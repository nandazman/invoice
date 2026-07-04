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
}

export type OrderStatus = "pending" | "paid";

export interface OrderItem {
  id: string;
  tanggal: string; // ISO date, yyyy-mm-dd (used for filtering/sorting)
  namaProduk: string;
  satuan: string; // chosen unit label (base satuan or a conversion nama)
  kuantitas: number;
  hargaSatuan: number; // price of the chosen unit
  totalHarga: number; // kuantitas x hargaSatuan
  status: OrderStatus; // payment status
  affectsStock: boolean; // if true, adding this item deducts stock (a "sale" movement)
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
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
  note: string; // free-text note
  createdAt: string; // ISO datetime
  updatedAt: string; // ISO datetime
}
