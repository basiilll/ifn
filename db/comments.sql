-- Post detail: comments (anyone) + sub_threads (creator-only progress updates) + RPCs that
-- join author names (masking anonymous post authors). Run in Supabase.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);

create table if not exists public.sub_threads (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists sub_threads_post_idx on public.sub_threads (post_id, created_at);

alter table public.comments enable row level security;
alter table public.sub_threads enable row level security;

-- comments: readable by authed; anyone can add their own; author deletes own.
drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments for select to authenticated using (true);
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments
  for insert to authenticated with check (
    author_id = auth.uid()
    and not exists (select 1 from public.posts p where p.id = post_id and p.comments_locked)
    and public.can_write(auth.uid())
  );
drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments
  for delete to authenticated using (author_id = auth.uid());

-- sub_threads (updates): readable by authed; ONLY the post's author may add; author deletes own.
drop policy if exists "sub_threads read" on public.sub_threads;
create policy "sub_threads read" on public.sub_threads for select to authenticated using (true);
drop policy if exists "sub_threads insert by post author" on public.sub_threads;
create policy "sub_threads insert by post author" on public.sub_threads
  for insert to authenticated
  with check (author_id = auth.uid()
              and auth.uid() = (select author_id from public.posts where id = post_id));
drop policy if exists "sub_threads delete own" on public.sub_threads;
create policy "sub_threads delete own" on public.sub_threads
  for delete to authenticated using (author_id = auth.uid());

-- One post with author masking + score + viewer vote + tags (own drafts also visible).
drop function if exists public.post_detail(uuid);
create function public.post_detail(p_id uuid)
returns table (
  id uuid, kind text, title text, problem text, solution text, startup text,
  anonymous boolean, badges text[], success_request text, pinned boolean,
  comments_locked boolean, edited boolean, created_at timestamptz,
  author_name text, author_role text, author_id uuid, is_mine boolean,
  tags text[], score bigint, my_vote int
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select auth.uid() as uid, (select role from public.profiles where id = auth.uid()) as role
  )
  select
    p.id, p.kind, p.title, p.problem, p.solution, p.startup,
    p.anonymous, p.badges, p.success_request, p.pinned, p.comments_locked, p.edited, p.created_at,
    case when p.anonymous and me.role is distinct from 'admin' and p.author_id <> me.uid then null else a.name end,
    case when p.anonymous and me.role is distinct from 'admin' and p.author_id <> me.uid then null else a.role end,
    case when p.anonymous and me.role is distinct from 'admin' and p.author_id <> me.uid then null else p.author_id end,
    (p.author_id = me.uid),
    coalesce((select array_agg(t.name order by t.name) from public.post_tags pt join public.tags t on t.id = pt.tag_id where pt.post_id = p.id and t.approved), '{}'),
    coalesce((select sum(v.value) from public.post_votes v where v.post_id = p.id), 0),
    (select v.value from public.post_votes v where v.post_id = p.id and v.user_id = me.uid)
  from public.posts p
  join public.profiles a on a.id = p.author_id
  cross join me
  where p.id = p_id and (p.status = 'published' or p.author_id = me.uid)
$$;
grant execute on function public.post_detail(uuid) to authenticated;

-- Comments with author name/role (comments are never anonymous).
drop function if exists public.post_comments(uuid);
create function public.post_comments(p_id uuid)
returns table (id uuid, body text, created_at timestamptz, author_name text, author_role text, author_id uuid, is_mine boolean)
language sql stable security definer set search_path = public
as $$
  select c.id, c.body, c.created_at, a.name, a.role, c.author_id, (c.author_id = auth.uid())
  from public.comments c
  join public.profiles a on a.id = c.author_id
  where c.post_id = p_id
  order by c.created_at asc
$$;
grant execute on function public.post_comments(uuid) to authenticated;

-- Creator updates; author name masked if the post is anonymous.
drop function if exists public.post_subthreads(uuid);
create function public.post_subthreads(p_id uuid)
returns table (id uuid, body text, created_at timestamptz, author_name text, is_mine boolean)
language sql stable security definer set search_path = public
as $$
  with me as (
    select auth.uid() as uid, (select role from public.profiles where id = auth.uid()) as role
  )
  select s.id, s.body, s.created_at,
    case when pp.anonymous and me.role is distinct from 'admin' and pp.author_id <> me.uid then null else a.name end,
    (s.author_id = me.uid)
  from public.sub_threads s
  join public.posts pp on pp.id = s.post_id
  join public.profiles a on a.id = s.author_id
  cross join me
  where s.post_id = p_id
  order by s.created_at asc
$$;
grant execute on function public.post_subthreads(uuid) to authenticated;
