/**
 * Minimal reactive i18n layer.
 *
 * Every user-facing string goes through t('key'). Four locales ship:
 * Azerbaijani (default), Turkish, English, Russian (Group H).
 *
 * Reactivity: the current locale is module state with a subscriber set.
 * The app shell subscribes via useSyncExternalStore, so switching language
 * re-renders the whole tree and every t() call re-evaluates — no per-string
 * wiring needed.
 *
 * Persistence: localStorage always (works for guests, incl. Russian — this
 * layer doesn't touch the database). For registered users the
 * profiles.locale column is ALSO supposed to be authoritative, but as of
 * this group its CHECK constraint (migration 002) and handle_new_user()'s
 * signup allow-list only permit ('az','tr','en') — 'ru' isn't in either.
 * That's a schema change (flagged, not written, per this group's
 * instruction) — see the note on LanguageSwitcher in ui.tsx. Until it
 * lands, a signed-in user choosing Russian keeps it for the session/device
 * via localStorage, but the server-side persist silently fails (already
 * caught elsewhere) and a fresh sign-in on another device falls back to
 * whatever profiles.locale actually holds.
 */

import { en } from './en';
import { az } from './az';
import { tr } from './tr';
import { ru } from './ru';

export type Dict = typeof en;
export type LocaleCode = 'az' | 'tr' | 'en' | 'ru';

export const SUPPORTED_LOCALES: Record<LocaleCode, Dict> = { az, tr, en, ru };

/** Native-language display names for the switcher. */
/**
 * Codes, not names: the switcher is a four-up .segmented track, and
 * "Azərbaycanca" / "Русский" were being ellipsised to "Azərb…" at a quarter of
 * its width. Two-letter codes are unambiguous and fit at any width. The
 * control carries an aria-label of "Language", so the codes are never the only
 * context a screen reader gets.
 */
export const LOCALE_NAMES: Record<LocaleCode, string> = {
  az: 'AZ',
  tr: 'TR',
  en: 'EN',
  ru: 'RU',
};

const STORAGE_KEY = 'pawline-locale';
const DEFAULT_LOCALE: LocaleCode = 'az'; // launch market first

function readStored(): LocaleCode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && v in SUPPORTED_LOCALES) return v as LocaleCode;
  } catch {
    // Private mode / storage disabled — fall through to the default.
  }
  return DEFAULT_LOCALE;
}

let current: LocaleCode = readStored();
const listeners = new Set<() => void>();

export function getLocale(): LocaleCode {
  return current;
}

export function setLocale(code: LocaleCode): void {
  if (code === current) return;
  current = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Best effort — the in-memory value still applies for this session.
  }
  document.documentElement.lang = code;
  listeners.forEach((fn) => fn());
}

/** Subscribe to locale changes (useSyncExternalStore-compatible). */
export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Translate a key, with optional {placeholder} interpolation. */
export function t(key: keyof Dict, vars?: Record<string, string | number>): string {
  let s: string = SUPPORTED_LOCALES[current][key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** True if `key` exists in the dictionaries (for dynamic keys like event types). */
export function hasKey(key: string): key is keyof Dict {
  return key in en;
}
