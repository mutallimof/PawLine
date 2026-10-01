/**
 * Home — the case board. Two views of the same live data:
 *  - Feed (default): photo-forward cards.
 *  - Map: case pins + vet pins — a toggle on phones, always beside the feed
 *    on desktop.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { EmptyPaw, IconChevronRight, IconFilter, IconList, IconMap, IconStethoscope } from '../components/Icons';
import { BrandMark } from '../components/Logo';

type View = 'map' | 'feed';
/** v3 tabs = the card-badge vocabulary: Ongoing (default: open + in
 *  progress) · Rescued (resolved) · Unclaimed (closed without a rescue) · All. */
type Filter = 'ongoing' | 'rescued' | 'unclaimed' | 'all';
const FILTERS: Filter[] = ['ongoing', 'rescued', 'unclaimed', 'all'];
const inTab = (f: Filter, status: CaseStatus): boolean =>
  f === 'ongoing' ? isCaseLive(status)
    : f === 'rescued' ? status === 'resolved'
    : f === 'unclaimed' ? status === 'closed'
    : true;
const TAB_LABEL: Record<Filter, () => string> = {
  ongoing: () => t('home.tab.ongoing'),
  rescued: () => t('home.tab.rescued'),
  unclaimed: () => t('home.tab.unclaimed'),
  all: () => t('home.filter.all'),
};

const ANIMAL_TYPES: AnimalType[] = ['dog', 'cat', 'other'];
const STATUS_TYPES: CaseStatus[] = [
  'open', 'accepted', 'vet_selected', 'vet_confirmed', 'en_route', 'resolved',
];
const RADIUS_OPTIONS = [5, 15, 30, 50] as const;

export default function HomePage() {
  const { cases, loading, error, reload } = useCases();
  const [vets, setVets] = useState<Vet[]>([]);
  // The feed is the default view; the map is one tap away (List | Map).
  const [view, setView] = useState<View>('feed');
  const [filter, setFilter] = useState<Filter>('ongoing');
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [searchFocus, setSearchFocus] = useState<LatLng | null>(null);
  const toast = useToast();

  // The tab row fades its right edge only when it really scrolls (long
  // labels on narrow phones); when the tabs fit, no fade.
  const tabsRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = tabsRef.current;
    if (el) setTabsOverflow(el.scrollWidth > el.clientWidth + 1);
  });
  useEffect(() => {
    const el = tabsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTabsOverflow(el.scrollWidth > el.clientWidth + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // Group G filters (radius / animal / finer status) apply under every tab,
  // so the tab counts below match what each tab will actually show.
  const refined = useMemo(() => {
    let list = cases;
    if (radiusKm && userLocation) {
      list = list.filter((c) => distanceKm(userLocation, { lat: c.lat, lng: c.lng }) <= radiusKm);
    }
    if (animalFilter.length > 0) {
      list = list.filter((c) => animalFilter.includes(c.animal));
    }
    if (statusFilter.length > 0) {
      list = list.filter((c) => statusFilter.includes(c.status));
    }
    return list;
  }, [cases, radiusKm, userLocation, animalFilter, statusFilter]);

  const tabCounts = useMemo(() => {
    const n: Record<Filter, number> = { ongoing: 0, rescued: 0, unclaimed: 0, all: refined.length };
    for (const c of refined) {
      if (inTab('ongoing', c.status)) n.ongoing += 1;
      else if (c.status === 'resolved') n.rescued += 1;
      else if (c.status === 'closed') n.unclaimed += 1;
    }
    return n;
  }, [refined]);

  const filtered = useMemo(() => {
    const list = refined.filter((c) => inTab(filter, c.status));
    // Escalated-and-still-open cases have waited longest — they lead the feed.
    return [...list].sort((a, b) => {
      const ae = a.status === 'open' && a.escalated_at ? 1 : 0;
      const be = b.status === 'open' && b.escalated_at ? 1 : 0;
      if (ae !== be) return be - ae;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [refined, filter]);

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
            <span className="home-brand__tile" aria-hidden="true"><BrandMark /></span>
            <span className="home-brand__name">{t('app.name')}</span>
          </Link>
          <AlertsBell />
        </div>
        <h1 className="home-title">{t('home.nearbyCases')}</h1>
        <p className="home-sub">{t('app.tagline')}</p>

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
        </div>

        <div
          ref={tabsRef}
          className={`v2-chips home-tabs${tabsOverflow ? ' home-tabs--scroll' : ''}`}
          role="group"
          aria-label={t('home.filterStatus')}
        >
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`v2-chip home-tab${filter === f ? ' active' : ''}`}
              aria-pressed={filter === f}
              onClick={(e) => {
                setFilter(f);
                // A tab half under the scroll fade comes fully into view,
                // clear of the 28px fade on the right edge.
                const btn = e.currentTarget;
                const row = btn.parentElement;
                if (row) {
                  const right = btn.offsetLeft + btn.offsetWidth + 32 - row.clientWidth;
                  const left = btn.offsetLeft - 20;
                  if (row.scrollLeft < right) row.scrollTo({ left: right });
                  else if (row.scrollLeft > left) row.scrollTo({ left: Math.max(0, left) });
                }
              }}
            >
              {TAB_LABEL[f]()}
              <span className="home-tab__count">{tabCounts[f]}</span>
            </button>
          ))}
        </div>

        <div className="home-controls">
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
          {/* List | Map only exists on phones — desktop shows both. */}
          <div className="home-view" role="group" aria-label={t('home.view')}>
            <button type="button" aria-pressed={view === 'feed'} onClick={() => setView('feed')}>
              <IconList size={16} /> {t('home.feed')}
            </button>
            <button type="button" aria-pressed={view === 'map'} onClick={() => setView('map')}>
              <IconMap size={16} /> {t('home.map')}
            </button>
          </div>
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
