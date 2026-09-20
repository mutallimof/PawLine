-- ============================================================================
-- PawLine — migration 027: one pinned message per case, pinnable by its vet
-- ----------------------------------------------------------------------------
-- WHY
-- A clinic that accepts an animal posts its condition and, in practice, bank
-- card details so people can contribute to treatment. In a long case chat that
-- scrolls away, and people then cannot find where to send money. One pinned
-- message per case, held at the top of the thread, fixes that.
--
-- WHO CAN PIN — the case's OWN vet, and nobody else. This is deliberately
-- enforced here rather than in the client: a pin decides which money-related
-- message the app visually endorses, so a client-side check (trivially
-- bypassable with the anon key and a REST call) is not good enough. The rescuer
-- can't pin, the reporter can't pin, an unrelated vet can't pin, and a vet
-- whose case this is not can't pin.
--
-- WHY AN RPC RATHER THAN RLS
-- public.cases has NO update policy at all — "there are no UPDATE policies on
-- cases; clients literally cannot write the status column" (001 §, and
-- docs/ARCHITECTURE.md §1). Every case mutation in this app is a SECURITY
-- DEFINER function, and the pin is no exception: adding an UPDATE policy just
-- for this column would be the first crack in that invariant. These two
-- functions re-derive the caller from auth.uid() and are the only way the
-- column can change.
--
-- SHAPE
-- A single nullable column on cases, not a boolean on case_messages. "One
-- pinned message per case" then holds by construction — pinning writes the
-- column, so a new pin replaces the old one atomically with no chance of two
-- rows both claiming to be pinned, and no second index to keep consistent.
-- ON DELETE SET NULL: if the pinned message is deleted the case quietly
-- unpins rather than pointing at a missing row.
--
-- NOTE ON READING IT: clients get pinned_message_id through the existing
-- `select *` on cases and resolve the body from the messages they have already
-- loaded for that chat. No new embed on the cases query — an embed would need
-- this FK to exist, and a cases query that fails because of a missing relation
-- takes the whole case view down with it (the exact failure 018's CASE_SELECT
-- note documents). So the client is safe to deploy before this migration is
-- applied: the column simply reads as undefined and no pin renders.
--
-- Run after 001-026. Idempotent.
-- ============================================================================

alter table public.cases
  add column if not exists pinned_message_id bigint
  references public.case_messages (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Pin a message. Raises rather than silently no-opping: the UI only offers
-- this to the case's vet, so a rejected call is a bug or an attempt, and
-- either way the caller should hear about it.
-- ---------------------------------------------------------------------------
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

  -- The message must belong to this case (no pinning another case's message
  -- by id) and must not be hidden by moderation (003/011) — a message an
  -- admin has taken down must not be promoted to the top of the thread.
  if not exists (
    select 1 from public.case_messages m
    where m.id = p_message and m.case_id = p_case and not m.hidden
  ) then
    raise exception 'That message is not part of this case.';
  end if;

  update public.cases set pinned_message_id = p_message where id = p_case;
end;
$$;

-- ---------------------------------------------------------------------------
-- Unpin. Same authority check; a case with nothing pinned is a no-op.
-- ---------------------------------------------------------------------------
create or replace function public.unpin_case_message(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in.';
  end if;

  if not exists (
    select 1 from public.cases c where c.id = p_case and c.vet_id = v_uid
  ) then
    raise exception 'Only the clinic handling this case can unpin a message.';
  end if;

  update public.cases set pinned_message_id = null where id = p_case;
end;
$$;

grant execute on function public.pin_case_message(uuid, bigint) to authenticated;
grant execute on function public.unpin_case_message(uuid) to authenticated;
