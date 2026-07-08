/** One direct-message thread. Realtime delivery; marks itself read. */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDmThread } from '../hooks/useRealtime';
import {
  fetchDmPartner,
  markConversationRead,
  sendMessage,
} from '../lib/api';
import { Avatar, useToast } from '../components/ui';
import { IconBack, IconSend } from '../components/Icons';
import type { InboxEntry } from '../lib/types';
import { t } from '../i18n';
import { clockTime } from '../lib/time';

export default function DmThreadPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { messages, loading } = useDmThread(id);
  const [partner, setPartner] = useState<InboxEntry['other'] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (id && user) fetchDmPartner(id, user.id).then(setPartner).catch(() => {});
  }, [id, user]);

  // Mark the thread read whenever new messages land while it's open.
  useEffect(() => {
    if (id && user) void markConversationRead(id).catch(() => {});
  }, [id, user, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !user || !id) return;
    setSending(true);
    try {
      await sendMessage(id, user.id, body);
      setDraft('');
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="chat-page">
      <header className="chat-header">
        <button onClick={() => navigate('/messages')} aria-label={t('common.back')}>
          <IconBack />
        </button>
        {partner && (
          <>
            <Avatar name={partner.display_name} url={partner.avatar_url} small />
            <div style={{ fontWeight: 800, fontSize: 15 }}>
              {partner.display_name}
              {partner.role === 'vet' ? ' 🏥' : ''}
            </div>
          </>
        )}
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {loading && <div className="spinner" />}
        {messages.map((m) => (
          <div key={m.id} className={`bubble${m.sender_id === user?.id ? ' bubble--mine' : ''}`}>
            {m.body}
            <span className="bubble__time">{clockTime(m.created_at)}</span>
          </div>
        ))}
      </div>

      <div className="chat-composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send()}
          placeholder={t('dm.placeholder')}
          maxLength={4000}
        />
        <button onClick={() => void send()} disabled={sending || !draft.trim()} aria-label={t('common.send')}>
          <IconSend size={18} />
        </button>
      </div>
    </div>
  );
}
