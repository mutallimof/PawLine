/**
 * Cloudflare Turnstile — optional bot protection on the guest (anonymous)
 * report path.
 *
 * Design decision: this is GRACEFULLY OPTIONAL. If VITE_TURNSTILE_SITE_KEY is
 * set, a guest solves a Turnstile challenge (usually invisible/managed — no
 * user friction in the common case) before their first anonymous report, and
 * the token is passed to signInAnonymously({ options: { captchaToken } }).
 * If the key is NOT set, the report flow works exactly as before — the
 * database circuit breaker (migration 005: 40 guest reports/hour platform-
 * wide) still bounds abuse. This lets the operator launch immediately and
 * turn on Turnstile the moment a spam wave appears, with zero code change.
 *
 * Setup is one dashboard step each side — see OPERATOR_GUIDE §Turnstile.
 */

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

export function turnstileEnabled(): boolean {
  return !!SITE_KEY;
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${SCRIPT_URL}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('turnstile-load-failed'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

interface TurnstileAPI {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      size?: 'normal' | 'flexible' | 'compact' | 'invisible';
      appearance?: 'always' | 'execute' | 'interaction-only';
    }
  ) => string;
  remove: (id: string) => void;
}

/**
 * Obtain a Turnstile token. Renders a managed widget into a transient,
 * off-screen container; in the common (invisible) case this resolves with
 * no user interaction. Rejects on load failure or timeout so callers can
 * decide whether to proceed without a token.
 */
export async function getTurnstileToken(timeoutMs = 12_000): Promise<string> {
  if (!SITE_KEY) throw new Error('turnstile-not-configured');
  await loadScript();

  const turnstile = (window as unknown as { turnstile?: TurnstileAPI }).turnstile;
  if (!turnstile) throw new Error('turnstile-unavailable');

  return new Promise<string>((resolve, reject) => {
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '80px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.zIndex = '4000';
    document.body.appendChild(container);

    let widgetId: string | null = null;
    const cleanup = () => {
      try {
        if (widgetId) turnstile.remove(widgetId);
      } catch {
        /* ignore */
      }
      container.remove();
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('turnstile-timeout'));
    }, timeoutMs);

    try {
      widgetId = turnstile.render(container, {
        sitekey: SITE_KEY,
        size: 'flexible',
        appearance: 'interaction-only', // invisible unless a challenge is needed
        callback: (token: string) => {
          window.clearTimeout(timer);
          cleanup();
          resolve(token);
        },
        'error-callback': () => {
          window.clearTimeout(timer);
          cleanup();
          reject(new Error('turnstile-error'));
        },
        'expired-callback': () => {
          window.clearTimeout(timer);
          cleanup();
          reject(new Error('turnstile-expired'));
        },
      });
    } catch (e) {
      window.clearTimeout(timer);
      cleanup();
      reject(e instanceof Error ? e : new Error('turnstile-render-failed'));
    }
  });
}
