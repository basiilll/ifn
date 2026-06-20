-- Calendar & Events (FRD Module I). Admin creates events; everyone sees them (broadcast).
-- Reads go straight through RLS; writes go through admin-guarded definer RPCs. The `source`
-- column lets the Idea Pipeline insert events later ('pipeline') without schema changes.
-- Run in Supabase.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  location text not null default '',
  type text not null default 'Other' check (type in ('Workshop', 'Mentorship', 'Deadline', 'Hackathon', 'Other')),
  starts_at timestamptz not null,
  ends_at timestamptz,                              -- null = point-in-time (e.g. a deadline)
  source text not null default 'manual',           -- 'manual' | 'pipeline' (future)
  source_id uuid,                                   -- optional link back to a pipeline idea
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists events_starts_idx on public.events (starts_at);

alter table public.events enable row level security;

-- Everyone authed reads events; writes happen only via the admin RPCs below.
drop policy if exists "events read" on public.events;
create policy "events read" on public.events for select to authenticated using (true);

create or replace function public.admin_create_event(
  p_title text, p_description text, p_location text, p_type text,
  p_starts_at timestamptz, p_ends_at timestamptz
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'title required'; end if;
  if p_starts_at is null then raise exception 'start time required'; end if;
  if p_ends_at is not null and p_ends_at < p_starts_at then raise exception 'end must be after start'; end if;
  insert into public.events (title, description, location, type, starts_at, ends_at, created_by)
  values (trim(p_title), coalesce(trim(p_description), ''), coalesce(trim(p_location), ''),
          coalesce(p_type, 'Other'), p_starts_at, p_ends_at, auth.uid())
  returning id into v_id;
  return v_id;
end
$$;
grant execute on function public.admin_create_event(text, text, text, text, timestamptz, timestamptz) to authenticated;

create or replace function public.admin_update_event(
  p_id uuid, p_title text, p_description text, p_location text, p_type text,
  p_starts_at timestamptz, p_ends_at timestamptz
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'title required'; end if;
  if p_ends_at is not null and p_ends_at < p_starts_at then raise exception 'end must be after start'; end if;
  update public.events set
    title = trim(p_title),
    description = coalesce(trim(p_description), ''),
    location = coalesce(trim(p_location), ''),
    type = coalesce(p_type, 'Other'),
    starts_at = p_starts_at,
    ends_at = p_ends_at
  where id = p_id;
end
$$;
grant execute on function public.admin_update_event(uuid, text, text, text, text, timestamptz, timestamptz) to authenticated;

create or replace function public.admin_delete_event(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  delete from public.events where id = p_id;
end
$$;
grant execute on function public.admin_delete_event(uuid) to authenticated;
