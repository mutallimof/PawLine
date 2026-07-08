-- ============================================================================
-- PawLine — migration 006: growth-critical backend features
-- ----------------------------------------------------------------------------
-- 1. Time-to-acceptance metrics (admin stats RPC) — the survival metric the
--    research pass identified: does a report reliably get a response?
-- 2. Case escalation — unanswered cases widen their notification reach
--    instead of silently sitting.
-- 3. Partner organizations — verified NGO/shelter accounts get a public
--    badge (partner-first launch strategy).
-- 4. Public impact aggregates — safe, PII-free numbers for /impact.
-- Run after 005.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. METRICS — admin-only detailed stats
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_stats()
returns table (
  cases_total          bigint,
  cases_open_now       bigint,
  cases_resolved_30d   bigint,
  median_accept_min    numeric,  -- median minutes report → rescuer commit (30d)
  median_resolve_min   numeric,  -- median minutes report → safe at vet (30d)
  active_rescuers_30d  bigint,
  reports_by_guests_7d bigint
) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query
  select
    (select count(*) from cases),
    (select count(*) from cases where status = 'open' and hidden = false),
    (select count(*) from cases where status = 'resolved'
       and resolved_at > now() - interval '30 days'),
    (select round((percentile_cont(0.5) within group
       (order by extract(epoch from (accepted_at - created_at)) / 60))::numeric, 1)
       from cases where accepted_at is not null
       and created_at > now() - interval '30 days'),
    (select round((percentile_cont(0.5) within group
       (order by extract(epoch from (resolved_at - created_at)) / 60))::numeric, 1)
       from cases where resolved_at is not null
       and created_at > now() - interval '30 days'),
    (select count(distinct rescuer_id) from cases
       where accepted_at > now() - interval '30 days'),
    (select count(*) from cases c
       where c.created_at > now() - interval '7 days'
       and not exists (select 1 from profiles p where p.id = c.creator_uid));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. ESCALATION — a case unanswered for 30 minutes stops being quiet.
--    escalate_stale_cases() is meant to run every 10 minutes via pg_cron
--    (scheduled below; harmless no-op where pg_cron is unavailable, e.g.
--    local replicas — Supabase has it).
--    Effect per stale case, exactly once:
--      · escalated_at is stamped (feed/map render it prominently, sorted first)
--      · nearby-pref users within 2× their chosen radius are notified
--        (they opted into "nearby"; a still-unanswered animal justifies
--        one wider ring — never repeated, dedup guard below)
-- ---------------------------------------------------------------------------
alter table public.cases add column if not exists escalated_at timestamptz;
create index if not exists cases_escalation_idx
  on public.cases (status, escalated_at) where status = 'open';

create or replace function public.escalate_stale_cases()
returns integer language plpgsql security definer set search_path = public as $$
declare
  c public.cases;  -- typed (not RECORD) so case_label(c.*) casts — caught in local replay
  v_count int := 0;
begin
  for c in
    select * from public.cases
    where status = 'open' and hidden = false and escalated_at is null
      and created_at < now() - interval '30 minutes'
    order by created_at
    limit 20  -- per run; the 10-min cadence drains any backlog quickly
  loop
    update public.cases set escalated_at = now() where id = c.id;

    insert into public.notifications (profile_id, type, case_id, title, body)
    select p.id, 'case_new_nearby', c.id,
           'Still waiting: ' || public.case_label(c.*),
           left(c.description, 140)
    from public.profiles p
    where p.banned = false
      and p.new_case_pref = 'nearby'
      and p.home_lat is not null and p.home_lng is not null
      and public.distance_km(p.home_lat, p.home_lng, c.lat, c.lng)
            <= p.notify_radius_km * 2
      and p.id is distinct from c.reporter_id
      -- never double-notify anyone about this case
      and not exists (select 1 from public.notifications n
                      where n.case_id = c.id and n.profile_id = p.id);

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Schedule (Supabase ships pg_cron; guarded so local replays don't fail).
do $outer$
begin
  begin
    create extension if not exists pg_cron;
    perform cron.schedule(
      'pawline-escalate-stale-cases',
      '*/10 * * * *',
      $job$ select public.escalate_stale_cases(); $job$
    );
  exception when others then
    raise notice 'pg_cron unavailable here — schedule escalate_stale_cases() manually (Supabase: it just works; see OPERATOR_GUIDE).';
  end;
end;
$outer$;

-- ---------------------------------------------------------------------------
-- 3. PARTNER ORGANIZATIONS — public affiliation badge, admin-granted.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists partner_org text;
grant select (partner_org) on public.profiles to anon, authenticated;

create or replace function public.admin_set_partner(p_profile uuid, p_org text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  update public.profiles
    set partner_org = nullif(trim(coalesce(p_org, '')), '')
    where id = p_profile;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. PUBLIC IMPACT — aggregates only, callable by anyone (incl. signed out).
--    Nothing row-level, nothing personal: safe for a public page and for
--    partner/sponsor conversations.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_impact()
returns table (
  helped_this_month bigint,
  helped_total      bigint,
  median_accept_min numeric,
  rescuers_30d      bigint,
  clinics           bigint
) language sql security definer stable set search_path = public as $$
  select
    (select count(*) from cases where status = 'resolved'
       and resolved_at >= date_trunc('month', now())),
    (select count(*) from cases where status = 'resolved'),
    (select round((percentile_cont(0.5) within group
       (order by extract(epoch from (accepted_at - created_at)) / 60))::numeric, 0)
       from cases where accepted_at is not null
       and created_at > now() - interval '30 days'),
    (select count(distinct rescuer_id) from cases
       where accepted_at > now() - interval '30 days'),
    (select count(*) from vets where status = 'approved');
$$;

-- Explicit grants (004's default privileges cover fresh projects; these make
-- 006 self-sufficient on projects where 004's defaults never ran).
grant execute on function public.admin_get_stats() to authenticated;
grant execute on function public.escalate_stale_cases() to authenticated;
grant execute on function public.admin_set_partner(uuid, text) to authenticated;
grant execute on function public.get_public_impact() to anon, authenticated;
