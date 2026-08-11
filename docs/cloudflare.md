# Deploy ke Cloudflare Workers

Aplikasi ini hidup di dua tempat sekaligus:

| | URL | Sifat |
| --- | --- | --- |
| GitHub Pages | `https://<username>.github.io/invoice/` | publik, otomatis tiap push |
| Cloudflare Workers | **https://invoice.xutopia.my.id** | privat, di balik login, deploy manual |

> Cloudflare menyajikan situs di root domain, bukan di `/invoice/`, jadi build-nya
> pakai `VITE_BASE=/`. Build GitHub Pages tidak berubah sama sekali.

> **Data tidak ikut pindah.** Dexie menyimpan semuanya di IndexedDB yang ter-scope
> per origin. Tiap hostname punya database sendiri: `invoice.xutopia.my.id` mulai
> kosong dan datanya terpisah total dari situs GitHub Pages. Aplikasi yang sama,
> dua database berbeda.

---

## Kenapa Workers, bukan Pages

Dulu ini deploy ke Cloudflare **Pages** di `invoice-es2.pages.dev`. Masalahnya:
**setiap project Pages selalu dapat URL `*.pages.dev` yang publik dan tidak bisa
dimatikan.** Cloudflare Access hanya bisa dipasang di hostname yang ada di zone
milik kita sendiri, sedangkan `pages.dev` itu zone milik Cloudflare. Hasilnya
domain sendiri terkunci rapat, tapi `pages.dev` tetap terbuka untuk siapa saja —
pintu belakang yang tidak bisa ditutup.

Workers tidak punya masalah itu. Dengan `workers_dev: false`, tidak ada URL
`*.workers.dev` yang dibuat, jadi custom domain adalah **satu-satunya** pintu
masuk dan Access tidak bisa dilewati.

Yang tidak berubah saat pindah: tetap gratis, bandwidth tetap unlimited, dan
karena `wrangler.jsonc` tidak mendeklarasikan `main` (tidak ada script sama
sekali, hanya `assets`), request dilayani langsung dari edge **tanpa memanggil
Worker**. Jadi kuota 100.000 request/hari tidak pernah tersentuh, persis seperti
Pages dulu.

---

## Deploy

Sekali saja:

```bash
bunx wrangler login
```

Tiap deploy — **tes dulu**, build dengan base root, lalu upload:

```powershell
# PowerShell
bun run test
$env:VITE_BASE = "/"; bun run build
bunx wrangler deploy
$env:VITE_BASE = $null   # env var bertahan sepanjang sesi shell
```

```bash
# Git Bash — MSYS_NO_PATHCONV wajib, kalau tidak `/` diubah jadi path Windows
bun run test
MSYS_NO_PATHCONV=1 VITE_BASE=/ bun run build
bunx wrangler deploy
```

Catatan:

- **Tidak ada pengaman tes.** Workflow GitHub Pages menjalankan `bun run test`
  sebelum build, jalur lokal tidak. Apa pun isi `dist/` akan naik — makanya
  `bun run test` ditulis manual di atas.
- Semua konfigurasi ada di `wrangler.jsonc`: folder aset, custom domain, dan
  `workers_dev: false`.
- Setelah ini `dist/` berisi aset ber-path root. Aman — `dist/` di-gitignore dan
  workflow GitHub Pages build ulang sendiri. Tapi kalau mau pratinjau versi
  GitHub Pages secara lokal, jalankan `bun run build` biasa dulu.
- Lihat versi yang sedang live: `bunx wrangler deployments list`.

---

## Cloudflare Access (Zero Trust)

Yang bikin situs ini privat. Request tanpa login ditolak **di edge**, sebelum
menyentuh file mana pun.

Setup lewat dashboard (tidak ada jalur CLI yang praktis), di
**Zero Trust → Access → Applications**:

1. **Add an application → Self-hosted**.
2. Destination: hostname `invoice.xutopia.my.id`.
3. Bikin policy **Allow** dengan selector **Emails** berisi email sendiri.
4. Login method: One-time PIN (kode via email) atau Google.

Prasyarat: domainnya harus ada di zone Cloudflare kita — makanya ini tidak pernah
bisa jalan di `pages.dev`.

Cek dari luar tanpa login, harus dapat 302 ke `cloudflareaccess.com`:

```bash
curl -sS -o /dev/null -D - https://invoice.xutopia.my.id
```

Batasannya cuma **50 seat** di free tier, dan seat baru terpakai kalau ada yang
berhasil login. Untuk pemakaian sendiri, praktis tak terbatas.

> Yang perlu disadari soal auth: **tidak ada data di server yang perlu
> dilindungi.** Semua invoice ada di browser masing-masing. Orang asing yang
> membuka URL-nya hanya dapat aplikasi kosong. Access menyembunyikan
> *aplikasinya*, bukan datanya.
>
> Risiko yang jauh lebih nyata untuk data ini bukan penyusup, tapi **IndexedDB
> terhapus** — clear browsing data, ganti browser, atau ganti laptop. Tidak ada
> backup otomatis di mana pun.

---

## Fitur Cloudflare lain (free tier)

> Sekarang domainnya ada di zone sendiri, jadi WAF, rate limiting, dan cache rules
> **sudah bisa dipakai** — dulu tidak, waktu masih di `pages.dev`.

**Cache** — sudah aktif, tanpa konfigurasi. Aset dilayani dari edge, bandwidth
unlimited. Nama file ber-hash dari Vite (`index-BK44kXUm.js`) bikin aset di-cache
lama sementara `index.html` tetap fresh, jadi hasil deploy langsung kelihatan.
Tidak ada yang perlu diatur.

**Rate limiting** — free tier dapat 1 rule. Gunanya melindungi origin atau API
dari gempuran; proyek ini tidak punya keduanya, dan Access sudah menolak request
asing sebelum sempat jadi beban. Lewati saja.

**R2** — 10 GB storage, kuota operasi cukup longgar, dan tanpa biaya egress
(bagian yang paling menarik). Kemungkinan tetap perlu memasang metode pembayaran
walau nol biaya. Tapi aplikasi ini menulis ke IndexedDB di browser; memakai R2
berarti membangun layer sync plus Worker di depannya buat auth — itu proyek
tersendiri, bukan sekadar setelan. Kalau tujuannya backup, ekspor Excel yang
sudah ada jauh lebih murah.

**Basic auth (`functions/_middleware.ts`)** — jangan. Setiap request jadi
menjalankan Worker dan memakan kuota 100k/hari, termasuk request yang ditolak,
jadi orang asing bisa menghabiskan kuota sampai situsnya mati untuk kita sendiri.
Password-nya juga nyangkut di source. Access lebih baik di semua sisi.

---

## Biaya

| | |
| --- | --- |
| Hosting, bandwidth, TLS, DNS | Rp 0 |
| Cloudflare Access (50 seat) | Rp 0 |
| Domain `xutopia.my.id` | Rp 50.000 / 2 tahun |
