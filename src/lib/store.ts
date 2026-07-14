import { useSyncExternalStore } from "react";
import type {
  Product,
  OrderItem,
  OrderStatus,
  PurchaseItem,
  StockMovement,
} from "./types";
import { nowISO, uid } from "./format";
import { logAudit, diff } from "./audit";
import {
  loadProducts,
  saveProducts,
  loadOrders,
  saveOrders,
  loadPurchases,
  savePurchases,
  loadTypes,
  saveTypes,
  loadStock,
  saveStock,
} from "./storage";

let products: Product[] = loadProducts();
let orders: OrderItem[] = loadOrders();
let purchases: PurchaseItem[] = loadPurchases();
let types: string[] = loadTypes();
let stock: StockMovement[] = loadStock();

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

export function setProducts(next: Product[]): void {
  products = next;
  saveProducts(next);
  emit();
}
export function setOrders(next: OrderItem[]): void {
  orders = next;
  saveOrders(next);
  emit();
}
export function setPurchases(next: PurchaseItem[]): void {
  purchases = next;
  savePurchases(next);
  emit();
}
export function setStock(next: StockMovement[]): void {
  stock = next;
  saveStock(next);
  emit();
}

// Add a type if new, persist, and notify. Returns the trimmed name.
export function addType(name: string): string {
  const t = name.trim();
  if (t && !types.some((x) => x.toLowerCase() === t.toLowerCase())) {
    types = [...types, t].sort((a, b) => a.localeCompare(b));
    saveTypes(types);
    emit();
    logAudit({
      entity: "type",
      entityId: t,
      action: "create",
      label: `Tipe "${t}" ditambahkan`,
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
    setProducts(
      products.map((x) =>
        x.id === p.id ? { ...p, createdAt: x.createdAt, updatedAt: now } : x,
      ),
    );
    const changes = diff(prev, p, PRODUCT_FIELDS);
    if (changes.length > 0) {
      logAudit({
        entity: "product",
        entityId: p.id,
        action: "update",
        label: `${p.namaProduk}: ${changes
          .map((c) => `${c.field} ${c.from} → ${c.to}`)
          .join(", ")}`,
        changes,
      });
    }
  } else {
    setProducts([...products, { ...p, createdAt: now, updatedAt: now }]);
    logAudit({
      entity: "product",
      entityId: p.id,
      action: "create",
      label: `Produk "${p.namaProduk}" dibuat`,
    });
  }
}

export function deleteProduct(id: string): void {
  const prev = products.find((p) => p.id === id);
  setProducts(products.filter((p) => p.id !== id));
  logAudit({
    entity: "product",
    entityId: id,
    action: "delete",
    label: `Produk "${prev?.namaProduk ?? id}" dihapus`,
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
export function addOrder(item: OrderItem): void {
  const now = nowISO();
  const filled: OrderItem = {
    ...item,
    status: item.status ?? "pending",
    affectsStock: item.affectsStock ?? false,
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
  };
  setOrders([...orders, filled]);
  logAudit({
    entity: "order",
    entityId: filled.id,
    action: "create",
    label: `Pesanan: ${filled.kuantitas} ${filled.satuan} ${filled.namaProduk}`,
  });

  if (filled.affectsStock) {
    // Resolve by productId first; fall back to name for legacy rows.
    const product =
      products.find((p) => p.id === filled.productId) ??
      products.find((p) => p.namaProduk === filled.namaProduk);
    if (product) {
      const baseQty = filled.kuantitas * baseUnitsFor(product, filled.satuan);
      addMovement({
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
      });
    }
  }
}

export function setOrderStatus(id: string, status: OrderStatus): void {
  const now = nowISO();
  const prev = orders.find((o) => o.id === id);
  setOrders(
    orders.map((o) => (o.id === id ? { ...o, status, updatedAt: now } : o)),
  );
  if (prev && prev.status !== status) {
    logAudit({
      entity: "order",
      entityId: id,
      action: "update",
      label: `${prev.namaProduk}: status ${prev.status} → ${status}`,
      changes: [{ field: "status", from: prev.status, to: status }],
    });
  }
}

export function deleteOrder(id: string): void {
  const prev = orders.find((o) => o.id === id);
  setOrders(orders.filter((o) => o.id !== id));
  // Drop any stock movement that was auto-generated from this order.
  if (stock.some((m) => m.orderId === id)) {
    setStock(stock.filter((m) => m.orderId !== id));
  }
  logAudit({
    entity: "order",
    entityId: id,
    action: "delete",
    label: `Pesanan ${prev?.namaProduk ?? id} dihapus`,
  });
}

export function deleteOrders(ids: Set<string>): void {
  setOrders(orders.filter((o) => !ids.has(o.id)));
  if (stock.some((m) => m.orderId && ids.has(m.orderId))) {
    setStock(stock.filter((m) => !(m.orderId && ids.has(m.orderId))));
  }
  for (const id of ids) {
    logAudit({
      entity: "order",
      entityId: id,
      action: "delete",
      label: `Pesanan dihapus (massal)`,
    });
  }
}

// ---------- Timestamp-aware purchase (Beli Stock) mutations ----------

// Add a Beli Stock line, stamping timestamps, and auto-create a linked
// `purchase` movement that ADDS the bought quantity (converted to base units)
// into stock, valued at the entered cost per base unit.
export function addPurchase(item: PurchaseItem, note = "dari beli stok"): void {
  const now = nowISO();
  const filled: PurchaseItem = {
    ...item,
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
  };
  setPurchases([...purchases, filled]);
  logAudit({
    entity: "purchase",
    entityId: filled.id,
    action: "create",
    label: `Beli Stok: ${filled.kuantitas} ${filled.satuan} ${filled.namaProduk}`,
  });

  const product =
    products.find((p) => p.id === filled.productId) ??
    products.find((p) => p.namaProduk === filled.namaProduk);
  if (product) {
    const baseUnits = baseUnitsFor(product, filled.satuan);
    const baseQty = filled.kuantitas * baseUnits;
    addMovement({
      id: uid(),
      productId: product.id,
      tanggal: filled.tanggal,
      qty: Math.abs(baseQty),
      satuan: product.satuan ?? "",
      reason: "purchase",
      hargaModal: baseUnits > 0 ? filled.hargaSatuan / baseUnits : filled.hargaSatuan,
      orderId: null,
      purchaseId: filled.id,
      note,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export function deletePurchase(id: string): void {
  const prev = purchases.find((p) => p.id === id);
  setPurchases(purchases.filter((p) => p.id !== id));
  // Drop any stock movement that was auto-generated from this purchase.
  if (stock.some((m) => m.purchaseId === id)) {
    setStock(stock.filter((m) => m.purchaseId !== id));
  }
  logAudit({
    entity: "purchase",
    entityId: id,
    action: "delete",
    label: `Beli Stok ${prev?.namaProduk ?? id} dihapus`,
  });
}

export function deletePurchases(ids: Set<string>): void {
  setPurchases(purchases.filter((p) => !ids.has(p.id)));
  if (stock.some((m) => m.purchaseId && ids.has(m.purchaseId))) {
    setStock(stock.filter((m) => !(m.purchaseId && ids.has(m.purchaseId))));
  }
  for (const id of ids) {
    logAudit({
      entity: "purchase",
      entityId: id,
      action: "delete",
      label: `Beli Stok dihapus (massal)`,
    });
  }
}

// ---------- Stock mutations ----------

export function addMovement(m: StockMovement): void {
  const now = nowISO();
  setStock([
    ...stock,
    {
      ...m,
      createdAt: m.createdAt ?? now,
      updatedAt: m.updatedAt ?? now,
    },
  ]);
  const name = products.find((p) => p.id === m.productId)?.namaProduk ?? m.productId;
  const sign = m.qty > 0 ? "+" : "";
  logAudit({
    entity: "stock",
    entityId: m.id,
    action: "create",
    label: `Stok ${name}: ${sign}${m.qty} (${m.reason})${
      m.orderId ? " dari pesanan" : ""
    }`,
  });
}

export function deleteMovement(id: string): void {
  const prev = stock.find((m) => m.id === id);
  setStock(stock.filter((m) => m.id !== id));
  const name = prev
    ? products.find((p) => p.id === prev.productId)?.namaProduk ?? prev.productId
    : id;
  logAudit({
    entity: "stock",
    entityId: id,
    action: "delete",
    label: `Pergerakan stok ${name} dihapus`,
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
