-- Length limits on every user-writable text column. This is the layer that CANNOT be escaped:
-- the browser holds the anon key and can POST straight to PostgREST or call an RPC, so a
-- client-side maxLength is only cosmetic. These CHECK constraints bound every write path.
-- Bounds are generous (legit input is never blocked) but stop someone stuffing megabytes.
-- Idempotent: each constraint is dropped then re-added. Runs near the end (after all tables).

-- helper pattern: char_length(col) <= N, allowing NULL.

-- profiles
alter table public.profiles drop constraint if exists chk_profiles_name_len;
alter table public.profiles add  constraint chk_profiles_name_len            check (name is null              or char_length(name) <= 120);
alter table public.profiles drop constraint if exists chk_profiles_region_len;
alter table public.profiles add  constraint chk_profiles_region_len          check (region is null            or char_length(region) <= 80);
alter table public.profiles drop constraint if exists chk_profiles_sector_len;
alter table public.profiles add  constraint chk_profiles_sector_len          check (sector is null            or char_length(sector) <= 80);
alter table public.profiles drop constraint if exists chk_profiles_domain_len;
alter table public.profiles add  constraint chk_profiles_domain_len          check (domain is null            or char_length(domain) <= 80);
alter table public.profiles drop constraint if exists chk_profiles_member_type_len;
alter table public.profiles add  constraint chk_profiles_member_type_len     check (member_type is null       or char_length(member_type) <= 60);
alter table public.profiles drop constraint if exists chk_profiles_linkedin_len;
alter table public.profiles add  constraint chk_profiles_linkedin_len        check (linkedin is null          or char_length(linkedin) <= 200);
alter table public.profiles drop constraint if exists chk_profiles_phone_len;
alter table public.profiles add  constraint chk_profiles_phone_len           check (phone is null             or char_length(phone) <= 30);
alter table public.profiles drop constraint if exists chk_profiles_bio_len;
alter table public.profiles add  constraint chk_profiles_bio_len             check (bio is null               or char_length(bio) <= 500);
alter table public.profiles drop constraint if exists chk_profiles_startup_len;
alter table public.profiles add  constraint chk_profiles_startup_len         check (startup is null           or char_length(startup) <= 120);
alter table public.profiles drop constraint if exists chk_profiles_restricted_reason_len;
alter table public.profiles add  constraint chk_profiles_restricted_reason_len check (restricted_reason is null or char_length(restricted_reason) <= 500);

-- posts (feed + problem/success posts). NOTE: a feed post's main text body is stored in the
-- `problem` column (see the create_post RPC), so problem/solution carry the long-form text.
alter table public.posts drop constraint if exists chk_posts_title_len;
alter table public.posts add  constraint chk_posts_title_len      check (title is null    or char_length(title) <= 300);
alter table public.posts drop constraint if exists chk_posts_startup_len;
alter table public.posts add  constraint chk_posts_startup_len    check (startup is null  or char_length(startup) <= 2000);
alter table public.posts drop constraint if exists chk_posts_problem_len;
alter table public.posts add  constraint chk_posts_problem_len    check (problem is null  or char_length(problem) <= 10000);
alter table public.posts drop constraint if exists chk_posts_solution_len;
alter table public.posts add  constraint chk_posts_solution_len   check (solution is null or char_length(solution) <= 10000);

-- comments + threads
alter table public.comments drop constraint if exists chk_comments_body_len;
alter table public.comments add  constraint chk_comments_body_len     check (body is null or char_length(body) <= 5000);
alter table public.sub_threads drop constraint if exists chk_sub_threads_body_len;
alter table public.sub_threads add  constraint chk_sub_threads_body_len check (body is null or char_length(body) <= 5000);

-- problem hub
alter table public.problems drop constraint if exists chk_problems_title_len;
alter table public.problems add  constraint chk_problems_title_len       check (title is null       or char_length(title) <= 300);
alter table public.problems drop constraint if exists chk_problems_description_len;
alter table public.problems add  constraint chk_problems_description_len check (description is null or char_length(description) <= 5000);
alter table public.problem_solutions drop constraint if exists chk_psol_title_len;
alter table public.problem_solutions add  constraint chk_psol_title_len          check (title is null          or char_length(title) <= 300);
alter table public.problem_solutions drop constraint if exists chk_psol_description_len;
alter table public.problem_solutions add  constraint chk_psol_description_len    check (description is null    or char_length(description) <= 5000);
alter table public.problem_solutions drop constraint if exists chk_psol_course_len;
alter table public.problem_solutions add  constraint chk_psol_course_len         check (course_context is null or char_length(course_context) <= 1000);

-- idea autopsies
alter table public.idea_autopsies drop constraint if exists chk_autopsy_project_len;
alter table public.idea_autopsies add  constraint chk_autopsy_project_len      check (project_name is null     or char_length(project_name) <= 200);
alter table public.idea_autopsies drop constraint if exists chk_autopsy_category_len;
alter table public.idea_autopsies add  constraint chk_autopsy_category_len     check (category is null         or char_length(category) <= 100);
alter table public.idea_autopsies drop constraint if exists chk_autopsy_domain_len;
alter table public.idea_autopsies add  constraint chk_autopsy_domain_len       check (domain is null           or char_length(domain) <= 100);
alter table public.idea_autopsies drop constraint if exists chk_autopsy_duration_len;
alter table public.idea_autopsies add  constraint chk_autopsy_duration_len     check (duration is null         or char_length(duration) <= 100);
alter table public.idea_autopsies drop constraint if exists chk_autopsy_investment_len;
alter table public.idea_autopsies add  constraint chk_autopsy_investment_len   check (total_investment is null or char_length(total_investment) <= 100);
alter table public.idea_autopsies drop constraint if exists chk_autopsy_root_len;
alter table public.idea_autopsies add  constraint chk_autopsy_root_len         check (root_cause is null       or char_length(root_cause) <= 3000);
alter table public.idea_autopsies drop constraint if exists chk_autopsy_story_len;
alter table public.idea_autopsies add  constraint chk_autopsy_story_len        check (story is null            or char_length(story) <= 5000);
alter table public.idea_autopsies drop constraint if exists chk_autopsy_lessons_len;
alter table public.idea_autopsies add  constraint chk_autopsy_lessons_len      check (key_lessons is null      or char_length(key_lessons) <= 3000);

-- pipeline ideas (free-text fields; gate/state are app-controlled but bounded as a backstop)
alter table public.pipeline_ideas drop constraint if exists chk_pipeline_title_len;
alter table public.pipeline_ideas add  constraint chk_pipeline_title_len    check (title is null    or char_length(title) <= 200);
alter table public.pipeline_ideas drop constraint if exists chk_pipeline_oneliner_len;
alter table public.pipeline_ideas add  constraint chk_pipeline_oneliner_len check (oneliner is null or char_length(oneliner) <= 300);
alter table public.pipeline_ideas drop constraint if exists chk_pipeline_problem_len;
alter table public.pipeline_ideas add  constraint chk_pipeline_problem_len  check (problem is null  or char_length(problem) <= 2000);
alter table public.pipeline_ideas drop constraint if exists chk_pipeline_solution_len;
alter table public.pipeline_ideas add  constraint chk_pipeline_solution_len check (solution is null or char_length(solution) <= 2000);
alter table public.pipeline_ideas drop constraint if exists chk_pipeline_startup_len;
alter table public.pipeline_ideas add  constraint chk_pipeline_startup_len  check (startup is null  or char_length(startup) <= 200);

-- polls + tags + team board
alter table public.poll_options drop constraint if exists chk_poll_label_len;
alter table public.poll_options add  constraint chk_poll_label_len check (label is null or char_length(label) <= 200);
alter table public.tags drop constraint if exists chk_tags_name_len;
alter table public.tags add  constraint chk_tags_name_len check (name is null or char_length(name) <= 60);
alter table public.team_posts drop constraint if exists chk_team_title_len;
alter table public.team_posts add  constraint chk_team_title_len       check (title is null       or char_length(title) <= 200);
alter table public.team_posts drop constraint if exists chk_team_startup_len;
alter table public.team_posts add  constraint chk_team_startup_len     check (startup is null     or char_length(startup) <= 200);
alter table public.team_posts drop constraint if exists chk_team_description_len;
alter table public.team_posts add  constraint chk_team_description_len check (description is null or char_length(description) <= 5000);
alter table public.team_posts drop constraint if exists chk_team_looking_len;
alter table public.team_posts add  constraint chk_team_looking_len     check (looking_for is null or char_length(looking_for) <= 1000);
alter table public.team_posts drop constraint if exists chk_team_commitment_len;
alter table public.team_posts add  constraint chk_team_commitment_len  check (commitment is null  or char_length(commitment) <= 200);
