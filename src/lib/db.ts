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
import type { Row } from "./sync/tables";

// The write path. Despite the file name there is no database in the browser any
// more: D1 is the only source of truth (docs/2026-10-02/d1-only-plan.md). What
// is left here is the seam every store mutation goes through.
//
// A mutation updates its module-level array first, so the screen reacts at once,
// and then calls `persist()` with the rows it changed. `persist()` sends them to
// D1 in the background, in order. If D1 refuses them the optimistic state is
// thrown away — `revert` reloads everything from the server — and the user is
// told. Nothing is ever queued for later: a write either reached D1 or it
// visibly did not.

// ---------- Snapshot ----------

// Everything the stores hydrate from, live rows only.
export interface Snapshot {
  products: Product[];
  orders: OrderItem[];
  purchases: PurchaseItem[];
  stock: StockMovement[];
  templates: Template[];
  audit: AuditEntry[];
  types: string[];
  buyers: Buyer[];
}

// ---------- Batches ----------

export type TableName =
  | "products"
  | "orders"
  | "purchases"
  | "stock"
  | "buyers"
  | "templates"
  | "audit"
  | "types";

export type Writes = Partial<Record<TableName, Row[]>>;

// The rows one mutation changed, grouped by table. One batch is one request and
// one D1 transaction, so an order, its stock movement and its audit entry land
// together or not at all.
export class Batch {
  readonly rows: Writes = {};

  put(table: TableName, row: object): void {
    (this.rows[table] ??= []).push(row as Row);
  }

  putAll(table: TableName, rows: readonly object[]): void {
    for (const row of rows) this.put(table, row);
  }

  get empty(): boolean {
    return Object.values(this.rows).every((r) => !r || r.length === 0);
  }
}

// ---------- Hooks ----------

// Registered by the sync client. A callback pair rather than an import, because
// the client imports the stores and the stores import this file.
export interface PersistHooks {
  // Send one batch to D1. Resolves when it is stored, rejects when it is not.
  commit(writes: Writes): Promise<void>;
  // Replace the in-memory arrays with what the server holds. Called after a
  // failed commit so the screen stops showing a change that never happened.
  revert(): Promise<void>;
}

let hooks: PersistHooks | null = null;

export function setPersistHooks(next: PersistHooks | null): void {
  hooks = next;
}

type PersistErrorHandler = (err: unknown, op: string) => void;
let onError: PersistErrorHandler = (err, op) => {
  console.error(`[db] persist failed during "${op}"`, err);
};

export function onPersistError(handler: PersistErrorHandler): void {
  onError = handler;
}

// How many writes are on their way to D1 right now. The sync client uses it to
// show "menyimpan…" and to hold the poll while anything is unconfirmed — a pull
// that landed mid-write would overwrite the optimistic row with the old one.
let inflight = 0;
const savingListeners = new Set<(n: number) => void>();

export function onSavingChange(handler: (n: number) => void): () => void {
  savingListeners.add(handler);
  return () => {
    savingListeners.delete(handler);
  };
}

function setInflight(n: number): void {
  inflight = n;
  for (const l of savingListeners) l(inflight);
}

export function hasPendingWrites(): boolean {
  return inflight > 0;
}

// Counts every write ever issued. A poll compares it before and after its
// request: if it moved, a write happened while the response was in flight and
// the response may predate it, so the response is thrown away.
let seq = 0;
export function writeSeq(): number {
  return seq;
}

// Writes run strictly one after another. Two edits to the same row must reach D1
// in the order they were made, and a request that overtook its predecessor
// would leave the older value standing.
let tail: Promise<void> = Promise.resolve();

// Bumped on every failed commit. A write queued before the failure was built on
// state that has just been discarded, so it is dropped instead of sent.
let generation = 0;

let pending = new Set<Promise<unknown>>();

// Fire-and-forget a write, routing any failure to the handler. Callers stay
// synchronous; this is what lets the store API keep its sync signatures.
export function persist(op: string, build: (b: Batch) => void): void {
  const batch = new Batch();
  build(batch);
  if (batch.empty) return;

  const gen = generation;
  seq++;
  setInflight(inflight + 1);

  const run = async (): Promise<void> => {
    if (gen !== generation) return;
    try {
      if (!hooks) throw new Error("Penyimpanan belum siap. Muat ulang halaman.");
      await hooks.commit(batch.rows);
    } catch (err) {
      generation++;
      onError(err, op);
      try {
        await hooks?.revert();
      } catch {
        onError(
          new Error(
            "Perubahan gagal disimpan dan data belum bisa dimuat ulang dari server. " +
              "Muat ulang halaman sebelum melanjutkan.",
          ),
          "revert",
        );
      }
    }
  };

  const p = tail.then(run);
  tail = p;
  pending.add(p);
  void p.finally(() => {
    pending.delete(p);
    setInflight(inflight - 1);
  });
}

// Await every in-flight write. Exists for tests: the store API is synchronous by
// design, so without this a test cannot tell "the write landed" from "the write
// was never issued".
export async function flushWrites(): Promise<void> {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
}

// Test seam: forget queued state between cases.
export function __resetPersistForTests(): void {
  hooks = null;
  tail = Promise.resolve();
  generation = 0;
  seq = 0;
  pending = new Set();
  setInflight(0);
  savingListeners.clear();
}

// ---------- Attribution on local writes ----------

// `updatedBy` is stamped by the Worker from a verified Access token, so the
// column means exactly one thing: "the server saw this person do it". A local
// edit INVALIDATES it — the row changed, but the value still names whoever
// edited it last time. Clearing it renders "—", which is the honest state until
// the next pull brings the server's own stamp back.
//
// Nothing is stamped locally on purpose. An unverified address sitting in the
// same column as a verified one would end the column's only guarantee.
export function touch<T extends Attribution & { updatedAt: string }>(
  row: T,
  now: string,
): T {
  return { ...row, updatedAt: now, updatedBy: null };
}

// The same rule for a row BORN from another one — a duplicate. Here `createdBy`
// is wrong too: this row was made by whoever is sitting here now.
export function fresh<T extends Attribution>(row: T): T {
  return { ...row, createdBy: null, updatedBy: null };
}
