import { useSyncExternalStore } from "react";
import { type Table } from "dexie";
import { db, onWrite } from "../db";
import { rehydrate } from "../bootstrap";
import {
  TABLES,
  attributionOf,
  type Payload,
  type Row,
  type TableSpec,
} from "./tables";

// The browser half of the D1 mirror. See docs/2026-08-15/sync-plan.md.
//
// The one rule everything here obeys: IndexedDB is the commit point and D1 is a
// mirror that follows. Nothing in this file is ever awaited by a write path, no
// store read becomes async, and a failed push is not an error the user has to
// resolve — it is just a mirror that is briefly behind.
//
// There is deliberately NO outbox. Offline is handled by the watermark alone: a
// push that fails does not advance it, so the same rows are swept again next
// time. A queue would be a second source of truth for "what still needs
// sending", and the sweep already answers that from the data itself.

// ---------- Public types ----------

export type Role = "none" | "read" | "write" | "admin";

export interface SyncStatus {
  // False when the API is not there at all — the GitHub Pages copy, which has
  // no Worker behind it. Distinct from "the request failed": there is nothing
  // to retry and nothing to report, so the UI hides sync entirely.
  available: boolean;
  email: string | null;
  role: Role;
  online: boolean;
  busy: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
  // table -> rows whose cursor is newer than the watermark. For a writer this
  // is the push backlog; for a reader it is the DIVERGENCE set, i.e. local
  // edits that will never leave this device.
  pending: Record<string, number>;
  pendingTotal: number;
  error: string | null;
}

// ---------- Persistence keys ----------

// Watermarks live in the existing Dexie `meta` table, next to the migration and
// buyer-backfill flags (db.ts). They are bookkeeping, not user data, and they
// must survive a reload — localStorage would work but would then be a second
// storage system holding a piece of the sync state.
const WATERMARKS_KEY = "sync.watermarks.v1";

// Scratch mode is genuinely a UI preference, not sync state: it re-enables the
// editors for a `read` user who understands the edits stay on this device. It
// is read synchronously by the admin page, so localStorage is the right home.
const SCRATCH_KEY = "sync.scratch.v1";

// D1 caps a row at ~2MB. Templates embed base64 dataURLs (template-store.ts) so
// they are the only table that can reach it. Leave headroom for the JSON quoting
// the Worker adds when it stringifies the object columns.
const ROW_SIZE_LIMIT = 1_800_000;

// Long enough to coalesce a burst of writes (a form save fires several
// `persist()` calls), short enough that the mirror is never visibly stale.
const DEBOUNCE_MS = 3000;

// ---------- Status store ----------

const initialStatus: SyncStatus = {
  available: false,
  email: null,
  role: "none",
  online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  busy: false,
  lastPushAt: null,
  lastPullAt: null,
  pending: {},
  pendingTotal: 0,
  error: null,
};

let status: SyncStatus = initialStatus;

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

// Replaces the object rather than mutating it, so `useSyncExternalStore` sees a
// new reference and re-renders. Same contract as store.ts.
function patch(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  emit();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSyncStatus, getSyncStatus);
}

export function canWrite(): boolean {
  return status.role === "write" || status.role === "admin";
}

// ---------- Scratch mode ----------

export function isScratchMode(): boolean {
  try {
    return localStorage.getItem(SCRATCH_KEY) === "1";
  } catch {
    return false;
  }
}

export function setScratchMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(SCRATCH_KEY, "1");
    else localStorage.removeItem(SCRATCH_KEY);
  } catch {
    // Private-mode browsers can throw on write. A lost preference is not worth
    // failing a click over.
  }
}

// ---------- Watermarks ----------

type Watermarks = Record<string, string | null>;

// Cached in memory because every sweep reads it and the sweep runs on a
// debounce. `null` here means "not loaded yet", distinct from a loaded map that
// happens to hold nulls.
let watermarks: Watermarks | null = null;

async function loadWatermarks(): Promise<Watermarks> {
  if (watermarks) return watermarks;
  const row = await db.meta.get(WATERMARKS_KEY);
  const value = row?.value;
  watermarks =
    value && typeof value === "object" ? { ...(value as Watermarks) } : {};
  return watermarks;
}

async function saveWatermarks(next: Watermarks): Promise<void> {
  watermarks = next;
  await db.meta.put({ key: WATERMARKS_KEY, value: next });
}

// Exposed for tests and for `discardLocalChanges`. Dropping the cache matters:
// a test (or a second tab) can rewrite the meta row underneath us.
function resetWatermarkCache(): void {
  watermarks = null;
}

// ---------- Dexie access by wire name ----------

// The wire name, the D1 table name and the Dexie table name are the same string
// by design (tables.ts), which is what lets this be a lookup instead of a
// switch that would need a new arm per table.
function tableOf(spec: TableSpec): Table<Row, string> {
  return db.table(spec.name) as unknown as Table<Row, string>;
}

// A row on its way OUT carries exactly `spec.columns` — no more. That keeps
// local-only fields from leaking, and it is the mechanical reason a push can
// never carry attribution: `createdBy`/`updatedBy` are not in `columns`, so
// they are dropped here whether or not a pull put them on the Dexie row.
// See the ATTRIBUTION block in tables.ts.
function pick(spec: TableSpec, row: Row): Row {
  const out: Row = {};
  for (const col of spec.columns) out[col] = row[col] ?? null;
  return out;
}

// A row on its way IN. Same `columns` projection, plus the two server-stamped
// attribution fields riding along so the pages can show who touched the row.
//
// Proving this is inert for sync, in the two places it could bite:
//
//   - DIVERGENCE. `sweepTable` decides "pending" purely by comparing
//     `row[spec.cursor]` to the watermark. It never compares content, so an
//     extra field on a Dexie row cannot make it look locally-diverged. (The one
//     content comparison in the file, `marker()`, reads only the primary key.)
//   - THE CURSOR. This copies exactly two keys and neither is `updatedAt`, so
//     an incoming row's cursor stays the server's own value. Nothing here goes
//     through `persist()` either, so applying a pull raises no write event and
//     cannot schedule the sync that would loop.
function pickIncoming(spec: TableSpec, row: Row): Row {
  return { ...pick(spec, row), ...attributionOf(row) };
}

// ---------- The sweep ----------

interface Swept {
  spec: TableSpec;
  // Wire-shaped rows whose cursor is newer than the watermark.
  rows: Row[];
  // Primary keys of those rows — the divergence set a pull must not overwrite.
  keys: Set<string>;
  // The watermark value to store once these rows are known to have landed.
  // For a cursored table this is the newest cursor actually sent; for `types`
  // (no cursor) it is a content marker, see below.
  next: string | null;
  // Templates that exceed D1's row cap, by name. Reported, never sent.
  oversized: string[];
  // The LOWEST cursor among those skipped rows, and a hard ceiling on how far
  // this table's watermark may advance. Without it a skipped row is not merely
  // unsent, it is unsendable: the watermark moves past it on the strength of a
  // newer sibling, the next sweep filters it out on the cursor before the size
  // check ever runs, and it is never synced and never reported again.
  oversizedFloor: string | null;
}

// The content marker for a cursorless table. `types` is a bare list of names
// with no timestamp to compare against, so "has it changed since the last
// successful sync?" has to be answered from the content itself. It is never
// more than a handful of short strings, which is what makes this cheap rather
// than lazy.
function marker(rows: Row[], key: string): string {
  return JSON.stringify(rows.map((r) => String(r[key])).sort());
}

// Read Dexie — NOT the in-memory arrays.
//
// This is the load-bearing detail of the whole design: `store.ts` holds live
// rows only, so a soft delete leaves memory entirely. A memory-based sweep
// would therefore never push a delete, and the mirror would silently keep rows
// the user removed.
async function sweepTable(spec: TableSpec, marks: Watermarks): Promise<Swept> {
  const all = await tableOf(spec).toArray();

  if (spec.cursor === null) {
    const m = marker(all, spec.key);
    const changed = marks[spec.name] !== m;
    return {
      spec,
      rows: changed ? all.map((r) => pick(spec, r)) : [],
      keys: changed ? new Set(all.map((r) => String(r[spec.key]))) : new Set(),
      next: m,
      oversized: [],
      oversizedFloor: null,
    };
  }

  const cursor = spec.cursor;
  const since = marks[spec.name] ?? null;

  const rows: Row[] = [];
  const keys = new Set<string>();
  const oversized: string[] = [];
  const sent: string[] = [];
  let oversizedFloor: string | null = null;

  for (const raw of all) {
    const value = raw[cursor];
    if (typeof value !== "string") continue;
    // A null watermark means "never synced", so everything is pending.
    if (since !== null && value <= since) continue;

    const wire = pick(spec, raw);
    // Size is checked on the wire shape because that is what actually travels
    // and what the Worker stores. Skipping the row keeps the rest of the push
    // whole: one 4MB template must not block every other table.
    if (JSON.stringify(wire).length > ROW_SIZE_LIMIT) {
      oversized.push(String(raw["nama"] ?? raw[spec.key]));
      if (oversizedFloor === null || value < oversizedFloor) oversizedFloor = value;
      continue;
    }

    rows.push(wire);
    keys.add(String(raw[spec.key]));
    sent.push(value);
  }

  // Cursors are ISO strings, so lexicographic order is chronological order.
  //
  // Rows newer than the floor are still SENT — they just do not move the
  // watermark, so they are re-sent on every sync until the oversized row is
  // fixed. Re-sending is an idempotent upsert on the server, and the cost buys
  // the property that matters: the oversized row stays in the sweep, so it
  // keeps being reported and syncs itself the moment the user shrinks it.
  let next = since;
  for (const value of sent) {
    if (oversizedFloor !== null && value >= oversizedFloor) continue;
    if (next === null || value > next) next = value;
  }

  return { spec, rows, keys, next, oversized, oversizedFloor };
}

async function sweepAll(marks: Watermarks): Promise<Swept[]> {
  return Promise.all(TABLES.map((spec) => sweepTable(spec, marks)));
}

function pendingFrom(swept: Swept[]): Pick<SyncStatus, "pending" | "pendingTotal"> {
  const pending: Record<string, number> = {};
  let total = 0;
  for (const s of swept) {
    if (s.rows.length === 0) continue;
    pending[s.spec.name] = s.rows.length;
    total += s.rows.length;
  }
  return { pending, pendingTotal: total };
}

// ---------- Transport ----------

type ApiResult<T> =
  // The API answered with JSON we understand.
  | { kind: "ok"; data: T }
  // Not our API at all: Access served its HTML login page, or this is the
  // GitHub Pages copy and the path 404s into index.html. Nothing to retry.
  | { kind: "unavailable" }
  // The Access session lapsed. A reload re-runs the Access redirect; there is
  // nothing the app itself can do.
  | { kind: "unauthenticated" }
  // A real, reportable failure — including "the network is down".
  | { kind: "error"; message: string };

const RELOAD_MESSAGE =
  "Sesi login sudah berakhir. Muat ulang halaman untuk masuk kembali.";

async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    // fetch only rejects on a transport failure, which is the offline case.
    // The API is still assumed to exist, so `available` must not flip.
    return {
      kind: "error",
      message:
        "Tidak dapat terhubung ke server. Perubahan tetap tersimpan di perangkat ini.",
    };
  }

  // Check the content type BEFORE parsing. Access's login page is a 200 with
  // HTML; letting JSON.parse throw would surface a SyntaxError as the user's
  // sync error, which tells them nothing and is not even true.
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return { kind: "unavailable" };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: "unavailable" };
  }

  if (res.ok) return { kind: "ok", data: body as T };

  const err = body as { code?: string; message?: string };
  if (res.status === 401 || err.code === "unauthenticated") {
    return { kind: "unauthenticated" };
  }
  return { kind: "error", message: err.message ?? `Sinkronisasi gagal (${res.status}).` };
}

// Translate a non-ok result into status. Returns true when the caller should
// stop — every non-ok result is a stop, this just keeps the branch in one place.
function reportFailure(result: Exclude<ApiResult<unknown>, { kind: "ok" }>): void {
  if (result.kind === "unavailable") {
    patch({ available: false, error: null });
  } else if (result.kind === "unauthenticated") {
    patch({ available: true, error: RELOAD_MESSAGE });
  } else {
    patch({ error: result.message });
  }
}

// ---------- Pull ----------

interface PullResponse {
  serverTime: string;
  tables: Payload;
}

interface PushResponse {
  serverTime: string;
  applied: Record<string, number>;
}

// `since` is the watermark map. `types` always asks for everything: it has no
// cursor, so the server replaces it wholesale.
function sincePayload(marks: Watermarks): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const spec of TABLES) {
    out[spec.name] = spec.cursor === null ? null : (marks[spec.name] ?? null);
  }
  return out;
}

// Apply a pull into Dexie.
//
// `force` is the "Buang perubahan lokal" path: it applies every server row
// unconditionally. Normally a row whose key is in the local divergence set is
// SKIPPED — the local edit wins until the user explicitly discards it, so
// nothing is lost without a click (see the plan's Conflicts section).
async function applyPull(
  payload: Payload,
  swept: Swept[],
  marks: Watermarks,
  force: boolean,
): Promise<{ applied: number; marks: Watermarks }> {
  const bySpec = new Map(swept.map((s) => [s.spec.name, s]));
  const next: Watermarks = { ...marks };
  let applied = 0;

  for (const spec of TABLES) {
    const incoming = payload[spec.name];
    if (!incoming) continue;

    const local = bySpec.get(spec.name);
    const diverged = force ? new Set<string>() : (local?.keys ?? new Set<string>());

    if (spec.cursor === null) {
      // Cursorless: the server copy replaces ours wholesale. Skipping is
      // all-or-nothing here because there are no per-row cursors to reconcile.
      if (diverged.size > 0) continue;
      await db.transaction("rw", tableOf(spec), async () => {
        await tableOf(spec).clear();
        await tableOf(spec).bulkPut(incoming.map((r) => pickIncoming(spec, r)));
      });
      applied += incoming.length;
      next[spec.name] = marker(incoming, spec.key);
      continue;
    }

    // An oversized local row is skipped by the sweep, so it is NOT in the
    // divergence set and would not block the advance below. It still has to,
    // for the same reason it blocks the push: past the floor, it drops out of
    // the sweep for good. `force` discards local rows outright, so no floor.
    const floor = force ? null : (local?.oversizedFloor ?? null);

    const rows: Row[] = [];
    let top = next[spec.name] ?? null;
    for (const raw of incoming) {
      const value = raw[spec.cursor];
      if (
        typeof value === "string" &&
        (floor === null || value < floor) &&
        (top === null || value > top)
      ) {
        top = value;
      }
      if (diverged.has(String(raw[spec.key]))) continue;
      rows.push(pickIncoming(spec, raw));
    }
    if (rows.length > 0) {
      await tableOf(spec).bulkPut(rows);
      applied += rows.length;
    }

    // Advance ONLY when nothing local diverged. Moving the watermark past a
    // local row that has not been pushed would drop it out of the next sweep,
    // and it would never reach D1. When there is divergence the push that
    // follows advances the watermark instead, and the small cost is re-pulling
    // rows we already have — which bulkPut makes idempotent.
    //
    // The known cost of a scalar watermark: while a table has divergence, rows
    // just APPLIED from the server also sit above the watermark and so count as
    // pending. For a writer that clears on the very next push (it re-sends rows
    // identical to the server's, which is a no-op there). For a reader it means
    // the divergence count is an upper bound. Fixing it properly needs a
    // per-row dirty flag, i.e. the outbox this design deliberately does without.
    if (diverged.size === 0) next[spec.name] = top;
  }

  return { applied, marks: next };
}

export async function pullNow(): Promise<void> {
  await runPull(false);
}

async function runPull(force: boolean): Promise<boolean> {
  const marks = await loadWatermarks();
  const swept = await sweepAll(marks);

  const since = encodeURIComponent(JSON.stringify(sincePayload(marks)));
  const result = await api<PullResponse>(`/api/sync/pull?since=${since}`);
  if (result.kind !== "ok") {
    reportFailure(result);
    return false;
  }

  const { applied, marks: nextMarks } = await applyPull(
    result.data.tables ?? {},
    swept,
    marks,
    force,
  );
  await saveWatermarks(nextMarks);

  // Rehydrate only when something actually landed. The sequence lives in
  // bootstrap.ts because it is the same one boot runs; duplicating it here
  // would guarantee the two drift.
  if (applied > 0) await rehydrate();

  const after = await sweepAll(nextMarks);
  patch({
    available: true,
    lastPullAt: result.data.serverTime,
    error: null,
    ...pendingFrom(after),
  });
  return true;
}

// ---------- Push ----------

async function runPush(): Promise<boolean> {
  const marks = await loadWatermarks();
  const swept = await sweepAll(marks);

  const oversized = swept.flatMap((s) => s.oversized);
  const tables: Payload = {};
  let count = 0;
  for (const s of swept) {
    if (s.rows.length === 0) continue;
    tables[s.spec.name] = s.rows;
    count += s.rows.length;
  }

  // Nothing to send, but an oversized template is still worth saying out loud —
  // otherwise it looks synced and never is.
  if (count === 0) {
    patch({ error: oversizedMessage(oversized), ...pendingFrom(swept) });
    return true;
  }

  const result = await api<PushResponse>("/api/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tables }),
  });
  if (result.kind !== "ok") {
    // The watermark is NOT advanced. That is the entire offline story: the same
    // rows are swept again next time, in the same order, with no queue to lose.
    reportFailure(result);
    patch(pendingFrom(swept));
    return false;
  }

  // Advance to the cursor values ACTUALLY SENT, not to "now". A row written
  // while the request was in flight has a newer cursor and must stay pending.
  const next: Watermarks = { ...marks };
  for (const s of swept) {
    if (s.rows.length > 0) next[s.spec.name] = s.next;
  }
  await saveWatermarks(next);

  const after = await sweepAll(next);
  patch({
    available: true,
    lastPushAt: result.data.serverTime,
    error: oversizedMessage(oversized),
    ...pendingFrom(after),
  });
  return true;
}

function oversizedMessage(names: string[]): string | null {
  if (names.length === 0) return null;
  return (
    `Template terlalu besar untuk disinkronkan: ${names.join(", ")}. ` +
    `Perkecil logo atau gambar di dalamnya, lalu simpan ulang.`
  );
}

// ---------- Orchestration ----------

let running: Promise<void> | null = null;

export async function syncNow(): Promise<void> {
  // Coalesce: a second caller joins the run in flight rather than starting a
  // concurrent sweep of the same tables.
  if (running) return running;
  running = (async () => {
    patch({ busy: true });
    try {
      if (!status.available) return;
      const pulled = await runPull(false);
      // A failed pull means the transport is down or the session lapsed;
      // pushing would fail the same way and overwrite the better message.
      if (!pulled) return;
      if (!canWrite()) return;
      await runPush();
    } catch (err) {
      // Nothing above should throw, but a Dexie failure here must not take the
      // app with it — sync is the mirror, not the commit point.
      patch({ error: `Sinkronisasi gagal: ${String(err)}` });
    } finally {
      patch({ busy: false });
      running = null;
    }
  })();
  return running;
}

export async function discardLocalChanges(): Promise<void> {
  // Reset to null so the next pull asks for the entire dataset, then apply it
  // unconditionally — this is the one path where the server wins outright.
  resetWatermarkCache();
  await saveWatermarks({});
  await runPull(true);
}

// ---------- Trigger ----------

let timer: ReturnType<typeof setTimeout> | null = null;

// Called from `persist()` in db.ts, after the write has landed — the sweep reads
// Dexie, so firing before the commit would miss the row that caused it.
function scheduleSync(): void {
  if (!status.available) return;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, DEBOUNCE_MS);
}

function flushNow(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  void syncNow();
}

// ---------- Boot ----------

let initialized = false;

export async function initSync(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const result = await api<{ email: string; role: Role }>("/api/sync/me");
  if (result.kind !== "ok") {
    // Quietly, always. Sync being unreachable is not a reason for the app to
    // fail to boot — every read is local and every write already landed.
    reportFailure(result);
    return;
  }

  patch({
    available: true,
    email: result.data.email,
    role: result.data.role,
    error: null,
  });

  onWrite(scheduleSync);

  if (typeof window !== "undefined") {
    // Reconnecting is the one moment a backlog is guaranteed to be drainable,
    // so skip the debounce entirely.
    window.addEventListener("online", () => {
      patch({ online: true });
      flushNow();
    });
    window.addEventListener("offline", () => patch({ online: false }));
  }

  // Deliberately not awaited: `initSync` is on the boot path and a slow network
  // must not hold up the first render.
  void syncNow();
}

// Test seam. Not part of the public API — the module holds process-wide state
// (watermark cache, debounce timer, the initialized flag) that a fresh test
// case has to be able to clear.
export function __resetSyncForTests(): void {
  resetWatermarkCache();
  initialized = false;
  running = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  status = { ...initialStatus };
  listeners.clear();
  onWrite(() => {});
}
