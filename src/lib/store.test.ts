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
  linkOrderProduct,
  linkPurchaseProduct,
  upsertBuyer,
  deleteBuyer,
  setOrderBuyer,
  setOrdersStatus,
  setOrdersBuyer,
  backfillOrderBuyer,
  getProducts,
  getOrders,
  getPurchases,
  getStock,
  getBuyers,
} from "./store";
import { hydrateAudit, getAudit } from "./audit";
import { db, flushWrites, BUYER_BACKFILL_KEY, type Snapshot } from "./db";
import type { Product, OrderItem, PurchaseItem, Buyer } from "./types";

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
    buyerId: "",
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

function buyer(over: Partial<Buyer> = {}): Buyer {
  return {
    id: "b1",
    nama: "Bu Ani",
    telepon: "081200000000",
    email: "",
    alamat: "",
    catatan: "",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
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
  buyers: [],
  needsBuyerBackfill: false,
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
    db.buyers.clear(),
    db.meta.clear(),
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

describe("linkOrderProduct", () => {
  // A legacy row: no productId, and a sale price that no longer matches the
  // product's current hargaJual.
  const orphan = () =>
    order({ id: "o9", productId: "", hargaSatuan: 4000, totalHarga: 20000 });

  beforeEach(() => reset({ products: [product] }));

  it("sets productId and persists it with an audit entry", async () => {
    addOrder(orphan());
    await flushWrites();
    const before = await db.audit.count();

    linkOrderProduct("o9", "p1");
    await flushWrites();

    expect((await db.orders.get("o9"))?.productId).toBe("p1");
    expect(await db.audit.count()).toBe(before + 1);
  });

  it("leaves the sold price and name untouched", async () => {
    addOrder(orphan());
    linkOrderProduct("o9", "p1");
    await flushWrites();

    const row = await db.orders.get("o9");
    expect(row?.hargaSatuan).toBe(4000); // not the product's 5000
    expect(row?.totalHarga).toBe(20000);
    expect(row?.namaProduk).toBe("Almond Kacang");
  });

  it("ignores an unknown product id", async () => {
    addOrder(orphan());
    linkOrderProduct("o9", "nope");
    await flushWrites();

    expect((await db.orders.get("o9"))?.productId).toBe("");
  });

  it("is a no-op when already linked to that product", async () => {
    addOrder(order()); // already productId "p1"
    await flushWrites();
    const before = await db.audit.count();

    linkOrderProduct("o1", "p1");
    await flushWrites();

    expect(await db.audit.count()).toBe(before);
  });
});

describe("linkPurchaseProduct", () => {
  // Same legacy shape as the order case: no productId, and a paid price that no
  // longer matches the product's current hargaDasar.
  const orphan = (): PurchaseItem => ({
    id: "b9",
    tanggal: "2026-07-15",
    productId: "",
    namaProduk: "Almond Kacang",
    satuan: "pcs",
    kuantitas: 5,
    hargaSatuan: 1500,
    totalHarga: 7500,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    deletedAt: null,
  });

  beforeEach(() => reset({ products: [product] }));

  it("sets productId and leaves the paid price untouched", async () => {
    addPurchase(orphan());
    await flushWrites();
    const before = await db.audit.count();

    linkPurchaseProduct("b9", "p1");
    await flushWrites();

    const row = await db.purchases.get("b9");
    expect(row?.productId).toBe("p1");
    expect(row?.hargaSatuan).toBe(1500); // not the product's 2000
    expect(await db.audit.count()).toBe(before + 1);
  });

  it("ignores an unknown product id and re-linking the same one", async () => {
    addPurchase(orphan());
    linkPurchaseProduct("b9", "nope");
    await flushWrites();
    expect((await db.purchases.get("b9"))?.productId).toBe("");

    linkPurchaseProduct("b9", "p1");
    await flushWrites();
    const before = await db.audit.count();

    linkPurchaseProduct("b9", "p1");
    await flushWrites();
    expect(await db.audit.count()).toBe(before);
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

describe("addOrder modal snapshot", () => {
  it("stamps Harga Dasar × base units for the chosen unit", async () => {
    await reset({ products: [product] });
    addOrder(order({ satuan: "box", kuantitas: 1 }));
    await flushWrites();
    expect((await db.orders.get("o1"))?.modalSatuan).toBe(24000); // 12 × 2000
  });

  it("keeps the snapshot when Harga Dasar changes afterwards", async () => {
    await reset({ products: [product] });
    addOrder(order());
    upsertProduct({ ...product, hargaDasar: 3000 });
    await flushWrites();
    expect((await db.orders.get("o1"))?.modalSatuan).toBe(2000);
  });

  it("leaves it null when Harga Dasar is not filled in", async () => {
    await reset({ products: [{ ...product, hargaDasar: 0 }] });
    addOrder(order());
    await flushWrites();
    expect((await db.orders.get("o1"))?.modalSatuan).toBeNull();
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

describe("upsertBuyer", () => {
  beforeEach(() => reset());

  it("persists a new buyer with a create audit entry", async () => {
    upsertBuyer(buyer());
    await flushWrites();

    expect((await db.buyers.get("b1"))?.nama).toBe("Bu Ani");
    expect(getBuyers()).toHaveLength(1);

    const entries = await db.audit.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entity: "buyer",
      entityId: "b1",
      action: "create",
    });
  });

  it("updates in place, keeps createdAt, and logs a field-level diff", async () => {
    // Renaming is the whole reason buyers are a table with an id rather than a
    // name-keyed row: the orders pointing at "b1" must survive it.
    await reset({ buyers: [buyer()] });

    upsertBuyer(buyer({ nama: "Ibu Ani Warung Kopi", telepon: "081211112222" }));
    await flushWrites();

    expect(await db.buyers.count()).toBe(1);
    const row = await db.buyers.get("b1");
    expect(row?.nama).toBe("Ibu Ani Warung Kopi");
    expect(row?.createdAt).toBe("2026-07-10T00:00:00.000Z");
    expect(row?.updatedAt).not.toBe("2026-07-10T00:00:00.000Z");

    const entries = await db.audit.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe("update");
    expect(entries[0].changes).toEqual(
      expect.arrayContaining([
        { field: "nama", from: "Bu Ani", to: "Ibu Ani Warung Kopi" },
        { field: "telepon", from: "081200000000", to: "081211112222" },
      ]),
    );
  });
});

describe("deleteBuyer", () => {
  beforeEach(() => reset({ products: [product], buyers: [buyer()] }));

  it("tombstones the buyer and leaves their orders pointing at it", async () => {
    // Deliberately NOT a cascade (plan.md §1). Losing which sales belonged to
    // whom because a contact was tidied up is worse than a dangling id, which
    // the UI resolves to "(pembeli dihapus)".
    addOrder(order({ buyerId: "b1" }));
    await flushWrites();

    deleteBuyer("b1");
    await flushWrites();

    expect(getBuyers()).toHaveLength(0);
    expect((await db.buyers.get("b1"))?.deletedAt).toBeTruthy();
    expect((await db.buyers.get("b1"))?.nama).toBe("Bu Ani");

    expect((await db.orders.get("o1"))?.buyerId).toBe("b1");
    expect(getOrders()[0].buyerId).toBe("b1");
  });

  it("is a no-op for an unknown id", async () => {
    deleteBuyer("nope");
    await flushWrites();
    expect(getBuyers()).toHaveLength(1);
  });
});

describe("setOrderBuyer", () => {
  beforeEach(() => reset({ products: [product], buyers: [buyer()] }));

  it("persists the buyer with an audit entry", async () => {
    addOrder(order());
    await flushWrites();
    const before = await db.audit.count();

    setOrderBuyer("o1", "b1");
    await flushWrites();

    expect((await db.orders.get("o1"))?.buyerId).toBe("b1");
    expect(await db.audit.count()).toBe(before + 1);
  });

  it("is a no-op when the buyer is unchanged", async () => {
    addOrder(order({ buyerId: "b1" }));
    await flushWrites();
    const before = await db.audit.count();

    setOrderBuyer("o1", "b1");
    await flushWrites();

    expect(await db.audit.count()).toBe(before);
  });

  it("ignores an unknown buyer id but accepts \"\" as a clear", async () => {
    addOrder(order({ buyerId: "b1" }));
    await flushWrites();

    setOrderBuyer("o1", "nope");
    await flushWrites();
    expect((await db.orders.get("o1"))?.buyerId).toBe("b1");

    // "" is the one non-existent id that is legal: it means "no buyer".
    setOrderBuyer("o1", "");
    await flushWrites();
    expect((await db.orders.get("o1"))?.buyerId).toBe("");
  });

  it("is a no-op for an unknown order id", async () => {
    setOrderBuyer("nope", "b1");
    await flushWrites();
    expect(await db.audit.count()).toBe(0);
  });
});

describe("bulk order edits", () => {
  beforeEach(() =>
    reset({ products: [product], buyers: [buyer(), buyer({ id: "b2" })] }),
  );

  it("stamps a status onto every selected row, one audit entry each", async () => {
    addOrder(order({ id: "o1" }));
    addOrder(order({ id: "o2" }));
    addOrder(order({ id: "o3" }));
    await flushWrites();
    const before = await db.audit.count();

    setOrdersStatus(new Set(["o1", "o3"]), "paid");
    await flushWrites();

    expect((await db.orders.get("o1"))?.status).toBe("paid");
    expect((await db.orders.get("o3"))?.status).toBe("paid");
    // Not selected, so untouched.
    expect((await db.orders.get("o2"))?.status).toBe("pending");
    expect(await db.audit.count()).toBe(before + 2);
  });

  it("skips rows already at the target status", async () => {
    addOrder(order({ id: "o1", status: "paid" }));
    addOrder(order({ id: "o2" }));
    await flushWrites();
    const before = await db.audit.count();

    setOrdersStatus(new Set(["o1", "o2"]), "paid");
    await flushWrites();

    // Only o2 changed, so only o2 is logged — a select-all over a mostly-paid
    // day must not fill Riwayat with no-op rewrites.
    expect(await db.audit.count()).toBe(before + 1);
  });

  it("stamps a buyer onto every selected row", async () => {
    addOrder(order({ id: "o1" }));
    addOrder(order({ id: "o2", buyerId: "b2" }));
    await flushWrites();

    setOrdersBuyer(new Set(["o1", "o2"]), "b1");
    await flushWrites();

    expect((await db.orders.get("o1"))?.buyerId).toBe("b1");
    // Reassignment, not just first assignment.
    expect((await db.orders.get("o2"))?.buyerId).toBe("b1");
  });

  it("rejects the whole batch on an unknown buyer id", async () => {
    addOrder(order({ id: "o1" }));
    addOrder(order({ id: "o2" }));
    await flushWrites();

    setOrdersBuyer(new Set(["o1", "o2"]), "nope");
    await flushWrites();

    expect((await db.orders.get("o1"))?.buyerId).toBe("");
    expect((await db.orders.get("o2"))?.buyerId).toBe("");
  });

  it("ignores ids that do not exist", async () => {
    addOrder(order({ id: "o1" }));
    await flushWrites();
    const before = await db.audit.count();

    setOrdersStatus(new Set(["o1", "ghost"]), "paid");
    await flushWrites();

    expect((await db.orders.get("o1"))?.status).toBe("paid");
    expect(await db.audit.count()).toBe(before + 1);
  });

  it("writes nothing when the selection is empty", async () => {
    addOrder(order({ id: "o1" }));
    await flushWrites();
    const before = await db.audit.count();

    setOrdersStatus(new Set(), "paid");
    setOrdersBuyer(new Set(), "b1");
    await flushWrites();

    expect(await db.audit.count()).toBe(before);
  });
});

describe("backfillOrderBuyer", () => {
  beforeEach(() =>
    reset({ products: [product], buyers: [buyer()], needsBuyerBackfill: true }),
  );

  it("writes every blank order, ONE audit entry, and the meta flag", async () => {
    addOrder(order({ id: "o1" }));
    addOrder(order({ id: "o2" }));
    addOrder(order({ id: "o3" }));
    await flushWrites();
    const before = await db.audit.count();

    backfillOrderBuyer("b1");
    await flushWrites();

    const rows = await db.orders.toArray();
    expect(rows.map((o) => o.buyerId)).toEqual(["b1", "b1", "b1"]);
    // Every row keeps its own trace of having changed, since the audit entry is
    // a summary and not a per-row record.
    expect(rows.every((o) => o.updatedAt !== "2026-07-15T00:00:00.000Z")).toBe(true);

    // The point of the whole function: 3 orders, ONE entry — not 3. The audit
    // log is the fastest-growing table and a 340-row backfill must not put 340
    // rows in Riwayat.
    expect(await db.audit.count()).toBe(before + 1);
    const buyerEntries = (await db.audit.toArray()).filter((a) => a.entity === "buyer");
    expect(buyerEntries).toHaveLength(1);
    expect(buyerEntries[0]).toMatchObject({ entityId: "b1", action: "update" });
    expect(buyerEntries[0].label).toContain("3 pesanan lama");

    expect((await db.meta.get(BUYER_BACKFILL_KEY))?.value).toBe(true);
  });

  it("fills blanks only and never overwrites an existing buyer", async () => {
    await reset({
      products: [product],
      buyers: [buyer(), buyer({ id: "b2", nama: "Pak Budi" })],
      needsBuyerBackfill: true,
    });
    addOrder(order({ id: "o1" }));
    addOrder(order({ id: "o2", buyerId: "b2" }));
    await flushWrites();

    backfillOrderBuyer("b1");
    await flushWrites();

    expect((await db.orders.get("o1"))?.buyerId).toBe("b1");
    expect((await db.orders.get("o2"))?.buyerId).toBe("b2");
    expect((await db.orders.get("o2"))?.updatedAt).toBe("2026-07-15T00:00:00.000Z");
  });

  it("ignores an unknown buyer id", async () => {
    addOrder(order());
    await flushWrites();
    const before = await db.audit.count();

    backfillOrderBuyer("nope");
    await flushWrites();

    expect((await db.orders.get("o1"))?.buyerId).toBe("");
    expect(await db.audit.count()).toBe(before);
    expect(await db.meta.get(BUYER_BACKFILL_KEY)).toBeUndefined();
  });

  it("is a no-op once the flag is already set", async () => {
    addOrder(order());
    await flushWrites();

    backfillOrderBuyer("b1");
    await flushWrites();
    const before = await db.audit.count();

    // The prompt is the only caller and it is terminal, so a second run has
    // nothing to answer — it must not append another summary entry. Without the
    // `buyerBackfillPending` guard this logged "… ke 0 pesanan lama" every time.
    backfillOrderBuyer("b1");
    await flushWrites();

    expect(await db.audit.count()).toBe(before);
    const buyerEntries = (await db.audit.toArray()).filter(
      (a) => a.entity === "buyer",
    );
    expect(buyerEntries).toHaveLength(1);
    expect((await db.orders.get("o1"))?.buyerId).toBe("b1");
  });
});

describe("local writes clear stale attribution", () => {
  beforeEach(() => reset());

  // `updatedBy` is stamped by the Worker from a verified Access token, so it is
  // only ever true of the last state the SERVER saw. A local edit makes it a
  // lie — the row changed, but the name is the previous editor's. These tests
  // pin the rule that a local write always leaves it null rather than stale.

  it("clears updatedBy but keeps createdBy when a product is edited", async () => {
    const synced: Product = {
      ...product,
      createdBy: "owner@example.com",
      updatedBy: "owner@example.com",
    };
    await reset({ products: [synced] });

    upsertProduct({ ...synced, hargaJual: 6000 });
    await flushWrites();

    const row = await db.products.get("p1");
    expect(row?.updatedBy).toBeNull();
    // The creator did not change, and the Worker COALESCEs it anyway.
    expect(row?.createdBy).toBe("owner@example.com");
    // In memory too — the UI reads the arrays, not the database.
    expect(getProducts()[0].updatedBy).toBeNull();
  });

  it("clears updatedBy on a soft delete", async () => {
    await reset({
      orders: [order({ createdBy: "owner@example.com", updatedBy: "owner@example.com" })],
    });

    deleteOrder("o1");
    await flushWrites();

    const row = await db.orders.get("o1");
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.updatedBy).toBeNull();
  });

  it("clears updatedBy on a bulk status change", async () => {
    await reset({ orders: [order({ updatedBy: "owner@example.com" })] });

    setOrdersStatus(new Set(["o1"]), "paid");
    await flushWrites();

    expect((await db.orders.get("o1"))?.updatedBy).toBeNull();
  });

  it("clears BOTH fields on a row created from an existing one", async () => {
    // A duplicate carries the source row's attribution through the spread onto
    // a brand-new id, which would credit the copy to whoever made the original.
    await reset();

    addOrder(order({ id: "o2", createdBy: "owner@example.com", updatedBy: "owner@example.com" }));
    await flushWrites();

    const row = await db.orders.get("o2");
    expect(row?.createdBy).toBeNull();
    expect(row?.updatedBy).toBeNull();
  });
});
