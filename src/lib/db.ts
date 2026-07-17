import Dexie, { type Table } from "dexie";
import type {
  Product,
  OrderItem,
  PurchaseItem,
  StockMovement,
  AuditEntry,
} from "./types";
import type { Template } from "./template-types";
import {
  hasLegacyData,
  loadProducts,
  loadOrders,
  loadPurchases,
  loadStock,
  loadTypes,
  loadAudit,
} from "./storage";
import { seedProducts } from "./seed";

// The IndexedDB layer. Replaces localStorage for all core business data.
//
// Two decisions shape everything here (see docs/2026-07-17/plan.md):
//
//  1. ONE RECORD PER ROW, not one JSON blob per table. A mutation writes a
//     single row, so write cost is proportional to the row and not to the size
//     of the table. localStorage forced whole-table JSON.stringify on every
//     write; that is gone.
//
//  2. THE IN-MEMORY ARRAYS STAY. `readAll()` bulk-reads every live row once at
//     boot; the stores keep serving synchronous reads off module-level arrays.
//     Nothing downstream of the stores becomes async.

// A product type ("Bar", "Dapur", ...). Legacy shape was a bare string[]; it is
// a table here so it is a row like everything else. No deletedAt: nothing
// deletes types today.
export interface TypeRow {
  nama: string;
}

// Bootstrap bookkeeping (migration flag). Not user data.
export interface MetaRow {
  key: string;
  value: unknown;
}

const MIGRATED_KEY = "migrated.v1";

class InvoiceDB extends Dexie {
  products!: Table<Product, string>;
  orders!: Table<OrderItem, string>;
  purchases!: Table<PurchaseItem, string>;
  stock!: Table<StockMovement, string>;
  templates!: Table<Template, string>;
  audit!: Table<AuditEntry, string>;
  types!: Table<TypeRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("invoice");
    // First segment is the primary key; the rest are indexes.
    //
    // On `deletedAt`: IndexedDB CANNOT INDEX null. Rows with `deletedAt: null`
    // — i.e. every live row — are simply absent from this index. So the index
    // is useless for "find live rows" but exactly right for "find tombstones"
    // (see `purgeTombstones`). Live rows are filtered in JS during `readAll`,
    // which is free: that read is a full table scan by design anyway.
    this.version(1).stores({
      products: "id, deletedAt, namaProduk, tipe",
      orders: "id, deletedAt, tanggal, productId, status",
      purchases: "id, deletedAt, tanggal, productId",
      stock: "id, deletedAt, productId, orderId, purchaseId, tanggal",
      templates: "id, deletedAt",
      audit: "id, timestamp, entity",
      types: "nama",
      meta: "key",
    });
  }
}

export const db = new InvoiceDB();

// ---------- Write failure surfacing ----------

// The UI is optimistic: stores update memory and emit BEFORE the write lands,
// so a failed write fails after the user already saw success. There is no
// rollback (a single-user local app does not warrant one) — instead failures
// are surfaced here and the shell shows them.
type PersistErrorHandler = (err: unknown, op: string) => void;
let onError: PersistErrorHandler = (err, op) => {
  console.error(`[db] persist failed during "${op}"`, err);
};

export function onPersistError(handler: PersistErrorHandler): void {
  onError = handler;
}

// In-flight writes. Tracked so `flushWrites()` can await them; nothing else
// should depend on this, since the UI deliberately never waits on a write.
let pending = new Set<Promise<unknown>>();

// Fire-and-forget a write, routing any failure to the handler. Callers stay
// synchronous; this is what lets the store API keep its sync signatures.
export function persist(op: string, run: () => Promise<unknown>): void {
  const p = run().catch((err) => onError(err, op));
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

// Await every in-flight write. Exists for tests: the store API is synchronous
// by design, so without this a test cannot tell "the write landed" from "the
// write was never issued".
export async function flushWrites(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}

// ---------- Boot ----------

// Everything the stores need to hydrate, read in one pass.
export interface Snapshot {
  products: Product[];
  orders: OrderItem[];
  purchases: PurchaseItem[];
  stock: StockMovement[];
  templates: Template[];
  audit: AuditEntry[];
  types: string[];
}

// True when IndexedDB is usable at all. Private-mode Firefox and some embedded
// webviews expose the API but throw on open, so this actually opens the db.
export async function isAvailable(): Promise<boolean> {
  try {
    await db.open();
    return true;
  } catch {
    return false;
  }
}

// Ask the browser to stop treating our data as evictable. IndexedDB defaults to
// "best-effort", meaning it can be dropped under disk pressure — not acceptable
// for uninvoiced business data with no server behind it. Best-effort itself:
// browsers may grant, deny, or ignore. Never blocks boot.
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// Live rows only — tombstones stay in IndexedDB and never reach the stores.
function live<T extends { deletedAt: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => r.deletedAt === null);
}

// Bulk-read every table. One sequential read each, once, at boot.
export async function readAll(): Promise<Snapshot> {
  const [products, orders, purchases, stock, templates, audit, types] =
    await Promise.all([
      db.products.toArray(),
      db.orders.toArray(),
      db.purchases.toArray(),
      db.stock.toArray(),
      db.templates.toArray(),
      db.audit.toArray(),
      db.types.toArray(),
    ]);

  return {
    products: live(products),
    orders: live(orders),
    purchases: live(purchases),
    stock: live(stock),
    templates: live(templates),
    audit, // append-only, no tombstones
    types: types.map((t) => t.nama).sort((a, b) => a.localeCompare(b)),
  };
}

// ---------- Migration ----------

export type MigrationResult =
  | { status: "skipped" } // already migrated
  | { status: "seeded" } // fresh install, no legacy data
  | { status: "migrated"; counts: Record<string, number> };

async function isMigrated(): Promise<boolean> {
  const row = await db.meta.get(MIGRATED_KEY);
  return row?.value === true;
}

// Stamp `deletedAt: null` onto legacy rows, which predate the field. Spread
// first and assign after, so an existing value always wins and a missing one
// cannot be resurrected as `undefined` (which IndexedDB would store verbatim).
function withTombstoneField<T extends { deletedAt?: string | null }>(
  rows: T[],
): (T & { deletedAt: string | null })[] {
  return rows.map((r) => ({ ...r, deletedAt: r.deletedAt ?? null }));
}

// One-time copy of localStorage -> IndexedDB.
//
// Ordering is the whole point: copy, VERIFY, and only then record that we are
// migrated. The legacy localStorage keys are deliberately NOT deleted — they
// are ≤5MB by definition and they are the only rollback path if this proves
// buggy in the field. A later release removes them.
export async function migrateFromLocalStorage(): Promise<MigrationResult> {
  if (await isMigrated()) return { status: "skipped" };

  // Fresh install: nothing to copy. Seed products straight into IDB rather than
  // routing through the legacy loaders, which would write the seed back out to
  // localStorage as a side effect.
  if (!hasLegacyData()) {
    const seeded = withTombstoneField(seedProducts());
    await db.transaction("rw", db.products, db.types, db.meta, async () => {
      await db.products.bulkPut(seeded);
      await db.types.bulkPut([{ nama: "Bar" }]);
      await db.meta.put({ key: MIGRATED_KEY, value: true });
    });
    return { status: "seeded" };
  }

  // Read through the existing loaders on purpose: they already back-fill every
  // legacy field (tipe, hargaDasar, productId, timestamps). Reimplementing that
  // here would be a second, divergent copy of the same rules.
  const products = withTombstoneField(loadProducts());
  const orders = withTombstoneField(loadOrders());
  const purchases = withTombstoneField(loadPurchases());
  const stock = withTombstoneField(loadStock());
  const audit = loadAudit();
  const types = loadTypes().map((nama) => ({ nama }));
  const templates = withTombstoneField(loadLegacyTemplates());

  await db.transaction(
    "rw",
    [db.products, db.orders, db.purchases, db.stock, db.templates, db.audit, db.types],
    async () => {
      await db.products.bulkPut(products);
      await db.orders.bulkPut(orders);
      await db.purchases.bulkPut(purchases);
      await db.stock.bulkPut(stock);
      await db.templates.bulkPut(templates);
      await db.audit.bulkPut(audit);
      await db.types.bulkPut(types);
    },
  );

  // Verify before flagging. If a count is short the write silently lost rows,
  // and we must NOT mark the migration done — the legacy keys are still intact,
  // so the next boot retries.
  const expected: Record<string, number> = {
    products: products.length,
    orders: orders.length,
    purchases: purchases.length,
    stock: stock.length,
    templates: templates.length,
    audit: audit.length,
    types: types.length,
  };
  const actual: Record<string, number> = {
    products: await db.products.count(),
    orders: await db.orders.count(),
    purchases: await db.purchases.count(),
    stock: await db.stock.count(),
    templates: await db.templates.count(),
    audit: await db.audit.count(),
    types: await db.types.count(),
  };
  for (const [table, want] of Object.entries(expected)) {
    if (actual[table] !== want) {
      throw new Error(
        `Migrasi gagal diverifikasi: tabel "${table}" berisi ${actual[table]} baris, ` +
          `diharapkan ${want}. Data lama di localStorage TIDAK dihapus — ` +
          `muat ulang halaman untuk mencoba lagi.`,
      );
    }
  }

  await db.meta.put({ key: MIGRATED_KEY, value: true });
  return { status: "migrated", counts: expected };
}

// Templates are the one legacy store whose reader lives in template-store.ts,
// which now depends on this module. Read the raw key here to avoid the cycle.
const LEGACY_TEMPLATES_KEY = "invoice.templates.v1";
function loadLegacyTemplates(): Template[] {
  try {
    const raw = localStorage.getItem(LEGACY_TEMPLATES_KEY);
    if (raw == null) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Template[]) : [];
  } catch {
    return [];
  }
}

// ---------- Maintenance ----------

// Drop tombstones older than `days`. Nothing calls this yet — it exists because
// the deletedAt index only ever contains tombstones (null is unindexable), so
// this is the one query that index is for.
export async function purgeTombstones(days = 90): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const tables = [db.products, db.orders, db.purchases, db.stock, db.templates];
  let removed = 0;
  for (const table of tables) {
    removed += await (table as Table<{ deletedAt: string | null }, string>)
      .where("deletedAt")
      .below(cutoff)
      .delete();
  }
  return removed;
}
