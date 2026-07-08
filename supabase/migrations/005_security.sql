-- ============================================================================
-- PawLine — migration 005: security audit fixes
-- ----------------------------------------------------------------------------
-- Every change here maps to a numbered finding in docs/TESTING_REPORT.md.
-- Run after 001–004. On a FRESH project run the (fixed) 004 first; on an
-- existing project just run this — it re-issues the grant 004's typo
-- swallowed (S2) and is idempotent throughout.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- S2: 004 granted on "conversation_members" (doesn't exist) and aborted.
-- Re-issue what died after that line on any project that ran broken 004.
-- ---------------------------------------------------------------------------
grant select on public.conversation_participants to authenticated;

-- ---------------------------------------------------------------------------
-- S1: home locations were world-readable. Profiles become a PUBLIC DIRECTORY
-- of only directory-safe columns; your own full row (home area, prefs,
-- locale, admin/ban flags) comes via get_my_profile() below.
-- RLS still allows the row; COLUMN grants now define what "public" means.
-- ---------------------------------------------------------------------------
revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, avatar_url, role, xp, cases_helped, created_at)
  on public.profiles to anon, authenticated;

create or replace function public.get_my_profile()
returns setof public.profiles
language sql security definer stable set search_path = public as $$
  select * from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- S4 + S5: report-creation hardening.
--  - creator_uid is now FORCED server-side (was client-supplied → rate-limit
--    bypass and identity framing).
--  - Platform-wide anonymous circuit breaker: guests (sessions with no
--    profile row) collectively max 40 reports/hour. Generous on purpose —
--    a real mass-casualty event must never trip before a spam wave does;
--    registered users are never affected. The durable anti-bot fix is
--    Cloudflare Turnstile on anonymous sign-in (OPERATOR_GUIDE §spam).
-- ---------------------------------------------------------------------------
create index if not exists cases_created_at_idx on public.cases (created_at desc);

create or replace function public.enforce_case_limits()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hour int;
  v_day  int;
  v_anon_hour int;
begin
  -- S4: never trust the client's claim of who created this row. Client
  -- sessions always have auth.uid(); coalesce keeps trusted service_role /
  -- seed inserts (which have no JWT) able to set it explicitly — a case our
  -- local adversarial harness caught (see TESTING_REPORT §C pass 2).
  new.creator_uid := coalesce(auth.uid(), new.creator_uid);

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

  -- S5: circuit breaker for anonymous sessions collectively.
  if public.is_anon_user() then
    select count(*) into v_anon_hour from public.cases c
      where c.created_at > now() - interval '1 hour'
        and not exists (select 1 from public.profiles p where p.id = c.creator_uid);
    if v_anon_hour >= 40 then
      raise exception 'Guest reporting is briefly paused due to unusual volume — please create a free account to report right now.';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- S3: photo injection. Report photos only by the case's CREATOR; delivery
-- photos only by the case's vet. (Previously: anyone, any case, forever.)
-- ---------------------------------------------------------------------------
drop policy if exists "attach report photos" on public.case_photos;
create policy "creator attaches report photos; vet attaches delivery photos"
  on public.case_photos for insert with check (
    (kind = 'report'
      and auth.uid() = (select creator_uid from public.cases where id = case_id))
    or
    (kind = 'delivery'
      and auth.uid() = (select vet_id from public.cases where id = case_id))
  );

-- Storage: the object path's first folder must be a case this uploader
-- created, rescues, or vets — the bucket stops being anonymous free hosting.
drop policy if exists "sessions can upload case photos" on storage.objects;
create policy "case participants upload under their case's folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'case-photos'
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and (c.creator_uid = auth.uid()
             or c.rescuer_id = auth.uid()
             or c.vet_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- S6: notifications — clients may flip `read`, nothing else.
-- ---------------------------------------------------------------------------
revoke update on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;

-- ---------------------------------------------------------------------------
-- S7: rescuer live location must not outlive the rescue.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_delivery(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  update public.cases
    set status = 'resolved', resolved_at = now(),
        rescuer_lat = null, rescuer_lng = null, rescuer_loc_at = null
    where id = p_case and vet_id = auth.uid()
      and status in ('en_route', 'vet_confirmed');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Only the receiving vet can confirm delivery.';
  end if;

  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'case_resolved',
          'The animal arrived at the clinic and is being cared for.');
end;
$$;

-- ---------------------------------------------------------------------------
-- S8: duplicate scan — only the case's creator (right after reporting) or an
-- admin may trigger it, and only while the case is fresh.
-- ---------------------------------------------------------------------------
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

  -- NULL-safe guard: plain `=` yields NULL (not false) against a NULL
  -- creator_uid, and `IF NOT NULL THEN` silently skips the raise — a real
  -- three-valued-logic hole our local adversarial harness caught
  -- (TESTING_REPORT §C pass 2). `is not distinct from` closes it.
  if not (public.is_admin() or c.creator_uid is not distinct from auth.uid()) then
    raise exception 'Only the reporter or an admin can run the duplicate scan.';
  end if;
  if c.created_at < now() - interval '24 hours' then
    return 0; -- stale; nothing to gain, nothing to spam
  end if;

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

-- ---------------------------------------------------------------------------
-- S9: banned/anonymous users don't get to open DM shells either.
-- ---------------------------------------------------------------------------
create or replace function public.get_or_create_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_conv uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to send messages.'; end if;
  if public.is_anon_user() then raise exception 'Create an account to send messages.'; end if;
  if public.is_banned() then raise exception 'This account cannot send messages.'; end if;
  if p_other = auth.uid() then raise exception 'You cannot message yourself.'; end if;

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
