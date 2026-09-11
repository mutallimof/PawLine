-- ============================================================================
-- PawLine — migration 015: C4, reporter abuse flagging
-- ----------------------------------------------------------------------------
-- Source: docs/FIX_SPEC.md, C4. Run after 001–014.
--
-- No schema change — content_reports already carries everything needed to
-- resolve "who actually made this" (target_case → cases.creator_uid,
-- target_message → case_messages.sender_id, target_profile directly). What's
-- missing is (a) a way to AGGREGATE open reports by that resolved account
-- instead of one row per report/case, and (b) a single action that hides
-- every case that account created and bans it, instead of hiding cases one
-- at a time. Both are new SECURITY DEFINER functions; nothing here alters a
-- table or column.
--
-- Not touched: migrations 001–014, the case state machine RPCs, auth flow,
-- is_admin/role/xp grants, and no RLS policy at all (these are function-only
-- changes — content_reports/cases/profiles RLS is unchanged; is_admin() is
-- checked explicitly inside each function body instead). Idempotent
-- (create or replace).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Accounts with unusually many OPEN reports against their content in a
-- recent window — the volume signal the per-report queue (B3) doesn't show,
-- since it lists one row per report/case with no cross-case aggregation.
-- Resolves the reported account the same way for all three target_types,
-- then groups by it. Only OPEN reports count, so an account drops off this
-- list automatically once admin_flag_account() (below) resolves them —
-- self-cleaning, no separate "dismiss from this view" action needed.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reported_accounts(
  p_window     interval default interval '7 days',
  p_min_reports integer  default 3
)
returns table (
  profile_id      uuid,
  display_name    text,
  report_count    bigint,
  case_count      bigint,
  first_report_at timestamptz,
  last_report_at  timestamptz
)
language plpgsql security definer stable set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;

  return query
  select
    acc.profile_id,
    p.display_name,
    count(*)::bigint as report_count,
    count(distinct acc.case_id)::bigint as case_count,
    min(r.created_at) as first_report_at,
    max(r.created_at) as last_report_at
  from public.content_reports r
  cross join lateral (
    select
      case r.target_type
        when 'case'         then (select c.creator_uid from public.cases c where c.id = r.target_case)
        when 'case_message' then (select cm.sender_id from public.case_messages cm where cm.id = r.target_message)
        when 'profile'      then r.target_profile
      end as profile_id,
      case r.target_type
        when 'case'         then r.target_case
        when 'case_message' then (select cm.case_id from public.case_messages cm where cm.id = r.target_message)
        else null
      end as case_id
  ) acc
  join public.profiles p on p.id = acc.profile_id
  where r.status = 'open'
    and r.created_at > now() - p_window
    and acc.profile_id is not null
  group by acc.profile_id, p.display_name
  having count(*) >= p_min_reports
  order by report_count desc, last_report_at desc;
end;
$$;

grant execute on function public.admin_reported_accounts(interval, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- The one action: hide every case that account created, ban the account,
-- and resolve every open report that pointed at them (case, case_message,
-- or profile) — so this account also disappears from admin_reported_accounts
-- and from the B3 per-report queue in the same stroke. Mirrors
-- admin_ban_user()'s self-ban guard.
-- ---------------------------------------------------------------------------
create or replace function public.admin_flag_account(p_profile uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_profile = auth.uid() then raise exception 'You cannot flag yourself.'; end if;

  update public.cases set hidden = true where creator_uid = p_profile;
  update public.profiles set banned = true where id = p_profile;

  update public.content_reports
    set status = 'resolved', resolved_at = now()
    where status = 'open'
      and (
        (target_type = 'case' and target_case in (
          select id from public.cases where creator_uid = p_profile))
        or (target_type = 'case_message' and target_message in (
          select id from public.case_messages where sender_id = p_profile))
        or (target_type = 'profile' and target_profile = p_profile)
      );
end;
$$;

grant execute on function public.admin_flag_account(uuid) to authenticated;
