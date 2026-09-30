-- ============================================================================
-- PawLine — migration 034: age (18+) and terms consent, recorded server-side
-- ----------------------------------------------------------------------------
-- A sign-up checkbox alone is bypassable, so the acceptance is stored on the
-- profile. Same pattern as record_safety_ack (009): a SECURITY DEFINER
-- function that only ever updates the caller's own row (auth.uid()). No
-- column UPDATE grant — the RPC is the only way to set these.
--
--   terms_accepted_at  when the user confirmed "18 or older" + Terms/Privacy
--   terms_version      which version they accepted (the app asks again when
--                      its current version is newer)
--
-- get_my_profile() (005) returns `select *` from profiles, so the app reads
-- both columns with no further change.
--
-- Wrapped in one transaction: if any statement fails, nothing is applied.
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text;

create or replace function public.record_terms_acceptance(p_version text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
    set terms_accepted_at = now(), terms_version = p_version
  where id = auth.uid()
    and p_version is not null
    and length(p_version) between 1 and 32;
$$;

revoke all on function public.record_terms_acceptance(text) from public, anon;
grant execute on function public.record_terms_acceptance(text) to authenticated;

commit;
