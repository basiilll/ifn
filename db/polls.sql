-- Polls: admin-created posts (posts.kind = 'poll') with options + one vote per member.
-- Default single-choice; admin can enable allow_multiple for multi-choice polls.
-- Results hidden until the viewer has voted at least once (client gates on i_voted).
-- Run in Supabase AFTER posts.sql, tags.sql, and admin.sql (needs is_admin()).

create table if not exists public.poll_options (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts(id) on delete cascade,
  idx        int  not null default 0,        -- display order
  label      text not null,
  created_at timestamptz not null default now()
);
create index if not exists poll_options_post_idx on public.poll_options (post_id);

-- One row per (poll, member, option). Single-choice polls delete existing votes before
-- inserting; multi-choice polls toggle individual options. PK includes option_id so
-- multi-choice can hold multiple rows per (post, user).
create table if not exists public.poll_votes (
  post_id    uuid not null references public.posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  option_id  uuid not null references public.poll_options(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, option_id)
);
create index if not exists poll_votes_option_idx on public.poll_votes (option_id);

-- Migrate existing installs: widen the PK from (post_id, user_id) to include option_id.
do $$
begin
  if not exists (
    select 1 from information_schema.key_column_usage
    where table_schema = 'public' and table_name = 'poll_votes'
      and column_name = 'option_id'
      and constraint_name in (
        select constraint_name from information_schema.table_constraints
        where table_schema = 'public' and table_name = 'poll_votes' and constraint_type = 'PRIMARY KEY'
      )
  ) then
    alter table public.poll_votes drop constraint if exists poll_votes_pkey;
    alter table public.poll_votes add primary key (post_id, user_id, option_id);
  end if;
end;
$$;

-- allow_multiple flag on posts (poll-level setting; non-poll posts ignore it).
alter table public.posts add column if not exists poll_allow_multiple boolean not null default false;

alter table public.poll_options enable row level security;
alter table public.poll_votes  enable row level security;
-- No policies on purpose: every read/write goes through the security-definer RPCs below,
-- so tallies stay server-controlled and "hide until voted" can't be bypassed by reading rows.


-- Create a poll (admin only). Stored as a post with kind='poll'; title = question,
-- problem = optional context. Options are 2..8 non-empty labels, kept in input order.
-- p_allow_multiple: if true, members may vote for more than one option.
drop function if exists public.create_poll(text, text, text[], text[]);
create or replace function public.create_poll(
  p_title          text,
  p_body           text,
  p_options        text[],
  p_tags           text[],
  p_allow_multiple boolean default false
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

  insert into public.posts (author_id, kind, title, problem, status, anonymous, poll_allow_multiple)
  values (v_uid, 'poll', trim(p_title), trim(coalesce(p_body, '')), 'published', false, coalesce(p_allow_multiple, false))
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
grant execute on function public.create_poll(text, text, text[], text[], boolean) to authenticated;


-- Cast / toggle a vote.
-- Single-choice: replaces any existing vote on this poll.
-- Multi-choice:  toggles this option (add if absent, remove if already chosen).
create or replace function public.poll_vote(p_post uuid, p_option uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_multi boolean;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  perform public.write_guard();
  if not exists (select 1 from public.poll_options where id = p_option and post_id = p_post) then
    raise exception 'invalid option';
  end if;
  select coalesce(poll_allow_multiple, false) into v_multi from public.posts where id = p_post;

  if v_multi then
    -- toggle: remove the vote if already cast, otherwise add it
    if exists (select 1 from public.poll_votes where post_id = p_post and user_id = v_uid and option_id = p_option) then
      delete from public.poll_votes where post_id = p_post and user_id = v_uid and option_id = p_option;
    else
      insert into public.poll_votes (post_id, user_id, option_id) values (p_post, v_uid, p_option);
    end if;
  else
    -- single choice: clear all votes for this poll then cast the new one
    delete from public.poll_votes where post_id = p_post and user_id = v_uid;
    insert into public.poll_votes (post_id, user_id, option_id) values (p_post, v_uid, p_option);
  end if;
end $$;
grant execute on function public.poll_vote(uuid, uuid) to authenticated;


-- Results: one row per option with its tally plus caller's choice and the poll's mode.
-- Client derives total = sum(votes) and i_voted = any(my_choice) to gate the bars.
-- allow_multiple is the same on every row; client reads options[0].allow_multiple.
drop function if exists public.poll_results(uuid);
create function public.poll_results(p_post uuid)
returns table (option_id uuid, label text, idx int, votes bigint, my_choice boolean, allow_multiple boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.label, o.idx,
         coalesce((select count(*) from public.poll_votes v where v.option_id = o.id), 0),
         exists (select 1 from public.poll_votes v where v.option_id = o.id and v.user_id = auth.uid()),
         coalesce(po.poll_allow_multiple, false)
  from public.poll_options o
  join public.posts po on po.id = o.post_id
  where o.post_id = p_post
  order by o.idx
$$;
grant execute on function public.poll_results(uuid) to authenticated;
