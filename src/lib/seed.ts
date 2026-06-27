import type { Product } from "./types";
import { uid } from "./format";
import rawPrices from "../data/seed-price.json";

interface RawPrice {
  "Nama Produk": string;
  Ukuran: number | null;
  Satuan: string | null;
  "Harga Jual": number;
}

// Initial product catalogue, mapped from the original price.json shape.
export function seedProducts(): Product[] {
  return (rawPrices as RawPrice[]).map((p) => ({
    id: uid(),
    namaProduk: p["Nama Produk"],
    ukuran: p.Ukuran ?? null,
    satuan: p.Satuan ?? null,
    hargaJual: p["Harga Jual"],
    konversi: [],
  }));
}
