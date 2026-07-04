# Plan — 2026-07-04

Feature round covering the add-item UX, full data backup/restore, an audit-log
history system, a product detail page, and fixing order↔product linkage.

## Agreed decisions

| Topic | Decision |
| --- | --- |
| Add flow (Pesanan & Stok) | Multi-row editor: each row fully editable, removable; one **Simpan** bottom-right below all rows and the **+ Tambah item** button. |
| History (point 3) | **Full audit log** across all entities (append-only), with a dedicated History page. |
| Product detail (point 4) | **New `/produk/:id` page** aggregating info, prices, stock, orders, and audit history. |
| Order linkage | **Migrate `OrderItem` to carry `productId`** (one-time match-by-name migration). |
| Backup (point 2) | **Sidebar-footer Backup / Restore** buttons; ID-preserving raw JSON of all stores. |

## Current state (reference)

- Storage is **localStorage only** (`src/lib/storage.ts`), keys `invoice.*.v1`.
- All mutations funnel through `src/lib/store.ts` — the single place to hook audit logging.
- `parseProducts/parseOrders/parseStock` in `src/lib/io.ts` **regenerate `id` via `uid()`** on import → per-page JSON is an *interchange* format, NOT a safe backup (it orphans `StockMovement.productId` links).
- `OrderItem` links to a product by **`namaProduk` (string)**; `StockMovement` links by **`productId`**.
- `deleteProduct` does not clean up related orders/stock → orphans are possible.

---

## 1. Multi-row add editor

Replace the "fill one line → push to read-only pending list → Simpan" flow in
`AddItemForm.tsx` (Pesanan) and `AddMovementForm.tsx` (Stok) with a list of
**editable rows**.

- Starts with one empty row.
- **+ Tambah item** appends another empty editable row (does not commit).
- Each row has a **✕** to remove it.
- **Simpan** sits bottom-right, below the rows and the + button; commits every valid row at once, then resets to a single empty row.
- Per-row (not global) extra fields:
  - Pesanan: `tanggal`, produk, satuan/konversi, qty, **Tambah ke stok** toggle.
  - Stok: `tanggal`, produk, Jenis (reason), satuan/konversi, qty, Harga modal, Catatan.

**Edge cases**
- Empty/blank rows are skipped on Simpan (not an error); Simpan is disabled if zero valid rows.
- Per-row validation: produk required, qty > 0. Invalid rows are highlighted, not silently dropped.
- Row IDs are ephemeral UI keys, not persisted.
- Wide row layouts must stay usable on small screens (horizontal scroll or wrap).

## 2. Global Backup / Restore

Add **Backup semua** and **Pulihkan** in the sidebar footer (`RootLayout.tsx`).

- New `src/lib/backup.ts`:
  - `exportAll()` → `{ version, exportedAt, products, orders, stock, types, templates, audit }` using **raw internal shapes with IDs preserved** (do NOT reuse `serialize*` from io.ts).
  - `importAll(text)` → validates `version`, replaces every store wholesale via the `set*` setters. **No `uid()` regeneration.**
- Restore shows a confirm dialog ("mengganti SEMUA data"). On version mismatch, refuse with a clear message.
- Keep existing per-page Impor/Ekspor JSON untouched (interchange use).

**Edge cases**
- Corrupt/partial file → catch, show error, change nothing.
- Missing optional sections (e.g. old backup without `audit`) → default to `[]`.
- Backup is the ONLY id-safe round-trip; call this out in README.

## 3. Full audit log

New append-only store `invoice.audit.v1`.

```ts
interface AuditEntry {
  id: string;
  timestamp: string;              // ISO datetime
  entity: "product" | "order" | "stock" | "type";
  entityId: string;
  action: "create" | "update" | "delete";
  label: string;                  // human summary, e.g. "Harga Jual 12.000 → 13.000"
  changes?: { field: string; from: unknown; to: unknown }[]; // field-level diff on update
}
```

- `src/lib/audit.ts`: `logAudit(entry)`, `useAudit()`, `getAudit()`, plus a `diff(oldObj, newObj)` helper.
- Hook logging **inside `store.ts` mutations**: `upsertProduct` (create/update+diff), `deleteProduct`, `addType`, `addOrder`, `setOrderStatus`, `deleteOrder`, `deleteOrders`, `addMovement`, `deleteMovement`.
- New route `/riwayat` (History page): reverse-chronological list, filters by entity, action, date range, and free-text search on `label`.

**Edge cases**
- Audit entries are **never** rewritten by later imports; a **Restore** replaces them (documented) — or optionally merges. Default: replace, matching other stores.
- Deleting an entity keeps its audit history (entityId may dangle) — History tolerates missing entities.
- Auto-generated movements from orders log with a note that they came from an order (avoid double-counting confusion).
- Guard against unbounded growth later (not now) — note as future work.

## 4. Product detail page `/produk/:id`

- Add route in `router.tsx`; make product rows in `PricesPage` (and product names elsewhere) link to it.
- Sections: header (nama, tipe, ukuran, satuan) + Edit; prices & konversi table; current stock + movement history (reuse FIFO from `stock.ts`); orders containing this product; audit history filtered to this product.
- Handle unknown `:id` (deleted/bad link) with a "produk tidak ditemukan" state.

## 5. Order → productId migration

- Add `productId: string` to `OrderItem` (`types.ts`).
- `loadOrders` migration: for legacy items without `productId`, match by `namaProduk` against loaded products; leave `""` if unmatched.
- The multi-row Pesanan form already selects a product by id → set `productId` directly.
- `addOrder`'s stock-linking looks up the product by **`productId`** (fallback to name only for legacy rows).
- `io.ts` serialize/parse orders gains a `"Produk ID"` field (optional on parse for back-compat).

**Edge cases**
- Unmatched legacy orders (product renamed/deleted) keep `productId: ""`; detail page's "orders" list matches on id OR falls back to name.
- Renaming a product no longer breaks stock auto-deduct.

---

## Suggested build order

1. Order `productId` migration (foundation for detail page). 
2. Audit store + logging hooks in `store.ts`.
3. Multi-row add editors (Pesanan, then Stok).
4. Product detail page `/produk/:id`.
5. History page `/riwayat`.
6. Global Backup / Restore in sidebar footer.
7. README update (backup = only id-safe round-trip; new pages).

See `tasks.md` for the itemized checklist.
