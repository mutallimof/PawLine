/** Alerts — the notification inbox. Tapping deep-links to the case or DM. */
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../hooks/useRealtime';
import { markAllNotificationsRead, markNotificationRead } from '../lib/api';
import type { AppNotification, NotificationType } from '../lib/types';
import { t } from '../i18n';
import { timeAgo } from '../lib/time';
import { EmptyPaw, IconStethoscope } from '../components/Icons';
import { ScreenHeader } from '../components/ui';

const TYPE_EMOJI: Record<NotificationType, ReactNode> = {
  case_new_nearby: '🆘',
  case_accepted: '🐾',
  case_dropped: '⚠️',
  vet_requested: <IconStethoscope size={19} />,
  vet_confirmed: '✅',
  vet_declined: '↩️',
  case_en_route: '🚗',
  case_resolved: '💚',
  case_update: '📋',
  case_message: '💬',
  direct_message: '✉️',
};

export default function NotificationsPage() {
  const { user, isGuest } = useAuth();
  // A guest has a `user` but no account and therefore no notifications; pass
  // no id so the hook doesn't query, and show the sign-in prompt below.
  const isRegistered = !!user && !isGuest;
  const { notifications, unread, loading, reload } = useNotifications(
    isRegistered ? user.id : undefined
  );
  const navigate = useNavigate();

  const open = async (n: AppNotification) => {
    if (!n.read) void markNotificationRead(n.id).then(reload);
    if (n.case_id) navigate(`/case/${n.case_id}`);
    else if (n.conversation_id) navigate(`/messages/${n.conversation_id}`);
  };

  if (!isRegistered) {
    return (
      <div className="page">
        <ScreenHeader title={t('alerts.title')} />
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

  return (
    <div className="page">
      <ScreenHeader title={t('alerts.title')} />
      {unread > 0 && (
        <div className="alerts__tools">
          <button className="v2-link" onClick={() => void markAllNotificationsRead(user.id).then(reload)}>
            {t('alerts.markAll')}
          </button>
        </div>
      )}

      {loading && <div className="spinner" />}
      {!loading && notifications.length === 0 && (
        <div className="empty-state">
          <EmptyPaw />
          {t('alerts.empty')}
        </div>
      )}

      {notifications.length > 0 && (
        <div className="v2-group">
          {notifications.map((n) => (
            <button
              key={n.id}
              className={`v2-row v2-row--sub alert-row${n.read ? '' : ' alert-row--unread'}`}
              onClick={() => void open(n)}
            >
              <span className="v2-row__icon alert-row__icon" aria-hidden="true">{TYPE_EMOJI[n.type]}</span>
              <span className="v2-row__main">
                <span className="v2-row__title">{n.title}</span>
                {n.body && <span className="v2-row__sub alert-row__body">{n.body}</span>}
              </span>
              <span className="msg-row__side">
                <span className="msg-row__time">{timeAgo(n.created_at)}</span>
                {!n.read && <span className="msg-row__dot" />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
