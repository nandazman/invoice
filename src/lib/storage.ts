import type {
  Product,
  OrderItem,
  PurchaseItem,
  StockMovement,
  AuditEntry,
} from "./types";
import { seedProducts } from "./seed";
import { nowISO } from "./format";

const PRODUCTS_KEY = "invoice.products.v1";
const ORDERS_KEY = "invoice.orders.v1";
const PURCHASES_KEY = "invoice.purchases.v1";
const TYPES_KEY = "invoice.types.v1";
const STOCK_KEY = "invoice.stock.v1";
const AUDIT_KEY = "invoice.audit.v1";

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
  // Migrate older records that predate the `tipe` / timestamp fields.
  const now = nowISO();
  return read<Product[]>(PRODUCTS_KEY, []).map((p) => ({
    ...p,
    tipe: p.tipe ?? "Bar",
    hargaDasar: p.hargaDasar ?? 0,
    stokMin: p.stokMin ?? 0,
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? p.createdAt ?? now,
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
  // Migrate older records that predate the status / timestamp / productId fields.
  const now = nowISO();
  // Backfill productId for legacy rows by matching namaProduk against products.
  const byName = new Map<string, string>();
  for (const p of loadProducts()) {
    if (!byName.has(p.namaProduk)) byName.set(p.namaProduk, p.id);
  }
  return read<OrderItem[]>(ORDERS_KEY, []).map((o) => ({
    ...o,
    productId: o.productId ?? byName.get(o.namaProduk) ?? "",
    status: o.status ?? "pending",
    affectsStock: o.affectsStock ?? false,
    createdAt: o.createdAt ?? now,
    updatedAt: o.updatedAt ?? o.createdAt ?? now,
  }));
}

export function saveOrders(orders: OrderItem[]): void {
  write(ORDERS_KEY, orders);
}

export function loadPurchases(): PurchaseItem[] {
  const now = nowISO();
  return read<PurchaseItem[]>(PURCHASES_KEY, []).map((p) => ({
    ...p,
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? p.createdAt ?? now,
  }));
}

export function savePurchases(purchases: PurchaseItem[]): void {
  write(PURCHASES_KEY, purchases);
}

export function loadStock(): StockMovement[] {
  const now = nowISO();
  return read<StockMovement[]>(STOCK_KEY, []).map((m) => ({
    ...m,
    hargaModal: m.hargaModal ?? null,
    orderId: m.orderId ?? null,
    purchaseId: m.purchaseId ?? null,
    note: m.note ?? "",
    createdAt: m.createdAt ?? now,
    updatedAt: m.updatedAt ?? m.createdAt ?? now,
  }));
}

export function saveStock(movements: StockMovement[]): void {
  write(STOCK_KEY, movements);
}

export function loadAudit(): AuditEntry[] {
  return read<AuditEntry[]>(AUDIT_KEY, []);
}

export function saveAudit(entries: AuditEntry[]): void {
  write(AUDIT_KEY, entries);
}
