import type {
  Product,
  OrderItem,
  PurchaseItem,
  StockMovement,
  AuditEntry,
} from "./types";
import { nowISO } from "./format";

// LEGACY — localStorage readers, kept ONLY as the source for the one-time
// IndexedDB migration in db.ts. Nothing in the app writes here anymore.
//
// These loaders carry every legacy field back-fill accumulated over the life of
// the localStorage schema (tipe, hargaDasar, stokMin, productId, timestamps).
// That is why they survive rather than being reimplemented inside the
// migration: there must be exactly one copy of those rules.
//
// `deletedAt` is NOT back-filled here — the migration stamps it, so this module
// keeps describing the old schema exactly as it was written.
//
// This module is deleted once the legacy keys are removed, a release or two
// after the migration has run clean in the field.
//
// NOTE: UI state (sidebar collapse in RootLayout, per-column visibility in
// columns.ts) legitimately stays in localStorage and has nothing to do with
// this module.

const PRODUCTS_KEY = "invoice.products.v1";
const ORDERS_KEY = "invoice.orders.v1";
const PURCHASES_KEY = "invoice.purchases.v1";
const TYPES_KEY = "invoice.types.v1";
const STOCK_KEY = "invoice.stock.v1";
const AUDIT_KEY = "invoice.audit.v1";
const TEMPLATES_KEY = "invoice.templates.v1";

// Every key the migration reads. Used to tell "existing install" from "fresh
// install" — the difference between copying data and seeding.
export const LEGACY_KEYS = [
  PRODUCTS_KEY,
  ORDERS_KEY,
  PURCHASES_KEY,
  TYPES_KEY,
  STOCK_KEY,
  AUDIT_KEY,
  TEMPLATES_KEY,
] as const;

// True when this browser holds data written by a pre-IndexedDB release.
export function hasLegacyData(): boolean {
  return LEGACY_KEYS.some((k) => localStorage.getItem(k) != null);
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Migrate older records that predate the `tipe` / timestamp fields.
//
// Unlike the pre-migration version of this function, this NEVER seeds: seeding
// used to write back to localStorage as a side effect of a read. The fresh-
// install seed now lives in db.ts, where it belongs.
export function loadProducts(): Product[] {
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

export function loadTypes(): string[] {
  const saved = read<string[]>(TYPES_KEY, []);
  // Union saved types with any types already present on products, plus "Bar".
  const set = new Set<string>(["Bar", ...saved]);
  for (const p of loadProducts()) if (p.tipe) set.add(p.tipe);
  return [...set].sort((a, b) => a.localeCompare(b));
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

export function loadPurchases(): PurchaseItem[] {
  const now = nowISO();
  return read<PurchaseItem[]>(PURCHASES_KEY, []).map((p) => ({
    ...p,
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? p.createdAt ?? now,
  }));
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

export function loadAudit(): AuditEntry[] {
  return read<AuditEntry[]>(AUDIT_KEY, []);
}
