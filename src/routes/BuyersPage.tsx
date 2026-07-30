import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Buyer } from "../lib/types";
import { useBuyers, useOrders, upsertBuyer, deleteBuyer } from "../lib/store";
import { formatRupiah, formatAngka, sumRupiah } from "../lib/format";
import { BuyerDialog } from "../components/BuyerDialog";
import { Button, PrimaryButton, DangerButton } from "../components/Button";
import { Input } from "../components/Input";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

export function BuyersPage() {
  const buyers = useBuyers();
  const orders = useOrders();
  const [editing, setEditing] = useState<Buyer | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");

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

  function removeBuyer(b: Buyer) {
    // Deleting a buyer deliberately does not touch their orders, so say out loud
    // what will be left behind — otherwise "Hapus" silently produces N rows
    // reading "(pembeli dihapus)". See docs/2026-07-29/plan.md §1.
    const n = statsByBuyer.get(b.id)?.count ?? 0;
    const tail =
      n === 0
        ? "Pembeli ini belum punya pesanan."
        : `${formatAngka(n)} pesanan tetap tercatat atas pembeli ini dan akan tampil sebagai "(pembeli dihapus)".`;
    if (!confirm(`Hapus pembeli "${b.nama}"?\n\n${tail}`)) return;
    deleteBuyer(b.id);
  }

  function upsert(buyer: Buyer) {
    upsertBuyer(buyer);
    setEditing(null);
    setCreating(false);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Pembeli</h1>
      <p className="text-slate-500 mb-4">
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
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={thClass}>Nama</th>
                <th className={thClass}>Telepon</th>
                <th className={thClass}>Email</th>
                <th className={`${thClass} text-right`}>Pesanan</th>
                <th className={`${thClass} text-right`}>Total Nilai</th>
                <th className={thClass}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => {
                const stats = statsByBuyer.get(b.id);
                return (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className={tdClass}>
                      <Link
                        to="/pembeli/$id"
                        params={{ id: b.id }}
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {b.nama}
                      </Link>
                    </td>
                    <td className={tdClass}>
                      {b.telepon || <span className="text-slate-400">—</span>}
                    </td>
                    <td className={tdClass}>
                      {b.email || <span className="text-slate-400">—</span>}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatAngka(stats?.count ?? 0)}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums font-semibold`}>
                      {formatRupiah(stats?.total ?? 0)}
                    </td>
                    <td className={tdClass}>
                      <div className="flex gap-1 justify-end">
                        <Button size="sm" onClick={() => setEditing(b)}>
                          Ubah
                        </Button>
                        <DangerButton size="sm" onClick={() => removeBuyer(b)}>
                          Hapus
                        </DangerButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && (
          <div className="text-center text-slate-400 py-8">
            Tidak ada pembeli.
          </div>
        )}
        <div className="text-slate-400 mt-2 text-xs">
          {buyers.length} pembeli
        </div>
      </Panel>

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
