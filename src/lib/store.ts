import { useSyncExternalStore } from "react";
import type {
  Attribution,
  Product,
  OrderItem,
  OrderStatus,
  PurchaseItem,
  StockMovement,
  Buyer,
} from "./types";
import { nowISO, uid } from "./format";
import { logAudit, diff, auditRow } from "./audit";
import { modalCostFor } from "./purchaseFromOrder";
import { planOrderEdit, type OrderEdit, type OrderEditPlan } from "./orderEdit";
import { persist, touch, fresh, type Snapshot } from "./db";

// In-memory cache of the LIVE rows (deletedAt === null) held in D1. Filled at
// boot and refreshed by the poll via `hydrateStores()`; every read below is
// served from here, so the whole store API stays synchronous even though the
// data lives behind the network.
//
// Nothing here is durable. A mutation updates the array first (so the screen
// reacts at once) and hands the changed rows to `persist()`, which sends them to
// D1; if D1 refuses, the arrays are reloaded from the server. See db.ts.
let products: Product[] = [];
let orders: OrderItem[] = [];
let purchases: PurchaseItem[] = [];
let types: string[] = [];
let stock: StockMovement[] = [];
let buyers: Buyer[] = [];

// Fill the in-memory arrays from a boot snapshot. Called once, before render.
export function hydrateStores(snap: Snapshot): void {
  products = snap.products;
  orders = snap.orders;
  purchases = snap.purchases;
  types = snap.types;
  stock = snap.stock;
  buyers = snap.buyers;
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

// ---------- Soft delete ----------

// Stamp a row as deleted. The row is NOT removed: it stays in D1 with a
// `deletedAt`, and only leaves the in-memory arrays. See types.ts for why.
// A delete is a write like any other, so it goes through `touch` too: the row
// the server last saw was the live one, and whoever deleted it is not yet known
// to the server.
function tombstone<T extends Attribution & { deletedAt: string | null; updatedAt: string }>(
  row: T,
  now: string,
): T {
  return touch({ ...row, deletedAt: now }, now);
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
    persist("addType", (b) => {
      b.put("types", { nama: t });
      b.put("audit", entry);
    });
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
    const row: Product = touch({ ...p, createdAt: prev.createdAt, deletedAt: null }, now);
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

    persist("upsertProduct", (b) => {
      b.put("products", row);
      if (entry) b.put("audit", entry);
    });
  } else {
    const row: Product = fresh({ ...p, createdAt: now, updatedAt: now, deletedAt: null });
    products = [...products, row];
    emit();

    const entry = logAudit({
      entity: "product",
      entityId: p.id,
      action: "create",
      label: `Produk "${p.namaProduk}" dibuat`,
    });
    persist("upsertProduct", (b) => {
      b.put("products", row);
      b.put("audit", entry);
    });
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
  persist("deleteProduct", (b) => {
    b.put("products", row);
    b.put("audit", entry);
  });
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
    const row: Buyer = touch({ ...b, createdAt: prev.createdAt, deletedAt: null }, now);
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

    persist("upsertBuyer", (b) => {
      b.put("buyers", row);
      if (entry) b.put("audit", entry);
    });
  } else {
    const row: Buyer = fresh({ ...b, createdAt: now, updatedAt: now, deletedAt: null });
    buyers = [...buyers, row];
    emit();

    const entry = logAudit({
      entity: "buyer",
      entityId: b.id,
      action: "create",
      label: `Pembeli "${b.nama}" dibuat`,
    });
    persist("upsertBuyer", (b) => {
      b.put("buyers", row);
      b.put("audit", entry);
    });
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
  persist("deleteBuyer", (b) => {
    b.put("buyers", row);
    b.put("audit", entry);
  });
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
  // Resolve by productId first; fall back to name for legacy rows.
  const product =
    products.find((p) => p.id === item.productId) ??
    products.find((p) => p.namaProduk === item.namaProduk);
  const filled: OrderItem = fresh({
    ...item,
    // Harga Dasar 0 means "not filled in", not "free" — snapshotting it would
    // freeze a 100% margin onto the row, so it stays null and the report falls
    // back to whatever the price list says later.
    modalSatuan:
      item.modalSatuan ??
      (product && product.hargaDasar > 0 ? modalCostFor(product, item.satuan) : null),
    status: item.status ?? "pending",
    affectsStock: item.affectsStock ?? false,
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
    deletedAt: null,
  });
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
  persist("addOrder", (b) => {
    b.put("orders", filled);
    if (movement) b.put("stock", movement);
    b.putAll("audit", entries);
  });
}

// Preview of what saving an edit would move in stock, for the confirm dialog.
export function previewOrderEdit(
  id: string,
  edit: Partial<OrderEdit>,
): OrderEditPlan | null {
  const prev = orders.find((o) => o.id === id);
  return prev ? planOrderEdit(prev, edit, products, stock) : null;
}

// Edit every field of one order. The order, its sale movements and the audit
// entries commit in ONE transaction, for the same reason addOrder does: an
// order whose qty changed but whose movement did not would silently skew stock.
export function updateOrder(id: string, edit: Partial<OrderEdit>): void {
  const now = nowISO();
  const prev = orders.find((o) => o.id === id);
  if (!prev) return;
  // An unknown buyerId would render as "(pembeli dihapus)" forever.
  if (
    edit.buyerId !== undefined &&
    edit.buyerId !== "" &&
    !buyers.some((b) => b.id === edit.buyerId)
  ) {
    return;
  }
  const plan = planOrderEdit(prev, edit, products, stock);
  if (plan.changes.length === 0) return;

  const row = touch(plan.next, now);
  orders = orders.map((o) => (o.id === id ? row : o));
  const moved = plan.moves.map((m) => touch(m.next, now));
  if (moved.length > 0) {
    const byId = new Map(moved.map((m) => [m.id, m] as const));
    stock = stock.map((m) => byId.get(m.id) ?? m);
  }
  emit();

  const entries = [
    logAudit({
      entity: "order",
      entityId: id,
      action: "update",
      label: `${prev.namaProduk}: diubah (${plan.changes.map((c) => c.field).join(", ")})`,
      changes: plan.changes,
    }),
    ...plan.moves.map((m) =>
      logAudit({
        entity: "stock",
        entityId: m.prev.id,
        action: "update",
        label: `Stok ${prev.namaProduk}: ${m.prev.qty} → ${m.next.qty} (ikut ubah pesanan)`,
        changes: diff(m.prev, m.next, ["tanggal", "productId", "qty", "satuan"]),
      }),
    ),
  ];
  persist("updateOrder", (b) => {
    b.put("orders", row);
    if (moved.length > 0) b.putAll("stock", moved);
    b.putAll("audit", entries);
  });
}

export function setOrderStatus(id: string, status: OrderStatus): void {
  setOrdersStatus(new Set([id]), status);
}

// Set the status on many rows at once, in one transaction. Rows already at
// `status` are skipped rather than rewritten, so a select-all over a mostly-paid
// day writes (and logs) only what actually changes.
//
// One audit entry per row, unlike backfillOrderBuyer's single summary: the
// backfill is unbounded (it touches every legacy order), whereas this set is
// whatever a human ticked, so the log stays readable and each row keeps a
// reversible record of its own before/after.
export function setOrdersStatus(ids: Set<string>, status: OrderStatus): void {
  const now = nowISO();
  const targets = orders.filter((o) => ids.has(o.id) && o.status !== status);
  if (targets.length === 0) return;

  const rows = targets.map((o) => touch({ ...o, status }, now));
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  orders = orders.map((o) => byId.get(o.id) ?? o);
  emit();

  const entries = targets.map((prev) =>
    logAudit({
      entity: "order",
      entityId: prev.id,
      action: "update",
      label: `${prev.namaProduk}: status ${prev.status} → ${status}`,
      changes: [{ field: "status", from: prev.status, to: status }],
    }),
  );
  persist("setOrdersStatus", (b) => {
    b.putAll("orders", rows);
    b.putAll("audit", entries);
  });
}

// Attach a legacy order row (productId "") to an existing product. Only the
// link changes: namaProduk, satuan and the prices stay as sold, because they
// are the historical record of that sale, not a stale copy of the product.
export function linkOrderProduct(id: string, productId: string): void {
  const now = nowISO();
  const prev = orders.find((o) => o.id === id);
  const product = products.find((p) => p.id === productId);
  if (!prev || !product || prev.productId === productId) return;

  const row: OrderItem = touch({ ...prev, productId }, now);
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
  persist("linkOrderProduct", (b) => {
    b.put("orders", row);
    b.put("audit", entry);
  });
}

// Assign (or clear, with "") the buyer on a single order row. Nothing else
// changes — the sold name and prices are the record of that sale.
export function setOrderBuyer(id: string, buyerId: string): void {
  setOrdersBuyer(new Set([id]), buyerId);
}

// The bulk form of the above. Same validity rule, checked once for the whole
// call: an unknown buyerId rejects the entire batch rather than half of it.
export function setOrdersBuyer(ids: Set<string>, buyerId: string): void {
  const now = nowISO();
  // An unknown id would render as "(pembeli dihapus)" forever; "" is the one
  // non-existent id that is legal, because it means "no buyer".
  if (buyerId !== "" && !buyers.some((b) => b.id === buyerId)) return;

  const targets = orders.filter((o) => ids.has(o.id) && o.buyerId !== buyerId);
  if (targets.length === 0) return;

  const rows = targets.map((o) => touch({ ...o, buyerId }, now));
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  orders = orders.map((o) => byId.get(o.id) ?? o);
  emit();

  const name = buyers.find((b) => b.id === buyerId)?.nama;
  const entries = targets.map((prev) =>
    logAudit({
      entity: "order",
      entityId: prev.id,
      action: "update",
      label: name
        ? `${prev.namaProduk}: pembeli → ${name}`
        : `${prev.namaProduk}: pembeli dikosongkan`,
      changes: [{ field: "buyerId", from: prev.buyerId, to: buyerId }],
    }),
  );
  persist("setOrdersBuyer", (b) => {
    b.putAll("orders", rows);
    b.putAll("audit", entries);
  });
}

// Same as linkOrderProduct, for the identical orphan case on purchases. Also
// link-only: the purchase price is what was actually paid, not a copy of the
// product's current hargaDasar.
export function linkPurchaseProduct(id: string, productId: string): void {
  const now = nowISO();
  const prev = purchases.find((p) => p.id === id);
  const product = products.find((p) => p.id === productId);
  if (!prev || !product || prev.productId === productId) return;

  const row: PurchaseItem = touch({ ...prev, productId }, now);
  purchases = purchases.map((p) => (p.id === id ? row : p));
  emit();

  const entry = logAudit({
    entity: "purchase",
    entityId: id,
    action: "update",
    label: `${prev.namaProduk}: ditautkan ke produk ${product.namaProduk}`,
    changes: [{ field: "productId", from: prev.productId, to: productId }],
  });
  persist("linkPurchaseProduct", (b) => {
    b.put("purchases", row);
    b.put("audit", entry);
  });
}

export function deleteOrder(id: string, opts?: DeleteOrderOptions): void {
  deleteOrders(new Set([id]), opts);
}

export interface DeleteOrderOptions {
  // Also cancel the Beli Stok purchases that were bought FOR these orders (and
  // the stock they added). Off by default: the purchase is a real buy that
  // happened, so deleting only the order must leave it standing.
  cancelPurchases?: boolean;
}

// What deleting these orders would touch, for the confirm dialog. Purchases are
// only listed when every order linked to them is in `ids`; a purchase that also
// feeds a surviving order is never cancelled.
export function orderDeleteImpact(ids: Set<string>): {
  orders: number;
  movements: number;
  purchases: PurchaseItem[];
} {
  const doomedOrders = orders.filter((o) => ids.has(o.id));
  const saleMoves = stock.filter((m) => m.orderId && ids.has(m.orderId));
  const linked = new Set(
    saleMoves.map((m) => m.purchaseId).filter((p): p is string => !!p),
  );
  const shared = new Set(
    stock
      .filter((m) => m.purchaseId && m.orderId && !ids.has(m.orderId))
      .map((m) => m.purchaseId as string),
  );
  return {
    orders: doomedOrders.length,
    movements: saleMoves.length,
    purchases: purchases.filter((p) => linked.has(p.id) && !shared.has(p.id)),
  };
}

// Soft-delete orders and cascade to the stock movements they generated, in one
// transaction. The cascade is why this must be atomic: a half-applied delete
// leaves orphaned movements that silently corrupt every stock aggregate.
export function deleteOrders(ids: Set<string>, opts: DeleteOrderOptions = {}): void {
  const now = nowISO();
  const doomedOrders = orders.filter((o) => ids.has(o.id));
  if (doomedOrders.length === 0) return;
  const doomedPurchases = opts.cancelPurchases
    ? orderDeleteImpact(ids).purchases
    : [];
  const purchaseIds = new Set(doomedPurchases.map((p) => p.id));
  const doomedStock = stock.filter(
    (m) =>
      (m.orderId && ids.has(m.orderId)) ||
      (m.purchaseId && purchaseIds.has(m.purchaseId)),
  );
  const doomedStockIds = new Set(doomedStock.map((m) => m.id));

  const orderRows = doomedOrders.map((o) => tombstone(o, now));
  const purchaseRows = doomedPurchases.map((p) => tombstone(p, now));
  const stockRows = doomedStock.map((m) => tombstone(m, now));

  orders = orders.filter((o) => !ids.has(o.id));
  if (purchaseIds.size > 0) {
    purchases = purchases.filter((p) => !purchaseIds.has(p.id));
  }
  if (doomedStock.length > 0) {
    stock = stock.filter((m) => !doomedStockIds.has(m.id));
  }
  emit();

  const bulk = doomedOrders.length > 1;
  const entries = [
    ...doomedOrders.map((o) =>
      logAudit({
        entity: "order",
        entityId: o.id,
        action: "delete",
        label: bulk ? `Pesanan dihapus (massal)` : `Pesanan ${o.namaProduk} dihapus`,
      }),
    ),
    ...doomedPurchases.map((p) =>
      logAudit({
        entity: "purchase",
        entityId: p.id,
        action: "delete",
        label: `Beli Stok ${p.namaProduk} dibatalkan bersama pesanan`,
      }),
    ),
  ];

  persist("deleteOrders", (b) => {
    b.putAll("orders", orderRows);
    if (purchaseRows.length > 0) b.putAll("purchases", purchaseRows);
    if (stockRows.length > 0) b.putAll("stock", stockRows);
    b.putAll("audit", entries);
  });
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
  const filled: PurchaseItem = fresh({
    ...item,
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
    deletedAt: null,
  });
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
  persist("addPurchase", (b) => {
    b.put("purchases", filled);
    if (movements.length > 0) b.putAll("stock", movements);
    b.putAll("audit", entries);
  });
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

  persist("deletePurchases", (b) => {
    b.putAll("purchases", purchaseRows);
    if (stockRows.length > 0) b.putAll("stock", stockRows);
    b.putAll("audit", entries);
  });
}

// ---------- Stock mutations ----------

export function addMovement(m: StockMovement): void {
  const now = nowISO();
  const row: StockMovement = fresh({
    ...m,
    createdAt: m.createdAt ?? now,
    updatedAt: m.updatedAt ?? now,
    deletedAt: null,
  });
  stock = [...stock, row];
  emit();

  const entry = auditRow(row, products);
  persist("addMovement", (b) => {
    b.put("stock", row);
    b.put("audit", entry);
  });
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
  persist("deleteMovement", (b) => {
    b.put("stock", row);
    b.put("audit", entry);
  });
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
