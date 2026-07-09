# PawLine — Deployment Guide

Exact steps from zero to a live production app. Nothing here requires prior
backend experience, but the ⚠ boxes mark the places where a mistake has real
consequences — read those twice.

Host choice: **Vercel**. Reasons: zero-config Vite support, `vercel.json`
already in the repo handles the SPA rewrite, generous free tier, and env-var
management in a clean UI. (Netlify or Cloudflare Pages work equally well —
the app is a static bundle; only the backend on Supabase matters.)

---

## Step 1 — Supabase project (the backend)

1. [supabase.com](https://supabase.com) → **New project**. Region: Frankfurt
   (`eu-central-1`) — closest to Azerbaijan. Choose a strong database
   password and store it in a password manager.
2. **SQL Editor** → run, in order:
   `supabase/migrations/001_init.sql` → `002_locale.sql` →
   `003_production.sql` → `004_grants.sql` → `005_security.sql` → `006_features.sql`.
   (004 grants the baseline table privileges explicitly — without it, the
   dashboard's "Automatically expose new tables" toggle being off causes
   403s on every query even though RLS is correct.)
3. **Authentication → Sign In / Up**:
   - Email provider: on (default).
   - **Allow anonymous sign-ins: ON** ← required; guest reporting uses
     anonymous sessions for rate limiting.
   - Recommended: enable **CAPTCHA (Cloudflare Turnstile)** here later if
     bot signups appear — it slots in without app changes.
4. Make yourself admin (one-time, SQL Editor):
   ```sql
   -- find your id after signing up in the app:
   select id, display_name from public.profiles;
   update public.profiles set is_admin = true where id = 'YOUR-ID-HERE';
   ```

> ⚠ **Keys — what's safe and what's radioactive**
> - `anon` **public** key → safe in the frontend; RLS protects everything.
> - `service_role` key → **bypasses ALL security**. It must only ever live
>   in Supabase Edge Function secrets (it's injected there automatically).
>   Never paste it into the frontend, git, `.env` files in the repo, or a chat.
> - Database password → only needed for the CLI; same care as service_role.

## Step 2 — Web Push (one-time wiring)

Push notifications need a VAPID key pair (a public half in the app, a
private half kept secret) and the `send-push` Edge Function.

```bash
# 1. Generate the key pair (run anywhere with Node):
npx web-push generate-vapid-keys
# → prints a Public Key and a Private Key. Save both in a password manager.

# 2. Install the Supabase CLI and link the project:
npm i -g supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF   # ref is in the dashboard URL

# 3. Store the secrets (private key NEVER goes anywhere else):
supabase secrets set \
  VAPID_PUBLIC_KEY="BP..." \
  VAPID_PRIVATE_KEY="..." \
  VAPID_SUBJECT="mailto:you@yourdomain.com" \
  PUSH_WEBHOOK_SECRET="$(openssl rand -hex 24)"   # note this value for step 5

# 4. Deploy the function:
supabase functions deploy send-push --no-verify-jwt
```

5. Dashboard → **Database → Webhooks → Create**:
   - Table `public.notifications`, event **INSERT**
   - Type: **Supabase Edge Function** → `send-push`
   - HTTP header: `x-push-secret` = the PUSH_WEBHOOK_SECRET value from step 3.

That's it — every in-app notification row now also goes out as a push
message to subscribed devices. Users opt in from Profile → 🔔 Enable push.
(iPhone users must add PawLine to their home screen first — iOS rule.)

## Step 3 — Deploy the frontend on Vercel

1. Push the project to a GitHub repository (private is fine).
2. [vercel.com](https://vercel.com) → **Add New Project** → import the repo.
   Vercel auto-detects Vite: build `npm run build`, output `dist`. Accept.
3. **Environment Variables** (Project → Settings → Environment Variables):

   | Name | Value | Secret? |
   |---|---|---|
   | `VITE_SUPABASE_URL` | from Supabase → Settings → API | no (public) |
   | `VITE_SUPABASE_ANON_KEY` | from the same page | no (public) |
   | `VITE_VAPID_PUBLIC_KEY` | the PUBLIC half from Step 2 | no (public) |
   | `VITE_GOOGLE_MAPS_API_KEY` | from Google Cloud (README "Google Maps setup") | no (public, but domain-restrict it!) |
   | `VITE_SENTRY_DSN` | optional, from sentry.io (Step 4) | no |

   > ⚠ Everything prefixed `VITE_` is compiled into the public bundle.
   > That's fine for the four above — they're designed to be public. It
   > means you must NEVER create a `VITE_`-anything containing the
   > service_role key or the VAPID private key.

4. Deploy. You'll get `https://your-app.vercel.app` over HTTPS — which
   unlocks geolocation, camera capture, install-to-home-screen, and push.
5. Optional custom domain: Vercel → Domains (buy one at any registrar,
   point it per Vercel's instructions — this is a human/real-world step).

## Step 4 — Error monitoring (optional, 5 minutes)

1. [sentry.io](https://sentry.io) → free account → Create Project → React.
2. Copy the DSN into `VITE_SENTRY_DSN` on Vercel → redeploy.
3. Errors from real users' phones now appear in the Sentry dashboard with
   stack traces. No DSN = monitoring silently off (dev default).

## Step 5 — Post-deploy smoke test (10 minutes, on a real phone)

1. Open the URL on a phone → Add to Home Screen → opens full-screen. ✅
2. Report a case as a guest (photo + pin). Submit 5 in a row — the 5th is
   rejected by the rate limit. ✅
3. Sign up a vet → clinic form → it does NOT appear in Nearby Vets yet.
   Approve it from Profile → Admin → Vet approvals → it appears. ✅
4. Enable push on a second account, close the app fully, accept the case
   from the first account → push notification arrives. ✅
5. Report the same animal again ~100 m away → the new case shows the
   "looks similar" banner with confirm/dismiss. ✅

## Ongoing

- **Backups**: Supabase Pro takes daily backups automatically; on the free
  tier, download a manual backup (Database → Backups) before running any
  new SQL. ⚠ Running untested SQL in production is the main way to lose data.
- **Upgrading to Pro (~$25/mo)** is the one paid step worth taking before
  any real launch: daily backups, no project pausing, and much higher
  realtime connection limits (the free tier caps concurrent realtime
  clients — a viral spike would hit that first).
