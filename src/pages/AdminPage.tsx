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
import type { ContentReport, Sponsor, Vet } from '../lib/types';

type Tab = 'vets' | 'reports' | 'sponsors';

export default function AdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('vets');
  const [pendingVets, setPendingVets] = useState<Vet[]>([]);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Sponsor form
  const [spName, setSpName] = useState('');
  const [spLogo, setSpLogo] = useState('');
  const [spUrl, setSpUrl] = useState('');
  const [spKind, setSpKind] = useState<'sponsor' | 'partner'>('sponsor');

  const reload = useCallback(async () => {
    try {
      const [v, r, s] = await Promise.all([
        fetchPendingVets(),
        fetchOpenReports(),
        fetchSponsors(),
      ]);
      setPendingVets(v);
      setReports(r);
      setSponsors(s);
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
        {(['vets', 'reports', 'sponsors'] as Tab[]).map((tb) => (
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
