-- Multi-select profile fields: region, sector, domain become text[] so a founder
-- active in multiple states, sectors, or domains can list them all. Run AFTER member_type.sql.
-- Idempotent: column migration guards with DO block; functions use drop-then-create.

-- The scalar char_length() length checks (db/input_limits.sql) must be gone before the type
-- change: Postgres re-validates every CHECK against the new type, and char_length(text[]) does
-- not exist. input_limits.sql now only drops these, but drop here too so apply order / a manual
-- re-run can't leave a stale scalar check that blocks the ALTER.
alter table public.profiles drop constraint if exists chk_profiles_region_len;
alter table public.profiles drop constraint if exists chk_profiles_sector_len;
alter table public.profiles drop constraint if exists chk_profiles_domain_len;

-- Migrate existing text values to single-element arrays. No-op if already text[].
-- Uses pg_catalog (not information_schema) because information_schema.data_type is
-- unreliable for array detection inside Supabase's self-hosted environment.
do $$
begin
  if (
    select pg_catalog.format_type(a.atttypid, a.atttypmod)
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles'
      and a.attname = 'region' and not a.attisdropped
  ) = 'text' then
    alter table public.profiles
      alter column region type text[] using case when region is null or region = '' then null else array[region] end,
      alter column sector type text[] using case when sector is null or sector = '' then null else array[sector] end,
      alter column domain  type text[] using case when domain  is null or domain  = '' then null else array[domain]  end;
  end if;
end;
$$;

-- Array-aware length bounds (replaces the old scalar char_length checks). Caps element count
-- and total payload so a client posting straight to PostgREST can't stuff megabytes. CHECK
-- expressions can't use subqueries, so bound the joined string instead of per-element.
alter table public.profiles drop constraint if exists chk_profiles_region_arr;
alter table public.profiles add  constraint chk_profiles_region_arr
  check (region is null or (coalesce(array_length(region, 1), 0) <= 50 and char_length(array_to_string(region, ',')) <= 1000));
alter table public.profiles drop constraint if exists chk_profiles_sector_arr;
alter table public.profiles add  constraint chk_profiles_sector_arr
  check (sector is null or (coalesce(array_length(sector, 1), 0) <= 50 and char_length(array_to_string(sector, ',')) <= 1000));
alter table public.profiles drop constraint if exists chk_profiles_domain_arr;
alter table public.profiles add  constraint chk_profiles_domain_arr
  check (domain is null or (coalesce(array_length(domain, 1), 0) <= 50 and char_length(array_to_string(domain, ',')) <= 1000));

-- directory(): return text[] for region/sector/domain; filter = "has this value" (&&).
-- Drop both the legacy 5-arg form (old directory.sql) and the scalar 6-arg form (old
-- member_type.sql); this file is now the sole definer.
drop function if exists public.directory(text, text, text, text, text);
drop function if exists public.directory(text, text, text, text, text, text);
create function public.directory(
  p_search      text default null,
  p_region      text default null,
  p_sector      text default null,
  p_domain      text default null,
  p_role        text default null,
  p_member_type text default null
)
returns table (
  id uuid, name text, role text, member_types text[], startup text,
  region text[], sector text[], domain text[], linkedin text, bio text,
  pinned boolean, contactable boolean
)
language sql stable security definer set search_path = public
as $$
  select
    p.id, p.name, p.role, coalesce(p.member_types, '{}'), p.startup,
    coalesce(p.region, '{}'), coalesce(p.sector, '{}'), coalesce(p.domain, '{}'),
    p.linkedin, p.bio,
    coalesce(p.directory_pinned, false), coalesce(p.contactable, true)
  from public.profiles p
  where coalesce(p.banned, false) = false
    and coalesce(p.onboarded, false) = true
    and coalesce(p.directory_visible, true) = true
    and (p_role is null or p.role = p_role)
    and (p_member_type is null or p_member_type = any(p.member_types))
    and (p_region is null or p.region @> array[p_region])
    and (p_sector is null or p.sector @> array[p_sector])
    and (p_domain  is null or p.domain  @> array[p_domain])
    and (p_search is null or p_search = ''
         or p.name ilike '%' || p_search || '%'
         or coalesce(p.startup, '') ilike '%' || p_search || '%')
  order by coalesce(p.directory_pinned, false) desc, p.name
$$;
revoke execute on function public.directory(text, text, text, text, text, text) from anon, public;
grant  execute on function public.directory(text, text, text, text, text, text) to authenticated;

-- public_profile(): return text[] for region/sector/domain.
drop function if exists public.public_profile(uuid);
create function public.public_profile(p_user uuid)
returns table (
  id uuid, name text, role text, member_types text[], startup text,
  region text[], sector text[], domain text[],
  linkedin text, bio text, contactable boolean, directory_visible boolean,
  incubation_interest boolean, is_self boolean, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.role, coalesce(p.member_types, '{}'), p.startup,
         coalesce(p.region, '{}'), coalesce(p.sector, '{}'), coalesce(p.domain, '{}'),
         p.linkedin, p.bio,
         coalesce(p.contactable, true), coalesce(p.directory_visible, true),
         coalesce(p.incubation_interest, false), (p.id = auth.uid()), p.created_at
  from public.profiles p
  where p.id = p_user and coalesce(p.banned, false) = false
$$;
revoke execute on function public.public_profile(uuid) from anon, public;
grant  execute on function public.public_profile(uuid) to authenticated;

-- admin_get_profile(): return text[] for region/sector/domain.
drop function if exists public.admin_get_profile(uuid);
create function public.admin_get_profile(p_user uuid)
returns table (
  name text, phone text, bio text, startup text,
  region text[], sector text[], domain text[],
  linkedin text, incubation_interest boolean, member_types text[]
)
language sql stable security definer set search_path = public
as $$
  select p.name, p.phone, p.bio, p.startup,
         coalesce(p.region, '{}'), coalesce(p.sector, '{}'), coalesce(p.domain, '{}'),
         p.linkedin, p.incubation_interest, coalesce(p.member_types, '{}')
  from public.profiles p
  where public.is_admin() and p.id = p_user
$$;
revoke execute on function public.admin_get_profile(uuid) from anon, public;
grant  execute on function public.admin_get_profile(uuid) to authenticated;

-- admin_update_profile(): accept text[] for region/sector/domain.
drop function if exists public.admin_update_profile(uuid, text, text, text, text, text,  text,  text,  text, boolean, text[]);
drop function if exists public.admin_update_profile(uuid, text, text, text, text, text[], text[], text[], text, boolean, text[]);
create function public.admin_update_profile(
  p_user         uuid,
  p_name         text,
  p_phone        text,
  p_bio          text,
  p_startup      text,
  p_region       text[],
  p_sector       text[],
  p_domain       text[],
  p_linkedin     text,
  p_incubation   boolean,
  p_member_types text[] default '{}'
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;
  update public.profiles set
    name                = trim(p_name),
    phone               = nullif(trim(coalesce(p_phone, '')), ''),
    bio                 = nullif(trim(coalesce(p_bio, '')), ''),
    startup             = nullif(trim(coalesce(p_startup, '')), ''),
    region              = case when cardinality(p_region) > 0 then p_region else null end,
    sector              = case when cardinality(p_sector) > 0 then p_sector else null end,
    domain              = case when cardinality(p_domain)  > 0 then p_domain  else null end,
    linkedin            = nullif(trim(coalesce(p_linkedin, '')), ''),
    incubation_interest = coalesce(p_incubation, false),
    member_types        = coalesce(p_member_types, '{}'),
    member_type         = case when coalesce(array_length(p_member_types, 1), 0) > 0 then p_member_types[1] else null end
  where id = p_user;
end
$$;
revoke execute on function public.admin_update_profile(uuid, text, text, text, text, text[], text[], text[], text, boolean, text[]) from anon, public;
grant  execute on function public.admin_update_profile(uuid, text, text, text, text, text[], text[], text[], text, boolean, text[]) to authenticated;

-- mentor_queue(): pull-queue of unassigned G1 applications, filterable by sector; ideas that
-- overlap the mentor's own sectors float first, oldest first (fairness). Relocated here from
-- pipeline.sql because the mentor's profiles.sector is text[] after the migration above, so the
-- own-sector match uses array overlap (&&) instead of the old scalar `= any(...)`.
-- (p_sector stays a single text filter: `p_sector = any(i.sectors)` is text = element, fine.)
drop function if exists public.mentor_queue();
drop function if exists public.mentor_queue(text);
create function public.mentor_queue(p_sector text default null)
returns table (
  id uuid, ifn int, title text, sector text, sectors text[], problem text, target_user text,
  author_name text, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select i.id, i.ifn, i.title, i.sector, i.sectors, i.problem, i.application->>'target_user',
         a.name, i.created_at
  from public.pipeline_ideas i
  join public.profiles a on a.id = i.author_id
  where public.is_mentor_or_admin()
    and i.pipeline_state = 'active' and i.gate = 1 and i.mentor_id is null
    and (p_sector is null or p_sector = any(i.sectors))
  order by coalesce((select sector from public.profiles where id = auth.uid()) && i.sectors, false) desc,
           i.created_at asc
$$;
revoke execute on function public.mentor_queue(text) from anon, public;
grant  execute on function public.mentor_queue(text) to authenticated;
