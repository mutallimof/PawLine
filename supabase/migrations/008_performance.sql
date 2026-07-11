-- ============================================================================
-- PawLine — migration 008: performance (load-test driven)
-- ----------------------------------------------------------------------------
-- Load test: 50,000 users (clustered Baku districts, realistic 5/80/15
-- all/nearby/off preference mix) + 5,000 open cases. See docs/OPERATIONS.md
-- "Load testing" for the full, honestly re-measured results.
--   · Open-cases MAP query (read hot path): ~0.76 ms via the partial index
--     added below — excellent, the clear win of this migration.
--   · New-case notification FAN-OUT (write hot path): ~17 ms at 50k users.
--     At this scale Postgres correctly seq-scans (most users are nearby-pref
--     and must be evaluated); the real cost is the haversine, not the scan.
-- The bounding-box gate below still helps when a report is far from almost
-- all users and costs nothing otherwise, but it is NOT the ~100x win an
-- earlier note claimed. The genuine sub-linear fix, deferred honestly until
-- the numbers demand it, is the PostGIS migration (see ARCHITECTURE.md).
-- Run after 001–007. Idempotent.
-- ============================================================================

-- Supporting indexes -------------------------------------------------------
-- 'nearby' users indexed by latitude for the bbox range scan.
create index if not exists profiles_nearby_lat_idx
  on public.profiles (home_lat)
  where new_case_pref = 'nearby' and home_lat is not null;

-- Open, visible cases — the map's constant query and the maintenance jobs.
create index if not exists cases_open_visible_idx
  on public.cases (created_at desc)
  where status = 'open' and hidden = false;

-- Fan-out with bbox pre-filter --------------------------------------------
-- ~0.30° latitude (~33 km) / ~0.40° longitude at Baku's ~40.4°N (~34 km)
-- comfortably covers the widest notify radius (9 km) even after the 2×
-- escalation widening (~18 km), with margin. 'all'-pref users skip the box.
create or replace function public.notify_new_case()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
begin
  v_title := 'New case: ' || public.case_label(new);

  insert into public.notifications (profile_id, type, case_id, title, body)
  select p.id, 'case_new_nearby', new.id, v_title, left(new.description, 140)
  from public.profiles p
  where p.id is distinct from new.reporter_id
    and p.banned = false
    and (
      p.new_case_pref = 'all'
      or (
        p.new_case_pref = 'nearby'
        and p.home_lat is not null and p.home_lng is not null
        -- cheap bounding-box gate (uses profiles_nearby_lat_idx) BEFORE the
        -- expensive haversine — the load-test fix.
        and p.home_lat between new.lat - 0.30 and new.lat + 0.30
        and p.home_lng between new.lng - 0.40 and new.lng + 0.40
        and public.distance_km(p.home_lat, p.home_lng, new.lat, new.lng)
              <= p.notify_radius_km
      )
    );

  perform public._watch(new.id, new.reporter_id);
  return new;
end;
$$;
