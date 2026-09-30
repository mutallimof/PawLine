/**
 * Case group chat (CHAT SYSTEM 2) — open to any registered user, tied to
 * one case. This is where help is coordinated and where vets may post their
 * bank details so people can chip in for treatment. Payments happen entirely
 * OUTSIDE the platform — this is information-sharing only, by design.
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCase, useCaseChat } from '../hooks/useRealtime';
import {
  blockUser,
  closeCaseChat,
  markCaseChatRead,
  pinCaseMessage,
  reopenCaseChat,
  sendCaseMessage,
  unpinCaseMessage,
} from '../lib/api';
import { caseTitle, ScreenHeader, statusLabel, useToast } from '../components/ui';
import { ReportSheet } from '../components/Report';
import { IconHelp, IconSend, VetTag } from '../components/Icons';
import { getLocale, t } from '../i18n';
import { clockTime, dayKey, dayLabel } from '../lib/time';
import type { CaseMessage } from '../lib/types';

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


export default function CaseChatPage() {
  const { id } = useParams<{ id: string }>();
  const { user, isGuest } = useAuth();
  // Reading this chat is deliberately public (case_messages is granted SELECT
  // to anon, and its policy only hides hidden rows), so a guest keeps full
  // read access — same as a signed-out visitor. Only POSTING needs an account:
  // the insert policy (003) excludes anonymous sessions and requires
  // sender_id = auth.uid(), an FK into profiles, which a guest has no row in
  // (sender_id is nullable only so a deleted author's messages survive, 037). So gate the
  // composer and the per-message actions, never the thread itself.
  const isRegistered = !!user && !isGuest;
  const { caseData, reload: reloadCase } = useCase(id);
  const { messages, loading } = useCaseChat(id);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
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
  // The message being reported, if any. The form is a sheet at page level
  // rather than inline in the dropdown — anchored to a bubble it spilled off
  // the side of the screen and clipped its own question and options.
  const [reportFor, setReportFor] = useState<CaseMessage | null>(null);

  // Task 8: the case's vet can close the chat (read-only for everyone, the
  // vet included) and reopen it, at any case status. close_case_chat /
  // reopen_case_chat refuse anyone but cases.vet_id, and the posting policy
  // refuses every insert while chat_closed_at is set (migration 032) — the
  // composer swap below is presentation. `cases` is in the realtime
  // publication, so everyone with the chat open sees the change live.
  const chatClosedAt = caseData?.chat_closed_at ?? null;
  const [togglingChat, setTogglingChat] = useState(false);
  const toggleChatClosed = async () => {
    if (!id) return;
    if (!chatClosedAt && !window.confirm(t('caseChat.closeConfirm'))) return;
    setTogglingChat(true);
    try {
      if (chatClosedAt) await reopenCaseChat(id);
      else await closeCaseChat(id);
      await reloadCase(); // don't wait on the realtime echo of our own write
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setTogglingChat(false);
    }
  };

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
      <div className="chat-top">
        <ScreenHeader
          title={t('caseChat.title')}
          fallback={id ? `/case/${id}` : '/'}
          action={
            // Figma's help button: opens the case this chat belongs to.
            <Link to={`/case/${id}`} className="icon-btn" aria-label={t('case.detailTitle')}>
              <IconHelp />
            </Link>
          }
        />
        {caseData && (
          <div className="chat-context">
            <div className="chat-context__main">
              <div className="chat-context__title">{caseTitle(caseData)}</div>
              <div className="chat-context__sub">
                {statusLabel(caseData.status)}
                {caseData.address_hint ? ` · ${caseData.address_hint}` : ''}
              </div>
            </div>
            {isCaseVet && !chatClosedAt && (
              <button
                type="button"
                className="chat-context__action"
                disabled={togglingChat}
                onClick={() => void toggleChatClosed()}
                title={t('caseChat.close')}
                aria-label={t('caseChat.close')}
              >
                🔒 {t('caseChat.closeShort')}
              </button>
            )}
          </div>
        )}
      </div>

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
        <p className="chat-note">{t('caseChat.subtitle')}</p>
        {loading && <div className="spinner" />}
        {!loading && messages.length === 0 && (
          <div className="empty-state">{t('caseChat.empty')}</div>
        )}
        {messages.map((m, i) => {
          const mine = m.sender_id === user?.id;
          const newDay = i === 0 || dayKey(messages[i - 1].created_at) !== dayKey(m.created_at);
          // Group E: the sender's name shows only on the first message of a
          // run — consecutive messages from one person collapse together.
          const isFirstOfRun = newDay || messages[i - 1].sender_id !== m.sender_id;
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
            <Fragment key={m.id}>
              {newDay && <div className="chat-day">{dayLabel(m.created_at)}</div>}
              <div className={`chat-msg${mine ? ' chat-msg--mine' : ''}`}>
                {/* Meta line ABOVE the bubble (Figma): sender · time. Block
                    acts on the PERSON, so it sits with the name. */}
                <div className="chat-msg__meta">
                  {mine ? (
                    <span className="chat-msg__who">{t('common.you')}</span>
                  ) : m.sender_id === null ? (
                    isFirstOfRun && (
                      <span className="chat-msg__who">{t('caseChat.deletedAccount')}</span>
                    )
                  ) : (
                    m.sender && isFirstOfRun && (
                      <Link to={`/user/${m.sender.id}`} className="chat-msg__who">
                        {m.sender.display_name}
                        {m.sender.role === 'vet' && <VetTag />}
                      </Link>
                    )
                  )}
                  <span className="bubble__time">{clockTime(m.created_at)}</span>
                  {!mine && isFirstOfRun && isRegistered && m.sender_id && m.sender_id !== user.id && (
                    <button
                      className="chat-msg__block"
                      title={t('settings.block')}
                      aria-label={t('settings.block')}
                      onClick={() => {
                        const senderName = m.sender?.display_name ?? '';
                        const senderId = m.sender_id;
                        if (!senderId) return;
                        if (!window.confirm(t('settings.blockConfirm', { name: senderName }))) return;
                        void blockUser(user.id, senderId)
                          .then(() => toast(t('settings.blocked_done')))
                          .catch((e) => toast(e instanceof Error ? e.message : t('common.error')));
                      }}
                    >
                      🚫
                    </button>
                  )}
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
                            {/* Report (B2): closes the menu and opens the form
                                as a sheet, so it gets the whole screen width. */}
                            {canReport && (
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenu(null);
                                  setReportFor(m);
                                }}
                              >
                                ⚑ {t('mod.report')}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className={`bubble${mine ? ' bubble--mine' : ''}`}>{m.body}</div>
              </div>
            </Fragment>
          );
        })}
      </div>

      {reportFor && user && (
        <ReportSheet
          reporterId={user.id}
          targetType="case_message"
          targetCase={reportFor.case_id}
          targetMessage={reportFor.id}
          targetProfile={reportFor.sender_id ?? undefined}
          onClose={() => setReportFor(null)}
        />
      )}

      {chatClosedAt ? (
        <div className="chat-composer chat-composer--closed" role="status">
          <span>
            🔒{' '}
            {t(isCaseVet ? 'caseChat.closedByYou' : 'caseChat.closedByClinic', {
              date: new Date(chatClosedAt).toLocaleDateString(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }),
            })}
          </span>
          {isCaseVet && (
            <button
              type="button"
              className="chat-reopen"
              disabled={togglingChat}
              onClick={() => void toggleChatClosed()}
            >
              {t('caseChat.reopen')}
            </button>
          )}
        </div>
      ) : isRegistered ? (
        <div className="chat-composer">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void send()}
            placeholder={t('caseChat.placeholder')}
            maxLength={4000}
          />
          <button
            className="chat-composer__send"
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            aria-label={t('common.send')}
          >
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
