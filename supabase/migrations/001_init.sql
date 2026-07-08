-- ============================================================================
-- PawLine — initial schema
-- ----------------------------------------------------------------------------
-- Everything security- or consistency-critical lives here, in the database:
--
--   * The case STATE MACHINE is enforced by SECURITY DEFINER functions
--     (accept_case, drop_case, select_vet, ...). Clients never UPDATE the
--     cases table directly, so an out-of-date or malicious client cannot
--     put a case into an illegal state or steal a case someone accepted.
--
--   * NOTIFICATIONS are fanned out by triggers, so every state change
--     produces exactly one consistent set of notifications regardless of
--     which client caused it.
--
--   * XP is awarded by a trigger when a case reaches 'resolved' — clients
--     cannot grant themselves XP.
--
-- Run this file in the Supabase SQL editor (or `supabase db push`).
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. ENUMS
-- ============================================================================

-- The case pipeline. Transitions (enforced in functions below):
--
--   open ──accept──▶ accepted ──select vet──▶ vet_selected ──vet confirms──▶
--   vet_confirmed ──rescuer departs──▶ en_route ──vet receives──▶ resolved
--
--   Any state before 'resolved' can fall back to 'open' if the rescuer
--   drops the case; 'vet_selected' falls back to 'accepted' if the vet
--   declines.
create type public.case_status as enum (
  'open',          -- reported, nobody has committed yet — needs help
  'accepted',      -- a rescuer has committed
  'vet_selected',  -- rescuer picked a vet, waiting for the vet to confirm
  'vet_confirmed', -- vet is ready to receive the animal
  'en_route',      -- rescuer is on the way to the vet
  'resolved'       -- vet confirmed receipt of the animal
);

create type public.animal_type as enum ('dog', 'cat', 'other');
create type public.profile_role as enum ('user', 'vet');

-- How a user wants to hear about brand-new cases.
create type public.new_case_pref as enum ('nearby', 'all', 'off');

create type public.notification_type as enum (
  'case_new_nearby',   -- new case reported near you / anywhere (per preference)
  'case_accepted',     -- a rescuer committed to a case you watch
  'case_dropped',      -- rescuer dropped the case — it needs help again
  'vet_requested',     -- (vets only) a rescuer wants to bring you an animal
  'vet_confirmed',     -- vet agreed to receive the animal
  'vet_declined',      -- vet can't receive — rescuer must pick another
  'case_en_route',     -- rescuer is on the way to the vet
  'case_resolved',     -- animal delivered, case closed
  'case_update',       -- free-form status note from the vet
  'case_message',      -- new message in a case group chat you take part in
  'direct_message'     -- new direct message
);

-- ============================================================================
-- 2. TABLES
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles — one row per registered account (users and vets alike).
-- Mirrors auth.users via trigger. XP/tier lives here.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default 'New user',
  avatar_url    text,
  role          public.profile_role not null default 'user',
  xp            integer not null default 0,
  cases_helped  integer not null default 0,          -- resolved cases as rescuer/vet
  -- Notification preferences ------------------------------------------------
  new_case_pref     public.new_case_pref not null default 'all',
  home_lat          double precision,                 -- used when pref = 'nearby'
  home_lng          double precision,
  notify_radius_km  integer not null default 15,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- vets — clinic details for accounts with role = 'vet'.
-- Kept separate from profiles so clinic data has its own lifecycle.
-- ---------------------------------------------------------------------------
create table public.vets (
  id           uuid primary key references public.profiles (id) on delete cascade,
  clinic_name  text not null,
  address      text not null default '',
  phone        text not null default '',
  lat          double precision not null,
  lng          double precision not null,
  is_open      boolean not null default true,        -- quick "accepting animals" toggle
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- cases — the heart of the app.
-- reporter_id is NULL for guest reports (no account required to report).
-- ---------------------------------------------------------------------------
create table public.cases (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid references public.profiles (id) on delete set null,
  guest_name     text,                                -- optional name for guest reports
  animal         public.animal_type not null,
  description    text not null check (char_length(description) between 3 and 2000),
  lat            double precision not null,
  lng            double precision not null,
  address_hint   text not null default '',            -- free-text landmark ("behind 28 Mall")
  status         public.case_status not null default 'open',
  rescuer_id     uuid references public.profiles (id) on delete set null,
  vet_id         uuid references public.vets (id) on delete set null,
  -- Optional coarse "last known location" of the rescuer while en route.
  rescuer_lat    double precision,
  rescuer_lng    double precision,
  rescuer_loc_at timestamptz,
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  resolved_at    timestamptz
);

create index cases_status_idx     on public.cases (status);
create index cases_created_idx    on public.cases (created_at desc);
create index cases_rescuer_idx    on public.cases (rescuer_id);
create index cases_vet_idx        on public.cases (vet_id);

-- ---------------------------------------------------------------------------
-- case_photos — report photos and the vet's delivery-confirmation photo.
-- Files themselves live in the 'case-photos' storage bucket; rows hold URLs.
-- ---------------------------------------------------------------------------
create table public.case_photos (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.cases (id) on delete cascade,
  url         text not null,
  kind        text not null default 'report' check (kind in ('report', 'delivery')),
  created_at  timestamptz not null default now()
);

create index case_photos_case_idx on public.case_photos (case_id);

-- ---------------------------------------------------------------------------
-- case_events — append-only audit trail of everything that happened to a case.
-- The notification fan-out trigger hangs off this table, so *every* event is
-- recorded once and notified once.
-- ---------------------------------------------------------------------------
create table public.case_events (
  id          bigint generated always as identity primary key,
  case_id     uuid not null references public.cases (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  type        public.notification_type not null,
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create index case_events_case_idx on public.case_events (case_id, created_at);

-- ---------------------------------------------------------------------------
-- case_watchers — everyone who should hear about a case's progress:
-- the reporter, the rescuer, the vet, and anyone who joined the case chat
-- or tapped "watch". Populated automatically by the functions below.
-- ---------------------------------------------------------------------------
create table public.case_watchers (
  case_id     uuid not null references public.cases (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (case_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- notifications — one row per user per event. The bell tab reads this;
-- realtime INSERTs drive in-app toasts.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  type        public.notification_type not null,
  case_id     uuid references public.cases (id) on delete cascade,
  conversation_id uuid,                              -- for direct_message
  title       text not null,
  body        text not null default '',
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index notifications_profile_idx on public.notifications (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- CHAT SYSTEM 1 — general messaging (Instagram-style DMs, no case involved).
-- ---------------------------------------------------------------------------
create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

create index conv_participants_profile_idx on public.conversation_participants (profile_id);

create table public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 4000),
  created_at      timestamptz not null default now()
);

create index messages_conv_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- CHAT SYSTEM 2 — per-case group chat. Open to any registered user.
-- This is where vets may share bank details for treatment fundraising.
-- The platform deliberately does NOT process payments — text only.
-- ---------------------------------------------------------------------------
create table public.case_messages (
  id          bigint generated always as identity primary key,
  case_id     uuid not null references public.cases (id) on delete cascade,
  sender_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);

create index case_messages_case_idx on public.case_messages (case_id, created_at);

-- ============================================================================
-- 3. HELPERS
-- ============================================================================

-- Haversine distance in km — used for "new case nearby" notifications.
create or replace function public.distance_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- Short human label for a case, used in notification texts.
create or replace function public.case_label(c public.cases)
returns text language sql stable as $$
  select initcap(c.animal::text) || case when c.address_hint <> ''
    then ' near ' || c.address_hint else '' end;
$$;

-- Auto-create a profile row whenever a new auth user signs up.
-- display_name / role can be passed via signUp metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'New user'),
    case when new.raw_user_meta_data ->> 'role' = 'vet' then 'vet'::public.profile_role
         else 'user'::public.profile_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Internal: add a watcher, ignoring duplicates and null profiles.
create or replace function public._watch(p_case uuid, p_profile uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.case_watchers (case_id, profile_id)
  select p_case, p_profile where p_profile is not null
  on conflict do nothing;
$$;

-- Internal: notify every watcher of a case except the actor who caused it.
create or replace function public._notify_watchers(
  p_case uuid, p_actor uuid, p_type public.notification_type,
  p_title text, p_body text
) returns void language sql security definer set search_path = public as $$
  insert into public.notifications (profile_id, type, case_id, title, body)
  select w.profile_id, p_type, p_case, p_title, p_body
  from public.case_watchers w
  where w.case_id = p_case
    and (p_actor is null or w.profile_id <> p_actor);
$$;

-- ============================================================================
-- 4. NOTIFICATION FAN-OUT (triggers)
-- ============================================================================

-- 4a. Broadcast brand-new cases to users according to their preference:
--     'all'    → everyone gets it
--     'nearby' → only if within their radius of their saved home location
--     'off'    → nothing
create or replace function public.notify_new_case()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
begin
  v_title := 'New case: ' || public.case_label(new);

  insert into public.notifications (profile_id, type, case_id, title, body)
  select p.id, 'case_new_nearby', new.id, v_title, left(new.description, 140)
  from public.profiles p
  where p.id is distinct from new.reporter_id
    and (
      p.new_case_pref = 'all'
      or (
        p.new_case_pref = 'nearby'
        and p.home_lat is not null and p.home_lng is not null
        and public.distance_km(p.home_lat, p.home_lng, new.lat, new.lng)
              <= p.notify_radius_km
      )
    );

  -- The reporter (if registered) automatically watches their own case.
  perform public._watch(new.id, new.reporter_id);
  return new;
end;
$$;

create trigger on_case_created
  after insert on public.cases
  for each row execute function public.notify_new_case();

-- 4b. Every case_event fans out to the case's watchers.
create or replace function public.notify_case_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.cases;
  v_title text;
begin
  select * into c from public.cases where id = new.case_id;

  v_title := case new.type
    when 'case_accepted' then 'A rescuer is on it'
    when 'case_dropped'  then 'Still needs help'
    when 'vet_confirmed' then 'Vet is ready'
    when 'vet_declined'  then 'Vet unavailable'
    when 'case_en_route' then 'On the way to the vet'
    when 'case_resolved' then 'Animal is safe'
    when 'case_update'   then 'Update from the vet'
    else 'Case update'
  end || ' — ' || public.case_label(c);

  perform public._notify_watchers(new.case_id, new.actor_id, new.type,
                                  v_title, new.note);

  -- 'vet_requested' additionally pings the selected vet directly
  -- (they may not be a watcher yet).
  if new.type = 'vet_requested' and c.vet_id is not null then
    insert into public.notifications (profile_id, type, case_id, title, body)
    values (c.vet_id, 'vet_requested', c.id,
            'Incoming animal — please confirm',
            'A rescuer wants to bring you an injured ' || c.animal::text || '. ' ||
            coalesce(new.note, ''));
  end if;

  return new;
end;
$$;

create trigger on_case_event
  after insert on public.case_events
  for each row execute function public.notify_case_event();

-- 4c. Case chat: posting makes you a watcher; watchers get a notification.
create or replace function public.notify_case_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.cases;
  v_sender text;
begin
  select * into c from public.cases where id = new.case_id;
  select display_name into v_sender from public.profiles where id = new.sender_id;

  perform public._watch(new.case_id, new.sender_id);
  perform public._notify_watchers(new.case_id, new.sender_id, 'case_message',
    v_sender || ' in ' || public.case_label(c), left(new.body, 140));
  return new;
end;
$$;

create trigger on_case_message
  after insert on public.case_messages
  for each row execute function public.notify_case_message();

-- 4d. Direct messages notify the other participants.
create or replace function public.notify_direct_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_sender text;
begin
  select display_name into v_sender from public.profiles where id = new.sender_id;

  insert into public.notifications (profile_id, type, conversation_id, title, body)
  select cp.profile_id, 'direct_message', new.conversation_id,
         'Message from ' || v_sender, left(new.body, 140)
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id
    and cp.profile_id <> new.sender_id;
  return new;
end;
$$;

create trigger on_direct_message
  after insert on public.messages
  for each row execute function public.notify_direct_message();

-- ============================================================================
-- 5. XP / LEVELING
-- ============================================================================
-- Awarded once, server-side, when a case reaches 'resolved':
--   rescuer +50, vet +30, reporter +10.
-- Tier thresholds live in the frontend (they're presentation), the raw XP
-- number lives here (it's truth).

create or replace function public.award_xp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    update public.profiles
      set xp = xp + 50, cases_helped = cases_helped + 1
      where id = new.rescuer_id;
    update public.profiles
      set xp = xp + 30, cases_helped = cases_helped + 1
      where id = new.vet_id;
    update public.profiles
      set xp = xp + 10
      where id = new.reporter_id;
  end if;
  return new;
end;
$$;

create trigger on_case_resolved
  after update on public.cases
  for each row execute function public.award_xp();

-- ============================================================================
-- 6. CASE STATE MACHINE (the only way case status ever changes)
-- ============================================================================
-- All functions are SECURITY DEFINER and validate both the caller's identity
-- and the current status, so illegal transitions are impossible no matter
-- what the client sends. Each successful transition writes a case_event,
-- which triggers the notification fan-out above.

-- A registered user commits to rescue an open case.
create or replace function public.accept_case(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept a case.';
  end if;

  -- Atomic compare-and-set: only succeeds if the case is still open.
  update public.cases
    set status = 'accepted', rescuer_id = auth.uid(), accepted_at = now()
    where id = p_case and status = 'open';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'This case was already accepted by someone else.';
  end if;

  perform public._watch(p_case, auth.uid());
  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'case_accepted', 'A rescuer committed to help.');
end;
$$;

-- The rescuer drops the case at any point before delivery → back to open.
create or replace function public.drop_case(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  update public.cases
    set status = 'open', rescuer_id = null, vet_id = null,
        accepted_at = null, rescuer_lat = null, rescuer_lng = null,
        rescuer_loc_at = null
    where id = p_case and rescuer_id = auth.uid()
      and status in ('accepted', 'vet_selected', 'vet_confirmed', 'en_route');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You are not the active rescuer on this case.';
  end if;

  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'case_dropped',
          'The rescuer dropped this case — it still needs help.');
end;
$$;

-- The rescuer picks a vet → the vet is asked to confirm.
create or replace function public.select_vet(p_case uuid, p_vet uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
  v_clinic text;
begin
  select clinic_name into v_clinic from public.vets where id = p_vet;
  if v_clinic is null then
    raise exception 'Vet not found.';
  end if;

  update public.cases
    set status = 'vet_selected', vet_id = p_vet
    where id = p_case and rescuer_id = auth.uid()
      and status in ('accepted', 'vet_selected');  -- allow re-picking after a decline
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Only the active rescuer can choose a vet at this stage.';
  end if;

  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'vet_requested',
          'Rescuer asked ' || v_clinic || ' to receive the animal.');
end;
$$;

-- The selected vet confirms or declines the incoming animal.
create or replace function public.vet_respond(p_case uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  if p_accept then
    update public.cases set status = 'vet_confirmed'
      where id = p_case and vet_id = auth.uid() and status = 'vet_selected';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'No pending request for your clinic on this case.'; end if;

    perform public._watch(p_case, auth.uid());
    insert into public.case_events (case_id, actor_id, type, note)
    values (p_case, auth.uid(), 'vet_confirmed',
            'The clinic is ready to receive the animal.');
  else
    update public.cases set status = 'accepted', vet_id = null
      where id = p_case and vet_id = auth.uid() and status = 'vet_selected';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'No pending request for your clinic on this case.'; end if;

    insert into public.case_events (case_id, actor_id, type, note)
    values (p_case, auth.uid(), 'vet_declined',
            'The clinic cannot receive the animal right now — please choose another vet.');
  end if;
end;
$$;

-- The rescuer sets off toward the vet.
create or replace function public.start_transport(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  update public.cases set status = 'en_route'
    where id = p_case and rescuer_id = auth.uid() and status = 'vet_confirmed';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'The vet must confirm before you set off.';
  end if;

  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'case_en_route',
          'The rescuer is on the way to the vet.');
end;
$$;

-- Optional bonus: the rescuer shares a coarse "last known location" en route.
create or replace function public.update_rescuer_location(
  p_case uuid, p_lat double precision, p_lng double precision
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.cases
    set rescuer_lat = p_lat, rescuer_lng = p_lng, rescuer_loc_at = now()
    where id = p_case and rescuer_id = auth.uid() and status = 'en_route';
end;
$$;

-- The vet confirms receipt of the animal → case resolved, XP awarded.
create or replace function public.confirm_delivery(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  update public.cases set status = 'resolved', resolved_at = now()
    where id = p_case and vet_id = auth.uid()
      and status in ('en_route', 'vet_confirmed');  -- rescuer may arrive without tapping "depart"
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Only the receiving vet can confirm delivery.';
  end if;

  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'case_resolved',
          'The animal arrived at the clinic and is being cared for.');
end;
$$;

-- Vets can post free-form status updates at any active stage
-- ("condition stable", "surgery scheduled", "there will be a delay"...).
create or replace function public.vet_post_update(p_case uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  select exists (
    select 1 from public.cases
    where id = p_case and vet_id = auth.uid()
  ) into v_ok;
  if not v_ok then
    raise exception 'Only the case''s vet can post updates.';
  end if;

  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'case_update', left(p_note, 500));
end;
$$;

-- Watch / unwatch a case (bell icon on the case page).
create or replace function public.watch_case(p_case uuid)
returns void language sql security definer set search_path = public as $$
  select public._watch(p_case, auth.uid());
$$;

create or replace function public.unwatch_case(p_case uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.case_watchers
  where case_id = p_case and profile_id = auth.uid();
$$;

-- ============================================================================
-- 7. DIRECT-MESSAGING RPC
-- ============================================================================
-- Find the existing 1:1 conversation with another user, or create one.
create or replace function public.get_or_create_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_conv uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to send messages.'; end if;
  if p_other = auth.uid() then raise exception 'You cannot message yourself.'; end if;

  -- Look for a conversation whose participant set is exactly {me, other}.
  select cp1.conversation_id into v_conv
  from public.conversation_participants cp1
  join public.conversation_participants cp2
    on cp1.conversation_id = cp2.conversation_id
  where cp1.profile_id = auth.uid() and cp2.profile_id = p_other
    and (select count(*) from public.conversation_participants cp3
         where cp3.conversation_id = cp1.conversation_id) = 2
  limit 1;

  if v_conv is null then
    insert into public.conversations default values returning id into v_conv;
    insert into public.conversation_participants (conversation_id, profile_id)
    values (v_conv, auth.uid()), (v_conv, p_other);
  end if;

  return v_conv;
end;
$$;

-- Mark a conversation as read up to now.
create or replace function public.mark_conversation_read(p_conv uuid)
returns void language sql security definer set search_path = public as $$
  update public.conversation_participants
  set last_read_at = now()
  where conversation_id = p_conv and profile_id = auth.uid();
$$;

-- ============================================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles                  enable row level security;
alter table public.vets                      enable row level security;
alter table public.cases                     enable row level security;
alter table public.case_photos               enable row level security;
alter table public.case_events               enable row level security;
alter table public.case_watchers             enable row level security;
alter table public.notifications             enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages                  enable row level security;
alter table public.case_messages             enable row level security;

-- profiles: public directory (names/levels are public), self-editable —
-- but only harmless columns. Column-level grants make it impossible to
-- self-award XP or self-promote to 'vet' even though the row is updatable:
-- xp, cases_helped and role are only ever written by SECURITY DEFINER
-- triggers/functions.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, new_case_pref, home_lat, home_lng, notify_radius_km)
  on public.profiles to authenticated;

create policy "profiles are viewable by everyone"
  on public.profiles for select using (true);
create policy "users update own profile"
  on public.profiles for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- vets: public directory; the owning vet manages their clinic row.
create policy "vets are viewable by everyone"
  on public.vets for select using (true);
create policy "vet inserts own clinic"
  on public.vets for insert with check (
    auth.uid() = id and
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'vet')
  );
create policy "vet updates own clinic"
  on public.vets for update using (auth.uid() = id);

-- cases: readable by everyone (including guests browsing the map).
-- INSERT is open to both anon (guest reports) and authenticated users —
-- a registered user must report as themselves, a guest as nobody.
-- No UPDATE/DELETE policies: all changes go through the state machine RPCs.
create policy "cases are viewable by everyone"
  on public.cases for select using (true);
create policy "anyone can report a case"
  on public.cases for insert with check (
    (auth.uid() is null and reporter_id is null)
    or (auth.uid() is not null and (reporter_id = auth.uid() or reporter_id is null))
  );

-- case_photos: public read; report photos attachable by anyone at report
-- time; delivery photos only by the case's vet.
create policy "case photos are viewable by everyone"
  on public.case_photos for select using (true);
create policy "attach report photos"
  on public.case_photos for insert with check (
    kind = 'report'
    or (kind = 'delivery' and auth.uid() = (select vet_id from public.cases where id = case_id))
  );

-- case_events: public read (they power the case timeline). Insert only via
-- definer functions, so no insert policy is needed.
create policy "case events are viewable by everyone"
  on public.case_events for select using (true);

-- case_watchers: users see & manage their own watch list (RPCs handle writes,
-- but a select policy lets the UI show "watching" state).
create policy "see own watches"
  on public.case_watchers for select using (auth.uid() = profile_id);

-- notifications: strictly private.
create policy "read own notifications"
  on public.notifications for select using (auth.uid() = profile_id);
create policy "mark own notifications read"
  on public.notifications for update using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- conversations & messages: participants only.
--
-- NOTE: these policies must NOT query conversation_participants directly
-- from within conversation_participants' own policy (or from a policy whose
-- evaluation cascades back into it) — Postgres would raise "infinite
-- recursion detected in policy". The SECURITY DEFINER helper below bypasses
-- RLS for the membership check, which breaks the cycle safely.
create or replace function public.is_conversation_member(p_conv uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conv and profile_id = auth.uid()
  );
$$;

create policy "participants see conversations"
  on public.conversations for select
  using (public.is_conversation_member(id));
create policy "participants see participant rows"
  on public.conversation_participants for select
  using (profile_id = auth.uid() or public.is_conversation_member(conversation_id));
create policy "participants read messages"
  on public.messages for select
  using (public.is_conversation_member(conversation_id));
create policy "participants send messages"
  on public.messages for insert
  with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));

-- case chat: readable by everyone (it's a public coordination space),
-- writable by any signed-in user.
create policy "case chat is viewable by everyone"
  on public.case_messages for select using (true);
create policy "signed-in users post in case chat"
  on public.case_messages for insert with check (sender_id = auth.uid());

-- ============================================================================
-- 9. REALTIME
-- ============================================================================
-- Add the live tables to Supabase's realtime publication so clients get
-- postgres_changes events for case status, chats, and notifications.
alter publication supabase_realtime add table public.cases;
alter publication supabase_realtime add table public.case_messages;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.case_events;

-- ============================================================================
-- 10. STORAGE
-- ============================================================================
-- Public bucket for case photos. Guests (anon) may upload report photos —
-- required because reporting works without an account. Uploads are capped
-- by Supabase's global file size limit; the client also compresses images.
insert into storage.buckets (id, name, public)
values ('case-photos', 'case-photos', true)
on conflict (id) do nothing;

create policy "public read of case photos"
  on storage.objects for select using (bucket_id = 'case-photos');
create policy "anyone can upload case photos"
  on storage.objects for insert with check (bucket_id = 'case-photos');
