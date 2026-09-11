-- ============================================================================
-- PawLine — migration 017: per-user read state for case chats
-- ----------------------------------------------------------------------------
-- New work, not in FIX_SPEC. Case chats have no per-user "last read"
-- marker, unlike DMs (conversation_participants.last_read_at +
-- mark_conversation_read(), both from 001_init.sql) — so the Messages tab's
-- unified list (Group D) can only order case chats by recency, with no
-- unread dot or count. This mirrors that exact mechanism instead of
-- inventing a new one.
--
-- WHERE THE COLUMN GOES, AND WHY: case_watchers is already the case-chat
-- analog of conversation_participants — every path that makes someone show
-- up in "my case chats" (fetchCaseChatInbox() in api.ts: reporter/rescuer/
-- vet, or anyone who has posted a case_message) already inserts a
-- case_watchers row via the internal _watch() helper: the reporter on
-- report (notify_new_case), the rescuer on accept_case, the vet on
-- vet_respond(accept), and anyone who posts a case_message
-- (notify_case_message). So last_read_at goes on case_watchers, the same
-- way it already sits on conversation_participants.
--
-- ONE DELIBERATE DIFFERENCE from mark_conversation_read(), and why:
-- conversation_participants rows are guaranteed to exist before a DM can be
-- opened (get_or_create_dm() creates both rows). case_watchers rows are NOT
-- guaranteed — case chat itself is public to any signed-in user regardless
-- of watch status, and fetchCaseChatInbox()'s membership (e.g. a vet who's
-- been selected but hasn't confirmed yet) can include someone who has never
-- watched. A bare UPDATE like mark_conversation_read() would silently no-op
-- for them. So mark_case_chat_read() below is an UPSERT. Side effect, and
-- it's consistent with this table's existing behavior rather than a new
-- one: opening a case's chat also makes you a watcher going forward (future
-- case updates notify you) — the same thing tapping "Watch" already does.
--
-- Not touched: migrations 001–016, the case state machine RPCs, auth flow,
-- is_admin/role/xp grants. No RLS policy changes — mark_case_chat_read() is
-- SECURITY DEFINER and writes the same way the existing _watch() helper
-- does, bypassing RLS exactly as _watch() already does; the existing "see
-- own watches" SELECT policy is untouched and already covers reading this
-- new column back (select * still returns it for the caller's own rows).
-- Run after 001–016. Idempotent.
-- ============================================================================

alter table public.case_watchers
  add column if not exists last_read_at timestamptz not null default now();

create or replace function public.mark_case_chat_read(p_case uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to mark a case chat read.';
  end if;

  insert into public.case_watchers (case_id, profile_id, last_read_at)
  values (p_case, auth.uid(), now())
  on conflict (case_id, profile_id) do update set last_read_at = now();
end;
$$;

grant execute on function public.mark_case_chat_read(uuid) to authenticated;
