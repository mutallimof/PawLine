-- ============================================================================
-- PawLine — migration 033: banned accounts can't move cases or manage chats
-- ----------------------------------------------------------------------------
-- accept_case (007) and flag_not_here (007) already refuse banned accounts,
-- as do reporting (enforce_case_limits, 021), case-chat posting (032 policy)
-- and case photo uploads (031). The rest of the case pipeline did not: a
-- banned account could still pick a vet, confirm/decline as a vet, set off,
-- confirm delivery, post vet updates, share rescuer location (which also
-- resets last_progress_at and so keeps a case from auto-reverting), resolve
-- duplicate flags, pin/unpin bank details, close/reopen a case chat, and rate
-- a clinic.
--
-- Every function below is its LATEST definition copied verbatim (source
-- migration noted above each), with one line added as the first statement:
--   if public.is_banned() then raise exception 'This account cannot …'; end if;
-- The "This account cannot" prefix matches every existing ban refusal, which
-- is what the app keys its localized banned-account message on.
--
-- Also (item 3): a banned owner's clinic can no longer be found or picked.
--   - vet_owner_banned(): SECURITY DEFINER, because profiles.banned is not
--     column-granted to anon/authenticated (005).
--   - vets_public (014) gets `where not vet_owner_banned(v.id)` — same
--     columns, same security_invoker. The vets table policy is left alone so
--     case history still shows which clinic handled a case.
--   - open_vets_near (010) skips banned owners' clinics.
--   - select_vet refuses a banned owner's clinic (the one extra body change).
--
-- Deliberately NOT changed: drop_case (a banned rescuer handing a case back
-- frees the animal for others — blocking it would trap the case until the
-- 45-minute auto-revert), watch/unwatch_case and mark_case_chat_read (own
-- subscriptions/read markers, no case state). Numbered 033: 026 is reserved
-- for the parked guest-report-race branch.
--
-- Wrapped in one transaction: if any statement fails, nothing is applied.
-- ============================================================================

begin;

-- Is the clinic's owner banned? (vets.id = the owner's profiles.id)
-- Answers only for clinic owners (the join on vets), so it can't be used to
-- probe whether an arbitrary user is banned.
create or replace function public.vet_owner_banned(p_vet uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.banned from public.profiles p join public.vets v on v.id = p.id where v.id = p_vet), false);
$$;

revoke all on function public.vet_owner_banned(uuid) from public;
grant execute on function public.vet_owner_banned(uuid) to anon, authenticated;

-- select_vet — latest definition: migration 010
-- (033 also rewords 'not verified' → 'not approved' in its approval check.)
create or replace function public.select_vet(p_case uuid, p_vet uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows   int;
  v_clinic text;
  v_vet    public.vets;
begin
  if public.is_banned() then raise exception 'This account cannot update cases.'; end if;
  select * into v_vet from public.vets where id = p_vet;
  if v_vet.id is null then
    raise exception 'Vet not found.';
  end if;
  v_clinic := v_vet.clinic_name;

  if v_vet.status is distinct from 'approved' then
    raise exception 'That clinic is not approved.';
  end if;
  -- 033: a banned owner's clinic can't receive animals.
  if public.vet_owner_banned(p_vet) then
    raise exception 'That clinic is not available right now.';
  end if;

  if not public.vet_within_hours(v_vet.opens_at, v_vet.closes_at, v_vet.is_24_7, v_vet.timezone) then
    raise exception 'That clinic is closed right now. Please choose one that is open.';
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

-- vet_respond — latest definition: migration 007
create or replace function public.vet_respond(p_case uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  if public.is_banned() then raise exception 'This account cannot update cases.'; end if;
  if p_accept then
    update public.cases set status = 'vet_confirmed', last_progress_at = now()
      where id = p_case and vet_id = auth.uid() and status = 'vet_selected';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'No pending request for your clinic on this case.'; end if;

    perform public._watch(p_case, auth.uid());
    insert into public.case_events (case_id, actor_id, type, note)
    values (p_case, auth.uid(), 'vet_confirmed',
            'The clinic is ready to receive the animal.');
  else
    update public.cases set status = 'accepted', vet_id = null, last_progress_at = now()
      where id = p_case and vet_id = auth.uid() and status = 'vet_selected';
    get diagnostics v_rows = row_count;
    if v_rows = 0 then raise exception 'No pending request for your clinic on this case.'; end if;

    insert into public.case_events (case_id, actor_id, type, note)
    values (p_case, auth.uid(), 'vet_declined',
            'The clinic cannot receive the animal right now — please choose another vet.');
  end if;
end;
$$;

-- start_transport — latest definition: migration 007
create or replace function public.start_transport(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  if public.is_banned() then raise exception 'This account cannot update cases.'; end if;
  update public.cases set status = 'en_route', last_progress_at = now()
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

-- confirm_delivery — latest definition: migration 005
create or replace function public.confirm_delivery(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  if public.is_banned() then raise exception 'This account cannot update cases.'; end if;
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

-- vet_post_update — latest definition: migration 007
create or replace function public.vet_post_update(p_case uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  if public.is_banned() then raise exception 'This account cannot update cases.'; end if;
  select exists (select 1 from public.cases where id = p_case and vet_id = auth.uid())
  into v_ok;
  if not v_ok then raise exception 'Only the case''s vet can post updates.'; end if;

  update public.cases set last_progress_at = now() where id = p_case;
  insert into public.case_events (case_id, actor_id, type, note)
  values (p_case, auth.uid(), 'case_update', left(p_note, 500));
end;
$$;

-- update_rescuer_location — latest definition: migration 007
create or replace function public.update_rescuer_location(
  p_case uuid, p_lat double precision, p_lng double precision
) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_banned() then raise exception 'This account cannot update cases.'; end if;
  update public.cases
    set rescuer_lat = p_lat, rescuer_lng = p_lng, rescuer_loc_at = now(),
        last_progress_at = now()
    where id = p_case and rescuer_id = auth.uid() and status = 'en_route';
end;
$$;

-- resolve_duplicate_flag — latest definition: migration 003
create or replace function public.resolve_duplicate_flag(p_id bigint, p_confirm boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.case_duplicate_flags;
  c public.cases;
begin
  if public.is_banned() then raise exception 'This account cannot update cases.'; end if;
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

-- pin_case_message — latest definition: migration 028
create or replace function public.pin_case_message(p_case uuid, p_message bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if public.is_banned() then raise exception 'This account cannot pin messages.'; end if;
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

  -- The message must belong to this case, must not be hidden by moderation
  -- (003/011), and — new in 028 — must have been written by the caller.
  if not exists (
    select 1 from public.case_messages m
    where m.id = p_message
      and m.case_id = p_case
      and m.sender_id = v_uid
      and not m.hidden
  ) then
    raise exception 'You can only pin your own message in this case.';
  end if;

  update public.cases set pinned_message_id = p_message where id = p_case;
end;
$$;

-- unpin_case_message — latest definition: migration 027
create or replace function public.unpin_case_message(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if public.is_banned() then raise exception 'This account cannot pin messages.'; end if;
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

-- close_case_chat — latest definition: migration 032
create or replace function public.close_case_chat(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if public.is_banned() then raise exception 'This account cannot manage this chat.'; end if;
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

-- reopen_case_chat — latest definition: migration 032
create or replace function public.reopen_case_chat(p_case uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if public.is_banned() then raise exception 'This account cannot manage this chat.'; end if;
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

-- open_vets_near — latest definition: migration 010; skips banned owners.
create or replace function public.open_vets_near(
  p_lat double precision, p_lng double precision, p_km double precision default 25
) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.vets v
  where v.status = 'approved'
    and not public.vet_owner_banned(v.id)
    and public.vet_within_hours(v.opens_at, v.closes_at, v.is_24_7, v.timezone)
    and public.distance_km(v.lat, v.lng, p_lat, p_lng) <= p_km;
$$;

-- vets_public — latest definition: migration 014; same columns and options,
-- plus the banned-owner filter. (Same column list, so OR REPLACE is allowed.)
create or replace view public.vets_public
with (security_invoker = true) as
select
  v.id, v.clinic_name, v.contact_phone, v.contact_email, v.address,
  v.lat, v.lng, v.is_open, v.opens_at, v.closes_at, v.is_24_7, v.timezone,
  v.accepted_animals, v.status, v.created_at,
  public.vet_within_hours(v.opens_at, v.closes_at, v.is_24_7, v.timezone) as open_now,
  public.vet_within_hours(v.opens_at, v.closes_at, v.is_24_7, v.timezone)
    and v.is_open as accepting_now,
  coalesce(r.rating_avg, 0)::numeric(3,2) as rating_avg,
  coalesce(r.rating_count, 0)::int as rating_count
from public.vets v
left join (
  select vet_id, avg(rating)::numeric as rating_avg, count(*) as rating_count
  from public.vet_ratings
  group by vet_id
) r on r.vet_id = v.id
where not public.vet_owner_banned(v.id);

grant select on public.vets_public to anon, authenticated;

-- Rating a clinic (policy from 014) — same rule, plus not banned.
drop policy if exists "rescuer rates a confirmed delivery, once per case" on public.vet_ratings;
create policy "rescuer rates a confirmed delivery, once per case"
  on public.vet_ratings for insert with check (
    rescuer_id = auth.uid()
    and not public.is_banned()
    and exists (
      select 1 from public.cases c
      where c.id = case_id
        and c.vet_id = vet_ratings.vet_id
        and c.rescuer_id = auth.uid()
        and c.status = 'resolved'
    )
  );

commit;
