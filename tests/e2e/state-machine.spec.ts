import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';
import { RUN_ID, TEST_PASSWORD, setEnglishLocale, signIn, signUp, submitMinimalReport, testEmail } from './helpers';

/**
 * Walks one case through its full lifecycle as three real accounts, each in
 * its own browser context (so cookies/session never leak between roles):
 *
 *   reporter: report → (watches)
 *   rescuer:  accept → choose vet → depart → rate
 *   vet:      respond → confirm delivery
 *
 * Requires (see tests/e2e/README.md):
 *   E2E_BASE_URL        - the deployed app to test against
 *   E2E_ADMIN_EMAIL     - a profile with is_admin = true (SQL-editor only)
 *   E2E_ADMIN_PASSWORD  - that profile's password
 * The admin account approves the test vet clinic mid-run — there is no
 * self-service path around that gate, by design (vetSetup.pending).
 */

test.describe.serial('case state machine', () => {
  const reporterEmail = testEmail('reporter');
  const rescuerEmail = testEmail('rescuer');
  const vetEmail = testEmail('vet');
  const clinicName = `PawLine E2E Clinic ${RUN_ID}`;

  let browser: Browser;
  let reporterCtx: BrowserContext, rescuerCtx: BrowserContext, vetCtx: BrowserContext, adminCtx: BrowserContext;
  let reporter: Page, rescuer: Page, vet: Page, admin: Page;
  let caseUrl: string;

  test.beforeAll(async ({ browser: b }) => {
    browser = b;
    reporterCtx = await browser.newContext();
    rescuerCtx = await browser.newContext();
    vetCtx = await browser.newContext();
    adminCtx = await browser.newContext();
    reporter = await reporterCtx.newPage();
    rescuer = await rescuerCtx.newPage();
    vet = await vetCtx.newPage();
    admin = await adminCtx.newPage();
  });

  test.afterAll(async () => {
    await Promise.all([reporterCtx.close(), rescuerCtx.close(), vetCtx.close(), adminCtx.close()]);
  });

  test('vet signs up and submits an always-open clinic (pending)', async () => {
    await signUp(vet, {
      email: vetEmail,
      password: TEST_PASSWORD,
      firstName: 'Vet',
      lastName: RUN_ID,
      phone: '+994000000000',
      isVet: true,
    });
    await expect(vet).toHaveURL(/\/vet-setup/);
    await vet.getByLabel('Clinic name').fill(clinicName);
    // Force "open" regardless of the real-world time this suite runs at.
    await vet.getByText('We are open 24/7 for emergencies').click();
    await vet.getByRole('button', { name: 'Save clinic' }).click();
    await expect(vet.getByText('Your clinic is awaiting verification by the PawLine team.')).toBeVisible();
  });

  test('reporter signs up and reports a case', async () => {
    await signUp(reporter, {
      email: reporterEmail,
      password: TEST_PASSWORD,
      firstName: 'Reporter',
      lastName: RUN_ID,
      phone: '+994000000001',
      isVet: false,
    });
    caseUrl = await submitMinimalReport(reporter, `E2E test case ${RUN_ID} — do not action, safe to delete.`);

    // Reporter role check: sees the open case, but none of the actor-only
    // controls (accept / vet-respond / confirm-delivery).
    await expect(reporter.getByText('Needs help')).toBeVisible();
    await expect(reporter.getByRole('button', { name: 'We’re ready' })).toHaveCount(0);
    await expect(reporter.getByRole('button', { name: 'Confirm animal received' })).toHaveCount(0);
  });

  test('admin approves the test clinic', async () => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const adminPassword = process.env.E2E_ADMIN_PASSWORD;
    if (!adminEmail || !adminPassword) {
      throw new Error(
        'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD are not set. A vet clinic can only be approved by a ' +
          'profile with is_admin = true, and that flag is settable ONLY via the Supabase SQL editor ' +
          '(see src/pages/AdminPage.tsx header comment) — there is no API or UI path around it. Set ' +
          'both env vars to an existing admin test account and re-run. See tests/e2e/README.md.'
      );
    }
    await signIn(admin, adminEmail, adminPassword);
    await admin.goto('/admin');
    await admin.getByRole('button', { name: /Vet approvals/ }).click();
    const vetRow = admin.getByText(clinicName);
    await expect(vetRow).toBeVisible({ timeout: 10_000 });
    await admin
      .locator('.card', { has: vetRow })
      .getByRole('button', { name: 'Approve' })
      .click();
    await expect(vetRow).toHaveCount(0); // leaves the pending list once approved
  });

  test('rescuer signs up and accepts the case', async () => {
    await signUp(rescuer, {
      email: rescuerEmail,
      password: TEST_PASSWORD,
      firstName: 'Rescuer',
      lastName: RUN_ID,
      phone: '+994000000002',
      isVet: false,
    });
    await setEnglishLocale(rescuer);
    await rescuer.goto(caseUrl);
    await rescuer.getByRole('button', { name: 'I’ll rescue this animal' }).click();
    // First-ever rescue shows the one-time safety acknowledgment gate.
    await rescuer.getByRole('button', { name: 'I understand — continue' }).click();
    await expect(rescuer.getByText('Rescuer on it')).toBeVisible();

    // Rescuer role check: no vet-only or reporter-only controls.
    await expect(rescuer.getByRole('button', { name: 'We’re ready' })).toHaveCount(0);
  });

  test('rescuer picks the now-approved vet', async () => {
    await rescuer.getByRole('link', { name: 'Choose a vet' }).click();
    await expect(rescuer).toHaveURL(/\/vets$/);
    const row = rescuer.getByText(clinicName);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await rescuer.locator('.list-row', { has: row }).getByRole('button', { name: 'Ask to receive' }).click();
    await expect(rescuer).toHaveURL(caseUrl);
    await expect(rescuer.getByText(`Waiting for ${clinicName} to confirm…`)).toBeVisible();
  });

  test('vet responds to the incoming case', async () => {
    await setEnglishLocale(vet);
    await vet.goto(caseUrl);
    // Vet role check: sees the respond controls the other two roles don't.
    await expect(vet.getByRole('button', { name: 'We’re ready' })).toBeVisible();
    await expect(vet.getByRole('button', { name: 'Can’t receive' })).toBeVisible();
    await vet.getByRole('button', { name: 'We’re ready' }).click();
    await expect(vet.getByText('Vet ready')).toBeVisible({ timeout: 10_000 });
  });

  test('rescuer departs (en route)', async () => {
    await rescuer.reload();
    await expect(rescuer.getByRole('button', { name: 'I’m on my way' })).toBeVisible({ timeout: 10_000 });
    await rescuer.getByRole('button', { name: 'I’m on my way' }).click();
    await expect(rescuer.getByText('En route')).toBeVisible({ timeout: 10_000 });
  });

  test('vet confirms delivery', async () => {
    await vet.reload();
    await expect(vet.getByRole('button', { name: 'Confirm animal received' })).toBeVisible({ timeout: 10_000 });
    await vet.getByRole('button', { name: 'Confirm animal received' }).click();
    await expect(vet.getByText('Safe at the vet')).toBeVisible({ timeout: 10_000 });
  });

  test('rescuer rates the vet and the reporter sees the resolution', async () => {
    await rescuer.reload();
    await expect(rescuer.getByText(`How was your experience with ${clinicName}?`)).toBeVisible({ timeout: 10_000 });
    await rescuer.getByRole('button', { name: '5 stars' }).click();
    await rescuer.getByRole('button', { name: 'Submit rating' }).click();
    await expect(rescuer.getByText('Thanks for rating your experience.')).toBeVisible();

    // Reporter role check: sees the resolution banner without having acted.
    await reporter.reload();
    await expect(
      reporter.getByText('This animal made it to the clinic. Thank you, everyone.')
    ).toBeVisible({ timeout: 10_000 });
  });
});
