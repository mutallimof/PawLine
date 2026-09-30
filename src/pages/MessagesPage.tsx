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
import { ScreenHeader, StatusGroupBadge } from '../components/ui';
import { animalEmoji, EmptyPaw, VetTag } from '../components/Icons';
import type { CaseChatInboxEntry, InboxEntry } from '../lib/types';
import { t } from '../i18n';
import { timeAgo } from '../lib/time';

type ListEntry =
  | { kind: 'case'; activityAt: string; entry: CaseChatInboxEntry }
  | { kind: 'dm'; activityAt: string; entry: InboxEntry };

export default function MessagesPage() {
  const { user, isGuest } = useAuth();
  // A guest (anonymous session from browsing) has a `user` but no account and
  // no conversations, so every query below would return empty — show them the
  // sign-in prompt rather than an empty inbox.
  const isRegistered = !!user && !isGuest;
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user || isGuest) return;
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
  }, [user, isGuest]);

  // Live-refresh on any new message in either chat system.
  useEffect(() => {
    if (!user || isGuest) {
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
  }, [user, isGuest, load]);

  if (!isRegistered) {
    return (
      <div className="page">
        <ScreenHeader title={t('dm.title')} />
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
      <ScreenHeader title={t('dm.title')} />

      {loading && <div className="spinner" />}
      {!loading && entries.length === 0 && (
        <div className="empty-state">
          <EmptyPaw />
          {t('dm.empty')}
        </div>
      )}

      {entries.length > 0 && (
      <div className="v2-group msg-list">
      {entries.map((item) =>
        item.kind === 'case' ? (
          <Link
            key={`case-${item.entry.caseId}`}
            to={`/case/${item.entry.caseId}/chat`}
            className={`v2-row v2-row--sub msg-row${item.entry.unread ? ' msg-row--unread' : ''}`}
          >
            <span className="msg-row__tile msg-row__tile--case" aria-hidden="true">
              {animalEmoji(item.entry.animal)}
            </span>
            <span className="v2-row__main">
              <span className="v2-row__title">
                {t('dm.caseChatTag')} · {item.entry.addressHint || t(`animal.${item.entry.animal}` as const)}
              </span>
              <span className="v2-row__sub msg-row__preview">
                {item.entry.lastMessage &&
                  `${item.entry.lastMessage.sender_id === user.id ? `${t('common.you')}: ` : item.entry.lastMessage.sender ? `${item.entry.lastMessage.sender.display_name}: ` : item.entry.lastMessage.sender_id === null ? `${t('caseChat.deletedAccount')}: ` : ''}${item.entry.lastMessage.body}`}
              </span>
            </span>
            <span className="msg-row__side">
              {item.entry.lastMessage && (
                <span className="msg-row__time">{timeAgo(item.entry.lastMessage.created_at)}</span>
              )}
              {item.entry.unread ? (
                <span className="msg-row__count">{Math.min(item.entry.unreadCount, 99)}</span>
              ) : (
                <StatusGroupBadge status={item.entry.status} />
              )}
            </span>
          </Link>
        ) : (
          <Link
            key={`dm-${item.entry.conversationId}`}
            to={`/messages/${item.entry.conversationId}`}
            className={`v2-row v2-row--sub msg-row${item.entry.unread ? ' msg-row--unread' : ''}`}
          >
            <span className="msg-row__tile" aria-hidden="true">
              {item.entry.other.display_name.trim().charAt(0).toUpperCase() || '?'}
            </span>
            <span className="v2-row__main">
              <span className="v2-row__title">
                {t('dm.directTag')} · {item.entry.other.display_name}
                {item.entry.other.role === 'vet' && <VetTag />}
              </span>
              <span className="v2-row__sub msg-row__preview">
                {item.entry.lastMessage
                  ? `${item.entry.lastMessage.sender_id === user.id ? `${t('common.you')}: ` : ''}${item.entry.lastMessage.body}`
                  : '—'}
              </span>
            </span>
            <span className="msg-row__side">
              {item.entry.lastMessage && (
                <span className="msg-row__time">{timeAgo(item.entry.lastMessage.created_at)}</span>
              )}
              {item.entry.unread && <span className="msg-row__dot" aria-hidden="true" />}
            </span>
          </Link>
        )
      )}
      </div>
      )}
    </div>
  );
}
