# Invoice & Pesanan

Aplikasi web **lokal sepenuhnya (offline, tanpa jaringan)** untuk mengelola harga
produk dan menghitung pesanan secara otomatis. Dibangun dengan **Vite + React +
TypeScript + TanStack**, di-style dengan **Tailwind CSS**, dan di-deploy ke
**GitHub Pages** lewat GitHub Actions.

Semua data disimpan di **localStorage browser** dan dapat di-**ekspor/impor
sebagai JSON**. Tidak ada server, tidak ada permintaan jaringan.

---

## Fitur saat ini

### Halaman Harga (`/harga`)
- Daftar produk: `Nama Produk`, `Ukuran`, `Satuan`, `Harga Satuan`.
- **Konversi kemasan** per produk, sebagai array yang bisa ditambah bebas.
  Setiap konversi memiliki **harganya sendiri**, contoh:
  - 1 produk dasar = Rp 10.000 / unit
  - 1 `box` = 12 unit, harga box = Rp 110.000 (mis. ada diskon grosir)
- Tabel dengan pencarian & pengurutan (TanStack Table).
- Tambah / ubah / hapus produk.
- **Impor / Ekspor JSON** (kompatibel dengan format `price.json` lama,
  ditambah field `Konversi`).

### Halaman Pesanan (`/pesanan`)
- **Tambah item**: pilih produk dari daftar harga, pilih tanggal, masukkan
  kuantitas — per **satuan dasar** atau per **konversi** (box, dus, dll.).
- Harga & total dihitung otomatis. Setiap item menyimpan **snapshot harga**
  saat ditambahkan; mengubah harga produk **tidak** mengubah pesanan lama.
- **Riwayat** ditampilkan dikelompokkan per tanggal, dengan subtotal per
  tanggal dan total keseluruhan.
- **Filter**: rentang tanggal (dari/sampai), tanggal spesifik, dan nama produk.
- **Impor / Ekspor JSON** (format `order.json` lama: `Orders[]` per tanggal +
  `Total Keseluruhan`).

---

## Model data

```ts
// Produk (price.json)
interface Conversion { nama: string; jumlah: number; harga: number }
interface Product {
  namaProduk: string;
  ukuran: number | null;
  satuan: string | null;
  hargaJual: number;          // harga per satuan dasar
  konversi: Conversion[];     // tiap konversi punya harga sendiri
}

// Item pesanan (order.json, dikelompokkan per tanggal saat diekspor)
interface OrderItem {
  tanggal: string;            // ISO yyyy-mm-dd
  namaProduk: string;
  satuan: string;             // satuan/konversi yang dipilih
  kuantitas: number;
  hargaSatuan: number;        // snapshot harga unit terpilih
  totalHarga: number;
}
```

---

## Menjalankan secara lokal

Prasyarat: [Bun](https://bun.sh).

```bash
bun install
bun run dev       # http://localhost:5173/invoice/
bun run build     # build produksi ke dist/
bun run preview   # pratinjau hasil build
```

> Routing memakai **hash history** (`/#/harga`) agar refresh tidak 404 di
> GitHub Pages. `base` di `vite.config.ts` di-set ke `/invoice/` (nama repo).

---

## Deploy ke GitHub Pages

Sudah ada workflow di `.github/workflows/deploy.yml`:

1. Push ke `main` (atau `master`).
2. Di repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Workflow akan `bun install`, `bun run build`, lalu publish `dist/`.

Situs tersedia di `https://<username>.github.io/invoice/`.

Jika nama repo bukan `invoice`, ubah `base` di `vite.config.ts` agar cocok.

---

## Struktur proyek

```
src/
  main.tsx              # entry
  router.tsx            # rute (hash history): /harga, /pesanan
  styles.css            # @import "tailwindcss"
  lib/
    types.ts            # tipe data
    format.ts           # rupiah, tanggal Indonesia, uid
    storage.ts          # baca/tulis localStorage
    store.ts            # state global (useSyncExternalStore)
    io.ts               # serialisasi & impor/ekspor JSON, unduh berkas
    seed.ts             # data awal dari src/data/seed-price.json
    ui.ts               # kelas Tailwind bersama (tombol, input, dll.)
  components/
    ProductDialog.tsx   # form tambah/ubah produk + konversi
    AddItemForm.tsx     # form tambah item pesanan
  routes/
    RootLayout.tsx      # sidebar + outlet
    PricesPage.tsx      # halaman Harga
    OrdersPage.tsx      # halaman Pesanan
python/                 # skrip Python lama (referensi, di-gitignore)
```

Folder `python/` berisi skrip asli yang menjadi acuan: `build_order.py`
(membangun `order.json` dari teks), `create_excel.py` (ekspor XLSX),
`lib.py`, `list_missing.py`.

---

## Langkah berikutnya (rencana)

### 1. Generator Invoice PDF
Buat invoice PDF langsung di browser (tetap offline), dari pesanan yang
sudah difilter / per tanggal.

- Kandidat library client-side: `jspdf` + `jspdf-autotable`, atau
  `@react-pdf/renderer` (komponen React → PDF).
- Isi invoice: header bisnis, nomor & tanggal invoice, tabel item
  (Produk, Satuan, Qty, Harga Satuan, Total), subtotal per tanggal,
  total keseluruhan dalam Rupiah.
- Tombol **"Unduh Invoice PDF"** di halaman Pesanan, menghormati filter aktif.

### 2. Ekspor XLSX (menyamai `python/create_excel.py`)
Hasilkan `order.xlsx` di browser dengan tata letak yang sama seperti skrip
Python:

- Kolom: **Tanggal, Nama Produk, Kuantitas, Harga Satuan, Total Harga**.
- `Total Harga` per baris = **formula** `Kuantitas * Harga Satuan`.
- **Subtotal** per tanggal (`SUM` rentang baris tanggal tsb.).
- **Total Keseluruhan** = jumlah seluruh subtotal.
- Sel `Tanggal` di-merge vertikal untuk tiap kelompok tanggal.
- Styling: header biru, baris subtotal & grand-total berwarna, border tipis,
  lebar kolom diset, `freeze_panes` di baris pertama.
- Kandidat library client-side: `exceljs` (mendukung formula, merge, styling,
  number format) — paling dekat dengan `openpyxl`. `SheetJS (xlsx)` lebih
  ringan tetapi dukungan styling/formula terbatas.
