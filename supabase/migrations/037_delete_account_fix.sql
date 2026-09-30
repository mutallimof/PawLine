-- ============================================================================
-- PawLine — migration 037: account deletion that actually completes
-- ----------------------------------------------------------------------------
-- Bug: delete_my_account() (009) sets case_messages.sender_id = null, but that
-- column is NOT NULL (001), so deletion raised for anyone who had ever posted
-- in a case chat, and nothing was deleted.
--
-- This migration:
--   1. case_messages.sender_id becomes nullable, and its FK to profiles goes
--      from ON DELETE CASCADE to ON DELETE SET NULL. Messages stay; the author
--      is anonymised (the app shows "Deleted account").
--   2. delete_my_account() is redefined from 009, verbatim except:
--        - DMs: every conversation the user is in is deleted outright (both
--          sides' messages and all participant rows cascade), plus the other
--          participants' notifications that point at those conversations
--          (notifications.conversation_id has no FK, so it would dangle).
--        - Case chat: if one of the user's messages is a case's pinned
--          message, the case is unpinned first (it may hold bank details).
--   3. Guard: aborts if any foreign key into public.profiles or auth.users
--      (outside the auth schema) would block the delete — ON DELETE NO
--      ACTION / RESTRICT, or SET NULL on a NOT NULL column. Reads the live
--      catalog, so it also catches anything created outside the migrations.
--
-- Storage (vet-documents) is NOT deleted here: deleting storage.objects rows
-- from SQL leaves the file bytes in the bucket, and Supabase blocks direct
-- deletes on storage tables. The delete-account Edge Function removes the
-- files through the Storage API after this function succeeds.
--
-- Deploy order: apply this, deploy the delete-account Edge Function, then
-- deploy the client that calls it.
--
-- Wrapped in one transaction: if any statement fails, nothing is applied.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. case_messages.sender_id: nullable, ON DELETE SET NULL
-- ---------------------------------------------------------------------------
-- The FK was declared inline in 001 with no explicit name, so look it up
-- rather than assume case_messages_sender_id_fkey.
do $fk$
declare
  v_conname text;
begin
  for v_conname in
    select con.conname
    from pg_constraint con
    join pg_attribute a
      on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
    where con.conrelid = 'public.case_messages'::regclass
      and con.contype = 'f'
      and a.attname = 'sender_id'
  loop
    execute format('alter table public.case_messages drop constraint %I', v_conname);
  end loop;
end
$fk$;

alter table public.case_messages
  alter column sender_id drop not null;

alter table public.case_messages
  add constraint case_messages_sender_id_fkey
  foreign key (sender_id) references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Guard: nothing else may block deleting a profile / auth user
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_hits text;
begin
  select string_agg(
           format('%s.%s -> %s (on delete %s, %s)',
                  con.conrelid::regclass, a.attname, con.confrelid::regclass,
                  case con.confdeltype
                    when 'a' then 'no action' when 'r' then 'restrict'
                    when 'n' then 'set null'  when 'd' then 'set default'
                    else 'cascade' end,
                  case when a.attnotnull then 'not null' else 'nullable' end),
           '; ')
    into v_hits
  from pg_constraint con
  join pg_class c      on c.oid = con.conrelid
  join pg_namespace n  on n.oid = c.relnamespace
  join pg_attribute a  on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
  where con.contype = 'f'
    and con.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
    and n.nspname <> 'auth'
    and (con.confdeltype in ('a', 'r')
         or (con.confdeltype in ('n', 'd') and a.attnotnull));

  if v_hits is not null then
    raise exception '037 aborted: these foreign keys would block account deletion: %', v_hits;
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 3. delete_my_account(), from 009
-- ---------------------------------------------------------------------------
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

  -- Direct messages: delete every thread the person is in, for both sides
  -- (messages and participants cascade from conversations), and the other
  -- side's notifications that point at those threads.
  delete from public.notifications
    where conversation_id in (
      select conversation_id from public.conversation_participants where profile_id = uid
    );
  delete from public.conversations
    where id in (
      select conversation_id from public.conversation_participants where profile_id = uid
    );
  delete from public.messages where sender_id = uid;
  delete from public.conversation_participants where profile_id = uid;

  -- Case chat authored by the user: keep the thread intact but detach
  -- identity (coordination history matters; the person does not). A pinned
  -- message of theirs is unpinned first — it may hold their bank details.
  update public.cases set pinned_message_id = null
    where pinned_message_id in (
      select id from public.case_messages where sender_id = uid
    );
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

commit;
