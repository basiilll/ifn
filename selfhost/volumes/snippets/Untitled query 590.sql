update public.profiles set role = 'admin', onboarded = true
where id = (select id from auth.users where email = 'basilambrosestevenson.bca24@ifheindia.org');