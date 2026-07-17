import { describe, it, expect, beforeEach } from "vitest";
import {
  hydrateStores,
  upsertProduct,
  addOrder,
  addPurchase,
  deleteOrder,
  deleteProduct,
  deletePurchase,
  setOrderStatus,
  getProducts,
  getOrders,
  getPurchases,
  getStock,
} from "./store";
import { hydrateAudit, getAudit } from "./audit";
import { db, flushWrites, type Snapshot } from "./db";
import type { Product, OrderItem } from "./types";

// These tests exist to prove the write path actually reaches IndexedDB. The
// store API is synchronous and optimistic — memory updates and emits before the
// write lands — so asserting on in-memory state alone would pass even if every
// write silently failed. Everything here goes through `flushWrites()` and then
// reads the database back.

const product: Product = {
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
  deletedAt: null,
};

function order(over: Partial<OrderItem> = {}): OrderItem {
  return {
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
    deletedAt: null,
    ...over,
  };
}

const empty: Snapshot = {
  products: [],
  orders: [],
  purchases: [],
  stock: [],
  templates: [],
  audit: [],
  types: [],
};

async function reset(seed: Partial<Snapshot> = {}) {
  await db.open();
  await Promise.all([
    db.products.clear(),
    db.orders.clear(),
    db.purchases.clear(),
    db.stock.clear(),
    db.audit.clear(),
    db.types.clear(),
  ]);
  const snap = { ...empty, ...seed };
  hydrateStores(snap);
  hydrateAudit(snap);
}

describe("writes reach IndexedDB", () => {
  beforeEach(() => reset());

  it("persists a new product as its own row", async () => {
    upsertProduct(product);
    await flushWrites();

    expect((await db.products.get("p1"))?.namaProduk).toBe("Almond Kacang");
  });

  it("persists an order and its audit entry together", async () => {
    await reset({ products: [product] });

    addOrder(order());
    await flushWrites();

    expect(await db.orders.get("o1")).toBeTruthy();
    // The audit entry commits in the SAME transaction as the order.
    expect(await db.audit.count()).toBe(1);
  });

  it("updates an existing row in place rather than appending", async () => {
    await reset({ products: [product] });

    upsertProduct({ ...product, hargaJual: 7000 });
    await flushWrites();

    expect(await db.products.count()).toBe(1);
    expect((await db.products.get("p1"))?.hargaJual).toBe(7000);
    expect(getProducts()).toHaveLength(1);
  });
});

describe("soft delete", () => {
  beforeEach(() => reset({ products: [product] }));

  it("keeps the row in IndexedDB and stamps deletedAt", async () => {
    deleteProduct("p1");
    await flushWrites();

    // Gone from memory...
    expect(getProducts()).toHaveLength(0);
    // ...but still on disk, stamped.
    const row = await db.products.get("p1");
    expect(row).toBeTruthy();
    expect(row?.deletedAt).toBeTruthy();
    expect(row?.namaProduk).toBe("Almond Kacang");
  });

  it("is a no-op for an unknown id", async () => {
    deleteProduct("nope");
    await flushWrites();
    expect(getProducts()).toHaveLength(1);
  });
});

describe("cascades", () => {
  it("deleting an order tombstones its generated stock movement", async () => {
    await reset({ products: [product] });

    addOrder(order({ affectsStock: true }));
    await flushWrites();

    // The order generated a sale movement that deducts stock.
    expect(getStock()).toHaveLength(1);
    const movementId = getStock()[0].id;
    expect(getStock()[0].qty).toBe(-5);

    deleteOrder("o1");
    await flushWrites();

    // Both leave memory...
    expect(getOrders()).toHaveLength(0);
    expect(getStock()).toHaveLength(0);
    // ...and both are tombstoned on disk. An orphaned movement here would
    // silently corrupt every stock aggregate, which is why the cascade is one
    // transaction.
    expect((await db.orders.get("o1"))?.deletedAt).toBeTruthy();
    expect((await db.stock.get(movementId))?.deletedAt).toBeTruthy();
  });

  it("deleting a purchase tombstones its generated stock movement", async () => {
    await reset({ products: [product] });

    addPurchase({
      id: "b1",
      tanggal: "2026-07-15",
      productId: "p1",
      namaProduk: "Almond Kacang",
      satuan: "box",
      kuantitas: 2,
      hargaSatuan: 24000,
      totalHarga: 48000,
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      deletedAt: null,
    });
    await flushWrites();

    // 2 boxes x 12 = 24 base units in, valued at 24000/12 = 2000 per base unit.
    expect(getStock()).toHaveLength(1);
    expect(getStock()[0].qty).toBe(24);
    expect(getStock()[0].hargaModal).toBe(2000);
    const movementId = getStock()[0].id;

    deletePurchase("b1");
    await flushWrites();

    expect(getPurchases()).toHaveLength(0);
    expect(getStock()).toHaveLength(0);
    expect((await db.stock.get(movementId))?.deletedAt).toBeTruthy();
  });

  it("buying from an order records both movements and removes both when deleted", async () => {
    await reset({ products: [product] });

    addPurchase(
      {
        id: "b1",
        tanggal: "2026-07-15",
        productId: "p1",
        namaProduk: "Almond Kacang",
        satuan: "pcs",
        kuantitas: 5,
        hargaSatuan: 2000,
        totalHarga: 10000,
        createdAt: "2026-07-15T00:00:00.000Z",
        updatedAt: "2026-07-15T00:00:00.000Z",
        deletedAt: null,
      },
      "from order",
      order(),
    );
    await flushWrites();

    // A purchase that adds stock, plus a sale that offsets it for the order.
    expect(getStock()).toMatchObject([
      { qty: 5, reason: "purchase", purchaseId: "b1", orderId: null },
      { qty: -5, reason: "sale", purchaseId: "b1", orderId: "o1" },
    ]);
    expect(getStock().reduce((sum, m) => sum + m.qty, 0)).toBe(0);
    expect(await db.stock.count()).toBe(2);

    deletePurchase("b1");
    await flushWrites();

    expect(getStock()).toHaveLength(0);
  });
});

describe("hydrate", () => {
  it("never exposes tombstones to the stores", async () => {
    await reset({ products: [product] });

    deleteProduct("p1");
    await flushWrites();

    // Re-hydrate from what is actually on disk, as a fresh boot would.
    const rows = await db.products.toArray();
    hydrateStores({ ...empty, products: rows.filter((p) => p.deletedAt === null) });

    expect(getProducts()).toHaveLength(0);
    expect(await db.products.count()).toBe(1);
  });
});

describe("audit", () => {
  beforeEach(() => reset({ products: [product] }));

  it("appends one row per mutation without rewriting the log", async () => {
    addOrder(order({ id: "o1" }));
    addOrder(order({ id: "o2" }));
    setOrderStatus("o1", "paid");
    await flushWrites();

    // 2 creates + 1 status update.
    expect(getAudit()).toHaveLength(3);
    expect(await db.audit.count()).toBe(3);
  });

  it("does not log a status change that changes nothing", async () => {
    addOrder(order({ status: "pending" }));
    await flushWrites();
    const before = getAudit().length;

    setOrderStatus("o1", "pending");
    await flushWrites();

    expect(getAudit()).toHaveLength(before);
  });
});
