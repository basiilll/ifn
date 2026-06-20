-- Profiles: the base identity table, 1:1 with auth.users. THIS FILE RUNS FIRST — almost every
-- other db/*.sql depends on public.profiles and on the signup trigger existing.
--
-- Backfills the README TODO: the table + handle_new_user were created by hand in the Supabase
-- dashboard and were never version-controlled. Reconstructed from the live cloud schema
-- (project uyepkmdpakwkpqxsofoi, Postgres 17) on 2026-06-19 so a blank self-host DB can boot.
--
-- Scope = BASE only. Later files add their own columns/policies idempotently and own them:
--   banned (admin.sql) · show_email + directory_visible (directory.sql) · onboarded (onboarding.sql)
--   member_type (member_type.sql) · restricted/restricted_reason/contactable + can_write() and the
--   final "update own profile" policy (readonly.sql) · notification_prefs (notifications) ·
--   directory_pinned (directory.sql). The column-level REVOKEs that stop self-escalation also live
--   in those files. Keep this file minimal so the apply order stays acyclic. Run in Supabase / psql.

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  role        text not null default 'student' check (role in ('student', 'mentor', 'admin')),
  region      text,
  sector      text,
  domain      text,
  incubation_interest boolean not null default false,
  linkedin    text,
  phone       text,
  bio         text,
  startup     text,
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Read/update only your own row. anon/service_role grants match Supabase defaults (RLS is the guard;
-- service_role bypasses RLS server-side). Privilege columns are revoked from authenticated in the
-- later files that introduce them, so users can't self-escalate role/banned/etc.
grant all on table public.profiles to anon, authenticated, service_role;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

-- Base update policy. db/readonly.sql REPLACES this with the can_write() guard (drop + recreate),
-- so the final live shape adds the read-only/restricted check. Kept simple here to avoid depending
-- on can_write() before readonly.sql has run.
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- handle_new_user: on signup, create the profile row from the signup metadata. security definer so
-- it can insert under RLS; search_path pinned to public. Later signup triggers (block_banned_signup,
-- enforce_registration_policy in admin.sql/invites.sql) sort around this one by name.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
