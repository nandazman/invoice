# Aturan data: jangan sampai kejadian 7 September terulang

Ditulis 2026-09-23, setelah enam pesanan tanggal 2026-09-07 hilang tanpa jejak.

## Apa yang terjadi

Enam pesanan dibuat 7 Sep 01:45–01:46 UTC dari perangkat
`maulanaagusrizki@gmail.com`. Pukul 02:04 pesanan itu dikonversi jadi Beli Stok;
purchase + stock movement-nya terkirim ke D1 dan masih ada sampai sekarang.
Pesanannya sendiri, dan seluruh entri audit sesi itu, tidak pernah sampai.

Yang membuktikan pesanan itu memang ada: enam baris `stock` menyimpan
`orderId` yang tidak menunjuk ke mana-mana, dan enam purchase itu satu-satunya
purchase di seluruh database yang tidak punya baris audit.

## Akar masalah — diperiksa ulang dengan backup teman (2026-09-23 sore)

`backup/invoice-backup-2026-09-23.json`, diekspor dari perangkat
`maulanaagusrizki@gmail.com` pukul 13:05 UTC. Hasilnya:

**Pesanan 7 Sep TIDAK ada di perangkat itu.** Nol baris `orders` tanggal
2026-09-07, dan enam baris `stock` di sana menggantung ke enam `orderId` yang
sama persis seperti di D1. Kerusakannya identik. Perangkat itu bukan sumber
pemulihan.

**Hipotesis cursor rusak: GUGUR.** Semua 444 `orders`, 197 `purchases`, 321
`stock`, 75 `products` dan 1699 `audit` punya cursor bertipe string yang valid.
Tidak ada satu pun baris yang bisa dilewati `sweepTable`.

**Jadi barisnya memang dihapus secara lokal**, dan teori `clear()` kembali
berlaku. `setOrders()` cuma punya SATU pemanggil di seluruh kode
(`backup.ts:166`, yaitu restore backup), jadi pintunya tinggal dua: restore
backup, atau "Buang perubahan lokal" (`discardLocalChanges`).

### Petunjuk baru yang belum tuntas

Produk Fructose di backup itu punya `updatedAt = 2026-09-07T01:44:47.463Z` —
28 detik SEBELUM pesanan pertama yang hilang — dengan `hargaJual` 25.000.
Perubahan harga itu selamat; entri auditnya tidak.

Itu mengarah ke "Buang perubahan lokal", bukan restore: force-pull mengganti
lokal dengan isi server, jadi baris yang SUDAH ter-push (produk itu) selamat
sementara yang belum (enam pesanan + auditnya) lenyap. Restore dari file
backup lama akan ikut mengembalikan harga Fructose ke 24.500, dan itu tidak
terjadi.

Belum terjawab: kenapa produknya sampai ke D1 tapi entri auditnya tidak,
padahal keduanya ikut push yang sama. Kandidatnya `BATCH_SIZE = 50` di
`worker/sync.ts` — push dipecah per 50 statement dan tiap chunk commit
sendiri, jadi chunk awal bisa mendarat sementara chunk berikutnya gagal, dan
client tetap membacanya sebagai "push gagal". Ini dugaan, belum dibuktikan.

Bagian di bawah ditulis sebelum backup itu ada, dan masih berlaku.

## Akar masalah

**`clear()` satu tabel penuh di store lokal yang tidak punya outbox.**

Ada dua pintu ke sana, dan keduanya tidak meninggalkan bekas apa pun:

- `src/lib/store.ts:120` — `setOrders()` dan saudara-saudaranya: `clear()` lalu
  `bulkPut()`. Dipakai oleh import JSON dan restore backup.
- `src/lib/sync/client.ts:610` — `discardLocalChanges()` ("Buang perubahan
  lokal"): `clear()` lalu isi ulang dari server.

Baris yang belum pernah ter-push hilang begitu saja: tidak ada tombstone
(`deletedAt`), tidak ada entri audit, dan tidak ada antrean yang bisa diperiksa
setelahnya. Push memilih baris lewat cursor `updatedAt` dibanding watermark —
baris yang sudah terhapus dari IndexedDB tidak akan pernah ikut ter-sweep lagi.

### Yang SUDAH dipastikan bukan penyebab

Tiga teori yang sempat saya pegang dan sudah gugur, supaya tidak ada yang
mengejarnya lagi:

1. **Urutan migrasi `modalSatuan`.** Dua pesanan tanggal 12 Sep masuk ke D1
   dengan `modalSatuan: null` — sebelum migrasi 0004 jalan 13 Sep 15:14. Client
   yang ter-deploy waktu itu belum mengirim kolom tersebut sama sekali.
2. **Push gagal lalu nyangkut.** Purchase 7 Sep punya
   `createdAt == updatedAt == 02:04:17.842Z`. Push pagi itu sukses. Dan karena
   watermark tidak maju saat gagal, pesanan yang masih pending pukul 02:04
   pasti ikut terbawa di payload yang sama.
3. **`replaceCloudWithLocal`.** Jalur itu menandai tombstone, bukan menghapus.
   Di seluruh tabel `orders` cuma ada 3 baris ber-`deletedAt`, tanggal 12 dan
   23 Sep. Bukan itu.

## Aturan

### R1 — Jangan pernah `clear()` tabel tersinkron tanpa menyelamatkan isinya dulu

Setiap jalur yang mengganti satu tabel utuh (`setOrders`, `setProducts`,
`setPurchases`, `setStock`, `setBuyers`, force-pull di `client.ts`) wajib
mengekspor baris yang belum ter-push ke file sebelum menghapus. Kalau
penyelamatan itu gagal, batalkan operasinya — jangan lanjut.

### R2 — Konfirmasi harus menyebut angka, bukan cuma peringatan

Dialog "Buang perubahan lokal" sekarang cuma bilang bahaya secara umum. Harus
menyebut: berapa baris yang akan hilang, dari tabel mana, tanggal berapa. Orang
tidak bisa menimbang risiko yang tidak diberi ukuran.

### R3 — Migrasi D1 jalan sebelum deploy, dipaksa oleh skrip

`deploy:cf` sekarang cuma `build:cf && wrangler deploy`. `d1:migrate` perintah
terpisah yang harus diingat sendiri. Gabungkan, atau tambahkan pengecekan yang
menolak deploy kalau ada migrasi yang belum terpakai di remote.

Ini tidak menyebabkan insiden 7 Sep, tapi jebakannya masih nyata dan header
`migrations/0004_order_modal.sql` sudah memperingatkannya sendiri.

### R4 — Pending yang menua harus berisik

Watermark yang tidak maju itu desain yang benar untuk offline. Yang salah:
tidak ada yang naik nada saat kondisi itu bertahan lama. Kalau ada baris pending
lebih dari 24 jam, tampilkan di luar panel sync — badge, banner, apa pun yang
terlihat tanpa harus dibuka.

### R5 — Sebelum operasi SQL manual di D1 remote, ekspor dulu

Sesi 13 Sep menjalankan SQL tulisan tangan langsung ke produksi. Kebetulan
isinya UPDATE semua, jadi aman. Lain kali jalankan `d1:export` dulu, simpan
hasilnya di `backup/`, baru eksekusi.

### R6 — Integritas referensial itu alarm, pakai

Yang akhirnya membongkar kasus ini: `stock.orderId` yang menggantung. Query itu
murah dan bisa jalan rutin:

```sql
SELECT COUNT(*) FROM stock s
LEFT JOIN orders o ON o.id = s.orderId
WHERE s.orderId IS NOT NULL AND o.id IS NULL;
```

Nol berarti sehat. Bukan nol berarti ada induk yang hilang, dan tanggalnya
langsung menunjuk sesi mana yang bermasalah. Sama untuk `stock.purchaseId`, dan
untuk purchase/order yang tidak punya baris audit.

## Tindakan pencegahan yang saya usulkan

Urut dari yang paling besar dampaknya per usaha:

1. **Ekspor otomatis sebelum destruktif** (R1) — satu helper yang dipanggil
   `setOrders` dkk dan `discardLocalChanges`. Ini sendirian sudah cukup untuk
   mengubah insiden ini dari kehilangan jadi sekadar merepotkan.
2. **Angka di dialog konfirmasi** (R2) — perubahan kecil di `SyncChip.tsx` dan
   `RootLayout.tsx`, hitungannya sudah tersedia di `status.pendingTotal`.
3. **Cek integritas di Laporan** (R6) — satu panel kecil yang menghitung baris
   menggantung, supaya ketahuan dalam hitungan hari, bukan minggu.
4. **Gabungkan migrasi ke deploy** (R3) — satu baris di `package.json`.
5. **Peringatan pending menua** (R4) — SUDAH: `StaleBacklogBanner` di
   `RootLayout.tsx`, muncul di setiap halaman begitu baris pending tertua
   lewat 24 jam. Ternyata tidak perlu menyimpan "pending sejak kapan":
   watermark tidak pernah maju melewati baris yang belum terkirim, jadi
   `updatedAt` baris itu sendiri sudah jawabannya (`SyncStatus.pendingSince`).

Nomor 1 dan 2 yang saya sarankan dikerjakan duluan.
