-- posts: unified feed (ideas + problems). Run in the Supabase SQL editor.
-- Tracked here so the schema is version-controlled even though it is applied by hand.

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('idea', 'problem', 'discussion', 'post', 'poll')),
  anonymous boolean not null default false,
  startup text,
  title text not null,
  problem text not null,
  solution text,                                   -- ideas only; problems leave null
  status text not null default 'published' check (status in ('draft', 'published')),
  pinned boolean not null default false,           -- admin only (see revoke below)
  comments_locked boolean not null default false,  -- admin only: turn comments off on a post
  badges text[] not null default '{}',             -- admin/system only
  success_request text not null default 'none'
    check (success_request in ('none', 'pending', 'approved', 'rejected')),
  edited boolean not null default false,
  edited_at timestamptz,
  original jsonb,                                   -- pre-edit snapshot {title, problem, solution}
  created_at timestamptz not null default now()
);

create index if not exists posts_feed_idx on public.posts (kind, status, created_at desc);
create index if not exists posts_author_idx on public.posts (author_id);
create index if not exists posts_pinned_idx on public.posts (pinned) where pinned;

-- migration: the feed collapsed to one generic 'post' kind (+ admin 'poll'); legacy
-- idea/problem/discussion rows stay valid and still render, just without a type chip.
alter table public.posts drop constraint if exists posts_kind_check;
alter table public.posts add constraint posts_kind_check check (kind in ('idea', 'problem', 'discussion', 'post', 'poll'));

alter table public.posts enable row level security;

-- READ: any authenticated user sees published posts; authors also see their own drafts.
drop policy if exists "posts read published or own" on public.posts;
create policy "posts read published or own" on public.posts
  for select to authenticated
  using (status = 'published' or author_id = auth.uid());

-- CREATE: only as yourself.
drop policy if exists "posts insert own" on public.posts;
create policy "posts insert own" on public.posts
  for insert to authenticated
  with check (author_id = auth.uid());

-- UPDATE / DELETE: author only for now (admin moderation comes in a later slice).
drop policy if exists "posts update own" on public.posts;
create policy "posts update own" on public.posts
  for update to authenticated using (author_id = auth.uid());

drop policy if exists "posts delete own" on public.posts;
create policy "posts delete own" on public.posts
  for delete to authenticated using (author_id = auth.uid());

-- Harden admin/system columns: a user must not be able to self-pin, self-award badges,
-- or fake the #Success state, and must not rewrite ownership/kind/timestamp.
revoke insert (pinned, badges, success_request) on public.posts from authenticated;
revoke update (pinned, comments_locked, badges, success_request, author_id, kind, created_at) on public.posts from authenticated;
