-- post_votes: one up/down vote per user per post. score = sum(value). Run in Supabase.

create table if not exists public.post_votes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_votes_post_idx on public.post_votes (post_id);

alter table public.post_votes enable row level security;

-- A user manages only their own vote. Score/my_vote are computed by the feed RPC (definer),
-- so clients don't need to read others' votes.
drop policy if exists "post_votes read own" on public.post_votes;
create policy "post_votes read own" on public.post_votes
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "post_votes insert own" on public.post_votes;
create policy "post_votes insert own" on public.post_votes
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "post_votes update own" on public.post_votes;
create policy "post_votes update own" on public.post_votes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "post_votes delete own" on public.post_votes;
create policy "post_votes delete own" on public.post_votes
  for delete to authenticated using (user_id = auth.uid());
