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
    const entries = vets.map((v) => ({
      vet: v,
      km: origin ? distanceKm(origin, { lat: v.lat, lng: v.lng }) : undefined,
    }));
    if (origin) entries.sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
    return entries;
  }, [vets, caseData]);

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
          <div className="empty-state__icon">🏥</div>
          {t('vets.none')}
        </div>
      )}

      {sorted.map(({ vet, km }: { vet: Vet; km?: number }) => (
        <div key={vet.id} className="list-row" style={{ alignItems: 'flex-start' }}>
          <div className="avatar" style={{ background: 'rgba(63,127,174,.14)', color: 'var(--status-enroute)' }}>
            +
          </div>
          <div className="list-row__main">
            <div className="list-row__title">{vet.clinic_name}</div>
            <div className="list-row__sub">
              {km !== undefined ? `${formatDistance(km)} · ` : ''}
              {vet.address}
            </div>
            {vet.phone && <div className="list-row__sub">{vet.phone}</div>}
            {!vet.is_open && (
              <div className="list-row__sub" style={{ color: 'var(--status-open)' }}>
                {t('vets.closed')}
              </div>
            )}
          </div>
          <button
            className="btn btn--primary btn--small"
            disabled={busy || !vet.is_open}
            onClick={() => void pick(vet.id)}
          >
            {t('vets.select')}
          </button>
        </div>
      ))}
    </div>
  );
}
