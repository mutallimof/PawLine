-- ============================================================================
-- PawLine — migration 014: Group C (C1, C2, C3, C5)
-- ----------------------------------------------------------------------------
-- Source: docs/FIX_SPEC.md, Group C. Run after 001–013.
--
--   C1. Vet verification documents — private bucket + vet_documents table.
--   C2. Vet ratings — closed set, one per confirmed-delivery case.
--   C3. Vet profile fields — split public contact from private manager info,
--       plus accepted_animals. vets_public is redefined to an explicit public
--       column list (see note before it) instead of `v.*`.
--   C5. Signup fields — first_name/last_name/phone on profiles, ADDITIVE
--       ONLY. See the strategy note in section 4 before the DDL — no rename,
--       no backfill, display_name untouched and still authoritative for
--       every existing read path.
--
-- Skipped per instruction: C4 (reporter abuse flagging) — not in this file.
--
-- Not touched: migrations 001–013, the case state machine RPCs (accept_case,
-- drop_case, select_vet, vet_respond, start_transport, update_rescuer_location,
-- confirm_delivery, vet_post_update), auth flow, is_admin/role/xp grants, and
-- no RLS policy not named above. Idempotent throughout.
-- ============================================================================


-- ============================================================================
-- 1. C1 — VET VERIFICATION DOCUMENTS
-- ----------------------------------------------------------------------------
-- Simplified per instruction: no required document types, no validation —
-- a vet uploads any file after signup; admin approves with or without them.
-- Documents are sensitive (business licenses, ID) so the bucket is PRIVATE —
-- unlike case-photos, reads need a signed URL, not a public one.
-- ============================================================================

create table if not exists public.vet_documents (
  id          uuid primary key default gen_random_uuid(),
  vet_id      uuid not null references public.vets (id) on delete cascade,
  path        text not null,              -- storage object path, not a public URL
  filename    text not null default '',   -- original filename, for the admin list
  created_at  timestamptz not null default now()
);

create index if not exists vet_documents_vet_idx on public.vet_documents (vet_id);

alter table public.vet_documents enable row level security;

create policy "vet and admin read vet documents"
  on public.vet_documents for select using (
    vet_id = auth.uid() or public.is_admin()
  );
create policy "vet uploads own documents"
  on public.vet_documents for insert with check (vet_id = auth.uid());
create policy "vet deletes own documents"
  on public.vet_documents for delete using (vet_id = auth.uid());

grant select, insert, delete on public.vet_documents to authenticated;

insert into storage.buckets (id, name, public)
values ('vet-documents', 'vet-documents', false)
on conflict (id) do nothing;

-- Folder convention matches case-photos (005): first path segment is the
-- owner's uid, so ownership is a storage-path check, not a lookup.
create policy "vet uploads own document files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'vet-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "vet and admin read own document files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'vet-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
create policy "vet deletes own document files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'vet-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admin needs full rows (including C3's private manager fields below) for
-- the review queue — a plain SELECT can't do that once vets' column grants
-- are narrowed in section 3, so this bypasses column grants the same way
-- get_my_profile() does for profiles (005).
create or replace function public.admin_list_pending_vets()
returns setof public.vets
language sql security definer stable set search_path = public as $$
  select * from public.vets
  where status = 'pending'
  order by created_at;
$$;

grant execute on function public.admin_list_pending_vets() to authenticated;

-- Note: "unapproved vets can report and rescue but don't appear in the vets
-- list" is already true — accept_case()/the report-insert trigger never
-- check vets.status, and vets_public/the picker already filter to
-- status = 'approved'. Nothing to change for that part of C1.


-- ============================================================================
-- 2. C2 — VET RATINGS
-- ----------------------------------------------------------------------------
-- Closed set: insertable only by the rescuer of a case that clinic actually
-- received the animal for (status = 'resolved', set exclusively by
-- confirm_delivery() — untouched here). `case_id unique` gives "one rating
-- per case" for free; re-rating is a new row for a DIFFERENT case, not an
-- update to this one (ratings are immutable once given — no update/delete
-- policy, matching case_events' append-only posture).
-- SELECT is public (using (true)), same posture as case_duplicate_flags —
-- and load-bearing here: vets_public's aggregate (section 3) is
-- security_invoker, so its subquery over vet_ratings runs under the
-- CALLER's own privileges. If ratings weren't publicly readable, a guest
-- computing "average rating" from the view would only ever see rows they
-- personally own, silently corrupting the average for everyone else.
-- ============================================================================

create table if not exists public.vet_ratings (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null unique references public.cases (id) on delete cascade,
  vet_id      uuid not null references public.vets (id) on delete cascade,
  rescuer_id  uuid not null references public.profiles (id) on delete cascade,
  rating      integer not null check (rating between 1 and 5),
  note        text not null default '' check (char_length(note) <= 500),
  created_at  timestamptz not null default now()
);

create index if not exists vet_ratings_vet_idx on public.vet_ratings (vet_id);

alter table public.vet_ratings enable row level security;

create policy "vet ratings are viewable by everyone"
  on public.vet_ratings for select using (true);

create policy "rescuer rates a confirmed delivery, once per case"
  on public.vet_ratings for insert with check (
    rescuer_id = auth.uid()
    and exists (
      select 1 from public.cases c
      where c.id = case_id
        and c.vet_id = vet_ratings.vet_id
        and c.rescuer_id = auth.uid()
        and c.status = 'resolved'
    )
  );

grant select on public.vet_ratings to anon, authenticated;
grant insert on public.vet_ratings to authenticated;


-- ============================================================================
-- 3. C3 — VET PROFILE FIELDS: public contact vs. private manager info
-- ----------------------------------------------------------------------------
-- 'phone' already IS the public clinic phone the app has shown since 001 —
-- renamed to contact_phone rather than duplicated (RENAME preserves data and
-- existing column-level grants/ACLs by attnum, not name; every UI reference
-- is updated in this branch to match). contact_email is new. manager_* are
-- new and PRIVATE — the clinic's internal contact, not necessarily the same
-- person as the Supabase-auth account holder. accepted_animals defaults to
-- all three types so existing approved vets don't silently vanish from any
-- animal-type filter the moment this runs (same "don't hide on migrate"
-- posture as 010's vet_within_hours default).
-- ============================================================================

alter table public.vets rename column phone to contact_phone;

alter table public.vets
  add column if not exists contact_email    text not null default '',
  add column if not exists manager_name     text not null default '',
  add column if not exists manager_surname  text not null default '',
  add column if not exists manager_phone    text not null default '',
  add column if not exists accepted_animals public.animal_type[]
    not null default array['dog','cat','other']::public.animal_type[];

-- Public directory columns only — no manager_* here. Re-stated explicitly
-- (revoke + grant) rather than relying on the rename carrying the old grant
-- forward, so this migration is self-sufficient to read on its own.
revoke select on public.vets from anon, authenticated;
grant select (
  id, clinic_name, contact_phone, contact_email, address, lat, lng, is_open,
  opens_at, closes_at, is_24_7, timezone, accepted_animals, status, created_at
) on public.vets to anon, authenticated;

-- Vets may edit their own public contact fields AND their own private
-- manager fields (still self-only — RLS's "vet updates own clinic" policy,
-- untouched, still gates the row; this only says which columns).
grant update (
  contact_email, manager_name, manager_surname, manager_phone, accepted_animals
) on public.vets to authenticated;

-- Full self-read (incl. manager_* and contact_email) for the vet's own
-- setup/dashboard screens — same pattern as get_my_profile() (005).
create or replace function public.get_my_vet()
returns setof public.vets
language sql security definer stable set search_path = public as $$
  select * from public.vets where id = auth.uid();
$$;

grant execute on function public.get_my_vet() to authenticated;

-- Redefine vets_public with an EXPLICIT public column list instead of
-- `v.*`. Two reasons this matters, not just style:
--   1. security_invoker = true (010) means the view enforces the CALLER's
--      own column grants, not the view owner's — `v.*` would try to read
--      manager_name/manager_surname/manager_phone/contact-adjacent private
--      columns too, and since those are no longer granted to anon/
--      authenticated (above), every read of this view would fail with a
--      permission error for everyone, not just leak the private columns.
--   2. Explicit columns also means adding a new (possibly private) vets
--      column later can't silently start leaking through this view again.
-- Adds rating_avg/rating_count (C2) as the same kind of computed column
-- open_now/accepting_now already are.
--
-- DROP + CREATE, not a bare CREATE OR REPLACE: 010's original view was
-- `select v.*, ...`, which — at that point in the vets table's column
-- history — put "address" in the 3rd output position. This version puts
-- "contact_phone" 3rd instead (the column list below is reordered from
-- the old v.* expansion, not just extended). Postgres's CREATE OR REPLACE
-- VIEW only allows APPENDING columns or changing a column's query
-- expression in place — it refuses to rename or reorder an existing
-- output column ("cannot change name of view column ... to ...", 42P16).
-- A plain DROP sidesteps that: nothing else in the schema selects FROM
-- vets_public (checked — no other view, function, or policy references
-- it; only application code does, via the Supabase client, which isn't a
-- database-level dependency and is unaffected by drop+recreate as long as
-- the new view still exposes what it expects, which it does, as a
-- superset). So a plain `drop view if exists` (no CASCADE) is safe here —
-- there is nothing for a CASCADE to take down. The view's own grant is
-- dropped along with it, which is exactly why that grant is re-issued
-- below, after the create.
drop view if exists public.vets_public;

create or replace view public.vets_public
with (security_invoker = true) as
select
  v.id, v.clinic_name, v.contact_phone, v.contact_email, v.address,
  v.lat, v.lng, v.is_open, v.opens_at, v.closes_at, v.is_24_7, v.timezone,
  v.accepted_animals, v.status, v.created_at,
  public.vet_within_hours(v.opens_at, v.closes_at, v.is_24_7, v.timezone) as open_now,
  public.vet_within_hours(v.opens_at, v.closes_at, v.is_24_7, v.timezone)
    and v.is_open as accepting_now,
  coalesce(r.rating_avg, 0)::numeric(3,2) as rating_avg,
  coalesce(r.rating_count, 0)::int as rating_count
from public.vets v
left join (
  select vet_id, avg(rating)::numeric as rating_avg, count(*) as rating_count
  from public.vet_ratings
  group by vet_id
) r on r.vet_id = v.id;

grant select on public.vets_public to anon, authenticated;


-- ============================================================================
-- 4. C5 — SIGNUP FIELDS: first_name / last_name / phone
-- ----------------------------------------------------------------------------
-- ADDITIVE ONLY — see the strategy note in the chat response this migration
-- shipped with. display_name is NOT renamed, NOT backfilled, and stays the
-- single column every existing read path (12 files) already uses. These
-- three columns are nullable with no default: existing rows get NULL in
-- all three and nothing about them changes. New signups populate all three;
-- handle_new_user() computes display_name from first_name/last_name when
-- given, falling back to the legacy `display_name` metadata key (or 'New
-- user') when they're absent, so nothing that doesn't pass them breaks.
-- ============================================================================

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name  text,
  add column if not exists phone      text;

-- Private — not part of the public directory grant (005's column list is
-- untouched below). Full self-read already exists via get_my_profile().
grant update (first_name, last_name, phone) on public.profiles to authenticated;

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
    case when new.raw_user_meta_data ->> 'locale' in ('az', 'tr', 'en')
         then new.raw_user_meta_data ->> 'locale'
         else 'az' end
  );
  return new;
end;
$$;
