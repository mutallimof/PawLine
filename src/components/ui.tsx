/** Shared UI building blocks. */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { CaseStatus, CaseWithDetails, Profile } from '../lib/types';
import {
  getLocale,
  LOCALE_NAMES,
  setLocale,
  SUPPORTED_LOCALES,
  t,
  type LocaleCode,
} from '../i18n';
import { updateProfile } from '../lib/api';
import { IconEye, IconEyeOff } from './Icons';
import { useAuth } from '../context/AuthContext';
import { timeAgo } from '../lib/time';
import { distanceKm, formatDistance, type LatLng } from '../lib/geo';
import { tierForXp, tierName } from '../lib/xp';
import { animalEmoji, IconBell, IconChat, IconMap, IconPlus, IconUser } from './Icons';

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
  const distance = userLocation
    ? formatDistance(distanceKm(userLocation, { lat: caseData.lat, lng: caseData.lng }))
    : null;

  return (
    <Link to={`/case/${caseData.id}`} className="card case-card">
      <div className={`case-card__photo${photo ? '' : ' case-card__photo--empty'}`}>
        {photo ? (
          <img src={photo.url} alt={`${caseData.animal} — ${statusLabel(caseData.status)}`} />
        ) : (
          <span>{animalEmoji(caseData.animal)}</span>
        )}
        <StatusBadge status={caseData.status} overlay />
      </div>
      <div className="case-card__body">
        <p className="case-card__desc">{caseData.description}</p>
        <div className="case-card__meta">
          <span>{animalEmoji(caseData.animal)} {t(`animal.${caseData.animal}` as const)}</span>
          <span>·</span>
          <span>{timeAgo(caseData.created_at)}</span>
          {distance && (
            <>
              <span>·</span>
              <span>{distance}</span>
            </>
          )}
          {caseData.address_hint && (
            <>
              <span>·</span>
              <span>{caseData.address_hint}</span>
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
      <NavLink to="/impact" className={({ isActive }) => item(isActive)}>
        <span className="side-nav__emoji">💚</span> {t('impact.title')}
      </NavLink>
      <NavLink to="/profile" className={({ isActive }) => item(isActive)}>
        <IconUser /> {t('nav.profile')}
      </NavLink>

      <div className="side-nav__foot">{t('app.tagline')}</div>
    </aside>
  );
}

export function BottomNav({ unreadAlerts }: { unreadAlerts: number }) {
  const navigate = useNavigate();
  return (
    <nav className="bottom-nav" aria-label="Main">
      <NavLink to="/" end className={({ isActive }) => `bottom-nav__item${isActive ? ' active' : ''}`}>
        <IconMap />
        {t('nav.home')}
      </NavLink>
      <NavLink
        to="/messages"
        className={({ isActive }) => `bottom-nav__item${isActive ? ' active' : ''}`}
      >
        <IconChat />
        {t('nav.messages')}
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
        to="/alerts"
        className={({ isActive }) => `bottom-nav__item${isActive ? ' active' : ''}`}
      >
        <IconBell />
        {t('nav.alerts')}
        {unreadAlerts > 0 && <span className="nav-badge">{Math.min(unreadAlerts, 99)}</span>}
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

  return (
    <div className="segmented" role="group" aria-label={t('profile.language')}>
      {(Object.keys(SUPPORTED_LOCALES) as LocaleCode[]).map((code) => (
        <button
          key={code}
          className={`segmented__option${current === code ? ' active' : ''}`}
          onClick={() => choose(code)}
        >
          {LOCALE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small profile row (used in DM search, case detail)
// ---------------------------------------------------------------------------

export function ProfileRow({
  profile,
  sub,
  onClick,
}: {
  profile: Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'xp'> & { role?: string };
  sub?: string;
  onClick?: () => void;
}) {
  return (
    <button className="list-row" onClick={onClick}>
      <Avatar name={profile.display_name} url={profile.avatar_url} />
      <div className="list-row__main">
        <div className="list-row__title">
          {profile.display_name}
          {profile.role === 'vet' ? ' 🏥' : ''}
        </div>
        {sub && <div className="list-row__sub">{sub}</div>}
      </div>
      <TierBadge xp={profile.xp ?? 0} />
    </button>
  );
}
