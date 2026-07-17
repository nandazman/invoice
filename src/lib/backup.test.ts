import { describe, it, expect, beforeEach } from "vitest";
import { exportAll, importAll, BACKUP_VERSION } from "./backup";
import { hydrateStores, getProducts, getOrders, getTypes } from "./store";
import { hydrateAudit, getAudit } from "./audit";
import { hydrateTemplates, getTemplates } from "./template-store";
import { db, flushWrites, readAll } from "./db";
import type { Snapshot } from "./db";

// A backup you cannot restore is not a backup. The v2 cases here are the ones
// that matter in the field: users have v2 files on disk, written before the
// IndexedDB migration, and those must keep restoring after this change.

const product = {
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

const order = {
  id: "o1",
  tanggal: "2026-07-15",
  productId: "p1",
  namaProduk: "Almond Kacang",
  satuan: "pcs",
  kuantitas: 5,
  hargaSatuan: 5000,
  totalHarga: 25000,
  status: "pending" as const,
  affectsStock: false,
  createdAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

const auditEntry = {
  id: "a1",
  timestamp: "2026-07-15T00:00:00.000Z",
  entity: "product" as const,
  entityId: "p1",
  action: "create" as const,
  label: "Produk dibuat",
};

// A v2 backup: the pre-IndexedDB shape. No `deletedAt` anywhere.
function v2File(): string {
  return JSON.stringify({
    version: 2,
    exportedAt: "2026-07-16T00:00:00.000Z",
    products: [product],
    orders: [order],
    purchases: [],
    stock: [],
    types: ["Bar", "Dapur"],
    templates: [],
    audit: [auditEntry],
  });
}

const emptySnapshot: Snapshot = {
  products: [],
  orders: [],
  purchases: [],
  stock: [],
  templates: [],
  audit: [],
  types: [],
};

async function resetStores() {
  await db.open();
  await Promise.all([
    db.products.clear(),
    db.orders.clear(),
    db.purchases.clear(),
    db.stock.clear(),
    db.templates.clear(),
    db.audit.clear(),
    db.types.clear(),
  ]);
  hydrateStores(emptySnapshot);
  hydrateAudit(emptySnapshot);
  // Not hydrateTemplates: it seeds an example template when given an empty
  // list, which would pollute the round-trip assertions.
}

describe("importAll — v2 files (pre-IndexedDB)", () => {
  beforeEach(resetStores);

  it("restores a v2 backup instead of rejecting it", () => {
    importAll(v2File());

    expect(getProducts()).toHaveLength(1);
    expect(getProducts()[0].namaProduk).toBe("Almond Kacang");
    expect(getOrders()).toHaveLength(1);
    expect(getTypes()).toEqual(["Bar", "Dapur"]);
    expect(getAudit()).toHaveLength(1);
  });

  it("backfills deletedAt: null on every restored row", () => {
    importAll(v2File());

    expect(getProducts()[0].deletedAt).toBeNull();
    expect(getOrders()[0].deletedAt).toBeNull();
  });

  it("preserves ids — a restore is a replacement, not an import", () => {
    importAll(v2File());

    expect(getProducts()[0].id).toBe("p1");
    expect(getOrders()[0].id).toBe("o1");
    // The stock <-> product link survives, which is the whole point of Backup
    // semua over the per-page JSON exchange format (which regenerates ids).
    expect(getOrders()[0].productId).toBe("p1");
  });
});

describe("exportAll / importAll — v3 round-trip", () => {
  beforeEach(resetStores);

  it("round-trips byte-identically apart from exportedAt", () => {
    importAll(v2File());
    const first = exportAll();

    importAll(first);
    const second = exportAll();

    const a = JSON.parse(first);
    const b = JSON.parse(second);
    delete a.exportedAt;
    delete b.exportedAt;
    expect(b).toEqual(a);
  });

  it("stamps the current version on export", () => {
    importAll(v2File());
    expect(JSON.parse(exportAll()).version).toBe(BACKUP_VERSION);
    expect(BACKUP_VERSION).toBe(3);
  });

  it("does not export tombstones", () => {
    // The stores hold live rows only, so a tombstone cannot reach a backup. A
    // delete that already happened is not something a restore needs to replay.
    hydrateStores({
      ...emptySnapshot,
      products: [{ ...product, deletedAt: null }],
    });
    hydrateAudit(emptySnapshot);

    expect(JSON.parse(exportAll()).products).toHaveLength(1);
  });
});

describe("importAll — durability", () => {
  beforeEach(resetStores);

  // Regression: restore appeared to do nothing. importAll only updates memory
  // and fires the writes; the caller then ran location.reload(), which killed
  // the in-flight transactions, and the reboot re-read the OLD data. Safe under
  // localStorage (synchronous setItem), fatal once writes went async.
  //
  // The reload is gone, but the underlying requirement is what matters: after a
  // restore settles, IndexedDB must hold the restored data — a reload, a closed
  // tab, or a crash must not undo it.
  it("writes the restored data to IndexedDB, not just memory", async () => {
    importAll(v2File());
    await flushWrites();

    // Read the database back exactly as a fresh boot would.
    const snap = await readAll();
    expect(snap.products).toHaveLength(1);
    expect(snap.products[0].id).toBe("p1");
    expect(snap.orders).toHaveLength(1);
    expect(snap.types).toEqual(["Bar", "Dapur"]);
    expect(snap.audit).toHaveLength(1);
  });

  it("survives a simulated reload", async () => {
    importAll(v2File());
    await flushWrites();

    // Drop everything in memory, then re-hydrate from disk — a page reload.
    hydrateStores(emptySnapshot);
    hydrateAudit(emptySnapshot);
    expect(getProducts()).toHaveLength(0);

    const snap = await readAll();
    hydrateStores(snap);
    hydrateAudit(snap);

    expect(getProducts()).toHaveLength(1);
    expect(getProducts()[0].namaProduk).toBe("Almond Kacang");
    expect(getOrders()[0].productId).toBe("p1");
  });

  it("replaces prior data rather than merging into it", async () => {
    // Pre-existing rows that are NOT in the backup file must be gone: a restore
    // is a wholesale replacement.
    // `product` is deliberately v2-shaped (no deletedAt), so stamp it here.
    hydrateStores({
      ...emptySnapshot,
      products: [
        { ...product, id: "stale", namaProduk: "Produk Lama", deletedAt: null },
      ],
    });
    await db.products.put({ ...product, id: "stale", deletedAt: null });
    await flushWrites();

    importAll(v2File());
    await flushWrites();

    const snap = await readAll();
    expect(snap.products.map((p) => p.id)).toEqual(["p1"]);
    expect(await db.products.get("stale")).toBeUndefined();
  });
});

describe("importAll — validation", () => {
  beforeEach(resetStores);

  it("rejects an unknown/future version", () => {
    const future = JSON.stringify({ ...JSON.parse(v2File()), version: 99 });
    expect(() => importAll(future)).toThrow(/tidak didukung/);
  });

  it("rejects a file with no version", () => {
    expect(() => importAll(JSON.stringify({ products: [] }))).toThrow(
      /tidak didukung/,
    );
  });

  it("leaves every store untouched when the file is bad", () => {
    importAll(v2File());
    const before = exportAll();

    expect(() => importAll("{ not json")).toThrow();
    expect(() => importAll(JSON.stringify({ version: 99 }))).toThrow();

    const after = exportAll();
    const a = JSON.parse(before);
    const b = JSON.parse(after);
    delete a.exportedAt;
    delete b.exportedAt;
    expect(b).toEqual(a);
  });
});

describe("importAll — reactivity", () => {
  beforeEach(resetStores);

  it("updates templates and types live, with no page reload", async () => {
    // The pre-IndexedDB importAll wrote types/templates straight to
    // localStorage because neither store had a setter, so a restore only took
    // effect after a reload. Both are real stores now.
    const template = {
      id: "t1",
      nama: "Template Uji",
      business: { nama: "Toko", alamat: "Jl. 1", telepon: "0812", logo: null },
      customer: { nama: "", alamat: "" },
      elements: [],
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      deletedAt: null,
    };
    hydrateTemplates({ ...emptySnapshot, templates: [template] });

    importAll(
      JSON.stringify({
        ...JSON.parse(v2File()),
        templates: [{ ...template, nama: "Dipulihkan" }],
      }),
    );

    expect(getTemplates()[0].nama).toBe("Dipulihkan");
    expect(getTypes()).toEqual(["Bar", "Dapur"]);
  });
});
