import { useSyncExternalStore } from "react";
import { type Table } from "dexie";
import { db, onWrite, resolveSeed } from "../db";
import { rehydrate } from "../bootstrap";
import { nowISO } from "../format";
import {
  TABLES,
  attributionOf,
  type Payload,
  type Row,
  type TableSpec,
} from "./tables";
import {
  __resetTabsForTests,
  broadcastChanged,
  claimLeadership,
  isLeader,
  onRemoteChange,
  onWake,
  requestSync,
} from "./tabs";

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

// Two rungs plus "not on the list". `none` means BLOCKED, not "reader": there
// is no longer a role that may look without saving — see
// docs/2026-08-15/permissions-plan.md decision 3.
export type Role = "none" | "write" | "admin";

export interface SyncStatus {
  // False when the API is not there at all — the GitHub Pages copy, which has
  // no Worker behind it. Distinct from "the request failed": there is nothing
  // to retry and nothing to report, so the UI hides sync entirely.
  available: boolean;
  email: string | null;
  role: Role;
  // True only once a live /api/sync/me has ANSWERED with a role. Without it
  // `role` is a guess — either the initial "none" or the localStorage cache —
  // and a guess must never gate anybody out of the app. See `isBlocked`.
  roleKnown: boolean;
  // May this account's changes leave the device? Set by an admin, answered by
  // /api/sync/me, enforced by the Worker on every push. False is "local-only":
  // the app works exactly as it always did, nothing is published, and pulling
  // carries on so this device still sees everyone else's rows.
  //
  // Covered by `roleKnown` — it comes from the same one answer, so a build that
  // has not heard from the server yet is guessing about this too.
  canPush: boolean;
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

// The last role /api/sync/me confirmed, so the UI has something better than
// "none" to show before the network answers — see `isBlocked`. localStorage
// rather than the Dexie `meta` table because it is read SYNCHRONOUSLY, during
// the first render, and Dexie cannot answer that early.
//
// A stale entry here is deliberately not defended against, in either
// direction. It only decides what the UI shows: every endpoint re-reads the
// role from D1 on every request, so a revoked user carrying a cached "write"
// sees the app and gets 403 on their next sync — the correct outcome, and the
// reason the server-side checks in src/worker/ must stay. Do not add
// expiry, signing or a revocation channel here; there is nothing to protect.
const ROLE_CACHE_KEY = "sync.role.v1";

// The same trick for the local-only flag, and for the same reason: the sync
// chip renders before the network answers, and "your changes stay on this
// device" is not a sentence to flash on and off.
//
// Absent means TRUE, matching the column default in migration 0003. The two
// wrong guesses are not symmetric: guessing false would show a local-only
// warning to everybody on their first ever boot, while guessing true is the
// state almost every account is actually in, and the push it might allow is
// refused by the Worker anyway.
const PUSH_CACHE_KEY = "sync.canpush.v1";

// D1 caps a row at ~2MB. Templates embed base64 dataURLs (template-store.ts) so
// they are the only table that can reach it. Leave headroom for the JSON quoting
// the Worker adds when it stringifies the object columns.
const ROW_SIZE_LIMIT = 1_800_000;

// Long enough to coalesce a burst of writes (a form save fires several
// `persist()` calls), short enough that the mirror is never visibly stale.
const DEBOUNCE_MS = 3000;

// ---------- Status store ----------

// The wire value is widened to a string on the way in so a role this build does
// not know about lands on `none` rather than on `undefined`. Failing closed is
// the right direction: the worst case is a UI that under-reports its own
// abilities, and the server decides anyway.
function asRole(raw: unknown): Role {
  return raw === "admin" ? "admin" : raw === "write" ? "write" : "none";
}

function readCachedRole(): Role {
  try {
    return asRole(localStorage.getItem(ROLE_CACHE_KEY));
  } catch {
    return "none";
  }
}

function readCachedCanPush(): boolean {
  try {
    return localStorage.getItem(PUSH_CACHE_KEY) !== "0";
  } catch {
    return true;
  }
}

function cacheGrant(role: Role, canPush: boolean): void {
  try {
    localStorage.setItem(ROLE_CACHE_KEY, role);
    localStorage.setItem(PUSH_CACHE_KEY, canPush ? "1" : "0");
  } catch {
    // Private-mode browsers can throw on write. A lost cache costs nothing —
    // the next successful /api/sync/me refills it.
  }
}

// A function rather than a constant because the cached role is read from
// localStorage each time: the test seam resets through here too, and a stale
// snapshot taken at import time would outlive a cleared store.
function freshStatus(): SyncStatus {
  return {
    available: false,
    email: null,
    // Optimistic on purpose. The role is unknown until the network answers, and
    // showing the last one we were told keeps a returning admin's nav from
    // flashing in late — and, more importantly, keeps `role` from reading as a
    // denial while it is really just unanswered.
    role: readCachedRole(),
    roleKnown: false,
    canPush: readCachedCanPush(),
    online:
      typeof navigator === "undefined" ? true : navigator.onLine !== false,
    busy: false,
    lastPushAt: null,
    lastPullAt: null,
    pending: {},
    pendingTotal: 0,
    error: null,
  };
}

let status: SyncStatus = freshStatus();

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

// Whether a push may be attempted at all. Both terms matter and they say
// different things: `canWrite` is "does this account get the app", `canPush` is
// "does what it writes get published". Nothing local changes when this is
// false — every write still lands in IndexedDB, which was always the commit
// point; it just stops there.
export function canPushToCloud(): boolean {
  return canWrite() && status.canPush;
}

// ---------- The gate ----------

// "This Access identity is signed in but is not on the roles list, and the
// server said so." The one condition the gate screen (RootLayout) may fire on.
//
// All three terms are load-bearing, and dropping any of them blanks the app for
// somebody who is entitled to it:
//
//   - `available` — false on the GitHub Pages copy, which has no Worker behind
//     it at all. `initSync` returns before setting it, so `role === "none"`
//     alone would blank that entire build.
//   - `roleKnown` — false until a live /api/sync/me has answered. `available`
//     is not enough on its own: a lapsed Access session sets it true from the
//     failure path, with the role still unanswered.
//   - `role === "none"` — the actual denial, only ever trusted alongside the
//     two above.
//
// Offline at boot therefore does NOT gate: /api/sync/me never answers, so
// `roleKnown` stays false and the cached role stands. A user whose train went
// into a tunnel keeps the whole app, which is the offline-first property this
// design exists to protect.
export function isBlocked(s: SyncStatus): boolean {
  return s.available && s.roleKnown && s.role === "none";
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

// Exposed for tests, for `discardLocalChanges`, and for the cross-tab listener.
// Dropping the cache matters: a test — or the leader tab, which is a different
// document sharing this same Dexie `meta` row — can rewrite it underneath us. A
// tab holding a stale copy would then compute its backlog against a watermark
// the leader has already moved.
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
      if (oversizedFloor === null || value < oversizedFloor)
        oversizedFloor = value;
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

function pendingFrom(
  swept: Swept[],
): Pick<SyncStatus, "pending" | "pendingTotal"> {
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
    // `redirect: "manual"` is load-bearing. Cloudflare Access answers an expired
    // session with a 302 to its login page on <team>.cloudflareaccess.com, and
    // the default "follow" chases it: a cross-origin request to a host that
    // sends no CORS headers, which makes the fetch REJECT. It would land in the
    // catch below and tell someone with a perfectly good network that they are
    // offline, while the console fills with CORS errors naming a URL that has
    // nothing wrong with it.
    res = await fetch(path, {
      credentials: "same-origin",
      redirect: "manual",
      ...init,
    });
  } catch {
    // fetch only rejects on a transport failure, which is the offline case.
    // The API is still assumed to exist, so `available` must not flip.
    return {
      kind: "error",
      message:
        "Tidak dapat terhubung ke server. Perubahan tetap tersimpan di perangkat ini.",
    };
  }

  // The redirect stopped here instead of being followed. An opaque response
  // carries no status, no headers and no body — but it does not need to, because
  // /api/* never redirects on its own: a redirect off our API IS Access asking
  // for a login, and only a reload can give it one. Checked before the
  // content-type below, which would otherwise read the missing header as "not
  // our API" and flip `available` off, hiding the chip that explains the problem.
  if (res.type === "opaqueredirect" || res.status === 0) {
    return { kind: "unauthenticated" };
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
  return {
    kind: "error",
    message: err.message ?? `Sinkronisasi gagal (${res.status}).`,
  };
}

// Translate a non-ok result into status. Returns true when the caller should
// stop — every non-ok result is a stop, this just keeps the branch in one place.
function reportFailure(
  result: Exclude<ApiResult<unknown>, { kind: "ok" }>,
): void {
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
    const diverged = force
      ? new Set<string>()
      : (local?.keys ?? new Set<string>());

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
    // `force` REPLACES the table rather than merging into it. Without the
    // clear, a row that exists only here — a seeded product, anything written
    // while local-only — survives a discard untouched, because a pull can only
    // put rows the server sent and the server has never heard of it. That made
    // "Buang perubahan lokal" a promise the code did not keep: the count went
    // down (the watermark moved) while the rows themselves stayed, which is the
    // one outcome the dialog rules out in so many words.
    //
    // Safe only because `force` is reached solely from `discardLocalChanges`,
    // which resets the watermarks to {} first — so `incoming` is the WHOLE
    // table, not a delta, and clearing before writing it loses nothing that the
    // same transaction does not immediately put back.
    if (force) {
      await db.transaction("rw", tableOf(spec), async () => {
        await tableOf(spec).clear();
        if (rows.length > 0) await tableOf(spec).bulkPut(rows);
      });
      applied += rows.length;
    } else if (rows.length > 0) {
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
    // Report the backlog even though the request failed, exactly as `runPush`
    // does. Offline is the case that makes this matter: the pull fails first, so
    // `syncNow` returns before ever reaching the push, and without this line the
    // chip keeps showing the pending count from the last SUCCESSFUL sync — i.e.
    // work done offline does not appear as unsent, which is the one moment the
    // number is load-bearing. The sweep above already read Dexie, so this costs
    // nothing.
    patch(pendingFrom(swept));
    return false;
  }

  const { applied, marks: nextMarks } = await applyPull(
    result.data.tables ?? {},
    swept,
    marks,
    force,
  );
  await saveWatermarks(nextMarks);

  // The pull is the moment a fresh install finally knows what the cloud holds,
  // and therefore the only honest moment to decide whether the starter
  // catalogue is wanted. `resolveSeed` is a no-op on every device that has
  // already answered — which is all of them after the first boot. See
  // SEED_PENDING_KEY in db.ts for what this replaced and why.
  const seeded = await resolveSeed();

  // Rehydrate only when something actually landed. The sequence lives in
  // bootstrap.ts because it is the same one boot runs; duplicating it here
  // would guarantee the two drift.
  //
  // The broadcast is what makes leader-only polling safe to look at: the other
  // tabs make no request of their own, so this is the only way they hear that
  // rows arrived. It goes out on the same condition as the local rehydrate —
  // announcing a pull that changed nothing would wake every tab for no reason.
  if (applied > 0 || seeded) {
    await rehydrate();
    broadcastChanged();
  }

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

// Deliberately NOT gated on leadership. The leader gate belongs on the
// automatic paths (`scheduleSync`, the poll, the reconnect flush), which is
// where the duplicated request rate actually comes from. This is also what the
// "Sinkronkan sekarang" button calls, and a button that silently did nothing
// because this tab happens not to hold a lock would be worse than the redundant
// request it saves. Two tabs pushing at once is safe — every statement is an
// idempotent upsert — it is only wasteful.
export async function syncNow(): Promise<void> {
  // Coalesce: a second caller joins the run in flight rather than starting a
  // concurrent sweep of the same tables.
  if (running) return running;
  lastSyncStartedAt = Date.now();
  running = (async () => {
    patch({ busy: true });
    try {
      if (!status.available) return;
      const pulled = await runPull(false);
      // A failed pull means the transport is down or the session lapsed;
      // pushing would fail the same way and overwrite the better message.
      if (!pulled) return;
      // A local-only account stops here, having pulled. The rows it has written
      // stay above the watermark and keep counting as pending, which is exactly
      // right: `pending` is the divergence set, and for this account that is a
      // permanent, honest number rather than a backlog waiting to drain.
      if (!canPushToCloud()) return;
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

// The other direction: make the cloud match THIS device, exactly.
//
// `discardLocalChanges` above is the cure when the cloud is right and a device
// is wrong. This is the cure when a device is right and the CLOUD is wrong —
// which is the state a JSON restore leaves you in, and the reason it needs to
// exist at all:
//
//   `importAll` replaces every store with the backup's rows, keeping their
//   original `updatedAt` values. Those are OLDER than the watermark, so the
//   next sweep does not see them and the restore is never pushed; and the rows
//   the restore deleted were cleared, not tombstoned, so the cloud keeps them
//   and hands them back on any later full pull. A restore is, today, entirely
//   invisible to sync. This is the button that publishes it.
//
// Deletion travels as TOMBSTONES, never as a server-side wipe. That is not a
// detail — a `DELETE FROM` in the Worker would remove the rows from D1 while
// every other device still held its own copy above its own watermark, and the
// first one to sync would push them all straight back. A tombstone is the only
// form of "this is gone" that other devices can actually receive.
//
// Two tables are deliberately left alone:
//
//   - `audit` has no `deletedAt` (tables.ts) — it is an append-only log, and
//     there is no shape a retraction could take. Local entries are still
//     pushed; the cloud's extra history simply stays.
//   - `types` is cursorless, and the Worker already replaces it wholesale on
//     every push, so it is made to match for free.
//
// Returns the number of cloud-only rows that were tombstoned, so the caller can
// say what actually happened rather than just "done".
export async function replaceCloudWithLocal(): Promise<number> {
  if (!status.available) {
    throw new Error("Cloud tidak tersedia dari perangkat ini.");
  }
  if (!canPushToCloud()) {
    throw new Error(
      "Akun ini disetel menyimpan di perangkat sendiri saja, jadi tidak bisa mengubah isi cloud.",
    );
  }

  // Ask for EVERYTHING, ignoring the watermarks. The whole job is to find rows
  // the cloud has and this device does not, and an incremental pull cannot see
  // them by construction: they are older than the watermark, which is exactly
  // why they have survived every sync so far.
  const everything: Record<string, null> = {};
  for (const spec of TABLES) everything[spec.name] = null;
  const result = await api<PullResponse>(
    `/api/sync/pull?since=${encodeURIComponent(JSON.stringify(everything))}`,
  );
  if (result.kind !== "ok") {
    reportFailure(result);
    // Nothing has been written yet, on either side. Failing here is the safe
    // place to fail, and the caller may say so.
    throw new Error(
      result.kind === "error"
        ? result.message
        : "Tidak dapat membaca isi cloud.",
    );
  }

  const payload = result.data.tables ?? {};
  const stamp = nowISO();
  let tombstoned = 0;

  for (const spec of TABLES) {
    const cursor = spec.cursor;
    if (cursor === null) continue;
    if (!spec.columns.includes("deletedAt")) continue;
    const incoming = payload[spec.name];
    if (!incoming || incoming.length === 0) continue;

    const local = new Set(
      (await tableOf(spec).toArray()).map((r) => String(r[spec.key])),
    );
    // The row's own content is kept and only the two timestamps are rewritten:
    // a tombstone that carries what it buried is what lets the audit trail and
    // any later forensics still say WHAT was removed.
    const graves = incoming
      .filter((r) => r["deletedAt"] == null && !local.has(String(r[spec.key])))
      .map((r) => ({
        ...pickIncoming(spec, r),
        deletedAt: stamp,
        [cursor]: stamp,
      }));
    if (graves.length === 0) continue;

    // Written straight to Dexie rather than through `persist()`: this must not
    // raise a write event, because the push below is not a debounced sweep that
    // happens to be scheduled — it is the point of the whole function.
    await tableOf(spec).bulkPut(graves);
    tombstoned += graves.length;
  }

  if (tombstoned > 0) {
    await rehydrate();
    broadcastChanged();
  }

  // Reset the watermarks so the sweep sees the ENTIRE local dataset, not the
  // handful of rows written since the last sync. A restored backup's rows are
  // old by definition; without this they would be filtered out on the cursor
  // and the push would carry nothing but the tombstones.
  resetWatermarkCache();
  await saveWatermarks({});
  if (!(await runPush())) {
    throw new Error(status.error ?? "Gagal mengirim data ke cloud.");
  }

  // Settle: re-pull so the watermarks land on the server's own values rather
  // than on what we happened to send. Nothing should come back — the two sides
  // now agree — and a normal, non-forcing pull is used precisely so that if
  // something does, it is treated as somebody else's edit and not discarded.
  await runPull(false);

  return tombstoned;
}

// ---------- Trigger ----------

let timer: ReturnType<typeof setTimeout> | null = null;

// Called from `persist()` in db.ts, after the write has landed — the sweep reads
// Dexie, so firing before the commit would miss the row that caused it.
//
// A non-leader tab stops here rather than pushing for itself. Its write is NOT
// dropped: sync/tabs.ts broadcasts on the same write event, the leader receives
// it as a remote change, and schedules this very function in its own document.
// The row is in the shared IndexedDB either way, so the leader's sweep finds it
// without anything having to be handed over.
function scheduleSync(): void {
  if (!status.available) return;
  if (!isLeader()) return;
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

// ---------- Periodic pull ----------

// Every trigger above is caused by THIS device: a local write debounces one,
// reconnecting flushes one, boot runs one. None of them fire when someone else
// changes a row, so a tab that is merely open shows whatever it saw the last
// time its own user touched something — and with more than one person on the
// data, "open and idle" is the normal state of a tab, not the exception. Two
// people editing stale copies of the same order is the thing the mirror exists
// to prevent, so freshness cannot depend on the reader happening to type.
//
// A minute, not ten seconds: a pull carries only rows past the watermark, so a
// steady-state poll is a near-empty response, but it is still a request per
// tab per interval against a free-tier Worker.
const POLL_MS = 60_000;

// Coming back to a tab is the moment staleness actually matters, so visibility
// syncs immediately instead of waiting out the interval. Alt-tabbing is
// frequent enough that it needs a floor, or a user moving between windows would
// fire a sync per switch.
const VISIBILITY_MIN_MS = 10_000;

let poll: ReturnType<typeof setInterval> | null = null;
let lastSyncStartedAt = 0;

// Hidden tabs are skipped rather than polled. A background tab has no reader,
// so the request buys nothing — and browsers throttle background timers anyway,
// which would make the interval a promise the platform does not keep. The
// visibility listener is what makes skipping safe: what you are looking at is
// never a minute stale, only what you are not.
//
// Every tab still runs this timer; what changes with more than one open is who
// SPENDS anything. A non-leader broadcasts instead of fetching, which costs
// nothing and reaches the one tab allowed to make the request. So the interval
// stays "per visible tab" while the request rate becomes "per origin", which is
// the number the free tier actually counts.
//
// The leader can still be hidden for a while — leadership only follows the user
// after tabs.ts's steal delay — which is exactly why the wake broadcast exists:
// a hidden leader skips its own interval, and the visible tab's wake is then
// what keeps the data fresh. It is no longer the ONLY thing, and that matters:
// a hidden tab is eventually frozen outright, at which point it stops receiving
// broadcasts too and a wake reaches nobody. Stealing is what ends that state;
// the wake is what covers the minutes before it.
function startPolling(): void {
  if (typeof window === "undefined" || poll !== null) return;

  poll = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    if (!status.online) return;
    if (isLeader()) void syncNow();
    else requestSync();
  }, POLL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    // The floor is applied here for a leader and at the receiving end for a
    // wake, because `lastSyncStartedAt` is per-document and a non-leader's copy
    // never advances — it makes no requests to time.
    if (isLeader()) {
      if (Date.now() - lastSyncStartedAt < VISIBILITY_MIN_MS) return;
      void syncNow();
    } else {
      requestSync();
    }
  });
}

// ---------- Boot ----------

let initialized = false;

// Unsubscribe functions for every listener registered below. Held so the test
// seam can actually unregister them — `onWrite` and the tabs.ts registries are
// Sets now, so overwriting a slot no longer clears anything and a leaked handler
// would fire against a later test's state.
const disposers: (() => void)[] = [];

export async function initSync(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const result = await api<{ email: string; role: string; canPush?: boolean }>(
    "/api/sync/me",
  );
  if (result.kind !== "ok") {
    // Quietly, always. Sync being unreachable is not a reason for the app to
    // fail to boot — every read is local and every write already landed.
    // `roleKnown` stays false, so nothing downstream reads the unanswered role
    // as a denial.
    reportFailure(result);
    // "unavailable" is the ONE failure that is also an answer: there is no
    // Worker behind this build (the GitHub Pages copy), so there is no cloud
    // catalogue to wait for and a deferred seed would be deferred forever.
    // Every other failure — offline, a lapsed Access session — leaves the flag
    // set for the next boot to resolve, because guessing "the cloud is empty"
    // is exactly the mistake this whole mechanism exists to stop.
    if (result.kind === "unavailable" && (await resolveSeed()))
      await rehydrate();
    return;
  }

  const role = asRole(result.data.role);
  // Absent means allowed. This is the one field where the OPPOSITE of the
  // failing-closed rule is right: a missing `canPush` means the Worker predates
  // the flag, and a Worker that does not know about local-only is one that will
  // accept the push regardless — so reading silence as "no" would stop syncing
  // for everyone against an older deploy, to enforce a rule that build has not
  // got. The server is still the enforcement either way.
  const canPush = result.data.canPush !== false;
  // Written only here: this is the one place a grant is confirmed by the server.
  cacheGrant(role, canPush);

  patch({
    available: true,
    email: result.data.email,
    role,
    roleKnown: true,
    canPush,
    error: null,
  });

  disposers.push(onWrite(scheduleSync));

  // Another tab wrote, or the leader pulled rows in. tabs.ts has already
  // re-read IndexedDB into the stores by the time this runs; what is left is the
  // bookkeeping only this module knows about.
  disposers.push(
    onRemoteChange(() => {
      // The watermark map is cached per tab over one shared `meta` row, so the
      // leader's last push may have moved it. Dropping the cache is what keeps
      // this tab's pending count honest and, if it later wins the election, what
      // keeps it from re-sweeping against a watermark that is hours old.
      resetWatermarkCache();
      // No-op unless this tab is the leader, in which case this is how a
      // non-leader's write actually reaches D1.
      scheduleSync();
    }),
  );

  // Only the leader is ever handed these (tabs.ts checks before fanning out), so
  // this is the request rate for the whole origin, not for this tab. The floor
  // is what stops four tabs' independent intervals from becoming four syncs.
  disposers.push(
    onWake(() => {
      if (Date.now() - lastSyncStartedAt < VISIBILITY_MIN_MS) return;
      void syncNow();
    }),
  );

  if (typeof window === "undefined") {
    // Deliberately not awaited: `initSync` is on the boot path and a slow
    // network must not hold up the first render.
    void syncNow();
    return;
  }

  // Reconnecting is the one moment a backlog is guaranteed to be drainable,
  // so skip the debounce entirely.
  window.addEventListener("online", () => {
    patch({ online: true });
    // Every tab hears `online`, but only one may act on it. A non-leader hands
    // the moment over instead of racing the leader to drain the same backlog out
    // of the same shared IndexedDB.
    if (isLeader()) flushNow();
    else requestSync();
  });
  window.addEventListener("offline", () => patch({ online: false }));
  // Only once the API is known to be there. On the GitHub Pages copy `initSync`
  // has already returned above, so no timer is ever created.
  startPolling();

  // Winning may happen now (no other tab open) or in an hour (when the tab
  // holding the lock closes). Syncing on election is not just an optimisation:
  // the tab that just went away may have been holding an undrained backlog, and
  // this tab is now the only one that can send it.
  claimLeadership(() => void syncNow());

  // A tab that did not win still wants current data on screen. Asking the
  // leader costs nothing and is answered with a `changed` broadcast if anything
  // actually arrived; the alternative is sitting on data up to POLL_MS stale
  // for no reason. Harmless in the tab that is about to win — nobody is leader
  // to act on it, and the election callback above covers that case.
  if (!isLeader()) requestSync();
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
  if (poll !== null) clearInterval(poll);
  poll = null;
  lastSyncStartedAt = 0;
  status = freshStatus();
  listeners.clear();
  for (const dispose of disposers) dispose();
  disposers.length = 0;
  __resetTabsForTests();
}
