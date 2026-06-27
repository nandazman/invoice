import { useSyncExternalStore } from "react";
import type { Product, OrderItem, OrderStatus } from "./types";
import { nowISO } from "./format";
import {
  loadProducts,
  saveProducts,
  loadOrders,
  saveOrders,
  loadTypes,
  saveTypes,
} from "./storage";

let products: Product[] = loadProducts();
let orders: OrderItem[] = loadOrders();
let types: string[] = loadTypes();

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

// Add an order item, stamping status/timestamps if not already set.
export function addOrder(item: OrderItem): void {
  const now = nowISO();
  setOrders([
    ...orders,
    {
      ...item,
      status: item.status ?? "pending",
      createdAt: item.createdAt ?? now,
      updatedAt: item.updatedAt ?? now,
    },
  ]);
}

export function setOrderStatus(id: string, status: OrderStatus): void {
  const now = nowISO();
  setOrders(
    orders.map((o) => (o.id === id ? { ...o, status, updatedAt: now } : o)),
  );
}

export function deleteOrder(id: string): void {
  setOrders(orders.filter((o) => o.id !== id));
}

export function deleteOrders(ids: Set<string>): void {
  setOrders(orders.filter((o) => !ids.has(o.id)));
}

export function getProducts(): Product[] {
  return products;
}
export function getOrders(): OrderItem[] {
  return orders;
}
