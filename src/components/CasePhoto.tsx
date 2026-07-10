/**
 * Case photo with blur-by-default (item 4e).
 *
 * Injured-animal photos are frequently graphic. Every case image renders
 * blurred behind a "may contain graphic content — tap to view" affordance,
 * on by default; one tap reveals it, and it can be re-hidden. This protects
 * users who don't want to be surprised by gore, and is the posture app-store
 * review expects. The blur is a real CSS filter on the actual <img>, so
 * nothing about the image leaks before the user opts in visually.
 *
 * Future scaling note (documented in OPERATIONS.md, not built now): an
 * automated content-severity check could pre-classify images so only
 * likely-graphic ones blur — optional, not blocking launch.
 */
import { useState } from 'react';
import { t } from '../i18n';

export function CasePhoto({
  url,
  alt,
  className,
}: {
  url: string;
  alt: string;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className={`case-photo${className ? ` ${className}` : ''}`}>
      <img
        src={url}
        alt={alt}
        className={revealed ? '' : 'case-photo__img--blurred'}
        draggable={false}
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
