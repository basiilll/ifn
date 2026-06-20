-- Replace problem_upvotes (toggle-only) with problem_votes (value: 1 | -1),
-- matching the post_votes pattern used on the feed page.

drop table if exists public.problem_upvotes cascade;
drop function if exists public.toggle_problem_upvote(uuid);

create table if not exists public.problem_votes (
  problem_id uuid not null references public.problems(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  value      smallint not null check (value in (1, -1)),
  created_at timestamptz not null default now(),
  primary key (problem_id, user_id)
);

alter table public.problem_votes enable row level security;

create policy "read votes" on public.problem_votes
  for select to authenticated using (true);

create policy "upsert own vote" on public.problem_votes
  for insert to authenticated with check (user_id = auth.uid());

create policy "update own vote" on public.problem_votes
  for update to authenticated using (user_id = auth.uid());

create policy "delete own vote" on public.problem_votes
  for delete to authenticated using (user_id = auth.uid());

-- Rebuild problem_feed with score + my_vote.
drop function if exists public.problem_feed(text);
create or replace function public.problem_feed(p_search text default null)
returns table (
  id             uuid,
  title          text,
  description    text,
  tags           text[],
  deadline       date,
  closed         boolean,
  author_id      uuid,
  author_name    text,
  created_at     timestamptz,
  solution_count bigint,
  i_solved       boolean,
  score          bigint,
  my_vote        smallint
)
language sql stable security definer set search_path = public
as $$
  select
    p.id,
    p.title,
    p.description,
    p.tags,
    p.deadline,
    coalesce(p.closed, false),
    p.author_id,
    pr.name,
    p.created_at,
    count(distinct ps.id),
    bool_or(ps.author_id = auth.uid()),
    coalesce(sum(pv.value), 0),
    max(case when pv.user_id = auth.uid() then pv.value end)
  from public.problems p
  join public.profiles pr on pr.id = p.author_id
  left join public.problem_solutions ps on ps.problem_id = p.id
  left join public.problem_votes pv on pv.problem_id = p.id
  where
    coalesce(p.closed, false) = false or p.author_id = auth.uid()
    and (
      p_search is null or p_search = ''
      or p.title ilike '%' || p_search || '%'
      or p.description ilike '%' || p_search || '%'
      or p.tags::text ilike '%' || p_search || '%'
    )
  group by p.id, pr.name
  order by p.created_at desc
$$;
grant execute on function public.problem_feed(text) to authenticated;

-- Rebuild problem_detail with score + my_vote.
drop function if exists public.problem_detail(uuid);
create or replace function public.problem_detail(p_id uuid)
returns table (
  id           uuid,
  title        text,
  description  text,
  tags         text[],
  deadline     date,
  closed       boolean,
  author_id    uuid,
  author_name  text,
  created_at   timestamptz,
  is_mine      boolean,
  score        bigint,
  my_vote      smallint
)
language sql stable security definer set search_path = public
as $$
  select
    p.id,
    p.title,
    p.description,
    p.tags,
    p.deadline,
    coalesce(p.closed, false),
    p.author_id,
    pr.name,
    p.created_at,
    p.author_id = auth.uid(),
    coalesce(sum(pv.value), 0),
    max(case when pv.user_id = auth.uid() then pv.value end)
  from public.problems p
  join public.profiles pr on pr.id = p.author_id
  left join public.problem_votes pv on pv.problem_id = p.id
  where p.id = p_id
  group by p.id, pr.name
$$;
grant execute on function public.problem_detail(uuid) to authenticated;
