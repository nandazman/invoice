// ---------- The unsynced-row rescue ----------
//
// Why this file exists: on 2026-09-07 six orders were entered, converted to
// Beli Stok, and then lost. The purchases and stock movements they produced
// reached D1 and are still there; the orders themselves are gone, with no
// tombstone and no audit entry. What made them unrecoverable was not the
// deletion — it was that nothing had ever written them anywhere but IndexedDB,
// so clearing that table erased the only copy in existence.
//
// There is no outbox in this design, deliberately: the push set is derived by
// comparing each row's cursor against a watermark, which is what makes the
// offline story so simple (a failed push advances nothing, so the same rows are
// swept again next time, in order, with no queue to corrupt). The cost is that
// "what has not reached the cloud yet" exists only as a query over live rows.
// Delete the rows and the question stops having an answer.
//
// So: before any operation that replaces a whole table, run that query and put
// the result in a file. See docs/2026-09-23/data-loss-rules.md (R1).
//
// The file is FORENSIC, not a one-click restore. It holds raw Dexie rows with
// their ids and timestamps intact, which is exactly what someone needs to write
// the recovery SQL by hand — and is a great deal more than the six orders left
// behind, which was one dangling foreign key each.

import { db, WATERMARKS_KEY } from "./db";
import { TABLES, type Row, type TableSpec } from "./sync/tables";
import { downloadJSON } from "./io";
import { nowISO } from "./format";

export const RESCUE_VERSION = 1;

export interface RescueFile {
  version: number;
  // What was about to happen. Named so a file found on disk months later still
  // explains itself.
  reason: string;
  exportedAt: string;
  // Rows per table, keyed by wire name. Raw Dexie shapes, ids preserved.
  tables: Record<string, Row[]>;
}

export interface Unsynced {
  total: number;
  counts: Record<string, number>;
  tables: Record<string, Row[]>;
  // The oldest pending cursor value across every table, or null when nothing is
  // pending. This is the "how long has this been stuck?" number — the six lost
  // orders sat unsynced for six days and nothing ever said so.
  oldest: string | null;
}

async function watermarks(): Promise<Record<string, string | null>> {
  const row = await db.meta.get(WATERMARKS_KEY);
  const value = row?.value;
  return value && typeof value === "object"
    ? { ...(value as Record<string, string | null>) }
    : {};
}

// Rows whose cursor is newer than the watermark — i.e. the ones the cloud has
// never confirmed. Deliberately a fresh read of `meta` rather than the cached
// copy in client.ts: this runs at most once per destructive action, and the
// leader tab may have moved the watermark since this tab last looked.
//
// Mirrors `sweepTable`'s cursor comparison but NOT its size filter: an
// oversized template is precisely a row that cannot reach the cloud, which
// makes it the most important thing in the file rather than something to skip.
//
// Cursorless tables (`types`) are left out. They carry no timestamp to compare,
// and `types` is a list of bare category names — reconstructible by looking at
// the products that use them, which is not true of anything else here.
export async function collectUnsynced(): Promise<Unsynced> {
  const marks = await watermarks();
  const counts: Record<string, number> = {};
  const tables: Record<string, Row[]> = {};
  let total = 0;
  let oldest: string | null = null;

  for (const spec of TABLES) {
    if (spec.cursor === null) continue;
    const rows = await pendingIn(spec, marks[spec.name] ?? null);
    if (rows.length === 0) continue;
    tables[spec.name] = rows;
    counts[spec.name] = rows.length;
    total += rows.length;
    for (const r of rows) {
      const v = r[spec.cursor];
      // ISO strings, so lexicographic order is chronological order.
      if (typeof v === "string" && (oldest === null || v < oldest)) oldest = v;
    }
  }

  return { total, counts, tables, oldest };
}

async function pendingIn(spec: TableSpec, since: string | null): Promise<Row[]> {
  const all = (await db.table(spec.name).toArray()) as Row[];
  // A null watermark means "never synced", so every row is pending. That is the
  // honest answer for a local-only account, and it means the rescue file for
  // one is the whole dataset — which is correct: for that account there is no
  // cloud copy to fall back on at all.
  if (since === null) return all;
  const cursor = spec.cursor as string;
  return all.filter((r) => {
    const v = r[cursor];
    return typeof v === "string" && v > since;
  });
}

// Collect, and write a file if there is anything to write. Returns what was
// found so the caller can report it.
//
// THROWS if the file cannot be produced, and callers must let that abort the
// destructive operation rather than swallowing it. A rescue that silently fails
// is the same as no rescue, and would be worse for being believed in.
export async function rescueUnsynced(reason: string): Promise<Unsynced> {
  const found = await collectUnsynced();
  if (found.total === 0) return found;

  const file: RescueFile = {
    version: RESCUE_VERSION,
    reason,
    exportedAt: nowISO(),
    tables: found.tables,
  };
  const stamp = file.exportedAt.slice(0, 19).replace(/[:T]/g, "-");
  downloadJSON(`invoice-unsynced-${reason}-${stamp}.json`, JSON.stringify(file, null, 2));
  return found;
}

// Indonesian table names for the confirmation copy. Only the tables that can
// appear in a rescue file need one.
const TABLE_LABELS: Record<string, string> = {
  products: "Produk",
  orders: "Pesanan",
  purchases: "Beli Stok",
  stock: "Stok",
  buyers: "Pembeli",
  templates: "Template",
  audit: "Riwayat",
};

// "12 Pesanan, 3 Beli Stok, 1 Stok" — the sentence a destructive confirmation
// has to be able to say. See R2: a warning without a number is not something a
// person can weigh, and "semua perubahan" is not a number.
//
// Takes the bare counts rather than an `Unsynced` so the sync panel can render
// it straight off `SyncStatus.pending`, which is the same map computed by the
// sweep and is already in memory there.
export function describeCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${n} ${TABLE_LABELS[name] ?? name}`)
    .join(", ");
}

export function describeUnsynced(u: Unsynced): string {
  return describeCounts(u.counts);
}

// How long the oldest pending row has been waiting, in whole days. The six
// orders lost in September sat unsynced for six days with nothing saying so;
// this is the number that should have been shouting. Null when nothing is
// pending or the cursor is unreadable.
export function stalenessDays(oldest: string | null, now = Date.now()): number | null {
  if (!oldest) return null;
  const t = Date.parse(oldest);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}
