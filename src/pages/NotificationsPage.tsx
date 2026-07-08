/** Alerts — the notification inbox. Tapping deep-links to the case or DM. */
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../hooks/useRealtime';
import { markAllNotificationsRead, markNotificationRead } from '../lib/api';
import type { AppNotification, NotificationType } from '../lib/types';
import { t } from '../i18n';
import { timeAgo } from '../lib/time';

const TYPE_EMOJI: Record<NotificationType, string> = {
  case_new_nearby: '🆘',
  case_accepted: '🐾',
  case_dropped: '⚠️',
  vet_requested: '🏥',
  vet_confirmed: '✅',
  vet_declined: '↩️',
  case_en_route: '🚗',
  case_resolved: '💚',
  case_update: '📋',
  case_message: '💬',
  direct_message: '✉️',
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const { notifications, unread, loading, reload } = useNotifications(user?.id);
  const navigate = useNavigate();

  const open = async (n: AppNotification) => {
    if (!n.read) void markNotificationRead(n.id).then(reload);
    if (n.case_id) navigate(`/case/${n.case_id}`);
    else if (n.conversation_id) navigate(`/messages/${n.conversation_id}`);
  };

  if (!user) {
    return (
      <div className="page">
        <h1 className="page-title">{t('alerts.title')}</h1>
        <div className="empty-state">
          <div className="empty-state__icon">🔔</div>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 className="page-title">{t('alerts.title')}</h1>
        {unread > 0 && (
          <button
            className="btn btn--ghost btn--small"
            onClick={() => void markAllNotificationsRead(user.id).then(reload)}
          >
            {t('alerts.markAll')}
          </button>
        )}
      </div>

      {loading && <div className="spinner" />}
      {!loading && notifications.length === 0 && (
        <div className="empty-state">
          <div className="empty-state__icon">🔔</div>
          {t('alerts.empty')}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        {notifications.map((n) => (
          <button
            key={n.id}
            className={`list-row${n.read ? '' : ' list-row--unread'}`}
            onClick={() => void open(n)}
          >
            <div className="avatar" aria-hidden>{TYPE_EMOJI[n.type]}</div>
            <div className="list-row__main">
              <div className="list-row__title">{n.title}</div>
              {n.body && <div className="list-row__sub">{n.body}</div>}
              <div className="list-row__sub">{timeAgo(n.created_at)}</div>
            </div>
            {!n.read && <span className="unread-dot" />}
          </button>
        ))}
      </div>
    </div>
  );
}
