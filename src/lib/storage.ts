import type { Product, OrderItem } from "./types";
import { seedProducts } from "./seed";

const PRODUCTS_KEY = "invoice.products.v1";
const ORDERS_KEY = "invoice.orders.v1";
const TYPES_KEY = "invoice.types.v1";

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
  // Migrate older records that predate the `tipe` field.
  return read<Product[]>(PRODUCTS_KEY, []).map((p) => ({
    ...p,
    tipe: p.tipe ?? "Bar",
  }));
}

export function saveProducts(products: Product[]): void {
  write(PRODUCTS_KEY, products);
}

export function loadTypes(): string[] {
  const saved = read<string[]>(TYPES_KEY, []);
  // Union saved types with any types already present on products, plus "Bar".
  const set = new Set<string>(["Bar", ...saved]);
  for (const p of loadProducts()) if (p.tipe) set.add(p.tipe);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function saveTypes(types: string[]): void {
  write(TYPES_KEY, types);
}

export function loadOrders(): OrderItem[] {
  return read<OrderItem[]>(ORDERS_KEY, []);
}

export function saveOrders(orders: OrderItem[]): void {
  write(ORDERS_KEY, orders);
}
