/**
 * First-run onboarding — three steps, skippable, shown exactly once
 * (localStorage-gated). The pipeline (report → rescuer → verified vet) is
 * novel enough that new users won't intuit it from a map of pins; this is
 * the 30 seconds that makes everything after it make sense.
 */
import { useState } from 'react';
import { t } from '../i18n';
import { InkScene, type EmptyKind } from './Ink';

const KEY = 'pawline-onboarded-v1';

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'done';
  } catch {
    return false; // storage unavailable → don't trap the user in a loop
  }
}

// Each step gets a hand-inked scene, not an emoji — the report→rescuer→vet
// pipeline told in the app's own visual voice from the very first screen.
const STEPS = [
  { scene: 'search', title: 'onb.1title', body: 'onb.1body' },
  { scene: 'calm', title: 'onb.2title', body: 'onb.2body' },
  { scene: 'done', title: 'onb.3title', body: 'onb.3body' },
] as const satisfies readonly { scene: EmptyKind; title: string; body: string }[];

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;

  const finish = () => {
    try {
      localStorage.setItem(KEY, 'done');
    } catch {
      /* best effort */
    }
    onDone();
  };

  const s = STEPS[step];
  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label={t(s.title)}>
      <div className="onboarding__icon" aria-hidden="true">
        <InkScene kind={s.scene} size={150} />
      </div>
      <h1 className="onboarding__title">{t(s.title)}</h1>
      <p className="onboarding__body">{t(s.body)}</p>

      <div className="onboarding__dots" aria-hidden="true">
        {STEPS.map((_, i) => (
          <span key={i} className={`onboarding__dot${i === step ? ' active' : ''}`} />
        ))}
      </div>

      <div className="onboarding__actions">
        <button
          className="btn btn--primary"
          onClick={() => (last ? finish() : setStep(step + 1))}
        >
          {last ? t('onb.start') : t('onb.next')}
        </button>
        {!last && (
          <button className="link-btn" onClick={finish}>
            {t('onb.skip')}
          </button>
        )}
      </div>
    </div>
  );
}
