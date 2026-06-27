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

-- directory() lives in db/multiselect_profile.sql now (array-aware 6-arg form, defined after
-- region/sector/domain become text[]). member_type.sql later added the p_member_type arg and
-- multiselect_profile.sql made the filters array-aware, so this older 5-arg scalar version is
-- fully superseded — defining it here only fails on a migrated DB (text[] = text).

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


-- public_profile() (the /u/:id page RPC) lives in db/multiselect_profile.sql now — it returns
-- region/sector/domain as text[] and adds member_types + email. The older scalar version that
-- was here is superseded; defining it here only fails on a migrated DB.
