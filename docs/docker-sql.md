# Running SQL from the terminal (Docker)

You can run SQL against the database without opening Studio, straight from a Git Bash terminal. This is handy for scripts, quick checks, and backups.

Run all of these from inside the `selfhost` folder:

```bash
cd ~/ifn-login-only/selfhost
```

## The basic command

```bash
docker compose exec -T db psql -U postgres -d postgres -c "select count(*) from public.profiles;"
```

Here is every piece of that, left to right:

| Piece | What it means |
|---|---|
| `docker compose` | The tool that manages our stack of containers |
| `exec` | "Run a command inside a container that is already running" |
| `-T` | Do not allocate a fake terminal. You need this when piping input or running from a script. Leave it out only for an interactive session. |
| `db` | The name of the container to run inside (our database container) |
| `psql` | The Postgres command-line client. Everything after this is psql's own arguments. |
| `-U postgres` | Connect as the database user `postgres` (the superuser) |
| `-d postgres` | Connect to the database named `postgres` (our app lives here) |
| `-c "..."` | Run this one SQL command, print the result, and exit |

So in plain words: "inside the running db container, open the Postgres client as the postgres user on the postgres database, run this one query, and quit."

## Useful variations

### Run a whole .sql file

Feed a file in on standard input with `<`:

```bash
docker compose exec -T db psql -U postgres -d postgres < ../docs/sql/commands.sql
```

`< ../docs/sql/commands.sql` means "send the contents of that file to the command as if you typed it". This is exactly how `apply-schema.sh` loads each schema file.

### Open an interactive session (type queries one by one)

Drop the `-T` and the `-c`:

```bash
docker compose exec db psql -U postgres -d postgres
```

Now you get a `postgres=#` prompt. Type SQL ending in `;` and press Enter. Type `\dt` to list tables, `\du` to list users, and `\q` to quit.

### Make the output readable

Add `-P pager=off` for long results, or `-x` to print one column per line (good for wide rows):

```bash
docker compose exec -T db psql -U postgres -d postgres -x -c "select * from public.profiles limit 1;"
```

- `-x` is "expanded" output, each field on its own line.

### Quiet, script-friendly output (just the value)

```bash
docker compose exec -T db psql -U postgres -d postgres -tAc "select count(*) from public.profiles;"
```

- `-t` removes the header and the row-count footer.
- `-A` removes the column-aligning whitespace.
- `c` is the same `-c` as before, glued on.

You get back just `42` with no decoration, which is what you want inside a script.

## Backing up the database

Make a full backup file (do this before anything risky):

```bash
docker compose exec -T db pg_dump -U postgres -d postgres > backup_$(date +%Y%m%d).sql
```

- `pg_dump` is the backup tool (instead of `psql`).
- `> backup_....sql` writes the output to a file on your machine. The `$(date ...)` part stamps today's date into the filename.

Restore it later by feeding it back in:

```bash
docker compose exec -T db psql -U postgres -d postgres < backup_20260620.sql
```

## Why `docker compose exec` and not just `psql`

`psql` is not installed on Windows by itself, and the database only listens inside Docker. `docker compose exec db` runs the client that already lives inside the database container, so you do not have to install anything. The database also publishes port `5443`, so if you prefer a graphical tool like DBeaver or pgAdmin, point it at `localhost:5443`, database `postgres`, user `postgres`, password from `selfhost/.env`.
