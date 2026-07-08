import type {
  Product,
  OrderItem,
  PurchaseItem,
  StockMovement,
  AuditEntry,
} from "./types";
import type { Template } from "./template-types";
import { nowISO } from "./format";
import {
  getProducts,
  getOrders,
  getPurchases,
  getStock,
  setProducts,
  setOrders,
  setPurchases,
  setStock,
} from "./store";
import { getAudit, setAudit } from "./audit";

// Bumped whenever the on-disk backup shape changes incompatibly. importAll
// rejects any file whose `version` does not match this exactly.
export const BACKUP_VERSION = 2;

// localStorage keys owned by stores we cannot re-enter through a setter here.
// Kept in sync with storage.ts (TYPES_KEY) and template-store.ts (TEMPLATES_KEY).
const TYPES_KEY = "invoice.types.v1";
const TEMPLATES_KEY = "invoice.templates.v1";

// The full-backup document: raw internal shapes with IDs preserved so a restore
// is a byte-for-byte replacement (unlike io.ts, which regenerates ids on import).
export interface BackupFile {
  version: number;
  exportedAt: string; // ISO datetime the backup was produced
  products: Product[];
  orders: OrderItem[];
  purchases: PurchaseItem[];
  stock: StockMovement[];
  types: string[];
  templates: Template[];
  audit: AuditEntry[];
}

// Read a JSON array straight from localStorage, defaulting to [] on any miss or
// parse error. Used for `types`/`templates`, which have no getter reachable here.
function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

// Serialize every store into one pretty-printed backup document, IDs preserved.
export function exportAll(): string {
  const data: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: nowISO(),
    products: getProducts(),
    orders: getOrders(),
    purchases: getPurchases(),
    stock: getStock(),
    types: readArray<string>(TYPES_KEY),
    templates: readArray<Template>(TEMPLATES_KEY),
    audit: getAudit(),
  };
  return JSON.stringify(data, null, 2);
}

// Wholesale-replace every store from a backup document (no id regeneration).
//
// All parsing/validation happens BEFORE any store is touched, so a bad file
// leaves everything untouched. `types` and `templates` are written directly to
// localStorage because their in-memory stores expose no re-entry setter here —
// so the CALLER MUST RELOAD THE PAGE afterwards for those two to re-read from
// storage (the reactive stores — products/orders/stock/audit — update live).
export function importAll(text: string): void {
  const data = JSON.parse(text) as Partial<BackupFile>;

  if (data.version !== BACKUP_VERSION) {
    throw new Error(
      `Versi cadangan tidak cocok — diharapkan ${BACKUP_VERSION}, ditemukan ${
        data.version ?? "tidak ada"
      }.`,
    );
  }

  // Reactive stores: persisted and broadcast immediately.
  setProducts(data.products ?? []);
  setOrders(data.orders ?? []);
  setPurchases(data.purchases ?? []);
  setStock(data.stock ?? []);
  setAudit(data.audit ?? []);

  // Non-reactive here: persisted only. Re-read happens on the next page load.
  localStorage.setItem(TYPES_KEY, JSON.stringify(data.types ?? []));
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(data.templates ?? []));
}
