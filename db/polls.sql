-- Polls: admin-created posts (posts.kind = 'poll') with options + one vote per member.
-- Single-choice; results are hidden until the member votes (the client gates on i_voted).
-- Run in Supabase AFTER posts.sql, tags.sql, and admin.sql (needs is_admin()).

create table if not exists public.poll_options (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  idx        int  not null default 0,        -- display order
  label      text not null,
  created_at timestamptz not null default now()
);
create index if not exists poll_options_post_idx on public.poll_options (post_id);

-- One row per (poll, member): single-choice. Changing your mind updates option_id.
create table if not exists public.poll_votes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  option_id  uuid not null references public.poll_options(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists poll_votes_option_idx on public.poll_votes (option_id);

alter table public.poll_options enable row level security;
alter table public.poll_votes  enable row level security;
-- No policies on purpose: every read/write goes through the security-definer RPCs below,
-- so tallies stay server-controlled and "hide until voted" can't be bypassed by reading rows.


-- Create a poll (admin only). Stored as a post with kind='poll'; title = question,
-- problem = optional context. Options are 2..8 non-empty labels, kept in input order.
create or replace function public.create_poll(
  p_title text,
  p_body text,
  p_options text[],
  p_tags text[]
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid;
  v_opt text;
  v_pos int := 0;
  v_count int := 0;
  v_tag text; v_norm text; v_tag_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public.is_admin() then raise exception 'only admins can create polls'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'question required'; end if;

  if p_options is not null then
    foreach v_opt in array p_options loop
      if coalesce(trim(v_opt), '') <> '' then v_count := v_count + 1; end if;
    end loop;
  end if;
  if v_count < 2 then raise exception 'a poll needs at least 2 options'; end if;
  if v_count > 8 then raise exception 'a poll allows at most 8 options'; end if;

  insert into public.posts (author_id, kind, title, problem, status, anonymous)
  values (v_uid, 'poll', trim(p_title), trim(coalesce(p_body, '')), 'published', false)
  returning id into v_post_id;

  foreach v_opt in array p_options loop
    if coalesce(trim(v_opt), '') = '' then continue; end if;
    insert into public.poll_options (post_id, idx, label) values (v_post_id, v_pos, trim(v_opt));
    v_pos := v_pos + 1;
  end loop;

  -- tags: same auto-approve logic as create_post
  if p_tags is not null then
    foreach v_tag in array p_tags loop
      v_norm := lower(trim(v_tag));
      if v_norm = '' or v_norm = 'success' then continue; end if;
      select id into v_tag_id from public.tags where name = v_norm;
      if v_tag_id is null then
        insert into public.tags (name, approved) values (v_norm, true) on conflict (name) do nothing;
        select id into v_tag_id from public.tags where name = v_norm;
      end if;
      insert into public.post_tags (post_id, tag_id) values (v_post_id, v_tag_id) on conflict do nothing;
    end loop;
  end if;

  return v_post_id;
end $$;
grant execute on function public.create_poll(text, text, text[], text[]) to authenticated;


-- Cast / change a vote (single choice). Re-voting moves your vote to the new option.
create or replace function public.poll_vote(p_post uuid, p_option uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  perform public.write_guard();
  if not exists (select 1 from public.poll_options where id = p_option and post_id = p_post) then
    raise exception 'invalid option';
  end if;
  insert into public.poll_votes (post_id, user_id, option_id)
  values (p_post, v_uid, p_option)
  on conflict (post_id, user_id) do update set option_id = excluded.option_id, created_at = now();
end $$;
grant execute on function public.poll_vote(uuid, uuid) to authenticated;


-- Results: one row per option with its tally, plus whether it is the caller's pick.
-- The client derives total = sum(votes) and i_voted = any(my_choice) to gate the bars.
create or replace function public.poll_results(p_post uuid)
returns table (option_id uuid, label text, idx int, votes bigint, my_choice boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.label, o.idx,
         coalesce((select count(*) from public.poll_votes v where v.option_id = o.id), 0),
         exists (select 1 from public.poll_votes v where v.option_id = o.id and v.user_id = auth.uid())
  from public.poll_options o
  where o.post_id = p_post
  order by o.idx
$$;
grant execute on function public.poll_results(uuid) to authenticated;
