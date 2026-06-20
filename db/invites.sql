-- ============================================================================
-- Registration domain lock + admin invites (mentors / admins)
-- ----------------------------------------------------------------------------
-- Run this once in the Supabase SQL editor (or via `supabase db push`).
--
-- It is ADDITIVE: it does not modify the existing handle_new_user trigger
-- (which holds the ban-email logic). The pieces here run alongside it.
--
-- Policy enforced server-side:
--   * email ends in @ifheindia.org            -> allowed, role = student
--   * email has a live invite (pending+unexpired) -> allowed, role from invite
--   * anything else                           -> signup rejected
--
-- Role is decided ONLY by this server logic. The client never sets it.
-- ============================================================================

-- 0. The one place the allowed student domain is defined. Change here if needed.
create or replace function public.student_domain()
returns text language sql immutable as $$ select 'ifheindia.org'::text $$;


-- 1. Invites table -----------------------------------------------------------
create table if not exists public.invites (
  id          uuid        primary key default gen_random_uuid(),
  email       text        not null,
  role        text        not null check (role in ('student', 'mentor', 'admin')),
  token       text        not null unique default encode(gen_random_bytes(16), 'hex'),
  invited_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid        references auth.users(id) on delete set null
);

-- When the invite email was last sent (NULL = link shared manually, never emailed).
-- Stamped by the send-invites Edge Function via admin_mark_invites_sent().
alter table public.invites add column if not exists sent_at timestamptz;

-- At most one live (pending) invite per email. Accepted invites stay as history.
create unique index if not exists invites_one_live_per_email
  on public.invites (lower(email))
  where accepted_at is null;

-- Locked down: no RLS policies -> only SECURITY DEFINER functions (below) and
-- the service_role can read/write. The anon/authenticated client cannot.
alter table public.invites enable row level security;


-- 2. Is this email allowed to register? Returns the role to grant, or NULL. ---
create or replace function public.email_signup_role(p_email text)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
begin
  if lower(split_part(p_email, '@', 2)) = public.student_domain() then
    return 'student';
  end if;

  select role into v_role
    from public.invites
   where lower(email) = lower(p_email)
     and accepted_at is null
     and expires_at > now()
   order by created_at desc
   limit 1;

  return v_role;  -- NULL when no live invite
end $$;


-- 3. Registration gate REMOVED (2026-06-20). Any email may have an account. Account
--    creation goes entirely through the admin-approval flow: register-request files a
--    pending row, an admin approves, and review-registration / create-member create the
--    account with the service role. The old @ifheindia.org-only trigger + its function are
--    dropped on apply so they never block createUser. (Open public self-signup is closed
--    separately by GOTRUE_DISABLE_SIGNUP=true, so "every registration needs admin approval"
--    still holds.)
drop trigger if exists enforce_registration_policy on auth.users;
drop function if exists public.enforce_registration_policy();


-- 4. Apply the invited role + consume the invite. ----------------------------
-- We grant the role only once the email is CONFIRMED (real proof of ownership),
-- so a stray unconfirmed signup never silently burns an invite. We cover both
-- project configs: confirmation-on (UPDATE fires) and confirmation-off (the
-- INSERT already carries email_confirmed_at).
create or replace function public.consume_invite_for(p_uid uuid, p_email text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invites;
begin
  select * into v_inv
    from public.invites
   where lower(email) = lower(p_email)
     and accepted_at is null
     and expires_at > now()
   order by created_at desc
   limit 1;

  if found then
    update public.profiles set role = v_inv.role where id = p_uid;
    update public.invites
       set accepted_at = now(), accepted_by = p_uid
     where id = v_inv.id;
  end if;
end $$;

-- Name sorts after handle_new_user's trigger so the profiles row already exists.
create or replace function public.tg_invite_on_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null then
    perform public.consume_invite_for(new.id, new.email);
  end if;
  return null;
end $$;

drop trigger if exists zzz_invite_on_insert on auth.users;
create trigger zzz_invite_on_insert
  after insert on auth.users
  for each row execute function public.tg_invite_on_insert();

create or replace function public.tg_invite_on_confirm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    perform public.consume_invite_for(new.id, new.email);
  end if;
  return null;
end $$;

drop trigger if exists zzz_invite_on_confirm on auth.users;
create trigger zzz_invite_on_confirm
  after update of email_confirmed_at on auth.users
  for each row execute function public.tg_invite_on_confirm();


-- 5. Admin RPCs --------------------------------------------------------------
-- Bulk-create invites. Pass an array of emails; get back one row per valid,
-- de-duplicated email with its shareable token. Supersedes any pending invite
-- for the same address (re-inviting just refreshes the link + expiry).
create or replace function public.admin_create_invites(p_emails text[], p_role text)
returns table (email text, role text, token text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if p_role not in ('student', 'mentor', 'admin') then
    raise exception 'Invalid role';
  end if;

  -- DISTINCT collapses duplicates the caller may have pasted.
  for v_email in select distinct lower(trim(e)) from unnest(p_emails) as e loop
    continue when v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';

    -- re-inviting refreshes the link + expiry: drop any pending invite first
    delete from public.invites i where lower(i.email) = v_email and i.accepted_at is null;

    return query
      insert into public.invites (email, role, invited_by)
      values (v_email, p_role, auth.uid())
      returning invites.email, invites.role, invites.token, invites.expires_at;
  end loop;
end $$;

-- drop first: the return type gained sent_at, and create-or-replace cannot
-- change a function's signature (re-running this file is the fix for PGRST202).
drop function if exists public.admin_list_invites();
create or replace function public.admin_list_invites()
returns table (
  id uuid, email text, role text, token text, invited_by_name text,
  created_at timestamptz, expires_at timestamptz, accepted_at timestamptz,
  sent_at timestamptz, status text
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  return query
    select i.id, i.email, i.role, i.token, p.name,
           i.created_at, i.expires_at, i.accepted_at, i.sent_at,
           case
             when i.accepted_at is not null then 'accepted'
             when i.expires_at < now()      then 'expired'
             else 'pending'
           end
      from public.invites i
      left join public.profiles p on p.id = i.invited_by
     order by i.created_at desc;
end $$;

create or replace function public.admin_revoke_invite(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  delete from public.invites where id = p_id and accepted_at is null;
end $$;

-- Stamp delivery time after the send-invites Edge Function mails the links.
create or replace function public.admin_mark_invites_sent(p_tokens text[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.invites
     set sent_at = now()
   where token = any(p_tokens);
end $$;

-- Public (anon) lookup so the Register page can prefill + show the invited role.
-- The token is the secret; knowing it is what authorizes reading the email.
create or replace function public.invite_lookup(p_token text)
returns table (email text, role text, valid boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select i.email, i.role, (i.accepted_at is null and i.expires_at > now())
      from public.invites i
     where i.token = p_token
     limit 1;
end $$;


-- 6. Grants ------------------------------------------------------------------
grant execute on function public.admin_create_invites(text[], text) to authenticated;
grant execute on function public.admin_list_invites()                to authenticated;
grant execute on function public.admin_revoke_invite(uuid)           to authenticated;
grant execute on function public.admin_mark_invites_sent(text[])     to authenticated;
grant execute on function public.invite_lookup(text)                 to anon, authenticated;
