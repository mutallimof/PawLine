-- ============================================================================
-- PawLine — migration 035: guest reports carry 18+ / Terms consent
-- ----------------------------------------------------------------------------
-- Guests report on an anonymous session, which has no profiles row (the
-- handle_new_user trigger skips anonymous users), so 034's profile columns
-- can't hold their consent. It is stored on the case row instead:
--
--   cases.terms_version      sent by the app with a guest report
--   cases.terms_accepted_at  set by the server (now()) when the row is inserted
--
-- enforce_case_limits() (latest: 021 — nothing later redefines it) is copied
-- exactly, with one block added after the ban check: an anonymous reporter
-- without terms_version is refused; otherwise terms_accepted_at is stamped
-- with the server's time. For signed-in reporters both columns are cleared —
-- their consent is on the profile.
--
-- No grant change: case inserts use the table-level INSERT grant (004), not
-- column grants, so the new columns are insertable as-is.
--
-- Wrapped in one transaction: if any statement fails, nothing is applied.
-- ============================================================================

begin;

alter table public.cases
  add column if not exists terms_version text
    check (terms_version is null or char_length(terms_version) <= 32),
  add column if not exists terms_accepted_at timestamptz;

-- enforce_case_limits — latest definition: migration 021
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

  -- 035: guests (anonymous sessions, no profile) must send consent with the
  -- report itself. The acceptance time is always the server's clock —
  -- anything the client put in terms_accepted_at is overwritten. Signed-in
  -- reporters' consent lives on their profile (034), so both are cleared.
  if public.is_anon_user() then
    if coalesce(btrim(new.terms_version), '') = '' then
      raise exception 'Please confirm you are 18 or older and accept the Terms before reporting.';
    end if;
    new.terms_accepted_at := now();
  else
    new.terms_version := null;
    new.terms_accepted_at := null;
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

commit;
