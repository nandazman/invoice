# Looking at the D1 data

From `permissions-plan.md` §E and decision 6.

The question this answers is "where is the pgAdmin for this?" — and the honest
answer has two halves, because local and production are not the same kind of
thing at all.

## Why there is no live GUI for production

**D1 has no wire protocol.** It is HTTP-only. There is no port to point a client
at and no connection to hold open, so nothing in the pgAdmin / TablePlus /
DBeaver family can ever attach to the production database the way it attaches to
a Postgres server. This is not a missing feature that might land later; it is
what D1 is.

What exists instead:

| | what it is | how you look at it |
|---|---|---|
| **local** | a real SQLite file on your disk | open it in any SQLite GUI |
| **production** | rows behind an HTTP API | one-off queries, or snapshot it down |

Per decision 6 in `permissions-plan.md`, we do not introduce a Cloudflare API
token to get anything better. A snapshot is the supported way to look at
production data, and it costs no new secret.

## The local database is an ordinary SQLite file

`wrangler dev` runs D1 through miniflare, which keeps the whole database in one
SQLite file under `.wrangler/`. Verified path in this repo:

```
.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite
```

The `<hash>` is derived from the binding, not from the database name, and it
changes if the binding is renamed or the local state is wiped — which is why the
helper globs for it rather than hardcoding it. Do not paste a hash you found in
a document into anything.

```bash
bun run d1:path
```

prints the full path, ready to paste into a file-open dialog. If the local
database has never been created it says so and points at `d1:migrate:local`,
rather than printing a path to a file that does not exist.

Alongside it sits `metadata.sqlite`, which is miniflare's own bookkeeping — not
your data. `d1:path` filters it out.

### Viewers that work

- **DB Browser for SQLite** — the closest thing to pgAdmin here. Free, browses
  tables, runs SQL, edits rows in a grid.
- **DBeaver** — heavier, but if you already have it open for something else its
  SQLite driver reads this file fine.
- **TablePlus** — nicer to look at, free tier is limited to a couple of tabs.
- **The VS Code SQLite extension** — no context switch, good enough for a quick
  `SELECT`.

All four open the same file; none of them are doing anything special.

### Stop `wrangler dev` first

Both processes want the same write lock. If the dev server is running while a
GUI holds the file open you get `database is locked` errors, on whichever side
loses — sometimes in the app, sometimes in the viewer, and the message does not
tell you the other process is the cause. Close one before opening the other.

## Ad-hoc SQL

```bash
bun run d1:sql "SELECT email, role FROM roles"          # local
bun run d1:sql:remote "SELECT email, role FROM roles"   # production
```

> **The `:remote` suffix means production here, and that is the opposite of
> `d1:migrate`.** `d1:migrate:local` / `d1:migrate` were named the other way
> round. For queries the unsuffixed name is the safe one, deliberately: a
> mistyped `d1:sql` reads your laptop's copy, not the live database. Read the
> suffix before you press enter on anything with `DELETE` in it.

## Snapshotting production

```bash
bun run d1:export
```

writes `d1-export.sql` in the repo root — a full dump, schema and data. It is
gitignored (`/d1-export*.sql`, kept narrow so `migrations/*.sql` stays tracked),
and it contains real customer data, so treat the file as you would a database
backup: do not paste it into a chat, do not attach it to an issue.

To browse the snapshot, load it into a scratch SQLite file and open that:

```bash
sqlite3 snapshot.sqlite ".read d1-export.sql"
```

The same dump is what `permissions-plan.md` calls for before applying migration
`0002` remotely — a pre-migration backup and a look at production data are the
same command.

The other two ways to see production, neither of which needs anything from this
repo: the D1 console in the Cloudflare dashboard, and
`bunx wrangler d1 execute invoice --remote --command "..."` directly.

## Scripts, in one place

| script | target | does |
|---|---|---|
| `d1:path` | local | print the `.sqlite` path for a GUI |
| `d1:sql` | local | ad-hoc SQL |
| `d1:sql:remote` | **production** | ad-hoc SQL |
| `d1:export` | **production** | snapshot to a gitignored `d1-export.sql` |
| `d1:migrate:local` | local | apply migrations |
| `d1:migrate` | **production** | apply migrations |
