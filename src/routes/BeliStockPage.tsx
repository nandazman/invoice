import { Fragment, useCallback, useMemo, useState } from "react";
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
import { ByCell, ByCells, ByHeaders } from "../components/Attribution";
import { useOrderFilter } from "../lib/useOrderFilter";
import { AddPurchaseForm } from "../components/AddPurchaseForm";
import { Button, GhostButton, PrimaryButton } from "../components/Button";
import { Panel } from "../components/Panel";
import { OrderFilterBar } from "../components/OrderFilterBar";
import { ColumnToggle } from "../components/ColumnToggle";
import { LinkProductDialog } from "../components/LinkProductDialog";
import { PurchaseDialog } from "../components/PurchaseDialog";
import { thClass, tdClass } from "../components/DataTable";
import {
  AlertIcon,
  ChevronDownIcon,
  PencilIcon,
  PlusIcon,
} from "../components/icons";

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
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PurchaseItem | null>(null);
  // Phone rows whose detail card is open.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
      <div className="hidden md:flex items-start gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold mb-1">Beli Stock</h1>
          <p className="text-faint">
            Catat pembelian stok; setiap baris menambah stok otomatis.
          </p>
        </div>
        {products.length > 0 && (
          <PrimaryButton onClick={() => setAdding(true)}>
            <PlusIcon /> Tambah
          </PrimaryButton>
        )}
      </div>

      {products.length === 0 && (
        <Panel className="text-center text-faint py-8">
          Belum ada produk. Tambahkan produk di halaman <b>Harga</b> dulu.
        </Panel>
      )}

      {/* No children: purchases carry no status, and the hook's status
          predicate skips rows without one. */}
      <OrderFilterBar
        filter={filter}
        showStatus={false}
        onAdd={products.length > 0 ? () => setAdding(true) : undefined}
      />

      <Panel>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <span className="text-lg font-bold">
            Total: {formatRupiah(grandTotal)}
          </span>
          <span className="text-faint">· {filtered.length} item</span>
          <span className="flex-1" />
          {/* Phone: one switch for every row's detail card. Desktop keeps
              the Kolom menu instead. */}
          <Button
            size="sm"
            className="md:!hidden"
            onClick={() =>
              setExpanded(
                expanded.size > 0 ? new Set() : new Set(filtered.map((o) => o.id)),
              )
            }
          >
            <ChevronDownIcon
              className={expanded.size > 0 ? "rotate-180" : undefined}
            />
            {expanded.size > 0 ? "Tutup semua" : "Buka semua"}
          </Button>
          <div className="hidden md:block">
            <ColumnToggle columns={COLUMNS} visible={visible} onToggle={toggle} />
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="text-center text-faint py-8">
            {hasFilter
              ? "Tidak ada item cocok dengan filter."
              : "Belum ada pembelian."}
          </div>
        ) : (
          <>
            {/* The phone layout. Below `md` a row is product and total;
                tapping it opens a label / value card with the rest and Edit.
                No Kolom menu here: the collapsed row is fixed. */}
            <div className="md:hidden">
              {groups.map((g) => (
                <Fragment key={g.tanggal}>
                  <div className="sticky top-14 z-10 flex items-center gap-2 px-3 py-1.5 bg-surface-hover border-b border-line text-sm font-bold">
                    <span className="flex-1">{formatTanggalID(g.tanggal)}</span>
                    <span className="tabular-nums">{formatRupiah(g.total)}</span>
                  </div>
                  {g.items.map((it) => (
                    <PhoneRow
                      key={it.id}
                      item={it}
                      open={expanded.has(it.id)}
                      onToggleOpen={() => toggleExpanded(it.id)}
                      onEdit={() => setEditing(it)}
                      onLink={() => setLinking(it)}
                    />
                  ))}
                </Fragment>
              ))}
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
                    onEdit={setEditing}
                    onLink={setLinking}
                  />
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Panel>

      {adding && (
        <AddPurchaseForm
          products={products}
          onAdd={addItems}
          onClose={() => setAdding(false)}
        />
      )}

      {editing && !linking && (
        <PurchaseDialog
          item={editing}
          onLink={() => setLinking(editing)}
          onDelete={() => removeItem(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}

      {linking && (
        <LinkProductDialog
          namaProduk={linking.namaProduk}
          products={products}
          onPick={(productId) => {
            linkPurchaseProduct(linking.id, productId);
            setLinking(null);
            setEditing(null);
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
  onEdit,
  onLink,
}: {
  group: DateGroup;
  visible: Record<string, boolean>;
  onEdit: (item: PurchaseItem) => void;
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
                  <AlertIcon className="inline h-3.5 w-3.5 -mt-0.5" /> {it.namaProduk}
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
          <td className={`${tdClass} text-right whitespace-nowrap`}>
            <GhostButton
              size="sm"
              onClick={() => onEdit(it)}
              title={`Ubah "${it.namaProduk}"`}
              aria-label={`Ubah "${it.namaProduk}"`}
            >
              <PencilIcon />
            </GhostButton>
          </td>
        </tr>
      ))}
    </>
  );
}

// One phone row: product and total collapsed; label / value card when open.
function PhoneRow({
  item: it,
  open,
  onToggleOpen,
  onEdit,
  onLink,
}: {
  item: PurchaseItem;
  open: boolean;
  onToggleOpen: () => void;
  onEdit: () => void;
  onLink: () => void;
}) {
  const kv: [string, React.ReactNode][] = [
    ["Satuan", it.satuan],
    ["Qty", formatAngka(it.kuantitas)],
    ["Harga satuan", formatRupiah(it.hargaSatuan)],
    ["Dibuat", formatDateTimeID(it.createdAt)],
    ["Diperbarui", formatDateTimeID(it.updatedAt)],
    ["Dibuat oleh", <ByCell key="c" email={it.createdBy} />],
    ["Diperbarui oleh", <ByCell key="u" email={it.updatedBy} />],
  ];
  return (
    <div className="border-b border-line">
      <div
        className="flex items-center gap-2 px-3 min-h-11 cursor-pointer"
        onClick={onToggleOpen}
      >
        <button
          type="button"
          aria-expanded={open}
          className="flex-1 min-w-0 text-left font-medium break-words py-1"
        >
          {!it.productId && (
            <AlertIcon className="inline h-3.5 w-3.5 -mt-0.5 mr-1 text-warn" />
          )}
          {it.namaProduk}
        </button>
        <span className="tabular-nums font-medium whitespace-nowrap">
          {formatRupiah(it.totalHarga)}
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-faint ${open ? "rotate-180" : ""}`}
        />
      </div>

      {open && (
        <div className="bg-surface-sunken border-t border-line px-3 py-3 text-sm">
          <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1.5">
            <dt className="text-faint">Produk</dt>
            <dd className="text-right">
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
                  className="text-warn bg-warn-soft border border-warn-line rounded px-1.5 py-0.5 font-medium"
                  onClick={onLink}
                >
                  Tautkan produk
                </button>
              )}
            </dd>
            {kv.map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-faint">{label}</dt>
                <dd className="text-right tabular-nums font-medium break-words">
                  {value}
                </dd>
              </Fragment>
            ))}
          </dl>
          <div className="flex justify-end mt-3">
            <Button size="sm" onClick={onEdit}>
              <PencilIcon /> Edit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
