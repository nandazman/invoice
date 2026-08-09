import type {
  Buyer,
  OrderItem,
  Product,
  PurchaseItem,
  StockMovement,
} from "./types";
import { computeFifo } from "./stock";
import { baseUnitsFor } from "./purchaseFromOrder";
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

// ---------- Stock that left without a sale ----------

export interface StockLoss {
  nilai: number; // FIFO cost of the goods that left, positive
  count: number; // how many movements
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
  for (const m of stock) {
    // `orderId === null` is the test, not `reason`: an adjustment is the usual
    // way this happens, but a `sale` movement entered by hand on the Stok page
    // carries no order either, and it is the same missing cost.
    if (m.qty >= 0 || m.orderId !== null) continue;
    if (!inScope(m)) continue;
    const value = index.cost.get(m.id);
    if (value === undefined) continue;
    nilai += roundRupiah(-value);
    count += 1;
  }
  return { nilai, count };
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
// This deliberately reads EVERY pending order and ignores whatever period the
// page is filtered to. `OrderStatus` is a flag with no payment date beside it,
// so "unpaid" is a fact about now, not about a period: an order dated March and
// paid in April is `paid` today, and nothing in the row remembers that it was
// outstanding through March. A period-scoped receivable printed next to
// period-scoped revenue would only invite subtracting one from the other.
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
