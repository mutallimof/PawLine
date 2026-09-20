-- ============================================================================
-- PawLine — migration 026: ensure_my_profile() — self-heal a missing profile
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
-- profiles.id references auth.users (id) ON DELETE CASCADE (001). That FK is
-- one-directional: deleting an auth user removes their profile, but deleting
-- a profiles row does NOTHING to auth.users. So a "wipe the test data" pass
-- that clears public.profiles leaves every affected account as a live,
-- working credential with no profile row — permanently. get_my_profile()
-- (005) then returns zero rows forever, and the app treats the account as
-- half-existing: signed in, but with no name, role, prefs or XP.
--
-- That is not hypothetical — it is the state that produced the Profile tab
-- hanging on a spinner for every fresh login, and "wipe all test data" is a
-- planned pre-launch step, so the same orphaning is scheduled to happen
-- again on the way to launch day. This makes the app repair itself instead.
--
-- handle_new_user() (024) is NOT changed by this migration and does not need
-- to be: it is correct, it runs inside the auth.users INSERT transaction, and
-- it cannot be the cause of a missing row (a failure there would roll the
-- signup back entirely rather than commit an auth user with no profile).
-- This is a second, later-in-time entry point to the same insert, for rows
-- that were created correctly and then deleted out from under a live user.
--
-- SAFETY, precisely (same posture as become_vet(), 025):
--   - No arguments. Nothing a caller passes can influence any written value.
--   - The subject is auth.uid(), re-derived server-side — never a passed-in
--     id, so one account can never materialise or alter another's row.
--   - role is the LITERAL 'user', not read from raw_user_meta_data. This is a
--     DELIBERATE divergence from handle_new_user(), which does honour a
--     'role' key: that key is written at signup by the signup form, whereas
--     this function is callable at any time by anyone signed in. A self-heal
--     restores ACCESS, never PRIVILEGE. A genuine vet whose row was wiped
--     comes back as role='user' and re-enters clinic setup through
--     become_vet() (025), exactly as a community member who wants to
--     register a clinic does. Operator-run backfills can restore 'vet'
--     faithfully; a user-callable function must not.
--   - public.profile_role is the enum ('user', 'vet') only (001) — 'admin' is
--     not a role value at all, it is the separate profiles.is_admin boolean
--     (003), which this function never references. is_admin and banned are
--     left entirely to their column defaults (false, false).
--   - ON CONFLICT (id) DO NOTHING, plus an explicit pre-check: an existing
--     row is never updated, so calling this can never reset an established
--     vet's role, an admin's flag, a ban, or anyone's XP. The only state
--     transition it can produce is "no row" -> "baseline row".
--   - Anonymous (guest) sessions return early, mirroring handle_new_user()'s
--     own is_anonymous guard (003). Guests deliberately have no profile row —
--     "they'd pollute people search and the notification fan-out with
--     thousands of throwaway 'New user' rows" (003). Guarded twice: the
--     auth.users.is_anonymous column (authoritative) and is_anon_user()'s
--     JWT claim.
--   - Ban evasion is not reachable through this: is_banned() (003) reads
--     `coalesce((select banned from profiles where id = auth.uid()), false)`,
--     so a missing row ALREADY evaluates to not-banned. Recreating the row
--     with banned=false changes nothing that was still in effect — the ban
--     was lost when the row was deleted, not here. (And no client can delete
--     its own row to get here: profiles grants authenticated only SELECT on
--     public columns and UPDATE on a named few — never DELETE or INSERT, 004.)
--
-- Run after 001–025. Idempotent; calling the function is idempotent too.
-- ============================================================================

create or replace function public.ensure_my_profile()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_meta    jsonb;
  v_is_anon boolean;
  v_first   text;
  v_last    text;
  v_phone   text;
  v_avatar  text;
  v_display text;
begin
  if v_uid is null then
    return;
  end if;

  -- Cheap exit for the overwhelmingly common case: the row is already there.
  if exists (select 1 from public.profiles where id = v_uid) then
    return;
  end if;

  select u.raw_user_meta_data, u.is_anonymous
    into v_meta, v_is_anon
    from auth.users u
   where u.id = v_uid;

  -- Guests never get a profile row — see the header note.
  if coalesce(v_is_anon, false) or public.is_anon_user() then
    return;
  end if;

  -- Same derivation as handle_new_user() (024), so a healed row is
  -- indistinguishable from one the trigger would have written — except for
  -- role, which is pinned to the community baseline (header note).
  v_first  := nullif(trim(v_meta ->> 'first_name'), '');
  v_last   := nullif(trim(v_meta ->> 'last_name'), '');
  v_phone  := nullif(trim(v_meta ->> 'phone'), '');
  v_avatar := nullif(trim(v_meta ->> 'avatar_url'), '');

  v_display := case
    when v_first is not null or v_last is not null
      then trim(concat_ws(' ', v_first, v_last))
    else coalesce(
      nullif(v_meta ->> 'display_name', ''),
      nullif(v_meta ->> 'full_name', ''),
      nullif(v_meta ->> 'name', ''),
      'New user'
    )
  end;

  if v_avatar is null then
    v_avatar := nullif(trim(v_meta ->> 'picture'), '');
  end if;

  insert into public.profiles (
    id, display_name, avatar_url, first_name, last_name, phone, role, locale
  )
  values (
    v_uid,
    v_display,
    v_avatar,
    v_first,
    v_last,
    v_phone,
    'user'::public.profile_role,  -- literal, never from metadata — see header
    case when v_meta ->> 'locale' in ('az', 'tr', 'en')
         then v_meta ->> 'locale'
         else 'az' end
  )
  on conflict (id) do nothing;
end;
$$;

grant execute on function public.ensure_my_profile() to authenticated;
