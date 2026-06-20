-- Feed querying. Full-text search index, feed_posts (sorts: hot/new/top/tag, search, tag filter,
-- pagination; returns author [masked], tags, score, viewer vote, comment count), plus trending_tags,
-- feed_tags (tags that have posts, for the filter dropdown), and posts_since (new-posts banner).
-- Run in Supabase.

alter table public.posts
  add column if not exists search_vec tsvector
  generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(problem, '') || ' ' ||
      coalesce(solution, '') || ' ' || coalesce(startup, ''))
  ) stored;
create index if not exists posts_search_idx on public.posts using gin (search_vec);

drop function if exists public.feed_posts(text);
drop function if exists public.feed_posts(text, text, text, text, int, int);
drop function if exists public.feed_posts(text, text, text[], text, int, int);
drop function if exists public.feed_posts(text, text, text[], text, int, int, uuid);
drop function if exists public.feed_posts(text, text, text[], text, int, int, uuid, int);

-- p_tags: filter to posts that have ALL of these supertags (AND). p_sort: 'hot' (default), 'new', 'top'.
-- p_author: when set, return ONLY that member's NON-anonymous posts (for their profile page;
-- anon posts are excluded so the profile can't de-anonymize them).
-- p_top_days: window for the 'top' sort (e.g. 7 = top of the last week); null = all time.
create function public.feed_posts(
  p_kind text default null,
  p_search text default null,
  p_tags text[] default null,
  p_sort text default 'hot',
  p_limit int default 20,
  p_offset int default 0,
  p_author uuid default null,
  p_top_days int default null
)
returns table (
  id uuid, kind text, title text, problem text, solution text, startup text,
  anonymous boolean, badges text[], success_request text, pinned boolean,
  edited boolean, created_at timestamptz,
  author_name text, author_role text, author_id uuid, is_mine boolean,
  tags text[], score bigint, my_vote int, comment_count bigint
)
language sql stable security definer set search_path = public
as $$
  with me as (
    select auth.uid() as uid, (select role from public.profiles where id = auth.uid()) as role
  )
  select
    p.id, p.kind, p.title, p.problem, p.solution, p.startup,
    p.anonymous, p.badges, p.success_request, p.pinned, p.edited, p.created_at,
    case when p.anonymous and me.role is distinct from 'admin' and p.author_id <> me.uid then null else a.name end,
    case when p.anonymous and me.role is distinct from 'admin' and p.author_id <> me.uid then null else a.role end,
    case when p.anonymous and me.role is distinct from 'admin' and p.author_id <> me.uid then null else p.author_id end,
    (p.author_id = me.uid),
    coalesce((select array_agg(t.name order by t.name) from public.post_tags pt join public.tags t on t.id = pt.tag_id where pt.post_id = p.id and t.approved), '{}'),
    coalesce((select sum(v.value) from public.post_votes v where v.post_id = p.id), 0),
    (select v.value from public.post_votes v where v.post_id = p.id and v.user_id = me.uid),
    coalesce((select count(*) from public.comments c where c.post_id = p.id), 0)
  from public.posts p
  join public.profiles a on a.id = p.author_id
  cross join me
  where p.status = 'published'
    and (p_author is null or (p.author_id = p_author and not p.anonymous))
    and (p_top_days is null or p.created_at > now() - make_interval(days => p_top_days))
    and (p_kind is null or p.kind = p_kind)
    and (p_search is null or p_search = '' or p.search_vec @@ websearch_to_tsquery('english', p_search))
    and (p_tags is null or p.id in (
      select pt.post_id from public.post_tags pt join public.tags t on t.id = pt.tag_id
      where t.approved and t.name = any(p_tags)
      group by pt.post_id
      having count(distinct t.name) = array_length(p_tags, 1)))
  order by
    p.pinned desc,
    case when p_sort = 'hot' then
      coalesce((select sum(v.value) from public.post_votes v where v.post_id = p.id), 0)::numeric
        / power((extract(epoch from (now() - p.created_at)) / 3600.0) + 2, 1.8)
    end desc nulls last,
    case when p_sort = 'top'
         then coalesce((select sum(v.value) from public.post_votes v where v.post_id = p.id), 0) end desc nulls last,
    case when p_sort = 'tag'
         then (select min(t.name) from public.post_tags pt join public.tags t on t.id = pt.tag_id
               where pt.post_id = p.id and t.approved) end asc nulls last,
    p.created_at desc,
    p.id
  limit greatest(1, least(p_limit, 50))
  offset greatest(0, p_offset)
$$;
grant execute on function public.feed_posts(text, text, text[], text, int, int, uuid, int) to authenticated;

-- trending_tags: top approved tags by published-post count over the last p_days days.
drop function if exists public.trending_tags(int, int);
create function public.trending_tags(p_days int default 7, p_limit int default 6)
returns table (name text, cnt bigint)
language sql stable security definer set search_path = public
as $$
  select t.name, count(*) as cnt
  from public.post_tags pt
  join public.tags t on t.id = pt.tag_id
  join public.posts p on p.id = pt.post_id
  where t.approved and p.status = 'published'
    and p.created_at > now() - make_interval(days => greatest(1, p_days))
  group by t.name
  order by cnt desc, t.name
  limit greatest(1, least(p_limit, 20))
$$;
grant execute on function public.trending_tags(int, int) to authenticated;

-- feed_tags: every approved tag that has at least one published post (for the filter dropdown).
drop function if exists public.feed_tags();
create function public.feed_tags()
returns table (name text, cnt bigint)
language sql stable security definer set search_path = public
as $$
  select t.name, count(*) as cnt
  from public.post_tags pt
  join public.tags t on t.id = pt.tag_id
  join public.posts p on p.id = pt.post_id
  where t.approved and p.status = 'published'
  group by t.name
  order by t.name
$$;
grant execute on function public.feed_tags() to authenticated;

-- posts_since: how many published posts are newer than a timestamp (for "X new posts" banner).
drop function if exists public.posts_since(timestamptz);
create function public.posts_since(p_since timestamptz)
returns bigint
language sql stable security definer set search_path = public
as $$
  select count(*) from public.posts where status = 'published' and created_at > p_since
$$;
grant execute on function public.posts_since(timestamptz) to authenticated;
