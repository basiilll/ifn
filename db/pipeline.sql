-- Idea Pipeline (PRD §4.6-4.8 + v1 Scope light entry). Design: ../pipeline-architecture.md.
-- The pipeline is STANDALONE: a founder files an application (title + one-liner + problem,
-- optionally pitch/startup) directly on the Pipeline page - nothing is taken from the feed.
-- The application gets an IFN-n number and moves through gates G1..G6. Heavy dossier
-- (basic details + files) arrives at G3, once a mentor is engaged (light entry).
-- All tables are default-deny RLS; every read/write goes through definer RPCs below.
-- Requires db/admin.sql (is_admin) and db/notifications.sql (notify). Run in Supabase.

-- ---------------------------------------------------------------------------
-- One-time cleanup of the earlier post-coupled draft schema (the pipeline was never
-- released, so dropping these loses only test data). Only fires when the old shapes exist.

drop trigger if exists notify_pipeline_post_edit on public.posts;
drop function if exists public.notify_pipeline_post_edit();
drop table if exists public.ideas_pipeline cascade;   -- old root (post_id PK); takes its
                                                      -- pipeline_waiting_on overload with it
do $$
begin
  -- old child tables were keyed by post_id; same names, wrong shape -> drop so the
  -- create-if-not-exists below builds the idea_id versions.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'idea_submissions' and column_name = 'post_id') then
    drop table if exists public.gate_transitions cascade;
    drop table if exists public.idea_submissions cascade;
    drop table if exists public.idea_reviews cascade;
    drop table if exists public.idea_actions cascade;
    drop table if exists public.idea_messages cascade;
    drop table if exists public.attachments cascade;
  end if;
end
$$;

-- old function signatures used p_post parameter names; create-or-replace cannot rename
-- parameters, so drop them (also makes this file safely re-runnable for the new versions).
-- (also drops superseded drafts of the application-era signatures)
drop function if exists public.pipeline_submit(text, text, text, text, text);
drop function if exists public.pipeline_submit(text, text, text, text, text, jsonb);
drop function if exists public.update_pipeline_idea(uuid, text, text, text, text, text);
drop function if exists public.update_pipeline_idea(uuid, text, text, text, text, text, jsonb);
drop function if exists public.check_application(text, text, text, text, jsonb);
drop function if exists public.admin_pipeline_board(int, text, uuid, text, text, int, int, int);
drop function if exists public.pipeline_submit(uuid, text);
drop function if exists public.submit_gate(uuid, jsonb);
drop function if exists public.resubmit_idea(uuid);
drop function if exists public.action_done(uuid, text);
drop function if exists public.idea_message_send(uuid, text, text);
drop function if exists public.register_attachment(uuid, int, text, text, bigint, text);
drop function if exists public.idea_dossier(uuid);
drop function if exists public.mentor_pick(uuid);
drop function if exists public.mentor_accept(uuid);
drop function if exists public.review_gate(uuid, jsonb, jsonb, text, text);
drop function if exists public.action_create(uuid, text, text, date);
drop function if exists public.admin_assign_mentor(uuid, uuid, text);
drop function if exists public.admin_bulk_assign(uuid[], uuid, text);
drop function if exists public.admin_move_gate(uuid, int, text);
drop function if exists public.admin_reject_idea(uuid, boolean, text);
drop function if exists public.admin_delete_pipeline_idea(uuid);  -- reason-less draft
-- the storage policies depend on can_access_idea; drop them first (recreated at the bottom)
drop policy if exists "idea files read" on storage.objects;
drop policy if exists "idea files insert" on storage.objects;
drop policy if exists "idea files delete own" on storage.objects;
drop function if exists public.can_access_idea(uuid);
drop function if exists public.log_transition(uuid, int, int, text, text, text, text);

-- ---------------------------------------------------------------------------
-- Tables

create table if not exists public.pipeline_ideas (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  ifn int not null unique,
  title text not null,
  oneliner text not null,
  problem text not null,
  solution text,                                   -- optional pitch at entry
  startup text,
  gate int not null default 1 check (gate between 1 and 6),
  gate_status text not null default 'submitted'
    check (gate_status in ('awaiting_submission', 'submitted', 'revision_requested', 'approved')),
  pipeline_state text not null default 'active'
    check (pipeline_state in ('active', 'refine', 'rejected')),
  mentor_id uuid references public.profiles(id) on delete set null,
  entered_gate_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists pipeline_ideas_gate_idx on public.pipeline_ideas (gate, pipeline_state);
create index if not exists pipeline_ideas_mentor_idx on public.pipeline_ideas (mentor_id);
create index if not exists pipeline_ideas_author_idx on public.pipeline_ideas (author_id);

-- The structured application (target_user, team, traction, market_size). Fixed-shape form,
-- read whole; required keys enforced in check_application below (no length minimums - the
-- structure and concrete prompts carry the clarity, owner decision 2026-06-10).
alter table public.pipeline_ideas add column if not exists application jsonb not null default '{}';
-- sector drives the mentor-queue and admin-board filters
alter table public.pipeline_ideas add column if not exists sector text;
create index if not exists pipeline_ideas_sector_idx on public.pipeline_ideas (sector);
-- an idea can span multiple sectors. `sectors` is the real list; `sector` stays as the
-- primary (sectors[1]) so legacy single-sector reads (list chips, queue sort) keep working.
-- Filters check membership in `sectors` (a sector matches if it's any of the idea's sectors).
alter table public.pipeline_ideas add column if not exists sectors text[] not null default '{}';
create index if not exists pipeline_ideas_sectors_idx on public.pipeline_ideas using gin (sectors);
update public.pipeline_ideas set sectors = array[sector]
  where sector is not null and cardinality(sectors) = 0;
-- the one-liner was replaced by the structured form; keep the column for old rows only
alter table public.pipeline_ideas alter column oneliner drop not null;

create table if not exists public.gate_transitions (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.pipeline_ideas(id) on delete cascade,
  from_gate int, to_gate int,
  from_state text, to_state text,
  changed_by uuid references public.profiles(id) on delete set null,
  role text not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists gate_transitions_idea_idx on public.gate_transitions (idea_id, created_at);

create table if not exists public.idea_submissions (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.pipeline_ideas(id) on delete cascade,
  gate int not null,
  payload jsonb not null,
  status text not null default 'submitted'
    check (status in ('submitted', 'revision_requested', 'approved', 'superseded')),
  created_at timestamptz not null default now()
);
create index if not exists idea_submissions_idea_idx on public.idea_submissions (idea_id, gate, created_at);

create table if not exists public.idea_reviews (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.pipeline_ideas(id) on delete cascade,
  gate int not null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  criteria jsonb not null,
  feasibility jsonb,
  feedback text not null,
  decision text not null check (decision in ('approved', 'revision')),
  created_at timestamptz not null default now()
);
create index if not exists idea_reviews_idea_idx on public.idea_reviews (idea_id, created_at);

create table if not exists public.idea_actions (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.pipeline_ideas(id) on delete cascade,
  gate int,
  label text not null,
  details text not null default '',
  due_date date,
  status text not null default 'open' check (status in ('open', 'done')),
  done_note text,
  done_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idea_actions_idea_idx on public.idea_actions (idea_id, created_at);

create table if not exists public.idea_messages (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.pipeline_ideas(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  kind text not null default 'message' check (kind in ('message', 'meeting', 'system')),
  created_at timestamptz not null default now()
);
create index if not exists idea_messages_idea_idx on public.idea_messages (idea_id, created_at);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references public.pipeline_ideas(id) on delete cascade,
  submission_id uuid references public.idea_submissions(id) on delete set null,
  gate int,
  bucket_path text not null,
  file_name text not null,
  size_bytes bigint not null,
  mime text not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists attachments_idea_idx on public.attachments (idea_id, created_at);

-- default-deny: no policies on any pipeline table; definer RPCs are the only door.
alter table public.pipeline_ideas enable row level security;
alter table public.gate_transitions enable row level security;
alter table public.idea_submissions enable row level security;
alter table public.idea_reviews enable row level security;
alter table public.idea_actions enable row level security;
alter table public.idea_messages enable row level security;
alter table public.attachments enable row level security;

-- notifications.idea_id gets its FK now that pipeline_ideas exists
-- (purge rows pointing at the dropped draft schema first, or the constraint fails)
delete from public.notifications n
where n.idea_id is not null
  and not exists (select 1 from public.pipeline_ideas i where i.id = n.idea_id);
alter table public.notifications drop constraint if exists notifications_idea_fk;
alter table public.notifications add constraint notifications_idea_fk
  foreign key (idea_id) references public.pipeline_ideas(id) on delete cascade;

-- global pipeline lock lives on the existing singleton settings row
alter table public.app_settings add column if not exists pipeline_locked boolean not null default false;
-- Feature flag: when on, founders may add a "Request IIEC for funds" note to a G5 submission.
alter table public.app_settings add column if not exists iiec_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- Helpers

create or replace function public.is_mentor_or_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('mentor', 'admin'))
$$;
grant execute on function public.is_mentor_or_admin() to authenticated;

-- author, assigned mentor, or admin. Used by RPCs and the Storage policies.
create or replace function public.can_access_idea(p_idea uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_idea is not null and exists (
    select 1 from public.pipeline_ideas i
    where i.id = p_idea
      and (i.author_id = auth.uid() or i.mentor_id = auth.uid() or public.is_admin())
  )
$$;
grant execute on function public.can_access_idea(uuid) to authenticated;

-- Author-only check for the Storage upload policy. Must be security definer: storage
-- policies run as the requesting user, and pipeline_ideas is default-deny RLS, so an
-- inline EXISTS there would always be false.
create or replace function public.is_idea_author(p_idea uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_idea is not null and exists (
    select 1 from public.pipeline_ideas i where i.id = p_idea and i.author_id = auth.uid()
  )
$$;
grant execute on function public.is_idea_author(uuid) to authenticated;

-- safe uuid from a storage object path '{idea_id}/...' (null when malformed)
create or replace function public.idea_path_uuid(p_name text)
returns uuid
language plpgsql immutable
as $$
begin
  return (split_part(p_name, '/', 1))::uuid;
exception when others then
  return null;
end
$$;
grant execute on function public.idea_path_uuid(text) to authenticated;

-- Whose turn is it? Single source of truth for every list/detail RPC.
-- 'student' | 'mentor' | 'mentor-pool' | 'admin' | 'none'
create or replace function public.pipeline_waiting_on(p public.pipeline_ideas)
returns text
language sql stable
as $$
  select case
    when p.pipeline_state = 'rejected' then 'none'
    when p.pipeline_state = 'refine' then 'student'
    when p.gate = 1 and p.mentor_id is null then 'mentor-pool'
    when p.mentor_id is null then 'admin'                         -- unassigned mid-pipeline
    when p.gate = 2 then 'mentor'                                 -- accept pending
    when p.gate_status = 'submitted' then 'mentor'
    when p.gate_status in ('awaiting_submission', 'revision_requested') then 'student'
    else 'none'                                                   -- 'approved' (G6 terminal)
  end
$$;
grant execute on function public.pipeline_waiting_on(public.pipeline_ideas) to authenticated;

-- transition logger (internal)
create or replace function public.log_transition(
  p_idea uuid, p_from_gate int, p_to_gate int, p_from_state text, p_to_state text,
  p_role text, p_reason text
) returns void
language sql security definer set search_path = public
as $$
  insert into public.gate_transitions (idea_id, from_gate, to_gate, from_state, to_state, changed_by, role, reason)
  values (p_idea, p_from_gate, p_to_gate, p_from_state, p_to_state, auth.uid(), p_role, p_reason)
$$;
revoke execute on function public.log_transition(uuid, int, int, text, text, text, text) from public, authenticated;

-- Bell feed (lives here, not in notifications.sql, because it joins pipeline_ideas).
drop function if exists public.my_notifications(int);
create function public.my_notifications(p_limit int default 30)
returns table (
  id uuid, kind text, idea_id uuid, idea_title text,
  actor_name text, payload jsonb, read_at timestamptz, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select n.id, n.kind, n.idea_id, i.title, a.name, n.payload, n.read_at, n.created_at
  from public.notifications n
  left join public.pipeline_ideas i on i.id = n.idea_id
  left join public.profiles a on a.id = n.actor_id
  where n.user_id = auth.uid()
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100))
$$;
grant execute on function public.my_notifications(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Student RPCs

-- The application contract: required fields + 500-char caps on the long answers. No length
-- minimums - the structured questions and concrete prompts carry the clarity. Enforced HERE
-- so the form cannot be bypassed.
drop function if exists public.check_application(text, text, text, text, jsonb);
create or replace function public.check_application(
  p_title text, p_sectors text[], p_problem text, p_solution text, p_application jsonb
) returns void
language plpgsql immutable
as $$
declare s text; n int := 0;
begin
  if coalesce(trim(p_title), '') = '' then raise exception 'startup / concept title required'; end if;
  if p_sectors is not null then
    foreach s in array p_sectors loop
      if coalesce(trim(s), '') <> '' then
        n := n + 1;
        if char_length(trim(s)) > 40 then raise exception 'sector name too long (max 40 characters)'; end if;
      end if;
    end loop;
  end if;
  if n = 0 then raise exception 'at least one sector required'; end if;
  if n > 6 then raise exception 'at most 6 sectors'; end if;
  if coalesce(trim(p_problem), '') = '' or char_length(trim(p_problem)) > 500 then
    raise exception 'problem hypothesis required (max 500 characters)';
  end if;
  if coalesce(trim(p_solution), '') = '' or char_length(trim(p_solution)) > 500 then
    raise exception 'proposed solution required (max 500 characters)';
  end if;
  if p_application is null or pg_column_size(p_application) > 20000 then
    raise exception 'invalid application';
  end if;
  if coalesce(trim(p_application->>'target_user'), '') = '' then
    raise exception 'target market segments required';
  end if;
  if coalesce(trim(p_application->>'team'), '') = '' then
    raise exception 'team composition required';
  end if;
end
$$;
revoke execute on function public.check_application(text, text[], text, text, jsonb) from public, authenticated;

-- File a pipeline application (the structured G1 form).
drop function if exists public.pipeline_submit(text, text, text, text, jsonb);
drop function if exists public.pipeline_submit(text, text[], text, text, jsonb);
create function public.pipeline_submit(
  p_title text, p_sectors text[], p_problem text, p_solution text, p_application jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ifn int;
  v_id uuid;
  v_sectors text[];
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  perform public.write_guard();
  if coalesce((select pipeline_locked from public.app_settings where id), false) and not public.is_admin() then
    raise exception 'pipeline submissions are currently closed';
  end if;
  perform public.check_application(p_title, p_sectors, p_problem, p_solution, p_application);
  v_sectors := (select array_agg(distinct trim(x)) from unnest(p_sectors) x where coalesce(trim(x), '') <> '');

  perform pg_advisory_xact_lock(hashtext('ifn_counter'));
  select coalesce(max(ifn), 0) + 1 into v_ifn from public.pipeline_ideas;

  insert into public.pipeline_ideas (author_id, ifn, title, sector, sectors, problem, solution, application)
  values (v_uid, v_ifn, trim(p_title), v_sectors[1], v_sectors, trim(p_problem), trim(p_solution),
          jsonb_build_object(
            'target_user', trim(p_application->>'target_user'),
            'team', trim(p_application->>'team'),
            'traction', nullif(trim(coalesce(p_application->>'traction', '')), ''),
            'market_size', nullif(trim(coalesce(p_application->>'market_size', '')), '')))
  returning id into v_id;
  perform public.log_transition(v_id, null, 1, null, 'active', 'student', null);
  return v_id;
end
$$;
grant execute on function public.pipeline_submit(text, text[], text, text, jsonb) to authenticated;

-- Edit the application: only before a mentor is engaged (G1) or when sent back to refine.
drop function if exists public.update_pipeline_idea(uuid, text, text, text, text, jsonb);
drop function if exists public.update_pipeline_idea(uuid, text, text[], text, text, jsonb);
create function public.update_pipeline_idea(
  p_idea uuid, p_title text, p_sectors text[], p_problem text, p_solution text, p_application jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_i public.pipeline_ideas;
  v_sectors text[];
begin
  select * into v_i from public.pipeline_ideas where id = p_idea;
  if not found then raise exception 'application not found'; end if;
  if v_i.author_id <> v_uid then raise exception 'not your application'; end if;
  if not (v_i.pipeline_state = 'refine' or (v_i.pipeline_state = 'active' and v_i.gate = 1)) then
    raise exception 'the application can only be edited at G1 or during refine';
  end if;
  perform public.check_application(p_title, p_sectors, p_problem, p_solution, p_application);
  v_sectors := (select array_agg(distinct trim(x)) from unnest(p_sectors) x where coalesce(trim(x), '') <> '');
  update public.pipeline_ideas set
    title = trim(p_title),
    sector = v_sectors[1],
    sectors = v_sectors,
    problem = trim(p_problem),
    solution = trim(p_solution),
    application = jsonb_build_object(
      'target_user', trim(p_application->>'target_user'),
      'team', trim(p_application->>'team'),
      'traction', nullif(trim(coalesce(p_application->>'traction', '')), ''),
      'market_size', nullif(trim(coalesce(p_application->>'market_size', '')), ''))
  where id = p_idea;
end
$$;
grant execute on function public.update_pipeline_idea(uuid, text, text[], text, text, jsonb) to authenticated;

-- Withdraw: the founder deletes their own application outright (any state, cascades the
-- whole dossier; uploaded storage objects are swept separately - documented trade-off).
-- The mentor is told afterwards via a notification with no idea reference (the row is gone;
-- an idea_id here would be cascade-deleted along with it).
create or replace function public.withdraw_application(p_idea uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_i public.pipeline_ideas;
begin
  select * into v_i from public.pipeline_ideas where id = p_idea;
  if not found or v_i.author_id <> auth.uid() then raise exception 'not your application'; end if;
  delete from public.pipeline_ideas where id = p_idea;
  perform public.notify(v_i.mentor_id, 'application_withdrawn', null, auth.uid(),
    jsonb_build_object('title', v_i.title, 'ifn', v_i.ifn));
end
$$;
grant execute on function public.withdraw_application(uuid) to authenticated;

-- Submit the current gate's template (G3 dossier / G4 beta plan / G5 evidence).
-- Server-side required-key checks per gate; G5 demands a verifiable artifact.
create or replace function public.submit_gate(p_idea uuid, p_payload jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_i public.pipeline_ideas;
begin
  perform public.write_guard();
  select * into v_i from public.pipeline_ideas where id = p_idea;
  if not found then raise exception 'application not found'; end if;
  if v_i.author_id <> v_uid then raise exception 'not your application'; end if;
  if v_i.pipeline_state <> 'active' then raise exception 'application is not active'; end if;
  if v_i.gate not between 3 and 5 then raise exception 'nothing to submit at this gate'; end if;
  if v_i.gate_status not in ('awaiting_submission', 'revision_requested') then
    raise exception 'this gate is already submitted';
  end if;
  if p_payload is null or pg_column_size(p_payload) > 20000 then raise exception 'invalid submission'; end if;

  if v_i.gate = 3 then
    if coalesce(trim(p_payload->>'who_you_are'), '') = '' then raise exception 'who you are is required'; end if;
    if coalesce(trim(p_payload->>'contact'), '') = '' then raise exception 'contact is required'; end if;
    if coalesce(trim(p_payload->>'market_value'), '') = '' then raise exception 'market value is required'; end if;
    if coalesce(trim(p_payload->>'market_size'), '') = '' then raise exception 'market size is required'; end if;
    if p_payload->'feasibility_self' is null then raise exception 'feasibility self-assessment is required'; end if;
  elsif v_i.gate = 4 then
    if coalesce(trim(p_payload->>'beta_plan'), '') = '' then raise exception 'beta plan is required'; end if;
  elsif v_i.gate = 5 then
    -- learnings are optional at G5; evidence (or a bypass) is what gates advancement.
    -- mentor bypass: when the prototype needs money/resources the founder does not have,
    -- they may request a bypass with a justification; the mentor's review IS the approval.
    if (p_payload->>'bypass_requested')::boolean is true then
      if coalesce(trim(p_payload->>'bypass_reason'), '') = '' then
        raise exception 'bypass reason required: why can the prototype not be built yet?';
      end if;
    -- otherwise the evidence gate applies: at least one verifiable artifact (URL or file)
    elsif coalesce(trim(p_payload->>'prototype_url'), '') = ''
       and coalesce(trim(p_payload->>'demo_url'), '') = ''
       and not exists (select 1 from public.attachments a where a.idea_id = p_idea and a.gate = 5) then
      raise exception 'evidence required: a prototype/demo link or an uploaded file (or request a mentor bypass)';
    end if;
    -- optional IIEC funding request (admin-gated on the client): a reason is required if flagged.
    -- No routing here; the mentor sees a banner and handles the IIEC offline.
    if (p_payload->>'iiec_funds_requested')::boolean is true
       and coalesce(trim(p_payload->>'iiec_reason'), '') = '' then
      raise exception 'IIEC funding reason required';
    end if;
    -- a founder picks at most one escape hatch: mentor bypass OR IIEC funds, not both.
    if (p_payload->>'bypass_requested')::boolean is true
       and (p_payload->>'iiec_funds_requested')::boolean is true then
      raise exception 'choose either a mentor bypass or an IIEC funding request, not both';
    end if;
  end if;

  update public.idea_submissions set status = 'superseded'
  where idea_id = p_idea and gate = v_i.gate and status in ('submitted', 'revision_requested');
  insert into public.idea_submissions (idea_id, gate, payload) values (p_idea, v_i.gate, p_payload);
  update public.pipeline_ideas set gate_status = 'submitted' where id = p_idea;
  perform public.notify(v_i.mentor_id, 'gate_submitted', p_idea, v_uid, jsonb_build_object('gate', v_i.gate));
end
$$;
grant execute on function public.submit_gate(uuid, jsonb) to authenticated;

-- Refine & Retry: after an admin sent it back, edit the application and re-enter at G1 (same IFN).
create or replace function public.resubmit_idea(p_idea uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_i public.pipeline_ideas;
begin
  perform public.write_guard();
  select * into v_i from public.pipeline_ideas where id = p_idea;
  if not found then raise exception 'application not found'; end if;
  if v_i.author_id <> v_uid then raise exception 'not your application'; end if;
  if v_i.pipeline_state <> 'refine' then raise exception 'application is not in refine'; end if;
  update public.pipeline_ideas
  set pipeline_state = 'active', gate = 1, gate_status = 'submitted', mentor_id = null, entered_gate_at = now()
  where id = p_idea;
  perform public.log_transition(p_idea, v_i.gate, 1, 'refine', 'active', 'student', 'resubmitted after refine');
end
$$;
grant execute on function public.resubmit_idea(uuid) to authenticated;

-- Close an action item with an evidence note (idea author only).
create or replace function public.action_done(p_action uuid, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_act public.idea_actions;
begin
  select * into v_act from public.idea_actions where id = p_action;
  if not found then raise exception 'action not found'; end if;
  -- founder, the idea's mentor, or any admin can mark an action done / cross it out.
  if not public.is_admin()
     and not exists (select 1 from public.pipeline_ideas i
                     where i.id = v_act.idea_id and (i.author_id = v_uid or i.mentor_id = v_uid)) then
    raise exception 'not your application';
  end if;
  if v_act.status = 'done' then raise exception 'already done'; end if;
  update public.idea_actions
  set status = 'done', done_note = nullif(trim(coalesce(p_note, '')), ''), done_at = now()
  where id = p_action;
  perform public.notify(v_act.created_by, 'action_done', v_act.idea_id, v_uid, jsonb_build_object('label', v_act.label));
end
$$;
grant execute on function public.action_done(uuid, text) to authenticated;

-- Private idea thread (author <-> mentor, admins included). 'meeting' = offline session log.
create or replace function public.idea_message_send(p_idea uuid, p_body text, p_kind text default 'message')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_i public.pipeline_ideas;
begin
  perform public.write_guard();
  if not public.can_access_idea(p_idea) then raise exception 'not allowed'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'message required'; end if;
  if length(p_body) > 4000 then raise exception 'message too long'; end if;
  if p_kind not in ('message', 'meeting') then raise exception 'invalid kind'; end if;
  if p_kind = 'meeting' and not public.is_mentor_or_admin() then raise exception 'only mentors log meetings'; end if;

  select * into v_i from public.pipeline_ideas where id = p_idea;
  insert into public.idea_messages (idea_id, author_id, body, kind) values (p_idea, v_uid, trim(p_body), p_kind);
  -- notify the other side(s)
  perform public.notify(v_i.author_id, 'message_received', p_idea, v_uid, '{}');
  perform public.notify(v_i.mentor_id, 'message_received', p_idea, v_uid, '{}');
end
$$;
grant execute on function public.idea_message_send(uuid, text, text) to authenticated;

-- Register an uploaded file (binary already in the 'idea-files' bucket; see policies below).
create or replace function public.register_attachment(
  p_idea uuid, p_gate int, p_path text, p_name text, p_size bigint, p_mime text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if not exists (select 1 from public.pipeline_ideas i where i.id = p_idea and i.author_id = v_uid) then
    raise exception 'not your application';
  end if;
  if public.idea_path_uuid(p_path) is distinct from p_idea then raise exception 'invalid path'; end if;
  insert into public.attachments (idea_id, gate, bucket_path, file_name, size_bytes, mime, uploaded_by)
  values (p_idea, p_gate, p_path, p_name, p_size, p_mime, v_uid)
  returning id into v_id;
  return v_id;
end
$$;
grant execute on function public.register_attachment(uuid, int, text, text, bigint, text) to authenticated;

-- My applications (author view).
drop function if exists public.my_pipeline();
create function public.my_pipeline()
returns table (
  id uuid, ifn int, title text, gate int, gate_status text, pipeline_state text,
  waiting_on text, mentor_name text, entered_gate_at timestamptz, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select i.id, i.ifn, i.title, i.gate, i.gate_status, i.pipeline_state,
         public.pipeline_waiting_on(i), m.name, i.entered_gate_at, i.created_at
  from public.pipeline_ideas i
  left join public.profiles m on m.id = i.mentor_id
  where i.author_id = auth.uid()
  order by i.created_at desc
$$;
grant execute on function public.my_pipeline() to authenticated;

-- My open action-item deadlines (for the personal layer on the Calendar page). Deadlines are
-- NEVER written to the broadcast events table - they are derived here, scoped to the caller,
-- so they can only ever reach the intended user's calendar.
drop function if exists public.my_action_deadlines();
create function public.my_action_deadlines()
returns table (id uuid, idea_id uuid, ifn int, idea_title text, label text, details text, due_date date)
language sql stable security definer set search_path = public
as $$
  select a.id, i.id, i.ifn, i.title, a.label, a.details, a.due_date
  from public.idea_actions a
  join public.pipeline_ideas i on i.id = a.idea_id
  where i.author_id = auth.uid() and a.status = 'open' and a.due_date is not null
  order by a.due_date
$$;
grant execute on function public.my_action_deadlines() to authenticated;

-- The dossier: the application's complete story in one call (author / assigned mentor / admin).
create or replace function public.idea_dossier(p_idea uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.can_access_idea(p_idea) then raise exception 'not allowed'; end if;

  select jsonb_build_object(
    'idea', (
      select jsonb_build_object(
        'id', i.id, 'ifn', i.ifn, 'title', i.title, 'oneliner', i.oneliner,
        'sector', i.sector, 'sectors', i.sectors,
        'problem', i.problem, 'solution', i.solution, 'startup', i.startup,
        'application', i.application,
        'gate', i.gate, 'gate_status', i.gate_status, 'pipeline_state', i.pipeline_state,
        'waiting_on', public.pipeline_waiting_on(i),
        'mentor_id', i.mentor_id, 'mentor_name', m.name,
        'author_id', i.author_id, 'author_name', a.name, 'author_role', a.role,
        'entered_gate_at', i.entered_gate_at, 'created_at', i.created_at,
        'is_mine', coalesce(i.author_id = auth.uid(), false),
        'is_mentor', coalesce(i.mentor_id = auth.uid(), false),
        'locked', coalesce((select pipeline_locked from public.app_settings where id), false),
        'iiec_enabled', coalesce((select iiec_enabled from public.app_settings where id), false))
      from public.pipeline_ideas i
      join public.profiles a on a.id = i.author_id
      left join public.profiles m on m.id = i.mentor_id
      where i.id = p_idea),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'gate', s.gate, 'payload', s.payload, 'status', s.status, 'created_at', s.created_at)
        order by s.created_at)
      from public.idea_submissions s where s.idea_id = p_idea), '[]'),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'gate', r.gate, 'criteria', r.criteria, 'feasibility', r.feasibility,
        'feedback', r.feedback, 'decision', r.decision, 'reviewer_name', rp.name, 'created_at', r.created_at)
        order by r.created_at)
      from public.idea_reviews r left join public.profiles rp on rp.id = r.reviewer_id
      where r.idea_id = p_idea), '[]'),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'gate', x.gate, 'label', x.label, 'details', x.details, 'due_date', x.due_date,
        'status', x.status, 'done_note', x.done_note, 'done_at', x.done_at,
        'created_by_name', cp.name, 'created_at', x.created_at)
        order by x.created_at)
      from public.idea_actions x left join public.profiles cp on cp.id = x.created_by
      where x.idea_id = p_idea), '[]'),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mg.id, 'body', mg.body, 'kind', mg.kind, 'author_name', mp.name,
        'is_mine', (mg.author_id = auth.uid()), 'created_at', mg.created_at)
        order by mg.created_at)
      from public.idea_messages mg left join public.profiles mp on mp.id = mg.author_id
      where mg.idea_id = p_idea), '[]'),
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', at.id, 'gate', at.gate, 'bucket_path', at.bucket_path, 'file_name', at.file_name,
        'size_bytes', at.size_bytes, 'mime', at.mime, 'created_at', at.created_at)
        order by at.created_at)
      from public.attachments at where at.idea_id = p_idea), '[]'),
    'transitions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'from_gate', t.from_gate, 'to_gate', t.to_gate, 'from_state', t.from_state, 'to_state', t.to_state,
        'role', t.role, 'reason', t.reason, 'by_name', tp.name, 'created_at', t.created_at)
        order by t.created_at)
      from public.gate_transitions t left join public.profiles tp on tp.id = t.changed_by
      where t.idea_id = p_idea), '[]')
  ) into v;
  return v;
end
$$;
grant execute on function public.idea_dossier(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Mentor RPCs

-- Pull-queue: unassigned G1 applications, filterable by the idea's sector; the mentor's own
-- sector floats first, oldest first (fairness).
drop function if exists public.mentor_queue();
drop function if exists public.mentor_queue(text);
create function public.mentor_queue(p_sector text default null)
returns table (
  id uuid, ifn int, title text, sector text, sectors text[], problem text, target_user text,
  author_name text, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select i.id, i.ifn, i.title, i.sector, i.sectors, i.problem, i.application->>'target_user',
         a.name, i.created_at
  from public.pipeline_ideas i
  join public.profiles a on a.id = i.author_id
  where public.is_mentor_or_admin()
    and i.pipeline_state = 'active' and i.gate = 1 and i.mentor_id is null
    and (p_sector is null or p_sector = any(i.sectors))
  order by ((select sector from public.profiles where id = auth.uid()) = any(i.sectors)) desc,
           i.created_at asc
$$;
grant execute on function public.mentor_queue(text) to authenticated;

-- Self-pick from the queue: claim + accept in one step (G1 -> G3, dossier requested).
create or replace function public.mentor_pick(p_idea uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_i public.pipeline_ideas;
begin
  if not public.is_mentor_or_admin() then raise exception 'mentors only'; end if;
  perform public.write_guard();
  select * into v_i from public.pipeline_ideas where id = p_idea for update;
  if not found then raise exception 'application not found'; end if;
  if v_i.pipeline_state <> 'active' or v_i.gate <> 1 or v_i.mentor_id is not null then
    raise exception 'idea is no longer available';
  end if;
  if v_i.author_id = v_uid then raise exception 'cannot mentor your own idea'; end if;

  update public.pipeline_ideas
  set mentor_id = v_uid, gate = 3, gate_status = 'awaiting_submission', entered_gate_at = now()
  where id = p_idea;
  perform public.log_transition(p_idea, 1, 3, 'active', 'active', 'mentor', 'picked from queue');
  perform public.notify(v_i.author_id, 'mentor_picked', p_idea, v_uid, '{}');
end
$$;
grant execute on function public.mentor_pick(uuid) to authenticated;

-- Accept an admin-assigned idea (G2 -> G3).
create or replace function public.mentor_accept(p_idea uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_i public.pipeline_ideas;
begin
  select * into v_i from public.pipeline_ideas where id = p_idea;
  if not found then raise exception 'application not found'; end if;
  if v_i.mentor_id is distinct from auth.uid() then raise exception 'not your assignment'; end if;
  if v_i.gate <> 2 or v_i.pipeline_state <> 'active' then raise exception 'nothing to accept'; end if;
  update public.pipeline_ideas
  set gate = 3, gate_status = 'awaiting_submission', entered_gate_at = now()
  where id = p_idea;
  perform public.log_transition(p_idea, 2, 3, 'active', 'active', 'mentor', 'accepted assignment');
  perform public.notify(v_i.author_id, 'mentor_accepted', p_idea, auth.uid(), '{}');
end
$$;
grant execute on function public.mentor_accept(uuid) to authenticated;

-- Ideas assigned to me (mentor home).
drop function if exists public.my_mentees();
create function public.my_mentees()
returns table (
  id uuid, ifn int, title text, gate int, gate_status text, pipeline_state text,
  waiting_on text, author_name text, entered_gate_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select i.id, i.ifn, i.title, i.gate, i.gate_status, i.pipeline_state,
         public.pipeline_waiting_on(i), a.name, i.entered_gate_at
  from public.pipeline_ideas i
  join public.profiles a on a.id = i.author_id
  where i.mentor_id = auth.uid()
  order by i.entered_gate_at asc
$$;
grant execute on function public.my_mentees() to authenticated;

-- Rubric review of the current gate's submission. Approve advances G3->G4->G5->G6;
-- revision sends it back to the student with feedback. G6 approval is terminal.
create or replace function public.review_gate(
  p_idea uuid, p_criteria jsonb, p_feasibility jsonb, p_feedback text, p_decision text
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_i public.pipeline_ideas;
  v_key text;
begin
  select * into v_i from public.pipeline_ideas where id = p_idea for update;
  if not found then raise exception 'application not found'; end if;
  if v_i.mentor_id is distinct from v_uid and not public.is_admin() then raise exception 'not your assignment'; end if;
  if v_i.pipeline_state <> 'active' then raise exception 'application is not active'; end if;
  if v_i.gate not between 3 and 5 then raise exception 'nothing to review at this gate'; end if;
  if v_i.gate_status <> 'submitted' then raise exception 'no submission to review'; end if;
  if p_decision not in ('approved', 'revision') then raise exception 'invalid decision'; end if;
  if coalesce(trim(p_feedback), '') = '' then raise exception 'feedback required'; end if;
  -- a gate cannot be passed while assigned work is still open: every action item must be
  -- closed before approval (requesting a revision is always allowed)
  if p_decision = 'approved'
     and exists (select 1 from public.idea_actions a where a.idea_id = p_idea and a.status = 'open') then
    raise exception 'open action items must be completed before advancing';
  end if;
  -- the 7-criteria rubric is the formal idea evaluation: it applies ONCE, at the G3 dossier
  -- review (where the founder's feasibility self-assessment is also confirmed/overridden).
  -- G4 (beta plan) and G5 (evidence) are judged by decision + feedback alone.
  if v_i.gate = 3 then
    foreach v_key in array array['clarity','feasibility','market_potential','innovation','technical','scalability','ps_fit'] loop
      if not (p_criteria ? v_key) or (p_criteria->>v_key)::numeric not between 1 and 5 then
        raise exception 'rubric incomplete: %', v_key;
      end if;
    end loop;
  end if;

  insert into public.idea_reviews (idea_id, gate, reviewer_id, criteria, feasibility, feedback, decision)
  values (p_idea, v_i.gate, v_uid,
          case when v_i.gate = 3 then p_criteria else coalesce(p_criteria, '{}') end,
          case when v_i.gate = 3 then p_feasibility else null end,
          trim(p_feedback), p_decision);

  if p_decision = 'approved' then
    update public.idea_submissions set status = 'approved'
    where idea_id = p_idea and gate = v_i.gate and status = 'submitted';
    update public.pipeline_ideas
    set gate = v_i.gate + 1,
        gate_status = case when v_i.gate + 1 = 6 then 'approved' else 'awaiting_submission' end,
        entered_gate_at = now()
    where id = p_idea;
    perform public.log_transition(p_idea, v_i.gate, v_i.gate + 1, 'active', 'active',
      case when public.is_admin() and v_i.mentor_id is distinct from v_uid then 'admin' else 'mentor' end,
      'review approved');
    perform public.notify(v_i.author_id, 'review_approved', p_idea, v_uid, jsonb_build_object('gate', v_i.gate));
  else
    update public.idea_submissions set status = 'revision_requested'
    where idea_id = p_idea and gate = v_i.gate and status = 'submitted';
    update public.pipeline_ideas set gate_status = 'revision_requested' where id = p_idea;
    perform public.notify(v_i.author_id, 'revision_requested', p_idea, v_uid, jsonb_build_object('gate', v_i.gate));
  end if;
end
$$;
grant execute on function public.review_gate(uuid, jsonb, jsonb, text, text) to authenticated;

-- Mentor assigns a concrete off-app task to the founder.
create or replace function public.action_create(p_idea uuid, p_label text, p_details text, p_due date)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_i public.pipeline_ideas;
begin
  select * into v_i from public.pipeline_ideas where id = p_idea;
  if not found then raise exception 'application not found'; end if;
  if v_i.mentor_id is distinct from v_uid and not public.is_admin() then raise exception 'not your assignment'; end if;
  if coalesce(trim(p_label), '') = '' then raise exception 'label required'; end if;
  if length(p_label) > 200 then raise exception 'label too long'; end if;
  insert into public.idea_actions (idea_id, gate, label, details, due_date, created_by)
  values (p_idea, v_i.gate, trim(p_label), coalesce(trim(p_details), ''), p_due, v_uid);
  perform public.notify(v_i.author_id, 'action_created', p_idea, v_uid, jsonb_build_object('label', trim(p_label)));
end
$$;
grant execute on function public.action_create(uuid, text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin RPCs (all audited; reasons mandatory on overrides)

-- Board of ALL applications with filters (sector included); oldest-in-gate first (triage order).
drop function if exists public.admin_pipeline_board(int, text, uuid, text, text, int, int, int);
drop function if exists public.admin_pipeline_board(int, text, uuid, text, text, text, int, int, int);
create function public.admin_pipeline_board(
  p_gate int default null,
  p_state text default null,
  p_mentor uuid default null,
  p_waiting text default null,
  p_sector text default null,
  p_search text default null,
  p_stale_days int default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid, ifn int, title text, sector text, sectors text[], author_name text, gate int, gate_status text,
  pipeline_state text, waiting_on text, mentor_id uuid, mentor_name text,
  days_in_gate int, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select i.id, i.ifn, i.title, i.sector, i.sectors, a.name, i.gate, i.gate_status,
         i.pipeline_state, public.pipeline_waiting_on(i), i.mentor_id, m.name,
         extract(day from now() - i.entered_gate_at)::int, i.created_at
  from public.pipeline_ideas i
  join public.profiles a on a.id = i.author_id
  left join public.profiles m on m.id = i.mentor_id
  where public.is_admin()
    and (p_gate is null or i.gate = p_gate)
    and (p_state is null or i.pipeline_state = p_state)
    and (p_mentor is null or i.mentor_id = p_mentor)
    and (p_waiting is null or public.pipeline_waiting_on(i) = p_waiting)
    and (p_sector is null or p_sector = any(i.sectors))
    and (p_stale_days is null or (i.pipeline_state = 'active' and i.gate_status <> 'approved'
         and i.entered_gate_at < now() - make_interval(days => p_stale_days)))
    and (p_search is null or p_search = ''
         or i.title ilike '%' || p_search || '%'
         or a.name ilike '%' || p_search || '%'
         or i.ifn::text = regexp_replace(p_search, '\D', '', 'g'))
  order by i.entered_gate_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0))
$$;
grant execute on function public.admin_pipeline_board(int, text, uuid, text, text, text, int, int, int) to authenticated;

-- Funnel health in one row.
create or replace function public.admin_pipeline_counts()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when public.is_admin() then jsonb_build_object(
    'by_gate', (select coalesce(jsonb_object_agg(g.gate, g.cnt), '{}') from (
      select gate, count(*) as cnt from public.pipeline_ideas where pipeline_state = 'active' group by gate) g),
    'unassigned', (select count(*) from public.pipeline_ideas where pipeline_state = 'active' and mentor_id is null),
    'refine', (select count(*) from public.pipeline_ideas where pipeline_state = 'refine'),
    'rejected', (select count(*) from public.pipeline_ideas where pipeline_state = 'rejected'),
    'stale', (select count(*) from public.pipeline_ideas
              where pipeline_state = 'active' and gate_status <> 'approved'
                and entered_gate_at < now() - interval '14 days'),
    'total', (select count(*) from public.pipeline_ideas)
  ) end
$$;
grant execute on function public.admin_pipeline_counts() to authenticated;

-- Assign / reassign / unassign (p_mentor null) a mentor.
create or replace function public.admin_assign_mentor(p_idea uuid, p_mentor uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_i public.pipeline_ideas;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  select * into v_i from public.pipeline_ideas where id = p_idea for update;
  if not found then raise exception 'application not found'; end if;

  if p_mentor is null then
    -- unassign: early gates return to the pull-queue; later gates wait for an admin reassign
    update public.pipeline_ideas
    set mentor_id = null,
        gate = case when v_i.gate <= 3 then 1 else v_i.gate end,
        gate_status = case when v_i.gate <= 3 then 'submitted' else v_i.gate_status end,
        entered_gate_at = case when v_i.gate <= 3 then now() else v_i.entered_gate_at end
    where id = p_idea;
    perform public.log_transition(p_idea, v_i.gate, case when v_i.gate <= 3 then 1 else v_i.gate end,
      v_i.pipeline_state, v_i.pipeline_state, 'admin', trim(p_reason));
    perform public.notify(v_i.author_id, 'mentor_unassigned', p_idea, auth.uid(), '{}');
    perform public.notify(v_i.mentor_id, 'mentor_unassigned', p_idea, auth.uid(), '{}');
    return;
  end if;

  if p_mentor = v_i.author_id then raise exception 'cannot assign the author as mentor'; end if;
  if not exists (select 1 from public.profiles where id = p_mentor and role in ('mentor', 'admin') and not banned) then
    raise exception 'not an active mentor';
  end if;
  update public.pipeline_ideas
  set mentor_id = p_mentor,
      gate = case when v_i.gate = 1 then 2 else v_i.gate end,
      entered_gate_at = case when v_i.gate = 1 then now() else v_i.entered_gate_at end
  where id = p_idea;
  perform public.log_transition(p_idea, v_i.gate, case when v_i.gate = 1 then 2 else v_i.gate end,
    v_i.pipeline_state, v_i.pipeline_state, 'admin', trim(p_reason));
  perform public.notify(v_i.author_id, 'mentor_assigned', p_idea, auth.uid(), '{}');
  perform public.notify(p_mentor, 'mentor_assigned', p_idea, auth.uid(), '{}');
end
$$;
grant execute on function public.admin_assign_mentor(uuid, uuid, text) to authenticated;

create or replace function public.admin_bulk_assign(p_ideas uuid[], p_mentor uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v uuid;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_mentor is null then raise exception 'mentor required'; end if;
  foreach v in array p_ideas loop
    perform public.admin_assign_mentor(v, p_mentor, p_reason);
  end loop;
end
$$;
grant execute on function public.admin_bulk_assign(uuid[], uuid, text) to authenticated;

-- Override: move any application to any gate, with a mandatory audited reason.
create or replace function public.admin_move_gate(p_idea uuid, p_gate int, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_i public.pipeline_ideas;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_gate not between 1 and 6 then raise exception 'invalid gate'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  select * into v_i from public.pipeline_ideas where id = p_idea for update;
  if not found then raise exception 'application not found'; end if;
  update public.pipeline_ideas
  set gate = p_gate,
      gate_status = case when p_gate = 1 then 'submitted'
                         when p_gate = 6 then 'approved'
                         else 'awaiting_submission' end,
      pipeline_state = 'active',
      entered_gate_at = now()
  where id = p_idea;
  perform public.log_transition(p_idea, v_i.gate, p_gate, v_i.pipeline_state, 'active', 'admin', trim(p_reason));
  perform public.notify(v_i.author_id, 'gate_moved', p_idea, auth.uid(), jsonb_build_object('gate', p_gate));
  perform public.notify(v_i.mentor_id, 'gate_moved', p_idea, auth.uid(), jsonb_build_object('gate', p_gate));
end
$$;
grant execute on function public.admin_move_gate(uuid, int, text) to authenticated;

-- Reject (final) or send to Refine & Retry. Refine clears the mentor; same IFN on resubmit.
create or replace function public.admin_reject_idea(p_idea uuid, p_final boolean, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_i public.pipeline_ideas;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  select * into v_i from public.pipeline_ideas where id = p_idea for update;
  if not found then raise exception 'application not found'; end if;
  if v_i.pipeline_state = 'rejected' then raise exception 'already rejected'; end if;
  update public.pipeline_ideas
  set pipeline_state = case when p_final then 'rejected' else 'refine' end,
      mentor_id = case when p_final then mentor_id else null end
  where id = p_idea;
  perform public.log_transition(p_idea, v_i.gate, v_i.gate, v_i.pipeline_state,
    case when p_final then 'rejected' else 'refine' end, 'admin', trim(p_reason));
  perform public.notify(v_i.author_id, case when p_final then 'idea_rejected' else 'idea_refine' end,
    p_idea, auth.uid(), jsonb_build_object('reason', trim(p_reason)));
end
$$;
grant execute on function public.admin_reject_idea(uuid, boolean, text) to authenticated;

-- Moderation: delete an application outright (cascades the whole dossier). Author and
-- mentor are told afterwards via a notification with no idea reference (the row is gone);
-- the mandatory reason rides in its payload - the only record that survives the cascade.
-- Storage objects are swept separately (same documented trade-off as withdraw).
create or replace function public.admin_delete_pipeline_idea(p_idea uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_i public.pipeline_ideas;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason required'; end if;
  select * into v_i from public.pipeline_ideas where id = p_idea;
  if not found then raise exception 'application not found'; end if;
  delete from public.pipeline_ideas where id = p_idea;
  perform public.notify(v_i.author_id, 'application_deleted', null, auth.uid(),
    jsonb_build_object('title', v_i.title, 'ifn', v_i.ifn, 'reason', trim(p_reason)));
  perform public.notify(v_i.mentor_id, 'application_deleted', null, auth.uid(),
    jsonb_build_object('title', v_i.title, 'ifn', v_i.ifn, 'reason', trim(p_reason)));
end
$$;
grant execute on function public.admin_delete_pipeline_idea(uuid, text) to authenticated;

-- Load per mentor so assignment is informed.
drop function if exists public.admin_mentor_load();
create function public.admin_mentor_load()
returns table (mentor_id uuid, mentor_name text, role text, active_count bigint)
language sql stable security definer set search_path = public
as $$
  select pr.id, pr.name, pr.role,
         (select count(*) from public.pipeline_ideas i
          where i.mentor_id = pr.id and i.pipeline_state = 'active' and i.gate_status <> 'approved')
  from public.profiles pr
  where public.is_admin() and pr.role in ('mentor', 'admin') and not pr.banned
  order by pr.name
$$;
grant execute on function public.admin_mentor_load() to authenticated;

create or replace function public.admin_set_pipeline_locked(p_locked boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.app_settings set pipeline_locked = p_locked where id;
end
$$;
grant execute on function public.admin_set_pipeline_locked(boolean) to authenticated;

create or replace function public.admin_set_iiec_enabled(p_enabled boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.app_settings set iiec_enabled = p_enabled where id;
end
$$;
grant execute on function public.admin_set_iiec_enabled(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for pipeline files. 20MB cap + doc/PDF/PPT mime allowlist
-- enforced at the bucket level. Objects are keyed '{idea_id}/{gate}/{uuid}-{filename}'.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('idea-files', 'idea-files', false, 20971520, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- author/mentor/admin read; only the application's author uploads; uploader may delete own object.
drop policy if exists "idea files read" on storage.objects;
create policy "idea files read" on storage.objects
  for select to authenticated
  using (bucket_id = 'idea-files' and public.can_access_idea(public.idea_path_uuid(name)));
drop policy if exists "idea files insert" on storage.objects;
create policy "idea files insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'idea-files' and public.is_idea_author(public.idea_path_uuid(name)));
drop policy if exists "idea files delete own" on storage.objects;
create policy "idea files delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'idea-files' and owner = auth.uid());

-- ---------------------------------------------------------------------------
-- Stale nudge: daily, both sides of any active idea stuck > 14 days (max one nudge / 7 days).
-- No-ops when the pg_cron extension is not enabled (enable it in Database -> Extensions).
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('pipeline-stale-nudge', '0 6 * * *', $job$
      insert into public.notifications (user_id, kind, idea_id, payload)
      select x.user_id, 'pipeline_stale', i.id,
             jsonb_build_object('days', extract(day from now() - i.entered_gate_at)::int)
      from public.pipeline_ideas i
      cross join lateral (values (i.author_id), (i.mentor_id)) as x(user_id)
      where i.pipeline_state = 'active'
        and i.gate_status <> 'approved'
        and i.entered_gate_at < now() - interval '14 days'
        and x.user_id is not null
        and not exists (
          select 1 from public.notifications n
          where n.idea_id = i.id and n.user_id = x.user_id
            and n.kind = 'pipeline_stale' and n.created_at > now() - interval '7 days')
    $job$);
  end if;
end
$do$;
