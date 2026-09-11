-- ============================================================================
-- PawLine — migration 012: restrict new DMs to shared-case participants
-- ----------------------------------------------------------------------------
-- get_or_create_dm() currently lets any two registered users open a DM with
-- no relationship at all. This restricts it: a NEW conversation can only be
-- created between two people who share an ACTIVE case as reporter, rescuer,
-- or the assigned vet on that case (any combination of those three roles).
--
-- "Existing conversations stay as they are": the gate below applies ONLY to
-- the branch that creates a brand-new conversation (`v_conv is null`). The
-- existing-conversation lookup above it is untouched, so two people who
-- already have a DM thread — even one whose shared case has since resolved
-- or closed — can keep messaging in it. Nothing here touches the `messages`
-- table's own RLS (still gated on membership + good standing + not blocked),
-- so sending into an existing thread is unaffected either way.
--
-- Every other check (signed in, not anonymous, not banned, not self, not
-- blocked either-way) is carried over unchanged from 007_prelaunch.sql.
--
-- Run after 001–011. Idempotent (create or replace).
-- ============================================================================

create or replace function public.get_or_create_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_conv uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to send messages.'; end if;
  if public.is_anon_user() then raise exception 'Create an account to send messages.'; end if;
  if public.is_banned() then raise exception 'This account cannot send messages.'; end if;
  if p_other = auth.uid() then raise exception 'You cannot message yourself.'; end if;
  if public.is_blocked_either_way(auth.uid(), p_other) then
    raise exception 'Messaging is not available with this user.';
  end if;

  -- Look for an existing 1:1 conversation first — untouched by the new
  -- restriction below, so old threads keep working exactly as they do today.
  select cp1.conversation_id into v_conv
  from public.conversation_participants cp1
  join public.conversation_participants cp2
    on cp1.conversation_id = cp2.conversation_id
  where cp1.profile_id = auth.uid() and cp2.profile_id = p_other
    and (select count(*) from public.conversation_participants cp3
         where cp3.conversation_id = cp1.conversation_id) = 2
  limit 1;

  if v_conv is null then
    -- NEW restriction: only allow opening a brand-new DM between two people
    -- who share an active case (not resolved, not closed) as reporter,
    -- rescuer, or the assigned vet — any combination of those three roles.
    if not exists (
      select 1 from public.cases c
      where c.status not in ('resolved', 'closed')
        and (c.reporter_id = auth.uid() or c.rescuer_id = auth.uid() or c.vet_id = auth.uid())
        and (c.reporter_id = p_other    or c.rescuer_id = p_other    or c.vet_id = p_other)
    ) then
      raise exception 'You can only message someone you share an active case with.';
    end if;

    insert into public.conversations default values returning id into v_conv;
    insert into public.conversation_participants (conversation_id, profile_id)
    values (v_conv, auth.uid()), (v_conv, p_other);
  end if;

  return v_conv;
end;
$$;
