-- ============================================================================
-- PawLine — migration 025: become_vet() — a second on-ramp into vet setup
-- ----------------------------------------------------------------------------
-- Until now, role='vet' was only ever set at signup, by handle_new_user()
-- (014/024) reading the isVet toggle's 'role' key out of raw_user_meta_data
-- — a key that only the email/password signup form ever populates. OAuth
-- identities (Google, migration 024) never carry it, and role is otherwise
-- unwritable by the client ("xp, cases_helped and role are only ever
-- written by SECURITY DEFINER functions", 001) — so a Google user, or
-- anyone who signed up as a community member and later wants to register a
-- clinic, had no path to role='vet' at all.
--
-- become_vet() is that second path. It changes nothing about what happens
-- AFTER role='vet' — upsert_my_vet() (020), the pending status, and admin
-- approval are all untouched; this only clears the gate VetSetupPage
-- already checks.
--
-- Safety, precisely:
--   - No arguments. 'vet' is a literal in the SET clause, not a parameter —
--     there is nothing a caller can pass to make this set any other value.
--   - public.profile_role is the enum ('user', 'vet') only (001) — 'admin'
--     is not a role value at all, it's the separate profiles.is_admin
--     boolean, which this function never references or touches. There is
--     no value this function could even be tricked into writing that would
--     touch admin status.
--   - The caller is auth.uid(), re-derived server-side — never a passed-in
--     id, so one account can never flip another's role.
--   - WHERE id = auth.uid() AND role = 'user' — an admin's or an existing
--     vet's row can never match this update, regardless of who calls it.
--     Calling it while already role='vet' matches zero rows: a silent,
--     idempotent no-op, not an error.
--   - A guest (anonymous session) has no profiles row at all
--     (handle_new_user returns early for is_anonymous, 014) — the WHERE
--     clause matches zero rows for them too, same no-op, no special case
--     needed.
-- ============================================================================

create or replace function public.become_vet()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
    set role = 'vet'
    where id = auth.uid() and role = 'user';
end;
$$;

grant execute on function public.become_vet() to authenticated;
