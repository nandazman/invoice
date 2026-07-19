import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { PurchaseItem } from "../lib/types";
import {
  useProducts,
  usePurchases,
  addPurchase,
  deletePurchase,
  linkPurchaseProduct,
} from "../lib/store";
import {
  formatRupiah,
  formatAngka,
  formatTanggalID,
  formatDateTimeID,
  sumRupiah,
} from "../lib/format";
import { usePersistentVisibility } from "../lib/columns";
import { useOrderFilter } from "../lib/useOrderFilter";
import { AddPurchaseForm } from "../components/AddPurchaseForm";
import { DangerButton } from "../components/Button";
import { Panel } from "../components/Panel";
import { FilterBar } from "../components/FilterBar";
import { ColumnToggle } from "../components/ColumnToggle";
import { LinkProductDialog } from "../components/LinkProductDialog";

interface DateGroup {
  tanggal: string;
  items: PurchaseItem[];
  total: number;
}

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

// Columns shown left of the "Total" column, in display order.
const COLS_BEFORE_TOTAL = [
  "namaProduk",
  "satuan",
  "kuantitas",
  "hargaSatuan",
] as const;
// Columns shown right of the "Total" column, in display order.
const COLS_AFTER_TOTAL = ["createdAt", "updatedAt"] as const;

const COLUMNS = [
  { id: "namaProduk", label: "Produk" },
  { id: "satuan", label: "Satuan" },
  { id: "kuantitas", label: "Qty" },
  { id: "hargaSatuan", label: "Harga Satuan" },
  { id: "totalHarga", label: "Total" },
  { id: "createdAt", label: "Dibuat" },
  { id: "updatedAt", label: "Diperbarui" },
];

// createdAt/updatedAt are hidden by default; users can re-enable them.
const HIDDEN_BY_DEFAULT = ["createdAt", "updatedAt"];
const COLUMN_DEFAULTS = Object.fromEntries(
  COLUMNS.map((c) => [c.id, !HIDDEN_BY_DEFAULT.includes(c.id)]),
);

export function BeliStockPage() {
  const products = useProducts();
  const purchases = usePurchases();

  const [visible, toggle] = usePersistentVisibility(
    "invoice.beli.cols.v1",
    COLUMN_DEFAULTS,
  );

  const filter = useOrderFilter(purchases, products);
  const { filtered, hasFilter } = filter;
  // The unlinked purchase row whose "Tautkan Produk" dialog is open.
  const [linking, setLinking] = useState<PurchaseItem | null>(null);

  function addItems(items: PurchaseItem[]) {
    for (const item of items) addPurchase(item);
  }
  function removeItem(id: string) {
    deletePurchase(id);
  }

  const groups = useMemo<DateGroup[]>(() => {
    const byDate = new Map<string, PurchaseItem[]>();
    for (const o of filtered) {
      const arr = byDate.get(o.tanggal) ?? [];
      arr.push(o);
      byDate.set(o.tanggal, arr);
    }
    return [...byDate.keys()]
      .sort((a, b) => b.localeCompare(a)) // newest first
      .map((tanggal) => {
        const items = byDate.get(tanggal)!;
        return {
          tanggal,
          items,
          total: sumRupiah(items.map((i) => i.totalHarga)),
        };
      });
  }, [filtered]);

  const grandTotal = sumRupiah(filtered.map((i) => i.totalHarga));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Beli Stock</h1>
      <p className="text-slate-500 mb-4">
        Catat pembelian stok; setiap baris menambah stok otomatis.
      </p>

      {products.length === 0 ? (
        <Panel className="text-center text-slate-400 py-8">
          Belum ada produk. Tambahkan produk di halaman <b>Harga</b> dulu.
        </Panel>
      ) : (
        <AddPurchaseForm products={products} onAdd={addItems} />
      )}

      {/* No children: purchases carry no status, and the hook's status
          predicate skips rows without one. */}
      <FilterBar filter={filter} />

      <Panel>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <span className="text-lg font-bold">
            Total: {formatRupiah(grandTotal)}
          </span>
          <span className="text-slate-400">· {filtered.length} item</span>
          <span className="flex-1" />
          <ColumnToggle columns={COLUMNS} visible={visible} onToggle={toggle} />
        </div>

        {groups.length === 0 ? (
          <div className="text-center text-slate-400 py-8">
            {hasFilter
              ? "Tidak ada item cocok dengan filter."
              : "Belum ada pembelian."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {visible.namaProduk !== false && (
                    <th className={thClass}>Produk</th>
                  )}
                  {visible.satuan !== false && (
                    <th className={thClass}>Satuan</th>
                  )}
                  {visible.kuantitas !== false && (
                    <th className={`${thClass} text-right`}>Qty</th>
                  )}
                  {visible.hargaSatuan !== false && (
                    <th className={`${thClass} text-right`}>Harga Satuan</th>
                  )}
                  {visible.totalHarga !== false && (
                    <th className={`${thClass} text-right`}>Total</th>
                  )}
                  {visible.createdAt !== false && (
                    <th className={thClass}>Dibuat</th>
                  )}
                  {visible.updatedAt !== false && (
                    <th className={thClass}>Diperbarui</th>
                  )}
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows
                    key={g.tanggal}
                    group={g}
                    visible={visible}
                    onRemove={removeItem}
                    onLink={setLinking}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {linking && (
        <LinkProductDialog
          namaProduk={linking.namaProduk}
          products={products}
          onPick={(productId) => {
            linkPurchaseProduct(linking.id, productId);
            setLinking(null);
          }}
          onClose={() => setLinking(null)}
        />
      )}
    </div>
  );
}

function GroupRows({
  group,
  visible,
  onRemove,
  onLink,
}: {
  group: DateGroup;
  visible: Record<string, boolean>;
  onRemove: (id: string) => void;
  onLink: (item: PurchaseItem) => void;
}) {
  // Date label spans every visible column left of "Total".
  const beforeCount = COLS_BEFORE_TOTAL.filter(
    (id) => visible[id] !== false,
  ).length;
  // Trailing empty cell spans every visible column right of "Total" plus the
  // always-visible actions column, keeping the subtotal aligned under "Total".
  const afterCount =
    COLS_AFTER_TOTAL.filter((id) => visible[id] !== false).length + 1;

  return (
    <>
      <tr className="bg-slate-100 font-bold">
        <td className={`${tdClass} font-bold`} colSpan={Math.max(1, beforeCount)}>
          {formatTanggalID(group.tanggal)}
        </td>
        {visible.totalHarga !== false && (
          <td className={`${tdClass} text-right font-bold tabular-nums`}>
            {formatRupiah(group.total)}
          </td>
        )}
        <td className={tdClass} colSpan={afterCount}></td>
      </tr>
      {group.items.map((it) => (
        <tr key={it.id} className="hover:bg-slate-50">
          {visible.namaProduk !== false && (
            <td className={tdClass}>
              {it.productId ? (
                <Link
                  to="/produk/$id"
                  params={{ id: it.productId }}
                  className="text-blue-600 hover:underline font-medium"
                >
                  {it.namaProduk}
                </Link>
              ) : (
                <button
                  type="button"
                  className="text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 font-medium hover:bg-amber-100"
                  title="Belum tertaut ke produk — klik untuk menautkan"
                  onClick={() => onLink(it)}
                >
                  ⚠ {it.namaProduk}
                </button>
              )}
            </td>
          )}
          {visible.satuan !== false && (
            <td className={tdClass}>{it.satuan}</td>
          )}
          {visible.kuantitas !== false && (
            <td className={`${tdClass} text-right tabular-nums`}>
              {formatAngka(it.kuantitas)}
            </td>
          )}
          {visible.hargaSatuan !== false && (
            <td className={`${tdClass} text-right tabular-nums`}>
              {formatRupiah(it.hargaSatuan)}
            </td>
          )}
          {visible.totalHarga !== false && (
            <td className={`${tdClass} text-right tabular-nums`}>
              {formatRupiah(it.totalHarga)}
            </td>
          )}
          {visible.createdAt !== false && (
            <td className={`${tdClass} text-xs text-slate-400 whitespace-nowrap`}>
              {formatDateTimeID(it.createdAt)}
            </td>
          )}
          {visible.updatedAt !== false && (
            <td className={`${tdClass} text-xs text-slate-400 whitespace-nowrap`}>
              {formatDateTimeID(it.updatedAt)}
            </td>
          )}
          <td className={`${tdClass} text-right`}>
            <DangerButton
              size="sm"
              onClick={() => onRemove(it.id)}
              title="Hapus item"
            >
              ✕
            </DangerButton>
          </td>
        </tr>
      ))}
    </>
  );
}
