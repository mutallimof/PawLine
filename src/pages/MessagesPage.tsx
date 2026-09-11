/**
 * Messages — one unified list (Group D), most recent activity first:
 *  - Case chats (CHAT SYSTEM 2) the user is attached to or has posted in.
 *  - Direct-message threads (CHAT SYSTEM 1) — since get_or_create_dm() now
 *    requires a shared active case (migration 012), every DM here is case-
 *    related coordination too, same as before, just 1:1 instead of the
 *    group chat.
 * There is no standalone DM inbox / people-search here anymore — starting a
 * new DM goes through a profile's "Message" button, which opens or resumes
 * the thread directly.
 *
 * Each row is tagged with what it is so the two kinds aren't ambiguous.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchCaseChatInbox, fetchInbox } from '../lib/api';
import { supabase } from '../lib/supabase';
import { Avatar, StatusBadge } from '../components/ui';
import { animalEmoji } from '../components/Icons';
import type { CaseChatInboxEntry, InboxEntry } from '../lib/types';
import { t } from '../i18n';
import { timeAgo } from '../lib/time';

type ListEntry =
  | { kind: 'case'; activityAt: string; entry: CaseChatInboxEntry }
  | { kind: 'dm'; activityAt: string; entry: InboxEntry };

export default function MessagesPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    const [cases, dms] = await Promise.all([
      fetchCaseChatInbox(user.id).catch(() => [] as CaseChatInboxEntry[]),
      fetchInbox(user.id).catch(() => [] as InboxEntry[]),
    ]);
    const merged: ListEntry[] = [
      ...cases.map((c): ListEntry => ({ kind: 'case', activityAt: c.lastMessage!.created_at, entry: c })),
      ...dms.map((d): ListEntry => ({ kind: 'dm', activityAt: d.lastMessage?.created_at ?? '', entry: d })),
    ];
    merged.sort((a, b) => b.activityAt.localeCompare(a.activityAt));
    setEntries(merged);
    setLoading(false);
  }, [user]);

  // Live-refresh on any new message in either chat system.
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
    const channel = supabase
      .channel(`messages-tab-${user.id}-${Math.random().toString(36).slice(2, 9)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => void load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'case_messages' }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [user, load]);

  if (!user) {
    return (
      <div className="page">
        <h1 className="page-title">{t('dm.title')}</h1>
        <div className="empty-state">
          <div className="empty-state__icon">💬</div>
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
      <h1 className="page-title">{t('dm.title')}</h1>

      {loading && <div className="spinner" />}
      {!loading && entries.length === 0 && (
        <div className="empty-state">
          <div className="empty-state__icon">💬</div>
          {t('dm.empty')}
        </div>
      )}

      {entries.map((item) =>
        item.kind === 'case' ? (
          <Link
            key={`case-${item.entry.caseId}`}
            to={`/case/${item.entry.caseId}/chat`}
            className={`list-row${item.entry.unread ? ' list-row--unread' : ''}`}
          >
            <div
              className="avatar"
              style={{ background: 'rgba(232,93,74,.14)', color: 'var(--coral-deep)', fontSize: 18 }}
            >
              {animalEmoji(item.entry.animal)}
            </div>
            <div className="list-row__main">
              <div className="list-row__title">
                {t('dm.caseChatTag')} · {item.entry.addressHint || t(`animal.${item.entry.animal}` as const)}
              </div>
              <div className="list-row__sub">
                {item.entry.lastMessage &&
                  `${item.entry.lastMessage.sender_id === user.id ? `${t('common.you')}: ` : item.entry.lastMessage.sender ? `${item.entry.lastMessage.sender.display_name}: ` : ''}${item.entry.lastMessage.body}`}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <StatusBadge status={item.entry.status} />
              {item.entry.lastMessage && (
                <span className="list-row__sub">{timeAgo(item.entry.lastMessage.created_at)}</span>
              )}
              {item.entry.unread && (
                <span className="nav-badge" style={{ position: 'static' }}>
                  {Math.min(item.entry.unreadCount, 99)}
                </span>
              )}
            </div>
          </Link>
        ) : (
          <Link
            key={`dm-${item.entry.conversationId}`}
            to={`/messages/${item.entry.conversationId}`}
            className={`list-row${item.entry.unread ? ' list-row--unread' : ''}`}
          >
            <Avatar name={item.entry.other.display_name} url={item.entry.other.avatar_url} />
            <div className="list-row__main">
              <div className="list-row__title">
                {t('dm.directTag')} · {item.entry.other.display_name}
                {item.entry.other.role === 'vet' ? ' 🏥' : ''}
              </div>
              <div className="list-row__sub">
                {item.entry.lastMessage
                  ? `${item.entry.lastMessage.sender_id === user.id ? `${t('common.you')}: ` : ''}${item.entry.lastMessage.body}`
                  : '—'}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              {item.entry.lastMessage && (
                <span className="list-row__sub">{timeAgo(item.entry.lastMessage.created_at)}</span>
              )}
              {item.entry.unread && <span className="unread-dot" />}
            </div>
          </Link>
        )
      )}
    </div>
  );
}
