-- ============================================================================
-- IFN login-only: handy SQL commands
-- ----------------------------------------------------------------------------
-- Run these in Studio (http://localhost:8010 -> SQL Editor) or from a terminal
-- (see docs/docker-sql.md). Each block is independent, run the one you need.
-- Replace anything in CAPITALS before running.
-- ============================================================================


-- --- Make a user an admin (the first-admin bootstrap) -----------------------
-- After creating the user in Studio -> Authentication -> Add user (Auto Confirm),
-- copy their id and run this. onboarded skips the profile setup, and the
-- must_change_password = false lets them log straight in.
update public.profiles
set role = 'admin', onboarded = true, must_change_password = false
where id = 'PASTE-USER-ID-HERE';


-- --- Find a user's id by email ----------------------------------------------
select id, email, created_at
from auth.users
where lower(email) = lower('SOMEONE@EXAMPLE.COM');


-- --- See everyone and their role --------------------------------------------
select p.id, u.email, p.name, p.role, p.member_type, p.onboarded,
       p.must_change_password, p.banned, p.restricted
from public.profiles p
join auth.users u on u.id = p.id
order by u.created_at desc;


-- --- Clear the forced password change for one account -----------------------
-- (normally the user does this themselves on first login)
update public.profiles set must_change_password = false
where id = 'PASTE-USER-ID-HERE';


-- --- Change someone's role --------------------------------------------------
-- role is one of: student, mentor, admin
update public.profiles set role = 'mentor'
where id = 'PASTE-USER-ID-HERE';


-- --- Ban or unban a member (soft block, they stay logged in but cannot write)
update public.profiles set restricted = true,  restricted_reason = 'spam' where id = 'PASTE-USER-ID-HERE'; -- read-only
update public.profiles set restricted = false, restricted_reason = null   where id = 'PASTE-USER-ID-HERE'; -- lift it
-- full ban (cannot do anything):
update public.profiles set banned = true  where id = 'PASTE-USER-ID-HERE';
update public.profiles set banned = false where id = 'PASTE-USER-ID-HERE';


-- --- Lock or unlock posting (also available in Admin Panel -> Settings) ------
update public.app_settings set feed_locked = true;     -- stop members posting
update public.app_settings set feed_locked = false;    -- allow again
update public.app_settings set pipeline_locked = true; -- stop pipeline submissions
update public.app_settings set pipeline_locked = false;


-- --- Quick health checks ----------------------------------------------------
select count(*) as members from public.profiles;
select count(*) as auth_users from auth.users;
-- did the schema build fully? these should all return true:
select to_regprocedure('public.can_write(uuid)') is not null            as can_write_ok,
       exists(select 1 from information_schema.columns
              where table_name='profiles' and column_name='must_change_password') as must_change_ok,
       exists(select 1 from storage.buckets where id='idea-files')       as idea_files_bucket_ok;


-- --- Delete a user completely (auth + profile) ------------------------------
-- Careful, this is permanent. Deleting from auth.users cascades to profiles.
delete from auth.users where id = 'PASTE-USER-ID-HERE';
