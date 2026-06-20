-- LOGIN-ONLY FORK: self-registration is removed, so the registration_requests TABLE and its
-- public/review flow are gone (db/login_only.sql drops any leftover from a cloned DB). What
-- survives here is the member_type descriptive label on profiles (member_type.sql + the
-- directory RPCs still read it) and the email_exists helper (admin add-member dup guard).
--
-- Apply: idempotent.

-- Descriptive label on profiles (NOT a permission role; role stays student/mentor/admin).
alter table public.profiles add column if not exists member_type text;

-- Does an auth account already exist for this email? (admin add-member duplicate guard,
-- called by the create-member edge function with the service role).
create or replace function public.email_exists(p_email text)
returns boolean
language sql security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users where lower(email) = lower(p_email))
$$;
grant execute on function public.email_exists(text) to service_role;
