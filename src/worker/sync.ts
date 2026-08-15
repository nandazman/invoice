import {
  CREATED_BY,
  INCREMENTAL,
  TABLES,
  TABLE_BY_NAME,
  UPDATED_BY,
  attributionOf,
  fromStorage,
  toStorage,
  type Payload,
  type Row,
  type TableSpec,
} from "../lib/sync/tables";
import { HttpError, json } from "./http";

// The pull/push pair. Both sides build their SQL from TABLES, so a column added
// to tables.ts appears here without an edit — which is the entire reason that
// file is shared rather than duplicated.

// D1 caps a row at ~2MB. Templates embed base64 dataURLs and are the only table
// that can get near it. Checking here turns "the whole push failed" into "this
// one template is too big", which is the difference between a user who can fix
// it and a user who cannot.
const MAX_ROW_BYTES = 1_900_000;

// A batch is one transaction, so the whole push cannot go in one: a first sync
// carries thousands of rows and an unbounded transaction is a lock held for as
// long as it takes. Chunking gives up all-or-nothing across the push, which is
// safe because every statement is an idempotent upsert — a client that retries
// after a partial failure simply re-sends rows that already landed.
const BATCH_SIZE = 50;

const now = () => new Date().toISOString();

// ---------- pull ----------

export async function handlePull(db: D1Database, url: URL): Promise<Response> {
  const since = parseSince(url.searchParams.get("since"));
  const tables: Record<string, Row[]> = {};

  for (const spec of TABLES) {
    tables[spec.name] = await pullTable(db, spec, since[spec.name] ?? null);
  }

  return json({ serverTime: now(), tables });
}

function parseSince(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "bad_since", "Parameter `since` bukan JSON yang valid.");
  }
}

async function pullTable(db: D1Database, spec: TableSpec, cursor: unknown): Promise<Row[]> {
  // No cap and no paging. A cap without a paging protocol would silently hand
  // the client a truncated table it would then believe was complete; the tables
  // that could grow large are all incremental, so a steady-state pull is small.
  const stmt =
    spec.cursor === null || cursor == null
      ? db.prepare(`SELECT * FROM ${spec.name}`)
      : db
          .prepare(`SELECT * FROM ${spec.name} WHERE ${spec.cursor} > ? ORDER BY ${spec.cursor}`)
          .bind(cursor);

  const { results } = await stmt.all<Row>();
  // fromStorage() covers spec.columns only; attributionOf() adds the two
  // server-stamped columns back on top. That split is the point — see
  // ATTRIBUTION (2)/(3) in tables.ts. Attribution travels OUT here and only
  // here; it is still never read from an inbound body.
  return results.map((r) => ({ ...fromStorage(spec, r), ...attributionOf(r) }));
}

// ---------- push ----------

export async function handlePush(
  db: D1Database,
  body: unknown,
  email: string,
): Promise<Response> {
  const payload = readPayload(body);
  const statements: D1PreparedStatement[] = [];
  const applied: Record<string, number> = {};

  for (const [name, rows] of Object.entries(payload)) {
    if (!rows) continue;
    const spec = TABLE_BY_NAME.get(name);
    if (!spec) throw new HttpError(400, "unknown_table", `Tabel "${name}" tidak dikenal.`);
    if (!Array.isArray(rows)) {
      throw new HttpError(400, "bad_rows", `Isi tabel "${name}" bukan array.`);
    }

    // `types` has no cursor, so there is no way to tell a removed name from one
    // that was never sent. Replacing the table wholesale is the only correct
    // read of the payload — and it is a handful of rows.
    if (spec.cursor === null) {
      statements.push(db.prepare(`DELETE FROM ${spec.name}`));
    }

    for (const row of rows) {
      statements.push(buildUpsert(db, spec, row as Row, email));
    }
    applied[name] = rows.length;
  }

  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    await db.batch(statements.slice(i, i + BATCH_SIZE));
  }

  return json({ serverTime: now(), applied });
}

function readPayload(body: unknown): Payload {
  if (body === null || typeof body !== "object") {
    throw new HttpError(400, "bad_body", "Body harus objek JSON.");
  }
  const tables = (body as { tables?: unknown }).tables;
  if (tables === undefined) return {};
  if (tables === null || typeof tables !== "object" || Array.isArray(tables)) {
    throw new HttpError(400, "bad_body", "Field `tables` harus objek.");
  }
  return tables as Payload;
}

function buildUpsert(
  db: D1Database,
  spec: TableSpec,
  row: Row,
  email: string,
): D1PreparedStatement {
  const stored = toStorage(spec, row);

  const key = stored[spec.key];
  if (key === null || key === undefined || key === "") {
    throw new HttpError(400, "missing_key", `Baris di "${spec.name}" tanpa ${spec.key}.`);
  }

  const size = new TextEncoder().encode(JSON.stringify(stored)).length;
  if (size > MAX_ROW_BYTES) {
    throw new HttpError(
      413,
      "row_too_large",
      `Baris "${String(key)}" di tabel "${spec.name}" berukuran ${Math.round(size / 1024)} KB, ` +
        `melebihi batas ${Math.round(MAX_ROW_BYTES / 1024)} KB per baris.`,
    );
  }

  // Attribution is stamped from the verified token and the body's own values
  // are never read — toStorage() only copies spec.columns, so anything the
  // client put in createdBy/updatedBy was already dropped before this point.
  const columns = [...spec.columns, CREATED_BY, UPDATED_BY];
  const values: unknown[] = [...spec.columns.map((c) => stored[c]), email, email];

  // COALESCE keeps the original creator: on an update the existing createdBy
  // wins, and only a genuine insert (where it is NULL) takes the pusher's
  // address. Without it every edit would rewrite history to the last editor.
  const updates = [
    ...spec.columns.filter((c) => c !== spec.key).map((c) => `${c} = excluded.${c}`),
    `${CREATED_BY} = COALESCE(${spec.name}.${CREATED_BY}, excluded.${CREATED_BY})`,
    `${UPDATED_BY} = excluded.${UPDATED_BY}`,
  ];

  // Identifiers come from TABLES, which is source code. Values are bound, never
  // interpolated — that is both the injection defence and the reason a
  // megabyte-sized template does not blow D1's ~100KB SQL statement limit.
  const sql =
    `INSERT INTO ${spec.name} (${columns.join(", ")}) ` +
    `VALUES (${columns.map(() => "?").join(", ")}) ` +
    `ON CONFLICT(${spec.key}) DO UPDATE SET ${updates.join(", ")}`;

  return db.prepare(sql).bind(...values);
}

// ---------- stats ----------

export interface TableStat {
  table: string;
  total: number;
  live: number;
  deleted: number;
}

export interface RecentRow {
  table: string;
  // Aliased to `id` rather than the spec's key name: every table but `types`
  // keys on `id` anyway, and a UNION needs one column name across all of them.
  id: string;
  updatedAt: string | null;
  updatedBy: string | null;
  deleted: boolean;
}

export async function tableStats(db: D1Database): Promise<TableStat[]> {
  const out: TableStat[] = [];
  for (const spec of TABLES) {
    // audit and types have no deletedAt, so everything in them is live by
    // definition rather than by query.
    const hasTombstones = spec.columns.includes("deletedAt");
    const sql = hasTombstones
      ? `SELECT COUNT(*) AS total, SUM(CASE WHEN deletedAt IS NULL THEN 1 ELSE 0 END) AS live FROM ${spec.name}`
      : `SELECT COUNT(*) AS total, COUNT(*) AS live FROM ${spec.name}`;
    const row = await db.prepare(sql).first<{ total: number; live: number | null }>();
    const total = row?.total ?? 0;
    const live = row?.live ?? 0;
    out.push({ table: spec.name, total, live, deleted: total - live });
  }
  return out;
}

// The most recently touched rows across every incremental table, so the admin
// page can answer "who changed what, last" without a per-table drill-down.
// Ten, not fifty: this is a glance at whether sync is alive, not an audit trail
// — the audit table is that, and it has its own page.
// UNION ALL in one statement rather than a query per table: the sort has to
// happen across tables, not within them.
export async function recentRows(db: D1Database, limit = 10): Promise<RecentRow[]> {
  const statements = INCREMENTAL.map((spec) => {
    // `audit` has no deletedAt (types.ts:94) — a literal 0 keeps the column
    // set identical across tables, so the merged rows all have one shape.
    const deleted = spec.columns.includes("deletedAt")
      ? "CASE WHEN deletedAt IS NOT NULL THEN 1 ELSE 0 END"
      : "0";
    return db
      .prepare(
        `SELECT '${spec.name}' AS "table", ${spec.key} AS id, ` +
          `${spec.cursor} AS updatedAt, ${UPDATED_BY} AS updatedBy, ${deleted} AS deleted ` +
          `FROM ${spec.name} ORDER BY ${spec.cursor} DESC LIMIT ?`,
      )
      .bind(limit);
  });

  // One statement per table merged in JS, NOT a single UNION ALL. D1 caps a
  // compound SELECT at 5 terms (SQLITE_MAX_COMPOUND_SELECT); there are 7
  // incremental tables, so the union form fails outright with "too many terms
  // in compound SELECT" — and the JS merge cannot be broken by adding another.
  // batch() is still one round trip.
  type StoredRow = Omit<RecentRow, "deleted"> & { deleted: number };
  const results = await db.batch<StoredRow>(statements);

  // Each table contributes its own newest `limit` rows, so the global newest
  // `limit` is guaranteed to be somewhere in here — sorting the union of the
  // per-table tops is exact, not an approximation.
  const merged = results.flatMap((r) => r.results);
  // ISO-8601 sorts lexically. Rows with no cursor value sort last rather than
  // throwing off the comparison.
  merged.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  // SQLite has no boolean. Converting here rather than in the page matters:
  // React renders a bare 0 as the text "0", so `{r.deleted && ...}` on a raw
  // integer would print stray zeroes into the table.
  return merged.slice(0, limit).map((r) => ({ ...r, deleted: r.deleted === 1 }));
}
