import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "@tanstack/react-router";
import type {
  Buyer,
  OrderItem,
  OrderStatus,
  Product,
  PurchaseItem,
} from "../lib/types";
import { modalCostFor, purchaseFromOrderItem } from "../lib/purchaseFromOrder";
import {
  useProducts,
  useOrders,
  useBuyers,
  addOrder,
  deleteOrders,
  updateOrder,
  setOrderStatus,
  setOrdersStatus,
  addPurchase,
  linkOrderProduct,
  setOrdersBuyer,
  upsertBuyer,
  useBuyerBackfillPending,
  dismissBuyerBackfill,
  needsBuyer,
} from "../lib/store";
import {
  formatRupiah,
  formatAngka,
  formatTanggalID,
  formatDateTimeID,
  sumRupiah,
  uid,
  nowISO,
} from "../lib/format";
import {
  ATTRIBUTION_COLUMNS,
  ATTRIBUTION_COLUMN_IDS,
  usePersistentVisibility,
} from "../lib/columns";
import { ByCell, ByCells, ByHeaders } from "../components/Attribution";
import { useOrderFilter } from "../lib/useOrderFilter";
import {
  AddOrderDialog,
  EditOrderDialog,
  type NewOrder,
} from "../components/OrderDialog";
import { DeleteOrdersDialog } from "../components/DeleteOrdersDialog";
import { BuyFromOrderDialog } from "../components/BuyFromOrderDialog";
import { LinkProductDialog } from "../components/LinkProductDialog";
import { BuyerBackfillDialog } from "../components/BuyerBackfillDialog";
import { BuyerSelect } from "../components/BuyerSelect";
import { Button, GhostButton, PrimaryButton } from "../components/Button";
import { OrderFilterBar } from "../components/OrderFilterBar";
import { Select } from "../components/Select";
import { Panel } from "../components/Panel";
import { ColumnToggle } from "../components/ColumnToggle";
import { thClass, tdClass } from "../components/DataTable";
import {
  PlusIcon,
  ChevronDownIcon,
  PencilIcon,
  EyeIcon,
  EyeOffIcon,
  AlertIcon,
} from "../components/icons";

interface DateGroup {
  tanggal: string;
  items: OrderItem[];
  total: number;
}

// One buyer's slice of the table, holding its own date groups. In flat mode
// there is exactly one section with `label: null` and no header row, so both
// modes render through the same code path rather than forking the table body.
interface BuyerSection {
  key: string;
  label: string | null;
  // null in flat mode: a date's "Beli stok" then covers that date outright,
  // which is what it has always done.
  buyerId: string | null;
  dates: DateGroup[];
  items: OrderItem[];
  total: number;
}

// Columns shown left of the "Total" column, in display order.
const COLS_BEFORE_TOTAL = [
  "namaProduk",
  "satuan",
  "kuantitas",
  "hargaSatuan",
  "modalSatuan",
] as const;
// Columns shown right of the "Total" column, in display order. Every new column
// has to be listed here (or above) or the date-group subtotal stops lining up
// under "Total" — the group row's colSpans are counted from these two lists.
const COLS_AFTER_TOTAL = [
  "status",
  "buyer",
  "createdAt",
  "updatedAt",
  ...ATTRIBUTION_COLUMN_IDS,
] as const;

const COLUMNS = [
  { id: "namaProduk", label: "Produk" },
  { id: "satuan", label: "Satuan" },
  { id: "kuantitas", label: "Qty" },
  { id: "hargaSatuan", label: "Harga Satuan" },
  { id: "modalSatuan", label: "Harga Dasar" },
  { id: "totalHarga", label: "Total" },
  { id: "status", label: "Status" },
  { id: "buyer", label: "Pembeli" },
  { id: "createdAt", label: "Dibuat" },
  { id: "updatedAt", label: "Diperbarui" },
  ...ATTRIBUTION_COLUMNS,
];

// createdAt/updatedAt are hidden by default; users can re-enable them. Pembeli
// is NOT: it is mandatory on new orders, so hiding it would hide a field the
// form insists on. No storage-key bump needed: usePersistentVisibility merges
// the saved object over `defaults` key by key (`columns.ts`), so an id the saved
// state has never heard of resolves to its default rather than to `undefined`.
const HIDDEN_BY_DEFAULT = ["createdAt", "updatedAt", ...ATTRIBUTION_COLUMN_IDS];
const COLUMN_DEFAULTS = Object.fromEntries(
  COLUMNS.map((c) => [c.id, !HIDDEN_BY_DEFAULT.includes(c.id)]),
);

// Order ids the user has hidden from the totals. This is a view preference, not
// domain data, so it lives in localStorage (like column visibility) — no DB row,
// no audit entry. Hidden items still render (dimmed); they just don't count.
function usePersistentHidden(
  storageKey: string,
): [Set<string>, (id: string) => void] {
  const [ids, setIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  const toggle = useCallback(
    (id: string) => {
      setIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        localStorage.setItem(storageKey, JSON.stringify([...next]));
        return next;
      });
    },
    [storageKey],
  );

  return [ids, toggle];
}

// A view preference stored as a plain boolean, same reasoning as the two hooks
// above: it changes nothing in the database, so it does not belong in one.
function usePersistentFlag(
  storageKey: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? fallback : raw === "1";
    } catch {
      return fallback;
    }
  });

  const set = useCallback(
    (next: boolean) => {
      setOn(next);
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // Private-mode storage failure: the toggle still works this session.
      }
    },
    [storageKey],
  );

  return [on, set];
}

// Newest date first, subtotals counting only rows the user has not hidden.
function buildDateGroups(items: OrderItem[], hidden: Set<string>): DateGroup[] {
  const byDate = new Map<string, OrderItem[]>();
  for (const o of items) {
    const arr = byDate.get(o.tanggal) ?? [];
    arr.push(o);
    byDate.set(o.tanggal, arr);
  }
  return [...byDate.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((tanggal) => {
      const rows = byDate.get(tanggal)!;
      return {
        tanggal,
        items: rows,
        total: sumRupiah(
          rows.filter((i) => !hidden.has(i.id)).map((i) => i.totalHarga),
        ),
      };
    });
}

// A buyer created from a picker, where a name is all we have. The remaining
// fields are "" rather than optional so the row matches one made in BuyerDialog
// — see the Buyer comment in types.ts.
function newBuyer(nama: string): Buyer {
  const now = nowISO();
  return {
    id: uid(),
    nama: nama.trim(),
    telepon: "",
    email: "",
    alamat: "",
    catatan: "",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

// The Harga Dasar shown for one order line, per its chosen unit. The snapshot
// taken when the order was added wins; a row that predates the snapshot (or
// whose product had no Harga Dasar then) falls back to today's price list and is
// flagged as an estimate, so an old line never passes today's cost off as what
// it cost at the time. null when neither exists.
function orderModal(
  it: OrderItem,
  productById: Map<string, Product>,
  productByName: Map<string, Product>,
): { value: number; estimate: boolean } | null {
  if (it.modalSatuan != null && it.modalSatuan > 0)
    return { value: it.modalSatuan, estimate: false };
  const product =
    productById.get(it.productId ?? "") ?? productByName.get(it.namaProduk);
  if (product && product.hargaDasar > 0)
    return { value: modalCostFor(product, it.satuan), estimate: true };
  return null;
}

function ModalValue({
  modal,
}: {
  modal: { value: number; estimate: boolean } | null;
}) {
  if (!modal) return <span className="text-faint">—</span>;
  if (!modal.estimate) return <>{formatRupiah(modal.value)}</>;
  return (
    <span
      className="text-faint"
      title="Perkiraan dari Harga Dasar saat ini — pesanan ini dibuat sebelum harga dasar dicatat per pesanan"
    >
      ≈ {formatRupiah(modal.value)}
    </span>
  );
}

// Colored badge feel for the inline status dropdown.
function statusSelectClass(status: OrderStatus): string {
  return status === "paid"
    ? "text-ok bg-ok-soft border-ok-line font-semibold"
    : "text-warn bg-warn-soft border-warn-line font-semibold";
}

export function OrdersPage() {
  const products = useProducts();
  const orders = useOrders();
  const buyers = useBuyers();

  const backfillPending = useBuyerBackfillPending();
  // Escape / click-outside on the prompt must write nothing, so "closed" is
  // session state here, not a stored answer: the prompt returns next visit.
  const [backfillClosed, setBackfillClosed] = useState(false);
  // Gate on the rows the backfill would actually touch, not on `orders.length`:
  // an install with no orders and one where every order already has a buyer are
  // the same question — "nothing to ask about" — and both must answer silently
  // rather than offer to stamp zero rows.
  const withoutBuyer = useMemo(
    () => orders.filter(needsBuyer).length,
    [orders],
  );
  useEffect(() => {
    if (backfillPending && withoutBuyer === 0) dismissBuyerBackfill();
  }, [backfillPending, withoutBuyer]);

  const [visible, toggle] = usePersistentVisibility(
    "invoice.pesanan.cols.v2",
    COLUMN_DEFAULTS,
  );
  const [hidden, toggleHidden] = usePersistentHidden(
    "invoice.pesanan.hidden.v1",
  );

  // Group the table by pembeli instead of running one flat date list. Off by
  // default: the flat list is the shape the page has always had, and a user who
  // never touches this should not find their table reorganised.
  const [perBuyer, setPerBuyer] = usePersistentFlag(
    "invoice.pesanan.perBuyer.v1",
    false,
  );

  const filter = useOrderFilter(orders, products);
  const { filtered, hasFilter } = filter;
  // "Beli stok" now works on the ticked rows (the bulk bar), so it is just open
  // or closed: the dialog reads `chosen` for its items.
  const [buying, setBuying] = useState(false);
  const [adding, setAdding] = useState(false);
  // The buyer survives the Add dialog closing: consecutive orders for one buyer
  // are the common case, and clearing it forces a re-pick on every save.
  const [addBuyerId, setAddBuyerId] = useState("");
  const [editing, setEditing] = useState<OrderItem | null>(null);
  const [deleting, setDeleting] = useState<Set<string> | null>(null);
  // Phone rows opened into their detail card.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  // The unlinked order row whose "Tautkan Produk" dialog is open.
  const [linking, setLinking] = useState<OrderItem | null>(null);
  // Rows ticked for a bulk edit. Kept as raw ids, never pruned on filter
  // change: narrowing the filter and widening it again should give you your
  // selection back. Every read goes through `chosen` below instead.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // Selection ∩ what is on screen. Bulk actions MUST run off this, not off
  // `selected` — otherwise filtering down to one day and hitting "Paid" would
  // silently also stamp rows from days the user cannot see.
  const chosen = useMemo(() => {
    const onScreen = new Set(filtered.map((o) => o.id));
    return new Set([...selected].filter((id) => onScreen.has(id)));
  }, [selected, filtered]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Select-all over a set of ids: if every one is already ticked, untick them.
  const toggleAll = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (ids.every((id) => next.has(id)))
        for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  function bulkStatus(status: OrderStatus) {
    setOrdersStatus(chosen, status);
    clearSelection();
  }
  function bulkBuyer(buyerId: string) {
    setOrdersBuyer(chosen, buyerId);
    clearSelection();
  }
  function bulkCreateBuyer(nama: string) {
    const row = newBuyer(nama);
    upsertBuyer(row);
    bulkBuyer(row.id);
  }

  const buyerById = useMemo(
    () => new Map(buyers.map((b) => [b.id, b] as const)),
    [buyers],
  );

  // For the Harga Dasar column's fallback on rows without a snapshot. Same
  // id-then-name resolution addOrder uses when it takes the snapshot.
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p] as const)),
    [products],
  );
  const productByName = useMemo(
    () => new Map(products.map((p) => [p.namaProduk, p] as const)),
    [products],
  );

  function addItems(items: NewOrder[]) {
    for (const { order, buyStock } of items) {
      addOrder(order);
      if (!buyStock) continue;
      // "Beli stok": the Beli Stok button's job, in the same step. Buy at Harga
      // Dasar, then the offsetting sale for this order.
      addPurchase(
        purchaseFromOrderItem(
          order,
          productById.get(order.productId),
        ),
        "pembelian dari pesanan langsung untuk stok (by order)",
        order,
      );
    }
  }
  // The dialog's heading names one date when every ticked row shares it.
  const buyingDate = useMemo(() => {
    const dates = new Set(
      orders.filter((o) => chosen.has(o.id)).map((o) => o.tanggal),
    );
    return dates.size === 1 ? [...dates][0] : "";
  }, [orders, chosen]);
  function commitPurchases(
    items: { purchase: PurchaseItem; order: OrderItem }[],
  ) {
    for (const item of items)
      addPurchase(
        item.purchase,
        "pembelian dari pesanan langsung untuk stok (by order)",
        item.order,
      );
    // Dialog stays open to show its success view; it closes itself via onClose.
  }
  const sections = useMemo<BuyerSection[]>(() => {
    const sectionOf = (
      key: string,
      label: string | null,
      buyerId: string | null,
      items: OrderItem[],
    ): BuyerSection => ({
      key,
      label,
      buyerId,
      items,
      dates: buildDateGroups(items, hidden),
      total: sumRupiah(
        items.filter((i) => !hidden.has(i.id)).map((i) => i.totalHarga),
      ),
    });

    if (!perBuyer) return [sectionOf("all", null, null, filtered)];

    const byBuyer = new Map<string, OrderItem[]>();
    for (const o of filtered) {
      const arr = byBuyer.get(o.buyerId) ?? [];
      arr.push(o);
      byBuyer.set(o.buyerId, arr);
    }
    return [...byBuyer.keys()]
      .sort((a, b) => {
        // Unassigned rows sink to the bottom: they are a to-do list, not a
        // pembeli, and sorting "" first would head the table with them.
        if (!a) return 1;
        if (!b) return -1;
        const na = buyerById.get(a)?.nama ?? "";
        const nb = buyerById.get(b)?.nama ?? "";
        return na.localeCompare(nb);
      })
      .map((id) =>
        sectionOf(
          id || "__none__",
          !id
            ? "— tanpa pembeli —"
            : (buyerById.get(id)?.nama ?? "(pembeli dihapus)"),
          id,
          byBuyer.get(id)!,
        ),
      );
  }, [filtered, hidden, perBuyer, buyerById]);

  // The two attribution columns are ordinary ColumnToggle entries here, so they
  // are independently toggleable and this just re-reads the same map.
  const byVisible = {
    created: visible.createdBy !== false,
    updated: visible.updatedBy !== false,
  };

  // Full-width span for the buyer header row: the checkbox column, every
  // visible data column, and the actions column.
  const totalCols = 2 + COLUMNS.filter((c) => visible[c.id] !== false).length;

  const counted = filtered.filter((i) => !hidden.has(i.id));
  const grandTotal = sumRupiah(counted.map((i) => i.totalHarga));
  const hiddenCount = filtered.length - counted.length;

  return (
    <div>
      <div className="hidden md:flex items-start gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold mb-1">Pesanan</h1>
          <p className="text-faint">
            Tambah item dari daftar harga, lihat riwayat per tanggal.
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

      <OrderFilterBar
        filter={filter}
        perBuyer={perBuyer}
        onPerBuyer={setPerBuyer}
        onAdd={products.length > 0 ? () => setAdding(true) : undefined}
      />

      <Panel>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <span className="text-lg font-bold">
            Total: {formatRupiah(grandTotal)}
          </span>
          <span className="text-faint">
            · {counted.length} item
            {hiddenCount > 0 && ` (${hiddenCount} disembunyikan)`}
          </span>
          <span className="flex-1" />
          {/* Phone: one switch for every row's detail card. Desktop keeps the
              Kolom menu instead, since its rows are columns, not cards. */}
          <Button
            size="sm"
            className="md:!hidden"
            onClick={() =>
              setExpanded(
                expanded.size > 0
                  ? new Set()
                  : new Set(filtered.map((o) => o.id)),
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

        {chosen.size > 0 && (
          <BulkBar
            count={chosen.size}
            buyers={buyers}
            onStatus={bulkStatus}
            onBuyer={bulkBuyer}
            onCreateBuyer={bulkCreateBuyer}
            onBuy={() => setBuying(true)}
            onClear={clearSelection}
          />
        )}

        {sections.every((s) => s.dates.length === 0) ? (
          <div className="text-center text-faint py-8">
            {hasFilter
              ? "Tidak ada item cocok dengan filter."
              : "Belum ada pesanan."}
          </div>
        ) : (
          <>
            {/* The phone layout. Nine-plus columns do not fit on 390px, so
                below `md` a row is name, status and price, and tapping it opens
                a label / value card with everything else. There is no Kolom
                menu here: the collapsed row is fixed, and the card is where the
                detail lives. */}
            <div className="md:hidden">
              {sections.map((s) => (
                <Fragment key={s.key}>
                  {s.label !== null && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-brand-soft border-t-2 border-brand-line font-bold text-brand-strong">
                      <SelectAllBox
                        ids={s.items.map((i) => i.id)}
                        selected={chosen}
                        onToggle={toggleAll}
                        title={`Pilih semua item ${s.label}`}
                      />
                      <span className="flex-1 min-w-0 break-words">
                        {s.label}
                        <span className="ml-1 font-normal text-brand-edge">
                          · {s.items.length} item
                        </span>
                      </span>
                      <span className="tabular-nums">{formatRupiah(s.total)}</span>
                    </div>
                  )}
                  {s.dates.map((g) => (
                    <Fragment key={g.tanggal}>
                      {/* The date pins under the fixed app bar (`top-14`) and
                          carries its own background. Scrolling a long day, the
                          first thing you lose is which day you are on. */}
                      <div className="sticky top-14 z-10 flex items-center gap-2 px-3 py-1.5 bg-surface-hover border-b border-line text-sm font-bold">
                        <SelectAllBox
                          ids={g.items.map((i) => i.id)}
                          selected={chosen}
                          onToggle={toggleAll}
                          title={`Pilih semua item ${formatTanggalID(g.tanggal)}`}
                        />
                        <span className="flex-1">{formatTanggalID(g.tanggal)}</span>
                        <span className="tabular-nums">{formatRupiah(g.total)}</span>
                      </div>
                      {g.items.map((it) => (
                        <PhoneRow
                          key={it.id}
                          item={it}
                          open={expanded.has(it.id)}
                          onToggleOpen={() => toggleExpanded(it.id)}
                          selected={chosen.has(it.id)}
                          onSelect={() => toggleSelected(it.id)}
                          dimmed={hidden.has(it.id)}
                          onToggleHidden={() => toggleHidden(it.id)}
                          onEdit={() => setEditing(it)}
                          onLink={() => setLinking(it)}
                          onStatus={(st) => setOrderStatus(it.id, st)}
                          buyerById={buyerById}
                          modal={orderModal(it, productById, productByName)}
                        />
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </div>

            <div className="overflow-x-auto hidden md:block">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={`${thClass} w-8`}>
                      <SelectAllBox
                        ids={filtered.map((o) => o.id)}
                        selected={chosen}
                        onToggle={toggleAll}
                        title="Pilih semua item yang tampil"
                      />
                    </th>
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
                    {visible.modalSatuan !== false && (
                      <th className={`${thClass} text-right`}>Harga Dasar</th>
                    )}
                    {visible.totalHarga !== false && (
                      <th className={`${thClass} text-right`}>Total</th>
                    )}
                    {visible.status !== false && (
                      <th className={thClass}>Status</th>
                    )}
                    {visible.buyer !== false && (
                      <th className={thClass}>Pembeli</th>
                    )}
                    {visible.createdAt !== false && (
                      <th className={thClass}>Dibuat</th>
                    )}
                    {visible.updatedAt !== false && (
                      <th className={thClass}>Diperbarui</th>
                    )}
                    <ByHeaders show={byVisible} className={thClass} />
                    <th className={thClass}></th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((s) => (
                    <Fragment key={s.key}>
                      {s.label !== null && (
                        <tr className="bg-brand-soft border-t-2 border-brand-line">
                          <td className={tdClass}>
                            <SelectAllBox
                              ids={s.items.map((i) => i.id)}
                              selected={chosen}
                              onToggle={toggleAll}
                              title={`Pilih semua item ${s.label}`}
                            />
                          </td>
                          <td
                            className={`${tdClass} font-bold text-brand-strong`}
                            colSpan={Math.max(1, totalCols - 2)}
                          >
                            {s.label}
                            <span className="ml-2 font-normal text-brand-edge">
                              · {s.items.length} item
                            </span>
                          </td>
                          {/* Only when there is a column left to put it in. With
                            every data column hidden the header would otherwise
                            emit more cells than the table has, stretching it
                            past its own <thead>. */}
                          {totalCols > 2 && (
                            <td
                              className={`${tdClass} text-right font-bold tabular-nums text-brand-strong`}
                            >
                              {formatRupiah(s.total)}
                            </td>
                          )}
                        </tr>
                      )}
                      {s.dates.map((g) => (
                        <GroupRows
                          key={g.tanggal}
                          group={g}
                          visible={visible}
                          hidden={hidden}
                          onEdit={setEditing}
                          onSetStatus={setOrderStatus}
                          onLink={setLinking}
                          productById={productById}
                          productByName={productByName}
                          buyerById={buyerById}
                          selected={chosen}
                          onToggleSelected={toggleSelected}
                          onToggleAll={toggleAll}
                        />
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      {adding && (
        <AddOrderDialog
          products={products}
          buyerId={addBuyerId}
          onBuyerChange={setAddBuyerId}
          onSave={addItems}
          onClose={() => setAdding(false)}
        />
      )}

      {editing && (
        <EditOrderDialog
          order={editing}
          products={products}
          hidden={hidden.has(editing.id)}
          onSave={(edit, hide) => {
            updateOrder(editing.id, edit);
            if (hide !== hidden.has(editing.id)) toggleHidden(editing.id);
          }}
          onDelete={() => {
            setDeleting(new Set([editing.id]));
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <DeleteOrdersDialog
          ids={deleting}
          onConfirm={(opts) => {
            deleteOrders(deleting, opts);
            setSelected((prev) => {
              const next = new Set(prev);
              for (const id of deleting) next.delete(id);
              return next;
            });
          }}
          onClose={() => setDeleting(null)}
        />
      )}

      {buying && (
        <BuyFromOrderDialog
          tanggal={buyingDate}
          items={orders.filter((o) => chosen.has(o.id))}
          products={products}
          onConfirm={commitPurchases}
          onClose={() => {
            setBuying(false);
            clearSelection();
          }}
        />
      )}

      {linking && (
        <LinkProductDialog
          namaProduk={linking.namaProduk}
          products={products}
          onPick={(productId) => {
            linkOrderProduct(linking.id, productId);
            setLinking(null);
          }}
          onClose={() => setLinking(null)}
        />
      )}

      {backfillPending && !backfillClosed && withoutBuyer > 0 && (
        <BuyerBackfillDialog
          count={withoutBuyer}
          onClose={() => setBackfillClosed(true)}
        />
      )}
    </div>
  );
}

// One-tap status. The badge IS the control: tapping flips pending/paid, the same
// single write the old inline dropdown made, without a menu in between.
function StatusBadge({
  status,
  onToggle,
}: {
  status: OrderStatus;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={status === "paid" ? "Paid — ketuk untuk jadikan Pending" : "Pending — ketuk untuk jadikan Paid"}
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs cursor-pointer whitespace-nowrap ${statusSelectClass(status)}`}
    >
      {status === "paid" ? "Paid" : "Pending"}
    </button>
  );
}

function ProductLink({
  item,
  onLink,
}: {
  item: OrderItem;
  onLink: (item: OrderItem) => void;
}) {
  return item.productId ? (
    <Link
      to="/produk/$id"
      params={{ id: item.productId }}
      className="text-brand hover:underline font-medium"
    >
      {item.namaProduk}
    </Link>
  ) : (
    <button
      type="button"
      className="text-warn bg-warn-soft border border-warn-line rounded px-1.5 py-0.5 font-medium hover:bg-warn-soft-strong"
      title="Belum tertaut ke produk — klik untuk menautkan"
      onClick={() => onLink(item)}
    >
      <AlertIcon className="inline h-3.5 w-3.5 -mt-0.5" /> {item.namaProduk}
    </button>
  );
}

// A row with no buyer gets a grey chip, not the amber one an unlinked product
// gets: an unlinked product is a data defect, a buyerless order is very often
// just the truth. Changing the buyer now happens in the Edit dialog.
function BuyerName({
  item,
  buyerById,
}: {
  item: OrderItem;
  buyerById: Map<string, Buyer>;
}) {
  if (!item.buyerId) return <span className="text-faint">— tanpa pembeli —</span>;
  const buyer = buyerById.get(item.buyerId);
  // deleteBuyer does not cascade, so a live order can point at a tombstoned
  // buyer. Say so instead of rendering a link that lands on a not-found page.
  return buyer ? (
    <Link
      to="/pembeli/$id"
      params={{ id: buyer.id }}
      className="text-brand hover:underline font-medium whitespace-nowrap"
    >
      {buyer.nama}
    </Link>
  ) : (
    <span className="text-faint italic">(pembeli dihapus)</span>
  );
}

// Profit on a line when a Harga Dasar exists to compute it from.
function untung(
  it: OrderItem,
  modal: { value: number; estimate: boolean } | null,
): { value: number; estimate: boolean } | null {
  return modal
    ? {
        value: (it.hargaSatuan - modal.value) * it.kuantitas,
        estimate: modal.estimate,
      }
    : null;
}

function PhoneRow({
  item: it,
  open,
  onToggleOpen,
  selected,
  onSelect,
  dimmed,
  onToggleHidden,
  onEdit,
  onLink,
  onStatus,
  buyerById,
  modal,
}: {
  item: OrderItem;
  open: boolean;
  onToggleOpen: () => void;
  selected: boolean;
  onSelect: () => void;
  dimmed: boolean;
  onToggleHidden: () => void;
  onEdit: () => void;
  onLink: () => void;
  onStatus: (status: OrderStatus) => void;
  buyerById: Map<string, Buyer>;
  modal: { value: number; estimate: boolean } | null;
}) {
  const profit = untung(it, modal);
  const kv: [string, React.ReactNode][] = [
    ["Satuan", it.satuan],
    ["Qty", formatAngka(it.kuantitas)],
    ["Harga satuan", formatRupiah(it.hargaSatuan)],
    ["Harga dasar", <ModalValue key="m" modal={modal} />],
    [
      "Untung",
      profit ? (
        <span className={profit.value < 0 ? "text-danger" : "text-ok"}>
          {profit.estimate && "≈ "}
          {profit.value < 0 ? "− " : "+ "}
          {formatRupiah(Math.abs(profit.value))}
        </span>
      ) : (
        <span className="text-faint">—</span>
      ),
    ],
    ["Pembeli", <BuyerName key="b" item={it} buyerById={buyerById} />],
    ["Dibuat", formatDateTimeID(it.createdAt)],
    ["Diperbarui", formatDateTimeID(it.updatedAt)],
    ["Dibuat oleh", <ByCell key="c" email={it.createdBy} />],
    ["Diperbarui oleh", <ByCell key="u" email={it.updatedBy} />],
  ];

  return (
    <div
      className={`border-b border-line ${dimmed ? "opacity-40" : ""} ${selected ? "bg-brand-soft" : ""}`}
    >
      <div
        className="flex items-center gap-2 pl-3 pr-2 min-h-11 cursor-pointer"
        onClick={onToggleOpen}
      >
        <input
          type="checkbox"
          className="accent-brand shrink-0"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={onSelect}
          aria-label={`Pilih ${it.namaProduk}`}
        />
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
        <StatusBadge status={it.status} onToggle={() => onStatus(it.status === "paid" ? "pending" : "paid")} />
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
              <ProductLink item={it} onLink={onLink} />
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
          <div className="flex justify-end gap-2 mt-3">
            <Button size="sm" onClick={onToggleHidden}>
              {dimmed ? <EyeOffIcon /> : <EyeIcon />}
              {dimmed ? "Hitung lagi" : "Sembunyikan"}
            </Button>
            <Button size="sm" onClick={onEdit}>
              <PencilIcon /> Edit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupRows({
  group,
  visible,
  hidden,
  onEdit,
  onSetStatus,
  onLink,
  productById,
  productByName,
  buyerById,
  selected,
  onToggleSelected,
  onToggleAll,
}: {
  group: DateGroup;
  visible: Record<string, boolean>;
  hidden: Set<string>;
  onEdit: (item: OrderItem) => void;
  onSetStatus: (id: string, status: OrderStatus) => void;
  onLink: (item: OrderItem) => void;
  productById: Map<string, Product>;
  productByName: Map<string, Product>;
  buyerById: Map<string, Buyer>;
  selected: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
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
        <td className={tdClass}>
          <SelectAllBox
            ids={group.items.map((i) => i.id)}
            selected={selected}
            onToggle={onToggleAll}
            title={`Pilih semua item ${formatTanggalID(group.tanggal)}`}
          />
        </td>
        <td
          className={`${tdClass} font-bold`}
          colSpan={Math.max(1, beforeCount)}
        >
          {formatTanggalID(group.tanggal)}
        </td>
        {visible.totalHarga !== false && (
          <td className={`${tdClass} text-right font-bold tabular-nums`}>
            {formatRupiah(group.total)}
          </td>
        )}
        <td className={tdClass} colSpan={afterCount} />
      </tr>
      {group.items.map((it) => (
        <tr
          key={it.id}
          className={`hover:bg-surface-sunken ${
            hidden.has(it.id) ? "opacity-40" : ""
          } ${selected.has(it.id) ? "bg-brand-soft" : ""}`}
        >
          <td className={tdClass}>
            <input
              type="checkbox"
              className="align-middle accent-brand"
              checked={selected.has(it.id)}
              onChange={() => onToggleSelected(it.id)}
              aria-label={`Pilih ${it.namaProduk}`}
            />
          </td>
          {visible.namaProduk !== false && (
            <td className={tdClass}>
              <ProductLink item={it} onLink={onLink} />
            </td>
          )}
          {visible.satuan !== false && <td className={tdClass}>{it.satuan}</td>}
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
          {visible.modalSatuan !== false && (
            <td className={`${tdClass} text-right tabular-nums whitespace-nowrap`}>
              <ModalValue
                modal={orderModal(it, productById, productByName)}
              />
            </td>
          )}
          {visible.totalHarga !== false && (
            <td className={`${tdClass} text-right tabular-nums`}>
              {formatRupiah(it.totalHarga)}
            </td>
          )}
          {visible.status !== false && (
            <td className={tdClass}>
              <StatusBadge
                status={it.status}
                onToggle={() =>
                  onSetStatus(it.id, it.status === "paid" ? "pending" : "paid")
                }
              />
            </td>
          )}
          {visible.buyer !== false && (
            <td className={tdClass}>
              <BuyerName item={it} buyerById={buyerById} />
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

// A checkbox over a set of rows: checked when all are selected, indeterminate
// when only some are. `indeterminate` is a DOM property with no HTML attribute,
// so it can only be set through a ref — React will not render it from JSX.
function SelectAllBox({
  ids,
  selected,
  onToggle,
  title,
}: {
  ids: string[];
  selected: Set<string>;
  onToggle: (ids: string[]) => void;
  title: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const picked = ids.filter((id) => selected.has(id)).length;
  const all = ids.length > 0 && picked === ids.length;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = picked > 0 && !all;
  }, [picked, all]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className="align-middle accent-brand"
      checked={all}
      disabled={ids.length === 0}
      onChange={() => onToggle(ids)}
      title={title}
      aria-label={title}
    />
  );
}

// The bulk editor. Both controls apply on change with no confirm step, matching
// the inline row controls they mirror — and every write they make is a normal
// audited update, so a misfire is visible in Riwayat rather than silent.
function BulkBar({
  count,
  buyers,
  onStatus,
  onBuyer,
  onCreateBuyer,
  onBuy,
  onClear,
}: {
  count: number;
  buyers: Buyer[];
  onStatus: (status: OrderStatus) => void;
  onBuyer: (buyerId: string) => void;
  onCreateBuyer: (nama: string) => void;
  onBuy: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex gap-3 flex-wrap items-center mb-3 p-2.5 rounded-lg border border-brand-line bg-brand-soft">
      <span className="text-sm font-semibold text-brand-text">
        {count} item dipilih
      </span>
      <Select
        className="w-auto py-1"
        // Resets to the placeholder after every apply: the control is an action,
        // not a field, and leaving "Paid" showing would imply the selection is
        // now paid when the selection has already been cleared.
        value=""
        onChange={(e) =>
          e.target.value && onStatus(e.target.value as OrderStatus)
        }
      >
        <option value="">Ubah status…</option>
        <option value="pending">Pending</option>
        <option value="paid">Paid</option>
      </Select>
      <div className="w-52">
        <BuyerSelect
          value=""
          options={buyers}
          onChange={onBuyer}
          onCreate={onCreateBuyer}
        />
      </div>
      <Button size="sm" onClick={onBuy} title="Catat pembelian stok untuk item terpilih">
        Beli stok ({count})
      </Button>
      <GhostButton size="sm" onClick={onClear}>
        Batal pilih
      </GhostButton>
    </div>
  );
}
