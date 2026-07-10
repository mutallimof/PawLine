-- ============================================================================
-- PawLine — migration 007: pre-launch completeness
-- ----------------------------------------------------------------------------
-- Run after 001–006. Adds, mapped to the pre-launch review items:
--   4a  Rescuer-abandonment timeout (claimed-but-abandoned recovery)
--   4b  Structured report fields (injury / spot type — i18n-mapped)
--   4c  Community "not here" signal + hard 24h TTL for unclaimed cases
--   4d  Vet identity-change re-verification
--   §3  User blocking · safety acknowledgment · data export
--   One maintenance job replaces the 006 escalation schedule.
-- ============================================================================

-- 'closed' is only referenced inside function bodies below (parsed at call
-- time), never in defaults/constraints in this file — safe even when the
-- SQL editor wraps the script in one transaction.
alter type public.case_status add value if not exists 'closed';

-- ---------------------------------------------------------------------------
-- Case columns
-- ---------------------------------------------------------------------------
alter table public.cases
  add column if not exists closed_reason text
    check (closed_reason in ('community', 'expired')),
  -- 4a: stamped by every meaningful action on the case; the abandonment
  -- reverter keys off it (accepted_at alone can't tell "stuck" from
  -- "slowly progressing through vet confirmation").
  add column if not exists last_progress_at timestamptz not null default now(),
  -- 4b: structured, language-independent facts. Values are i18n KEYS —
  -- reporter picks in their language, rescuer reads in theirs.
  add column if not exists injury_type text
    check (injury_type in ('limping','bleeding','hit_by_car','weak','skin','trapped','unknown')),
  add column if not exists spot_type text
    check (spot_type in ('street','park','dumpster','building','courtyard','roadside'));

-- ---------------------------------------------------------------------------
-- Safety acknowledgment (first-accept waiver — server truth, follows account)
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists safety_ack_at timestamptz;
grant update (safety_ack_at) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- User blocking (DMs; case chat stays public space, moderated by admins)
-- ---------------------------------------------------------------------------
create table if not exists public.blocked_users (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocked_users enable row level security;
create policy "manage own block list" on public.blocked_users
  for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
grant select, insert, delete on public.blocked_users to authenticated;

create or replace function public.is_blocked_either_way(a uuid, b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.blocked_users
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

-- DMs respect blocks: opening a thread and sending into an existing one.
create or replace function public.get_or_create_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_conv uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to send messages.'; end if;
  if public.is_anon_user() then raise exception 'Create an account to send messages.'; end if;
  if public.is_banned() then raise exception 'This account cannot send messages.'; end if;
  if p_other = auth.uid() then raise exception 'You cannot message yourself.'; end if;
  if public.is_blocked_either_way(auth.uid(), p_other) then
    raise exception 'Messaging is not available with this user.';
  end if;

  select cp1.conversation_id into v_conv
  from public.conversation_participants cp1
  join public.conversation_participants cp2
    on cp1.conversation_id = cp2.conversation_id
  where cp1.profile_id = auth.uid() and cp2.profile_id = p_other
    and (select count(*) from public.conversation_participants cp3
         where cp3.conversation_id = cp1.conversation_id) = 2
  limit 1;

  if v_conv is null then
    insert into public.conversations default values returning id into v_conv;
    insert into public.conversation_participants (conversation_id, profile_id)
    values (v_conv, auth.uid()), (v_conv, p_other);
  end if;
  return v_conv;
end;
$$;

drop policy if exists "participants in good standing send messages" on public.messages;
create policy "participants in good standing send messages"
  on public.messages for insert with check (
    sender_id = auth.uid()
    and not public.is_anon_user()
    and not public.is_banned()
    and public.is_conversation_member(conversation_id)
    and not exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id
        and cp.profile_id <> auth.uid()
        and public.is_blocked_either_way(auth.uid(), cp.profile_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 4c-i: community "animal not here / already helped" signal
-- ---------------------------------------------------------------------------
create table if not exists public.case_not_here_flags (
  case_id     uuid not null references public.cases (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (case_id, profile_id)
);
alter table public.case_not_here_flags enable row level security;
create policy "see own not-here flags" on public.case_not_here_flags
  for select using (profile_id = auth.uid());
grant select on public.case_not_here_flags to authenticated;
-- inserts only via the RPC (validation lives there)

create or replace function public.flag_not_here(p_case uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  c public.cases;
  v_count int;
begin
  if auth.uid() is null or public.is_anon_user() then
    raise exception 'Sign in to flag a case.';
  end if;
  if public.is_banned() then raise exception 'This account cannot flag cases.'; end if;

  select * into c from public.cases where id = p_case;
  if c.id is null then raise exception 'Case not found.'; end if;
  if c.status <> 'open' then raise exception 'Only open, unclaimed cases can be flagged.'; end if;
  if c.creator_uid = auth.uid() then
    raise exception 'You reported this case — use your own case page instead.';
  end if;

  insert into public.case_not_here_flags (case_id, profile_id)
  values (p_case, auth.uid())
  on conflict do nothing;

  select count(distinct profile_id) into v_count
  from public.case_not_here_flags where case_id = p_case;

  -- Three independent people is the community-consensus bar. Soft, humane
  -- close: nothing is deleted; the timeline says exactly what happened.
  if v_count >= 3 and c.status = 'open' then
    update public.cases
      set status = 'closed', closed_reason = 'community'
      where id = p_case and status = 'open';
    insert into public.case_events (case_id, actor_id, type, note)
    values (p_case, null, 'case_update',
            'Closed by community: several people nearby reported the animal is no longer here or already helped.');
  end if;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4a + 4c-ii: progress stamping + the unified maintenance job
-- ---------------------------------------------------------------------------
-- Every meaningful action refreshes last_progress_at. Recreated functions
-- keep their latest audited bodies (003/005) — only the stamp is added.

create or replace function public.accept_case(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  if auth.uid() is null or public.is_anon_user() then
    raise exception 'Sign in to accept a case.';
  end if;
  if public.is_banned() then raise exception 'This account cannot accept cases.'; end if;

  update public.cases
    set status = 'accepted', rescuer_id = auth.uid(), accepted_at = now(),
        last_progress_at = now()
    where id = p_case and status = 'open';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'This case was already accepted by someone else.';
  end if;

  perform public._watch(p_case, auth.uid());
  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'case_accepted', 'A rescuer committed to help.');
end;
$$;

create or replace function public.select_vet(p_case uuid, p_vet uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
  v_clinic text;
begin
  select clinic_name into v_clinic from public.vets
    where id = p_vet and status = 'approved';
  if v_clinic is null then
    raise exception 'Vet not found or not yet verified.';
  end if;

  update public.cases
    set status = 'vet_selected', vet_id = p_vet, last_progress_at = now()
    where id = p_case and rescuer_id = auth.uid()
      and status in ('accepted', 'vet_selected');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Only the active rescuer can choose a vet at this stage.';
  end if;

  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'vet_requested',
          'Rescuer asked ' || v_clinic || ' to receive the animal.');
end;
$$;

create or replace function public.vet_respond(p_case uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  if p_accept then
    update public.cases set status = 'vet_confirmed', last_progress_at = now()
      where id = p_case and vet_id = auth.uid() and status = 'vet_selected';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'No pending request for your clinic on this case.'; end if;

    perform public._watch(p_case, auth.uid());
    insert into public.case_events (case_id, actor_id, type, note)
    values (p_case, auth.uid(), 'vet_confirmed',
            'The clinic is ready to receive the animal.');
  else
    update public.cases set status = 'accepted', vet_id = null, last_progress_at = now()
      where id = p_case and vet_id = auth.uid() and status = 'vet_selected';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'No pending request for your clinic on this case.'; end if;

    insert into public.case_events (case_id, actor_id, type, note)
    values (p_case, auth.uid(), 'vet_declined',
            'The clinic cannot receive the animal right now — please choose another vet.');
  end if;
end;
$$;

create or replace function public.start_transport(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  update public.cases set status = 'en_route', last_progress_at = now()
    where id = p_case and rescuer_id = auth.uid() and status = 'vet_confirmed';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'The vet must confirm before you set off.';
  end if;

  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'case_en_route',
          'The rescuer is on the way to the vet.');
end;
$$;

create or replace function public.update_rescuer_location(
  p_case uuid, p_lat double precision, p_lng double precision
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.cases
    set rescuer_lat = p_lat, rescuer_lng = p_lng, rescuer_loc_at = now(),
        last_progress_at = now()
    where id = p_case and rescuer_id = auth.uid() and status = 'en_route';
end;
$$;

create or replace function public.vet_post_update(p_case uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  select exists (select 1 from public.cases where id = p_case and vet_id = auth.uid())
  into v_ok;
  if not v_ok then raise exception 'Only the case''s vet can post updates.'; end if;

  update public.cases set last_progress_at = now() where id = p_case;
  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'case_update', left(p_note, 500));
end;
$$;

-- 4a: claimed-but-abandoned recovery. Distinct failure mode from 006's
-- never-accepted escalation. 45 min without progress in the claim/vet
-- stages, 75 min while en_route (roads are slow; a live location ping
-- counts as progress) → back to open, everyone honestly informed.
create or replace function public.revert_abandoned_cases()
returns integer language plpgsql security definer set search_path = public as $$
declare
  c record;
  v_count int := 0;
begin
  for c in
    select id, rescuer_id from public.cases
    where hidden = false
      and (
        (status in ('accepted', 'vet_selected', 'vet_confirmed')
          and last_progress_at < now() - interval '45 minutes')
        or (status = 'en_route'
          and last_progress_at < now() - interval '75 minutes')
      )
  loop
    update public.cases
      set status = 'open', rescuer_id = null, vet_id = null,
          accepted_at = null, rescuer_lat = null, rescuer_lng = null,
          rescuer_loc_at = null, last_progress_at = now()
      where id = c.id;

    insert into public.case_events (case_id, actor_id, type, note)
    values (c.id, null, 'case_dropped',
            'No progress for a while — the case was automatically reopened so other rescuers can step in.');

    if c.rescuer_id is not null then
      insert into public.notifications (profile_id, type, case_id, title, body)
      values (c.rescuer_id, 'case_update', c.id,
              'Your rescue was reopened',
              'We hadn''t seen progress in a while, so the case is open to others again. If you''re still on it, you can re-accept.');
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- 4c-ii: hard TTL — an open case nobody claimed in 24h closes as expired.
-- The map must stay trustworthy: a pin means "an animal likely needs help
-- NOW", not "someone saw something yesterday".
create or replace function public.expire_unclaimed_cases()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  with expired as (
    update public.cases
      set status = 'closed', closed_reason = 'expired'
      where status = 'open' and hidden = false
        and created_at < now() - interval '24 hours'
      returning id
  )
  insert into public.case_events (case_id, actor_id, type, note)
  select id, null, 'case_update',
         'Automatically archived: open for 24 hours without a rescuer. The animal may still be in the area.'
  from expired;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- One job to rule them: replaces 006's escalate-only schedule.
create or replace function public.run_case_maintenance()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.escalate_stale_cases();
  perform public.revert_abandoned_cases();
  perform public.expire_unclaimed_cases();
end;
$$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job
    where jobname in ('pawline-escalate-stale-cases', 'pawline-case-maintenance');
  perform cron.schedule('pawline-case-maintenance', '*/10 * * * *',
                        'select public.run_case_maintenance()');
exception when others then
  raise notice 'pg_cron unavailable here (%) — schedule run_case_maintenance() manually on Supabase.', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 4d: vet identity-change re-verification
-- ---------------------------------------------------------------------------
-- A verified badge belongs to a VERIFIED name+address. Change either and
-- the badge comes off until an admin re-checks — silently keeping it on
-- changed information is exactly how account-takeover impersonation works.
create or replace function public.vet_identity_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'approved'
     and (new.clinic_name is distinct from old.clinic_name
          or new.address is distinct from old.address) then
    new.status := 'pending';

    insert into public.notifications (profile_id, type, title, body)
    values (new.id, 'case_update', 'Clinic details changed — re-verification needed',
            'Because your clinic name or address changed, your listing is hidden until the PawLine team re-verifies it.');

    insert into public.notifications (profile_id, type, title, body)
    select p.id, 'case_update', 'Vet re-verification needed',
           coalesce(old.clinic_name, 'A clinic') || ' changed its name/address and needs re-approval.'
    from public.profiles p where p.is_admin = true;
  end if;
  return new;
end;
$$;

drop trigger if exists on_vet_identity_change on public.vets;
create trigger on_vet_identity_change
  before update on public.vets
  for each row execute function public.vet_identity_guard();

-- ---------------------------------------------------------------------------
-- Data export (self-serve, GDPR-shaped): everything WE hold about YOU.
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = auth.uid()),
    'clinic',  (select to_jsonb(v) from public.vets v where v.id = auth.uid()),
    'cases_reported', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
      from public.cases c
      where c.reporter_id = auth.uid() or c.creator_uid = auth.uid()),
    'cases_rescued', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
      from public.cases c where c.rescuer_id = auth.uid()),
    'case_messages_sent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'case_id', m.case_id, 'body', m.body, 'created_at', m.created_at)
        order by m.created_at), '[]'::jsonb)
      from public.case_messages m where m.sender_id = auth.uid()),
    'direct_messages_sent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'conversation_id', m.conversation_id, 'body', m.body, 'created_at', m.created_at)
        order by m.created_at), '[]'::jsonb)
      from public.messages m where m.sender_id = auth.uid()),
    'watching_cases', (
      select coalesce(jsonb_agg(w.case_id), '[]'::jsonb)
      from public.case_watchers w where w.profile_id = auth.uid()),
    'reports_filed', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb)
      from public.content_reports r where r.reporter_id = auth.uid()),
    'push_devices', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'endpoint', s.endpoint, 'created_at', s.created_at)), '[]'::jsonb)
      from public.push_subscriptions s where s.profile_id = auth.uid()),
    'blocked_users', (
      select coalesce(jsonb_agg(b.blocked_id), '[]'::jsonb)
      from public.blocked_users b where b.blocker_id = auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Grants for everything above
-- ---------------------------------------------------------------------------
grant execute on function public.flag_not_here(uuid)          to authenticated;
grant execute on function public.export_my_data()             to authenticated;
-- (maintenance functions are invoked by pg_cron as the database owner —
--  deliberately NOT granted to authenticated users)
grant execute on function public.is_blocked_either_way(uuid, uuid) to authenticated;
