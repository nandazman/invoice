import { useMemo, useState } from "react";
import { useOrders, useProducts, usePurchases } from "../lib/store";
import { formatRupiah, formatAngka, formatTanggalID } from "../lib/format";
import { downloadOrdersXLSX } from "../lib/excel";
import { copyOrdersImage, downloadOrdersImage } from "../lib/orderImage";
import {
  useOrderFilter,
  type FilterableRow,
  type StatusFilter,
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
import { FilterBar } from "../components/FilterBar";
import { CopyTextDialog } from "../components/CopyTextDialog";
import { MobileList, MobileRow } from "../components/MobileList";
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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Ekspor Excel</h1>
      <p className="text-faint mb-4">
        Pilih item ke area staging, lalu ekspor ke berkas{" "}
        <b>{labels.filename}.xlsx</b>.
      </p>

      <FilterBar filter={filter}>
        <Field label="Sumber" className="w-36">
          <Select
            value={source}
            onChange={(e) => changeSource(e.target.value as Source)}
          >
            <option value="order">Order</option>
            <option value="beli">Beli Stock</option>
          </Select>
        </Field>
        {source === "order" ? (
          <Field label="Status" className="w-36">
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
        ) : null}
      </FilterBar>

      <Panel>
        <div className="flex gap-3 flex-wrap items-center">
          <span className="flex-1" />
          <Button onClick={appendFiltered}>Tambah (sesuai filter)</Button>
          <Button onClick={replaceFiltered}>Ganti semua</Button>
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
        </div>
        <div className="flex gap-3 flex-wrap items-center justify-end mb-3">
          <label className="flex items-center gap-1.5 text-sm text-muted select-none cursor-pointer mr-auto">
            <input
              type="checkbox"
              checked={showPrice}
              onChange={(e) => setShowPrice(e.target.checked)}
            />
            Tampilkan harga
          </label>
          <DangerButton onClick={removeSelected} disabled={selected.size === 0}>
            Hapus terpilih
          </DangerButton>
          <Button onClick={() => setTextOpen(true)} disabled={staged.length === 0}>
            Salin teks
          </Button>
          <Button onClick={copyImage} disabled={staged.length === 0}>
            {copyState === "copied"
              ? "✓ Tersalin"
              : copyState === "error"
                ? "Gagal menyalin"
                : "Salin gambar"}
          </Button>
          <Button
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
          <PrimaryButton
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
            {/* The phone layout. Seven-plus columns do not fit on 390px, so
                below `md` the row collapses to what it IS on the left and what
                it is WORTH on the right. Tanggal and the row's delete action
                restack under the product; the per-row checkbox rides along
                with the title since the header has no room for a select-all
                on the phone. When Harga is hidden, Kuantitas takes over the
                right side and its own arithmetic note is dropped since it
                would just repeat the value already shown there. */}
            <div className="md:hidden">
              <MobileList
                // Select-all is the difference between exporting a filtered
                // set and ticking forty rows by hand, so it rides in the phone
                // header rather than staying a desktop-only affordance.
                left={
                  <span className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="Pilih semua baris"
                    />
                    Nama Produk
                  </span>
                }
                right={showPrice ? "Total" : "Kuantitas"}
              >
                {stagedSorted.map((it) => (
                  <MobileRow
                    key={it.id}
                    title={
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={selected.has(it.id)}
                          onChange={() => toggleRow(it.id)}
                        />
                        <span className="truncate">{it.namaProduk}</span>
                      </span>
                    }
                    meta={
                      <>
                        <span>{formatTanggalID(it.tanggal)}</span>
                        {/* The trailing action column has nowhere else to go
                            on a phone, so it rides along here. */}
                        <DangerGhostButton
                          size="sm"
                          onClick={() => removeRow(it.id)}
                          title="Hapus dari staging"
                          aria-label="Hapus dari staging"
                        >
                          <TrashIcon />
                        </DangerGhostButton>
                      </>
                    }
                    value={
                      showPrice
                        ? formatRupiah(it.totalHarga)
                        : formatAngka(it.kuantitas)
                    }
                    note={
                      showPrice
                        ? `${formatAngka(it.kuantitas)} × ${formatRupiah(
                            it.hargaSatuan,
                          )}`
                        : undefined
                    }
                  />
                ))}
              </MobileList>
            </div>

          <div className="overflow-x-auto hidden md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${thClass} w-8`}>
                    <input
                      type="checkbox"
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
