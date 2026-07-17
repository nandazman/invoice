# Tasks — 2026-07-17

Migrate core data from localStorage to IndexedDB (Dexie), one **record per row**,
and add `deletedAt` to every stored entity. See `plan.md` for why per-row rather
than JSON-blob, why `deletedAt` lands now, and what is explicitly out of scope.

**Invariant:** write cost is proportional to the row written, never to the size
of the table.

**Containment rule:** the in-memory arrays hold **live rows only**. No route,
table, or aggregate may filter on `deletedAt` — if one needs to, the containment
leaked.

## 0. Dependency

- [x] `bun add dexie` (4.4.4).

## 1. Schema — `deletedAt` on the entity types

- [x] `src/lib/types.ts`: add `deletedAt: string | null` to `Product`,
      `OrderItem`, `PurchaseItem`, `StockMovement`. Header comment states the
      soft-delete convention and the containment rule.
- [x] `src/lib/template-types.ts`: add `deletedAt` to `Template`.
- [x] Deliberately **not** on `AuditEntry` — append-only, never deleted.
- [x] Row-construction sites the compiler flagged: `AddItemForm`,
      `AddMovementForm`, `AddPurchaseForm`, `ProductDialog`, `seed.ts`,
      `purchaseFromOrder.ts`.

## 2. `src/lib/db.ts` (new)

- [x] Dexie subclass + schema. Tables: `products`, `orders`, `purchases`,
      `stock`, `templates`, `audit`, `types`, `meta`.
- [x] Indexes to serve existing access patterns: `orders.productId`,
      `orders.tanggal`, `stock.productId`, `stock.orderId`, `stock.purchaseId`,
      `purchases.productId`, `audit.timestamp`, plus `deletedAt` per soft-
      deletable table.
- [x] `readAll()` — one bulk read per table; filter `deletedAt === null` into
      the in-memory arrays.
      **Gotcha found:** IndexedDB **cannot index null**, so every live row is
      absent from the `deletedAt` index. That index can only find *tombstones*
      (which is what `purgeTombstones` uses it for); live rows are filtered in
      JS. Documented at the schema.
- [x] `migrateFromLocalStorage()` — flag check → read via the existing
      `storage.ts` loaders → backfill `deletedAt: null` → `bulkPut` per table in
      a transaction → **verify counts** → *then* set `meta.migrated.v1`. Legacy
      keys **not** deleted.
- [x] `requestPersistence()` — `navigator.storage.persist()`, best-effort.
- [x] `isAvailable()` — actually opens the db (private mode exposes the API but
      throws on open).
- [x] `persist()` / `onPersistError()` — fire-and-forget write + failure hook.
- [x] `flushWrites()` — awaits in-flight writes. **Tests need this:** the store
      API is synchronous, so without it a test cannot distinguish "the write
      landed" from "the write was never issued".
- [x] `purgeTombstones(days)` — not wired to anything yet; the only consumer of
      the `deletedAt` index.

## 3. `src/lib/storage.ts` — demoted to legacy reader

- [x] Kept the `load*()` functions as the migration's source of truth (they
      carry every legacy field back-fill). Module marked legacy/migration-only.
- [x] Dropped the `save*()` writers — nothing writes to localStorage now.
- [x] **`loadProducts` no longer seeds.** It used to write the seed back to
      localStorage as a side effect *of a read*; the fresh-install seed moved
      into `db.ts` where it belongs.
- [x] Added `hasLegacyData()` / `LEGACY_KEYS` — distinguishes "existing install,
      migrate" from "fresh install, seed".
- [x] UI state left alone in localStorage: `RootLayout.tsx:48-73`, `columns.ts`.

## 4. `src/lib/store.ts` — per-row writes, soft deletes

- [x] Module-init `load*()` replaced by `hydrateStores(snapshot)`.
- [x] Mutations keep **synchronous signatures**; memory → `emit()` →
      fire-and-forget `put`.
- [x] `upsertProduct`, `addOrder`, `addPurchase`, `addMovement`,
      `setOrderStatus`, `addType` → single-row `put`.
- [x] `deleteProduct`, `deleteOrder(s)`, `deletePurchase(s)`, `deleteMovement` →
      stamp `deletedAt`, drop from memory, `put` the tombstone.
- [x] Cascades in **one transaction** each: `addOrder` (order + movement +
      audit), `addPurchase`, `deleteOrders`, `deletePurchases`.
      `deleteOrder`/`deletePurchase` now delegate to the plural form — one code
      path, so the single and bulk cases cannot drift.
- [x] Bulk `setProducts`/`setOrders`/`setPurchases`/`setStock`/`setTypes` kept
      for replace-all → `clear()` + `bulkPut` in one transaction.
- [x] Added `getTypes()` so `backup.ts` no longer reads localStorage.

## 5. `src/lib/audit.ts` + `src/lib/template-store.ts`

- [x] `audit.ts`: appends **one row** instead of rewriting the whole log.
- [x] **`logAudit` no longer persists** — it returns the entry, and the caller
      writes it inside its own transaction. An audit entry must commit with the
      mutation it describes; logging separately would reintroduce the torn write
      that transactions exist to prevent.
- [x] `auditRow()` — shared stock-movement entry builder (`addMovement`,
      `addOrder`, `addPurchase`).
- [x] `template-store.ts`: Dexie-backed; `deleteTemplate` soft-deletes;
      `putTemplate` writes one row.
- [x] Removed the `QuotaExceededError` alert — the bug it reported is what this
      change fixes.
- [x] `setTemplates` exported for Restore.

## 6. `src/lib/backup.ts` — round-trip survives the schema change

- [x] `BACKUP_VERSION` 2 → 3.
- [x] **`importAll` accepts v2 AND v3.** v2 → upgraded on read by backfilling
      `deletedAt: null`. Only unknown/future versions rejected. The old exact-
      match check would have refused every backup file already on disk.
- [x] v3 → v3 round-trips identically (IDs preserved).
- [x] Direct localStorage reads/writes replaced with real getters/setters.
- [x] "CALLER MUST RELOAD THE PAGE" contract deleted — every store is reactive.
- [x] Still validates **before** touching any store.
- [x] Tombstones are never exported: the stores hold live rows only, and a
      delete that already happened is not something a restore needs to replay.

## 7. `src/lib/io.ts` — per-page JSON import

- [x] All four parsers stamp `deletedAt: null`. Unchanged otherwise — still the
      interchange format, still regenerates IDs.

## 8. `src/main.tsx` + `src/lib/bootstrap.ts`

- [x] `bootstrap.ts` (new): migrate → `readAll` → hydrate all three stores →
      `requestPersistence`. Separate module because the stores import `db` to
      write, so `db` cannot import the stores to hydrate them.
- [x] `main.tsx` awaits `bootstrap()` before the first render.
- [x] Boot-error screen. A boot failure means we could not read the user's data;
      rendering empty tables anyway is indistinguishable from data loss and the
      user might start typing into them.

## 9. Tests — 72 passing

- [x] `db.test.ts` (12): fresh install seeds without writing to localStorage;
      every table copies; `deletedAt` backfilled; **legacy keys survive**;
      idempotent; a second run cannot clobber post-migration edits; legacy
      back-fills apply; `readAll` hides tombstones without deleting them;
      `purgeTombstones` spares live rows.
- [x] `backup.test.ts` (10): **v2 file restores** with `deletedAt` backfilled;
      IDs preserved; v3 round-trips; unknown version rejects; a bad file leaves
      every store untouched; templates/types update live with no reload.
- [x] `store.test.ts` (10): writes reach IndexedDB; soft delete keeps the row on
      disk; cascade delete tombstones the linked movement; hydrate skips
      tombstones; audit appends one row per mutation.
- [x] Existing 41 tests still pass — `deletedAt` does not leak into exports.
- [x] `test-setup.ts` + `vite.config.ts` `test.setupFiles`: fake-indexeddb and a
      localStorage stub, installed before any module loads.
- [x] **Verified the new tests are not vacuous** — breaking `persist()` fails 8
      of them. Without that check they would pass against a no-op write path.
- [x] `bunx tsc -b` clean; `bun run build` clean.

## 10. Docs

- [x] `docs/2026-07-17/plan.md`, `docs/2026-07-17/tasks.md`.
- [x] `README.md`: storage line now says IndexedDB; added a migration note (auto,
      legacy keys kept, old backups still restore, UI prefs stay in
      localStorage); file tree updated with `db.ts` / `bootstrap.ts` /
      `test-setup.ts` and `storage.ts` marked legacy.

## Follow-ups (not this change)

- [ ] Delete `storage.ts` + the legacy localStorage keys, once this has run
      clean in the field for a release or two.
- [ ] Wire `onPersistError` to a visible UI surface. It currently only
      `console.error`s — a failed write is invisible to the user, which is the
      known cost of the optimistic model.
- [ ] Call `purgeTombstones` somewhere (boot? a maintenance action?). Tombstones
      accumulate unbounded until something does.
- [ ] Prune the audit log — unbounded growth, one entry per mutation forever.
- [ ] Read-only mode, before any sync ships.
