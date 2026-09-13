import { useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import type { Buyer, StockReason } from "../lib/types";
import {
  useProducts,
  useOrders,
  useStock,
  useTypes,
  useBuyers,
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
import { usePersistentAttribution } from "../lib/columns";
import {
  AttributionToggle,
  MobileBy,
  ByCells,
  ByHeaders,
  bothBy,
} from "../components/Attribution";
import { ProductDialog } from "../components/ProductDialog";
import { PrimaryButton } from "../components/Button";
import { Panel } from "../components/Panel";
import { thClass, tdClass } from "../components/DataTable";
import { MobileList, MobileRow } from "../components/MobileList";


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
  const buyers = useBuyers();
  const [editing, setEditing] = useState(false);
  // One preference for the whole page: both tables below list rows from the
  // same mirror, so a reader who wants the "who" on one wants it on the other.
  const [showBy, setShowBy] = usePersistentAttribution(
    "invoice.produk.detail.by.v1",
  );

  // "Who bought this" is the question this page is already for, so the Pesanan
  // table resolves buyer ids through a Map rather than a find() per row.
  const buyerById = useMemo(
    () => new Map(buyers.map((b) => [b.id, b] as const)),
    [buyers],
  );

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
          <p className="text-lg font-semibold text-muted mb-1">
            Produk tidak ditemukan
          </p>
          <p className="text-faint mb-4">
            Produk dengan id ini tidak ada atau sudah dihapus.
          </p>
          <Link
            to="/harga"
            className="text-brand hover:underline font-medium"
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
            className="text-brand hover:underline font-medium text-sm"
          >
            ← Kembali ke Daftar Harga
          </Link>
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{product.namaProduk}</h1>
              <span className="inline-block bg-surface-hover text-muted rounded-md px-2 py-0.5 text-xs font-semibold">
                {product.tipe}
              </span>
            </div>
            <p className="text-faint mt-1">
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
            className={laba < 0 ? "text-danger" : "text-ok"}
          />
          <Stat
            label="Stok minimum"
            value={
              product.stokMin > 0 ? formatAngka(product.stokMin) : "—"
            }
          />
        </div>
        {product.konversi.length === 0 ? (
          <p className="text-sm text-faint">Belum ada konversi kemasan.</p>
        ) : (
          <>
          <div className="md:hidden">
            <MobileList left="Nama" right="Harga">
              {product.konversi.map((k, i) => (
                <MobileRow
                  key={i}
                  title={k.nama}
                  value={formatRupiah(k.harga)}
                  note={`= ${formatAngka(k.jumlah)} satuan`}
                />
              ))}
            </MobileList>
          </div>
          <div className="overflow-x-auto hidden md:block">
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
                  <tr key={i} className="hover:bg-surface-sunken">
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
          </>
        )}
      </Panel>

      {/* 3. Stok */}
      <Panel>
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-bold">Stok</h2>
          <span className="flex-1" />
          {movements.length > 0 && (
            <AttributionToggle show={showBy} onChange={setShowBy} />
          )}
        </div>
        <div className="flex gap-6 flex-wrap mb-4">
          <Stat
            label="Stok saat ini"
            value={`${formatAngka(fifo.qty)} ${product.satuan ?? ""}`.trim()}
            className={fifo.qty < 0 ? "text-danger" : ""}
          />
          <Stat
            label="Modal / satuan"
            value={fifo.qty > 0 ? formatRupiah(fifo.unitCost) : "—"}
          />
          <Stat label="Nilai persediaan" value={formatRupiah(fifo.value)} />
        </div>
        {movements.length === 0 ? (
          <p className="text-sm text-faint">Belum ada pergerakan stok.</p>
        ) : (
          <>
          <div className="md:hidden">
            <MobileList left="Tanggal" right="Nilai">
              {movements.map((m) => {
                const mv = fifo.movementValue.get(m.id) ?? 0;
                return (
                  <MobileRow
                    key={m.id}
                    title={formatTanggalID(m.tanggal)}
                    meta={
                      <>
                        <span>
                          {REASON_LABEL[m.reason]}
                          {m.orderId && " (dari pesanan)"}
                        </span>
                        <span>{formatDateTimeID(m.createdAt)}</span>
                        {m.note && <span>{m.note}</span>}
                        <MobileBy show={bothBy(showBy)} row={m} />
                      </>
                    }
                    value={
                      <span className={mv < 0 ? "text-danger" : "text-ok"}>
                        {mv > 0
                          ? `+${formatRupiah(mv)}`
                          : mv < 0
                            ? `−${formatRupiah(-mv)}`
                            : formatRupiah(0)}
                      </span>
                    }
                    note={
                      <>
                        <span
                          className={
                            m.qty < 0 ? "text-danger" : "text-ok"
                          }
                        >
                          {m.qty > 0
                            ? `+${formatAngka(m.qty)}`
                            : formatAngka(m.qty)}
                        </span>
                        {" × "}
                        {m.hargaModal != null
                          ? formatRupiah(m.hargaModal)
                          : "—"}
                      </>
                    }
                  />
                );
              })}
            </MobileList>
          </div>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Tanggal</th>
                  <th className={thClass}>Alasan</th>
                  <th className={`${thClass} text-right`}>Qty</th>
                  <th className={`${thClass} text-right`}>Modal/satuan</th>
                  <th className={`${thClass} text-right`}>Nilai</th>
                  <ByHeaders show={bothBy(showBy)} className={thClass} />
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => {
                  const mv = fifo.movementValue.get(m.id) ?? 0;
                  return (
                    <tr key={m.id} className="hover:bg-surface-sunken">
                      <td className={tdClass}>
                        {formatTanggalID(m.tanggal)}
                        <span className="block text-xs text-faint">
                          {formatDateTimeID(m.createdAt)}
                        </span>
                      </td>
                      <td className={tdClass}>
                        {REASON_LABEL[m.reason]}
                        {m.orderId && " (dari pesanan)"}
                        {m.note && (
                          <span className="block text-xs text-faint">
                            {m.note}
                          </span>
                        )}
                      </td>
                      <td
                        className={`${tdClass} text-right tabular-nums font-semibold ${
                          m.qty < 0 ? "text-danger" : "text-ok"
                        }`}
                      >
                        {m.qty > 0
                          ? `+${formatAngka(m.qty)}`
                          : formatAngka(m.qty)}
                      </td>
                      <td className={`${tdClass} text-right tabular-nums text-faint`}>
                        {m.hargaModal != null
                          ? formatRupiah(m.hargaModal)
                          : "—"}
                      </td>
                      <td
                        className={`${tdClass} text-right tabular-nums ${
                          mv < 0 ? "text-danger" : "text-ok"
                        }`}
                      >
                        {mv > 0
                          ? `+${formatRupiah(mv)}`
                          : mv < 0
                            ? `−${formatRupiah(-mv)}`
                            : formatRupiah(0)}
                      </td>
                      <ByCells
                        show={bothBy(showBy)}
                        row={m}
                        className={tdClass}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Panel>

      {/* 4. Pesanan */}
      <Panel>
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-bold">Pesanan</h2>
          <span className="flex-1" />
          {productOrders.length > 0 && (
            <AttributionToggle show={showBy} onChange={setShowBy} />
          )}
        </div>
        {productOrders.length === 0 ? (
          <p className="text-sm text-faint">Belum ada pesanan.</p>
        ) : (
          <>
          <div className="md:hidden">
            <MobileList left="Tanggal" right="Total">
              {productOrders.map((o) => (
                <MobileRow
                  key={o.id}
                  title={formatTanggalID(o.tanggal)}
                  meta={
                    <>
                      <BuyerLabel
                        buyerId={o.buyerId}
                        buyer={buyerById.get(o.buyerId) ?? null}
                      />
                      <span>{o.satuan}</span>
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${
                          o.status === "paid"
                            ? "bg-ok-soft text-ok-text"
                            : "bg-warn-soft text-warn-text"
                        }`}
                      >
                        {STATUS_LABEL[o.status] ?? o.status}
                      </span>
                      <span>Dibuat {formatDateTimeID(o.createdAt)}</span>
                      {o.updatedAt !== o.createdAt && (
                        <span>Diubah {formatDateTimeID(o.updatedAt)}</span>
                      )}
                      <MobileBy show={bothBy(showBy)} row={o} />
                    </>
                  }
                  value={formatRupiah(o.totalHarga)}
                  note={`${formatAngka(o.kuantitas)} × ${formatRupiah(
                    o.hargaSatuan,
                  )}`}
                />
              ))}
            </MobileList>
          </div>
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Tanggal</th>
                  <th className={thClass}>Pembeli</th>
                  <th className={thClass}>Satuan</th>
                  <th className={`${thClass} text-right`}>Qty</th>
                  <th className={`${thClass} text-right`}>Harga Satuan</th>
                  <th className={`${thClass} text-right`}>Total</th>
                  <th className={thClass}>Status</th>
                  <ByHeaders show={bothBy(showBy)} className={thClass} />
                </tr>
              </thead>
              <tbody>
                {productOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-surface-sunken">
                    <td className={tdClass}>
                      {formatTanggalID(o.tanggal)}
                      <span className="block text-xs text-faint">
                        Dibuat {formatDateTimeID(o.createdAt)}
                      </span>
                      {o.updatedAt !== o.createdAt && (
                        <span className="block text-xs text-faint">
                          Diubah {formatDateTimeID(o.updatedAt)}
                        </span>
                      )}
                    </td>
                    <td className={tdClass}>
                      <BuyerLabel
                        buyerId={o.buyerId}
                        buyer={buyerById.get(o.buyerId) ?? null}
                      />
                    </td>
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
                            ? "bg-ok-soft text-ok-text"
                            : "bg-warn-soft text-warn-text"
                        }`}
                      >
                        {STATUS_LABEL[o.status] ?? o.status}
                      </span>
                    </td>
                    <ByCells
                      show={bothBy(showBy)}
                      row={o}
                      className={tdClass}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Panel>

      {/* 5. Riwayat */}
      <Panel>
        <h2 className="text-lg font-bold mb-3">Riwayat perubahan</h2>
        {productAudit.length === 0 ? (
          <p className="text-sm text-faint">Belum ada riwayat.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {productAudit.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="text-faint text-xs mr-2 tabular-nums">
                  {formatDateTimeID(e.timestamp)}
                </span>
                <span className="text-body">{e.label}</span>
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

// Read-only here: assigning a buyer belongs on Pesanan, where the row lives.
// An id with no matching buyer is a deleted buyer, not a bug — deleteBuyer
// deliberately leaves orders pointing at the tombstone.
function BuyerLabel({
  buyerId,
  buyer,
}: {
  buyerId: string;
  buyer: Buyer | null;
}) {
  if (!buyerId) return <span className="text-faint">—</span>;
  if (!buyer)
    return <span className="text-faint italic">(pembeli dihapus)</span>;
  return (
    <Link
      to="/pembeli/$id"
      params={{ id: buyer.id }}
      className="text-brand hover:underline font-medium"
    >
      {buyer.nama}
    </Link>
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
      <div className="text-xs uppercase tracking-wide text-faint font-semibold">
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${className}`}>
        {value}
      </div>
    </div>
  );
}
