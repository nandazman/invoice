import { useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import type { StockReason } from "../lib/types";
import {
  useProducts,
  useOrders,
  useStock,
  useTypes,
  upsertProduct,
} from "../lib/store";
import { useAudit } from "../lib/audit";
import { computeFifo } from "../lib/stock";
import {
  formatRupiah,
  formatAngka,
  formatTanggalID,
  formatDateTimeID,
} from "../lib/format";
import { ProductDialog } from "../components/ProductDialog";
import { PrimaryButton } from "../components/Button";
import { Panel } from "../components/Panel";

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

const REASON_LABEL: Record<StockReason, string> = {
  purchase: "Pembelian",
  return: "Retur",
  sale: "Penjualan",
  adjustment: "Penyesuaian",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Belum bayar",
  paid: "Lunas",
};

export function ProductDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const products = useProducts();
  const orders = useOrders();
  const stock = useStock();
  const audit = useAudit();
  const types = useTypes();
  const [editing, setEditing] = useState(false);

  const product = products.find((p) => p.id === id);

  // Movements for this product, newest first, plus FIFO figures.
  const stockData = useMemo(() => {
    const movements = stock
      .filter((m) => m.productId === id)
      .sort((a, b) =>
        (b.tanggal + b.createdAt).localeCompare(a.tanggal + a.createdAt),
      );
    const fifo = computeFifo(movements, product?.hargaDasar ?? 0);
    return { movements, fifo };
  }, [stock, id, product?.hargaDasar]);

  // Orders belonging to this product (by id, or legacy name fallback).
  const productOrders = useMemo(() => {
    if (!product) return [];
    return orders
      .filter(
        (o) => o.productId === id || o.namaProduk === product.namaProduk,
      )
      .sort((a, b) =>
        (b.tanggal + b.createdAt).localeCompare(a.tanggal + a.createdAt),
      );
  }, [orders, id, product]);

  // Audit trail for this product, newest first.
  const productAudit = useMemo(
    () =>
      audit
        .filter((e) => e.entity === "product" && e.entityId === id)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [audit, id],
  );

  if (!product) {
    return (
      <div>
        <Panel className="text-center py-12">
          <p className="text-lg font-semibold text-slate-600 mb-1">
            Produk tidak ditemukan
          </p>
          <p className="text-slate-400 mb-4">
            Produk dengan id ini tidak ada atau sudah dihapus.
          </p>
          <Link
            to="/harga"
            className="text-blue-600 hover:underline font-medium"
          >
            ← Kembali ke Daftar Harga
          </Link>
        </Panel>
      </div>
    );
  }

  const laba = product.hargaJual - product.hargaDasar;
  const { movements, fifo } = stockData;

  return (
    <div>
      {/* 1. Header */}
      <Panel>
        <div className="mb-2">
          <Link
            to="/harga"
            className="text-blue-600 hover:underline font-medium text-sm"
          >
            ← Kembali ke Daftar Harga
          </Link>
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{product.namaProduk}</h1>
              <span className="inline-block bg-slate-100 text-slate-600 rounded-md px-2 py-0.5 text-xs font-semibold">
                {product.tipe}
              </span>
            </div>
            <p className="text-slate-500 mt-1">
              {product.ukuran == null && !product.satuan
                ? "—"
                : `${product.ukuran ?? ""} ${product.satuan ?? ""}`.trim()}
            </p>
          </div>
          <PrimaryButton onClick={() => setEditing(true)}>Ubah</PrimaryButton>
        </div>
      </Panel>

      {/* 2. Harga & konversi */}
      <Panel>
        <h2 className="text-lg font-bold mb-3">Harga & konversi</h2>
        <div className="flex gap-6 flex-wrap mb-4">
          <Stat label="Harga Dasar" value={formatRupiah(product.hargaDasar)} />
          <Stat label="Harga Satuan" value={formatRupiah(product.hargaJual)} />
          <Stat
            label="Laba"
            value={formatRupiah(laba)}
            className={laba < 0 ? "text-red-600" : "text-emerald-600"}
          />
          <Stat
            label="Stok minimum"
            value={
              product.stokMin > 0 ? formatAngka(product.stokMin) : "—"
            }
          />
        </div>
        {product.konversi.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada konversi kemasan.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Nama</th>
                  <th className={`${thClass} text-right`}>= Satuan</th>
                  <th className={`${thClass} text-right`}>Harga</th>
                </tr>
              </thead>
              <tbody>
                {product.konversi.map((k, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className={tdClass}>{k.nama}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatAngka(k.jumlah)}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatRupiah(k.harga)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* 3. Stok */}
      <Panel>
        <h2 className="text-lg font-bold mb-3">Stok</h2>
        <div className="flex gap-6 flex-wrap mb-4">
          <Stat
            label="Stok saat ini"
            value={`${formatAngka(fifo.qty)} ${product.satuan ?? ""}`.trim()}
            className={fifo.qty < 0 ? "text-red-600" : ""}
          />
          <Stat
            label="Modal / satuan"
            value={fifo.qty > 0 ? formatRupiah(fifo.unitCost) : "—"}
          />
          <Stat label="Nilai persediaan" value={formatRupiah(fifo.value)} />
        </div>
        {movements.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada pergerakan stok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Tanggal</th>
                  <th className={thClass}>Alasan</th>
                  <th className={`${thClass} text-right`}>Qty</th>
                  <th className={`${thClass} text-right`}>Modal/satuan</th>
                  <th className={`${thClass} text-right`}>Nilai</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const mv = fifo.movementValue.get(m.id) ?? 0;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className={tdClass}>
                        {formatTanggalID(m.tanggal)}
                        <span className="block text-xs text-slate-400">
                          {formatDateTimeID(m.createdAt)}
                        </span>
                      </td>
                      <td className={tdClass}>
                        {REASON_LABEL[m.reason]}
                        {m.orderId && " (dari pesanan)"}
                        {m.note && (
                          <span className="block text-xs text-slate-400">
                            {m.note}
                          </span>
                        )}
                      </td>
                      <td
                        className={`${tdClass} text-right tabular-nums font-semibold ${
                          m.qty < 0 ? "text-red-600" : "text-emerald-600"
                        }`}
                      >
                        {m.qty > 0
                          ? `+${formatAngka(m.qty)}`
                          : formatAngka(m.qty)}
                      </td>
                      <td className={`${tdClass} text-right tabular-nums text-slate-500`}>
                        {m.hargaModal != null
                          ? formatRupiah(m.hargaModal)
                          : "—"}
                      </td>
                      <td
                        className={`${tdClass} text-right tabular-nums ${
                          mv < 0 ? "text-red-600" : "text-emerald-600"
                        }`}
                      >
                        {mv > 0
                          ? `+${formatRupiah(mv)}`
                          : mv < 0
                            ? `−${formatRupiah(-mv)}`
                            : formatRupiah(0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* 4. Pesanan */}
      <Panel>
        <h2 className="text-lg font-bold mb-3">Pesanan</h2>
        {productOrders.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada pesanan.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Tanggal</th>
                  <th className={thClass}>Satuan</th>
                  <th className={`${thClass} text-right`}>Qty</th>
                  <th className={`${thClass} text-right`}>Harga Satuan</th>
                  <th className={`${thClass} text-right`}>Total</th>
                  <th className={thClass}>Status</th>
                </tr>
              </thead>
              <tbody>
                {productOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className={tdClass}>{formatTanggalID(o.tanggal)}</td>
                    <td className={tdClass}>{o.satuan}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatAngka(o.kuantitas)}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatRupiah(o.hargaSatuan)}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums font-semibold`}>
                      {formatRupiah(o.totalHarga)}
                    </td>
                    <td className={tdClass}>
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${
                          o.status === "paid"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {STATUS_LABEL[o.status] ?? o.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* 5. Riwayat */}
      <Panel>
        <h2 className="text-lg font-bold mb-3">Riwayat perubahan</h2>
        {productAudit.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada riwayat.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {productAudit.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="text-slate-400 text-xs mr-2 tabular-nums">
                  {formatDateTimeID(e.timestamp)}
                </span>
                <span className="text-slate-700">{e.label}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && (
        <ProductDialog
          product={product}
          types={types}
          onSave={(p) => {
            upsertProduct(p);
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${className}`}>
        {value}
      </div>
    </div>
  );
}
