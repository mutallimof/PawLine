# PawLine — Adversarial Testing & Security Audit Report

*Excellence pass, July 2026. Method: no live multi-browser simulation is
available in this environment, so this was done the systematic way — a
persona-by-persona trace of every flow through the actual code and SQL,
plus a **real local replay**: the full migration chain applied to a scratch
PostgreSQL 16 with a Supabase shim (`auth.uid()`/`auth.jwt()` driven by
impersonated JWT claims, `storage.objects` with RLS), and each attack
executed against it. Findings are listed before fixes, uncomfortable ones
first. The harness caught two bugs **in the fixes themselves** — recorded
below, because that's the point of testing.*

Severity: 🔴 must fix before launch · 🟠 real exposure · 🟡 hardening · ⚪ verified OK

---

## A. Security audit findings

### 🔴 S1 — Every user's home location was publicly scrapable
`profiles` had `SELECT using (true)` with a full-table grant: anyone —
including a logged-out visitor with curl — could download **every user's
`home_lat`/`home_lng` and alert radius**. A map of where users live: the
"skeptical journalist" headline. Case locations are public by design;
home locations never were.
**Fix (005):** column-level SELECT exposing only directory columns
(id, display name, avatar, role, XP, cases_helped, created_at); own full
row via `get_my_profile()` SECURITY DEFINER RPC; every client query
rewritten to explicit column lists.
**Verified (local replay):** as `anon`, `select home_lat from profiles` →
`permission denied`; directory columns still readable; app flows compile
and run on the restricted set.

### 🔴 S2 — Migration 004 fails on a fresh project
`004_grants.sql` granted on `conversation_members`; the table is
`conversation_participants`. **Empirically reproduced:** on a scratch
database, 004 aborts at that line and every grant after it never runs —
recreating the exact 403 bug it was written to prevent. It only "worked"
in production because grants had been applied manually first.
**Fix:** 004 corrected in-repo (fresh deploys); 005 re-issues the swallowed
grant (existing projects). **Verified:** chain 001→005 now replays clean.

### 🔴 S3 — Anyone could attach photos to anyone's case
`case_photos` INSERT allowed `kind='report'` with **no ownership or time
check** — any session could push arbitrary (including abusive) images into
any case, forever. Same gap in storage: any session could upload unlimited
files to the public bucket (free anonymous image hosting).
**Fix (005):** report photos only by the case's creator; delivery photos
only by its vet; storage INSERT requires the path's first folder to be a
case the uploader created/rescues/vets.
**Verified:** Bob→Alice's case: RLS violation; Alice→own case: insert OK.

### 🔴 S4 — `creator_uid` was client-supplied → rate-limit & identity spoofing
The rate limiter keys on `cases.creator_uid`, but nothing constrained it: a
modified client could rotate random uids (unlimited spam) or plant a
*victim's* uid — which, after S3's fix, would also have granted the victim
photo-attach rights on a case they never made (a policy-interaction bug).
**Fix (005):** BEFORE INSERT trigger forces `creator_uid :=
coalesce(auth.uid(), provided)` — client sessions always have a uid, so
the client value is always overridden; trusted no-JWT paths (seeds,
service_role) keep working.
**Verified:** forged insert as Bob landed with Bob's uid.
**Harness-caught bug #1:** the first version forced `auth.uid()`
unconditionally, silently NULLing creator on trusted inserts — which then
broke the owner's own photo policy. Caught locally, fixed via coalesce.

### 🟠 S5 — Anonymous rate limit resets with cleared site data
A fresh anonymous uid gets a fresh 4/hour budget. Not fully fixable without
CAPTCHA; damage is now bounded: **platform-wide circuit breaker** — max 40
anonymous-session reports/hour across the whole platform, beyond which
guests get a friendly "create a free account to report right now" while
registered reporting continues. Deliberately generous: a real
mass-casualty event must never trip before a spam wave does. The durable
fix (Cloudflare Turnstile on anonymous sign-in) is a dashboard toggle,
documented in OPERATOR_GUIDE.
**Verified:** 40 anon-created cases seeded → 41st anonymous report raises
the breaker; a registered user's report during the pause succeeds.

### 🟠 S6 — Users could rewrite their own notification contents
Table-wide UPDATE grant (needed only for mark-as-read) let users edit
title/body/case_id of their rows — spoofable content later rendered by the
UI. **Fix (005):** grant restricted to the `read` column.
**Verified:** body update → `permission denied`; read flip → `UPDATE 1`.

### 🟠 S7 — Rescuer's live location never expired
En-route sharing (by design, disclosed) wrote `rescuer_lat/lng` to the
public case row and `confirm_delivery` never cleared it — the rescuer's
last precise position persisted publicly forever.
**Fix (005):** delivery clears it (drop already did); privacy policy text
extended (en-route sharing named explicitly, ends at delivery).
**Verified:** full pipeline replayed locally (report → accept → select vet
→ vet confirm → depart → share location → deliver): location nulled,
status resolved — and the XP triggers paid exactly per spec
(rescuer+reporter 60, vet 30) with no client-writable path to XP.

### 🟡 S8 — Duplicate scan callable by anyone on any case
Flag-spam annoyance + proximity-relationship probing. **Fix (005):**
creator-or-admin only, within 24h.
**Verified:** Bob → raise; Alice (creator) → runs.
**Harness-caught bug #2:** the first guard used `creator_uid = auth.uid()`,
which is **NULL, not false**, when creator_uid is NULL — and `IF NOT NULL`
silently skips the raise (classic SQL three-valued-logic hole). Fixed with
`is not distinct from`; re-verified.

### 🟡 S9 — Banned/anonymous users could open empty DM shells
Sending was blocked; conversation *creation* wasn't. **Fix (005):** guards
added. **Verified:** anonymous-claim call → raise.

### 🟡 S10 — No security headers
**Fix:** strict CSP in `vercel.json` (script-src only self + Google Maps;
connect-src only Supabase/Maps/Sentry; `frame-ancestors 'none'`;
`Permissions-Policy` scoping geolocation/camera to self; nosniff;
strict referrer). Origin list built from what the bundle actually contacts.

### 🟡 S11 — Sponsor link scheme unvalidated
Admin-entered, but defense-in-depth: SponsorStrip now renders only
http/https URLs (a compromised admin session can't plant `javascript:`).

### ⚪ Verified clean (so the next auditor doesn't re-derive it)
- All state-machine RPCs check caller identity in their WHERE clause;
  `accept_case` is an atomic CAS — **double-accept race replayed locally:
  second accept correctly rejected.**
- XP / role / is_admin / banned / vet status unwritable by clients —
  **self-promotion to vet and self-award of XP both replayed: permission
  denied** (column grants hold even through the legitimate own-row UPDATE
  policy).
- Zero `dangerouslySetInnerHTML`; React escapes all user content
  (chat, descriptions, clinic names, notifications, push payloads).
- Secrets: only intentionally-public keys ship client-side; service_role &
  VAPID private live solely in Supabase function secrets; `.gitignore`
  excludes `.env` and was committed before anything else; push webhook
  requires its shared-secret header.
- DM membership checks (SECURITY DEFINER helper) sound; vet phone/address
  public by intent (clinics are public businesses).

---

## B. Persona walkthrough findings (product/robustness)

### 🔴 P1 — Rushed reporter, bad signal: failed photo upload strands a half-born case
`createCase` inserts the case, *then* uploads photos. A signal drop mid-
upload throws — the case already exists (rescuers already notified) with
no photos; the natural retry creates a duplicate. No offline path at all:
a report typed next to an injured animal is simply lost.
**Fix (features commit):** per-photo retry with backoff; if offline (or the
network dies before anything is created), the whole report — photos as
Blobs — queues in IndexedDB and auto-submits on reconnect; explicit
"saved, will send when you're back online" messaging; submit hard-disabled
while in flight.

### 🟠 P2 — GPS-off reporter silently submits the default city center
Plausible-looking, wrong. **Fix:** the form tracks whether the location was
ever user-confirmed (GPS fix, search pick, or map drag); submitting the
untouched default asks one inline confirmation.

### 🟠 P3 — Cases sit unanswered, silently — the liquidity killer
Nothing distinguished 5 minutes old from 6 hours old; nobody re-notified.
**Fix (006):** escalation — after 30 unanswered minutes a scheduled job
marks the case escalated and re-fans notifications to nearby users at 2×
their radius; escalated cases sort first with a distinct "still waiting"
treatment in feed and map.

### 🟡 P4 — Vet double-taps on slow connection → scary error
Second RPC correctly no-ops but surfaced "No pending request…". **Fix:**
in-flight disabling on vet actions; that error maps to a neutral toast.

### 🟡 P5 — Rescuer cancels mid-transport
Traced fully: works, clears location, reopens the case, and the confirmed
vet IS notified (they're a watcher). ⚪ — but a reopened case now re-enters
with escalation treatment immediately (its clock started long ago).

### 🟡 P6 — No onboarding for a novel pipeline
New users can't intuit report→rescuer→vet. **Fix:** first-run, skippable,
trilingual 3-step onboarding.

---

## C. Re-test log (chronological, honest)
- **Pass 1 (pre-fix):** findings documented; build green.
- **Pass 2 (after 005 + client security changes):** migration chain
  001→005 replayed on scratch PostgreSQL 16 behind a Supabase shim; broken
  004 failure **reproduced** first, then fixed chain applied clean. Attack
  suite run with impersonated JWTs: S1, S3(±), S4, S6(±), S8(±), S9,
  double-accept, XP/role/vet-status escalation, full pipeline w/ S7, anon
  circuit breaker w/ registered bypass. Two bugs found **in the fixes**
  (S4 coalesce, S8 NULL-logic) — fixed and re-verified. Client rewritten
  to column-scoped profile queries + own-profile RPC; production build
  green.
- **Pass 3 (features + UI completion, executed):**
  - 006 replayed on the scratch database on top of 001→005; then
    functionally tested: `escalate_stale_cases()` escalated a seeded
    45-minute open case exactly once (idempotent on re-run) and created the
    widened notification for a nearby user; `get_public_impact()` returns
    aggregates to anon; `admin_get_stats()` correctly rejects non-admins.
  - UI re-trace of all six personas on the new surfaces: onboarding →
    (simulated offline) report queue path; escalated cases sort first and
    render the "still waiting" pulse in feed and photo-pin pulse on map;
    skeletons replace the bare feed spinner; feed error path shows retry;
    resolution celebration fires only on a live status transition (not on
    revisits — guarded by previous-status tracking).
  - Found during re-trace: maps.tsx's new pin system referenced CSS classes
    that didn't exist yet (pins would have rendered unstyled) — the pin
    design-system layer (§14) was written and verified in the build.
