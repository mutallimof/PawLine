# E2E: full case state machine

Drives one case through report → accept → select vet → vet responds →
transport → confirm delivery → rate, as three real accounts (reporter,
rescuer, vet), each in its own browser context, against a **deployed**
PawLine instance — not a local dev server. It has to be deployed: the app
reads `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` from the build, and this
suite needs the real Supabase Auth, RLS, and RPCs behind whichever URL you
point it at.

## Before your first run

**1. Set the target and account secrets** (shell env, not committed):

```bash
export E2E_BASE_URL="https://<your-vercel-url>"
export E2E_ADMIN_EMAIL="<an existing admin test account>"
export E2E_ADMIN_PASSWORD="<its password>"
```

**2. Get Playwright itself installed** — `npm install` is already recorded
in `package.json` (`@playwright/test`), but the actual install and the
browser binary download didn't run in the environment this suite was
written in (blocked by permissions). Run once:

```bash
npm install
npx playwright install --with-deps chromium
```

**3. The vet-approval gate — read this before running.** A freshly
signed-up vet clinic is `pending` until a profile with `is_admin = true`
approves it (`AdminPage.tsx`), and `is_admin` is **settable only via the
Supabase SQL editor** — there's no API or UI path around it, by design. So
either:

- you already have an admin test account → point `E2E_ADMIN_EMAIL`/
  `E2E_ADMIN_PASSWORD` at it, or
- you don't yet → sign up one throwaway account by hand once, then in the
  Supabase SQL editor:
  ```sql
  update profiles set is_admin = true where id = '<that account's auth uid>';
  ```

Without this, the suite fails at the "admin approves the test clinic" step
with a message pointing back here — it does not silently skip.

**4. Two Supabase Auth settings this suite assumes:**

- **Confirm email** (Authentication → Sign In / Up) should be **off** for
  whatever project the target deployment uses. The suite signs up and
  expects an immediate session; it can't click a confirmation link in an
  inbox. If it's on, `signUp()` throws a clear error naming the account
  that's stuck.
- **Enable Captcha protection**, if turned on for the project, gates *all*
  sign-ups/sign-ins, not just the anonymous guest-report path this app's
  own Turnstile integration targets — the suite has no captcha solver and
  will fail at sign-up if it's on.

## Running it

```bash
npm run test:e2e        # headless
npm run test:e2e:ui     # Playwright's UI mode, for watching/debugging
```

Tests run in one serial file (`state-machine.spec.ts`) — a later step
depends on state a prior one created (the case, the clinic, the accounts),
so a failure stops the rest rather than reporting misleading passes.

## What this creates, and on what

Every run signs up three real accounts and creates one real case and one
real vet clinic **in whatever Supabase project `E2E_BASE_URL` points at**.
If that's your production project, that data is real and visible to real
users (the case appears in the live feed/map; the clinic appears in vet
search) until someone hides or deletes it. Consider pointing this at a
staging Supabase project + staging Vercel deployment instead, if you have
one; the suite doesn't care which it's given, as long as the three Auth
settings above match.

## Cleanup

Everything this suite creates is tagged with one run id so it's easy to
find afterward:

- Accounts: `pawline-e2e-<runid>-{reporter,rescuer,vet}@example.com`
- Clinic: `PawLine E2E Clinic <runid>`
- Case description starts with `E2E test case <runid>`

To remove a run: as an admin, hide/delete the case from `/admin`, and
either delete the three `auth.users` rows from the Supabase dashboard
(Authentication → Users) or leave them — they're inert `@example.com`
addresses that will never sign in again outside another test run.
