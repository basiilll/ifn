-- Idea Autopsy Library: post-mortems of failed ideas/startups (the /autopsy-library page
-- + the admin Autopsies tab). This table was originally created by hand in the Supabase
-- dashboard and never tracked here, so it was missing from the repo and from any fresh
-- self-host DB (the page errored locally with "table not found"). This file is the schema
-- reverse-engineered from the live cloud table, so local == prod. Idempotent.

create table if not exists public.idea_autopsies (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid,
  user_id          uuid,
  project_name     varchar not null,
  category         varchar not null,          -- sector
  domain           varchar not null,
  duration         varchar,
  total_investment varchar,
  root_cause       text not null,
  story            text,
  key_lessons      text not null,
  status           varchar default 'pending', -- pending | approved | rejected
  rejection_reason text,
  is_anonymous     boolean default false,
  created_at       timestamptz not null default timezone('utc', now())
);

-- Supabase default table grants; RLS below is the actual guard.
grant select, insert, update, delete on table public.idea_autopsies to anon, authenticated, service_role;

alter table public.idea_autopsies enable row level security;

-- Read: approved autopsies are visible to everyone; you can always see your own (any status).
drop policy if exists "Allow public read access to approved autopsies" on public.idea_autopsies;
create policy "Allow public read access to approved autopsies" on public.idea_autopsies
  for select to public
  using (status = 'approved');

drop policy if exists "Allow users to view their own autopsies regardless of status" on public.idea_autopsies;
create policy "Allow users to view their own autopsies regardless of status" on public.idea_autopsies
  for select to public
  using (auth.uid() = user_id);

-- Insert: only as yourself, only as 'pending' (no self-publish), and not while read-only/banned.
drop policy if exists "Allow authenticated users to insert autopsies" on public.idea_autopsies;
create policy "Allow authenticated users to insert autopsies" on public.idea_autopsies
  for insert to authenticated
  with check (auth.uid() = user_id and status = 'pending' and public.can_write(auth.uid()));

-- Delete your own.
drop policy if exists "Allow users to delete their own autopsies" on public.idea_autopsies;
create policy "Allow users to delete their own autopsies" on public.idea_autopsies
  for delete to authenticated
  using (auth.uid() = user_id);

-- Admins (or super_admins) can do anything: this is what powers approve / reject / delete
-- from the admin Autopsies tab.
drop policy if exists "Allow admins full management capabilities" on public.idea_autopsies;
create policy "Allow admins full management capabilities" on public.idea_autopsies
  for all to public
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and (profiles.role = 'admin' or profiles.role = 'super_admin')
  ));
