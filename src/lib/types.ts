// Soft deletes: every stored entity except AuditEntry carries `deletedAt`.
// Deleting stamps it instead of dropping the row, so the row survives in
// IndexedDB and a delete stays representable as data rather than as absence.
// The in-memory stores hold LIVE rows only (`deletedAt === null`), so nothing
// downstream of `store.ts` ever sees a tombstone and no page needs to filter.

// A packaging conversion for a product, e.g. "1 box = 12 unit".
// Each conversion carries its OWN price (may differ from base unit x jumlah).
export interface Conversion {
  nama: string; // unit label, e.g. "box", "dus"
  jumlah: number; // how many base units this unit contains
  harga: number; // price for one of this unit
}

export interface Product {
  id: string;
  namaProduk: string;
  tipe: string; // category, e.g. "Bar"
  ukuran: number | null;
  satuan: string | null; // base unit label (may be null in source data)
  hargaDasar: number; // cost/base price per single unit (modal)
  hargaJual: number; // selling price per single unit
  konversi: Conversion[];
  stokMin: number; // low-stock threshold in base units (0 = no threshold)
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  deletedAt: string | null; // ISO datetime once soft-deleted; null while live
}

export type OrderStatus = "pending" | "paid";

export interface OrderItem {
  id: string;
  tanggal: string; // ISO date, yyyy-mm-dd (used for filtering/sorting)
  productId: string; // links to Product.id ("" for unmatched legacy rows)
  namaProduk: string;
  satuan: string; // chosen unit label (base satuan or a conversion nama)
  kuantitas: number;
  hargaSatuan: number; // price of the chosen unit
  totalHarga: number; // kuantitas x hargaSatuan
  status: OrderStatus; // payment status
  affectsStock: boolean; // if true, adding this item deducts stock (a "sale" movement)
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  deletedAt: string | null; // ISO datetime once soft-deleted; null while live
}

// A stock-purchase line (Beli Stock). Pesanan-shaped but without status /
// affectsStock: every saved purchase always ADDS stock. Priced at Harga Dasar
// (modal); hargaSatuan is editable so the real invoice cost can be captured.
export interface PurchaseItem {
  id: string;
  tanggal: string; // ISO date, yyyy-mm-dd
  productId: string; // links to Product.id
  namaProduk: string;
  satuan: string; // chosen unit label (base satuan or a conversion nama)
  kuantitas: number; // in chosen unit
  hargaSatuan: number; // cost per chosen unit (editable, defaults from hargaDasar)
  totalHarga: number; // kuantitas x hargaSatuan
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  deletedAt: string | null; // ISO datetime once soft-deleted; null while live
}

// The common fields the export helpers (excel/text/image) read. Both OrderItem
// and PurchaseItem structurally satisfy this, so exports work off either source.
export interface LineItem {
  tanggal: string;
  namaProduk: string;
  satuan: string;
  kuantitas: number;
  hargaSatuan: number;
  totalHarga: number;
}

// One append-only entry in the global audit log. Never rewritten; a Restore
// replaces the whole log. entityId may dangle after the entity is deleted.
export interface AuditEntry {
  id: string;
  timestamp: string; // ISO datetime
  entity: "product" | "order" | "stock" | "type" | "purchase";
  entityId: string;
  action: "create" | "update" | "delete";
  label: string; // human summary, e.g. "Harga Jual 12.000 → 13.000"
  changes?: { field: string; from: unknown; to: unknown }[]; // field-level diff
}

// Why a movement is recorded. purchase/return add stock, sale/adjustment remove
// (adjustment can go either way via the sign of `qty`).
export type StockReason = "purchase" | "sale" | "adjustment" | "return";

// A single stock in/out entry. Current stock for a product is the sum of its
// movements' `qty`. Everything is stored in BASE units so mixed packaging
// (konversi) always reconciles.
export interface StockMovement {
  id: string;
  productId: string; // links to Product.id
  tanggal: string; // ISO date, yyyy-mm-dd
  qty: number; // signed, in BASE units (+ in, − out)
  satuan: string; // base unit label at time of entry (for display)
  reason: StockReason;
  hargaModal: number | null; // cost per BASE unit, snapshot on purchases; null otherwise
  orderId: string | null; // set when auto-generated from an order item
  purchaseId: string | null; // set when auto-generated from a Beli Stock line
  note: string; // free-text note
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  deletedAt: string | null; // ISO datetime once soft-deleted; null while live
}
