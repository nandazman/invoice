import type { Product } from "./types";
import { uid, nowISO } from "./format";
import rawPrices from "../data/seed-price.json";

interface RawPrice {
  "Nama Produk": string;
  Ukuran: number | null;
  Satuan: string | null;
  "Harga Jual": number;
}

// Initial product catalogue, mapped from the original price.json shape.
export function seedProducts(): Product[] {
  const now = nowISO();
  return (rawPrices as RawPrice[]).map((p) => ({
    id: uid(),
    namaProduk: p["Nama Produk"],
    tipe: "Bar",
    ukuran: p.Ukuran ?? null,
    satuan: p.Satuan ?? null,
    hargaDasar: 0,
    hargaJual: p["Harga Jual"],
    konversi: [],
    stokMin: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }));
}
