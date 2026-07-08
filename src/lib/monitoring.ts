/**
 * Error monitoring — Sentry, initialized only when a DSN is configured, so
 * development and privacy-conscious deployments run with zero telemetry.
 *
 * Setup: create a free Sentry project (sentry.io → React), copy its DSN
 * into VITE_SENTRY_DSN in your deployment env vars. That's the whole setup.
 * The free tier is more than enough for a project this size.
 *
 * Deliberately conservative: low trace sampling, no session replay, no PII.
 */
import * as Sentry from '@sentry/react';

export function initErrorMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0.05,
    // Ignore noise that isn't actionable for a PWA in the field.
    ignoreErrors: [
      'ResizeObserver loop',
      'Network request failed',
      'Load failed',
      'Failed to fetch',
    ],
  });
}
