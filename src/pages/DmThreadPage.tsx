/**
 * One direct-message thread. Realtime delivery; marks itself read.
 *
 * No report button here (B2): content_reports.target_type only allows
 * 'case' | 'case_message' | 'profile', and target_message is a bigint FK
 * to case_messages specifically — there is no column or type value for a
 * DM (the `messages` table). Reporting a DM sender's whole profile
 * (target_type: 'profile') is possible with the current schema, but there
 * is no admin action to hide a single DM either (admin_hide_case_message
 * only touches case_messages), and DMs are already private 1:1 threads
 * with `blocked_users` as the existing defense — see FIX_SPEC B4. Needs a
 * schema change (new target_type + FK to `messages`) to do properly;
 * flagging per FIX_SPEC's "stop and flag it" rule rather than building
 * around it.
 *
 * Since migration 032, DMs are user → approved clinic only, and admins can
 * read every thread (Admin → DMs) and ban either side from there. A thread
 * that no longer fits the model (an old user↔user thread, or a clinic that
 * lost approval) stays readable here but can't be posted in — the send
 * policy refuses it, and the composer is swapped for a notice.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDmThread } from '../hooks/useRealtime';
import {
  blockUser,
  fetchDmPartner,
  isUserBlocked,
  isUserVetConversation,
  markConversationRead,
  sendMessage,
  unblockUser,
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
  const [blocked, setBlocked] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // null while checking; the server's send policy is the real gate.
  const [canSend, setCanSend] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (id && user) fetchDmPartner(id, user.id).then(setPartner).catch(() => {});
  }, [id, user]);

  useEffect(() => {
    if (id && user) void isUserVetConversation(id).then(setCanSend);
  }, [id, user]);

  // B4: reflect current block state so the header action reads Block vs Unblock.
  useEffect(() => {
    if (user && partner) {
      isUserBlocked(user.id, partner.id).then(setBlocked).catch(() => {});
    }
  }, [user, partner]);

  const toggleBlock = async () => {
    if (!user || !partner) return;
    try {
      if (blocked) {
        await unblockUser(user.id, partner.id);
        setBlocked(false);
      } else {
        if (!window.confirm(t('settings.blockConfirm', { name: partner.display_name }))) return;
        await blockUser(user.id, partner.id);
        setBlocked(true);
        toast(t('settings.blocked_done'));
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  };

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
            <div style={{ fontWeight: 800, fontSize: 15, flex: 1, minWidth: 0 }}>
              {partner.display_name}
              {partner.role === 'vet' ? ' 🏥' : ''}
            </div>
            <button
              className="btn btn--ghost btn--small"
              title={blocked ? t('settings.unblock') : t('settings.block')}
              aria-label={blocked ? t('settings.unblock') : t('settings.block')}
              onClick={() => void toggleBlock()}
            >
              🚫
            </button>
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

      {canSend === false ? (
        <div className="chat-composer chat-composer--closed" role="status">
          <span>🔒 {t('dm.threadClosed')}</span>
        </div>
      ) : (
        <div className="chat-composer">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
            placeholder={t('dm.placeholder')}
            maxLength={4000}
            disabled={canSend === null}
          />
          <button onClick={() => void send()} disabled={sending || !draft.trim() || canSend === null} aria-label={t('common.send')}>
            <IconSend size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
