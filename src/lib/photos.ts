/**
 * Photo handling: client-side compression + upload to the public
 * 'case-photos' storage bucket.
 *
 * Compression matters here — reports are often sent from the street on
 * mobile data. We downscale to max 1600px and re-encode as JPEG ~0.8.
 */
import { supabase } from './supabase';

const MAX_DIM = 1600;
const QUALITY = 0.8;

export async function compressImage(file: File): Promise<Blob> {
  // createImageBitmap handles EXIF orientation in modern browsers.
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file; // extremely unlikely; fall back to the original
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', QUALITY)
  );
}

/**
 * Unique-enough id for a storage filename.
 *
 * crypto.randomUUID() only exists in SECURE contexts (HTTPS/localhost) —
 * testing over a phone on the LAN (http://192.168.x.x) has no `randomUUID`
 * and would throw, blocking every photo upload. Filenames don't need
 * cryptographic randomness, just collision resistance, so we fall back to
 * timestamp + Math.random. (Audited: this was the only secure-context-only
 * API called directly in the codebase; geolocation and Web Push already
 * detect insecure contexts and degrade with a clear message.)
 */
function safeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Upload a photo and return its public URL. */
export async function uploadCasePhoto(file: File, caseId: string): Promise<string> {
  const blob = await compressImage(file);
  const path = `${caseId}/${safeId()}.jpg`;

  const { error } = await supabase.storage
    .from('case-photos')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from('case-photos').getPublicUrl(path);
  return data.publicUrl;
}
