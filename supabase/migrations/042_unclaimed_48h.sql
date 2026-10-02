-- 042: unclaimed cases close after 48 hours instead of 24.
--
-- expire_unclaimed_cases() is defined once, in 007 (nothing later redefines
-- it; 011 only schedules run_case_maintenance(), which calls it). This is
-- that definition copied exactly, with two changes:
--   1. interval '24 hours' -> interval '48 hours'
--   2. the timeline note says 48 hours (it is shown to users verbatim:
--      case_update events have no localized text).
-- Already-closed cases are not reopened. CREATE OR REPLACE keeps the
-- owner and grants. NOT applied — review, then run in the SQL editor.

begin;

-- 4c-ii: hard TTL — an open case nobody claimed in 48h closes as expired.
-- The map must stay trustworthy: a pin means "an animal likely needs help
-- NOW", not "someone saw something days ago".
create or replace function public.expire_unclaimed_cases()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  with expired as (
    update public.cases
      set status = 'closed', closed_reason = 'expired'
      where status = 'open' and hidden = false
        and created_at < now() - interval '48 hours'
      returning id
  )
  insert into public.case_events (case_id, actor_id, type, note)
  select id, null, 'case_update',
         'Automatically archived: open for 48 hours without a rescuer. The animal may still be in the area.'
  from expired;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

commit;
