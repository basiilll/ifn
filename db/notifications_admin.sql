-- Admin notification surfaces for the /notifications page. Run AFTER admin.sql +
-- pipeline.sql + notifications.sql (needs is_admin, pipeline_ideas, notifications).
-- Members use my_notifications (own); admins additionally get these two views.

-- All activity: every notification row platform-wide, newest first, with who it was
-- for (recipient) and who caused it (actor). Admin only.
create or replace function public.admin_all_notifications(p_limit int default 50)
returns table (
  id uuid, kind text, idea_id uuid, idea_title text,
  actor_name text, recipient_name text, payload jsonb, read_at timestamptz, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select n.id, n.kind, n.idea_id, i.title, a.name, u.name, n.payload, n.read_at, n.created_at
  from public.notifications n
  left join public.pipeline_ideas i on i.id = n.idea_id
  left join public.profiles a on a.id = n.actor_id
  left join public.profiles u on u.id = n.user_id
  where public.is_admin()
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;
grant execute on function public.admin_all_notifications(int) to authenticated;

-- Needs action: the unified admin to-do. Computed live (not notification rows) so it is
-- always accurate. Two buckets for now, extensible by adding union branches:
--   * 'success'  -> a post whose author requested the #Success badge (approve/reject inline)
--   * 'pipeline' -> a filed application with no mentor yet (review on the idea page)
create or replace function public.admin_needs_action()
returns table (item_type text, ref_id uuid, ifn int, title text, subtitle text, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select 'success'::text, p.id, null::int, p.title,
         ('#Success request from ' || coalesce(a.name, 'a member'))::text, p.created_at
    from public.posts p
    join public.profiles a on a.id = p.author_id
   where public.is_admin() and p.success_request = 'pending'
  union all
  select 'pipeline'::text, i.id, i.ifn, i.title,
         'New application, no mentor yet'::text, i.created_at
    from public.pipeline_ideas i
   where public.is_admin()
     and i.pipeline_state = 'active' and i.gate = 1 and i.mentor_id is null
  union all
  -- Problem Hub problems with unreviewed solutions (open problems only), grouped so each
  -- problem is one row no matter how many solutions are pending a mentor score.
  select 'solution'::text, pr.id, null::int, pr.title,
         (count(*) || ' solution' || case when count(*) > 1 then 's' else '' end || ' need review')::text,
         max(sol.created_at)
    from public.problem_solutions sol
    join public.problems pr on pr.id = sol.problem_id
   where public.is_admin() and sol.reviewed_at is null and not pr.closed
   group by pr.id, pr.title
  order by created_at desc
$$;
grant execute on function public.admin_needs_action() to authenticated;
