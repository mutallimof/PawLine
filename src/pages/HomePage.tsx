/**
 * Home — the case board. Two views of the same live data:
 *  - Map: color-coded case pins + vet pins.
 *  - Feed: photo-forward cards, nearest info first if location is known.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCases } from '../hooks/useRealtime';
import { fetchVets } from '../lib/api';
import { isCaseLive, type AnimalType, type CaseStatus, type Vet } from '../lib/types';
import { CasesMap, LocationSearch } from '../components/maps';
import { AlertsBell, CaseCard, useToast } from '../components/ui';
import { SponsorStrip } from '../components/extras';
import { distanceKm, geoErrorKind, getCurrentPosition, type LatLng } from '../lib/geo';
import { t } from '../i18n';
import { PawTrailInk } from '../components/Ink';
import { EmptyPaw, IconChevronRight, IconFilter, IconMap, IconStethoscope, PawHeartMark } from '../components/Icons';

type View = 'map' | 'feed';
/** Figma v2 chips: Active (default) · Needs rescue · At the vet · All. */
type Filter = 'active' | 'open' | 'resolved' | 'all';
const FILTERS: Filter[] = ['active', 'open', 'resolved', 'all'];

const ANIMAL_TYPES: AnimalType[] = ['dog', 'cat', 'other'];
const STATUS_TYPES: CaseStatus[] = [
  'open', 'accepted', 'vet_selected', 'vet_confirmed', 'en_route', 'resolved',
];
const RADIUS_OPTIONS = [5, 15, 30, 50] as const;

export default function HomePage() {
  const { cases, loading, error, reload } = useCases();
  const [vets, setVets] = useState<Vet[]>([]);
  // Figma's home is the card list; the map is one tap away (search row).
  const [view, setView] = useState<View>('feed');
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
    // "Active" = live only (Needs rescue + In progress); "At the vet" =
    // resolved only. Closed cases show under "All" (and in history).
    if (filter === 'active') list = cases.filter((c) => isCaseLive(c.status));
    else if (filter === 'open') list = cases.filter((c) => c.status === 'open');
    else if (filter === 'resolved') list = cases.filter((c) => c.status === 'resolved');

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

  // "N vet clinics nearby" banner: within 25km if we know where the user is
  // (matches the Filters panel's own distance semantics), otherwise every
  // registered vet — never a made-up number.
  const nearbyVetCount = useMemo(() => {
    if (!userLocation) return vets.length;
    return vets.filter((v) => distanceKm(userLocation, { lat: v.lat, lng: v.lng }) <= 25).length;
  }, [vets, userLocation]);

  return (
    <div className="page page--flush">
      <div className="home-header">
        <div className="home-top">
          <Link to="/" className="home-brand">
            <span className="home-brand__tile" aria-hidden="true"><PawHeartMark /></span>
            <span className="home-brand__name">{t('app.name')}</span>
          </Link>
          <AlertsBell />
        </div>
        <p className="home-sub">{t('app.tagline')}</p>

        <div className="v2-chips home-chips" role="group" aria-label={t('home.filterStatus')}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`v2-chip${filter === f ? ' active' : ''}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === 'active' ? t('home.filter.active')
                : f === 'open' ? t('status.open')
                : f === 'resolved' ? t('status.resolved')
                : t('home.filter.all')}
            </button>
          ))}
        </div>

        {nearbyVetCount > 0 && (
          <Link to="/vets" className="home-vet-banner">
            <span className="home-vet-banner__icon" aria-hidden="true">
              <IconStethoscope size={19} />
            </span>
            <span className="home-vet-banner__text">
              <span className="home-vet-banner__title">{t('home.vetsNearby', { n: nearbyVetCount })}</span>
              <span className="home-vet-banner__sub">{t('home.vetsNearbyHint')}</span>
            </span>
            <span className="home-vet-banner__chevron" aria-hidden="true"><IconChevronRight /></span>
          </Link>
        )}

        <div className="home-tools">
          <div className="home-tools__search">
            {/* Picking a place focuses the map on it, as before — on phones
                that means switching to the map view. */}
            <LocationSearch
              onSelect={(p) => {
                setSearchFocus(p);
                setView('map');
              }}
              bias={userLocation}
            />
          </div>
          {/* Map/feed toggle only exists on phones — desktop shows both. */}
          <button
            type="button"
            className="home-tools__btn home-view-toggle"
            aria-pressed={view === 'map'}
            aria-label={t('home.map')}
            onClick={() => setView((v) => (v === 'map' ? 'feed' : 'map'))}
          >
            <IconMap />
          </button>
          {/* Group G: radius / animal type / status, behind one button. */}
          <button
            type="button"
            className={`home-tools__btn home-tools__filter${showFilters || activeFilterCount > 0 ? ' active' : ''}`}
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
          >
            <IconFilter />
            {t('home.filters')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>

        {showFilters && (
          <div className="v2-group home-filters">
            <div className="v2-group__body">
              <div className="v2-label" style={{ marginTop: 0 }}>{t('home.filterRadius')}</div>
              <div className="v2-chips v2-chips--wrap">
                <button
                  type="button"
                  className={`v2-chip v2-chip--light${radiusKm === null ? ' active' : ''}`}
                  aria-pressed={radiusKm === null}
                  onClick={() => setRadiusKm(null)}
                >
                  {t('home.filterRadiusAny')}
                </button>
                {RADIUS_OPTIONS.map((km) => (
                  <button
                    key={km}
                    type="button"
                    className={`v2-chip v2-chip--light${radiusKm === km ? ' active' : ''}`}
                    aria-pressed={radiusKm === km}
                    disabled={!userLocation}
                    onClick={() => setRadiusKm(km)}
                  >
                    {km} km
                  </button>
                ))}
              </div>
              {!userLocation && <p className="home-filters__note">{t('home.filterRadiusNoLocation')}</p>}

              <div className="v2-label">{t('home.filterAnimal')}</div>
              <div className="v2-chips v2-chips--wrap">
                {ANIMAL_TYPES.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`v2-chip v2-chip--light${animalFilter.includes(a) ? ' active' : ''}`}
                    aria-pressed={animalFilter.includes(a)}
                    onClick={() => setAnimalFilter((prev) => toggleIn(prev, a))}
                  >
                    {t(`animal.${a}` as const)}
                  </button>
                ))}
              </div>

              <div className="v2-label">{t('home.filterStatus')}</div>
              <div className="v2-chips v2-chips--wrap">
                {STATUS_TYPES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`v2-chip v2-chip--light${statusFilter.includes(s) ? ' active' : ''}`}
                    aria-pressed={statusFilter.includes(s)}
                    onClick={() => setStatusFilter((prev) => toggleIn(prev, s))}
                  >
                    {t(`status.${s}` as const)}
                  </button>
                ))}
              </div>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  className="v2-link"
                  style={{ marginTop: 12 }}
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
          </div>
        )}
      </div>

      {/* Both views always render; .home-layout--map/--feed shows one on
          phones, the desktop split view shows both side by side. */}
      <div className={`home-layout home-layout--${view}`}>
        <div className="home-feed">
          <h2 className="home-h1">{t('home.nearbyCases')}</h2>
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
              <EmptyPaw />
              {t('home.empty')}
            </div>
          )}
          {filtered.map((c) => (
            <CaseCard key={c.id} caseData={c} userLocation={userLocation} />
          ))}
          <SponsorStrip />
        </div>

        <div className="home-map">
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
