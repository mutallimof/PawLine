/** Geometry & geolocation helpers. */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Baku city centre — sensible default map view for the Azerbaijan launch. */
export const DEFAULT_CENTER: LatLng = { lat: 40.3777, lng: 49.892 };
export const DEFAULT_ZOOM = 13;

/** Haversine distance in km (matches the SQL distance_km function). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * Promise wrapper around the browser geolocation API, with TYPED failures
 * so callers can show a precise message instead of failing silently:
 *   'insecure'    — page not served over HTTPS/localhost (browser blocks
 *                   geolocation entirely; expected in plain-HTTP dev)
 *   'denied'      — user (or OS) denied the permission
 *   'unavailable' — no fix / timeout / no hardware
 */
export interface GeoPosition extends LatLng {
  /** Radius of 68% confidence, in meters, as reported by the device. */
  accuracy: number;
}

function readPosition(options: PositionOptions): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) =>
        reject(new GeoError(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')),
      options
    );
  });
}

export function getCurrentPosition(): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(new GeoError('insecure'));
      return;
    }
    if (!('geolocation' in navigator)) {
      reject(new GeoError('unavailable'));
      return;
    }

    // ACCURACY NOTE (part of the map-accuracy fix): the browser's FIRST fix
    // is frequently a coarse network/IP estimate that can be off by hundreds
    // of meters, especially indoors. Strategy: take the quick fix so the UI
    // responds immediately-ish, and if it's coarse (> 75 m) request one more
    // FRESH high-accuracy reading (maximumAge: 0 forbids cached positions)
    // and keep whichever reports better accuracy.
    (async () => {
      let best: GeoPosition;
      try {
        best = await readPosition({
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 20_000,
        });
      } catch (e) {
        reject(e);
        return;
      }
      if (best.accuracy > 75) {
        try {
          const second = await readPosition({
            enableHighAccuracy: true,
            timeout: 8_000,
            maximumAge: 0,
          });
          if (second.accuracy < best.accuracy) best = second;
        } catch {
          // keep the first fix
        }
      }
      resolve(best);
    })();
  });
}

/* ---------------------------------------------------------------------------
 * Geolocation error typing + free geocoding (added in the fix pass)
 * ------------------------------------------------------------------------- */

export type GeoErrorKind = 'denied' | 'unavailable' | 'insecure';

/** Typed geolocation failure so the UI can show a precise, translated message. */
export class GeoError extends Error {
  kind: GeoErrorKind;
  constructor(kind: GeoErrorKind) {
    super(`geolocation:${kind}`);
    this.kind = kind;
  }
}

export function geoErrorKind(e: unknown): GeoErrorKind {
  return e instanceof GeoError ? e.kind : 'unavailable';
}
