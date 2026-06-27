import type { Product, OrderItem, Conversion, OrderStatus } from "./types";
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
  "Harga Jual"?: number;
  Konversi?: RawConversion[];
  CreatedAt?: string;
  UpdatedAt?: string;
}

export function serializeProducts(products: Product[]): string {
  const out = products.map((p) => ({
    "Nama Produk": p.namaProduk,
    Tipe: p.tipe,
    Ukuran: p.ukuran,
    Satuan: p.satuan,
    "Harga Jual": p.hargaJual,
    Konversi: p.konversi.map((c) => ({
      Nama: c.nama,
      Jumlah: c.jumlah,
      Harga: c.harga,
    })),
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
      hargaJual: Number(p["Harga Jual"] ?? 0),
      konversi,
      createdAt: p.CreatedAt ?? now,
      updatedAt: p.UpdatedAt ?? p.CreatedAt ?? now,
    };
  });
}

// ---------- Orders (order.json, grouped by date) ----------

interface RawItem {
  "Nama Produk"?: string;
  Satuan?: string;
  Kuantitas?: number;
  "Harga Satuan"?: number;
  "Total Harga"?: number;
  Status?: string;
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
        "Nama Produk": i.namaProduk,
        Satuan: i.satuan,
        Kuantitas: i.kuantitas,
        "Harga Satuan": i.hargaSatuan,
        "Total Harga": i.totalHarga,
        Status: i.status,
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
        namaProduk: String(it["Nama Produk"] ?? ""),
        satuan: String(it.Satuan ?? ""),
        kuantitas,
        hargaSatuan,
        totalHarga: Number(it["Total Harga"] ?? kuantitas * hargaSatuan),
        status,
        createdAt: it.CreatedAt ?? now,
        updatedAt: it.UpdatedAt ?? it.CreatedAt ?? now,
      });
    }
  }
  return items;
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
