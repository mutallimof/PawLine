/**
 * Case detail — the hub of a rescue.
 *
 * Renders differently depending on who's looking:
 *  - Anyone:            photos, paw-trail progress, timeline, case chat, watch.
 *  - Registered user:   "I'll rescue this animal" while the case is open.
 *  - The active rescuer: choose vet → depart → (drop at any point).
 *  - The selected vet:  confirm/decline the incoming animal, post updates,
 *                       confirm delivery (optionally with a photo).
 *
 * All state changes call the database RPCs; the UI updates via realtime.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCase } from '../hooks/useRealtime';
import {
  acceptCase,
  addDeliveryPhoto,
  fetchDuplicateFlags,
  reportContent,
  resolveDuplicateFlag,
  confirmDelivery,
  dropCase,
  isWatching,
  startTransport,
  unwatchCase,
  updateRescuerLocation,
  vetPostUpdate,
  vetRespond,
  watchCase,
} from '../lib/api';
import { EnRouteMap } from '../components/maps';
import { Avatar, PawTrail, StatusBadge, useToast } from '../components/ui';
import { IconBack, IconCamera } from '../components/Icons';
import { hasKey, t } from '../i18n';
import type { DuplicateFlag } from '../lib/types';
import { timeAgo } from '../lib/time';
import { getCurrentPosition } from '../lib/geo';

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { caseData, events, loading } = useCase(id);
  const toast = useToast();
  const navigate = useNavigate();

  const [watching, setWatching] = useState(false);
  const [dupFlags, setDupFlags] = useState<DuplicateFlag[]>([]);
  // The emotional peak: celebrate only a LIVE transition to resolved, not
  // every visit to an already-resolved case.
  const [justResolved, setJustResolved] = useState(false);
  const prevStatus = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vetNote, setVetNote] = useState('');
  const deliveryPhotoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (id && user) isWatching(id, user.id).then(setWatching).catch(() => {});
  }, [id, user]);

  useEffect(() => {
    const status = caseData?.status ?? null;
    if (prevStatus.current && prevStatus.current !== 'resolved' && status === 'resolved') {
      setJustResolved(true);
    }
    prevStatus.current = status;
  }, [caseData?.status]);

  // Possible-duplicate flags (soft, advisory — see migration 003 §6).
  useEffect(() => {
    if (id) fetchDuplicateFlags(id).then(setDupFlags).catch(() => {});
  }, [id]);

  // Bonus feature: while en route, the rescuer's device shares a coarse
  // "last known location" every ~45s so watchers can follow along.
  useEffect(() => {
    if (!caseData || !user) return;
    if (caseData.status !== 'en_route' || caseData.rescuer_id !== user.id) return;
    const share = () =>
      getCurrentPosition()
        .then((p) => updateRescuerLocation(caseData.id, p.lat, p.lng))
        .catch(() => {});
    share();
    const timer = window.setInterval(share, 45_000);
    return () => window.clearInterval(timer);
  }, [caseData, user]);

  if (loading) return <div className="page"><div className="spinner" /></div>;
  if (!caseData) return <div className="page"><div className="empty-state">{t('common.error')}</div></div>;

  const isRescuer = !!user && caseData.rescuer_id === user.id;
  const isVet = !!user && caseData.vet_id === user.id;
  const reportPhotos = caseData.photos.filter((p) => p.kind === 'report');
  const deliveryPhotos = caseData.photos.filter((p) => p.kind === 'delivery');

  /** Run an action with busy state + error toast. */
  const run = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      // Audit P4: a double-tap or a race with another actor lands here with a
      // scary server message; the honest translation is "someone got there
      // first" — the realtime refresh shows the new state momentarily.
      if (/no pending request|already accepted/i.test(msg)) {
        toast(t('case.alreadyHandled'));
      } else {
        toast(msg || t('common.error'));
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleWatch = run(async () => {
    if (!user) return navigate('/auth');
    if (watching) {
      await unwatchCase(caseData.id);
      setWatching(false);
    } else {
      await watchCase(caseData.id);
      setWatching(true);
    }
  });

  const onDeliveryPhoto = async (files: FileList | null) => {
    if (!files?.[0]) return;
    setBusy(true);
    try {
      await addDeliveryPhoto(caseData.id, files[0]);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page page--flush">
      {/* Hero photo with status */}
      <div className="photo-hero">
        {reportPhotos[0] ? (
          <img src={reportPhotos[0].url} alt={caseData.description} />
        ) : (
          <div className="case-card__photo--empty" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 52 }}>
            🐾
          </div>
        )}
        <button
          className="back-btn"
          onClick={() => navigate(-1)}
          style={{ position: 'absolute', top: 10, left: 10, background: 'var(--card)', borderRadius: 999, padding: '8px 14px', boxShadow: 'var(--shadow)' }}
        >
          <IconBack size={18} /> {t('common.back')}
        </button>
        <div style={{ position: 'absolute', bottom: 10, left: 10 }}>
          <StatusBadge status={caseData.status} />
        </div>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {/* More photos */}
        {reportPhotos.length > 1 && (
          <div className="photo-grid" style={{ marginBottom: 12 }}>
            {reportPhotos.slice(1).map((p) => (
              <img key={p.id} src={p.url} alt="" />
            ))}
          </div>
        )}

        <p style={{ fontSize: 16, marginBottom: 6 }}>{caseData.description}</p>
        <p className="page-subtitle">
          {t('case.reportedBy', {
            name: caseData.reporter?.display_name ?? caseData.guest_name ?? t('case.guest'),
          })}
          {' · '}
          {timeAgo(caseData.created_at)}
          {caseData.address_hint ? ` · ${caseData.address_hint}` : ''}
        </p>

        {/* Signature element: the paw trail */}
        <div className="card" style={{ padding: '4px 8px 12px', marginBottom: 14 }}>
          <PawTrail status={caseData.status} />
        </div>

        {/* Possible duplicate — advisory only; the report always stands. */}
        {dupFlags.map((f) => {
          const canResolve =
            !!user && (user.id === caseData.reporter_id || user.id === caseData.rescuer_id);
          return (
            <div key={f.id} className="banner banner--warn" style={{ fontWeight: 600 }}>
              {t('dup.banner', { min: Math.max(f.minutes_apart, 1), m: f.distance_m })}
              {f.phash_distance !== null && f.phash_distance <= 12 && (
                <> {t('dup.photoMatch')}</>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <Link to={`/case/${f.similar_case_id}`} className="btn btn--ghost btn--small">
                  {t('dup.view')}
                </Link>
                {canResolve && (
                  <>
                    <button
                      className="btn btn--secondary btn--small"
                      disabled={busy}
                      onClick={run(async () => {
                        await resolveDuplicateFlag(f.id, true);
                        setDupFlags((prev) => prev.filter((x) => x.id !== f.id));
                        toast(t('dup.confirmed'));
                      })}
                    >
                      {t('dup.confirm')}
                    </button>
                    <button
                      className="btn btn--ghost btn--small"
                      disabled={busy}
                      onClick={run(async () => {
                        await resolveDuplicateFlag(f.id, false);
                        setDupFlags((prev) => prev.filter((x) => x.id !== f.id));
                      })}
                    >
                      {t('dup.dismiss')}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {caseData.status === 'resolved' && (
          <div className={`banner banner--success${justResolved ? ' celebrate' : ''}`}>
            {t('case.resolvedBanner')}
            {justResolved &&
              ['-70px','-30px','25px','65px'].map((dx, i) => (
                <span
                  key={i}
                  className="paw-burst"
                  aria-hidden="true"
                  style={{
                    ['--dx' as string]: dx,
                    ['--dy' as string]: `${-46 - i * 10}px`,
                    ['--rot' as string]: `${i % 2 ? 24 : -20}deg`,
                    animationDelay: `${i * 90}ms`,
                  }}
                >
                  🐾
                </span>
              ))}
          </div>
        )}

        {/* People involved */}
        {caseData.rescuer && (
          <Link to={`/user/${caseData.rescuer.id}`} className="list-row">
            <Avatar name={caseData.rescuer.display_name} url={caseData.rescuer.avatar_url} />
            <div className="list-row__main">
              <div className="list-row__title">{caseData.rescuer.display_name}</div>
              <div className="list-row__sub">{t('status.accepted')}</div>
            </div>
          </Link>
        )}
        {caseData.vet && (
          <Link to={`/vet/${caseData.vet.id}`} className="list-row">
            <div className="avatar" style={{ background: 'rgba(63,127,174,.14)', color: 'var(--status-enroute)' }}>+</div>
            <div className="list-row__main">
              <div className="list-row__title">{caseData.vet.clinic_name}</div>
              <div className="list-row__sub">{caseData.vet.address}</div>
            </div>
          </Link>
        )}

        {/* En-route view: origin → vet with last known rescuer location */}
        {(caseData.status === 'en_route' || caseData.status === 'vet_confirmed') && caseData.vet && (
          <div style={{ margin: '12px 0' }}>
            <EnRouteMap caseData={caseData} />
            {caseData.rescuer_loc_at && (
              <p className="page-subtitle" style={{ marginTop: 6 }}>
                {t('case.lastKnown')} · {timeAgo(caseData.rescuer_loc_at)}
              </p>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------------
            ACTIONS — role- and status-aware
           ------------------------------------------------------------------ */}
        <div style={{ display: 'grid', gap: 10, margin: '14px 0' }}>
          {/* Anyone signed-out, case open → prompt to sign in */}
          {caseData.status === 'open' && !user && (
            <Link to="/auth" className="btn btn--primary">{t('case.signInToHelp')}</Link>
          )}

          {/* Registered user, case open → accept */}
          {caseData.status === 'open' && user && (
            <>
              <button className="btn btn--primary" disabled={busy} onClick={run(() => acceptCase(caseData.id))}>
                🐾 {t('case.accept')}
              </button>
              <p className="page-subtitle" style={{ textAlign: 'center' }}>{t('case.acceptNote')}</p>
            </>
          )}

          {/* Rescuer: choose a vet */}
          {isRescuer && caseData.status === 'accepted' && (
            <Link to={`/case/${caseData.id}/vets`} className="btn btn--primary">
              🏥 {t('case.chooseVet')}
            </Link>
          )}

          {/* Rescuer: waiting for vet confirmation */}
          {isRescuer && caseData.status === 'vet_selected' && caseData.vet && (
            <div className="banner banner--warn">
              {t('case.waitingVet', { clinic: caseData.vet.clinic_name })}
            </div>
          )}

          {/* Rescuer: vet confirmed → depart */}
          {isRescuer && caseData.status === 'vet_confirmed' && caseData.vet && (
            <>
              <div className="banner banner--info">
                {t('case.arrivedAtVet', { clinic: caseData.vet.clinic_name })}
                {caseData.vet.phone ? ` · ${caseData.vet.phone}` : ''}
              </div>
              <button className="btn btn--primary" disabled={busy} onClick={run(() => startTransport(caseData.id))}>
                🚗 {t('case.depart')}
              </button>
            </>
          )}

          {/* Rescuer: drop (any active stage) */}
          {isRescuer && ['accepted', 'vet_selected', 'vet_confirmed', 'en_route'].includes(caseData.status) && (
            <button
              className="btn btn--danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t('case.dropConfirm'))) void run(() => dropCase(caseData.id))();
              }}
            >
              {t('case.drop')}
            </button>
          )}

          {/* Vet: confirm/decline incoming animal */}
          {isVet && caseData.status === 'vet_selected' && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn--success" disabled={busy} onClick={run(() => vetRespond(caseData.id, true))}>
                {t('case.vetAccept')}
              </button>
              <button className="btn btn--danger" disabled={busy} onClick={run(() => vetRespond(caseData.id, false))}>
                {t('case.vetDecline')}
              </button>
            </div>
          )}

          {/* Vet: confirm delivery */}
          {isVet && ['vet_confirmed', 'en_route'].includes(caseData.status) && (
            <>
              <button className="btn btn--success" disabled={busy} onClick={run(() => confirmDelivery(caseData.id))}>
                ✓ {t('case.confirmDelivery')}
              </button>
              <button className="btn btn--ghost" onClick={() => deliveryPhotoInput.current?.click()}>
                <IconCamera size={18} /> {t('case.confirmDeliveryNote')}
              </button>
            </>
          )}

          {/* Vet: post a free-form update at any stage they're attached */}
          {isVet && caseData.status !== 'open' && (
            <div className="card" style={{ padding: 12 }}>
              <label className="field" style={{ marginBottom: 8 }}>
                <span className="field__label">{t('case.vetUpdate')}</span>
                <input
                  value={vetNote}
                  onChange={(e) => setVetNote(e.target.value)}
                  placeholder={t('case.vetUpdatePlaceholder')}
                  maxLength={500}
                />
              </label>
              <button
                className="btn btn--secondary btn--small"
                disabled={busy || vetNote.trim().length === 0}
                onClick={run(async () => {
                  await vetPostUpdate(caseData.id, vetNote.trim());
                  setVetNote('');
                })}
              >
                {t('common.send')}
              </button>
            </div>
          )}

          {/* Vet delivery photo input (hidden) */}
          <input
            ref={deliveryPhotoInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => void onDeliveryPhoto(e.target.files)}
          />

          {/* Anyone signed in can flag abusive/fake content for admin review */}
          {user && (
            <button
              className="btn btn--ghost btn--small"
              style={{ alignSelf: 'flex-end' }}
              onClick={() => {
                const reason = window.prompt(t('mod.reportPrompt'));
                if (reason && reason.trim().length >= 3) {
                  void reportContent({
                    reporterId: user.id,
                    targetType: 'case',
                    targetCase: caseData.id,
                    reason: reason.trim(),
                  })
                    .then(() => toast(t('mod.reported')))
                    .catch((e) => toast(e instanceof Error ? e.message : t('common.error')));
                }
              }}
            >
              ⚑ {t('mod.report')}
            </button>
          )}

          {/* Everyone: case chat + watch */}
          <div style={{ display: 'flex', gap: 10 }}>
            <Link to={`/case/${caseData.id}/chat`} className="btn btn--secondary">
              💬 {t('case.openChat')}
            </Link>
            {user && !isRescuer && !isVet && (
              <button className={`btn ${watching ? 'btn--ghost' : 'btn--secondary'}`} disabled={busy} onClick={toggleWatch}>
                {watching ? `✓ ${t('case.watching')}` : `🔔 ${t('case.watch')}`}
              </button>
            )}
          </div>
        </div>

        {/* Delivery photos */}
        {deliveryPhotos.length > 0 && (
          <>
            <div className="section-label">{t('status.resolved')}</div>
            <div className="photo-grid">
              {deliveryPhotos.map((p) => (
                <img key={p.id} src={p.url} alt="" />
              ))}
            </div>
          </>
        )}

        {/* Timeline */}
        <div className="section-label">{t('case.timeline')}</div>
        <div className="card" style={{ padding: '6px 14px' }}>
          {events.length === 0 && (
            <p className="page-subtitle" style={{ padding: '8px 0' }}>—</p>
          )}
          {events.map((ev) => (
            <div key={ev.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {/* Machine-generated pipeline events are localized by type;
                    free-text updates (vet notes etc.) show verbatim. */}
                {hasKey(`event.${ev.type}`) ? t(`event.${ev.type}` as never) : ev.note}
              </div>
              <div className="page-subtitle" style={{ margin: 0 }}>{timeAgo(ev.created_at)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
