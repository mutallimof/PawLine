-- ============================================================================
-- PawLine — migration 021: tighter per-reporter case-creation limits
-- ----------------------------------------------------------------------------
-- Reports are never created through an RPC — the client does a plain
-- `insert into cases` under RLS ("signed-in or anonymous sessions can
-- report", 003), and public.enforce_case_limits() (005) is the BEFORE
-- INSERT trigger that actually gates it. This redefines that same trigger
-- rather than adding a new one, since Postgres fires all BEFORE INSERT
-- triggers on a table but gives no ordering guarantee between them — two
-- independent triggers both computing "how many cases does this reporter
-- have" would be redundant and could disagree.
--
-- creator_uid is already forced from auth.uid() one line into the function
-- (S4, 005) before any check runs, so both new checks below key off that
-- re-derived value — never new.reporter_id, which the client still supplies
-- and which is only a display link to profiles (null for guest sessions).
--
-- NEW:
--   - OPEN CASES cap (3): a reporter with 3 reports not yet resolved/closed
--     is asked to wrap one up before starting another — catches someone
--     repeatedly reporting without follow-through, independent of timing.
--     'resolved'/'closed' as "not open" matches the existing convention in
--     012's DM-restriction check.
--   - 24H TOTAL cap (7): replaces the old 15/24h cap. 15 was already
--     unreachable in practice once this ships (7 always trips first), so
--     leaving it would just be a dead, misleading threshold.
-- UNCHANGED: the 4/hour burst cap and the 40/hour anonymous circuit
-- breaker — different dimensions (burst speed, platform-wide guest spam),
-- not what this migration was asked to touch.
-- ============================================================================

create or replace function public.enforce_case_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hour int;
  v_open int;
  v_day  int;
  v_anon_hour int;
begin
  -- S4: never trust the client's claim of who created this row. Client
  -- sessions always have auth.uid(); coalesce keeps trusted service_role /
  -- seed inserts (which have no JWT) able to set it explicitly — a case our
  -- local adversarial harness caught (see TESTING_REPORT §C pass 2).
  new.creator_uid := coalesce(auth.uid(), new.creator_uid);

  if public.is_banned() then
    raise exception 'This account cannot create reports.';
  end if;

  select count(*) into v_hour from public.cases
    where creator_uid = auth.uid() and created_at > now() - interval '1 hour';
  if v_hour >= 4 then
    raise exception 'Too many reports from this device in the last hour. Please wait a while before reporting again.';
  end if;

  select count(*) into v_open from public.cases
    where creator_uid = auth.uid() and status not in ('resolved', 'closed');
  if v_open >= 3 then
    raise exception 'You already have too many open reports. Please wait for one to be resolved (or drop it) before reporting another.';
  end if;

  select count(*) into v_day from public.cases
    where creator_uid = auth.uid() and created_at > now() - interval '24 hours';
  if v_day >= 7 then
    raise exception 'You''ve reached today''s reporting limit for this device. Please try again tomorrow.';
  end if;

  -- S5: circuit breaker for anonymous sessions collectively.
  if public.is_anon_user() then
    select count(*) into v_anon_hour from public.cases c
      where c.created_at > now() - interval '1 hour'
        and not exists (select 1 from public.profiles p where p.id = c.creator_uid);
    if v_anon_hour >= 40 then
      raise exception 'Guest reporting is briefly paused due to unusual volume — please create a free account to report right now.';
    end if;
  end if;

  return new;
end;
$$;
