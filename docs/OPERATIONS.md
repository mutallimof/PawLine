# PawLine — Operations Guide

How to run the platform day to day, and where mistakes can cause real harm.
Written for an operator who is still learning the stack — every routine task
has an in-app screen; SQL is only for rare one-time actions.

## Security audit status (excellence pass)

A full adversarial audit was performed — every RLS policy and SECURITY
DEFINER function attacked with impersonated identities against a live
Postgres replay of the migration chain. Findings, fixes, and the honest
test log live in `docs/TESTING_REPORT.md`; incident response procedures in
`docs/OPERATOR_GUIDE.md` Part B. Headline outcomes: user home locations
are no longer publicly readable (public directory columns only), photos
can only be attached by a case's own participants, report identity is
server-forced, guests have a platform-wide spam circuit breaker, rescuer
live location is erased at delivery, and strict CSP/security headers ship
with the app.

## Your routine tasks (all in-app: Profile → 🛠 Admin)

### Vet approvals (do within ~24h of a signup)
New clinics land in **Admin → Vet approvals** and are invisible to rescuers
until approved. Before approving, verify the clinic is real — this is the
single most safety-critical judgment on the platform, because approval means
injured animals get physically delivered to that address:
1. Search the clinic name + address online; call the phone number.
2. Check the map pin matches the stated address.
3. Approve or Reject. The vet is notified automatically either way.

### Moderation reports
Users flag cases and chat messages (⚑). They appear in **Admin → Reports**:
- **Hide content** — reversible soft-hide; the public stops seeing it,
  you still can. Use for fake reports, harassment, scam bank details.
- **Ban user** — blocks reporting, rescuing, and chatting. Reversible
  (`Admin → ban again toggles`, or via SQL). Use for repeat offenders.
- **Dismiss** — the report was unfounded.

Scam pattern to watch for specifically: someone posing as a vet or rescuer
posting *their own* bank details in case chats. Real treatment fundraising
should come from the case's confirmed vet. Hide + ban on sight.

### Duplicate flags
Possible-duplicate banners resolve themselves on the case pages (reporter,
rescuer, or you can confirm/dismiss). Nothing to do centrally — but if two
rescuers head to the same animal, the confirmed-duplicate timeline note
tells them to coordinate.

### Stats (the health check)
**Admin → Stats** shows the number that decides whether PawLine survives:
**median time-to-acceptance** over 30 days, plus resolved counts, active
rescuers, and approved clinics. Under ~30 minutes = healthy liquidity;
climbing = recruit rescuers/partners in that area before anything else.
Escalation runs automatically (open >30 min → wider alert radius + "still
waiting" treatment) — no action needed from you, but a feed full of
escalated cases IS the signal to act on supply.

### Partner organizations
Verified NGOs/shelters get a partner badge and org label: find their
profile id (`select id, display_name from profiles where display_name
ilike '%name%';`) then, in SQL editor,
`select admin_set_partner('THEIR-ID', 'Org Name');` (null to remove).
Partners see the same public cases everyone does — the badge is trust
plus the relationship per MONETIZATION.md; no extra data access is granted.

### Sponsors & partners
**Admin → Sponsors**: name + logo URL + website. `Partner` entries (shelters,
federations) show under "Partners"; `Sponsor` entries under "Supported by".
Keep it to a handful — the strip is trust-building, not a billboard.

## Rare tasks (SQL Editor — careful mode)

> ⚠ Before ANY SQL in production: Database → Backups → download one.
> A wrong `update` without a `where` clause can alter every row in a table.

- **Grant/revoke admin** (deliberately not possible from the app, so a
  stolen phone or hijacked session can never mint admins):
  ```sql
  update public.profiles set is_admin = true  where id = '...';
  update public.profiles set is_admin = false where id = '...';
  ```
- **Delete a user entirely** (GDPR-style request): Authentication → Users →
  delete. Cascades remove their profile, messages, subscriptions; their
  cases remain with `reporter_id` null (rescue history is preserved,
  identity removed) — matching the privacy policy.

## Where real harm is possible — the short list

1. **service_role key or VAPID private key leaking** → total data breach /
   forged notifications. They live only in Supabase secrets. If you ever
   suspect exposure: Settings → API → rotate, and re-run `supabase secrets set`.
2. **Approving a fake vet** → an injured animal delivered to a scammer.
   Always verify by phone before approving.
3. **Untested SQL in production** → data loss. Backup first, and prefer
   asking an AI assistant to review any statement you didn't write yourself —
   paste the schema files from `supabase/migrations/` as context.
4. **Turning off RLS on a table** (Database → tables → RLS toggle) → that
   table becomes world-readable/writable instantly. Never do this; every
   feature already works with RLS on.

## Health checks (weekly, 5 minutes)

- Supabase → Reports: database size, API request curve (sudden spikes =
  investigate), auth signups.
- Sentry (if enabled): new error types.
- Admin → Reports: queue at zero?
- Storage growth: photos are the main consumer; the free tier includes 1 GB —
  at ~150 KB per compressed photo that's ~6,500 photos before Pro is needed.

## Understanding the system (learning path)

Read in this order, each builds on the last:
1. `docs/ARCHITECTURE.md` — why the state machine and notifications live in
   the database.
2. `supabase/migrations/001_init.sql` — the whole backend, heavily commented.
3. `003_production.sql` — how rate limiting, moderation, verification, and
   duplicate detection actually work.
Any AI assistant given these three files has full context to help you safely.
