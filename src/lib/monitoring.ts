/**
 * Error monitoring — Sentry, initialized only when a DSN is configured, so
 * development and privacy-conscious deployments run with zero telemetry.
 *
 * Setup: create a free Sentry project (sentry.io → React), copy its DSN
 * into VITE_SENTRY_DSN in your deployment env vars. That's the whole setup.
 * The free tier is more than enough for a project this size.
 *
 * Deliberately conservative: error reports only — no tracing, no session
 * replay, no profiling, no PII. The Sentry organization is in the EU region
 * (ingest.de.sentry.io, Germany); the DSN decides where events go.
 */
import * as Sentry from '@sentry/react';

export function initErrorMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    // Errors only: no tracesSampleRate (tracing off), no replay or profiling
    // integrations. The privacy policy relies on this — keep them off.
    // Ignore noise that isn't actionable for a PWA in the field.
    ignoreErrors: [
      'ResizeObserver loop',
      'Network request failed',
      'Load failed',
      'Failed to fetch',
    ],
  });
}

/**
 * Explicit capture for React error-boundary crashes. Render errors caught
 * by a boundary never reach window.onerror, so without this call Sentry is
 * blind to exactly the crashes users actually see. No-op when unconfigured.
 */
export function captureBoundaryError(error: unknown): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.captureException(error);
}

/**
 * Explicit capture for any other handled failure we still want visibility
 * into — e.g. a retried background fetch that gives up and would otherwise
 * only ever reach a console.error nobody's watching. No-op when unconfigured.
 */
export function captureError(error: unknown): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.captureException(error);
}
