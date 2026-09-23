import type {
  Attribution,
  Product,
  OrderItem,
  PurchaseItem,
  StockMovement,
  AuditEntry,
  Buyer,
} from "./types";
import type { Template } from "./template-types";
import { nowISO } from "./format";
import {
  getProducts,
  getOrders,
  getPurchases,
  getStock,
  getTypes,
  getBuyers,
  setProducts,
  setOrders,
  setPurchases,
  setStock,
  setTypes,
  setBuyers,
} from "./store";
import { getAudit, setAudit } from "./audit";
import { getTemplates, setTemplates } from "./template-store";
import { rescueUnsynced } from "./rescue";

// Bumped whenever the on-disk backup shape changes incompatibly.
//
//   v2 — pre-IndexedDB. No `deletedAt` on any row.
//   v3 — adds `deletedAt` (see docs/2026-07-17/plan.md).
//   v4 — adds `buyers` and `OrderItem.buyerId` (see docs/2026-07-29/plan.md).
//
// v2 files are READ AND UPGRADED, not rejected: users have backup files on disk
// from before the IndexedDB migration, and a backup you cannot restore is not a
// backup. Only unknown/future versions are refused.
export const BACKUP_VERSION = 4;
const SUPPORTED_VERSIONS = [2, 3, 4];

// The full-backup document: raw internal shapes with IDs preserved so a restore
// is a byte-for-byte replacement (unlike io.ts, which regenerates ids on import).
export interface BackupFile {
  version: number;
  exportedAt: string; // ISO datetime the backup was produced
  products: Product[];
  orders: OrderItem[];
  purchases: PurchaseItem[];
  stock: StockMovement[];
  types: string[];
  buyers: Buyer[];
  templates: Template[];
  audit: AuditEntry[];
}

// Serialize every store into one pretty-printed backup document, IDs preserved.
//
// Exports LIVE rows only: the stores hold no tombstones, and a tombstone is
// bookkeeping for a delete that already happened — not something a restore on
// another machine needs. A v4 backup therefore round-trips byte-identically.
//
// And it exports NO attribution — see `shed` below, which is the other half of
// why that round-trip still holds now that rows carry `createdBy`/`updatedBy`.
export function exportAll(): string {
  const data: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: nowISO(),
    products: shed(getProducts()),
    orders: shed(getOrders()),
    purchases: shed(getPurchases()),
    stock: shed(getStock()),
    types: getTypes(),
    buyers: shed(getBuyers()),
    templates: shed(getTemplates()),
    audit: shed(getAudit()),
  };
  return JSON.stringify(data, null, 2);
}

// Attribution does not go in the file.
//
// `createdBy`/`updatedBy` are stamped by the Worker from a verified Access
// token, and they assert something narrow: the SERVER saw this person do this.
// A JSON file on someone's disk cannot make that claim — it is editable by
// anyone who has it — and a restore cannot honour it, because the restore is
// itself a local write the server has not seen (which is why store.ts's bulk
// setters run every incoming row through `fresh`).
//
// So the file simply does not carry the field. This is the same rule `pick()`
// enforces on the push path, applied to the other direction data leaves the
// app: attribution travels out of the server and nowhere else. It is also what
// keeps "a v4 backup round-trips byte-identically" true rather than
// almost-true — export drops the field, restore would have cleared it anyway.
//
// The bare `_` names are unused on purpose: this is the destructuring form of
// "everything except these two", and it is the only form that removes a key
// rather than setting it to undefined.
function shed<T extends Attribution>(rows: T[]): T[] {
  return rows.map(({ createdBy: _c, updatedBy: _u, ...rest }) => rest as T);
}

// Stamp `deletedAt: null` onto rows from a v2 file, which predates the field.
// Spread first, assign after: an existing value wins, and a missing one cannot
// land as `undefined`.
function upgradeRows<T extends { deletedAt?: string | null }>(
  rows: T[] | undefined,
): (T & { deletedAt: string | null })[] {
  return (rows ?? []).map((r) => ({ ...r, deletedAt: r.deletedAt ?? null }));
}

// Stamp `buyerId: ""` onto orders from a v2/v3 file, which predate the field.
// Same spread-first rule as upgradeRows, and for the same reason: an existing
// buyer wins, and a missing one must land as "" rather than as `undefined`,
// which IndexedDB stores verbatim and every `buyerId === ""` check then misses.
function upgradeOrders<T extends { buyerId?: string }>(
  rows: T[],
): (T & { buyerId: string })[] {
  return rows.map((r) => ({ ...r, buyerId: r.buyerId ?? "" }));
}

// Wholesale-replace every store from a backup document (no id regeneration).
//
// All parsing/validation happens BEFORE any store is touched, so a bad file
// leaves everything untouched.
//
// Unlike the pre-IndexedDB version, this no longer requires the caller to
// reload the page: `types` and `templates` now have real setters, so every
// store here is reactive and updates live.
//
// A restore deliberately does NOT touch the buyer-backfill flag: it records
// that this installation has been asked, not that this data has buyers. An
// installation that already answered stays unasked (the per-row picker is
// there), and a fresh one still gets the prompt. See docs/2026-07-29/plan.md §6.
// Async ONLY because of the rescue below. Every store write it makes is still
// fire-and-forget (the caller waits on `flushWrites()`), so awaiting this does
// not mean the restore is durable — it means the safety net is written.
export async function importAll(text: string): Promise<void> {
  const data = JSON.parse(text) as Partial<BackupFile>;

  if (typeof data.version !== "number" || !SUPPORTED_VERSIONS.includes(data.version)) {
    throw new Error(
      `Versi cadangan tidak didukung — diharapkan ${SUPPORTED_VERSIONS.join(
        " atau ",
      )}, ditemukan ${data.version ?? "tidak ada"}.`,
    );
  }

  // v2 -> v3: backfill deletedAt. A no-op for v3 files.
  const products = upgradeRows(data.products);
  // v3 -> v4: backfill buyerId. A no-op for v4 files.
  const orders = upgradeOrders(upgradeRows(data.orders));
  const purchases = upgradeRows(data.purchases);
  const stock = upgradeRows(data.stock);
  const templates = upgradeRows(data.templates);

  // Everything above validates; nothing above writes. From here the stores are
  // replaced wholesale — `setOrders` and its siblings `clear()` the table and
  // drop tombstones with it — so this is the last moment at which rows that
  // never reached the cloud still exist anywhere. Write them out first, and let
  // a failure here abort the restore. See R1 in
  // docs/2026-09-23/data-loss-rules.md.
  await rescueUnsynced("pulihkan-cadangan");

  setProducts(products);
  setOrders(orders);
  setPurchases(purchases);
  setStock(stock);
  setTypes(data.types ?? []);
  setBuyers(data.buyers ?? []);
  setTemplates(templates);
  setAudit(data.audit ?? []);
}
