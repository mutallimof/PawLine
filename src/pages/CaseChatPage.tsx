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
import { blockUser, sendCaseMessage } from '../lib/api';
import { Avatar, StatusBadge, useToast } from '../components/ui';
import { ReportButton } from '../components/Report';
import { IconBack, IconSend } from '../components/Icons';
import { t } from '../i18n';
import { clockTime } from '../lib/time';

export default function CaseChatPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
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

  const send = async () => {
    const body = draft.trim();
    if (!body || !user || !id) return;
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
        {messages.map((m) => {
          const mine = m.sender_id === user?.id;
          return (
            <div key={m.id} className={`bubble${mine ? ' bubble--mine' : ''}`}>
              {!mine && m.sender && (
                <div className="bubble__sender">
                  <Link to={`/user/${m.sender.id}`}>
                    {m.sender.display_name}
                    {m.sender.role === 'vet' ? ' 🏥' : ''}
                  </Link>
                  {user && (
                    <ReportButton
                      reporterId={user.id}
                      targetType="case_message"
                      targetCase={m.case_id}
                      targetMessage={m.id}
                      targetProfile={m.sender_id}
                      small
                    />
                  )}
                  {user && m.sender_id && m.sender_id !== user.id && (
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
            </div>
          );
        })}
      </div>

      {user ? (
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
