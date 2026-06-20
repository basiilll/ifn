-- Problem Hub: members post real-world problems (title + description + domain tags +
-- optional deadline); the hub reads like the feed. Each problem has its own detail page
-- where any member can propose solutions in an open comment thread, visible to everyone.
-- Mentors/admins review individual solutions with impact and feasibility scores (1-10).
-- Requires db/admin.sql (is_admin), db/pipeline.sql (is_mentor_or_admin) and
-- db/notifications.sql (notify). Run in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- One-time cleanup of the earlier dashboard-created draft (old shape keyed by user_id with
-- solution_title/contact_email columns; the hub was unreleased, so dropping loses only
-- test data). Only fires when the old shape exists.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'problems' and column_name = 'user_id') then
    drop table if exists public.problem_solutions cascade;
    drop table if exists public.problems cascade;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Tables

create table if not exists public.problems (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null,
  tags text[] not null default '{}',
  deadline date,                                   -- optional "needed by"
  closed boolean not null default false,           -- poster/admin closes a solved problem
  created_at timestamptz not null default now()
);
create index if not exists problems_created_idx on public.problems (created_at desc);

-- Solutions are comment-style: one body of text per solution, any number per member,
-- threaded under the problem. title/course_context remain for rows created under the
-- earlier structured form (rendered when present).
create table if not exists public.problem_solutions (
  id uuid primary key default gen_random_uuid(),
  problem_id uuid not null references public.problems(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '',
  description text not null,
  course_context text not null default '',
  impact int check (impact between 1 and 10),      -- review columns, set only by review_solution
  feasibility int check (feasibility between 1 and 10),
  review_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists problem_solutions_problem_idx on public.problem_solutions (problem_id);

-- One solution per member per problem (editable, not multiple). Collapse any existing
-- duplicates (keep the most recent per author+problem), then enforce uniqueness.
alter table public.problem_solutions drop constraint if exists problem_solutions_problem_id_author_id_key;
delete from public.problem_solutions s using public.problem_solutions s2
  where s.problem_id = s2.problem_id and s.author_id = s2.author_id and s.id <> s2.id and s.created_at < s2.created_at;
alter table public.problem_solutions add constraint problem_solutions_problem_id_author_id_key unique (problem_id, author_id);
alter table public.problem_solutions alter column title set default '';

alter table public.problems enable row level security;
alter table public.problem_solutions enable row level security;

-- problems: any authed member reads; author creates (unless banned) / edits / deletes own.
-- Admin moderation goes through admin_delete_problem below.
drop policy if exists "problems read" on public.problems;
create policy "problems read" on public.problems for select to authenticated using (true);
drop policy if exists "problems insert own" on public.problems;
create policy "problems insert own" on public.problems
  for insert to authenticated with check (
    author_id = auth.uid()
    and public.can_write(auth.uid())
  );
drop policy if exists "problems update own" on public.problems;
create policy "problems update own" on public.problems
  for update to authenticated using (author_id = auth.uid());
drop policy if exists "problems delete own" on public.problems;
create policy "problems delete own" on public.problems
  for delete to authenticated using (author_id = auth.uid());
revoke update (author_id, created_at) on public.problems from authenticated;

-- problem_solutions: any authed member reads (the thread is community-visible); inserts go
-- through problem_solve() only (definer; no insert policy); author may delete own. Admin
-- moderation goes through admin_delete_solution below. The review columns are written only
-- by review_solution() (definer; no update policy).
drop policy if exists "solutions read" on public.problem_solutions;
create policy "solutions read" on public.problem_solutions for select to authenticated using (true);
drop policy if exists "solutions delete own" on public.problem_solutions;
create policy "solutions delete own" on public.problem_solutions
  for delete to authenticated using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- problem_feed: list problems with author (joined past profiles RLS) + solution count +
-- whether the viewer posted it / already proposed a solution.
drop function if exists public.problem_feed(text);
create function public.problem_feed(p_search text default null)
returns table (
  id uuid, title text, description text, tags text[], deadline date, closed boolean,
  created_at timestamptz, author_id uuid, author_name text, author_role text,
  is_mine boolean, solution_count bigint, i_solved boolean
)
language sql stable security definer set search_path = public
as $$
  select
    p.id, p.title, p.description, p.tags, p.deadline, p.closed, p.created_at,
    p.author_id, a.name, a.role,
    (p.author_id = auth.uid()),
    coalesce((select count(*) from public.problem_solutions s where s.problem_id = p.id), 0),
    exists (select 1 from public.problem_solutions s where s.problem_id = p.id and s.author_id = auth.uid())
  from public.problems p
  join public.profiles a on a.id = p.author_id
  where p_search is null or p_search = '' or (
    p.title ilike '%' || p_search || '%'
    or p.description ilike '%' || p_search || '%'
    or exists (select 1 from unnest(p.tags) t where t ilike '%' || p_search || '%')
  )
  order by p.closed asc, p.created_at desc
$$;
grant execute on function public.problem_feed(text) to authenticated;

-- ---------------------------------------------------------------------------
-- problem_detail: a single problem with its author, for the detail page.
drop function if exists public.problem_detail(uuid);
create function public.problem_detail(p_id uuid)
returns table (
  id uuid, title text, description text, tags text[], deadline date, closed boolean,
  created_at timestamptz, author_id uuid, author_name text, author_role text,
  is_mine boolean, solution_count bigint
)
language sql stable security definer set search_path = public
as $$
  select
    p.id, p.title, p.description, p.tags, p.deadline, p.closed, p.created_at,
    p.author_id, a.name, a.role,
    (p.author_id = auth.uid()),
    coalesce((select count(*) from public.problem_solutions s where s.problem_id = p.id), 0)
  from public.problems p
  join public.profiles a on a.id = p.author_id
  where p.id = p_id
$$;
grant execute on function public.problem_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Propose a solution (comment-style: a single body of text). Any member can reply,
-- including the problem's author; closed problems accept nothing. The problem's author
-- is notified on replies from others (payload carries the title + a body preview).
drop function if exists public.problem_solve(uuid, text, text, text);
drop function if exists public.problem_solve(uuid, text);
create function public.problem_solve(p_problem uuid, p_body text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.problems;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  perform public.write_guard();
  if coalesce(trim(p_body), '') = '' then raise exception 'body required'; end if;
  select * into v_p from public.problems where id = p_problem;
  if not found then raise exception 'problem not found'; end if;
  if v_p.closed then raise exception 'this problem is closed'; end if;
  if exists (select 1 from public.problem_solutions where problem_id = p_problem and author_id = v_uid) then
    raise exception 'you already proposed a solution; edit it instead';
  end if;

  insert into public.problem_solutions (problem_id, author_id, description)
  values (p_problem, v_uid, trim(p_body));

  if v_p.author_id <> v_uid then
    perform public.notify(v_p.author_id, 'problem_solution_received', null, v_uid,
      jsonb_build_object('title', v_p.title, 'solution', left(trim(p_body), 80)));
  end if;
end
$$;
grant execute on function public.problem_solve(uuid, text) to authenticated;

-- Edit your own solution. Editing CLEARS any prior mentor review (the score no longer
-- matches the new text), so the mentor re-scores.
create or replace function public.update_solution(p_solution uuid, p_body text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  perform public.write_guard();
  if coalesce(trim(p_body), '') = '' then raise exception 'body required'; end if;
  update public.problem_solutions
     set description = trim(p_body),
         impact = null, feasibility = null, review_note = null, reviewed_by = null, reviewed_at = null
   where id = p_solution and author_id = v_uid;
  if not found then raise exception 'not your solution'; end if;
end
$$;
grant execute on function public.update_solution(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Solutions for a problem, with the solver's public profile and the reviewer's name.
drop function if exists public.problem_solutions_list(uuid);
create function public.problem_solutions_list(p_problem uuid)
returns table (
  id uuid, title text, description text, course_context text,
  impact int, feasibility int, review_note text, reviewed_at timestamptz,
  reviewer_name text, created_at timestamptz,
  author_id uuid, author_name text, author_role text, author_startup text
)
language sql stable security definer set search_path = public
as $$
  select
    s.id, s.title, s.description, s.course_context,
    s.impact, s.feasibility, s.review_note, s.reviewed_at,
    r.name, s.created_at,
    s.author_id, a.name, a.role, a.startup
  from public.problem_solutions s
  join public.profiles a on a.id = s.author_id
  left join public.profiles r on r.id = s.reviewed_by
  where s.problem_id = p_problem
  order by s.created_at desc
$$;
grant execute on function public.problem_solutions_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Review a solution (mentor/admin): impact + feasibility 1-10, optional note.
-- Re-reviewing overwrites. The solver is notified with the scores in the payload.
drop function if exists public.review_solution(uuid, int, int, text);
create function public.review_solution(p_solution uuid, p_impact int, p_feasibility int, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_s public.problem_solutions;
  v_title text;
begin
  if not public.is_mentor_or_admin() then raise exception 'mentors and admins only'; end if;
  if p_impact not between 1 and 10 or p_feasibility not between 1 and 10 then
    raise exception 'scores must be between 1 and 10';
  end if;
  select * into v_s from public.problem_solutions where id = p_solution;
  if not found then raise exception 'solution not found'; end if;
  select title into v_title from public.problems where id = v_s.problem_id;

  update public.problem_solutions
  set impact = p_impact, feasibility = p_feasibility,
      review_note = nullif(trim(coalesce(p_note, '')), ''),
      reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_solution;

  perform public.notify(v_s.author_id, 'solution_reviewed', null, auth.uid(),
    jsonb_build_object('title', v_title, 'solution', coalesce(nullif(v_s.title, ''), left(v_s.description, 80)),
                       'impact', p_impact, 'feasibility', p_feasibility));
end
$$;
grant execute on function public.review_solution(uuid, int, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Close / reopen a problem (owner or admin). Closed problems accept no solutions.
create or replace function public.set_problem_closed(p_id uuid, p_closed boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_author uuid;
begin
  select author_id into v_author from public.problems where id = p_id;
  if v_author is null then raise exception 'problem not found'; end if;
  if v_author <> auth.uid() and not public.is_admin() then raise exception 'not allowed'; end if;
  update public.problems set closed = p_closed where id = p_id;
end
$$;
grant execute on function public.set_problem_closed(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin moderation: delete any problem (cascades its solutions) or any single solution.
create or replace function public.admin_delete_problem(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  delete from public.problems where id = p_id;
end
$$;
grant execute on function public.admin_delete_problem(uuid) to authenticated;

create or replace function public.admin_delete_solution(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  delete from public.problem_solutions where id = p_id;
end
$$;
grant execute on function public.admin_delete_solution(uuid) to authenticated;
