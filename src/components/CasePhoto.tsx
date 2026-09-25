/**
 * Case photo, blurred when the case is CRITICAL (task 11).
 *
 * The reporter's own urgency call decides it: a case marked `critical` is the
 * one most likely to show a badly hurt animal, so its photos start blurred
 * behind a "may contain graphic content — tap to view" affordance, on every
 * screen that uses this component (feed cards, case detail). `high`, `medium`
 * and `low` start revealed. Either way one tap reveals or re-hides it.
 *
 * The blur is a real CSS filter on the actual <img>, so nothing about the
 * image leaks before the user opts in visually. Map pins don't use this
 * component (see maps.tsx) and are never blurred.
 */
import { useState } from 'react';
import { t } from '../i18n';
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
  /** The case's urgency. Required, so no screen can forget it: `critical`
   *  starts blurred, anything else starts revealed. */
  urgency: UrgencyLevel;
}) {
  const [revealed, setRevealed] = useState(urgency !== 'critical');

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
