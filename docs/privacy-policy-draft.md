# Stray's Call — Privacy Policy

> **Status:** Part C is the policy text, live in the app in English, Azerbaijani and Turkish (`PRIVACY` in `src/components/extras.tsx`, `TERMS_VERSION` 2026-10-01). The AZ and TR translations await review by a native speaker. Not reviewed by legal counsel.
> **Basis:** every statement below was checked against the code and migrations on `main` at commit `f407367` (migrations 001–038, the `delete-account` Edge Function, captcha tokens on every Supabase auth call). The one open point is in **Part E**.
> **Production (confirmed by the operator):** migrations 036, 037 and 038 and the `delete-account` Edge Function are live; Supabase region `eu-west-3` (Paris, France); Vercel serves static files only (no Vercel Functions); Sentry, Cloudflare Turnstile (Supabase Auth captcha), web push and Google Maps are on.
> **Target law:** Law of the Republic of Azerbaijan "On Personal Data". Users are in Azerbaijan; the data is stored outside Azerbaijan (§C6).

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

*(The in-app policy is this text, in English, Azerbaijani and Turkish; formal register.)*

**Privacy Policy**

Effective date: 1 October 2026

This Privacy Policy describes how personal data is processed in connection with the Stray’s Call web application and its related services.

### C1. Data Controller

The data controller responsible for the processing of personal data described in this Policy is Fikrat Mutallimov, an individual (the “Controller”, “we”, “us”). The Controller may be contacted by email only, at fikretmutallimov@gmail.com.

### C2. Personal Data We Process and Purposes

We process the following categories of personal data: (a) account data: email address and password; first name, last name and, optionally, telephone number, so that clinics and rescuers can identify the persons with whom they are dealing; a display name derived from the first and last name; and the selected language. Where you sign in with Google, we receive your name, email address and profile picture from Google; (b) alert settings: where you elect to receive alerts about nearby cases, the home area and radius you specify; (c) report data: photographs, description, the animal's condition and urgency, the exact location marked on the map, an optional landmark, and a street address derived from that location; for guest reports, the name optionally provided; (d) rescue data: your role in a case and, solely while you are transporting an animal to a clinic, the location of your device at intervals of approximately 45 seconds; (e) the content of messages you send in case chats and in direct messages with clinics; (f) ratings, blocks and content reports you submit; (g) copies of notifications sent to you and, where you enable push notifications, a technical address of your device; (h) consent records: the date and version of your confirmation that you are at least 18 years of age and of your acceptance of the Terms of Service and this Policy; (i) for clinics, in addition: clinic details, the private contact details of a manager, and verification documents; (j) technical data: a session identifier for your device (including for guests), data processed for automated bot detection (Cloudflare Turnstile), and error reports (Sentry). Personal data is processed solely for the purposes of operating the rescue service: publishing reports, alerting nearby helpers, coordinating rescues and clinics, maintaining the security of the platform (bot detection, spam limits and moderation), and providing your account.

### C3. Legal Basis for Processing

Personal data is processed on the basis of your consent and where processing is necessary to operate the service and maintain its security. Consent is given: when you create an account, by ticking the mandatory boxes “I am 18 or older” and “I agree to the Terms of Service and the Privacy policy”, which are recorded together with the date and version; for guest reports, by ticking the same boxes for each report, which are recorded with the report; for location data during transport, by starting the transport; and for push notifications, by enabling them. Processing necessary to operate the service and maintain its security comprises bot detection, spam limits, moderation, and the retention of rescue history in anonymised form after an account has been deleted.

### C4. Publicly Visible Information

Information described as public may be viewed by anyone, including persons without an account. In respect of a case, the following information is public: the animal, description, condition, urgency, exact location and street address, landmark, status and associated times, the guest name where provided, the case timeline, the case chat, and the accounts that reported, rescued and treated the animal. Photographs of a case are visible to all users of the application. The following information is also public: your display name, profile picture, role, date of joining, number of animals helped and partner organisation; clinic ratings, including the identity of the person who submitted them; and the public details of approved clinics. The following information is not public: the device or guest session from which a report was submitted; consent records; cases hidden by moderators; and the live location of the rescuer, which is accessible only to the participants in the case concerned (the reporter, the rescuer and the clinic) and to administrators.

### C5. Access to Personal Data and Recipients

Direct messages are accessible to the two participants in the conversation and to administrators. Your email address, name and telephone number, home area and alert settings, language, notifications, block list, content reports submitted by you and consent records are accessible only to you and to administrators. Administrators have access to the email addresses of all users, all direct messages, content reports, hidden content, clinic verification documents and manager contact details, and use such access solely to review abuse reports, approve clinics and resolve technical issues. In its capacity as database operator, the Controller has technical access to all stored data. The recipients of personal data are the service providers listed in Section 6.

### C6. Storage Location and International Transfers

The database, files and authentication service are hosted by Supabase in the European Union (Paris, France), outside the Republic of Azerbaijan. The application's files are delivered through Vercel's global network; Vercel retains request logs for a short period for security purposes. Maps, place search and street-address lookups are provided by Google, and bot detection by Cloudflare. Error reports are transmitted to Sentry and retained for its standard retention period. Push notifications are delivered through the push service of your browser. Personal data is stored in the European Union (France) and processed by the above providers in various countries. By using Stray's Call, you consent to this international transfer of personal data.

### C7. Retention Periods

Personal data is retained for the following periods: account and profile data — until the account is deleted; reports and case timelines — retained as the rescue record, and open reports that are not taken up are closed after 24 hours and are not deleted; case chats — deleted 90 days after the case is resolved or closed, save that a message under review by moderators is retained until the review is completed; photographs — currently retained together with the case, and a retention period will be added to this Policy once automated deletion of photographs is in place; live location during transport — deleted upon delivery of the animal, withdrawal from the rescue, or automatic reopening of the rescue after 75 minutes without progress; direct messages — until either participant deletes their account, whereupon the entire conversation is deleted; notifications — 90 days; guest sessions — deleted after 30 days unless an open report exists, while completed reports are retained without any link to the session; clinic verification documents — for as long as the clinic's account exists; push device addresses — until push notifications are disabled, the device ceases to accept them, or the account is deleted. Data stored on your device (session, settings and unsent offline reports) remains in your browser until it is sent or the browser data is cleared; cached photographs are kept for up to 7 days.

### C8. Your Rights

You have the right to access your personal data and obtain a copy of it via Settings → Data & account → Export my data, and to rectify it via Settings → Personal information; alert, area and language settings may be changed in Settings. You may delete your account via Settings → Data & account → Delete my account. Deletion permanently removes your sign-in credentials and email address, profile, alert settings, notifications, push devices, block list, content reports submitted by you, “not here” flags, watched cases, clinic ratings submitted by you, all direct-message conversations in which you participate (for both participants) and, in the case of clinics, the clinic and its verification documents. Messages you have posted in case chats remain in the case and are displayed as “Deleted account”. Cases you created or rescued are retained as rescue history without any link to you. Where a rescue in which you are participating is in progress, the case is reopened to other rescuers; where your clinic is expecting an animal, the rescuer is asked to select another clinic. You may withdraw your consent by deleting your account or, in respect of location data or push notifications, by stopping the transport or disabling push notifications. Any other request may be sent to fikretmutallimov@gmail.com. We will respond as soon as possible and within any time limit prescribed by law. You also have the right to lodge a complaint with the data protection authority in your country.

### C9. Age Requirement

Stray's Call is intended solely for persons aged 18 and over. Each user confirms that they meet this requirement before creating an account or submitting a report as a guest.

### C10. Photographs and Location Data

Photographs are resized and re-encoded on your device before upload, which removes embedded metadata such as GPS position; where this cannot be done, the photograph is not uploaded. Clinic verification documents are uploaded in their original form and are accessible only to the clinic concerned and to administrators. Location data is used solely for the following purposes: the location marked on a report (public); the home area selected for alerts (not public); the location of your device while transporting an animal (accessible only to the participants in the case concerned and to administrators, and deleted at the end of the transport); and centring the map and displaying distances on your device (not stored). Report locations are transmitted to Google in order to determine a street address.

### C11. Our Commitments

We do not sell personal data, do not display targeted advertising and do not process payments. Where a clinic shares bank details in a case chat, any payment is made directly between you and the clinic, outside Stray's Call.

### C12. Changes to This Policy

In the event of material changes to the Terms of Service or this Policy, the version will be updated and all account holders will be asked to accept the updated version before continuing to use the service. Guests accept the version in force when submitting each report.

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
