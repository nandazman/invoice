import { useMemo } from "react";
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
  todayISO,
} from "../lib/format";
import { FilterBar } from "../components/FilterBar";
import { Field } from "../components/Field";
import { Panel } from "../components/Panel";
import { Select } from "../components/Select";
import { Stat } from "../components/Stat";

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

export function ReportPage() {
  const products = useProducts();
  const orders = useOrders();
  const purchases = usePurchases();
  const stock = useStock();
  const buyers = useBuyers();

  const filter = useOrderFilter(orders, products);
  const { filtered } = filter;

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
        <Panel className="text-center text-slate-400 py-8">
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
            label="Penjualan (semua pesanan)"
            value={formatRupiah(summary.penjualanTotal)}
          />
          {summary.tanpaStokCount > 0 && (
            <>
              <Line
                label={`Belum ada dasar modal (${formatAngka(
                  summary.tanpaStokCount,
                )} pesanan)`}
                value={`(${formatRupiah(summary.tanpaStokNilai)})`}
                className="text-amber-700"
                muted
              />
              <Line
                label="Penjualan yang dihitung"
                value={formatRupiah(summary.penjualan)}
                divider
              />
            </>
          )}
          <Line
            label="HPP (modal barang terjual)"
            value={`(${formatRupiah(summary.hpp)})`}
            className="text-rose-600"
          />
          {susut.count > 0 ? (
            <>
              <Line
                label="Laba Kotor"
                value={formatRupiah(summary.labaKotor)}
                divider
                className={summary.labaKotor < 0 ? "text-rose-600" : ""}
              />
              <Line
                label={`Susut / stok keluar tanpa penjualan (${formatAngka(
                  susut.count,
                )})`}
                value={`(${formatRupiah(susut.nilai)})`}
                className="text-rose-600"
                muted
              />
              <Total
                label="Laba setelah susut"
                value={labaAkhir}
                pct={
                  summary.penjualan === 0
                    ? null
                    : (labaAkhir / summary.penjualan) * 100
                }
              />
            </>
          ) : (
            <Total
              label="Laba Kotor"
              value={summary.labaKotor}
              pct={summary.marginPct}
            />
          )}
        </div>

        {/* Susut is scoped by MOVEMENT, and a movement carries neither a buyer
            nor a payment status — so those two filters cannot narrow it, and it
            keeps its full value while everything above it shrinks. Saying so
            beats printing a figure the user believes narrowed when it did not. */}
        {susut.count > 0 &&
          (filter.applied.pembeli !== "" ||
            filter.applied.status !== "semua") && (
          <p className="mt-3 text-sm text-amber-700">
            Angka susut di atas tidak ikut filter{" "}
            {filter.applied.pembeli !== "" && "pembeli"}
            {filter.applied.pembeli !== "" &&
              filter.applied.status !== "semua" &&
              " dan "}
            {filter.applied.status !== "semua" && "status"} — stok yang hilang
            atau disesuaikan tidak terhubung ke pembeli mana pun, dan tidak punya
            status bayar. Nilainya tetap penuh untuk periode ini.
          </p>
        )}

        {/* Quarantined rows. Not noise — a to-do list. Each one is an order
            whose modal cannot be stated as fact: no stock movement at all, or a
            sale FIFO could not fully source from any purchase lot. */}
        {summary.tanpaStokCount > 0 && (
          <p className="mt-3 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Baris “belum ada dasar modal” di atas: stoknya tidak dicatat (opsi
            “potong stok” tidak dicentang), atau barangnya terjual tanpa ada
            catatan pembelian yang menutupi. Penjualannya nyata — yang belum
            diketahui hanya modalnya, jadi barisnya dikeluarkan dulu supaya
            labanya tidak terlihat lebih besar dari yang sebenarnya.
          </p>
        )}

        {/* A double-deducted order is a data bug, not a reporting one: the
            stock ledger really did record the sale twice, so the HPP above is
            genuinely inflated. Say so rather than silently halving it. */}
        {summary.dobelCount > 0 && (
          <p className="mt-2 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {formatAngka(summary.dobelCount)} pesanan punya lebih dari satu
            catatan penjualan, jadi stoknya terpotong dua kali dan HPP di atas
            ikut menggelembung. Biasanya ini pesanan yang sudah memotong stok
            lalu dibelikan lagi lewat “Beli stok dari pesanan”. Periksa di
            halaman Stok.
          </p>
        )}

        <p className="mt-3 text-xs text-slate-400">
          Tidak ada laba bersih di sini: aplikasi belum mencatat biaya
          operasional (sewa, gaji, transport), jadi tidak ada yang bisa
          dikurangkan dari laba kotor.
        </p>
      </Panel>

      {/* 2. Context figures, deliberately OUTSIDE the arithmetic above.
          Pembelian is cash moving into persediaan, not an expense: its cost
          only becomes HPP when FIFO releases it on a sale. Subtracting it here
          would double-count the goods. */}
      <Panel>
        <h2 className="text-lg font-bold mb-1">Di luar perhitungan di atas</h2>
        <p className="text-sm text-slate-400 mb-3">
          Pembelian bukan biaya — uangnya berpindah jadi persediaan, dan baru
          jadi HPP saat barangnya terjual. Persediaan dan piutang adalah posisi
          saat ini, bukan angka periode, jadi keduanya tidak ikut difilter.
        </p>
        <div className="flex gap-6 flex-wrap">
          <Stat
            label="Pembelian periode ini"
            value={formatRupiah(pembelian)}
            className={filter.applied.pembeli ? "text-slate-400" : ""}
          />
          <Stat label="Nilai persediaan (kini)" value={formatRupiah(persediaan)} />
          <Stat
            label="Belum dibayar (kini)"
            value={formatRupiah(piutang.total)}
            className={piutang.total > 0 ? "text-amber-600" : ""}
          />
        </div>

        {/* Pembelian follows the tanggal, produk and tipe filters, but NOT
            pembeli: Beli Stok records what we bought, and its counterpart is a
            supplier, not a pembeli. Without this note the figure reads as
            "what I bought for Bu Ani", which it is not. */}
        {(filter.applied.pembeli !== "" ||
          filter.applied.status !== "semua") && (
          <p className="mt-3 text-sm text-amber-700">
            Filter pembeli dan status tidak berlaku untuk pembelian — stok dibeli
            dari supplier, bukan per pembeli, dan barisnya tidak punya status
            bayar. Angka pembelian di atas masih untuk semuanya.
          </p>
        )}
      </Panel>

      {/* 3. Piutang */}
      <Panel>
        <h2 className="text-lg font-bold mb-1">Piutang</h2>
        <p className="text-sm text-slate-400 mb-3">
          Semua pesanan yang belum lunas, berapa pun tanggalnya — status bayar
          tidak menyimpan tanggal pelunasan, jadi ini posisi hari ini.
        </p>
        {piutang.count === 0 ? (
          <p className="text-sm text-slate-400">
            Tidak ada pesanan yang belum dibayar. 🎉
          </p>
        ) : (
          <div className="flex gap-6 flex-wrap">
            <Stat label="Total" value={formatRupiah(piutang.total)} />
            <Stat label="Jumlah pesanan" value={formatAngka(piutang.count)} />
            <Stat label="0–30 hari" value={formatRupiah(piutang.d0_30)} />
            <Stat
              label="31–60 hari"
              value={formatRupiah(piutang.d31_60)}
              className={piutang.d31_60 > 0 ? "text-amber-600" : ""}
            />
            <Stat
              label="60+ hari"
              value={formatRupiah(piutang.d60plus)}
              className={piutang.d60plus > 0 ? "text-rose-600" : ""}
            />
          </div>
        )}
        {/* Aged into the oldest bucket rather than the newest: an unreadable
            date is a reason to chase the row, not to assume it is fresh. */}
        {piutang.tanggalTidakValid > 0 && (
          <p className="mt-3 text-sm text-amber-700">
            {formatAngka(piutang.tanggalTidakValid)} pesanan tanggalnya tidak
            terbaca, jadi dimasukkan ke kelompok 60+ hari. Perbaiki tanggalnya di
            halaman Pesanan supaya umurnya benar.
          </p>
        )}
      </Panel>

      {/* 4. Margin per produk */}
      <Panel>
        <h2 className="text-lg font-bold mb-1">Margin per produk</h2>
        <p className="text-sm text-slate-400 mb-3">
          Urut dari penyumbang laba terbesar. Baris merah di bawah berarti
          barangnya terjual lebih murah dari modal lot-nya — biasanya harga
          beli sudah naik tapi Harga Jual belum ikut.
        </p>
        <MarginTable rows={produkRows} showQty />
      </Panel>

      {/* 5. Margin per pembeli */}
      <Panel>
        <h2 className="text-lg font-bold mb-3">Margin per pembeli</h2>
        <MarginTable rows={pembeliRows} linkBuyer />
      </Panel>
    </div>
  );
}

function Header() {
  return (
    <>
      <h1 className="text-2xl font-bold mb-1">Laba Rugi</h1>
      <p className="text-slate-500 mb-4">
        Penjualan, HPP (biaya modal barang yang benar-benar terjual, metode
        FIFO), dan laba kotor untuk periode yang dipilih.
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
        divider ? "border-t border-slate-300 mt-1 pt-2" : ""
      }`}
    >
      <span
        className={`flex-1 ${muted ? "pl-4 text-sm text-slate-500" : "text-slate-600"}`}
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
// there is exactly one per block.
function Total({
  label,
  value,
  pct,
}: {
  label: string;
  value: number;
  pct: number | null;
}) {
  return (
    <div className="border-t-2 border-slate-800 mt-1 pt-2 flex items-baseline gap-3">
      <span className="text-lg font-bold flex-1">{label}</span>
      <span
        className={`text-xl font-bold tabular-nums ${
          value < 0 ? "text-rose-600" : "text-emerald-700"
        }`}
      >
        {formatRupiah(value)}
      </span>
      <span className="text-sm font-semibold text-slate-500 tabular-nums w-16 text-right">
        {formatPersen(pct)}
      </span>
    </div>
  );
}

function MarginTable({
  rows,
  showQty = false,
  linkBuyer = false,
}: {
  rows: MarginRow[];
  showQty?: boolean;
  linkBuyer?: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-400 py-4 text-center">
        Belum ada pesanan dengan catatan stok di periode ini.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={thClass}>{linkBuyer ? "Pembeli" : "Produk"}</th>
            {showQty && <th className={`${thClass} text-right`}>Qty</th>}
            <th className={`${thClass} text-right`}>Penjualan</th>
            <th className={`${thClass} text-right`}>HPP</th>
            <th className={`${thClass} text-right`}>Laba</th>
            <th className={`${thClass} text-right`}>Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="hover:bg-slate-50">
              <td className={tdClass}>
                {linkBuyer && r.key !== "" ? (
                  <Link
                    to="/pembeli/$id"
                    params={{ id: r.key }}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    {r.label}
                  </Link>
                ) : !linkBuyer && r.key !== "" ? (
                  <Link
                    to="/produk/$id"
                    params={{ id: r.key }}
                    className="text-blue-600 hover:underline font-medium"
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
              <td className={`${tdClass} text-right tabular-nums text-slate-500`}>
                {formatRupiah(r.hpp)}
              </td>
              <td
                className={`${tdClass} text-right tabular-nums font-semibold ${
                  r.laba < 0 ? "text-rose-600" : ""
                }`}
              >
                {formatRupiah(r.laba)}
              </td>
              <td
                className={`${tdClass} text-right tabular-nums ${
                  r.laba < 0 ? "text-rose-600 font-semibold" : "text-slate-500"
                }`}
              >
                {formatPersen(r.marginPct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
