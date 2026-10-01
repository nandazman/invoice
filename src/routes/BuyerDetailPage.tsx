import { Fragment, useMemo, useState } from "react";
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
  ByCell,
  ByCells,
  ByHeaders,
  bothBy,
} from "../components/Attribution";
import { BuyerDialog } from "../components/BuyerDialog";
import { Button } from "../components/Button";
import { Panel } from "../components/Panel";
import { Stat } from "../components/Stat";
import { thClass, tdClass } from "../components/DataTable";
import { PencilIcon, ChevronDownIcon } from "../components/icons";


const STATUS_LABEL: Record<string, string> = {
  pending: "Belum bayar",
  paid: "Lunas",
};

// Read-only here (changing status happens on Pesanan), so a tinted label, not a
// button.
function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
        status === "paid"
          ? "text-ok bg-ok-soft border-ok-line"
          : "text-warn bg-warn-soft border-warn-line"
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function BuyerDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const buyers = useBuyers();
  const orders = useOrders();
  const audit = useAudit();
  const [editing, setEditing] = useState(false);
  // Phone order rows opened into their detail card.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
          <p className="text-lg font-semibold text-muted mb-1">
            Pembeli tidak ditemukan
          </p>
          <p className="text-faint mb-4">
            Pembeli dengan id ini tidak ada atau sudah dihapus.
          </p>
          <Link
            to="/pembeli"
            className="text-brand hover:underline font-medium"
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
            className="text-brand hover:underline font-medium text-sm"
          >
            ← Kembali ke Pembeli
          </Link>
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <h1 className="text-2xl font-bold">{buyer.nama}</h1>
            <p className="text-faint mt-1">
              {buyer.telepon || "—"} · {buyer.email || "—"}
            </p>
            <p className="text-faint mt-1">{buyer.alamat || "—"}</p>
            {buyer.catatan && (
              <p className="text-sm text-faint mt-1">{buyer.catatan}</p>
            )}
          </div>
          <Button onClick={() => setEditing(true)}>
            <PencilIcon /> Ubah
          </Button>
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
            className={totals.belumLunas > 0 ? "text-warn" : ""}
          />
        </div>
      </Panel>

      {/* 3. Pesanan */}
      <Panel>
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-bold">Pesanan</h2>
          <span className="flex-1" />
          {buyerOrders.length > 0 && (
            <>
              <div className="hidden md:block">
                <AttributionToggle show={showBy} onChange={setShowBy} />
              </div>
              <Button
                size="sm"
                className="md:!hidden"
                onClick={() =>
                  setExpanded(
                    expanded.size > 0
                      ? new Set()
                      : new Set(buyerOrders.map((o) => o.id)),
                  )
                }
              >
                <ChevronDownIcon
                  className={expanded.size > 0 ? "rotate-180" : undefined}
                />
                {expanded.size > 0 ? "Tutup semua" : "Buka semua"}
              </Button>
            </>
          )}
        </div>
        {buyerOrders.length === 0 ? (
          <p className="text-sm text-faint">Belum ada pesanan.</p>
        ) : (
          <>
          <div className="md:hidden">
            {buyerOrders.map((o) => {
              const open = expanded.has(o.id);
              const kv: [string, React.ReactNode][] = [
                ["Tanggal", formatTanggalID(o.tanggal)],
                ["Satuan", o.satuan],
                ["Qty", formatAngka(o.kuantitas)],
                ["Harga satuan", formatRupiah(o.hargaSatuan)],
                ["Dibuat", formatDateTimeID(o.createdAt)],
                ...(o.updatedAt !== o.createdAt
                  ? ([["Diubah", formatDateTimeID(o.updatedAt)]] as [
                      string,
                      React.ReactNode,
                    ][])
                  : []),
                ["Dibuat oleh", <ByCell key="c" email={o.createdBy} />],
                ["Diperbarui oleh", <ByCell key="u" email={o.updatedBy} />],
              ];
              return (
                <div key={o.id} className="border-b border-line">
                  <div
                    className="flex items-center gap-2 pl-3 pr-2 min-h-11 cursor-pointer"
                    onClick={() => toggleExpanded(o.id)}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      className="flex-1 min-w-0 text-left font-medium break-words py-1"
                    >
                      {o.namaProduk}
                    </button>
                    <StatusBadge status={o.status} />
                    <span className="tabular-nums font-medium whitespace-nowrap">
                      {formatRupiah(o.totalHarga)}
                    </span>
                    <ChevronDownIcon
                      className={`h-4 w-4 shrink-0 text-faint ${open ? "rotate-180" : ""}`}
                    />
                  </div>
                  {open && (
                    <div className="bg-surface-sunken border-t border-line px-3 py-3 text-sm">
                      <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1.5">
                        <dt className="text-faint">Produk</dt>
                        <dd className="text-right">
                          {o.productId ? (
                            <Link
                              to="/produk/$id"
                              params={{ id: o.productId }}
                              className="text-brand hover:underline font-medium"
                            >
                              {o.namaProduk}
                            </Link>
                          ) : (
                            o.namaProduk
                          )}
                        </dd>
                        {kv.map(([label, value]) => (
                          <Fragment key={label}>
                            <dt className="text-faint">{label}</dt>
                            <dd className="text-right tabular-nums font-medium break-words">
                              {value}
                            </dd>
                          </Fragment>
                        ))}
                      </dl>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="overflow-x-auto hidden md:block">
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
                      {o.productId ? (
                        <Link
                          to="/produk/$id"
                          params={{ id: o.productId }}
                          className="text-brand hover:underline font-medium"
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
                      <StatusBadge status={o.status} />
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

      {/* 4. Riwayat */}
      <Panel>
        <h2 className="text-lg font-bold mb-3">Riwayat perubahan</h2>
        {buyerAudit.length === 0 ? (
          <p className="text-sm text-faint">Belum ada riwayat.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {buyerAudit.map((e) => (
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
