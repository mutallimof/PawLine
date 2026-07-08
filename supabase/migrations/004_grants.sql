-- ============================================================================
-- PawLine — migration 004: explicit privilege grants
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
-- Postgres has TWO independent gates in front of every query:
--   1. GRANTs   — "may this role touch this table at all?"
--   2. RLS      — "which rows may it touch?"
-- Supabase's dashboard toggle "Automatically expose new tables" silently
-- handles gate 1. With it off (as happened on the real project), every query
-- returned 403 *before RLS was even evaluated* — the policies were correct,
-- the baseline table privileges were missing. This migration bakes gate 1
-- into SQL so a fresh project works identically regardless of that toggle.
--
-- PRINCIPLE OF LEAST PRIVILEGE, per role:
--   anon           = visitor with NO session at all: read-only public surface.
--   authenticated  = any session, INCLUDING anonymous guest sessions
--                    (Supabase anonymous sign-ins use the authenticated role
--                    with an is_anonymous JWT claim). Row-level rules like
--                    "guests can't chat" live in RLS via is_anon_user() —
--                    grants here are the coarse layer.
-- Writes not granted below (e.g. case_events, notifications inserts, XP)
-- happen inside SECURITY DEFINER functions, which run with the function
-- owner's privileges and therefore need no caller grants.
-- Run after 001–003. Idempotent.
-- ============================================================================

-- Schema + RPC access -------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
-- (RPCs like accept_case verify auth/admin/ban status internally, so a broad
-- execute grant is safe — calling is allowed, acting is still gated.)

-- Identity/bigserial columns need sequence access for direct inserts.
grant usage, select on all sequences in schema public to authenticated;

-- Public read surface (works signed out) ------------------------------------
grant select on public.profiles             to anon, authenticated;
grant select on public.vets                 to anon, authenticated; -- RLS: approved only
grant select on public.cases                to anon, authenticated; -- RLS: not hidden
grant select on public.case_photos          to anon, authenticated;
grant select on public.case_events          to anon, authenticated;
grant select on public.case_messages        to anon, authenticated; -- RLS: not hidden
grant select on public.case_duplicate_flags to anon, authenticated;
grant select on public.sponsors             to anon, authenticated; -- RLS: active only

-- Session-only reads ---------------------------------------------------------
grant select on public.notifications        to authenticated; -- RLS: own rows
grant select on public.conversations        to authenticated; -- RLS: member only
grant select on public.conversation_participants to authenticated;
grant select on public.messages             to authenticated;
grant select on public.case_watchers        to authenticated;
grant select on public.content_reports      to authenticated; -- RLS: admin/own
grant select on public.push_subscriptions   to authenticated; -- RLS: own rows

-- Writes the app performs directly (each still constrained by RLS) ----------
grant insert         on public.cases              to authenticated; -- report (incl. guests)
grant insert         on public.case_photos        to authenticated;
grant insert         on public.case_messages      to authenticated; -- RLS: non-anon, non-banned
grant insert         on public.messages           to authenticated; -- RLS: member + good standing
grant insert         on public.content_reports    to authenticated;
grant insert, update, delete on public.push_subscriptions to authenticated; -- own device
grant update         on public.notifications      to authenticated; -- mark read (own rows)
grant insert, update on public.vets               to authenticated; -- own clinic (status is admin-RPC-only via column list below)
grant insert, update, delete on public.sponsors   to authenticated; -- RLS: admins only

-- profiles: column-level UPDATE grants were issued in 001/002 (display_name,
-- prefs, home area, locale). Re-issue here so this migration alone is
-- sufficient on any project; xp / cases_helped / role / is_admin / banned
-- remain deliberately ungranted (server-managed only).
grant update (display_name, new_case_pref, home_lat, home_lng, notify_radius_km)
  on public.profiles to authenticated;
grant update (locale) on public.profiles to authenticated;

-- vets: clinics may edit their own details but never their verification
-- status — revoke the broad update above and re-grant per column.
revoke update on public.vets from authenticated;
grant update (clinic_name, address, phone, lat, lng, is_open)
  on public.vets to authenticated;

-- Belt-and-braces for the future: any table created later in this schema by
-- the migration role gets sane defaults, so a forgotten grant can't 403.
alter default privileges in schema public
  grant select on tables to anon, authenticated;
alter default privileges in schema public
  grant execute on functions to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
