import type { StockMovement } from "./types";

export interface FifoResult {
  qty: number; // net stock, base units (signed)
  value: number; // remaining inventory value under FIFO
  unitCost: number; // value / qty when qty > 0, else 0
  movementValue: Map<string, number>; // signed money in/out per movement id
  // Base units an out-movement could NOT source from any lot, per movement id.
  // Absent (not zero) when the movement was fully covered.
  //
  // This exists because `movementValue` cannot tell "these goods cost nothing"
  // apart from "there was no lot to price them against" — both come out as 0.
  // Anything reasoning about cost has to know the difference: a sale with no
  // purchase history behind it has an UNKNOWN cost, not a zero one, and
  // reporting it as zero invents profit. See report.ts.
  uncovered: Map<string, number>;
}

// Replay one product's movements in chronological order under FIFO: each in-lot
// carries its own cost (falling back to the product's Harga Dasar), and each
// out-movement consumes the oldest lots first. Value never chases the newest
// price — it stays the actual cost of what's still on hand.
export function computeFifo(
  movements: StockMovement[],
  fallbackCost: number,
): FifoResult {
  const sorted = [...movements].sort((a, b) => {
    const byTime = (a.tanggal + a.createdAt).localeCompare(
      b.tanggal + b.createdAt,
    );
    if (byTime !== 0) return byTime;
    // SAME INSTANT: stock IN replays before stock OUT.
    //
    // "Beli stok dari pesanan" (store.ts `addPurchase` with an order) writes a
    // purchase movement and its paired sale movement in one call, from one
    // `now` — so the two are identical on both tanggal and createdAt and the
    // time comparison above cannot separate them. They are then stored under
    // random `uid()` keys, and `db.stock.toArray()` returns rows in key order,
    // so after any reload the pair can come back either way round.
    //
    // With the sale first, FIFO finds no lot: the sale costs 0 and is flagged
    // uncovered (so the order drops out of the report), and the purchase is
    // left sitting in `value` as inventory that no longer exists. Goods cannot
    // leave before they arrive, so the tie is broken in favour of arrival.
    return Math.sign(b.qty) - Math.sign(a.qty);
  });
  const lots: { qty: number; cost: number }[] = [];
  const movementValue = new Map<string, number>();
  const uncovered = new Map<string, number>();
  let value = 0;
  let qty = 0;
  // Base units that have already left but had no lot to leave from. Stock in
  // settles this before it becomes a lot — see the in-branch below.
  let deficit = 0;

  for (const m of sorted) {
    qty += m.qty;
    if (m.qty > 0) {
      const cost = m.hargaModal ?? fallbackCost;
      // Goods sold before their purchase was recorded — the ordinary shape of
      // any ledger started mid-stream. The first units to arrive are settling
      // that debt, not restocking the shelf, so they must not become a lot: a
      // 10-unit sale with no history followed by a 10-unit purchase left `qty`
      // at 0 while `value` held the full purchase price, and StockPage showed
      // inventory value for a product with nothing on hand. `uncovered` is NOT
      // cleared — the sale is still recorded as having had no cost basis at the
      // time it happened, and a later purchase cannot retroactively price it.
      const settled = Math.min(deficit, m.qty);
      deficit -= settled;
      const remaining = m.qty - settled;
      if (remaining > 0) lots.push({ qty: remaining, cost });
      const v = remaining * cost;
      value += v;
      // The movement's own value is what it added to inventory, so a purchase
      // that only settled a deficit is worth 0 here. It is not a sale movement,
      // so nothing reads this as HPP.
      movementValue.set(m.id, v);
    } else if (m.qty < 0) {
      let need = -m.qty;
      let removed = 0;
      while (need > 0 && lots.length > 0) {
        const lot = lots[0];
        const take = Math.min(need, lot.qty);
        lot.qty -= take;
        need -= take;
        removed += take * lot.cost;
        if (lot.qty <= 0) lots.shift();
      }
      value -= removed;
      movementValue.set(m.id, -removed);
      // Lots ran out before the movement was satisfied. Stock still goes
      // negative (the qty ledger is authoritative), but the cost of the
      // unsourced units is unknown, not zero.
      if (need > 0) {
        uncovered.set(m.id, need);
        deficit += need;
      }
    } else {
      movementValue.set(m.id, 0);
    }
  }

  return {
    qty,
    value,
    unitCost: qty > 0 ? value / qty : 0,
    movementValue,
    uncovered,
  };
}
