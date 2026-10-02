import { useSyncExternalStore } from "react";
import {
  hasPendingWrites,
  onPersistError,
  onSavingChange,
  setPersistHooks,
  writeSeq,
  type Writes,
} from "../db";
import { applyPull } from "../bootstrap";
import { seedProducts } from "../seed";
import { seedTemplate } from "../template-seed";
import { TABLES, TABLE_BY_NAME, type Payload, type Row } from "./tables";

// The browser half of the D1 connection. See docs/2026-10-02/d1-only-plan.md.
//
// D1 is the only copy of the data. The arrays in store.ts are an in-memory cache
// of it, filled by one full pull at boot and kept fresh by a slow incremental
// poll. A write updates the cache first and is sent from `commit()` below; if
// the server refuses it, `revert()` reloads the cache from the server and the
// user is told. Nothing is saved on this device and nothing is queued.

// ---------- Public types ----------

// Two rungs plus "not on the list". `none` means BLOCKED.
export type Role = "none" | "write" | "admin";

export interface SyncStatus {
  // False when the API is not there at all (an old static copy of the site).
  available: boolean;
  email: string | null;
  role: Role;
  // True once /api/sync/me has answered. Without it `role` is a guess and must
  // never gate anybody out of the app. See `isBlocked`.
  roleKnown: boolean;
  // May this account save? False is read-only: the app shows everything, every
  // save is refused up front.
  canPush: boolean;
  online: boolean;
  // A pull is running.
  busy: boolean;
  // Writes on their way to D1 right now.
  saving: number;
  lastPullAt: string | null;
  // A save was refused. Sticky until dismissed: the change on screen was undone
  // and the user has to be told, not left to notice.
  error: string | null;
  // The last poll failed. Clears itself on the next one that works.
  pollError: string | null;
}

// ---------- Status store ----------

function freshStatus(): SyncStatus {
  return {
    available: false,
    email: null,
    role: "none",
    roleKnown: false,
    canPush: true,
    online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    busy: false,
    saving: 0,
    lastPullAt: null,
    error: null,
    pollError: null,
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

export function dismissError(): void {
  patch({ error: null });
}

function asRole(raw: unknown): Role {
  return raw === "admin" ? "admin" : raw === "write" ? "write" : "none";
}

export function canWrite(): boolean {
  return status.role === "write" || status.role === "admin";
}

// Whether a save may be attempted at all. Both terms matter: `canWrite` is "does
// this account get the app", `canPush` is "may it change anything".
export function canPushToCloud(): boolean {
  return canWrite() && status.canPush;
}

// "This Access identity is signed in but is not on the roles list, and the
// server said so." The one condition the gate screen may fire on. All three
// terms are load-bearing; see GateScreen.
export function isBlocked(s: SyncStatus): boolean {
  return s.available && s.roleKnown && s.role === "none";
}

// ---------- Transport ----------

type ApiResult<T> =
  | { kind: "ok"; data: T }
  // Not our API at all: Access served its HTML login page, or this is a static
  // copy and the path 404s into index.html.
  | { kind: "unavailable" }
  // The Access session lapsed. A reload re-runs the Access redirect.
  | { kind: "unauthenticated" }
  // A real, reportable failure — including "the network is down".
  | { kind: "error"; message: string };

const RELOAD_MESSAGE =
  "Sesi login sudah berakhir. Muat ulang halaman untuk masuk kembali.";
const OFFLINE_MESSAGE = "Tidak dapat terhubung ke server.";
const UNAVAILABLE_MESSAGE = "Server tidak tersedia.";

async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    // `redirect: "manual"` is load-bearing. Cloudflare Access answers an expired
    // session with a 302 to its login page on another origin; following it
    // makes the fetch REJECT with a CORS error and would read as "offline" to
    // someone with a perfectly good network.
    res = await fetch(path, {
      credentials: "same-origin",
      redirect: "manual",
      cache: "no-store",
      ...init,
    });
  } catch {
    return { kind: "error", message: OFFLINE_MESSAGE };
  }

  if (res.type === "opaqueredirect" || res.status === 0) {
    return { kind: "unauthenticated" };
  }

  // Check the content type BEFORE parsing: Access's login page is a 200 with HTML.
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
  return { kind: "error", message: err.message ?? `Permintaan gagal (${res.status}).` };
}

function messageOf(result: Exclude<ApiResult<unknown>, { kind: "ok" }>): string {
  if (result.kind === "unauthenticated") return RELOAD_MESSAGE;
  if (result.kind === "unavailable") return UNAVAILABLE_MESSAGE;
  return result.message;
}

interface PullResponse {
  serverTime: string;
  tables: Payload;
}

// ---------- Pull ----------

// A pull asks for rows newer than the previous pull's server time, minus this
// margin. The margin covers a write that was stamped just before a pull ran but
// committed just after: re-merging a row is harmless, missing one is not.
const OVERLAP_MS = 30_000;

let since: string | null = null;

function sinceParam(): string {
  if (since === null) return "";
  const map: Record<string, string> = {};
  for (const spec of TABLES) if (spec.cursor !== null) map[spec.name] = since;
  return `?since=${encodeURIComponent(JSON.stringify(map))}`;
}

function nextSince(serverTime: string): string {
  const t = Date.parse(serverTime);
  return Number.isNaN(t) ? serverTime : new Date(t - OVERLAP_MS).toISOString();
}

// Everything the server holds, tombstones included. Does not touch the stores.
async function pullAll(): Promise<PullResponse> {
  const result = await api<PullResponse>("/api/sync/pull");
  if (result.kind !== "ok") throw new Error(messageOf(result));
  return result.data;
}

// Replace the stores with the server's contents. Used at boot and to undo a
// refused write.
async function reload(): Promise<void> {
  const data = await pullAll();
  since = nextSince(data.serverTime);
  applyPull(data.tables ?? {}, true);
  patch({ lastPullAt: data.serverTime, pollError: null });
}

// ---------- Poll ----------

let running: Promise<void> | null = null;

// One incremental pull. Skipped while a write is unconfirmed, and its result is
// discarded if a write started while the request was in flight: either way the
// response may predate the change on screen and would put the old row back.
export async function syncNow(): Promise<void> {
  if (running) return running;
  if (!status.available || !canWrite()) return;
  if (hasPendingWrites()) return;

  running = (async () => {
    patch({ busy: true });
    const seq = writeSeq();
    try {
      const result = await api<PullResponse>(`/api/sync/pull${sinceParam()}`);
      if (result.kind !== "ok") {
        patch({ pollError: messageOf(result) });
        return;
      }
      if (hasPendingWrites() || writeSeq() !== seq) return;
      since = nextSince(result.data.serverTime);
      applyPull(result.data.tables ?? {}, false);
      patch({ lastPullAt: result.data.serverTime, pollError: null });
    } catch (err) {
      patch({ pollError: `Gagal memuat data: ${String(err)}` });
    } finally {
      patch({ busy: false });
      running = null;
    }
  })();
  return running;
}

// A minute, not ten seconds: a steady-state pull carries only the rows past
// `since`, so it is a near-empty response, but it is still a request per tab per
// interval against a free-tier Worker.
const POLL_MS = 60_000;

// Coming back to a tab is the moment staleness actually matters, so visibility
// pulls immediately. Alt-tabbing is frequent enough that it needs a floor.
const VISIBILITY_MIN_MS = 10_000;

let poll: ReturnType<typeof setInterval> | null = null;
let lastPullStartedAt = 0;

function pullIfDue(minGapMs: number): void {
  if (document.visibilityState === "hidden") return;
  if (!status.online) return;
  if (Date.now() - lastPullStartedAt < minGapMs) return;
  lastPullStartedAt = Date.now();
  void syncNow();
}

// Hidden tabs are skipped: a background tab has no reader, and browsers throttle
// its timers anyway. The visibility listener is what makes skipping safe.
function startPolling(): void {
  if (typeof window === "undefined" || poll !== null) return;

  poll = setInterval(() => pullIfDue(0), POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pullIfDue(VISIBILITY_MIN_MS);
  });
  window.addEventListener("online", () => {
    patch({ online: true });
    pullIfDue(0);
  });
  window.addEventListener("offline", () => patch({ online: false }));
}

// ---------- Push ----------

// A row on its way OUT carries exactly `spec.columns` — no more. That is the
// mechanical reason a push can never carry attribution: `createdBy`/`updatedBy`
// are not in `columns`. See the ATTRIBUTION block in tables.ts.
function pick(columns: string[], row: Row): Row {
  const out: Row = {};
  for (const col of columns) out[col] = row[col] ?? null;
  return out;
}

function toPayload(writes: Writes): Payload {
  const tables: Payload = {};
  for (const [name, rows] of Object.entries(writes)) {
    const spec = TABLE_BY_NAME.get(name);
    if (!spec || !rows || rows.length === 0) continue;
    tables[name] = rows.map((r) => pick(spec.columns, r));
  }
  return tables;
}

async function post(tables: Payload): Promise<void> {
  const result = await api<{ serverTime: string }>("/api/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tables }),
  });
  if (result.kind !== "ok") throw new Error(messageOf(result));
}

// What `persist()` calls for every store mutation.
async function commit(writes: Writes): Promise<void> {
  if (!canPushToCloud()) {
    throw new Error("Akun ini hanya bisa melihat data, tidak bisa menyimpan perubahan.");
  }
  await post(toPayload(writes));
}

// ---------- Boot ----------

let initialized = false;
const disposers: (() => void)[] = [];

// First run on a brand-new deployment: the starter catalogue, the example
// template and the default "Bar" type. Decided from the server's own rows —
// tombstones included, so deleting everything on purpose never brings the seed
// back — and only by an account that is allowed to save.
async function seedIfEmpty(tables: Payload): Promise<boolean> {
  if (!canPushToCloud()) return false;
  const writes: Writes = {};
  if ((tables.products ?? []).length === 0) writes.products = seedProducts() as unknown as Row[];
  if ((tables.templates ?? []).length === 0) writes.templates = [seedTemplate()] as unknown as Row[];
  if ((tables.types ?? []).length === 0) writes.types = [{ nama: "Bar" }];
  if (Object.keys(writes).length === 0) return false;
  await post(toPayload(writes));
  return true;
}

// Open the app: ask who this is, load everything, start polling. Throws when the
// data could not be loaded — the caller shows the error and a retry button,
// because rendering with empty tables would look exactly like data loss.
export async function initSync(): Promise<void> {
  if (initialized) return;

  const me = await api<{ email: string; role: string; canPush?: boolean }>("/api/sync/me");
  if (me.kind !== "ok") throw new Error(messageOf(me));

  const role = asRole(me.data.role);
  // Absent means allowed: a Worker that predates the flag accepts the push
  // regardless. The server is the enforcement either way.
  const canPush = me.data.canPush !== false;
  patch({
    available: true,
    email: me.data.email,
    role,
    roleKnown: true,
    canPush,
  });

  // Not on the list: nothing to load, and every endpoint would answer 403. The
  // gate screen takes over from here.
  if (role === "none") {
    initialized = true;
    return;
  }

  let data = await pullAll();

  // First run on a brand-new deployment only; see seedIfEmpty.
  try {
    if (await seedIfEmpty(data.tables ?? {})) data = await pullAll();
  } catch (err) {
    patch({
      error: `Data awal gagal disimpan: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  since = nextSince(data.serverTime);
  applyPull(data.tables ?? {}, true);
  patch({ lastPullAt: data.serverTime });

  setPersistHooks({ commit, revert: reload });
  onPersistError((err) => {
    patch({
      error:
        `Perubahan tidak tersimpan: ${err instanceof Error ? err.message : String(err)} ` +
        `Tampilan dikembalikan sesuai data di server.`,
    });
  });
  disposers.push(onSavingChange((saving) => patch({ saving })));

  initialized = true;
  startPolling();
}

// Test seam. The module holds process-wide state that a fresh test case has to
// be able to clear.
export function __resetSyncForTests(): void {
  initialized = false;
  running = null;
  since = null;
  if (poll !== null) clearInterval(poll);
  poll = null;
  lastPullStartedAt = 0;
  status = freshStatus();
  listeners.clear();
  for (const dispose of disposers) dispose();
  disposers.length = 0;
  setPersistHooks(null);
}
