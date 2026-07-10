# PawLine — Architecture

This document explains the non-obvious design decisions. Read alongside
`supabase/migrations/001_init.sql`, which contains the authoritative
implementation.

## 1. The case state machine

```
                      ┌──────────────────────────────────────────────┐
                      │            rescuer drops (drop_case)         │
                      ▼                                              │
 report            accept            select_vet          vet_respond │  start_transport      confirm_delivery
┌──────┐  ─────▶ ┌────────┐ ─────▶ ┌────────────┐ ─────▶ ┌───────────────┐ ─────▶ ┌──────────┐ ─────▶ ┌──────────┐
│ open │         │accepted│        │vet_selected│  true  │ vet_confirmed │        │ en_route │        │ resolved │
└──────┘         └────────┘        └────────────┘        └───────────────┘        └──────────┘        └──────────┘
                      ▲                   │ false (vet declines)
                      └───────────────────┘
```

Additional edges:
- `drop_case` works from **any** of `accepted`, `vet_selected`,
  `vet_confirmed`, `en_route` → back to `open` (rescuer and vet are cleared,
  watchers are notified "still needs help").
- `confirm_delivery` is also allowed from `vet_confirmed`, because in
  practice rescuers sometimes arrive without remembering to tap
  "I'm on my way".
- `select_vet` is allowed from `vet_selected` too, so a rescuer can re-pick
  after a decline without an intermediate step.

### Why it lives in the database

Every transition is a `SECURITY DEFINER` Postgres function
(`accept_case`, `drop_case`, `select_vet`, `vet_respond`,
`start_transport`, `confirm_delivery`). There are **no UPDATE policies on
`cases`** — clients literally cannot write the status column. Consequences:

- **Race safety.** Two rescuers tapping "accept" at the same moment resolve
  cleanly: the function does an atomic compare-and-set
  (`UPDATE ... WHERE status = 'open'`) and the loser gets a friendly error.
- **Authority checks in one place.** Only the active rescuer can choose a
  vet or depart; only the selected vet can confirm/decline/receive. A stale
  or malicious client can't corrupt a case.
- **Exactly-once side effects.** Each successful transition inserts one
  `case_events` row, and everything else (notifications, timeline) hangs
  off that.

## 2. Notification fan-out

All notifications are rows in `notifications`, created by triggers — the
client never decides who gets notified.

| Trigger | Fires on | Who gets notified |
| --- | --- | --- |
| `on_case_created` | `INSERT cases` | Every profile whose preference is `all`, or `nearby` within their saved radius (haversine in SQL). Also auto-subscribes the reporter as a watcher. |
| `on_case_event` | `INSERT case_events` | All `case_watchers` except the actor. `vet_requested` additionally pings the selected vet directly (they may not be a watcher yet). |
| `on_case_message` | `INSERT case_messages` | Sender becomes a watcher; all other watchers get a `case_message` alert. |
| `on_direct_message` | `INSERT messages` | The other conversation participant(s). |

**Watchers** (`case_watchers`) are the audience of a case: the reporter,
the rescuer, the vet, anyone who posted in its chat, and anyone who tapped
"Watch". This gives the required behaviors for free — e.g. "rescuer dropped
this case, still needs help" reaches exactly the people who care.

Clients subscribe to their own `notifications` rows over Supabase Realtime,
which drives the bell-tab badge live. Web Push is a clean later addition:
the rows are already the source of truth; an Edge Function on insert can
deliver them to push subscriptions.

## 3. Two chat systems, deliberately separate

| | General DMs | Case group chat |
| --- | --- | --- |
| Tables | `conversations`, `conversation_participants`, `messages` | `case_messages` |
| Access | Participants only (RLS via a `SECURITY DEFINER` membership check — direct self-referential policies would recurse) | Publicly readable, any signed-in user can post |
| UI | Messages tab → inbox → thread | "Case chat" button inside a case |
| Purpose | People/vets getting in touch freely, Instagram-style | Coordinating one rescue; vets may post bank details for treatment fundraising |

They share nothing but the message-bubble styling. The platform never
processes payments — the case chat is information-sharing only, which keeps
PawLine free of financial liability by design.

## 4. Guests

Reporting must be as frictionless as a social-media post, so `cases.reporter_id`
is nullable and RLS allows the `anon` role to insert cases and upload photos
to the public `case-photos` bucket. Guests can browse everything (cases,
map, timelines, chat read-only) but need an account to accept cases, chat,
or receive notifications — accounts are where reputation (XP) accrues.

## 5. XP / tiers

Raw XP is **data** and lives in `profiles.xp`, written only by the
`award_xp` trigger when a case first reaches `resolved`
(rescuer +50, vet +30, reporter +10). Column-level grants prevent users
from updating `xp`, `cases_helped`, or `role` themselves.
Tier names/thresholds are **presentation** and live in `src/lib/xp.ts`
(Bronze 0 / Silver 150 / Gold 400 / Platinum 1000) so they can be tuned
without a migration.

## 6. Realtime strategy

`cases`, `case_events`, `case_messages`, `messages`, and `notifications`
are in the realtime publication. Hooks follow one pattern: fetch once, then
on any `postgres_changes` event **refetch with a short debounce** rather
than patching state locally. Slightly more queries, but joined data
(photos, rescuer, vet) stays consistent with zero duplicated join logic —
the right trade at this scale. DM threads append incoming rows directly
since they need no joins.

RLS applies to realtime as well: a user only ever receives changes for rows
they're allowed to read.

## 7. PWA behavior

- App shell (JS/CSS/fonts/icons) is precached → instant startup, works
  offline enough to open, browse cached content, and see the offline banner.
- OSM tiles and case photos use cache-first runtime caching with expiry —
  maps you've looked at recently keep rendering on flaky mobile data.
- Supabase API/realtime traffic is never cached: statuses and chat must be
  live.
- `display: standalone`, safe-area insets, iOS meta tags → full-screen
  without browser UI on both platforms after Add to Home Screen.

## 8. Scale notes (target: 1,000+ concurrent)

- Reads are simple indexed queries (`status`, `created_at`, foreign keys).
- The heaviest write is the new-case fan-out (one insert per opted-in user).
  Fine for the launch population; if the user base grows into the hundreds
  of thousands, move that specific fan-out to an Edge Function/queue and
  keep everything else unchanged.
- Supabase Realtime on the Pro plan handles thousands of concurrent
  connections without custom work (check current plan limits; the free tier
  is fine for development but has a low concurrent-connection cap).


## 9. Production layer (migration 003) — design notes

- **Guests are anonymous auth users.** The pure `anon` role had no identity,
  so rate limiting was impossible. `signInAnonymously()` gives each guest
  device a uid; a BEFORE INSERT trigger enforces 4 reports/hour, 15/day.
  Anonymous sessions cannot accept cases or chat — those need accounts.
- **Verification and moderation are RLS, not UI.** Pending vets and hidden
  content are filtered by policies, so no client (including a malicious one)
  can see or use them. Admin powers are SECURITY DEFINER RPCs gated on
  `is_admin()`; the flag itself is settable only via SQL.
- **Duplicate detection is deliberately dumb-but-cheap.** Distance + time +
  same-species narrows candidates; a 64-bit dHash per photo (computed
  on-device, compared with `bit_count(a # b)` in Postgres) adds photo
  similarity for free. It only writes advisory flag rows — the case pipeline
  is untouched, so a false positive can never delay help.
- **Push reuses the notifications table as its source of truth.** A database
  webhook on INSERT calls the send-push Edge Function; in-app and push can
  never disagree because they're the same row.


## 10. Scaling notes (flagged, not yet needed)

**PostGIS / spatial indexing (item 4f).** "Nearby" queries — users near a
new case (fan-out), vets near a user, cases near a point — currently use a
plain haversine (`distance_km`) with, as of migration 008, a bounding-box
pre-filter on plain btree indexes over `home_lat/home_lng`. This is
correct and fast at launch scale (measured: fan-out ~0.06 ms at 50k users;
see OPERATIONS "Load testing"). The bounding box is a rectangle, so it
slightly over-selects near the poles and across the antimeridian — neither
matters for Azerbaijan/Turkey. **Migration path when case/vet volume grows
large (roughly: millions of rows, or multi-country with dense metros):**
enable the PostGIS extension, add a `geography(Point)` column alongside the
lat/lng, build a GiST index on it, and replace the bbox+haversine with
`ST_DWithin`. That change is localized to `notify_new_case()`, the vet
listing query, and `check_case_duplicates()` — no schema-wide churn. Not
worth the operational weight (PostGIS upgrades, bigger backups) until the
btree bounding box actually shows strain, which the load test says is far
away.

**Notification fan-out at extreme scale.** Even index-gated, the fan-out
writes one row per matching user synchronously inside the reporting
transaction. At hundreds of thousands of *local* opted-in users per report
(not a near-term reality for these markets), move the fan-out to a queued
Edge Function: the trigger enqueues one job, a worker writes notifications
in batches. The notifications table is already the single source of truth
for both in-app and push, so this is an internal change with no client
impact.
