/**
 * Own profile: identity, tier/XP progress, my cases, notification
 * preferences, and (for vets) the clinic dashboard entry point.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { updateProfile } from '../lib/api';
import { disablePush, enablePush, getPushSubscription, pushSupported } from '../lib/push';
import { supabase } from '../lib/supabase';
import { Avatar, CaseCard, LanguageSwitcher, TierBadge, useToast } from '../components/ui';
import { tierForXp, tierName } from '../lib/xp';
import { getCurrentPosition } from '../lib/geo';
import { t } from '../i18n';
import { InkScene } from '../components/Ink';
import type { CaseWithDetails, NewCasePref } from '../lib/types';

export default function ProfilePage() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const [myCases, setMyCases] = useState<CaseWithDetails[]>([]);
  const [pushOn, setPushOn] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    getPushSubscription().then((sub) => setPushOn(!!sub)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    // Cases I reported, rescued or received.
    supabase
      .from('cases')
      .select('*, photos:case_photos (*)')
      .or(`reporter_id.eq.${user.id},rescuer_id.eq.${user.id},vet_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => setMyCases((data ?? []) as unknown as CaseWithDetails[]));
  }, [user]);

  // Auth gate — on `user` ONLY. `profile` can lag behind the session for a
  // moment (or briefly fail and retry); treating that as "signed out" was
  // part of bug #1. A signed-in user with a pending profile sees a spinner,
  // never the sign-in prompt.
  if (!user) {
    return (
      <div className="page">
        <h1 className="page-title">{t('nav.profile')}</h1>
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="section-label" style={{ marginTop: 0 }}>{t('profile.language')}</div>
          <LanguageSwitcher />
        </div>
        <div className="empty-state">
          <InkScene kind="calm" />
          {t('dm.signIn')}
          <div style={{ marginTop: 16 }}>
            <Link to="/auth" className="btn btn--primary">{t('auth.signIn')}</Link>
          </div>
        </div>
        <Link
          to="/privacy"
          style={{ display: 'block', textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--ink-soft)' }}
        >
          {t('privacy.link')}
        </Link>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="page">
        <h1 className="page-title">{t('nav.profile')}</h1>
        <div className="spinner" />
      </div>
    );
  }

  const { tier, next, progress, xpToNext } = tierForXp(profile.xp);

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

  return (
    <div className="page">
      {/* Identity + tier */}
      <div className="card" style={{ padding: 18, textAlign: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
          <Avatar name={profile.display_name} url={profile.avatar_url} />
        </div>
        <h1 className="page-title" style={{ fontSize: 24 }}>
          {profile.display_name}
          {profile.role === 'vet' ? ' 🏥' : ''}
        </h1>
        <p className="page-subtitle">
          {t('profile.memberSince', {
            date: new Date(profile.created_at).toLocaleDateString(),
          })}
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
          <TierBadge xp={profile.xp} />
          <span className="tier-badge" style={{ background: 'var(--ink-soft)' }}>
            {t('profile.xp', { xp: profile.xp })}
          </span>
        </div>
        <div className="progress-track">
          <div className="progress-track__fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="page-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
          {next
            ? t('profile.toNext', { xp: xpToNext, tier: tierName(next) })
            : t('profile.maxTier')}
          {' · '}
          {t('profile.casesHelped')}: {profile.cases_helped}
        </p>
        {/* screen-reader label for the progress bar's tier context */}
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
          {t('profile.level')}: {tierName(tier)}
        </span>
      </div>

      {/* Vet entry points */}
      {profile.role === 'vet' && (
        <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
          <Link to="/vet-dashboard" className="btn btn--primary">🏥 {t('profile.vetDashboard')}</Link>
          <Link to="/vet-setup" className="btn btn--secondary">{t('vetSetup.title')}</Link>
        </div>
      )}

      {/* Language */}
      <div className="section-label">{t('profile.language')}</div>
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <LanguageSwitcher />
      </div>

      {/* Notification preferences */}
      <div className="section-label">{t('profile.settings')}</div>
      <div className="card" style={{ padding: 14, marginBottom: 14 }}>
        <p className="page-subtitle">{t('profile.prefHelp')}</p>
        <div className="segmented">
          {(['all', 'nearby', 'off'] as NewCasePref[]).map((p) => (
            <button
              key={p}
              className={`segmented__option${profile.new_case_pref === p ? ' active' : ''}`}
              onClick={() => void setPref(p)}
            >
              {t(`profile.pref.${p}` as const)}
            </button>
          ))}
        </div>
        {profile.new_case_pref === 'nearby' && (
          <div style={{ marginTop: 12 }}>
            <p className="page-subtitle">
              {t('profile.radius', { km: profile.notify_radius_km ?? 5 })}
            </p>
            <button className="btn btn--ghost btn--small" onClick={() => void saveHome()}>
              📍 {t('profile.setHome')}
            </button>
          </div>
        )}

        {/* Web Push: alerts even when the app is closed. */}
        <div style={{ marginTop: 14 }}>
          {pushOn && <p className="page-subtitle">{t('push.enabled')}</p>}
          <button
            className={`btn ${pushOn ? 'btn--ghost' : 'btn--secondary'} btn--small`}
            onClick={() => {
              if (pushOn) {
                void disablePush().then(() => setPushOn(false));
              } else if (!pushSupported()) {
                toast(t('push.unsupported'));
              } else {
                void enablePush(profile.id)
                  .then(() => setPushOn(true))
                  .catch((e) =>
                    toast(e instanceof Error && e.message === 'push-denied'
                      ? t('push.denied')
                      : t('push.unsupported'))
                  );
              }
            }}
          >
            🔔 {pushOn ? t('push.disable') : t('push.enable')}
          </button>
        </div>
      </div>

      {/* My cases */}
      {myCases.length > 0 && (
        <>
          <div className="section-label">{t('profile.myCases')}</div>
          {myCases.map((c) => (
            <CaseCard key={c.id} caseData={c} userLocation={null} />
          ))}
        </>
      )}

      <Link to="/settings" className="btn btn--secondary" style={{ marginTop: 8 }}>
        ⚙️ {t('settings.title')}
      </Link>

      {profile.is_admin && (
        <Link to="/admin" className="btn btn--secondary" style={{ marginTop: 8 }}>
          🛠 {t('admin.title')}
        </Link>
      )}

      <button
        className="btn btn--danger"
        style={{ marginTop: 8 }}
        onClick={() => void signOut().then(() => navigate('/'))}
      >
        {t('auth.signOut')}
      </button>

      <footer className="app-footer">
        <Link to="/about">{t('legal.about')}</Link>
        <Link to="/faq">{t('legal.faq')}</Link>
        <Link to="/safety">{t('legal.safety')}</Link>
        <Link to="/guidelines">{t('legal.conduct')}</Link>
        <Link to="/privacy">{t('legal.privacy')}</Link>
        <Link to="/terms">{t('legal.terms')}</Link>
        <Link to="/contact">{t('legal.contact')}</Link>
      </footer>
    </div>
  );
}
