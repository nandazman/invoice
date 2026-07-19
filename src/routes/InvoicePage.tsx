import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { OrderItem } from "../lib/types";
import type { InvoiceData, FieldType } from "../lib/template-types";
import { fieldKey } from "../lib/template-types";
import { useOrders, useProducts } from "../lib/store";
import { useTemplates } from "../lib/template-store";
import { formatRupiah, formatAngka, sumRupiah } from "../lib/format";
import { useOrderFilter, type StatusFilter } from "../lib/useOrderFilter";
import { Preview } from "../components/template/Preview";
import { FilterBar } from "../components/FilterBar";
import { CopyTextDialog } from "../components/CopyTextDialog";
import { Panel } from "../components/Panel";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { Field } from "../components/Field";
import { Button, PrimaryButton, DangerButton } from "../components/Button";

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

export function InvoicePage() {
  const orders = useOrders();
  const products = useProducts();
  const templates = useTemplates();

  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");
  const template = templates.find((t) => t.id === templateId) ?? templates[0] ?? null;

  // Dynamic fields come from the template's field elements: collect unique
  // definitions by title (same title placed twice shares one input).
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const fieldDefs = useMemo(() => {
    const seen = new Map<string, { label: string; type: FieldType; options: string[] }>();
    for (const el of template?.elements ?? []) {
      if (el.type !== "field") continue;
      const label = (el.fieldLabel ?? "").trim();
      if (!label) continue;
      const key = fieldKey(label);
      if (!seen.has(key)) {
        seen.set(key, {
          label,
          type: el.fieldType ?? "text",
          options: el.fieldOptions ?? [],
        });
      }
    }
    return [...seen.values()];
  }, [template]);

  const filter = useOrderFilter(orders, products);
  const { filtered } = filter;
  const [staged, setStaged] = useState<OrderItem[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [showPrice, setShowPrice] = useState(true);
  const [copyOpen, setCopyOpen] = useState(false);

  function appendFiltered() {
    setStaged((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...filtered.filter((f) => !seen.has(f.id))];
    });
  }
  function replaceFiltered() {
    setStaged(filtered);
    setSelectedRows(new Set());
  }
  function toggleRow(id: string) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelectedRows((prev) =>
      prev.size === staged.length ? new Set() : new Set(staged.map((s) => s.id)),
    );
  }
  function removeSelected() {
    setStaged((prev) => prev.filter((s) => !selectedRows.has(s.id)));
    setSelectedRows(new Set());
  }

  const stagedSorted = useMemo(
    () => [...staged].sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    [staged],
  );
  const total = sumRupiah(staged.map((i) => i.totalHarga));

  const data: InvoiceData = {
    items: stagedSorted,
    total,
    fields: fieldValues,
  };

  if (!template) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Buat Invoice</h1>
        <Panel>
          <p className="text-slate-500">
            Belum ada template. Buat dulu di halaman <b>Desain Template</b>.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4 no-print">
        <h1 className="text-2xl font-bold mr-2">Buat Invoice</h1>
        <Select
          value={template.id}
          onChange={(e) => setTemplateId(e.target.value)}
          className="w-auto"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nama}
            </option>
          ))}
        </Select>
        <Button
          className="ml-auto"
          onClick={() => setCopyOpen(true)}
          disabled={staged.length === 0}
        >
          Salin teks
        </Button>
        <PrimaryButton
          onClick={() => window.print()}
          disabled={staged.length === 0}
        >
          Cetak / PDF
        </PrimaryButton>
      </div>

      <div className="flex gap-4 items-start no-print">
        <div className="w-80 shrink-0 space-y-4">
          <Panel>
            <h3 className="font-bold text-sm text-slate-700 mb-2">Data Invoice</h3>
            {fieldDefs.length === 0 ? (
              <p className="text-xs text-slate-400">
                Template ini belum punya field. Tambahkan elemen <b>Field</b> di
                halaman Desain Template.
              </p>
            ) : (
              <div className="space-y-2">
                {fieldDefs.map((f) => {
                  const key = fieldKey(f.label);
                  const val = fieldValues[key] ?? "";
                  const set = (v: string) =>
                    setFieldValues((prev) => ({ ...prev, [key]: v }));
                  return (
                    <Field key={key} label={f.label}>
                      {f.type === "select" ? (
                        <Select value={val} onChange={(e) => set(e.target.value)}>
                          <option value="">— pilih —</option>
                          {f.options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          type={
                            f.type === "number"
                              ? "number"
                              : f.type === "date"
                                ? "date"
                                : "text"
                          }
                          value={val}
                          onChange={(e) => set(e.target.value)}
                        />
                      )}
                    </Field>
                  );
                })}
              </div>
            )}
          </Panel>

          <FilterBar
            filter={filter}
            className="flex flex-col gap-2"
            fieldClassName="w-full"
          >
            <Field label="Status">
              <Select
                value={filter.values.status}
                onChange={(e) =>
                  filter.set({ status: e.target.value as StatusFilter })
                }
              >
                <option value="semua">Semua</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
              </Select>
            </Field>
          </FilterBar>

          <Panel>
            <h3 className="font-bold text-sm text-slate-700 mb-2">Pilih Item Pesanan</h3>
            <div className="flex gap-2">
              <Button size="sm" onClick={appendFiltered} className="flex-1">
                Tambah
              </Button>
              <Button size="sm" onClick={replaceFiltered} className="flex-1">
                Ganti semua
              </Button>
            </div>
          </Panel>

          <Panel>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-700">{formatRupiah(total)}</span>
              <span className="text-xs text-slate-400">{staged.length} item</span>
            </div>
            {staged.length > 0 && (
              <div className="mb-2">
                <DangerButton
                  size="sm"
                  onClick={removeSelected}
                  disabled={selectedRows.size === 0}
                >
                  Hapus terpilih ({selectedRows.size})
                </DangerButton>
              </div>
            )}
            {staged.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-3">Belum ada item.</p>
            ) : (
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={`${thClass} w-8`}>
                        <input
                          type="checkbox"
                          checked={selectedRows.size === staged.length}
                          onChange={toggleAll}
                        />
                      </th>
                      <th className={thClass}>Produk</th>
                      <th className={`${thClass} text-right`}>Qty</th>
                      <th className={`${thClass} text-right`}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stagedSorted.map((it) => (
                      <tr key={it.id} className="hover:bg-slate-50">
                        <td className={tdClass}>
                          <input
                            type="checkbox"
                            checked={selectedRows.has(it.id)}
                            onChange={() => toggleRow(it.id)}
                          />
                        </td>
                        <td className={tdClass}>{it.namaProduk}</td>
                        <td className={`${tdClass} text-right tabular-nums`}>
                          {formatAngka(it.kuantitas)}
                        </td>
                        <td className={`${tdClass} text-right tabular-nums`}>
                          {formatRupiah(it.totalHarga)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="flex-1 min-w-0 bg-slate-100 rounded-xl p-4">
          <Preview template={template} data={data} />
        </div>
      </div>

      {copyOpen && (
        <CopyTextDialog
          items={stagedSorted}
          title="🧾 Invoice"
          showPrice={showPrice}
          onShowPriceChange={setShowPrice}
          onClose={() => setCopyOpen(false)}
        />
      )}

      {/* Full-size pages used only for printing. Rendered into <body> (outside
          #root) so the multi-page invoice flows and breaks per A4 sheet — a
          position:absolute overlay inside the app shell can't paginate. */}
      {createPortal(
        <div className="print-portal">
          <Preview template={template} data={data} fit={false} />
        </div>,
        document.body,
      )}
    </div>
  );
}
