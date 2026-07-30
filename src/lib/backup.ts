import type {
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
export function exportAll(): string {
  const data: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: nowISO(),
    products: getProducts(),
    orders: getOrders(),
    purchases: getPurchases(),
    stock: getStock(),
    types: getTypes(),
    buyers: getBuyers(),
    templates: getTemplates(),
    audit: getAudit(),
  };
  return JSON.stringify(data, null, 2);
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
export function importAll(text: string): void {
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

  setProducts(products);
  setOrders(orders);
  setPurchases(purchases);
  setStock(stock);
  setTypes(data.types ?? []);
  setBuyers(data.buyers ?? []);
  setTemplates(templates);
  setAudit(data.audit ?? []);
}
