/**
 * Own profile (Figma v2 "Profile Page" 95:241): identity, three stats we
 * actually have, my latest cases and a menu. Language and notification
 * preferences live in Settings; the platform-wide numbers live on About.
 * RescueHistoryPage (/profile/history) is the full list behind "View all".
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { resolvePhotoUrls, withCaseColumns } from '../lib/api';
import { CaseCard, GroupRow, LanguageSwitcher, ScreenHeader } from '../components/ui';
import { VetVisibilityNotice } from './vetAndUserPages';
import { t } from '../i18n';
import { formatDate } from '../lib/time';
import {
  EmptyPaw,
  IconClinic,
  IconHistory,
  IconLogOut,
  IconSettings,
  IconShield,
  IconStethoscope,
  VetTag,
} from '../components/Icons';
import { isCaseLive, type CaseWithDetails } from '../lib/types';

/**
 * Cases I reported, rescued or received — the query Profile always used,
 * now without its 20-row limit so the stats and history are exact. Photo
 * paths come back unsigned (the bucket is private, 018), so they're signed
 * the same way the Home feed does it before the cards render.
 */
function useMyCases(userId: string | null) {
  const [cases, setCases] = useState<CaseWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!userId) return;
    void withCaseColumns((cols) =>
      supabase
        .from('cases')
        .select(`${cols}, photos:case_photos (*)`)
        .or(`reporter_id.eq.${userId},rescuer_id.eq.${userId},vet_id.eq.${userId}`)
        .order('created_at', { ascending: false })
    ).then(async ({ data }) => {
        const list = (data ?? []) as unknown as CaseWithDetails[];
        await resolvePhotoUrls(list); // never throws; failures become "no photo"
        setCases(list);
        setLoading(false);
      });
  }, [userId]);
  return { cases, loading };
}

/** Help & legal links — Settings has them for accounts; guests get them here. */
const LEGAL_LINKS = [
  ['/about', 'legal.about'],
  ['/faq', 'legal.faq'],
  ['/safety', 'legal.safety'],
  ['/privacy', 'legal.privacy'],
  ['/terms', 'legal.terms'],
  ['/guidelines', 'legal.conduct'],
  ['/contact', 'legal.contact'],
] as const;

export default function ProfilePage() {
  const { user, isGuest, profile, profileError, retryProfile, signOut } = useAuth();
  const account = !!user && !isGuest;
  const { cases: myCases } = useMyCases(account ? user.id : null);
  const navigate = useNavigate();

  // Auth gate — a real account, not merely a session. `profile` can lag
  // behind the session for a moment (or briefly fail and retry); treating
  // that as "signed out" was part of bug #1, so this still never gates on
  // `profile`. But a GUEST (anonymous session, minted just by browsing the
  // feed) also has a `user` while having no account at all, and belongs here
  // rather than in the profile-loading path below — otherwise they fall
  // through to a spinner, then a profile-load error, for a profile they were
  // never supposed to have.
  if (!account) {
    return (
      <div className="page">
        <ScreenHeader title={t('nav.profile')} />
        <div className="empty-state">
          <EmptyPaw />
          {t('dm.signIn')}
          <div style={{ marginTop: 16 }}>
            <Link to="/auth" className="btn btn--primary">{t('auth.signIn')}</Link>
          </div>
        </div>
        <div className="v2-label">{t('profile.language')}</div>
        <div className="v2-group">
          <div className="v2-group__body"><LanguageSwitcher /></div>
        </div>
        <div className="v2-label">{t('settings.legal')}</div>
        <div className="v2-group">
          {LEGAL_LINKS.map(([to, key]) => (
            <GroupRow key={to} to={to} title={t(key)} />
          ))}
        </div>
      </div>
    );
  }

  if (!profile) {
    if (profileError) {
      return (
        <div className="page">
          <ScreenHeader title={t('nav.profile')} />
          <div className="empty-state">
            <EmptyPaw />
            {t('profile.loadFailed')}
            {/* TEMP (debugging the "every fresh login" profile hang): raw
                cause on-screen so a tester can report it without opening
                devtools. Remove once the root cause is fixed. */}
            <p className="page-subtitle" style={{ marginTop: 4, opacity: 0.6, fontSize: 11 }}>
              couldn't load profile: {profileError}
            </p>
            <div style={{ marginTop: 16 }}>
              <button className="btn btn--secondary" onClick={retryProfile}>
                {t('common.retry')}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="page">
        <ScreenHeader title={t('nav.profile')} />
        <div className="spinner" />
      </div>
    );
  }

  const isVet = profile.role === 'vet';
  const activeRescues = myCases.filter(
    (c) => c.rescuer_id === profile.id && c.status !== 'open' && isCaseLive(c.status)
  ).length;
  const reported = myCases.filter((c) => c.reporter_id === profile.id).length;

  return (
    <div className="page profile">
      <ScreenHeader title={t('nav.profile')} />

      <div className="profile__id">
        <div className="profile__avatar" aria-hidden="true">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" />
          ) : (
            profile.display_name.trim().charAt(0).toUpperCase() || '?'
          )}
        </div>
        <div className="profile__id-text">
          <h2 className="profile__name">
            {profile.display_name}
            {isVet && <VetTag />}
          </h2>
          <div className="profile__role">{isVet ? t('auth.roleVet') : t('profile.roleRescuer')}</div>
          <div className="profile__since">
            {t('profile.memberSince', { date: formatDate(profile.created_at) })}
          </div>
        </div>
      </div>

      <div className="v2-stats profile__stats">
        <div className="v2-stat">
          <div className="v2-stat__value profile__stat--helped">{profile.cases_helped}</div>
          <div className="v2-stat__label">{t('profile.casesHelped')}</div>
        </div>
        <div className="v2-stat">
          <div className="v2-stat__value profile__stat--active">{activeRescues}</div>
          <div className="v2-stat__label">{t('profile.activeRescues')}</div>
        </div>
        <div className="v2-stat">
          <div className="v2-stat__value profile__stat--reported">{reported}</div>
          <div className="v2-stat__label">{t('profile.casesReported')}</div>
        </div>
      </div>

      {isVet && <VetVisibilityNotice />}

      {myCases.length > 0 && (
        <>
          <div className="profile__section-head">
            <h2 className="v2-h2">{t('profile.myCases')}</h2>
            <Link to="/profile/history" className="profile__view-all">{t('profile.viewAll')}</Link>
          </div>
          {myCases.slice(0, 2).map((c) => (
            <CaseCard key={c.id} caseData={c} userLocation={null} />
          ))}
        </>
      )}

      <div className="v2-group profile__menu">
        <GroupRow
          to="/profile/history"
          icon={<IconHistory />}
          title={t('profile.history')}
          sub={t('profile.historySub')}
        />
        {isVet && (
          <>
            <GroupRow to="/vet-dashboard" icon={<IconStethoscope />} iconTone="brand" title={t('profile.vetDashboard')} />
            <GroupRow to="/vet-setup" icon={<IconClinic />} iconTone="brand" title={t('vetSetup.title')} />
          </>
        )}
        {profile.is_admin && (
          <GroupRow to="/admin" icon={<IconShield />} title={t('admin.title')} />
        )}
        <GroupRow
          to="/settings"
          icon={<IconSettings />}
          title={t('settings.title')}
          sub={t('profile.settingsSub')}
        />
        <GroupRow
          onClick={() => void signOut().then(() => navigate('/'))}
          icon={<IconLogOut />}
          iconTone="danger"
          title={t('auth.signOut')}
          danger
        />
      </div>
    </div>
  );
}

/** /profile/history — every case I reported, rescued or received. */
export function RescueHistoryPage() {
  const { user, isGuest } = useAuth();
  const account = !!user && !isGuest;
  const { cases, loading } = useMyCases(account ? user.id : null);

  return (
    <div className="page">
      <ScreenHeader title={t('profile.history')} fallback="/profile" />
      {!account ? (
        <div className="empty-state">
          <EmptyPaw />
          {t('dm.signIn')}
          <div style={{ marginTop: 16 }}>
            <Link to="/auth" className="btn btn--primary">{t('auth.signIn')}</Link>
          </div>
        </div>
      ) : loading ? (
        <div className="spinner" />
      ) : cases.length === 0 ? (
        <div className="empty-state">
          <EmptyPaw />
          {t('profile.historyEmpty')}
        </div>
      ) : (
        cases.map((c) => <CaseCard key={c.id} caseData={c} userLocation={null} />)
      )}
    </div>
  );
}
