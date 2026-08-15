// The one description of the synced schema, shared by BOTH the browser client
// and the Worker. Neither side may import anything browser- or Worker-specific
// from here, because both sides compile it.
//
// This file exists so the wire format has exactly one definition: the client
// serializes rows against these specs and the Worker builds its SQL from the
// same specs, so a column added in one place cannot go missing in the other.
//
// The D1 tables in migrations/0001_init.sql mirror db.ts one-for-one. Three
// differences are deliberate:
//
//  1. Object-valued fields (konversi, elements, ...) are TEXT holding JSON.
//     IndexedDB stores structured clones; SQLite does not.
//
//  2. `deletedAt` is a real nullable column WITH an index. IndexedDB cannot
//     index null (see db.ts:72), which is why tombstone filtering happens in JS
//     on that side. SQLite has no such limit, so the server can answer "give me
//     live rows" directly. Tombstones still replicate — a delete has to travel.
//
//  3. Every table carries `createdBy` / `updatedBy`, which are server-stamped
//     and are NOT part of `spec.columns`. They ride along on pull only, and are
//     optional on the IndexedDB side because a row written locally and never
//     synced has never been stamped. See ATTRIBUTION below.

// How a table's incremental cursor works.
//
//   "updatedAt"  — mutable rows. Every write bumps it, including a soft delete
//                  (store.ts tombstone()), so one column catches inserts,
//                  updates AND deletes.
//   "timestamp"  — audit only. Append-only, never rewritten.
//   null         — no cursor: the table is replaced wholesale on every sync.
export type Cursor = string | null;

export interface TableSpec {
  // Wire name, D1 table name, and Dexie table name — all the same string on
  // purpose. Divergence here would need a mapping layer nothing else wants.
  name: string;
  key: string;
  cursor: Cursor;
  // Columns that exist on BOTH sides AND may travel in either direction.
  // Attribution columns are deliberately absent: the Worker appends them on
  // write and merges them on read, and this list is exactly what a push is
  // allowed to carry. See ATTRIBUTION below.
  columns: string[];
  // Columns held as JSON TEXT in D1 and as live objects everywhere else.
  json: string[];
}

// ---------- ATTRIBUTION ----------
//
// `createdBy` / `updatedBy` hold the Cloudflare Access email of whoever pushed
// the row. Three rules, all load-bearing:
//
//  1. SERVER-STAMPED ONLY. The Worker takes the address from the verified
//     Access JWT and ignores any value in the request body. Attribution a
//     client can set is attribution that means nothing.
//
//  2. NOT IN `spec.columns` — EVER. This is what keeps rule 1 mechanical rather
//     than a promise: every outbound path (the client's `pick()`, the Worker's
//     `toStorage()`) copies exactly `spec.columns`, so a value sitting in
//     `row.updatedBy` is dropped before it can be serialized, bound, or
//     compared. Listing them as ordinary columns would make the push carry them
//     and the upsert would then be stamping client-supplied text.
//
//  3. PULL-ONLY RIDE-ALONG. They now DO reach Dexie, so the pages can show who
//     touched a row — but by an explicit, separate path, never by widening
//     `columns`. `pullTable()` (worker/sync.ts) merges `attributionOf(dbRow)`
//     over `fromStorage(spec, dbRow)`, and the client merges the same two keys
//     when it applies a pull. Three properties make that inert:
//
//       - the push set is chosen by CURSOR (`updatedAt` vs the watermark), not
//         by comparing content, so extra fields on a Dexie row cannot make it
//         look diverged and cannot trigger a push;
//       - the merge writes only these two keys and never `updatedAt`, so the
//         sync cursor is untouched and there is no pull -> write -> pull loop;
//       - the next push filters back down to `columns`, so what came in as
//         attribution never goes back out.
//
//     `toStorage`/`fromStorage` themselves stay exact inverses over
//     `spec.columns` — the ride-along happens at the call site, deliberately, so
//     that pair keeps the one property both compilers rely on.
export const CREATED_BY = "createdBy";
export const UPDATED_BY = "updatedBy";
export const ATTRIBUTION = [CREATED_BY, UPDATED_BY] as const;

// The attribution half of a stored row, as an object safe to spread over a
// deserialized row. Absent keys stay absent rather than becoming `undefined`:
// IndexedDB stores `undefined` verbatim, and a row that has genuinely never
// been synced should have no attribution field at all rather than an explicit
// empty one.
export function attributionOf(row: Row): Row {
  const out: Row = {};
  for (const col of ATTRIBUTION) {
    const v = row[col];
    if (v !== undefined) out[col] = v;
  }
  return out;
}

export const TABLES: TableSpec[] = [
  {
    name: "products",
    key: "id",
    cursor: "updatedAt",
    columns: [
      "id",
      "namaProduk",
      "tipe",
      "ukuran",
      "satuan",
      "hargaDasar",
      "hargaJual",
      "konversi",
      "stokMin",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ],
    json: ["konversi"],
  },
  {
    name: "orders",
    key: "id",
    cursor: "updatedAt",
    columns: [
      "id",
      "tanggal",
      "productId",
      "buyerId",
      "namaProduk",
      "satuan",
      "kuantitas",
      "hargaSatuan",
      "totalHarga",
      "status",
      "affectsStock",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ],
    json: [],
  },
  {
    name: "purchases",
    key: "id",
    cursor: "updatedAt",
    columns: [
      "id",
      "tanggal",
      "productId",
      "namaProduk",
      "satuan",
      "kuantitas",
      "hargaSatuan",
      "totalHarga",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ],
    json: [],
  },
  {
    name: "stock",
    key: "id",
    cursor: "updatedAt",
    columns: [
      "id",
      "productId",
      "tanggal",
      "qty",
      "satuan",
      "reason",
      "hargaModal",
      "orderId",
      "purchaseId",
      "note",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ],
    json: [],
  },
  {
    name: "buyers",
    key: "id",
    cursor: "updatedAt",
    columns: [
      "id",
      "nama",
      "telepon",
      "email",
      "alamat",
      "catatan",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ],
    json: [],
  },
  {
    // Templates embed base64 image dataURLs (business.logo, element.src), so a
    // single row here can be megabytes where every other table is bytes. D1
    // caps a row at ~2MB; the client checks size before sending and surfaces a
    // per-template error rather than failing the whole push.
    name: "templates",
    key: "id",
    cursor: "updatedAt",
    columns: [
      "id",
      "nama",
      "business",
      "customer",
      "elements",
      "createdAt",
      "updatedAt",
      "deletedAt",
    ],
    json: ["business", "customer", "elements"],
  },
  {
    // Append-only, and the only table with no `deletedAt`: a restore replaces
    // the whole log rather than deleting entries (types.ts:94).
    name: "audit",
    key: "id",
    cursor: "timestamp",
    columns: ["id", "timestamp", "entity", "entityId", "action", "label", "changes"],
    json: ["changes"],
  },
  {
    // A bare name with no timestamps, so there is nothing to compare a cursor
    // against. It is also never more than a handful of rows, which is what
    // makes replacing it wholesale the cheap option rather than the lazy one.
    name: "types",
    key: "nama",
    cursor: null,
    columns: ["nama"],
    json: [],
  },
];

export const TABLE_BY_NAME = new Map(TABLES.map((t) => [t.name, t]));

// Tables carrying a cursor, i.e. everything that syncs incrementally.
export const INCREMENTAL = TABLES.filter((t) => t.cursor !== null);

// The wire shape. Rows are plain JSON objects keyed by table name; JSON columns
// travel as real objects and are stringified only at the SQLite boundary.
export type Row = Record<string, unknown>;
export type Payload = Partial<Record<string, Row[]>>;

// ---------- Row (de)serialization ----------
//
// D1 has no boolean and no object columns. These two functions are the only
// place that gap is bridged, and they are exact inverses of each other.

// A row on its way INTO SQLite: objects become JSON text, booleans become 0/1.
export function toStorage(spec: TableSpec, row: Row): Row {
  const out: Row = {};
  for (const col of spec.columns) {
    const v = row[col];
    if (spec.json.includes(col)) {
      // `undefined` and `null` are distinct here: AuditEntry.changes is
      // genuinely optional, and storing the string "undefined" would be a bug
      // that only shows up on read.
      out[col] = v === undefined || v === null ? null : JSON.stringify(v);
    } else if (typeof v === "boolean") {
      out[col] = v ? 1 : 0;
    } else {
      out[col] = v === undefined ? null : v;
    }
  }
  return out;
}

// Columns that are booleans in TypeScript but INTEGER in SQLite. Listed
// explicitly because 0/1 is indistinguishable from a number once stored, so
// there is no way to infer this on the way back out.
const BOOL_COLUMNS = new Set(["affectsStock"]);

// A row on its way OUT of SQLite, back to the shape db.ts expects. It covers
// exactly `spec.columns` — the exact inverse of toStorage(). Attribution is NOT
// its business: callers that want it spread `attributionOf(row)` on top, which
// is what keeps this pair invertible. See ATTRIBUTION (3).
export function fromStorage(spec: TableSpec, row: Row): Row {
  const out: Row = {};
  for (const col of spec.columns) {
    const v = row[col];
    if (spec.json.includes(col)) {
      out[col] = v == null ? null : safeParse(v as string);
    } else if (BOOL_COLUMNS.has(col)) {
      out[col] = v === 1 || v === true;
    } else {
      out[col] = v;
    }
  }
  return out;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
