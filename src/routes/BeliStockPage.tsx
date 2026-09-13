import { Fragment, useMemo, useState } from "react";
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
import {
  ATTRIBUTION_COLUMNS,
  ATTRIBUTION_COLUMN_IDS,
  usePersistentVisibility,
} from "../lib/columns";
import { ByCells, ByHeaders, MobileBy } from "../components/Attribution";
import { useOrderFilter } from "../lib/useOrderFilter";
import { AddPurchaseForm } from "../components/AddPurchaseForm";
import { DangerGhostButton } from "../components/Button";
import { Panel } from "../components/Panel";
import { FilterBar } from "../components/FilterBar";
import { ColumnToggle } from "../components/ColumnToggle";
import { LinkProductDialog } from "../components/LinkProductDialog";
import {
  MobileField,
  MobileList,
  MobileRow,
  qtyTimesHarga,
} from "../components/MobileList";
import { thClass, tdClass } from "../components/DataTable";
import { TrashIcon } from "../components/icons";

interface DateGroup {
  tanggal: string;
  items: PurchaseItem[];
  total: number;
}


// Columns shown left of the "Total" column, in display order.
const COLS_BEFORE_TOTAL = [
  "namaProduk",
  "satuan",
  "kuantitas",
  "hargaSatuan",
] as const;
// Columns shown right of the "Total" column, in display order.
const COLS_AFTER_TOTAL = [
  "createdAt",
  "updatedAt",
  ...ATTRIBUTION_COLUMN_IDS,
] as const;

const COLUMNS = [
  { id: "namaProduk", label: "Produk" },
  { id: "satuan", label: "Satuan" },
  { id: "kuantitas", label: "Qty" },
  { id: "hargaSatuan", label: "Harga Satuan" },
  { id: "totalHarga", label: "Total" },
  { id: "createdAt", label: "Dibuat" },
  { id: "updatedAt", label: "Diperbarui" },
  ...ATTRIBUTION_COLUMNS,
];

// createdAt/updatedAt and the two attribution columns are hidden by default;
// users can re-enable them. No storage-key bump needed — usePersistentVisibility
// falls back to `defaults` for any id the saved state predates.
const HIDDEN_BY_DEFAULT = ["createdAt", "updatedAt", ...ATTRIBUTION_COLUMN_IDS];
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
      <p className="text-faint mb-4">
        Catat pembelian stok; setiap baris menambah stok otomatis.
      </p>

      {products.length === 0 ? (
        <Panel className="text-center text-faint py-8">
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
          <span className="text-faint">· {filtered.length} item</span>
          <span className="flex-1" />
          <ColumnToggle columns={COLUMNS} visible={visible} onToggle={toggle} />
        </div>

        {groups.length === 0 ? (
          <div className="text-center text-faint py-8">
            {hasFilter
              ? "Tidak ada item cocok dengan filter."
              : "Belum ada pembelian."}
          </div>
        ) : (
          <>
            {/* The phone layout. Nine columns do not fit on 390px, so below
                `md` the row collapses to what it IS on the left and what it is
                WORTH on the right: satuan, the Dibuat stamp and the delete
                action restack under the product; the arithmetic behind the
                money restacks under the total. The Kolom toggle applies here
                too: every column switched on restacks into the row, every
                column switched off leaves it. The product name stays as the
                row's anchor (it carries the link) whatever the toggle says. */}
            <div className="md:hidden">
              <MobileList
                left="Produk"
                right={visible.totalHarga !== false ? "Total" : ""}
              >
                {groups.map((g) => (
                  <Fragment key={g.tanggal}>
                    <tr className="bg-surface-hover font-bold">
                      <td className={`${tdClass} font-bold`}>
                        {formatTanggalID(g.tanggal)}
                      </td>
                      <td
                        className={`${tdClass} text-right font-bold tabular-nums`}
                      >
                        {formatRupiah(g.total)}
                      </td>
                    </tr>
                    {g.items.map((it) => (
                      <MobileRow
                        key={it.id}
                        title={
                          it.productId ? (
                            <Link
                              to="/produk/$id"
                              params={{ id: it.productId }}
                              className="text-brand hover:underline font-medium"
                            >
                              {it.namaProduk}
                            </Link>
                          ) : (
                            <button
                              type="button"
                              className="text-warn bg-warn-soft border border-warn-line rounded px-1.5 py-0.5 font-medium hover:bg-warn-soft-strong"
                              title="Belum tertaut ke produk — klik untuk menautkan"
                              onClick={() => setLinking(it)}
                            >
                              ⚠ {it.namaProduk}
                            </button>
                          )
                        }
                        meta={
                          <>
                            {visible.satuan !== false && (
                              <span>{it.satuan}</span>
                            )}
                            {visible.createdAt !== false && (
                              <MobileField label="Dibuat">
                                {formatDateTimeID(it.createdAt)}
                              </MobileField>
                            )}
                            {visible.updatedAt !== false && (
                              <MobileField label="Diperbarui">
                                {formatDateTimeID(it.updatedAt)}
                              </MobileField>
                            )}
                            <MobileBy
                              show={{
                                created: visible.createdBy !== false,
                                updated: visible.updatedBy !== false,
                              }}
                              row={it}
                            />
                            {/* The trailing action column has nowhere else to
                                go on a phone, so it rides along here. */}
                            <DangerGhostButton
                              size="sm"
                              onClick={() => removeItem(it.id)}
                              title={`Hapus "${it.namaProduk}"`}
                              aria-label={`Hapus "${it.namaProduk}"`}
                            >
                              <TrashIcon />
                            </DangerGhostButton>
                          </>
                        }
                        value={
                          visible.totalHarga !== false
                            ? formatRupiah(it.totalHarga)
                            : null
                        }
                        note={qtyTimesHarga(
                          visible,
                          it.kuantitas,
                          it.hargaSatuan,
                        )}
                      />
                    ))}
                  </Fragment>
                ))}
              </MobileList>
            </div>

            <div className="overflow-x-auto hidden md:block">
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
                  <ByHeaders
                    show={{
                      created: visible.createdBy !== false,
                      updated: visible.updatedBy !== false,
                    }}
                    className={thClass}
                  />
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
          </>
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
      <tr className="bg-surface-hover font-bold">
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
        <tr key={it.id} className="hover:bg-surface-sunken">
          {visible.namaProduk !== false && (
            <td className={tdClass}>
              {it.productId ? (
                <Link
                  to="/produk/$id"
                  params={{ id: it.productId }}
                  className="text-brand hover:underline font-medium"
                >
                  {it.namaProduk}
                </Link>
              ) : (
                <button
                  type="button"
                  className="text-warn bg-warn-soft border border-warn-line rounded px-1.5 py-0.5 font-medium hover:bg-warn-soft-strong"
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
            <td className={`${tdClass} text-xs text-faint whitespace-nowrap`}>
              {formatDateTimeID(it.createdAt)}
            </td>
          )}
          {visible.updatedAt !== false && (
            <td className={`${tdClass} text-xs text-faint whitespace-nowrap`}>
              {formatDateTimeID(it.updatedAt)}
            </td>
          )}
          <ByCells
            show={{
              created: visible.createdBy !== false,
              updated: visible.updatedBy !== false,
            }}
            row={it}
            className={tdClass}
          />
          <td className={`${tdClass} text-right`}>
            <DangerGhostButton
              size="sm"
              onClick={() => onRemove(it.id)}
              title={`Hapus "${it.namaProduk}"`}
              aria-label={`Hapus "${it.namaProduk}"`}
            >
              <TrashIcon />
            </DangerGhostButton>
          </td>
        </tr>
      ))}
    </>
  );
}
