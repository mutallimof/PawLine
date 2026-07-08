/**
 * Public impact page (/impact) — safe aggregates only, no PII, readable
 * signed out. Two audiences: (1) a first-time visitor deciding whether
 * this platform is real, (2) a partner/sponsor conversation where these
 * numbers ARE the pitch (see MONETIZATION.md).
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchPublicImpact, type PublicImpact } from '../lib/api';
import { IconBack } from '../components/Icons';
import { SponsorStrip } from '../components/extras';
import { t } from '../i18n';

export default function ImpactPage() {
  const [impact, setImpact] = useState<PublicImpact | null>(null);
  const [failed, setFailed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchPublicImpact().then(setImpact).catch(() => setFailed(true));
  }, []);

  const stat = (value: string | number, label: string, big = false) => (
    <div className="impact-stat" style={big ? { gridColumn: '1 / -1' } : undefined}>
      <div className={`impact-stat__value${big ? ' impact-stat__value--big' : ''}`}>{value}</div>
      <div className="impact-stat__label">{label}</div>
    </div>
  );

  return (
    <div className="page">
      <button className="back-btn" onClick={() => navigate(-1)}>
        <IconBack size={18} /> {t('common.back')}
      </button>
      <h1 className="page-title">🐾 {t('impact.title')}</h1>
      <p className="page-subtitle">{t('impact.subtitle')}</p>

      {failed && <div className="banner banner--warn">{t('common.error')}</div>}
      {!impact && !failed && <div className="skeleton skeleton--stats" aria-hidden="true" />}

      {impact && (
        <div className="impact-grid">
          {stat(impact.helped_this_month, t('impact.helpedMonth'), true)}
          {stat(impact.helped_total, t('impact.helpedTotal'))}
          {stat(
            impact.median_accept_min !== null
              ? t('impact.medianUnit', { m: impact.median_accept_min })
              : '—',
            t('impact.medianAccept')
          )}
          {stat(impact.rescuers_30d, t('impact.rescuers'))}
          {stat(impact.clinics, t('impact.clinics'))}
        </div>
      )}

      <Link to="/report" className="btn btn--primary" style={{ marginTop: 22 }}>
        {t('impact.cta')}
      </Link>

      <SponsorStrip />
    </div>
  );
}
