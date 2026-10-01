/**
 * Nearby Vets — always-available clinic browsing, independent of any rescue
 * case. List and map views of every registered clinic, sorted by distance
 * from the user's current GPS position, falling back to their saved home
 * area (Profile → notifications → "use current location as my area") when
 * GPS is denied or unavailable. Tapping a clinic opens its public page.
 *
 * This adds no role restrictions: everyone can still report and rescue
 * exactly as before — this is just a browse view.
 */
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchVets } from '../lib/api';
import { CasesMap } from '../components/maps';
import { EmptyPaw } from '../components/Icons';
import { ScreenHeader, VetCard } from '../components/ui';
import { SponsorStrip } from '../components/extras';
import { distanceKm, getCurrentPosition, type LatLng } from '../lib/geo';
import { t } from '../i18n';
import type { Vet } from '../lib/types';

export default function VetsPage() {
  const { profile } = useAuth();
  const [vets, setVets] = useState<Vet[]>([]);
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [noLocation, setNoLocation] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVets()
      .then(setVets)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Distance origin: GPS first; saved home area as a fallback.
  useEffect(() => {
    let cancelled = false;
    getCurrentPosition()
      .then((p) => {
        if (!cancelled) setOrigin(p);
      })
      .catch(() => {
        if (cancelled) return;
        if (profile?.home_lat != null && profile?.home_lng != null) {
          setOrigin({ lat: profile.home_lat, lng: profile.home_lng });
        } else {
          setNoLocation(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const sorted = useMemo(() => {
    const entries = vets.map((vet) => ({
      vet,
      km: origin ? distanceKm(origin, { lat: vet.lat, lng: vet.lng }) : undefined,
    }));
    if (origin) entries.sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
    else entries.sort((a, b) => a.vet.clinic_name.localeCompare(b.vet.clinic_name));
    return entries;
  }, [vets, origin]);

  return (
    <div className="page">
      <ScreenHeader title={t('vetsBrowse.title')} />
      <p className="v2-sub">{t('vetsBrowse.subtitle')}</p>

      <div className="v2-chips" role="group" aria-label={t('vetsBrowse.title')} style={{ marginBottom: 14 }}>
        <button type="button" className={`v2-chip${view === 'list' ? ' active' : ''}`} aria-pressed={view === 'list'} onClick={() => setView('list')}>
          {t('common.list')}
        </button>
        <button type="button" className={`v2-chip${view === 'map' ? ' active' : ''}`} aria-pressed={view === 'map'} onClick={() => setView('map')}>
          {t('home.map')}
        </button>
      </div>

      {noLocation && <div className="banner banner--info">{t('vetsBrowse.noLocation')}</div>}

      {view === 'map' ? (
        <div style={{ margin: '0 calc(-1 * var(--gutter))' }}>
          <CasesMap
            cases={[]}
            vets={vets}
            userLocation={origin}
            onRequestLocation={() => getCurrentPosition().then(setOrigin).catch(() => {})}
          />
        </div>
      ) : (
        <>
          {loading && <div className="spinner" />}
          {!loading && sorted.length === 0 && (
            <div className="empty-state">
              <EmptyPaw />
              {t('vets.none')}
            </div>
          )}
          {sorted.map(({ vet, km }) => (
            <VetCard key={vet.id} vet={vet} km={km} to={`/vet/${vet.id}`} />
          ))}
          <SponsorStrip />
        </>
      )}
    </div>
  );
}
