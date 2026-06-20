-- tags + post_tags + tag_requests, and create_post (atomic post + tags + drafts). Run in Supabase.

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                -- stored lowercased
  approved boolean not null default false,  -- only approved tags are usable/trending
  created_at timestamptz not null default now()
);

create table if not exists public.post_tags (
  post_id uuid not null references public.posts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (post_id, tag_id)
);

create table if not exists public.tag_requests (
  id uuid primary key default gen_random_uuid(),
  tag text not null,
  post_id uuid references public.posts(id) on delete set null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- One-time: approve any tags that were created under the old unapproved default.
update public.tags set approved = true where not approved;

alter table public.tags enable row level security;
alter table public.post_tags enable row level security;
alter table public.tag_requests enable row level security;

-- tags: authed users read approved tags (suggestions, trending). Writes via RPC / admin only.
drop policy if exists "tags read approved" on public.tags;
create policy "tags read approved" on public.tags
  for select to authenticated using (approved);

-- post_tags: readable for joins. Writes happen via the create_post RPC (definer) only.
drop policy if exists "post_tags read" on public.post_tags;
create policy "post_tags read" on public.post_tags
  for select to authenticated using (true);

-- tag_requests: an author can read their own requests (admin queue comes later).
drop policy if exists "tag_requests read own" on public.tag_requests;
create policy "tag_requests read own" on public.tag_requests
  for select to authenticated using (author_id = auth.uid());

-- Atomic create: insert the post, link tags; a brand-new tag is created (auto-approved for now).
-- security definer so it can write tags/post_tags.
create or replace function public.create_post(
  p_kind text,
  p_title text,
  p_problem text,
  p_solution text,
  p_startup text,
  p_anonymous boolean,
  p_status text,
  p_tags text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid;
  v_tag text;
  v_norm text;
  v_tag_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  perform public.write_guard();
  -- 'post' is the generic kind used by the feed now; legacy kinds still accepted for old rows.
  -- 'poll' is intentionally excluded here: polls are admin-only via create_poll().
  if p_kind not in ('idea', 'problem', 'discussion', 'post') then raise exception 'invalid kind'; end if;
  -- global feed lock: only admins may post when feed_locked is on
  if coalesce((select feed_locked from public.app_settings where id), false)
     and (select role from public.profiles where id = v_uid) is distinct from 'admin' then
    raise exception 'posting is currently closed';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'title required'; end if;
  if coalesce(trim(p_problem), '') = '' then raise exception 'problem required'; end if;

  insert into public.posts (author_id, kind, title, problem, solution, startup, anonymous, status)
  values (
    v_uid, p_kind, trim(p_title), trim(p_problem),
    case when p_kind = 'idea' then nullif(trim(coalesce(p_solution, '')), '') else null end,
    nullif(trim(coalesce(p_startup, '')), ''),
    coalesce(p_anonymous, false),
    case when p_status = 'draft' then 'draft' else 'published' end
  )
  returning id into v_post_id;

  if p_tags is not null then
    foreach v_tag in array p_tags loop
      v_norm := lower(trim(v_tag));
      if v_norm = '' then continue; end if;
      if v_norm = 'success' then continue; end if; -- reserved: badge granted via admin approval only

      select id into v_tag_id from public.tags where name = v_norm;
      if v_tag_id is null then
        -- normal supertags are auto-approved; only #Success goes through the admin queue
        insert into public.tags (name, approved) values (v_norm, true)
          on conflict (name) do nothing;
        select id into v_tag_id from public.tags where name = v_norm;
      end if;

      insert into public.post_tags (post_id, tag_id) values (v_post_id, v_tag_id)
        on conflict do nothing;
    end loop;
  end if;

  return v_post_id;
end
$$;

grant execute on function public.create_post(text, text, text, text, text, boolean, text, text[]) to authenticated;

-- Edit own post: update text fields + reset tags atomically. Snapshots the first version into
-- posts.original (once), marks edited. Kind and anonymity are not editable.
create or replace function public.update_post(
  p_id uuid,
  p_title text,
  p_problem text,
  p_solution text,
  p_startup text,
  p_tags text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post public.posts;
  v_tag text;
  v_norm text;
  v_tag_id uuid;
begin
  select * into v_post from public.posts where id = p_id;
  if not found then raise exception 'post not found'; end if;
  if v_post.author_id <> v_uid then raise exception 'not your post'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'title required'; end if;
  if coalesce(trim(p_problem), '') = '' then raise exception 'problem required'; end if;

  -- drafts edit silently; only published posts get the edited mark + original snapshot
  update public.posts set
    title = trim(p_title),
    problem = trim(p_problem),
    solution = case when kind = 'idea' then nullif(trim(coalesce(p_solution, '')), '') else null end,
    startup = nullif(trim(coalesce(p_startup, '')), ''),
    edited = case when v_post.status = 'published' then true else edited end,
    edited_at = case when v_post.status = 'published' then now() else edited_at end,
    original = case when v_post.status = 'published' and original is null then jsonb_build_object(
        'title', v_post.title, 'problem', v_post.problem,
        'solution', v_post.solution, 'startup', v_post.startup
      ) else original end
  where id = p_id;

  -- reset tags to the new set (auto-approve new ones for now)
  delete from public.post_tags where post_id = p_id;
  if p_tags is not null then
    foreach v_tag in array p_tags loop
      v_norm := lower(trim(v_tag));
      if v_norm = '' then continue; end if;
      if v_norm = 'success' then continue; end if; -- reserved: badge granted via admin approval only
      select id into v_tag_id from public.tags where name = v_norm;
      if v_tag_id is null then
        insert into public.tags (name, approved) values (v_norm, true) on conflict (name) do nothing;
        select id into v_tag_id from public.tags where name = v_norm;
      end if;
      insert into public.post_tags (post_id, tag_id) values (p_id, v_tag_id) on conflict do nothing;
    end loop;
  end if;
end
$$;
grant execute on function public.update_post(uuid, text, text, text, text, text[]) to authenticated;

-- Publish own draft. Resets created_at so it enters the feed as a new post
-- (created_at is column-revoked for direct updates, hence the definer RPC).
create or replace function public.publish_post(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post public.posts;
begin
  select * into v_post from public.posts where id = p_id;
  if not found then raise exception 'post not found'; end if;
  if v_post.author_id <> v_uid then raise exception 'not your post'; end if;
  if v_post.status <> 'draft' then raise exception 'not a draft'; end if;
  update public.posts set status = 'published', created_at = now() where id = p_id;
end
$$;
grant execute on function public.publish_post(uuid) to authenticated;
