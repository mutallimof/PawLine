-- ============================================================================
-- PawLine — migration 038: data retention
-- ----------------------------------------------------------------------------
-- Periods (decided):
--   - case chat (case_messages): 90 days after the case is resolved/closed
--   - case photos (rows + files): 6 months after resolved/closed — COUNTED
--     here only; files must be removed through the Storage API, so deletion
--     is done by an Edge Function (planned separately). The case row stays.
--   - notifications: 90 days after they were created
--   - guest (anonymous) auth users: older than 30 days and no open case;
--     creator_uid on their finished cases is nulled first
--   - kept: clinic documents, accounts, profiles, DMs (until account deletion)
--
-- 1. cases.closed_at. There was no close timestamp: resolved cases have
--    resolved_at, but the two close paths (flag_not_here's community close
--    and expire_unclaimed_cases, both 007) only set status/closed_reason.
--    A trigger stamps closed_at whenever status becomes 'closed' and clears
--    it whenever status leaves 'closed' — so it holds for every close path,
--    present or future, and a reopened case is never "finished".
--    Backfill: both close paths write a case_events row in the same
--    statement, so a closed case's latest event is its close time; cases
--    with no events fall back to created_at. Resolved cases missing
--    resolved_at (none expected) get the same treatment.
--    closed_at is server-only: not in 036's column-level read grant.
--
-- 2. content_reports.target_message: ON DELETE CASCADE -> SET NULL, so a
--    reviewed report survives its message being purged (reason, case and
--    status stay). A message with an OPEN report is not purged until an
--    admin resolves or dismisses the report.
--
-- 3. run_retention(p_dry_run boolean default true) returns counts per
--    category as jsonb and deletes only when p_dry_run = false. SECURITY
--    DEFINER; execute revoked from public, anon and authenticated.
--
-- 4. New daily pg_cron job 'pawline-retention' at 03:17 UTC — separate from
--    the hourly 'pawline-case-maintenance' (011): retention is heavier, needs
--    no hourly cadence, and can be paused on its own. Its first run deletes
--    the whole backlog: run `select public.run_retention();` (dry run) after
--    applying, before 03:17 UTC, to see what that will be.
--
-- References checked for the rows being deleted:
--   case_messages  <- cases.pinned_message_id (SET NULL; unpinned explicitly
--                     first), content_reports.target_message (see 2).
--                     Nothing else references case_messages.
--   case_photos    <- nothing references it. The duplicate scan
--                     (check_case_duplicates, 003) only compares reports
--                     <= 90 min apart, so 6-month-old hashes are never read;
--                     stored case_duplicate_flags keep their distances.
--   notifications  <- nothing references it (send-push fires on INSERT).
--   guest users    <- profiles only, and guests have none (handle_new_user
--                     skips anonymous users, 003/024); cases.creator_uid has
--                     no FK and is nulled explicitly. Guard below aborts if
--                     anything outside the auth schema could block deleting
--                     an auth user.
--   case_events    stay (the case stays); they hold no message text.
--
-- Wrapped in one transaction: if any statement fails, nothing is applied.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Guards
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_hits text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'is_anonymous'
  ) then
    raise exception '038 aborted: auth.users.is_anonymous not found';
  end if;

  select string_agg(format('%s.%s', con.conrelid::regclass, a.attname), '; ')
    into v_hits
  from pg_constraint con
  join pg_class c      on c.oid = con.conrelid
  join pg_namespace n  on n.oid = c.relnamespace
  join pg_attribute a  on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
  where con.contype = 'f'
    and con.confrelid = 'auth.users'::regclass
    and n.nspname <> 'auth'
    and (con.confdeltype in ('a', 'r')
         or (con.confdeltype in ('n', 'd') and a.attnotnull));

  if v_hits is not null then
    raise exception '038 aborted: these foreign keys would block deleting guest users: %', v_hits;
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 1. cases.closed_at
-- ---------------------------------------------------------------------------
alter table public.cases
  add column if not exists closed_at timestamptz;

create or replace function public.stamp_case_closed_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.closed_at := now();
  elsif new.status <> 'closed' then
    new.closed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists on_case_closed_at on public.cases;
create trigger on_case_closed_at
  before update of status on public.cases
  for each row execute function public.stamp_case_closed_at();

-- Backfill (updates closed_at / resolved_at only, so the status trigger
-- above does not fire).
update public.cases c
  set closed_at = coalesce(
    (select max(e.created_at) from public.case_events e where e.case_id = c.id),
    c.created_at)
  where c.status = 'closed' and c.closed_at is null;

update public.cases c
  set resolved_at = coalesce(
    (select max(e.created_at) from public.case_events e where e.case_id = c.id),
    c.created_at)
  where c.status = 'resolved' and c.resolved_at is null;

-- ---------------------------------------------------------------------------
-- 2. content_reports.target_message: CASCADE -> SET NULL
-- ---------------------------------------------------------------------------
do $fk$
declare
  v_conname text;
begin
  for v_conname in
    select con.conname
    from pg_constraint con
    join pg_attribute a
      on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
    where con.conrelid = 'public.content_reports'::regclass
      and con.contype = 'f'
      and a.attname = 'target_message'
  loop
    execute format('alter table public.content_reports drop constraint %I', v_conname);
  end loop;
end
$fk$;

alter table public.content_reports
  add constraint content_reports_target_message_fkey
  foreign key (target_message) references public.case_messages (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. run_retention
-- ---------------------------------------------------------------------------
create or replace function public.run_retention(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg_ids     bigint[];
  v_held        int;
  v_unpinned    int := 0;
  v_notifs      int;
  v_photos      int;
  v_guest_ids   uuid[];
  v_guest_cases int := 0;
begin
  -- Case chat: 90 days after the case finished. Messages with an open
  -- report wait for the admin.
  select coalesce(array_agg(m.id), '{}') into v_msg_ids
  from public.case_messages m
  join public.cases c on c.id = m.case_id
  where ((c.status = 'resolved' and c.resolved_at < now() - interval '90 days')
      or (c.status = 'closed'   and c.closed_at   < now() - interval '90 days'))
    and not exists (
      select 1 from public.content_reports r
      where r.target_message = m.id and r.status = 'open'
    );

  select count(*) into v_held
  from public.case_messages m
  join public.cases c on c.id = m.case_id
  where ((c.status = 'resolved' and c.resolved_at < now() - interval '90 days')
      or (c.status = 'closed'   and c.closed_at   < now() - interval '90 days'))
    and exists (
      select 1 from public.content_reports r
      where r.target_message = m.id and r.status = 'open'
    );

  -- Photos: 6 months after the case finished. Counted only — the files
  -- are removed (with their rows) by the retention Edge Function.
  select count(*) into v_photos
  from public.case_photos p
  join public.cases c on c.id = p.case_id
  where (c.status = 'resolved' and c.resolved_at < now() - interval '6 months')
     or (c.status = 'closed'   and c.closed_at   < now() - interval '6 months');

  -- Guests: anonymous users older than 30 days with no open case.
  select coalesce(array_agg(u.id), '{}') into v_guest_ids
  from auth.users u
  where u.is_anonymous
    and u.created_at < now() - interval '30 days'
    and not exists (
      select 1 from public.cases c
      where c.creator_uid = u.id and c.status not in ('resolved', 'closed')
    );

  if p_dry_run then
    select count(*) into v_unpinned
    from public.cases where pinned_message_id = any (v_msg_ids);
    select count(*) into v_notifs
    from public.notifications where created_at < now() - interval '90 days';
    select count(*) into v_guest_cases
    from public.cases where creator_uid = any (v_guest_ids);
  else
    update public.cases set pinned_message_id = null
      where pinned_message_id = any (v_msg_ids);
    get diagnostics v_unpinned = row_count;
    delete from public.case_messages where id = any (v_msg_ids);

    delete from public.notifications where created_at < now() - interval '90 days';
    get diagnostics v_notifs = row_count;

    update public.cases set creator_uid = null where creator_uid = any (v_guest_ids);
    get diagnostics v_guest_cases = row_count;
    delete from auth.users where id = any (v_guest_ids) and is_anonymous;
  end if;

  return jsonb_build_object(
    'dry_run',                     p_dry_run,
    'case_messages_deleted',       cardinality(v_msg_ids),
    'case_messages_held_by_report', v_held,
    'cases_unpinned',              v_unpinned,
    'notifications_deleted',       v_notifs,
    'case_photos_due',             v_photos,
    'guest_users_deleted',         cardinality(v_guest_ids),
    'guest_cases_unlinked',        v_guest_cases
  );
end;
$$;

-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon and authenticated; take it away. pg_cron runs as the owner.
revoke execute on function public.run_retention(boolean) from public, anon, authenticated;
revoke execute on function public.stamp_case_closed_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Daily schedule
-- ---------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;

  perform cron.unschedule(jobid) from cron.job where jobname = 'pawline-retention';

  perform cron.schedule(
    'pawline-retention',
    '17 3 * * *',  -- daily, 03:17 UTC (quiet hours in Azerbaijan/Türkiye)
    $job$ select public.run_retention(false); $job$
  );
exception when others then
  raise notice 'pg_cron unavailable here (%) — schedule run_retention(false) daily (Supabase: Database → Cron).', sqlerrm;
end $$;

commit;
