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

-- directory(), public_profile(), admin_get_profile() and admin_update_profile() are all defined
-- in db/multiselect_profile.sql now: they read region/sector/domain as text[] (which only exist
-- after that file's migration) and already carry the member_types surfaced here. The scalar
-- versions that used to live in this file are fully superseded and would only fail on a migrated
-- DB (text[] = text), so they were removed. This file just adds the member_types column.
