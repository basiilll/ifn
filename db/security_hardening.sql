-- ============================================================================
-- db/security_hardening.sql  —  applied LAST (see selfhost/apply-schema.sh ORDER)
--
-- Closes authorization holes found in the 2026-06-20 security audit
-- (reviews/SECURITY-AUDIT.md). Every statement is idempotent and depends only
-- on objects defined in earlier files (profiles.role, profiles.member_type,
-- public.can_write, public.is_admin), so it is safe to re-run.
--
-- Apply to an existing database immediately with:
--   psql "$DATABASE_URL" -f db/security_hardening.sql
-- Supabase Cloud: paste this file into the SQL editor and run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- [CRITICAL] Privilege escalation via profiles.role / profiles.member_type.
--
-- profiles.sql does `grant all on table public.profiles to authenticated`, which
-- includes column-level UPDATE on every column. The header comment claims the
-- privilege columns are "revoked in the later files that introduce them" — but
-- for `role` and `member_type` that revoke was never written (only banned,
-- restricted, restricted_reason and directory_pinned are revoked anywhere).
-- The "update own profile" policy has no column list and no WITH CHECK, and the
-- role CHECK permits 'admin'. So any authenticated, non-banned member could run,
-- directly against PostgREST with the public anon key:
--     update public.profiles set role = 'admin' where id = auth.uid();
-- is_admin() reads profiles.role, so this is instant Super Admin = full
-- compromise of the authorization model.
--
-- Legit role/member_type writes all go through SECURITY DEFINER functions
-- (admin_set_role, consume_invite, admin_update_profile) or the create-member
-- edge function (service role) — all of which bypass column GRANTs — so revoking
-- the columns from `authenticated` breaks no legitimate flow. Verified: no
-- client-side direct update touches a privileged column (Onboarding.jsx,
-- Profile.jsx and Settings.jsx only write the 14 columns granted below).
--
-- PostgreSQL GOTCHA (the reason a naive `revoke update (role)` does NOT work):
-- profiles.sql does `grant all on table profiles to anon, authenticated`, which
-- grants TABLE-level UPDATE. A column-level `revoke update (role)` CANNOT override
-- a table-level grant — has_column_privilege('authenticated','profiles.role',
-- 'UPDATE') stays TRUE. (This same gotcha silently defeated the existing
-- banned / restricted / directory_pinned column revokes too.) The ONLY correct
-- fix is to drop the table-level UPDATE and re-grant UPDATE on the safe,
-- user-editable columns only. Privileged columns (role, member_type, banned,
-- restricted, restricted_reason, directory_pinned, id, created_at) are then
-- unwritable by any client; admin / SECURITY DEFINER paths bypass column grants.
revoke update on public.profiles from anon, authenticated;
grant update (
  name, region, sector, domain, incubation_interest, linkedin, phone, bio,
  startup, show_email, directory_visible, onboarded, notification_prefs, contactable
) on public.profiles to authenticated;

-- Defense-in-depth: re-assert that a member can only write their OWN row on
-- UPDATE (USING already enforces it; WITH CHECK stops any future column-grant
-- slip from being combined with a row swap). Mirrors readonly.sql's policy and
-- keeps the can_write() read-only guard.
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated
  using (auth.uid() = id and public.can_write(auth.uid()))
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- [HIGH] Banned / read-only (restricted) users could still create and edit
-- their own posts via direct PostgREST calls. The posts insert/update policies
-- checked only `author_id = auth.uid()` and skipped public.can_write() — unlike
-- post_votes, comments, tags, team_apply, etc. The composer UI is hidden for
-- these users, but RLS (the only server-side guard) did not stop them. Re-add
-- the can_write() guard, matching the rest of the schema.
drop policy if exists "posts insert own" on public.posts;
create policy "posts insert own" on public.posts
  for insert to authenticated
  with check (author_id = auth.uid() and public.can_write(auth.uid()));

drop policy if exists "posts update own" on public.posts;
create policy "posts update own" on public.posts
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.can_write(auth.uid()));
-- DELETE is intentionally left author-only: removing your own content is allowed
-- even in read-only mode. The existing column REVOKEs on posts (pinned, badges,
-- success_request, comments_locked, ...) are unaffected by these policy rewrites.

-- ---------------------------------------------------------------------------
-- [HIGH — MANUAL, NOT APPLIED HERE] idea_autopsies has NO schema/RLS tracked in
-- this repo (the table was created in the Supabase dashboard). AdminPanel.jsx
-- and AutopsyLibrary.jsx perform approve / reject / delete as DIRECT client
-- table writes (supabase.from('idea_autopsies').update/delete). If the live
-- table's RLS is missing or permissive, any member can self-approve their own
-- case study (publish without admin review) or delete others'.
--
-- ACTION: inspect the live table and lock it down. In psql:
--     \d  public.idea_autopsies      -- column names
--     \dp public.idea_autopsies      -- current grants/policies
-- Then RECONCILE the column names below against the real table and run them.
-- Left commented so this file stays apply-safe against the (untracked) schema:
--
-- alter table public.idea_autopsies enable row level security;
-- revoke update (status, rejection_reason) on public.idea_autopsies from authenticated;
--
-- drop policy if exists "autopsies read approved or own" on public.idea_autopsies;
-- create policy "autopsies read approved or own" on public.idea_autopsies
--   for select to authenticated
--   using (status = 'approved' or author_id = auth.uid() or public.is_admin());
--
-- drop policy if exists "autopsies insert own pending" on public.idea_autopsies;
-- create policy "autopsies insert own pending" on public.idea_autopsies
--   for insert to authenticated
--   with check (author_id = auth.uid() and status = 'pending' and public.can_write(auth.uid()));
--
-- drop policy if exists "autopsies delete own or admin" on public.idea_autopsies;
-- create policy "autopsies delete own or admin" on public.idea_autopsies
--   for delete to authenticated
--   using (author_id = auth.uid() or public.is_admin());
--
-- -- Status transitions (approve/reject) must be admin-only. Either keep the
-- -- column revoked and move AdminPanel's approve/reject to a SECURITY DEFINER
-- -- RPC (admin_review_autopsy), or add an UPDATE policy gated on public.is_admin().

-- ---------------------------------------------------------------------------
-- [CONSISTENCY] Extend the can_write() read-only guard to the remaining content
-- write policies that were missing it (problem_votes, problems, team_posts,
-- sub_threads), matching posts. Banned / read-only users can browse but cannot
-- post, edit, or vote via direct PostgREST calls. (DELETE-own and notifications
-- mark-read stay allowed in read-only mode. idea_autopsies lives only in the
-- cloud dashboard schema, so its equivalent guard is applied there, not here.)

drop policy if exists "upsert own vote" on public.problem_votes;
create policy "upsert own vote" on public.problem_votes
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_write(auth.uid()));

drop policy if exists "update own vote" on public.problem_votes;
create policy "update own vote" on public.problem_votes
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_write(auth.uid()));

drop policy if exists "problems update own" on public.problems;
create policy "problems update own" on public.problems
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.can_write(auth.uid()));

drop policy if exists "team_posts update own" on public.team_posts;
create policy "team_posts update own" on public.team_posts
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.can_write(auth.uid()));

drop policy if exists "sub_threads insert by post author" on public.sub_threads;
create policy "sub_threads insert by post author" on public.sub_threads
  for insert to authenticated
  with check (author_id = auth.uid()
    and auth.uid() = (select posts.author_id from public.posts where posts.id = sub_threads.post_id)
    and public.can_write(auth.uid()));

-- ---------------------------------------------------------------------------
-- [ANON LOCKDOWN] Postgres grants function EXECUTE to PUBLIC by default, and
-- Supabase's default privileges also grant it to `anon`. Combined with
-- SECURITY DEFINER read functions that lack an auth.uid() gate (e.g. directory()),
-- this let the anon role (public key, no login) call RPCs and read member data.
-- The logged-out pages call ZERO database RPCs (they use GoTrue auth + edge
-- functions only), so anon needs no function access at all. Revoke it from every
-- public function. Runs LAST so it covers all functions; re-run after adding any.
-- authenticated keeps its explicit grants; service_role/postgres are untouched.
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;

-- ---------------------------------------------------------------------------
-- [SEARCH_PATH] Pin search_path on 6 functions the linter flagged as mutable
-- (function_search_path_mutable). Defense against search_path hijacking of a
-- SECURITY DEFINER function. The source definitions should also add
-- `set search_path = public`; these ALTERs are the idempotent backstop.
alter function public.check_application(p_title text, p_sectors text[], p_problem text, p_solution text, p_application jsonb) set search_path = public;
alter function public.contact_daily_cap() set search_path = public;
alter function public.idea_path_uuid(p_name text) set search_path = public;
alter function public.notif_category(p_kind text) set search_path = public;
alter function public.pipeline_waiting_on(p public.pipeline_ideas) set search_path = public;
alter function public.student_domain() set search_path = public;
