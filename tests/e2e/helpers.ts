import { type Page, expect } from '@playwright/test';

/**
 * Every account this suite creates is tagged with the same run id, so a
 * human (or a follow-up script) can find and remove them later by email
 * prefix — see tests/e2e/README.md "Cleanup".
 */
export const RUN_ID = Date.now().toString(36);

export function testEmail(role: 'reporter' | 'rescuer' | 'vet'): string {
  return `pawline-e2e-${RUN_ID}-${role}@example.com`;
}

export const TEST_PASSWORD = 'E2e-test-pass-1!';

/** The app defaults to Azerbaijani; pin English before the first paint so
 * every locator below can match on stable, reviewable English strings. */
export async function setEnglishLocale(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('pawline-locale', 'en');
  });
}

export interface SignUpInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  isVet: boolean;
}

/**
 * Drives the real sign-up form. Throws with a clear message if the project
 * has email confirmation turned on (Supabase Auth → Sign In / Up) — this
 * suite can't click a confirmation link, so that setting must be off for a
 * test run, or the three accounts must be confirmed by hand first.
 */
export async function signUp(page: Page, input: SignUpInput): Promise<void> {
  await setEnglishLocale(page);
  await page.goto('/auth');
  await page.getByText('New here? Create an account').click();
  await page.getByLabel('First name').fill(input.firstName);
  await page.getByLabel('Last name').fill(input.lastName);
  await page.getByLabel('Phone (optional)').fill(input.phone);
  await page.getByLabel('Email').fill(input.email);
  await page.getByLabel('Password').fill(input.password);
  if (input.isVet) {
    await page.getByText('I’m registering a veterinary clinic').click();
  }
  await page.getByRole('button', { name: 'Create account' }).click();

  const emailGate = page.getByText('Check your inbox to confirm your email, then sign in.');
  if (await emailGate.isVisible({ timeout: 5_000 }).catch(() => false)) {
    throw new Error(
      `Sign-up for ${input.email} needs email confirmation before it can sign in. ` +
        'Disable "Confirm email" in Supabase Auth → Sign In / Up for this test run, ' +
        'or confirm this address manually and re-run.'
    );
  }
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await setEnglishLocale(page);
  await page.goto('/auth');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(?!auth)/, { timeout: 10_000 });
}

/** Fills the minimum valid report and submits it, returning the new case's
 * detail-page URL. Accepts the native confirm() for the untouched map pin —
 * see ReportPage.tsx's audit-P2 guard. */
export async function submitMinimalReport(page: Page, description: string): Promise<string> {
  page.once('dialog', (d) => void d.accept());
  await page.goto('/report');
  await page.setInputFiles('input[type="file"]', 'tests/e2e/fixtures/sample-photo.png');
  await page.getByLabel('Condition & details').fill(description);
  await page.getByRole('button', { name: 'Send report' }).click();
  await expect(page).toHaveURL(/\/case\/[^/]+$/, { timeout: 15_000 });
  return page.url();
}
