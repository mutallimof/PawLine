/**
 * Case detail — the hub of a rescue.
 *
 * Section order (Group F): location → title/description → status
 * (paw trail, resolution, rating, people, actions, event log) → photo →
 * case chat. Location leads because a rescuer's first question is always
 * "where" — everything else follows from that.
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
  recordSafetyAck,
  addDeliveryPhoto,
  fetchDuplicateFlags,
  fetchRatingForCase,
  rateVet,
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
import { CaseLocationMap, EnRouteMap } from '../components/maps';
import { Avatar, PawTrail, StatusBadge, useToast } from '../components/ui';
import { ReportButton } from '../components/Report';
import { CasePhoto } from '../components/CasePhoto';
import { animalEmoji, IconBack, IconCamera } from '../components/Icons';
import { hasKey, t } from '../i18n';
import { SafetyAck, hasAcceptedSafety } from '../components/legal';
import { Paw } from '../components/Ink';
import type { DuplicateFlag, VetRating } from '../lib/types';
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
  const [showSafety, setShowSafety] = useState(false);
  // The emotional peak: celebrate only a LIVE transition to resolved, not
  // every visit to an already-resolved case.
  const [justResolved, setJustResolved] = useState(false);
  const prevStatus = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vetNote, setVetNote] = useState('');
  const deliveryPhotoInput = useRef<HTMLInputElement>(null);
  // C2: vet rating on a resolved case (rescuer only, once per case).
  const [myRating, setMyRating] = useState<VetRating | null>(null);
  const [ratingValue, setRatingValue] = useState(0);
  const [ratingNote, setRatingNote] = useState('');
  const [ratingBusy, setRatingBusy] = useState(false);
  // Migration 018 (A2): tracks photos whose signed URL failed to load —
  // separate from photo.url being null outright (signing failed upstream);
  // both fall back to the same "photo unavailable" placeholder below.
  const [brokenPhotoIds, setBrokenPhotoIds] = useState<Set<string>>(new Set());
  const markPhotoBroken = (id: string) =>
    setBrokenPhotoIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

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

  // C2: has the rescuer already rated this resolved case's vet?
  useEffect(() => {
    if (caseData?.status === 'resolved' && user && caseData.rescuer_id === user.id) {
      fetchRatingForCase(caseData.id).then(setMyRating).catch(() => {});
    }
  }, [caseData?.id, caseData?.status, user]);

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

  const doAccept = run(async () => {
    await acceptCase(caseData!.id);
    void recordSafetyAck().catch(() => {}); // durable server record; best effort
  });

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

  const submitRating = async () => {
    if (!user || !caseData.vet || ratingValue < 1) return;
    setRatingBusy(true);
    try {
      await rateVet({
        caseId: caseData.id,
        vetId: caseData.vet.id,
        rescuerId: user.id,
        rating: ratingValue,
        note: ratingNote,
      });
      setMyRating({
        id: '',
        case_id: caseData.id,
        vet_id: caseData.vet.id,
        rescuer_id: user.id,
        rating: ratingValue,
        note: ratingNote.trim(),
        created_at: new Date().toISOString(),
      });
      toast(t('rating.thanks'));
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setRatingBusy(false);
    }
  };

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
    <div className="page">
      <button className="back-btn" onClick={() => navigate(-1)}>
        <IconBack size={18} /> {t('common.back')}
      </button>

      {/* ==================================================================
          1. LOCATION — leads, per Group F. The landmark text is the
          closest thing to a "street name" the report form collects
          (there's no reverse-geocoded address — see note in FIX_SPEC
          follow-up); the mini map gives it real visual weight.
         ================================================================== */}
      <div className="case-detail__map-card">
        <CaseLocationMap caseData={caseData} />
        <div className="case-detail__map-pill">
          📍 {caseData.address_hint || t('case.locationUnknown')}
        </div>
        <a
          className="case-detail__map-directions"
          href={`https://www.google.com/maps/search/?api=1&query=${caseData.lat},${caseData.lng}`}
        >
          🧭 {t('case.getDirections')}
        </a>
      </div>
      <div className="case-detail__map-legend">
        <span className="case-detail__map-legend-item">
          <span className="case-detail__map-legend-dot case-detail__map-legend-dot--case" aria-hidden="true" />
          {t('case.legendAnimal')}
        </span>
        {caseData.vet && (
          <span className="case-detail__map-legend-item">
            <span className="case-detail__map-legend-dot case-detail__map-legend-dot--vet" aria-hidden="true" />
            {caseData.vet.clinic_name}
          </span>
        )}
      </div>

      {/* ==================================================================
          2. TITLE AND DESCRIPTION
         ================================================================== */}
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
            {animalEmoji(caseData.animal)} {t(`animal.${caseData.animal}` as const)}
          </h1>
          <StatusBadge status={caseData.status} />
        </div>
        <p className="page-subtitle" style={{ marginBottom: 6 }}>
          {t('case.reportedBy', {
            name: caseData.reporter?.display_name ?? caseData.guest_name ?? t('case.guest'),
          })}
          {' · '}
          {timeAgo(caseData.created_at)}
        </p>
        <p className="case-detail__quote">{caseData.description}</p>
      </div>

      {/* ==================================================================
          3. STATUS TIMELINE — the pipeline, its history, who's involved,
          and everything that can move it forward, grouped as one idea.
         ================================================================== */}
      <div className="section-label">{t('case.rescueProgress')}</div>
      <div className="card" style={{ padding: 'var(--space-2xs) var(--space-xs) var(--space-sm)', marginBottom: 'var(--space-xl)' }}>
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

      {caseData.status === 'resolved' && justResolved && (
        // The emotional peak, given its due: a Fraunces arrival headline
        // over an ink bloom of paws that draw in from below, like prints
        // pressed into paper. Fires only on a LIVE transition.
        <div className="arrival">
          <div className="paw-bloom" aria-hidden="true">
            {[
              { l: '18%', s: 18, ty: '-54px', r: '-24deg', d: 120 },
              { l: '40%', s: 26, ty: '-72px', r: '8deg', d: 40 },
              { l: '62%', s: 20, ty: '-60px', r: '20deg', d: 200 },
              { l: '30%', s: 14, ty: '-40px', r: '-10deg', d: 280 },
              { l: '76%', s: 16, ty: '-48px', r: '16deg', d: 340 },
            ].map((p, i) => (
              <span
                key={i}
                style={{
                  left: p.l,
                  ['--ty' as string]: p.ty,
                  ['--r' as string]: p.r,
                  animationDelay: `${p.d}ms`,
                }}
              >
                <Paw size={p.s} />
              </span>
            ))}
          </div>
          <h2 className="arrival-title">{t('case.arrivalTitle')}</h2>
          <p className="voice-quiet arrival-sub">{t('case.arrivalSub')}</p>
        </div>
      )}
      {caseData.status === 'resolved' && !justResolved && (
        <div className="banner banner--success">{t('case.resolvedBanner')}</div>
      )}

      {/* C2: rate the vet — rescuer only, once per case */}
      {caseData.status === 'resolved' && user && caseData.rescuer_id === user.id && caseData.vet && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          {myRating ? (
            <>
              <div className="field__label" style={{ marginBottom: 4 }}>{t('rating.yourRating')}</div>
              <div style={{ fontSize: 22 }}>
                {'★'.repeat(myRating.rating)}
                <span style={{ color: 'var(--line)' }}>{'★'.repeat(5 - myRating.rating)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="field__label" style={{ marginBottom: 8 }}>
                {t('rating.prompt', { clinic: caseData.vet.clinic_name })}
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRatingValue(n)}
                    aria-label={t('rating.stars', { n })}
                    style={{
                      fontSize: 26,
                      lineHeight: 1,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      color: n <= ratingValue ? 'var(--coral)' : 'var(--line)',
                    }}
                  >
                    ★
                  </button>
                ))}
              </div>
              {ratingValue > 0 && (
                <>
                  <input
                    value={ratingNote}
                    onChange={(e) => setRatingNote(e.target.value)}
                    placeholder={t('rating.notePlaceholder')}
                    maxLength={500}
                    style={{ marginBottom: 8, width: '100%' }}
                  />
                  <button
                    className="btn btn--primary btn--small"
                    disabled={ratingBusy}
                    onClick={() => void submitRating()}
                  >
                    {t('rating.submit')}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* People involved */}
      {caseData.rescuer && (
        <>
          <div className="section-label">{t('case.currentRescue')}</div>
          <Link
            to={`/user/${caseData.rescuer.id}`}
            className="list-row"
            style={{ marginBottom: 'var(--space-xl)' }}
          >
            <Avatar name={caseData.rescuer.display_name} url={caseData.rescuer.avatar_url} />
            <div className="list-row__main">
              <div className="list-row__title">{caseData.rescuer.display_name}</div>
              <div className="list-row__sub">{t('status.accepted')}</div>
              {caseData.vet && (
                <div className="list-row__sub">{t('case.toClinic', { clinic: caseData.vet.clinic_name })}</div>
              )}
            </div>
          </Link>
        </>
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
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={() => {
                // First rescue ever → show the safety acknowledgment gate
                // right where the risk begins, not buried in settings.
                if (hasAcceptedSafety()) void doAccept();
                else setShowSafety(true);
              }}
            >
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
              {caseData.vet.contact_phone ? ` · ${caseData.vet.contact_phone}` : ''}
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
      </div>

      {/* Event log */}
      <div className="section-label">{t('case.timeline')}</div>
      {events.length === 0 ? (
        <p className="page-subtitle">—</p>
      ) : (
        <ol className="case-detail__timeline">
          {events.map((ev) => (
            <li key={ev.id} className="case-detail__timeline-item">
              <div className="case-detail__timeline-time">{timeAgo(ev.created_at)}</div>
              <div className="case-detail__timeline-text">
                {/* Machine-generated pipeline events are localized by type;
                    free-text updates (vet notes etc.) show verbatim. */}
                {hasKey(`event.${ev.type}`) ? t(`event.${ev.type}` as never) : ev.note}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* ==================================================================
          4. PHOTO
         ================================================================== */}
      {(reportPhotos.length > 0 || deliveryPhotos.length > 0) && (
        <>
          <div className="section-label">{t('report.photos')}</div>
          {reportPhotos[0] && (
            <div className="photo-hero" style={{ borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 12 }}>
              {reportPhotos[0].url && !brokenPhotoIds.has(reportPhotos[0].id) ? (
                <CasePhoto
                  url={reportPhotos[0].url}
                  alt={caseData.description}
                  onError={() => markPhotoBroken(reportPhotos[0].id)}
                  defaultRevealed
                />
              ) : (
                <div className="photo-unavailable">
                  <span aria-hidden="true">🐾</span>
                  <span>{t('photo.unavailable')}</span>
                </div>
              )}
            </div>
          )}
          {reportPhotos.length > 1 && (
            <div className="photo-grid" style={{ marginBottom: 12 }}>
              {reportPhotos.slice(1).map((p) =>
                p.url && !brokenPhotoIds.has(p.id) ? (
                  <CasePhoto key={p.id} url={p.url} alt="" onError={() => markPhotoBroken(p.id)} defaultRevealed />
                ) : (
                  <div key={p.id} className="photo-unavailable">
                    <span aria-hidden="true">🐾</span>
                  </div>
                )
              )}
            </div>
          )}
          {deliveryPhotos.length > 0 && (
            <>
              <div className="section-label">{t('status.resolved')}</div>
              <div className="photo-grid" style={{ marginBottom: 14 }}>
                {deliveryPhotos.map((p) =>
                  p.url && !brokenPhotoIds.has(p.id) ? (
                    <CasePhoto key={p.id} url={p.url} alt="" onError={() => markPhotoBroken(p.id)} defaultRevealed />
                  ) : (
                    <div key={p.id} className="photo-unavailable">
                      <span aria-hidden="true">🐾</span>
                    </div>
                  )
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* ==================================================================
          5. CASE CHAT
         ================================================================== */}
      <div className="case-detail__actions-stack">
        <Link to={`/case/${caseData.id}/chat`} className="btn btn--primary">
          💬 {t('case.openChat')}
        </Link>
        {user && !isRescuer && !isVet && (
          <button className={`btn ${watching ? 'btn--ghost' : 'btn--secondary'}`} disabled={busy} onClick={toggleWatch}>
            {watching ? `✓ ${t('case.watching')}` : `🔔 ${t('case.watch')}`}
          </button>
        )}
        {user && (
          <div className="case-detail__report-link">
            <ReportButton reporterId={user.id} targetType="case" targetCase={caseData.id} />
          </div>
        )}
      </div>

      {showSafety && (
        <SafetyAck
          onAccept={() => {
            setShowSafety(false);
            void doAccept();
          }}
          onCancel={() => setShowSafety(false)}
        />
      )}
    </div>
  );
}
