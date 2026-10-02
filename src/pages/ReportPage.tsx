/**
 * Report flow — the app's most important screen, usable WITHOUT an account.
 * Photo(s) → animal type → condition → pin on the map → send.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { createCase, fetchCases, isBannedError, isGuestConsentError, openVetsNear } from '../lib/api';
import { isNetworkError, queueReport } from '../lib/offlineQueue';
import { cleanPhotoFile, PhotoPrivacyError } from '../lib/photos';
import { PinDropMap } from '../components/maps';
import { ScreenHeader, useToast } from '../components/ui';
import { ConsentChecks } from '../components/legal';
import { TERMS_VERSION } from '../lib/consent';
import { DEFAULT_CENTER, distanceKm, getCurrentPosition, type LatLng } from '../lib/geo';
import { t } from '../i18n';
import type { AnimalType, CaseWithDetails, InjuryType, SpotType, UrgencyLevel } from '../lib/types';
import { INJURY_TYPES, SPOT_TYPES, URGENCY_LEVELS, type CaseNeed } from '../lib/types';
import { NeedsPicker } from '../components/CaseNeeds';
import { animalEmoji, IconCamera } from '../components/Icons';

export default function ReportPage() {
  const { user, isGuest } = useAuth();
  // A real account, not merely a session. Someone who browsed the feed before
  // opening this page already holds an ANONYMOUS session (ensureSession, in
  // api.ts, mints one to sign photo URLs), so `user` is set for them too —
  // but they are still a guest, and their report must go in as one. Treating
  // them as registered is what sent reporter_id = <anon uid>, which the
  // cases INSERT policy (003) rejects outright with 42501.
  const isRegistered = !!user && !isGuest;
  // 035: guests confirm 18+ and the Terms on the form; the consent is sent
  // with the report. Accounts already passed ConsentGate (034).
  const [ageOk, setAgeOk] = useState(false);
  const [termsOk, setTermsOk] = useState(false);
  const consentOk = isRegistered || (ageOk && termsOk);
  const navigate = useNavigate();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  // One entry per photo: the file plus its preview object URL. Keeping them
  // paired means removal is a single splice and URLs are revoked exactly once.
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [animal, setAnimal] = useState<AnimalType>('dog');
  const [description, setDescription] = useState('');
  const [addressHint, setAddressHint] = useState('');
  const [injuryType, setInjuryType] = useState<InjuryType | null>(null);
  const [spotType, setSpotType] = useState<SpotType | null>(null);
  const [needs, setNeeds] = useState<CaseNeed[]>([]);
  // Defaults to 'medium', not null — unlike injury/spot, urgency always
  // has some value; pre-selecting saves a mandatory tap while staying
  // adjustable.
  const [urgency, setUrgency] = useState<UrgencyLevel>('medium');
  const [guestName, setGuestName] = useState('');
  const [location, setLocation] = useState<LatLng>(DEFAULT_CENTER);
  // Audit P2: DEFAULT_CENTER is a plausible-looking wrong location. Track
  // whether the user (or GPS/search) ever actually set the pin; the map's
  // automatic first emit doesn't count.
  const [locationTouched, setLocationTouched] = useState(false);

  // Transparency, not a blocker: if no clinic near the animal is open right
  // now (3am, say), the reporter deserves to know help may be slower — but
  // the animal still needs to be FOUND, so reporting stays fully open.
  const [noVetsOpen, setNoVetsOpen] = useState(false);
  useEffect(() => {
    if (!locationTouched) return; // default city centre isn't a real location
    let cancelled = false;
    void openVetsNear(location.lat, location.lng, 25)
      .then((n) => {
        if (!cancelled) setNoVetsOpen(n === 0);
      })
      .catch(() => {
        if (!cancelled) setNoVetsOpen(false); // never scare people on a network blip
      });
    return () => {
      cancelled = true;
    };
  }, [location, locationTouched]);
  const firstEmit = useRef(true);
  const onPinChange = (p: LatLng) => {
    setLocation(p);
    if (firstEmit.current) {
      firstEmit.current = false;
      return;
    }
    setLocationTouched(true);
  };
  const [submitting, setSubmitting] = useState(false);
  // Proximity warning (advisory only — see submit()/finalize() below): an
  // open case found within ~50m of this report's location, shown once,
  // right before the report is sent. Neither of its two buttons skips
  // creating this report; they only change where the reporter lands after.
  const [nearbyCase, setNearbyCase] = useState<CaseWithDetails | null>(null);

  // Center the pin on the reporter's location as soon as the page opens —
  // in the field, the reporter is almost always standing next to the animal.
  useEffect(() => {
    getCurrentPosition()
      .then((p) => {
        setLocation(p);
        setLocationTouched(true);
        firstEmit.current = false;
      })
      .catch(() => {});
  }, []);

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const room = Math.max(0, 5 - photos.length);
    // Clean each photo now (re-encoded, location/EXIF removed): the preview
    // shows exactly what will be uploaded, and a photo that can't be cleaned
    // is refused here rather than failing the report at submit.
    const added: { file: File; url: string }[] = [];
    for (const original of Array.from(files).slice(0, room)) {
      try {
        const file = await cleanPhotoFile(original);
        added.push({ file, url: URL.createObjectURL(file) });
      } catch (e) {
        toast(e instanceof PhotoPrivacyError ? e.message : t('common.error'));
      }
    }
    setPhotos((prev) => [...prev, ...added].slice(0, 5));
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const submit = async () => {
    if (photos.length === 0) return toast(t('report.needPhoto'));
    if (description.trim().length < 3) return toast(t('report.needDescription'));
    if (!consentOk) return toast(t('report.consentRequired'));

    if (submitting) return; // double-tap guard (audit P1)
    // Audit P2: don't let a never-touched default pin ship silently.
    if (!locationTouched && !window.confirm(t('report.confirmDefaultLoc'))) return;

    // Proximity warning — advisory only, never a gate. Reuses the exact
    // client-side fetch-then-distanceKm-filter pattern HomePage's own
    // radius filter already uses (fetchCases() + distanceKm()), rather
    // than a new DB function — a ~50m check doesn't need one. Skipped
    // outright when offline, same as the rest of this online-only path;
    // any failure here (network blip) must never block the actual report.
    if (navigator.onLine) {
      try {
        const cases = await fetchCases();
        const nearby = cases.find(
          (c) => c.status === 'open' && distanceKm(location, { lat: c.lat, lng: c.lng }) <= 0.05
        );
        if (nearby) {
          setNearbyCase(nearby);
          return; // paused — the modal's two buttons both call finalize()
        }
      } catch {
        // Couldn't check — fall through and report anyway.
      }
    }

    await finalize();
  };

  // Actually creates the report. `existingCaseId`, when set (the "it's the
  // same one" path), only changes where we navigate afterward — the report
  // itself is created either way, so a reporter who was right to flag it
  // still has a durable record, and one who was wrong hasn't lost anything.
  const finalize = async (existingCaseId?: string) => {
    setNearbyCase(null);
    const input = {
      animal,
      description: description.trim(),
      lat: location.lat,
      lng: location.lng,
      addressHint: addressHint.trim(),
      // reporter_id MUST be null for any guest, however their session was
      // minted: the INSERT policy only admits an anonymous session when
      // reporter_id is null (and only a registered one when it equals
      // auth.uid()). creator_uid still records the device server-side, so
      // the per-device rate limits (003/021) are unaffected.
      guestName: isRegistered ? null : guestName.trim() || null,
      reporterId: isRegistered ? user.id : null,
      injuryType,
      spotType,
      urgency,
      needs,
      photos: photos.map((p) => p.file),
      termsVersion: isRegistered ? null : TERMS_VERSION,
    };

    // Fully offline? Queue immediately — don't make the person watch a
    // spinner fail next to an injured animal.
    if (!navigator.onLine) {
      await queueReport(input);
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      toast(t('report.queuedOffline'));
      navigate('/');
      return;
    }

    setSubmitting(true);
    try {
      const caseId = await createCase(input);
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      toast(t('report.success'));
      navigate(`/case/${existingCaseId ?? caseId}`);
    } catch (e) {
      if (isBannedError(e)) {
        // Before the network branch: a refused account's report must never
        // be queued — it would be refused again on every flush.
        toast(t('error.banned'));
      } else if (e instanceof PhotoPrivacyError) {
        // Checked first: offline, isNetworkError() says yes to anything,
        // and a queued report with this photo could never be sent.
        toast(e.message);
      } else if (isNetworkError(e)) {
        // Signal died mid-flight (audit P1) — persist and reassure.
        await queueReport(input);
        photos.forEach((p) => URL.revokeObjectURL(p.url));
        toast(t('report.queuedOffline'));
        navigate('/');
      } else if (e instanceof Error && e.message === 'captcha-failed') {
        toast(t('report.captchaFailed'));
      } else if (isGuestConsentError(e)) {
        toast(t('report.consentRequired'));
      } else {
        // A raw RLS rejection (42501, e.g. the guest-session race this flow
        // guards against) is Postgres-speak, not something a reporter can
        // act on — show a plain, always-visible message instead of either
        // that jargon or nothing at all.
        const code = (e as { code?: string } | null)?.code;
        toast(code === '42501' ? t('report.submitFailed') : e instanceof Error ? e.message : t('common.error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page report">
      {/* Proximity warning — advisory only. Neither button skips creating
          this report; "same one" only changes where we navigate after. */}
      {nearbyCase && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('report.nearbyTitle')}>
          <div className="modal-sheet">
            <h2 className="modal-sheet__title">{t('report.nearbyTitle')}</h2>
            <p className="modal-sheet__intro">{t('report.nearbyBody')}</p>
            <button
              className="btn btn--secondary"
              disabled={submitting}
              onClick={() => void finalize(nearbyCase.id)}
            >
              {t('report.nearbySame')}
            </button>
            <button
              className="btn btn--primary"
              style={{ marginTop: 8 }}
              disabled={submitting}
              onClick={() => void finalize()}
            >
              {t('report.nearbyDifferent')}
            </button>
          </div>
        </div>
      )}

      <ScreenHeader title={t('report.title')} />
      <p className="v2-sub">{t('report.subtitle')}</p>

      {!isRegistered && <div className="banner banner--info">{t('report.guestNote')}</div>}

      {/* Photos */}
      <span className="field__label">{t('report.photos')}</span>
      <p className="page-subtitle" style={{ marginTop: -4 }}>{t('report.cameraHint')}</p>
      <div className="photo-grid" style={{ marginBottom: 16 }}>
        {photos.map((p, i) => (
          <div key={p.url} className="photo-thumb">
            <img src={p.url} alt={`${t('report.photos')} ${i + 1}`} />
            <button
              type="button"
              className="photo-thumb__remove"
              onClick={() => removePhoto(i)}
              aria-label={t('report.removePhoto')}
            >
              ×
            </button>
          </div>
        ))}
        {photos.length < 5 && (
          <button type="button" className="photo-add" onClick={() => fileInput.current?.click()}>
            <IconCamera size={22} />
            {t('report.addPhoto')}
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          /* ANTI-FRAUD: `capture` opens the CAMERA directly on mobile
             browsers instead of the photo library, so reports carry a live
             photo taken on the spot. One shot per tap (no `multiple` — the
             capture+multiple combo falls back to the gallery picker on some
             Androids, which would defeat the purpose); tap "Add photo"
             again for more. Deterrent, not foolproof: desktop browsers
             ignore `capture` and show a file picker — acceptable, since
             street reports are overwhelmingly mobile. */
          capture="environment"
          hidden
          onChange={(e) => void addPhotos(e.target.files)}
        />
      </div>

      {/* Animal type */}
      <span className="field__label">{t('report.animalType')}</span>
      <div className="chip-row" style={{ marginBottom: 16 }}>
        {(['dog', 'cat', 'other'] as AnimalType[]).map((a) => (
          <button
            key={a}
            type="button"
            className={`chip${animal === a ? ' active' : ''}`}
            onClick={() => setAnimal(a)}
          >
            {animalEmoji(a)} {t(`animal.${a}` as const)}
          </button>
        ))}
      </div>

      {/* Urgency */}
      <span className="field__label">{t('report.urgencyLabel')}</span>
      <div className="chip-row" style={{ marginBottom: 16 }}>
        {URGENCY_LEVELS.map((u) => (
          <button
            key={u}
            type="button"
            className={`chip chip--urgency-${u}${urgency === u ? ' active' : ''}`}
            onClick={() => setUrgency(u)}
          >
            {t(`urgency.${u}` as const)}
          </button>
        ))}
      </div>

      {/* Description */}
      <label className="field">
        <span className="field__label">{t('report.description')}</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('report.descriptionPlaceholder')}
          maxLength={2000}
        />
      </label>

      {/* Location */}
      {/* Structured, language-independent fields (audit 4b) — each person
          sees these in their own language regardless of who picked them. */}
      <span className="field__label">{t('report.injuryLabel')}</span>
      <div className="chip-row" style={{ marginBottom: 14 }}>
        {INJURY_TYPES.map((k) => (
          <button
            key={k}
            type="button"
            className={`chip${injuryType === k ? ' active' : ''}`}
            onClick={() => setInjuryType(injuryType === k ? null : k)}
          >
            {t(`injury.${k}` as const)}
          </button>
        ))}
      </div>

      <span className="field__label">{t('report.spotLabel')}</span>
      <div className="chip-row" style={{ marginBottom: 16 }}>
        {SPOT_TYPES.map((k) => (
          <button
            key={k}
            type="button"
            className={`chip${spotType === k ? ' active' : ''}`}
            onClick={() => setSpotType(spotType === k ? null : k)}
          >
            {t(`spot.${k}` as const)}
          </button>
        ))}
      </div>

      <span className="field__label">{t('need.reportLabel')}</span>
      <div style={{ marginBottom: 16 }}>
        <NeedsPicker value={needs} onChange={setNeeds} />
      </div>

      <span className="field__label">{t('report.location')}</span>
      <p className="page-subtitle" style={{ marginBottom: 8 }}>
        {t('report.locationHelp')}
      </p>
      <div style={{ marginBottom: 16 }}>
        <PinDropMap value={location} onChange={onPinChange} />
      </div>

      <label className="field">
        <span className="field__label">{t('report.addressHint')}</span>
        <input
          value={addressHint}
          onChange={(e) => setAddressHint(e.target.value)}
          placeholder={t('report.addressHintPlaceholder')}
          maxLength={120}
        />
      </label>

      {!isRegistered && (
        <label className="field">
          <span className="field__label">{t('report.guestName')}</span>
          <input value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={60} />
        </label>
      )}

      {/* Honest heads-up — never a blocker. The animal must still be found. */}
      {noVetsOpen && (
        <div className="banner banner--warn" role="status">
          {t('report.noVetsOpen')}
        </div>
      )}

      {!isRegistered && (
        <ConsentChecks age={ageOk} terms={termsOk} onAge={setAgeOk} onTerms={setTermsOk} />
      )}

      <button className="btn btn--primary" onClick={submit} disabled={submitting || !consentOk}>
        {submitting ? t('report.submitting') : t('report.submit')}
      </button>
    </div>
  );
}
