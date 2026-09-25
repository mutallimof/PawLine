/**
 * Admin → DMs: read-only oversight of every direct-message thread
 * (migration 032). Admins READ; they never post — the send policy requires a
 * participant, and nothing here offers a composer. The one action is banning
 * either side, through the existing admin_ban_user() (with a confirm).
 *
 * The thread list comes from admin_list_dm_threads(), which is is_admin()-
 * gated and carries each participant's ban state (hidden from plain selects
 * by column grants). Messages are a plain select that the admin read policy
 * on `messages` (032) opens up to admins.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  adminBanUser,
  fetchAdminDmThreads,
  fetchMessages,
  type AdminDmThread,
} from '../../lib/api';
import { useToast } from '../../components/ui';
import { t } from '../../i18n';
import { clockTime, timeAgo } from '../../lib/time';
import type { DirectMessage, ProfileRole } from '../../lib/types';

const PAGE = 50;

interface Side {
  id: string;
  name: string;
  role: ProfileRole | null;
  banned: boolean;
}

function sides(th: AdminDmThread): Side[] {
  const out: Side[] = [];
  if (th.a_id) out.push({ id: th.a_id, name: th.a_name ?? '—', role: th.a_role, banned: !!th.a_banned });
  if (th.b_id) out.push({ id: th.b_id, name: th.b_name ?? '—', role: th.b_role, banned: !!th.b_banned });
  return out;
}

function SideLabel({ s }: { s: Side }) {
  return (
    <>
      {s.name}
      {s.role === 'vet' ? ' 🏥' : ''}
      {s.banned && <span className="admin-badge admin-badge--banned" style={{ marginLeft: 6 }}>{t('admin.badgeBanned')}</span>}
    </>
  );
}

function ThreadView({
  thread,
  currentUserId,
  onBack,
  onBanChanged,
}: {
  thread: AdminDmThread;
  currentUserId: string;
  onBack: () => void;
  onBanChanged: (profileId: string, banned: boolean) => void;
}) {
  const toast = useToast();
  const [messages, setMessages] = useState<DirectMessage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const people = sides(thread);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '—';

  useEffect(() => {
    fetchMessages(thread.conversation_id)
      .then(setMessages)
      .catch((e) => {
        setMessages([]);
        toast(e instanceof Error ? e.message : t('common.error'));
      });
  }, [thread.conversation_id, toast]);

  const toggleBan = async (s: Side) => {
    if (!s.banned && !window.confirm(t('admin.userBanConfirm', { name: s.name }))) return;
    setBusy(true);
    try {
      await adminBanUser(s.id, !s.banned);
      onBanChanged(s.id, !s.banned);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="link-btn" onClick={onBack} style={{ marginBottom: 12 }}>
        ← {t('admin.dmsBack')}
      </button>

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        {people.map((s) => (
          <div key={s.id} className="admin-hidden-row">
            <div style={{ minWidth: 0, flex: 1 }}>
              <Link to={`/user/${s.id}`} className="list-row__title" style={{ display: 'block' }}>
                <SideLabel s={s} />
              </Link>
              <div className="list-row__sub">{s.role === 'vet' ? t('admin.roleVet') : t('admin.roleUser')}</div>
            </div>
            {s.id !== currentUserId && (
              <button
                type="button"
                className={`btn btn--small ${s.banned ? 'btn--secondary' : 'btn--danger'}`}
                disabled={busy}
                onClick={() => void toggleBan(s)}
              >
                {s.banned ? t('admin.unbanUser') : t('admin.banUser')}
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="page-subtitle" style={{ marginTop: 0 }}>🔒 {t('admin.dmsReadOnly')}</p>

      {messages === null && <div className="spinner" />}
      {messages?.length === 0 && <div className="empty-state">{t('admin.dmsNoMessages')}</div>}
      {messages && messages.length > 0 && (
        <div className="card admin-dm-log">
          {messages.map((m) => (
            <div key={m.id} className="admin-dm-msg">
              <div className="admin-dm-msg__meta">
                <strong>{nameOf(m.sender_id)}</strong> · {new Date(m.created_at).toLocaleDateString()} {clockTime(m.created_at)}
              </div>
              <div className="admin-dm-msg__body">{m.body}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function DmsTab({ currentUserId }: { currentUserId: string }) {
  const toast = useToast();
  const [threads, setThreads] = useState<AdminDmThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        const rows = await fetchAdminDmThreads(PAGE, offset);
        setThreads((prev) => (offset === 0 ? rows : [...prev, ...rows]));
        setHasMore(rows.length === PAGE);
      } catch (e) {
        toast(e instanceof Error ? e.message : t('common.error'));
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  // A ban applies to the person, so reflect it on every thread they're in.
  const onBanChanged = (profileId: string, banned: boolean) =>
    setThreads((prev) =>
      prev.map((th) => ({
        ...th,
        a_banned: th.a_id === profileId ? banned : th.a_banned,
        b_banned: th.b_id === profileId ? banned : th.b_banned,
      })),
    );

  const selected = threads.find((th) => th.conversation_id === selectedId) ?? null;
  if (selected) {
    return (
      <ThreadView
        key={selected.conversation_id}
        thread={selected}
        currentUserId={currentUserId}
        onBack={() => setSelectedId(null)}
        onBanChanged={onBanChanged}
      />
    );
  }

  return (
    <>
      <p className="page-subtitle" style={{ marginTop: -4 }}>{t('admin.dmsSub')}</p>
      {!loading && threads.length === 0 && <div className="empty-state">{t('admin.none')}</div>}
      {threads.map((th) => {
        const [a, b] = sides(th);
        return (
          <button
            key={th.conversation_id}
            type="button"
            className="list-row admin-user-row"
            onClick={() => setSelectedId(th.conversation_id)}
          >
            <div className="list-row__main" style={{ minWidth: 0, flex: 1 }}>
              <div className="admin-dm-row__who">
                {a && <SideLabel s={a} />}
                {b && (
                  <>
                    <span className="admin-dm-row__arrow" aria-hidden="true">↔</span>
                    <SideLabel s={b} />
                  </>
                )}
              </div>
              <div className="list-row__sub">{th.last_message ?? '—'}</div>
              <div className="admin-user-row__meta">
                <span>{t('admin.dmsCount', { n: th.message_count })}</span>
                {th.last_message_at && <span>{timeAgo(th.last_message_at)}</span>}
              </div>
            </div>
          </button>
        );
      })}
      {loading && <div className="spinner" />}
      {!loading && hasMore && (
        <button type="button" className="btn btn--ghost btn--small" onClick={() => void load(threads.length)} style={{ width: '100%' }}>
          {t('admin.usersLoadMore')}
        </button>
      )}
    </>
  );
}
