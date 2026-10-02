-- 041: what a case needs on the ground ("Needs").
--
-- A fixed, language-independent list — water, food, carrier, blanket,
-- first_aid, transport — so every viewer reads it in their own language.
--
--   * cases.needs text[]: empty by default; a CHECK keeps it to the list.
--   * The reporter picks them on the report form (optional). The existing
--     cases INSERT grant (004) and policy cover the column; the CHECK is the
--     server-side validation.
--   * Later changes go ONLY through set_case_needs(), which checks the caller:
--     the reporter (reporter_id, or the guest session that created the case,
--     creator_uid) or the CURRENT rescuer, not banned, case still live and
--     not hidden. There is no client UPDATE grant on cases, so there is no
--     other way to change it.
--   * Public: added to the column-level SELECT grant (036) and to the
--     realtime signal trigger's column list so open pages refresh.
--
-- NOT applied — review, then run in the SQL editor.

begin;

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------
alter table public.cases
  add column if not exists needs text[] not null default '{}';

alter table public.cases drop constraint if exists cases_needs_allowed;
alter table public.cases
  add constraint cases_needs_allowed check (
    needs <@ array['water', 'food', 'carrier', 'blanket', 'first_aid', 'transport']::text[]
    and cardinality(needs) <= 6
  );

-- ---------------------------------------------------------------------------
-- 2. Public read (036 replaced the table grant with a column list)
-- ---------------------------------------------------------------------------
grant select (needs) on public.cases to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Realtime: a change of needs refreshes open pages (036's list + needs)
-- ---------------------------------------------------------------------------
drop trigger if exists on_case_signal on public.cases;
create trigger on_case_signal
  after insert or update of reporter_id, guest_name, animal, description, lat, lng, address_hint, street_address, status, rescuer_id, vet_id, accepted_at, resolved_at, hidden, escalated_at, closed_reason, injury_type, spot_type, urgency, pinned_message_id, chat_closed_at, needs
  on public.cases
  for each row execute function public.touch_case_signal();

-- ---------------------------------------------------------------------------
-- 4. Update RPC — reporter or current rescuer only
-- ---------------------------------------------------------------------------
create or replace function public.set_case_needs(p_case uuid, p_needs text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  c record;
  v_needs text[];
begin
  if v_uid is null then
    raise exception 'Sign in to update this case.';
  end if;
  if public.is_banned() then
    raise exception 'Your account is suspended.';
  end if;

  select reporter_id, creator_uid, rescuer_id, status, hidden
    into c
    from public.cases where id = p_case
    for update;
  if not found then
    raise exception 'Case not found.';
  end if;

  if not (v_uid = c.reporter_id or v_uid = c.creator_uid or v_uid = c.rescuer_id) then
    raise exception 'Only the reporter or the current rescuer can change what this case needs.';
  end if;
  if c.hidden or c.status in ('resolved', 'closed') then
    raise exception 'This case can no longer be changed.';
  end if;

  -- De-duplicate and keep a stable order; unknown values fail the CHECK.
  select coalesce(array_agg(distinct n order by n), '{}')
    into v_needs
    from unnest(coalesce(p_needs, '{}')) as n;

  update public.cases set needs = v_needs where id = p_case;
end;
$$;

revoke all on function public.set_case_needs(uuid, text[]) from public, anon;
-- Guests report through an anonymous session, which is `authenticated`.
grant execute on function public.set_case_needs(uuid, text[]) to authenticated;

commit;
