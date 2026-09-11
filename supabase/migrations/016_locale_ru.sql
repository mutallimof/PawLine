-- ============================================================================
-- PawLine — migration 016: add 'ru' as a valid locale
-- ----------------------------------------------------------------------------
-- Flagged during Group H (Russian UI added client-side) rather than written
-- then, per that group's instruction. Two places hardcode the locale
-- allow-list to ('az', 'tr', 'en') and reject/silently drop 'ru':
--
--   1. profiles.locale's CHECK constraint (migration 002) — an UPDATE
--      setting locale = 'ru' (LanguageSwitcher, ui.tsx) is rejected outright.
--   2. handle_new_user()'s signup metadata check (002, replaced by 003 and
--      014) — a new signup with locale: 'ru' in the metadata silently falls
--      back to 'az' instead of erroring, which is its own quieter bug.
--
-- The constraint was declared inline in 002 with no explicit name, so
-- Postgres auto-named it (normally profiles_locale_check) — found
-- dynamically below instead of hardcoding that name, then recreated with an
-- explicit name so future migrations can reference it directly. Idempotent:
-- re-running finds the explicitly-named constraint the same way and
-- replaces it identically.
--
-- Not touched: migrations 001–015, the case state machine RPCs, auth flow,
-- is_admin/role/xp grants, and no RLS policy (this is a column constraint
-- and one trigger function, not a policy). Run after 001–015.
-- ============================================================================

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.profiles'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%locale%';

  if v_conname is not null then
    execute format('alter table public.profiles drop constraint %I', v_conname);
  end if;
end $$;

alter table public.profiles
  add constraint profiles_locale_check check (locale in ('az', 'tr', 'en', 'ru'));

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_first text := nullif(trim(new.raw_user_meta_data ->> 'first_name'), '');
  v_last  text := nullif(trim(new.raw_user_meta_data ->> 'last_name'), '');
  v_phone text := nullif(trim(new.raw_user_meta_data ->> 'phone'), '');
  v_display text;
begin
  if new.is_anonymous then
    return new;
  end if;

  v_display := case
    when v_first is not null or v_last is not null
      then trim(concat_ws(' ', v_first, v_last))
    else coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'New user')
  end;

  insert into public.profiles (id, display_name, first_name, last_name, phone, role, locale)
  values (
    new.id,
    v_display,
    v_first,
    v_last,
    v_phone,
    case when new.raw_user_meta_data ->> 'role' = 'vet' then 'vet'::public.profile_role
         else 'user'::public.profile_role end,
    case when new.raw_user_meta_data ->> 'locale' in ('az', 'tr', 'en', 'ru')
         then new.raw_user_meta_data ->> 'locale'
         else 'az' end
  );
  return new;
end;
$$;
