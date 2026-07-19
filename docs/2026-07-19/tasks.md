# Tasks — 2026-07-19

Delete per-page JSON I/O, add a preview modal before copy-text, and extract the
triplicated filter into one hook plus one component with date presets and a type
filter. See `plan.md` for why no `hargaDasar` column, why no exporter refactor,
and why filters are not persisted.

**Order matters:** section 1 is pure deletion and shrinks two of the pages that
sections 2 and 3 then edit.

**Invariant:** `<FilterBar>` takes no boolean props. Anything one page shows and
another does not goes in as `children`.

## 1. Remove per-page JSON import/export

- [x] `src/routes/OrdersPage.tsx`: drop `doImport`, both buttons
      (`:285-290`), and the `io` imports. This is the one that called
      `setOrders(imported)` — a whole-table replace behind one `confirm()`.
- [x] `src/routes/PricesPage.tsx`: same (`:242-248`).
- [x] `src/routes/StockPage.tsx`: same (`:127-131`).
- [x] `src/routes/BeliStockPage.tsx`: same (`:205-211`).
- [x] `src/lib/io.ts`: delete `serializeProducts`, `parseProducts`,
      `serializeOrders`, `parseOrders`, `serializePurchases`, `parsePurchases`,
      `serializeStock`, `parseStock`, and the `Raw*` interfaces + date helpers
      that only they use.
- [x] **Keep** `downloadJSON` and `pickJSONFile` — `RootLayout.tsx:81,92` uses
      both for Cadangkan/Pulihkan. `io.ts` ends up ~20 lines.
- [x] Verify `backup.ts` still imports nothing from `io.ts` (it does not today —
      it goes through `store`/`audit`/`template-store`).
- [x] Check whether `setOrders` / `setProducts` / `setStock` / `setPurchases`
      still have callers. `backup.ts` `importAll` uses them, so they stay — but
      confirm rather than assume.
- [x] `bun run build` — the compiler finds every dangling import.

## 2. Copy-text preview modal

- [x] `src/components/CopyTextDialog.tsx` (new). Props: `items`, `title`,
      `showPrice`, `onShowPriceChange`, `onClose`. Renders
      `buildOrdersText(items, { title, showPrice })` into a read-only
      `<textarea>`, with the `Tampilkan harga` checkbox and a Copy button.
- [x] Text goes through `useMemo` on `[items, title, showPrice]`.
- [x] Copy button calls `navigator.clipboard.writeText`, shows `✓ Tersalin`,
      and keeps the existing error state — clipboard writes fail on
      non-secure origins and on denied permission.
- [x] Match `BuyFromOrderDialog.tsx` for overlay markup, Escape-to-close, and
      button placement. Do not invent a second modal idiom.
- [x] `ExcelPage.tsx`: `Salin teks` opens the dialog instead of copying.
      Delete `copyText` and `textState` (`:139-148`).
- [x] **`showPrice` stays page state**, passed down. The dialog does not own a
      copy — the XLSX and image buttons read the same value. The existing
      checkbox at `:243` stays where it is.
- [x] `src/lib/orderText.ts`: `copyOrdersText` loses its last caller. Delete it;
      keep `buildOrdersText`.
- [x] `InvoicePage.tsx`: add a `Salin teks` button next to `Cetak / PDF`
      (`:141`) opening the same dialog over `stagedSorted`, with
      `title: "🧾 Invoice"`. Needs its own `showPrice` state — Invoice has none
      today; default `true`.
- [x] Disabled when nothing is staged, matching the existing export buttons.

## 3. Shared filter

### 3a. The hook

- [x] `src/lib/useOrderFilter.ts` (new). Signature:
      `useOrderFilter<T>(rows, products)` returning
      `{ values, set, preset, filtered, clear, hasFilter }`.
      `set` takes a **partial patch** (`set({ produk: v })`), not a key/value
      pair. `preset(key)` writes `from`/`to` and clears `exact` itself, so the
      clear-`exact` rule lives in the hook, not in every caller.
      Also exports `StatusFilter` and `FilterableRow`.
      Note: `tipe` uses `""` for unconstrained; `status` uses `"semua"`.
- [x] State: `exact`, `from`, `to`, `produk`, `status`, `tipe`.
- [x] `hasFilter` is a **real boolean** — today it is a string
      (`exact || from || ...`). Coerce.
- [x] `Map<productId, tipe>` in a `useMemo` over `products`. The predicate does
      `Map.get`, never `products.find` — the predicate runs per row per
      keystroke.
- [x] `useDeferredValue` on `produk` before filtering.
- [x] Status predicate skips rows with no `status` field, so purchases need no
      caller-side guard (replaces Excel's `source === "order"` check).

### 3b. Date presets

- [x] `presetRange(key, now = new Date())` in `src/lib/format.ts`. Keys:
      `hari-ini`, `kemarin`, `7-hari`, `bulan-ini`, `bulan-lalu`. The optional
      `now` is the test seam. Formats with a local `isoLocal()` helper — **not**
      `toISOString()`, which is UTC and shifts the day by one at UTC+7.
- [x] `format.test.ts`: 13 cases — one per key, 30/31-day months, leap and
      non-leap February, January `bulan-lalu` → December of the prior year.
- [x] Presets clear `exact` (inside `preset()`, see 3a).

### 3c. The component

- [x] `src/components/FilterBar.tsx` (new). Props: `filter`, `className`,
      `children`. **No booleans.**
- [x] Renders only the universal controls: `Tanggal spesifik`, `Dari`, `Sampai`,
      the preset buttons, `Cari produk`, `Tipe`, the `N cocok` count, and
      `Reset` when `hasFilter`.
- [x] `Tipe` is a plain `<Select>` over `useTypes()` — **not** `TypeSelect`,
      which requires `onCreate` and offers "+ Buat tipe".
- [x] Page-specific controls arrive as `children`: Excel's `Sumber` select,
      `Status` on the pages that show it.
- [x] Layout via `className` only. Invoice passes a vertical stack; Orders and
      Excel pass the horizontal row.

### 3d. Adoption

- [x] `OrdersPage.tsx`: replace the filter state and `filtered` memo with the
      hook; replace the filter Panel (`:213-260`) with `<FilterBar>` + Status as
      a child. `groups` keeps consuming `filtered` unchanged.
- [x] `ExcelPage.tsx`: same. `Sumber` and `Status` become children. `changeSource`
      keeps clearing staging/selection but now calls `filter.clear()`.
- [x] `InvoicePage.tsx`: same, vertical `className`, Status as a child.
      `appendFiltered`/`replaceFiltered` keep consuming `filtered`.
- [x] `BeliStockPage.tsx`: same, no children — `PurchaseItem` has no `status`
      field and the hook's predicate skips such rows. Gains presets and the type
      filter, which it never had. (Added after the fact; not in the original
      scope.)
- [x] Delete the three `clearFilters` and three `hasFilter` definitions.
- [x] `bun run build` and `bun run test`. **Not** `bun test` — that invokes
      Bun's own runner instead of Vitest and fails 35 pre-existing tests with
      `IndexedDB API missing` / `localStorage is not defined`, because it skips
      the jsdom + fake-indexeddb environment. `package.json` maps `test` to
      `vitest run`.

## 4. Follow-ups — unplanned, added the same day

Not in `plan.md`. Recorded here so the reasoning survives.

### 4a. FilterBar fields not filling the Invoice sidebar

- [x] The four fixed-size fields were hardcoded `w-36`, which is right for the
      horizontal row but leaves a gap in Invoice's vertical stack.
      `FilterBar.tsx` gains `fieldClassName = "w-36"`; `InvoicePage.tsx:189`
      passes `"w-full"`. `Cari produk` keeps `flex-1 min-w-[160px]`.
- [x] A **string** prop, so the no-booleans invariant still holds.
- Rejected: dropping the widths and relying on `<input type="date">` intrinsic
  sizing (fragile); `[.flex-col_&]:w-full` (depends on the caller literally
  passing `flex-col`); `basis-36 grow` (changes three pages to fix one).

### 4b. Linking legacy rows with `productId: ""`

Imported rows that never resolved to a product rendered as dead text — no link,
excluded from the type filter, absent from the product detail page.

- [x] `store.ts` `linkOrderProduct(id, productId)`: writes **only** `productId`
      and `updatedAt`. `namaProduk`, `satuan`, `hargaSatuan` and `totalHarga`
      stay as sold — they are the record of that sale, not a stale copy of the
      product. Audit entry commits in the same `db.transaction`.
- [x] Guards: unknown product id, and a no-op when already linked to that
      product (so re-picking the same one does not spam the log).
- [x] `LinkProductDialog.tsx` (new). Row name shown as a read-only mint chip;
      search starts **empty** (pre-filling it meant clearing it before you could
      search); list capped at `LIMIT = 5`; rows show `ukuran · satuan` because
      duplicate names are the reason this dialog exists; "Ada N produk lagi"
      counts against the unsliced list, so it stays quiet at exactly 5.
- [x] `OrdersPage.tsx`: unlinked rows render as an amber `⚠ Nama` button
      (`:362`) opening the dialog. Amber matches the existing pending style.
- [x] `store.test.ts` — 4 cases: persists id + audit entry, leaves sold
      name/price untouched, ignores an unknown id, no-ops when already linked.
      Suite 89 → 93.
- [x] Riwayat needed no change: `HistoryPage.tsx:205-208` renders `label` and
      `changes` generically, and `order` is already in `ENTITY_LABELS`.
- Purchases had the identical orphan fallback; done later the same day in 4e.
- Not done: a legacy row imported with `affectsStock: true` has no stock
  movement, and linking does not create one. `AddItemForm.tsx:86,90-91` refuses
  to build a row without a product, so orphans only ever arrive through
  `storage.ts` import — which generates no movements. Left alone pending a
  decision on whether linking an old sale should retroactively move stock.

### 4c. Cursor

- [x] One rule in the `styles.css` base layer covers every `button`, `select`,
      checkbox, radio, file input and `label`, plus `not-allowed` on disabled —
      instead of a `cursor-pointer` class per element. The `Button` components
      already had it; the ad-hoc buttons (`OrdersPage`'s amber row, the product
      picker rows, `TypeSelect`, `RootLayout` nav) did not.

### 4d. One Modal instead of six overlays

- [x] `src/components/Modal.tsx` (new). Owns the overlay, click-outside,
      Escape, and the panel that stops its own clicks. Only the panel's width
      and padding ever differed, so that is the single `className` prop.
- [x] Adopted by `CopyTextDialog`, `ProductDialog`, `LinkProductDialog` and
      `BuyFromOrderDialog` (all three of its overlays, including the success
      view and the nested confirm). `CopyTextDialog` loses its own Escape
      effect — it was the only dialog that had one.
- [x] Nested modals: every instance listens on `window`, so one Escape would
      have closed the confirm *and* the dialog under it. `Modal` keeps a
      module-level stack and only the topmost reacts. `overlayClassName` exists
      solely for the confirm's `z-[60]`.

### 4e. Linking legacy purchase rows

- [x] `store.ts` `linkPurchaseProduct(id, productId)` — mirrors
      `linkOrderProduct`, link-only, audit in the same transaction. The paid
      price stays as paid, not a copy of the product's `hargaDasar`.
- [x] `BeliStockPage.tsx`: same amber `⚠ Nama` button and the same
      `LinkProductDialog`, which needed no changes to serve both pages.
- [x] `store.test.ts` — 2 cases (link + price preserved; unknown id and re-link
      are both no-ops). Suite 93 → 95.

### 4f. Small fixes

- [x] `InvoicePage.tsx`: `Cetak / PDF` is disabled when nothing is staged,
      matching `Salin teks` next to it.
- [x] Checked the "FilterBar renders its own `<Panel>`, so ExcelPage shows two"
      note from an earlier session: **not a bug.** `ExcelPage.tsx:135-167` has
      `<FilterBar>` and the staging `<Panel>` as siblings, which is the same
      shape every other page uses. No change.

## Checks

- [ ] Orders/Prices/Stock/Beli Stock show no JSON buttons; sidebar
      Cadangkan/Pulihkan still round-trips.
- [ ] Copy-text preview matches what actually lands on the clipboard, with the
      price toggle both on and off.
- [ ] Toggling price in the dialog changes the XLSX output too — one state.
- [ ] Type filter on Excel with `Sumber: Beli Stock` (purchases carry
      `productId`, so it resolves the same way).
- [ ] Rows with `productId: ""` disappear when a type is selected, and the
      `N cocok` count agrees.
- [ ] `bulan-lalu` in January lands in the previous year.
- [ ] Invoice's filter fields fill the sidebar; Orders/Excel/Beli Stock rows are
      unchanged.
- [ ] An unlinked order row is amber and clickable; picking a product makes it a
      link, keeps the sold price, and appears in Riwayat. Same on Beli Stock.
- [ ] Escape closes each dialog; inside Beli Stok dari Pesanan, Escape closes
      the confirm and leaves the dialog open.

Sections 1–4 verified against the code on 2026-07-19. Everything above the
Checks list is done; the Checks themselves are manual browser passes and have
not been run.
