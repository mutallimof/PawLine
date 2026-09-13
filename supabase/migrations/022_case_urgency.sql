-- ============================================================================
-- PawLine — migration 022: urgency field on reports
-- ----------------------------------------------------------------------------
-- text + check, not a Postgres enum — matching injury_type/spot_type (007),
-- not case_status/animal_type/profile_role. Those two are the precedent
-- for exactly this kind of field: reporter-picked, i18n-key-shaped,
-- purely descriptive (never branched on on the server, never gates a
-- state transition), and a plain CHECK is easier to extend later than an
-- enum type. Levels: low / medium / high / critical.
--
-- Default 'medium': existing rows get a neutral middle value rather than
-- one implying either "this was nothing" or "this was an emergency" for
-- reports we have no real urgency signal for. New reports default the
-- same way client-side (ReportPage) but the reporter can change it before
-- sending.
--
-- No RLS/grant changes needed: `insert`/`select` on public.cases are
-- already table-wide grants (004), not column-restricted, so they cover
-- this column automatically — same reason injury_type/spot_type needed
-- none either. Purely descriptive, so nothing here re-derives it from
-- auth.uid() the way creator_uid is forced (021) — there is no "true"
-- server-known urgency to defend against a spoofed client value.
-- ============================================================================

alter table public.cases
  add column if not exists urgency text not null default 'medium'
    check (urgency in ('low', 'medium', 'high', 'critical'));
