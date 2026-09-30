/**
 * Photo handling: client-side re-encoding + upload to the PRIVATE
 * 'case-photos' storage bucket (migration 018 — was public until then).
 *
 * Compression matters here — reports are often sent from the street on
 * mobile data. We downscale to max 1600px and re-encode as JPEG ~0.8.
 *
 * PRIVACY: re-encoding is also what strips EXIF (GPS position, device,
 * timestamps) — a canvas export carries none of it. An original file is
 * NEVER uploaded. If the browser can't re-encode a photo we try another
 * decoder/encoder, then strip the metadata segments from the JPEG bytes
 * directly; if all of that fails the photo is refused (PhotoPrivacyError).
 */
import { supabase } from './supabase';
import { t } from '../i18n';

const MAX_DIM = 1600;
const QUALITY = 0.8;

/** A photo we could not make metadata-free. Its message is user-facing. */
export class PhotoPrivacyError extends Error {
  constructor() {
    super(t('photo.cannotStrip'));
    this.name = 'PhotoPrivacyError';
  }
}

/** Blobs this module produced, so a file cleaned at pick time isn't re-encoded on upload. */
const cleaned = new WeakSet<Blob>();

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

/** Decoder 1: createImageBitmap (applies EXIF orientation in modern browsers). */
async function decodeBitmap(file: Blob): Promise<Decoded> {
  const bitmap = await createImageBitmap(file);
  return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
}

/** Decoder 2: an <img> element — decodes some formats createImageBitmap won't. */
async function decodeImgElement(file: Blob): Promise<Decoded> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function paint(ctx: Ctx2D, d: Decoded, w: number, h: number) {
  // JPEG has no alpha: without a fill, transparent PNG areas turn black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(d.source, 0, 0, w, h);
}

/** Encoder 1: a DOM canvas. */
async function encodeCanvas(d: Decoded, w: number, h: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paint(ctx, d, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
}

/** Encoder 2: an OffscreenCanvas (separate code path, different memory limits). */
async function encodeOffscreen(d: Decoded, w: number, h: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paint(ctx, d, w, h);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
}

/** Only a non-empty JPEG counts — a PNG fallback from toBlob would be mislabeled on upload. */
const isJpeg = (b: Blob | null): b is Blob => !!b && b.size > 0 && b.type === 'image/jpeg';

/**
 * Last resort for JPEGs: copy the file segment by segment, dropping every
 * metadata segment — APP1 (EXIF incl. GPS, XMP), APP13 (IPTC), all other
 * APPn except APP0 (JFIF), APP2 ICC_PROFILE (colour) and APP14 (Adobe,
 * needed to decode colour correctly) — and COM comments. Stops at the first
 * EOI, which also drops multi-picture extras (depth/gain maps) phones append
 * after it, each with its own EXIF. Returns null on anything unexpected.
 * The photo is not downscaled, and EXIF orientation is lost with EXIF, so
 * it may show sideways — acceptable for a path that should almost never run.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const b = bytes;
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out: Uint8Array[] = [b.subarray(0, 2)];
  const startsWith = (at: number, s: string) =>
    [...s].every((c, k) => b[at + k] === c.charCodeAt(0));

  let i = 2;
  let sawEoi = false;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd9) {                   // EOI: done
      out.push(b.subarray(i, i + 2));
      sawEoi = true;
      break;
    }
    if (i + 3 >= b.length) return null;
    const len = (b[i + 2] << 8) | b[i + 3];
    const end = i + 2 + len;
    if (len < 2 || end > b.length) return null;

    const payload = i + 4;
    const drop =
      marker === 0xfe ||
      (marker >= 0xe1 && marker <= 0xef &&
        !(marker === 0xee) &&
        !(marker === 0xe2 && startsWith(payload, 'ICC_PROFILE\0')));
    if (!drop) out.push(b.subarray(i, end));
    i = end;

    if (marker === 0xda) {
      // SOS: entropy-coded data follows until the next real marker
      // (0xFF not followed by 0x00 stuffing or an RSTn restart marker).
      let j = i;
      while (j + 1 < b.length) {
        if (b[j] === 0xff) {
          const n = b[j + 1];
          if (n !== 0x00 && !(n >= 0xd0 && n <= 0xd7) && n !== 0xff) break;
        }
        j++;
      }
      if (j + 1 >= b.length) return null;
      out.push(b.subarray(i, j));
      i = j;
    }
  }
  if (!sawEoi) return null;

  const total = out.reduce((n, s) => n + s.length, 0);
  const result = new Uint8Array(total);
  let o = 0;
  for (const s of out) {
    result.set(s, o);
    o += s.length;
  }
  return result;
}

/**
 * Re-encode a photo as a metadata-free JPEG, max 1600px. Tries each decoder
 * with each encoder, then byte-level stripping for JPEGs. Never returns the
 * input; throws PhotoPrivacyError when nothing works.
 */
export async function compressImage(file: Blob): Promise<Blob> {
  for (const decode of [decodeBitmap, decodeImgElement]) {
    let d: Decoded;
    try {
      d = await decode(file);
    } catch {
      continue; // this decoder can't read the format — try the next
    }
    try {
      if (!d.width || !d.height) continue;
      const scale = Math.min(1, MAX_DIM / Math.max(d.width, d.height));
      const w = Math.round(d.width * scale);
      const h = Math.round(d.height * scale);
      for (const encode of [encodeCanvas, encodeOffscreen]) {
        const blob = await encode(d, w, h).catch(() => null);
        if (isJpeg(blob)) {
          cleaned.add(blob);
          return blob;
        }
      }
    } finally {
      d.release();
    }
  }

  const stripped = stripJpegMetadata(new Uint8Array(await file.arrayBuffer()));
  if (stripped) {
    const blob = new Blob([stripped], { type: 'image/jpeg' });
    cleaned.add(blob);
    return blob;
  }
  throw new PhotoPrivacyError();
}

/**
 * The upload-ready version of a picked photo, as a File (for previews and
 * the offline queue). Throws PhotoPrivacyError — call it when the photo is
 * picked so a refusal shows up right away, not at submit.
 */
export async function cleanPhotoFile(file: File): Promise<File> {
  if (cleaned.has(file)) return file;
  const blob = await compressImage(file);
  const clean = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
  cleaned.add(clean);
  return clean;
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

/**
 * Upload a photo and return its storage PATH — not a URL. The bucket is
 * private (migration 018), so there is no public URL to hand back; callers
 * store this path on case_photos.path, and fetchCases()/fetchCase() mint a
 * short-lived signed URL for display (see api.ts).
 */
export async function uploadCasePhoto(file: File, caseId: string): Promise<string> {
  const blob = cleaned.has(file) ? file : await compressImage(file);
  const path = `${caseId}/${safeId()}.jpg`;

  const { error } = await supabase.storage
    .from('case-photos')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;

  return path;
}
