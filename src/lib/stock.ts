import type { StockMovement } from "./types";

export interface FifoResult {
  qty: number; // net stock, base units (signed)
  value: number; // remaining inventory value under FIFO
  unitCost: number; // value / qty when qty > 0, else 0
  movementValue: Map<string, number>; // signed money in/out per movement id
}

// Replay one product's movements in chronological order under FIFO: each in-lot
// carries its own cost (falling back to the product's Harga Dasar), and each
// out-movement consumes the oldest lots first. Value never chases the newest
// price — it stays the actual cost of what's still on hand.
export function computeFifo(
  movements: StockMovement[],
  fallbackCost: number,
): FifoResult {
  const sorted = [...movements].sort((a, b) =>
    (a.tanggal + a.createdAt).localeCompare(b.tanggal + b.createdAt),
  );
  const lots: { qty: number; cost: number }[] = [];
  const movementValue = new Map<string, number>();
  let value = 0;
  let qty = 0;

  for (const m of sorted) {
    qty += m.qty;
    if (m.qty > 0) {
      const cost = m.hargaModal ?? fallbackCost;
      lots.push({ qty: m.qty, cost });
      const v = m.qty * cost;
      value += v;
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
    } else {
      movementValue.set(m.id, 0);
    }
  }

  return { qty, value, unitCost: qty > 0 ? value / qty : 0, movementValue };
}
