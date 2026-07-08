-- ============================================================================
-- PawLine — migration 003: production readiness
-- ----------------------------------------------------------------------------
-- Run after 001 and 002. Adds, in order:
--   1. Admin role + user bans
--   2. Guest reporting hardening (anonymous auth + rate limits)
--   3. Vet verification (pending → approved before appearing publicly)
--   4. Content moderation (reports, soft-hiding content)
--   5. Web Push subscriptions
--   6. AI-assisted duplicate-report detection (soft flags only)
--   7. Sponsors / partners
--   8. Scale: indexes + safer defaults
--
-- ⚠ OPERATIONAL NOTE (see docs/OPERATIONS.md): after running this, make
-- yourself admin with:  update public.profiles set is_admin = true where id = 'YOUR-PROFILE-ID';
-- That column can ONLY be set this way (SQL editor) — deliberately, so a
-- compromised app session can never mint new admins.
-- ============================================================================

-- ============================================================================
-- 1. ADMIN + BANS
-- ============================================================================

alter table public.profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists banned   boolean not null default false;

-- True if the current caller is an admin. SECURITY DEFINER so policies on
-- any table can call it without tripping over profiles' own RLS.
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

-- True if the current caller signed in anonymously (guest reporting).
create or replace function public.is_anon_user()
returns boolean language sql stable as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

-- True if the caller's account is banned.
create or replace function public.is_banned()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (select banned from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ============================================================================
-- 2. GUEST REPORTING HARDENING
-- ----------------------------------------------------------------------------
-- Design: "no account required" stays, but guests now get a Supabase
-- ANONYMOUS session under the hood (the app calls signInAnonymously()
-- transparently). That gives every guest device a stable auth.uid() we can
-- rate-limit against — the pure `anon` role had no identity at all, so any
-- bot could insert unlimited fake reports.
--
-- ⚠ SETUP REQUIRED: enable "Allow anonymous sign-ins" in
--    Supabase Dashboard → Authentication → Sign In / Up.
-- Optionally also enable CAPTCHA (Cloudflare Turnstile) there for a
-- stronger bot deterrent — the app works either way.
-- ============================================================================

-- Track who physically created each case (registered OR anonymous uid).
alter table public.cases
  add column if not exists creator_uid uuid default auth.uid();

create index if not exists cases_creator_recent_idx
  on public.cases (creator_uid, created_at desc);

-- Skip profile creation for anonymous users — they'd pollute people search
-- and the notification fan-out with thousands of throwaway "New user" rows.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_anonymous then
    return new;
  end if;
  insert into public.profiles (id, display_name, role, locale)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'New user'),
    case when new.raw_user_meta_data ->> 'role' = 'vet' then 'vet'::public.profile_role
         else 'user'::public.profile_role end,
    case when new.raw_user_meta_data ->> 'locale' in ('az', 'tr', 'en')
         then new.raw_user_meta_data ->> 'locale'
         else 'az' end
  );
  return new;
end;
$$;

-- Rate limit + ban check on new reports, enforced in the database where the
-- client can't bypass it: max 4 reports/hour and 15/day per identity.
create or replace function public.enforce_case_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hour int;
  v_day  int;
begin
  if public.is_banned() then
    raise exception 'This account cannot create reports.';
  end if;

  select count(*) into v_hour from public.cases
    where creator_uid = auth.uid() and created_at > now() - interval '1 hour';
  select count(*) into v_day from public.cases
    where creator_uid = auth.uid() and created_at > now() - interval '24 hours';

  if v_hour >= 4 or v_day >= 15 then
    raise exception 'Too many reports from this device. Please wait a while before reporting again.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_case_rate_limit on public.cases;
create trigger on_case_rate_limit
  before insert on public.cases
  for each row execute function public.enforce_case_limits();

-- Replace the case INSERT policy: every report now requires *some* session
-- (anonymous counts). Registered users report as themselves; anonymous
-- sessions report with reporter_id null.
drop policy if exists "anyone can report a case" on public.cases;
create policy "signed-in or anonymous sessions can report"
  on public.cases for insert with check (
    auth.uid() is not null
    and (
      (public.is_anon_user() and reporter_id is null)
      or (not public.is_anon_user() and reporter_id = auth.uid())
    )
  );

-- Storage: uploads now require a session too (anonymous included).
drop policy if exists "anyone can upload case photos" on storage.objects;
create policy "sessions can upload case photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'case-photos');

-- ============================================================================
-- 3. VET VERIFICATION
-- ----------------------------------------------------------------------------
-- New clinics start 'pending' and are invisible to the public until an
-- admin approves them (in-app Admin screen). Prevents fake clinics from
-- receiving injured animals — the highest-trust role on the platform.
-- ============================================================================

alter table public.vets
  add column if not exists status text not null default 'pending'
  check (status in ('pending', 'approved', 'rejected'));

-- Public sees only approved clinics; owners always see their own row;
-- admins see everything.
drop policy if exists "vets are viewable by everyone" on public.vets;
create policy "approved vets are public; owners and admins see all"
  on public.vets for select using (
    status = 'approved' or id = auth.uid() or public.is_admin()
  );

-- A rescuer must not be able to route an animal to an unapproved clinic.
create or replace function public.select_vet(p_case uuid, p_vet uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
  v_clinic text;
begin
  select clinic_name into v_clinic from public.vets
    where id = p_vet and status = 'approved';
  if v_clinic is null then
    raise exception 'Vet not found or not yet verified.';
  end if;

  update public.cases
    set status = 'vet_selected', vet_id = p_vet
    where id = p_case and rescuer_id = auth.uid()
      and status in ('accepted', 'vet_selected');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Only the active rescuer can choose a vet at this stage.';
  end if;

  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'vet_requested',
          'Rescuer asked ' || v_clinic || ' to receive the animal.');
end;
$$;

-- Admin: approve/reject a clinic. Notifies the vet either way.
create or replace function public.admin_set_vet_status(p_vet uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'Invalid status.';
  end if;

  update public.vets set status = p_status where id = p_vet;

  insert into public.notifications (profile_id, type, title, body)
  values (p_vet, 'case_update',
          case p_status when 'approved' then 'Your clinic is verified'
                        when 'rejected' then 'Clinic verification declined'
                        else 'Clinic under review' end,
          case p_status when 'approved' then 'Your clinic now appears to rescuers on PawLine.'
                        else 'Please contact support if you believe this is a mistake.' end);
end;
$$;

-- ============================================================================
-- 4. CONTENT MODERATION
-- ----------------------------------------------------------------------------
-- Users flag content; admins review in the Admin screen and can soft-hide
-- content or ban accounts. Hiding is reversible (nothing is deleted, so
-- mistakes can be undone and evidence is preserved).
-- ============================================================================

alter table public.cases         add column if not exists hidden boolean not null default false;
alter table public.case_messages add column if not exists hidden boolean not null default false;

-- Hidden content disappears from public reads but stays visible to admins.
drop policy if exists "cases are viewable by everyone" on public.cases;
create policy "visible cases are viewable by everyone"
  on public.cases for select using (not hidden or public.is_admin());

drop policy if exists "case chat is viewable by everyone" on public.case_messages;
create policy "visible case chat is viewable by everyone"
  on public.case_messages for select using (not hidden or public.is_admin());

-- Posting in chats now requires a full (non-anonymous, non-banned) account.
drop policy if exists "signed-in users post in case chat" on public.case_messages;
create policy "accounts in good standing post in case chat"
  on public.case_messages for insert with check (
    sender_id = auth.uid() and not public.is_anon_user() and not public.is_banned()
  );

drop policy if exists "participants send messages" on public.messages;
create policy "participants in good standing send messages"
  on public.messages for insert with check (
    sender_id = auth.uid()
    and not public.is_anon_user()
    and not public.is_banned()
    and public.is_conversation_member(conversation_id)
  );

-- Accepting a case also requires good standing.
create or replace function public.accept_case(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  if auth.uid() is null or public.is_anon_user() then
    raise exception 'Sign in to accept a case.';
  end if;
  if public.is_banned() then
    raise exception 'This account cannot accept cases.';
  end if;

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

-- The report queue itself.
create table if not exists public.content_reports (
  id             bigint generated always as identity primary key,
  reporter_id    uuid not null references public.profiles (id) on delete cascade,
  target_type    text not null check (target_type in ('case', 'case_message', 'profile')),
  target_case    uuid references public.cases (id) on delete cascade,
  target_message bigint references public.case_messages (id) on delete cascade,
  target_profile uuid references public.profiles (id) on delete cascade,
  reason         text not null check (char_length(reason) between 3 and 500),
  status         text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create index if not exists content_reports_open_idx
  on public.content_reports (status, created_at desc);

alter table public.content_reports enable row level security;

create policy "accounts file reports"
  on public.content_reports for insert with check (
    reporter_id = auth.uid() and not public.is_anon_user() and not public.is_banned()
  );
create policy "admins and authors read reports"
  on public.content_reports for select using (
    public.is_admin() or reporter_id = auth.uid()
  );

-- Admin moderation actions (all reversible except the audit trail).
create or replace function public.admin_hide_case(p_case uuid, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.cases set hidden = p_hidden where id = p_case;
end;
$$;

create or replace function public.admin_hide_case_message(p_id bigint, p_hidden boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.case_messages set hidden = p_hidden where id = p_id;
end;
$$;

create or replace function public.admin_ban_user(p_profile uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_profile = auth.uid() then raise exception 'You cannot ban yourself.'; end if;
  update public.profiles set banned = p_banned where id = p_profile;
end;
$$;

create or replace function public.admin_resolve_report(p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_status not in ('resolved', 'dismissed') then raise exception 'Invalid status.'; end if;
  update public.content_reports
    set status = p_status, resolved_at = now()
    where id = p_id;
end;
$$;

-- ============================================================================
-- 5. WEB PUSH SUBSCRIPTIONS
-- ----------------------------------------------------------------------------
-- One row per browser/device that enabled push. The send-push Edge Function
-- (supabase/functions/send-push) reads these when a notifications row is
-- inserted, via a Database Webhook — see docs/DEPLOYMENT.md for setup.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists push_subscriptions_profile_idx
  on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;

create policy "users manage own push subscriptions"
  on public.push_subscriptions for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- ============================================================================
-- 6. DUPLICATE-REPORT DETECTION (soft flags — NEVER blocks a report)
-- ----------------------------------------------------------------------------
-- Signals: distance ≤ 500 m, reported ≤ 90 min apart, same animal type,
-- plus perceptual-hash (dHash) similarity between photos when available.
-- The client computes a 64-bit dHash per photo (free, on-device, no AI API)
-- and stores it on case_photos.phash; hamming distance is computed here
-- with bit_count(). Flags are advisory: humans confirm or dismiss.
-- ============================================================================

alter table public.case_photos
  add column if not exists phash bigint;

create table if not exists public.case_duplicate_flags (
  id               bigint generated always as identity primary key,
  case_id          uuid not null references public.cases (id) on delete cascade,
  similar_case_id  uuid not null references public.cases (id) on delete cascade,
  distance_m       integer not null,
  minutes_apart    integer not null,
  phash_distance   integer,          -- 0–64; ≤ 12 is a strong photo match; null = no comparable photos
  status           text not null default 'pending'
                     check (status in ('pending', 'confirmed', 'dismissed')),
  created_at       timestamptz not null default now(),
  unique (case_id, similar_case_id)
);

create index if not exists dup_flags_case_idx on public.case_duplicate_flags (case_id, status);

alter table public.case_duplicate_flags enable row level security;
create policy "duplicate flags are viewable by everyone"
  on public.case_duplicate_flags for select using (true);

-- Scan for likely duplicates of a freshly reported case. Idempotent; the
-- client calls it once after photo upload. Deliberately conservative:
-- it can only ADD advisory flags, never touch the case itself.
create or replace function public.check_case_duplicates(p_case uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  c public.cases;
  v_count int := 0;
  cand record;
  v_phash int;
begin
  select * into c from public.cases where id = p_case;
  if c.id is null then return 0; end if;

  for cand in
    select o.*,
           round(public.distance_km(c.lat, c.lng, o.lat, o.lng) * 1000)::int as dist_m,
           round(extract(epoch from (c.created_at - o.created_at)) / 60)::int as mins
    from public.cases o
    where o.id <> c.id
      and o.hidden = false
      and o.animal = c.animal
      and o.created_at between c.created_at - interval '90 minutes' and c.created_at
      and public.distance_km(c.lat, c.lng, o.lat, o.lng) <= 0.5
    order by o.created_at desc
    limit 5
  loop
    -- Best (lowest) hamming distance between any photo pair with hashes.
    select min(bit_count(a.phash # b.phash)) into v_phash
    from public.case_photos a, public.case_photos b
    where a.case_id = c.id and b.case_id = cand.id
      and a.phash is not null and b.phash is not null;

    insert into public.case_duplicate_flags
      (case_id, similar_case_id, distance_m, minutes_apart, phash_distance)
    values (c.id, cand.id, cand.dist_m, cand.mins, v_phash)
    on conflict (case_id, similar_case_id) do nothing;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Confirm/dismiss a flag. Allowed for admins, the case reporter, and the
-- active rescuer — the people actually looking at the animal. Confirming
-- only records the link in the timeline; the case stays fully alive.
create or replace function public.resolve_duplicate_flag(p_id bigint, p_confirm boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.case_duplicate_flags;
  c public.cases;
begin
  select * into f from public.case_duplicate_flags where id = p_id;
  if f.id is null then raise exception 'Flag not found.'; end if;
  select * into c from public.cases where id = f.case_id;

  if not (public.is_admin() or auth.uid() = c.reporter_id or auth.uid() = c.rescuer_id) then
    raise exception 'Only the reporter, rescuer, or an admin can resolve this.';
  end if;

  update public.case_duplicate_flags
    set status = case when p_confirm then 'confirmed' else 'dismissed' end
    where id = p_id;

  if p_confirm then
    insert into public.case_events (case_id, actor_id, type, note)
    values (f.case_id, auth.uid(), 'case_update',
            'Marked as the same animal as an earlier report — rescuers, please coordinate in the case chats.');
  end if;
end;
$$;

-- ============================================================================
-- 7. SPONSORS / PARTNERS
-- ----------------------------------------------------------------------------
-- Infrastructure for the monetization/partnership model (see MONETIZATION.md):
-- a tasteful "Supported by" strip. `kind` distinguishes paying sponsors from
-- nonprofit partners (shelters, federations) shown for credibility.
-- ============================================================================

create table if not exists public.sponsors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'sponsor' check (kind in ('sponsor', 'partner')),
  logo_url    text not null default '',
  url         text not null default '',
  blurb       text not null default '',
  active      boolean not null default true,
  sort        integer not null default 100,
  created_at  timestamptz not null default now()
);

alter table public.sponsors enable row level security;

create policy "active sponsors are public; admins see all"
  on public.sponsors for select using (active or public.is_admin());
create policy "admins insert sponsors"
  on public.sponsors for insert with check (public.is_admin());
create policy "admins update sponsors"
  on public.sponsors for update using (public.is_admin());
create policy "admins delete sponsors"
  on public.sponsors for delete using (public.is_admin());

-- ============================================================================
-- 8. SCALE
-- ----------------------------------------------------------------------------
-- The one true hot spot is the new-case notification fan-out (one row per
-- opted-in user per report). Two mitigations, keeping current users intact:
--   a. New signups default to 'nearby' instead of 'all' — fan-out then grows
--      with local density, not total user count. (Existing users keep 'all'.)
--   b. Partial indexes so the fan-out SELECT and the unread-badge query stay
--      index-only as tables grow.
-- If PawLine reaches hundreds of thousands of users, move this fan-out to a
-- queued Edge Function — everything else already holds (see ARCHITECTURE.md).
-- ============================================================================

alter table public.profiles alter column new_case_pref set default 'nearby';

create index if not exists profiles_fanout_idx
  on public.profiles (new_case_pref) where new_case_pref <> 'off';

create index if not exists notifications_unread_idx
  on public.notifications (profile_id) where read = false;

-- Don't notify banned accounts about new cases.
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
    and p.banned = false
    and (
      p.new_case_pref = 'all'
      or (
        p.new_case_pref = 'nearby'
        and p.home_lat is not null and p.home_lng is not null
        and public.distance_km(p.home_lat, p.home_lng, new.lat, new.lng)
              <= p.notify_radius_km
      )
    );

  perform public._watch(new.id, new.reporter_id);
  return new;
end;
$$;
