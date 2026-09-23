import Dexie, { type Table } from "dexie";
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
import { seedTemplate } from "./template-seed";

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
export interface TypeRow extends Attribution {
  nama: string;
}

// Bootstrap bookkeeping (migration flag). Not user data.
export interface MetaRow {
  key: string;
  value: unknown;
}

const MIGRATED_KEY = "migrated.v1";

// Set once the user has answered the "which pembeli owns your existing orders?"
// prompt — either way. Its ABSENCE is the only thing that means "never asked":
// `buyerId === ""` cannot distinguish "not asked yet" from "asked, and the
// answer was none", so checking the orders themselves would prompt forever.
// See docs/2026-07-29/plan.md §3.
export const BUYER_BACKFILL_KEY = "buyerBackfill.v1";

// Set on a fresh install to mean "the starter catalogue has NOT been written
// yet, and the cloud has not been consulted about whether it should be".
// Cleared by `resolveSeed()` once there is an answer either way.
//
// This flag exists because seeding at boot was actively destructive. The seed
// mints 39 products with fresh `uid()`s, and boot runs before sync has said a
// word — so on every new browser the seeded catalogue landed BESIDE the real
// one pulled from D1 (same names, different ids, nothing to merge on), and for
// an account that may push, those 39 rows then went up and polluted the cloud
// for everyone. A device that has never seen the cloud has no business deciding
// the catalogue is empty.
export const SEED_PENDING_KEY = "seed.pending.v1";

// Per-table sync cursors: the newest cursor value known to have reached the
// cloud. Owned by sync/client.ts, which is the only writer — it lives here
// because `rescue.ts` must read it to tell synced rows from pending ones, and
// importing client.ts from there would close an import cycle through
// bootstrap.ts.
export const WATERMARKS_KEY = "sync.watermarks.v1";

class InvoiceDB extends Dexie {
  products!: Table<Product, string>;
  orders!: Table<OrderItem, string>;
  purchases!: Table<PurchaseItem, string>;
  stock!: Table<StockMovement, string>;
  templates!: Table<Template, string>;
  audit!: Table<AuditEntry, string>;
  types!: Table<TypeRow, string>;
  buyers!: Table<Buyer, string>;
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

    // v2 — adds `buyers` and `OrderItem.buyerId` (docs/2026-07-29/plan.md).
    //
    // version(1) above stays VERBATIM. Dexie replays the version chain on an
    // installed database, so deleting it breaks every upgrade path.
    //
    // Only the changed tables are listed; unlisted ones carry over unchanged.
    this.version(2)
      .stores({
        buyers: "id, deletedAt, nama",
        orders: "id, deletedAt, tanggal, productId, status, buyerId",
      })
      // Existing order rows predate the field. Without this they carry
      // `undefined`, which IndexedDB stores verbatim and which every
      // `buyerId === ""` check would then silently miss.
      .upgrade((tx) =>
        tx
          .table<OrderItem>("orders")
          .toCollection()
          .modify((o) => {
            o.buyerId = o.buyerId ?? "";
          }),
      );

    // NO version(3) for `createdBy`/`updatedBy`. A Dexie schema string declares
    // the primary key and the INDEXES, nothing else — the record itself is a
    // structured clone of whatever object you put, so an unindexed field needs
    // no migration and is readable the moment it is written. Neither attribution
    // field is indexed (nothing queries by them; they are display-only), so
    // there is no schema change to version. `buyerId` above is the contrast: it
    // IS an index, which is exactly why it needed version(2).
    //
    // No backfill either. `buyerId` needed one because `undefined` broke an
    // equality check; here absence is the honest answer for a row that has never
    // been pushed, and the types say so (`createdBy?: string | null`).
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

// ---------- Write notification ----------

// Same registration pattern as `onPersistError`, and for the same reason: the
// D1 sync client needs to know a write happened, but this module must not
// import it. `db -> sync -> db` would be a cycle, and `db` is the lower layer.
//
// A SET, not a single slot. There are two independent listeners now — the sync
// client schedules a push, and sync/tabs.ts tells the other tabs to re-read
// IndexedDB — and with a single slot whichever registered last would silently
// unregister the other. Returning a disposer rather than exposing a remove
// function keeps the caller from having to hold onto the handler identity.
type WriteHandler = () => void;
const writeHandlers = new Set<WriteHandler>();

export function onWrite(handler: WriteHandler): () => void {
  writeHandlers.add(handler);
  return () => {
    writeHandlers.delete(handler);
  };
}

// In-flight writes. Tracked so `flushWrites()` can await them; nothing else
// should depend on this, since the UI deliberately never waits on a write.
let pending = new Set<Promise<unknown>>();

// Fire-and-forget a write, routing any failure to the handler. Callers stay
// synchronous; this is what lets the store API keep its sync signatures.
export function persist(op: string, run: () => Promise<unknown>): void {
  // The notification fires AFTER the write resolves, never before: the sync
  // sweep reads Dexie, so a handler run at call time would miss the very row
  // that triggered it. A throwing handler must not become a persist failure.
  const p = run().then(
    () => {
      // Each handler is isolated: one that throws must not stop the others from
      // running, and none of them may turn a write that SUCCEEDED into a
      // persist failure.
      for (const handler of writeHandlers) {
        try {
          handler();
        } catch (err) {
          console.error("[db] write handler failed", err);
        }
      }
    },
    (err) => onError(err, op),
  );
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

// ---------- Attribution on local writes ----------

// `updatedBy` is stamped by the Worker from a verified Access token, so the
// column means exactly one thing: "the server saw this person do it". A local
// edit INVALIDATES it — the row changed, but the value still names whoever
// edited it last time, so between the write and the next pull the UI would
// confidently show the wrong person. Clearing it renders "—", which is the
// honest state for a change the server has not seen yet.
//
// Nothing is stamped locally on purpose. An unverified address sitting in the
// same column as a verified one would end the column's only guarantee, and
// there would be no way to tell the two apart by looking.
//
// `createdAt`/`createdBy` are untouched: the creator did not change, and the
// Worker's COALESCE keeps the stored value across an update anyway.
export function touch<T extends Attribution & { updatedAt: string }>(
  row: T,
  now: string,
): T {
  return { ...row, updatedAt: now, updatedBy: null };
}

// The same rule for a row BORN from another one — a duplicate, an import. Here
// `createdBy` is wrong too: this row was made by whoever is sitting here now,
// not by the person who made the row it was copied from. `structuredClone`
// copies both fields happily, which is exactly the trap this closes.
export function fresh<T extends Attribution>(row: T): T {
  return { ...row, createdBy: null, updatedBy: null };
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
  buyers: Buyer[];
  // True when the buyer backfill prompt has never been answered. Resolved here
  // so the check stays synchronous downstream, like every other store read.
  needsBuyerBackfill: boolean;
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
  const [products, orders, purchases, stock, templates, audit, types, buyers, backfill] =
    await Promise.all([
      db.products.toArray(),
      db.orders.toArray(),
      db.purchases.toArray(),
      db.stock.toArray(),
      db.templates.toArray(),
      db.audit.toArray(),
      db.types.toArray(),
      db.buyers.toArray(),
      db.meta.get(BUYER_BACKFILL_KEY),
    ]);

  return {
    products: live(products),
    orders: live(orders),
    purchases: live(purchases),
    stock: live(stock),
    templates: live(templates),
    audit, // append-only, no tombstones
    types: types.map((t) => t.nama).sort((a, b) => a.localeCompare(b)),
    buyers: live(buyers),
    needsBuyerBackfill: backfill?.value !== true,
  };
}

// Record that the buyer backfill prompt has been answered. Called for BOTH
// answers (apply and skip) — the flag means "asked", not "has buyers".
export async function markBuyerBackfillDone(): Promise<void> {
  await db.meta.put({ key: BUYER_BACKFILL_KEY, value: true });
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

// Same rule for `buyerId`, which legacy order rows predate. Spread first,
// assign after, so `undefined` can never reach IndexedDB.
function withBuyerField<T extends { buyerId?: string }>(
  rows: T[],
): (T & { buyerId: string })[] {
  return rows.map((r) => ({ ...r, buyerId: r.buyerId ?? "" }));
}

// ---------- Deferred seeding ----------

// Decide the fresh install's catalogue, now that there IS something to decide
// it against. Call this ONLY when the cloud's answer is known:
//
//   - the pull succeeded  -> `db.products` holds whatever the cloud has
//   - there is no Worker  -> there is no cloud, and never will be
//
// Do NOT call it on a failed or unauthenticated sync. Leaving the flag set
// costs a first boot with an empty price list and fixes itself on the next one;
// seeding on a guess is how the duplicate catalogues got into D1 in the first
// place.
//
// Empty means empty: if the cloud sent products, this device adopts them and
// the starter list is dropped for good. That is the whole point — the seed is a
// starting position for the FIRST user of a deployment, not a default every
// device is entitled to.
//
// TEMPLATES ride along here for exactly the same reason, and this is the only
// place either seed is written. `hydrateTemplates()` used to seed its own
// example whenever it found an empty table, which was the products bug with a
// sharper edge: that function runs on every `rehydrate()` — after a pull, after
// a cross-tab broadcast — so it re-answered "is this table empty?" over and
// over, minting a fresh `uid()` each time. One "Template Contoh" per device
// beside the cloud's own copy, and a last template that could not be deleted
// because the next pull put it straight back. Both fall out once the decision
// happens once, here, after the cloud has answered.
//
// Returns true when rows were actually written, so the caller knows whether the
// in-memory stores need rehydrating.
export async function resolveSeed(): Promise<boolean> {
  // Deliberately no in-memory "already resolved" cache. It would need a reset
  // seam for the tests and would save one indexed `get` on an open connection
  // per pull, which is not a cost worth owning state for.
  const flag = await db.meta.get(SEED_PENDING_KEY);
  if (flag?.value !== true) return false;

  let wrote = false;
  await db.transaction("rw", db.products, db.templates, db.meta, async () => {
    // Re-checked inside the transaction, not before it: two tabs can reach this
    // on the same pull, and the loser must not write a second catalogue.
    const current = await db.meta.get(SEED_PENDING_KEY);
    if (current?.value !== true) return;
    if ((await db.products.count()) === 0) {
      await db.products.bulkPut(withTombstoneField(seedProducts()));
      wrote = true;
    }
    // Counted separately from products: a deployment whose cloud has a
    // catalogue but no template yet is a real state, and the two seeds are
    // independent answers to independent questions.
    if ((await db.templates.count()) === 0) {
      await db.templates.put(seedTemplate());
      wrote = true;
    }
    await db.meta.delete(SEED_PENDING_KEY);
  });

  return wrote;
}

// One-time copy of localStorage -> IndexedDB.
//
// Ordering is the whole point: copy, VERIFY, and only then record that we are
// migrated. The legacy localStorage keys are deliberately NOT deleted — they
// are ≤5MB by definition and they are the only rollback path if this proves
// buggy in the field. A later release removes them.
export async function migrateFromLocalStorage(): Promise<MigrationResult> {
  if (await isMigrated()) return { status: "skipped" };

  // Fresh install: nothing to copy, and — deliberately — nothing seeded yet.
  // The catalogue and the example template are both DEFERRED to
  // `resolveSeed()`, which runs once sync has answered; see SEED_PENDING_KEY
  // for why this must not happen at boot. The
  // "Bar" type still goes in, because it is a fixed default rather than data:
  // it collides with nothing pulled from the cloud (the key is the name itself,
  // so an incoming "Bar" overwrites it) and the type picker must not be empty
  // on the first render.
  if (!hasLegacyData()) {
    await db.transaction("rw", db.types, db.meta, async () => {
      await db.types.bulkPut([{ nama: "Bar" }]);
      await db.meta.put({ key: MIGRATED_KEY, value: true });
      // A fresh install has no orders to backfill, so the prompt would be a
      // question about nothing. Answer it here, before it can ever be asked.
      await db.meta.put({ key: BUYER_BACKFILL_KEY, value: true });
      await db.meta.put({ key: SEED_PENDING_KEY, value: true });
    });
    return { status: "seeded" };
  }

  // Read through the existing loaders on purpose: they already back-fill every
  // legacy field (tipe, hargaDasar, productId, timestamps). Reimplementing that
  // here would be a second, divergent copy of the same rules.
  const products = withTombstoneField(loadProducts());
  const orders = withBuyerField(withTombstoneField(loadOrders()));
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
  const tables = [
    db.products,
    db.orders,
    db.purchases,
    db.stock,
    db.templates,
    db.buyers,
  ];
  let removed = 0;
  for (const table of tables) {
    removed += await (table as Table<{ deletedAt: string | null }, string>)
      .where("deletedAt")
      .below(cutoff)
      .delete();
  }
  return removed;
}
