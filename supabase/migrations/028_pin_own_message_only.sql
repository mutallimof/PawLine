-- ============================================================================
-- PawLine — migration 028: a vet may pin only their OWN message
-- ----------------------------------------------------------------------------
-- 027 let the case's vet pin ANY message in the thread. The UI now offers the
-- pin only on the vet's own messages — a clinic pins its condition update or
-- its bank details, not somebody else's post — and the server has to agree,
-- for the same reason the vet check itself lives here rather than in the
-- client: the pin decides which money-related message the app visually
-- endorses, and a rule that only exists in the UI is bypassable with the anon
-- key and one REST call. Without this, a clinic could promote a stranger's
-- message (say, someone else's card number) to the top of the thread under
-- the "Pinned by the clinic" label.
--
-- Redefines 027's function rather than editing it in place, matching how 021
-- redefined 005's enforce_case_limits and 023 redefined 001's award_xp: the
-- applied history stays linear and each file records one decision.
--
-- unpin_case_message is UNCHANGED (027) and deliberately not restated: it
-- clears the column rather than choosing a message, so it has nothing to
-- narrow — the vet check it already has is the whole rule.
--
-- Run after 027. Idempotent.
-- ============================================================================

create or replace function public.pin_case_message(p_case uuid, p_message bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  -- The caller must be the vet ON THIS CASE. Checked against the row itself,
  -- so being a vet elsewhere, or the rescuer/reporter here, is not enough.
  if not exists (
    select 1 from public.cases c where c.id = p_case and c.vet_id = v_uid
  ) then
    raise exception 'Only the clinic handling this case can pin a message.';
  end if;

  -- The message must belong to this case, must not be hidden by moderation
  -- (003/011), and — new in 028 — must have been written by the caller.
  if not exists (
    select 1 from public.case_messages m
    where m.id = p_message
      and m.case_id = p_case
      and m.sender_id = v_uid
      and not m.hidden
  ) then
    raise exception 'You can only pin your own message in this case.';
  end if;

  update public.cases set pinned_message_id = p_message where id = p_case;
end;
$$;

grant execute on function public.pin_case_message(uuid, bigint) to authenticated;
