# PawLine — Operator's Guide

*Written for you personally, as the non-technical owner. Part A takes you
from "code on GitHub" to "live app real people can use," assuming you're
doing it alone for the first time. Part B is the security runbook for when
real things happen at real scale. Technical background docs live separately
(`ARCHITECTURE.md`, `OPERATIONS.md`, `TESTING_REPORT.md`) — this file is
the one you open when you need to DO something.*

---

# Part A — Deployment: start to finish

You will create four accounts (GitHub — done, Supabase, Google Cloud,
Vercel), run five SQL files, set a handful of settings, and end with a live
URL. Budget ~2 hours the first time. Do the steps in order; each one tells
you what success looks like.

### A0. What you need before starting
- The GitHub repository with this code pushed to it
- A password manager (you'll generate several secrets — every one goes in
  there, never in a notes app or chat)
- A bank card for Google Cloud (required to enable Maps; you will set a
  budget alert so it can't silently cost money)

### A1. Supabase — the database and backend (~30 min)

1. Go to **supabase.com** → Sign in with GitHub → **New project**.
   - Name: `pawline` · Region: **Frankfurt (eu-central-1)** (closest to
     Azerbaijan) · Database password: generate in your password manager.
   - ✅ *Success looks like:* a project dashboard with a left sidebar
     (Table Editor, SQL Editor, Authentication…).
2. Left sidebar → **SQL Editor** → **New query**. Open the repo folder
   `supabase/migrations/` and run each file **in this exact order**, one at
   a time: paste the entire file's contents → **Run** → wait for
   "Success. No rows returned":
   `001_init.sql` → `002_locale.sql` → `003_production.sql` →
   `004_grants.sql` → `005_security.sql` → `006_features.sql` →
   `007_prelaunch.sql` → `008_performance.sql` → `009_prelaunch2.sql`.
   - ❌ *If a file errors:* stop. Don't skip ahead. Copy the error message
     and the file name into a new chat with an AI assistant along with the
     file's contents — the fix is usually a one-liner. (The migrations are
     tested to run clean in order on a fresh project.)
3. **Authentication → Sign In / Up**:
   - Email: leave **on**.
   - **Allow anonymous sign-ins: turn ON** (guest reporting needs it).
4. **Database → Extensions** → search `pg_cron` → enable it if it isn't
   already. (This runs the "case sat unanswered for 30 minutes → alert more
   people" escalation job. Migration 006 scheduled it; the extension just
   needs to be on.)
   - ✅ *Check it worked:* SQL Editor → run
     `select jobname from cron.job;` → you should see
     `pawline-escalate-stale-cases`. If the table doesn't exist, re-run
     just the last block of `006_features.sql` (and the cron block in `007_prelaunch.sql`) after enabling the
     extension.
5. **Settings → API**: copy two values into your password manager:
   - **Project URL** (like `https://abcd1234.supabase.co`)
   - **anon public** key (long string starting `eyJ…`)
   - ⚠ On the same page there is a **service_role** key. **Do not copy it
     anywhere.** It bypasses every security rule. You will never need to
     touch it manually — it's injected automatically where it's used.

### A2. Web Push — notifications when the app is closed (~20 min)

This needs a terminal once. On Windows use PowerShell; on Mac, Terminal.
You need Node.js installed (nodejs.org → LTS → install → reopen terminal).

```bash
# 1. Generate the push key pair (run anywhere):
npx web-push generate-vapid-keys
```
It prints a **Public Key** and a **Private Key** → both into the password
manager.

```bash
# 2. Install the Supabase command-line tool and connect it:
npm install -g supabase
supabase login                    # opens a browser to approve
supabase link --project-ref YOUR-PROJECT-REF
# (the ref is the abcd1234 part of your Project URL)

# 3. Store the secrets on Supabase (private key's ONLY home besides
#    your password manager):
supabase secrets set VAPID_PUBLIC_KEY="BP...paste-public..." VAPID_PRIVATE_KEY="...paste-private..." VAPID_SUBJECT="mailto:you@yourdomain.com" PUSH_WEBHOOK_SECRET="paste-a-long-random-string-from-your-password-manager"

# 4. Deploy the notification-sending function (run from the repo folder):
supabase functions deploy send-push --no-verify-jwt
```
✅ *Success:* the deploy command prints a function URL.

5. Back in the Supabase dashboard: **Database → Webhooks → Create a new
   hook**: Table `notifications` · Events: **Insert** only · Type:
   **Supabase Edge Function** → `send-push` · Add HTTP header:
   name `x-push-secret`, value = the PUSH_WEBHOOK_SECRET you generated.

### A3. Google Maps (~15 min)

Follow the README section **"Google Maps setup"** exactly — it walks
through: create Google Cloud project → enable billing → **set a $5 budget
alert** → enable *Maps JavaScript API* + *Places API* → create an API key →
**restrict the key** to your domains and to only those two APIs. You end
with one key → password manager. The restriction step is not optional:
it's what stops someone else using your key on their site and running up
your bill.

### A4. Vercel — putting the app on the internet (~15 min)

1. **vercel.com** → sign in with GitHub → **Add New… → Project** → Import
   your PawLine repository. Vercel auto-detects everything (Vite) —
   don't change build settings.
2. Before clicking Deploy, open **Environment Variables** and add exactly
   these four:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Project URL from A1 |
   | `VITE_SUPABASE_ANON_KEY` | the anon public key from A1 |
   | `VITE_VAPID_PUBLIC_KEY` | the push **Public** key from A2 |
   | `VITE_GOOGLE_MAPS_API_KEY` | the Maps key from A3 |

   Optional fifth: `VITE_SENTRY_DSN` (error monitoring — sentry.io, free
   tier, create a React project, paste its DSN; you can add this any time).
   - ⚠ Never create a variable containing the service_role key or the
     VAPID **private** key. Anything starting `VITE_` becomes public.
3. **Deploy.** ✅ *Success:* a confetti screen and a live URL like
   `https://pawline.vercel.app`. Open it on your phone.
4. Update the Google Maps key restriction (A3) to include this exact URL
   with `/*` on the end, if you hadn't yet.

### A5. Make yourself admin (one-time)

1. Open the live app → create your own account (normal sign-up).
2. Supabase → SQL Editor:
   ```sql
   select id, display_name from public.profiles;
   ```
   find your row, copy the `id`, then:
   ```sql
   update public.profiles set is_admin = true where id = 'PASTE-YOUR-ID';
   ```
3. ✅ Reload the app → Profile now shows **🛠 Admin**.
   (Deliberately SQL-only: a stolen phone can never mint new admins.)

### A6. The 10-minute smoke test (do all of it, on a real phone)

1. Add to Home Screen → opens full-screen like an app. ✅
2. First open shows the 3-step onboarding. ✅
3. Report a case as a guest: the photo button opens the **camera** (not
   the gallery), the map pin follows you, submit works. ✅
4. Report 4 more times fast → the 5th is politely refused (rate limit). ✅
5. Sign up a second account as a **vet**, fill the clinic form → it does
   **not** appear in Nearby Vets. Approve it in Admin → it appears. ✅
6. Enable push (Profile → 🔔) on one account, fully close the app, accept
   its case from the other account → a push notification arrives. ✅
7. Airplane mode → try to report → "saved, will send when online" → turn
   the network back on → it submits itself. ✅
8. Visit `/impact` → public numbers page loads. ✅

If any step fails: the matching section of `docs/DEPLOYMENT.md` has the
technical detail, and the error message + step number is exactly what to
paste to an AI assistant.

### A7. Before you tell the world (strongly recommended)

- **Supabase Pro (~$25/mo)** — the single paid upgrade that matters:
  daily automatic backups, the project never pauses from inactivity, and
  much higher realtime limits (a viral moment on the free tier hits the
  connection cap first).
- **A custom domain** (any registrar, ~$10/yr) → Vercel → Settings →
  Domains → follow its two DNS instructions. Then add the domain to the
  Google Maps key restrictions and to Supabase → Authentication → URL
  Configuration.

---

# Part B — Security runbook (for when real things happen)

The theme of everything below: **you cannot make a catastrophic mistake by
reading dashboards, and almost every real response starts with rotating a
key or flipping a setting — both reversible.** Breathe first.

### B1. "I think someone got in" (suspected breach / unauthorized access)

Signs: an admin action you didn't do, a vet approved that you never
approved, sponsors you didn't add, Supabase Auth logs showing sign-ins to
*your* account from places you weren't.

Do, in order (total ~15 minutes):
1. **Change your own passwords** (Supabase account, GitHub, Vercel, Google)
   and turn on 2-factor on all four if you haven't. Most "breaches" at this
   scale are one stolen owner password.
2. **Rotate the Supabase keys**: Dashboard → Settings → API → *Rotate*
   on the anon key AND service_role. Then update `VITE_SUPABASE_ANON_KEY`
   on Vercel (Settings → Environment Variables → edit → **Redeploy**).
   The app is briefly broken between rotate and redeploy — that's fine,
   minutes matter less than the key.
3. **Check the damage surface** in Supabase → Table Editor: `profiles`
   (any is_admin=true rows you don't recognize? set them false), `vets`
   (unapproved things approved?), `sponsors`.
4. **Write down the timeline** (what you saw, when, what you did) while
   it's fresh — you'll want it if you later bring in a professional, and
   it's your privacy-policy obligation source if user data was actually
   accessed.
5. **If you confirm user data was accessed** (not just your account —
   actual reads of messages/locations): that's an escalation point (B6),
   and users must be told honestly. The privacy page promised that.

### B2. Key & secret rotation (routine, and after any exposure)

**When**: immediately if a secret was ever pasted somewhere public (a chat,
a screenshot, a public repo, a stack-overflow question) — and calmly, on a
~6-month schedule, for hygiene.

| Secret | Where it lives | How to rotate |
|---|---|---|
| Supabase anon key | Vercel env var | Supabase → Settings → API → Rotate → paste new into Vercel → Redeploy |
| Supabase service_role | Supabase only (auto-injected) | Same Rotate button — nothing else to update |
| Google Maps key | Vercel env var | Google Cloud → Credentials → create NEW key with same restrictions → paste into Vercel → Redeploy → delete old key |
| VAPID push keys | Supabase secrets + Vercel (public half) | `npx web-push generate-vapid-keys` → `supabase secrets set …` → update `VITE_VAPID_PUBLIC_KEY` on Vercel → Redeploy. ⚠ Every user must re-enable push (their old subscriptions die) — rotate these only on real exposure. |
| PUSH_WEBHOOK_SECRET | Supabase secrets + the webhook header | New random string → `supabase secrets set` → edit the webhook's `x-push-secret` header |
| Database password | Supabase | Settings → Database → Reset password (nothing app-side uses it) |

**"I committed a secret to GitHub by mistake":** rotate it FIRST (the key
is burned the moment it's pushed — assume bots saw it within minutes), then
clean the repo history second. Rotation is the fix; history-cleaning is
cosmetics. The only secrets that could plausibly be in this repo by
accident are in a `.env` file — which `.gitignore` blocks — so this
requires actively fighting the safety rails; still, now you know.

### B3. Coordinated spam / abuse wave

**What it looks like:** a burst of fake reports (often same photo reused,
or nonsense descriptions), fake "clinics" registering, or bank-detail scams
in case chats ("send treatment money to this card").

**What's already automatic:** per-device limits (4/hour, 15/day), a
platform-wide guest circuit breaker (40 guest reports/hour total → guests
are politely asked to create an account, registered users unaffected),
duplicate-photo flagging, vet invisibility until you approve, and the ⚑
report queue.

**Your moves, escalating:**
1. **Admin → Reports**: hide the content (reversible), ban the accounts.
   Ten minutes of this ends most waves — they're rarely persistent.
2. **Turn on CAPTCHA** (the durable fix, one toggle, no code): Supabase →
   Authentication → Sign In / Up → *Enable Captcha protection* →
   Cloudflare Turnstile (free — create a Turnstile widget at
   dash.cloudflare.com, paste site+secret keys). This kills scripted
   guest-session farming dead.
3. **Fake vets**: never approve without the phone call (OPERATIONS.md has
   the checklist). If one slipped through: Admin → set it back to
   rejected, ban the account, and check whether any case was routed to it.
4. **Chat scammers** (the serious one — people posing as vets to collect
   "treatment money"): hide the message, ban, and post a vet update on
   affected cases if needed. The rule users are told: legitimate bank
   details come from the case's *confirmed clinic* only.

### B4. Traffic spike ("we went viral")

What breaks first, in order, and what to do:

1. **Supabase realtime connections** (free tier: ~200 concurrent) —
   symptom: live updates stop, app otherwise works. Fix: **upgrade to Pro**
   (takes effect in minutes). This is the #1 reason to already be on Pro.
2. **Google Maps quota** — symptom: map shows an error watermark, or your
   budget alert email arrives. Check Google Cloud → APIs → quotas. The
   free monthly credit is generous; a genuine viral day may exceed it —
   decide consciously (raise the cap) rather than reactively.
3. **Database CPU** — Supabase → Reports → Database. Sustained >80%:
   Pro tier again, then compute add-on (a slider, no migration).
4. **Nothing else needs you**: Vercel's static hosting effectively doesn't
   care about your scale; notifications fan out in the database and were
   built for this (indexes + nearby-default preferences).

**During the spike**: check Admin → Reports twice a day (attention brings
trolls), watch Sentry for new error types, and — this is the growth moment
the research pass identified — make sure open cases are getting accepted
(Admin → Stats → median time-to-accept). If that number climbs, rescuer
supply is the fire, not the servers: activate the partner orgs.

### B5. Turnstile — the full setup (15 minutes, do this before launch)

The app already contains the client side (it activates automatically when
the key below exists; without it, guest reporting still works and the
database circuit breaker still bounds abuse). To turn it on:

1. **dash.cloudflare.com** → sign up free → left menu **Turnstile** →
   **Add widget**. Name: `pawline` · Domains: your Vercel URL and your
   custom domain (no `https://`, just the hostname) · Mode: **Managed**
   (invisible for almost everyone; shows a checkbox only to suspicious
   traffic). Create → copy BOTH the **Site Key** and the **Secret Key**
   into your password manager.
2. **Supabase → Authentication → Bot and Abuse Protection** (name varies
   slightly by dashboard version; it's under Authentication settings) →
   Enable Captcha protection → provider **Turnstile** → paste the
   **Secret Key** → Save.
3. **Vercel → Settings → Environment Variables** → add
   `VITE_TURNSTILE_SITE_KEY` = the **Site Key** → **Redeploy**.
4. ✅ *Test:* open the live app in a private window → report as a guest →
   the report goes through (Managed mode is usually invisible). To see it
   actually challenge, Cloudflare's widget page has a "force interaction"
   test mode.
   ❌ *If guest reports start failing with a captcha error:* the Secret
   Key in Supabase and the Site Key in Vercel are probably from different
   widgets — they must be from the same one.

### B6. Backups: the TESTED restore procedure

Backups you've never restored are hopes, not backups. This procedure was
executed end-to-end during the pre-launch pass on a 50,000-user database
(dump → restore into a clean database → verified all rows, all 29 security
policies, and that functions actually execute). Practice it once yourself
in ~15 minutes:

**Taking a backup (choose one):**
- **Supabase Pro**: automatic daily backups already exist (Database →
  Backups). Nothing to do.
- **Manual (free tier, or extra safety before risky changes):** on your
  computer, with the database connection string from Supabase → Settings →
  Database (URI tab):
  ```bash
  pg_dump "YOUR-CONNECTION-STRING" -Fc -f pawline-$(date +%F).dump
  ```
  Keep the file somewhere safe (it contains user data — treat it like a
  password). ~2 MB per 50k users, so storage is a non-issue.

**Restoring (the part people never practice):**
1. Supabase → **Database → Backups → Restore** (Pro tier: pick a date,
   click restore — the project restores in place, expect a few minutes of
   downtime), **or** for a manual dump into a fresh/second project:
   ```bash
  pg_restore -d "NEW-PROJECT-CONNECTION-STRING" --no-owner --no-acl pawline-YYYY-MM-DD.dump
   ```
2. **Verify — don't assume.** In the SQL editor of the restored project:
   ```sql
   select count(*) from public.profiles;      -- expect your user count
   select count(*) from pg_policies where schemaname = 'public';  -- expect 29
   select proname from pg_proc where proname = 'delete_my_account'; -- exists
   ```
3. If restoring into a *new* project: the project URL and anon key changed
   → update both env vars in Vercel and redeploy (see B2's rotation table —
   it's the same motion).

**When to restore:** you deleted/broke data by accident, a migration went
wrong, or (worst case) post-breach recovery. When in doubt, restore into a
SECOND project first and look around before touching production.

### B7. Rollback: revert to the last known-good deployment (2 minutes)

If a deploy breaks the app (blank screen, errors everywhere), you do NOT
need to fix code under pressure:

1. **Vercel → your project → Deployments** → find the last deployment that
   was working (they're timestamped; the one before your broken one) →
   **⋯ menu → Promote to Production** (or "Instant Rollback" on the
   current production deployment's menu). The old version is live again in
   seconds. This is always safe: deployments are immutable snapshots.
2. **The database caveat — read this part twice:** rolling back the APP
   does not roll back the DATABASE. Migrations in this project are
   additive (new tables/columns/functions), so an older app version runs
   fine against a newer database — that's by design. But never write a
   future migration that DROPS or renames a column an older app still
   reads, or rollback stops being safe. If a migration itself caused the
   problem, that's a restore situation (B6), not a rollback.
3. After rolling back: reproduce the problem in a preview deployment (every
   git branch gets its own URL on Vercel) and only promote again when the
   preview works.

### B8. Monitoring with real alerting (so problems find YOU)

Silent logs help nobody at 2am. Three alert channels, ~20 minutes total,
all free tiers:

1. **Crash alerts — Sentry** (you added the DSN in A4): sentry.io → your
   project → **Alerts → Create Alert → Issues** → condition "when a new
   issue is created" → action "send email to me" → save. Optionally a
   second rule: "when an issue is seen by more than 10 users in 1 hour".
   That's the difference between logging and alerting — now crashes email
   you. The app reports both global errors AND React render crashes (the
   error boundary reports explicitly — a silent gap that was found and
   fixed in the pre-launch pass).
2. **Downtime alerts — UptimeRobot** (uptimerobot.com, free): Add New
   Monitor → HTTP(s) → your production URL → check every 5 minutes →
   alert contact: your email. You'll know the site is down before users
   tell you.
3. **Database health — Supabase**: Settings → Notifications: make sure
   email notifications are ON (they alert on resource exhaustion,
   approaching limits). Weekly, glance at Reports → Database as per B10.

If all three are quiet, the app is up, not crashing, and the database is
healthy — that's your whole monitoring story at this scale.

### B9. Pre-launch real-condition QA (do once on real devices)

These three things can only be verified in the real deployed environment —
automated checks in a sandbox can't reach a real inbox, a real push
service, or a real camera. Each takes 2 minutes; do all of them before
inviting partner organizations:

1. **Password-reset email actually arrives:** live app → sign-in screen →
   "Forgot password?" with your real email → the email should arrive
   within ~2 minutes (check spam the first time — and if it landed there,
   that's your cue to set up custom SMTP later; Supabase's built-in sender
   has modest deliverability and a 3-4/hour rate limit, fine for launch,
   not for scale). Click the link → set a new password → sign in with it.
2. **Push notifications fire from the real webhook:** on your phone, in
   the installed PWA, Profile → enable 🔔 → fully close the app → from
   another device/account, accept a case you reported → a push should
   arrive on the closed phone within seconds. ❌ If not: Supabase →
   Database → Webhooks → check the send-push hook shows recent deliveries
   (if deliveries show errors, the `x-push-secret` header doesn't match
   the secret you set in A2).
3. **Real camera photo sizes upload fine:** report a case using an actual
   phone camera photo (modern phones produce 3–12 MB images; the app
   compresses client-side before upload, so what leaves the phone is
   ~200–400 KB). ✅ The report submits on mobile data in a few seconds and
   the photo appears on the case. ❌ If uploads fail only on huge photos,
   note the phone model — that's a compression bug worth reporting.

### B10. Habits — what to actually check

**Weekly (5 minutes):**
- Admin → Reports queue at zero, pending vets handled
- Admin → Stats: median time-to-accept (THE health number — under ~30
  minutes is healthy; climbing = recruit rescuers/partners)
- Supabase → Reports: any weird cliff or spike in API requests

**Monthly (15 minutes):**
- Supabase → Database → Backups: confirm backups exist (Pro) or take a
  manual one (free)
- Sentry: any new recurring error (>10 occurrences)
- Google Cloud billing page: is Maps spend ~what you expect (usually $0)
- Storage usage (photos are the only real consumer)
- Skim `content_reports` resolved this month — patterns worth a rule?

**Quarterly:** rotate what B2 marks as hygiene; re-run the A6 smoke test
after any big dependency update.

### B11. Fix-it-yourself vs. call a professional

**You + this documentation + an AI assistant can handle:** everything in
B1–B5; approving/hiding/banning; key rotation; tier upgrades; re-running a
failed migration; adding a sponsor; reading any dashboard mentioned here.

**Get a professional (or at minimum a long, careful session with a strong
AI assistant *before acting*) when:**
- You've confirmed actual access to user data by an outsider (B1 step 5) —
  both for forensics and because disclosure may have legal shape
- Anything requires *writing new SQL against production* beyond the
  documented one-liners — the blast radius of a bad UPDATE is the database
- A government or law-enforcement body contacts you about user data
- Payment/money ever enters the picture (it's out of scope by design;
  keep it that way without professional advice)
- You feel pressure to act fast and don't understand what the action does.
  That combination — urgency + not understanding — is precisely when
  people cause their own outage. The honest test: **if you can't explain
  what a command will do, you're not the one who should run it yet.**

Everything in this app was built so that the safe path is also the lazy
path: reads are harmless, the dashboards are the tools, and every
moderation action is reversible. When in doubt, do the reversible thing.
