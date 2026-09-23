// ---------- Referential-integrity checks ----------
//
// The query that finally exposed the 7 September data loss, made routine.
//
// Six orders vanished on 2026-09-07 and nothing noticed for over two weeks. The
// app kept working: the Riwayat page reads `audit` and simply had a quiet day,
// the report totalled the rows it could see, and no screen anywhere asks
// whether the rows REFERENCE each other correctly. What gave it away was that
// six `stock` rows carried an `orderId` pointing at an order that no longer
// existed — a shape that cannot occur through any normal path.
//
// It cannot occur because deleting is symmetric: `deleteOrders` tombstones the
// order AND its linked stock movements in one transaction, and `deletePurchases`
// does the same. So a LIVE movement whose parent is missing means the parent
// left by some route that is not a delete — a cleared table, a half-applied
// restore, a push that never landed. Exactly the class of failure that has no
// other symptom.
//
// Cheap enough to run on every render of the report: it is two Set lookups per
// stock row over a table in the low thousands.
//
// See R6 in docs/2026-09-23/data-loss-rules.md.

import type { OrderItem, PurchaseItem, StockMovement } from "./types";

export interface IntegrityFinding {
  kind: "order" | "purchase";
  // The movements left pointing at nothing.
  movements: StockMovement[];
  // The distinct parent ids that are missing — what a recovery would have to
  // reconstruct, and the number worth reporting.
  missingIds: string[];
  // The dates those movements carry, earliest first. This is the part that
  // turns "something is wrong" into "look at 7 September".
  dates: string[];
}

export interface IntegrityReport {
  findings: IntegrityFinding[];
  total: number;
}

// `orders` and `purchases` are the LIVE arrays from store.ts — tombstoned rows
// are absent from them, which is correct here: a tombstoned parent takes its
// movements with it, so a live movement pointing at one is just as broken as
// one pointing at a row that was erased outright.
export function checkIntegrity(
  stock: StockMovement[],
  orders: OrderItem[],
  purchases: PurchaseItem[],
): IntegrityReport {
  const orderIds = new Set(orders.map((o) => o.id));
  const purchaseIds = new Set(purchases.map((p) => p.id));

  const findings: IntegrityFinding[] = [];
  const orphanedByOrder = stock.filter((m) => m.orderId && !orderIds.has(m.orderId));
  const orphanedByPurchase = stock.filter(
    (m) => m.purchaseId && !purchaseIds.has(m.purchaseId),
  );

  if (orphanedByOrder.length > 0) {
    findings.push(summarize("order", orphanedByOrder, (m) => m.orderId));
  }
  if (orphanedByPurchase.length > 0) {
    findings.push(summarize("purchase", orphanedByPurchase, (m) => m.purchaseId));
  }

  return { findings, total: orphanedByOrder.length + orphanedByPurchase.length };
}

function summarize(
  kind: "order" | "purchase",
  movements: StockMovement[],
  idOf: (m: StockMovement) => string | null,
): IntegrityFinding {
  const missingIds = [...new Set(movements.map((m) => idOf(m)).filter((x): x is string => !!x))];
  // ISO dates, so a plain sort is chronological.
  const dates = [...new Set(movements.map((m) => m.tanggal))].sort();
  return { kind, movements, missingIds, dates };
}
