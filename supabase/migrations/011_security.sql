-- ============================================================================
-- PawLine — migration 011: Group A security fixes
-- ----------------------------------------------------------------------------
-- Source: docs/FIX_SPEC.md, Group A. Run after 001–010.
--
--   A1. case_photos SELECT never got the `hidden` check that cases and
--       case_messages have (audit finding). Admin hiding a case removed it
--       from the feed but left its images queryable via the table.
--   A3. escalate_stale_cases / revert_abandoned_cases / expire_unclaimed_cases
--       are only ever called through run_case_maintenance(), which nothing
--       schedules — pg_cron was never actually enabled on this project, so
--       migration 007's own schedule attempt silently no-op'd. This enables
--       pg_cron for real and schedules run_case_maintenance() hourly.
--
-- Out of scope (per FIX_SPEC Group A): A2, the public storage bucket, is
-- flagged only — see the analysis delivered alongside this file, not in SQL.
-- Nothing here touches the case state machine RPCs, migrations 001–010, or
-- any RLS policy not named above. Idempotent — safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A1: case_photos respects the parent case's `hidden` flag, same as
-- cases and case_messages already do. Admins still see everything.
-- ---------------------------------------------------------------------------
drop policy if exists "case photos are viewable by everyone" on public.case_photos;
create policy "visible case photos are viewable by everyone"
  on public.case_photos for select using (
    exists (
      select 1 from public.cases c
      where c.id = case_photos.case_id and (not c.hidden or public.is_admin())
    )
  );

-- ---------------------------------------------------------------------------
-- A3: enable pg_cron and schedule the maintenance job hourly.
-- Clears any stale job left by 006/007's own (evidently failed) attempts
-- before rescheduling, so there is exactly one job and one cadence.
-- ---------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;

  perform cron.unschedule(jobid) from cron.job
    where jobname in ('pawline-escalate-stale-cases', 'pawline-case-maintenance');

  perform cron.schedule(
    'pawline-case-maintenance',
    '0 * * * *',  -- hourly, on the hour
    $job$ select public.run_case_maintenance(); $job$
  );
exception when others then
  raise notice 'pg_cron unavailable here (%) — schedule run_case_maintenance() manually (Supabase: Database → Cron).', sqlerrm;
end $$;
