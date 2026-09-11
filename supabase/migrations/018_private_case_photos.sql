-- ============================================================================
-- PawLine — migration 018: A2, private case-photos bucket + signed URLs
-- ----------------------------------------------------------------------------
-- Source: docs/FIX_SPEC.md A2, previously flagged (migration 011) and now
-- actioned. case-photos was public=true, so image bytes were fetchable by
-- direct URL forever regardless of RLS — hiding a case (011) removed it from
-- listings but never actually revoked photo access. This makes the bucket
-- private; case_photos.url becomes a bare storage path, and the client
-- mints short-lived (1 hour) signed URLs instead — see api.ts
-- fetchCases()/fetchCase()/resolvePhotoUrls().
--
-- Column rename-in-place, not a new column + later drop: every existing
-- value is deterministic ("<bucket>/object/public/case-photos/<case_id>/
-- <file>"), so the backfill is a single regexp strip, reviewed here before
-- you run it — no separate cleanup migration needed.
--
-- Not touched: migrations 001–017, the case state machine RPCs, auth flow,
-- is_admin/role/xp grants. case_photos' own table-level RLS/grants (011,
-- 004) are untouched — they were already correct; the gap was entirely at
-- the storage.objects/bucket level. The insert/delete storage policies
-- (005) already check folder ownership via the same convention this
-- migration's new SELECT policy uses, and don't reference `public` or the
-- renamed column — also untouched. Run after 001–017.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. case_photos.url -> path: rewritten from a full public URL to a bare
-- storage path (e.g. "3f2e.../a1b2c3.jpg"). The `where path like 'http%'`
-- guard makes this safe to re-run — already-bare paths are left alone.
-- ---------------------------------------------------------------------------
alter table public.case_photos rename column url to path;

update public.case_photos
  set path = regexp_replace(path, '^.*/object/public/case-photos/', '')
  where path like 'http%';

-- ---------------------------------------------------------------------------
-- 2. The bucket itself: public -> private. This is what actually closes the
-- A2 gap — a public bucket serves objects by direct URL with NO RLS check
-- at all, regardless of any table or storage.objects policy.
-- ---------------------------------------------------------------------------
update storage.buckets set public = false where id = 'case-photos';

-- ---------------------------------------------------------------------------
-- 3. storage.objects SELECT: was `using (bucket_id = 'case-photos')` with no
-- role restriction since 001 — unconditional, the actual A2 gap. Replaced
-- with the same hidden-case check case_photos' own table policy already
-- enforces (011), using the same folder-ownership convention the upload
-- policy already relies on (005): the object path's first segment IS the
-- case id.
--
-- `to authenticated` (not anon) is deliberate: minting a signed URL for a
-- private object requires SELECT on it, so this is also the enforcement
-- point for "guests need a session to view photos" — the app already
-- creates an anonymous one silently for this (api.ts ensureSession()), the
-- same mechanism guest reporting has used since migration 003. A bare
-- `anon` grant here would let anyone with the public API key mint URLs with
-- no session or identity at all — the exact unaccountable-caller shape
-- migration 003 moved reporting away from, with no reason to reintroduce it
-- for reads.
-- ---------------------------------------------------------------------------
drop policy if exists "public read of case photos" on storage.objects;

create policy "case photos are visible unless the case is hidden"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'case-photos'
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and (not c.hidden or public.is_admin())
    )
  );
