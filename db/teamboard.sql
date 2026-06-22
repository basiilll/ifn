-- Services board (formerly Team Acquisition): members post a service they can give (kind='offer')
-- or a service they need (kind='request'). Others respond with a message + contact; the poster
-- sees a list and reaches out. Responses are internal rows (no email is ever exposed); the poster
-- sees the responder's name/role/startup/LinkedIn. There is no in-app accept/reject. Run in Supabase.

create table if not exists public.team_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  startup text not null default '',
  description text not null default '',
  looking_for text not null default '',
  skills text[] not null default '{}',
  commitment text not null default '',
  stage text not null default '',
  closed boolean not null default false,         -- poster/admin closes a filled role
  created_at timestamptz not null default now()
);
create index if not exists team_posts_created_idx on public.team_posts (created_at desc);
-- migration for installs created before `closed` existed
alter table public.team_posts add column if not exists closed boolean not null default false;
-- Services board: discriminator + paid signal. Existing rows default to 'request' (a need).
--   offer   = a service the author can provide
--   request = a service the author needs (may be a paid gig)
alter table public.team_posts add column if not exists kind text not null default 'request';
alter table public.team_posts drop constraint if exists team_posts_kind_chk;
alter table public.team_posts add constraint team_posts_kind_chk check (kind in ('offer', 'request'));
alter table public.team_posts add column if not exists paid boolean not null default false;   -- requests only (UI)
alter table public.team_posts add column if not exists budget text not null default '';        -- optional amount when paid
create index if not exists team_posts_kind_created_idx on public.team_posts (kind, created_at desc);

create table if not exists public.team_applications (
  id uuid primary key default gen_random_uuid(),
  team_post_id uuid not null references public.team_posts(id) on delete cascade,
  applicant_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  contact text not null default '',              -- how the poster reaches the applicant (mandatory at apply time)
  status text not null default 'sent' check (status in ('sent', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  unique (team_post_id, applicant_id)            -- one application per person per post
);
create index if not exists team_applications_post_idx on public.team_applications (team_post_id);
-- migration for installs created before contact existed
alter table public.team_applications add column if not exists contact text not null default '';

alter table public.team_posts enable row level security;
alter table public.team_applications enable row level security;

-- team_posts: anyone authed reads; author creates/edits/deletes own (admin deletes via RPC).
drop policy if exists "team_posts read" on public.team_posts;
create policy "team_posts read" on public.team_posts for select to authenticated using (true);
drop policy if exists "team_posts insert own" on public.team_posts;
create policy "team_posts insert own" on public.team_posts
  for insert to authenticated with check (
    author_id = auth.uid()
    and public.can_write(auth.uid())
  );
drop policy if exists "team_posts update own" on public.team_posts;
create policy "team_posts update own" on public.team_posts
  for update to authenticated using (author_id = auth.uid());
drop policy if exists "team_posts delete own" on public.team_posts;
create policy "team_posts delete own" on public.team_posts
  for delete to authenticated using (author_id = auth.uid());

-- team_applications: applicant reads own; the post's author reads applications to their post.
-- Inserts go through team_apply() (definer); applicant may withdraw (delete own).
drop policy if exists "team_apps read" on public.team_applications;
create policy "team_apps read" on public.team_applications
  for select to authenticated using (
    applicant_id = auth.uid()
    or exists (select 1 from public.team_posts tp where tp.id = team_post_id and tp.author_id = auth.uid())
  );
drop policy if exists "team_apps delete own" on public.team_applications;
create policy "team_apps delete own" on public.team_applications
  for delete to authenticated using (applicant_id = auth.uid());

-- ---------------------------------------------------------------------------
-- team_feed: list posts with author (joined past profiles RLS) + application count +
-- whether the viewer already applied + whether it is the viewer's own post.
drop function if exists public.team_feed(text);
drop function if exists public.team_feed(text, text);
create function public.team_feed(p_search text default null, p_kind text default null)
returns table (
  id uuid, title text, startup text, description text, looking_for text,
  skills text[], commitment text, stage text, closed boolean, created_at timestamptz,
  kind text, paid boolean, budget text,
  author_id uuid, author_name text, author_role text,
  is_mine boolean, app_count bigint, i_applied boolean
)
language sql stable security definer set search_path = public
as $$
  select
    t.id, t.title, t.startup, t.description, t.looking_for,
    t.skills, t.commitment, t.stage, t.closed, t.created_at,
    t.kind, t.paid, t.budget,
    t.author_id, a.name, a.role,
    (t.author_id = auth.uid()),
    coalesce((select count(*) from public.team_applications ap where ap.team_post_id = t.id), 0),
    exists (select 1 from public.team_applications ap where ap.team_post_id = t.id and ap.applicant_id = auth.uid())
  from public.team_posts t
  join public.profiles a on a.id = t.author_id
  where (p_kind is null or t.kind = p_kind)
    and (p_search is null or p_search = '' or (
      t.title ilike '%' || p_search || '%'
      or t.startup ilike '%' || p_search || '%'
      or t.description ilike '%' || p_search || '%'
      or t.looking_for ilike '%' || p_search || '%'
      or exists (select 1 from unnest(t.skills) s where s ilike '%' || p_search || '%')
    ))
  order by t.created_at desc
$$;
grant execute on function public.team_feed(text, text) to authenticated;

-- Apply to a post with a message + contact info. Cannot apply to your own post; one per person.
drop function if exists public.team_apply(uuid, text);
create or replace function public.team_apply(p_post uuid, p_message text, p_contact text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
  v_closed boolean;
  v_title text;
  v_kind text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  perform public.write_guard();
  if coalesce(trim(p_message), '') = '' then raise exception 'message required'; end if;
  if coalesce(trim(p_contact), '') = '' then raise exception 'contact required'; end if;
  select author_id, closed, title, kind into v_author, v_closed, v_title, v_kind from public.team_posts where id = p_post;
  if v_author is null then raise exception 'post not found'; end if;
  if v_author = v_uid then raise exception 'cannot apply to your own post'; end if;
  if v_closed then raise exception 'this post is closed'; end if;

  insert into public.team_applications (team_post_id, applicant_id, message, contact)
  values (p_post, v_uid, trim(p_message), trim(p_contact))
  on conflict (team_post_id, applicant_id) do nothing;
  if not found then raise exception 'already applied'; end if;

  -- Tell the poster someone responded (honors their 'team' notification preference).
  perform public.notify(v_author, 'service_response', null, v_uid,
    jsonb_build_object('title', v_title, 'kind', v_kind));
end
$$;
grant execute on function public.team_apply(uuid, text, text) to authenticated;

-- Applicants for a post: only the post author or an admin may read; returns the applicant's
-- public profile (name/role/startup/LinkedIn) + message. The email is never returned.
drop function if exists public.team_applicants(uuid);
create function public.team_applicants(p_post uuid)
returns table (
  id uuid, message text, contact text, status text, created_at timestamptz,
  applicant_id uuid, applicant_name text, applicant_role text,
  applicant_startup text, applicant_linkedin text
)
language sql stable security definer set search_path = public
as $$
  select
    ap.id, ap.message, ap.contact, ap.status, ap.created_at,
    ap.applicant_id, p.name, p.role, p.startup, p.linkedin
  from public.team_applications ap
  join public.profiles p on p.id = ap.applicant_id
  where ap.team_post_id = p_post
    and (
      public.is_admin()
      or exists (select 1 from public.team_posts t where t.id = p_post and t.author_id = auth.uid())
    )
  order by ap.created_at desc
$$;
grant execute on function public.team_applicants(uuid) to authenticated;

-- Close / reopen a role (owner or admin). Closed roles cannot receive applications.
create or replace function public.set_team_closed(p_id uuid, p_closed boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.team_posts where id = p_id;
  if v_author is null then raise exception 'post not found'; end if;
  if v_author <> auth.uid() and not public.is_admin() then raise exception 'not allowed'; end if;
  update public.team_posts set closed = p_closed where id = p_id;
end
$$;
grant execute on function public.set_team_closed(uuid, boolean) to authenticated;

-- Admin moderation: delete any team post.
create or replace function public.admin_delete_team_post(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  delete from public.team_posts where id = p_id;
end
$$;
grant execute on function public.admin_delete_team_post(uuid) to authenticated;
