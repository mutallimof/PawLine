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
import { blockUser, markCaseChatRead, pinCaseMessage, sendCaseMessage, unpinCaseMessage } from '../lib/api';
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
/**
 * Whether this device has already been shown the "you can pin a message" hint.
 * Same posture as legal.tsx's safety ACK_KEY: on a storage error we treat it as
 * already seen, so a blocked-storage browser is never nagged on every open.
 */
const PIN_HINT_KEY = 'pawline-pin-hint-seen';

function pinHintSeen(): boolean {
  try {
    return localStorage.getItem(PIN_HINT_KEY) === 'yes';
  } catch {
    return true;
  }
}

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
  const { caseData, reload: reloadCase } = useCase(id);
  const { messages, loading } = useCaseChat(id);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const toast = useToast();

  // Only the clinic assigned to THIS case may pin. The server enforces it too
  // (pin_case_message, 027) — this just decides whether to offer the control.
  const isCaseVet = isRegistered && !!caseData && caseData.vet_id === user.id;

  // Resolved from the messages already loaded rather than joined onto the case
  // query: an embed would need 027's FK to exist, and a cases query that fails
  // on a missing relation takes the whole case view down. Reads as undefined
  // until that migration is applied, so nothing renders and nothing breaks.
  const pinned = caseData?.pinned_message_id
    ? messages.find((m) => m.id === caseData.pinned_message_id) ?? null
    : null;

  // The pin only exists for the assigned clinic, and only once a vet has been
  // selected on the case — so it is easy to never discover. Show a one-time
  // hint, which also retires itself as soon as anything is pinned.
  const [hintSeen, setHintSeen] = useState(pinHintSeen);
  const dismissHint = () => {
    setHintSeen(true);
    try {
      localStorage.setItem(PIN_HINT_KEY, 'yes');
    } catch {
      /* storage blocked — the hint just reappears next time, which is fine */
    }
  };

  // Which message's ⋯ menu is open, if any.
  const [openMenu, setOpenMenu] = useState<number | null>(null);

  const setPin = async (messageId: number | null) => {
    if (!id) return;
    setOpenMenu(null);
    try {
      if (messageId === null) await unpinCaseMessage(id);
      else await pinCaseMessage(id, messageId);
      await reloadCase(); // don't wait on the realtime echo of our own write
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    }
  };

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

      {pinned && (
        <div className="chat-pinned">
          <div className="chat-pinned__label">
            📌 {t('caseChat.pinned')}
            {isCaseVet && (
              <button className="chat-pinned__unpin" onClick={() => void setPin(null)}>
                {t('caseChat.unpin')}
              </button>
            )}
          </div>
          <div className="chat-pinned__body">{pinned.body}</div>
        </div>
      )}

      {isCaseVet && !pinned && !hintSeen && (
        <div className="chat-pin-hint">
          <span>💡 {t('caseChat.pinHint')}</span>
          <button className="chat-pin-hint__dismiss" onClick={dismissHint}>
            {t('caseChat.hintGotIt')}
          </button>
        </div>
      )}

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
          // Menu contents by viewer. Reporting is for other people's messages;
          // pinning is for the case's own vet, and only on their OWN message —
          // a clinic pins its condition/bank-details post, nothing else. Both
          // of those are enforced server-side too (028 / content_reports RLS).
          const canReport = !mine && isRegistered;
          const ownVetMessage = isCaseVet && m.sender_id === user.id;
          const canPin = ownVetMessage && m.id !== caseData?.pinned_message_id;
          const canUnpin = ownVetMessage && m.id === caseData?.pinned_message_id;
          // No affordance at all when there would be nothing in the menu.
          const hasMenu = canReport || canPin || canUnpin;
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
              {/* One footer row for the timestamp and the ⋯ menu.
                  .bubble__time is `display: block` and shared with
                  DmThreadPage, so it keeps that — the row overrides the time's
                  display locally instead, otherwise anything after it starts a
                  new line. */}
              <div className="bubble__footer">
                <span className="bubble__time">{clockTime(m.created_at)}</span>
                {hasMenu && (
                  <div className="bubble__menu">
                    <button
                      className="bubble__menu-btn"
                      aria-label={t('caseChat.actions')}
                      aria-haspopup="menu"
                      aria-expanded={openMenu === m.id}
                      onClick={() => setOpenMenu(openMenu === m.id ? null : m.id)}
                    >
                      ⋯
                    </button>
                    {openMenu === m.id && (
                      <>
                        {/* Tap-anywhere-else to close, without a document
                            listener to attach and tear down. */}
                        <div className="bubble__menu-backdrop" onClick={() => setOpenMenu(null)} />
                        <div className="bubble__menu-list" role="menu">
                          {canPin && (
                            <button role="menuitem" onClick={() => void setPin(m.id)}>
                              📌 {t('caseChat.pin')}
                            </button>
                          )}
                          {canUnpin && (
                            <button role="menuitem" onClick={() => void setPin(null)}>
                              📌 {t('caseChat.unpin')}
                            </button>
                          )}
                          {/* Report (B2), unchanged — just relocated into the
                              menu so it stops sitting under every bubble. */}
                          {canReport && (
                            <ReportButton
                              reporterId={user.id}
                              targetType="case_message"
                              targetCase={m.case_id}
                              targetMessage={m.id}
                              targetProfile={m.sender_id}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
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
