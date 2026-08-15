import { useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useBuyers, useOrders, upsertBuyer } from "../lib/store";
import { useAudit } from "../lib/audit";
import {
  formatRupiah,
  formatAngka,
  formatTanggalID,
  formatDateTimeID,
  sumRupiah,
} from "../lib/format";
import { usePersistentAttribution } from "../lib/columns";
import {
  AttributionToggle,
  ByCells,
  ByHeaders,
  bothBy,
} from "../components/Attribution";
import { BuyerDialog } from "../components/BuyerDialog";
import { PrimaryButton } from "../components/Button";
import { Panel } from "../components/Panel";
import { Stat } from "../components/Stat";

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

const STATUS_LABEL: Record<string, string> = {
  pending: "Belum bayar",
  paid: "Lunas",
};

export function BuyerDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const buyers = useBuyers();
  const orders = useOrders();
  const audit = useAudit();
  const [editing, setEditing] = useState(false);
  const [showBy, setShowBy] = usePersistentAttribution(
    "invoice.pembeli.detail.by.v1",
  );

  const buyer = buyers.find((b) => b.id === id);

  // This buyer's orders, newest first. Unlike products there is no legacy name
  // fallback: buyerId has existed since the field did, so an id is the only link.
  const buyerOrders = useMemo(
    () =>
      orders
        .filter((o) => o.buyerId === id)
        .sort((a, b) =>
          (b.tanggal + b.createdAt).localeCompare(a.tanggal + a.createdAt),
        ),
    [orders, id],
  );

  const totals = useMemo(() => {
    const all = buyerOrders.map((o) => o.totalHarga);
    const unpaid = buyerOrders
      .filter((o) => o.status !== "paid")
      .map((o) => o.totalHarga);
    return { nilai: sumRupiah(all), belumLunas: sumRupiah(unpaid) };
  }, [buyerOrders]);

  // Audit trail for this buyer, newest first.
  const buyerAudit = useMemo(
    () =>
      audit
        .filter((e) => e.entity === "buyer" && e.entityId === id)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [audit, id],
  );

  if (!buyer) {
    return (
      <div>
        <Panel className="text-center py-12">
          <p className="text-lg font-semibold text-slate-600 mb-1">
            Pembeli tidak ditemukan
          </p>
          <p className="text-slate-400 mb-4">
            Pembeli dengan id ini tidak ada atau sudah dihapus.
          </p>
          <Link
            to="/pembeli"
            className="text-blue-600 hover:underline font-medium"
          >
            ← Kembali ke Pembeli
          </Link>
        </Panel>
      </div>
    );
  }

  return (
    <div>
      {/* 1. Header */}
      <Panel>
        <div className="mb-2">
          <Link
            to="/pembeli"
            className="text-blue-600 hover:underline font-medium text-sm"
          >
            ← Kembali ke Pembeli
          </Link>
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <h1 className="text-2xl font-bold">{buyer.nama}</h1>
            <p className="text-slate-500 mt-1">
              {buyer.telepon || "—"} · {buyer.email || "—"}
            </p>
            <p className="text-slate-500 mt-1">{buyer.alamat || "—"}</p>
            {buyer.catatan && (
              <p className="text-sm text-slate-400 mt-1">{buyer.catatan}</p>
            )}
          </div>
          <PrimaryButton onClick={() => setEditing(true)}>Ubah</PrimaryButton>
        </div>
      </Panel>

      {/* 2. Ringkasan */}
      <Panel>
        <h2 className="text-lg font-bold mb-3">Ringkasan</h2>
        <div className="flex gap-6 flex-wrap">
          <Stat
            label="Total pesanan"
            value={formatAngka(buyerOrders.length)}
          />
          <Stat label="Total nilai" value={formatRupiah(totals.nilai)} />
          <Stat
            label="Belum lunas"
            value={formatRupiah(totals.belumLunas)}
            className={totals.belumLunas > 0 ? "text-amber-600" : ""}
          />
        </div>
      </Panel>

      {/* 3. Pesanan */}
      <Panel>
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-bold">Pesanan</h2>
          <span className="flex-1" />
          {buyerOrders.length > 0 && (
            <AttributionToggle show={showBy} onChange={setShowBy} />
          )}
        </div>
        {buyerOrders.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada pesanan.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Tanggal</th>
                  <th className={thClass}>Produk</th>
                  <th className={thClass}>Satuan</th>
                  <th className={`${thClass} text-right`}>Qty</th>
                  <th className={`${thClass} text-right`}>Harga Satuan</th>
                  <th className={`${thClass} text-right`}>Total</th>
                  <th className={thClass}>Status</th>
                  <ByHeaders show={bothBy(showBy)} className={thClass} />
                </tr>
              </thead>
              <tbody>
                {buyerOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className={tdClass}>
                      {formatTanggalID(o.tanggal)}
                      <span className="block text-xs text-slate-400">
                        Dibuat {formatDateTimeID(o.createdAt)}
                      </span>
                      {o.updatedAt !== o.createdAt && (
                        <span className="block text-xs text-slate-400">
                          Diubah {formatDateTimeID(o.updatedAt)}
                        </span>
                      )}
                    </td>
                    <td className={tdClass}>
                      {o.productId ? (
                        <Link
                          to="/produk/$id"
                          params={{ id: o.productId }}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {o.namaProduk}
                        </Link>
                      ) : (
                        o.namaProduk
                      )}
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
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
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
        )}
      </Panel>

      {/* 4. Riwayat */}
      <Panel>
        <h2 className="text-lg font-bold mb-3">Riwayat perubahan</h2>
        {buyerAudit.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada riwayat.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {buyerAudit.map((e) => (
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
        <BuyerDialog
          buyer={buyer}
          onSave={(b) => {
            upsertBuyer(b);
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
