# Stray's Call — Privacy Policy

> **Status:** Part C is the policy text, live in the app in English, Azerbaijani and Turkish (`PRIVACY` in `src/components/extras.tsx`, `TERMS_VERSION` 2026-10-01). The AZ and TR translations await review by a native speaker. Not reviewed by legal counsel.
> **Basis:** every statement below was checked against the code and migrations on `main` at commit `f407367` (migrations 001–038, the `delete-account` Edge Function, captcha tokens on every Supabase auth call). The one open point is in **Part E**.
> **Production (confirmed by the operator):** migrations 036, 037 and 038 and the `delete-account` Edge Function are live; Supabase region `eu-west-3` (Paris, France); Vercel serves static files only (no Vercel Functions); Sentry, Cloudflare Turnstile (Supabase Auth captcha), web push and Google Maps are on.
> **Target law:** Law of the Republic of Azerbaijan "On Personal Data". Users are in Azerbaijan; the data is stored outside Azerbaijan (§C5).

---

## Part A — Data inventory

"**Public**" means readable by **anyone, including people with no account**: the database grants `SELECT` on those rows/columns to the `anon` role (the app's public API key) and the row-level-security (RLS) policy allows the row. Quotes are from the migrations; the number in brackets is the migration file.

### A1. Account & profile (`public.profiles`, plus Supabase Auth `auth.users`)

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Email address** | Supabase Auth (`auth.users.email`) — not in `profiles`. | The user. **Admins**: `admin_list_users()` returns every account's email [030] (callable only when `is_admin()`). Not readable by other users. | Until account deletion (`delete from auth.users` in `delete_my_account()` [037]). |
| **Password** | Supabase Auth, hashed by Supabase. | Nobody. | Until account deletion. |
| **First name, last name, phone** | `profiles.first_name`, `last_name`, `phone` [014]. | The user (`get_my_profile()` [005]). Not in the public column grant `(id, display_name, avatar_url, role, xp, cases_helped, created_at)` [005] + `partner_org` [006]. | Until account deletion (row cascades from `auth.users`). |
| **Display name** | `profiles.display_name` (first + last name). | **Public** (column grant; RLS `using (true)` [001]). Shown on cases, chats, ratings. | Until account deletion. |
| **Avatar URL** | `profiles.avatar_url` — the Google profile-picture URL for Google sign-ups [024]; no avatar files are uploaded. | **Public.** | Until account deletion. |
| **Role, XP, "animals helped", join date, partner organisation** | `profiles.role`, `xp`, `cases_helped`, `created_at`, `partner_org`. | **Public** [005/006]. XP is not shown in the app but is readable. | Until account deletion. |
| **Language** | `profiles.locale` — `az`, `tr` or `en` in the app. The database also accepts `ru` [016], but Russian is hidden (`ENABLED_LOCALES = ['az','tr','en']`, `src/i18n/index.ts`). | The user; not public. | Until account deletion. |
| **Home area, alert radius, alert preference** | `profiles.home_lat`, `home_lng`, `notify_radius_km`, `new_case_pref`. | The user; used server-side to choose who gets new-case alerts [013]. | Until account deletion. |
| **Admin / banned flags** | `profiles.is_admin`, `banned` [003]. | The user (own row), admins. | Until account deletion. |
| **Safety acknowledgment** | `profiles.safety_ack_at` [009] + `localStorage` `pawline-safety-ack-v1`. | The user. | Until account deletion / browser data cleared. |
| **Terms / age consent (accounts)** | `profiles.terms_accepted_at`, `terms_version` [034], written only by `record_terms_acceptance()` (server time); also `terms_version` in the sign-up metadata. Re-asked whenever `TERMS_VERSION` changes (`ConsentGate`). | The user; not public. | Until account deletion. |

### A2. Reports / cases (`cases`, `case_photos`, bucket `case-photos`, `case_rescuer_locations`)

Since 036, `cases` has a **column-level** read grant to `anon, authenticated`: `(id, reporter_id, guest_name, animal, description, lat, lng, address_hint, street_address, status, rescuer_id, vet_id, created_at, accepted_at, resolved_at, hidden, escalated_at, closed_reason, injury_type, spot_type, urgency, pinned_message_id, chat_closed_at)` [036]. Rows: `"visible cases are viewable by everyone" … using (not hidden or public.is_admin())` [003]. **Server-only** (no client can read them): `creator_uid`, `terms_version`, `terms_accepted_at`, `last_progress_at` [036], `closed_at` [038].

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Exact location of the animal** | `cases.lat`, `lng`. | **Public.** | Kept with the case (cases are not deleted; unclaimed open cases close after 24 h, `expire_unclaimed_cases()` [007]). |
| **Street address** | `cases.street_address` [029], looked up once from lat/lng by Google Geocoding at report time. | **Public.** | Kept with the case. |
| **Landmark, description, animal, condition, spot type, urgency** | `cases.address_hint`, `description`, `animal`, `injury_type`, `spot_type`, `urgency`. | **Public.** | Kept with the case. |
| **Guest's optional name** | `cases.guest_name`. | **Public.** | Kept with the case. |
| **Reporter / rescuer / clinic account IDs** | `cases.reporter_id`, `rescuer_id`, `vet_id`. | **Public** (names via public `profiles`). | Kept; cleared for a user who deletes their account [037]. |
| **Session that created the report** | `cases.creator_uid` (guests: the anonymous session ID). | **Server-only** [036]; used for spam limits and to let the creator's session add photos (`is_case_creator()`). | Cleared on account deletion [037] and when a guest session is deleted after 30 days [038]. |
| **Guest consent** | `cases.terms_version`, `terms_accepted_at` [035] (server time; required for guest reports). | **Server-only** [036]. | Kept with the case. |
| **Rescuer's live location** | `case_rescuer_locations` (one row per case) [036], written by `update_rescuer_location()` about every 45 s, only while the case is `en_route`. | **Case participants only**: `is_case_participant()` = the reporter, the session that created the report, the rescuer, the clinic, and admins [036]. **Not** watchers, not the public. | Deleted on delivery (`confirm_delivery`), drop (`drop_case`), automatic reopen after 75 min without progress (`revert_abandoned_cases`) [036], and when the rescuer deletes their account [037]. |
| **Photos (report & delivery)** | Private bucket `case-photos` [018]; `case_photos.path`. Re-encoded on the device before upload (max 1600 px, JPEG), which drops EXIF/GPS; if re-encoding fails, EXIF segments are stripped from the JPEG bytes; if that fails too, the photo is refused — **an original file is never uploaded** (`src/lib/photos.ts`). | Photo rows: readable by anyone [011] (`grant select … to anon` [004]). Files: storage policy `… to authenticated` [018], via 1-hour signed URLs; guests get an anonymous session automatically (after the Turnstile check), so in practice anyone using the app sees photos of visible cases. | **Kept with the case.** 038 counts photos 6 months past resolve/close, but the file-deletion job is not built (OPERATOR_GUIDE B12). Device cache: service worker `case-photos`, 200 entries / 7 days. |
| **Photo fingerprint** | `case_photos.phash` (64-bit perceptual hash, computed on the device) [003]. | **Public** (table grant). | Kept with the photo row. |
| **Case timeline** | `case_events` (`actor_id`, `note`). | **Public** — `using (true)` [001]. | Kept with the case; `actor_id` set null when that account is deleted. |
| **Duplicate-report flags** | `case_duplicate_flags`. | **Public** — `using (true)` [003]. | Kept. |
| **Realtime change signal** | `case_signals` (`case_id`, `hidden`, time) [036]. | **Public.** No personal data. | Kept with the case. |
| **"Animal not here" flags** | `case_not_here_flags`. | Only the flagger [007]. | Deleted on account deletion [037]. |
| **Watching a case** | `case_watchers` (+ `last_read_at` [017]). | Only the watcher [001]. | Deleted on account deletion [037]. |

### A3. Messaging

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Case chat messages** (clinics may post bank details) | `case_messages`. | **Public** — `using (not hidden or public.is_admin())` [003], grant to `anon` [004]. Posting needs an account in good standing, and not in a chat the clinic closed [032]. | **90 days after the case is resolved or closed** (`run_retention()`, daily job `pawline-retention` [038]); a pinned message is unpinned first; a message with an open content report waits for the admin. On account deletion the message stays with the author removed (`sender_id` → null, shown as "Deleted account") and is unpinned if pinned [037]. |
| **Direct messages** (a user ↔ an approved clinic only [032]) | `conversations`, `conversation_participants`, `messages`. | The two participants [001]. **Admins read all DMs** — `"admins read all direct messages" … using (public.is_admin())` [032], plus the admin DM oversight tab. | **No time limit.** When **either** participant deletes their account, the whole conversation is deleted for both, with its notifications [037]. |
| **Notifications** (title + excerpt, e.g. first 140 characters of a DM or case description) | `notifications`. | Only the recipient [001]. | **90 days** [038]; earlier on account deletion. |

### A4. Ratings, blocks, moderation

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Clinic ratings** (stars, optional note, rater ID) | `vet_ratings` [014]. | **Public**, including `rescuer_id`. | Deleted when the rater's account or the clinic is deleted (cascade). |
| **Block list** | `blocked_users`. | Only the blocker [007]. | Deleted on account deletion (either side) [037]. |
| **Content reports** (reason, target) | `content_reports`. | The reporter and admins [003]. | Deleted when the reporter deletes their account, or the reported case/profile is deleted (cascade). When retention deletes a reported chat message, a reviewed report stays with the message link cleared (`on delete set null` [038]). |
| **Moderation state** | `cases.hidden`, `case_messages.hidden`, `profiles.banned`. | Hidden rows: admins only. Ban flag: user + admins. | Kept. |

### A5. Clinics

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Clinic name, address, map position, public phone & email, hours, accepted animals** | `vets`. | **Public** for approved clinics (column grant [014], policy [003]). | Until account deletion [037]. Cases in progress with the clinic go back to the rescuer to choose another clinic [037]. |
| **Manager name, surname, phone** | `vets.manager_*` [014]. | The clinic and admins. | Until account deletion. |
| **Verification documents** (any file type) | Private bucket `vet-documents`, rows in `vet_documents` [014]. **Uploaded as-is** — no re-encoding, so image files keep any EXIF/GPS they contain. | The clinic and admins [014]. | Kept while the clinic's account exists (not in retention). On account deletion the rows cascade and the `delete-account` Edge Function removes the files through the Storage API. |

### A6. Push notifications

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Push subscription** (endpoint URL + encryption keys) | `push_subscriptions` [003]. | The owner; read by the `send-push` Edge Function (service role), triggered by a database webhook on new `notifications` rows. | Until push is turned off, the push service reports the endpoint gone (404/410), or account deletion. |

### A7. Guests (no account)

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Anonymous session** | Supabase Auth anonymous user (`signInAnonymously()` in `src/lib/api.ts`), created when a guest first loads photos or submits a report — both after a Turnstile check. No `profiles` row [024]. | Server-only (`creator_uid`, [036]). | **Deleted after 30 days** unless the guest still has an open report; `creator_uid` is cleared on their finished reports first [038]. |
| **Guest report content** | As A2 (incl. `guest_name`; consent fields server-only). | As A2. | As A2. |

### A8. On the user's device

| Data | Where stored | How long kept |
|---|---|---|
| **Login session** (tokens + user object incl. email and sign-up metadata) | `localStorage` `sb-<project>-auth-token`. | Until sign-out / expiry / browser data cleared. |
| **App settings** | `localStorage`: `pawline-locale`, `pawline-onboarded-v1`, `pawline-safety-ack-v1`, `pawline-pin-hint-seen`, `pawline-oauth-vet-pending`, `pawline-vet-setup-pending-email` (**the email typed at clinic sign-up**, removed after the first sign-in). | Until cleared. |
| **Offline report queue** (description, location, landmark, guest name, photos — already metadata-free, consent version) | IndexedDB `pawline-offline`. | Until sent. A report that can never be sent (missing guest consent, or a photo that can't be cleaned) stays until browser data is cleared. |
| **Cached case photos** | Service-worker cache `case-photos`. | 200 entries / 7 days. |

### A9. Error monitoring

| Data | Where stored | Who can see it | How long kept |
|---|---|---|---|
| **Crash/error reports** | Sentry (on in production). `sendDefaultPii: false`, `tracesSampleRate: 0.05`, no session replay (`src/lib/monitoring.ts`). | The operator's Sentry account. | Sentry's standard retention period. |

---

## Part B — Third parties that receive personal data

| Service | What it receives | Why | Where |
|---|---|---|---|
| **Supabase** (database, auth, storage, realtime, Edge Functions) | Everything in Part A except device-only items. | Hosts the whole backend. | `eu-west-3`, Paris, France (AWS). |
| **Vercel** | Requests for the app's static files (IP address, browser user agent, URL). No Vercel Functions — no app data passes through Vercel. | Serving the web app. | Global edge network. Request logs are kept briefly by Vercel for security (no specific period stated). |
| **Google Maps Platform** (Maps JavaScript API, Places, Geocoding) | Map views (viewport, IP, browser data); place-search text typed by the user; the exact lat/lng of every report (reverse geocoding); app language. | Maps, place search, street address of a report. | Google (global, incl. the USA). |
| **Google Sign-In** (via Supabase Auth) | The Google identity; Google returns name, email and profile picture; the app stores name and picture URL [024]. | "Continue with Google". | Google. |
| **Cloudflare Turnstile** (Supabase Auth captcha, enforced) | Browser and device signals and IP address, when the app creates a guest session (first photo load or guest report) and on sign-up, email sign-in and password reset (`captchaOptions()`, `src/lib/turnstile.ts`). Usually invisible. | Bot protection. | Cloudflare (global). |
| **Sentry** | Error details: stack traces, page URL (can contain case IDs), browser/OS. `sendDefaultPii: false`. | Finding crashes. | **[TO CONFIRM: Sentry data region — US or EU.]** Kept for Sentry's standard period. |
| **Web push services** (chosen by the browser: Google FCM, Mozilla, Apple) | The device's push endpoint and an **encrypted** payload (title, excerpt, link), sent by `send-push` via `web-push` with VAPID keys; the push service can't read it. | Notifications when the app is closed. | The browser vendor's service. |
| **Google Fonts** | — | — | Allowed in the CSP but not used (fonts are self-hosted). No data sent. |

---

## Part C — Privacy Policy

*(Plain-language text for users. The in-app policy is this text, in English, Azerbaijani and Turkish.)*

### C1. Who runs Stray's Call

Stray's Call is run by **Fikrat Mutallimov**, an individual, who is the controller of the personal data described here. Contact by email only: **fikretmutallimov@gmail.com** (no postal address is published).

### C2. What we collect and why

- **Your account:** email and password (to sign you in); first name, last name and optional phone (so clinics and rescuers know who they are dealing with); a display name built from your name; your language. With Google sign-in we receive your name, email and profile picture from Google.
- **Alert settings:** if you choose "alerts near me", the home area and radius you set.
- **Reports:** photos, description, the animal's condition and urgency, the exact spot you place on the map, an optional landmark, and a street address we look up from that spot. As a guest, the optional name you type.
- **Rescues:** your role on a case and — only while you are driving an animal to a clinic — your device's location, about every 45 seconds.
- **Messages:** what you write in case chats and in direct messages with clinics.
- **Ratings, blocks and content reports** you make.
- **Notifications:** copies of the alerts we send you; if you turn on push, a technical address for your device.
- **Consent records:** when you confirmed you are 18+ and accepted the Terms and this policy, and which version.
- **Clinics** also provide clinic details, a private manager contact, and verification documents.
- **Technical data:** a session identity for your device (also for guests), a bot check (Cloudflare Turnstile), and error reports (Sentry).

We use this data only to run the rescue service: publishing reports, alerting nearby helpers, coordinating rescues and clinics, keeping the platform safe (bot checks, spam limits, moderation), and providing your account.

### C3. Legal basis

We process your data on the basis of **your consent**, and of **what is necessary to run the service and keep it safe**.

Consent, which you give:
- when you create an account — the two required boxes "I am 18 or older" and "I agree to the Terms of Service and the Privacy policy", recorded with the date and version;
- as a guest, on each report (the same two boxes), recorded with the report;
- for location while transporting an animal, by starting the transport; for push notifications, by turning them on.

Necessary to run the service and keep it safe: bot checks, spam limits, moderation, and keeping rescue history in anonymised form after an account is deleted.

### C4. Who can see what

**Public means anyone, even without an account or the app.** For a case, that is:
- the animal, description, condition, urgency, the exact location and street address, landmark, status and its timestamps, and the guest name if one was given;
- the case timeline and the case chat;
- which accounts reported, rescued and treated it (their display names);
- photos: everyone using the app can see the photos of a visible case.

Also public: your display name, profile picture, role, join date, "animals helped" count and partner organisation; clinic ratings including who left them; approved clinics' public details.

**Not public:** which device or guest session submitted a report; consent records; the rescuer's live location, which only the people on that case (reporter, rescuer, clinic) and administrators can see; cases hidden by moderators.

**Direct messages** are visible to the two participants **and to administrators**.

**Only you** (and administrators): your email, name and phone fields, home area and alert settings, language, notifications, block list, the content reports you filed, and your consent records.

**Administrators** can see all users' email addresses, **all direct messages**, content reports, hidden content, clinic verification documents and manager contacts. They use this only to review abuse reports, approve clinics and fix problems. As the database operator, the controller has technical access to all stored data.

### C5. Where your data is stored

Our database, files and sign-in service are hosted by Supabase in the European Union (Paris, France), outside Azerbaijan. The app's files are delivered by Vercel's global network; Vercel keeps request logs briefly for security. Maps, place search and street-address lookups are provided by Google, and the bot check by Cloudflare; error reports go to Sentry, which keeps them for its standard period; push notifications go through your browser's push service. Your data is stored in the EU (France) and processed by these providers around the world. By using Stray's Call you consent to this transfer.

### C6. How long we keep it

- **Your account and profile:** until you delete your account.
- **Reports and case timelines:** kept as the rescue record. Open reports nobody takes are closed after 24 hours, not deleted.
- **Case chats:** deleted 90 days after the case is resolved or closed. A message under review by moderators is kept until the review ends.
- **Photos:** currently kept with the case. We will add a deletion period to this policy when automatic photo cleanup is in place.
- **Your live location while transporting:** deleted when the animal is delivered, the rescue is dropped, or the rescue is reopened after 75 minutes without progress.
- **Direct messages:** until you or the other person deletes their account; then the whole conversation is deleted.
- **Notifications:** 90 days.
- **Guest sessions:** deleted after 30 days unless you still have an open report; your finished reports stay, no longer linked to the session.
- **Clinic verification documents:** while the clinic's account exists.
- **Push device addresses:** until you turn push off, the device stops accepting pushes, or you delete your account.
- **On your device:** your session, settings and any unsent offline reports stay in your browser until sent or until you clear its data; cached photos for up to 7 days.

### C7. Your rights

- **See and export your data:** Settings → Data & account → **Export my data** downloads a file with your profile, clinic details, the cases you reported or rescued, the case chat and direct messages you sent, the cases you watch, the content reports you filed, your push devices and your block list.
- **Correct your data:** Settings → Personal information (name, phone); alerts, area and language in Settings.
- **Delete your account:** Settings → Data & account → **Delete my account**. This permanently removes your sign-in and email, profile, alert settings, notifications, push devices, block list, the content reports you filed, "not here" flags, watched cases, the clinic ratings you left, every direct-message conversation you are in (for both people), and — for clinics — the clinic and its verification document files. Your case-chat messages stay in the case, shown as "Deleted account". Reports you created or rescued stay as rescue history, no longer linked to you. If you were in the middle of a rescue, the case reopens for other rescuers; if your clinic was expecting an animal, the rescuer is asked to choose another clinic.
- **Withdraw consent:** by deleting your account (for location or push: by stopping the transport or turning push off).
- For anything else, write to fikretmutallimov@gmail.com. We'll respond as soon as we can, within any time limit the law sets. You can also complain to the data protection authority in your country.

### C8. 18+ only

Stray's Call is only for people aged 18 and over. Everyone confirms this before creating an account or submitting a report as a guest.

### C9. Photos

Photos are resized and re-encoded on your device before upload, which removes hidden metadata such as GPS position. If that can't be done, the photo is not uploaded. Report photos can be seen by everyone using the app, so rescuers can recognise the animal. Clinic verification documents are uploaded as they are and are visible only to the clinic and administrators.

### C10. Location

We use location only: (1) where you place the pin on a report (public), (2) your chosen home area for alerts (private), (3) your device location while you transport an animal (visible only to the people on that case and administrators, deleted at the end of the transport), and (4) to centre the map and show distances on your device (not stored). Report locations are sent to Google to look up a street address.

### C11. What we never do

We don't sell your data, we don't show targeted advertising, and we don't process payments. If a clinic shares bank details in a case chat, any payment happens directly between you and the clinic, outside Stray's Call.

### C12. Changes to this policy

When we change the Terms or this policy materially, we update the version, and everyone with an account is asked to accept again before continuing. Guests accept the current version with each report.

---

## Part D — What changed from the previous live policy

The previous in-app policy (all three languages) said, or omitted:
1. Deleting an account required "contacting the Stray's Call team" — there is in-app **Delete my account** and **Export my data**.
2. "Direct messages can be read only by the people in the conversation" — **admins can read all DMs** [032].
3. Email "not public" — true, but admins can see every account's email [030].
4. Collected data omitted names and phone, language, Google picture, consent records, ratings, blocks, content reports, notifications, clinic manager contacts and documents.
5. "Your display name and level are public" — also public: picture, role, "animals helped", join date, partner organisation.
6. Live location "appears on that case" — it is now visible only to the people on the case and admins [036].
7. Guest identity — now server-only [036], and deleted after 30 days [038].
8. No photo handling, third parties, storage location, retention periods, age requirement, legal basis, bot check, or re-acceptance on changes.

## Part E — Remaining [TO CONFIRM]

1. **Sentry data region** — US or EU (Part B). The in-app policy does not name Sentry's region, so it is unaffected.

Also outstanding, not a [TO CONFIRM]: native-speaker review of the Azerbaijani and Turkish translations; legal review has not been done.
