-- member_type plumbing: surface the descriptive label(s) in the directory + public profile, and
-- let admins read/set them. Idempotent: drop+create where the return shape or arg list changes.
-- profiles.member_type itself is added in registration_requests.sql.

-- Multiple member types: a profile can carry several descriptive labels (e.g. Founder + Investor
-- + Mentor). The array member_types is the source of truth; the legacy single member_type column
-- is kept populated with the first label for any older reader. Backfill once from member_type.
alter table public.profiles add column if not exists member_types text[] not null default '{}';
update public.profiles
  set member_types = array[member_type]
  where member_type is not null and trim(member_type) <> '' and (member_types is null or member_types = '{}');

-- directory: return each member's types + filter by "has this type".
drop function if exists public.directory(text, text, text, text, text);
drop function if exists public.directory(text, text, text, text, text, text);
create function public.directory(
  p_search text default null,
  p_region text default null,
  p_sector text default null,
  p_domain text default null,
  p_role text default null,
  p_member_type text default null
)
returns table (
  id uuid, name text, role text, member_types text[], startup text,
  region text, sector text, domain text, linkedin text, bio text, pinned boolean, contactable boolean, email text
)
language sql stable security definer set search_path = public
as $$
  -- email is surfaced (gated on contactable) so members reach each other by email/LinkedIn
  -- directly; the in-app email relay was removed 2026-06-20.
  select
    p.id, p.name, p.role, coalesce(p.member_types, '{}'), p.startup, p.region, p.sector, p.domain, p.linkedin,
    p.bio, coalesce(p.directory_pinned, false), coalesce(p.contactable, true),
    case when coalesce(p.contactable, true) then u.email::text else null end
  from public.profiles p
  join auth.users u on u.id = p.id
  where coalesce(p.banned, false) = false
    and coalesce(p.onboarded, false) = true
    and coalesce(p.directory_visible, true) = true
    and (p_role is null or p.role = p_role)
    and (p_member_type is null or p_member_type = any(p.member_types))
    and (p_region is null or p.region = p_region)
    and (p_sector is null or p.sector = p_sector)
    and (p_domain is null or p.domain = p_domain)
    and (p_search is null or p_search = ''
         or p.name ilike '%' || p_search || '%'
         or coalesce(p.startup, '') ilike '%' || p_search || '%')
  order by coalesce(p.directory_pinned, false) desc, p.name
$$;
-- Lock to logged-in members: Postgres grants function EXECUTE to PUBLIC by default, and
-- directory() has no auth.uid() gate, so without this revoke the anon role (public key, no
-- login) could call it and harvest the whole member list incl. emails. Members only.
revoke execute on function public.directory(text, text, text, text, text, text) from anon, public;
grant execute on function public.directory(text, text, text, text, text, text) to authenticated;

-- public_profile: add member_types.
drop function if exists public.public_profile(uuid);
create function public.public_profile(p_user uuid)
returns table (
  id uuid, name text, role text, member_types text[], startup text, region text, sector text, domain text,
  linkedin text, bio text, contactable boolean, directory_visible boolean,
  incubation_interest boolean, is_self boolean, created_at timestamptz, email text
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.role, coalesce(p.member_types, '{}'), p.startup, p.region, p.sector, p.domain,
         p.linkedin, p.bio, coalesce(p.contactable, true), coalesce(p.directory_visible, true),
         coalesce(p.incubation_interest, false), (p.id = auth.uid()), p.created_at,
         case when coalesce(p.contactable, true) or p.id = auth.uid() then u.email::text else null end
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_user and coalesce(p.banned, false) = false
$$;
revoke execute on function public.public_profile(uuid) from anon, public;
grant execute on function public.public_profile(uuid) to authenticated;

-- admin_get_profile: add member_types.
drop function if exists public.admin_get_profile(uuid);
create function public.admin_get_profile(p_user uuid)
returns table (
  name text, phone text, bio text, startup text,
  region text, sector text, domain text, linkedin text, incubation_interest boolean, member_types text[]
)
language sql stable security definer set search_path = public
as $$
  select p.name, p.phone, p.bio, p.startup, p.region, p.sector, p.domain, p.linkedin, p.incubation_interest, coalesce(p.member_types, '{}')
  from public.profiles p
  where public.is_admin() and p.id = p_user
$$;
grant execute on function public.admin_get_profile(uuid) to authenticated;

-- admin_update_profile: p_member_types array (last arg, defaulted so existing callers don't break).
drop function if exists public.admin_update_profile(uuid, text, text, text, text, text, text, text, text, boolean);
drop function if exists public.admin_update_profile(uuid, text, text, text, text, text, text, text, text, boolean, text);
drop function if exists public.admin_update_profile(uuid, text, text, text, text, text, text, text, text, boolean, text[]);
create function public.admin_update_profile(
  p_user uuid, p_name text, p_phone text, p_bio text, p_startup text,
  p_region text, p_sector text, p_domain text, p_linkedin text, p_incubation boolean,
  p_member_types text[] default '{}'
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;
  update public.profiles set
    name = trim(p_name),
    phone = nullif(trim(coalesce(p_phone, '')), ''),
    bio = nullif(trim(coalesce(p_bio, '')), ''),
    startup = nullif(trim(coalesce(p_startup, '')), ''),
    region = nullif(trim(coalesce(p_region, '')), ''),
    sector = nullif(trim(coalesce(p_sector, '')), ''),
    domain = nullif(trim(coalesce(p_domain, '')), ''),
    linkedin = nullif(trim(coalesce(p_linkedin, '')), ''),
    incubation_interest = coalesce(p_incubation, false),
    member_types = coalesce(p_member_types, '{}'),
    member_type = case when coalesce(array_length(p_member_types, 1), 0) > 0 then p_member_types[1] else null end
  where id = p_user;
end
$$;
grant execute on function public.admin_update_profile(uuid, text, text, text, text, text, text, text, text, boolean, text[]) to authenticated;
