/**
 * Home — the case board. Two views of the same live data:
 *  - Map: color-coded case pins + vet pins.
 *  - Feed: photo-forward cards, nearest info first if location is known.
 */
import { useEffect, useMemo, useState } from 'react';
import { useCases } from '../hooks/useRealtime';
import { fetchVets } from '../lib/api';
import type { AnimalType, CaseStatus, Vet } from '../lib/types';
import { CasesMap, LocationSearch } from '../components/maps';
import { CaseCard, useToast } from '../components/ui';
import { SponsorStrip } from '../components/extras';
import { distanceKm, geoErrorKind, getCurrentPosition, type LatLng } from '../lib/geo';
import { t } from '../i18n';
import { InkScene, PawTrailInk } from '../components/Ink';

type View = 'map' | 'feed';
type Filter = 'active' | 'all' | 'resolved';

const ANIMAL_TYPES: AnimalType[] = ['dog', 'cat', 'other'];
const STATUS_TYPES: CaseStatus[] = [
  'open', 'accepted', 'vet_selected', 'vet_confirmed', 'en_route', 'resolved',
];
const RADIUS_OPTIONS = [5, 15, 30, 50] as const;

export default function HomePage() {
  const { cases, loading, error, reload } = useCases();
  const [vets, setVets] = useState<Vet[]>([]);
  const [view, setView] = useState<View>('map');
  const [filter, setFilter] = useState<Filter>('active');
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [searchFocus, setSearchFocus] = useState<LatLng | null>(null);
  const toast = useToast();

  // Group G: additional feed filters, layered on top of the all/active/
  // resolved tabs above — e.g. "active" already means "not resolved", but a
  // rescuer may want just 'open' cases within that, hence the separate
  // (finer-grained) status filter here.
  const [showFilters, setShowFilters] = useState(false);
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [animalFilter, setAnimalFilter] = useState<AnimalType[]>([]);
  const [statusFilter, setStatusFilter] = useState<CaseStatus[]>([]);
  const activeFilterCount =
    (radiusKm ? 1 : 0) + (animalFilter.length > 0 ? 1 : 0) + (statusFilter.length > 0 ? 1 : 0);

  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  useEffect(() => {
    fetchVets().then(setVets).catch(() => {});
    // Try to get location quietly on load; the locate button retries loudly.
    getCurrentPosition().then(setUserLocation).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    let list = cases;
    if (filter === 'resolved') list = cases.filter((c) => c.status === 'resolved');
    else if (filter === 'active') list = cases.filter((c) => c.status !== 'resolved');

    // Group G: radius / animal type / (finer) status, on top of the tab above.
    if (radiusKm && userLocation) {
      list = list.filter((c) => distanceKm(userLocation, { lat: c.lat, lng: c.lng }) <= radiusKm);
    }
    if (animalFilter.length > 0) {
      list = list.filter((c) => animalFilter.includes(c.animal));
    }
    if (statusFilter.length > 0) {
      list = list.filter((c) => statusFilter.includes(c.status));
    }

    // Escalated-and-still-open cases have waited longest — they lead the feed.
    return [...list].sort((a, b) => {
      const ae = a.status === 'open' && a.escalated_at ? 1 : 0;
      const be = b.status === 'open' && b.escalated_at ? 1 : 0;
      if (ae !== be) return be - ae;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [cases, filter, radiusKm, userLocation, animalFilter, statusFilter]);

  return (
    <div className="page page--flush">
      <div className="home-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">{t('app.name')}</h1>
            <p className="page-subtitle">{t('app.tagline')}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Map/feed toggle only exists on phones — desktop shows both. */}
          <div className="segmented home-view-toggle" style={{ flex: 1 }}>
            <button
              className={`segmented__option${view === 'map' ? ' active' : ''}`}
              onClick={() => setView('map')}
            >
              {t('home.map')}
            </button>
            <button
              className={`segmented__option${view === 'feed' ? ' active' : ''}`}
              onClick={() => setView('feed')}
            >
              {t('home.feed')}
            </button>
          </div>
          <div className="segmented" style={{ flex: 1.4 }}>
            {(['active', 'all', 'resolved'] as Filter[]).map((f) => (
              <button
                key={f}
                className={`segmented__option${filter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {t(`home.filter.${f}` as const)}
              </button>
            ))}
          </div>
          {/* Group G: radius / animal type / status — additional to the tabs
              above, so "Filters" opens a panel instead of crowding the bar. */}
          <button
            type="button"
            className={`chip${showFilters || activeFilterCount > 0 ? ' active' : ''}`}
            onClick={() => setShowFilters((v) => !v)}
          >
            ⚙️ {t('home.filters')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>

        {showFilters && (
          <div className="card" style={{ padding: 12, marginTop: 10 }}>
            <div className="field__label" style={{ marginBottom: 6 }}>{t('home.filterRadius')}</div>
            <div className="segmented" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
              <button
                className={`segmented__option${radiusKm === null ? ' active' : ''}`}
                onClick={() => setRadiusKm(null)}
              >
                {t('home.filterRadiusAny')}
              </button>
              {RADIUS_OPTIONS.map((km) => (
                <button
                  key={km}
                  className={`segmented__option${radiusKm === km ? ' active' : ''}`}
                  disabled={!userLocation}
                  onClick={() => setRadiusKm(km)}
                >
                  {km} km
                </button>
              ))}
            </div>
            {!userLocation && (
              <p className="page-subtitle" style={{ marginTop: -8, marginBottom: 12 }}>
                {t('home.filterRadiusNoLocation')}
              </p>
            )}

            <div className="field__label" style={{ marginBottom: 6 }}>{t('home.filterAnimal')}</div>
            <div className="segmented" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
              {ANIMAL_TYPES.map((a) => (
                <button
                  key={a}
                  className={`segmented__option${animalFilter.includes(a) ? ' active' : ''}`}
                  onClick={() => setAnimalFilter((prev) => toggleIn(prev, a))}
                >
                  {t(`animal.${a}` as const)}
                </button>
              ))}
            </div>

            <div className="field__label" style={{ marginBottom: 6 }}>{t('home.filterStatus')}</div>
            <div className="segmented" style={{ flexWrap: 'wrap', marginBottom: activeFilterCount > 0 ? 12 : 0 }}>
              {STATUS_TYPES.map((s) => (
                <button
                  key={s}
                  className={`segmented__option${statusFilter.includes(s) ? ' active' : ''}`}
                  onClick={() => setStatusFilter((prev) => toggleIn(prev, s))}
                >
                  {t(`status.${s}` as const)}
                </button>
              ))}
            </div>

            {activeFilterCount > 0 && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => {
                  setRadiusKm(null);
                  setAnimalFilter([]);
                  setStatusFilter([]);
                }}
              >
                {t('home.filterClear')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Both views always render; .home-layout--map/--feed shows one on
          phones, the desktop split view shows both side by side. */}
      <div className={`home-layout home-layout--${view}`}>
        <div className="home-feed">
          {loading && (
            <div aria-hidden="true">
              <div style={{ padding: '18px 0 22px' }}>
                <PawTrailInk count={4} />
              </div>
              <div className="skeleton skeleton--card" />
              <div className="skeleton skeleton--card" />
            </div>
          )}
          {!loading && error && (
            <div className="banner banner--warn" role="alert">
              {t('home.loadError')}
              <div style={{ marginTop: 8 }}>
                <button className="btn btn--ghost btn--small" onClick={() => void reload()}>
                  {t('common.retry')}
                </button>
              </div>
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="empty-state">
              <InkScene kind="calm" />
              {t('home.empty')}
            </div>
          )}
          {filtered.map((c) => (
            <CaseCard key={c.id} caseData={c} userLocation={userLocation} />
          ))}
          <SponsorStrip />
        </div>

        <div className="home-map">
          <div className="home-map__search">
            <LocationSearch onSelect={setSearchFocus} bias={userLocation} />
          </div>
          <CasesMap
            cases={filtered}
            vets={vets}
            userLocation={userLocation}
            focus={searchFocus}
            onRequestLocation={() =>
              getCurrentPosition()
                .then(setUserLocation)
                .catch((e) => toast(t(`geo.${geoErrorKind(e)}` as const)))
            }
          />
        </div>
      </div>
    </div>
  );
}
