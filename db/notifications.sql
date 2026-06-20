-- Notifications (ADR-020, brought forward for the Idea Pipeline): minimal in-app center.
-- Rows are written ONLY by security-definer functions (no insert policy); users read and
-- mark-read their own. Run in Supabase BEFORE db/pipeline.sql.
-- `idea_id` points at pipeline_ideas; the FK + the title-joining reader (my_notifications)
-- live in db/pipeline.sql because that table is created there.

-- One-time upgrade from the earlier post-coupled draft (the pipeline was unreleased):
-- the table used a post_id column referencing posts; rename it to idea_id and drop the FK.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'notifications' and column_name = 'post_id') then
    alter table public.notifications drop constraint if exists notifications_post_id_fkey;
    alter table public.notifications rename column post_id to idea_id;
  end if;
end
$$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  idea_id uuid,
  actor_id uuid references public.profiles(id) on delete set null,
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

-- read own; mark-read own (every column except read_at is revoked from update);
-- clear own. Inserts happen only inside definer functions.
drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own" on public.notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own" on public.notifications
  for delete to authenticated using (user_id = auth.uid());
revoke update (id, user_id, kind, idea_id, actor_id, payload, created_at) on public.notifications from authenticated;

-- Per-user notification preferences. Coarse categories; a missing or true value means
-- "send", only an explicit false suppresses. Default '{}' so everyone starts fully opted in
-- and any newly added category is on until the user turns it off.
alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

-- Maps a notification kind to its user-facing preference category. Anything unmapped
-- falls through to 'pipeline' so a new kind is never silently undeliverable.
create or replace function public.notif_category(p_kind text)
returns text
language sql immutable
as $$
  select case
    when p_kind in ('problem_solution_received', 'solution_reviewed') then 'problems'
    when p_kind in ('application_withdrawn', 'application_deleted') then 'team'
    else 'pipeline'
  end
$$;

-- Internal writer used by the pipeline RPCs. Not callable by clients.
-- (drop first: an earlier draft used p_post as the parameter name; replace cannot rename)
drop function if exists public.notify(uuid, text, uuid, uuid, jsonb);
create function public.notify(
  p_user uuid, p_kind text, p_idea uuid, p_actor uuid, p_payload jsonb default '{}'
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_prefs jsonb;
begin
  if p_user is null or p_user = p_actor then return; end if;  -- never self-notify
  -- honor the recipient's category preference; missing key = opted in
  select notification_prefs into v_prefs from public.profiles where id = p_user;
  if v_prefs is not null and (v_prefs -> public.notif_category(p_kind)) = 'false'::jsonb then
    return;
  end if;
  insert into public.notifications (user_id, kind, idea_id, actor_id, payload)
  values (p_user, p_kind, p_idea, p_actor, coalesce(p_payload, '{}'));
end
$$;
revoke execute on function public.notify(uuid, text, uuid, uuid, jsonb) from public, authenticated;

create or replace function public.notifications_unread_count()
returns bigint
language sql stable security definer set search_path = public
as $$
  select count(*) from public.notifications where user_id = auth.uid() and read_at is null
$$;
grant execute on function public.notifications_unread_count() to authenticated;

create or replace function public.mark_notifications_read()
returns void
language sql security definer set search_path = public
as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null
$$;
grant execute on function public.mark_notifications_read() to authenticated;
