/**
 * First-run onboarding — three steps, skippable, shown exactly once
 * (localStorage-gated). The pipeline (report → rescuer → verified vet) is
 * novel enough that new users won't intuit it from a map of pins; this is
 * the 30 seconds that makes everything after it make sense.
 *
 * Visuals follow the design's three splash frames (green / white / lavender).
 * The frames are flat bitmaps, so the photos are crops of them and the colors
 * are sampled from them — see the .onboarding block in index.css.
 */
import { useState } from 'react';
import { getLocale, LOCALE_NAMES, setLocale, SUPPORTED_LOCALES, t, type LocaleCode } from '../i18n';
import { updateProfile } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import splash1 from '../assets/onboarding/splash-1.webp';
import splash2 from '../assets/onboarding/splash-2.webp';
import splash3 from '../assets/onboarding/splash-3.webp';

const KEY = 'pawline-onboarded-v1';

export function shouldShowOnboarding(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'done';
  } catch {
    return false; // storage unavailable → don't trap the user in a loop
  }
}

// `cta` follows the design: "Get started" on the first and last frames,
// "Continue" on the middle one.
const STEPS = [
  { theme: 'green', art: splash1, title: 'onb.1title', body: 'onb.1body', cta: 'onb.start' },
  { theme: 'light', art: splash2, title: 'onb.2title', body: 'onb.2body', cta: 'onb.next' },
  { theme: 'lavender', art: splash3, title: 'onb.3title', body: 'onb.3body', cta: 'onb.start' },
] as const;

/** The design's brand mark: a paw whose main pad carries a heart. */
function PawHeartMark() {
  return (
    <svg className="onboarding__mark" viewBox="0 0 28 28" aria-hidden="true">
      <ellipse cx="5" cy="11.2" rx="2.9" ry="3.4" transform="rotate(-18 5 11.2)" />
      <ellipse cx="10.4" cy="5.4" rx="3" ry="3.6" transform="rotate(-6 10.4 5.4)" />
      <ellipse cx="17.6" cy="5.4" rx="3" ry="3.6" transform="rotate(6 17.6 5.4)" />
      <ellipse cx="23" cy="11.2" rx="2.9" ry="3.4" transform="rotate(18 23 11.2)" />
      <path
        fillRule="evenodd"
        d="M14 11.6c5.4 0 9.6 4.9 9.6 9.3 0 3.6-2.6 5.6-5.6 5.6-1.6 0-2.8-.6-4-.6s-2.4.6-4 .6c-3 0-5.6-2-5.6-5.6 0-4.4 4.2-9.3 9.6-9.3Zm0 7.1c-.8-1.5-3.6-1.4-3.6.8 0 1.8 2.2 3.3 3.6 4.3 1.4-1 3.6-2.5 3.6-4.3 0-2.2-2.8-2.3-3.6-.8Z"
      />
    </svg>
  );
}

/**
 * The design has no language control on these frames, but language has to be
 * choosable before any of the copy is legible — so a compact native select
 * sits opposite the brand (the 4-chip switcher doesn't fit beside it at 320px).
 */
function LanguageSelect() {
  const { user } = useAuth();
  const choose = (code: LocaleCode) => {
    setLocale(code); // persists to localStorage + notifies subscribers
    if (user) void updateProfile(user.id, { locale: code }).catch(() => {});
  };
  return (
    <select
      className="onboarding__lang"
      aria-label={t('profile.language')}
      value={getLocale()}
      onChange={(e) => choose(e.target.value as LocaleCode)}
    >
      {(Object.keys(SUPPORTED_LOCALES) as LocaleCode[]).map((code) => (
        <option key={code} value={code}>
          {LOCALE_NAMES[code]}
        </option>
      ))}
    </select>
  );
}

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
    <div
      className={`onboarding onboarding--${s.theme}`}
      role="dialog"
      aria-modal="true"
      aria-label={t(s.title)}
    >
      <div className="onboarding__frame">
        <header className="onboarding__top">
          <span className="onboarding__brand">
            <PawHeartMark />
            {t('app.name')}
          </span>
          <LanguageSelect />
        </header>

        <div className="onboarding__art">
          <img src={s.art} alt="" width={1973} height={961} />
        </div>

        <div className="onboarding__panel">
          <h1 className="onboarding__title">{t(s.title)}</h1>
          <p className="onboarding__body">{t(s.body)}</p>

          <div className="onboarding__actions">
            <button
              type="button"
              className="onboarding__cta"
              onClick={() => (last ? finish() : setStep(step + 1))}
            >
              {t(s.cta)}
            </button>
            {last ? (
              <span className="onboarding__skip-slot" aria-hidden="true" />
            ) : (
              <button type="button" className="onboarding__skip" onClick={finish}>
                {t('onb.skip')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
