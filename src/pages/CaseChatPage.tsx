/**
 * Case group chat (CHAT SYSTEM 2) — open to any registered user, tied to
 * one case. This is where help is coordinated and where vets may post their
 * bank details so people can chip in for treatment. Payments happen entirely
 * OUTSIDE the platform — this is information-sharing only, by design.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCase, useCaseChat } from '../hooks/useRealtime';
import { blockUser, markCaseChatRead, sendCaseMessage } from '../lib/api';
import { Avatar, StatusBadge, useToast } from '../components/ui';
import { ReportButton } from '../components/Report';
import { IconBack, IconSend } from '../components/Icons';
import { t } from '../i18n';
import { clockTime } from '../lib/time';

/**
 * Group E: a consistent colour per sender across the thread, distinct from
 * the semantic status/brand colours (--coral, --status-*) so a sender's
 * name is never mistaken for a status cue. Plain hash of their id — no
 * state, so it's naturally stable across renders and reloads.
 */
const SENDER_COLORS = [
  '#c2402f', '#3f7fae', '#3f9b6c', '#8a5cb5',
  '#b5762f', '#4a7a6b', '#a8477a', '#5c6bc0',
];
function senderColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return SENDER_COLORS[hash % SENDER_COLORS.length];
}

export default function CaseChatPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isGuest } = useAuth();
  // Reading this chat is deliberately public (case_messages is granted SELECT
  // to anon, and its policy only hides hidden rows), so a guest keeps full
  // read access — same as a signed-out visitor. Only POSTING needs an account:
  // the insert policy (003) excludes anonymous sessions, and sender_id is a
  // NOT NULL FK into profiles, which a guest has no row in. So gate the
  // composer and the per-message actions, never the thread itself.
  const isRegistered = !!user && !isGuest;
  const { caseData } = useCase(id);
  const { messages, loading } = useCaseChat(id);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const toast = useToast();

  // Keep the newest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  // Migration 017: mark read whenever new messages land while it's open —
  // mirrors DmThreadPage's markConversationRead effect.
  useEffect(() => {
    if (id && isRegistered) void markCaseChatRead(id).catch(() => {});
  }, [id, user, isRegistered, messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !isRegistered || !id) return;
    setSending(true);
    try {
      await sendCaseMessage(id, user.id, body);
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
        <button onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconBack />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{t('caseChat.title')}</div>
          {caseData && (
            <div className="list-row__sub">{caseData.description}</div>
          )}
        </div>
        {caseData && <StatusBadge status={caseData.status} />}
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        <div className="banner banner--info" style={{ fontWeight: 600 }}>
          {t('caseChat.subtitle')}
        </div>
        {loading && <div className="spinner" />}
        {!loading && messages.length === 0 && (
          <div className="empty-state">{t('caseChat.empty')}</div>
        )}
        {messages.map((m, i) => {
          const mine = m.sender_id === user?.id;
          // Group E: sender name shows only on the first message of a run —
          // consecutive messages from the same person collapse together,
          // WhatsApp-style.
          const isFirstOfRun = i === 0 || messages[i - 1].sender_id !== m.sender_id;
          return (
            <div key={m.id} className={`bubble${mine ? ' bubble--mine' : ''}`}>
              {/* Sender name + block: identity info, so only once per run —
                  block acts on the PERSON, not this one message. */}
              {!mine && m.sender && isFirstOfRun && (
                <div className="bubble__sender" style={{ color: senderColor(m.sender.id) }}>
                  <Link to={`/user/${m.sender.id}`} style={{ color: 'inherit' }}>
                    {m.sender.display_name}
                    {m.sender.role === 'vet' ? ' 🏥' : ''}
                  </Link>
                  {isRegistered && m.sender_id && m.sender_id !== user.id && (
                    <button
                      style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-soft)' }}
                      title={t('settings.block')}
                      aria-label={t('settings.block')}
                      onClick={() => {
                        const senderName = m.sender?.display_name ?? '';
                        const senderId = m.sender_id;
                        if (!window.confirm(t('settings.blockConfirm', { name: senderName }))) return;
                        void blockUser(user.id, senderId)
                          .then(() => toast(t('settings.blocked_done')))
                          .catch((e) => toast(e instanceof Error ? e.message : t('common.error')));
                      }}
                    >
                      🚫
                    </button>
                  )}
                </div>
              )}
              {m.body}
              <span className="bubble__time">{clockTime(m.created_at)}</span>
              {/* Report (B2): per-message, so every message keeps this —
                  unlike the name/block above, unrelated to run-grouping. */}
              {!mine && isRegistered && (
                <ReportButton
                  reporterId={user.id}
                  targetType="case_message"
                  targetCase={m.case_id}
                  targetMessage={m.id}
                  targetProfile={m.sender_id}
                  small
                />
              )}
            </div>
          );
        })}
      </div>

      {isRegistered ? (
        <div className="chat-composer">
          <div style={{ alignSelf: 'center' }}>
            <Avatar name={user.email ?? 'me'} small />
          </div>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
            placeholder={t('caseChat.placeholder')}
            maxLength={4000}
          />
          <button onClick={() => void send()} disabled={sending || !draft.trim()} aria-label={t('common.send')}>
            <IconSend size={18} />
          </button>
        </div>
      ) : (
        <div className="chat-composer" style={{ justifyContent: 'center' }}>
          <Link to="/auth" className="btn btn--secondary btn--small">
            {t('caseChat.signIn')}
          </Link>
        </div>
      )}
    </div>
  );
}
