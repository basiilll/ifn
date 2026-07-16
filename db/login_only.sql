-- LOGIN-ONLY FORK teardown + first-login password machinery.
-- Runs LAST. Two jobs:
--   1. Remove anything left from the self-registration flow (a DB cloned from the original
--      still has the request table / RPCs / cert bucket policy).
--   2. Add the forced first-login password change used with admin-created accounts.
-- Idempotent.

-- 1a. Drop the registration request queue, its admin read RPC, and the new-request notifier.
drop table if exists public.registration_requests cascade;
drop function if exists public.admin_list_registration_requests();
drop function if exists public.notify_admins_new_registration(text, text);

-- 1b. The registration-certs bucket is now unused (no cert uploads). Drop its read policy;
--     leave the (empty) bucket itself, since deleting a storage bucket needs its objects gone.
drop policy if exists "registration-certs admin read" on storage.objects;

-- 2. Forced password change on first login. The admin hands out a per-user temp password;
--    create-member sets this true, and set_password_changed() clears it after the user picks
--    a new password. must_change_password is deliberately NOT in the authenticated UPDATE
--    grant on profiles (see security_hardening.sql), so a user cannot flip it themselves.
alter table public.profiles add column if not exists must_change_password boolean not null default false;

create or replace function public.set_password_changed()
returns void
language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid()
$$;
grant execute on function public.set_password_changed() to authenticated;

-- 2b. Verify the caller's CURRENT password server-side (for the Settings "Old password"
--     field). GoTrue's captcha guards signInWithPassword, so we can't cheaply re-auth from
--     the client; instead compare the supplied password against the caller's own bcrypt hash
--     with pgcrypto. Self-only (auth.uid()), so this is not a vector against other accounts.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.verify_current_password(attempt text)
returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid()
      and encrypted_password is not null
      and encrypted_password = crypt(attempt, encrypted_password)
  )
$$;
grant execute on function public.verify_current_password(text) to authenticated;

-- 3. Normalize existing linkedin values to bare handles. The app now stores + renders only the
--    handle (https://www.linkedin.com/in/<handle>); a stored full URL or, worse, a non-LinkedIn
--    or javascript:/data: link was a phishing / stored-XSS vector on the directory.
update public.profiles
set linkedin = substring(linkedin from 'linkedin\.com/in/([^/?#]+)')
where linkedin is not null and linkedin ~* 'linkedin\.com/in/';

-- Drop anything left that is not a clean handle (had a non-LinkedIn or malformed value).
update public.profiles
set linkedin = null
where linkedin is not null and linkedin !~ '^[A-Za-z0-9-]{1,100}$';
