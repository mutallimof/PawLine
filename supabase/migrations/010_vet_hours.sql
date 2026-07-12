-- ============================================================================
-- PawLine — migration 010: vet operating hours
-- ----------------------------------------------------------------------------
-- THE PROBLEM THIS FIXES
-- Vets only had a manual `is_open` toggle. If a clinic closed for the night
-- and forgot to flip it, the app kept recommending them until morning — and a
-- rescuer carrying an injured animal could arrive at a locked door at 2am.
-- That is the worst possible failure for this app: the animal is already in
-- someone's arms and the plan has just evaporated.
--
-- THE MODEL
--   opens_at / closes_at : the clinic's real daily hours (local wall time)
--   is_24_7              : round-the-clock emergency clinics skip hours entirely
--   timezone             : hours are wall-clock, so they need a zone to mean
--                          anything (Baku and Istanbul differ by an hour)
--   is_open (existing)   : KEPT, but its meaning is now precise — it is the
--                          capacity switch ("we're open but full / can't take
--                          more right now"), not a stand-in for hours.
--
-- Availability = (is_24_7 OR inside today's hours) AND is_open.
-- The hours half is automatic. The capacity half stays a deliberate human act.
--
-- Deliberately NOT a 7-day-per-week schedule table: clinics in the launch
-- market keep simple daily hours, and a schema nobody fills in correctly is
-- worse than one that is always right. Per-weekday hours can be layered on
-- later without breaking this (the function is the only thing that would
-- change). Run after 001–009. Idempotent.
-- ============================================================================

alter table public.vets
  add column if not exists opens_at  time,
  add column if not exists closes_at time,
  add column if not exists is_24_7   boolean not null default false,
  add column if not exists timezone  text    not null default 'Asia/Baku';

comment on column public.vets.is_open is
  'Capacity switch: the clinic is within its hours but cannot accept more animals right now. NOT a substitute for opening hours — see opens_at/closes_at/is_24_7.';

-- ---------------------------------------------------------------------------
-- Is this clinic inside its stated hours right now?
--
-- Handles the three real cases:
--   · 24/7 clinic                        → always true
--   · normal day window (09:00 → 18:00)  → now between them
--   · OVERNIGHT window   (20:00 → 06:00) → closes_at < opens_at, so the window
--     wraps past midnight. This is the one everybody gets wrong, and it is
--     exactly the emergency-clinic case that matters most here.
--
-- Hours not set yet → treated as OPEN. Existing verified clinics predate this
-- column; silently hiding them all the moment this migration ran would be a
-- worse bug than the one being fixed. They get nudged to set hours instead.
-- ---------------------------------------------------------------------------
create or replace function public.vet_within_hours(
  p_opens time, p_closes time, p_24_7 boolean, p_tz text
) returns boolean
language sql stable as $$
  select case
    when p_24_7 then true
    when p_opens is null or p_closes is null then true   -- hours unknown → don't hide
    when p_opens = p_closes then true                    -- 00:00–00:00 == always
    when p_closes > p_opens then
      (now() at time zone coalesce(nullif(p_tz, ''), 'Asia/Baku'))::time
        between p_opens and p_closes
    else                                                 -- overnight wrap
      (now() at time zone coalesce(nullif(p_tz, ''), 'Asia/Baku'))::time >= p_opens
      or (now() at time zone coalesce(nullif(p_tz, ''), 'Asia/Baku'))::time < p_closes
  end;
$$;

-- ---------------------------------------------------------------------------
-- The list the app actually reads. `security_invoker` keeps the underlying
-- RLS on public.vets in force (PG15+), so this view grants no extra reach —
-- it only adds two computed columns.
--   open_now      : inside opening hours (or 24/7)
--   accepting_now : open_now AND has capacity — the one the picker uses
-- ---------------------------------------------------------------------------
create or replace view public.vets_public
with (security_invoker = true) as
select
  v.*,
  public.vet_within_hours(v.opens_at, v.closes_at, v.is_24_7, v.timezone) as open_now,
  public.vet_within_hours(v.opens_at, v.closes_at, v.is_24_7, v.timezone)
    and v.is_open                                                          as accepting_now
from public.vets v;

grant select on public.vets_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- SERVER-SIDE ENFORCEMENT.
-- The picker hides/disables closed clinics, but the UI is not a security
-- boundary — a modified client could still POST a closed clinic's id, and the
-- animal would be driven to a locked door. So the RPC refuses it too.
--
-- A 24/7 clinic, or one whose hours aren't set, is never blocked here.
-- The capacity toggle (is_open) is intentionally NOT enforced as a hard block:
-- a clinic that is open-but-full may still say yes to a genuine emergency, and
-- vet_respond() already gives them the final word. Hours are physics; capacity
-- is a judgement call.
-- ---------------------------------------------------------------------------
create or replace function public.select_vet(p_case uuid, p_vet uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows   int;
  v_clinic text;
  v_vet    public.vets;
begin
  select * into v_vet from public.vets where id = p_vet;
  if v_vet.id is null then
    raise exception 'Vet not found.';
  end if;
  v_clinic := v_vet.clinic_name;

  if v_vet.status is distinct from 'approved' then
    raise exception 'That clinic is not verified.';
  end if;

  if not public.vet_within_hours(v_vet.opens_at, v_vet.closes_at, v_vet.is_24_7, v_vet.timezone) then
    raise exception 'That clinic is closed right now. Please choose one that is open.';
  end if;

  update public.cases
    set status = 'vet_selected', vet_id = p_vet
    where id = p_case and rescuer_id = auth.uid()
      and status in ('accepted', 'vet_selected');  -- allow re-picking after a decline
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Only the active rescuer can choose a vet at this stage.';
  end if;

  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'vet_requested',
          'Rescuer asked ' || v_clinic || ' to receive the animal.');
end;
$$;

-- ---------------------------------------------------------------------------
-- "Is anywhere near this animal actually open?" — one honest number for the
-- UI to be transparent with, instead of silently rendering an empty list.
-- Counts APPROVED, currently-open clinics within p_km of a point.
-- ---------------------------------------------------------------------------
create or replace function public.open_vets_near(
  p_lat double precision, p_lng double precision, p_km double precision default 25
) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.vets v
  where v.status = 'approved'
    and public.vet_within_hours(v.opens_at, v.closes_at, v.is_24_7, v.timezone)
    and public.distance_km(v.lat, v.lng, p_lat, p_lng) <= p_km;
$$;

grant execute on function public.open_vets_near(double precision, double precision, double precision)
  to anon, authenticated;

-- Vets may edit their own hours (the identity guard in 007 deliberately only
-- watches clinic_name/address, so updating hours does NOT bounce a verified
-- clinic back to pending — closing early on a quiet Tuesday is not an
-- identity change).
grant update (opens_at, closes_at, is_24_7, timezone, is_open) on public.vets to authenticated;
