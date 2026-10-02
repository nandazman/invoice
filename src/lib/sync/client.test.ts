import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { flushWrites, __resetPersistForTests } from "../db";
import {
  initSync,
  syncNow,
  getSyncStatus,
  canWrite,
  isBlocked,
  dismissError,
  __resetSyncForTests,
} from "./client";
import { getProducts, upsertProduct } from "../store";
import { getAudit } from "../audit";
import type { Payload } from "./tables";

// What the D1-only client has to get right:
//
//   1. boot loads everything from the server, and refuses to open on a failure
//      (an empty app would look exactly like data loss);
//   2. a write reaches the server in ONE request, with the audit entry in it;
//   3. a refused write is undone on screen and reported, never left standing;
//   4. a poll never overwrites a change that is still on its way;
//   5. a non-JSON response is "the API is not here", not an error to report.

// ---------- fetch stub ----------

interface Recorded {
  url: string;
  body: { tables: Payload; legacy?: boolean } | null;
}

interface Routes {
  me?: () => Response;
  pull?: (since: Record<string, string> | null) => Response;
  push?: (body: { tables: Payload }) => Response | Promise<Response>;
}

let calls: Recorded[] = [];
let routes: Routes = {};
let realFetch: typeof globalThis.fetch | undefined;

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
      const raw = url.split("since=")[1];
      const since = raw ? (JSON.parse(decodeURIComponent(raw)) as Record<string, string>) : null;
      return routes.pull?.(since) ?? pullOf({});
    }
    if (url.startsWith("/api/sync/push")) {
      return (
        (await routes.push?.(body as { tables: Payload })) ??
        res({ serverTime: "2026-10-02T10:00:01.000Z", applied: {} })
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

// A template that survives template-store's migrate() untouched.
const template = {
  id: "t1",
  nama: "Inert",
  business: { nama: "T", alamat: "", telepon: "", logo: "data:image/png;base64,AA" },
  customer: { nama: "", alamat: "" },
  elements: [{ id: "e1", type: "logo", x: 0, y: 0, w: 10, h: 10, z: 1, style: {} }],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  deletedAt: null,
};

// Non-empty products/templates/types, so the first-run seed stays out of the
// way of the assertions.
function fullEmpty(over: Payload = {}): Payload {
  return {
    products: [product("seed", "2026-07-01T00:00:00.000Z")],
    templates: [template],
    types: [{ nama: "Bar" }],
    ...over,
  };
}

function pullOf(tables: Payload, serverTime = "2026-10-02T10:00:00.000Z"): Response {
  return res({ serverTime, tables: fullEmpty(tables) });
}

const pushes = () => calls.filter((c) => c.url.startsWith("/api/sync/push"));
const pulls = () => calls.filter((c) => c.url.startsWith("/api/sync/pull"));

beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = [];
  routes = {};
  __resetSyncForTests();
  __resetPersistForTests();
  installFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch as typeof globalThis.fetch;
});

// ---------- boot ----------

describe("initSync", () => {
  it("loads every row from the server before resolving", async () => {
    routes.pull = () =>
      pullOf({
        products: [
          product("p1", "2026-09-01T00:00:00.000Z"),
          product("p2", "2026-09-02T00:00:00.000Z"),
        ],
      });

    await initSync();

    expect(getProducts().map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(getSyncStatus()).toMatchObject({ available: true, roleKnown: true, role: "write" });
    // The first pull asks for everything: no `since`.
    expect(calls.find((c) => c.url.startsWith("/api/sync/pull"))!.url).toBe("/api/sync/pull");
  });

  it("drops tombstones from the arrays", async () => {
    routes.pull = () =>
      pullOf({
        products: [
          product("p1", "2026-09-01T00:00:00.000Z"),
          product("p2", "2026-09-02T00:00:00.000Z", { deletedAt: "2026-09-03T00:00:00.000Z" }),
        ],
      });
    await initSync();
    expect(getProducts().map((p) => p.id)).toEqual(["p1"]);
  });

  it("throws instead of opening on an empty app when the pull fails", async () => {
    routes.pull = () => res({ code: "internal", message: "D1 mati" }, 500);
    await expect(initSync()).rejects.toThrow("D1 mati");
  });

  it("throws when the API is not there at all", async () => {
    routes.me = () => html();
    await expect(initSync()).rejects.toThrow("Server tidak tersedia");
  });

  it("gates an account that is not on the list, without pulling anything", async () => {
    routes.me = () => res({ email: "x@y.z", role: "none" });
    await initSync();
    expect(isBlocked(getSyncStatus())).toBe(true);
    expect(canWrite()).toBe(false);
    expect(pulls()).toHaveLength(0);
  });

  it("seeds a brand-new deployment, once, from the server's own emptiness", async () => {
    routes.pull = () => res({ serverTime: "2026-10-02T10:00:00.000Z", tables: {} });
    await initSync();
    const seed = pushes()[0];
    expect(seed.body!.tables.products!.length).toBeGreaterThan(0);
    expect(seed.body!.tables.templates).toHaveLength(1);
    expect(seed.body!.tables.types).toEqual([{ nama: "Bar" }]);
  });

  it("does not seed when the server holds rows, even only tombstones", async () => {
    routes.pull = () =>
      pullOf({
        products: [
          product("p1", "2026-09-01T00:00:00.000Z", { deletedAt: "2026-09-02T00:00:00.000Z" }),
        ],
      });
    await initSync();
    expect(pushes()).toHaveLength(0);
  });
});

// ---------- writes ----------

describe("a write", () => {
  it("reaches the server in one request, with its audit entry", async () => {
    routes.pull = () => pullOf({});
    await initSync();

    upsertProduct(product("new", "2026-10-02T00:00:00.000Z") as never);
    await flushWrites();

    expect(pushes()).toHaveLength(1);
    const tables = pushes()[0].body!.tables;
    expect(tables.products).toHaveLength(1);
    expect(tables.audit).toHaveLength(1);
    // Spec columns only: attribution can never ride a push.
    expect(Object.keys(tables.products![0])).not.toContain("createdBy");
  });

  it("shows at once, before the server answers", async () => {
    routes.pull = () => pullOf({});
    let release!: () => void;
    routes.push = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(res({ serverTime: "T", applied: {} }));
      });
    await initSync();

    upsertProduct(product("new", "2026-10-02T00:00:00.000Z") as never);
    expect(getProducts().some((p) => p.id === "new")).toBe(true);
    expect(getSyncStatus().saving).toBe(1);

    // let the request start, then answer it
    await new Promise((r) => setTimeout(r, 0));
    release();
    await flushWrites();
    expect(getSyncStatus().saving).toBe(0);
    expect(getSyncStatus().error).toBeNull();
  });

  it("is undone on screen and reported when the server refuses it", async () => {
    routes.pull = () => pullOf({});
    await initSync();
    routes.push = () => res({ code: "row_too_large", message: "Baris terlalu besar." }, 413);

    const auditBefore = getAudit().length;
    upsertProduct(product("new", "2026-10-02T00:00:00.000Z") as never);
    expect(getProducts().some((p) => p.id === "new")).toBe(true);
    await flushWrites();

    // reverted from a fresh full pull, which does not contain the row
    expect(getProducts().some((p) => p.id === "new")).toBe(false);
    expect(getAudit()).toHaveLength(auditBefore);
    expect(getSyncStatus().error).toContain("Baris terlalu besar.");
    expect(getSyncStatus().error).toContain("dikembalikan");

    dismissError();
    expect(getSyncStatus().error).toBeNull();
  });

  it("is refused up front for an account that may only look", async () => {
    routes.me = () => res({ email: "a@b.c", role: "write", canPush: false });
    routes.pull = () => pullOf({});
    await initSync();

    upsertProduct(product("new", "2026-10-02T00:00:00.000Z") as never);
    await flushWrites();

    expect(pushes()).toHaveLength(0);
    expect(getProducts().some((p) => p.id === "new")).toBe(false);
    expect(getSyncStatus().error).toContain("hanya bisa melihat");
  });
});

// ---------- poll ----------

describe("syncNow (the poll)", () => {
  it("asks only for rows past the previous server time, minus a margin", async () => {
    routes.pull = () => pullOf({}, "2026-10-02T10:00:00.000Z");
    await initSync();

    let seen: Record<string, string> | null = null;
    routes.pull = (since) => {
      seen = since;
      return pullOf({}, "2026-10-02T10:01:00.000Z");
    };
    await syncNow();

    expect(seen).not.toBeNull();
    expect(seen!.products).toBe("2026-10-02T09:59:30.000Z");
    // types has no cursor, so it never appears in `since`
    expect(seen!.types).toBeUndefined();
  });

  it("merges someone else's change in, and removes what they deleted", async () => {
    routes.pull = () =>
      pullOf({
        products: [
          product("p1", "2026-09-01T00:00:00.000Z"),
          product("p2", "2026-09-01T00:00:00.000Z"),
        ],
      });
    await initSync();

    routes.pull = () =>
      pullOf({
        products: [
          product("p1", "2026-10-02T10:00:30.000Z", { hargaJual: 9999 }),
          product("p2", "2026-10-02T10:00:30.000Z", { deletedAt: "2026-10-02T10:00:30.000Z" }),
          product("p3", "2026-10-02T10:00:30.000Z"),
        ],
      });
    await syncNow();

    expect(getProducts().map((p) => [p.id, p.hargaJual])).toEqual([
      ["p1", 9999],
      ["p3", 2000],
    ]);
  });

  it("does not run while a write is unconfirmed", async () => {
    routes.pull = () => pullOf({});
    await initSync();
    routes.push = () => new Promise<Response>(() => {}); // never answers
    upsertProduct(product("new", "2026-10-02T00:00:00.000Z") as never);

    const before = pulls().length;
    await syncNow();
    expect(pulls()).toHaveLength(before);
  });

  it("throws its response away if a write started while it was in flight", async () => {
    routes.pull = () => pullOf({});
    await initSync();

    // The poll's response carries the OLD version of the row; a write lands
    // while it is on the wire. Applying it would put the old row back.
    routes.pull = () => {
      upsertProduct(product("mine", "2026-10-02T10:00:10.000Z") as never);
      return pullOf({});
    };
    routes.push = () => new Promise<Response>(() => {});
    await syncNow();

    expect(getProducts().some((p) => p.id === "mine")).toBe(true);
  });

  it("reports a failed poll without touching the data, and clears on the next good one", async () => {
    routes.pull = () => pullOf({ products: [product("p1", "2026-09-01T00:00:00.000Z")] });
    await initSync();

    routes.pull = () => res({ code: "internal", message: "gagal" }, 500);
    await syncNow();
    expect(getSyncStatus().pollError).toBe("gagal");
    expect(getProducts().map((p) => p.id)).toEqual(["p1"]);

    routes.pull = () => pullOf({});
    await syncNow();
    expect(getSyncStatus().pollError).toBeNull();
  });
});
