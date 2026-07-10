/**
 * Offline report queue (audit finding P1).
 *
 * A report typed next to an injured animal must never be lost to bad
 * signal. If submission fails for network reasons (or the device is
 * offline outright), the ENTIRE report — photos included, stored as
 * Blobs — is persisted in IndexedDB and submitted automatically when
 * connectivity returns (Shell flushes on `online` and on app start).
 *
 * Design notes:
 *  - Raw IndexedDB, no dependency — one store, tiny surface.
 *  - Flush-once semantics: an in-flight lock prevents the double-submit
 *    that rapid online/offline flapping would otherwise cause.
 *  - Failures during flush keep the record and stop (retried on the next
 *    `online` event) — half-flushed queues never drop reports.
 */
import { createCase, type NewCaseInput } from './api';

const DB_NAME = 'pawline-offline';
const STORE = 'reports';

interface QueuedReport {
  id?: number;
  createdAt: number;
  animal: NewCaseInput['animal'];
  description: string;
  lat: number;
  lng: number;
  addressHint: string;
  guestName: string;
  injuryType?: string | null;
  spotType?: string | null;
  reporterId: string | null;
  photos: Blob[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Persist a report for later submission. */
export async function queueReport(input: NewCaseInput): Promise<void> {
  const db = await openDb();
  const record: QueuedReport = {
    createdAt: Date.now(),
    animal: input.animal,
    description: input.description,
    lat: input.lat,
    lng: input.lng,
    addressHint: input.addressHint ?? '',
    guestName: input.guestName ?? '',
    injuryType: (input as { injuryType?: string | null }).injuryType ?? null,
    spotType: (input as { spotType?: string | null }).spotType ?? null,
    reporterId: input.reporterId ?? null,
    photos: input.photos.map((f) => f.slice(0, f.size, f.type)), // plain Blobs store cleanly
  };
  await tx(db, 'readwrite', (s) => s.add(record));
  db.close();
}

export async function queuedCount(): Promise<number> {
  try {
    const db = await openDb();
    const n = await tx(db, 'readonly', (s) => s.count());
    db.close();
    return n;
  } catch {
    return 0;
  }
}

let flushing = false; // flush-once lock (see header)

/**
 * Submit everything queued. Returns how many reports went through.
 * Safe to call eagerly — no-ops offline or while another flush runs.
 */
export async function flushQueue(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    const db = await openDb();
    const all = (await tx(db, 'readonly', (s) => s.getAll())) as QueuedReport[];
    for (const r of all) {
      try {
        await createCase({
          animal: r.animal,
          description: r.description,
          lat: r.lat,
          lng: r.lng,
          addressHint: r.addressHint,
          guestName: r.guestName,
          reporterId: r.reporterId,
          injuryType: (r.injuryType ?? null) as never,
          spotType: (r.spotType ?? null) as never,
          photos: r.photos.map(
            (b, i) => new File([b], `queued-${i}.jpg`, { type: b.type || 'image/jpeg' })
          ),
        });
        await tx(db, 'readwrite', (s) => s.delete(r.id!));
        sent++;
      } catch {
        break; // still bad signal — keep the rest, retry on next `online`
      }
    }
    db.close();
  } catch {
    // IndexedDB unavailable (private mode) — nothing queued there anyway.
  } finally {
    flushing = false;
  }
  return sent;
}

/** Heuristic: was this failure the network's fault (vs. a rejection)? */
export function isNetworkError(e: unknown): boolean {
  if (!navigator.onLine) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg);
}
