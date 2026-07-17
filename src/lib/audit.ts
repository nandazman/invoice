import { useSyncExternalStore } from "react";
import type { AuditEntry, Product, StockMovement } from "./types";
import { uid, nowISO } from "./format";
import { db, persist, type Snapshot } from "./db";

// The global audit log. Append-only: entries are never updated or deleted, so
// this is the one store with no `deletedAt`.
//
// It is also the hottest write path in the app — every mutation appends here.
// Under localStorage each append rewrote the ENTIRE log (O(n) stringify + write
// per entry, on the biggest and fastest-growing table). Now it is one row.
let entries: AuditEntry[] = [];

export function hydrateAudit(snap: Snapshot): void {
  entries = snap.audit;
  emit();
}

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useAudit(): AuditEntry[] {
  return useSyncExternalStore(subscribe, () => entries);
}

export function getAudit(): AuditEntry[] {
  return entries;
}

// Replace the whole log (used by Restore). No id regeneration.
export function setAudit(next: AuditEntry[]): void {
  entries = next;
  emit();
  persist("setAudit", () =>
    db.transaction("rw", db.audit, async () => {
      await db.audit.clear();
      await db.audit.bulkPut(next);
    }),
  );
}

// Stamp an entry, append it to the in-memory log, and RETURN it.
//
// IMPORTANT: this does NOT write to IndexedDB. The caller must put the returned
// entry inside its own transaction — an audit entry always accompanies a data
// mutation, and the two must commit together or not at all. Logging separately
// would reintroduce exactly the torn-write problem that transactions fix.
export function logAudit(entry: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
  const full: AuditEntry = { ...entry, id: uid(), timestamp: nowISO() };
  entries = [...entries, full];
  emit();
  return full;
}

// The audit entry for a newly recorded stock movement. Shared by addMovement,
// addOrder, and addPurchase, which all create movements.
export function auditRow(m: StockMovement, products: Product[]): AuditEntry {
  const name = products.find((p) => p.id === m.productId)?.namaProduk ?? m.productId;
  const sign = m.qty > 0 ? "+" : "";
  return logAudit({
    entity: "stock",
    entityId: m.id,
    action: "create",
    label: `Stok ${name}: ${sign}${m.qty} (${m.reason})${
      m.orderId ? " dari pesanan" : ""
    }`,
  });
}

// Field-level diff between two objects. Only keys in `fields` are compared;
// values that differ (by strict !==) become { field, from, to }.
export function diff<T extends object>(
  oldObj: T,
  newObj: T,
  fields: (keyof T)[],
): { field: string; from: unknown; to: unknown }[] {
  const out: { field: string; from: unknown; to: unknown }[] = [];
  for (const f of fields) {
    const from = oldObj[f];
    const to = newObj[f];
    if (!Object.is(from, to)) {
      out.push({ field: String(f), from, to });
    }
  }
  return out;
}
