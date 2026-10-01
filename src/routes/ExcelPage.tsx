import { useMemo, useState } from "react";
import { useOrders, useProducts, usePurchases } from "../lib/store";
import { formatRupiah, formatAngka, formatTanggalID } from "../lib/format";
import { useStagedHandoff } from "../lib/stageHandoff";
import { downloadOrdersXLSX } from "../lib/excel";
import { copyOrdersImage, downloadOrdersImage } from "../lib/orderImage";
import {
  useOrderFilter,
  type FilterableRow,
} from "../lib/useOrderFilter";
import {
  Button,
  PrimaryButton,
  DangerButton,
  DangerGhostButton,
} from "../components/Button";
import { Select } from "../components/Select";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";
import { OrderFilterBar } from "../components/OrderFilterBar";
import { CopyTextDialog } from "../components/CopyTextDialog";
import {
  StagedPhoneList,
  ExpandAllButton,
  useExpandAll,
} from "./stagedRows";
import { thClass, tdClass } from "../components/DataTable";
import { TrashIcon } from "../components/icons";

type Source = "order" | "beli";

// A staged/exported row: the common line fields plus an id for selection.
type Row = FilterableRow;

const SOURCE_LABELS: Record<
  Source,
  { title: string; sheetName: string; filename: string }
> = {
  order: { title: "🧾 Pesanan", sheetName: "Orders", filename: "order" },
  beli: { title: "🧾 Beli Stock", sheetName: "Beli Stock", filename: "beli-stok" },
};


export function ExcelPage() {
  const orders = useOrders();
  const purchases = usePurchases();
  const products = useProducts();

  const [source, setSource] = useState<Source>("order");

  const [staged, setStaged] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // When off, exports drop prices/totals and show only a date-grouped listing.
  const [showPrice, setShowPrice] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [textOpen, setTextOpen] = useState(false);

  // The active dataset. Both OrderItem and PurchaseItem satisfy Row.
  const dataset: Row[] = source === "order" ? orders : purchases;
  const labels = SOURCE_LABELS[source];

  const filter = useOrderFilter(dataset, products);
  const filtered = filter.filtered;

  useStagedHandoff(orders, (picked) => {
    setSource("order");
    setStaged(picked);
  });

  // Switching source starts fresh: no filters (purchases have no status) and no
  // staging/selection so the two sources never mix in a single export.
  function changeSource(next: Source) {
    if (next === source) return;
    setSource(next);
    filter.clear();
    setStaged([]);
    setSelected(new Set());
  }

  function appendFiltered() {
    setStaged((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      const additions = filtered.filter((f) => !seen.has(f.id));
      return [...prev, ...additions];
    });
  }
  function replaceFiltered() {
    setStaged(filtered);
    setSelected(new Set());
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === staged.length ? new Set() : new Set(staged.map((s) => s.id)),
    );
  }
  function removeSelected() {
    setStaged((prev) => prev.filter((s) => !selected.has(s.id)));
    setSelected(new Set());
  }
  function removeRow(id: string) {
    setStaged((prev) => prev.filter((s) => s.id !== id));
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function copyImage() {
    try {
      await copyOrdersImage(stagedSorted, { showPrice });
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 2500);
    }
  }

  // Show staging sorted by date ascending (matches export grouping).
  const stagedSorted = useMemo(
    () => [...staged].sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    [staged],
  );

  const grandTotal = staged.reduce((s, i) => s + i.totalHarga, 0);
  const allChecked = staged.length > 0 && selected.size === staged.length;
  const exp = useExpandAll(staged.map((s) => s.id));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end gap-2 sm:gap-3 mb-1">
        <h1 className="hidden md:block text-2xl font-bold sm:mr-auto">Ekspor Excel</h1>
        <Field label="Sumber" className="w-full sm:w-36">
          <Select
            value={source}
            onChange={(e) => changeSource(e.target.value as Source)}
          >
            <option value="order">Order</option>
            <option value="beli">Beli Stock</option>
          </Select>
        </Field>
      </div>
      <p className="text-faint mb-4">
        Pilih item ke area staging, lalu ekspor ke berkas{" "}
        <b>{labels.filename}.xlsx</b>.
      </p>

      <OrderFilterBar filter={filter} showStatus={source === "order"} />

      <Panel>
        <div className="flex gap-2 flex-wrap items-center">
          <span className="flex-1" />
          <Button size="sm" onClick={appendFiltered}>Tambah sesuai filter ({filter.filtered.length})</Button>
          <Button size="sm" onClick={replaceFiltered}>Ganti semua</Button>
        </div>
      </Panel>

      <Panel>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          {showPrice && (
            <span className="text-lg font-bold">
              Total: {formatRupiah(grandTotal)}
            </span>
          )}
          <span className="text-faint">· {staged.length} item</span>
          <span className="flex-1" />
          {staged.length > 0 && (
            <ExpandAllButton anyOpen={exp.open.size > 0} onClick={exp.toggleAll} />
          )}
        </div>
        <div className="flex gap-2 flex-wrap items-center justify-end mb-3">
          <label className="flex items-center gap-1.5 text-sm text-muted select-none cursor-pointer mr-auto">
            <input
              type="checkbox"
              className="w-4 h-4 accent-brand cursor-pointer"
              checked={showPrice}
              onChange={(e) => setShowPrice(e.target.checked)}
            />
            Tampilkan harga
          </label>
          <DangerButton size="sm" onClick={removeSelected} disabled={selected.size === 0}>
            Hapus terpilih
          </DangerButton>
          <Button size="sm" onClick={() => setTextOpen(true)} disabled={staged.length === 0}>
            Salin teks
          </Button>
          <Button size="sm" onClick={copyImage} disabled={staged.length === 0}>
            {copyState === "copied"
              ? "✓ Tersalin"
              : copyState === "error"
                ? "Gagal menyalin"
                : "Salin gambar"}
          </Button>
          <Button size="sm"
            onClick={() =>
              downloadOrdersImage(stagedSorted, {
                filename: `${labels.filename}.png`,
                showPrice,
              })
            }
            disabled={staged.length === 0}
          >
            Unduh gambar
          </Button>
          <PrimaryButton size="sm"
            onClick={() =>
              downloadOrdersXLSX(stagedSorted, {
                sheetName: labels.sheetName,
                filename: `${labels.filename}.xlsx`,
                showPrice,
              })
            }
            disabled={staged.length === 0}
          >
            Ekspor XLSX
          </PrimaryButton>
        </div>

        {staged.length === 0 ? (
          <div className="text-center text-faint py-8">
            Belum ada data di staging. Gunakan filter lalu tambahkan.
          </div>
        ) : (
          <>
            <StagedPhoneList
              className="-mx-4"
              rows={stagedSorted}
              selected={selected}
              open={exp.open}
              onToggleSelected={toggleRow}
              onToggleOpen={exp.toggle}
              onToggleAll={toggleAll}
              details={(it) => [
                ["Tanggal", formatTanggalID(it.tanggal)],
                ["Kuantitas", formatAngka(it.kuantitas)],
                ["Harga Satuan", formatRupiah(it.hargaSatuan)],
                ["Total", formatRupiah(it.totalHarga)],
              ]}
              actions={(it) => (
                <DangerGhostButton
                  size="sm"
                  onClick={() => removeRow(it.id)}
                  aria-label="Hapus dari staging"
                >
                  <TrashIcon /> Hapus dari staging
                </DangerGhostButton>
              )}
            />

          <div className="overflow-x-auto hidden md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${thClass} w-8`}>
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-brand cursor-pointer"
                      checked={allChecked}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className={thClass}>Tanggal</th>
                  <th className={thClass}>Nama Produk</th>
                  <th className={`${thClass} text-right`}>Kuantitas</th>
                  {showPrice && (
                    <>
                      <th className={`${thClass} text-right`}>Harga Satuan</th>
                      <th className={`${thClass} text-right`}>Total</th>
                    </>
                  )}
                  <th className={`${thClass} w-8`}></th>
                </tr>
              </thead>
              <tbody>
                {stagedSorted.map((it) => (
                  <tr key={it.id} className="hover:bg-surface-sunken">
                    <td className={tdClass}>
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-brand cursor-pointer"
                        checked={selected.has(it.id)}
                        onChange={() => toggleRow(it.id)}
                      />
                    </td>
                    <td className={tdClass}>{formatTanggalID(it.tanggal)}</td>
                    <td className={tdClass}>{it.namaProduk}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatAngka(it.kuantitas)}
                    </td>
                    {showPrice && (
                      <>
                        <td className={`${tdClass} text-right tabular-nums`}>
                          {formatRupiah(it.hargaSatuan)}
                        </td>
                        <td className={`${tdClass} text-right tabular-nums`}>
                          {formatRupiah(it.totalHarga)}
                        </td>
                      </>
                    )}
                    <td className={`${tdClass} text-right`}>
                      <DangerGhostButton
                        size="sm"
                        onClick={() => removeRow(it.id)}
                        title="Hapus dari staging"
                        aria-label="Hapus dari staging"
                      >
                        <TrashIcon />
                      </DangerGhostButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Panel>

      {textOpen && (
        <CopyTextDialog
          items={stagedSorted}
          title={labels.title}
          showPrice={showPrice}
          onShowPriceChange={setShowPrice}
          onClose={() => setTextOpen(false)}
        />
      )}
    </div>
  );
}
