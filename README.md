# Invoice & Pesanan

Aplikasi web **lokal sepenuhnya (offline, tanpa jaringan)** untuk mengelola harga
produk dan menghitung pesanan secara otomatis. Dibangun dengan **Vite + React +
TypeScript + TanStack**, di-style dengan **Tailwind CSS**, dan di-deploy ke
**GitHub Pages** lewat GitHub Actions.

Semua data disimpan di **localStorage browser** dan dapat di-**ekspor/impor
sebagai JSON**. Tidak ada server, tidak ada permintaan jaringan.

> **Status:** Lima halaman sudah **selesai** — Harga, Pesanan, Ekspor Excel,
> Desain Template, dan Buat Invoice.

---

## Fitur saat ini

### Halaman Harga (`/harga`)
- Daftar produk: `Nama Produk`, `Tipe`, `Ukuran`, `Satuan`, `Harga Dasar`
  (modal), `Harga Satuan` (jual), dan **Laba** (`Harga Satuan − Harga Dasar`,
  dihitung otomatis dan diberi warna hijau/merah).
- **Tipe produk** (mis. `Bar`, `Dapur`) dipilih lewat combobox ala GitHub
  "create branch": pilih tipe yang ada atau ketik nama baru untuk
  **membuat tipe** — langsung tersimpan dan tersedia di semua dropdown.
- **Konversi kemasan** per produk, sebagai array yang bisa ditambah bebas.
  Harga tiap konversi **dihitung otomatis** dari `Harga Satuan × jumlah`,
  contoh: harga satuan Rp 10.000, `1 box = 12 unit` → harga box = Rp 120.000.
- Tabel dengan pencarian & pengurutan (TanStack Table).
- Tambah / ubah / hapus produk.
- **Impor / Ekspor JSON** (kompatibel dengan format `price.json` lama,
  ditambah field `Tipe` & `Konversi`).

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

### Halaman Ekspor Excel (`/excel`)
- Ekspor pesanan ke **`order.xlsx`** langsung di browser (memakai `exceljs`),
  menyamai tata letak `python/create_excel.py`.
- Kolom: **Tanggal, Nama Produk, Kuantitas, Harga Satuan, Total Harga**, dengan
  **formula** `Kuantitas × Harga Satuan` per baris, **subtotal** per tanggal,
  dan **Total Keseluruhan**.
- Styling: header berwarna, baris subtotal/grand-total, border, sel tanggal
  di-merge per kelompok, dan `freeze_panes`.
- Filter rentang/tanggal/produk/status dan **toggle kolom** sebelum ekspor.

### Halaman Desain Template (`/template`)
- **Perancang template drag-and-drop** untuk tata letak invoice di kanvas
  ukuran A4: tarik, ubah ukuran, dan susun elemen dengan snap.
- Jenis elemen: **Teks** (dengan token `{{business.nama}}`, `{{customer.nama}}`,
  dst.), **Field** dinamis (no. invoice, tanggal terbit, jatuh tempo),
  **Gambar**, **Logo**, **Item Pesanan** (tabel berkolom), **Total**, dan **Garis**.
- Inspector untuk gaya teks (ukuran, perataan, warna, tebal/miring), urutan
  lapisan (ke depan/belakang), duplikat, dan hapus.
- **Field dinamis** — setiap elemen **Field** di kanvas mendefinisikan sendiri
  **Judul** + **Tipe** (Teks / Angka / Tanggal / Dropdown; dropdown menyertakan
  daftar pilihan). Tidak ada lagi field "bawaan" yang di-hardcode: template baru
  hanya **diisi default** No. Invoice (teks), Tanggal Terbit (tanggal), dan
  Jatuh Tempo (tanggal) yang bebas diubah/dihapus. Setiap judul otomatis menjadi
  input di halaman **Buat Invoice** sesuai tipenya; judul yang sama (dipasang di
  beberapa tempat) berbagi satu isian.
- **Pengaturan template**: nama template, data bisnis (nama, alamat, telepon,
  logo via unggah atau URL), dan data pelanggan contoh.
- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z), hapus via Delete, dan **simpan
  otomatis** ke localStorage. Buat, duplikat, dan hapus template.

### Halaman Buat Invoice (`/invoice`)
- Pilih template, isi **data invoice** (nomor, tanggal terbit, jatuh tempo).
- Pilih item pesanan lewat filter (rentang/tanggal/produk/status), **tambah**
  atau **ganti semua**, lalu hapus baris terpilih.
- **Pratinjau langsung** invoice sesuai template, dengan total otomatis.
- **Cetak / simpan PDF** lewat dialog cetak browser (`window.print()`).

---

## Model data

```ts
// Produk (price.json)
interface Conversion { nama: string; jumlah: number; harga: number } // harga = jumlah × hargaJual (otomatis)
interface Product {
  namaProduk: string;
  tipe: string;               // kategori, mis. "Bar"
  ukuran: number | null;
  satuan: string | null;
  hargaDasar: number;         // harga modal per satuan dasar
  hargaJual: number;          // harga jual per satuan dasar (laba = hargaJual − hargaDasar)
  konversi: Conversion[];     // harga tiap konversi dihitung dari hargaJual
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
  router.tsx            # rute (hash history): /harga, /pesanan, /excel, /template, /invoice
  styles.css            # @import "tailwindcss"
  lib/
    types.ts            # tipe data
    format.ts           # rupiah, tanggal Indonesia, uid
    storage.ts          # baca/tulis localStorage (produk, pesanan, tipe)
    store.ts            # state global (useSyncExternalStore) + addType
    io.ts               # serialisasi & impor/ekspor JSON, unduh berkas
    seed.ts             # data awal dari src/data/seed-price.json
    columns.ts          # definisi & toggle kolom tabel
    excel.ts            # ekspor order.xlsx (exceljs)
    template-types.ts   # tipe template, elemen, & data invoice
    template-store.ts   # state template (localStorage) + create/duplicate/save
    image.ts            # downscale gambar & baca dimensi
    snap.ts             # snapping drag/resize di kanvas
  components/
    Button.tsx          # Button / PrimaryButton / DangerButton / GhostButton
    Input.tsx, Select.tsx, Panel.tsx, Field.tsx
    TypeSelect.tsx      # combobox tipe (pilih / buat baru)
    ProductDialog.tsx   # form tambah/ubah produk + konversi
    AddItemForm.tsx     # form tambah item pesanan
    ColumnToggle.tsx    # toggle visibilitas kolom
    template/
      Canvas.tsx        # kanvas drag-and-drop A4
      ElementContent.tsx# render isi tiap elemen
      Inspector.tsx     # panel properti template/elemen
      Preview.tsx       # render template + data invoice
  routes/
    RootLayout.tsx      # sidebar + outlet
    PricesPage.tsx      # halaman Harga
    OrdersPage.tsx      # halaman Pesanan
    ExcelPage.tsx       # halaman Ekspor Excel
    TemplatePage.tsx    # halaman Desain Template
    InvoicePage.tsx     # halaman Buat Invoice
python/                 # skrip Python lama (referensi, di-gitignore)
```

Folder `python/` berisi skrip asli yang menjadi acuan: `build_order.py`
(membangun `order.json` dari teks), `create_excel.py` (ekspor XLSX),
`lib.py`, `list_missing.py`.

---

## Langkah berikutnya (rencana)

Semua fitur inti sudah selesai. Ide pengembangan lanjutan:

- **Ekspor PDF asli** (mis. `@react-pdf/renderer`) sebagai alternatif dialog
  cetak browser, untuk hasil yang lebih konsisten antar-perangkat.
- **Field kustom bertipe angka/mata uang** yang ikut dihitung (mis. pajak/PPN,
  diskon) — saat ini field kustom bersifat tampilan, belum memengaruhi total.
- **Status pembayaran & rekap** invoice yang sudah dibuat.
