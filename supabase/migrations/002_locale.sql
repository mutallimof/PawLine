-- ============================================================================
-- PawLine — migration 002: user language preference
-- ----------------------------------------------------------------------------
-- Adds profiles.locale ('az' default — launch market), lets users update it,
-- and teaches the signup trigger to carry over a language chosen while
-- browsing as a guest (passed via signUp metadata).
-- Run after 001_init.sql.
-- ============================================================================

alter table public.profiles
  add column if not exists locale text not null default 'az'
  check (locale in ('az', 'tr', 'en'));

-- Column-level update grants are additive — this extends the safe-column set
-- established in 001 (xp / cases_helped / role remain locked).
grant update (locale) on public.profiles to authenticated;

-- Recreate the signup trigger function to also read the locale metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, role, locale)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'New user'),
    case when new.raw_user_meta_data ->> 'role' = 'vet' then 'vet'::public.profile_role
         else 'user'::public.profile_role end,
    case when new.raw_user_meta_data ->> 'locale' in ('az', 'tr', 'en')
         then new.raw_user_meta_data ->> 'locale'
         else 'az' end
  );
  return new;
end;
$$;
