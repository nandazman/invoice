# Tasks — 2026-07-08

Ordered to minimize rework. See `plan.md` for rationale and edge cases.

## 1. Data model & storage

- [x] Add `PurchaseItem` interface to `src/lib/types.ts` (no `status`/`affectsStock`).
- [x] Add `LineItem` (shared export shape) to `types.ts`; note `OrderItem` & `PurchaseItem` satisfy it.
- [x] Add `purchaseId: string | null` to `StockMovement`; update the `affectsStock` comment on `OrderItem` to "deducts stock".
- [x] Extend `AuditEntry.entity` union with `"purchase"` in `types.ts` (and `audit.ts` if typed there).
- [x] `storage.ts`: `PURCHASES_KEY = "invoice.purchases.v1"`, `loadPurchases`/`savePurchases`; `loadStock` backfills `purchaseId ?? null`.

## 2. Store mutations

- [x] `store.ts`: `purchases` state, `usePurchases`, `getPurchases`, `setPurchases`.
- [x] `addPurchase(item)`: stamp timestamps, append, auto-create linked `purchase` movement (`+baseQty`, `hargaModal = hargaSatuan / baseUnits`, `purchaseId`), audit-log.
- [x] `deletePurchase(id)` / `deletePurchases(ids)`: remove line + linked movement(s) by `purchaseId`, audit-log.
- [x] **Flip `addOrder`**: `affectsStock` now creates a `sale` movement (`-baseQty`, `hargaModal: null`), keeping `orderId`.

## 3. Beli Stock page

- [x] `src/components/AddPurchaseForm.tsx`: rows with editable Harga Satuan (default base `hargaDasar`, konversi `hargaDasar × jumlah`); no stock checkbox; blank/invalid rules like `AddItemForm`.
- [x] `src/routes/BeliStockPage.tsx`: date-grouped table, subtotals + grand total, filters (no status), `ColumnToggle` key `invoice.beli.cols.v1`, Impor/Ekspor JSON (`beli-stok.json`).
- [x] Register `/beli-stok` route in `router.tsx`.

## 4. Pesanan tweaks

- [x] Add status filter (`semua | pending | paid`) to `OrdersPage.tsx` filters + `filtered` memo + Reset.
- [x] Relabel `AddItemForm` checkbox "Tambah ke stok" → "Kurangi stok".

## 5. Excel export source toggle

- [x] Generalize `excel.ts`, `orderText.ts`, `orderImage.ts` to `LineItem[]`; make sheet/heading/filename source-aware (`beli-stok.xlsx`, "🧾 Beli Stock").
- [x] `ExcelPage.tsx`: `source: "order" | "beli"` toggle; `dataset` = orders/purchases; hide status filter when `beli`; clear staging+selection on source switch.

## 6. Global backup / restore (must support Beli Stock)

- [x] `backup.ts`: add `purchases: PurchaseItem[]` to `BackupFile`; `exportAll` includes `getPurchases()`; `importAll` calls `setPurchases(data.purchases ?? [])`.
- [x] Bump `BACKUP_VERSION` to **2**; keep strict version check.
- [x] `io.ts`: `serializePurchases`/`parsePurchases` (`beli-stok.json`); round-trip `purchaseId`/`orderId` in stock serialize/parse.

## 7. Sidebar grouping

- [x] `RootLayout.tsx`: two groups — **Data** (Harga, Pesanan, Stok, Beli Stock 🛒, Riwayat) and **Alat** (Ekspor Excel, Desain Template, Buat Invoice); group labels when expanded, divider when collapsed.
- [x] Add the `/beli-stok` nav link.

## 8. Docs

- [x] Update `README.md`: Beli Stock page, Pesanan checkbox now reduces stock, export source toggle, sidebar groups, backup version 2.

## Post-plan tweaks (requested during build)

- [x] Beli Stock total is auto-computed, read-only (no manual entry).
- [x] Stock page (`AddMovementForm`): remove manual "Harga modal /satuan" field; cost auto from `hargaDasar`; show read-only "Total (modal)".
- [x] Sidebar groups collapsible per group (chevron toggle, persisted in `invoice.sidebar.groups`).
- [x] Group header highlights active when a child page is the current route.

## Verification

- [x] `tsc -b` + `vite build` clean.
- [x] FIFO with flipped order: purchase +24 @10k then sale −5 → qty 19, value 190 000 (logic test vs. shipped `stock.ts`).
- [x] Stock JSON round-trip preserves both `orderId` and `purchaseId`; Beli Stock JSON round-trip intact (logic test vs. shipped `io.ts`).
- [ ] Add a Beli Stock entry → Stok qty increases by the base-unit amount; FIFO value uses the entered cost. *(not driven in live UI — Chrome extension unavailable)*
- [ ] Delete that Beli Stock entry → linked movement removed, stock returns. *(live-UI)*
- [ ] Pesanan item with "Kurangi stok" → Stok qty decreases; deleting the order restores it. *(live-UI)*
- [ ] Excel toggle: switching source swaps dataset, hides status for Beli Stock, clears staging; XLSX/text/image exports label the right source. *(live-UI)*
- [ ] Backup → wipe localStorage → Restore → products, orders, **purchases**, stock (with `purchaseId`/`orderId` links) all intact; version-2 file required. *(live-UI)*
