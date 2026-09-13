-- ============================================================================
-- PawLine — migration 024: handle_new_user() picks up OAuth metadata
-- ----------------------------------------------------------------------------
-- Prompted by adding "Continue with Google" (client-side only otherwise —
-- no schema change needed for the OAuth flow itself, since Supabase Auth
-- creates the same auth.users row for OAuth as for email/password and this
-- trigger already fires on any insert into auth.users).
--
-- Investigated what handle_new_user() (014) does for a Google sign-up,
-- since Google identities never carry first_name/last_name/phone/role/
-- locale — the keys this trigger was written to read:
--   - role: already defaults sensibly. The CASE falls to 'user' whenever
--     raw_user_meta_data has no 'role' key, which is always true for OAuth
--     — a Google sign-up can never become a vet by accident. No change.
--   - locale: already defaults sensibly the same way (falls to 'az' when
--     absent) — not OAuth-specific, same fallback every signup missing it
--     hits. No change.
--   - Nothing here can ERROR on the missing fields: first_name/last_name/
--     phone are nullable columns (014, additive-only), so the insert always
--     succeeds regardless of what raw_user_meta_data does or doesn't have.
--   - display_name: this ONE actually did NOT default sensibly. With no
--     first_name/last_name and no 'display_name' key (Google's metadata
--     uses 'full_name'/'name' instead), every Google sign-up silently
--     became the literal string 'New user' — a real, visible defect, not
--     hypothetical. Fixed below: 'full_name' and 'name' added as
--     additional fallback sources, tried after 'display_name' so no
--     existing signup path's behavior changes.
--   - avatar_url: not previously set by this trigger at all (always NULL
--     from signup, regardless of provider) even though profiles.avatar_url
--     exists and Google's metadata carries a real photo URL. Also fixed
--     below, from 'avatar_url' or 'picture' (Supabase's Google mapping
--     uses the former; 'picture' covers other providers that don't).
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_first text := nullif(trim(new.raw_user_meta_data ->> 'first_name'), '');
  v_last  text := nullif(trim(new.raw_user_meta_data ->> 'last_name'), '');
  v_phone text := nullif(trim(new.raw_user_meta_data ->> 'phone'), '');
  v_avatar text := nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), '');
  v_display text;
begin
  if new.is_anonymous then
    return new;
  end if;

  v_display := case
    when v_first is not null or v_last is not null
      then trim(concat_ws(' ', v_first, v_last))
    else coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      'New user'
    )
  end;

  if v_avatar is null then
    v_avatar := nullif(trim(new.raw_user_meta_data ->> 'picture'), '');
  end if;

  insert into public.profiles (id, display_name, avatar_url, first_name, last_name, phone, role, locale)
  values (
    new.id,
    v_display,
    v_avatar,
    v_first,
    v_last,
    v_phone,
    case when new.raw_user_meta_data ->> 'role' = 'vet' then 'vet'::public.profile_role
         else 'user'::public.profile_role end,
    case when new.raw_user_meta_data ->> 'locale' in ('az', 'tr', 'en')
         then new.raw_user_meta_data ->> 'locale'
         else 'az' end
  );
  return new;
end;
$$;
