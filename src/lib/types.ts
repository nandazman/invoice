// Soft deletes: every stored entity except AuditEntry carries `deletedAt`.
// Deleting stamps it instead of dropping the row, so the row survives in
// IndexedDB and a delete stays representable as data rather than as absence.
// The in-memory stores hold LIVE rows only (`deletedAt === null`), so nothing
// downstream of `store.ts` ever sees a tombstone and no page needs to filter.

// Who last touched a row, as a Cloudflare Access email. Server-stamped by the
// Worker on push and merged back onto the row on pull (see the ATTRIBUTION
// block in lib/sync/tables.ts) — nothing in the app ever WRITES these.
//
// Both are optional, and must stay optional: a row created on this device and
// never synced has never been stamped, and the GitHub Pages copy has no Worker
// behind it at all, so it never has them. Every reader must handle absence —
// the tables render an em-dash.
export interface Attribution {
  createdBy?: string | null;
  updatedBy?: string | null;
}

// A packaging conversion for a product, e.g. "1 box = 12 unit".
// Each conversion carries its OWN price (may differ from base unit x jumlah).
export interface Conversion {
  nama: string; // unit label, e.g. "box", "dus"
  jumlah: number; // how many base units this unit contains
  harga: number; // price for one of this unit
}

export interface Product extends Attribution {
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

// A customer. Shaped after Product (uid key, timestamps, soft delete) rather
// than TypeRow, which is keyed on its own name: buyers get renamed, carry
// contact details, and need a stable key so their order history survives a
// rename. Only `nama` is required; the rest are "" when unknown.
// See docs/2026-07-29/plan.md §1.
export interface Buyer extends Attribution {
  id: string;
  nama: string;
  telepon: string;
  email: string;
  alamat: string;
  catatan: string;
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  deletedAt: string | null; // ISO datetime once soft-deleted; null while live
}

export type OrderStatus = "pending" | "paid";

export interface OrderItem extends Attribution {
  id: string;
  tanggal: string; // ISO date, yyyy-mm-dd (used for filtering/sorting)
  productId: string; // links to Product.id ("" for unmatched legacy rows)
  buyerId: string; // links to Buyer.id ("" when no buyer is assigned)
  namaProduk: string;
  satuan: string; // chosen unit label (base satuan or a conversion nama)
  kuantitas: number;
  hargaSatuan: number; // price of the chosen unit
  totalHarga: number; // kuantitas x hargaSatuan
  // Modal (cost) per chosen unit, snapshot of Harga Dasar × base units when the
  // order was added, so editing the price list later cannot rewrite what a past
  // sale cost. Optional and null on rows that predate it, and null when the
  // product had no Harga Dasar filled in — readers fall back to the product.
  modalSatuan?: number | null;
  status: OrderStatus; // payment status
  affectsStock: boolean; // if true, adding this item deducts stock (a "sale" movement)
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
  deletedAt: string | null; // ISO datetime once soft-deleted; null while live
}

// A stock-purchase line (Beli Stock). Pesanan-shaped but without status /
// affectsStock: every saved purchase always ADDS stock. Priced at Harga Dasar
// (modal); hargaSatuan is editable so the real invoice cost can be captured.
export interface PurchaseItem extends Attribution {
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
export interface AuditEntry extends Attribution {
  id: string;
  timestamp: string; // ISO datetime
  entity: "product" | "order" | "stock" | "type" | "purchase" | "buyer";
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
export interface StockMovement extends Attribution {
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
