-- ============================================================================
-- PawLine — migration 020: upsert_my_vet() RPC (fixes vets upsert 403)
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS
-- upsertVet() called supabase.from('vets').upsert(vet) directly. PostgREST's
-- upsert compiles to INSERT ... ON CONFLICT (id) DO UPDATE SET <every
-- submitted column>, and Postgres requires UPDATE privilege on every column
-- in that SET clause. Worse: when a role has only COLUMN-level (not
-- table-wide) UPDATE on a column and the table has row-level security
-- enabled, updating that column ALSO requires SELECT privilege on it — the
-- policy check needs to read the row. manager_name/manager_surname/
-- manager_phone (014) were granted UPDATE but deliberately NEVER granted
-- SELECT (they're the clinic's private internal contact — never publicly
-- readable), so every clinic Save that touched them 403ed with "permission
-- denied for table vets" / hint "GRANT SELECT ON public.vets".
--
-- Granting SELECT on those columns would fix the 403 but reopen exactly the
-- privacy hole 014 closed: RLS's SELECT policy is `status = 'approved' OR
-- id = auth.uid() OR is_admin()`, so any signed-in user could then read
-- every approved clinic's manager name/phone, not just their own — RLS
-- gates ROWS, not columns, so there's no way to grant SELECT "for own row
-- only" at the privilege level.
--
-- FIX: route the write through a SECURITY DEFINER RPC — the same pattern
-- already used for reads (get_my_vet, get_my_profile, admin_list_pending_
-- vets). The function owner's privileges cover the write, so the caller
-- needs no table/column grants on vets for this path at all. manager_* stay
-- write-only from the client's side: settable only through this function's
-- parameters, still selectable only via get_my_vet() (own clinic) or
-- admin_list_pending_vets() (admin review) — never through a raw SELECT.
--
-- The caller is re-derived from auth.uid() inside the function body, never
-- accepted as a parameter — a client can never upsert a clinic under
-- someone else's id. The role='vet' check mirrors (defense-in-depth; the
-- table owner bypasses RLS, so this function must enforce it itself) the
-- existing "vet inserts own clinic" policy's WITH CHECK. status is
-- intentionally never touched here — admin-RPC-only, unchanged — and
-- vet_identity_guard() (007) still fires on the underlying UPDATE exactly
-- as before, resetting an approved clinic to 'pending' if its name/address
-- changes.
-- ============================================================================

create or replace function public.upsert_my_vet(
  p_clinic_name      text,
  p_address          text,
  p_contact_phone    text,
  p_contact_email    text,
  p_lat              double precision,
  p_lng              double precision,
  p_manager_name     text default '',
  p_manager_surname  text default '',
  p_manager_phone    text default '',
  p_accepted_animals public.animal_type[] default array['dog','cat','other']::public.animal_type[],
  p_is_open          boolean default true,
  p_opens_at         time default null,
  p_closes_at        time default null,
  p_is_24_7          boolean default false,
  p_timezone         text default 'Asia/Baku'
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'vet'
  ) then
    raise exception 'only vet accounts may manage a clinic';
  end if;

  insert into public.vets (
    id, clinic_name, address, contact_phone, contact_email,
    manager_name, manager_surname, manager_phone, accepted_animals,
    lat, lng, is_open, opens_at, closes_at, is_24_7, timezone
  ) values (
    auth.uid(), p_clinic_name, p_address, p_contact_phone, p_contact_email,
    p_manager_name, p_manager_surname, p_manager_phone, p_accepted_animals,
    p_lat, p_lng, p_is_open, p_opens_at, p_closes_at, p_is_24_7, p_timezone
  )
  on conflict (id) do update set
    clinic_name      = excluded.clinic_name,
    address          = excluded.address,
    contact_phone    = excluded.contact_phone,
    contact_email    = excluded.contact_email,
    manager_name     = excluded.manager_name,
    manager_surname  = excluded.manager_surname,
    manager_phone    = excluded.manager_phone,
    accepted_animals = excluded.accepted_animals,
    lat              = excluded.lat,
    lng              = excluded.lng,
    is_open          = excluded.is_open,
    opens_at         = excluded.opens_at,
    closes_at        = excluded.closes_at,
    is_24_7          = excluded.is_24_7,
    timezone         = excluded.timezone;
end;
$$;

grant execute on function public.upsert_my_vet(
  text, text, text, text, double precision, double precision,
  text, text, text, public.animal_type[], boolean, time, time, boolean, text
) to authenticated;
