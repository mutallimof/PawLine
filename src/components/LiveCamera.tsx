/**
 * In-app live camera — the ONLY way a photo enters a report or a clinic's
 * delivery/recovery photo. There is no file picker in either flow: a photo
 * has to be taken here and now, which is what makes a report credible.
 *
 * getUserMedia with the rear camera preferred; a switch button appears when
 * the device has more than one camera. Shutter → review (Retake / Use
 * photo). The frame is handed over as a JPEG File; callers run it through
 * cleanPhotoFile like any other photo (re-encode, no metadata).
 *
 * The stream is stopped whenever this view closes (unmount), the tab is
 * hidden or the page is left, and restarted when the tab comes back — no
 * camera is ever left running in the background.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import { IconCamera } from './Icons';

type Phase = 'starting' | 'live' | 'review' | 'denied' | 'unavailable';

function stopStream(s: MediaStream | null) {
  s?.getTracks().forEach((tr) => tr.stop());
}

export function LiveCamera({
  title,
  remaining,
  onCapture,
  onClose,
}: {
  title: string;
  /** How many more photos may be taken in this session (≥ 1). */
  remaining: number;
  /** Receives each accepted shot. May be async; the view waits for it. */
  onCapture: (file: File) => void | Promise<void>;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const aliveRef = useRef(true);
  const shutterRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>('starting');
  const [cameras, setCameras] = useState<string[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [left, setLeft] = useState(remaining);

  const start = useCallback(async (wanted: string | null) => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      // No API at all: an old browser, or a page not served over HTTPS.
      setPhase('unavailable');
      return;
    }
    setPhase('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: wanted
          ? { deviceId: { exact: wanted } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      // Closed (or hidden) while the permission prompt was open: don't keep it.
      if (!aliveRef.current || document.visibilityState === 'hidden') {
        stopStream(stream);
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? null);
      // Labels/ids are only complete once permission is granted.
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      if (!aliveRef.current) return;
      setCameras(devices.filter((d) => d.kind === 'videoinput' && d.deviceId).map((d) => d.deviceId));
      setPhase('live');
    } catch (e) {
      if (!aliveRef.current) return;
      const name = e instanceof DOMException ? e.name : '';
      setPhase(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
    }
  }, []);

  // Start on open; stop on close / unmount.
  useEffect(() => {
    aliveRef.current = true;
    void start(null);
    return () => {
      aliveRef.current = false;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [start]);

  // Tab hidden or page left → camera off; back → on again (same camera).
  const deviceRef = useRef(deviceId);
  deviceRef.current = deviceId;
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stopStream(streamRef.current);
        streamRef.current = null;
      } else if (aliveRef.current && !streamRef.current) {
        void start(deviceRef.current);
      }
    };
    const onPageHide = () => {
      stopStream(streamRef.current);
      streamRef.current = null;
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [start]);

  // Escape closes; the page behind doesn't scroll while the camera is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    if (phase !== 'live') return;
    // Back from review: some mobile browsers pause a video that was hidden.
    void videoRef.current?.play().catch(() => {});
    shutterRef.current?.focus();
  }, [phase]);

  // Drop the review preview's object URL when it's replaced or closed.
  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  const takeShot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob || !aliveRef.current) return;
        const file = new File([blob], 'camera.jpg', { type: 'image/jpeg' });
        setShot({ file, url: URL.createObjectURL(file) });
        setPhase('review');
      },
      'image/jpeg',
      0.92
    );
  };

  const usePhoto = async () => {
    if (!shot) return;
    setSaving(true);
    try {
      await onCapture(shot.file);
    } catch {
      // The caller has already said what went wrong; stay on this shot.
      if (aliveRef.current) setSaving(false);
      return;
    }
    if (!aliveRef.current) return;
    setSaving(false);
    setShot(null);
    if (left <= 1) return onClose();
    setLeft(left - 1);
    setPhase('live');
  };

  const switchCamera = () => {
    if (cameras.length < 2) return;
    const i = cameras.indexOf(deviceId ?? '');
    void start(cameras[(i + 1) % cameras.length]);
  };

  const blocked = phase === 'denied' || phase === 'unavailable';

  // Portal to <body>: the app shell creates a containing block, which would
  // otherwise keep this full-screen view beside the side nav.
  return createPortal(
    <div className="live-cam" role="dialog" aria-modal="true" aria-label={title}>
      <div className="live-cam__top">
        <button type="button" className="live-cam__close" onClick={onClose} aria-label={t('camera.close')}>
          ×
        </button>
        <span className="live-cam__title">{title}</span>
        {phase === 'live' && remaining > 1 ? (
          <span className="live-cam__count">{t('camera.left', { n: left })}</span>
        ) : (
          <span className="live-cam__count" />
        )}
      </div>

      <div className="live-cam__stage">
        <video
          ref={videoRef}
          className="live-cam__video"
          playsInline
          muted
          autoPlay
          hidden={phase !== 'live' && phase !== 'starting'}
        />
        {phase === 'review' && shot && <img className="live-cam__video" src={shot.url} alt={t('camera.preview')} />}
        {phase === 'starting' && <div className="live-cam__status" role="status">{t('camera.starting')}</div>}
        {blocked && (
          <div className="live-cam__blocked" role="alert">
            <IconCamera size={32} />
            <h2>{phase === 'denied' ? t('camera.deniedTitle') : t('camera.unavailableTitle')}</h2>
            <p>{t('camera.needLive')}</p>
            <p>{phase === 'denied' ? t('camera.deniedHelp') : t('camera.unavailableHelp')}</p>
            <button type="button" className="btn btn--primary" onClick={() => void start(null)}>
              {t('camera.retry')}
            </button>
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              {t('camera.close')}
            </button>
          </div>
        )}
      </div>

      {phase === 'live' && (
        <div className="live-cam__bar">
          <span className="live-cam__side" />
          <button
            ref={shutterRef}
            type="button"
            className="live-cam__shutter"
            onClick={takeShot}
            aria-label={t('camera.shutter')}
          />
          {cameras.length > 1 ? (
            <button type="button" className="live-cam__switch" onClick={switchCamera}>
              {t('camera.switch')}
            </button>
          ) : (
            <span className="live-cam__side" />
          )}
        </div>
      )}
      {phase === 'review' && (
        <div className="live-cam__bar live-cam__bar--review">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={saving}
            onClick={() => {
              setShot(null);
              setPhase(streamRef.current ? 'live' : 'starting');
              if (!streamRef.current) void start(deviceId);
            }}
          >
            {t('camera.retake')}
          </button>
          <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void usePhoto()}>
            {saving ? t('common.loading') : t('camera.use')}
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}
