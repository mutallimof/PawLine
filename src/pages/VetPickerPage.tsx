/**
 * Vet picker — step 4 of the pipeline. The rescuer sees registered clinics
 * sorted by distance from the ANIMAL (that's the trip that matters), and
 * asks one to receive the animal.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchVets, selectVet } from '../lib/api';
import { useCase } from '../hooks/useRealtime';
import { useToast } from '../components/ui';
import { IconBack } from '../components/Icons';
import type { Vet } from '../lib/types';
import { distanceKm, formatDistance } from '../lib/geo';
import { t } from '../i18n';
import { InkScene } from '../components/Ink';

/** 'HH:MM:SS' → 'HH:MM' (the seconds are noise to a human). */
function hhmm(t: string): string {
  return t.slice(0, 5);
}

export default function VetPickerPage() {
  const { id } = useParams<{ id: string }>();
  const { caseData } = useCase(id);
  const [vets, setVets] = useState<Vet[]>([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    fetchVets().then(setVets).catch(() => {});
  }, []);

  const sorted = useMemo(() => {
    const origin = caseData ? { lat: caseData.lat, lng: caseData.lng } : null;
    const entries = vets
      .filter((v) => v.status === 'approved')
      .map((v) => ({
        vet: v,
        km: origin ? distanceKm(origin, { lat: v.lat, lng: v.lng }) : undefined,
      }));
    // Open clinics ALWAYS outrank closed ones, then nearest-first within each
    // group. A closed clinic 200m away is useless; an open one 4km away is the
    // whole point. Closed ones stay visible (so the rescuer can see they exist
    // and when they reopen) but sink to the bottom and can't be selected.
    entries.sort((a, b) => {
      const aOpen = a.vet.open_now !== false;
      const bOpen = b.vet.open_now !== false;
      if (aOpen !== bOpen) return aOpen ? -1 : 1;
      return (a.km ?? 0) - (b.km ?? 0);
    });
    return entries;
  }, [vets, caseData]);

  const openCount = useMemo(
    () => sorted.filter(({ vet }) => vet.open_now !== false).length,
    [sorted],
  );

  const pick = async (vetId: string) => {
    if (!id) return;
    setBusy(true);
    try {
      await selectVet(id, vetId);
      navigate(`/case/${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <button className="back-btn" onClick={() => navigate(-1)}>
        <IconBack size={18} /> {t('common.back')}
      </button>
      <h1 className="page-title">{t('vets.title')}</h1>
      <p className="page-subtitle">{t('vets.sortedBy')}</p>

      {sorted.length === 0 && (
        <div className="empty-state">
          <InkScene kind="search" />
          {t('vets.none')}
        </div>
      )}

      {/* Honest, not silent: if nothing nearby is open (3am, say), say so
          plainly and tell the rescuer what to do instead of showing a list of
          doors that won't open. */}
      {sorted.length > 0 && openCount === 0 && (
        <div className="banner banner--warn" role="alert">
          <strong>{t('vets.noneOpenTitle')}</strong>
          <div style={{ marginTop: 4 }}>{t('vets.noneOpenBody')}</div>
        </div>
      )}

      {sorted.map(({ vet, km }: { vet: Vet; km?: number }) => {
        const openNow = vet.open_now !== false;
        const atCapacity = openNow && vet.is_open === false;
        return (
          <div
            key={vet.id}
            className={`list-row${openNow ? '' : ' list-row--muted'}`}
            style={{ alignItems: 'flex-start' }}
          >
            <div
              className="avatar"
              style={{ background: 'rgba(63,127,174,.14)', color: 'var(--status-enroute)' }}
            >
              +
            </div>
            <div className="list-row__main">
              <div className="list-row__title">
                {vet.clinic_name}
                {vet.is_24_7 && <span className="tag tag--always"> {t('vets.always')}</span>}
              </div>
              <div className="list-row__sub">
                {km !== undefined ? `${formatDistance(km)} · ` : ''}
                {vet.address}
              </div>
              {vet.phone && <div className="list-row__sub">{vet.phone}</div>}

              {!openNow && (
                <div className="list-row__sub list-row__sub--closed">
                  {vet.opens_at
                    ? t('vets.closedUntil').replace('{time}', hhmm(vet.opens_at))
                    : t('vets.closed')}
                </div>
              )}
              {atCapacity && (
                <div className="list-row__sub list-row__sub--closed">{t('vets.atCapacity')}</div>
              )}
              {openNow && !atCapacity && vet.closes_at && !vet.is_24_7 && (
                <div className="list-row__sub list-row__sub--open">
                  {t('vets.openUntil').replace('{time}', hhmm(vet.closes_at))}
                </div>
              )}
            </div>
            <button
              className="btn btn--primary btn--small"
              disabled={busy || !openNow}
              onClick={() => void pick(vet.id)}
            >
              {t('vets.select')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
