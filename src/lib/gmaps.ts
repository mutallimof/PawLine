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
