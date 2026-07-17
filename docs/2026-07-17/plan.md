# Plan — 2026-07-17

Move core business data out of **localStorage** and into **IndexedDB** (via
Dexie), stored as **one record per row** rather than one JSON blob per table.
Add a `deletedAt` tombstone field to every stored entity.

> Scope: storage layer only — `storage.ts`, `store.ts`, `audit.ts`,
> `template-store.ts`, `backup.ts`, `main.tsx`, plus `deletedAt` on the entity
> types. **No page/route changes.** Sync (WebRTC/Drive), pagination, and web
> workers are explicit **non-goals**; see "Not in this change" below.

## The problem we actually have

localStorage caps at **~5 MB per origin** and fails **hard** — a `setItem` past
the cap throws `QuotaExceededError` and the write is simply lost.

We are already hitting this. `template-store.ts:26-35` exists solely to catch it:

```ts
function write(list: Template[]): void {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
  } catch (e) {
    // Most likely QuotaExceededError — surface it so the user knows the save failed.
    alert("Gagal menyimpan template. Penyimpanan browser penuh — ...");
    throw e;
  }
}
```

The dominant consumer is **templates**, whose `business.logo` and image elements
are stored as **base64 data URLs** (`template-types.ts` `PLACEHOLDER_LOGO`,
`TemplateElement.src`). Base64 inflates binary by ~33% and then gets embedded in
a JSON string. A handful of logos can eat the entire 5 MB budget, at which point
**every store in the app** starts failing to save — not just templates, because
the 5 MB is shared across the whole origin.

Row data (orders/stock/purchases) is a secondary concern: at ~200 bytes/row the
5 MB cap works out to roughly **25k rows total**. Real, but not what is biting
us today.

## Why not just swap localStorage for IndexedDB behind `read`/`write`

Because that keeps the thing that makes writes expensive. Today every mutation
rewrites the **whole table**:

- `store.ts:330` — `setStock([...stock, {...m}])`
- `storage.ts:29` — `localStorage.setItem(key, JSON.stringify(value))`

So adding **one** stock movement copies the entire array, `JSON.stringify`s the
entire array, and writes the entire array — three O(n) passes per row inserted.
Keeping the blob shape on IndexedDB converts a *hard failure* into a *gradual
slowdown*, which is better, but leaves the cost curve intact:
`JSON.stringify` on ~20 MB is >100 ms of blocked main thread, on every single
order added.

The `JSON.stringify` is **not a design decision** — it is a localStorage
artifact. localStorage stores only strings, so serialization was mandatory.
IndexedDB stores structured objects natively (structured clone). Rows should be
rows.

## The invariant we want

> **Write cost is proportional to the row being written, never to the size of
> the table.** Adding one order costs the same whether the table holds 10 rows
> or 10 million.

## Design

### 1. Per-row object stores, but keep the in-memory arrays

This is the key decision, and it is what keeps the change small.

- **IndexedDB holds rows**, one record per entity, with indexes.
- **`hydrate()` bulk-reads every live row into memory once, at boot.** One
  sequential read per table.
- **The in-memory arrays and the synchronous API stay exactly as they are.**
  `useProducts()`, `getOrders()`, `computeFifo` — all still synchronous, all
  still reading module-level arrays.
- **Mutations write a single row** (`table.put(row)`), not the table.

What this buys:

| | Blob per table | **Per-row (this plan)** |
| --- | --- | --- |
| Write cost per mutation | O(table) | **O(1)** |
| Boot read | whole table | whole table (once) |
| Route changes needed | none | **none** |
| Pagination possible later | no | **yes** |

The `[...orders, x]` in-memory copy and the `emit()` re-render stay O(n). That
is ~1 ms at 100k rows and is deliberately **not** addressed here — it is the
next ceiling, not this one.

### 2. Boot becomes async — the one structural change

`store.ts:24-28` initializes synchronously at module import:

```ts
let products: Product[] = loadProducts();   // sync read — impossible on IDB
```

IndexedDB has no synchronous read, so this moves into a `hydrate()` awaited in
`main.tsx` before the first render. After hydration everything downstream is
unchanged.

### 3. Writes are fire-and-forget (the UI is already optimistic)

`setProducts` already updates memory and `emit()`s *before* persisting — the UI
never waits on storage. That stays. Mutations keep their **synchronous
signatures**, so no route changes: update memory → `emit()` → kick off the IDB
write → surface failures via `onPersistError`.

This does introduce a real gap: a write that fails now fails *after* the UI
showed success. Handling: a persist-error callback the shell can surface. We are
**not** implementing rollback — for a single-user local app, a visible "save
failed" is proportionate, and IDB writes failing at all is close to a
disk-full/corruption scenario.

### 4. Cascades get real transactions

One user action is not one write. `store.ts:166-206` (`addOrder`) writes the
order **plus** a stock movement **plus** an audit entry. Under localStorage
these were three unrelated `setItem`s with no atomicity — a crash between them
left inconsistent data, silently.

Every cascade goes in **one Dexie transaction**: `addOrder`, `addPurchase`,
`deleteOrder`/`deleteOrders` (which also drop linked movements, `store.ts:228`),
`deletePurchase`/`deletePurchases` (`store.ts:301`). This is strictly better
than what we have.

### 5. `deletedAt` — soft deletes

Every stored entity except `AuditEntry` (append-only, never deleted) gets
`deletedAt: string | null`. Deleting stamps it instead of dropping the row.

**Why now, given we are not building sync yet:** a delete currently destroys
information irrecoverably (`store.ts:143`, `:225`, `:300` all just `filter()`).
Once the row is gone, "row absent" is ambiguous — it cannot be distinguished
from "row never existed". Any future merge, undo, or delete-history feature is
impossible without this, and retrofitting it later means a **second** schema
migration over live data. It is nearly free to add now.

**Containment — no page filters `deletedAt`:** the in-memory arrays hold **live
rows only**. `hydrate()` filters tombstones out; `delete*` removes the row from
memory *and* writes the tombstone to IDB. Nothing downstream of `store.ts` ever
sees a tombstone, so no route, table, or aggregate needs a `.filter(r =>
!r.deletedAt)`. Tombstones exist only in IndexedDB.

### 6. Migration — copy, verify, *then* stop reading the old keys

One-time, on first boot after this ships:

1. If the IDB `meta` flag `migrated.v1` is set → skip.
2. Read via the **existing** `load*()` functions in `storage.ts` — they already
   back-fill every legacy field (`tipe`, `hargaDasar`, `productId`, timestamps;
   `storage.ts:41-48`, `:75-82`). Reuse, do not reimplement.
3. Backfill `deletedAt: null` on every row.
4. `bulkPut` into IDB, inside one transaction per table.
5. **Verify** — re-read counts and compare against the source.
6. Only then set the `migrated.v1` flag.

**The legacy localStorage keys are NOT deleted.** The original plan called for
wiping them; we are keeping them for at least one release. They are ≤5 MB by
definition, the flag already stops us reading them, and they are the only
rollback path if migration proves buggy in the field. A later release removes
them once this has run clean.

Order matters: verify *before* setting the flag, and never delete the source
before the verified write. A wipe-first sequence that fails mid-way loses the
data outright.

### 7. Persistent storage

IndexedDB defaults to **best-effort** — the browser may evict it under disk
pressure. This is uninvoiced business data with no server behind it. Call
`navigator.storage.persist()` during bootstrap.

### 8. Backup/restore must keep working — including existing files

Non-negotiable: **backup files already sitting on disk must still restore.**

`BACKUP_VERSION` goes **2 → 3** (`deletedAt` added). But `importAll` currently
rejects anything that is not an exact match (`backup.ts:84`):

```ts
if (data.version !== BACKUP_VERSION) throw new Error(...);
```

That would reject every v2 backup the user already has. Instead **accept v2 and
upgrade on read** — backfill `deletedAt: null` — and reject only unknown/future
versions. v3 files must round-trip byte-identically.

This change also **removes a wart**. `backup.ts:28-29` and `:100-101` reach
straight into localStorage for `types`/`templates` because those stores expose
no setter, forcing the caller to reload the page (`backup.ts:76-80`). With both
stores on Dexie, `importAll` can call real setters and the reload hack goes
away.

## Not in this change

Named explicitly, because they were in the original three-phase plan:

- **WebRTC/PeerJS sync.** Sync is periodic, not live — WebRTC's only advantage
  (liveness, LAN, no account) does not apply.
- **LWW / delta manifests / tombstone merge.** Only **one device writes**; the
  other reads. Single-writer means full-snapshot replace, and in a complete
  snapshot from a single authority, absence *is* the deletion — nothing to
  merge. `exportAll`/`importAll` already implements this.
- **Google Drive.** Convenience on top of a backup flow that already works
  manually. Sequenced after this.
- **Pagination / dropping the in-memory arrays.** Not needed at this scale; the
  per-row schema leaves the door open.
- **Web workers.** Once `JSON.stringify`-per-write is gone there is nothing
  left to offload. (`exportAll` at `backup.ts:71` — full DB, pretty-printed —
  remains the one genuine worker candidate, later.)
- **Read-only mode** for the reader device. Required before any sync ships;
  not required by this change.

## Risks

| Risk | Mitigation |
| --- | --- |
| Migration corrupts/loses data | Verify-then-flag; legacy keys retained as rollback |
| Existing v2 backups rejected | `importAll` accepts v2 and upgrades on read; test |
| Async boot regresses first paint | One bulk read per table; measure |
| Silent write failure after optimistic UI | `onPersistError` surfaced in the shell |
| IDB evicted by browser | `navigator.storage.persist()` |
| Private mode / IDB unavailable | Detect at bootstrap, surface a clear error |
