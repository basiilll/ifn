-- Admin layer: is_admin helper, member/role management, pin/unpin, moderation deletes,
-- and the #Success badge request/approval queue. All admin actions go through
-- security-definer RPCs guarded by is_admin() (no extra RLS policies needed).
-- Run in Supabase.

-- ---------------------------------------------------------------------------
-- BOOTSTRAP the first Super Admin (role changes need an existing admin).
-- Run once; safe to re-run.
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'basilambrosestevenson.bca24@ifheindia.org');

-- ---------------------------------------------------------------------------
-- Helper: is the caller a Super Admin? (security definer dodges profiles RLS)
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Ban support: a flag on the profile (so live sessions are blocked) + a banned_emails list
-- (so the address cannot re-register). Users cannot self-edit the flag.
alter table public.profiles add column if not exists banned boolean not null default false;
revoke update (banned) on public.profiles from authenticated;

create table if not exists public.banned_emails (
  email text primary key,                  -- stored lowercased
  reason text,
  created_at timestamptz not null default now()
);
alter table public.banned_emails enable row level security;  -- no policies: definer RPCs only

-- Block a banned address from signing up again (trigger on the auth table).
create or replace function public.block_banned_signup()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.banned_emails b where b.email = lower(new.email)) then
    raise exception 'This email is banned';
  end if;
  return new;
end
$$;
drop trigger if exists block_banned_signup on auth.users;
create trigger block_banned_signup before insert on auth.users
  for each row execute function public.block_banned_signup();

-- Members list (profiles RLS is read-own, so admins list members via RPC).
drop function if exists public.admin_members();
create function public.admin_members()
returns table (id uuid, email text, name text, role text, startup text, banned boolean, restricted boolean, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select p.id, u.email::text, p.name, p.role, p.startup, p.banned, coalesce(p.restricted, false), p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_admin()
  order by p.created_at
$$;
grant execute on function public.admin_members() to authenticated;

-- Read a member's full profile (for the admin edit form; profiles RLS is read-own).
drop function if exists public.admin_get_profile(uuid);
create function public.admin_get_profile(p_user uuid)
returns table (
  name text, phone text, bio text, startup text,
  region text, sector text, domain text, linkedin text, incubation_interest boolean
)
language sql stable security definer set search_path = public
as $$
  select p.name, p.phone, p.bio, p.startup, p.region, p.sector, p.domain, p.linkedin, p.incubation_interest
  from public.profiles p
  where public.is_admin() and p.id = p_user
$$;
grant execute on function public.admin_get_profile(uuid) to authenticated;

-- Edit any member's profile fields (role and banned have their own RPCs).
create or replace function public.admin_update_profile(
  p_user uuid, p_name text, p_phone text, p_bio text, p_startup text,
  p_region text, p_sector text, p_domain text, p_linkedin text, p_incubation boolean
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;
  update public.profiles set
    name = trim(p_name),
    phone = nullif(trim(coalesce(p_phone, '')), ''),
    bio = nullif(trim(coalesce(p_bio, '')), ''),
    startup = nullif(trim(coalesce(p_startup, '')), ''),
    region = nullif(trim(coalesce(p_region, '')), ''),
    sector = nullif(trim(coalesce(p_sector, '')), ''),
    domain = nullif(trim(coalesce(p_domain, '')), ''),
    linkedin = nullif(trim(coalesce(p_linkedin, '')), ''),
    incubation_interest = coalesce(p_incubation, false)
  where id = p_user;
end
$$;
grant execute on function public.admin_update_profile(uuid, text, text, text, text, text, text, text, text, boolean) to authenticated;

-- Ban a member: flag the profile + add the email to the banned list. Cannot ban yourself.
create or replace function public.admin_ban_user(p_user uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_email text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_user = auth.uid() then raise exception 'cannot ban yourself'; end if;
  select email into v_email from auth.users where id = p_user;
  if v_email is null then raise exception 'user not found'; end if;
  update public.profiles set banned = true where id = p_user;
  insert into public.banned_emails (email, reason) values (lower(v_email), p_reason)
    on conflict (email) do update set reason = excluded.reason;
end
$$;
grant execute on function public.admin_ban_user(uuid, text) to authenticated;

create or replace function public.admin_unban_user(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_email text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select email into v_email from auth.users where id = p_user;
  update public.profiles set banned = false where id = p_user;
  delete from public.banned_emails where email = lower(v_email);
end
$$;
grant execute on function public.admin_unban_user(uuid) to authenticated;

-- Assign a role (student / mentor / admin). Admins cannot change their own role
-- (prevents accidentally locking yourself out of the panel).
create or replace function public.admin_set_role(p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_role not in ('student', 'mentor', 'admin') then raise exception 'invalid role'; end if;
  if p_user = auth.uid() then raise exception 'cannot change your own role'; end if;
  update public.profiles set role = p_role where id = p_user;
end
$$;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Pin / unpin a post (FRD B7): pinned posts sit on top of the feed.
create or replace function public.admin_pin_post(p_id uuid, p_pinned boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.posts set pinned = p_pinned where id = p_id;
end
$$;
grant execute on function public.admin_pin_post(uuid, boolean) to authenticated;

-- Moderation deletes: any post / any comment.
create or replace function public.admin_delete_post(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  delete from public.posts where id = p_id;
end
$$;
grant execute on function public.admin_delete_post(uuid) to authenticated;

create or replace function public.admin_delete_comment(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  delete from public.comments where id = p_id;
end
$$;
grant execute on function public.admin_delete_comment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- #Success badge (FRD D4 + Module H): author requests, Super Admin approves.
-- posts.success_request: null | 'pending' | 'approved' | 'rejected'

-- Author asks for the badge on their own published post.
create or replace function public.request_success(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_post public.posts;
begin
  select * into v_post from public.posts where id = p_id;
  if not found then raise exception 'post not found'; end if;
  if v_post.author_id <> auth.uid() then raise exception 'not your post'; end if;
  if v_post.status <> 'published' then raise exception 'publish the post first'; end if;
  if v_post.success_request = 'approved' or 'Success' = any(coalesce(v_post.badges, '{}')) then
    raise exception 'already approved';
  end if;
  update public.posts set success_request = 'pending' where id = p_id;
end
$$;
grant execute on function public.request_success(uuid) to authenticated;

-- Admin queue: pending #Success requests.
drop function if exists public.admin_success_queue();
create function public.admin_success_queue()
returns table (id uuid, title text, author_name text, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select p.id, p.title, a.name, p.created_at
  from public.posts p
  join public.profiles a on a.id = p.author_id
  where public.is_admin() and p.success_request = 'pending'
  order by p.created_at
$$;
grant execute on function public.admin_success_queue() to authenticated;

-- Approve: badge lands on the post. Reject: request cleared.
create or replace function public.admin_review_success(p_id uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_author uuid; v_title text;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_approve then
    update public.posts set
      success_request = 'approved',
      badges = case when 'Success' = any(coalesce(badges, '{}')) then badges
                    else array_append(coalesce(badges, '{}'), 'Success') end
    where id = p_id and success_request = 'pending'
    returning author_id, title into v_author, v_title;
  else
    update public.posts set success_request = 'rejected'
    where id = p_id and success_request = 'pending'
    returning author_id, title into v_author, v_title;
  end if;
  -- v_author is set ONLY when a pending row actually changed, so re-running never re-notifies.
  if v_author is not null then
    perform public.notify(
      v_author,
      case when p_approve then 'success_approved' else 'success_rejected' end,
      null, auth.uid(), jsonb_build_object('post_id', p_id, 'title', v_title));
  end if;
end
$$;
grant execute on function public.admin_review_success(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Global app settings (single row). feed_locked: when on, only admins can create posts.
create table if not exists public.app_settings (
  id boolean primary key default true check (id),  -- enforces exactly one row
  feed_locked boolean not null default false
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;
alter table public.app_settings enable row level security;
drop policy if exists "settings read" on public.app_settings;
create policy "settings read" on public.app_settings for select to authenticated using (true);

create or replace function public.admin_set_feed_locked(p_locked boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.app_settings set feed_locked = p_locked where id;
end
$$;
grant execute on function public.admin_set_feed_locked(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Per-post comment lock: admin can turn comments off on a single post.
alter table public.posts add column if not exists comments_locked boolean not null default false;
revoke update (comments_locked) on public.posts from authenticated;  -- admins set it via RPC only

create or replace function public.admin_set_comments_locked(p_id uuid, p_locked boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.posts set comments_locked = p_locked where id = p_id;
end
$$;
grant execute on function public.admin_set_comments_locked(uuid, boolean) to authenticated;
