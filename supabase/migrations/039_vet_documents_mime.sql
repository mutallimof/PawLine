-- ============================================================================
-- PawLine — migration 039: vet-documents accepts only images and PDF
-- ----------------------------------------------------------------------------
-- The bucket was created in 014 with no type restriction, so any file could
-- be uploaded as a clinic document. Storage now refuses anything but JPEG,
-- PNG, WebP, HEIC and PDF — the same list the app checks before upload
-- (uploadVetDocument, which also sends the detected type as contentType).
--
-- Only new uploads are checked; files already in the bucket are untouched.
-- Run after 001–038. Idempotent.
-- ============================================================================

begin;

update storage.buckets
  set allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/pdf'
  ]
  where id = 'vet-documents';

do $check$
begin
  if not exists (select 1 from storage.buckets where id = 'vet-documents') then
    raise exception '039 aborted: bucket vet-documents not found';
  end if;
end
$check$;

commit;
