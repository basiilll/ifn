# Running SQL in the dashboard (Studio)

Studio is the admin dashboard that comes with the backend. For a self-hosted setup it is at **http://localhost:8010** (the same address as the API, Kong serves both). It is the self-hosted version of the Supabase dashboard you may have seen in the cloud.

If it asks for a username and password, they are `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` from `selfhost/.env`.

## The two screens you will use most

### Table Editor

Left sidebar, **Table Editor**. A spreadsheet-style view of every table. Pick `profiles` to see members, `posts` to see feed posts, and so on. You can edit cells directly. Good for a quick look or a one-off change.

To see the login accounts, use **Authentication** in the sidebar instead (that reads the `auth` schema), or switch the Table Editor's schema dropdown from `public` to `auth`.

### SQL Editor

Left sidebar, **SQL Editor**. A box where you paste SQL and click **Run** (or press Ctrl+Enter). This is how you make the first admin, change roles, lock posting, and run health checks.

## The commands you need are in one file

Open `docs/sql/commands.sql` in this repo. It has ready-to-run blocks for:

- Making a user an admin (the first-admin bootstrap).
- Finding a user's id by email.
- Listing everyone and their role.
- Clearing the forced password change.
- Changing roles.
- Banning, restricting, unbanning.
- Locking and unlocking posting.
- Health checks (did the schema build correctly).
- Deleting a user.

Copy the block you want into the SQL Editor, replace the CAPITALS (like `PASTE-USER-ID-HERE`), and Run.

## The one you need on day one

After you make your login account in **Authentication -> Add user** (tick Auto Confirm), copy its id, then run this in the SQL Editor:

```sql
update public.profiles
set role = 'admin', onboarded = true, must_change_password = false
where id = 'PASTE-USER-ID-HERE';
```

That makes you an admin, skips the onboarding screen, and skips the forced password change. Now you can log in at http://localhost:5173/login and use the Admin Panel to add everyone else.

## Prefer the terminal?

You do not have to use Studio. You can run the exact same SQL from a Git Bash terminal straight against the database. See `docs/docker-sql.md`, it explains every part of the command.
