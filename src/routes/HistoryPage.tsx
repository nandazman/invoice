import { useMemo, useState } from "react";
import type { AuditEntry } from "../lib/types";
import { useAudit } from "../lib/audit";
import { formatDateTimeID } from "../lib/format";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { Button } from "../components/Button";

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100 align-top";

const ENTITY_LABELS: Record<AuditEntry["entity"], string> = {
  product: "Produk",
  order: "Pesanan",
  stock: "Stok",
  type: "Tipe",
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
  }
}

// green=create, blue=update, red=delete
function actionBadgeClass(action: AuditEntry["action"]): string {
  switch (action) {
    case "create":
      return "text-emerald-700 bg-emerald-50 border-emerald-200";
    case "update":
      return "text-blue-700 bg-blue-50 border-blue-200";
    case "delete":
      return "text-red-700 bg-red-50 border-red-200";
  }
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
      <p className="text-slate-500 mb-4">
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
          <span className="text-slate-400">{filtered.length} entri</span>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center text-slate-400 py-8">
            {hasFilter
              ? "Tidak ada yang cocok dengan filter."
              : "Belum ada riwayat."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${thClass} whitespace-nowrap`}>Waktu</th>
                  <th className={thClass}>Entitas</th>
                  <th className={thClass}>Aksi</th>
                  <th className={thClass}>Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td
                      className={`${tdClass} text-xs text-slate-500 whitespace-nowrap`}
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
                      <div className="text-slate-700">{e.label}</div>
                      {e.changes && e.changes.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {e.changes.map((c, i) => (
                            <span
                              key={i}
                              className="inline-block px-1.5 py-0.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded"
                            >
                              <span className="font-medium">{c.field}</span>:{" "}
                              {formatValue(c.from)} → {formatValue(c.to)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
