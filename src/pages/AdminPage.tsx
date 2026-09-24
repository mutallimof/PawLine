/**
 * Admin screen — routine operations for the platform operator, in-app so no
 * SQL is needed day to day:
 *   - Vet approvals: pending clinics appear here; approve/reject.
 *   - Reports: everything users flagged; hide content, ban users, dismiss.
 *   - Sponsors: manage the "Supported by" strip.
 *   - Users: every account (migration 030) — ban/unban, unhide, clinic review.
 *
 * Access: profiles.is_admin — settable ONLY via the SQL editor
 * (docs/OPERATIONS.md explains how and why).
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  adminBanUser,
  adminFlagAccount,
  adminSetPartner,
  fetchAdminStats,
  fetchReportedAccounts,
  fetchHiddenRatioAccounts,
  fetchHighVolumeReporters,
  searchProfiles,
  type AdminStats,
  type ReportedAccount,
  type HiddenRatioAccount,
  type HighVolumeReporter,
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
import VetDocumentsList from './admin/VetDocumentsList';
import UsersTab from './admin/UsersTab';
import GrowthCharts from './admin/GrowthCharts';

type Tab = 'stats' | 'users' | 'vets' | 'reports' | 'flagged' | 'sponsors';

const TABS: Tab[] = ['stats', 'users', 'vets', 'reports', 'flagged', 'sponsors'];

export default function AdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<Tab>('stats');
  const [pendingVets, setPendingVets] = useState<Vet[]>([]);
  // Document count per pending vet, reported up by VetDocumentsList — gates
  // the approve-with-no-documents warning (C1 follow-up).
  const [vetDocCounts, setVetDocCounts] = useState<Record<string, number>>({});
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [flagged, setFlagged] = useState<ReportedAccount[]>([]);
  const [flagWindow, setFlagWindow] = useState(7);
  // Migration 023 — review-only signals, surfaced next to the report-count
  // list above. Neither ever calls adminFlagAccount itself.
  const [hiddenRatio, setHiddenRatio] = useState<HiddenRatioAccount[]>([]);
  const [highVolume, setHighVolume] = useState<HighVolumeReporter[]>([]);
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
      const [v, r, fl, s, st, hr, hv] = await Promise.all([
        fetchPendingVets(),
        fetchOpenReports(),
        fetchReportedAccounts(flagWindow),
        fetchSponsors(),
        fetchAdminStats(),
        fetchHiddenRatioAccounts(),
        fetchHighVolumeReporters(),
      ]);
      setPendingVets(v);
      setReports(r);
      setFlagged(fl);
      setSponsors(s);
      setStats(st);
      setHiddenRatio(hr);
      setHighVolume(hv);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  }, [toast, flagWindow]);

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

      {/* chip-row, not .segmented: six tabs with counts ("Reports (12)") are
          far past what the equal-width, no-wrap segmented track can hold
          without ellipsising. Chips size to their label and wrap. */}
      <div className="chip-row" role="tablist" style={{ margin: '12px 0 16px' }}>
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            aria-selected={tab === tb}
            className={`chip${tab === tb ? ' active' : ''}`}
            onClick={() => setTab(tb)}
          >
            {t(`admin.${tb}` as const)}
            {tb === 'vets' && pendingVets.length > 0 ? ` (${pendingVets.length})` : ''}
            {tb === 'reports' && reports.length > 0 ? ` (${reports.length})` : ''}
            {tb === 'flagged' && flagged.length > 0 ? ` (${flagged.length})` : ''}
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
          <GrowthCharts />
        </>
      )}

      {/* ---- Users (migration 030) ---- */}
      {tab === 'users' && (
        <UsersTab currentUserId={profile.id} pendingVets={pendingVets} onChanged={reload} />
      )}

      {/* ---- Vet approvals ---- */}
      {tab === 'vets' && (
        <>
          {pendingVets.length === 0 && <div className="empty-state">{t('admin.none')}</div>}
          {pendingVets.map((v) => (
            <div key={v.id} className="card" style={{ padding: 14, marginBottom: 12 }}>
              <div className="list-row__title">{v.clinic_name}</div>
              <div className="list-row__sub">{v.address}</div>
              <div className="list-row__sub">{v.contact_phone}{v.contact_email ? ` · ${v.contact_email}` : ''}</div>
              {(v.manager_name || v.manager_surname || v.manager_phone) && (
                <div className="list-row__sub">
                  {t('admin.vetManager')}: {[v.manager_name, v.manager_surname].filter(Boolean).join(' ')}
                  {v.manager_phone ? ` · ${v.manager_phone}` : ''}
                </div>
              )}
              {v.accepted_animals?.length > 0 && (
                <div className="list-row__sub">
                  {v.accepted_animals.map((a) => t(`animal.${a}` as const)).join(', ')}
                </div>
              )}
              <VetDocumentsList
                vetId={v.id}
                onCount={(n) => setVetDocCounts((prev) => ({ ...prev, [v.id]: n }))}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  className="btn btn--success btn--small"
                  disabled={busy}
                  onClick={run(() => {
                    if (
                      !vetDocCounts[v.id] &&
                      !window.confirm(t('admin.vetApproveNoDocsConfirm', { name: v.clinic_name }))
                    ) {
                      return Promise.resolve();
                    }
                    return adminSetVetStatus(v.id, 'approved');
                  })}
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

              {/* B3: show what's actually being reported, not just the reason. */}
              {r.target_type === 'case' && r.reported_case && (
                <p className="list-row__sub" style={{ fontStyle: 'italic' }}>
                  {r.reported_case.hidden ? `[${t('admin.alreadyHidden')}] ` : ''}
                  {r.reported_case.animal} — {r.reported_case.description.slice(0, 140)}
                </p>
              )}
              {r.target_type === 'case_message' && r.reported_message && (
                <p className="list-row__sub" style={{ fontStyle: 'italic' }}>
                  {r.reported_message.hidden ? `[${t('admin.alreadyHidden')}] ` : ''}
                  “{r.reported_message.body.slice(0, 140)}”
                </p>
              )}
              {r.target_type === 'profile' && r.reported_profile && (
                <p className="list-row__sub" style={{ fontStyle: 'italic' }}>
                  {r.reported_profile.display_name}
                </p>
              )}

              {r.target_case && (
                <Link
                  to={`/case/${r.target_case}`}
                  style={{ fontWeight: 800, color: 'var(--coral-deep)', fontSize: 13 }}
                >
                  → /case/{r.target_case.slice(0, 8)}…
                </Link>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {/* Already hidden (by another report or a flagged account)?
                    Offer Unhide instead. Unhiding leaves the report open —
                    Dismiss is still the separate "this report was wrong". */}
                {r.target_type === 'case' && r.target_case && !r.reported_case?.hidden && (
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
                {r.target_type === 'case' && r.target_case && r.reported_case?.hidden && (
                  <button
                    className="btn btn--secondary btn--small"
                    disabled={busy}
                    onClick={run(() => adminHideCase(r.target_case!, false))}
                  >
                    {t('admin.unhide')}
                  </button>
                )}
                {r.target_type === 'case_message' && r.target_message && !r.reported_message?.hidden && (
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
                {r.target_type === 'case_message' && r.target_message && r.reported_message?.hidden && (
                  <button
                    className="btn btn--secondary btn--small"
                    disabled={busy}
                    onClick={run(() => adminHideCaseMessage(r.target_message!, false))}
                  >
                    {t('admin.unhide')}
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

      {/* ---- C4: accounts with unusually many open reports recently ---- */}
      {tab === 'flagged' && (
        <>
          <p className="page-subtitle" style={{ marginTop: -4 }}>{t('admin.flaggedSub')}</p>
          <div className="chip-row" style={{ marginBottom: 14 }}>
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={flagWindow === d}
                className={`chip${flagWindow === d ? ' active' : ''}`}
                onClick={() => setFlagWindow(d)}
              >
                {t('admin.flaggedWindow', { n: d })}
              </button>
            ))}
          </div>
          {flagged.length === 0 && <div className="empty-state">{t('admin.none')}</div>}
          {flagged.map((a) => (
            <div key={a.profile_id} className="card" style={{ padding: 14, marginBottom: 12 }}>
              <div className="list-row__title">{a.display_name}</div>
              <div className="list-row__sub">
                {t('admin.flaggedCounts', { reports: a.report_count, cases: a.case_count })}
              </div>
              <div className="list-row__sub">
                {timeAgo(a.first_report_at)} → {timeAgo(a.last_report_at)}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Link to={`/user/${a.profile_id}`} className="btn btn--ghost btn--small">
                  {t('admin.viewProfile')}
                </Link>
                <button
                  className="btn btn--danger btn--small"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(t('admin.flagConfirm', { name: a.display_name }))) return;
                    void run(() => adminFlagAccount(a.profile_id))();
                  }}
                >
                  {t('admin.flagAction')}
                </button>
              </div>
            </div>
          ))}

          {/* Migration 023 — review-only signals. Same shape/action as the
              report-count list above; neither list here auto-bans. */}
          <div className="section-label">{t('admin.hiddenRatioTitle')}</div>
          <p className="page-subtitle" style={{ marginTop: -4 }}>{t('admin.hiddenRatioSub')}</p>
          {hiddenRatio.length === 0 && <div className="empty-state">{t('admin.none')}</div>}
          {hiddenRatio.map((a) => (
            <div key={a.profile_id} className="card" style={{ padding: 14, marginBottom: 12 }}>
              <div className="list-row__title">{a.display_name}</div>
              <div className="list-row__sub">
                {t('admin.hiddenRatioCounts', {
                  pct: Math.round(a.hidden_ratio * 100),
                  hidden: a.hidden_cases,
                  total: a.total_cases,
                })}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Link to={`/user/${a.profile_id}`} className="btn btn--ghost btn--small">
                  {t('admin.viewProfile')}
                </Link>
                <button
                  className="btn btn--danger btn--small"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(t('admin.flagConfirm', { name: a.display_name }))) return;
                    void run(() => adminFlagAccount(a.profile_id))();
                  }}
                >
                  {t('admin.flagAction')}
                </button>
              </div>
            </div>
          ))}

          <div className="section-label">{t('admin.highVolumeTitle')}</div>
          <p className="page-subtitle" style={{ marginTop: -4 }}>{t('admin.highVolumeSub')}</p>
          {highVolume.length === 0 && <div className="empty-state">{t('admin.none')}</div>}
          {highVolume.map((a) => (
            <div key={a.profile_id} className="card" style={{ padding: 14, marginBottom: 12 }}>
              <div className="list-row__title">{a.display_name}</div>
              <div className="list-row__sub">
                {t('admin.highVolumeCounts', { hour: a.cases_1h, day: a.cases_24h })}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <Link to={`/user/${a.profile_id}`} className="btn btn--ghost btn--small">
                  {t('admin.viewProfile')}
                </Link>
                <button
                  className="btn btn--danger btn--small"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(t('admin.flagConfirm', { name: a.display_name }))) return;
                    void run(() => adminFlagAccount(a.profile_id))();
                  }}
                >
                  {t('admin.flagAction')}
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
            <div className="chip-row" style={{ marginBottom: 12 }}>
              {(['sponsor', 'partner'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={spKind === k}
                  className={`chip${spKind === k ? ' active' : ''}`}
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
