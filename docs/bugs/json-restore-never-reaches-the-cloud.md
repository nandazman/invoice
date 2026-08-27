# A JSON restore never reaches the cloud

**Status:** addressed by `replaceCloudWithLocal()` in the working tree, not yet
deployed. The underlying invisibility of a restore is unchanged and deliberate.
**Files:** `src/lib/backup.ts`, `src/lib/store.ts`, `src/lib/sync/client.ts`

## Symptom

> "somehow when i still have duplicate product, i backup using json, it does not
> replace the data on cloud that duplicate"

The user had duplicate products (see
[the starter catalogue bug](starter-catalogue-reseeded-on-a-synced-device.md)),
fixed them locally by restoring a clean JSON backup, and the duplicates came
straight back — and were still in the cloud for everyone else.

## What it actually was

Two independent causes. Either alone is enough.

### 1. A restore's rows are older than the watermark

The sweep decides what is pending by comparing each row's cursor against a
scalar per-table watermark (`sweepTable`, `client.ts:376`):

```ts
if (since !== null && value <= since) continue;
```

`importAll` preserves ids **and timestamps** — a backup's rows carry the
`updatedAt` they had when they were written, which is by definition older than
the watermark of a device that has synced since. `setProducts` and its siblings
map through `fresh()` (`db.ts:242`), which clears attribution and deliberately
**does not** bump `updatedAt`.

So after a restore the backlog reads as empty. Nothing is pending, nothing is
pushed, and the chip is telling the truth when it says everything is synced.

### 2. A restore deletes rows without tombstones

`setProducts(next)` does `db.products.clear()` then `bulkPut(rows)`
(`store.ts:109`). Rows that the restore removed simply cease to exist locally —
no `deletedAt`, no row at all.

Deletes travel as tombstones. A row that vanishes without one is not a delete
the mirror can ever hear about, so the cloud keeps every row the restore
removed, and hands them all back on the next full pull.

Together: a restore is **entirely invisible to sync**. It is a local-only
operation that looks like a global one.

## Fix

Not by changing what a restore does — bumping every timestamp on import would
make a restore win every conflict on every device, which is worse — but by
giving the user an explicit way to say "the cloud should look like this device":

`replaceCloudWithLocal()` (`client.ts:841`), behind the **Kirim ke cloud**
button and a confirmation dialog:

1. Pull the entire cloud (`since = null` for every table).
2. For every row present in the cloud and absent locally, write a **local
   tombstone** — not a server-side delete.
3. Reset the watermarks to `{}` so the whole local database is pending.
4. Push, then settle with a normal pull.

Step 2 is the part that is easy to get wrong. A `DELETE FROM` in the Worker
would clear D1 while every other device still held its copy above its own
watermark, and the first device to sync would push it all straight back. A
tombstone is the only form of "this is gone" that other devices can receive.

`audit` is skipped (append-only, no `deletedAt` — history is not retracted) and
so is `types` (cursorless, replaced wholesale by every push anyway).

## Lesson

"The chip says synced" and "the cloud matches this device" are different claims.
The watermark design can only answer the first one, and any operation that
rewrites the local database wholesale — a restore, an import, a migration —
falls outside what it can see.
