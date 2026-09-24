-- ============================================================================
-- PawLine — migration 030: admin_list_users() for the Admin → Users tab
-- ----------------------------------------------------------------------------
-- The Users tab needs, per account, fields that column grants deliberately
-- hide from every signed-in session (005): `banned`, `is_admin`, and the
-- account email, which lives in auth.users and is not exposed at all. An
-- admin connects as the same `authenticated` role as everyone else, so a
-- plain SELECT can't reach them — this bypasses the grants the same way
-- admin_list_pending_vets() does for vets' private columns (014).
--
-- SECURITY BOUNDARY. This function returns every user's email and ban state.
-- The is_admin() check on the first line of the body IS the protection; the
-- execute grant below only lets the call reach that check. Nothing is read
-- before it, so a non-admin learns nothing but "Admins only." — not whether
-- a search matched, not a row count.
--
-- Execute is revoked from PUBLIC and anon first: 004's default privileges
-- grant execute on every new function to anon, and a signed-out caller has
-- no business reaching even the gate. `authenticated` keeps it, because the
-- admin is an authenticated session like any other.
--
-- Parameters (all optional):
--   p_role    'user' | 'vet' | null (all). Anything else is rejected.
--   p_search  substring of display_name OR email, case-insensitive. LIKE
--             wildcards typed by the admin (% _ \) are escaped, so they
--             match literally instead of widening the search.
--   p_sort    'created_at' (newest first) | 'xp' | 'cases_helped' (highest
--             first). Sorting is server-side because the list is paginated:
--             sorting one client-side page would order only that page.
--   p_limit   clamped to 1..100.
--   p_offset  clamped to >= 0.
-- Ties break on id, so offset pages never overlap or skip a row.
--
-- cases_reported / cases_hidden count cases by creator_uid — the same "who
-- made this" rule admin_reported_accounts (015) and the 023 review lists
-- use. Guests have no profiles row (handle_new_user skips anonymous
-- sessions), so they never appear here.
--
-- Run after 029. Idempotent.
-- ============================================================================

create or replace function public.admin_list_users(
  p_role   text    default null,
  p_search text    default null,
  p_sort   text    default 'created_at',
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id             uuid,
  display_name   text,
  avatar_url     text,
  role           public.profile_role,
  xp             integer,
  cases_helped   integer,
  created_at     timestamptz,
  banned         boolean,
  is_admin       boolean,
  partner_org    text,
  email          text,
  cases_reported bigint,
  cases_hidden   bigint
)
language plpgsql security definer stable set search_path = public as $$
declare
  v_sort   text    := coalesce(p_sort, 'created_at');
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text    := nullif(trim(p_search), '');
  v_like   text;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;

  if p_role is not null and p_role not in ('user', 'vet') then
    raise exception 'Invalid role.';
  end if;
  if v_sort not in ('created_at', 'xp', 'cases_helped') then
    raise exception 'Invalid sort.';
  end if;

  if v_search is not null then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select
    p.id,
    p.display_name,
    p.avatar_url,
    p.role,
    p.xp,
    p.cases_helped,
    p.created_at,
    p.banned,
    p.is_admin,
    p.partner_org,
    u.email::text,
    coalesce(c.reported, 0)::bigint,
    coalesce(c.hidden, 0)::bigint
  from public.profiles p
  left join auth.users u on u.id = p.id
  left join lateral (
    select
      count(*)                              as reported,
      count(*) filter (where cs.hidden)     as hidden
    from public.cases cs
    where cs.creator_uid = p.id
  ) c on true
  where (p_role is null or p.role::text = p_role)
    and (
      v_like is null
      or p.display_name ilike v_like
      or u.email ilike v_like
    )
  order by
    case when v_sort = 'xp'           then p.xp           end desc nulls last,
    case when v_sort = 'cases_helped' then p.cases_helped end desc nulls last,
    p.created_at desc,
    p.id
  limit v_limit
  offset v_offset;
end;
$$;

revoke execute on function public.admin_list_users(text, text, text, integer, integer) from public, anon;
grant  execute on function public.admin_list_users(text, text, text, integer, integer) to authenticated;
