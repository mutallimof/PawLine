/**
 * Admin screen — routine operations for the platform operator, in-app so no
 * SQL is needed day to day:
 *   - Vet approvals: pending clinics appear here; approve/reject.
 *   - Reports: everything users flagged; hide content, ban users, dismiss.
 *   - Sponsors: manage the "Supported by" strip.
 *
 * Access: profiles.is_admin — settable ONLY via the SQL editor
 * (docs/OPERATIONS.md explains how and why).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  adminBanUser,
  adminSetPartner,
  fetchAdminStats,
  searchProfiles,
  type AdminStats,
  adminDeleteSponsor,
  adminHideCase,
  adminHideCaseMessage,
  adminResolveReport,
  adminSetVetStatus,
  adminUpsertSponsor,
  fetchOpenReports,
  fetchPendingVets,
  fetchSponsors,
} from '../lib/api';
import { useToast } from '../components/ui';
import { t } from '../i18n';
import { timeAgo } from '../lib/time';
import type { ContentReport, Profile, Sponsor, Vet } from '../lib/types';

type Tab = 'stats' | 'vets' | 'reports' | 'sponsors';

export default function AdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('stats');
  const [pendingVets, setPendingVets] = useState<Vet[]>([]);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  // Partner badge management
  const [partnerQuery, setPartnerQuery] = useState('');
  const [partnerResults, setPartnerResults] = useState<Profile[]>([]);
  const [partnerOrg, setPartnerOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Sponsor form
  const [spName, setSpName] = useState('');
  const [spLogo, setSpLogo] = useState('');
  const [spUrl, setSpUrl] = useState('');
  const [spKind, setSpKind] = useState<'sponsor' | 'partner'>('sponsor');

  const reload = useCallback(async () => {
    try {
      const [v, r, s, st] = await Promise.all([
        fetchPendingVets(),
        fetchOpenReports(),
        fetchSponsors(),
        fetchAdminStats(),
      ]);
      setPendingVets(v);
      setReports(r);
      setSponsors(s);
      setStats(st);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  }, [toast]);

  useEffect(() => {
    if (profile?.is_admin) void reload();
  }, [profile, reload]);

  if (!profile?.is_admin) {
    return (
      <div className="page">
        <div className="empty-state">{t('common.error')}</div>
      </div>
    );
  }

  /** Run an admin action, then refresh all queues. */
  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">{t('admin.title')}</h1>

      <div className="segmented" style={{ margin: '12px 0 16px' }}>
        {(['stats', 'vets', 'reports', 'sponsors'] as Tab[]).map((tb) => (
          <button
            key={tb}
            className={`segmented__option${tab === tb ? ' active' : ''}`}
            onClick={() => setTab(tb)}
          >
            {t(`admin.${tb}` as const)}
            {tb === 'vets' && pendingVets.length > 0 ? ` (${pendingVets.length})` : ''}
            {tb === 'reports' && reports.length > 0 ? ` (${reports.length})` : ''}
          </button>
        ))}
      </div>

      {/* ---- Stats: the survival metric front and center ---- */}
      {tab === 'stats' && (
        <>
          {!stats && <div className="spinner" />}
          {stats && (
            <div className="impact-grid">
              <div className="impact-stat" style={{ gridColumn: '1 / -1' }}>
                <div className="impact-stat__value impact-stat__value--big">
                  {stats.median_accept_min !== null ? `${stats.median_accept_min} min` : '—'}
                </div>
                <div className="impact-stat__label">{t('admin.statMedianAccept')}</div>
              </div>
              <div className="impact-stat">
                <div className="impact-stat__value">{stats.cases_open_now}</div>
                <div className="impact-stat__label">{t('admin.statOpen')}</div>
              </div>
              <div className="impact-stat">
                <div className="impact-stat__value">{stats.cases_resolved_30d}</div>
                <div className="impact-stat__label">{t('admin.statResolved30')}</div>
              </div>
              <div className="impact-stat">
                <div className="impact-stat__value">
                  {stats.median_resolve_min !== null ? `${stats.median_resolve_min} min` : '—'}
                </div>
                <div className="impact-stat__label">{t('admin.statMedianResolve')}</div>
              </div>
              <div className="impact-stat">
                <div className="impact-stat__value">{stats.active_rescuers_30d}</div>
                <div className="impact-stat__label">{t('admin.statRescuers')}</div>
              </div>
              <div className="impact-stat">
                <div className="impact-stat__value">{stats.reports_by_guests_7d}</div>
                <div className="impact-stat__label">{t('admin.statGuest7')}</div>
              </div>
              <div className="impact-stat">
                <div className="impact-stat__value">{stats.cases_total}</div>
                <div className="impact-stat__label">{t('home.filter.all')}</div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ---- Vet approvals ---- */}
      {tab === 'vets' && (
        <>
          {pendingVets.length === 0 && <div className="empty-state">{t('admin.none')}</div>}
          {pendingVets.map((v) => (
            <div key={v.id} className="card" style={{ padding: 14, marginBottom: 12 }}>
              <div className="list-row__title">{v.clinic_name}</div>
              <div className="list-row__sub">{v.address}</div>
              <div className="list-row__sub">{v.phone}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  className="btn btn--success btn--small"
                  disabled={busy}
                  onClick={run(() => adminSetVetStatus(v.id, 'approved'))}
                >
                  ✓ {t('admin.approve')}
                </button>
                <button
                  className="btn btn--danger btn--small"
                  disabled={busy}
                  onClick={run(() => adminSetVetStatus(v.id, 'rejected'))}
                >
                  {t('admin.reject')}
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ---- Moderation reports ---- */}
      {tab === 'reports' && (
        <>
          {reports.length === 0 && <div className="empty-state">{t('admin.none')}</div>}
          {reports.map((r) => (
            <div key={r.id} className="card" style={{ padding: 14, marginBottom: 12 }}>
              <div className="list-row__title">
                {r.target_type} · {timeAgo(r.created_at)}
              </div>
              <p style={{ fontSize: 14, margin: '6px 0' }}>“{r.reason}”</p>
              {r.target_case && (
                <Link
                  to={`/case/${r.target_case}`}
                  style={{ fontWeight: 800, color: 'var(--coral-deep)', fontSize: 13 }}
                >
                  → /case/{r.target_case.slice(0, 8)}…
                </Link>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {r.target_type === 'case' && r.target_case && (
                  <button
                    className="btn btn--danger btn--small"
                    disabled={busy}
                    onClick={run(async () => {
                      await adminHideCase(r.target_case!, true);
                      await adminResolveReport(r.id, 'resolved');
                    })}
                  >
                    {t('admin.hideContent')}
                  </button>
                )}
                {r.target_type === 'case_message' && r.target_message && (
                  <button
                    className="btn btn--danger btn--small"
                    disabled={busy}
                    onClick={run(async () => {
                      await adminHideCaseMessage(r.target_message!, true);
                      await adminResolveReport(r.id, 'resolved');
                    })}
                  >
                    {t('admin.hideContent')}
                  </button>
                )}
                {r.target_profile && (
                  <button
                    className="btn btn--danger btn--small"
                    disabled={busy}
                    onClick={run(async () => {
                      await adminBanUser(r.target_profile!, true);
                      await adminResolveReport(r.id, 'resolved');
                    })}
                  >
                    {t('admin.banUser')}
                  </button>
                )}
                <button
                  className="btn btn--ghost btn--small"
                  disabled={busy}
                  onClick={run(() => adminResolveReport(r.id, 'dismissed'))}
                >
                  {t('admin.dismiss')}
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ---- Sponsors ---- */}
      {tab === 'sponsors' && (
        <>
          <div className="card" style={{ padding: 14, marginBottom: 16 }}>
            <label className="field">
              <span className="field__label">{t('admin.sponsorName')}</span>
              <input value={spName} onChange={(e) => setSpName(e.target.value)} maxLength={80} />
            </label>
            <label className="field">
              <span className="field__label">{t('admin.sponsorLogo')}</span>
              <input value={spLogo} onChange={(e) => setSpLogo(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">{t('admin.sponsorUrl')}</span>
              <input value={spUrl} onChange={(e) => setSpUrl(e.target.value)} />
            </label>
            <span className="field__label">{t('admin.sponsorKind')}</span>
            <div className="segmented" style={{ marginBottom: 12 }}>
              {(['sponsor', 'partner'] as const).map((k) => (
                <button
                  key={k}
                  className={`segmented__option${spKind === k ? ' active' : ''}`}
                  onClick={() => setSpKind(k)}
                >
                  {k === 'sponsor' ? t('sponsors.title') : t('partners.title')}
                </button>
              ))}
            </div>
            <button
              className="btn btn--primary btn--small"
              disabled={busy || !spName.trim()}
              onClick={run(async () => {
                await adminUpsertSponsor({
                  name: spName.trim(),
                  logo_url: spLogo.trim(),
                  url: spUrl.trim(),
                  kind: spKind,
                });
                setSpName('');
                setSpLogo('');
                setSpUrl('');
              })}
            >
              {t('admin.add')}
            </button>
          </div>

          {/* Partner badge: mark a user account as a verified org rep */}
          <div className="card" style={{ padding: 14, marginBottom: 16 }}>
            <div className="section-label" style={{ marginTop: 0 }}>{t('admin.partnerTitle')}</div>
            <label className="field">
              <span className="field__label">{t('dm.searchPeople')}</span>
              <input
                value={partnerQuery}
                onChange={(e) => {
                  setPartnerQuery(e.target.value);
                  if (e.target.value.trim().length >= 2 && profile) {
                    void searchProfiles(e.target.value.trim(), profile.id)
                      .then((r) => setPartnerResults(r.slice(0, 5)))
                      .catch(() => {});
                  } else setPartnerResults([]);
                }}
              />
            </label>
            <label className="field">
              <span className="field__label">{t('admin.partnerOrg')}</span>
              <input value={partnerOrg} onChange={(e) => setPartnerOrg(e.target.value)} maxLength={60} />
            </label>
            {partnerResults.map((p) => (
              <div key={p.id} className="list-row">
                <div className="list-row__main">
                  <div className="list-row__title">{p.display_name}</div>
                  {p.partner_org && <div className="list-row__sub">🤝 {p.partner_org}</div>}
                </div>
                <button
                  className="btn btn--secondary btn--small"
                  disabled={busy}
                  onClick={run(async () => {
                    await adminSetPartner(p.id, partnerOrg.trim() || null);
                    setPartnerResults([]);
                    setPartnerQuery('');
                  })}
                >
                  {t('admin.partnerSet')}
                </button>
              </div>
            ))}
          </div>

          {sponsors.map((sp) => (
            <div key={sp.id} className="list-row">
              <div className="list-row__main">
                <div className="list-row__title">
                  {sp.name} · {sp.kind === 'sponsor' ? '💛' : '🤝'}
                </div>
                <div className="list-row__sub">{sp.url}</div>
              </div>
              <button
                className="btn btn--danger btn--small"
                disabled={busy}
                onClick={run(() => adminDeleteSponsor(sp.id))}
              >
                {t('admin.remove')}
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
