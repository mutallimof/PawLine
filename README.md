# 🐾 PawLine

**Report, rescue, and treat injured stray animals — together.**

PawLine is a mobile-first Progressive Web App for coordinating stray-animal
rescue, launching in Azerbaijan (built to be translated for Turkey later).
Anyone who spots an injured animal reports it in seconds — even without an
account. Registered users accept cases as rescuers, pick a nearby registered
vet clinic, and bring the animal in. Everyone watching gets live status
updates, and each case has an open group chat where vets can share bank
details so people can chip in for treatment (payments happen entirely
outside the platform).

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 18 + TypeScript + Vite | Fast, typed, mainstream — easy for any developer to pick up |
| PWA | vite-plugin-pwa (Workbox) | Installable, standalone full-screen, offline app shell, cached map tiles |
| Backend | **Supabase** (Postgres, Auth, Realtime, Storage) | The case pipeline is relational and consistency-critical; Postgres RLS + `SECURITY DEFINER` functions enforce the state machine **server-side**. Realtime channels push case/chat/notification changes live. Comfortably supports 1,000+ concurrent users on a Pro plan with no custom scaling work |
| Maps | Google Maps JavaScript API | Best tile/positioning accuracy and place coverage in Azerbaijan & Turkey; requires an API key (setup below) |
| Place search | Google Places (Text Search) | Accurate address/POI search in the launch markets, biased to the visible map area |
| Fonts | Fraunces + Nunito Sans (self-hosted via Fontsource) | Bundled and precached — typography works offline |

Firebase was the other candidate; Supabase won because the case state
machine, XP awards, and notification fan-out are naturally expressed as
Postgres functions and triggers — one authoritative implementation instead
of duplicated client logic or cloud functions.

## Project layout

```
supabase/
  migrations/001_init.sql   ← the entire backend: schema, RLS, state machine,
                              notification triggers, XP awards, storage bucket
  seed.sql                  ← notes for seeding demo vet clinics
src/
  lib/                      ← shared logic
    types.ts                  types mirroring the DB schema
    supabase.ts               client singleton
    api.ts                    ALL queries & RPC calls (components stay clean)
    geo.ts / time.ts / xp.ts  distance, relative time, tier thresholds
    photos.ts                 client-side image compression + upload
  i18n/                     ← every UI string; copy en.ts → az.ts/tr.ts to translate
  context/AuthContext.tsx   ← session + profile state
  hooks/useRealtime.ts      ← live cases / case detail / notifications / chats
  components/               ← Icons, ui (nav, cards, badges, paw trail), maps
  pages/                    ← one file per screen
  styles/index.css          ← design tokens + all component styles
docs/ARCHITECTURE.md        ← state machine & notification design, read this next
```

## Setup (about 10 minutes)

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project (pick a region
   close to Azerbaijan, e.g. Frankfurt `eu-central-1`).
2. Open **SQL Editor** → run `supabase/migrations/001_init.sql`, then
   `002_locale.sql`, `003_production.sql`, `004_grants.sql`, `005_security.sql`, and
   `006_features.sql` (in that order). Together
   they create every table, policy, function, trigger, the realtime
   publication, the `case-photos` storage bucket, language preferences,
   and the production layer: admin/moderation, guest rate limiting, vet
   verification, push subscriptions, duplicate detection, sponsors, and —
   in 004 — the explicit table privileges, so the app works regardless of
   the dashboard's "Automatically expose new tables" toggle.
   Then enable **anonymous sign-ins** (Authentication → Sign In / Up) —
   guest reporting requires it.
   - If the two `storage.objects` policies at the very bottom fail on your
     project (permissions vary by plan), create them instead in
     **Storage → case-photos → Policies**: allow `SELECT` for everyone and
     `INSERT` for everyone (anon + authenticated) — guests must be able to
     upload report photos.
3. **Authentication → Providers → Email**: enabled by default. For the
   smoothest field experience, turn **"Confirm email" OFF** so rescuers can
   sign up and act immediately (turn it back on later if spam becomes an
   issue — the app handles both modes).

### 2. Configure the app

```bash
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
# from Supabase → Project Settings → API
npm install
npm run dev
```

Open the printed URL on your phone (same Wi-Fi) or in a mobile-sized browser
window. Note: geolocation and PWA install require **HTTPS** (or localhost),
so test location features via localhost or a deployed URL.

### 3. Try the whole pipeline locally

1. **Guest report** — without signing in, tap the coral **+**, add a photo,
   drop the pin, send.
2. **Rescuer** — create a normal account in a second browser/profile; the
   new case appears live; open it → *"I'll rescue this animal"*.
3. **Vet** — create a third account with *"I'm registering a veterinary
   clinic"* checked, complete the clinic form (name, address, pin).
4. Back as the rescuer: *Choose a vet* → pick the clinic. As the vet:
   confirm. As the rescuer: *I'm on my way*. As the vet: *Confirm animal
   received* (optionally with a photo).
5. Watch the paw-trail fill in live in every window, alerts land in the
   bell tab, XP appears on profiles (+50 rescuer, +30 vet, +10 reporter).

### 4. Deploy

Any static host works — the entire backend is Supabase.

**Vercel / Netlify / Cloudflare Pages:**
- Build command `npm run build`, output directory `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Add a SPA fallback rewrite of all routes to `/index.html`
  (Netlify: `/_redirects` with `/* /index.html 200`; Vercel handles SPAs
  via `vercel.json` rewrites)

Once deployed over HTTPS, phones will offer **Add to Home Screen** — the app
then runs full-screen with no browser UI on both iOS and Android.

## Languages

The app ships in **Azerbaijani (default)**, **Turkish, and English** —
full translations in `src/i18n/az.ts`, `tr.ts`, `en.ts`, switchable from
Profile (works for guests too). The choice persists in localStorage and,
for signed-in users, in `profiles.locale`, so it follows them across
devices. A language chosen while browsing as a guest carries over at signup
via auth metadata. To add another language: copy `en.ts`, translate, and
register the code in `src/i18n/index.ts` — the `Dict` type makes the
compiler flag any missing key.

## What's deliberately NOT here (v1 scope)

- **No in-app payments** — vets share bank details in case chat; money moves
  directly between donors and the clinic. The platform never touches funds.
- No public leaderboard, no cash rewards — XP tiers are personal progression.
- No native apps — PWA only.

## Google Maps setup (required for maps & place search)

The map runs on Google Maps, which needs an API key you create once.
It takes about 10 minutes. Google's free monthly credit comfortably covers
an app of this size — but billing must still be enabled on the account
(that's how Google gates the APIs).

1. Go to [console.cloud.google.com](https://console.cloud.google.com) →
   sign in → top bar → **New Project** → name it `pawline` → Create.
2. **Billing** (left menu) → link a billing account (card required).
   ⚠ Set a **budget alert** while you're there (Billing → Budgets & alerts →
   e.g. $5/month) so any surprise usage emails you long before it costs
   real money.
3. **APIs & Services → Library** → enable BOTH:
   - **Maps JavaScript API** (the map itself)
   - **Places API** (the location search box)
4. **APIs & Services → Credentials → Create credentials → API key.**
   Copy the key.
5. ⚠ **Restrict the key immediately** (click the key → edit):
   - *Application restrictions* → **Websites** → add
     `http://localhost:5173/*`, your Vercel URL
     (`https://your-app.vercel.app/*`), and your custom domain if any.
   - *API restrictions* → **Restrict key** → select only Maps JavaScript
     API and Places API.
   This key ships inside the public bundle **by design** (like the Supabase
   anon key) — the restrictions above are what stop anyone else from using
   it on their own site and running up your bill.
6. Put it in your env: locally in `.env` as `VITE_GOOGLE_MAPS_API_KEY=...`,
   and on Vercel as the same variable (Project → Settings → Environment
   Variables) — never hardcode it in source.

Without the key the app still runs — map areas show a friendly
"map unavailable" note instead, which is also what you'll see in dev
before finishing this setup.

## Production layer (added in the readiness pass)

- **Web Push** — real notifications with the app closed
  (`supabase/functions/send-push` + custom service worker; wiring steps in
  `docs/DEPLOYMENT.md`).
- **Vet verification** — clinics are `pending` until approved in the in-app
  Admin screen; unverified clinics never appear to rescuers.
- **Moderation** — users flag cases/messages (⚑); admins hide content and
  ban accounts, all reversible.
- **Abuse prevention** — guests get transparent anonymous sessions;
  database-enforced rate limits (4 reports/hour, 15/day per identity).
- **Duplicate detection** — location + time + on-device perceptual photo
  hashing produce *advisory* "same animal?" flags; never blocks a report.
- **Live-camera reports (anti-fraud)** — the report flow opens the camera
  directly on phones instead of the photo library, so reports carry a photo
  taken on the spot. Deterrent, not foolproof: desktop browsers ignore the
  `capture` hint and show a normal file picker.
- **Sponsors/partners strip**, trilingual **privacy policy** (`/privacy`),
  optional **Sentry** error monitoring, **Vercel** deployment config.

Operating docs: `docs/DEPLOYMENT.md` (go-live steps), `docs/OPERATIONS.md`
(day-to-day admin + safety warnings), `MONETIZATION.md` (funding strategy).

## Sensible next steps after launch
