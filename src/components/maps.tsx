/**
 * Map components — Google Maps JS API with a custom marker system.
 *
 * DESIGN (excellence pass): pins ARE the cases.
 *  - Normal density: each case renders its animal's PHOTO in a circular
 *    pin with a status-colored ring (open = urgent red, in-progress =
 *    amber, en-route = blue, resolved = green + dimmed). Escalated open
 *    cases pulse. Instantly recognizable which case is which.
 *  - High density: greedy pixel clustering (56px grid). A cluster renders
 *    as a compact count bubble tinted by "does it contain open cases?";
 *    tapping zooms to its bounds. Above ~60 visible singles the map
 *    degrades photo pins to compact status dots (bikeshare-style) so it
 *    stays legible; tapping any dot still opens the case.
 *  - Vets are a visually distinct white pin with a coral cross, never
 *    clustered with cases.
 *
 * Implementation: google.maps.OverlayView-based HTML markers (no mapId /
 * AdvancedMarker requirement, full CSS control — pin styles live in the
 * design system, styles/index.css §pins).
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

const CLUSTER_PX = 56;   // pins closer than this merge into a cluster
const DENSITY_LIMIT = 60; // above this many visible singles → compact dots

// ---------------------------------------------------------------------------
// Base map hook + unavailable state
// ---------------------------------------------------------------------------
function useGoogleMap(
  ref: React.RefObject<HTMLDivElement | null>,
  options: google.maps.MapOptions
) {
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [failed, setFailed] = useState(!GMAPS_KEY);
  const optionsRef = useRef(options);

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

// ---------------------------------------------------------------------------
// HTML overlay marker (factory — the class needs the loaded google object)
// ---------------------------------------------------------------------------
interface HtmlMarkerInstance {
  setMap(map: google.maps.Map | null): void;
}

type HtmlMarkerCtor = new (
  position: LatLng,
  el: HTMLElement
) => HtmlMarkerInstance & google.maps.OverlayView;

let MarkerClass: HtmlMarkerCtor | null = null;

function getMarkerClass(g: typeof google): HtmlMarkerCtor {
  if (MarkerClass) return MarkerClass;
  class HtmlMarker extends g.maps.OverlayView {
    private el: HTMLElement;
    private position: LatLng;
    constructor(position: LatLng, el: HTMLElement) {
      super();
      this.position = position;
      this.el = el;
      this.el.style.position = 'absolute';
      this.el.style.transform = 'translate(-50%, -50%)';
      this.el.style.cursor = 'pointer';
    }
    onAdd() {
      this.getPanes()?.overlayMouseTarget.appendChild(this.el);
    }
    draw() {
      const proj = this.getProjection();
      if (!proj) return;
      const pt = proj.fromLatLngToDivPixel(
        new g.maps.LatLng(this.position.lat, this.position.lng)
      );
      if (pt) {
        this.el.style.left = `${pt.x}px`;
        this.el.style.top = `${pt.y}px`;
      }
    }
    onRemove() {
      this.el.remove();
    }
  }
  MarkerClass = HtmlMarker as unknown as HtmlMarkerCtor;
  return MarkerClass;
}

// ---------------------------------------------------------------------------
// Pin element builders (styles: index.css "Map pins" section)
// ---------------------------------------------------------------------------
function statusClass(c: CaseWithDetails): string {
  if (c.status === 'resolved') return 'resolved';
  if (c.status === 'en_route') return 'enroute';
  if (c.status === 'open') return 'open';
  if (c.status === 'closed') return 'resolved';
  return 'progress';
}

function photoPinEl(c: CaseWithDetails, onClick: () => void): HTMLElement {
  const photo = c.photos?.find((p) => p.kind === 'report') ?? c.photos?.[0];
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `pin-photo pin-photo--${statusClass(c)}${
    c.status === 'open' && c.escalated_at ? ' pin-photo--escalated' : ''
  }`;
  el.setAttribute('aria-label', `${t(`animal.${c.animal}` as const)} — ${t(`status.${c.status}` as const)}`);
  if (photo) {
    const img = document.createElement('img');
    img.src = photo.url;
    img.alt = '';
    img.loading = 'lazy';
    el.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.className = 'pin-photo__emoji';
    span.textContent = animalEmoji(c.animal);
    el.appendChild(span);
  }
  if (c.status === 'resolved') {
    const check = document.createElement('span');
    check.className = 'pin-photo__check';
    check.textContent = '✓';
    el.appendChild(check);
  }
  el.addEventListener('click', onClick);
  return el;
}

function dotPinEl(c: CaseWithDetails, onClick: () => void): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `pin-dot pin-dot--${statusClass(c)}`;
  el.setAttribute('aria-label', `${t(`animal.${c.animal}` as const)} — ${t(`status.${c.status}` as const)}`);
  el.addEventListener('click', onClick);
  return el;
}

function clusterEl(count: number, hasOpen: boolean, onClick: () => void): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `pin-cluster${hasOpen ? ' pin-cluster--open' : ''}`;
  el.textContent = count > 99 ? '99+' : String(count);
  el.setAttribute('aria-label', `${count} cases`);
  el.addEventListener('click', onClick);
  return el;
}

function vetPinEl(name: string, onClick: () => void): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pin-vet';
  el.textContent = '+';
  el.setAttribute('aria-label', name);
  el.title = name;
  el.addEventListener('click', onClick);
  return el;
}

// ---------------------------------------------------------------------------
// Greedy pixel clustering at the current zoom
// ---------------------------------------------------------------------------
interface Cluster {
  cases: CaseWithDetails[];
  x: number;
  y: number;
}

function clusterCases(
  g: typeof google,
  map: google.maps.Map,
  cases: CaseWithDetails[]
): Cluster[] {
  const proj = map.getProjection();
  const zoom = map.getZoom() ?? DEFAULT_ZOOM;
  if (!proj) return cases.map((c) => ({ cases: [c], x: 0, y: 0 }));
  const scale = 2 ** zoom;

  const clusters: Cluster[] = [];
  for (const c of cases) {
    const wp = proj.fromLatLngToPoint(new g.maps.LatLng(c.lat, c.lng));
    if (!wp) continue;
    const x = wp.x * scale;
    const y = wp.y * scale;
    const hit = clusters.find(
      (cl) => Math.abs(cl.x - x) < CLUSTER_PX && Math.abs(cl.y - y) < CLUSTER_PX
    );
    if (hit) {
      hit.cases.push(c);
      // keep the bubble anchored near the group's running centroid
      hit.x = (hit.x * (hit.cases.length - 1) + x) / hit.cases.length;
      hit.y = (hit.y * (hit.cases.length - 1) + y) / hit.cases.length;
    } else {
      clusters.push({ cases: [c], x, y });
    }
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Location search — Google Places Text Search, biased to the map area.
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
// Main cases map — photo pins, clusters, density degradation
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
  focus?: LatLng | null;
  onRequestLocation: () => void;
}) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const { map, failed } = useGoogleMap(ref, {
    center: userLocation ?? DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
  });
  const markers = useRef<HtmlMarkerInstance[]>([]);
  const dataRef = useRef({ cases, vets });
  dataRef.current = { cases, vets };

  // Rebuild all pins (data changed, or zoom/pan changed the clustering).
  const rebuild = useRef(() => {});
  rebuild.current = () => {
    if (!map) return;
    const g = window.google;
    const Marker = getMarkerClass(g);

    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];

    const bounds = map.getBounds();
    const inView = bounds
      ? dataRef.current.cases.filter((c) =>
          bounds.contains(new g.maps.LatLng(c.lat, c.lng)))
      : dataRef.current.cases;

    const clusters = clusterCases(g, map, inView);
    const singles = clusters.filter((cl) => cl.cases.length === 1).length;
    const dense = singles > DENSITY_LIMIT; // scooter-map mode

    for (const cl of clusters) {
      if (cl.cases.length === 1) {
        const c = cl.cases[0];
        const el = dense
          ? dotPinEl(c, () => navigate(`/case/${c.id}`))
          : photoPinEl(c, () => navigate(`/case/${c.id}`));
        const m = new Marker({ lat: c.lat, lng: c.lng }, el);
        m.setMap(map);
        markers.current.push(m);
      } else {
        const hasOpen = cl.cases.some((c) => c.status !== 'resolved');
        // anchor the bubble at the members' geographic centroid
        const lat = cl.cases.reduce((s, c) => s + c.lat, 0) / cl.cases.length;
        const lng = cl.cases.reduce((s, c) => s + c.lng, 0) / cl.cases.length;
        const el = clusterEl(cl.cases.length, hasOpen, () => {
          const b = new g.maps.LatLngBounds();
          cl.cases.forEach((c) => b.extend(new g.maps.LatLng(c.lat, c.lng)));
          map.fitBounds(b, 72);
        });
        const m = new Marker({ lat, lng }, el);
        m.setMap(map);
        markers.current.push(m);
      }
    }

    for (const v of dataRef.current.vets) {
      const m = new Marker(
        { lat: v.lat, lng: v.lng },
        vetPinEl(v.clinic_name, () => navigate(`/vet/${v.id}`))
      );
      m.setMap(map);
      markers.current.push(m);
    }
  };

  useEffect(() => {
    if (!map) return;
    const idle = map.addListener('idle', () => rebuild.current());
    rebuild.current();
    return () => {
      idle.remove();
      markers.current.forEach((m) => m.setMap(null));
      markers.current = [];
    };
  }, [map]);

  // Data changed → rebuild without waiting for the next idle.
  useEffect(() => {
    rebuild.current();
  }, [cases, vets, map]);

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
// Pin-drop picker (report flow, clinic setup) — unchanged behavior:
// initial-emit sync, accuracy-aware locate, Places search.
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

  const lastEmitted = useRef(value);
  const emit = (p: LatLng) => {
    lastEmitted.current = p;
    onChange(p);
  };

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
      const pos = await getCurrentPosition();
      if (map) {
        map.panTo(pos);
        map.setZoom(pos.accuracy <= 40 ? 18 : 16);
      }
      emit(pos);
      showAccuracy(pos, pos.accuracy);
    } catch (e) {
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
// En-route mini map — photo pin for the animal, vet cross, rescuer dot.
// ---------------------------------------------------------------------------
export function EnRouteMap({ caseData }: { caseData: CaseWithDetails }) {
  const ref = useRef<HTMLDivElement>(null);
  const { map, failed } = useGoogleMap(ref, {
    center: { lat: caseData.lat, lng: caseData.lng },
    zoom: 13,
  });
  const markers = useRef<HtmlMarkerInstance[]>([]);

  useEffect(() => {
    if (!map) return;
    const g = window.google;
    const Marker = getMarkerClass(g);
    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];

    const bounds = new g.maps.LatLngBounds();
    const add = (p: LatLng, el: HTMLElement) => {
      const m = new Marker(p, el);
      m.setMap(map);
      markers.current.push(m);
      bounds.extend(new g.maps.LatLng(p.lat, p.lng));
    };

    add({ lat: caseData.lat, lng: caseData.lng }, photoPinEl(caseData, () => {}));
    if (caseData.vet) {
      add({ lat: caseData.vet.lat, lng: caseData.vet.lng },
        vetPinEl(caseData.vet.clinic_name, () => {}));
    }
    if (caseData.rescuer_lat && caseData.rescuer_lng) {
      const car = document.createElement('div');
      car.className = 'pin-rescuer';
      car.textContent = '🚗';
      add({ lat: caseData.rescuer_lat, lng: caseData.rescuer_lng }, car);
    }

    map.fitBounds(bounds, 48);
    return () => {
      markers.current.forEach((m) => m.setMap(null));
      markers.current = [];
    };
  }, [map, caseData]);

  if (failed) return <MapUnavailable height={220} />;
  return (
    <div className="map-wrap" style={{ height: 220, borderRadius: 'var(--radius)' }}>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
