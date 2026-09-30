/** Shared UI building blocks. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { isCaseLive, type CaseStatus, type CaseWithDetails, type UrgencyLevel, type Vet } from '../lib/types';
import {
  getLocale,
  LOCALE_NAMES,
  setLocale,
  ENABLED_LOCALES,
  t,
  type LocaleCode,
} from '../i18n';
import { fetchPublicImpact, updateProfile, type PublicImpact } from '../lib/api';
import { IconEye, IconEyeOff } from './Icons';
import { useAuth } from '../context/AuthContext';
import { timeAgo } from '../lib/time';
import { distanceKm, formatDistance, type LatLng } from '../lib/geo';
import { tierForXp, tierName } from '../lib/xp';
import {
  animalEmoji,
  IconBack,
  IconBell,
  IconChatRound,
  IconChevronRight,
  IconClock,
  IconGrid,
  IconPin,
  IconPlus,
  IconStethoscope,
  IconUser,
  PawHeartMark,
} from './Icons';
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
  resolved: 'var(--brand-fill)', // badge fill under white text — the bright green fails contrast
  closed: 'var(--ink-soft)',
};

export function statusLabel(status: CaseStatus): string {
  return t(`status.${status}` as const);
}

/**
 * Figma v2: one status vocabulary. The seven DB statuses fold into four
 * groups shown on filter chips and card badges; the exact step still shows
 * on Case Detail (statusLabel) and in the paw trail.
 */
export type StatusGroup = 'open' | 'progress' | 'done' | 'closed';
export function statusGroup(status: CaseStatus): StatusGroup {
  if (status === 'open') return 'open';
  if (status === 'resolved') return 'done';
  if (status === 'closed') return 'closed';
  return 'progress';
}
export function statusGroupLabel(group: StatusGroup): string {
  return group === 'open' ? t('status.open')
    : group === 'progress' ? t('status.inProgress')
    : group === 'done' ? t('status.resolved')
    : t('status.closed');
}
export function StatusGroupBadge({ status }: { status: CaseStatus }) {
  const g = statusGroup(status);
  return <span className={`v2-badge v2-badge--${g}`}>{statusGroupLabel(g)}</span>;
}

export function StatusBadge({
  status,
  overlay = false,
}: {
  status: CaseStatus;
  overlay?: boolean;
}) {
  // Pulses only while the case is live — never on resolved OR closed.
  const live = isCaseLive(status);
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

export function caseTitle(c: Pick<CaseWithDetails, 'animal' | 'injury_type'>): string {
  const animal = t(`animal.${c.animal}` as const);
  return c.injury_type ? `${animal} · ${t(`injury.${c.injury_type}` as const)}` : animal;
}

/** Figma v2 "UI Card": 140px photo left, badge · title · description · meta. */
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
  const place = [caseData.address_hint, distance].filter(Boolean).join(' · ');
  const escalated = caseData.status === 'open' && !!caseData.escalated_at;

  return (
    <Link to={`/case/${caseData.id}`} className="v2-card">
      <div className={`v2-card__photo${showPhoto ? '' : ' v2-card__photo--empty'}`}>
        {showPhoto ? (
          <CasePhoto
            url={photo!.url!}
            alt={`${caseData.animal} — ${statusLabel(caseData.status)}`}
            onError={() => setPhotoBroken(true)}
            urgency={caseData.urgency}
          />
        ) : (
          <span aria-hidden="true">{animalEmoji(caseData.animal)}</span>
        )}
      </div>
      <div className="v2-card__body">
        <div className="v2-card__badges">
          <StatusGroupBadge status={caseData.status} />
          {(caseData.urgency === 'high' || caseData.urgency === 'critical') && (
            <span className={`v2-badge v2-badge--urgency-${caseData.urgency}`}>
              {urgencyLabel(caseData.urgency)}
            </span>
          )}
        </div>
        <h3 className="v2-card__title">{caseTitle(caseData)}</h3>
        {caseData.description && <p className="v2-card__desc">{caseData.description}</p>}
        <div className="v2-card__meta">
          {place && (
            <span className="v2-meta"><IconPin /><span>{place}</span></span>
          )}
          <span className="v2-meta">
            <IconClock />
            <span>{timeAgo(caseData.created_at)}{escalated ? ` · ${t('home.stillWaiting')}` : ''}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * Figma v2 no-photo UI card for a clinic: stethoscope tile, name, one hours
 * badge, distance/address and rating meta, and an optional action (the vet
 * picker's "Ask to receive"). Links to the clinic page when `to` is given.
 */
export function vetHoursBadge(vet: Vet): { tone: StatusGroup; label: string } | null {
  if (vet.open_now === false) {
    return {
      tone: 'closed',
      label: vet.opens_at ? t('vets.closedUntil').replace('{time}', vet.opens_at.slice(0, 5)) : t('vets.closed'),
    };
  }
  if (vet.is_open === false) return { tone: 'open', label: t('vets.atCapacity') };
  if (vet.is_24_7) return { tone: 'done', label: t('vets.hours247') };
  if (vet.closes_at) return { tone: 'done', label: t('vets.openUntil').replace('{time}', vet.closes_at.slice(0, 5)) };
  return null;
}

export function VetCard({
  vet,
  km,
  to,
  showPhone = false,
  muted = false,
  action,
}: {
  vet: Vet;
  km?: number;
  to?: string;
  showPhone?: boolean;
  muted?: boolean;
  action?: ReactNode;
}) {
  const badge = vetHoursBadge(vet);
  const body = (
    <>
      <span className="vet-card__tile" aria-hidden="true"><IconStethoscope /></span>
      <span className="vet-card__body">
        <span className="v2-card__title">{vet.clinic_name}</span>
        {badge && <span className={`v2-badge v2-badge--${badge.tone} vet-card__badge`}>{badge.label}</span>}
        <span className="v2-meta">
          <IconPin />
          <span>{km !== undefined ? `${formatDistance(km)} · ` : ''}{vet.address}</span>
        </span>
        {!!vet.rating_count && (
          <span className="v2-meta vet-card__rating">
            <span aria-hidden="true">★</span>
            <span>{vet.rating_avg?.toFixed(1)} · {t('vets.ratingCount', { n: vet.rating_count })}</span>
          </span>
        )}
        {showPhone && vet.contact_phone && <span className="v2-meta"><span>{vet.contact_phone}</span></span>}
        {action && <span className="vet-card__action">{action}</span>}
      </span>
    </>
  );
  const cls = `v2-card vet-card${muted ? ' vet-card--muted' : ''}`;
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
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
        <PawHeartMark className="side-nav__mark" />
        <span className="side-nav__name">{t('app.name')}</span>
      </div>

      <button className="btn btn--primary side-nav__report" onClick={() => navigate('/report')}>
        <IconPlus size={20} /> {t('nav.report')}
      </button>

      <NavLink to="/" end className={({ isActive }) => item(isActive)}>
        <IconGrid /> {t('nav.home')}
      </NavLink>
      <NavLink to="/vets" className={({ isActive }) => item(isActive)}>
        <IconStethoscope /> {t('home.browseVets')}
      </NavLink>
      <NavLink to="/messages" className={({ isActive }) => item(isActive)}>
        <IconChatRound /> {t('nav.messages')}
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
 * Group D: Vets replaces Alerts here — on phones, alerts live behind the
 * header bell (AlertsBell). Same five slots as the Figma bottom nav.
 */
export function BottomNav() {
  const navigate = useNavigate();
  return (
    <nav className="bottom-nav" aria-label="Main">
      <NavLink to="/" end className={({ isActive }) => `bottom-nav__item${isActive ? ' active' : ''}`}>
        <IconGrid />
        {t('nav.home')}
      </NavLink>
      <NavLink to="/vets" className={({ isActive }) => `bottom-nav__item${isActive ? ' active' : ''}`}>
        <IconStethoscope />
        {t('nav.vets')}
      </NavLink>
      <div className="bottom-nav__report">
        <button
          className="bottom-nav__report-btn"
          onClick={() => navigate('/report')}
          aria-label={t('report.title')}
        >
          <IconPlus size={24} />
        </button>
      </div>
      <NavLink
        to="/messages"
        className={({ isActive }) => `bottom-nav__item${isActive ? ' active' : ''}`}
      >
        <IconChatRound />
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

/** Unread alert count, provided once by the app shell (same hook as before). */
export const UnreadAlertsContext = createContext(0);

/**
 * Header bell (Figma v2): 40×40 icon button with a green dot when there are
 * unread alerts. Phones only — the desktop sidebar has its own Alerts link.
 */
export function AlertsBell() {
  const unread = useContext(UnreadAlertsContext);
  const label = unread > 0 ? `${t('nav.alerts')} (${Math.min(unread, 99)})` : t('nav.alerts');
  return (
    <Link to="/alerts" className="icon-btn icon-btn--mobile" aria-label={label}>
      <IconBell />
      {unread > 0 && <span className="icon-btn__dot" />}
    </Link>
  );
}

/**
 * Figma v2 screen header: 40×40 back · centred uppercase title · 40×40
 * action. Back returns to the previous in-app page, or to `fallback` when
 * the page was opened directly (nothing in-app to go back to).
 */
export function ScreenHeader({
  title,
  back = true,
  fallback = '/',
  action,
}: {
  title: ReactNode;
  back?: boolean;
  fallback?: string;
  action?: ReactNode;
}) {
  const navigate = useNavigate();
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback);
  };
  return (
    <header className="screen-header">
      {back ? (
        <button type="button" className="icon-btn" onClick={goBack} aria-label={t('common.back')}>
          <IconBack />
        </button>
      ) : (
        <span />
      )}
      <h1 className="screen-header__title">{title}</h1>
      {action ?? <span />}
    </header>
  );
}

/** One row of a grouped card (Settings, Profile menu). Link, button or static. */
export function GroupRow({
  title,
  sub,
  value,
  icon,
  iconTone,
  to,
  onClick,
  danger = false,
  chevron,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  icon?: ReactNode;
  iconTone?: 'danger' | 'brand';
  to?: string;
  onClick?: () => void;
  danger?: boolean;
  chevron?: boolean;
  children?: ReactNode;
}) {
  const cls = `v2-row${sub ? ' v2-row--sub' : ''}${danger ? ' v2-row--danger' : ''}`;
  const showChev = chevron ?? !!(to || onClick);
  const inner = (
    <>
      {icon && (
        <span className={`v2-row__icon${iconTone ? ` v2-row__icon--${iconTone}` : ''}`} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="v2-row__main">
        <span className="v2-row__title">{title}</span>
        {sub && <span className="v2-row__sub">{sub}</span>}
      </span>
      {value != null && <span className="v2-row__value">{value}</span>}
      {children}
      {showChev && (
        <span className="v2-row__chev" aria-hidden="true"><IconChevronRight /></span>
      )}
    </>
  );
  if (to) return <Link to={to} className={cls}>{inner}</Link>;
  if (onClick) return <button type="button" className={cls} onClick={onClick}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
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
// Offers ENABLED_LOCALES only (Russian is hidden for launch — see i18n).
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
      {ENABLED_LOCALES.map((code) => (
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
