/**
 * Report flow — the app's most important screen, usable WITHOUT an account.
 * Photo(s) → animal type → condition → pin on the map → send.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { createCase, openVetsNear } from '../lib/api';
import { isNetworkError, queueReport } from '../lib/offlineQueue';
import { PinDropMap } from '../components/maps';
import { useToast } from '../components/ui';
import { DEFAULT_CENTER, getCurrentPosition, type LatLng } from '../lib/geo';
import { t } from '../i18n';
import type { AnimalType, InjuryType, SpotType } from '../lib/types';
import { INJURY_TYPES, SPOT_TYPES } from '../lib/types';
import { animalEmoji, IconCamera } from '../components/Icons';

export default function ReportPage() {
  const { user } = useAuth();
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

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const room = Math.max(0, 5 - photos.length);
    const added = Array.from(files)
      .slice(0, room)
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPhotos((prev) => [...prev, ...added]);
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

    if (submitting) return; // double-tap guard (audit P1)
    // Audit P2: don't let a never-touched default pin ship silently.
    if (!locationTouched && !window.confirm(t('report.confirmDefaultLoc'))) return;

    const input = {
      animal,
      description: description.trim(),
      lat: location.lat,
      lng: location.lng,
      addressHint: addressHint.trim(),
      guestName: user ? null : guestName.trim() || null,
      reporterId: user?.id ?? null,
      injuryType,
      spotType,
      photos: photos.map((p) => p.file),
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
      navigate(`/case/${caseId}`);
    } catch (e) {
      if (isNetworkError(e)) {
        // Signal died mid-flight (audit P1) — persist and reassure.
        await queueReport(input);
        photos.forEach((p) => URL.revokeObjectURL(p.url));
        toast(t('report.queuedOffline'));
        navigate('/');
      } else if (e instanceof Error && e.message === 'captcha-failed') {
        toast(t('report.captchaFailed'));
      } else {
        toast(e instanceof Error ? e.message : t('common.error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">{t('report.title')}</h1>
      <p className="page-subtitle">{t('report.subtitle')}</p>

      {!user && <div className="banner banner--info">{t('report.guestNote')}</div>}

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
          onChange={(e) => addPhotos(e.target.files)}
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

      {!user && (
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


      <button className="btn btn--primary" onClick={submit} disabled={submitting}>
        {submitting ? t('report.submitting') : t('report.submit')}
      </button>
    </div>
  );
}
