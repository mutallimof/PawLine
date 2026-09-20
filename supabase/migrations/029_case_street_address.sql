-- ============================================================================
-- PawLine — migration 029: reverse-geocoded street address on a case
-- ----------------------------------------------------------------------------
-- (Internal name unchanged; the app's display name is now Stray's Call.)
--
-- WHY
-- A report carries a pin and, optionally, a free-text landmark the reporter
-- typed ("behind 28 Mall"). Most reporters type nothing — they are standing in
-- the street next to a hurt animal, not composing an address. A rescuer then
-- gets coordinates and a blank line. This column holds the street name and
-- number derived from the pin at creation time, so the case detail screen can
-- show a real address even when nobody wrote one.
--
-- SEPARATE FROM address_hint, deliberately: address_hint is what a human
-- chose to say and is often better than an address ("the alley behind the
-- bakery"). This is machine-derived and may be wrong or coarse. Keeping them
-- apart means we can prefer the human's words and fall back to this, and it
-- keeps one from silently overwriting the other.
--
-- NULLABLE WITH NO DEFAULT, and nothing in the database ever populates it:
-- geocoding happens once on the client at creation and is strictly
-- best-effort. A failed, empty, throttled or unconfigured geocode leaves this
-- null and the report is created exactly as before. Reporting an injured
-- animal must never depend on a Google API being reachable.
--
-- NO GRANT CHANGES NEEDED: cases already grants `select` and `insert` to
-- anon/authenticated as whole-table privileges (004), so a new column is
-- covered automatically — the same reason 022 needed none for urgency.
-- The insert policy (003) constrains reporter_id, not the column list.
--
-- Run after 001-028. Idempotent.
-- ============================================================================

alter table public.cases
  add column if not exists street_address text;

comment on column public.cases.street_address is
  'Reverse-geocoded street address from the report pin, set once by the client '
  'at creation. Best-effort: null whenever geocoding failed or returned nothing. '
  'Distinct from address_hint, which is the reporter''s own words.';
