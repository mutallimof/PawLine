/**
 * Minimal reactive i18n layer.
 *
 * Every user-facing string goes through t('key'). Three locales ship:
 * Azerbaijani (default), Turkish, English.
 *
 * Reactivity: the current locale is module state with a subscriber set.
 * The app shell subscribes via useSyncExternalStore, so switching language
 * re-renders the whole tree and every t() call re-evaluates — no per-string
 * wiring needed.
 *
 * Persistence: localStorage always (works for guests); for registered users
 * the profiles.locale column is authoritative and is applied on sign-in
 * (see AuthContext) and written by the language switcher.
 */

import { en } from './en';
import { az } from './az';
import { tr } from './tr';

export type Dict = typeof en;
export type LocaleCode = 'az' | 'tr' | 'en';

export const SUPPORTED_LOCALES: Record<LocaleCode, Dict> = { az, tr, en };

/** Native-language display names for the switcher. */
export const LOCALE_NAMES: Record<LocaleCode, string> = {
  az: 'Azərbaycanca',
  tr: 'Türkçe',
  en: 'English',
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
