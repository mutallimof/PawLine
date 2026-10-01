/**
 * Settings (Figma v2 "settings" 97:4) — grouped rows in the Figma order,
 * each opening a small sub-page (/settings/:section) that hosts the same
 * controls the app already had. Rows for features that don't exist yet
 * (password & security, sensitive content, privacy settings) are left out.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GroupRow, PasswordField, ScreenHeader, useToast } from '../components/ui';
import { supabase } from '../lib/supabase';
import { captchaOptions } from '../lib/turnstile';
import {
  deleteMyAccount,
  exportMyData,
  fetchBlockedIds,
  fetchProfile,
  unblockUser,
  updateProfile,
} from '../lib/api';
import { disablePush, enablePush, getPushSubscription, pushSupported } from '../lib/push';
import { getCurrentPosition } from '../lib/geo';
import { ENABLED_LOCALES, getLocale, LOCALE_NATIVE, setLocale, t, type LocaleCode } from '../i18n';
import { EmptyPaw, IconCheck } from '../components/Icons';
import type { NewCasePref, Profile } from '../lib/types';

type Section = 'personal' | 'notifications' | 'alerts' | 'location' | 'language' | 'blocked' | 'delete' | 'security';
const SECTIONS: Section[] = ['personal', 'notifications', 'alerts', 'location', 'language', 'blocked', 'delete', 'security'];

const LEGAL_LINKS = [
  ['/about', 'legal.about'],
  ['/faq', 'legal.faq'],
  ['/safety', 'legal.safety'],
  ['/privacy', 'legal.privacy'],
  ['/terms', 'legal.terms'],
  ['/guidelines', 'legal.conduct'],
  ['/contact', 'legal.contact'],
] as const;

export default function SettingsPage() {
  const { section } = useParams<{ section?: string }>();
  const { user, isGuest, profile, profileError, retryProfile } = useAuth();
  // Bug #1 pattern (see AuthContext's header): gate on the ACCOUNT, never on
  // `profile`, which lags the session briefly after sign-in. Gating on
  // !profile alone showed "Sign in" to someone who was already signed in.
  const isRegistered = !!user && !isGuest;
  const current = SECTIONS.includes(section as Section) ? (section as Section) : null;

  if (!isRegistered) {
    return (
      <div className="page">
        <ScreenHeader title={t('settings.title')} fallback="/profile" />
        <div className="empty-state">
          <EmptyPaw />
          {t('dm.signIn')}
          <div style={{ marginTop: 16 }}>
            <Link to="/auth" className="btn btn--primary">{t('auth.signIn')}</Link>
          </div>
        </div>
      </div>
    );
  }

  // Signed in, profile not here yet: a spinner while it loads, and a real
  // error with a retry if it never arrives — never an endless spinner.
  if (!profile) {
    return (
      <div className="page">
        <ScreenHeader title={t('settings.title')} fallback="/profile" />
        {profileError ? (
          <div className="empty-state">
            <EmptyPaw />
            {t('profile.loadFailed')}
            <div style={{ marginTop: 16 }}>
              <button className="btn btn--secondary" onClick={retryProfile}>{t('common.retry')}</button>
            </div>
          </div>
        ) : (
          <div className="spinner" />
        )}
      </div>
    );
  }

  if (current) return <SettingsSection section={current} profile={profile} userId={user.id} />;
  return <SettingsHome />;
}

/** The grouped list itself. */
function SettingsHome() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `strays-call-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t('settings.exportDone'));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page settings">
      <ScreenHeader title={t('settings.title')} fallback="/profile" />

      <div className="v2-label">{t('settings.account')}</div>
      <div className="v2-group">
        <GroupRow to="/settings/personal" title={t('settings.personal')} sub={t('settings.personalSub')} />
        <GroupRow to="/settings/security" title={t('security.title')} sub={t('security.sub')} />
      </div>

      <div className="v2-label">{t('settings.notifications')}</div>
      <div className="v2-group">
        <GroupRow to="/settings/notifications" title={t('settings.notifManage')} sub={t('settings.pushSub')} />
        <GroupRow to="/settings/alerts" title={t('settings.nearbyAlerts')} sub={t('settings.nearbyAlertsSub')} />
      </div>

      <div className="v2-label">{t('settings.groupLocation')}</div>
      <div className="v2-group">
        <GroupRow to="/settings/location" title={t('settings.location')} sub={t('settings.locationSub')} />
      </div>

      <div className="v2-label">{t('profile.language')}</div>
      <div className="v2-group">
        <GroupRow to="/settings/language" title={t('profile.language')} value={LOCALE_NATIVE[getLocale()]} />
      </div>

      <div className="v2-label">{t('settings.groupPrivacy')}</div>
      <div className="v2-group">
        <GroupRow to="/settings/blocked" title={t('settings.blocked')} />
      </div>

      <div className="v2-label">{t('settings.groupData')}</div>
      <div className="v2-group">
        <GroupRow
          onClick={busy ? undefined : () => void doExport()}
          title={busy ? t('settings.exporting') : t('settings.exportData')}
          sub={t('settings.exportSub')}
        />
        <GroupRow to="/settings/delete" title={t('settings.deleteAccount')} danger />
      </div>

      <div className="v2-label">{t('settings.groupHelp')}</div>
      <div className="v2-group">
        {LEGAL_LINKS.map(([to, key]) => (
          <GroupRow key={to} to={to} title={t(key)} />
        ))}
      </div>
    </div>
  );
}

/** One sub-page — the same controls the app already had, one topic each. */
function SettingsSection({ section, profile, userId }: { section: Section; profile: Profile; userId: string }) {
  const { refreshProfile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  // --- personal information (name + phone; both columns are user-editable)
  const [first, setFirst] = useState(profile.first_name ?? (profile.last_name ? '' : profile.display_name));
  const [last, setLast] = useState(profile.last_name ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const savePersonal = async () => {
    const f = first.trim();
    const l = last.trim();
    if (!f && !l) return;
    setBusy(true);
    try {
      // display_name is built from first + last, the same way sign-up does.
      await updateProfile(profile.id, {
        first_name: f || null,
        last_name: l || null,
        display_name: [f, l].filter(Boolean).join(' '),
        phone: phone.trim() || null,
      });
      await refreshProfile();
      toast(t('settings.saved'));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  // --- push (this device)
  const [pushOn, setPushOn] = useState(false);
  useEffect(() => {
    getPushSubscription().then((sub) => setPushOn(!!sub)).catch(() => {});
  }, []);
  const togglePush = () => {
    if (pushOn) {
      void disablePush().then(() => setPushOn(false));
    } else if (!pushSupported()) {
      toast(t('push.unsupported'));
    } else {
      void enablePush(profile.id)
        .then(() => setPushOn(true))
        .catch((e) =>
          toast(e instanceof Error && e.message === 'push-denied' ? t('push.denied') : t('push.unsupported'))
        );
    }
  };

  // --- nearby alerts + area
  const setPref = async (pref: NewCasePref) => {
    try {
      await updateProfile(profile.id, { new_case_pref: pref });
      await refreshProfile();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  };
  const saveHome = async () => {
    try {
      const pos = await getCurrentPosition();
      await updateProfile(profile.id, { home_lat: pos.lat, home_lng: pos.lng });
      await refreshProfile();
      toast(t('profile.homeSet'));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  };

  // --- language
  const chooseLocale = (code: LocaleCode) => {
    setLocale(code); // persists to localStorage + notifies subscribers
    void updateProfile(userId, { locale: code }).catch(() => {});
  };

  // --- blocked users
  const [blocked, setBlocked] = useState<Profile[] | null>(null);
  useEffect(() => {
    if (section !== 'blocked') return;
    void (async () => {
      try {
        const ids = await fetchBlockedIds(userId);
        const profiles = await Promise.all(ids.map((id) => fetchProfile(id)));
        setBlocked(profiles.filter((p): p is Profile => !!p));
      } catch {
        setBlocked([]);
      }
    })();
  }, [section, userId]);
  const doUnblock = async (id: string) => {
    try {
      await unblockUser(userId, id);
      setBlocked((prev) => (prev ?? []).filter((p) => p.id !== id));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  };

  // --- delete
  const doDelete = async () => {
    setBusy(true);
    try {
      await deleteMyAccount();
      toast(t('settings.deleted'));
      navigate('/');
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
      setBusy(false);
    }
  };

  const titles: Record<Section, string> = {
    personal: t('settings.personal'),
    notifications: t('settings.notifManage'),
    alerts: t('settings.nearbyAlerts'),
    location: t('settings.location'),
    language: t('profile.language'),
    blocked: t('settings.blocked'),
    delete: t('settings.deleteAccount'),
    security: t('security.title'),
  };

  return (
    <div className="page settings">
      <ScreenHeader title={titles[section]} fallback="/settings" />

      {section === 'security' && <PasswordSection />}

      {section === 'personal' && (
        <div className="v2-group">
          <div className="v2-group__body settings__form">
            <label className="v2-field">
              <span className="v2-field__label">{t('auth.firstName')}</span>
              <input value={first} onChange={(e) => setFirst(e.target.value)} maxLength={60} autoComplete="given-name" />
            </label>
            <label className="v2-field">
              <span className="v2-field__label">{t('auth.lastName')}</span>
              <input value={last} onChange={(e) => setLast(e.target.value)} maxLength={60} autoComplete="family-name" />
            </label>
            <label className="v2-field">
              <span className="v2-field__label">{t('auth.phone')}</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" autoComplete="tel" />
            </label>
            <button
              className="btn btn--primary"
              disabled={busy || (!first.trim() && !last.trim())}
              onClick={() => void savePersonal()}
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      )}

      {section === 'notifications' && (
        <>
          <div className="v2-group">
            <button type="button" className="v2-row" role="switch" aria-checked={pushOn} onClick={togglePush}>
              <span className="v2-row__main">
                <span className="v2-row__title">{t('settings.pushSub')}</span>
                {pushOn && <span className="v2-row__sub">{t('push.enabled')}</span>}
              </span>
              <span className={`v2-switch${pushOn ? ' on' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </>
      )}

      {section === 'alerts' && (
        <div className="v2-group">
          <div className="v2-group__body">
            <p className="settings__help">{t('profile.prefHelp')}</p>
            <div className="v2-chips v2-chips--wrap">
              {(['all', 'nearby', 'off'] as NewCasePref[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`v2-chip v2-chip--light${profile.new_case_pref === p ? ' active' : ''}`}
                  aria-pressed={profile.new_case_pref === p}
                  onClick={() => void setPref(p)}
                >
                  {t(`profile.pref.${p}` as const)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {section === 'location' && (
        <div className="v2-group">
          <GroupRow title={t('profile.radius', { km: profile.notify_radius_km ?? 5 })} />
          <GroupRow onClick={() => void saveHome()} title={t('profile.setHome')} chevron={false} />
        </div>
      )}

      {section === 'language' && (
        <div className="v2-group" role="radiogroup" aria-label={t('profile.language')}>
          {ENABLED_LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={getLocale() === code}
              className="v2-row"
              onClick={() => chooseLocale(code)}
            >
              <span className="v2-row__main"><span className="v2-row__title">{LOCALE_NATIVE[code]}</span></span>
              {getLocale() === code && <span className="settings__check" aria-hidden="true"><IconCheck size={16} /></span>}
            </button>
          ))}
        </div>
      )}

      {section === 'blocked' && (
        <div className="v2-group">
          {blocked === null ? (
            <div className="v2-group__body"><div className="spinner" /></div>
          ) : blocked.length === 0 ? (
            <div className="v2-group__body settings__help" style={{ margin: 0 }}>{t('settings.noBlocked')}</div>
          ) : (
            blocked.map((b) => (
              <GroupRow key={b.id} title={b.display_name} chevron={false}>
                <button className="btn btn--secondary btn--small" onClick={() => void doUnblock(b.id)}>
                  {t('settings.unblock')}
                </button>
              </GroupRow>
            ))
          )}
        </div>
      )}

      {section === 'delete' && (
        <div className="v2-group">
          <div className="v2-group__body">
            <p className="settings__help">{t('settings.deleteConfirm')}</p>
            <div style={{ display: 'grid', gap: 10 }}>
              <button className="btn btn--danger" disabled={busy} onClick={() => void doDelete()}>
                {t('settings.deleteConfirmBtn')}
              </button>
              <button className="btn btn--secondary" disabled={busy} onClick={() => navigate('/settings')}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Settings → Password & security. Email/password accounts only: the current
 * password is re-verified by signing in again (with a captcha token — Auth
 * captcha is on), then updateUser({ password }). Because that sign-in makes
 * the session brand new, it also satisfies Supabase's "Secure password
 * change" (recent sign-in) when that option is on. Google-only accounts
 * have no Stray's Call password, so they get a note instead.
 */
function PasswordSection() {
  const { user } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const providers: string[] =
    (user?.app_metadata?.providers as string[] | undefined) ??
    (user?.app_metadata?.provider ? [user.app_metadata.provider as string] : []);
  const hasPassword = providers.includes('email') && !!user?.email;

  if (!hasPassword) {
    return (
      <div className="v2-group">
        <div className="v2-group__body settings__help" style={{ margin: 0 }}>{t('security.google')}</div>
      </div>
    );
  }

  const save = async () => {
    if (next.length < 6) return toast(t('auth.passwordTooShort'));
    if (next !== repeat) return toast(t('auth.passwordMismatch'));
    if (next === current) return toast(t('security.samePassword'));
    setBusy(true);
    try {
      // 1. Re-verify the current password.
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: user!.email!,
        password: current,
        options: await captchaOptions(),
      });
      if (authErr) {
        toast(authErr.message.toLowerCase().includes('invalid login') ? t('security.wrongCurrent') : authErr.message);
        return;
      }
      // 2. Set the new one.
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) {
        toast(error.code === 'same_password' ? t('security.samePassword') : error.message);
        return;
      }
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
      toast(t('security.done'));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="v2-group">
      <div className="v2-group__body settings__form">
        {done && <div className="banner banner--success" role="status">{t('security.done')}</div>}
        <PasswordField label={t('security.current')} value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField label={t('security.new')} value={next} onChange={setNext} autoComplete="new-password" />
        <PasswordField
          label={t('security.confirm')}
          value={repeat}
          onChange={setRepeat}
          autoComplete="new-password"
          onEnter={() => void save()}
        />
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || !current || !next || !repeat}
          onClick={() => void save()}
        >
          {busy ? t('common.loading') : t('security.save')}
        </button>
      </div>
    </div>
  );
}
