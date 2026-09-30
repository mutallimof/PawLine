# Stray's Call — Privacy Policy (DRAFT for legal review)

> **Status:** draft, not published. The live policy in the app (`src/components/extras.tsx`) is unchanged.
> **Basis:** every statement below was checked against the code and database migrations on `main` at commit `104e75b` (migrations 001–035). Anything the code cannot tell us is marked **[TO CONFIRM: …]**.
> **Target law:** Law of the Republic of Azerbaijan "On Personal Data". Users are in Azerbaijan; the data is stored outside Azerbaijan (see §2 and §C5).
> **Retention periods** (§A, §C6) describe migration 038 (`run_retention()`, daily pg_cron job `pawline-retention`) — **[TO CONFIRM: 038 applied, and the photo-retention Edge Function deployed and scheduled; until then photos are not deleted.]**
> **Migrations assumed applied:** 001–035. [TO CONFIRM: that production has 033, 034 and 035 applied — 034/035 add the consent fields referenced below.]

---

## Part A — Data inventory

"Public" below means readable by **anyone, including people with no account**: the database grants `SELECT` to the `anon` role and the row-level-security (RLS) policy is `using (true)` or equivalent. Quotes are from the migrations; the number in brackets is the migration file.

### A1. Account & profile (`public.profiles`, plus Supabase Auth `auth.users`)

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Email address** | Supabase Auth (`auth.users.email`) — not in `profiles`. | The user (via their session). **Admins**: `admin_list_users()` "returns every user's email and ban state" [030] — callable only when `is_admin()`. Not readable by other users. | Until account deletion (`delete from auth.users where id = uid` in `delete_my_account()` [009]). |
| **Password** | Supabase Auth, hashed by Supabase. | Nobody (Supabase handles it). | Until account deletion. |
| **First name, last name, phone** | `profiles.first_name`, `last_name`, `phone` [014]. | The user only (via `get_my_profile()` [005]). **Not** in the public column grant: `grant select (id, display_name, avatar_url, role, xp, cases_helped, created_at) on public.profiles to anon, authenticated` [005] (+ `partner_org` [006]). | Until account deletion (row cascades from `auth.users`). |
| **Display name** | `profiles.display_name` (built from first + last name at sign-up). | **Public** (column grant above; RLS `"profiles are viewable by everyone" … using (true)` [001]). Shown on cases, chats, ratings. | Until account deletion. |
| **Avatar URL** | `profiles.avatar_url` (filled from the Google profile picture for Google sign-ups [024]). | **Public** (column grant). | Until account deletion. |
| **Role (user / vet), XP, "cases helped", join date, partner organisation** | `profiles.role`, `xp`, `cases_helped`, `created_at`, `partner_org`. | **Public** (column grants [005], [006]). XP is no longer shown in the app UI but is still readable. | Until account deletion. |
| **Language** | `profiles.locale`. | The user; not in the public grant. | Until account deletion. |
| **Home area (lat/lng) and alert radius, new-case alert preference** | `profiles.home_lat`, `home_lng`, `notify_radius_km`, `new_case_pref`. | The user only (not in public grant). Used server-side by `notify_new_case` / `escalate_stale_cases` to pick who to alert [013]. | Until account deletion. |
| **Admin / banned flags** | `profiles.is_admin`, `banned` [003]. | The user (own row), admins. Not public. | Until account deletion. |
| **Safety acknowledgment** | `profiles.safety_ack_at` [009] + browser `localStorage` key `pawline-safety-ack-v1`. | The user; not public. | Until account deletion (DB); until the browser storage is cleared (device). |
| **Terms / age consent (accounts)** | `profiles.terms_accepted_at`, `terms_version` [034] — set only by `record_terms_acceptance()`. Also `terms_version` in the Supabase Auth sign-up metadata. | The user; not public. | Until account deletion. |

### A2. Reports / cases (`public.cases`, `public.case_photos`, storage bucket `case-photos`)

**Important:** `cases` has a *table-level* read grant — `grant select on public.cases to anon, authenticated` [004] — and the RLS policy `"visible cases are viewable by everyone" … using (not hidden or public.is_admin())` [003]. There is **no column restriction**, so **every column below is readable by anyone** while the case is not hidden by an admin.

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Exact location of the animal** (lat/lng) | `cases.lat`, `lng`. | **Public.** | **No deletion.** Cases are never deleted; unclaimed open cases are only *closed* after 24 h (`expire_unclaimed_cases()` [007], run hourly by pg_cron job `pawline-case-maintenance` [011]). |
| **Street address** (reverse-geocoded) | `cases.street_address` [029] — computed once at report time by Google's Geocoder from the lat/lng. | **Public.** | No deletion. |
| **Landmark text, description, animal type, condition, spot type, urgency** | `cases.address_hint`, `description`, `animal`, `injury_type`, `spot_type`, `urgency`. | **Public.** | No deletion. |
| **Guest's optional name** | `cases.guest_name`. | **Public.** | No deletion. |
| **Reporter / rescuer / vet account IDs** | `cases.reporter_id`, `rescuer_id`, `vet_id`. | **Public** (IDs; names come from public `profiles`). | No deletion; set to null for the deleting user by `delete_my_account()` [009]. |
| **Device/session identity of whoever created the report** | `cases.creator_uid` — forced to `auth.uid()` by `enforce_case_limits()` [005/021/035]; for guests this is the anonymous session ID. | **Public** (table-level grant). Lets anyone see which reports came from the same device/session. | No deletion; set to null by `delete_my_account()` for the deleting user. |
| **Guest consent** | `cases.terms_version`, `terms_accepted_at` [035] — server sets `terms_accepted_at = now()` for anonymous reporters; cleared for signed-in reporters. | **Public** (table-level grant). | No deletion. |
| **Rescuer's live location while en route** | `cases.rescuer_lat`, `rescuer_lng`, `rescuer_loc_at`; sent every ~45 s by the rescuer's device only while status is `en_route` (`CaseDetailPage` + `update_rescuer_location()` [007/033]). | **Public** (table-level grant) — not only on the case page. | Cleared (`= null`) by `confirm_delivery()` [005], `drop_case()` [001], and the automatic revert after 75 min without progress (`revert_abandoned_cases()` [007]). |
| **Photos (report & delivery/recovery)** | Private storage bucket `case-photos` [018]; path in `case_photos.path`; photos are re-encoded in the browser (max 1600 px, JPEG) before upload (`compressImage`, `src/lib/photos.ts`). | Row: `"visible case photos are viewable by everyone"` [011]. Files: storage policy `"case photos are visible unless the case is hidden" … to authenticated` [018] — the app fetches short-lived signed URLs; guest (anonymous) sessions count as `authenticated`, so anyone who opens the app can see them. | **6 months after the case is resolved or closed**: rows and files deleted by the photo-retention Edge Function (038 counts them; the case itself stays). Browser cache: service worker cache `case-photos`, max 200 entries / 7 days (`src/sw.ts`). |
| **Photo fingerprint** | `case_photos.phash` (64-bit perceptual hash, computed on the device) [003]. | **Public** (table grant on `case_photos`). | No deletion. |
| **Case timeline** (events, vet free-text updates) | `case_events` (`actor_id`, `note`). | **Public** — `"case events are viewable by everyone" … using (true)` [001]. | No deletion; `actor_id` set null when that account is deleted (FK `on delete set null`). |
| **Duplicate-report flags** | `case_duplicate_flags` (distance, minutes apart, photo similarity). | **Public** — `using (true)` [003]. | No deletion. |
| **"Animal not here" flags** | `case_not_here_flags` (`case_id`, `profile_id`). | Only the flagger — `"see own not-here flags" … using (profile_id = auth.uid())` [007]. | Deleted on account deletion [009]. |
| **Watching a case** | `case_watchers` (+ `last_read_at` [017]). | Only the watcher — `"see own watches"` [001]. | Deleted on account deletion [009]. |

### A3. Messaging

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Case chat messages** (may include bank details posted by clinics) | `case_messages`. | **Public** — `"visible case chat is viewable by everyone" … using (not hidden or public.is_admin())` [003], table grant to `anon` [004]. Posting requires an account in good standing [032]. | **90 days after the case is resolved or closed** (`run_retention()` [038]); a pinned message is unpinned first. A message with an open content report is kept until an admin resolves or dismisses the report. On account deletion authorship is detached (`sender_id` set null) [037]. |
| **Direct messages** (user ↔ approved clinic only [032]) | `conversations`, `conversation_participants`, `messages`. | Participants — `"participants read messages" … using (public.is_conversation_member(conversation_id))` [001]. **Admins** — `"admins read all direct messages" … using (public.is_admin())` [032] (and the admin DM oversight tab). | No automatic deletion. On account deletion the user's own sent messages and memberships are deleted [009]; the other person's messages stay. |
| **Notifications** (title + text excerpt, e.g. first 140 characters of a DM or case description) | `notifications`. | Only the recipient — `"read own notifications"` [001]. | **90 days** after creation (`run_retention()` [038]); earlier on account deletion [009]. |

### A4. Ratings, blocks, moderation

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Clinic ratings** (stars + optional note, rescuer ID) | `vet_ratings` [014]. | **Public** — `"vet ratings are viewable by everyone" … using (true)` [014]; `grant select … to anon`. Includes `rescuer_id`. | Deleted when the rescuer's account is deleted (FK `on delete cascade`). |
| **Block list** | `blocked_users`. | Only the blocker — `"manage own block list" … using (blocker_id = auth.uid())` [007]. | Deleted on account deletion (either side) [009]. |
| **Content reports** (reason text, target) | `content_reports`. | The reporter and admins — `"admins and authors read reports"` [003]. | Deleted if the reporter deletes their account [009] or the target case/profile is deleted (cascade). When a reported case-chat message is deleted by retention, the report stays with its message link cleared (`on delete set null` [038]). |
| **Moderation state** (hidden cases/messages, bans) | `cases.hidden`, `case_messages.hidden`, `profiles.banned`. | Hidden rows: admins only. Ban flag: user + admins. | No deletion. |

### A5. Vet clinics

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Clinic name, address, map position, public phone & email, hours, accepted animals** | `vets`. | **Public** for approved clinics — column grant `(id, clinic_name, contact_phone, contact_email, address, lat, lng, is_open, opens_at, closes_at, is_24_7, timezone, accepted_animals, status, created_at)` [014] + policy `"approved vets are public; owners and admins see all"` [003]. | Deleted on account deletion (`delete from public.vets where id = uid` [009]). |
| **Manager name, surname, phone** | `vets.manager_name`, `manager_surname`, `manager_phone` [014]. | The clinic owner and admins (not in the public column grant). | Deleted on account deletion. |
| **Verification documents** (licence, registration, ID — any file) | Private bucket `vet-documents`; rows in `vet_documents` [014]. | The clinic and admins — `"vet and admin read vet documents"`, storage policy `"vet and admin read own document files"` [014]. | Row deleted when the clinic is deleted (cascade). **Files: no code deletes them on account deletion** (only when the vet removes a document in-app). Uploaded as-is (no re-encoding). |

### A6. Push notifications

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Push subscription** (browser push endpoint URL + encryption keys) | `push_subscriptions` [003]. | Only the owner — `"users manage own push subscriptions"` [003]; read by the `send-push` Edge Function with the service role. | Deleted when the user turns push off (`disablePush`), when the push service reports the endpoint gone (404/410 in `send-push`), or on account deletion [009]. |

### A7. Guests (no account)

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Anonymous session** | Supabase Auth creates an anonymous user (`signInAnonymously()` in `src/lib/api.ts`) — silently when browsing (to load photos) or when reporting. No `profiles` row (`handle_new_user` returns early `if new.is_anonymous` [024]). | Its ID appears publicly as `cases.creator_uid` on the guest's reports. | **Deleted 30 days after creation** unless the guest still has an open report; `creator_uid` is cleared on their finished reports first (`run_retention()` [038]). |
| **Guest report content** | Same as A2 (incl. `guest_name`, `terms_version`/`terms_accepted_at`). | Public. | No deletion. |

### A8. On the user's device

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Login session** (access/refresh token and the user object incl. email and sign-up metadata) | Browser `localStorage` (Supabase client default key `sb-<project>-auth-token`). | The device. | Until sign-out / expiry / browser data cleared. |
| **App settings** | `localStorage`: `pawline-locale`, `pawline-onboarded-v1`, `pawline-safety-ack-v1`, `pawline-pin-hint-seen`, `pawline-oauth-vet-pending`, `pawline-vet-setup-pending-email` (**contains the email address typed at sign-up**, removed after the first vet sign-in). | The device. | Until cleared. |
| **Offline report queue** (full report: description, location, landmark, guest name, photos, consent version) | IndexedDB database `pawline-offline` (`src/lib/offlineQueue.ts`). | The device. | Until sent; a guest report refused for missing consent (035) stays on the device indefinitely. |
| **Cached case photos** | Service-worker cache `case-photos`. | The device. | Max 200 entries / 7 days. |

### A9. Error monitoring

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Crash/error reports** | Sentry, only if `VITE_SENTRY_DSN` is set (`src/lib/monitoring.ts`). Config: `sendDefaultPii: false`, `tracesSampleRate: 0.05`, no session replay. | Operator's Sentry account. | **[TO CONFIRM: whether `VITE_SENTRY_DSN` is set in production (it is empty in the local `.env`); Sentry project data region and retention.]** |

---

## Part B — Third parties that receive personal data

| Service | What it receives | Why | Notes |
|---|---|---|---|
| **Supabase** (database, auth, storage, realtime, Edge Functions) | Everything in Part A (except device-only items). | Hosts the whole backend. | Project `pgvxabettdkgrsrhftdp.supabase.co`. Region: **[TO CONFIRM — owner to fill in]**. |
| **Vercel** | Requests for the app's files (IP address, user agent, URL) — the app is a static site (`vercel.json`). | Hosting the web app. | **[TO CONFIRM: Vercel region and log retention.]** |
| **Google Maps Platform** (Maps JavaScript API, Places, Geocoding) | Map views: the user's approximate viewport and IP/browser data. **Location search** text typed by the user (Places Text Search, `LocationSearch` in `src/components/maps.tsx`). **Reverse geocoding**: the exact lat/lng of every report (`reverseGeocode()` in `src/lib/gmaps.ts`). App language. | Showing maps, searching places, turning the report location into a street address. | API key set in the local `.env`. **[TO CONFIRM: production key + Google's terms/DPA acceptance.]** |
| **Google Sign-In** (via Supabase Auth OAuth) | The user's Google identity; Google returns name, email and profile picture to Supabase, and the app stores name/picture (`handle_new_user` [024]). | "Continue with Google". | |
| **Cloudflare Turnstile** | Browser signals from guests before their first anonymous session when enabled (`src/lib/turnstile.ts`). | Bot protection on guest reports. | Only active if `VITE_TURNSTILE_SITE_KEY` is set — empty in the local `.env`. **[TO CONFIRM: production setting.]** |
| **Sentry** | Error details (stack traces, page URL — which can contain case IDs — browser/OS info). `sendDefaultPii: false`, so no user identity is attached by default. | Finding crashes. | **[TO CONFIRM: active in production? IP handling and data region.]** |
| **Web push services** (e.g. Google FCM for Chrome/Android, Mozilla for Firefox, Apple for Safari — chosen by the user's browser) | The push endpoint and an **encrypted** notification payload (title, excerpt, link) sent by the `send-push` Edge Function via `web-push` with VAPID keys. The push service cannot read the encrypted payload. | Delivering notifications when the app is closed. | Requires `VITE_VAPID_PUBLIC_KEY` (empty in the local `.env`). **[TO CONFIRM: production setting, and how the `send-push` function is triggered (database webhook?).]** |
| **Google Fonts** | — | — | Allowed in the CSP (`vercel.json`) but **not used**: fonts are self-hosted (`@fontsource-variable/dm-sans`). No data sent. |

---

## Part C — Draft Privacy Policy

*(Plain-language text for users. Items marked [TO CONFIRM] must be resolved before publishing.)*

### C1. Who runs Stray's Call

Stray's Call is operated by **[TO CONFIRM: operator name / legal entity, registration number, address]**, who is the data controller for the personal data described here.

Contact: **fikretmutallimov@gmail.com** [TO CONFIRM: whether a dedicated privacy contact / DPO is needed].

### C2. What we collect and why

- **Your account:** email address and password (to sign you in); first name, last name and optional phone (so clinics and rescuers know who they are dealing with); a display name built from your name; your language. If you sign in with Google, we receive your name, email and profile picture from Google.
- **Alert settings:** if you choose "alerts near me", the home area and radius you set, so we only notify you about animals near you.
- **Reports:** the photos you take, a description, the animal's condition and urgency, the exact spot you place on the map, an optional landmark, and a street address we look up from that spot. If you report as a guest, the optional name you type.
- **Rescues:** if you rescue an animal, your role on the case and — only while you are driving the animal to a clinic — your device's location, updated about every 45 seconds.
- **Messages:** what you write in case chats and in direct messages with clinics.
- **Ratings, blocks and reports** you make.
- **Notifications:** copies of the alerts we send you, and, if you turn on push notifications, a technical address for your device.
- **Consent records:** when you confirmed you are 18+ and accepted the Terms and this policy, and which version.
- **Clinics** also provide clinic details, a private manager contact, and optional verification documents.
- **Technical data:** a session identity for your device (also for guests), and — if enabled — error reports [TO CONFIRM: Sentry].

We use this data only to run the rescue service: publishing reports, alerting nearby helpers, coordinating rescues and clinics, keeping the platform safe (spam limits, moderation), and providing your account.

### C3. Legal basis

We process your data on the basis of **your consent**, which you give:
- when you create an account (the two required boxes: "I am 18 or older" and "I agree to the Terms and the Privacy Policy"), recorded with the date and version;
- as a guest, on the report form (the same two boxes), recorded with your report;
- for location while en route, by starting a transport; for push notifications, by turning them on.

[TO CONFIRM with counsel: whether any processing (e.g. spam prevention, moderation, keeping rescue history after deletion) should instead rely on another basis under the Law on Personal Data.]

### C4. Who can see what

**Public — anyone, even without an account:**
- reports: photos, description, condition, the exact location and street address, landmark, status, timeline, and the guest name if one was given;
- case chats;
- your display name, profile picture, role, join date, "animals helped" count and partner organisation;
- clinic ratings, including who left them;
- while you are transporting an animal, your live location on that case;
- a technical identifier for the device that submitted each report (so reports from the same device can be linked).

**People involved in a conversation:** direct messages are visible to the two participants.

**Only you:** your email, name and phone fields, home area and alert settings, language, notifications, block list, the reports you filed about content, and your consent records.

**Administrators** can see everything above, plus: all users' email addresses, **all direct messages**, content reports, hidden content, clinic verification documents and private manager contacts. Admins use this only to review abuse reports, approve clinics and fix problems.

### C5. Where your data is stored (cross-border transfer)

Our data is stored with Supabase in **[TO CONFIRM — region]**, outside Azerbaijan. The app is served by Vercel **[TO CONFIRM: region]**. Maps, place search and street-address lookups are provided by Google. By using Stray's Call you consent to this transfer. [TO CONFIRM with counsel: whether the Law on Personal Data requires additional steps for this cross-border transfer, e.g. adequacy or specific consent wording.]

### C6. How long we keep it

- **Your account and profile:** until you delete your account.
- **Reports and case timelines:** kept as the rescue record. Open reports nobody takes are closed after 24 hours but not deleted.
- **Case chats:** deleted 90 days after the case is resolved or closed (a message under review by moderators is kept until the review ends).
- **Photos:** deleted 6 months after the case is resolved or closed.
- **Guest (no account) sessions:** deleted after 30 days, unless you still have an open report; your finished reports stay, no longer linked to that session.
- **Clinic verification documents:** kept while the clinic's account exists.
- **Your live location while en route:** removed from the case as soon as the animal is delivered, the rescue is dropped, or the rescue is automatically reopened after 75 minutes without progress.
- **Direct messages:** until the account that owns them is deleted.
- **Notifications:** 90 days.
- **Push device addresses:** until you turn push off, the device stops accepting pushes, or you delete your account.
- **On your device:** your session, settings and any unsent offline reports stay in your browser until sent or until you clear its data; cached photos for up to 7 days.

### C7. Your rights

You can:
- **See and export your data:** Settings → Data & account → **Export my data** downloads a file with your profile, clinic details (if any), the cases you reported or rescued, the case chat and direct messages you sent, the cases you watch, the content reports you filed, your push devices and your block list.
- **Correct your data:** Settings → Personal information (first name, last name, phone); alert settings, area and language in Settings.
- **Delete your account:** Settings → Data & account → **Delete my account**. This permanently removes your sign-in, profile, alert settings, notifications, push devices, block list, content reports, "not here" flags, watched cases, your sent direct messages and conversation memberships, and your clinic (if you are a vet). Reports you created or rescued stay as anonymous rescue history, with your account unlinked. [TO CONFIRM — see D1: deletion currently fails for users who have posted in a case chat; photos and clinic document files are not deleted.]
- **Withdraw consent:** by deleting your account (and, for location or push, by stopping the transport or turning push off).
- Contact us at the address in C1 for anything else [TO CONFIRM: response time, complaint authority in Azerbaijan].

### C8. 18+ only

Stray's Call is only for people aged 18 and over. Everyone confirms this before creating an account or submitting a report as a guest.

### C9. Photos

Photos are resized and re-encoded on your device before upload, which removes the hidden metadata (EXIF, including GPS position) that phones attach. [TO CONFIRM: `compressImage()` in `src/lib/photos.ts` falls back to uploading the **original file, metadata included,** if the browser can't create a canvas context or `canvas.toBlob()` returns nothing — rare, but the statement isn't absolute unless that fallback is changed. Clinic verification documents are uploaded as-is.] Report photos are public so rescuers can recognise the animal.

### C10. Location

We use your location only: (1) where you place the pin on a report (public), (2) your chosen home area for alerts (private), (3) your device location while you transport an animal (public on that case, removed at delivery), and (4) to centre the map and show distances on your device (not stored). Report locations are sent to Google to look up a street address.

### C11. What we never do

We don't sell your data, we don't show targeted advertising, and we don't process payments. If a clinic shares bank details in a case chat, any payment happens directly between you and the clinic, outside Stray's Call.

### C12. Changes to this policy

When we change the Terms or this policy materially, we update the version number, and everyone with an account is asked to accept again before continuing to use the app. Guests accept the current version with each report.

---

## Part D — Mismatches: current live policy vs. what the code does

Live policy = `PRIVACY.en` in `src/components/extras.tsx` (az/tr say the same).

1. **"You can delete your account and messages by contacting the Stray's Call team."** — There is an in-app **Delete my account** and **Export my data** (Settings), backed by `delete_my_account()` and `export_my_data()`. **Code bug:** `delete_my_account()` runs `update public.case_messages set sender_id = null`, but `case_messages.sender_id` is declared `not null` [001] and no migration relaxes it — so **account deletion fails (and rolls back entirely) for anyone who has ever posted in a case chat**.
2. **"Direct messages can be read only by the people in the conversation."** — False: `"admins read all direct messages" … using (public.is_admin())` [032], and there is an admin DM oversight tab.
3. **"Your email … [is] not public"** — true for the public, but admins can see **every user's email** via `admin_list_users()` [030]. Not mentioned.
4. **What is collected** omits: first/last name and phone [014], language, the Google profile picture, consent records [034/035], safety acknowledgment [009], ratings, block lists, content reports, notification contents, clinic manager contacts and verification documents.
5. **"Your display name and level are public"** — XP/level is no longer shown in the UI but `xp` is still publicly readable; also public but unmentioned: avatar, role, `cases_helped`, join date, partner organisation.
6. **Live location:** the policy says it "appears on that case until delivery, then it is removed". Removal is correct (delivery, drop, or 75-min auto-revert), but the location is readable by anyone through the public `cases` table grant, not only on the case page.
7. **Guest identity:** "an anonymous technical identity used only to prevent spam" — the anonymous ID is stored in `cases.creator_uid`, which is **publicly readable**, so anyone can link reports from the same device.
8. **Case table exposure:** the table-level `grant select on public.cases to anon, authenticated` [004] makes *every* case column public — including `creator_uid`, `guest_name`, rescuer live location and the consent fields. The policy doesn't reflect this; it may be worth restricting with column grants instead.
9. **Photos:** no mention that photos are public, re-encoded (EXIF stripped) on the device, cached on the device for 7 days, and **never deleted** (no code deletes storage files, even on account deletion). Clinic document files are also not deleted on account deletion.
10. **No mention of third parties** (Supabase, Vercel, Google Maps/Places/Geocoding — which receives every report location — Google Sign-In, Turnstile, Sentry, browser push services).
11. **No mention of storage location / cross-border transfer.**
12. **No retention periods** in the live policy. Decided periods (038): case chats 90 days and photos 6 months after the case is resolved/closed, notifications 90 days, guest sessions 30 days (no open report); reports themselves stay.
13. **No age requirement** in the policy (the app now requires 18+ for accounts and guest reports).
14. **No legal basis / consent statement**, and no mention that users re-accept when `TERMS_VERSION` changes.
15. **Public case timeline, duplicate flags and ratings** (with rater ID) are not mentioned.
16. **Local device storage** (session, offline report queue incl. photos and location, the vet-signup email kept in `localStorage`) is not mentioned.
17. **Minor:** `safety_ack_at` still has a direct column `UPDATE` grant [007/009] alongside its RPC — inconsistent with the "RPC only" approach used for consent (034). Not a policy statement, noted for completeness.
