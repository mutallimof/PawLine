-- ============================================================================
-- PawLine — migration 023: XP retune, hidden-gated report XP, review-only
-- abuse-signal lists
-- ----------------------------------------------------------------------------
-- 1. award_xp() retuned: reporter +10 → +5, rescuer +50 → +10. Vet XP (+30)
--    removed entirely — vets are rated by stars (migration 014, C2), not XP.
--    cases_helped increments are UNCHANGED: rescuer and vet both still get
--    +1 (that counter isn't part of this ask).
-- 2. Reporter's +5 is now gated on the case NOT being hidden at the moment
--    it resolves. Rescuer XP is unaffected either way. This is the "easy
--    half" only — a case hidden AFTER it already resolved (and XP already
--    paid) is NOT clawed back. That needs a ledger recording what was
--    granted per case (nothing here tracks that today), and is explicitly
--    deferred, not attempted.
-- 3. Two new admin-only, review-only RPCs, mirroring admin_reported_accounts
--    (015) exactly — same shape (is_admin() gate, SECURITY DEFINER, joined
--    to profiles so only accounts admin_flag_account can actually act on
--    are returned), same non-action: they SELECT, they never call
--    admin_flag_account or touch banned/hidden themselves. The admin
--    reviews the list and presses ban manually, same as the existing
--    Flagged tab.
--      - admin_hidden_ratio_accounts: total/hidden case counts per creator,
--        with a minimum case FLOOR so a brand-new account's first hidden
--        case (1-of-1 = 100%) can't appear. Defaults: at least 3 cases
--        created, at least 50% of them hidden.
--      - admin_high_volume_reporters: reuses the exact `created_at > now()
--        - interval '1 hour' / '24 hours'` windows enforce_case_limits()
--        (021) already gates creation on, as review signals rather than a
--        hard block. Defaults match 021's hard caps (4/hour, 7/24h) — this
--        surfaces accounts that have been hitting the rate limit, not a
--        new, separate, unexplained threshold.
-- ============================================================================

create or replace function public.award_xp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    update public.profiles
      set xp = xp + 10, cases_helped = cases_helped + 1
      where id = new.rescuer_id;
    update public.profiles
      set cases_helped = cases_helped + 1
      where id = new.vet_id;
    if not new.hidden then
      update public.profiles
        set xp = xp + 5
        where id = new.reporter_id;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Review signal 1: accounts whose own reports get hidden unusually often.
-- ---------------------------------------------------------------------------
create or replace function public.admin_hidden_ratio_accounts(
  p_min_cases integer default 3,
  p_min_ratio numeric default 0.5
)
returns table (
  profile_id    uuid,
  display_name  text,
  total_cases   bigint,
  hidden_cases  bigint,
  hidden_ratio  numeric
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;

  return query
  select
    c.creator_uid as profile_id,
    p.display_name,
    count(*)::bigint as total_cases,
    count(*) filter (where c.hidden)::bigint as hidden_cases,
    round(count(*) filter (where c.hidden)::numeric / count(*), 2) as hidden_ratio
  from public.cases c
  join public.profiles p on p.id = c.creator_uid
  group by c.creator_uid, p.display_name
  having count(*) >= p_min_cases
     and count(*) filter (where c.hidden)::numeric / count(*) >= p_min_ratio
  order by hidden_ratio desc, total_cases desc;
end;
$$;

grant execute on function public.admin_hidden_ratio_accounts(integer, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Review signal 2: accounts currently at/above the creation-rate-limit
-- windows (021) — not a new block, just visibility into who's hitting it.
-- ---------------------------------------------------------------------------
create or replace function public.admin_high_volume_reporters(
  p_hour_threshold integer default 4,
  p_day_threshold  integer default 7
)
returns table (
  profile_id    uuid,
  display_name  text,
  cases_1h      bigint,
  cases_24h     bigint
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;

  return query
  select
    c.creator_uid as profile_id,
    p.display_name,
    count(*) filter (where c.created_at > now() - interval '1 hour')::bigint as cases_1h,
    count(*)::bigint as cases_24h
  from public.cases c
  join public.profiles p on p.id = c.creator_uid
  where c.created_at > now() - interval '24 hours'
  group by c.creator_uid, p.display_name
  having count(*) filter (where c.created_at > now() - interval '1 hour') >= p_hour_threshold
      or count(*) >= p_day_threshold
  order by cases_24h desc, cases_1h desc;
end;
$$;

grant execute on function public.admin_high_volume_reporters(integer, integer) to authenticated;
