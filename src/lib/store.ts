import { useSyncExternalStore } from "react";
import type { Product, OrderItem } from "./types";
import {
  loadProducts,
  saveProducts,
  loadOrders,
  saveOrders,
} from "./storage";

let products: Product[] = loadProducts();
let orders: OrderItem[] = loadOrders();

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

export function getProducts(): Product[] {
  return products;
}
export function getOrders(): OrderItem[] {
  return orders;
}
