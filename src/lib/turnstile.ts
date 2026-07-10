/**
 * Cloudflare Turnstile — bot protection on the anonymous (guest) sign-in
 * that backs guest reporting.
 *
 * Design: OPTIONAL and gracefully degrading. If VITE_TURNSTILE_SITE_KEY is
 * set, a guest's first report solves a Turnstile challenge (usually
 * invisible) and passes the token to Supabase, which verifies it server-side
 * (configured in the dashboard — see OPERATOR_GUIDE §Turnstile). If the key
 * is absent, reporting works exactly as before; the database circuit breaker
 * (migration 005) still bounds abuse. This lets the operator turn real
 * bot-protection on with one env var + one dashboard toggle, no code change.
 *
 * We load the script on demand and render an invisible widget once, reusing
 * it for subsequent tokens.
 */

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export function turnstileEnabled(): boolean {
  return !!SITE_KEY;
}

interface TurnstileAPI {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  execute: (id: string, opts?: Record<string, unknown>) => void;
  reset: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileAPI;
    __pawlineTurnstileReady?: Promise<void>;
  }
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (window.__pawlineTurnstileReady) return window.__pawlineTurnstileReady;
  window.__pawlineTurnstileReady = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('turnstile-load-failed'));
    document.head.appendChild(s);
  });
  return window.__pawlineTurnstileReady;
}

let widgetId: string | null = null;
let container: HTMLElement | null = null;

/**
 * Obtain a fresh Turnstile token, or null if Turnstile isn't configured.
 * Rejects only on genuine widget failure so the caller can decide whether to
 * hard-block or fall through.
 */
export async function getTurnstileToken(): Promise<string | null> {
  if (!SITE_KEY) return null;
  await loadScript();
  const api = window.turnstile;
  if (!api) return null;

  if (!container) {
    container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '0';
    container.style.left = '-9999px';
    document.body.appendChild(container);
  }

  return new Promise<string | null>((resolve, reject) => {
    const opts = {
      sitekey: SITE_KEY,
      size: 'invisible' as const,
      callback: (token: string) => resolve(token),
      'error-callback': () => reject(new Error('turnstile-error')),
      'timeout-callback': () => reject(new Error('turnstile-timeout')),
    };
    try {
      if (widgetId === null) {
        widgetId = api.render(container as HTMLElement, opts);
      } else {
        api.reset(widgetId);
      }
      api.execute(widgetId, opts);
    } catch (e) {
      reject(e instanceof Error ? e : new Error('turnstile-failed'));
    }
  });
}
