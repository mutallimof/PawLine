-- ============================================================================
-- PawLine — migration 031: banned accounts can't add case photos
-- ----------------------------------------------------------------------------
-- The two rules that gate case photos (005) never checked for a ban:
--   - public.case_photos INSERT: report photos by the case's creator,
--     delivery / recovery photos by the case's vet
--   - storage.objects INSERT into 'case-photos': the case's creator, rescuer
--     or vet, under that case's folder
-- So a banned vet could keep posting delivery and (since the recovery-photo
-- change) post-resolution photos onto a public case page. Case chat has
-- refused banned accounts since 003 ("accounts in good standing post in case
-- chat": `and not public.is_banned()`); this adds the same check, the same
-- function, to both photo rules.
--
-- Applied to BOTH branches of the case_photos rule (report and delivery), not
-- just delivery: a banned account already can't create a case at all
-- (enforce_case_limits raises on is_banned(), 005/021), so there is no
-- legitimate report-photo upload by a banned account to preserve. Guests are
-- unaffected — is_banned() is false for an anonymous session, which has no
-- profiles row (coalesce(..., false)).
--
-- Both policies are restated in full (drop + create, same names as 005) with
-- only the ban check added; nothing else about who may upload changes.
--
-- Run after 030. Idempotent.
-- ============================================================================

drop policy if exists "creator attaches report photos; vet attaches delivery photos" on public.case_photos;
create policy "creator attaches report photos; vet attaches delivery photos"
  on public.case_photos for insert with check (
    not public.is_banned()
    and (
      (kind = 'report'
        and auth.uid() = (select creator_uid from public.cases where id = case_id))
      or
      (kind = 'delivery'
        and auth.uid() = (select vet_id from public.cases where id = case_id))
    )
  );

drop policy if exists "case participants upload under their case's folder" on storage.objects;
create policy "case participants upload under their case's folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'case-photos'
    and not public.is_banned()
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and (c.creator_uid = auth.uid()
             or c.rescuer_id = auth.uid()
             or c.vet_id = auth.uid())
    )
  );
