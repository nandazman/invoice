# Plan — 2026-08-09

Add **Laporan** — a finance page.

Three things, in this order:

1. **A pure `report.ts`** that derives revenue, HPP (FIFO), and gross profit for
   a period from data that already exists. No new fields, no new table.
2. **A `/laporan` page** reusing `FilterBar` / `useOrderFilter` for the period,
   showing the laba-rugi block plus margin per produk and per pembeli.
3. **Piutang**, reported *beside* the laba-rugi block and never inside its
   arithmetic — it is a balance at a moment, not a flow across a period.

> Scope: no schema change, no Dexie version bump, no `BACKUP_VERSION` bump. One
> new route, one new lib module, one new nav group. Explicit non-goals at the
> bottom — **neraca is one of them**, and §1 says why.

## 1. The question: neraca, or laba rugi?

Laba rugi. A neraca is not derivable from this schema and should not be faked.

A balance sheet needs assets, liabilities, and equity. Count what is actually in
`types.ts`:

- **Cash and bank: absent.** There is no account entity of any kind. Money is
  only ever implied by an order or a purchase line.
- **Hutang: absent.** `PurchaseItem` (`types.ts:71-84`) has no `status` field —
  unlike `OrderItem`, which has one (`types.ts:60`). So stock bought on credit
  and stock paid for in cash are the same row. There is no payables side to
  report.
- **Modal / equity: absent.** Nothing records what the owner put in.

Two of the three sides do not exist. A page could still render *persediaan +
piutang* under a heading that says "Aset", but then liabilities would be a
permanent zero and equity would have to be a plug figure — assets minus nothing.
That balance sheet balances **by construction**, every time, no matter how wrong
the data is. It would look like a check and be incapable of failing one. That is
worse than not shipping it.

Laba rugi has the opposite property: every input is a real recorded row, and the
output can be wrong in ways the user can see and correct.

The minimum honest path to a neraca later is a `status` on `PurchaseItem` plus
an opening balance. Both are schema changes. Not this plan.

## 2. The number is already computed, and already thrown away

This is the reason the report is small.

`computeFifo` returns four things (`stock.ts:3-8`):

```ts
export interface FifoResult {
  qty: number; // net stock, base units (signed)
  value: number; // remaining inventory value under FIFO
  unitCost: number; // value / qty when qty > 0, else 0
  movementValue: Map<string, number>; // signed money in/out per movement id
}
```

`movementValue` is the cost each movement actually consumed — for an outbound
movement it is negative, and it is the sum of the lot costs FIFO popped
(`stock.ts:46`). **That is HPP.** It is exact, per movement, and it is already
being calculated on every render of the Stok page.

`StockPage` reads `fifo.value` and `fifo.qty` (`StockPage.tsx:55-62`) and drops
`movementValue` on the floor. The whole page total is one reduce over `value`
(`StockPage.tsx:67`). Nothing in the app has ever read the cost side.

So the report does **not** estimate margin as `hargaJual − hargaDasar`. That
figure is a price-list opinion; it drifts the moment `hargaDasar` is edited and
it retroactively rewrites the profit on orders that shipped months ago. The FIFO
number is what the goods on that specific order actually cost, from the lots they
actually came out of.

## 3. Period attribution, and the invariant that governs it

**FIFO replays the whole history, then the result is filtered to the period.
Never the other way around.**

`computeFifo` sorts and walks movements from the beginning (`stock.ts:19-21`),
building lots as it goes. Slicing the movement list to "July only" before calling
it would start the replay with an empty lot stack, so every July sale would
consume July's purchases — or nothing at all — and the HPP would be fiction.

Concretely, `report.ts` must:

1. Group **all** live movements by `productId` — the same grouping
   `StockPage.tsx:38-46` already does.
2. Call `computeFifo(allMovementsForProduct, p.hargaDasar)` once per product.
3. Merge every returned `movementValue` into one `Map<movementId, number>`.
4. *Then* select which movements fall in the period and sum their costs.

Which movements belong to a period is decided by the movement's own `tanggal`,
and that is safe because `addOrder` copies it straight off the order
(`store.ts:406`: `tanggal: filled.tanggal`). Revenue and its HPP therefore always
land in the same month, even when the row was typed in later.

The link back to the order is `StockMovement.orderId`, set on the generated sale
movement (`store.ts:411`) and null everywhere else. So:

- **Revenue** for a period = sum of `totalHarga` over the filtered orders.
- **HPP** for a period = sum of `−movementValue[m.id]` over sale movements whose
  `orderId` is one of those orders.

Keying HPP off the *orders* rather than off "all movements in the date range" is
deliberate: it makes every filter in `FilterBar` — produk, tipe, pembeli, status
— narrow revenue and cost together. "Margin on everything I sold Bu Ani in July"
falls out with no extra code.

## 4. The gap: orders that never touched stock

`affectsStock` is opt-in per row (`types.ts:64`), and `addOrder` only creates a
movement when it is set **and** the product resolves (`store.ts:402-407`). So
these carry revenue with no usable cost attached:

- `affectsStock: false` — the user chose not to deduct stock.
- A name that never matched any product, so no movement was written at all.
- **A sale FIFO cannot fully source from any lot.** This one is not obvious and
  is the most common of the three. `computeFifo` consumes what lots it has and
  stops; the movement's cost then covers only part of what was sold, and a sale
  with no purchase history behind it prices out at exactly **0**. Nothing
  downstream can tell that from a genuinely cheap sale, because `movementValue`
  reports both as a small number. Every order predating Beli Stok takes this
  path, so it is the common case, not an edge one. `computeFifo` therefore
  reports `uncovered` alongside the money, and an order is quarantined unless
  every one of its sale movements was fully sourced.

> **Correction 1.** An earlier draft of this section listed `productId: ""` as a
> third no-cost case, on the grounds that unmatched legacy rows fail the product
> lookup. That is wrong: `addOrder` falls back to matching on `namaProduk`
> (`store.ts:403-405`), so those orders *do* get a movement and *are* costed —
> the movement carries the resolved id even though the order's stays `""`. The
> consequence is a grouping bug, not a costing one, and §7 handles it.

> **Correction 2.** The same draft listed "a product deleted since the order was
> recorded" as a no-cost case. It *was* one, but because of how `buildFifoIndex`
> was written, not because the data is missing. Products are soft deleted
> (`deletedAt`) while their movements stay live, and the first implementation
> looped over the product list — so every movement of a deleted product was
> skipped, its sales lost their cost entry, and **deleting a product retroactively
> erased months of finished revenue from a closed period.** The loop now walks the
> movement groups and looks the product up for its `hargaDasar`, which is only a
> fallback. Deleting a product changes the price list; it must never change what
> was already sold. The one thing that does drop out is the deleted product's
> leftover `value` from `inventoryValue`, which is correct: persediaan is what the
> Stok page shows on hand, and the row is no longer on it.

**Do not impute a cost for these.** The tempting fix is
`hargaDasar × baseUnitsFor(product, satuan)` — `modalCostFor` in
`purchaseFromOrder.ts:16-18` already computes exactly that. Using it here would
silently blend a current-price estimate into a column labelled FIFO, and the
resulting margin could not be audited back to any lot.

Instead the report **quarantines them**. The laba-rugi block counts only orders
with a matching sale movement, and directly beneath it sits a line:

```
3 pesanan (Rp 840.000) tidak punya catatan stok — tidak dihitung di HPP.
```

That number is a to-do list for the user, not noise. It points at rows where
either `affectsStock` should have been ticked, or the goods were sold before any
purchase covering them was recorded.

> **Correction 3.** The draft said the second case is fixed with
> `LinkProductDialog`, and that "the count going to zero is the signal that the
> report is complete". Both are wrong. `linkOrderProduct` (`store.ts:481-506`)
> writes `OrderItem.productId` and an audit entry and **nothing else** — no stock
> movement — so linking a legacy row never gives it a cost basis and never clears
> it from the quarantine. There is, today, no in-app action that moves a row out
> of this count: the only real remedies are recording the missing purchase, or
> re-entering the order with `affectsStock` ticked. So the count going to zero is
> **not** a reachable goal on historical data, and a panel implying otherwise is
> a chore with no end. That is why the quarantined revenue now appears as a
> subtraction inside the laba-rugi block (§10) rather than only as a warning: it
> has to be legible as a permanent qualifier on the numbers, not as a to-do.

An imputed figure would hide the qualifier entirely, which is worse.

## 5. Pembelian is not an expense

Stated loudly because it is the single easiest way to make this page wrong.

`PurchaseItem.totalHarga` is cash leaving for goods. Those goods then sit in
`persediaan` until they are sold, at which point FIFO releases their cost as HPP.
Subtracting purchases from revenue **double-counts** them — once when bought,
again when sold — and makes profit swing wildly with restock timing: deeply
negative the month a big order lands, inflated the month after.

So purchases appear on the page as context, under their own heading, visually
outside the laba-rugi arithmetic:

```
Penjualan (semua pesanan)         Rp 13.100.000
  Belum ada dasar modal (3)       (Rp   700.000)
  ─────────────────────────────────────────────
  Penjualan yang dihitung          Rp 12.400.000
HPP (modal barang terjual)        (Rp  8.150.000)
  ─────────────────────────────────────────────
  Laba Kotor                       Rp  4.250.000
  Susut / stok keluar (2)           (Rp  180.000)
═════════════════════════════════════════════════
Laba setelah susut                 Rp  4.070.000   32,8%

Di luar perhitungan di atas
  Pembelian periode ini      Rp  3.200.000
  Nilai persediaan (kini)    Rp  6.700.000
  Belum dibayar (piutang)    Rp  1.900.000
```

The two indented deductions and the reconciling subtotals came out of the review;
§10 has the reasoning. The rule is that **every figure the block excludes is
excluded on screen, in the arithmetic** — the top line is the real top line.

A second reason the block stops at Laba Kotor: the app records no operating
costs — no sewa, gaji, transport, listrik. There is nothing to subtract, so there
is no laba bersih. The heading must say **Laba Kotor** and mean it, rather than
printing the same number under a word that promises more than the data supports.

## 6. Piutang is a balance, not a flow

`OrderStatus` is `"pending" | "paid"` (`types.ts:29`) — a flag, with no payment
date beside it. So "unpaid" is a fact about *now*, not about the filtered period.
An order dated March that was paid in April is `paid` today; it was `pending`
throughout March, and nothing in the row remembers that.

Two consequences:

- The piutang figure ignores the date filter and reads every live pending order.
  Putting a period-scoped receivable next to period-scoped revenue would invite
  the user to subtract one from the other, which means nothing.
- **Aging** buckets by `tanggal` age — 0–30 / 31–60 / 60+ days — because that is
  the actionable cut. It is pure grouping over data already in hand.

There *is* a payment timestamp hiding in the audit log: `setOrdersStatus` records
`status pending → paid` with a `timestamp` and a field-level diff
(`store.ts:466-467`). That is a legitimate source for "collected this month", but
only for transitions made after auditing existed — older rows have no entry, and
`AuditEntry.entityId` may dangle (`types.ts:78`). Good enough for a trailing
figure, not for a historical chart. Deferred; see non-goals.

## 7. Margin per produk, and per pembeli

Same computation, different `groupBy`. Both come free once §3 has built the
movement-cost map.

**Per produk must group on the MOVEMENT's `productId`, not the order's.** Legacy
rows carry `productId: ""` yet are costed through the name fallback above, so
grouping on the order's own field collapses every such order — across genuinely
different products — into one row labelled with whichever name arrived first.
`joinOrderCosts` keeps the resolved id for exactly this. The totals stay correct
either way, which is what makes the bug quiet: only the breakdown is wrong.

**Qty is summed in base units**, through `baseUnitsFor` (`purchaseFromOrder.ts`).
"5 pcs" plus "2 box" is 29, not 7. Everything else in the module is careful about
base units and this column has to match.

**Per produk** is the one that earns its place. Sorted by profit contribution, it
answers a question the app cannot currently answer at all: *which products am I
selling below what they cost me?* That happens for real — a supplier raises a
price, the new lot enters stock at the new cost, and `hargaJual` does not move.
FIFO surfaces it on the next sale; the price list never will. Rows with negative
margin get the same amber treatment `StockPage.tsx:91-94` uses for low stock.

**Per pembeli** groups on `buyerId`, which orders have carried since 2026-07-29,
and reuses the existing `Link` to `/pembeli/$id`. Cheap, and it makes the
`BuyerDetailPage` "Ringkasan" block (`BuyerDetailPage.tsx:111-124`) into a
per-buyer slice of the same numbers rather than a separate idea.

## 8. Where it lives

- **`src/lib/report.ts`** — pure functions over `(orders, purchases, stock,
  products)`, no React, no store imports. Matches `catalog.ts`, `orderText.ts`,
  `purchaseFromOrder.ts`: all pure, all with a sibling `.test.ts`. This is the
  part that must be tested; the arithmetic is the product.
- **`src/lib/report.test.ts`** — the FIFO-window cases are the point. See
  tasks §2.
- **`src/routes/ReportPage.tsx`** — composes `FilterBar` exactly as `OrdersPage`
  does (`OrdersPage.tsx:168`), then renders blocks. No new components: `Panel`,
  `Field`, and the `Stat` in `BuyerDetailPage.tsx:236-255` cover it. `Stat` moves
  to `src/components/Stat.tsx` and both pages import it — it is already written,
  already styled, and copying it would fork the styling on the next tweak.
- **`src/router.tsx`** — `/laporan`, registered in `routeTree` like the rest.
- **`src/routes/RootLayout.tsx`** — a third `NAV_GROUPS` entry, `"Laporan"`, with
  a single item (`NAV_GROUPS` at `:25-45`). Not under "Data" (it stores nothing)
  and not under "Alat" (it produces no file). Group collapse state is keyed on
  the label and already persists.

Nothing else changes. `backup.ts` is untouched: the report writes no rows, so
there is nothing new to export, and `BACKUP_VERSION` stays put.

## 9. Non-goals

- **Neraca.** §1. Blocked on `PurchaseItem.status` and an opening balance.
- **Laba bersih / operating expenses.** No expense entity exists. Adding one is a
  bigger decision than a report page, and inventing categories here would
  pre-empt it.
- **Cash-flow over time.** §6 — no payment date on the row.
- **Charts.** The numbers have never been shown at all; a table of them is the
  first useful thing. A charting dependency to plot twelve monthly totals is not
  worth it before anyone has looked at the totals once. Revisit after use.
- **Anything average-cost or LIFO.** The app is FIFO because `stock.ts` is FIFO.
  One valuation method.
- **Exporting the report to Excel.** `excel.ts` is built around `LineItem`
  (`types.ts:87-94`); report rows are aggregates and do not fit it. Separate job.

## 10. Revisions after the review round

Four reviewers went over the shipped module: two general, one reading it as an
engineer, one reading it as an accountant. Their findings split cleanly, and the
split is the useful part of this section.

The engineering findings were **local**: a wrong guard, a `continue` that should
have been a flag, an empty state rendered beside the thing it was meant to
replace. Each one is fixed in a line or two and has a test beside it now.

The finance findings were **structural**, and every one of them said the same
thing in a different place: *the block was arranged so that every number it could
not account for made the result look better.* Quarantined revenue sat outside the
total. Lost stock consumed lots and was charged to nobody. A zero-revenue line
with real cost behind it printed `0.0%`. None of these were arithmetic errors —
the sums were right — and that is exactly why they survived four rounds of tests.
A report can be correct in every figure and still be biased in one direction by
which figures it chooses to show.

The rule adopted in response, and the one to hold future changes to:

> **A number that cannot be computed is shown as a subtraction, never as an
> omission.** If the report leaves something out, the amount left out appears on
> screen, inside the arithmetic, under the line it was taken from.

### What changed

1. **The top line is total revenue** (`ProfitSummary.penjualanTotal`), reconciled
   downward to `penjualan` through a visible "belum ada dasar modal" deduction.
   Previously the block opened on the *priced subset* under the heading
   "Penjualan", which is the one number a user will read without checking.
2. **Susut is charged** (`stockLoss`). Out-movements with no `orderId` — stock
   takes, breakage, goods taken for personal use — pop FIFO lots exactly as a
   sale does, but no order ever collects the cost, so it fell out of the report
   entirely. Inventory dropped, nothing was charged, and Laba Kotor rose by the
   value of whatever was lost. It now sits below Laba Kotor as the only operating
   cost the app actually records, and the bottom line is "Laba setelah susut".
3. **`marginPct` is `number | null`.** The old guard, `penjualan === 0 ? 0`, is
   right only when the cost is zero too. A bonus line priced at Rp 0 that still
   consumed stock is a total loss, and it printed `0.0%` — which reads as
   break-even. Null means "no percentage exists here" and renders as an em dash.
4. **Deleted products keep their history.** See §4, correction 2.
5. **Sale movements with no cost entry clear `complete`** instead of being
   skipped. A `continue` there made an order whose only sale went uncosted
   indistinguishable from an order with no stock record at all.
6. **`dobelCount` counts priced orders only.** It and `tanpaStokCount` could
   count the same row, putting two banners on screen that gave contradictory
   advice about it. The dobel banner says "the HPP above is inflated" — which is
   only meaningful for a row that reached the HPP above.
7. **Unreadable dates age to the OLDEST bucket**, and are counted
   (`Aging.tanggalTidakValid`). `parseTanggalID` returns its input unchanged when
   it cannot read it, so an imported row can hold free text in `tanggal`. Worse,
   `Date.parse` is lenient enough to read `"15 Juli"` as **15 July 2001** — not
   NaN, just silently 25 years stale — so the shape is now checked against
   `yyyy-mm-dd` before parsing. An unknown age is a reason to chase a row, not to
   assume it is fresh.
8. **A status filter**, as `FilterBar` children, exactly as `OrdersPage` does it.
   Both documents assumed it was there; it was not. "Laba dari yang sudah
   dibayar" is a different question from "laba dari semua yang keluar".
9. **The empty state replaces the report** rather than rendering above it. A full
   Rp 0 laba-rugi under the words "belum ada pesanan" is worse than no zero.
10. **Percentages are Indonesian** — `formatPersen`, `34,3%` — and anything that
    rounds to zero prints `Rp 0`, never `-Rp 0` (`formatRupiah`). Float residue
    was putting a minus sign on a zero, which reads as a loss that is not there.

### Deliberately not fixed here

- **The double-deduction itself.** `addPurchase(item, note, order)` writes a
  second sale movement for an order that has already deducted stock, and
  `BuyFromOrderDialog` has no `affectsStock` guard, so the ledger really does
  record the sale twice. The report surfaces it (`saleMovements`, `dobelCount`,
  the red banner) rather than silently halving the HPP, because the fix belongs
  in `store.ts` and the existing bad rows need correcting either way.
- **Returns and positive adjustments re-lot at current `hargaDasar`** and never
  offset the originating order's HPP, so a fully returned order keeps 100% of
  both its revenue and its cost. Pre-existing in `stock.ts`; the report is what
  makes it visible as money. Wants its own change.

### Three smaller ones, same round

11. **Phantom inventory** (`stock.ts`). When lots ran out, the shortfall was
    recorded and forgotten, so the next purchase became a lot in full: a 10-unit
    sale with no history followed by a 10-unit purchase left `qty` at 0 while
    `value` held the entire purchase price, and the Stok page showed money on
    hand for a product with nothing on it. `computeFifo` now carries a `deficit`
    and settles it out of incoming stock before shelving the rest. `uncovered` is
    deliberately **not** cleared by this: the sale had no cost basis at the
    moment it happened, and letting a later purchase price it would make HPP
    depend on what happens next. Side effect worth knowing: on
    `ProductDetailPage`, a purchase that only settled a deficit shows **Nilai
    Rp 0** beside its real Modal/satuan — correct (it added nothing to
    inventory), and possibly surprising.
12. **`todayISO()` moved out of the piutang memo.** Called inside, it was an
    input React could not see, so a page left open overnight kept yesterday's
    ages until `orders` happened to change.
13. **`group()` carries each order with the entry it was admitted on.** The sums
    used to re-look-up the cost, which needed `?? 0` and an `as OrderCost` — two
    fallbacks for a case `hasCostBasis` had already excluded, which is precisely
    where a real one would go unnoticed.

### 14. Found by the browser pass

Filtering to **Status: Pending** shrank every line above susut while susut kept
its full value, with nothing on screen to say why. A movement carries neither a
`buyerId` nor a `status`, so those two filters cannot narrow it — the same
already-known limitation as pembelian, which only had a note for the pembeli
half. Both notes now cover both filters. This is the invariant from §10 applied
to a caveat rather than a figure: if the report cannot narrow something, it says
so where the number is, instead of leaving the user to infer it.
