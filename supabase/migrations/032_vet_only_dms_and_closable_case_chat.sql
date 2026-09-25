-- ============================================================================
-- PawLine — migration 032: DMs are user → clinic only; admins can read them;
-- the case's vet can close its case chat
-- ----------------------------------------------------------------------------
-- A. DIRECT MESSAGES: USER → CLINIC ONLY
--    New model: a regular user may start a DM with an approved clinic; the
--    clinic replies in that thread; a clinic may never start one; two regular
--    users may never message each other.
--
--    Before this (012), get_or_create_dm() allowed a NEW conversation only
--    between two people sharing an active case, in any role combination —
--    so user↔user DMs existed, and messaging a clinic from its own page
--    failed unless you already shared a case. Conversations and participants
--    have no INSERT grant at all (004), so get_or_create_dm() is the ONLY
--    way a conversation is ever created: that function is the creation gate.
--
--    "A vet" here means an APPROVED clinic (vets.status = 'approved' and
--    profiles.role = 'vet'), not merely role = 'vet'. Becoming a vet is
--    self-service (become_vet(), 025); an unreviewed or rejected "clinic"
--    must not be a DM destination. "A regular user" means profiles.role =
--    'user' (a pending vet is neither, so it can neither start nor receive).
--
--    Enforced in two places:
--      1. get_or_create_dm(): a NEW conversation only when the caller is a
--         regular user and the other side is an approved clinic. An existing
--         conversation is returned only if it is such a pair.
--      2. The messages INSERT policy: sending (in either direction) requires
--         the conversation to be exactly one regular user + one approved
--         clinic. This is what closes EXISTING threads that no longer fit —
--         user↔user threads, and threads with a clinic that is no longer
--         approved — without deleting anything: they stay readable, but
--         nobody can post in them.
--
-- B. ADMIN OVERSIGHT OF DMS
--    Admins may READ every conversation, participant row and message — the
--    same `or public.is_admin()` read pattern as cases, case_messages and
--    content_reports. Admins never POST: the send policy still requires the
--    sender to be a participant, and nothing can make an admin a participant
--    (participants are only ever inserted by get_or_create_dm(), for the
--    caller and the clinic).
--    admin_list_dm_threads() gives the oversight list in one call, including
--    each participant's ban state (hidden from plain selects by column
--    grants, 005), gated on is_admin() first like admin_list_users (030).
--    Banning uses the existing admin_ban_user() — no new ban path.
--
-- C. THE CASE'S VET CAN CLOSE ITS CASE CHAT
--    cases.chat_closed_at (null = open). close_case_chat / reopen_case_chat
--    are modelled on pin_case_message (027): SECURITY DEFINER, and refuse
--    unless cases.vet_id = auth.uid(). Allowed at any case status.
--    The case-chat POSTING policy (003) is restated with one more condition:
--    refuse while the chat is closed — for everyone, the vet included (the vet
--    reopens to post again). Hiding the composer alone would not stop an API
--    call. `cases` is already in the realtime publication (001), so a
--    close/reopen reaches every open chat screen live.
--
-- Run after 031. Idempotent.
-- ============================================================================


-- ============================================================================
-- A. DMs: user → approved clinic only
-- ============================================================================

-- Is this profile an approved clinic?
create or replace function public.is_approved_vet(p_profile uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.vets v
    join public.profiles p on p.id = v.id
    where v.id = p_profile and v.status = 'approved' and p.role = 'vet'
  );
$$;

-- Is (a, b) one regular user and one approved clinic, in either order?
create or replace function public.is_user_vet_pair(a uuid, b uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select
    (public.is_approved_vet(b)
       and exists (select 1 from public.profiles where id = a and role = 'user'))
    or
    (public.is_approved_vet(a)
       and exists (select 1 from public.profiles where id = b and role = 'user'));
$$;

-- Is this conversation exactly two people forming a user ↔ approved-clinic
-- pair? Answers only for a participant or an admin (false for anyone else), so
-- it can't be used to probe other people's threads; the client calls it to
-- decide whether to show the composer.
create or replace function public.is_user_vet_conversation(p_conv uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select case
    when not (public.is_conversation_member(p_conv) or public.is_admin()) then false
    else coalesce((
      select count(*) = 2
             and public.is_user_vet_pair((array_agg(cp.profile_id))[1], (array_agg(cp.profile_id))[2])
      from public.conversation_participants cp
      where cp.conversation_id = p_conv
    ), false)
  end;
$$;

grant execute on function public.is_approved_vet(uuid) to authenticated;
grant execute on function public.is_user_vet_pair(uuid, uuid) to authenticated;
grant execute on function public.is_user_vet_conversation(uuid) to authenticated;

-- The creation gate. Signed-in / not-anonymous / not-banned / not-self /
-- not-blocked checks are carried over unchanged from 012; the shared-active-
-- case rule is REPLACED by the user → clinic rule.
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

  -- Existing 1:1 conversation between the two?
  select cp1.conversation_id into v_conv
  from public.conversation_participants cp1
  join public.conversation_participants cp2
    on cp1.conversation_id = cp2.conversation_id
  where cp1.profile_id = auth.uid() and cp2.profile_id = p_other
    and (select count(*) from public.conversation_participants cp3
         where cp3.conversation_id = cp1.conversation_id) = 2
  limit 1;

  if v_conv is not null then
    -- Opening an existing thread is not "initiating", so a clinic may reach
    -- a thread a user started. But only a user ↔ clinic thread: an old
    -- user ↔ user thread is not reopened through here.
    if not public.is_user_vet_pair(auth.uid(), p_other) then
      raise exception 'Direct messages are only between members and clinics.';
    end if;
    return v_conv;
  end if;

  -- NEW conversation: only a regular user, only to an approved clinic.
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'user') then
    raise exception 'Clinics can reply to messages but cannot start a conversation.';
  end if;
  if not public.is_approved_vet(p_other) then
    raise exception 'You can only start a conversation with a verified clinic.';
  end if;

  insert into public.conversations default values returning id into v_conv;
  insert into public.conversation_participants (conversation_id, profile_id)
  values (v_conv, auth.uid()), (v_conv, p_other);

  return v_conv;
end;
$$;

-- Sending. Restates 007's policy (same name) and adds one condition: the
-- conversation must be a user ↔ approved-clinic pair.
drop policy if exists "participants in good standing send messages" on public.messages;
create policy "participants in good standing send messages"
  on public.messages for insert with check (
    sender_id = auth.uid()
    and not public.is_anon_user()
    and not public.is_banned()
    and public.is_conversation_member(conversation_id)
    and not exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id
        and cp.profile_id <> auth.uid()
        and public.is_blocked_either_way(auth.uid(), cp.profile_id)
    )
    and public.is_user_vet_conversation(conversation_id)
  );


-- ============================================================================
-- B. Admin oversight: read every DM (never post)
-- ============================================================================

drop policy if exists "admins read all conversations" on public.conversations;
create policy "admins read all conversations"
  on public.conversations for select using (public.is_admin());

drop policy if exists "admins read all conversation participants" on public.conversation_participants;
create policy "admins read all conversation participants"
  on public.conversation_participants for select using (public.is_admin());

drop policy if exists "admins read all direct messages" on public.messages;
create policy "admins read all direct messages"
  on public.messages for select using (public.is_admin());

-- The oversight list: one row per conversation, the regular user first and
-- the clinic second, each with their ban state, plus message count and the
-- latest message. Newest activity first. limit clamped to 1..100.
create or replace function public.admin_list_dm_threads(
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  conversation_id  uuid,
  created_at       timestamptz,
  a_id             uuid,
  a_name           text,
  a_role           public.profile_role,
  a_banned         boolean,
  b_id             uuid,
  b_name           text,
  b_role           public.profile_role,
  b_banned         boolean,
  message_count    bigint,
  last_message_at  timestamptz,
  last_message     text
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;

  return query
  select
    c.id,
    c.created_at,
    pa.id, pa.display_name, pa.role, pa.banned,
    pb.id, pb.display_name, pb.role, pb.banned,
    coalesce(m.cnt, 0)::bigint,
    m.last_at,
    m.last_body
  from public.conversations c
  left join lateral (
    select p.id, p.display_name, p.role, p.banned
    from public.conversation_participants cp
    join public.profiles p on p.id = cp.profile_id
    where cp.conversation_id = c.id
    order by (p.role = 'vet'), p.id
    limit 1
  ) pa on true
  left join lateral (
    select p.id, p.display_name, p.role, p.banned
    from public.conversation_participants cp
    join public.profiles p on p.id = cp.profile_id
    where cp.conversation_id = c.id
    order by (p.role = 'vet'), p.id
    offset 1 limit 1
  ) pb on true
  left join lateral (
    select
      count(*) as cnt,
      max(mm.created_at) as last_at,
      (select m2.body from public.messages m2
        where m2.conversation_id = c.id
        order by m2.created_at desc, m2.id desc limit 1) as last_body
    from public.messages mm
    where mm.conversation_id = c.id
  ) m on true
  order by m.last_at desc nulls last, c.created_at desc, c.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.admin_list_dm_threads(integer, integer) from public, anon;
grant  execute on function public.admin_list_dm_threads(integer, integer) to authenticated;


-- ============================================================================
-- C. The case's vet can close / reopen its case chat
-- ============================================================================

alter table public.cases
  add column if not exists chat_closed_at timestamptz;

comment on column public.cases.chat_closed_at is
  'When the case''s vet closed the case chat (null = open). Set only by close_case_chat / reopen_case_chat.';

create or replace function public.close_case_chat(p_case uuid)
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
    raise exception 'Only the clinic handling this case can close its chat.';
  end if;

  -- Keep the original close time if it is already closed.
  update public.cases
    set chat_closed_at = coalesce(chat_closed_at, now())
    where id = p_case;
end;
$$;

create or replace function public.reopen_case_chat(p_case uuid)
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
    raise exception 'Only the clinic handling this case can reopen its chat.';
  end if;

  update public.cases set chat_closed_at = null where id = p_case;
end;
$$;

grant execute on function public.close_case_chat(uuid) to authenticated;
grant execute on function public.reopen_case_chat(uuid) to authenticated;

-- Is this case's chat closed? SECURITY DEFINER so the answer doesn't depend
-- on whether the caller can see the case row: under the caller's own RLS a
-- hidden case would read as "not closed" and let a post through.
create or replace function public.is_case_chat_closed(p_case uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(
    (select chat_closed_at is not null from public.cases where id = p_case),
    false
  );
$$;

grant execute on function public.is_case_chat_closed(uuid) to authenticated;

-- Posting in case chat. Restates 003's policy (same name) and adds the
-- closed-chat refusal.
drop policy if exists "accounts in good standing post in case chat" on public.case_messages;
create policy "accounts in good standing post in case chat"
  on public.case_messages for insert with check (
    sender_id = auth.uid()
    and not public.is_anon_user()
    and not public.is_banned()
    and not public.is_case_chat_closed(case_id)
  );
