# D1 as the only source of truth

Supersedes `docs/2026-08-15/sync-plan.md` (the local-first mirror design).
Written 2026-10-02.

## Decision

D1 is the only place data lives. The browser keeps **nothing durable**: no
IndexedDB, no watermarks, no local copy of any business table.

What goes away, and why it is safe to say so out loud:

| Gone | Because |
|---|---|
| IndexedDB / Dexie (`db.ts`) as storage | nothing durable lives in the browser |
| Watermark sweep, push set, divergence set | there is no second copy to diverge |
| "Buang perubahan lokal", `replaceCloudWithLocal` | nothing local to discard or push up |
| The whole-table `clear()` on `setOrders` etc. | the 2026-09-07 loss class cannot occur: a write either reached D1 or it errored in front of the user |
| `rescue.ts` (unsynced-row rescue) | no unsynced rows exist |
| Panel **Cadangan** (export/restore JSON in `RootLayout`) and `backup.ts` | backups are D1 exports, taken by the owner (see below) |
| Status chips **tersinkron** / **tersimpan lokal** (`SyncChip`) | one state only; replaced by a plain "Menyimpan…" / error toast |
| `localStorage` migration code, `scripts/copy-localstorage.js`, `paste-localstorage.js` | legacy, already migrated |

## The constraint, restated

Every read in the app is **synchronous**, served off the module-level arrays in
`src/lib/store.ts`. We still do not add an async read path. So the arrays stay,
but their meaning changes: they are a **cache of D1, held in memory only**, not
a database.

- **Boot:** `GET /api/sync/pull` (no `since`) → fill the arrays → render. If it
  fails, show a blocking error with "Coba lagi"; the app does not open on stale
  or empty data.
- **Write:** optimistic. Update the in-memory array and the screen immediately,
  mark the row "menyimpan", and send the push in the background. On success the
  mark clears; on failure the row **rolls back** and the user sees an error with
  their input restored so they can retry. Never a silent background retry — the
  rollback is what keeps "looks saved but is not" from happening. This keeps
  saves feeling instant despite the network round trip (~100–400 ms).
- **Other people's changes:** keep the polling already built in
  `sync/client.ts`: `pull?since=<serverTime>` every 60 s (`POLL_MS`), skipped
  while the tab is hidden or offline, plus an immediate pull when the tab
  becomes visible (at most once per 10 s, `VISIBILITY_MIN_MS`). Merge rows by id
  (soft deletes arrive as `deletedAt` and drop out of the array). `since` is
  held in memory; a reload does a full pull. Each tab polls for itself: the
  leader election in `tabs.ts` existed only to serialize pushes, and with
  optimistic writes going straight to the API there is nothing to serialize.
  A rollback in one tab does not need to be coordinated with other tabs.
- **Offline:** the app is read-only-stale at best. Recommend: show a banner
  "Offline — perubahan tidak bisa disimpan" and disable save buttons. No queue.
  This is the real cost of the decision; see *Open decisions*.

## Write path

Today every write goes `store.ts → persist() → Dexie`, and `scheduleSync()`
mirrors it. New shape:

```
store.ts mutation
  → api.put(table, rows)        POST /api/sync/push  (existing endpoint)
  → on 2xx: update the array, emit()
  → on error: throw; the caller surfaces it
```

Keep the existing push endpoint and its idempotent upserts, role re-check, and
server-stamped `createdBy`/`updatedBy`. `tables.ts` stays the single wire-format
description. Mutations that touch several tables (order → Beli Stok creates a
purchase + stock movements + audit) must go in **one** push request.

**Make the push atomic.** `BATCH_SIZE = 50` chunking in `worker/sync.ts` was the
leading suspect for the 2026-09-07 loss (a partial landing read as failure). With
user-facing writes of a handful of rows, send each push as a single
`db.batch()`; keep chunking only for the one-time legacy upload below, and make
that path report exactly which chunks landed.

**Audit entries** are rows like any other and travel in the same request as the
change they describe, so "change landed but its audit did not" (the Fructose
anomaly) cannot happen.

## Cutover

Decided 2026-10-02: **no migration of leftover local data.** The new client
never reads or deletes the old browser database; any rows a device had not yet
synced stay untouched in that browser and are simply not used. (A one-time
upload-and-delete was built and then removed at the owner's request.)

## Backups (replaces the Cadangan panel)

The JSON export/restore UI is removed. Backup is an operator action:

- `bun run d1:export` → `backup/d1-export-<date>.sql`, taken **before every
  deploy that changes schema or the write path**, and on a schedule if wanted
  (a Cloudflare Cron Trigger can run D1 Time Travel; D1 also keeps 30 days of
  point-in-time restore, `wrangler d1 time-travel`). Document restore in
  `docs/cloudflare.md`.
- The admin page keeps a single "Unduh cadangan (.sql)" button only if the
  owner wants one; otherwise it is CLI-only.
- `data-loss-rules.md` R-rules about `clear()` and unsynced export become
  historical; keep the file, add a pointer to this doc, and keep the two that
  still apply: **destructive confirmations state the row count**, and **export
  before hand-written SQL against remote D1**.

## Release procedure (what "finish local, back up, deploy" means)

Order is not negotiable:

1. Implement and run everything **locally**: `bun run d1:migrate:local`,
   `wrangler dev`, click through every page (orders, Buat Invoice, Beli Stok,
   stock, reports, harga, admin), `bun run test`, `bun run build`.
2. `bun run d1:export` → move the file into `backup/` with the date. Confirm it
   is non-empty and contains the six real tables' rows.
3. If any migration is part of this change, apply it **before** deploying a
   client that names the new column (`migrations/0004_order_modal.sql` explains
   why). `deploy:cf` runs `d1:migrate` first, but check the migration by hand
   against the export from step 2.
4. `bun run deploy:cf`.
5. Smoke test production: boot, one write, reload and see it, second browser
   sees it after a poll. Keep the step-2 export until the next one is taken.

## Work breakdown

1. `src/lib/api.ts`: thin typed client for pull/push with error mapping.
2. `store.ts`: replace `persist()`/Dexie writes with awaited API writes;
   hydrate from pull. Delete `setOrders`-style `clear()` helpers.
3. `bootstrap.ts`: boot = pull; drop `migrateFromLocalStorage`, persistence
   request, `isAvailable`.
4. Reduce `client.ts` to poll + merge (keep the interval and visibility rules);
   delete the sweep/push/watermark code and `tabs.ts`.
5. UI: remove Cadangan panel, `SyncChip` states, "Buang perubahan lokal", the
   rescue/backup dialogs in `RootLayout`; add saving/error/offline states per
   `DESIGN.md`.
6. Worker: single-batch push; keep roles/Access untouched.
7. Legacy upload-and-delete boot check (Release B), with tests for the partial
   failure path.
8. Tests: rewrite `store.test.ts`, drop `db.test.ts`, `rescue.test.ts`,
   `backup.test.ts`, `sync/tabs.test.ts`; slim `client.test.ts` to poll/merge.
9. Docs: mark `sync-plan.md` superseded; update `README.md`, `docs/cloudflare.md`.

## Decisions (2026-10-02)

1. **Offline: not supported.** No queue, no read-only mode to design. If a
   write fails the user sees the error and retries; if boot fails they see
   "Coba lagi". A small "tidak ada koneksi" banner is the most we add.
2. **Backup: CLI only.** No download button in the app (`bun run d1:export`).
3. **Devices: up to 5.** Release A's "everyone has synced" check is five people
   opening the app once; the Release B boot-time upload covers anyone who misses it.
4. **Libraries.** Keep `@tanstack/react-table` (rendering only, unrelated to
   where data lives). Do **not** add TanStack Query: every component reads
   synchronously from `store.ts` via `useSyncExternalStore`, and Query would
   make every read async (loading/error states on all pages) to solve a problem
   the in-memory cache already solves. Revisit only if we ever drop the
   synchronous store.
5. **Poll interval:** unchanged, 60 s + on visible; no realtime channel.
6. **Cloudflare free plan** (10 ms CPU/request, 100k requests/day, 5M D1 rows
   read/day). Polling is far inside the limits (~6k requests/day for 5 devices,
   indexed `updatedAt` cursors). The one watch item is the **uncapped boot
   pull**, whose JSON serialization could approach 10 ms CPU as the `audit`
   table grows. Not urgent; if it bites, trim old audit rows from the first
   pull or pull tables separately. Check the D1 rows-read counter after the
   first day in production.
