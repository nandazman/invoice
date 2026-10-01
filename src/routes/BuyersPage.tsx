import { Fragment, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Buyer } from "../lib/types";
import { useBuyers, useOrders, upsertBuyer, deleteBuyer } from "../lib/store";
import { formatRupiah, formatAngka, sumRupiah } from "../lib/format";
import {
  usePersistentAttribution,
  usePersistentVisibility,
  ATTRIBUTION_COLUMNS,
  ATTRIBUTION_COLUMN_IDS,
} from "../lib/columns";
import {
  AttributionToggle,
  ByCell,
  ByCells,
  ByHeaders,
  bothBy,
} from "../components/Attribution";
import { BuyerDialog } from "../components/BuyerDialog";
import { Button, PrimaryButton, GhostButton } from "../components/Button";
import { ColumnToggle } from "../components/ColumnToggle";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Input } from "../components/Input";
import { Panel } from "../components/Panel";
import { thClass, tdClass } from "../components/DataTable";
import {
  PlusIcon,
  PencilIcon,
  ChevronDownIcon,
  SearchIcon,
} from "../components/icons";

// The lines of the phone detail card the Kolom menu can switch. Nama (the
// collapsed row and the card's link) and the total are fixed. Phone only: the
// desktop table is not column-toggled.
const COLUMNS = [
  { id: "telepon", label: "Telepon" },
  { id: "email", label: "Email" },
  { id: "pesanan", label: "Pesanan" },
  ...ATTRIBUTION_COLUMNS,
];
const COLUMN_DEFAULTS = Object.fromEntries(
  COLUMNS.map((c) => [c.id, !ATTRIBUTION_COLUMN_IDS.includes(c.id)]),
);

export function BuyersPage() {
  const buyers = useBuyers();
  const orders = useOrders();
  const [editing, setEditing] = useState<Buyer | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  // Phone rows opened into their detail card.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [visible, toggleCol] = usePersistentVisibility(
    "invoice.pembeli.cols.v1",
    COLUMN_DEFAULTS,
  );
  const [showBy, setShowBy] = usePersistentAttribution("invoice.pembeli.by.v1");

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
      <div className="hidden md:flex items-start gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold mb-1">Pembeli</h1>
          <p className="text-faint">
            Daftar pembeli beserta jumlah dan nilai pesanan mereka.
          </p>
        </div>
        <PrimaryButton onClick={() => setCreating(true)}>
          <PlusIcon /> Tambah
        </PrimaryButton>
      </div>

      <Panel>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <div className="relative flex-1 min-w-[200px] md:max-w-sm">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-faint pointer-events-none" />
            <Input
              className="!pl-8"
              aria-label="Cari pembeli"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Cari nama, telepon, atau email…"
            />
          </div>
          <span className="flex-1 hidden md:block" />
          <div className="hidden md:flex h-9 items-center">
            <AttributionToggle show={showBy} onChange={setShowBy} />
          </div>
          <PrimaryButton
            className="md:hidden"
            onClick={() => setCreating(true)}
          >
            <PlusIcon /> Tambah
          </PrimaryButton>
          <Button
            size="sm"
            className="md:!hidden"
            onClick={() =>
              setExpanded(
                expanded.size > 0 ? new Set() : new Set(shown.map((b) => b.id)),
              )
            }
          >
            <ChevronDownIcon
              className={expanded.size > 0 ? "rotate-180" : undefined}
            />
            {expanded.size > 0 ? "Tutup semua" : "Buka semua"}
          </Button>
          <div className="md:hidden">
            <ColumnToggle
              columns={COLUMNS}
              visible={visible}
              onToggle={toggleCol}
            />
          </div>
        </div>

        {/* Phone: name left, what the buyer is WORTH right; tap for the card
            with telepon, email and Ubah. Hapus lives in the Ubah dialog. */}
        {shown.length > 0 && (
          <div className="md:hidden">
            {shown.map((b) => {
              const stats = statsByBuyer.get(b.id);
              const open = expanded.has(b.id);
              const all: [string, string, React.ReactNode][] = [
                [
                  "telepon",
                  "Telepon",
                  b.telepon || <span className="text-faint">—</span>,
                ],
                [
                  "email",
                  "Email",
                  b.email || <span className="text-faint">—</span>,
                ],
                ["pesanan", "Pesanan", formatAngka(stats?.count ?? 0)],
                [
                  "createdBy",
                  "Dibuat oleh",
                  <ByCell key="c" email={b.createdBy} />,
                ],
                [
                  "updatedBy",
                  "Diperbarui oleh",
                  <ByCell key="u" email={b.updatedBy} />,
                ],
              ];
              const kv = all.filter(([id]) => visible[id] !== false);
              return (
                <div key={b.id} className="border-b border-line">
                  <div
                    className="flex items-center gap-2 pl-3 pr-2 min-h-11 cursor-pointer"
                    onClick={() => toggleExpanded(b.id)}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      className="flex-1 min-w-0 text-left font-medium break-words py-1"
                    >
                      {b.nama}
                    </button>
                    <span className="tabular-nums font-medium whitespace-nowrap">
                      {formatRupiah(stats?.total ?? 0)}
                    </span>
                    <ChevronDownIcon
                      className={`h-4 w-4 shrink-0 text-faint ${open ? "rotate-180" : ""}`}
                    />
                  </div>
                  {open && (
                    <div className="bg-surface-sunken border-t border-line px-3 py-3 text-sm">
                      <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1.5">
                        <dt className="text-faint">Nama</dt>
                        <dd className="text-right">
                          <Link
                            to="/pembeli/$id"
                            params={{ id: b.id }}
                            className="text-brand hover:underline font-medium"
                          >
                            {b.nama}
                          </Link>
                        </dd>
                        {kv.map(([id, label, value]) => (
                          <Fragment key={id}>
                            <dt className="text-faint">{label}</dt>
                            <dd className="text-right tabular-nums font-medium break-words">
                              {value}
                            </dd>
                          </Fragment>
                        ))}
                      </dl>
                      <div className="flex justify-end mt-3">
                        <Button size="sm" onClick={() => setEditing(b)}>
                          <PencilIcon /> Edit
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
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
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatRupiah(stats?.total ?? 0)}
                    </td>
                    <ByCells
                      show={bothBy(showBy)}
                      row={b}
                      className={tdClass}
                    />
                    <td className={`${tdClass} text-right whitespace-nowrap`}>
                      <GhostButton
                        size="sm"
                        title={`Ubah pembeli "${b.nama}"`}
                        aria-label={`Ubah pembeli "${b.nama}"`}
                        onClick={() => setEditing(b)}
                      >
                        <PencilIcon />
                      </GhostButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && (
          <div className="text-center text-faint py-8">Tidak ada pembeli.</div>
        )}
        <div className="text-faint mt-2 text-xs">{buyers.length} pembeli</div>
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
          onDelete={
            editing
              ? () => {
                  setDeleting(editing);
                  setEditing(null);
                }
              : undefined
          }
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
