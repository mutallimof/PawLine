/** Shared UI building blocks. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { CaseStatus, CaseWithDetails, UrgencyLevel } from '../lib/types';
import {
  getLocale,
  LOCALE_NAMES,
  setLocale,
  SUPPORTED_LOCALES,
  t,
  type LocaleCode,
} from '../i18n';
import { fetchPublicImpact, updateProfile, type PublicImpact } from '../lib/api';
import { IconEye, IconEyeOff } from './Icons';
import { useAuth } from '../context/AuthContext';
import { timeAgo } from '../lib/time';
import { distanceKm, formatDistance, type LatLng } from '../lib/geo';
import { tierForXp, tierName } from '../lib/xp';
import { animalEmoji, IconBell, IconChat, IconMap, IconPlus, IconUser } from './Icons';
import { CasePhoto } from './CasePhoto';

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const STATUS_COLOR: Record<CaseStatus, string> = {
  open: 'var(--status-open)',
  accepted: 'var(--status-progress)',
  vet_selected: 'var(--status-progress)',
  vet_confirmed: 'var(--status-progress)',
  en_route: 'var(--status-enroute)',
  resolved: 'var(--status-resolved)',
  closed: 'var(--ink-soft)',
};

export function statusLabel(status: CaseStatus): string {
  return t(`status.${status}` as const);
}

export function StatusBadge({
  status,
  overlay = false,
}: {
  status: CaseStatus;
  overlay?: boolean;
}) {
  const live = status !== 'resolved';
  return (
    <span
      className={`status-badge${overlay ? ' status-badge--overlay' : ''}`}
      style={{ background: STATUS_COLOR[status] }}
    >
      <span className={`status-dot${live ? ' status-dot--pulse' : ''}`} />
      {statusLabel(status)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Urgency (migration 022) — purely descriptive, reporter-picked at report
// time. A separate scale from CaseStatus above: this is "how urgent did
// the reporter say it is", not "what stage is this case at".
// ---------------------------------------------------------------------------

export const URGENCY_COLOR: Record<UrgencyLevel, string> = {
  low: 'var(--urgency-low)',
  medium: 'var(--urgency-medium)',
  high: 'var(--urgency-high)',
  critical: 'var(--urgency-critical)',
};

export function urgencyLabel(level: UrgencyLevel): string {
  return t(`urgency.${level}` as const);
}

export function UrgencyBadge({ level }: { level: UrgencyLevel }) {
  return (
    <span className="urgency-badge" style={{ background: URGENCY_COLOR[level] }}>
      {urgencyLabel(level)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Avatar & tier badge
// ---------------------------------------------------------------------------

export function Avatar({
  name,
  url,
  small = false,
}: {
  name: string;
  url?: string | null;
  small?: boolean;
}) {
  return (
    <div className={`avatar${small ? ' avatar--sm' : ''}`} aria-hidden>
      {url ? <img src={url} alt="" /> : name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
}

export function TierBadge({ xp }: { xp: number }) {
  const { tier } = tierForXp(xp);
  return (
    <span className="tier-badge" style={{ background: tier.color }}>
      ★ {tierName(tier)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Platform stats — total helped, active rescuers, verified clinics — via
// the same public, no-PII get_public_impact() RPC the old standalone
// /impact page used before it was folded into Profile. Self-contained:
// fetches and renders its own data, so a page just drops in <PlatformStats />.
// ---------------------------------------------------------------------------

export function PlatformStats() {
  const [impact, setImpact] = useState<PublicImpact | null>(null);

  useEffect(() => {
    fetchPublicImpact().then(setImpact).catch(() => {});
  }, []);

  if (!impact) return null;

  return (
    <>
      <div className="section-label">{t('profile.platformStats')}</div>
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="platform-stats">
          <div className="platform-stats__item">
            <div className="platform-stats__value">{impact.helped_total}</div>
            <div className="platform-stats__label">{t('impact.helpedTotal')}</div>
          </div>
          <div className="platform-stats__item">
            <div className="platform-stats__value">{impact.rescuers_30d}</div>
            <div className="platform-stats__label">{t('impact.rescuers')}</div>
          </div>
          <div className="platform-stats__item">
            <div className="platform-stats__value">{impact.clinics}</div>
            <div className="platform-stats__label">{t('impact.clinics')}</div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Confirm modal — the styled .modal-overlay/.modal-sheet pattern SafetyAck
// (components/legal.tsx) already uses for a "make sure before you commit"
// gate, generalized to a plain title/body/confirm so other irreversible
// one-tap actions (e.g. Profile's "Register your clinic") can use the same
// look instead of a raw window.confirm.
// ---------------------------------------------------------------------------

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-sheet">
        <h2 className="modal-sheet__title">{title}</h2>
        <p className="modal-sheet__intro">{body}</p>
        <button className="btn btn--primary" onClick={onConfirm}>{confirmLabel}</button>
        <button className="link-btn" onClick={onCancel} style={{ marginTop: 8, width: '100%' }}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Case card (feed)
// ---------------------------------------------------------------------------

export function CaseCard({
  caseData,
  userLocation,
}: {
  caseData: CaseWithDetails;
  userLocation: LatLng | null;
}) {
  const photo = caseData.photos?.find((p) => p.kind === 'report') ?? caseData.photos?.[0];
  // Migration 018 (A2): photo.url can be null (signing failed) even when a
  // photo row exists, or an already-rendered <img> can fail mid-view if its
  // signed URL expires — both fall back to the same empty-state treatment.
  const [photoBroken, setPhotoBroken] = useState(false);
  const showPhoto = !!photo?.url && !photoBroken;
  const distance = userLocation
    ? formatDistance(distanceKm(userLocation, { lat: caseData.lat, lng: caseData.lng }))
    : null;

  return (
    <Link
      to={`/case/${caseData.id}`}
      className={`card case-card case-card--compact case-card--${
        caseData.status === 'resolved' ? 'resolved'
        : caseData.status === 'en_route' ? 'enroute'
        : caseData.status === 'open' ? 'open'
        : 'progress'
      }${caseData.status === 'open' && caseData.escalated_at ? ' case-card--escalated' : ''}`}
    >
      <div className={`case-card__photo${showPhoto ? '' : ' case-card__photo--empty'}`}>
        {showPhoto ? (
          <CasePhoto
            url={photo!.url!}
            alt={`${caseData.animal} — ${statusLabel(caseData.status)}`}
            onError={() => setPhotoBroken(true)}
          />
        ) : (
          <span>{animalEmoji(caseData.animal)}</span>
        )}
      </div>
      <div className="case-card__body">
        <div className="case-card__meta">
          <StatusBadge status={caseData.status} />
          <UrgencyBadge level={caseData.urgency} />
          <span>{animalEmoji(caseData.animal)} {t(`animal.${caseData.animal}` as const)}</span>
        </div>
        <p className="case-card__desc">{caseData.description}</p>
        <div className="case-card__meta case-card__meta--sub">
          <span>{timeAgo(caseData.created_at)}</span>
          {distance && (
            <>
              <span>·</span>
              <span>{distance}</span>
            </>
          )}
          {caseData.status === 'open' && caseData.escalated_at && (
            <span className="case-card__waiting">{t('home.stillWaiting')}</span>
          )}
          {caseData.address_hint && (
            <>
              <span>·</span>
              <span className="case-card__addr">{caseData.address_hint}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Paw trail — the app's signature element: the pipeline as paw prints
// walking from the report pin to the vet's cross.
// ---------------------------------------------------------------------------

const TRAIL_STEPS: { statuses: CaseStatus[]; icon: string; labelKey: Parameters<typeof t>[0] }[] = [
  { statuses: ['open'], icon: '📍', labelKey: 'status.open' },
  { statuses: ['accepted'], icon: '🐾', labelKey: 'status.accepted' },
  { statuses: ['vet_selected', 'vet_confirmed'], icon: '🐾', labelKey: 'status.vet_confirmed' },
  { statuses: ['en_route'], icon: '🐾', labelKey: 'status.en_route' },
  { statuses: ['resolved'], icon: '🏥', labelKey: 'status.resolved' },
];

export function PawTrail({ status }: { status: CaseStatus }) {
  const currentIdx = TRAIL_STEPS.findIndex((s) => s.statuses.includes(status));
  return (
    <div className="paw-trail" role="img" aria-label={statusLabel(status)}>
      {TRAIL_STEPS.map((step, i) => {
        const state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : '';
        // The resolved step shows as fully "done" when reached.
        const cls = status === 'resolved' ? (i <= currentIdx ? 'done' : '') : state;
        return (
          <div key={step.labelKey} className={`paw-trail__step ${cls}`}>
            {i > 0 && <div className="paw-trail__connector" />}
            <span className="paw-trail__icon">{step.icon}</span>
            <span className="paw-trail__label">{t(step.labelKey)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast (transient confirmations & errors)
// ---------------------------------------------------------------------------

const ToastContext = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);

  const show = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------------------
// Bottom navigation
// ---------------------------------------------------------------------------

/**
 * Desktop sidebar — same destinations as the bottom tab bar, plus a
 * prominent report action. Hidden below 1024px (CSS), where BottomNav
 * takes over. Rendering both and gating via CSS keeps a single source of
 * truth for routing while letting each form factor feel native.
 */
export function SideNav({ unreadAlerts }: { unreadAlerts: number }) {
  const navigate = useNavigate();
  const item = (isActive: boolean) => `side-nav__item${isActive ? ' active' : ''}`;
  return (
    <aside className="side-nav" aria-label="Main">
      <div className="side-nav__brand" onClick={() => navigate('/')} role="button" tabIndex={0}>
        <span className="side-nav__paw">🐾</span>
        <span className="side-nav__name">{t('app.name')}</span>
      </div>

      <button className="btn btn--primary side-nav__report" onClick={() => navigate('/report')}>
        <IconPlus size={20} /> {t('nav.report')}
      </button>

      <NavLink to="/" end className={({ isActive }) => item(isActive)}>
        <IconMap /> {t('nav.home')}
      </NavLink>
      <NavLink to="/vets" className={({ isActive }) => item(isActive)}>
        <span className="side-nav__emoji">🏥</span> {t('home.browseVets')}
      </NavLink>
      <NavLink to="/messages" className={({ isActive }) => item(isActive)}>
        <IconChat /> {t('nav.messages')}
      </NavLink>
      <NavLink to="/alerts" className={({ isActive }) => item(isActive)}>
        <IconBell /> {t('nav.alerts')}
        {unreadAlerts > 0 && <span className="nav-badge">{Math.min(unreadAlerts, 99)}</span>}
      </NavLink>
      <NavLink to="/profile" className={({ isActive }) => item(isActive)}>
        <IconUser /> {t('nav.profile')}
      </NavLink>

      <div className="side-nav__foot">{t('app.tagline')}</div>
    </aside>
  );
}

/**
 * Group D: Vets replaces Alerts here — notifications moved to the top-right
 * bell (see TopBar below). Same five slots as before, just swapped.
 */
export function BottomNav() {
  const navigate = useNavigate();
  return (
    <nav className="bottom-nav" aria-label="Main">
      <NavLink to="/" end className={({ isActive }) => `bottom-nav__item${isActive ? ' active' : ''}`}>
        <IconMap />
        {t('nav.home')}
      </NavLink>
      <NavLink to="/vets" className={({ isActive }) => `bottom-nav__item${isActive ? ' active' : ''}`}>
        <span className="bottom-nav__emoji" aria-hidden="true">🏥</span>
        {t('nav.vets')}
      </NavLink>
      <div className="bottom-nav__report">
        <button
          className="bottom-nav__report-btn"
          onClick={() => navigate('/report')}
          aria-label={t('report.title')}
        >
          <IconPlus size={26} />
        </button>
      </div>
      <NavLink
        to="/messages"
        className={({ isActive }) => `bottom-nav__item${isActive ? ' active' : ''}`}
      >
        <IconChat />
        {t('nav.messages')}
      </NavLink>
      <NavLink
        to="/profile"
        className={({ isActive }) => `bottom-nav__item${isActive ? ' active' : ''}`}
      >
        <IconUser />
        {t('nav.profile')}
      </NavLink>
    </nav>
  );
}

/**
 * Group D: top-right bell, mobile only (CSS hides it at the ≥1024px
 * breakpoint where SideNav's own Alerts link takes over — see side-nav in
 * index.css). Replaces the bottom tab bar's old Alerts slot.
 */
export function TopBar({ unreadAlerts }: { unreadAlerts: number }) {
  return (
    <div className="top-bar">
      <NavLink to="/alerts" className="top-bar__bell" aria-label={t('nav.alerts')}>
        <IconBell size={22} />
        {unreadAlerts > 0 && <span className="nav-badge">{Math.min(unreadAlerts, 99)}</span>}
      </NavLink>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Password field with show/hide toggle
// ---------------------------------------------------------------------------

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  onEnter?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <div className="pw-wrap">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        />
        <button
          type="button"
          className="pw-toggle"
          aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
        >
          {visible ? <IconEyeOff size={19} /> : <IconEye size={19} />}
        </button>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Language switcher — works for guests (localStorage) and signed-in users
// (localStorage + profiles.locale, so the choice follows them across devices).
//
// FLAGGED, NOT FIXED (Group H): profiles.locale's CHECK constraint
// (migration 002) and handle_new_user()'s signup allow-list only permit
// ('az','tr','en') — not 'ru'. So for a signed-in user choosing Russian,
// the updateProfile() call below fails silently (already caught) — the
// local switch still applies for this session/device, but the choice
// won't survive signing in elsewhere until a migration adds 'ru' to both.
// That's a schema change; per this group's instructions it's flagged here
// rather than written as an unapplied migration.
// ---------------------------------------------------------------------------

export function LanguageSwitcher() {
  const { user } = useAuth();
  const current = getLocale();

  const choose = (code: LocaleCode) => {
    setLocale(code); // persists to localStorage + notifies subscribers
    if (user) {
      // Best-effort server persistence; the local switch already applied.
      void updateProfile(user.id, { locale: code }).catch(() => {});
    }
  };

  // chip-row, not .segmented: even two-letter codes ellipsised there ("E…",
  // "R…") — a quarter of the track minus its padding is narrower than "EN"
  // or "RU" at that weight. Chips size to their label, so this can't clip at
  // any width or in any locale.
  return (
    <div className="chip-row lang-switcher" role="group" aria-label={t('profile.language')}>
      {(Object.keys(SUPPORTED_LOCALES) as LocaleCode[]).map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={current === code}
          className={`chip${current === code ? ' active' : ''}`}
          onClick={() => choose(code)}
        >
          {LOCALE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}
