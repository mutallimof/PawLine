-- ============================================================================
-- PawLine — migration 009: final pre-launch backend
-- ----------------------------------------------------------------------------
-- Run after 001–008. Two things:
--   1. Genuine, complete self-serve account deletion (was a client-side
--      profile scrub that couldn't remove the auth row — a real GDPR gap).
--   2. A durable record of the first-rescue safety acknowledgment, so it
--      survives a cleared browser (the localStorage gate is the fast path;
--      this is the source of truth and lets us prove consent if ever asked).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. COMPLETE ACCOUNT DELETION
-- ---------------------------------------------------------------------------
-- Supabase exposes no client API to delete one's own auth row. This
-- SECURITY DEFINER function does the whole job atomically: scrub/ђanonymize
-- owned data, then remove the auth.users row (profiles cascades from it via
-- the FK, and cases keep their history with reporter/rescuer set null).
--
-- SAFETY: it can ONLY ever delete auth.uid() — the caller themselves. There
-- is no parameter for "which user", by design, so it cannot be turned into
-- an admin-delete-anyone weapon if the RPC is ever exposed more broadly.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in.';
  end if;

  -- Data the user owns outright.
  delete from public.push_subscriptions where profile_id = uid;
  delete from public.blocked_users where blocker_id = uid or blocked_id = uid;
  delete from public.content_reports where reporter_id = uid;
  delete from public.case_not_here_flags where profile_id = uid;
  delete from public.case_watchers where profile_id = uid;
  delete from public.notifications where profile_id = uid;

  -- Direct messages: remove the person's messages and their membership.
  delete from public.messages where sender_id = uid;
  delete from public.conversation_participants where profile_id = uid;

  -- Case chat authored by the user: keep the thread intact but detach
  -- identity (coordination history matters; the person does not).
  update public.case_messages set sender_id = null where sender_id = uid;

  -- If the user is a vet, remove the clinic (it should not linger verified).
  delete from public.vets where id = uid;

  -- Cases: reporter/rescuer set null keeps the rescue record without the
  -- person (matches the privacy policy). vet_id already handled above.
  update public.cases set reporter_id = null where reporter_id = uid;
  update public.cases set rescuer_id = null, creator_uid = null
    where rescuer_id = uid or creator_uid = uid;

  -- Finally the identity itself. profiles has FK ... references auth.users
  -- on delete cascade, so the profile row goes with it.
  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. SAFETY ACKNOWLEDGMENT (durable source of truth)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists safety_ack_at timestamptz;

grant update (safety_ack_at) on public.profiles to authenticated;

create or replace function public.record_safety_ack()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set safety_ack_at = now()
  where id = auth.uid() and safety_ack_at is null;
$$;

grant execute on function public.record_safety_ack() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. TURNSTILE NOTE (no schema change)
-- ---------------------------------------------------------------------------
-- Cloudflare Turnstile bot-protection on anonymous sign-in is enabled in the
-- Supabase dashboard (Authentication → Bot & Abuse Protection), not in SQL.
-- The client passes the Turnstile token via signInAnonymously({ options:
-- { captchaToken } }). See OPERATOR_GUIDE §Turnstile for the exact setup.
