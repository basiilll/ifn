-- Onboarding: first-time users complete their profile before using the app.
-- New signups get onboarded=false (column default; the handle_new_user trigger does not set it);
-- they finish the onboarding form which flips it to true. Run in Supabase.

alter table public.profiles add column if not exists onboarded boolean not null default false;

-- Safe backfill: existing members who already have profile data are past onboarding.
-- Idempotent (only touches rows with data), so re-running never re-prompts a fresh signup.
update public.profiles set onboarded = true
where onboarded = false
  and (coalesce(region, '') <> '' or coalesce(sector, '') <> '' or coalesce(domain, '') <> ''
       or coalesce(bio, '') <> '' or coalesce(startup, '') <> '' or coalesce(phone, '') <> '');
