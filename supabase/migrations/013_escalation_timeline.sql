-- ============================================================================
-- PawLine — migration 013: escalation visibility (B5)
-- ----------------------------------------------------------------------------
-- escalate_stale_cases() (006_features.sql) already re-notifies nearby-pref
-- users when a case has sat open 30+ minutes — that part of B5 was already
-- done, just never actually running until migration 011 scheduled
-- run_case_maintenance() hourly. The one real gap: it never wrote a
-- case_events row, so the case's own timeline (CaseDetailPage — see
-- src/pages/CaseDetailPage.tsx) had no record of the escalation at all.
--
-- This adds exactly that one insert, in the same per-case loop, right after
-- escalated_at is stamped. No client change needed: the timeline already
-- renders any case_events row generically — event.<type> if a translation
-- key exists, else the raw note verbatim (see CaseDetailPage.tsx's
-- `hasKey('event.'+ev.type) ? t(...) : ev.note` — the exact pattern
-- 'case_update' rows from revert_abandoned_cases/expire_unclaimed_cases
-- (007_prelaunch.sql) already rely on) — so this note appears automatically
-- once the SQL below runs.
--
-- Everything else in escalate_stale_cases() — the 30-minute/hidden/limit-20
-- selection, the 2x-radius nearby notification, the "never repeated" guard
-- via escalated_at — is carried over byte-for-byte from 006_features.sql.
--
-- Run after 001–012. Idempotent (create or replace).
-- ============================================================================

create or replace function public.escalate_stale_cases()
returns integer language plpgsql security definer set search_path = public as $$
declare
  c public.cases;  -- typed (not RECORD) so case_label(c.*) casts — caught in local replay
  v_count int := 0;
begin
  for c in
    select * from public.cases
    where status = 'open' and hidden = false and escalated_at is null
      and created_at < now() - interval '30 minutes'
    order by created_at
    limit 20  -- per run; the 10-min cadence drains any backlog quickly
  loop
    update public.cases set escalated_at = now() where id = c.id;

    -- NEW (B5): a timeline entry so the case page shows this happened.
    -- actor_id null — same convention as revert_abandoned_cases/
    -- expire_unclaimed_cases for system-generated events, not a person's.
    insert into public.case_events (case_id, actor_id, type, note)
    values (c.id, null, 'case_update',
            'Still needs a rescuer after 30 minutes — nearby helpers have been notified again.');

    insert into public.notifications (profile_id, type, case_id, title, body)
    select p.id, 'case_new_nearby', c.id,
           'Still waiting: ' || public.case_label(c.*),
           left(c.description, 140)
    from public.profiles p
    where p.banned = false
      and p.new_case_pref = 'nearby'
      and p.home_lat is not null and p.home_lng is not null
      and public.distance_km(p.home_lat, p.home_lng, c.lat, c.lng)
            <= p.notify_radius_km * 2
      and p.id is distinct from c.reporter_id
      -- never double-notify anyone about this case
      and not exists (select 1 from public.notifications n
                      where n.case_id = c.id and n.profile_id = p.id);

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
