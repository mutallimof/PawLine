# PawLine — fix spec

Source: two-person test session + RLS audit, Sept 2026.
Groups are ordered by dependency. Do not reorder.

---

## Rules for every group

- **One branch per group.** `fix/a-security`, `fix/b-wiring`, etc. Test the Vercel preview before merging.
- **Never edit migrations 001–010.** They are applied. New work goes in `011_*.sql` and up.
- **Any migration is run manually by Fikrat in the Supabase SQL Editor BEFORE the code that uses it is merged.** Nothing applies migrations automatically.
- **Do not touch** the case state machine RPCs, RLS policies not named here, auth flow, or `is_admin`/`role`/`xp` grants.
- If a change needs a schema alteration not listed here, stop and flag it.

---

## Group A — Security. Do first, alone.

**A1. Hidden cases still expose their photos.**
`case_photos` SELECT policy is `using (true)` and never got the `hidden` check that `cases` and `case_messages` have. Admin hiding a case removes it from the feed but leaves the images queryable.

In `011`: add to the `case_photos` SELECT policy —
```sql
and exists (
  select 1 from cases c
  where c.id = case_id and (not c.hidden or is_admin())
)
```

**A2. The storage bucket is public — flag, do not fix yet.**
`case-photos` is `public=true`, so image bytes are fetchable by direct URL regardless of RLS. A1 does not close this. Moving to a private bucket with signed URLs changes every image render in the app. Write up what that would involve; Fikrat decides separately.

**A3. Maintenance functions are never called.**
`escalate_stale_cases`, `revert_abandoned_cases`, `expire_unclaimed_cases`, `run_case_maintenance` exist and are `pg_cron`-only. Nothing schedules them.

In `011`: enable `pg_cron` and schedule `run_case_maintenance()` hourly. Report the exact SQL for Fikrat to run.

---

## Group B — Wire existing backend to the UI. No new tables.

Everything here already exists server-side and has no button.

**B1. Rescuer cancel.** `drop_case` exists. Add a cancel action on cases where the user is the rescuer. Neutral wording — no shame, no penalty. Returns the case to NEEDS HELP.

**B2. Report button on every case and every chat message.** `content_reports` + `admin_resolve_report` exist. Add reasons: wrong content, not an animal, scam, duplicate, other.

**B3. Admin moderation queue.** `fetchOpenReports`, `admin_hide_case`, `admin_hide_case_message`, `admin_ban_user` all exist. Build the screen: open reports, the reported content, hide / ban / dismiss.

**B4. Block user.** `blocked_users` exists. Surface it on profiles and in chat.

**B5. Stale-case visibility.** When `escalate_stale_cases` returns a case to NEEDS HELP, show it in the timeline and re-notify nearby users.

---

## Group C — New database work. Migration 012.

**C1. Vet verification documents.**
`vets.status` (pending/approved) and `admin_set_vet_status()` already exist; there is no way to submit documents. Add a private storage bucket for vet documents and a `vet_documents` table. Vet uploads from their profile after signup. Admin reviews in the queue from B3. Unapproved vets can report and rescue but do not appear in the vets list.

**C2. Vet ratings.**
New `vet_ratings` table. **Insert allowed only where a case exists with that `vet_id`, `rescuer_id = auth.uid()`, and delivery confirmed.** Closed set, cannot be farmed. One rating per case.

**C3. Vet profile fields.**
Split login identity from public contact:
- public: `clinic_name`, `contact_phone`, `contact_email`, address, hours, location
- private: `manager_name`, `manager_surname`, `manager_phone`
- `accepted_animals` (multi-select)

**C4. Reporter abuse flagging.**
Many reports from one account in a short window should flag the **reporter**, not each case. Add an admin view listing accounts by report volume, with one action to hide all their cases and ban.

**C5. Signup fields.** Split `display_name` into name + surname. Add phone.

---

## Group D — Navigation

- Move **Vets** into the bottom tab bar.
- Move **notifications** to a top-right bell icon with an unread badge.
- **Messages tab shows case chats only.** There is no standalone DM inbox. Group by case, most recent first.

---

## Group E — Case chat

- WhatsApp-style alignment: own messages right, others left.
- Per-sender name colour, consistent across the thread.
- Sender name only on the first message of a run.

---

## Group F — Case detail

Current order is photo → title → status. Change to:
1. Location — street name and landmark, prominent
2. Title and description
3. Status timeline
4. Photo
5. Case chat

---

## Group G — Feed

- Smaller cards, more per screen.
- Filters: radius, animal type (cat / dog / other), status.
- Keep the existing all / active / resolved tabs.

---

## Group H — Language and onboarding

- Language switcher on the first screen and on every auth screen, not only after login.
- Add Russian alongside Azerbaijani and English.
- Map placeholder becomes a loading skeleton, not an empty box.

---

## Not in scope

Renaming the app · custom domain · design tokens, colours, typography (handled separately by the designer) · private-bucket migration (A2, pending decision).
