/**
 * Google Maps JS API loader (singleton).
 *
 * The key is PUBLIC by design (like the Supabase anon key) but must be
 * restricted in Google Cloud Console to your domains — README documents
 * the exact setup. If no key is configured, map components render a clear
 * placeholder instead of crashing, so the rest of the app stays usable.
 */
import { getLocale } from '../i18n';

declare global {
  interface Window {
    google: typeof google;
  }
}

export const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

let pending: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> {
  if (!GMAPS_KEY) return Promise.reject(new Error('missing-key'));
  if (window.google?.maps) return Promise.resolve(window.google);
  if (pending) return pending;

  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const params = new URLSearchParams({
      key: GMAPS_KEY,
      v: 'weekly',
      loading: 'async',
      language: getLocale(),
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      pending = null;
      reject(new Error('gmaps-load-failed'));
    };
    document.head.appendChild(script);
  });
  return pending;
}

/**
 * Street address for a pin, or null. Best-effort by contract: EVERY failure
 * path returns null rather than throwing, because the one caller is report
 * creation and a report must never fail over an address lookup.
 *
 * Uses the Maps JS Geocoder rather than the Geocoding REST endpoint: the web
 * service sends no CORS headers, so a browser fetch to it is blocked. The
 * Geocoder class goes through the already-loaded Maps JS API — but it still
 * bills against, and requires, the Geocoding API being enabled on the Cloud
 * project (a separate toggle from Maps JavaScript and Places).
 *
 * Returns the street-level part only ("Nizami küç. 12"), not the full
 * formatted address, which in Baku trails city, postcode and country and
 * would not fit the pill it is shown in. Falls back to the full formatted
 * address when no street components come back.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const g = await loadGoogleMaps();
    const { results } = await new g.maps.Geocoder().geocode({ location: { lat, lng } });
    const best = results?.[0];
    if (!best) return null;

    const part = (type: string) =>
      best.address_components?.find((c) => c.types.includes(type))?.long_name ?? '';
    const route = part('route');
    const number = part('street_number');
    const street = [route, number].filter(Boolean).join(' ').trim();

    return street || best.formatted_address || null;
  } catch {
    // Missing key, script blocked, Geocoding API not enabled, over quota,
    // ZERO_RESULTS — all the same to the caller: no address, carry on.
    return null;
  }
}

/**
 * Calm, warm map style matching PawLine's palette — desaturated, low-noise
 * (no POI pins or transit icons competing with case markers).
 */
export const MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#f6efe7' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a7d72' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#fdf9f4' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#fbe9dc' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f6ddc9' }] },
  { featureType: 'water', stylers: [{ color: '#cfe3ea' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#edefe2' }] },
];

export const BASE_MAP_OPTIONS: google.maps.MapOptions = {
  styles: MAP_STYLE,
  disableDefaultUI: true,
  zoomControl: false,
  clickableIcons: false,
  gestureHandling: 'greedy',
  backgroundColor: '#f6efe7',
};
