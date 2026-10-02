/**
 * Case photo that can start blurred behind a "may contain graphic content —
 * tap to view" affordance, on every screen that uses this component (feed
 * cards, case detail, profile lists).
 *
 * What starts blurred is the viewer's device setting (Settings → Sensitive
 * content, lib/sensitive.ts): by default photos of CRITICAL cases (the
 * reporter's own urgency call — the cases most likely to show a badly hurt
 * animal); or every photo; or none. Either way one tap reveals or re-hides
 * it, and a photo the viewer hasn't touched follows a change of setting.
 *
 * The blur is a real CSS filter on the actual <img>, so nothing about the
 * image leaks before the user opts in visually. Map pins don't use this
 * component (see maps.tsx) and are never blurred.
 */
import { useState } from 'react';
import { t } from '../i18n';
import { startsBlurred as blurredFor, useSensitiveMode } from '../lib/sensitive';
import type { UrgencyLevel } from '../lib/types';

export function CasePhoto({
  url,
  alt,
  className,
  onError,
  urgency,
}: {
  url: string;
  alt: string;
  className?: string;
  onError?: () => void;
  /** The case's urgency. Required, so no screen can forget it: under the
   *  default setting `critical` starts blurred. */
  urgency: UrgencyLevel;
}) {
  const mode = useSensitiveMode();
  const startsBlurred = blurredFor(mode, urgency);
  // null = the viewer hasn't tapped: follow the setting (live).
  const [choice, setRevealed] = useState<boolean | null>(null);
  const revealed = choice ?? !startsBlurred;

  return (
    <div className={`case-photo${className ? ` ${className}` : ''}`}>
      <img
        src={url}
        alt={alt}
        className={revealed ? '' : 'case-photo__img--blurred'}
        draggable={false}
        onError={onError}
      />
      {!revealed ? (
        <button
          type="button"
          className="case-photo__reveal"
          onClick={() => setRevealed(true)}
          aria-label={t('photo.tapToView')}
        >
          <span className="case-photo__reveal-icon" aria-hidden="true">👁️</span>
          <span className="case-photo__reveal-title">{t('photo.graphic')}</span>
          <span className="case-photo__reveal-cta">{t('photo.tapToView')}</span>
        </button>
      ) : (
        <button
          type="button"
          className="case-photo__hide"
          onClick={() => setRevealed(false)}
        >
          {t('photo.hide')}
        </button>
      )}
    </div>
  );
}
