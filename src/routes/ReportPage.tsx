import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  useProducts,
  useOrders,
  usePurchases,
  useStock,
  useBuyers,
} from "../lib/store";
import {
  buildFifoIndex,
  joinOrderCosts,
  summarize,
  byProduct,
  byBuyer,
  receivables,
  purchaseTotal,
  stockLoss,
  estimateUnpriced,
  monthlyTrend,
  type MarginRow,
} from "../lib/report";
import {
  useOrderFilter,
  buildTipeIndex,
  filterRows,
  type StatusFilter,
} from "../lib/useOrderFilter";
import type { StockMovement } from "../lib/types";
import {
  formatRupiah,
  formatAngka,
  formatPersen,
  formatBulanPendek,
  todayISO,
} from "../lib/format";
import { FilterBar } from "../components/FilterBar";
import { Field } from "../components/Field";
import { Panel } from "../components/Panel";
import { Select } from "../components/Select";
import { Stat } from "../components/Stat";
import { thClass, tdClass } from "../components/DataTable";
import { MobileList, MobileRow } from "../components/MobileList";
import { CompositionChart, ContributionChart } from "../components/Chart";

// How many rows the two charts draw. Past this a bar chart stops being a chart
// and becomes a table with decoration: the bars get too short to compare and the
// page too long to scan. The full list is always right below, in the tables.
const CHART_ROWS = 8;
const CHART_MONTHS = 12;

export function ReportPage() {
  const products = useProducts();
  const orders = useOrders();
  const purchases = usePurchases();
  const stock = useStock();
  const buyers = useBuyers();

  const filter = useOrderFilter(orders, products);
  const { filtered } = filter;

  // Off by default, and it stays a per-session choice rather than a saved
  // setting: the estimate is an assumption, and an assumption that survives a
  // reload silently becomes the number the user believes.
  const [pakaiPerkiraan, setPakaiPerkiraan] = useState(false);

  // The full-history FIFO replay. Memoised on stock/products alone so it does
  // NOT re-run while the user types in the produk box — this walks every
  // movement of every product, and it is the most expensive thing on the page.
  // It also yields the inventory total, so that costs nothing extra.
  const fifo = useMemo(() => buildFifoIndex(stock, products), [stock, products]);
  const costByOrder = useMemo(() => joinOrderCosts(stock, fifo), [stock, fifo]);

  const summary = useMemo(
    () => summarize(filtered, costByOrder),
    [filtered, costByOrder],
  );
  const produkRows = useMemo(
    () => byProduct(filtered, costByOrder, products),
    [filtered, costByOrder, products],
  );
  const pembeliRows = useMemo(
    () => byBuyer(filtered, costByOrder, buyers),
    [filtered, costByOrder, buyers],
  );
  const tren = useMemo(
    () => monthlyTrend(filtered, costByOrder),
    [filtered, costByOrder],
  );
  // Computed whether or not the toggle is on: the banner has to be able to say
  // how many of the excluded rows an estimate would actually reach before the
  // user decides to switch it on.
  const perkiraan = useMemo(
    () => estimateUnpriced(filtered, costByOrder, products),
    [filtered, costByOrder, products],
  );

  // Purchases run through the SAME filter values, so "pembelian periode ini"
  // means the period the user actually picked. Purchases carry no status and no
  // buyerId, so those two filters pass them through untouched (filterRows).
  const tipeById = useMemo(() => buildTipeIndex(products), [products]);
  const pembelian = useMemo(
    () => purchaseTotal(filterRows(purchases, filter.applied, tipeById)),
    [purchases, filter.applied, tipeById],
  );

  // Stock that left without an order behind it. Scoped by the same period and
  // product filters as everything else, matched against the MOVEMENT — it has a
  // tanggal and a productId, but no buyer and no status, so those two filters
  // have nothing to match here and the panel says so.
  const lossScope = useMemo(() => {
    const { exact, from, to, tipe } = filter.applied;
    const q = filter.applied.produk.trim().toLowerCase();
    const byId = new Map(products.map((p) => [p.id, p]));
    return (m: StockMovement) => {
      if (exact) {
        if (m.tanggal !== exact) return false;
      } else {
        if (from && m.tanggal < from) return false;
        if (to && m.tanggal > to) return false;
      }
      if (!q && !tipe) return true;
      const p = byId.get(m.productId);
      if (q && !(p?.namaProduk ?? "").toLowerCase().includes(q)) return false;
      if (tipe && p?.tipe !== tipe) return false;
      return true;
    };
  }, [filter.applied, products]);
  const susut = useMemo(
    () => stockLoss(stock, fifo, lossScope),
    [stock, fifo, lossScope],
  );
  // Susut is not part of Laba Kotor — gross profit is revenue less the cost of
  // what was SOLD — so it lands below it as the only operating cost the app
  // actually records. When there is none, Laba Kotor is the bottom line.
  const labaAkhir = summary.labaKotor - susut.nilai;

  // The estimate is added at the very bottom, after susut, so every line above
  // it stays a measured figure. `pakaiPerkiraan` gates only what is DISPLAYED —
  // nothing above is recomputed, so switching the toggle off returns the page
  // to exactly the numbers it showed before.
  const labaTermasukPerkiraan = labaAkhir + perkiraan.laba;
  const penjualanTermasukPerkiraan = summary.penjualan + perkiraan.penjualan;

  // Both of these are balances at a moment, not flows across the period, so
  // neither is filtered. See docs/2026-08-09/plan.md §6.
  const persediaan = fifo.inventoryValue;
  // `today` is read during render and passed in as a dependency. Calling
  // todayISO() *inside* the memo hid a second input from React: the result would
  // have kept yesterday's ages until `orders` happened to change, so a page left
  // open overnight aged nothing at midnight. This still needs a render to
  // refresh, but it no longer claims to depend only on `orders`.
  const today = todayISO();
  const piutang = useMemo(() => receivables(orders, today), [orders, today]);

  // Nothing to report on. Returned instead of the blocks below, not alongside
  // them: rendering both put a full Rp 0 laba-rugi under the words "belum ada
  // pesanan", and a zero that looks computed is worse than no zero at all.
  if (filtered.length === 0) {
    return (
      <div>
        <Header />
        <FilterBar filter={filter}>
          <StatusField filter={filter} />
        </FilterBar>
        <Panel className="text-center text-faint py-8">
          {filter.hasFilter
            ? "Tidak ada pesanan yang cocok dengan filter ini."
            : "Belum ada pesanan. Catat pesanan di halaman Pesanan dulu."}
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <Header />

      <FilterBar filter={filter}>
        <StatusField filter={filter} />
      </FilterBar>

      {/* 1. Laba rugi.
          The block opens on TOTAL revenue and works down to the part that has a
          cost behind it, so the excluded rows are visible in the arithmetic
          rather than mentioned underneath it. */}
      <Panel>
        <div className="max-w-md">
          <Line
            label="Uang masuk dari penjualan"
            value={formatRupiah(summary.penjualanTotal)}
          />
          {summary.tanpaStokCount > 0 && (
            <>
              <Line
                label={`Modalnya belum diketahui (${formatAngka(
                  summary.tanpaStokCount,
                )} pesanan)`}
                value={`(${formatRupiah(summary.tanpaStokNilai)})`}
                className="text-warn-text"
                muted
              />
              <Line
                label="Penjualan yang bisa dihitung labanya"
                value={formatRupiah(summary.penjualan)}
                divider
              />
            </>
          )}
          <Line
            label="Modal barang yang terjual (HPP)"
            value={`(${formatRupiah(summary.hpp)})`}
            className="text-negative"
          />
          {susut.count > 0 ? (
            <>
              <Line
                label="Laba kotor"
                value={formatRupiah(summary.labaKotor)}
                divider
                className={summary.labaKotor < 0 ? "text-negative" : ""}
              />
              <Line
                label={`Stok hilang, rusak, atau dipakai sendiri (${formatAngka(
                  susut.count,
                )} catatan)`}
                value={`(${formatRupiah(susut.nilai)})`}
                className="text-negative"
                muted
              />
              <Total
                label="Laba setelah stok hilang"
                value={labaAkhir}
                pct={
                  summary.penjualan === 0
                    ? null
                    : (labaAkhir / summary.penjualan) * 100
                }
                strong={!pakaiPerkiraan || perkiraan.count === 0}
              />
            </>
          ) : (
            <Total
              label="Laba kotor"
              value={summary.labaKotor}
              pct={summary.marginPct}
              strong={!pakaiPerkiraan || perkiraan.count === 0}
            />
          )}

          {/* The estimate, kept below the bottom line rather than folded into
              it. Every figure above is a cost the stock ledger can point at;
              these two are an assumption, and the moment the two are added in
              one column nobody can tell them apart again. */}
          {pakaiPerkiraan && perkiraan.count > 0 && (
            <div className="mt-4 pt-3 border-t border-dashed border-warn-line">
              <p className="text-xs uppercase tracking-wide font-semibold text-warn-text mb-1">
                Perkiraan — bukan angka pasti
              </p>
              <Line
                label={`Penjualan yang modalnya dikira-kira (${formatAngka(
                  perkiraan.count,
                )} pesanan)`}
                value={formatRupiah(perkiraan.penjualan)}
                muted
              />
              <Line
                label="Perkiraan modal, dari Harga Dasar"
                value={`(${formatRupiah(perkiraan.hpp)})`}
                className="text-negative"
                muted
              />
              <Total
                label="Laba termasuk perkiraan"
                value={labaTermasukPerkiraan}
                pct={
                  penjualanTermasukPerkiraan === 0
                    ? null
                    : (labaTermasukPerkiraan / penjualanTermasukPerkiraan) * 100
                }
                approx
              />
            </div>
          )}
        </div>

        {/* Susut is scoped by MOVEMENT, and a movement carries neither a buyer
            nor a payment status — so those two filters cannot narrow it, and it
            keeps its full value while everything above it shrinks. Saying so
            beats printing a figure the user believes narrowed when it did not. */}
        {susut.count > 0 &&
          (filter.applied.pembeli !== "" ||
            filter.applied.status !== "semua") && (
          <p className="mt-3 text-sm text-warn-text">
            Angka stok hilang di atas tidak ikut filter{" "}
            {filter.applied.pembeli !== "" && "pembeli"}
            {filter.applied.pembeli !== "" &&
              filter.applied.status !== "semua" &&
              " dan "}
            {filter.applied.status !== "semua" && "status"} — stok yang hilang
            atau disesuaikan tidak terhubung ke pembeli mana pun, dan tidak punya
            status bayar. Nilainya tetap penuh untuk periode ini.
          </p>
        )}

        {/* Stock that left with no lot behind it. Its cost is unknown, not
            zero, so it is left out of the figure above and counted here — the
            same rule the quarantined orders follow. */}
        {susut.tanpaModal > 0 && (
          <p className="mt-3 text-sm text-warn-text">
            Ada {formatAngka(susut.tanpaModal)} catatan stok keluar yang
            modalnya belum diketahui, jadi nilainya belum ikut dikurangkan di
            atas. Catat pembeliannya di halaman Beli Stok supaya nilainya
            terhitung.
          </p>
        )}

        {/* Quarantined rows. Not noise — a to-do list. Each one is an order
            whose modal cannot be stated as fact: no stock movement at all, or a
            sale FIFO could not fully source from any purchase lot. */}
        {summary.tanpaStokCount > 0 && (
          <div className="mt-3 text-sm text-warn-text bg-warn-soft border border-warn-line rounded-lg px-3 py-2.5">
            <p className="font-semibold">
              Kenapa ada pesanan yang modalnya belum diketahui?
            </p>
            <p className="mt-1">
              Dua sebab: pilihan “potong stok” tidak dicentang waktu pesanan
              dicatat, atau barangnya terjual tanpa ada catatan pembelian yang
              menutupi. Penjualannya nyata — yang belum diketahui hanya
              modalnya. Baris itu dikeluarkan dulu supaya laba tidak terlihat
              lebih besar dari yang sebenarnya.
            </p>

            {/* The toggle sits inside the banner it answers: the sentence above
                explains the problem, and the fix is the next thing the eye
                reaches instead of a setting somewhere else on the page. */}
            {perkiraan.count > 0 && (
              <label className="mt-2.5 flex items-start gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={pakaiPerkiraan}
                  onChange={(e) => setPakaiPerkiraan(e.target.checked)}
                  className="mt-0.5 w-4 h-4 shrink-0 accent-warn"
                />
                <span>
                  Kira-kira modalnya pakai Harga Dasar produk (
                  {formatAngka(perkiraan.count)} dari{" "}
                  {formatAngka(summary.tanpaStokCount)} pesanan)
                  <span className="block font-normal">
                    Hasilnya perkiraan, bukan angka pasti — dipakai untuk
                    gambaran kasar, jangan untuk laporan pajak.
                  </span>
                </span>
              </label>
            )}

            {pakaiPerkiraan && perkiraan.sisaCount > 0 && (
              <p className="mt-2">
                {formatAngka(perkiraan.sisaCount)} pesanan (
                {formatRupiah(perkiraan.sisaNilai)}) tetap tidak bisa
                dikira-kira: produknya sudah dihapus, atau Harga Dasar-nya masih
                0. Isi Harga Dasar di halaman Produk supaya ikut terhitung.
              </p>
            )}
          </div>
        )}

        {/* A double-deducted order is a data bug, not a reporting one: the
            stock ledger really did record the sale twice, so the HPP above is
            genuinely inflated. Say so rather than silently halving it. */}
        {summary.dobelCount > 0 && <DobelWarning count={summary.dobelCount} />}

        <p className="mt-3 text-xs text-faint">
          Belum ada laba bersih di sini: aplikasi belum mencatat biaya
          operasional (sewa, gaji, transport), jadi tidak ada yang bisa
          dikurangkan dari laba kotor.
        </p>
      </Panel>

      {/* 2. The same laba-rugi, drawn. Charts come straight after the block
          they picture, and every bar's value is printed beside it — see
          Chart.tsx. */}
      <Panel>
        <h2 className="text-lg font-bold mb-1">Grafik penjualan per bulan</h2>
        <p className="text-sm text-faint mb-3">
          Panjang batang = besar penjualan. Bagian abu-abu adalah modal
          barangnya, bagian hijau adalah laba. Batang merah berarti bulan itu
          rugi — barangnya terjual lebih murah dari modalnya.
        </p>
        <CompositionChart
          rows={tren.slice(-CHART_MONTHS).map((t) => ({
            key: t.bulan,
            label: formatBulanPendek(t.bulan),
            penjualan: t.penjualan,
            hpp: t.hpp,
            laba: t.laba,
            marginPct: t.penjualan === 0 ? null : (t.laba / t.penjualan) * 100,
          }))}
          empty={
            <p className="text-sm text-faint py-4 text-center">
              Belum ada pesanan yang modalnya diketahui di periode ini, jadi
              belum ada yang bisa digambar.
            </p>
          }
        />
      </Panel>

      <Panel>
        <h2 className="text-lg font-bold mb-1">
          Produk penyumbang laba terbesar
        </h2>
        <p className="text-sm text-faint mb-3">
          {CHART_ROWS} teratas dan, kalau ada, yang paling merugi. Daftar
          lengkapnya ada di tabel “Margin per produk” di bawah.
        </p>
        <ContributionChart
          rows={topContributors(produkRows).map((r) => ({
            key: r.key,
            label:
              r.key === "" ? (
                r.label
              ) : (
                <Link
                  to="/produk/$id"
                  params={{ id: r.key }}
                  className="text-brand hover:underline font-medium"
                >
                  {r.label}
                </Link>
              ),
            value: r.laba,
          }))}
          empty={
            <p className="text-sm text-faint py-4 text-center">
              Belum ada pesanan dengan catatan stok di periode ini.
            </p>
          }
        />
      </Panel>

      {/* 3. Context figures, deliberately OUTSIDE the arithmetic above.
          Pembelian is cash moving into persediaan, not an expense: its cost
          only becomes HPP when FIFO releases it on a sale. Subtracting it here
          would double-count the goods. */}
      <Panel>
        <h2 className="text-lg font-bold mb-1">Di luar perhitungan di atas</h2>
        <p className="text-sm text-faint mb-3">
          Belanja stok bukan biaya — uangnya berubah jadi barang di gudang, dan
          baru dihitung sebagai modal waktu barangnya terjual. Nilai stok dan
          uang yang belum dibayar adalah posisi hari ini, bukan angka periode,
          jadi keduanya tidak ikut difilter.
        </p>
        <div className="flex gap-6 flex-wrap">
          <Stat
            label="Belanja stok periode ini"
            value={formatRupiah(pembelian)}
            className={filter.applied.pembeli ? "text-faint" : ""}
          />
          <Stat
            label="Nilai stok yang masih ada"
            value={formatRupiah(persediaan)}
          />
          <Stat
            label="Belum dibayar pembeli"
            value={formatRupiah(piutang.total)}
            className={piutang.total > 0 ? "text-warn" : ""}
          />
        </div>

        {/* Pembelian follows the tanggal, produk and tipe filters, but NOT
            pembeli: Beli Stok records what we bought, and its counterpart is a
            supplier, not a pembeli. Without this note the figure reads as
            "what I bought for Bu Ani", which it is not. */}
        {(filter.applied.pembeli !== "" ||
          filter.applied.status !== "semua") && (
          <p className="mt-3 text-sm text-warn-text">
            Filter pembeli dan status tidak berlaku untuk belanja stok — stok
            dibeli dari supplier, bukan per pembeli, dan barisnya tidak punya
            status bayar. Angka belanja stok di atas masih untuk semuanya.
          </p>
        )}
      </Panel>

      {/* 4. Piutang */}
      <Panel>
        <h2 className="text-lg font-bold mb-1">
          Uang yang belum dibayar pembeli
        </h2>
        <p className="text-sm text-faint mb-3">
          Semua pesanan yang belum lunas, berapa pun tanggalnya. Status bayar
          tidak menyimpan tanggal pelunasan, jadi ini posisi hari ini. Makin ke
          kanan kelompoknya, makin lama uangnya belum masuk.
        </p>
        {piutang.count === 0 ? (
          <p className="text-sm text-faint">
            Semua pesanan sudah dibayar. 🎉
          </p>
        ) : (
          <div className="flex gap-6 flex-wrap">
            <Stat label="Total" value={formatRupiah(piutang.total)} />
            <Stat label="Jumlah pesanan" value={formatAngka(piutang.count)} />
            <Stat label="0–30 hari" value={formatRupiah(piutang.d0_30)} />
            <Stat
              label="31–60 hari"
              value={formatRupiah(piutang.d31_60)}
              className={piutang.d31_60 > 0 ? "text-warn" : ""}
            />
            <Stat
              label="Lebih dari 60 hari"
              value={formatRupiah(piutang.d60plus)}
              className={piutang.d60plus > 0 ? "text-negative" : ""}
            />
          </div>
        )}
        {/* Aged into the oldest bucket rather than the newest: an unreadable
            date is a reason to chase the row, not to assume it is fresh. */}
        {piutang.tanggalTidakValid > 0 && (
          <p className="mt-3 text-sm text-warn-text">
            {formatAngka(piutang.tanggalTidakValid)} pesanan tanggalnya tidak
            terbaca, jadi dimasukkan ke kelompok lebih dari 60 hari. Perbaiki
            tanggalnya di halaman Pesanan supaya umurnya benar.
          </p>
        )}
      </Panel>

      {/* 5. Margin per produk */}
      <Panel>
        <h2 className="text-lg font-bold mb-1">Margin per produk</h2>
        <p className="text-sm text-faint mb-3">
          Urut dari penyumbang laba terbesar; klik judul kolom untuk mengurutkan
          ulang. Baris merah berarti barangnya terjual lebih murah dari
          modalnya — biasanya harga beli sudah naik tapi harga jual belum ikut.
        </p>
        <MarginTable rows={produkRows} showQty />
        <TableCaveats
          susutNilai={susut.count > 0 ? susut.nilai : 0}
          dobelCount={summary.dobelCount}
          tanpaStokCount={summary.tanpaStokCount}
        />
      </Panel>

      {/* 6. Margin per pembeli */}
      <Panel>
        <h2 className="text-lg font-bold mb-1">Margin per pembeli</h2>
        <p className="text-sm text-faint mb-3">
          Pembeli mana yang paling menguntungkan. Klik judul kolom untuk
          mengurutkan ulang.
        </p>
        <MarginTable rows={pembeliRows} linkBuyer />
        <TableCaveats
          susutNilai={susut.count > 0 ? susut.nilai : 0}
          dobelCount={summary.dobelCount}
          tanpaStokCount={summary.tanpaStokCount}
        />
      </Panel>
    </div>
  );
}

// The chart's rows: the best contributors, plus every loss-making row. A loss is
// never truncated away — it is the row the owner most needs to see, and it sorts
// to the bottom of a profit-descending list, which is exactly where a `slice`
// would cut it off.
function topContributors(rows: MarginRow[]): MarginRow[] {
  const top = rows.slice(0, CHART_ROWS);
  const losses = rows.filter((r) => r.laba < 0 && !top.includes(r));
  return [...top, ...losses];
}

function Header() {
  return (
    <>
      <h1 className="text-2xl font-bold mb-1">Laba Rugi</h1>
      <p className="text-faint mb-4">
        Berapa uang yang masuk dari penjualan, berapa modal barang yang terjual,
        dan berapa sisanya jadi laba. Modal dihitung dari harga beli yang
        sebenarnya, stok yang lebih dulu masuk dianggap lebih dulu keluar
        (FIFO).
      </p>
    </>
  );
}

// Status belongs on this page for the same reason it belongs on Pesanan: "laba
// dari yang sudah dibayar" is a different question from "laba dari semua yang
// keluar", and both docs assumed it was here. It rides in as FilterBar children
// exactly as OrdersPage does it.
function StatusField({
  filter,
}: {
  filter: { values: { status: StatusFilter }; set: (p: { status: StatusFilter }) => void };
}) {
  return (
    <Field label="Status" className="w-36">
      <Select
        value={filter.values.status}
        onChange={(e) => filter.set({ status: e.target.value as StatusFilter })}
      >
        <option value="semua">Semua</option>
        <option value="pending">Pending</option>
        <option value="paid">Paid</option>
      </Select>
    </Field>
  );
}

// The same warning the laba-rugi block carries, repeated under each margin
// table. The banner used to live only in the block above, so someone who
// scrolled straight to a product row read an inflated HPP with nothing beside
// it saying so — the warning has to sit with every figure it applies to.
function DobelWarning({ count }: { count: number }) {
  return (
    <p className="mt-3 text-sm font-semibold text-negative-text bg-negative-soft border border-negative-line rounded-lg px-3 py-2">
      {formatAngka(count)} pesanan punya lebih dari satu catatan penjualan, jadi
      stoknya terpotong dua kali dan angka modalnya ikut menggelembung. Biasanya
      ini pesanan yang sudah memotong stok lalu dibelikan lagi lewat “Beli stok
      dari pesanan”. Periksa di halaman Stok.
    </p>
  );
}

// What a margin table does NOT contain. Both tables sum back to Laba Kotor, not
// to the page's bottom line: susut has no product and no buyer to belong to, and
// the quarantined orders were never priced. Without this, adding the Laba column
// up and finding it disagrees with the total looks like a bug in the app.
function TableCaveats({
  susutNilai,
  dobelCount,
  tanpaStokCount,
}: {
  susutNilai: number;
  dobelCount: number;
  tanpaStokCount: number;
}) {
  if (susutNilai === 0 && dobelCount === 0 && tanpaStokCount === 0) return null;
  return (
    <>
      <p className="mt-3 text-xs text-faint">
        Kalau kolom Laba di sini dijumlahkan, hasilnya laba kotor — bukan angka
        paling bawah di blok Laba Rugi.
        {tanpaStokCount > 0 &&
          ` ${formatAngka(tanpaStokCount)} pesanan yang modalnya belum diketahui tidak masuk tabel ini.`}
        {susutNilai > 0 &&
          ` Stok hilang senilai ${formatRupiah(susutNilai)} juga tidak masuk — barang yang hilang tidak punya pembeli.`}
      </p>
      {dobelCount > 0 && <DobelWarning count={dobelCount} />}
    </>
  );
}

function Line({
  label,
  value,
  className = "",
  divider = false,
  muted = false,
}: {
  label: string;
  value: string;
  className?: string;
  // A thin rule above, for an intermediate subtotal. The heavy rule is Total's.
  divider?: boolean;
  // Indented and smaller: a deduction from the line above, not a peer of it.
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-3 py-1 ${
        divider ? "border-t border-line-strong mt-1 pt-2" : ""
      }`}
    >
      <span
        className={`flex-1 ${muted ? "pl-4 text-sm text-faint" : "text-muted"}`}
      >
        {label}
      </span>
      <span
        className={`tabular-nums ${muted ? "text-sm" : "font-semibold"} ${className}`}
      >
        {value}
      </span>
      <span className="w-16" />
    </div>
  );
}

// The one bold line the eye lands on. Whatever sits here is the bottom line, so
// there is exactly one per block — except while the estimate is switched on,
// where the measured total steps back (`strong: false`) and the estimated one
// takes the weight, marked "≈" so it can never be mistaken for a counted figure.
function Total({
  label,
  value,
  pct,
  strong = true,
  approx = false,
}: {
  label: string;
  value: number;
  pct: number | null;
  strong?: boolean;
  approx?: boolean;
}) {
  return (
    <div
      className={`mt-1 pt-2 flex items-baseline gap-3 ${
        strong ? "border-t-2 border-line-inverse" : "border-t border-line-strong"
      }`}
    >
      <span className={`flex-1 font-bold ${strong ? "text-lg" : ""}`}>
        {label}
      </span>
      <span
        className={`font-bold tabular-nums ${strong ? "text-xl" : ""} ${
          value < 0 ? "text-negative" : approx ? "text-warn-text" : "text-ok-text"
        }`}
      >
        {approx ? "≈ " : ""}
        {formatRupiah(value)}
      </span>
      <span className="text-sm font-semibold text-faint tabular-nums w-16 text-right">
        {formatPersen(pct)}
      </span>
    </div>
  );
}

// ---------- Margin tables ----------

type SortKey = "label" | "qty" | "penjualan" | "hpp" | "laba" | "marginPct";
type SortDir = "asc" | "desc";
interface Sort {
  key: SortKey;
  dir: SortDir;
}

// Sorting lives here rather than in `byProduct`/`byBuyer` because it is a view
// choice, not a fact about the data: the report functions keep their
// profit-descending default so the charts and the tables open the same way.
function sortRows(rows: MarginRow[], { key, dir }: Sort): MarginRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "label") return sign * a.label.localeCompare(b.label, "id");
    const av = a[key];
    const bv = b[key];
    // A row with no revenue has no margin to compare — see `marginOf`. It sorts
    // last in BOTH directions: "—" is not smaller than -40%, it is unknown, and
    // letting it head the ascending list would name it the worst product.
    if (av === null || bv === null) {
      if (av === bv) return 0;
      return av === null ? 1 : -1;
    }
    return sign * (av - bv);
  });
}

const SORT_OPTIONS: { value: string; label: string; sort: Sort }[] = [
  { value: "laba-desc", label: "Laba terbesar", sort: { key: "laba", dir: "desc" } },
  { value: "laba-asc", label: "Laba terkecil / rugi", sort: { key: "laba", dir: "asc" } },
  { value: "marginPct-desc", label: "Margin tertinggi", sort: { key: "marginPct", dir: "desc" } },
  { value: "marginPct-asc", label: "Margin terendah", sort: { key: "marginPct", dir: "asc" } },
  { value: "penjualan-desc", label: "Penjualan terbesar", sort: { key: "penjualan", dir: "desc" } },
  { value: "label-asc", label: "Nama A–Z", sort: { key: "label", dir: "asc" } },
];

function MarginTable({
  rows,
  showQty = false,
  linkBuyer = false,
}: {
  rows: MarginRow[];
  showQty?: boolean;
  linkBuyer?: boolean;
}) {
  // Defaults to the order `byProduct` already returns, so the table looks the
  // same as it did before anyone touched a header.
  const [sort, setSort] = useState<Sort>({ key: "laba", dir: "desc" });
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  // Numbers open on their largest value, names on A–Z: clicking "Laba" and
  // getting the smallest first is never what the click meant.
  const toggle = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "label" ? "asc" : "desc" },
    );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-faint py-4 text-center">
        Belum ada pesanan dengan catatan stok di periode ini.
      </p>
    );
  }

  const nameLabel = linkBuyer ? "Pembeli" : "Produk";

  return (
    <>
      {/* The phone layout. Six columns do not fit on 390px, so below `md` the
          row collapses to what it IS on the left and what it is WORTH on the
          right: Qty (when shown) restacks under the label, and the penjualan
          − HPP arithmetic plus the margin percentage restack under Laba.
          Sorting cannot ride on the two headers here — four of the six sortable
          columns are not headers on a phone at all — so it gets one select. */}
      <div className="md:hidden">
        <div className="px-2.5 mb-2">
          <Field label="Urutkan">
            <Select
              value={
                SORT_OPTIONS.find(
                  (o) => o.sort.key === sort.key && o.sort.dir === sort.dir,
                )?.value ?? "laba-desc"
              }
              onChange={(e) => {
                const found = SORT_OPTIONS.find((o) => o.value === e.target.value);
                if (found) setSort(found.sort);
              }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <MobileList left={nameLabel} right="Laba">
          {sorted.map((r) => (
            <MobileRow
              key={r.key}
              title={
                linkBuyer && r.key !== "" ? (
                  <Link
                    to="/pembeli/$id"
                    params={{ id: r.key }}
                    className="text-brand hover:underline font-medium"
                  >
                    {r.label}
                  </Link>
                ) : !linkBuyer && r.key !== "" ? (
                  <Link
                    to="/produk/$id"
                    params={{ id: r.key }}
                    className="text-brand hover:underline font-medium"
                  >
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )
              }
              // The desktop has a "Qty" column header to explain the number;
              // the phone layout does not, so the label rides with the value.
              meta={showQty && <span>Qty {formatAngka(r.qty)}</span>}
              value={
                <span className={r.laba < 0 ? "text-negative" : ""}>
                  {formatRupiah(r.laba)}
                </span>
              }
              note={
                <>
                  {formatRupiah(r.penjualan)} − {formatRupiah(r.hpp)} (
                  <span
                    className={
                      r.laba < 0 ? "text-negative font-semibold" : ""
                    }
                  >
                    {formatPersen(r.marginPct)}
                  </span>
                  )
                </>
              }
            />
          ))}
        </MobileList>
      </div>

      <div className="overflow-x-auto hidden md:block">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <SortTh sort={sort} onSort={toggle} col="label" label={nameLabel} />
            {showQty && (
              <SortTh sort={sort} onSort={toggle} col="qty" label="Qty" num />
            )}
            <SortTh
              sort={sort}
              onSort={toggle}
              col="penjualan"
              label="Penjualan"
              num
            />
            <SortTh sort={sort} onSort={toggle} col="hpp" label="Modal" num />
            <SortTh sort={sort} onSort={toggle} col="laba" label="Laba" num />
            <SortTh
              sort={sort}
              onSort={toggle}
              col="marginPct"
              label="Margin"
              num
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key} className="hover:bg-surface-sunken">
              <td className={tdClass}>
                {linkBuyer && r.key !== "" ? (
                  <Link
                    to="/pembeli/$id"
                    params={{ id: r.key }}
                    className="text-brand hover:underline font-medium"
                  >
                    {r.label}
                  </Link>
                ) : !linkBuyer && r.key !== "" ? (
                  <Link
                    to="/produk/$id"
                    params={{ id: r.key }}
                    className="text-brand hover:underline font-medium"
                  >
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
              </td>
              {showQty && (
                <td className={`${tdClass} text-right tabular-nums`}>
                  {formatAngka(r.qty)}
                </td>
              )}
              <td className={`${tdClass} text-right tabular-nums`}>
                {formatRupiah(r.penjualan)}
              </td>
              <td className={`${tdClass} text-right tabular-nums text-faint`}>
                {formatRupiah(r.hpp)}
              </td>
              <td
                className={`${tdClass} text-right tabular-nums font-semibold ${
                  r.laba < 0 ? "text-negative" : ""
                }`}
              >
                {formatRupiah(r.laba)}
              </td>
              <td
                className={`${tdClass} text-right tabular-nums ${
                  r.laba < 0 ? "text-negative font-semibold" : "text-faint"
                }`}
              >
                {formatPersen(r.marginPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

// The same markup as DataTable's `SortHeader`, driven by this page's own sort
// state instead of a TanStack column — these two tables are built by hand from
// `MarginRow[]`, not from a table instance.
function SortTh({
  sort,
  onSort,
  col,
  label,
  num = false,
}: {
  sort: Sort;
  onSort: (key: SortKey) => void;
  col: SortKey;
  label: string;
  num?: boolean;
}) {
  const active = sort.key === col;
  return (
    <th
      scope="col"
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
      className={`${thClass} ${num ? "text-right" : ""}`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 w-full cursor-pointer select-none uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
          num ? "justify-end" : ""
        }`}
      >
        {label}
        {/* Fixed width so the label does not shift sideways when the arrow
            appears. */}
        <span aria-hidden className="w-3 shrink-0 text-faint">
          {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );
}
