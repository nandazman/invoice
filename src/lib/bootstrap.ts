import { getProducts, getOrders, getPurchases, getStock, getBuyers, getTypes, hydrateStores } from "./store";
import { getAudit, hydrateAudit } from "./audit";
import { getTemplates, hydrateTemplates } from "./template-store";
import type { Snapshot } from "./db";
import type { Payload, Row } from "./sync/tables";

// Turns a pull response into the in-memory arrays the stores serve reads from.
//
// This module exists to break a cycle: the stores import `db` to write, and the
// sync client imports the stores to fill them, so the orchestration lives here,
// above both.

function isLive(r: Row): boolean {
  return r.deletedAt == null;
}

// Merge incoming rows into `current` by id. A tombstone removes the row; a live
// row replaces or appends. `full` means the payload is the whole table (boot, or
// a revert), so it REPLACES `current` instead of merging into it.
function merge<T extends { id: string }>(
  current: T[],
  incoming: Row[] | undefined,
  full: boolean,
): T[] {
  if (!incoming) return full ? [] : current;
  if (full) return incoming.filter(isLive) as unknown as T[];
  if (incoming.length === 0) return current;

  const byId = new Map(current.map((r) => [r.id, r] as const));
  for (const raw of incoming) {
    const id = String(raw.id);
    if (isLive(raw)) byId.set(id, raw as unknown as T);
    else byId.delete(id);
  }
  return [...byId.values()];
}

// How many rows a payload carries, ignoring `types` (which is cursorless and
// comes back whole on every pull, so its length says nothing about change).
function countRows(payload: Payload): number {
  let n = 0;
  for (const [name, rows] of Object.entries(payload)) {
    if (name !== "types" && rows) n += rows.length;
  }
  return n;
}

// Apply a pull to the stores. Returns true when anything on screen may have
// changed, so the caller can tell a quiet poll from a busy one.
export function applyPull(payload: Payload, full: boolean): boolean {
  const changedTypes = payload.types
    ? payload.types.map((r) => String(r.nama)).sort((a, b) => a.localeCompare(b))
    : null;
  const typesChanged =
    changedTypes !== null && changedTypes.join("\u0000") !== getTypes().join("\u0000");

  if (!full && countRows(payload) === 0 && !typesChanged) return false;

  const snap: Snapshot = {
    products: merge(getProducts(), payload.products, full),
    orders: merge(getOrders(), payload.orders, full),
    purchases: merge(getPurchases(), payload.purchases, full),
    stock: merge(getStock(), payload.stock, full),
    buyers: merge(getBuyers(), payload.buyers, full),
    templates: merge(getTemplates(), payload.templates, full),
    audit: merge(getAudit(), payload.audit, full),
    types: changedTypes ?? getTypes(),
  };
  if (full) {
    snap.audit.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  hydrateStores(snap);
  hydrateAudit(snap);
  hydrateTemplates(snap);
  return true;
}
