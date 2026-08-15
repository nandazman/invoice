# D1 sync — design

Mirror the local IndexedDB database into Cloudflare D1, so the data survives the
browser it was typed into and a second person can see it.

## The constraint everything else follows from

Every read in the app is **synchronous**, served off module-level arrays in
`src/lib/store.ts` that are hydrated once at boot from IndexedDB
(`src/lib/bootstrap.ts`). There is no async read path and we are not adding one.

Therefore:

- **IndexedDB stays the source of truth for reading.** Everyone reads locally.
- **A write lands in IndexedDB first, always, for everyone.** D1 is a mirror
  that follows. This is what makes offline writes free: offline just means the
  mirror lags.
- **A pull writes into IndexedDB**, then re-runs `readAll()` + the `hydrate*()`
  functions. It cannot bypass IndexedDB and feed the stores directly.

The role decides only **whether a local write is allowed to leave the device**
— and, since `permissions-plan.md`, whether the app opens at all.

## Identity and roles

Identity comes from **Cloudflare Access**, which already guards
`invoice.xutopia.my.id`. The Worker reads the `Cf-Access-Jwt-Assertion` header
and verifies it against the team's public keys. There is no application-level
login, no password table, no session cookie of our own.

> An earlier draft of this design had username/password accounts. Access makes
> all of that redundant — do not build it.

Two Access applications on the one hostname, scoped by path:

| Path | Access policy |
|---|---|
| `/api/admin/*` | the owner's email only |
| `/api/sync/*` | the wider allowed-email list |

**Why the API and not the page:** the app uses hash routing
(`createHashHistory()` in `src/router.tsx`). `/#/admin` never leaves the
browser — the server only ever sees `/`. No Access policy can scope to a hash
route. Real API paths do reach the server, so that is where enforcement lives.
The admin *page* is only pixels; it renders "tidak berwenang" when
`/api/admin/me` returns 403.

Roles live in a D1 `roles` table keyed by email:

- **not on the list** — blocked. Every endpoint returns 403 and the app shows a
  gate screen instead of itself.
- `write` — full use of the app; changes pull and push.
- `admin` — `write`, plus managing the `roles` table and the D1 dashboard.

> **Revised by `permissions-plan.md` (decision 3).** As first built this was a
> three-rung ladder whose bottom rung, `read`, could pull but not push, and got
> a read-only UI with an opt-in "Mode coba-coba" that re-enabled local editing
> on that device only. Both the rung and that mode have been deleted. Being on
> the list is now itself the grant, which is what makes blocking a non-listed
> user outright possible — see decision 4 for why gating one screen beat
> disabling editing across eleven pages.

`push` re-checks the role in D1 on **every** request rather than trusting the
role at token-issue time, so a demotion takes effect immediately. Writes are
rare; the extra query is free.

## Sync mechanism: watermark sweep

Every row carries `updatedAt`, and a soft delete bumps it (`tombstone()` in
`store.ts`). So one comparison catches inserts, updates and deletes:

> which local rows have a cursor newer than my last successful sync?

One sweep produces both readings, which is the point:

| the sweep result is | when |
|---|---|
| the **push set** | normally — sent to D1, then the watermark advances |
| the **divergence** set | when the push did not happen or did not succeed |

Local edits that have not reached the cloud therefore need no extra bookkeeping
— they are just a push set that has not been pushed, surfaced as "N baris lokal
berbeda dari cloud".

> As built, the second column was a permanent condition for the `read` role,
> which pulled but never pushed. With `read` deleted
> (`permissions-plan.md` decision 3) divergence is a transient state — offline,
> a rejected push, a row over D1's size cap — not a way of life.

**Offline is free.** A failed push does not advance the watermark, so
reconnecting resumes exactly where it stopped. There is no outbox to lose and
nothing to replay.

**The sweep reads Dexie, not the in-memory arrays.** Memory holds live rows
only, so a memory-based sweep would never push a delete.

### Conflicts

A pull skips any row whose id is in the local divergence set, and applies
everything else. The admin page lists the diverged rows with a "Buang perubahan
lokal" action that discards them and re-pulls clean. Nothing is lost without an
explicit click.

## Trigger

Every write in the app already funnels through `persist()` in `src/lib/db.ts`.
A `scheduleSync()` call there covers all ~34 call sites without touching any of
them.

`db.ts` must **not** import the sync client — that would be a cycle
(`db -> sync -> db`). Use the callback-registration pattern `db.ts` already uses
for `onPersistError`: expose `onWrite(handler)`, and let the sync module
register itself at boot.

## Schema

`src/lib/sync/tables.ts` is the single shared description of the wire format and
the D1 columns, compiled by **both** the client and the Worker. It already
exists — read it first, and do not restate its contents anywhere else.

`createdBy` / `updatedBy` are server-stamped from the verified Access email and
ignored if present in a request body. They are **not** in `spec.columns`, which
is what makes "a push can never carry them" mechanical rather than a promise —
but they do ride along on **pull**, by an explicit separate path, so the tables
can show who touched a row. See the ATTRIBUTION block in that file.

## Cost note

`wrangler.jsonc` is currently a static-assets-only Worker with **no script**, on
purpose, so requests never count as Worker invocations. Adding `main` ends that.
Only `/api/*` executes the script, and `run_worker_first: ["/api/*"]` is
required — without it `not_found_handling: "single-page-application"` returns
`index.html` for the API routes and swallows them.
