-- Read-only (soft block) moderation tier. A restricted member stays logged in and can
-- browse, but every WRITE is blocked server-side. Sits between active and banned.
--
-- Run AFTER admin.sql (needs is_admin) and BEFORE re-applying the write-path files that
-- call can_write()/write_guard() (tags, comments, pipeline, teamboard, problemhub, polls,
-- directory). can_write/write_guard are the single source of truth for "may this user write".

-- banned is "owned" by admin.sql, but can_write()/write_guard() below read it and Postgres
-- body-checks functions at creation time — so banned MUST exist before this file runs. Add it
-- here too (idempotent) so a fresh apply works regardless of file order.
alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.profiles add column if not exists restricted boolean not null default false;
alter table public.profiles add column if not exists restricted_reason text;
revoke update (restricted, restricted_reason) on public.profiles from authenticated;

-- Boolean form for RLS policies.
create or replace function public.can_write(p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not coalesce(p.banned, false) and not coalesce(p.restricted, false)
  from public.profiles p where p.id = p_uid
$$;

-- Raising form for write RPCs: `perform public.write_guard();` gives the caller the right message.
create or replace function public.write_guard()
returns void
language plpgsql stable security definer set search_path = public
as $$
declare v_banned boolean; v_restricted boolean;
begin
  select banned, restricted into v_banned, v_restricted from public.profiles where id = auth.uid();
  if coalesce(v_banned, false) then raise exception 'account is banned'; end if;
  if coalesce(v_restricted, false) then raise exception 'your account is read-only'; end if;
end
$$;

-- Gate the two write surfaces that are NOT routed through a guarded RPC: profile self-edits
-- (sector/domain/name/...) and voting. Both are direct client writes governed only by RLS.
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id and public.can_write(auth.uid()));

drop policy if exists "post_votes insert own" on public.post_votes;
create policy "post_votes insert own" on public.post_votes
  for insert to authenticated with check (user_id = auth.uid() and public.can_write(auth.uid()));
drop policy if exists "post_votes update own" on public.post_votes;
create policy "post_votes update own" on public.post_votes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_write(auth.uid()));


-- Admin: restrict / unrestrict (read-only). Reason is stored on the profile (audited).
create or replace function public.admin_restrict_user(p_user uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if p_user = auth.uid() then raise exception 'cannot restrict yourself'; end if;
  update public.profiles set restricted = true, restricted_reason = nullif(trim(coalesce(p_reason, '')), '') where id = p_user;
end $$;
grant execute on function public.admin_restrict_user(uuid, text) to authenticated;

create or replace function public.admin_unrestrict_user(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.profiles set restricted = false, restricted_reason = null where id = p_user;
end $$;
grant execute on function public.admin_unrestrict_user(uuid) to authenticated;
