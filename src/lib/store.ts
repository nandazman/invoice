import { useSyncExternalStore } from "react";
import type {
  Product,
  OrderItem,
  OrderStatus,
  PurchaseItem,
  StockMovement,
  Buyer,
} from "./types";
import { nowISO, uid } from "./format";
import { logAudit, diff, auditRow } from "./audit";
import { db, persist, BUYER_BACKFILL_KEY, type Snapshot } from "./db";

// In-memory mirror of the LIVE rows (deletedAt === null). Filled once by
// `hydrateStores()` at boot; every read below is served from here, so the whole
// store API stays synchronous even though IndexedDB is async-only.
//
// Writes are per-row: a mutation puts ONE record, never the table. That is the
// invariant this module exists to hold — write cost tracks the row, not the
// table size.
let products: Product[] = [];
let orders: OrderItem[] = [];
let purchases: PurchaseItem[] = [];
let types: string[] = [];
let stock: StockMovement[] = [];
let buyers: Buyer[] = [];

// Whether the one-time "which pembeli owns your existing orders?" prompt still
// needs answering. Mirrors a `meta` row; see db.ts BUYER_BACKFILL_KEY.
let buyerBackfillPending = false;

// Fill the in-memory arrays from a boot snapshot. Called once, before render.
export function hydrateStores(snap: Snapshot): void {
  products = snap.products;
  orders = snap.orders;
  purchases = snap.purchases;
  types = snap.types;
  stock = snap.stock;
  buyers = snap.buyers;
  buyerBackfillPending = snap.needsBuyerBackfill;
  emit();
}

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

export function useProducts(): Product[] {
  return useSyncExternalStore(subscribe, () => products);
}
export function useOrders(): OrderItem[] {
  return useSyncExternalStore(subscribe, () => orders);
}
export function usePurchases(): PurchaseItem[] {
  return useSyncExternalStore(subscribe, () => purchases);
}
export function useTypes(): string[] {
  return useSyncExternalStore(subscribe, () => types);
}
export function useStock(): StockMovement[] {
  return useSyncExternalStore(subscribe, () => stock);
}
export function useBuyers(): Buyer[] {
  return useSyncExternalStore(subscribe, () => buyers);
}
export function useBuyerBackfillPending(): boolean {
  return useSyncExternalStore(subscribe, () => buyerBackfillPending);
}

// ---------- Soft delete ----------

// Stamp a row as deleted. The row is NOT removed: it stays in IndexedDB with a
// `deletedAt`, and only leaves the in-memory arrays. See types.ts for why.
function tombstone<T extends { deletedAt: string | null; updatedAt: string }>(
  row: T,
  now: string,
): T {
  return { ...row, deletedAt: now, updatedAt: now };
}

// ---------- Bulk replace (JSON import + backup restore) ----------
//
// These are the ONLY whole-table writes left, and they are correct here: the
// caller is replacing the entire dataset, so the cost genuinely is O(table).
// `clear()` drops tombstones too — a restore is an authoritative replacement,
// not a merge.

export function setProducts(next: Product[]): void {
  products = next;
  emit();
  persist("setProducts", () =>
    db.transaction("rw", db.products, async () => {
      await db.products.clear();
      await db.products.bulkPut(next);
    }),
  );
}
export function setOrders(next: OrderItem[]): void {
  orders = next;
  emit();
  persist("setOrders", () =>
    db.transaction("rw", db.orders, async () => {
      await db.orders.clear();
      await db.orders.bulkPut(next);
    }),
  );
}
export function setPurchases(next: PurchaseItem[]): void {
  purchases = next;
  emit();
  persist("setPurchases", () =>
    db.transaction("rw", db.purchases, async () => {
      await db.purchases.clear();
      await db.purchases.bulkPut(next);
    }),
  );
}
export function setStock(next: StockMovement[]): void {
  stock = next;
  emit();
  persist("setStock", () =>
    db.transaction("rw", db.stock, async () => {
      await db.stock.clear();
      await db.stock.bulkPut(next);
    }),
  );
}
export function setBuyers(next: Buyer[]): void {
  buyers = next;
  emit();
  persist("setBuyers", () =>
    db.transaction("rw", db.buyers, async () => {
      await db.buyers.clear();
      await db.buyers.bulkPut(next);
    }),
  );
}
export function setTypes(next: string[]): void {
  types = [...next].sort((a, b) => a.localeCompare(b));
  emit();
  const rows = types.map((nama) => ({ nama }));
  persist("setTypes", () =>
    db.transaction("rw", db.types, async () => {
      await db.types.clear();
      await db.types.bulkPut(rows);
    }),
  );
}

// Add a type if new, persist, and notify. Returns the trimmed name.
export function addType(name: string): string {
  const t = name.trim();
  if (t && !types.some((x) => x.toLowerCase() === t.toLowerCase())) {
    types = [...types, t].sort((a, b) => a.localeCompare(b));
    emit();
    const entry = logAudit({
      entity: "type",
      entityId: t,
      action: "create",
      label: `Tipe "${t}" ditambahkan`,
    });
    persist("addType", () =>
      db.transaction("rw", db.types, db.audit, async () => {
        await db.types.put({ nama: t });
        await db.audit.put(entry);
      }),
    );
  }
  return t;
}

// Fields worth diffing when a product is updated, with human labels.
const PRODUCT_FIELDS: (keyof Product)[] = [
  "namaProduk",
  "tipe",
  "ukuran",
  "satuan",
  "hargaDasar",
  "hargaJual",
  "stokMin",
];

// ---------- Timestamp-aware product mutations ----------

// Insert or update a product, stamping createdAt/updatedAt automatically.
export function upsertProduct(p: Product): void {
  const now = nowISO();
  const prev = products.find((x) => x.id === p.id);

  if (prev) {
    const row: Product = {
      ...p,
      createdAt: prev.createdAt,
      updatedAt: now,
      deletedAt: null,
    };
    products = products.map((x) => (x.id === p.id ? row : x));
    emit();

    const changes = diff(prev, p, PRODUCT_FIELDS);
    const entry =
      changes.length > 0
        ? logAudit({
            entity: "product",
            entityId: p.id,
            action: "update",
            label: `${p.namaProduk}: ${changes
              .map((c) => `${c.field} ${c.from} → ${c.to}`)
              .join(", ")}`,
            changes,
          })
        : null;

    persist("upsertProduct", () =>
      db.transaction("rw", db.products, db.audit, async () => {
        await db.products.put(row);
        if (entry) await db.audit.put(entry);
      }),
    );
  } else {
    const row: Product = { ...p, createdAt: now, updatedAt: now, deletedAt: null };
    products = [...products, row];
    emit();

    const entry = logAudit({
      entity: "product",
      entityId: p.id,
      action: "create",
      label: `Produk "${p.namaProduk}" dibuat`,
    });
    persist("upsertProduct", () =>
      db.transaction("rw", db.products, db.audit, async () => {
        await db.products.put(row);
        await db.audit.put(entry);
      }),
    );
  }
}

export function deleteProduct(id: string): void {
  const now = nowISO();
  const prev = products.find((p) => p.id === id);
  if (!prev) return;

  const row = tombstone(prev, now);
  products = products.filter((p) => p.id !== id);
  emit();

  const entry = logAudit({
    entity: "product",
    entityId: id,
    action: "delete",
    label: `Produk "${prev.namaProduk}" dihapus`,
  });
  persist("deleteProduct", () =>
    db.transaction("rw", db.products, db.audit, async () => {
      await db.products.put(row);
      await db.audit.put(entry);
    }),
  );
}

// ---------- Timestamp-aware buyer mutations ----------

// Fields worth diffing when a buyer is updated.
const BUYER_FIELDS: (keyof Buyer)[] = [
  "nama",
  "telepon",
  "email",
  "alamat",
  "catatan",
];

export function upsertBuyer(b: Buyer): void {
  const now = nowISO();
  const prev = buyers.find((x) => x.id === b.id);

  if (prev) {
    const row: Buyer = {
      ...b,
      createdAt: prev.createdAt,
      updatedAt: now,
      deletedAt: null,
    };
    buyers = buyers.map((x) => (x.id === b.id ? row : x));
    emit();

    const changes = diff(prev, b, BUYER_FIELDS);
    const entry =
      changes.length > 0
        ? logAudit({
            entity: "buyer",
            entityId: b.id,
            action: "update",
            label: `${b.nama}: ${changes
              .map((c) => `${c.field} ${c.from} → ${c.to}`)
              .join(", ")}`,
            changes,
          })
        : null;

    persist("upsertBuyer", () =>
      db.transaction("rw", db.buyers, db.audit, async () => {
        await db.buyers.put(row);
        if (entry) await db.audit.put(entry);
      }),
    );
  } else {
    const row: Buyer = { ...b, createdAt: now, updatedAt: now, deletedAt: null };
    buyers = [...buyers, row];
    emit();

    const entry = logAudit({
      entity: "buyer",
      entityId: b.id,
      action: "create",
      label: `Pembeli "${b.nama}" dibuat`,
    });
    persist("upsertBuyer", () =>
      db.transaction("rw", db.buyers, db.audit, async () => {
        await db.buyers.put(row);
        await db.audit.put(entry);
      }),
    );
  }
}

// Soft-delete a buyer. Deliberately does NOT cascade to their orders: those
// keep their `buyerId` and render as "(pembeli dihapus)". Losing which sales
// belonged to whom because a contact was tidied up is worse than a dangling id,
// and dangling entityIds are already an accepted shape here (types.ts).
export function deleteBuyer(id: string): void {
  const now = nowISO();
  const prev = buyers.find((b) => b.id === id);
  if (!prev) return;

  const row = tombstone(prev, now);
  buyers = buyers.filter((b) => b.id !== id);
  emit();

  const entry = logAudit({
    entity: "buyer",
    entityId: id,
    action: "delete",
    label: `Pembeli "${prev.nama}" dihapus`,
  });
  persist("deleteBuyer", () =>
    db.transaction("rw", db.buyers, db.audit, async () => {
      await db.buyers.put(row);
      await db.audit.put(entry);
    }),
  );
}

// ---------- Timestamp-aware order mutations ----------

// How many BASE units one `satuan` label represents for a product (base unit = 1,
// otherwise the matching konversi's `jumlah`; unknown labels fall back to 1).
function baseUnitsFor(product: Product, satuan: string): number {
  if (product.satuan && satuan === product.satuan) return 1;
  const conv = product.konversi.find((k) => k.nama === satuan);
  return conv ? conv.jumlah : 1;
}

// Add an order item, stamping status/timestamps if not already set. When
// `affectsStock` is set, also record a matching `sale` movement that DEDUCTS
// the ordered quantity (converted to base units) from stock — a customer order
// consumes inventory. FIFO consumes existing purchase layers (hargaModal null).
//
// The order, its movement, and both audit entries commit in ONE transaction:
// under localStorage these were three unrelated writes, so a crash between them
// left an order with no movement, silently.
export function addOrder(item: OrderItem): void {
  const now = nowISO();
  const filled: OrderItem = {
    ...item,
    status: item.status ?? "pending",
    affectsStock: item.affectsStock ?? false,
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
    deletedAt: null,
  };
  orders = [...orders, filled];

  const entries = [
    logAudit({
      entity: "order",
      entityId: filled.id,
      action: "create",
      label: `Pesanan: ${filled.kuantitas} ${filled.satuan} ${filled.namaProduk}`,
    }),
  ];

  let movement: StockMovement | null = null;
  if (filled.affectsStock) {
    // Resolve by productId first; fall back to name for legacy rows.
    const product =
      products.find((p) => p.id === filled.productId) ??
      products.find((p) => p.namaProduk === filled.namaProduk);
    if (product) {
      const baseQty = filled.kuantitas * baseUnitsFor(product, filled.satuan);
      movement = {
        id: uid(),
        productId: product.id,
        tanggal: filled.tanggal,
        qty: -Math.abs(baseQty),
        satuan: product.satuan ?? "",
        reason: "sale",
        hargaModal: null,
        orderId: filled.id,
        purchaseId: null,
        note: "dari pesanan",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      stock = [...stock, movement];
      entries.push(auditRow(movement, products));
    }
  }

  emit();
  persist("addOrder", () =>
    db.transaction("rw", db.orders, db.stock, db.audit, async () => {
      await db.orders.put(filled);
      if (movement) await db.stock.put(movement);
      await db.audit.bulkPut(entries);
    }),
  );
}

export function setOrderStatus(id: string, status: OrderStatus): void {
  const now = nowISO();
  const prev = orders.find((o) => o.id === id);
  if (!prev || prev.status === status) return;

  const row: OrderItem = { ...prev, status, updatedAt: now };
  orders = orders.map((o) => (o.id === id ? row : o));
  emit();

  const entry = logAudit({
    entity: "order",
    entityId: id,
    action: "update",
    label: `${prev.namaProduk}: status ${prev.status} → ${status}`,
    changes: [{ field: "status", from: prev.status, to: status }],
  });
  persist("setOrderStatus", () =>
    db.transaction("rw", db.orders, db.audit, async () => {
      await db.orders.put(row);
      await db.audit.put(entry);
    }),
  );
}

// Attach a legacy order row (productId "") to an existing product. Only the
// link changes: namaProduk, satuan and the prices stay as sold, because they
// are the historical record of that sale, not a stale copy of the product.
export function linkOrderProduct(id: string, productId: string): void {
  const now = nowISO();
  const prev = orders.find((o) => o.id === id);
  const product = products.find((p) => p.id === productId);
  if (!prev || !product || prev.productId === productId) return;

  const row: OrderItem = { ...prev, productId, updatedAt: now };
  orders = orders.map((o) => (o.id === id ? row : o));
  emit();

  const entry = logAudit({
    entity: "order",
    entityId: id,
    action: "update",
    label: `${prev.namaProduk}: ditautkan ke produk ${product.namaProduk}`,
    changes: [
      { field: "productId", from: prev.productId, to: productId },
    ],
  });
  persist("linkOrderProduct", () =>
    db.transaction("rw", db.orders, db.audit, async () => {
      await db.orders.put(row);
      await db.audit.put(entry);
    }),
  );
}

// Assign (or clear, with "") the buyer on a single order row. Nothing else
// changes — the sold name and prices are the record of that sale.
export function setOrderBuyer(id: string, buyerId: string): void {
  const now = nowISO();
  const prev = orders.find((o) => o.id === id);
  if (!prev || prev.buyerId === buyerId) return;
  // An unknown id would render as "(pembeli dihapus)" forever; "" is the one
  // non-existent id that is legal, because it means "no buyer".
  if (buyerId !== "" && !buyers.some((b) => b.id === buyerId)) return;

  const row: OrderItem = { ...prev, buyerId, updatedAt: now };
  orders = orders.map((o) => (o.id === id ? row : o));
  emit();

  const name = buyers.find((b) => b.id === buyerId)?.nama;
  const entry = logAudit({
    entity: "order",
    entityId: id,
    action: "update",
    label: name
      ? `${prev.namaProduk}: pembeli → ${name}`
      : `${prev.namaProduk}: pembeli dikosongkan`,
    changes: [{ field: "buyerId", from: prev.buyerId, to: buyerId }],
  });
  persist("setOrderBuyer", () =>
    db.transaction("rw", db.orders, db.audit, async () => {
      await db.orders.put(row);
      await db.audit.put(entry);
    }),
  );
}

// The one-time backfill: stamp `buyerId` onto every existing order that has
// none, and record that the prompt has been answered. See plan.md §3.
//
// ONE audit entry, whatever N is — the log is the fastest-growing table and a
// 340-row backfill must not put 340 rows in Riwayat. `updatedAt` is bumped per
// row instead, so each row keeps its own trace of having changed.
// The single definition of "this order still needs a buyer". The backfill and
// the prompt that counts what it is about to affect both read it, so the rule
// cannot drift between what the dialog promises and what the write does.
export function needsBuyer(o: OrderItem): boolean {
  return !o.buyerId;
}

export function backfillOrderBuyer(buyerId: string): void {
  // The prompt is the only caller, and it is asked once. Without this guard a
  // second call still appends an audit entry ("… ke 0 pesanan lama") and
  // rewrites the flag, so the operation is not idempotent.
  if (!buyerBackfillPending) return;

  const buyer = buyers.find((b) => b.id === buyerId);
  if (!buyer) return;

  const now = nowISO();
  // Fills blanks only; an order that somehow already has a buyer is left alone.
  const targets = orders.filter(needsBuyer);
  const rows = targets.map((o) => ({ ...o, buyerId, updatedAt: now }));

  const byId = new Map(rows.map((r) => [r.id, r]));
  orders = orders.map((o) => byId.get(o.id) ?? o);
  buyerBackfillPending = false;
  emit();

  const entry = logAudit({
    entity: "buyer",
    entityId: buyerId,
    action: "update",
    label: `Pembeli "${buyer.nama}" diterapkan ke ${rows.length} pesanan lama`,
  });

  // One transaction: a half-applied backfill that still stamped the flag would
  // be unrepeatable, because the prompt is the only thing that offers to do it.
  persist("backfillOrderBuyer", () =>
    db.transaction("rw", db.orders, db.audit, db.meta, async () => {
      if (rows.length > 0) await db.orders.bulkPut(rows);
      await db.audit.put(entry);
      await db.meta.put({ key: BUYER_BACKFILL_KEY, value: true });
    }),
  );
}

// Answer the backfill prompt with "not for these orders". Writes the flag and
// nothing else, so it is never asked again.
export function dismissBuyerBackfill(): void {
  if (!buyerBackfillPending) return;
  buyerBackfillPending = false;
  emit();
  persist("dismissBuyerBackfill", () =>
    db.meta.put({ key: BUYER_BACKFILL_KEY, value: true }),
  );
}

// Same as linkOrderProduct, for the identical orphan case on purchases. Also
// link-only: the purchase price is what was actually paid, not a copy of the
// product's current hargaDasar.
export function linkPurchaseProduct(id: string, productId: string): void {
  const now = nowISO();
  const prev = purchases.find((p) => p.id === id);
  const product = products.find((p) => p.id === productId);
  if (!prev || !product || prev.productId === productId) return;

  const row: PurchaseItem = { ...prev, productId, updatedAt: now };
  purchases = purchases.map((p) => (p.id === id ? row : p));
  emit();

  const entry = logAudit({
    entity: "purchase",
    entityId: id,
    action: "update",
    label: `${prev.namaProduk}: ditautkan ke produk ${product.namaProduk}`,
    changes: [{ field: "productId", from: prev.productId, to: productId }],
  });
  persist("linkPurchaseProduct", () =>
    db.transaction("rw", db.purchases, db.audit, async () => {
      await db.purchases.put(row);
      await db.audit.put(entry);
    }),
  );
}

export function deleteOrder(id: string): void {
  deleteOrders(new Set([id]));
}

// Soft-delete orders and cascade to the stock movements they generated, in one
// transaction. The cascade is why this must be atomic: a half-applied delete
// leaves orphaned movements that silently corrupt every stock aggregate.
export function deleteOrders(ids: Set<string>): void {
  const now = nowISO();
  const doomedOrders = orders.filter((o) => ids.has(o.id));
  if (doomedOrders.length === 0) return;
  const doomedStock = stock.filter((m) => m.orderId && ids.has(m.orderId));

  const orderRows = doomedOrders.map((o) => tombstone(o, now));
  const stockRows = doomedStock.map((m) => tombstone(m, now));

  orders = orders.filter((o) => !ids.has(o.id));
  if (doomedStock.length > 0) {
    stock = stock.filter((m) => !(m.orderId && ids.has(m.orderId)));
  }
  emit();

  const bulk = doomedOrders.length > 1;
  const entries = doomedOrders.map((o) =>
    logAudit({
      entity: "order",
      entityId: o.id,
      action: "delete",
      label: bulk ? `Pesanan dihapus (massal)` : `Pesanan ${o.namaProduk} dihapus`,
    }),
  );

  persist("deleteOrders", () =>
    db.transaction("rw", db.orders, db.stock, db.audit, async () => {
      await db.orders.bulkPut(orderRows);
      if (stockRows.length > 0) await db.stock.bulkPut(stockRows);
      await db.audit.bulkPut(entries);
    }),
  );
}

// ---------- Timestamp-aware purchase (Beli Stock) mutations ----------

// Add a Beli Stock line, stamping timestamps, and auto-create a linked
// `purchase` movement that ADDS the bought quantity (converted to base units)
// into stock, valued at the entered cost per base unit. One transaction.
// When `order` is given, also record a matching `sale` movement that offsets
// the bought quantity for that order.
export function addPurchase(
  item: PurchaseItem,
  note = "dari beli stok",
  order?: OrderItem,
): void {
  const now = nowISO();
  const filled: PurchaseItem = {
    ...item,
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
    deletedAt: null,
  };
  purchases = [...purchases, filled];

  const entries = [
    logAudit({
      entity: "purchase",
      entityId: filled.id,
      action: "create",
      label: `Beli Stok: ${filled.kuantitas} ${filled.satuan} ${filled.namaProduk}`,
    }),
  ];

  const movements: StockMovement[] = [];
  const product =
    products.find((p) => p.id === filled.productId) ??
    products.find((p) => p.namaProduk === filled.namaProduk);
  if (product) {
    const baseUnits = baseUnitsFor(product, filled.satuan);
    const baseQty = filled.kuantitas * baseUnits;
    const purchaseMovement: StockMovement = {
      id: uid(),
      productId: product.id,
      tanggal: filled.tanggal,
      qty: Math.abs(baseQty),
      satuan: product.satuan ?? "",
      reason: "purchase",
      hargaModal:
        baseUnits > 0 ? filled.hargaSatuan / baseUnits : filled.hargaSatuan,
      orderId: null,
      purchaseId: filled.id,
      note,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    movements.push(purchaseMovement);
    entries.push(auditRow(purchaseMovement, products));

    if (order) {
      const saleMovement: StockMovement = {
        id: uid(),
        productId: product.id,
        tanggal: filled.tanggal,
        qty: -Math.abs(baseQty),
        satuan: product.satuan ?? "",
        reason: "sale",
        hargaModal: null,
        orderId: order.id,
        purchaseId: filled.id,
        note: "penjualan dari pesanan (by order)",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      movements.push(saleMovement);
      entries.push(auditRow(saleMovement, products));
    }
  }

  if (movements.length > 0) stock = [...stock, ...movements];
  emit();
  persist("addPurchase", () =>
    db.transaction("rw", db.purchases, db.stock, db.audit, async () => {
      await db.purchases.put(filled);
      if (movements.length > 0) await db.stock.bulkPut(movements);
      await db.audit.bulkPut(entries);
    }),
  );
}

export function deletePurchase(id: string): void {
  deletePurchases(new Set([id]));
}

export function deletePurchases(ids: Set<string>): void {
  const now = nowISO();
  const doomedPurchases = purchases.filter((p) => ids.has(p.id));
  if (doomedPurchases.length === 0) return;
  const doomedStock = stock.filter((m) => m.purchaseId && ids.has(m.purchaseId));

  const purchaseRows = doomedPurchases.map((p) => tombstone(p, now));
  const stockRows = doomedStock.map((m) => tombstone(m, now));

  purchases = purchases.filter((p) => !ids.has(p.id));
  if (doomedStock.length > 0) {
    stock = stock.filter((m) => !(m.purchaseId && ids.has(m.purchaseId)));
  }
  emit();

  const bulk = doomedPurchases.length > 1;
  const entries = doomedPurchases.map((p) =>
    logAudit({
      entity: "purchase",
      entityId: p.id,
      action: "delete",
      label: bulk ? `Beli Stok dihapus (massal)` : `Beli Stok ${p.namaProduk} dihapus`,
    }),
  );

  persist("deletePurchases", () =>
    db.transaction("rw", db.purchases, db.stock, db.audit, async () => {
      await db.purchases.bulkPut(purchaseRows);
      if (stockRows.length > 0) await db.stock.bulkPut(stockRows);
      await db.audit.bulkPut(entries);
    }),
  );
}

// ---------- Stock mutations ----------

export function addMovement(m: StockMovement): void {
  const now = nowISO();
  const row: StockMovement = {
    ...m,
    createdAt: m.createdAt ?? now,
    updatedAt: m.updatedAt ?? now,
    deletedAt: null,
  };
  stock = [...stock, row];
  emit();

  const entry = auditRow(row, products);
  persist("addMovement", () =>
    db.transaction("rw", db.stock, db.audit, async () => {
      await db.stock.put(row);
      await db.audit.put(entry);
    }),
  );
}

export function deleteMovement(id: string): void {
  const now = nowISO();
  const prev = stock.find((m) => m.id === id);
  if (!prev) return;

  const row = tombstone(prev, now);
  stock = stock.filter((m) => m.id !== id);
  emit();

  const name =
    products.find((p) => p.id === prev.productId)?.namaProduk ?? prev.productId;
  const entry = logAudit({
    entity: "stock",
    entityId: id,
    action: "delete",
    label: `Pergerakan stok ${name} dihapus`,
  });
  persist("deleteMovement", () =>
    db.transaction("rw", db.stock, db.audit, async () => {
      await db.stock.put(row);
      await db.audit.put(entry);
    }),
  );
}

export function getProducts(): Product[] {
  return products;
}
export function getOrders(): OrderItem[] {
  return orders;
}
export function getPurchases(): PurchaseItem[] {
  return purchases;
}
export function getStock(): StockMovement[] {
  return stock;
}
export function getTypes(): string[] {
  return types;
}
export function getBuyers(): Buyer[] {
  return buyers;
}
