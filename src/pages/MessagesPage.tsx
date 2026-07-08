/**
 * Messages inbox (CHAT SYSTEM 1) — Instagram-style DMs, completely separate
 * from the rescue pipeline. Any registered user can message any user or vet.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchInbox, getOrCreateDm, searchProfiles } from '../lib/api';
import { supabase } from '../lib/supabase';
import { Avatar, ProfileRow, useToast } from '../components/ui';
import type { InboxEntry, Profile } from '../lib/types';
import { t } from '../i18n';
import { timeAgo } from '../lib/time';

export default function MessagesPage() {
  const { user } = useAuth();
  const [inbox, setInbox] = useState<InboxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const navigate = useNavigate();
  const toast = useToast();

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setInbox(await fetchInbox(user.id));
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Live-refresh the inbox when any message in my conversations changes.
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
    const channel = supabase
      .channel(`inbox-${user.id}-${Math.random().toString(36).slice(2, 9)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => void load())
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [user, load]);

  // Debounced people search.
  useEffect(() => {
    if (!user || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      searchProfiles(query.trim(), user.id).then(setResults).catch(() => {});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, user]);

  const openDm = async (otherId: string) => {
    try {
      const convId = await getOrCreateDm(otherId);
      navigate(`/messages/${convId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  };

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

      <label className="field" style={{ marginTop: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('dm.searchPeople')}
        />
      </label>

      {/* Search results — tap to start (or resume) a conversation */}
      {results.map((p) => (
        <ProfileRow key={p.id} profile={p} onClick={() => void openDm(p.id)} />
      ))}

      {query.trim().length < 2 && (
        <>
          {loading && <div className="spinner" />}
          {!loading && inbox.length === 0 && (
            <div className="empty-state">
              <div className="empty-state__icon">💬</div>
              {t('dm.empty')}
            </div>
          )}
          {inbox.map((entry) => (
            <Link
              key={entry.conversationId}
              to={`/messages/${entry.conversationId}`}
              className={`list-row${entry.unread ? ' list-row--unread' : ''}`}
            >
              <Avatar name={entry.other.display_name} url={entry.other.avatar_url} />
              <div className="list-row__main">
                <div className="list-row__title">
                  {entry.other.display_name}
                  {entry.other.role === 'vet' ? ' 🏥' : ''}
                </div>
                <div className="list-row__sub">
                  {entry.lastMessage
                    ? `${entry.lastMessage.sender_id === user.id ? `${t('common.you')}: ` : ''}${entry.lastMessage.body}`
                    : '—'}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                {entry.lastMessage && (
                  <span className="list-row__sub">{timeAgo(entry.lastMessage.created_at)}</span>
                )}
                {entry.unread && <span className="unread-dot" />}
              </div>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}
