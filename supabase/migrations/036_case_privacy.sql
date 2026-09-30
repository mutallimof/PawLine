-- ============================================================================
-- PawLine — migration 036: case privacy (live location, server-only columns)
-- ----------------------------------------------------------------------------
-- public.cases was readable column-for-column by anyone, including anon
-- (004: `grant select on public.cases to anon, authenticated`, no column
-- grants) and was in the supabase_realtime publication (001), so every change
-- broadcast the full row. That exposed the rescuer's LIVE location
-- (rescuer_lat / rescuer_lng / rescuer_loc_at, updated every ~45 s),
-- creator_uid (links a guest's reports) and the consent fields.
--
-- This migration:
--   1. Guards: aborts if anything in the LIVE database other than the four
--      functions redefined here references the rescuer_* columns, or if any
--      policy / view reads a column this migration makes server-only.
--   2. Moves the live location to case_rescuer_locations, readable only by
--      the case's participants — reporter_id, creator_uid (a guest reporter's
--      own session), rescuer_id, vet_id — and admins. Watching a case grants
--      NO access. Written only by update_rescuer_location(); deleted on
--      delivery, drop and auto-revert. Then drops the three columns.
--   3. Takes `cases` out of the realtime publication and publishes
--      case_signals (case_id, hidden, changed_at) instead, bumped by a trigger
--      when a public column changes — the app only uses these events to
--      refetch. case_rescuer_locations is published too (row-level RLS).
--   4. Replaces the table-level read grant on cases with a public column
--      list: creator_uid, terms_version, terms_accepted_at and
--      last_progress_at become server-only.
--   5. Photo-upload policies (031) stop reading creator_uid directly (they run
--      as the caller) and use is_case_creator(); admins get
--      admin_hidden_cases_by() in place of filtering on creator_uid.
--
-- Functions redefined from their latest definitions, verbatim except for the
-- rescuer_* lines: update_rescuer_location (033), confirm_delivery (033),
-- drop_case (001), revert_abandoned_cases (007).
--
-- Prerequisite: the public column list includes street_address (029),
-- pinned_message_id (027) and chat_closed_at (032); if any is missing the
-- migration fails and nothing is applied.
--
-- Deploy the fix/case-privacy-client build FIRST (it works before and after
-- this migration), then run this.
--
-- Wrapped in one transaction: if any statement fails, nothing is applied.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Guards (read the live catalog, not the migration files)
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_hits text;
begin
  select string_agg(distinct x, '; ' order by x) into v_hits
  from (
    select format('function %I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as x
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosrc ~ 'rescuer_(lat|lng|loc_at)'
      and not (n.nspname = 'public'
               and p.proname in ('update_rescuer_location', 'confirm_delivery',
                                 'drop_case', 'revert_abandoned_cases'))
    union all
    select format('view %I.%I', schemaname, viewname)
    from pg_views where definition ~ 'rescuer_(lat|lng|loc_at)'
    union all
    select format('materialized view %I.%I', schemaname, matviewname)
    from pg_matviews where definition ~ 'rescuer_(lat|lng|loc_at)'
    union all
    select format('policy %I.%I "%s"', schemaname, tablename, policyname)
    from pg_policies
    where coalesce(qual, '') ~ 'rescuer_(lat|lng|loc_at)'
       or coalesce(with_check, '') ~ 'rescuer_(lat|lng|loc_at)'
  ) s;
  if v_hits is not null then
    raise exception '036 aborted — these still reference rescuer_lat / rescuer_lng / rescuer_loc_at: %', v_hits;
  end if;

  -- Policies and views run with the CALLER's column privileges, so any that
  -- read a column made server-only below would start failing. Only the two
  -- photo-upload policies redefined in section 5 are expected.
  select string_agg(distinct x, '; ' order by x) into v_hits
  from (
    select format('policy %I.%I "%s"', schemaname, tablename, policyname) as x
    from pg_policies
    where (coalesce(qual, '') ~ '(creator_uid|terms_version|terms_accepted_at|last_progress_at)'
           or coalesce(with_check, '') ~ '(creator_uid|terms_version|terms_accepted_at|last_progress_at)')
      and policyname not in ('creator attaches report photos; vet attaches delivery photos',
                             'case participants upload under their case''s folder')
    union all
    select format('view %I.%I', schemaname, viewname)
    from pg_views
    where schemaname = 'public'
      and definition ~ '(creator_uid|terms_version|terms_accepted_at|last_progress_at)'
  ) s;
  if v_hits is not null then
    raise exception '036 aborted — these read a column that becomes server-only: %', v_hits;
  end if;

  if (select puballtables from pg_publication where pubname = 'supabase_realtime') then
    raise exception '036 aborted — supabase_realtime publishes ALL tables, so cases cannot be excluded from it.';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- The case's participants: reporter, the guest session that created it,
-- rescuer, vet — and admins. Watchers are not participants.
create or replace function public.is_case_participant(p_case uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.is_admin()
    or exists (
      select 1 from public.cases c
      where c.id = p_case
        and auth.uid() in (c.reporter_id, c.creator_uid, c.rescuer_id, c.vet_id)
    )
  );
$$;

-- Did the caller's session create this case? (creator_uid is server-only now.)
create or replace function public.is_case_creator(p_case uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cases c where c.id = p_case and c.creator_uid = auth.uid()
  );
$$;

revoke all on function public.is_case_participant(uuid) from public;
revoke all on function public.is_case_creator(uuid) from public;
grant execute on function public.is_case_participant(uuid) to anon, authenticated;
grant execute on function public.is_case_creator(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Live location: its own participants-only table
-- ---------------------------------------------------------------------------
create table if not exists public.case_rescuer_locations (
  case_id    uuid primary key references public.cases (id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  updated_at timestamptz not null default now()
);

alter table public.case_rescuer_locations enable row level security;

drop policy if exists "case participants and admins see the rescuer's location" on public.case_rescuer_locations;
create policy "case participants and admins see the rescuer's location"
  on public.case_rescuer_locations for select
  using (public.is_case_participant(case_id));

-- Read-only for clients; update_rescuer_location() is the only writer.
grant select on public.case_rescuer_locations to authenticated;

-- Carry over positions of rescues currently en route.
insert into public.case_rescuer_locations (case_id, lat, lng, updated_at)
select id, rescuer_lat, rescuer_lng, coalesce(rescuer_loc_at, now())
from public.cases
where status = 'en_route' and rescuer_lat is not null and rescuer_lng is not null
on conflict (case_id) do nothing;

-- update_rescuer_location — latest definition: migration 033
create or replace function public.update_rescuer_location(
  p_case uuid, p_lat double precision, p_lng double precision
) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_banned() then raise exception 'This account cannot update cases.'; end if;
  update public.cases
    set last_progress_at = now()
    where id = p_case and rescuer_id = auth.uid() and status = 'en_route';
  -- 036: the position itself lives in case_rescuer_locations (participants only).
  if found then
    insert into public.case_rescuer_locations (case_id, lat, lng, updated_at)
    values (p_case, p_lat, p_lng, now())
    on conflict (case_id) do update
      set lat = excluded.lat, lng = excluded.lng, updated_at = excluded.updated_at;
  end if;
end;
$$;

-- confirm_delivery — latest definition: migration 033
create or replace function public.confirm_delivery(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  if public.is_banned() then raise exception 'This account cannot update cases.'; end if;
  update public.cases
    set status = 'resolved', resolved_at = now()
    where id = p_case and vet_id = auth.uid()
      and status in ('en_route', 'vet_confirmed');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'Only the receiving vet can confirm delivery.';
  end if;
  -- 036: replaces clearing the old location columns on the case row.
  delete from public.case_rescuer_locations where case_id = p_case;

  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'case_resolved',
          'The animal arrived at the clinic and is being cared for.');
end;
$$;

-- drop_case — latest definition: migration 001
create or replace function public.drop_case(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  update public.cases
    set status = 'open', rescuer_id = null, vet_id = null,
        accepted_at = null
    where id = p_case and rescuer_id = auth.uid()
      and status in ('accepted', 'vet_selected', 'vet_confirmed', 'en_route');
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You are not the active rescuer on this case.';
  end if;
  -- 036: replaces clearing the old location columns on the case row.
  delete from public.case_rescuer_locations where case_id = p_case;

  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'case_dropped',
          'The rescuer dropped this case — it still needs help.');
end;
$$;

-- revert_abandoned_cases — latest definition: migration 007
create or replace function public.revert_abandoned_cases()
returns integer language plpgsql security definer set search_path = public as $$
declare
  c record;
  v_count int := 0;
begin
  for c in
    select id, rescuer_id from public.cases
    where hidden = false
      and (
        (status in ('accepted', 'vet_selected', 'vet_confirmed')
          and last_progress_at < now() - interval '45 minutes')
        or (status = 'en_route'
          and last_progress_at < now() - interval '75 minutes')
      )
  loop
    update public.cases
      set status = 'open', rescuer_id = null, vet_id = null,
          accepted_at = null, last_progress_at = now()
      where id = c.id;
    -- 036: replaces clearing the old location columns on the case row.
    delete from public.case_rescuer_locations where case_id = c.id;

    insert into public.case_events (case_id, actor_id, type, note)
    values (c.id, null, 'case_dropped',
            'No progress for a while — the case was automatically reopened so other rescuers can step in.');

    if c.rescuer_id is not null then
      insert into public.notifications (profile_id, type, case_id, title, body)
      values (c.rescuer_id, 'case_update', c.id,
              'Your rescue was reopened',
              'We hadn''t seen progress in a while, so the case is open to others again. If you''re still on it, you can re-accept.');
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

alter table public.cases
  drop column rescuer_lat,
  drop column rescuer_lng,
  drop column rescuer_loc_at;

-- ---------------------------------------------------------------------------
-- 4. Realtime: publish a tiny signal table instead of full case rows
-- ---------------------------------------------------------------------------
create table if not exists public.case_signals (
  case_id    uuid primary key references public.cases (id) on delete cascade,
  hidden     boolean not null default false,
  changed_at timestamptz not null default now()
);

alter table public.case_signals enable row level security;

drop policy if exists "case signals are viewable by everyone" on public.case_signals;
create policy "case signals are viewable by everyone"
  on public.case_signals for select using (true);

grant select on public.case_signals to anon, authenticated;

create or replace function public.touch_case_signal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.case_signals (case_id, hidden, changed_at)
  values (new.id, new.hidden, now())
  on conflict (case_id) do update
    set hidden = excluded.hidden, changed_at = excluded.changed_at;
  return null;
end;
$$;

-- Fires on new cases and on changes to PUBLIC columns only — not on
-- last_progress_at, so location pings don't make every client refetch.
drop trigger if exists on_case_signal on public.cases;
create trigger on_case_signal
  after insert or update of reporter_id, guest_name, animal, description, lat, lng, address_hint, street_address, status, rescuer_id, vet_id, accepted_at, resolved_at, hidden, escalated_at, closed_reason, injury_type, spot_type, urgency, pinned_message_id, chat_closed_at
  on public.cases
  for each row execute function public.touch_case_signal();

do $pub$
begin
  if exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cases') then
    alter publication supabase_realtime drop table public.cases;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'case_signals') then
    alter publication supabase_realtime add table public.case_signals;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'case_rescuer_locations') then
    alter publication supabase_realtime add table public.case_rescuer_locations;
  end if;
end
$pub$;

-- ---------------------------------------------------------------------------
-- 5. Column-level read grant on cases; policies that read creator_uid
-- ---------------------------------------------------------------------------
revoke select on public.cases from anon, authenticated;
grant select (id, reporter_id, guest_name, animal, description, lat, lng, address_hint, street_address, status, rescuer_id, vet_id, created_at, accepted_at, resolved_at, hidden, escalated_at, closed_reason, injury_type, spot_type, urgency, pinned_message_id, chat_closed_at)
  on public.cases to anon, authenticated;

-- Photo uploads (031) — same rules, creator check via is_case_creator().
drop policy if exists "creator attaches report photos; vet attaches delivery photos" on public.case_photos;
create policy "creator attaches report photos; vet attaches delivery photos"
  on public.case_photos for insert with check (
    not public.is_banned()
    and (
      (kind = 'report'
        and public.is_case_creator(case_id))
      or
      (kind = 'delivery'
        and auth.uid() = (select vet_id from public.cases where id = case_id))
    )
  );

drop policy if exists "case participants upload under their case's folder" on storage.objects;
create policy "case participants upload under their case's folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'case-photos'
    and not public.is_banned()
    and exists (
      select 1 from public.cases c
      where c.id::text = (storage.foldername(name))[1]
        and (public.is_case_creator(c.id)
             or c.rescuer_id = auth.uid()
             or c.vet_id = auth.uid())
    )
  );

-- Admin: one account's hidden cases (the client filtered on creator_uid).
create or replace function public.admin_hidden_cases_by(p_profile uuid)
returns table (id uuid, animal public.animal_type, description text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query
    select c.id, c.animal, c.description, c.created_at
    from public.cases c
    where c.creator_uid = p_profile and c.hidden
    order by c.created_at desc
    limit 50;
end;
$$;

revoke all on function public.admin_hidden_cases_by(uuid) from public;
grant execute on function public.admin_hidden_cases_by(uuid) to authenticated;

commit;
