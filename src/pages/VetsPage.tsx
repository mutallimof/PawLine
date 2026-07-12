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
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchVets } from '../lib/api';
import { CasesMap } from '../components/maps';
import { IconBack } from '../components/Icons';
import { SponsorStrip } from '../components/extras';
import { distanceKm, formatDistance, getCurrentPosition, type LatLng } from '../lib/geo';
import { t } from '../i18n';
import type { Vet } from '../lib/types';

export default function VetsPage() {
  const { profile } = useAuth();
  const [vets, setVets] = useState<Vet[]>([]);
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [noLocation, setNoLocation] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

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
      <button className="back-btn" onClick={() => navigate(-1)}>
        <IconBack size={18} /> {t('common.back')}
      </button>
      <h1 className="page-title">{t('vetsBrowse.title')}</h1>
      <p className="page-subtitle">{t('vetsBrowse.subtitle')}</p>

      <div className="segmented" style={{ marginBottom: 14 }}>
        <button
          className={`segmented__option${view === 'list' ? ' active' : ''}`}
          onClick={() => setView('list')}
        >
          {t('common.list')}
        </button>
        <button
          className={`segmented__option${view === 'map' ? ' active' : ''}`}
          onClick={() => setView('map')}
        >
          {t('home.map')}
        </button>
      </div>

      {noLocation && <div className="banner banner--info">{t('vetsBrowse.noLocation')}</div>}

      {view === 'map' ? (
        <div style={{ margin: '0 -16px' }}>
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
              <div className="empty-state__icon">🏥</div>
              {t('vets.none')}
            </div>
          )}
          {sorted.map(({ vet, km }) => (
            <Link key={vet.id} to={`/vet/${vet.id}`} className="list-row">
              <div
                className="avatar"
                style={{ background: 'rgba(63,127,174,.14)', color: 'var(--status-enroute)' }}
              >
                +
              </div>
              <div className="list-row__main">
                <div className="list-row__title">{vet.clinic_name}</div>
                <div className="list-row__sub">
                  {km !== undefined ? `${formatDistance(km)} · ` : ''}
                  {vet.address}
                </div>
                {vet.open_now === false ? (
                  <div className="list-row__sub list-row__sub--closed">
                    {vet.opens_at
                      ? t('vets.closedUntil').replace('{time}', vet.opens_at.slice(0, 5))
                      : t('vets.closed')}
                  </div>
                ) : vet.is_open === false ? (
                  <div className="list-row__sub list-row__sub--closed">{t('vets.atCapacity')}</div>
                ) : vet.is_24_7 ? (
                  <div className="list-row__sub list-row__sub--open">{t('vets.always')}</div>
                ) : vet.closes_at ? (
                  <div className="list-row__sub list-row__sub--open">
                    {t('vets.openUntil').replace('{time}', vet.closes_at.slice(0, 5))}
                  </div>
                ) : null}
              </div>
            </Link>
          ))}
          <SponsorStrip />
        </>
      )}
    </div>
  );
}
