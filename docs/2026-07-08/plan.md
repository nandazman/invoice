# Plan — 2026-07-08

Add a **Beli Stock** (stock purchasing) ledger as its own page, fix the Pesanan
stock-effect to be a *reduction* (a customer order consumes inventory), let the
Excel export switch between Order and Beli Stock as its source, add a status
filter to Pesanan, and group the sidebar navigation.

## Agreed decisions

| Topic | Decision |
| --- | --- |
| Beli Stock structure | **Dedicated page + new `PurchaseItem` ledger** (`/beli-stok`), shaped like Pesanan; the Stok page stays the valuation snapshot. |
| Stock effect direction | Pesanan "affects stock" now **reduces** stock (a `sale` movement) since an order is a customer sale. Beli Stock **always adds** stock — no checkbox. |
| Beli Stock pricing | Priced at **Harga Dasar** (modal). Base unit = `hargaDasar`; a konversi unit defaults to `hargaDasar × jumlah`. Price field is **editable** so the real invoice cost can be captured (product carries no per-konversi cost). |
| Beli Stock status | **No status** for now (dropped from the original ask). |
| Status filter | Add a **status filter to Pesanan** (Pesanan has `pending`/`paid` already; the filter exists on Excel but not on Pesanan). Beli Stock has no status → no filter. |
| Excel export source | **Toggle at top of the existing Excel page**: `Sumber: Order / Beli Stock` switches which dataset the existing filters/staging/export operate on. Status filter hides when source = Beli Stock. |
| Sidebar | Two groups — **Data** (Harga, Pesanan, Stok, Beli Stock, Riwayat) and **Alat** (Ekspor Excel, Desain Template, Buat Invoice). |

## Current state (reference)

- `AddItemForm`'s **"Tambah ke stok"** checkbox currently makes `addOrder`
  create a **`purchase`** movement (+qty) at `hargaDasar` — it *adds* stock. The
  `types.ts` comment says it should *deduct* (a "sale"). Implementation and intent
  disagree; this plan resolves it in favor of **reduce**.
- Export helpers (`excel.ts`, `orderText.ts`, `orderImage.ts`) only read
  `tanggal, namaProduk, satuan, kuantitas, hargaSatuan, totalHarga` — **no
  `status`** — so a status-less `PurchaseItem` satisfies them structurally.
- `StockMovement` links to its origin order via `orderId`. Purchases need a
  parallel link.
- Stores funnel through `store.ts`; audit logging is hooked there. `backup.ts`
  (`BACKUP_VERSION`) and `io.ts` must learn about the new entity.

---

## 1. `PurchaseItem` entity + store

New type in `types.ts` — a Pesanan-shaped line, minus `status`/`affectsStock`:

```ts
interface PurchaseItem {
  id: string;
  tanggal: string;       // ISO yyyy-mm-dd
  productId: string;
  namaProduk: string;
  satuan: string;        // chosen unit label (base satuan or konversi nama)
  kuantitas: number;     // in chosen unit
  hargaSatuan: number;   // cost per chosen unit (editable, defaults from hargaDasar)
  totalHarga: number;    // kuantitas × hargaSatuan
  createdAt: string;
  updatedAt: string;
}
```

Also extend `StockMovement` with `purchaseId: string | null` (mirrors `orderId`).

- `storage.ts`: `PURCHASES_KEY = "invoice.purchases.v1"`, `loadPurchases`/
  `savePurchases`; `loadStock` backfills `purchaseId ?? null`.
- `store.ts`: `purchases` state, `usePurchases`, `getPurchases`, `setPurchases`,
  and mutations:
  - `addPurchase(item)` — stamp timestamps, append, **auto-create a linked
    `purchase` movement** (`reason: "purchase"`, `qty: +baseQty`,
    `hargaModal: hargaSatuan / baseUnits`, `purchaseId: item.id`), audit-log it.
  - `deletePurchase(id)` / `deletePurchases(ids)` — remove the line **and** its
    linked movement(s) (`m.purchaseId === id`), audit-log.
- `audit.ts`: allow `entity: "purchase"` (extend the union).

**Edge cases**
- `baseUnits` resolves via the same `baseUnitsFor(product, satuan)` logic used by
  `addOrder` (base unit = 1, else konversi `jumlah`, unknown = 1).
- Deleting a purchase must not delete order-linked movements and vice versa —
  filter strictly on the correct id field.

## 2. Flip Pesanan stock effect to a reduction

In `store.ts addOrder`, when `affectsStock`:
- create a **`sale`** movement with **`qty: -baseQty`**, `hargaModal: null`
  (FIFO consumes existing purchase layers), keep the `orderId` link.
- Relabel the checkbox in `AddItemForm.tsx`: **"Tambah ke stok" → "Kurangi stok"**
  (customer order consumes inventory). Update the field comment in `types.ts`
  (`affectsStock` = deducts stock) to match reality.
- `deleteOrder`/`deleteOrders` already drop movements by `orderId` — unchanged.

**Edge cases**
- Existing order-linked movements in stored data were `+qty` purchases; note in
  README/plan that historical rows keep their old sign (no destructive
  migration). Only new entries reduce. (If a full re-sign is wanted, that's a
  separate one-off — out of scope here.)

## 3. Beli Stock page `/beli-stok`

New `src/routes/BeliStockPage.tsx`, modeled on `OrdersPage.tsx`:
- Date-grouped table with per-date subtotals + grand total.
- Columns: Produk, Satuan, Qty, Harga Satuan (modal), Total, Dibuat/Diperbarui
  (toggleable via `ColumnToggle`, key `invoice.beli.cols.v1`). **No status column.**
- Filters: tanggal spesifik / dari / sampai / cari produk (same as Pesanan, no
  status).
- Impor/Ekspor JSON (`beli-stok.json`) via new `serializePurchases`/
  `parsePurchases`.

New `src/components/AddPurchaseForm.tsx`, modeled on `AddItemForm.tsx`:
- Rows: tanggal, produk, satuan/konversi, qty, **editable Harga Satuan**
  (default: base = `hargaDasar`, konversi = `hargaDasar × jumlah`), Total.
- **No "affects stock" checkbox** — every saved row adds stock.
- Same blank/invalid-row rules as `AddItemForm`.

Register `/beli-stok` in `router.tsx`.

## 4. Status filter on Pesanan

In `OrdersPage.tsx`, add a `status` select (`semua | pending | paid`) beside the
existing filters and include it in the `filtered` memo — same shape as the one
already in `ExcelPage.tsx`. Reset clears it.

## 5. Excel export source toggle

In `ExcelPage.tsx`:
- Add `source: "order" | "beli"` state with a toggle at the top of the filter
  Panel. `useOrders()` and `usePurchases()` both loaded; `dataset = source ===
  "order" ? orders : purchases`.
- Filters operate on `dataset`. **Status filter renders only when
  `source === "order"`**; switching to `beli` forces `status = "semua"`.
- Switching source **clears staging + selection** (avoid mixing sources in one
  export).
- Generalize the three export helpers to a shared line shape:
  - Add `LineItem` (the common fields) to `types.ts`; `OrderItem` and
    `PurchaseItem` structurally satisfy it.
  - Change `downloadOrdersXLSX`/`buildOrdersWorkbook`, `copyOrdersText`/
    `buildOrdersText`, `copyOrdersImage`/`downloadOrdersImage` signatures to
    `LineItem[]`. Titles ("🧾 Pesanan", sheet "Orders", filename `order.xlsx`)
    become source-aware where user-visible (e.g. `beli-stok.xlsx`, "🧾 Beli
    Stock").

**Edge cases**
- `PurchaseItem` has no `status`; export code must not read it (already true).
- Filename/heading should reflect the chosen source so exports aren't mislabeled.

## 6. Backup / io / migration

- `backup.ts`: add `purchases: PurchaseItem[]` to `BackupFile`; `exportAll`
  includes `getPurchases()`; `importAll` calls `setPurchases(data.purchases ?? [])`.
  **Bump `BACKUP_VERSION` to 2** (shape changed) and keep the strict version check.
- `io.ts`: `serializePurchases`/`parsePurchases` (date-grouped `beli-stok.json`,
  mirroring `serializeOrders`); parse `purchaseId`/`orderId` in stock round-trips.

## 7. Sidebar grouping

In `RootLayout.tsx`, split the flat `<nav>` into two labeled sections:
- **Data**: Harga, Pesanan, Stok, **Beli Stock** (🛒), Riwayat.
- **Alat**: Ekspor Excel, Desain Template, Buat Invoice.
- Expanded: small uppercase group label (`text-xs text-slate-400`) above each
  set. Collapsed: replace labels with a thin divider so icons stay aligned.

## 8. Docs

Update `README.md`: Beli Stock page, the Pesanan checkbox now **reduces** stock,
export source toggle, sidebar groups, and that backup is now version 2.

---

## Suggested build order

1. `PurchaseItem` type + `StockMovement.purchaseId` + storage load/save + migration.
2. `store.ts`: purchases state/mutations; flip `addOrder` to a `sale` reduction.
3. `AddPurchaseForm` + `BeliStockPage` + route.
4. Pesanan status filter + checkbox relabel.
5. `LineItem` refactor of export helpers; Excel source toggle.
6. `io.ts` purchases serialize/parse; `backup.ts` v2 + purchases.
7. Sidebar grouping.
8. README.

See `tasks.md` for the itemized checklist.
