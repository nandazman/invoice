import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Buyer } from "../lib/types";
import { useBuyers, useOrders, upsertBuyer, deleteBuyer } from "../lib/store";
import { formatRupiah, formatAngka, sumRupiah } from "../lib/format";
import { usePersistentAttribution } from "../lib/columns";
import {
  AttributionToggle,
  ByCells,
  ByHeaders,
  bothBy,
} from "../components/Attribution";
import { BuyerDialog } from "../components/BuyerDialog";
import {
  PrimaryButton,
  DangerGhostButton,
  GhostButton,
} from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Input } from "../components/Input";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";
import { thClass, tdClass } from "../components/DataTable";
import { MobileList, MobileRow } from "../components/MobileList";
import { TrashIcon, PencilIcon } from "../components/icons";


export function BuyersPage() {
  const buyers = useBuyers();
  const orders = useOrders();
  const [editing, setEditing] = useState<Buyer | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [showBy, setShowBy] = usePersistentAttribution(
    "invoice.pembeli.by.v1",
  );

  // One pass over the orders, keyed by buyer. A `.filter()` per row would be
  // O(buyers × orders) on every render, and both lists grow without bound.
  const statsByBuyer = useMemo(() => {
    const lines = new Map<string, number[]>();
    for (const o of orders) {
      if (!o.buyerId) continue;
      const prev = lines.get(o.buyerId);
      if (prev) prev.push(o.totalHarga);
      else lines.set(o.buyerId, [o.totalHarga]);
    }
    const out = new Map<string, { count: number; total: number }>();
    for (const [id, totals] of lines) {
      out.set(id, { count: totals.length, total: sumRupiah(totals) });
    }
    return out;
  }, [orders]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const sorted = [...buyers].sort((a, b) => a.nama.localeCompare(b.nama));
    if (!q) return sorted;
    return sorted.filter(
      (b) =>
        b.nama.toLowerCase().includes(q) ||
        b.telepon.toLowerCase().includes(q) ||
        b.email.toLowerCase().includes(q),
    );
  }, [buyers, filter]);

  // Which buyer is waiting for its delete confirmation. One slot: only ever one
  // dialog is on screen.
  const [deleting, setDeleting] = useState<Buyer | null>(null);
  // Deleting a buyer deliberately does not touch their orders, so say out loud
  // what will be left behind — otherwise "Hapus" silently produces N rows
  // reading "(pembeli dihapus)". See docs/2026-07-29/plan.md §1.
  const leftBehind = deleting ? (statsByBuyer.get(deleting.id)?.count ?? 0) : 0;

  function removeBuyer() {
    if (deleting) deleteBuyer(deleting.id);
    setDeleting(null);
  }

  function upsert(buyer: Buyer) {
    upsertBuyer(buyer);
    setEditing(null);
    setCreating(false);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Pembeli</h1>
      <p className="text-faint mb-4">
        Daftar pembeli beserta jumlah dan nilai pesanan mereka.
      </p>

      <Panel>
        <div className="flex gap-3 flex-wrap items-end mb-3">
          <Field label="Cari pembeli" className="flex-1 min-w-[220px]">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Ketik nama, telepon, atau email…"
            />
          </Field>
          <PrimaryButton onClick={() => setCreating(true)}>
            + Tambah Pembeli
          </PrimaryButton>
          <div className="h-9 flex items-center">
            <AttributionToggle show={showBy} onChange={setShowBy} />
          </div>
        </div>

        {/* The phone layout: the row collapses to who the buyer IS on the left
            and what they are WORTH on the right. Telepon and email restack
            under the name, the order count under the total. Ubah and Hapus
            join the meta line — the desktop action cell has nowhere else to go
            once the table is two columns wide, and the name stays the link to
            the buyer's page exactly as it is on the wide table. */}
        {shown.length > 0 && (
          <div className="md:hidden">
            <MobileList left="Nama" right="Total Nilai">
              {shown.map((b) => {
                const stats = statsByBuyer.get(b.id);
                return (
                  <MobileRow
                    key={b.id}
                    title={
                      <Link
                        to="/pembeli/$id"
                        params={{ id: b.id }}
                        className="flex items-center w-full min-h-11 text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        {b.nama}
                      </Link>
                    }
                    meta={
                      <>
                        <span>{b.telepon || "—"}</span>
                        <span>{b.email || "—"}</span>
                        <span className="flex gap-1 w-full">
                          <GhostButton
                            size="sm"
                            title={`Ubah pembeli "${b.nama}"`}
                            aria-label={`Ubah pembeli "${b.nama}"`}
                            onClick={() => setEditing(b)}
                          >
                            <PencilIcon />
                          </GhostButton>
                          <DangerGhostButton
                            size="sm"
                            title={`Hapus pembeli "${b.nama}"`}
                            aria-label={`Hapus pembeli "${b.nama}"`}
                            onClick={() => setDeleting(b)}
                          >
                            <TrashIcon />
                          </DangerGhostButton>
                        </span>
                      </>
                    }
                    value={formatRupiah(stats?.total ?? 0)}
                    note={`${formatAngka(stats?.count ?? 0)} pesanan`}
                  />
                );
              })}
            </MobileList>
          </div>
        )}

        <div className="overflow-x-auto hidden md:block">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={thClass}>Nama</th>
                <th className={thClass}>Telepon</th>
                <th className={thClass}>Email</th>
                <th className={`${thClass} text-right`}>Pesanan</th>
                <th className={`${thClass} text-right`}>Total Nilai</th>
                <ByHeaders show={bothBy(showBy)} className={thClass} />
                <th className={thClass}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => {
                const stats = statsByBuyer.get(b.id);
                return (
                  <tr key={b.id} className="hover:bg-surface-sunken">
                    <td className={tdClass}>
                      <Link
                        to="/pembeli/$id"
                        params={{ id: b.id }}
                        className="text-brand hover:underline font-medium"
                      >
                        {b.nama}
                      </Link>
                    </td>
                    <td className={tdClass}>
                      {b.telepon || <span className="text-faint">—</span>}
                    </td>
                    <td className={tdClass}>
                      {b.email || <span className="text-faint">—</span>}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatAngka(stats?.count ?? 0)}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums font-semibold`}>
                      {formatRupiah(stats?.total ?? 0)}
                    </td>
                    <ByCells
                      show={bothBy(showBy)}
                      row={b}
                      className={tdClass}
                    />
                    <td className={tdClass}>
                      <div className="flex gap-1 justify-end">
                        <GhostButton
                          size="sm"
                          title={`Ubah pembeli "${b.nama}"`}
                          aria-label={`Ubah pembeli "${b.nama}"`}
                          onClick={() => setEditing(b)}
                        >
                          <PencilIcon />
                        </GhostButton>
                        <DangerGhostButton
                          size="sm"
                          title={`Hapus pembeli "${b.nama}"`}
                          aria-label={`Hapus pembeli "${b.nama}"`}
                          onClick={() => setDeleting(b)}
                        >
                          <TrashIcon />
                        </DangerGhostButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && (
          <div className="text-center text-faint py-8">
            Tidak ada pembeli.
          </div>
        )}
        <div className="text-faint mt-2 text-xs">
          {buyers.length} pembeli
        </div>
      </Panel>

      {deleting && (
        <ConfirmDialog
          danger
          title={`Hapus pembeli "${deleting.nama}"?`}
          confirmLabel="Ya, hapus pembeli"
          onConfirm={removeBuyer}
          onClose={() => setDeleting(null)}
        >
          <p>
            Data pembeli ini — nama, telepon, dan email — dihapus dari daftar.
            Tidak bisa dibatalkan.
          </p>
          {leftBehind === 0 ? (
            <p>Pembeli ini belum punya pesanan.</p>
          ) : (
            <p>
              <strong>{formatAngka(leftBehind)} pesanan</strong> tetap tercatat
              atas pembeli ini dan tidak ikut terhapus. Setelah ini pesanan
              tersebut akan tampil sebagai “(pembeli dihapus)”.
            </p>
          )}
        </ConfirmDialog>
      )}

      {(creating || editing) && (
        <BuyerDialog
          buyer={editing}
          onSave={upsert}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
