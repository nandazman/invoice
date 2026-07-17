import { describe, it, expect, beforeEach } from "vitest";
import { db, migrateFromLocalStorage, readAll, purgeTombstones } from "./db";
import { LEGACY_KEYS } from "./storage";

// The migration is the one piece of this change that touches data the user
// cannot get back if we are wrong. These tests pin the ordering guarantees:
// copy -> verify -> flag, and never delete the source.

const PRODUCTS_KEY = "invoice.products.v1";
const ORDERS_KEY = "invoice.orders.v1";
const STOCK_KEY = "invoice.stock.v1";
const AUDIT_KEY = "invoice.audit.v1";
const TYPES_KEY = "invoice.types.v1";

// A legacy (pre-deletedAt, pre-IndexedDB) product row.
const legacyProduct = {
  id: "p1",
  namaProduk: "Almond Kacang",
  tipe: "Bar",
  ukuran: null,
  satuan: "pcs",
  hargaDasar: 2000,
  hargaJual: 5000,
  konversi: [{ nama: "box", jumlah: 12, harga: 60000 }],
  stokMin: 0,
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
};

const legacyOrder = {
  id: "o1",
  tanggal: "2026-07-15",
  productId: "p1",
  namaProduk: "Almond Kacang",
  satuan: "pcs",
  kuantitas: 5,
  hargaSatuan: 5000,
  totalHarga: 25000,
  status: "pending",
  affectsStock: false,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

async function resetAll() {
  localStorage.clear();
  await db.open();
  await Promise.all([
    db.products.clear(),
    db.orders.clear(),
    db.purchases.clear(),
    db.stock.clear(),
    db.templates.clear(),
    db.audit.clear(),
    db.types.clear(),
    db.meta.clear(),
  ]);
}

describe("migrateFromLocalStorage", () => {
  beforeEach(resetAll);

  it("seeds a fresh install rather than migrating nothing", async () => {
    const result = await migrateFromLocalStorage();

    expect(result.status).toBe("seeded");
    expect(await db.products.count()).toBeGreaterThan(0);
    // Seeding must not write back to localStorage — the old loader did that as
    // a side effect of a read, which is why the seed moved into db.ts.
    expect(localStorage.getItem(PRODUCTS_KEY)).toBeNull();
  });

  it("copies every legacy table into IndexedDB", async () => {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify([legacyProduct]));
    localStorage.setItem(ORDERS_KEY, JSON.stringify([legacyOrder]));
    localStorage.setItem(TYPES_KEY, JSON.stringify(["Bar", "Dapur"]));
    localStorage.setItem(
      AUDIT_KEY,
      JSON.stringify([
        {
          id: "a1",
          timestamp: "2026-07-15T00:00:00.000Z",
          entity: "product",
          entityId: "p1",
          action: "create",
          label: "dibuat",
        },
      ]),
    );

    const result = await migrateFromLocalStorage();

    expect(result.status).toBe("migrated");
    expect(await db.products.count()).toBe(1);
    expect(await db.orders.count()).toBe(1);
    expect(await db.audit.count()).toBe(1);
    expect((await db.products.get("p1"))?.namaProduk).toBe("Almond Kacang");
  });

  it("backfills deletedAt: null on legacy rows", async () => {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify([legacyProduct]));
    localStorage.setItem(ORDERS_KEY, JSON.stringify([legacyOrder]));

    await migrateFromLocalStorage();

    // Explicitly null, not undefined: IndexedDB stores undefined verbatim and
    // `deletedAt === null` is what the live-row filter tests.
    const p = await db.products.get("p1");
    expect(p?.deletedAt).toBeNull();
    expect("deletedAt" in (p as object)).toBe(true);
    expect((await db.orders.get("o1"))?.deletedAt).toBeNull();
  });

  it("does NOT delete the legacy localStorage keys", async () => {
    // They are the only rollback path if the migration proves buggy in the
    // field. A later release removes them.
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify([legacyProduct]));
    localStorage.setItem(ORDERS_KEY, JSON.stringify([legacyOrder]));

    await migrateFromLocalStorage();

    expect(localStorage.getItem(PRODUCTS_KEY)).not.toBeNull();
    expect(localStorage.getItem(ORDERS_KEY)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(PRODUCTS_KEY)!)).toEqual([legacyProduct]);
  });

  it("is idempotent — a second run is a no-op", async () => {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify([legacyProduct]));

    expect((await migrateFromLocalStorage()).status).toBe("migrated");
    expect((await migrateFromLocalStorage()).status).toBe("skipped");

    // Not duplicated by the second run.
    expect(await db.products.count()).toBe(1);
  });

  it("does not re-migrate over data written since the migration", async () => {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify([legacyProduct]));
    await migrateFromLocalStorage();

    // Simulate the user editing after migrating.
    await db.products.put({ ...legacyProduct, hargaJual: 9999, deletedAt: null });
    await migrateFromLocalStorage();

    // The flag must stop the stale localStorage copy from clobbering the edit.
    expect((await db.products.get("p1"))?.hargaJual).toBe(9999);
  });

  it("applies the legacy field back-fills from storage.ts", async () => {
    // A row from before `tipe`/`stokMin`/timestamps existed.
    const ancient = { id: "p9", namaProduk: "Lama", hargaJual: 1000, konversi: [] };
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify([ancient]));

    await migrateFromLocalStorage();

    const p = await db.products.get("p9");
    expect(p?.tipe).toBe("Bar");
    expect(p?.hargaDasar).toBe(0);
    expect(p?.stokMin).toBe(0);
    expect(p?.createdAt).toBeTruthy();
    expect(p?.deletedAt).toBeNull();
  });

  it("treats any legacy key as an existing install", async () => {
    // Stock only, no products: still a migration, not a fresh seed.
    localStorage.setItem(STOCK_KEY, JSON.stringify([]));
    expect(LEGACY_KEYS).toContain(STOCK_KEY);

    expect((await migrateFromLocalStorage()).status).toBe("migrated");
  });
});

describe("readAll", () => {
  beforeEach(resetAll);

  it("returns live rows and hides tombstones", async () => {
    await db.products.bulkPut([
      { ...legacyProduct, id: "live", deletedAt: null },
      { ...legacyProduct, id: "dead", deletedAt: "2026-07-16T00:00:00.000Z" },
    ]);

    const snap = await readAll();

    expect(snap.products.map((p) => p.id)).toEqual(["live"]);
    // The tombstone is hidden from the stores, NOT deleted from the database.
    expect(await db.products.count()).toBe(2);
  });

  it("sorts types", async () => {
    await db.types.bulkPut([{ nama: "Dapur" }, { nama: "Bar" }]);
    expect((await readAll()).types).toEqual(["Bar", "Dapur"]);
  });
});

describe("purgeTombstones", () => {
  beforeEach(resetAll);

  it("removes tombstones older than the cutoff and keeps live rows", async () => {
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
    await db.products.bulkPut([
      { ...legacyProduct, id: "live", deletedAt: null },
      { ...legacyProduct, id: "old", deletedAt: old },
      { ...legacyProduct, id: "recent", deletedAt: recent },
    ]);

    const removed = await purgeTombstones(90);

    expect(removed).toBe(1);
    const ids = (await db.products.toArray()).map((p) => p.id).sort();
    // `live` survives because null is not indexable — it is absent from the
    // deletedAt index entirely, so a range query can never match it.
    expect(ids).toEqual(["live", "recent"]);
  });
});
