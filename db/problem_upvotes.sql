-- problem_upvotes: "I face this" resonance signal on problems.
-- One row per (problem, user). Toggle via RPC. Count surfaced in
-- problem_feed and problem_detail.

create table if not exists public.problem_upvotes (
  problem_id uuid not null references public.problems(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (problem_id, user_id)
);

alter table public.problem_upvotes enable row level security;

-- anyone authenticated can read (needed for counts)
create policy "read upvotes" on public.problem_upvotes
  for select to authenticated using (true);

-- only insert/delete your own row
create policy "insert own upvote" on public.problem_upvotes
  for insert to authenticated with check (user_id = auth.uid());

create policy "delete own upvote" on public.problem_upvotes
  for delete to authenticated using (user_id = auth.uid());

-- toggle_problem_upvote: insert if absent, delete if present.
-- Returns the new upvote count for the problem.
create or replace function public.toggle_problem_upvote(p_problem uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_exists boolean;
  v_count  int;
begin
  select exists(
    select 1 from public.problem_upvotes
    where problem_id = p_problem and user_id = auth.uid()
  ) into v_exists;

  if v_exists then
    delete from public.problem_upvotes
    where problem_id = p_problem and user_id = auth.uid();
  else
    insert into public.problem_upvotes (problem_id, user_id)
    values (p_problem, auth.uid());
  end if;

  select count(*) into v_count
  from public.problem_upvotes where problem_id = p_problem;

  return v_count;
end;
$$;
grant execute on function public.toggle_problem_upvote(uuid) to authenticated;

-- Rebuild problem_feed to include upvote_count + i_upvoted.
-- Drop old signature first (arg list unchanged so drop by name is safe).
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
  upvote_count   bigint,
  i_upvoted      boolean
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
    count(distinct pu.user_id),
    bool_or(pu.user_id = auth.uid())
  from public.problems p
  join public.profiles pr on pr.id = p.author_id
  left join public.problem_solutions ps on ps.problem_id = p.id
  left join public.problem_upvotes pu on pu.problem_id = p.id
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

-- Rebuild problem_detail to include upvote_count + i_upvoted.
drop function if exists public.problem_detail(uuid);
create or replace function public.problem_detail(p_id uuid)
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
  is_mine        boolean,
  upvote_count   bigint,
  i_upvoted      boolean
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
    count(distinct pu.user_id),
    bool_or(pu.user_id = auth.uid())
  from public.problems p
  join public.profiles pr on pr.id = p.author_id
  left join public.problem_upvotes pu on pu.problem_id = p.id
  where p.id = p_id
  group by p.id, pr.name
$$;
grant execute on function public.problem_detail(uuid) to authenticated;
