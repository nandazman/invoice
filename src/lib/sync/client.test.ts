import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db, flushWrites } from "../db";
import {
  initSync,
  syncNow,
  pullNow,
  discardLocalChanges,
  getSyncStatus,
  canWrite,
  isBlocked,
  __resetSyncForTests,
  type Role,
} from "./client";
import type { Payload } from "./tables";

// These tests pin the four things the sync design actually rests on:
//
//   1. the sweep reads DEXIE, so a soft delete is in the push set;
//   2. the watermark advances on success and ONLY on success — that is the
//      whole offline story, there is no outbox to check instead;
//   3. a pull never overwrites a locally diverged row;
//   4. a non-JSON response is "the API is not here", not an error to report.
//
// Everything else in the client is bookkeeping around those.

const WATERMARKS_KEY = "sync.watermarks.v1";

// ---------- fetch stub ----------

interface Recorded {
  url: string;
  body: unknown;
}

interface Routes {
  me?: () => Response;
  pull?: (since: Record<string, string | null>) => Response;
  push?: (body: { tables: Payload }) => Response;
}

let calls: Recorded[] = [];
let routes: Routes = {};
let realFetch: typeof globalThis.fetch | undefined;

// Only the four members the client touches. A hand-rolled stub beats a real
// Response here because it lets a test serve HTML with a 200, which is exactly
// what Cloudflare Access's login page does and what case (4) is about.
function res(body: unknown, status = 200, type = "application/json"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? type : null),
    },
    json: async () => body,
  } as unknown as Response;
}

function html(): Response {
  return res("<!doctype html><title>Sign in</title>", 200, "text/html; charset=utf-8");
}

function installFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });

    if (url.startsWith("/api/sync/me")) {
      return routes.me?.() ?? res({ email: "a@b.c", role: "write" });
    }
    if (url.startsWith("/api/sync/pull")) {
      const raw = decodeURIComponent(url.split("since=")[1] ?? "%7B%7D");
      const since = JSON.parse(raw) as Record<string, string | null>;
      return routes.pull?.(since) ?? res({ serverTime: "T0", tables: {} });
    }
    if (url.startsWith("/api/sync/push")) {
      return (
        routes.push?.(body as { tables: Payload }) ??
        res({ serverTime: "T1", applied: {} })
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof globalThis.fetch;
}

// ---------- fixtures ----------

const product = (id: string, updatedAt: string, over: Record<string, unknown> = {}) => ({
  id,
  namaProduk: `Produk ${id}`,
  tipe: "Bar",
  ukuran: null,
  satuan: "pcs",
  hargaDasar: 1000,
  hargaJual: 2000,
  konversi: [],
  stokMin: 0,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt,
  deletedAt: null,
  ...over,
});

// hydrateTemplates() SEEDS an example template when the table is empty, and a
// seed is a write — which would show up as a phantom pending row in the middle
// of a pull assertion. One inert template keeps that path quiet. It must also
// survive template-store's migrate() untouched: logo present, no legacy fields,
// no negative z.
const inertTemplate = {
  id: "t1",
  nama: "Inert",
  business: { nama: "T", alamat: "", telepon: "", logo: "data:image/png;base64,AA" },
  customer: { nama: "", alamat: "" },
  elements: [
    { id: "e1", type: "logo", x: 0, y: 0, w: 10, h: 10, z: 1, style: {} },
  ],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  deletedAt: null,
};

// Park every table's watermark in the far future so only the tables a test
// seeds explicitly are ever pending. Without this, the inert template and the
// seeded types row would appear in every push.
const FUTURE = "9999-01-01T00:00:00.000Z";

async function setWatermarks(over: Record<string, string | null> = {}): Promise<void> {
  const marks: Record<string, string | null> = {
    products: FUTURE,
    orders: FUTURE,
    purchases: FUTURE,
    stock: FUTURE,
    buyers: FUTURE,
    templates: FUTURE,
    audit: FUTURE,
    // Cursorless: its watermark is a content marker, and "[]" matches the empty
    // types table these tests start with.
    types: "[]",
    ...over,
  };
  await db.meta.put({ key: WATERMARKS_KEY, value: marks });
}

async function readWatermarks(): Promise<Record<string, string | null>> {
  const row = await db.meta.get(WATERMARKS_KEY);
  return (row?.value ?? {}) as Record<string, string | null>;
}

async function reset(): Promise<void> {
  // localStorage FIRST: the status the reset seam builds reads the cached role
  // out of it, so clearing afterwards would leave one test's role seeding the
  // next test's initial status.
  localStorage.clear();
  __resetSyncForTests();
  calls = [];
  routes = {};
  await db.open();
  await Promise.all([
    db.products.clear(),
    db.orders.clear(),
    db.purchases.clear(),
    db.stock.clear(),
    db.templates.clear(),
    db.audit.clear(),
    db.types.clear(),
    db.buyers.clear(),
    db.meta.clear(),
  ]);
  await db.templates.put(inertTemplate as never);
}

// Bring the client up as `role` and let its boot sync finish. `initSync` fires
// the first sync without awaiting it (boot must not wait on the network), so a
// second `syncNow()` joins the run already in flight rather than starting one.
async function boot(role: Role = "write"): Promise<void> {
  routes.me = () => res({ email: "a@b.c", role });
  await initSync();
  await syncNow();
  await flushWrites();
}

// Boot a client that will not push, so a test can assert on the pull half on
// its own. `none` is the only role left that cannot push. In production such a
// client never reaches a pull at all — the gate screen hides the app and the
// Worker answers 403 — but the fetch stub here does not enforce roles, so it
// serves purely as a push-suppressing seam and keeps these tests about pulling.
async function bootWithoutPush(): Promise<void> {
  await boot("none");
}

beforeEach(async () => {
  realFetch = globalThis.fetch;
  installFetch();
  await reset();
});

afterEach(() => {
  __resetSyncForTests();
  if (realFetch) globalThis.fetch = realFetch;
});

describe("identity", () => {
  it("resolves the role and reports availability", async () => {
    await setWatermarks();
    await boot("admin");

    const s = getSyncStatus();
    expect(s.available).toBe(true);
    expect(s.email).toBe("a@b.c");
    expect(s.role).toBe("admin");
    expect(canWrite()).toBe(true);
  });

  it("treats a non-JSON response as an absent API, not an error", async () => {
    // Access serving its HTML login page, or the GitHub Pages copy 404ing into
    // index.html. Both are 200s with HTML. Parsing first would surface a
    // SyntaxError as the user's sync error, which is neither useful nor true.
    routes.me = () => html();
    await setWatermarks();
    await initSync();

    const s = getSyncStatus();
    expect(s.available).toBe(false);
    expect(s.error).toBeNull();
    // Nothing is attempted beyond the probe.
    expect(calls.map((c) => c.url)).toEqual(["/api/sync/me"]);
  });

  it("asks the user to reload when the Access session lapsed", async () => {
    routes.me = () =>
      res({ code: "unauthenticated", message: "no jwt" }, 401);
    await setWatermarks();
    await initSync();

    const s = getSyncStatus();
    // The API is there — this is not the GitHub Pages case.
    expect(s.available).toBe(true);
    expect(s.error).toMatch(/Muat ulang/);
  });
});

describe("push sweep", () => {
  it("includes a soft-deleted row, because it sweeps Dexie and not memory", async () => {
    await db.products.bulkPut([
      product("p1", "2026-08-01T00:00:00.000Z") as never,
      product("p2", "2026-08-02T00:00:00.000Z", {
        deletedAt: "2026-08-02T00:00:00.000Z",
      }) as never,
    ]);
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });

    await boot("write");

    const push = calls.find((c) => c.url === "/api/sync/push");
    const rows = (push?.body as { tables: Payload }).tables.products ?? [];
    expect(rows.map((r) => r.id).sort()).toEqual(["p1", "p2"]);
    // The tombstone is the whole point: the deleted row is absent from the
    // in-memory arrays, so a memory sweep would never replicate the delete.
    expect(rows.find((r) => r.id === "p2")?.deletedAt).toBe(
      "2026-08-02T00:00:00.000Z",
    );
  });

  it("sends only the columns in the shared spec", async () => {
    await db.products.put(
      product("p1", "2026-08-01T00:00:00.000Z", { secretLocalField: 1 }) as never,
    );
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });

    await boot("write");

    const push = calls.find((c) => c.url === "/api/sync/push");
    const row = (push?.body as { tables: Payload }).tables.products?.[0] ?? {};
    expect("secretLocalField" in row).toBe(false);
    expect(row.namaProduk).toBe("Produk p1");
  });

  it("skips rows at or below the watermark", async () => {
    await db.products.bulkPut([
      product("old", "2026-07-01T00:00:00.000Z") as never,
      product("new", "2026-08-01T00:00:00.000Z") as never,
    ]);
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });

    await boot("write");

    const push = calls.find((c) => c.url === "/api/sync/push");
    const rows = (push?.body as { tables: Payload }).tables.products ?? [];
    expect(rows.map((r) => r.id)).toEqual(["new"]);
  });

  it("never pushes without a role, and the sweep becomes the divergence count", async () => {
    await db.products.put(product("p1", "2026-08-01T00:00:00.000Z") as never);
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });

    await bootWithoutPush();

    expect(calls.some((c) => c.url === "/api/sync/push")).toBe(false);
    expect(canWrite()).toBe(false);
    expect(getSyncStatus().pending.products).toBe(1);
    expect(getSyncStatus().pendingTotal).toBe(1);
  });
});

describe("watermark advancement", () => {
  it("advances to the newest cursor actually sent, on success", async () => {
    await db.products.bulkPut([
      product("p1", "2026-08-01T00:00:00.000Z") as never,
      product("p2", "2026-08-03T00:00:00.000Z") as never,
    ]);
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });

    await boot("write");

    expect((await readWatermarks()).products).toBe("2026-08-03T00:00:00.000Z");
    expect(getSyncStatus().pendingTotal).toBe(0);
    expect(getSyncStatus().lastPushAt).toBe("T1");
  });

  it("does NOT advance when the push fails, and keeps the rows pending", async () => {
    await db.products.put(product("p1", "2026-08-01T00:00:00.000Z") as never);
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });
    routes.push = () => res({ code: "server_error", message: "D1 down" }, 500);

    await boot("write");

    // This IS the offline mechanism. The unchanged watermark is the only record
    // that the row still needs sending — there is no outbox behind it.
    expect((await readWatermarks()).products).toBe("2026-07-15T00:00:00.000Z");
    expect(getSyncStatus().pending.products).toBe(1);
    expect(getSyncStatus().error).toMatch(/D1 down/);
  });

  it("does not advance when the network is down", async () => {
    await db.products.put(product("p1", "2026-08-01T00:00:00.000Z") as never);
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });
    const stub = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/sync/me")) return stub(input, init);
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;

    await boot("write");

    expect((await readWatermarks()).products).toBe("2026-07-15T00:00:00.000Z");
    // A transport failure must not flip `available` — the API still exists.
    expect(getSyncStatus().available).toBe(true);
    expect(getSyncStatus().error).toMatch(/tidak dapat terhubung/i);
  });
});

describe("pull", () => {
  it("applies server rows and rehydrates the stores", async () => {
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });
    routes.pull = () =>
      res({
        serverTime: "T9",
        tables: { products: [product("s1", "2026-08-10T00:00:00.000Z")] },
      });

    await bootWithoutPush();

    expect((await db.products.get("s1"))?.namaProduk).toBe("Produk s1");
    expect(getSyncStatus().lastPullAt).toBe("T9");
    // No divergence, so the watermark follows the newest row received.
    expect((await readWatermarks()).products).toBe("2026-08-10T00:00:00.000Z");
  });

  it("skips a row that diverges locally, and applies the rest", async () => {
    await db.products.put(
      product("p1", "2026-08-01T00:00:00.000Z", { namaProduk: "Lokal" }) as never,
    );
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });
    routes.pull = () =>
      res({
        serverTime: "T9",
        tables: {
          products: [
            product("p1", "2026-08-09T00:00:00.000Z", { namaProduk: "Server" }),
            product("p2", "2026-08-09T00:00:00.000Z"),
          ],
        },
      });

    await bootWithoutPush();

    // The local edit survives: nothing is discarded without an explicit click.
    expect((await db.products.get("p1"))?.namaProduk).toBe("Lokal");
    expect((await db.products.get("p2"))?.namaProduk).toBe("Produk p2");
    // And the watermark stays put, or p1 would drop out of the divergence set
    // and could never be reconciled.
    expect((await readWatermarks()).products).toBe("2026-07-15T00:00:00.000Z");
    // 2, not 1: with the watermark held back, the row just applied from the
    // server (p2) also sits above it. That is the documented cost of a scalar
    // watermark — see applyPull. It resolves on the next push for a writer, and
    // makes the reader's count an upper bound.
    expect(getSyncStatus().pending.products).toBe(2);
  });

  it("sends the stored watermarks as `since`", async () => {
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });
    await bootWithoutPush();

    const pull = calls.find((c) => c.url.startsWith("/api/sync/pull"));
    const since = JSON.parse(
      decodeURIComponent(pull!.url.split("since=")[1]),
    ) as Record<string, string | null>;
    expect(since.products).toBe("2026-07-15T00:00:00.000Z");
    // Cursorless tables always ask for everything.
    expect(since.types).toBeNull();
  });

  it("replaces a cursorless table wholesale", async () => {
    await setWatermarks();
    routes.pull = () =>
      res({ serverTime: "T9", tables: { types: [{ nama: "Bar" }, { nama: "Dapur" }] } });

    await bootWithoutPush();

    expect((await db.types.toArray()).map((t) => t.nama).sort()).toEqual([
      "Bar",
      "Dapur",
    ]);
  });

  it("pullNow does not push even for a writer", async () => {
    await db.products.put(product("p1", "2026-08-01T00:00:00.000Z") as never);
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });
    routes.push = () => res({ serverTime: "T1", applied: {} });

    await boot("write");
    calls = [];
    await pullNow();

    expect(calls.some((c) => c.url === "/api/sync/push")).toBe(false);
  });
});

describe("attribution", () => {
  // The two server-stamped columns ride along on PULL only. See the ATTRIBUTION
  // block in tables.ts — the risk being pinned here is that data flowing INTO
  // Dexie makes a row look diverged, or bumps the cursor, or comes back out on
  // the next push.

  it("lands createdBy/updatedBy in Dexie, with no Dexie version bump", async () => {
    // Unindexed fields need no migration: a Dexie schema string declares the
    // primary key and the indexes, and the record itself is a structured clone
    // of whatever object was put. If that were false this read would come back
    // without the two fields.
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });
    routes.pull = () =>
      res({
        serverTime: "T9",
        tables: {
          products: [
            product("s1", "2026-08-10T00:00:00.000Z", {
              createdBy: "andi@example.com",
              updatedBy: "budi@example.com",
            }),
          ],
        },
      });

    await bootWithoutPush();

    const row = (await db.products.get("s1")) as unknown as Record<string, unknown>;
    expect(row.createdBy).toBe("andi@example.com");
    expect(row.updatedBy).toBe("budi@example.com");
  });

  it("leaves the row absent-not-undefined when the server never stamped it", async () => {
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });
    routes.pull = () =>
      res({
        serverTime: "T9",
        tables: { products: [product("s1", "2026-08-10T00:00:00.000Z")] },
      });

    await bootWithoutPush();

    const row = (await db.products.get("s1")) as unknown as Record<string, unknown>;
    expect("createdBy" in row).toBe(false);
  });

  it("does not bump updatedAt, so it cannot loop the sweep", async () => {
    // updatedAt is the sync cursor. If applying a pull rewrote it, the row would
    // sit above the watermark again on the very next sweep, push, come back, and
    // never settle.
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });
    routes.pull = () =>
      res({
        serverTime: "T9",
        tables: {
          products: [
            product("s1", "2026-08-10T00:00:00.000Z", { updatedBy: "andi@b.c" }),
          ],
        },
      });

    await bootWithoutPush();

    expect((await db.products.get("s1"))?.updatedAt).toBe(
      "2026-08-10T00:00:00.000Z",
    );
    // Cursor untouched means the watermark followed the row, and nothing is
    // left looking locally-diverged.
    expect((await readWatermarks()).products).toBe("2026-08-10T00:00:00.000Z");
    expect(getSyncStatus().pendingTotal).toBe(0);
  });

  it("never sends attribution back, even from a row that has it", async () => {
    // The row is pulled WITH attribution and then edited locally, so it is in
    // the next push set with createdBy/updatedBy still on it. `pick()` filters
    // to spec.columns, which is what has to drop them.
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });
    routes.pull = () =>
      res({
        serverTime: "T9",
        tables: {
          products: [
            product("s1", "2026-08-10T00:00:00.000Z", {
              createdBy: "andi@example.com",
              updatedBy: "budi@example.com",
            }),
          ],
        },
      });

    await boot("write");

    // A later local edit: same row, newer cursor, attribution still attached.
    await db.products.put(
      product("s1", "2026-08-11T00:00:00.000Z", {
        createdBy: "andi@example.com",
        updatedBy: "budi@example.com",
      }) as never,
    );
    calls = [];
    await syncNow();

    const push = calls.find((c) => c.url === "/api/sync/push");
    const row = (push?.body as { tables: Payload }).tables.products?.[0] ?? {};
    expect("createdBy" in row).toBe(false);
    expect("updatedBy" in row).toBe(false);
    expect(row.id).toBe("s1");
  });

  it("does not make an otherwise-identical row pending", async () => {
    // Divergence is decided by the CURSOR, never by comparing content. A row
    // whose only difference from the server's is the attribution it just
    // received must not register as a local change.
    await db.products.put(product("p1", "2026-08-01T00:00:00.000Z") as never);
    await setWatermarks({ products: "2026-08-01T00:00:00.000Z" });
    routes.pull = () =>
      res({
        serverTime: "T9",
        tables: {
          products: [
            product("p1", "2026-08-01T00:00:00.000Z", {
              createdBy: "andi@example.com",
            }),
          ],
        },
      });

    await bootWithoutPush();

    expect(getSyncStatus().pending.products).toBeUndefined();
    expect(getSyncStatus().pendingTotal).toBe(0);
  });
});

describe("discardLocalChanges", () => {
  it("resets the watermarks and lets the server win outright", async () => {
    await db.products.put(
      product("p1", "2026-08-01T00:00:00.000Z", { namaProduk: "Lokal" }) as never,
    );
    await setWatermarks({ products: "2026-07-15T00:00:00.000Z" });
    routes.pull = (since) =>
      res({
        serverTime: "T9",
        // Echo the cursor back so the test can assert it was cleared.
        tables: {
          products: [
            product("p1", "2026-08-09T00:00:00.000Z", {
              namaProduk: since.products === null ? "Server" : "Lokal",
            }),
          ],
        },
      });

    await bootWithoutPush();
    expect((await db.products.get("p1"))?.namaProduk).toBe("Lokal");

    await discardLocalChanges();

    expect((await db.products.get("p1"))?.namaProduk).toBe("Server");
    expect((await readWatermarks()).products).toBe("2026-08-09T00:00:00.000Z");
  });
});

describe("oversized templates", () => {
  it("skips the row and names it, rather than failing the whole push", async () => {
    // D1 caps a row at ~2MB and templates embed base64 dataURLs, so this is the
    // one table that can hit it (tables.ts).
    await db.templates.put({
      ...inertTemplate,
      id: "big",
      nama: "Template Raksasa",
      business: { ...inertTemplate.business, logo: "x".repeat(2_000_000) },
      updatedAt: "2026-08-05T00:00:00.000Z",
    } as never);
    await db.products.put(product("p1", "2026-08-01T00:00:00.000Z") as never);
    await setWatermarks({
      products: "2026-07-15T00:00:00.000Z",
      templates: "2026-07-15T00:00:00.000Z",
    });

    await boot("write");

    const push = calls.find((c) => c.url === "/api/sync/push");
    const tables = (push?.body as { tables: Payload }).tables;
    // The oversized template is gone; everything else went out.
    expect(tables.templates).toBeUndefined();
    expect(tables.products?.length).toBe(1);
    expect(getSyncStatus().error).toMatch(/Template Raksasa/);
  });

  it("does not let the watermark advance past the skipped row", async () => {
    // A newer sibling in the same table used to carry the watermark past the
    // oversized row. The next sweep then filtered that row out on the cursor
    // BEFORE the size check ran, so it was never sent and never reported again
    // — unsendable rather than merely unsent.
    await db.templates.put({
      ...inertTemplate,
      id: "big",
      nama: "Template Raksasa",
      business: { ...inertTemplate.business, logo: "x".repeat(2_000_000) },
      updatedAt: "2026-08-01T00:00:00.000Z",
    } as never);
    await db.templates.put({
      ...inertTemplate,
      id: "small",
      nama: "Template Kecil",
      updatedAt: "2026-08-05T00:00:00.000Z", // newer than the oversized one
    } as never);
    await setWatermarks({ templates: "2026-07-15T00:00:00.000Z" });

    await boot("write");

    // The small one goes out, and the watermark stays BELOW the oversized row's
    // cursor rather than jumping to the small one's.
    const push = calls.find((c) => c.url === "/api/sync/push");
    const tables = (push?.body as { tables: Payload }).tables;
    expect(tables.templates?.map((r) => r.id)).toEqual(["small"]);

    const marks = (await db.meta.get("sync.watermarks.v1"))?.value as Record<
      string,
      string | null
    >;
    expect(marks.templates === null || marks.templates < "2026-08-01T00:00:00.000Z").toBe(
      true,
    );

    // Which means it is still swept, so the user is still told about it.
    expect(getSyncStatus().error).toMatch(/Template Raksasa/);
    expect(getSyncStatus().pending.templates).toBeGreaterThan(0);
  });
});

// The poll is the one trigger this environment cannot see on its own:
// `startPolling` is guarded on `typeof window`, and node has none. Stubbing the
// three members it touches is enough to pin what actually matters — that the
// interval gets created at all, that a hidden tab is skipped, and that coming
// back to a tab syncs without waiting out the interval — instead of leaving the
// whole feature untested over an environment detail.
describe("periodic pull", () => {
  let visibility = "visible";
  let onVisibilityChange: (() => void) | null = null;

  const pulls = () => calls.filter((c) => c.url.startsWith("/api/sync/pull")).length;

  beforeEach(() => {
    visibility = "visible";
    onVisibilityChange = null;
    Object.defineProperty(globalThis, "window", {
      value: { addEventListener: () => {} },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: {
        get visibilityState() {
          return visibility;
        },
        addEventListener: (type: string, fn: () => void) => {
          if (type === "visibilitychange") onVisibilityChange = fn;
        },
      },
      configurable: true,
      writable: true,
    });
    // ONLY the interval and the clock. fake-indexeddb schedules its own work on
    // setTimeout, so faking that too deadlocks every Dexie call in `boot()` —
    // the suite hangs rather than fails, which is a much worse way to find out.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it("pulls again after the interval without any local write", async () => {
    await setWatermarks();
    await boot("write");
    const before = pulls();

    await vi.advanceTimersByTimeAsync(60_000);

    // The point of the whole feature: nothing on this device changed, and the
    // tab still went and looked.
    expect(pulls()).toBe(before + 1);
  });

  it("skips the tick while the tab is hidden", async () => {
    await setWatermarks();
    await boot("write");
    const before = pulls();

    visibility = "hidden";
    await vi.advanceTimersByTimeAsync(180_000);

    expect(pulls()).toBe(before);
  });

  it("syncs on becoming visible again, but not more than once per 10s", async () => {
    await setWatermarks();
    await boot("write");

    // The visibility handler fires `syncNow` without awaiting it, and the run
    // goes through Dexie — which is on the REAL setTimeout here (see the
    // `toFake` list). So settling it is a real tick, not a timer advance.
    const settle = () => new Promise((r) => setTimeout(r, 20));

    // Straight after a sync, a visibility flip is swallowed — alt-tabbing
    // between two windows must not fire a request per switch.
    visibility = "visible";
    onVisibilityChange?.();
    await settle();
    expect(pulls()).toBe(1);

    // Past the floor it goes through, without waiting out the full interval.
    vi.advanceTimersByTime(11_000);
    onVisibilityChange?.();
    await settle();
    expect(pulls()).toBe(2);
  });
});

// The gate screen blanks the entire app, so the interesting cases here are the
// ones where it must NOT fire. Each of them is a worse bug than the one the
// gate fixes, and each would ship unnoticed on a machine where the API is up
// and the role is granted.
describe("the gate condition", () => {
  it("does not gate when the API is absent — the GitHub Pages copy", async () => {
    // No Worker behind this build: /api/sync/me 404s into index.html, which is
    // a 200 of HTML. `initSync` returns before `available` is ever set.
    routes.me = () => html();
    await setWatermarks();
    await initSync();

    const s = getSyncStatus();
    expect(s.available).toBe(false);
    expect(s.role).toBe("none");
    // The whole point: role alone says "blocked", and believing it would blank
    // a build that has no roles at all.
    expect(isBlocked(s)).toBe(false);
  });

  it("does not gate when the network is down at boot", async () => {
    // fetch rejecting is the offline case. The role is UNKNOWN, not denied.
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as never;
    await setWatermarks();
    await initSync();

    const s = getSyncStatus();
    expect(s.roleKnown).toBe(false);
    expect(isBlocked(s)).toBe(false);
  });

  it("does not gate when the Access session lapsed", async () => {
    // 401 sets `available` true from the failure path, with the role still
    // unanswered — which is why `available && role === "none"` is not enough
    // on its own.
    routes.me = () => res({ code: "unauthenticated", message: "no jwt" }, 401);
    await setWatermarks();
    await initSync();

    const s = getSyncStatus();
    expect(s.available).toBe(true);
    expect(s.roleKnown).toBe(false);
    expect(isBlocked(s)).toBe(false);
  });

  it("gates only on a confirmed 'none' from a live /api/sync/me", async () => {
    await setWatermarks();
    await bootWithoutPush();

    const s = getSyncStatus();
    expect(s.available).toBe(true);
    expect(s.roleKnown).toBe(true);
    expect(isBlocked(s)).toBe(true);
  });

  it("does not gate a granted role", async () => {
    await setWatermarks();
    await boot("write");

    expect(isBlocked(getSyncStatus())).toBe(false);
  });
});

describe("the cached role", () => {
  it("stands in for the role until the server answers", async () => {
    await setWatermarks();
    await boot("admin");

    // A reload with the network down: the cache is what keeps the admin nav
    // from vanishing, and keeps the role from reading as a denial.
    __resetSyncForTests();
    expect(getSyncStatus().role).toBe("admin");
    expect(getSyncStatus().roleKnown).toBe(false);
  });

  it("is overwritten by whatever the server last confirmed", async () => {
    await setWatermarks();
    await boot("admin");

    __resetSyncForTests();
    await setWatermarks();
    await boot("write");

    __resetSyncForTests();
    expect(getSyncStatus().role).toBe("write");
  });
});
