import { useSyncExternalStore } from "react";
import type {
  Product,
  OrderItem,
  OrderStatus,
  StockMovement,
} from "./types";
import { nowISO, uid } from "./format";
import {
  loadProducts,
  saveProducts,
  loadOrders,
  saveOrders,
  loadTypes,
  saveTypes,
  loadStock,
  saveStock,
} from "./storage";

let products: Product[] = loadProducts();
let orders: OrderItem[] = loadOrders();
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
  }
  return t;
}

// ---------- Timestamp-aware product mutations ----------

// Insert or update a product, stamping createdAt/updatedAt automatically.
export function upsertProduct(p: Product): void {
  const now = nowISO();
  const exists = products.some((x) => x.id === p.id);
  if (exists) {
    setProducts(
      products.map((x) =>
        x.id === p.id ? { ...p, createdAt: x.createdAt, updatedAt: now } : x,
      ),
    );
  } else {
    setProducts([...products, { ...p, createdAt: now, updatedAt: now }]);
  }
}

export function deleteProduct(id: string): void {
  setProducts(products.filter((p) => p.id !== id));
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
// `affectsStock` is set, also record a matching `purchase` movement that adds
// the ordered quantity (converted to base units) into stock, valued at the
// product's Harga Dasar.
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

  if (filled.affectsStock) {
    const product = products.find((p) => p.namaProduk === filled.namaProduk);
    if (product) {
      const baseQty = filled.kuantitas * baseUnitsFor(product, filled.satuan);
      addMovement({
        id: uid(),
        productId: product.id,
        tanggal: filled.tanggal,
        qty: Math.abs(baseQty),
        satuan: product.satuan ?? "",
        reason: "purchase",
        hargaModal: product.hargaDasar,
        orderId: filled.id,
        note: "dari pesanan",
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

export function setOrderStatus(id: string, status: OrderStatus): void {
  const now = nowISO();
  setOrders(
    orders.map((o) => (o.id === id ? { ...o, status, updatedAt: now } : o)),
  );
}

export function deleteOrder(id: string): void {
  setOrders(orders.filter((o) => o.id !== id));
  // Drop any stock movement that was auto-generated from this order.
  if (stock.some((m) => m.orderId === id)) {
    setStock(stock.filter((m) => m.orderId !== id));
  }
}

export function deleteOrders(ids: Set<string>): void {
  setOrders(orders.filter((o) => !ids.has(o.id)));
  if (stock.some((m) => m.orderId && ids.has(m.orderId))) {
    setStock(stock.filter((m) => !(m.orderId && ids.has(m.orderId))));
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
}

export function deleteMovement(id: string): void {
  setStock(stock.filter((m) => m.id !== id));
}

export function getProducts(): Product[] {
  return products;
}
export function getOrders(): OrderItem[] {
  return orders;
}
export function getStock(): StockMovement[] {
  return stock;
}
