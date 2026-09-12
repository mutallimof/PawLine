import { defineConfig, devices } from '@playwright/test';

/**
 * Runs against a deployed environment (Vercel), never a local dev server —
 * see tests/e2e/README.md for why, and for the manual step this suite
 * needs mid-run (approving the test vet clinic as an admin).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // the whole suite is one linear case lifecycle
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
