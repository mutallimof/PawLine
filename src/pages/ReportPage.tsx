/**
 * Report flow — the app's most important screen, usable WITHOUT an account.
 * Photo(s) → animal type → condition → pin on the map → send.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { createCase } from '../lib/api';
import { PinDropMap } from '../components/maps';
import { useToast } from '../components/ui';
import { DEFAULT_CENTER, getCurrentPosition, type LatLng } from '../lib/geo';
import { t } from '../i18n';
import type { AnimalType } from '../lib/types';
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
  const [guestName, setGuestName] = useState('');
  const [location, setLocation] = useState<LatLng>(DEFAULT_CENTER);
  const [submitting, setSubmitting] = useState(false);

  // Center the pin on the reporter's location as soon as the page opens —
  // in the field, the reporter is almost always standing next to the animal.
  useEffect(() => {
    getCurrentPosition().then(setLocation).catch(() => {});
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

    setSubmitting(true);
    try {
      const caseId = await createCase({
        animal,
        description: description.trim(),
        lat: location.lat,
        lng: location.lng,
        addressHint: addressHint.trim(),
        guestName: user ? null : guestName.trim() || null,
        reporterId: user?.id ?? null,
        photos: photos.map((p) => p.file),
      });
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      toast(t('report.success'));
      navigate(`/case/${caseId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : t('common.error'));
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
      <span className="field__label">{t('report.location')}</span>
      <p className="page-subtitle" style={{ marginBottom: 8 }}>
        {t('report.locationHelp')}
      </p>
      <div style={{ marginBottom: 16 }}>
        <PinDropMap value={location} onChange={setLocation} />
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

      <button className="btn btn--primary" onClick={submit} disabled={submitting}>
        {submitting ? t('report.submitting') : t('report.submit')}
      </button>
    </div>
  );
}
