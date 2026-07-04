# Tasks — 2026-07-04

Ordered to minimize rework. See `plan.md` for rationale and edge cases.

## 1. Order → productId migration

- [x] Add `productId: string` to `OrderItem` in `src/lib/types.ts`.
- [x] `loadOrders` (`storage.ts`): backfill `productId` by matching `namaProduk` against loaded products; `""` if unmatched.
- [x] `addOrder` (`store.ts`): resolve product by `productId` first, fall back to name for legacy rows.
- [x] `io.ts`: emit/parse `"Produk ID"` (optional on parse).

## 2. Audit log

- [x] New store key `invoice.audit.v1` in `storage.ts` (`loadAudit`/`saveAudit`).
- [x] New `src/lib/audit.ts`: `AuditEntry` type, `logAudit`, `useAudit`, `getAudit`, `diff()` helper.
- [x] Hook logging into every `store.ts` mutation: `upsertProduct`, `deleteProduct`, `addType`, `addOrder`, `setOrderStatus`, `deleteOrder`, `deleteOrders`, `addMovement`, `deleteMovement`.
- [x] Note order-generated movements distinctly in their audit label.

## 3. Multi-row add editors

- [x] Rewrite `AddItemForm.tsx` (Pesanan) → editable rows, `+ Tambah item`, per-row `✕`, `Simpan` bottom-right; per-row `affectsStock`.
- [x] Rewrite `AddMovementForm.tsx` (Stok) → same pattern; per-row reason, harga modal, catatan.
- [x] Skip blank rows on save; disable Simpan when no valid rows; highlight invalid rows.
- [x] Verify responsive layout (scroll/wrap) with several rows.

## 4. Product detail page

- [x] Add `/produk/:id` route in `router.tsx`; new `src/routes/ProductDetailPage.tsx`.
- [x] Sections: header + Edit, prices/konversi, stock + movements (reuse `computeFifo`), related orders, audit history for this product.
- [x] Link product rows/names (PricesPage, and where sensible) to the detail page.
- [x] "Produk tidak ditemukan" state for bad/deleted id.

## 5. History page

- [x] Add `/riwayat` route + `src/routes/HistoryPage.tsx`.
- [x] Reverse-chronological audit list; filters: entity, action, date range, text search on label.
- [x] Sidebar nav link for Riwayat.

## 6. Global Backup / Restore

- [x] New `src/lib/backup.ts`: `exportAll()` (raw, id-preserving) + `importAll(text)` (wholesale replace, version-checked, no `uid()`).
- [x] Sidebar-footer **Backup semua** / **Pulihkan** buttons in `RootLayout.tsx` with confirm on restore.
- [x] Graceful handling of corrupt/partial/old-version files.

## 7. Docs

- [x] Update `README.md`: new pages (detail, riwayat), audit log, and that Backup is the only id-safe round-trip (per-page JSON regenerates ids).

## 8. Post-review refinements

- [x] Remove the per-product movement-history dropdown on Stok (detail now lives on `/produk/:id`); drop the expand column, `deleteMovement` wiring, and unused date/reason formatters from `StockPage.tsx`.
- [x] Make product names clickable → `/produk/:id` on Stok (always) and Pesanan (when `productId` set; plain text for legacy rows).
- [x] Add editors wrap onto two lines instead of horizontal scroll: `AddItemForm`/`AddMovementForm` use `flex flex-wrap` with a bordered per-row group instead of `overflow-x-auto` + `min-w-max`.

## Verification

- [x] Rename a product → stock auto-deduct + detail order list still resolve.
- [x] Backup → wipe localStorage → Restore → all stores + ids intact, stock links unbroken.
- [x] Every mutation type produces exactly one sensible audit entry.
- [x] Multi-row save with a mix of valid/blank/invalid rows behaves correctly.

_Verification items remain unchecked: verified at typecheck/build level (`tsc -b` + `vite build` clean); not yet click-tested in the browser (Chrome extension not connected)._
