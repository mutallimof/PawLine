/**
 * Sensitive content — a device-only choice of which case photos start
 * blurred. Stored in localStorage (this browser only, never on the account);
 * every read and write is guarded, so a blocked or private-mode storage
 * simply falls back to the default.
 *
 *   critical (default) — photos of critical cases start blurred (the
 *                         behaviour before this setting existed)
 *   all                 — every case photo starts blurred
 *   never               — nothing starts blurred
 *
 * Any photo can still be revealed or hidden with one tap.
 */
import { useSyncExternalStore } from 'react';

export type SensitiveMode = 'critical' | 'all' | 'never';
export const SENSITIVE_MODES: readonly SensitiveMode[] = ['critical', 'all', 'never'];

const KEY = 'pawline-sensitive-content';
const EVENT = 'pawline-sensitive-content';

export function getSensitiveMode(): SensitiveMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'all' || v === 'never' ? v : 'critical';
  } catch {
    return 'critical';
  }
}

export function setSensitiveMode(mode: SensitiveMode): void {
  try {
    if (mode === 'critical') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* storage blocked — the choice lasts until reload */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange(); // another tab changed it
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Does a photo of a case with this urgency start blurred under `mode`? */
export function startsBlurred(mode: SensitiveMode, urgency: string): boolean {
  return mode === 'all' || (mode === 'critical' && urgency === 'critical');
}

/** The current mode, re-rendering when it changes (this tab or another). */
export function useSensitiveMode(): SensitiveMode {
  return useSyncExternalStore(subscribe, getSensitiveMode, () => 'critical');
}
