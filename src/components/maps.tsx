/**
 * Map components — Google Maps JavaScript API (+ Places for search).
 *
 * Replaced Leaflet/OpenStreetMap in the final pre-deployment pass, primarily
 * for ACCURACY in the launch markets: Google's geocoding/places coverage of
 * Baku and Turkish cities is far stronger than OSM/Nominatim's, and its
 * positioning UX (tiles, gestures) is what local users already trust.
 *
 * Requires VITE_GOOGLE_MAPS_API_KEY (setup: README "Google Maps setup").
 * Without a key every component renders a friendly placeholder — the rest
 * of the app keeps working.
 *
 * Same public API as the previous Leaflet version:
 *   <CasesMap cases vets userLocation focus onRequestLocation />
 *   <PinDropMap value onChange height />
 *   <EnRouteMap caseData />
 *   <LocationSearch onSelect bias? />
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CaseWithDetails, Vet } from '../lib/types';
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  geoErrorKind,
  getCurrentPosition,
  type LatLng,
} from '../lib/geo';
import { BASE_MAP_OPTIONS, GMAPS_KEY, loadGoogleMaps } from '../lib/gmaps';
import { t } from '../i18n';
import { IconCrosshair, animalEmoji } from './Icons';

const STATUS_HEX: Record<string, string> = {
  open: '#d93a2b',
  accepted: '#e09b26',
  vet_selected: '#e09b26',
  vet_confirmed: '#e09b26',
  en_route: '#3f7fae',
  resolved: '#3f9b6c',
};

// ---------------------------------------------------------------------------
// Shared: create a map inside a ref'd div. Returns null until ready.
// ---------------------------------------------------------------------------
function useGoogleMap(
  ref: React.RefObject<HTMLDivElement | null>,
  options: google.maps.MapOptions
) {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [failed, setFailed] = useState(!GMAPS_KEY);
  const optionsRef = useRef(options); // initial options only

  useEffect(() => {
    let cancelled = false;
    if (!ref.current || !GMAPS_KEY) return;
    loadGoogleMaps()
      .then(async (g) => {
        const { Map } = (await g.maps.importLibrary('maps')) as google.maps.MapsLibrary;
        if (cancelled || !ref.current) return;
        setMap(new Map(ref.current, { ...BASE_MAP_OPTIONS, ...optionsRef.current }));
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { map, failed };
}

function MapUnavailable({ height }: { height?: number | string }) {
  return (
    <div className="map-missing" style={{ height: height ?? '100%' }}>
      🗺️ {t('map.noKey')}
    </div>
  );
}

/** Circle marker with an emoji/text glyph — shared look for all pins. */
function makeMarker(
  g: typeof google,
  map: google.maps.Map,
  position: LatLng,
  fill: string,
  glyph: string,
  onClick?: () => void
): google.maps.Marker {
  const marker = new g.maps.Marker({
    position,
    map,
    icon: {
      path: g.maps.SymbolPath.CIRCLE,
      scale: 14,
      fillColor: fill,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2.5,
    },
    label: { text: glyph, fontSize: '14px', color: '#ffffff' },
    optimized: true,
    clickable: !!onClick,
  });
  if (onClick) marker.addListener('click', onClick);
  return marker;
}

function clearMarkers(markers: google.maps.Marker[]) {
  markers.forEach((m) => m.setMap(null));
  markers.length = 0;
}

// ---------------------------------------------------------------------------
// Location search — Google Places Text Search, biased to the current map
// area. Debounced; selecting a result jumps the parent map there.
// ---------------------------------------------------------------------------
export function LocationSearch({
  onSelect,
  bias,
}: {
  onSelect: (p: LatLng) => void;
  bias?: LatLng | null;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [searched, setSearched] = useState(false);
  const biasRef = useRef(bias);
  biasRef.current = bias;

  useEffect(() => {
    if (!GMAPS_KEY) return;
    if (query.trim().length < 3) {
      setResults([]);
      setSearched(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const g = await loadGoogleMaps();
        const { PlacesService } = (await g.maps.importLibrary(
          'places'
        )) as google.maps.PlacesLibrary;
        const service = new PlacesService(document.createElement('div'));
        const center = biasRef.current ?? DEFAULT_CENTER;
        service.textSearch(
          {
            query: query.trim(),
            location: new g.maps.LatLng(center.lat, center.lng),
            radius: 30_000,
          },
          (places, status) => {
            setSearched(true);
            if (status !== g.maps.places.PlacesServiceStatus.OK || !places) {
              setResults([]);
              return;
            }
            setResults(
              places.slice(0, 5).flatMap((p) => {
                const loc = p.geometry?.location;
                if (!loc) return [];
                return [
                  {
                    label: [p.name, p.formatted_address].filter(Boolean).join(' — '),
                    lat: loc.lat(),
                    lng: loc.lng(),
                  },
                ];
              })
            );
          }
        );
      } catch {
        setSearched(true);
        setResults([]);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [query]);

  if (!GMAPS_KEY) return null;

  return (
    <div className="loc-search">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('search.location')}
        aria-label={t('search.location')}
      />
      {(results.length > 0 || searched) && query.trim().length >= 3 && (
        <div className="loc-search__results">
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              className="loc-search__result"
              onClick={() => {
                onSelect({ lat: r.lat, lng: r.lng });
                setQuery('');
                setResults([]);
                setSearched(false);
              }}
            >
              {r.label}
            </button>
          ))}
          {searched && results.length === 0 && (
            <div className="loc-search__result loc-search__result--empty">
              {t('search.noResults')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main cases map
// ---------------------------------------------------------------------------
export function CasesMap({
  cases,
  vets,
  userLocation,
  focus = null,
  onRequestLocation,
}: {
  cases: CaseWithDetails[];
  vets: Vet[];
  userLocation: LatLng | null;
  /** External recenter target (e.g. a location-search result). */
  focus?: LatLng | null;
  onRequestLocation: () => void;
}) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const { map, failed } = useGoogleMap(ref, {
    center: userLocation ?? DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
  });
  const markers = useRef<google.maps.Marker[]>([]);

  // Case + vet pins.
  useEffect(() => {
    if (!map) return;
    const g = window.google;
    clearMarkers(markers.current);
    for (const c of cases) {
      markers.current.push(
        makeMarker(g, map, { lat: c.lat, lng: c.lng }, STATUS_HEX[c.status] ?? '#d93a2b',
          animalEmoji(c.animal), () => navigate(`/case/${c.id}`))
      );
    }
    for (const v of vets) {
      markers.current.push(
        makeMarker(g, map, { lat: v.lat, lng: v.lng }, '#3f7fae', '+', () =>
          navigate(`/vet/${v.id}`))
      );
    }
    return () => clearMarkers(markers.current);
  }, [map, cases, vets, navigate]);

  // Recenter on user location / search focus.
  useEffect(() => {
    if (map && userLocation) {
      map.panTo(userLocation);
      if ((map.getZoom() ?? 0) < 14) map.setZoom(14);
    }
  }, [map, userLocation]);
  useEffect(() => {
    if (map && focus) {
      map.panTo(focus);
      map.setZoom(16);
    }
  }, [map, focus]);

  if (failed) return <MapUnavailable />;

  return (
    <div className="map-wrap">
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
      <button
        className="map-locate-btn"
        onClick={onRequestLocation}
        aria-label={t('report.useMyLocation')}
      >
        <IconCrosshair size={20} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pin-drop picker (report flow, clinic setup)
// ---------------------------------------------------------------------------
export function PinDropMap({
  value,
  onChange,
  height = 260,
}: {
  value: LatLng;
  onChange: (p: LatLng) => void;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { map, failed } = useGoogleMap(ref, { center: value, zoom: 16 });
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const accuracyCircle = useRef<google.maps.Circle | null>(null);

  // The map is the source of truth while dragging; lastEmitted lets us tell
  // an external `value` change (GPS resolved in the parent) apart from the
  // echo of our own emit.
  const lastEmitted = useRef(value);
  const emit = (p: LatLng) => {
    lastEmitted.current = p;
    onChange(p);
  };

  // ACCURACY FIX: emit the initial center exactly once as soon as the map is
  // live. Previously the parent's value and the visible pin could disagree
  // until the first drag — a submitted report could carry a stale location.
  useEffect(() => {
    if (!map) return;
    const c = map.getCenter();
    if (c) emit({ lat: c.lat(), lng: c.lng() });

    const idle = map.addListener('idle', () => {
      const center = map.getCenter();
      if (!center) return;
      const p = { lat: center.lat(), lng: center.lng() };
      const moved =
        Math.abs(p.lat - lastEmitted.current.lat) > 1e-7 ||
        Math.abs(p.lng - lastEmitted.current.lng) > 1e-7;
      if (moved) emit(p);
    });
    return () => idle.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // External value change → recenter.
  useEffect(() => {
    if (!map) return;
    const moved =
      Math.abs(value.lat - lastEmitted.current.lat) > 1e-7 ||
      Math.abs(value.lng - lastEmitted.current.lng) > 1e-7;
    if (moved) {
      lastEmitted.current = value;
      map.panTo(value);
    }
  }, [map, value]);

  const showAccuracy = (p: LatLng, accuracy: number) => {
    setAccuracyM(Math.round(accuracy));
    if (!map) return;
    accuracyCircle.current?.setMap(null);
    accuracyCircle.current = new window.google.maps.Circle({
      map,
      center: p,
      radius: accuracy,
      fillColor: '#3f7fae',
      fillOpacity: 0.12,
      strokeColor: '#3f7fae',
      strokeOpacity: 0.4,
      strokeWeight: 1,
    });
  };

  const locateMe = async () => {
    setLocating(true);
    setGeoError(null);
    try {
      const pos = await getCurrentPosition(); // two-reading, accuracy-aware
      if (map) {
        map.panTo(pos);
        map.setZoom(pos.accuracy <= 40 ? 18 : 16);
      }
      emit(pos);
      showAccuracy(pos, pos.accuracy);
    } catch (e) {
      // Never fail silently — say exactly why, dragging remains the fallback.
      setGeoError(t(`geo.${geoErrorKind(e)}` as const));
    } finally {
      setLocating(false);
    }
  };

  const jumpTo = (p: LatLng) => {
    setGeoError(null);
    setAccuracyM(null);
    accuracyCircle.current?.setMap(null);
    if (map) {
      map.panTo(p);
      map.setZoom(17);
    }
    emit(p);
  };

  return (
    <div>
      <LocationSearch onSelect={jumpTo} bias={value} />
      {failed ? (
        <MapUnavailable height={height} />
      ) : (
        <div className="map-wrap" style={{ height, borderRadius: 'var(--radius)' }}>
          <div ref={ref} style={{ width: '100%', height: '100%' }} />
          <div className="center-pin">📍</div>
          <button
            type="button"
            className="map-locate-btn"
            onClick={locateMe}
            disabled={locating}
            aria-label={t('report.useMyLocation')}
          >
            <IconCrosshair size={20} />
          </button>
        </div>
      )}
      {accuracyM !== null && accuracyM > 30 && (
        <p className="map-accuracy-hint">{t('map.accuracy', { m: accuracyM })}</p>
      )}
      {geoError && (
        <div className="banner banner--warn" style={{ marginTop: 8 }} role="alert">
          {geoError}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// En-route mini map: animal origin → vet, plus the rescuer's last shared spot.
// ---------------------------------------------------------------------------
export function EnRouteMap({ caseData }: { caseData: CaseWithDetails }) {
  const ref = useRef<HTMLDivElement>(null);
  const { map, failed } = useGoogleMap(ref, {
    center: { lat: caseData.lat, lng: caseData.lng },
    zoom: 13,
  });
  const markers = useRef<google.maps.Marker[]>([]);

  useEffect(() => {
    if (!map) return;
    const g = window.google;
    clearMarkers(markers.current);

    const bounds = new g.maps.LatLngBounds();
    const add = (p: LatLng, fill: string, glyph: string) => {
      markers.current.push(makeMarker(g, map, p, fill, glyph));
      bounds.extend(p);
    };

    add({ lat: caseData.lat, lng: caseData.lng },
      STATUS_HEX[caseData.status] ?? '#d93a2b', animalEmoji(caseData.animal));
    if (caseData.vet) add({ lat: caseData.vet.lat, lng: caseData.vet.lng }, '#3f7fae', '+');
    if (caseData.rescuer_lat && caseData.rescuer_lng)
      add({ lat: caseData.rescuer_lat, lng: caseData.rescuer_lng }, '#3f7fae', '🚗');

    map.fitBounds(bounds, 48);
    return () => clearMarkers(markers.current);
  }, [map, caseData]);

  if (failed) return <MapUnavailable height={220} />;
  return (
    <div className="map-wrap" style={{ height: 220, borderRadius: 'var(--radius)' }}>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
