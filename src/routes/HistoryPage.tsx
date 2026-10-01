import { useMemo, useState } from "react";
import type { AuditEntry } from "../lib/types";
import { useAudit } from "../lib/audit";
import { formatDateTimeID } from "../lib/format";
import { usePersistentAttribution } from "../lib/columns";
import {
  AttributionToggle,
  ByCell,
  ByCells,
  ByHeaders,
  bothBy,
} from "../components/Attribution";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { Button } from "../components/Button";
import { thClass, tdClass as tdBase } from "../components/DataTable";
import { Modal } from "../components/Modal";
import { PrimaryButton } from "../components/Button";
import {
  ChevronDownIcon,
  CloseIcon,
  FilterIcon,
  SearchIcon,
} from "../components/icons";

const tdClass = `${tdBase} align-top`;

const ENTITY_LABELS: Record<AuditEntry["entity"], string> = {
  product: "Produk",
  order: "Pesanan",
  stock: "Stok",
  type: "Tipe",
  purchase: "Beli Stok",
  buyer: "Pembeli",
};

const ACTION_LABELS: Record<AuditEntry["action"], string> = {
  create: "Dibuat",
  update: "Diubah",
  delete: "Dihapus",
};

// green=create, blue=update, red=delete
function actionBadgeClass(action: AuditEntry["action"]): string {
  switch (action) {
    case "create":
      return "text-ok-text bg-ok-soft border-ok-line";
    case "update":
      return "text-brand-text bg-brand-soft border-brand-line";
    case "delete":
      return "text-danger-text bg-danger-soft border-danger-line";
  }
}

// The phone Waktu column has no room for formatDateTimeID's full
// "27 Jun 2026, 15.30" next to a badge-carrying left column, so this trims it
// to "27/06, 15.30" for that layout only — desktop keeps the full form.
// The phone layout's right column is a timestamp, not an amount, and
// "27 Jun 2026, 15.30" on one non-wrapping line would set the column's minimum
// width. Splitting it across the value and its note keeps the YEAR — an audit
// log outlives a calendar year, so a date without one is ambiguous — while
// letting the column stay narrow. Desktop still shows the single-line form.
function splitWaktu(iso: string): { tanggal: string; jam: string } {
  const full = formatDateTimeID(iso);
  const at = full.lastIndexOf(", ");
  if (at < 0) return { tanggal: full, jam: "" };
  return { tanggal: full.slice(0, at), jam: full.slice(at + 2) };
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export function HistoryPage() {
  const audit = useAudit();

  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  // The audit log is pushed like every other table, so its entries carry the
  // same server-stamped attribution — "who was logged in when this was logged".
  const [showBy, setShowBy] = usePersistentAttribution("invoice.riwayat.by.v1");

  function clearFilters() {
    setEntity("");
    setAction("");
    setFrom("");
    setTo("");
    setQuery("");
  }

  const hasFilter = !!(entity || action || from || to || query);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return audit
      .filter((e) => {
        if (entity && e.entity !== entity) return false;
        if (action && e.action !== action) return false;
        const day = e.timestamp.slice(0, 10);
        if (from && day < from) return false;
        if (to && day > to) return false;
        if (q && !e.label.toLowerCase().includes(q)) return false;
        return true;
      })
      // newest first
      .slice()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [audit, entity, action, from, to, query]);

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Chips for what the Filter panel applied; the search box is already on the bar.
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (entity)
    chips.push({
      key: "entity",
      label: `Entitas: ${ENTITY_LABELS[entity as AuditEntry["entity"]]}`,
      clear: () => setEntity(""),
    });
  if (action)
    chips.push({
      key: "action",
      label: `Aksi: ${ACTION_LABELS[action as AuditEntry["action"]]}`,
      clear: () => setAction(""),
    });
  if (from)
    chips.push({ key: "from", label: `Dari ${from}`, clear: () => setFrom("") });
  if (to)
    chips.push({ key: "to", label: `Sampai ${to}`, clear: () => setTo("") });

  const changeChips = (e: AuditEntry) =>
    e.changes && e.changes.length > 0 ? (
      <div className="mt-1 flex flex-wrap gap-1">
        {e.changes.map((c, i) => (
          <span
            key={i}
            className="inline-block px-1.5 py-0.5 text-xs text-faint bg-surface-sunken border border-line rounded"
          >
            <span className="font-medium">{c.field}</span>: {formatValue(c.from)}{" "}
            → {formatValue(c.to)}
          </span>
        ))}
      </div>
    ) : null;

  const actionBadge = (a: AuditEntry["action"]) => (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border whitespace-nowrap ${actionBadgeClass(a)}`}
    >
      {ACTION_LABELS[a]}
    </span>
  );

  return (
    <div>
      <h1 className="hidden md:block text-2xl font-bold mb-1">Riwayat</h1>
      <p className="hidden md:block text-faint mb-4">
        Catatan perubahan produk, pesanan, stok, dan tipe.
      </p>

      <Panel>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-faint pointer-events-none" />
              <Input
                className="!pl-8"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari keterangan…"
                aria-label="Cari keterangan"
              />
            </div>
            <Button onClick={() => setOpen(true)}>
              <FilterIcon />
              Filter{chips.length > 0 && ` (${chips.length})`}
            </Button>
          </div>
          {hasFilter && (
            <div className="flex gap-1.5 flex-wrap items-center">
              {chips.map((c) => (
                <span
                  key={c.key}
                  className="inline-flex items-center gap-1 rounded border border-brand-line bg-brand-soft text-brand-text pl-2 pr-1 py-0.5 text-xs font-semibold"
                >
                  {c.label}
                  <button
                    type="button"
                    onClick={c.clear}
                    aria-label={`Hapus filter ${c.label}`}
                    className="rounded p-0.5 hover:bg-brand-line cursor-pointer"
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-semibold text-muted hover:text-body underline cursor-pointer"
              >
                Reset
              </button>
            </div>
          )}
        </div>

        {open && (
          <Modal
            onClose={() => setOpen(false)}
            className="bg-surface p-4 md:p-5 w-full max-w-md overflow-auto"
          >
            <div className="flex items-center mb-3">
              <h2 className="text-lg font-bold flex-1">Filter</h2>
              <Button
                size="sm"
                className="!border-transparent"
                onClick={() => setOpen(false)}
                aria-label="Tutup"
              >
                <CloseIcon />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Entitas">
                <Select
                  value={entity}
                  onChange={(e) => setEntity(e.target.value)}
                >
                  <option value="">Semua</option>
                  <option value="product">Produk</option>
                  <option value="order">Pesanan</option>
                  <option value="stock">Stok</option>
                  <option value="type">Tipe</option>
                </Select>
              </Field>
              <Field label="Aksi">
                <Select
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="">Semua</option>
                  <option value="create">Dibuat</option>
                  <option value="update">Diubah</option>
                  <option value="delete">Dihapus</option>
                </Select>
              </Field>
              <Field label="Dari tanggal">
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field label="Sampai tanggal">
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <span className="text-sm text-faint">
                {filtered.length} cocok
              </span>
              <span className="flex-1" />
              {hasFilter && <Button onClick={clearFilters}>Reset</Button>}
              <PrimaryButton onClick={() => setOpen(false)}>
                Selesai
              </PrimaryButton>
            </div>
          </Modal>
        )}
      </Panel>

      <Panel>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <span className="text-faint">{filtered.length} entri</span>
          <span className="flex-1" />
          <Button
            size="sm"
            className="md:!hidden"
            onClick={() =>
              setExpanded(
                expanded.size > 0
                  ? new Set()
                  : new Set(filtered.map((e) => e.id)),
              )
            }
          >
            <ChevronDownIcon
              className={expanded.size > 0 ? "rotate-180" : undefined}
            />
            {expanded.size > 0 ? "Tutup semua" : "Buka semua"}
          </Button>
          <AttributionToggle show={showBy} onChange={setShowBy} />
        </div>

        {filtered.length === 0 ? (
          <div className="text-center text-faint py-8">
            {hasFilter
              ? "Tidak ada yang cocok dengan filter."
              : "Belum ada riwayat."}
          </div>
        ) : (
          <>
            {/* Phone: collapsed row = keterangan, aksi and date; tap for the
                detail card (entitas, changes, attribution). */}
            <div className="md:hidden border-t border-line">
              {filtered.map((e) => {
                const isOpen = expanded.has(e.id);
                const w = splitWaktu(e.timestamp);
                const by = bothBy(showBy);
                return (
                  <div key={e.id} className="border-b border-line">
                    <div
                      className="flex items-center gap-2 px-1 min-h-11 cursor-pointer"
                      onClick={() => toggleExpanded(e.id)}
                    >
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        className="flex-1 min-w-0 text-left break-words py-1 text-body"
                      >
                        {e.label}
                      </button>
                      {actionBadge(e.action)}
                      <span className="text-xs text-faint whitespace-nowrap text-right leading-tight">
                        {w.tanggal}
                        <br />
                        {w.jam}
                      </span>
                      <ChevronDownIcon
                        className={`h-4 w-4 shrink-0 text-faint ${isOpen ? "rotate-180" : ""}`}
                      />
                    </div>
                    {isOpen && (
                      <div className="bg-surface-sunken border-t border-line px-3 py-3 text-sm">
                        <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1.5">
                          <dt className="text-faint">Entitas</dt>
                          <dd className="text-right font-medium">
                            {ENTITY_LABELS[e.entity]}
                          </dd>
                          <dt className="text-faint">Waktu</dt>
                          <dd className="text-right font-medium">
                            {formatDateTimeID(e.timestamp)}
                          </dd>
                          {by.created && (
                            <>
                              <dt className="text-faint">Dibuat oleh</dt>
                              <dd className="text-right">
                                <ByCell email={e.createdBy} />
                              </dd>
                            </>
                          )}
                          {by.updated && (
                            <>
                              <dt className="text-faint">Diperbarui oleh</dt>
                              <dd className="text-right">
                                <ByCell email={e.updatedBy} />
                              </dd>
                            </>
                          )}
                        </dl>
                        {changeChips(e)}
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
                    <th className={`${thClass} whitespace-nowrap`}>Waktu</th>
                    <th className={thClass}>Entitas</th>
                    <th className={thClass}>Aksi</th>
                    <th className={thClass}>Keterangan</th>
                    <ByHeaders show={bothBy(showBy)} className={thClass} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id} className="hover:bg-surface-sunken">
                      <td
                        className={`${tdClass} text-xs text-faint whitespace-nowrap`}
                      >
                        {formatDateTimeID(e.timestamp)}
                      </td>
                      <td className={`${tdClass} text-muted`}>
                        {ENTITY_LABELS[e.entity]}
                      </td>
                      <td className={tdClass}>{actionBadge(e.action)}</td>
                      <td className={tdClass}>
                        <div className="text-body">{e.label}</div>
                        {changeChips(e)}
                      </td>
                      <ByCells
                        show={bothBy(showBy)}
                        row={e}
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
    </div>
  );
}
