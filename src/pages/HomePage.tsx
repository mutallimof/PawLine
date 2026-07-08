/**
 * Home — the case board. Two views of the same live data:
 *  - Map: color-coded case pins + vet pins.
 *  - Feed: photo-forward cards, nearest info first if location is known.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCases } from '../hooks/useRealtime';
import { fetchVets } from '../lib/api';
import type { Vet } from '../lib/types';
import { CasesMap, LocationSearch } from '../components/maps';
import { CaseCard, useToast } from '../components/ui';
import { SponsorStrip } from '../components/extras';
import { geoErrorKind, getCurrentPosition, type LatLng } from '../lib/geo';
import { t } from '../i18n';

type View = 'map' | 'feed';
type Filter = 'active' | 'all' | 'resolved';

export default function HomePage() {
  const { cases, loading } = useCases();
  const [vets, setVets] = useState<Vet[]>([]);
  const [view, setView] = useState<View>('map');
  const [filter, setFilter] = useState<Filter>('active');
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [searchFocus, setSearchFocus] = useState<LatLng | null>(null);
  const toast = useToast();

  useEffect(() => {
    fetchVets().then(setVets).catch(() => {});
    // Try to get location quietly on load; the locate button retries loudly.
    getCurrentPosition().then(setUserLocation).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    let list = cases;
    if (filter === 'resolved') list = cases.filter((c) => c.status === 'resolved');
    else if (filter === 'active') list = cases.filter((c) => c.status !== 'resolved');
    // Escalated-and-still-open cases have waited longest — they lead the feed.
    return [...list].sort((a, b) => {
      const ae = a.status === 'open' && a.escalated_at ? 1 : 0;
      const be = b.status === 'open' && b.escalated_at ? 1 : 0;
      if (ae !== be) return be - ae;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [cases, filter]);

  return (
    <div className="page page--flush">
      <div className="home-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 className="page-title">{t('app.name')}</h1>
            <p className="page-subtitle">{t('app.tagline')}</p>
          </div>
          {/* Always-available vet browsing — not tied to any rescue case. */}
          <Link to="/vets" className="chip active" style={{ marginTop: 10, textDecoration: 'none' }}>
            🏥 {t('home.browseVets')}
          </Link>
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
        </div>
      </div>

      {/* Both views always render; .home-layout--map/--feed shows one on
          phones, the desktop split view shows both side by side. */}
      <div className={`home-layout home-layout--${view}`}>
        <div className="home-feed">
          {loading && <div className="spinner" />}
          {!loading && filtered.length === 0 && (
            <div className="empty-state">
              <div className="empty-state__icon">🐾</div>
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
