import type {
  Buyer,
  OrderItem,
  Product,
  PurchaseItem,
  StockMovement,
} from "./types";
import { computeFifo } from "./stock";
import { baseUnitsFor, modalCostFor } from "./purchaseFromOrder";
import { roundRupiah, sumRupiah } from "./format";

// Laba rugi and its breakdowns, derived from rows that already exist. Nothing
// here is stored; the whole module is a projection.
//
// Three rules govern everything below (docs/2026-08-09/plan.md):
//
//  1. FIFO REPLAYS THE WHOLE HISTORY, THEN THE RESULT IS FILTERED. `computeFifo`
//     builds its lot stack from the first movement onward, so slicing movements
//     to a date range before calling it starts the replay with an empty stack:
//     a July sale would consume July's purchases, or nothing at all. Callers
//     pass EVERY live movement to `buildMovementCosts` and narrow afterwards.
//
//  2. HPP IS SELECTED THROUGH `orderId`, not by scanning movements in a date
//     range. That is what makes the produk/tipe/pembeli filters narrow revenue
//     and cost together: filter the orders, and their costs follow.
//
//  3. AN ORDER WITH NO SALE MOVEMENT CONTRIBUTES REVENUE ONLY, and is reported
//     separately rather than being given an imputed cost. See `summarize`.

// ---------- Cost basis ----------

export interface FifoIndex {
  cost: Map<string, number>; // signed money per movement id
  uncovered: Map<string, number>; // base units no lot could source, per movement
  inventoryValue: number; // total value on hand, across every product
}

// One FIFO replay over the whole ledger, yielding everything the page needs.
//
// `stock` MUST be the complete live movement list — see rule 1 at the top.
// Grouping mirrors StockPage.tsx, and `inventoryValue` is the same total that
// page shows; it is returned from here rather than computed separately so the
// most expensive operation on the page happens exactly once.
//
// The loop walks the MOVEMENT GROUPS, not the product list. Products are soft
// deleted (`deletedAt`) while their movements stay live, so iterating `products`
// silently skipped every movement of a deleted product: its sales got no cost
// entry, their orders fell out of `joinOrderCosts` entirely, and deleting a
// product retroactively erased months of revenue from a finished period. Walking
// the groups keeps history stable — deleting a product changes the price list,
// never what was already sold.
export function buildFifoIndex(
  stock: StockMovement[],
  products: Product[],
): FifoIndex {
  const byProduct = new Map<string, StockMovement[]>();
  for (const m of stock) {
    const arr = byProduct.get(m.productId) ?? [];
    arr.push(m);
    byProduct.set(m.productId, arr);
  }

  const productById = new Map(products.map((p) => [p.id, p]));
  const cost = new Map<string, number>();
  const uncovered = new Map<string, number>();
  let inventoryValue = 0;
  for (const [productId, movements] of byProduct) {
    const product = productById.get(productId);
    // A deleted product has no Harga Dasar left to fall back on. That only
    // matters for in-movements with a null `hargaModal` — legacy rows, since
    // AddMovementForm has snapshotted the cost on every stock-in since. Those
    // lots price at 0, and any sale drawing on them is understated rather than
    // quarantined. Rare enough to accept; imputing a cost is the worse trade.
    const fifo = computeFifo(movements, product?.hargaDasar ?? 0);
    for (const [id, value] of fifo.movementValue) cost.set(id, value);
    for (const [id, units] of fifo.uncovered) uncovered.set(id, units);
    // Inventory VALUE is a different question from cost: it is what the Stok
    // page shows as on hand, and a deleted product is no longer on the list.
    // Its history still costs its sales; its leftovers stop being counted.
    if (product) inventoryValue += fifo.value;
  }
  return { cost, uncovered, inventoryValue };
}

// What the stock ledger says about one order.
export interface OrderCost {
  hpp: number; // positive; the lot cost the sale consumed
  productId: string; // from the MOVEMENT, not the order — see below
  // False when FIFO ran out of lots partway through. The cost then covers only
  // part of what was sold and the rest is unknown, so the order is quarantined
  // rather than reported at an understated HPP.
  complete: boolean;
  saleMovements: number; // >1 means stock was deducted more than once
}

// Join the FIFO costs back onto orders, through `StockMovement.orderId`.
//
// `productId` comes off the movement because the order's own may be "". Legacy
// rows carry `productId: ""` (types.ts) but `addOrder` still resolves a product
// by NAME (store.ts) and stamps the resolved id on the movement it writes. So
// those orders do get a real cost, and grouping them by the order's empty string
// would collapse genuinely different products into one mislabelled row.
//
// Costs are summed across movements rather than assigned: `addOrder` writes at
// most one sale movement, but `addPurchase(item, note, order)` writes ANOTHER
// carrying the same orderId, so an order that already deducted stock and is then
// bought through "Beli stok dari pesanan" ends up deducted twice. Summing is
// faithful to the ledger — the stock really did go out twice — and
// `saleMovements` is what lets the page say so instead of quietly reporting a
// doubled HPP as fact.
export function joinOrderCosts(
  stock: StockMovement[],
  index: FifoIndex,
): Map<string, OrderCost> {
  const byOrder = new Map<string, OrderCost>();
  for (const m of stock) {
    if (m.orderId === null || m.qty >= 0) continue;
    // A movement with no cost entry contributes nothing to `hpp` but DOES clear
    // `complete`. `continue` here instead would drop the movement silently: an
    // order whose only sale went uncosted would look like an order with no stock
    // record at all, and one of several sale movements going missing would leave
    // a partial HPP reported as fact.
    const value = index.cost.get(m.id);
    const prev = byOrder.get(m.orderId);
    byOrder.set(m.orderId, {
      hpp: (prev?.hpp ?? 0) - (value ?? 0),
      productId: prev?.productId ?? m.productId,
      complete:
        (prev?.complete ?? true) &&
        value !== undefined &&
        !index.uncovered.has(m.id),
      saleMovements: (prev?.saleMovements ?? 0) + 1,
    });
  }
  return byOrder;
}

// ---------- Laba rugi ----------

export interface ProfitSummary {
  // Revenue over EVERY order handed in, quarantined ones included. The page
  // leads with this and reconciles down to `penjualan`, because a figure headed
  // "Penjualan" that silently omits rows is the one number a user will trust
  // without checking — and `tanpaStokNilai` sitting in a separate panel is not
  // a reconciliation, it is a footnote.
  penjualanTotal: number;
  penjualan: number; // revenue from orders that have a full cost basis
  hpp: number; // FIFO cost of those same orders
  labaKotor: number; // penjualan − hpp
  // labaKotor / penjualan × 100, or null when there is no revenue to divide by.
  // Null rather than 0: a bonus line sold at Rp 0 that still consumed stock is a
  // 100% loss, and "0.0%" beside it reads as break-even. See `marginOf`.
  marginPct: number | null;
  tanpaStokCount: number; // orders with no usable cost basis
  tanpaStokNilai: number; // their revenue, excluded from `penjualan`
  dobelCount: number; // orders whose stock was deducted more than once
}

// Margin as a percentage, or null when the denominator is zero.
//
// The old guard was `penjualan === 0 ? 0 : …`, which is right only when the cost
// is also zero. With revenue 0 and a real HPP behind it the true ratio is −∞ —
// there is no percentage to print — and returning 0 put "0.0%" next to a loss.
function marginOf(laba: number, penjualan: number): number | null {
  return penjualan === 0 ? null : (laba / penjualan) * 100;
}

// True when this order's cost can be stated as fact. Everything else is
// quarantined — never imputed.
//
// Three kinds fail. Two have no cost at all: `affectsStock: false`, and a
// product that never resolved by id or name — both leave the order with no sale
// movement to cost. (A product deleted *after* the order is NOT one of them: its
// movements are still costed, see `buildFifoIndex`.) The third is the dangerous
// one: FIFO ran out of lots partway through the sale, so the cost covers only
// some of the units. `movementValue` reports
// that as a smaller number, indistinguishable from a genuinely cheap sale — an
// order for goods with NO purchase history behind it prices out at exactly 0 and
// would otherwise be reported as 100% margin. Every sale that predates Beli Stok
// takes this path, so it is the common case, not an edge one.
function hasCostBasis(entry: OrderCost | undefined): entry is OrderCost {
  return entry !== undefined && entry.complete;
}

// Revenue, cost and margin over the orders handed in (already filtered).
//
// Quarantined orders have their revenue excluded too, rather than counted with a
// zero cost. That is what keeps `labaKotor = penjualan − hpp` a closed sum over
// rows that are actually comparable — and it keeps the margin honest, since
// revenue with no cost behind it reads as pure profit.
export function summarize(
  orders: OrderItem[],
  costByOrder: Map<string, OrderCost>,
): ProfitSummary {
  const priced: OrderItem[] = [];
  const unpriced: OrderItem[] = [];
  let dobelCount = 0;
  for (const o of orders) {
    const entry = costByOrder.get(o.id);
    const ok = hasCostBasis(entry);
    // Only priced orders are counted as double-deducted, so the two banners
    // stay about disjoint sets of rows. The dobel banner says "the HPP above is
    // inflated" — true only of orders that made it into the HPP above. A
    // quarantined order contributes nothing to inflate, and counting it in both
    // made two banners describe the same row with contradictory advice.
    if (ok && entry.saleMovements > 1) dobelCount += 1;
    (ok ? priced : unpriced).push(o);
  }

  const penjualan = sumRupiah(priced.map((o) => o.totalHarga));
  const hpp = sumRupiah(priced.map((o) => costByOrder.get(o.id)?.hpp ?? 0));
  const labaKotor = penjualan - hpp;

  return {
    penjualanTotal: sumRupiah(orders.map((o) => o.totalHarga)),
    penjualan,
    hpp,
    labaKotor,
    marginPct: marginOf(labaKotor, penjualan),
    tanpaStokCount: unpriced.length,
    tanpaStokNilai: sumRupiah(unpriced.map((o) => o.totalHarga)),
    dobelCount,
  };
}

// ---------- Estimated cost basis ----------

// The quarantined rows, priced at Harga Dasar instead of left out.
//
// Everything above this line is FACT: a cost the stock ledger can point at. This
// is the opposite — an assumption, and it is kept in its own shape so the page
// can never print it as though it were measured. `hasCostBasis` still decides
// which rows land here; this only offers a number for the ones it rejected.
export interface ProfitEstimate {
  count: number; // quarantined orders we could put a price on
  penjualan: number; // their revenue
  hpp: number; // their assumed modal, from Harga Dasar
  laba: number; // penjualan − hpp
  // Orders even the assumption cannot reach: the product is gone, or its Harga
  // Dasar is 0, so any figure would be invented rather than estimated. They stay
  // out of every total, and the page says how many are left.
  sisaCount: number;
  sisaNilai: number;
}

// The product an order refers to. Mirrors `addOrder` (store.ts): id first, then
// name for legacy rows that never carried one.
function productForOrder(
  o: OrderItem,
  byId: Map<string, Product>,
  byName: Map<string, Product>,
): Product | undefined {
  return byId.get(o.productId) ?? byName.get(o.namaProduk);
}

// Assume a modal for the orders `summarize` had to exclude.
//
// The basis is `modalCostFor` — Harga Dasar × base units — which is exactly what
// "Beli stok dari pesanan" fills in when it turns an order into a purchase. So
// the estimate is the same number the user would have recorded had they bought
// the stock through the app, which makes it explainable rather than magic.
//
// A partially-covered order is estimated WHOLE rather than topped up: half a
// measured cost plus half an assumed one is a figure nobody can check, and the
// mixed row would be the one that gets quoted as fact.
export function estimateUnpriced(
  orders: OrderItem[],
  costByOrder: Map<string, OrderCost>,
  products: Product[],
): ProfitEstimate {
  const byId = new Map(products.map((p) => [p.id, p]));
  const byName = new Map(products.map((p) => [p.namaProduk, p]));

  const priced: { revenue: number; modal: number }[] = [];
  let sisaCount = 0;
  let sisaNilai = 0;
  for (const o of orders) {
    if (hasCostBasis(costByOrder.get(o.id))) continue;
    const product = productForOrder(o, byId, byName);
    // Harga Dasar 0 is not a cost of zero — it is a price list nobody has filled
    // in. Estimating from it would hand back the 100% margin the quarantine
    // exists to prevent.
    if (!product || product.hargaDasar <= 0) {
      sisaCount += 1;
      sisaNilai += roundRupiah(o.totalHarga);
      continue;
    }
    priced.push({
      revenue: o.totalHarga,
      modal: o.kuantitas * modalCostFor(product, o.satuan),
    });
  }

  const penjualan = sumRupiah(priced.map((r) => r.revenue));
  const hpp = sumRupiah(priced.map((r) => r.modal));
  return {
    count: priced.length,
    penjualan,
    hpp,
    laba: penjualan - hpp,
    sisaCount,
    sisaNilai,
  };
}

// ---------- Trend ----------

// One month of the laba-rugi block, for the chart.
export interface TrendRow {
  bulan: string; // "2026-07"
  penjualan: number;
  hpp: number;
  laba: number;
}

const ISO_MONTH = /^\d{4}-\d{2}/;

// Revenue, cost and profit per calendar month, oldest first.
//
// Built from PRICED orders only, for the same reason the breakdown tables are:
// a month whose orders have no cost basis would draw a bar of pure profit, and a
// chart is read faster and questioned less than a table. Months with no priced
// order are absent rather than zero — an empty bar reads as "we sold nothing",
// which is a different claim from "nothing here could be costed".
export function monthlyTrend(
  orders: OrderItem[],
  costByOrder: Map<string, OrderCost>,
): TrendRow[] {
  const byMonth = new Map<string, { penjualan: number[]; hpp: number[] }>();
  for (const o of orders) {
    const entry = costByOrder.get(o.id);
    if (!hasCostBasis(entry)) continue;
    // The ISO prefix is the month. A `tanggal` that is not ISO (imported free
    // text) has no month to sit in and is left out; `receivables` already tells
    // the user those rows exist.
    if (!ISO_MONTH.test(o.tanggal)) continue;
    const key = o.tanggal.slice(0, 7);
    const bucket = byMonth.get(key) ?? { penjualan: [], hpp: [] };
    bucket.penjualan.push(o.totalHarga);
    bucket.hpp.push(entry.hpp);
    byMonth.set(key, bucket);
  }

  return [...byMonth.entries()]
    .map(([bulan, b]) => {
      const penjualan = sumRupiah(b.penjualan);
      const hpp = sumRupiah(b.hpp);
      return { bulan, penjualan, hpp, laba: penjualan - hpp };
    })
    .sort((a, b) => a.bulan.localeCompare(b.bulan));
}

// What the trend chart is FOR. A picture of twelve months answers "which month
// was biggest"; the question a shop owner actually has is "am I getting better
// or worse", and that is a comparison, not a shape.
export interface TrendInsight {
  bulan: string; // the most recent month in view
  margin: number | null; // its margin, null when it sold nothing
  // The mean margin of the months before it, up to `BANDING_BULAN` of them.
  // Null when there is no earlier month to compare against.
  marginSebelumnya: number | null;
  // margin − marginSebelumnya, in percentage POINTS (not percent-of-percent).
  selisihPoin: number | null;
  bulanRugi: number; // how many months in view lost money
}

// How far back "sebelumnya" reaches. One month is too noisy to call a direction
// on — a single big order moves it — and the whole history drags a shop's early
// months into a comparison with its current ones. Three is the shortest window
// that survives one unusual month.
const BANDING_BULAN = 3;

export function trendInsight(rows: TrendRow[]): TrendInsight | null {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  const before = rows.slice(Math.max(0, rows.length - 1 - BANDING_BULAN), rows.length - 1);

  // Weighted by revenue, not a mean of the monthly percentages: a month that
  // sold Rp 50 rb should not pull the baseline as hard as one that sold Rp 50
  // jt. Averaging the percentages themselves is the classic way to make a tiny
  // month decide the story.
  const penjualanBefore = sumRupiah(before.map((r) => r.penjualan));
  const labaBefore = sumRupiah(before.map((r) => r.laba));
  const marginSebelumnya =
    before.length === 0 ? null : marginOf(labaBefore, penjualanBefore);
  const margin = marginOf(last.laba, last.penjualan);

  return {
    bulan: last.bulan,
    margin,
    marginSebelumnya,
    selisihPoin:
      margin === null || marginSebelumnya === null
        ? null
        : margin - marginSebelumnya,
    bulanRugi: rows.filter((r) => r.laba < 0).length,
  };
}

// ---------- Breakdowns ----------

// One row of a margin table. `key` is the grouping id (productId or buyerId);
// `qty` is only meaningful per product, since quantities across different
// products are not addable.
export interface MarginRow {
  key: string;
  label: string;
  qty: number;
  penjualan: number;
  hpp: number;
  laba: number;
  marginPct: number | null; // null when the row has no revenue — see `marginOf`
}

// Shared body of the two breakdowns: bucket priced orders by a key, sum, sort by
// profit descending. Quarantined orders drop out here for the same reason they
// do in `summarize`, which keeps every breakdown summing back to its totals.
function group(
  orders: OrderItem[],
  costByOrder: Map<string, OrderCost>,
  keyOf: (o: OrderItem, entry: OrderCost) => string,
  labelOf: (key: string, o: OrderItem) => string,
  qtyOf: (o: OrderItem, entry: OrderCost) => number,
): MarginRow[] {
  // Each order is carried with the entry it was admitted on, so the sums below
  // never look it up a second time. The re-lookups this replaces needed `?? 0`
  // and an `as OrderCost` to typecheck — two fallbacks for a case `hasCostBasis`
  // has already ruled out, which is exactly where a real one would hide.
  type Priced = { order: OrderItem; entry: OrderCost };
  const buckets = new Map<string, { label: string; rows: Priced[] }>();
  for (const o of orders) {
    const entry = costByOrder.get(o.id);
    if (!hasCostBasis(entry)) continue;
    const key = keyOf(o, entry);
    const bucket = buckets.get(key) ?? { label: labelOf(key, o), rows: [] };
    bucket.rows.push({ order: o, entry });
    buckets.set(key, bucket);
  }

  const rows: MarginRow[] = [];
  for (const [key, { label, rows: priced }] of buckets) {
    const penjualan = sumRupiah(priced.map((p) => p.order.totalHarga));
    const hpp = sumRupiah(priced.map((p) => p.entry.hpp));
    const laba = penjualan - hpp;
    rows.push({
      key,
      label,
      qty: priced.reduce((s, p) => s + qtyOf(p.order, p.entry), 0),
      penjualan,
      hpp,
      laba,
      marginPct: marginOf(laba, penjualan),
    });
  }
  return rows.sort((a, b) => b.laba - a.laba);
}

// Margin per produk, best contributor first. The rows that matter are at the
// BOTTOM: a negative `laba` means the lot those units came from cost more than
// they were sold for — a supplier price rise that `hargaJual` never followed.
// The price list cannot show this; only the lot cost can.
export function byProduct(
  orders: OrderItem[],
  costByOrder: Map<string, OrderCost>,
  products: Product[],
): MarginRow[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return group(
    orders,
    costByOrder,
    // The MOVEMENT's productId, not the order's — legacy rows carry "" and would
    // otherwise all collapse into a single row under whichever name came first.
    (_o, entry) => entry.productId,
    // The order's own `namaProduk` is the fallback, so a deleted product still
    // reads as the thing that was sold rather than as a bare id.
    (key, o) => byId.get(key)?.namaProduk ?? o.namaProduk,
    // Base units, so a row mixing "5 pcs" and "2 box" totals 29 rather than 7.
    // Quantities in different packaging are not addable as typed.
    (o, entry) => {
      const p = byId.get(entry.productId);
      return o.kuantitas * (p ? baseUnitsFor(p, o.satuan) : 1);
    },
  );
}

// Margin per pembeli. `buyerId: ""` collapses into one row — unassigned is a
// real value here, not a missing one, and it is usually the largest row until
// the backfill has been done.
export function byBuyer(
  orders: OrderItem[],
  costByOrder: Map<string, OrderCost>,
  buyers: Buyer[],
): MarginRow[] {
  const nameById = new Map(buyers.map((b) => [b.id, b.nama]));
  return group(
    orders,
    costByOrder,
    (o) => o.buyerId,
    (key) => (key === "" ? "Tanpa pembeli" : (nameById.get(key) ?? "Pembeli dihapus")),
    // Not shown per buyer: a buyer's orders span products, and quantities of
    // different products are not addable even in base units.
    () => 0,
  );
}

// ---------- Concentration ----------

export interface ParetoRow {
  row: MarginRow;
  share: number; // this row's share of the total profit earned, 0-100
  kumulatif: number; // share of every row down to and including this one
}

export interface Pareto {
  // Profit-making rows, largest first, each carrying its running share.
  untung: ParetoRow[];
  // Loss-making rows, worst first. Kept OUT of the ranking rather than at the
  // bottom of it: a cumulative percentage only means anything over a set of
  // numbers with the same sign, and "row 9 brings the total to 104%" is not a
  // sentence anyone can act on.
  rugi: MarginRow[];
  totalUntung: number; // sum of the profit-making rows
  totalRugi: number; // sum of the losses, negative
  // How many of the top rows it takes to reach `AMBANG` of the profit. This is
  // the number the chart exists to produce: "4 products earn 80% of it" tells
  // the owner what to protect, which no ranking of bars does on its own.
  inti: number;
}

// The Pareto threshold. 80 is the convention and it is arbitrary; what makes it
// useful is that it is FIXED, so the count moves only when the business does.
const AMBANG = 80;

export function paretoProfit(rows: MarginRow[]): Pareto {
  const untungRows = rows.filter((r) => r.laba > 0).sort((a, b) => b.laba - a.laba);
  const rugi = rows.filter((r) => r.laba < 0).sort((a, b) => a.laba - b.laba);
  const totalUntung = sumRupiah(untungRows.map((r) => r.laba));
  const totalRugi = sumRupiah(rugi.map((r) => r.laba));

  let jalan = 0;
  let inti = 0;
  const untung = untungRows.map((row, i) => {
    jalan += row.laba;
    // Guarded because every row can be laba 0 — filtered out above, but a
    // totalUntung of 0 with an empty list still reaches the division below.
    const kumulatif = totalUntung === 0 ? 0 : (jalan / totalUntung) * 100;
    // The first row to cross the line is counted, so `inti` is "how many rows
    // you need", not "how many fit under it".
    if (inti === 0 && kumulatif >= AMBANG) inti = i + 1;
    return {
      row,
      share: totalUntung === 0 ? 0 : (row.laba / totalUntung) * 100,
      kumulatif,
    };
  });

  return { untung, rugi, totalUntung, totalRugi, inti };
}

// ---------- Stock that left without a sale ----------

export interface StockLoss {
  nilai: number; // FIFO cost of the goods that left, positive
  count: number; // how many movements, counting only the priced ones
  // Movements FIFO could not source from any lot. Their cost is unknown, not
  // zero, so they are left out of `nilai` and `count` and reported here — the
  // same quarantine rule `hasCostBasis` applies to sales. Counting them at 0
  // printed "Susut (3) — Rp 0" and left the bottom line overstated by exactly
  // the value of goods nobody could price.
  tanpaModal: number;
}

// Stock that went OUT of the ledger without an order behind it: susut, rusak,
// hilang, a stock-take correction, goods taken for personal use.
//
// This has to appear in the laba-rugi block, not beside it. Those units consumed
// real lots — FIFO popped their cost out of `persediaan` exactly as a sale would
// — but no order ever picked the cost up, so it vanished from the arithmetic
// entirely. Inventory fell, nothing was charged, and Laba Kotor came out
// overstated by precisely the value of the goods that were lost. The bigger the
// leak, the better the report looked.
//
// `inScope` is a predicate rather than a date range because the caller owns what
// the period means, and the same movement-level filtering has to agree with the
// one the orders went through. It cannot express every filter: a movement has no
// buyer, so a pembeli filter has nothing to match here — the page says so rather
// than pretending the number narrowed.
export function stockLoss(
  stock: StockMovement[],
  index: FifoIndex,
  inScope: (m: StockMovement) => boolean,
): StockLoss {
  let nilai = 0;
  let count = 0;
  let tanpaModal = 0;
  for (const m of stock) {
    // `orderId === null` is the test, not `reason`: an adjustment is the usual
    // way this happens, but a `sale` movement entered by hand on the Stok page
    // carries no order either, and it is the same missing cost.
    if (m.qty >= 0 || m.orderId !== null) continue;
    if (!inScope(m)) continue;
    const value = index.cost.get(m.id);
    if (value === undefined) continue;
    // Partially covered counts as uncovered, exactly as it does for a sale:
    // the movement's value then holds the cost of only some of the units, and
    // reporting that as the loss understates it.
    if (index.uncovered.has(m.id)) {
      tanpaModal += 1;
      continue;
    }
    nilai += roundRupiah(-value);
    count += 1;
  }
  return { nilai, count, tanpaModal };
}

// ---------- Piutang ----------

export interface Aging {
  d0_30: number;
  d31_60: number;
  d60plus: number;
  total: number;
  count: number;
  // Pending orders whose `tanggal` could not be read as a date. They are aged
  // into the OLDEST bucket, and counted here so the page can say why.
  tanggalTidakValid: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Whole days between two ISO dates (yyyy-mm-dd), or null when either will not
// parse. Counted on the calendar rather than on elapsed time: both are read as
// UTC midnight, so no timezone offset or DST shift can move a row across a
// bucket boundary.
//
// Null, not 0. `parseTanggalID` returns its input unchanged when it cannot read
// it (format.ts), so an imported row can hold free text in `tanggal`; returning
// 0 aged every one of those into "0–30 hari", which is the bucket nobody chases.
// An unreadable date is the opposite of reassuring, and it sorts to the oldest.
function daysBetween(from: string, to: string): number | null {
  // The shape is checked before parsing because Date.parse is far too willing:
  // its legacy fallback reads "15 Juli" as 15 July *2001*, a date that is not
  // NaN, is 25 years stale, and would be aged as fact. Only yyyy-mm-dd counts.
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

// Outstanding receivables, aged by order date.
//
// Scope is the CALLER's decision, because "unpaid" has two honest readings and
// only one of them is computable. `OrderStatus` is a flag with no payment date
// beside it, so nothing in the data can answer "how much was outstanding at the
// end of August" — an order dated March and paid in April reads `paid` today,
// and the row does not remember it was outstanding through March. What IS
// answerable is "orders PLACED in August that are still unpaid today", and that
// is what passing a period-filtered list here means. Laporan shows both: the
// filtered list as the headline, the whole list as the reconciliation beneath
// it, each labelled with the period it covers.
//
// The buckets always age against `today` whichever list comes in, so a filtered
// total and an unfiltered one are directly comparable — one is a subset of the
// other, never a different clock.
//
// `today` is a parameter rather than a `todayISO()` call so the buckets are
// testable; a function that reads the clock cannot be pinned.
export function receivables(orders: OrderItem[], today: string): Aging {
  const aging: Aging = {
    d0_30: 0,
    d31_60: 0,
    d60plus: 0,
    total: 0,
    count: 0,
    tanggalTidakValid: 0,
  };
  for (const o of orders) {
    if (o.status !== "pending") continue;
    const amount = Math.round(o.totalHarga);
    const age = daysBetween(o.tanggal, today);
    // Boundaries follow the labels: 30 days old is still 0–30, 60 is still
    // 31–60. A future-dated order (negative age) belongs in the newest bucket.
    if (age === null) {
      aging.d60plus += amount;
      aging.tanggalTidakValid += 1;
    } else if (age <= 30) aging.d0_30 += amount;
    else if (age <= 60) aging.d31_60 += amount;
    else aging.d60plus += amount;
    aging.total += amount;
    aging.count += 1;
  }
  return aging;
}

// ---------- Context figures ----------

// Cash out for stock in the filtered period. Reported BESIDE the laba-rugi
// block and never inside it: a purchase moves money into persediaan, and its
// cost only becomes an expense when FIFO releases it as HPP on a sale.
// Subtracting it from revenue double-counts the goods and makes profit swing
// with restock timing — deeply negative the month a big order lands, inflated
// the month after.
export function purchaseTotal(purchases: PurchaseItem[]): number {
  return sumRupiah(purchases.map((p) => p.totalHarga));
}

// Inventory value on hand right now — the same figure the Stok page shows —
// comes off `FifoIndex.inventoryValue`. It is not a separate function: a second
// pass would re-walk every movement of every product to recompute a number the
// first pass already had. Unfiltered by design: like piutang, it is a balance at
// a moment, not a flow across the period.
