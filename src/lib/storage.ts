import type { Product, OrderItem } from "./types";
import { seedProducts } from "./seed";

const PRODUCTS_KEY = "invoice.products.v1";
const ORDERS_KEY = "invoice.orders.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadProducts(): Product[] {
  const existing = localStorage.getItem(PRODUCTS_KEY);
  if (existing == null) {
    const seeded = seedProducts();
    write(PRODUCTS_KEY, seeded);
    return seeded;
  }
  return read<Product[]>(PRODUCTS_KEY, []);
}

export function saveProducts(products: Product[]): void {
  write(PRODUCTS_KEY, products);
}

export function loadOrders(): OrderItem[] {
  return read<OrderItem[]>(ORDERS_KEY, []);
}

export function saveOrders(orders: OrderItem[]): void {
  write(ORDERS_KEY, orders);
}
