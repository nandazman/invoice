import { useMemo, useState } from "react";
import type { AuditEntry } from "../lib/types";
import { useAudit } from "../lib/audit";
import { formatDateTimeID } from "../lib/format";
import { usePersistentAttribution } from "../lib/columns";
import {
  AttributionToggle,
  MobileBy,
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
import { MobileList, MobileRow } from "../components/MobileList";

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

// Colored badge per entity kind.
function entityBadgeClass(entity: AuditEntry["entity"]): string {
  switch (entity) {
    case "product":
      return "text-indigo-700 bg-indigo-50 border-indigo-200";
    case "order":
      return "text-sky-700 bg-sky-50 border-sky-200";
    case "stock":
      return "text-amber-700 bg-amber-50 border-amber-200";
    case "type":
      return "text-violet-700 bg-violet-50 border-violet-200";
    case "purchase":
      return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "buyer":
      return "text-rose-700 bg-rose-50 border-rose-200";
  }
}

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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Riwayat</h1>
      <p className="text-faint mb-4">
        Catatan perubahan produk, pesanan, stok, dan tipe.
      </p>

      <Panel>
        <div className="flex gap-3 flex-wrap items-end">
          <Field label="Entitas" className="w-36">
            <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">Semua</option>
              <option value="product">Produk</option>
              <option value="order">Pesanan</option>
              <option value="stock">Stok</option>
              <option value="type">Tipe</option>
            </Select>
          </Field>
          <Field label="Aksi" className="w-36">
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">Semua</option>
              <option value="create">Dibuat</option>
              <option value="update">Diubah</option>
              <option value="delete">Dihapus</option>
            </Select>
          </Field>
          <Field label="Dari tanggal" className="w-36">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="Sampai tanggal" className="w-36">
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label="Cari" className="flex-1 min-w-[160px]">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari keterangan…"
            />
          </Field>
          {hasFilter && <Button onClick={clearFilters}>Reset</Button>}
        </div>
      </Panel>

      <Panel>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <span className="text-faint">{filtered.length} entri</span>
          <span className="flex-1" />
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
            {/* The phone layout. Four columns (plus attribution) don't fit at
                390px, so below `md` the row collapses to what it IS on the
                left (Keterangan, with the entitas/aksi badges and the
                per-change chips restacked under it) and what it is WORTH on
                the right (Waktu). The attribution toggle restacks there too. */}
            <div className="md:hidden">
              <MobileList left="Keterangan" right="Waktu">
                {filtered.map((e) => (
                  <MobileRow
                    key={e.id}
                    title={<span className="text-body">{e.label}</span>}
                    meta={
                      <>
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full border ${entityBadgeClass(
                            e.entity,
                          )}`}
                        >
                          {ENTITY_LABELS[e.entity]}
                        </span>
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full border ${actionBadgeClass(
                            e.action,
                          )}`}
                        >
                          {ACTION_LABELS[e.action]}
                        </span>
                        {e.changes &&
                          e.changes.length > 0 &&
                          e.changes.map((c, i) => (
                            <span
                              key={i}
                              className="inline-block px-1.5 py-0.5 text-xs text-faint bg-surface-sunken border border-line rounded"
                            >
                              <span className="font-medium">{c.field}</span>:{" "}
                              {formatValue(c.from)} → {formatValue(c.to)}
                            </span>
                          ))}
                        <MobileBy show={bothBy(showBy)} row={e} />
                      </>
                    }
                    value={splitWaktu(e.timestamp).tanggal}
                    note={splitWaktu(e.timestamp).jam}
                  />
                ))}
              </MobileList>
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
                    <td className={tdClass}>
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full border ${entityBadgeClass(
                          e.entity,
                        )}`}
                      >
                        {ENTITY_LABELS[e.entity]}
                      </span>
                    </td>
                    <td className={tdClass}>
                      <span
                        className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full border ${actionBadgeClass(
                          e.action,
                        )}`}
                      >
                        {ACTION_LABELS[e.action]}
                      </span>
                    </td>
                    <td className={tdClass}>
                      <div className="text-body">{e.label}</div>
                      {e.changes && e.changes.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {e.changes.map((c, i) => (
                            <span
                              key={i}
                              className="inline-block px-1.5 py-0.5 text-xs text-faint bg-surface-sunken border border-line rounded"
                            >
                              <span className="font-medium">{c.field}</span>:{" "}
                              {formatValue(c.from)} → {formatValue(c.to)}
                            </span>
                          ))}
                        </div>
                      )}
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
