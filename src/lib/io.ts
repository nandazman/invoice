import type {
  Product,
  OrderItem,
  Conversion,
  OrderStatus,
  StockMovement,
  StockReason,
} from "./types";
import {
  uid,
  nowISO,
  formatTanggalID,
  parseTanggalID,
  todayISO,
} from "./format";

// ---------- Products (price.json) ----------

interface RawConversion {
  Nama?: string;
  Jumlah?: number;
  Harga?: number;
}
interface RawProduct {
  "Nama Produk"?: string;
  Tipe?: string;
  Ukuran?: number | null;
  Satuan?: string | null;
  "Harga Dasar"?: number;
  "Harga Jual"?: number;
  Konversi?: RawConversion[];
  "Stok Min"?: number;
  CreatedAt?: string;
  UpdatedAt?: string;
}

export function serializeProducts(products: Product[]): string {
  const out = products.map((p) => ({
    "Nama Produk": p.namaProduk,
    Tipe: p.tipe,
    Ukuran: p.ukuran,
    Satuan: p.satuan,
    "Harga Dasar": p.hargaDasar,
    "Harga Jual": p.hargaJual,
    Konversi: p.konversi.map((c) => ({
      Nama: c.nama,
      Jumlah: c.jumlah,
      Harga: c.harga,
    })),
    "Stok Min": p.stokMin,
    CreatedAt: p.createdAt,
    UpdatedAt: p.updatedAt,
  }));
  return JSON.stringify(out, null, 2);
}

export function parseProducts(text: string): Product[] {
  const data = JSON.parse(text) as RawProduct[];
  if (!Array.isArray(data)) throw new Error("Format produk tidak valid");
  return data.map((p) => {
    const konversi: Conversion[] = Array.isArray(p.Konversi)
      ? p.Konversi.map((c) => ({
          nama: String(c.Nama ?? ""),
          jumlah: Number(c.Jumlah ?? 0),
          harga: Number(c.Harga ?? 0),
        }))
      : [];
    const now = nowISO();
    return {
      id: uid(),
      namaProduk: String(p["Nama Produk"] ?? ""),
      tipe: String(p.Tipe ?? "Bar"),
      ukuran: p.Ukuran ?? null,
      satuan: p.Satuan ?? null,
      hargaDasar: Number(p["Harga Dasar"] ?? 0),
      hargaJual: Number(p["Harga Jual"] ?? 0),
      konversi,
      stokMin: Number(p["Stok Min"] ?? 0),
      createdAt: p.CreatedAt ?? now,
      updatedAt: p.UpdatedAt ?? p.CreatedAt ?? now,
    };
  });
}

// ---------- Orders (order.json, grouped by date) ----------

interface RawItem {
  "Produk ID"?: string;
  "Nama Produk"?: string;
  Satuan?: string;
  Kuantitas?: number;
  "Harga Satuan"?: number;
  "Total Harga"?: number;
  Status?: string;
  "Tambah Stok"?: boolean;
  CreatedAt?: string;
  UpdatedAt?: string;
}
interface RawOrderGroup {
  Tanggal?: string;
  Items?: RawItem[];
}
interface RawOrderFile {
  Orders?: RawOrderGroup[];
}

export function serializeOrders(items: OrderItem[]): string {
  // Group by ISO date, ascending, emit in order.json shape.
  const byDate = new Map<string, OrderItem[]>();
  for (const it of items) {
    const arr = byDate.get(it.tanggal) ?? [];
    arr.push(it);
    byDate.set(it.tanggal, arr);
  }
  const dates = [...byDate.keys()].sort();
  let grand = 0;
  const Orders = dates.map((iso) => {
    const group = byDate.get(iso)!;
    const totalTanggal = group.reduce((s, i) => s + i.totalHarga, 0);
    grand += totalTanggal;
    return {
      Tanggal: formatTanggalID(iso),
      Items: group.map((i) => ({
        "Produk ID": i.productId,
        "Nama Produk": i.namaProduk,
        Satuan: i.satuan,
        Kuantitas: i.kuantitas,
        "Harga Satuan": i.hargaSatuan,
        "Total Harga": i.totalHarga,
        Status: i.status,
        "Tambah Stok": i.affectsStock,
        CreatedAt: i.createdAt,
        UpdatedAt: i.updatedAt,
      })),
      "Total Tanggal": totalTanggal,
    };
  });
  return JSON.stringify(
    { Orders, "Total Keseluruhan": grand },
    null,
    2,
  );
}

export function parseOrders(text: string): OrderItem[] {
  const data = JSON.parse(text) as RawOrderFile;
  const groups = Array.isArray(data?.Orders) ? data.Orders : [];
  const items: OrderItem[] = [];
  for (const g of groups) {
    const iso = g.Tanggal ? parseTanggalID(g.Tanggal) : todayISO();
    for (const it of g.Items ?? []) {
      const kuantitas = Number(it.Kuantitas ?? 0);
      const hargaSatuan = Number(it["Harga Satuan"] ?? 0);
      const now = nowISO();
      const status: OrderStatus = it.Status === "paid" ? "paid" : "pending";
      items.push({
        id: uid(),
        tanggal: iso,
        productId: String(it["Produk ID"] ?? ""),
        namaProduk: String(it["Nama Produk"] ?? ""),
        satuan: String(it.Satuan ?? ""),
        kuantitas,
        hargaSatuan,
        totalHarga: Number(it["Total Harga"] ?? kuantitas * hargaSatuan),
        status,
        affectsStock: it["Tambah Stok"] === true,
        createdAt: it.CreatedAt ?? now,
        updatedAt: it.UpdatedAt ?? it.CreatedAt ?? now,
      });
    }
  }
  return items;
}

// ---------- Stock (stock.json) ----------

interface RawMovement {
  "Produk ID"?: string;
  Tanggal?: string;
  Qty?: number;
  Satuan?: string;
  Alasan?: string;
  "Harga Modal"?: number | null;
  "Order ID"?: string | null;
  Catatan?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
}
interface RawStockFile {
  Movements?: RawMovement[];
}

const REASONS: StockReason[] = ["purchase", "sale", "adjustment", "return"];

export function serializeStock(movements: StockMovement[]): string {
  const Movements = movements.map((m) => ({
    "Produk ID": m.productId,
    Tanggal: formatTanggalID(m.tanggal),
    Qty: m.qty,
    Satuan: m.satuan,
    Alasan: m.reason,
    "Harga Modal": m.hargaModal,
    "Order ID": m.orderId,
    Catatan: m.note,
    CreatedAt: m.createdAt,
    UpdatedAt: m.updatedAt,
  }));
  return JSON.stringify({ Movements }, null, 2);
}

export function parseStock(text: string): StockMovement[] {
  const data = JSON.parse(text) as RawStockFile;
  const rows = Array.isArray(data?.Movements) ? data.Movements : [];
  return rows.map((m) => {
    const now = nowISO();
    const reason: StockReason = REASONS.includes(m.Alasan as StockReason)
      ? (m.Alasan as StockReason)
      : "adjustment";
    const rawModal = m["Harga Modal"];
    return {
      id: uid(),
      productId: String(m["Produk ID"] ?? ""),
      tanggal: m.Tanggal ? parseTanggalID(m.Tanggal) : todayISO(),
      qty: Number(m.Qty ?? 0),
      satuan: String(m.Satuan ?? ""),
      reason,
      hargaModal: rawModal == null ? null : Number(rawModal),
      orderId: m["Order ID"] ?? null,
      note: String(m.Catatan ?? ""),
      createdAt: m.CreatedAt ?? now,
      updatedAt: m.UpdatedAt ?? m.CreatedAt ?? now,
    };
  });
}

// ---------- Browser file helpers ----------

export function downloadJSON(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function pickJSONFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error("Tidak ada berkas dipilih"));
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    };
    input.click();
  });
}
