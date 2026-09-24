/**
 * Admin → Users: every account, searchable by name or email, sortable, with
 * a detail panel for ban/unban, unhiding their hidden content and (for vets)
 * clinic review.
 *
 * The list comes from admin_list_users() (migration 030), the only read path
 * for email / banned / is_admin. It pages and sorts server-side, so sorting
 * always covers every account, not just the loaded page.
 *
 * Every action here calls an admin RPC that re-checks is_admin() on the
 * server. The client-side gate on AdminPage is presentation only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  adminBanUser,
  adminHideCase,
  adminHideCaseMessage,
  adminSetVetStatus,
  fetchAdminUsers,
  fetchHiddenContentBy,
  fetchVetForAdmin,
  type AdminUser,
  type AdminUserSort,
  type HiddenCaseRow,
  type HiddenMessageRow,
} from '../../lib/api';
import { Avatar, useToast } from '../../components/ui';
import { getLocale, t } from '../../i18n';
import type { ProfileRole, Vet } from '../../lib/types';
import VetDocumentsList from './VetDocumentsList';

const PAGE = 50;

function joinDate(iso: string): string {
  return new Date(iso).toLocaleDateString(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

function VetStatusBadge({ status }: { status: Vet['status'] }) {
  return (
    <span className={`admin-badge admin-badge--${status}`}>{t(`admin.vetStatus.${status}` as const)}</span>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function UserDetail({
  user,
  currentUserId,
  pendingVets,
  onBack,
  onPatch,
  onChanged,
}: {
  user: AdminUser;
  currentUserId: string;
  pendingVets: Vet[];
  onBack: () => void;
  onPatch: (patch: Partial<AdminUser>) => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState<{ cases: HiddenCaseRow[]; messages: HiddenMessageRow[] } | null>(null);
  const [vet, setVet] = useState<Vet | null | undefined>(undefined); // undefined = loading
  const [docCount, setDocCount] = useState(0);

  // The pending queue already carries the private manager_* fields (via
  // admin_list_pending_vets); for approved/rejected clinics only the public
  // columns are readable, so those fields are simply absent.
  const pendingRow = pendingVets.find((v) => v.id === user.id);

  const loadHidden = useCallback(() => {
    fetchHiddenContentBy(user.id)
      .then(setHidden)
      .catch(() => setHidden({ cases: [], messages: [] }));
  }, [user.id]);

  const loadVet = useCallback(() => {
    if (user.role !== 'vet') return;
    fetchVetForAdmin(user.id)
      .then(setVet)
      .catch(() => setVet(null));
  }, [user.id, user.role]);

  useEffect(() => {
    loadHidden();
    loadVet();
  }, [loadHidden, loadVet]);

  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      after?.();
      await onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const isSelf = user.id === currentUserId;

  const toggleBan = () => {
    if (!user.banned && !window.confirm(t('admin.userBanConfirm', { name: user.display_name }))) return;
    void act(
      () => adminBanUser(user.id, !user.banned),
      () => onPatch({ banned: !user.banned }),
    );
  };

  const unhideCase = (c: HiddenCaseRow) =>
    void act(
      () => adminHideCase(c.id, false),
      () => {
        setHidden((h) => h && { ...h, cases: h.cases.filter((x) => x.id !== c.id) });
        onPatch({ cases_hidden: Math.max(0, user.cases_hidden - 1) });
      },
    );

  const unhideMessage = (m: HiddenMessageRow) =>
    void act(
      () => adminHideCaseMessage(m.id, false),
      () => setHidden((h) => h && { ...h, messages: h.messages.filter((x) => x.id !== m.id) }),
    );

  const setVetStatus = (status: Vet['status']) => {
    if (!vet) return;
    const name = vet.clinic_name;
    if (status === 'approved' && docCount === 0 && !window.confirm(t('admin.vetApproveNoDocsConfirm', { name }))) {
      return;
    }
    if (status === 'rejected' && !window.confirm(t('admin.vetRejectConfirm', { name }))) return;
    if (status === 'pending' && vet.status === 'approved' && !window.confirm(t('admin.vetUnapproveConfirm', { name }))) {
      return;
    }
    void act(
      () => adminSetVetStatus(vet.id, status),
      () => setVet({ ...vet, status }),
    );
  };

  const vetDetails = pendingRow ?? vet;

  return (
    <>
      <button type="button" className="link-btn" onClick={onBack} style={{ marginBottom: 12 }}>
        ← {t('admin.usersBack')}
      </button>

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="admin-user-head">
          <Avatar name={user.display_name} url={user.avatar_url} />
          <div style={{ minWidth: 0 }}>
            <div className="list-row__title">{user.display_name}</div>
            <div className="list-row__sub">{user.email ?? '—'}</div>
          </div>
        </div>
        <div className="admin-badges">
          <span className="admin-badge">{user.role === 'vet' ? t('admin.roleVet') : t('admin.roleUser')}</span>
          {user.is_admin && <span className="admin-badge admin-badge--admin">{t('admin.badgeAdmin')}</span>}
          {user.banned && <span className="admin-badge admin-badge--banned">{t('admin.badgeBanned')}</span>}
          {user.partner_org && <span className="admin-badge">🤝 {user.partner_org}</span>}
        </div>

        <dl className="admin-facts">
          <div><dt>{t('admin.colXp')}</dt><dd>{user.xp}</dd></div>
          <div><dt>{t('admin.colRescues')}</dt><dd>{user.cases_helped}</dd></div>
          <div><dt>{t('admin.colReported')}</dt><dd>{user.cases_reported}</dd></div>
          <div><dt>{t('admin.colHidden')}</dt><dd>{user.cases_hidden}</dd></div>
          <div className="admin-facts__wide"><dt>{t('admin.colJoined')}</dt><dd>{joinDate(user.created_at)}</dd></div>
        </dl>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <Link to={`/user/${user.id}`} className="btn btn--ghost btn--small">
            {t('admin.viewProfile')}
          </Link>
          {!isSelf && (
            <button
              type="button"
              className={`btn btn--small ${user.banned ? 'btn--secondary' : 'btn--danger'}`}
              disabled={busy}
              onClick={toggleBan}
            >
              {user.banned ? t('admin.unbanUser') : t('admin.banUser')}
            </button>
          )}
        </div>
      </div>

      {user.role === 'vet' && (
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="section-label" style={{ marginTop: 0 }}>{t('admin.clinicTitle')}</div>
          {vet === undefined && <div className="spinner" />}
          {vet === null && <p className="list-row__sub">{t('admin.clinicNone')}</p>}
          {vet && vetDetails && (
            <>
              <div className="admin-user-head" style={{ marginBottom: 6 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="list-row__title">{vetDetails.clinic_name}</div>
                  <div className="list-row__sub">{vetDetails.address}</div>
                </div>
                <VetStatusBadge status={vet.status} />
              </div>
              <div className="list-row__sub">
                {vetDetails.contact_phone}
                {vetDetails.contact_email ? ` · ${vetDetails.contact_email}` : ''}
              </div>
              {pendingRow && (pendingRow.manager_name || pendingRow.manager_surname || pendingRow.manager_phone) && (
                <div className="list-row__sub">
                  {t('admin.vetManager')}: {[pendingRow.manager_name, pendingRow.manager_surname].filter(Boolean).join(' ')}
                  {pendingRow.manager_phone ? ` · ${pendingRow.manager_phone}` : ''}
                </div>
              )}
              {vetDetails.accepted_animals?.length > 0 && (
                <div className="list-row__sub">
                  {vetDetails.accepted_animals.map((a) => t(`animal.${a}` as const)).join(', ')}
                </div>
              )}
              <VetDocumentsList vetId={vet.id} onCount={setDocCount} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {vet.status !== 'approved' && (
                  <button
                    type="button"
                    className="btn btn--success btn--small"
                    disabled={busy}
                    onClick={() => setVetStatus('approved')}
                  >
                    ✓ {t('admin.approve')}
                  </button>
                )}
                {vet.status !== 'rejected' && (
                  <button
                    type="button"
                    className="btn btn--danger btn--small"
                    disabled={busy}
                    onClick={() => setVetStatus('rejected')}
                  >
                    {t('admin.reject')}
                  </button>
                )}
                {vet.status !== 'pending' && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    disabled={busy}
                    onClick={() => setVetStatus('pending')}
                  >
                    {t('admin.vetBackToReview')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {hidden && (hidden.cases.length > 0 || hidden.messages.length > 0) && (
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div className="section-label" style={{ marginTop: 0 }}>{t('admin.hiddenContentTitle')}</div>
          {hidden.cases.map((c) => (
            <div key={c.id} className="admin-hidden-row">
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link to={`/case/${c.id}`} className="list-row__title" style={{ display: 'block' }}>
                  {t(`animal.${c.animal}` as const)} — {c.description.slice(0, 80)}
                </Link>
                <div className="list-row__sub">{joinDate(c.created_at)}</div>
              </div>
              <button type="button" className="btn btn--secondary btn--small" disabled={busy} onClick={() => unhideCase(c)}>
                {t('admin.unhide')}
              </button>
            </div>
          ))}
          {hidden.messages.map((m) => (
            <div key={m.id} className="admin-hidden-row">
              <div style={{ minWidth: 0, flex: 1 }}>
                <Link to={`/case/${m.case_id}`} className="list-row__title" style={{ display: 'block' }}>
                  “{m.body.slice(0, 80)}”
                </Link>
                <div className="list-row__sub">{joinDate(m.created_at)}</div>
              </div>
              <button type="button" className="btn btn--secondary btn--small" disabled={busy} onClick={() => unhideMessage(m)}>
                {t('admin.unhide')}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export default function UsersTab({
  currentUserId,
  pendingVets,
  onChanged,
}: {
  currentUserId: string;
  pendingVets: Vet[];
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [role, setRole] = useState<ProfileRole>('user');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState(''); // debounced copy of query
  const [sort, setSort] = useState<AdminUserSort>('created_at');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Guards against an older, slower request overwriting a newer one's rows.
  const requestSeq = useRef(0);

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(query), 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const load = useCallback(
    async (offset: number) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      try {
        const rows = await fetchAdminUsers({ role, search, sort, limit: PAGE, offset });
        if (seq !== requestSeq.current) return;
        setUsers((prev) => (offset === 0 ? rows : [...prev, ...rows]));
        setHasMore(rows.length === PAGE);
      } catch (e) {
        if (seq === requestSeq.current) toast(e instanceof Error ? e.message : t('common.error'));
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [role, search, sort, toast],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const selected = users.find((u) => u.id === selectedId) ?? null;

  if (selected) {
    return (
      <UserDetail
        key={selected.id}
        user={selected}
        currentUserId={currentUserId}
        pendingVets={pendingVets}
        onBack={() => setSelectedId(null)}
        onPatch={(patch) => setUsers((prev) => prev.map((u) => (u.id === selected.id ? { ...u, ...patch } : u)))}
        onChanged={onChanged}
      />
    );
  }

  const sortOptions: { value: AdminUserSort; label: string }[] = [
    { value: 'created_at', label: t('admin.sortJoined') },
    { value: 'cases_helped', label: t('admin.sortRescues') },
    { value: 'xp', label: t('admin.sortXp') },
  ];

  return (
    <>
      <div className="chip-row" style={{ marginBottom: 12 }}>
        {(['user', 'vet'] as const).map((r) => (
          <button
            key={r}
            type="button"
            className={`chip${role === r ? ' active' : ''}`}
            aria-pressed={role === r}
            onClick={() => setRole(r)}
          >
            {r === 'user' ? t('admin.usersCommunity') : t('admin.usersVets')}
          </button>
        ))}
      </div>

      <label className="field" style={{ marginBottom: 10 }}>
        <span className="field__label">{t('admin.usersSearch')}</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin.usersSearchPlaceholder')}
          autoComplete="off"
        />
      </label>

      <div className="admin-sort">
        <span className="field__label" style={{ margin: 0 }}>{t('admin.sortBy')}</span>
        <div className="chip-row">
          {sortOptions.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`chip${sort === o.value ? ' active' : ''}`}
              aria-pressed={sort === o.value}
              onClick={() => setSort(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {!loading && users.length === 0 && <div className="empty-state">{t('admin.usersNone')}</div>}

      {users.map((u) => (
        <button key={u.id} type="button" className="list-row admin-user-row" onClick={() => setSelectedId(u.id)}>
          <Avatar name={u.display_name} url={u.avatar_url} />
          <div className="list-row__main" style={{ minWidth: 0, flex: 1 }}>
            <div className="admin-user-row__name">
              <span className="list-row__title">{u.display_name}</span>
              {u.banned && <span className="admin-badge admin-badge--banned">{t('admin.badgeBanned')}</span>}
              {u.is_admin && <span className="admin-badge admin-badge--admin">{t('admin.badgeAdmin')}</span>}
            </div>
            <div className="list-row__sub">{u.email ?? '—'}</div>
            <div className="admin-user-row__meta">
              <span>{u.role === 'vet' ? t('admin.roleVet') : t('admin.roleUser')}</span>
              <span>{t('admin.metaXp', { n: u.xp })}</span>
              <span>{t('admin.metaRescues', { n: u.cases_helped })}</span>
              <span>{joinDate(u.created_at)}</span>
            </div>
          </div>
        </button>
      ))}

      {loading && <div className="spinner" />}
      {!loading && hasMore && (
        <button type="button" className="btn btn--ghost btn--small" onClick={() => void load(users.length)} style={{ width: '100%' }}>
          {t('admin.usersLoadMore')}
        </button>
      )}
    </>
  );
}
