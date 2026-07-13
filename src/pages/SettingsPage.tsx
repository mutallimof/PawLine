/**
 * Settings — one place for everything account-related, per the pre-launch
 * consolidation brief: notification preferences, language, blocked users,
 * data export, account deletion, and links to every legal/trust page.
 *
 * Notification radius/home-area controls stay on the Profile page (they sit
 * naturally with the map); Settings links there rather than duplicating.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LanguageSwitcher, useToast } from '../components/ui';
import { IconBack } from '../components/Icons';
import {
  deleteMyAccount,
  exportMyData,
  fetchBlockedIds,
  fetchProfile,
  unblockUser,
} from '../lib/api';
import { t } from '../i18n';
import { InkScene } from '../components/Ink';
import type { Profile } from '../lib/types';

export default function SettingsPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [blocked, setBlocked] = useState<Profile[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const ids = await fetchBlockedIds(user.id);
        const profiles = await Promise.all(ids.map((id) => fetchProfile(id)));
        setBlocked(profiles.filter((p): p is Profile => !!p));
      } catch {
        /* non-fatal */
      }
    })();
  }, [user]);

  if (!user || !profile) {
    return (
      <div className="page">
        <button className="back-btn" onClick={() => navigate(-1)}>
          <IconBack size={18} /> {t('common.back')}
        </button>
        <h1 className="page-title">{t('settings.title')}</h1>
        <div className="empty-state">
          <InkScene kind="lost" />
          {t('dm.signIn')}
          <Link to="/auth" className="btn btn--primary" style={{ marginTop: 14 }}>
            {t('auth.signIn')}
          </Link>
        </div>
      </div>
    );
  }

  const doExport = async () => {
    setBusy(true);
    try {
      const data = await exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pawline-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t('settings.exportDone'));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const doUnblock = async (id: string) => {
    try {
      await unblockUser(user.id, id);
      setBlocked((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  };

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

  return (
    <div className="page">
      <button className="back-btn" onClick={() => navigate(-1)}>
        <IconBack size={18} /> {t('common.back')}
      </button>
      <h1 className="page-title">{t('settings.title')}</h1>

      {/* Language */}
      <div className="section-label">{t('profile.language')}</div>
      <div className="card" style={{ padding: 14, marginBottom: 18 }}>
        <LanguageSwitcher />
      </div>

      {/* Notifications live on Profile (with the map/home controls) */}
      <div className="section-label">{t('settings.notifications')}</div>
      <Link to="/profile" className="list-row" style={{ marginBottom: 18 }}>
        <div className="list-row__main">
          <div className="list-row__title">🔔 {t('settings.notifManage')}</div>
          <div className="list-row__sub">{t('settings.notifManageSub')}</div>
        </div>
        <span aria-hidden="true">›</span>
      </Link>

      {/* Blocked users */}
      <div className="section-label">{t('settings.blocked')}</div>
      <div className="card" style={{ padding: 4, marginBottom: 18 }}>
        {blocked.length === 0 ? (
          <p className="page-subtitle" style={{ padding: 12, margin: 0 }}>
            {t('settings.noBlocked')}
          </p>
        ) : (
          blocked.map((b) => (
            <div key={b.id} className="list-row" style={{ boxShadow: 'none' }}>
              <div className="list-row__main">
                <div className="list-row__title">{b.display_name}</div>
              </div>
              <button className="btn btn--ghost btn--small" onClick={() => void doUnblock(b.id)}>
                {t('settings.unblock')}
              </button>
            </div>
          ))
        )}
      </div>

      {/* Your data */}
      <div className="section-label">{t('settings.account')}</div>
      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <button
          className="btn btn--secondary"
          disabled={busy}
          onClick={() => void doExport()}
          style={{ width: '100%' }}
        >
          ⬇️ {t('settings.exportData')}
        </button>
        <p className="page-subtitle" style={{ marginTop: 8, marginBottom: 0 }}>
          {t('settings.exportSub')}
        </p>
      </div>

      {/* Danger zone */}
      <div className="card danger-zone" style={{ padding: 14, marginBottom: 18 }}>
        {!confirmDelete ? (
          <button
            className="btn btn--danger-ghost"
            onClick={() => setConfirmDelete(true)}
            style={{ width: '100%' }}
          >
            {t('settings.deleteAccount')}
          </button>
        ) : (
          <>
            <p style={{ fontSize: 14, fontWeight: 700, marginTop: 0 }}>
              {t('settings.deleteConfirm')}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn--danger"
                disabled={busy}
                onClick={() => void doDelete()}
                style={{ flex: 1 }}
              >
                {t('settings.deleteConfirmBtn')}
              </button>
              <button
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => setConfirmDelete(false)}
                style={{ flex: 1 }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Legal & trust */}
      <div className="section-label">{t('settings.legal')}</div>
      <div className="card" style={{ padding: 4 }}>
        {([
          ['/about', 'legal.about'],
          ['/faq', 'legal.faq'],
          ['/safety', 'legal.safety'],
          ['/guidelines', 'legal.conduct'],
          ['/privacy', 'legal.privacy'],
          ['/terms', 'legal.terms'],
          ['/contact', 'legal.contact'],
        ] as const).map(([to, key]) => (
          <Link key={to} to={to} className="list-row" style={{ boxShadow: 'none' }}>
            <div className="list-row__main">
              <div className="list-row__title">{t(key)}</div>
            </div>
            <span aria-hidden="true">›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
