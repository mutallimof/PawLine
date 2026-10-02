-- ============================================================================
-- PawLine — migration 040: per-type notification switches
-- ----------------------------------------------------------------------------
-- Four switches on the profile, all ON by default:
--   notify_new_cases       — new cases nearby (and the escalation re-alerts)
--   notify_case_updates    — updates on cases the user follows / is part of
--   notify_messages        — direct messages and case chat
--   notify_rescue_requests — clinics: a rescuer asks to bring an animal
--
-- ENFORCED SERVER-SIDE at the one place every notification is created: a
-- BEFORE INSERT trigger on public.notifications drops the row (RETURN NULL)
-- when the recipient has switched that kind off. Every creator inserts
-- there — checked against the latest definitions:
--   notify_new_case (008)          case_new_nearby  → new cases
--   escalate_stale_cases (013)     case_new_nearby  → new cases
--   _notify_watchers (001), via
--     notify_case_event (001)      the event's type → case updates
--     notify_case_message (001)    case_message     → messages
--   notify_case_event (001)        vet_requested to the case's clinic
--                                                   → rescue requests
--   notify_direct_message (001)    direct_message   → messages
--   revert_abandoned_cases (036)   case_update (to the rescuer) → updates
--   admin_set_vet_status (003),
--   vet_identity_guard (007)       case_update with NO case — account and
--                                  admin notices, always delivered
-- Push: the send-push Edge Function runs from a database webhook on INSERT
-- into notifications (OPERATOR_GUIDE A2). A row dropped here is never
-- inserted, so the webhook never fires and no push is sent — the switches
-- cover push and in-app alike. The realtime INSERT event and the unread
-- badge are skipped the same way.
--
-- vet_requested also reaches watchers through _notify_watchers ("a rescuer
-- asked clinic X"); for them it counts as a case update. Only the case's own
-- clinic is governed by notify_rescue_requests.
--
-- Writes: own row only, through set_notification_prefs() (SECURITY DEFINER,
-- auth.uid()). No column grant. Reads come back with get_my_profile()
-- (select * — 005), so no change there; the columns are not in the public
-- profiles column grant.
--
-- Run after 001–039. Wrapped in one transaction.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists notify_new_cases       boolean not null default true,
  add column if not exists notify_case_updates    boolean not null default true,
  add column if not exists notify_messages        boolean not null default true,
  add column if not exists notify_rescue_requests boolean not null default true;

-- ---------------------------------------------------------------------------
-- Enforcement
-- ---------------------------------------------------------------------------
create or replace function public.enforce_notification_prefs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_case_vet uuid;
begin
  select notify_new_cases, notify_case_updates, notify_messages, notify_rescue_requests
    into p
  from public.profiles
  where id = new.profile_id;
  if not found then
    return new;  -- no profile row (should not happen): deliver, as before
  end if;

  if new.type = 'case_new_nearby' then
    if not p.notify_new_cases then return null; end if;
  elsif new.type in ('case_message', 'direct_message') then
    if not p.notify_messages then return null; end if;
  elsif new.type = 'vet_requested' then
    select vet_id into v_case_vet from public.cases where id = new.case_id;
    if v_case_vet is not distinct from new.profile_id then
      if not p.notify_rescue_requests then return null; end if;  -- the clinic asked
    elsif not p.notify_case_updates then
      return null;                                               -- a watcher
    end if;
  elsif new.case_id is null then
    return new;  -- account / admin notices (clinic verification etc.)
  elsif not p.notify_case_updates then
    return null;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_notification_prefs() from public, anon, authenticated;

drop trigger if exists notifications_enforce_prefs on public.notifications;
create trigger notifications_enforce_prefs
  before insert on public.notifications
  for each row execute function public.enforce_notification_prefs();

-- ---------------------------------------------------------------------------
-- Own-row writes
-- ---------------------------------------------------------------------------
create or replace function public.set_notification_prefs(
  p_new_cases       boolean,
  p_case_updates    boolean,
  p_messages        boolean,
  p_rescue_requests boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or public.is_anon_user() then
    raise exception 'Sign in to change notification settings.';
  end if;

  update public.profiles
     set notify_new_cases       = coalesce(p_new_cases, notify_new_cases),
         notify_case_updates    = coalesce(p_case_updates, notify_case_updates),
         notify_messages        = coalesce(p_messages, notify_messages),
         notify_rescue_requests = coalesce(p_rescue_requests, notify_rescue_requests)
   where id = v_uid;

  if not found then
    raise exception 'Profile not found.';
  end if;
end;
$$;

revoke all on function public.set_notification_prefs(boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_notification_prefs(boolean, boolean, boolean, boolean) to authenticated;

commit;
