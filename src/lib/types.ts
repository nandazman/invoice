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
  ukuran: number | null;
  satuan: string | null; // base unit label (may be null in source data)
  hargaJual: number; // base price per single unit
  konversi: Conversion[];
}

export interface OrderItem {
  id: string;
  tanggal: string; // ISO date, yyyy-mm-dd (used for filtering/sorting)
  namaProduk: string;
  satuan: string; // chosen unit label (base satuan or a conversion nama)
  kuantitas: number;
  hargaSatuan: number; // price of the chosen unit
  totalHarga: number; // kuantitas x hargaSatuan
}
