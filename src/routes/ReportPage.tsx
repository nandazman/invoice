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
  trendInsight,
  paretoProfit,
  type MarginRow,
  type ProfitSummary,
  type TrendInsight,
} from "../lib/report";
import {
  useOrderFilter,
  buildTipeIndex,
  filterRows,
  type StatusFilter,
} from "../lib/useOrderFilter";
import type { StockMovement } from "../lib/types";
import { checkIntegrity } from "../lib/integrity";
import {
  formatRupiah,
  formatAngka,
  formatPersen,
  formatBulanPendek,
  periodeLabel,
  todayISO,
} from "../lib/format";
import { FilterBar } from "../components/FilterBar";
import { Chip } from "../components/Chip";
import { Field } from "../components/Field";
import { Panel } from "../components/Panel";
import { Select } from "../components/Select";
import { Stat } from "../components/Stat";
import { thClass, tdClass } from "../components/DataTable";
import { MobileList, MobileRow } from "../components/MobileList";
import {
  WaterfallChart,
  TrendChart,
  ParetoBars,
  ChartNote,
  type WaterfallStep,
} from "../components/Chart";

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

  // Deliberately NOT filtered: a dangling row from outside the selected period
  // is still a dangling row, and hiding it behind a date filter is how this
  // went unnoticed for two weeks in September.
  const integrity = useMemo(
    () => checkIntegrity(stock, orders, purchases),
    [stock, orders, purchases],
  );

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

  // Declared before the memos rather than beside the first one that needs it:
  // four blocks below re-apply the filter to a list the hook does not own
  // (purchases, and orders re-scoped for tren and piutang), and a `const` read
  // above its declaration in this body is a TDZ crash, not a warning.
  const tipeById = useMemo(() => buildTipeIndex(products), [products]);

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
  // The one panel that deliberately ignores the DATE filter, and says so in its
  // chip. A trend is a comparison, and a comparison needs something to compare
  // against: filtered to Agustus this drew a single column and captioned it
  // against nothing. So the window stays twelve months wide and the filtered
  // months are highlighted inside it. Every other filter still applies — narrow
  // to one product and you get that product's trend, which is the useful case.
  const trenScope = useMemo(
    () => ({ ...filter.applied, exact: "", from: "", to: "" }),
    [filter.applied],
  );
  const tren = useMemo(
    () => monthlyTrend(filterRows(orders, trenScope, tipeById), costByOrder),
    [orders, trenScope, tipeById, costByOrder],
  );
  const trenTampil = useMemo(() => tren.slice(-CHART_MONTHS), [tren]);
  // Which of the drawn months the date filter actually covers. Compared as
  // yyyy-mm strings against the yyyy-mm-dd bounds: a month is in view if it
  // overlaps the range at all, so a 15 Jul – 15 Sep filter lights up all three.
  const fokusBulan = useMemo(() => {
    const { exact, from, to } = filter.applied;
    if (exact) return new Set([exact.slice(0, 7)]);
    if (!from && !to) return null; // no date filter: every month is in focus
    const set = new Set<string>();
    for (const r of trenTampil) {
      if (from && r.bulan < from.slice(0, 7)) continue;
      if (to && r.bulan > to.slice(0, 7)) continue;
      set.add(r.bulan);
    }
    return set;
  }, [filter.applied, trenTampil]);
  // The caption reads the prefix ENDING at the last focused month, not the last
  // month drawn. Otherwise filtering to Agustus would light up August's column
  // and then caption the chart about September, which is the same
  // filter-says-one-thing-number-says-another problem this page had.
  const insight = useMemo(() => {
    if (!fokusBulan) return trendInsight(trenTampil);
    let akhir = -1;
    trenTampil.forEach((r, i) => {
      if (fokusBulan.has(r.bulan)) akhir = i;
    });
    return akhir < 0 ? null : trendInsight(trenTampil.slice(0, akhir + 1));
  }, [trenTampil, fokusBulan]);
  const pareto = useMemo(() => paretoProfit(produkRows), [produkRows]);
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

  // A balance at a moment, not a flow across the period, and unlike piutang it
  // cannot be scoped to one either: FIFO leaves exactly one stack per product,
  // and "the stock on hand during August" is not a thing the replay produces.
  // The Stat says so on its own line. See docs/2026-08-09/plan.md §6.
  const persediaan = fifo.inventoryValue;

  // `today` is read during render and passed in as a dependency. Calling
  // todayISO() *inside* the memo hid a second input from React: the result would
  // have kept yesterday's ages until `orders` happened to change, so a page left
  // open overnight aged nothing at midnight. This still needs a render to
  // refresh, but it no longer claims to depend only on `orders`.
  const today = todayISO();

  // Piutang follows every filter EXCEPT status. The panel is itself the pending
  // filter, so layering "lunas" on top could only ever zero it out — the user
  // would have picked a status and been shown an empty piutang block as if the
  // money were collected. The note under the panel says the status filter is
  // ignored here, the same way the belanja-stok note does.
  const piutangScope = useMemo(
    () => ({ ...filter.applied, status: "semua" as StatusFilter }),
    [filter.applied],
  );
  const piutang = useMemo(
    () => receivables(filterRows(orders, piutangScope, tipeById), today),
    [orders, piutangScope, tipeById, today],
  );
  // The whole-history figure, kept so the filtered one can be reconciled against
  // it rather than quietly replacing it. Without this line a period filter would
  // hide money instead of scoping it: an order from another month that is still
  // unpaid is exactly the kind of thing a report must not drop.
  const piutangSemua = useMemo(() => receivables(orders, today), [orders, today]);
  const piutangLuar = piutangSemua.total - piutang.total;

  // Every panel in the top band prints one of these. `periode` is empty when no
  // date filter is set, and a chip still has to say something — an absent chip
  // would read as "this one is different" on exactly the panels that are not.
  const periode = periodeLabel(filter.applied);
  const periodeChip = periode || "Semua tanggal";
  // Purchases carry no buyerId and no status, and stock movements carry neither
  // either, so those two dropdowns cannot reach them. Stated on the chip rather
  // than in a warning that only appears once the user has already been misled.
  const sebagian =
    filter.applied.pembeli !== "" || filter.applied.status !== "semua";

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

      {/* 0. Integrity. Above everything, outside every filter, and rendered
          only when something is actually wrong — so it is an alarm rather than
          a permanent panel people learn to scroll past. It reports the whole
          dataset on purpose: a broken link from a date outside the current
          filter is still broken. See lib/integrity.ts. */}
      {integrity.total > 0 && (
        <Panel>
          <PanelHead
            title="Ada data yang tidak cocok"
            scope={<Chip tone="partial">seluruh riwayat</Chip>}
          />
          <p className="text-sm text-warn-text mb-3">
            Ada baris stok yang menunjuk ke pesanan atau pembelian yang sudah
            tidak ada. Ini tidak bisa terjadi lewat tombol hapus biasa — menghapus
            pesanan ikut menghapus baris stoknya — jadi induknya hilang lewat
            jalan lain: tabel yang terhapus sebelum tersinkron, atau pemulihan
            cadangan yang setengah jalan.
          </p>
          <ul className="text-sm space-y-2">
            {integrity.findings.map((f) => (
              <li key={f.kind}>
                <span className="font-semibold">
                  {f.movements.length} baris stok
                </span>{" "}
                menunjuk ke {f.missingIds.length}{" "}
                {f.kind === "order" ? "pesanan" : "pembelian"} yang hilang
                {/* The dates are the actionable part: they name the session
                    that broke, which is how the September loss was traced. */}
                {f.dates.length > 0 && <> — tanggal {f.dates.join(", ")}</>}.
              </li>
            ))}
          </ul>
          <p className="text-sm text-faint mt-3">
            Angka laba dan stok di bawah ini tidak menghitung baris-baris itu
            dengan benar sampai induknya dipulihkan.
          </p>
        </Panel>
      )}

      <Band
        title="Selama periode"
        sub={
          periode
            ? `Angka di bawah ini bergerak mengikuti filter: ${periode}.`
            : "Angka di bawah ini bergerak mengikuti filter. Belum ada filter tanggal, jadi ini seluruh riwayat."
        }
      />

      {/* 1. Laba rugi.
          The block opens on TOTAL revenue and works down to the part that has a
          cost behind it, so the excluded rows are visible in the arithmetic
          rather than mentioned underneath it. */}
      <Panel>
        <PanelHead title="Laba rugi" scope={<Chip>{periodeChip}</Chip>} />
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

      {/* 2. The laba-rugi block, drawn as the bridge it is. A waterfall is the
          chart for "where did the money go": each bar starts where the last one
          ended, so the drop from penjualan to laba is a distance you can see
          rather than a subtraction you have to do. */}
      <Panel>
        <PanelHead
          title="Ke mana uang penjualannya"
          scope={<Chip>{periodeChip}</Chip>}
        />
        <p className="text-sm text-faint mb-3">
          Batang biru adalah semua uang yang masuk. Setiap batang merah
          memotongnya, dan batang paling bawah adalah sisanya.
        </p>
        {summary.penjualanTotal > 0 && (
          <ChartNote tone={labaAkhir < 0 ? "buruk" : "netral"}>
            {komposisiPenjualan(summary, susut.nilai, labaAkhir)}
          </ChartNote>
        )}
        <WaterfallChart steps={waterfallSteps(summary, susut.nilai, labaAkhir)} />
      </Panel>

      {/* 3. Trend. Columns because time has an axis, plus the margin line on
          top: a month can grow and get worse at once, and the two marks
          together are the only way to see that. */}
      <Panel>
        <PanelHead
          title="Naik atau turun tiap bulan"
          scope={
            <Chip tone={fokusBulan ? "partial" : "period"}>
              {fokusBulan
                ? `12 bulan terakhir · ${periode} disorot`
                : "12 bulan terakhir"}
            </Chip>
          }
        />
        <p className="text-sm text-faint mb-3">
          Batang biru penjualan, batang abu-abu modalnya. Kalau yang abu-abu
          lebih tinggi, bulan itu rugi. Garis oranye margin, skalanya di sumbu
          kanan. Batang bisa membesar sementara garisnya turun — jualan makin
          banyak, tapi untung per rupiahnya makin tipis.
        </p>
        {/* The one place a filter is deliberately not obeyed, so it is said out
            loud instead of left to the chip alone. Cutting the chart down to the
            filtered months would leave a single column and a caption comparing
            it to nothing, which is not a trend. */}
        {fokusBulan && (
          <p className="text-sm text-warn-text mb-3">
            Filter tanggal sengaja tidak dipakai di sini — tren butuh bulan
            pembanding. Bulan yang kamu filter dicetak tebal, sisanya dibuat
            samar sebagai pembanding.
          </p>
        )}
        {trenTampil.length === 0 ? (
          <p className="text-sm text-faint py-4 text-center">
            Belum ada pesanan yang modalnya diketahui, jadi belum ada yang bisa
            digambar.
          </p>
        ) : (
          <>
            {insight && (
              <ChartNote tone={trenTone(insight.selisihPoin)}>
                {trenKalimat(insight, trenTampil.length)}
              </ChartNote>
            )}
            <TrendChart
              points={trenTampil.map((t) => ({
                key: t.bulan,
                label: formatBulanPendek(t.bulan),
                penjualan: t.penjualan,
                hpp: t.hpp,
                laba: t.laba,
                marginPct:
                  t.penjualan === 0 ? null : (t.laba / t.penjualan) * 100,
                dim: fokusBulan ? !fokusBulan.has(t.bulan) : false,
              }))}
            />
          </>
        )}
      </Panel>

      {/* 4. Pareto. The ranking is the leaderboard; the running percentage is
          the answer — how few products the whole profit actually rests on. */}
      <Panel>
        <PanelHead
          title="Produk mana yang bawa labanya"
          scope={<Chip>{periodeChip}</Chip>}
        />
        <p className="text-sm text-faint mb-3">
          Urut dari penyumbang terbesar. Panjang blok biru = besar labanya
          dibanding produk teratas.
        </p>
        {pareto.untung.length === 0 && pareto.rugi.length === 0 ? (
          <p className="text-sm text-faint py-4 text-center">
            Belum ada pesanan dengan catatan stok di periode ini.
          </p>
        ) : (
          <>
            {pareto.inti > 0 && (
              <ChartNote>
                {formatAngka(pareto.inti)} dari{" "}
                {formatAngka(pareto.untung.length)} produk menghasilkan 80% laba
                Anda. Kalau salah satunya berhenti laku atau harga belinya naik,
                labanya langsung terasa.
              </ChartNote>
            )}
            {pareto.untung.length > 0 && (
              <ParetoBars
                inti={pareto.inti}
                bars={pareto.untung.slice(0, CHART_ROWS).map((p) => ({
                  key: p.row.key,
                  label: <RowLabel row={p.row} />,
                  value: p.row.laba,
                }))}
              />
            )}
            {pareto.untung.length > CHART_ROWS && (
              <p className="mt-2 text-sm text-faint">
                Ditambah {formatAngka(pareto.untung.length - CHART_ROWS)} produk
                lain senilai{" "}
                {formatRupiah(
                  pareto.totalUntung -
                    pareto.untung
                      .slice(0, CHART_ROWS)
                      .reduce((n, p) => n + p.row.laba, 0),
                )}
                . Daftar lengkapnya ada di tabel “Margin per produk” di bawah.
              </p>
            )}

            {/* Losses get their own list, not the bottom of the ranking: a
                running percentage only means something over numbers with the
                same sign, and a shop owner reads this list for a different
                reason — these are the prices to fix. */}
            {pareto.rugi.length > 0 && (
              <div className="mt-5 pt-4 border-t border-line">
                <h3 className="font-semibold text-negative-text mb-1">
                  Produk yang malah menggerus laba
                </h3>
                <p className="text-sm text-faint mb-3">
                  Terjual lebih murah dari modalnya, total{" "}
                  {formatRupiah(pareto.totalRugi)}. Biasanya harga belinya sudah
                  naik tapi harga jualnya belum ikut.
                </p>
                <ParetoBars
                  negatif
                  bars={pareto.rugi.slice(0, CHART_ROWS).map((r) => ({
                    key: r.key,
                    label: <RowLabel row={r} />,
                    value: r.laba,
                  }))}
                />
              </div>
            )}
          </>
        )}
      </Panel>

      {/* 5. Belanja stok. Outside the laba-rugi arithmetic but inside the
          period: cash moving into persediaan is not an expense, its cost only
          becomes HPP when FIFO releases it on a sale, so subtracting it above
          would double-count the goods. It still belongs in this band because it
          IS a flow across the filtered period. */}
      <Panel>
        <PanelHead
          title="Belanja stok"
          scope={
            <Chip tone={sebagian ? "partial" : "period"}>
              {sebagian
                ? `${periodeChip} · semua pembeli & status`
                : periodeChip}
            </Chip>
          }
        />
        <p className="text-sm text-faint mb-3">
          Belanja stok bukan biaya — uangnya berubah jadi barang di gudang, dan
          baru dihitung sebagai modal waktu barangnya terjual. Jadi angka ini
          sengaja tidak ikut dikurangkan dari laba di atas.
        </p>
        <div className="flex gap-6 flex-wrap">
          <Stat
            label="Uang keluar untuk stok"
            value={formatRupiah(pembelian)}
            hint={periodeChip}
          />
        </div>

        {/* The chip already carries this, but the chip is four words and this is
            the trap that actually costs money: Beli Stok records what we bought,
            and its counterpart is a supplier, not a pembeli. Without the long
            form the figure reads as "what I bought for Bu Ani", which it is
            not. Shown only once those filters are set, so it stays a correction
            rather than noise. */}
        {sebagian && (
          <p className="mt-3 text-sm text-warn-text">
            Filter pembeli dan status tidak berlaku untuk belanja stok — stok
            dibeli dari supplier, bukan per pembeli, dan barisnya tidak punya
            status bayar. Angka di atas masih untuk semuanya.
          </p>
        )}
      </Panel>

      {/* 6. Piutang, scoped to the period: orders PLACED in it that are still
          unpaid today. The reconciliation strip underneath carries the rest, so
          a filter narrows the question without hiding money. */}
      <Panel>
        <PanelHead
          title="Uang yang belum dibayar pembeli"
          scope={<Chip>{periodeChip}</Chip>}
        />
        <p className="text-sm text-faint mb-3">
          Pesanan {periode ? `dari ${periode}` : "dari semua tanggal"} yang
          sampai hari ini belum lunas. Umurnya dihitung dari tanggal pesanan,
          jadi makin ke kanan kelompoknya, makin lama uangnya belum masuk.
        </p>
        {piutang.count === 0 ? (
          <p className="text-sm text-faint">
            {periode
              ? `Semua pesanan dari ${periode} sudah dibayar. 🎉`
              : "Semua pesanan sudah dibayar. 🎉"}
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

        {/* The reconciliation. Shown whenever the filter is hiding unpaid money,
            because "Rp 15.997.000" under a filter and "Rp 21.320.000" without
            one is exactly the contradiction that made this page untrustworthy —
            the difference has to be named on the same screen, not left for the
            reader to find by clearing the filter. */}
        {piutangLuar > 0 && (
          <p className="mt-3 pt-3 border-t border-line text-sm text-muted">
            Di luar {periode ?? "filter ini"} masih ada{" "}
            <strong className="text-warn-text">
              {formatRupiah(piutangLuar)}
            </strong>{" "}
            yang belum dibayar ({formatAngka(piutangSemua.count - piutang.count)}{" "}
            pesanan). Semua periode:{" "}
            <strong>{formatRupiah(piutangSemua.total)}</strong> ·{" "}
            {formatAngka(piutangSemua.count)} pesanan — rinciannya di bawah.
          </p>
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

      {/* 7. Margin per produk */}
      <Panel>
        <PanelHead title="Margin per produk" scope={<Chip>{periodeChip}</Chip>} />
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

      {/* 8. Margin per pembeli */}
      <Panel>
        <PanelHead title="Margin per pembeli" scope={<Chip>{periodeChip}</Chip>} />
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

      {/* Second band: the figures the filter cannot reach. Kept on the page
          because they are the two numbers a shop owner acts on — what is in the
          gudang and who owes money — but fenced off below everything filtered so
          the filter bar at the top can never be read as applying to them. */}
      <Band
        title="Sampai hari ini"
        sub="Posisi saat ini, bukan angka periode. Tidak ikut filter apa pun di atas."
      />

      <Panel>
        <PanelHead
          title="Nilai stok yang masih ada"
          scope={<Chip tone="static">Sampai hari ini</Chip>}
        />
        <p className="text-sm text-faint mb-3">
          Modal yang masih berbentuk barang di gudang, dihitung dari harga beli
          FIFO. Angka ini tidak bisa difilter per periode: yang direkam adalah
          sisa stok sekarang, bukan sisa stok di akhir bulan tertentu.
        </p>
        <div className="flex gap-6 flex-wrap">
          <Stat
            label="Nilai stok"
            value={formatRupiah(persediaan)}
            hint="Sampai hari ini"
          />
        </div>
      </Panel>

      {/* The all-time aging, kept as its own panel rather than folded into the
          filtered one. Both are true and they are different questions: "what
          did Agustus leave unpaid" is a period question, "how old is the money
          I am still owed" is not, and the buckets only mean something when they
          cover every pending order. */}
      <Panel>
        <PanelHead
          title="Semua uang yang belum dibayar"
          scope={<Chip tone="static">Semua periode · sampai hari ini</Chip>}
        />
        <p className="text-sm text-faint mb-3">
          Semua pesanan yang belum lunas, berapa pun tanggalnya. Status bayar
          tidak menyimpan tanggal pelunasan, jadi ini selalu posisi hari ini —
          bukan angka yang bisa dipotong per bulan.
        </p>
        {piutangSemua.count === 0 ? (
          <p className="text-sm text-faint">Semua pesanan sudah dibayar. 🎉</p>
        ) : (
          <div className="flex gap-6 flex-wrap">
            <Stat label="Total" value={formatRupiah(piutangSemua.total)} />
            <Stat
              label="Jumlah pesanan"
              value={formatAngka(piutangSemua.count)}
            />
            <Stat label="0–30 hari" value={formatRupiah(piutangSemua.d0_30)} />
            <Stat
              label="31–60 hari"
              value={formatRupiah(piutangSemua.d31_60)}
              className={piutangSemua.d31_60 > 0 ? "text-warn" : ""}
            />
            <Stat
              label="Lebih dari 60 hari"
              value={formatRupiah(piutangSemua.d60plus)}
              className={piutangSemua.d60plus > 0 ? "text-negative" : ""}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

// The laba-rugi block, restated as a bridge. Same four figures, same order, and
// the same closing sum: penjualanTotal − tanpaStokNilai − hpp − susut = laba.
// The two conditional deductions are omitted when they are zero rather than
// drawn flat — a labelled bar with no length reads as a bug, not as "nothing
// happened here". Modal always shows: it is the step the chart exists for.
function waterfallSteps(
  summary: ProfitSummary,
  susutNilai: number,
  labaAkhir: number,
): WaterfallStep[] {
  const steps: WaterfallStep[] = [
    {
      key: "masuk",
      label: "Uang masuk dari penjualan",
      delta: summary.penjualanTotal,
      kind: "start",
    },
  ];
  if (summary.tanpaStokNilai > 0)
    steps.push({
      key: "tanpa",
      label: "Penjualan yang modalnya belum diketahui",
      delta: -summary.tanpaStokNilai,
      kind: "sub",
      unknown: true,
    });
  steps.push({
    key: "hpp",
    label: "Modal barang yang terjual",
    delta: -summary.hpp,
    kind: "sub",
  });
  if (susutNilai > 0)
    steps.push({
      key: "susut",
      label: "Stok hilang, rusak, atau dipakai sendiri",
      delta: -susutNilai,
      kind: "sub",
    });
  steps.push({ key: "laba", label: "Sisanya jadi laba", delta: labaAkhir, kind: "total" });
  return steps;
}

// The waterfall's takeaway. This used to be scaled to "per Rp 1.000 that came
// in", on the theory that a shop owner could check it against a single sale.
// They can't: nobody makes a Rp 1.000 sale, so the reader had to hold a
// made-up denominator in their head AND the real total at the same time, and
// two sets of rupiah figures on one line just read as noise. Percentages of the
// actual penjualan say the same thing with one unit and no invented scale.
function komposisiPenjualan(
  summary: ProfitSummary,
  susutNilai: number,
  labaAkhir: number,
): string {
  const pct = (n: number) => formatPersen((n / summary.penjualanTotal) * 100);
  const bagian = [`${pct(summary.hpp)} modal barang`];
  if (susutNilai > 0) bagian.push(`${pct(susutNilai)} hilang di stok`);
  if (summary.tanpaStokNilai > 0)
    bagian.push(`${pct(summary.tanpaStokNilai)} belum bisa dihitung modalnya`);
  return `Dari ${formatRupiah(summary.penjualanTotal)} penjualan: ${bagian.join(
    ", ",
  )}, dan ${pct(labaAkhir)} jadi laba (${formatRupiah(labaAkhir)}).`;
}

// Two points of margin is the line between "moved" and "noise". Below it the
// note stays neutral and says so, rather than colouring a rounding difference
// green and telling the owner things are looking up.
const AMBANG_POIN = 2;

function trenTone(selisihPoin: number | null): "netral" | "baik" | "buruk" {
  if (selisihPoin === null || Math.abs(selisihPoin) < AMBANG_POIN) return "netral";
  return selisihPoin > 0 ? "baik" : "buruk";
}

function trenKalimat(insight: TrendInsight, bulanTampil: number): string {
  const bulan = formatBulanPendek(insight.bulan);
  const rugi =
    insight.bulanRugi > 0
      ? ` ${formatAngka(insight.bulanRugi)} dari ${formatAngka(bulanTampil)} bulan di grafik ini rugi.`
      : "";

  if (insight.margin === null)
    return `Bulan ${bulan} belum ada penjualan yang bisa dihitung marginnya.${rugi}`;
  if (insight.selisihPoin === null || insight.marginSebelumnya === null)
    return `Margin bulan ${bulan} ${formatPersen(insight.margin)}. Baru satu bulan, belum ada pembandingnya.${rugi}`;

  const poin = Math.abs(insight.selisihPoin).toFixed(1).replace(".", ",");
  const arah =
    Math.abs(insight.selisihPoin) < AMBANG_POIN
      ? "hampir sama dengan"
      : insight.selisihPoin > 0
        ? `naik ${poin} poin dari`
        : `turun ${poin} poin dari`;
  return `Margin bulan ${bulan} ${formatPersen(insight.margin)}, ${arah} rata-rata bulan-bulan sebelumnya (${formatPersen(insight.marginSebelumnya)}).${rugi}`;
}

// A product row's name, linked when the row is a real product. "Produk dihapus"
// and "Tanpa pembeli" carry an empty key and have nowhere to go.
function RowLabel({ row }: { row: MarginRow }) {
  if (row.key === "") return <>{row.label}</>;
  return (
    <Link
      to="/produk/$id"
      params={{ id: row.key }}
      className="text-brand hover:underline font-medium"
    >
      {row.label}
    </Link>
  );
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

// The rule for reading this page, made structural: everything between the
// filter bar and the second band answers the filter, and everything after it
// answers "right now". A caption on each panel could not do this job — the
// reader has to know which zone a number is in BEFORE reading it, otherwise the
// filter bar at the top silently claims every figure on the page, which is
// exactly how 57 pesanan got read as an August number.
// Title and scope on one line, so the scope is read WITH the heading rather
// than found afterwards in a paragraph. The chip wraps to its own line on a
// phone instead of squeezing the title, because a truncated scope is worse than
// a scope on the next line.
function PanelHead({
  title,
  scope,
}: {
  title: string;
  scope: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-1">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="flex flex-wrap gap-1.5">{scope}</div>
    </div>
  );
}

function Band({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 mt-6 mb-3">
      <div className="shrink-0">
        <div className="text-xs uppercase tracking-wide text-faint font-semibold">
          {title}
        </div>
        <div className="text-sm text-faint">{sub}</div>
      </div>
      <div className="flex-1 border-t border-line" />
    </div>
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
