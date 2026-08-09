# Tasks — 2026-08-09

Add a `/laporan` page: laba rugi from FIFO cost, margin per produk and per
pembeli, and piutang with aging. See `plan.md` for why this is not a neraca (§1),
why HPP comes from `movementValue` instead of `hargaJual − hargaDasar` (§2), why
pembelian sits outside the profit arithmetic (§5), and why piutang ignores the
date filter (§6).

**No schema change.** No new table, no Dexie version, no `BACKUP_VERSION` bump,
no store mutations. Every task below reads.

**Order matters:** §1 (extract `Stat`) and §2 (`report.ts` + tests) both land
before §3 renders anything. The arithmetic is the product — it gets tested before
it gets a page.

**Invariants:**

- `computeFifo` runs over a product's **entire** movement history, then the
  result is filtered to the period. Slicing movements to the date range before
  calling it produces fiction (`plan.md` §3).
- HPP is selected via `StockMovement.orderId` matching a filtered order — never
  by scanning movements in the date range. This is what makes the pembeli/tipe
  filters narrow revenue and cost together.
- An order with no matching sale movement contributes **revenue only**, is
  excluded from HPP and from margin, and is counted in the "tanpa catatan stok"
  line. No cost is ever imputed from `hargaDasar`.
- Pembelian is never subtracted from revenue.
- Piutang reads every live pending order, ignoring the date filter.
- The profit line is labelled **Laba Kotor**. There is no laba bersih.
- **Anything the report cannot compute is shown as a subtraction, never as an
  omission.** Added after the review; see `plan.md` §10 for why this turned out
  to be the invariant the others were quietly breaking.
- **Deleting a product must not change what was already sold.** Products are soft
  deleted while their movements stay live; cost is derived from the movement
  groups, and the product list only supplies a `hargaDasar` fallback.

## 1. Extract `Stat`

- [x] `src/components/Stat.tsx`: move the `Stat` component out of
      `BuyerDetailPage.tsx:236-255` verbatim — `label`, `value`, `className`,
      same markup. Export it.
- [x] `src/routes/BuyerDetailPage.tsx`: delete the local copy, import from
      `../components/Stat`. No visual change; the Ringkasan block
      (`:111-124`) must render identically.

## 2. `src/lib/report.ts` — the arithmetic

Pure functions over plain arrays. No React, no `store.ts` import — same shape as
`catalog.ts` and `purchaseFromOrder.ts`.

- [x] `buildMovementCosts(stock: StockMovement[], products: Product[]):
      Map<string, number>` — group **all** movements by `productId` (the grouping
      in `StockPage.tsx:38-46` is the model), `computeFifo(movements,
      p.hargaDasar)` once per product, merge every `fifo.movementValue` into one
      map keyed by movement id. Values stay signed: negative = cost released.
- [x] `costByOrderId(stock, costs): Map<string, number>` — for each movement with
      `orderId !== null` and `qty < 0`, the **positive** HPP for that order
      (`−costs.get(m.id)`). One order has at most one sale movement
      (`store.ts:402-425`), but sum rather than overwrite so a hand-added
      movement carrying an `orderId` cannot silently win.
- [x] `summarize(orders: OrderItem[], costByOrder): ProfitSummary` — returns
      `{ penjualan, hpp, labaKotor, marginPct, tanpaStokCount, tanpaStokNilai }`.
      An order is "tanpa stok" when `costByOrder` has no entry for its id. Its
      `totalHarga` counts in `tanpaStokNilai` and **not** in `penjualan`, so
      `labaKotor = penjualan − hpp` stays a closed sum over comparable rows.
- [x] ~~`marginPct` is `0` when `penjualan` is `0`.~~ Superseded: it is
      `number | null`, null when `penjualan` is 0. Never `NaN` — it reaches a
      formatter in the UI. See §7.
- [x] `byProduct(orders, costByOrder, products): ProductMargin[]` —
      `{ productId, namaProduk, qty, penjualan, hpp, laba, marginPct }`, sorted
      by `laba` descending. Orders with no cost entry are excluded (invariant 3),
      so the rows here always sum back to `summarize`'s totals.
- [x] `byBuyer(orders, costByOrder, buyers): BuyerMargin[]` — same shape keyed on
      `buyerId`. `buyerId: ""` collapses into one row labelled "Tanpa pembeli";
      it is a real value, not a missing one (`plan.md` §6 of 2026-07-29).
- [x] `receivables(orders: OrderItem[], today: string): Aging` — every live order
      with `status === "pending"`, bucketed on `tanggal` age into
      `{ d0_30, d31_60, d60plus, total, count }`. `today` is a parameter, not
      `todayISO()` — a date-dependent function that reads the clock cannot be
      tested.
- [x] Money sums go through `sumRupiah` (`format.ts:29`), not raw `+`, matching
      `OrdersPage.tsx:276`.

## 3. `src/lib/report.test.ts`

The FIFO-window cases are the reason this file exists. `stock.test.ts` does not
exist yet — `computeFifo` itself is currently untested — so these tests are also
the first coverage it gets.

- [x] **The window invariant.** Two purchase lots at different costs, the first
      dated before the period, then a sale inside the period big enough to
      consume the older lot. HPP must equal the **old** lot's cost. Computing
      FIFO over period-sliced movements would give the new cost or zero — this
      test is what stops that regression.
- [x] An order with `affectsStock: false`: excluded from `penjualan` and `hpp`,
      counted in `tanpaStokCount` / `tanpaStokNilai`.
- [x] An order with `productId: ""`: same treatment, via the same path.
- [x] `labaKotor` goes negative when a lot's cost exceeds the sale price, and
      `byProduct` surfaces that row — the price-rise case from `plan.md` §7.
- [x] Conversion units: an order in a `konversi` unit (`jumlah: 12`) deducts 12
      base units (`store.ts:406`, `baseUnitsFor` at `:366-370`) and its HPP is 12
      base units of lot cost, not 1.
- [x] `marginPct` with `penjualan: 0` returns `null`, not `0` and not `NaN`.
- [x] Aging boundaries: exactly 30 and exactly 60 days old land in the buckets
      the labels claim. Off-by-one here is invisible in the UI forever.
- [x] A paid order never appears in `receivables`, regardless of date.

## 4. `src/routes/ReportPage.tsx`

- [x] `const filter = useOrderFilter(orders, products)` and `<FilterBar filter={filter} />`,
      copying `OrdersPage.tsx:168`. Period, produk, tipe, pembeli, and status all
      scope the report. ~~No `children`.~~ The status control *is* `children`,
      exactly as on `OrdersPage` — `FilterBar` does not carry one. See §7.
- [x] `buildMovementCosts` runs in a `useMemo` over `[stock, products]` — the
      full-history replay must not re-run on every keystroke of the produk
      search. `summarize` / `byProduct` / `byBuyer` memo on
      `[filter.filtered, costByOrder]`.
- [x] Laba-rugi `Panel`: Penjualan, HPP (parenthesised, red), rule, **Laba
      Kotor** with `marginPct` beside it. Right-aligned `tabular-nums`, matching
      the money columns in `OrdersPage.tsx:565-568`.
- [x] The "tanpa catatan stok" line directly beneath, amber, only when
      `tanpaStokCount > 0`. Wording:
      `N pesanan (Rp X) tidak punya catatan stok — tidak dihitung di HPP.`
      Reuse the amber badge classes from `StockPage.tsx:91-94`.
- [x] A separate `Panel` headed **Di luar perhitungan di atas**, holding three
      `Stat`s: Pembelian periode ini (sum over the filtered purchases), Nilai
      persediaan (the `StockPage.tsx:67` reduce, unfiltered — it is a balance
      now), Belum dibayar. The heading is what keeps §5 true on screen; it is not
      decoration.
- [x] Piutang `Panel`: total, count, and the three aging buckets as `Stat`s.
      Renders whether or not a date filter is set, with a note that it ignores
      the period.
- [x] Margin per produk table: Produk, Qty, Penjualan, HPP, Laba, Margin %.
      Negative `laba` rows get amber text. `thClass` / `tdClass` copied from
      `StockPage.tsx:16-18` like every other table in the app.
- [x] Margin per pembeli table: same columns minus Qty, buyer name linking to
      `/pembeli/$id` as `BuyersPage` already does.
- [x] Empty state when `filter.filtered.length === 0`: the centred
      `text-slate-400 py-8` `Panel` used at `StockPage.tsx:76-79`. It **returns**
      in place of the report — rendering it alongside put a computed-looking
      Rp 0 laba-rugi under the words "belum ada pesanan".

## 5. Wiring

- [x] `src/router.tsx`: `reportRoute` at `/laporan`, added to `routeTree`.
- [x] `src/routes/RootLayout.tsx`: third `NAV_GROUPS` entry
      `{ label: "Laporan", items: [{ to: "/laporan", label: "Laba Rugi", icon: "📈" }] }`
      after "Alat" (`:25-45`).
- [x] `bun run test` green, `bun run build` clean.

## 7. Review round — fixes applied after shipping

Four reviewers (two general, one engineering, one finance). `plan.md` §10 has the
reasoning and the split; this is the checklist. Every item has a test in
`report.test.ts` unless marked UI.

- [x] `ProfitSummary.penjualanTotal` — revenue over **every** filtered order. The
      block leads with it and reconciles down through a visible "belum ada dasar
      modal" deduction. Previously the top line was the priced subset under a
      heading that read as a total.
- [x] `stockLoss(stock, index, inScope)` — out-movements with no `orderId` pop
      FIFO lots but were charged to nobody, so losing stock *improved* Laba
      Kotor. Charged below Laba Kotor; the bottom line becomes "Laba setelah
      susut". `inScope` is a predicate: the caller owns what the period means,
      and a movement has no buyer, so the pembeli filter cannot narrow it — the
      page says so rather than implying it did.
- [x] `marginPct: number | null`, via `marginOf`. `penjualan === 0 ? 0` was right
      only when the cost was zero too; a Rp 0 bonus line that consumed stock
      printed `0.0%` next to a total loss.
- [x] `buildFifoIndex` loops the movement groups, not the product list. Deleting
      a product was erasing finished revenue from closed periods.
- [x] `joinOrderCosts` clears `complete` for a sale movement with no cost entry
      instead of `continue`-ing past it.
- [x] `dobelCount` counts priced orders only — it and `tanpaStokCount` could
      count the same row and put two contradictory banners on it.
- [x] `Aging.tanggalTidakValid`; unreadable dates age to the **oldest** bucket.
      `daysBetween` checks the `yyyy-mm-dd` shape before parsing, because
      `Date.parse("15 Juli")` returns 15 July **2001** rather than NaN.
- [x] Status filter on the page, as `FilterBar` children (UI).
- [x] Empty state returns instead of rendering alongside the report (UI).
- [x] `formatPersen` — Indonesian separator, `34,3%`, em dash for null.
      `formatRupiah` prints `Rp 0` for anything that rounds to zero, never
      `-Rp 0`.
- [x] `bun run test` green (191), `bunx tsc --noEmit` clean, `bun run build`
      clean.

### Left open, deliberately

- The `store.ts` double-deduction itself: `addPurchase(item, note, order)` writes
  a second sale movement and `BuyFromOrderDialog` has no `affectsStock` guard.
  The report reports it (`dobelCount`) rather than hiding it. Needs a store fix
  **and** a pass over the rows already written.
- Returns / positive adjustments re-lot at current `hargaDasar` and never offset
  the originating order's HPP.
- Piutang per pembeli, and re-cutting the aging buckets to 0-7 / 8-14 / 15-30 /
  30+ for the credit terms this trade actually runs on.

## 6. Deliberately not in this change

Listed so they are decisions, not oversights. Full reasoning in `plan.md` §9.

- Neraca — blocked on `PurchaseItem.status` and an opening balance.
- Laba bersih / biaya operasional — no expense entity exists.
- Cash-flow over time — `OrderStatus` carries no payment date; the audit log
  (`store.ts:466`) only covers transitions recorded after auditing existed.
- Charts — read the tables first.
- Excel export of the report — `excel.ts` is `LineItem`-shaped
  (`types.ts:87-94`); aggregates do not fit.

### Also in the review round

- [x] `computeFifo` carries a `deficit`: stock arriving against units that
      already left settles the debt instead of becoming a lot. Fixes inventory
      value for a product with nothing on hand. Does not clear `uncovered`.
- [x] `todayISO()` read during render and passed as a memo dependency, not called
      inside the memo.
- [x] `group()` keeps each order beside its `OrderCost` instead of re-looking it
      up behind `?? 0` / `as OrderCost`.
- [x] Susut and pembelian both note that the **pembeli and status** filters do
      not apply to them (a movement has neither field). Caught by the browser
      pass; previously only the pembeli half was mentioned, and only on
      pembelian.
