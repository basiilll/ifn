-- Directory / Network (FRD Module K): browse + filter members. profiles RLS is read-own,
-- so the directory is exposed via a security-definer RPC. Phone and EMAIL are never exposed:
-- members reach each other through the send-contact relay (Edge Function), so no address ever
-- reaches the client. Members opt out of the directory (and thus being contacted) entirely via
-- directory_visible (on by default). Banned members are hidden. Run in Supabase.

-- directory preferences, controlled by the user in Settings:
alter table public.profiles add column if not exists show_email boolean not null default false; -- legacy, unused (emails are never displayed now)
alter table public.profiles add column if not exists directory_visible boolean not null default true;
-- "Let people contact you": opt out of the message relay. Default on; independent of being listed.
alter table public.profiles add column if not exists contactable boolean not null default true;

-- admin-only: pin a profile to the top of the directory (a network-wide highlight).
-- Revoked from authenticated so members cannot self-pin; only admin_set_directory_pinned writes it.
alter table public.profiles add column if not exists directory_pinned boolean not null default false;
revoke update (directory_pinned) on public.profiles from authenticated;

drop function if exists public.directory(text, text, text, text, text);
create function public.directory(
  p_search text default null,
  p_region text default null,
  p_sector text default null,
  p_domain text default null,
  p_role text default null
)
returns table (
  id uuid, name text, role text, startup text,
  region text, sector text, domain text, linkedin text, bio text, pinned boolean, contactable boolean
)
language sql stable security definer set search_path = public
as $$
  select
    p.id, p.name, p.role, p.startup, p.region, p.sector, p.domain, p.linkedin,
    p.bio, coalesce(p.directory_pinned, false), coalesce(p.contactable, true)
  from public.profiles p
  where coalesce(p.banned, false) = false
    and coalesce(p.directory_visible, true) = true
    and (p_role is null or p.role = p_role)
    and (p_region is null or p.region = p_region)
    and (p_sector is null or p.sector = p_sector)
    and (p_domain is null or p.domain = p_domain)
    and (p_search is null or p_search = ''
         or p.name ilike '%' || p_search || '%'
         or coalesce(p.startup, '') ilike '%' || p_search || '%')
  order by coalesce(p.directory_pinned, false) desc, p.name
$$;
grant execute on function public.directory(text, text, text, text, text) to authenticated;

-- admin pins/unpins a profile (network-wide top placement in the directory).
create or replace function public.admin_set_directory_pinned(p_user uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.profiles set directory_pinned = p_pinned where id = p_user;
end
$$;
grant execute on function public.admin_set_directory_pinned(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- Member-to-member contact relay. The site mediates first contact so no email is
-- ever exposed. contact_member enforces policy + rate limit + audit and returns
-- NOTHING sensitive; the send-contact Edge Function resolves addresses with the
-- service-role key (never reachable from a browser) and sends via Resend.

create table if not exists public.contact_log (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  subject      text,
  created_at   timestamptz not null default now()
);
create index if not exists contact_log_sender_day_idx on public.contact_log (sender_id, created_at);
alter table public.contact_log enable row level security;
-- no policies: only the definer RPC below writes it; the client never reads it.

-- Messages a member may send per rolling 24h (spam backstop).
create or replace function public.contact_daily_cap() returns int language sql immutable as $$ select 10 $$;

-- Gate a contact attempt: caller not banned, recipient reachable, not self, under
-- the daily cap. Logs the attempt. Raises a client-surfaceable message on each block.
-- Returns nothing sensitive (no email) so it is safe to be authenticated-callable.
create or replace function public.contact_member(p_to uuid, p_subject text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sent int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  perform public.write_guard();
  if p_to = v_uid then raise exception 'you cannot message yourself'; end if;
  if not exists (
    select 1 from public.profiles
     where id = p_to and coalesce(banned, false) = false
       and coalesce(directory_visible, true) = true and coalesce(contactable, true) = true
  ) then
    raise exception 'this member is not reachable';
  end if;
  select count(*) into v_sent from public.contact_log
   where sender_id = v_uid and created_at > now() - interval '24 hours';
  if v_sent >= public.contact_daily_cap() then
    raise exception 'daily message limit reached (% per day)', public.contact_daily_cap();
  end if;
  insert into public.contact_log (sender_id, recipient_id, subject)
  values (v_uid, p_to, nullif(trim(coalesce(p_subject, '')), ''));
end
$$;
grant execute on function public.contact_member(uuid, text) to authenticated;


-- A member's public profile (for the /u/:id page). profiles RLS is read-own, so this
-- definer RPC exposes the same public fields as the directory: never phone or email.
-- Banned members return no row (treated as not found). Works even if the member opted out
-- of the directory listing, since their name is already on any non-anonymous post they made.
create or replace function public.public_profile(p_user uuid)
returns table (
  id uuid, name text, role text, startup text, region text, sector text, domain text,
  linkedin text, bio text, contactable boolean, directory_visible boolean,
  incubation_interest boolean, is_self boolean, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.name, p.role, p.startup, p.region, p.sector, p.domain,
         p.linkedin, p.bio, coalesce(p.contactable, true), coalesce(p.directory_visible, true),
         coalesce(p.incubation_interest, false), (p.id = auth.uid()), p.created_at
  from public.profiles p
  where p.id = p_user and coalesce(p.banned, false) = false
$$;
grant execute on function public.public_profile(uuid) to authenticated;
