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
import { modalCostFor } from "../lib/purchaseFromOrder";
import {
  useProducts,
  useOrders,
  useBuyers,
  addOrder,
  deleteOrder,
  setOrderStatus,
  setOrdersStatus,
  addPurchase,
  linkOrderProduct,
  setOrderBuyer,
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
import { ByCells, ByHeaders, MobileBy } from "../components/Attribution";
import { useOrderFilter, type StatusFilter } from "../lib/useOrderFilter";
import { AddItemForm } from "../components/AddItemForm";
import { BuyFromOrderDialog } from "../components/BuyFromOrderDialog";
import { LinkProductDialog } from "../components/LinkProductDialog";
import { BuyerBackfillDialog } from "../components/BuyerBackfillDialog";
import { BuyerSelect } from "../components/BuyerSelect";
import { Button, DangerGhostButton, GhostButton } from "../components/Button";
import { FilterBar } from "../components/FilterBar";
import { Select } from "../components/Select";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";
import { ColumnToggle } from "../components/ColumnToggle";
import {
  MobileField,
  MobileList,
  MobileRow,
  qtyTimesHarga,
} from "../components/MobileList";
import { thClass, tdClass } from "../components/DataTable";
import {
  TrashIcon,
  PencilIcon,
  EyeIcon,
  EyeOffIcon,
  CloseIcon,
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
  // The slice of orders open in the "Beli stok dari pesanan" dialog. Scoped by
  // buyer as well as date whenever the table is split per pembeli — otherwise
  // the button under "Andi · 5 Agustus" would open Budi's items for the same
  // day too, and the whole point of splitting is that you are looking at one
  // buyer at a time.
  const [buying, setBuying] = useState<{
    tanggal: string;
    buyerId: string | null;
  } | null>(null);
  // The unlinked order row whose "Tautkan Produk" dialog is open.
  const [linking, setLinking] = useState<OrderItem | null>(null);
  // The order row whose buyer cell is currently showing the picker.
  const [assigning, setAssigning] = useState<string | null>(null);
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

  function createBuyerFor(orderId: string, nama: string) {
    const row = newBuyer(nama);
    upsertBuyer(row);
    setOrderBuyer(orderId, row.id);
    setAssigning(null);
  }

  function addItems(items: OrderItem[]) {
    for (const item of items) addOrder(item);
  }
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
  function removeItem(id: string) {
    deleteOrder(id);
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
      <h1 className="text-2xl font-bold mb-1">Pesanan</h1>
      <p className="text-faint mb-4">
        Tambah item dari daftar harga, lihat riwayat per tanggal.
      </p>

      {products.length === 0 ? (
        <Panel className="text-center text-faint py-8">
          Belum ada produk. Tambahkan produk di halaman <b>Harga</b> dulu.
        </Panel>
      ) : (
        <AddItemForm products={products} onAdd={addItems} />
      )}

      <FilterBar filter={filter} className="flex gap-3 flex-wrap items-end">
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
        {/* A view switch, not a filter — so it sits here rather than in
            FilterBar's own row, and Reset deliberately leaves it alone. */}
        <label className="flex items-center gap-2 text-sm text-muted cursor-pointer h-9 shrink-0">
          <input
            type="checkbox"
            checked={perBuyer}
            onChange={(e) => setPerBuyer(e.target.checked)}
            className="w-4 h-4 accent-brand cursor-pointer"
          />
          Pisahkan per pembeli
        </label>
      </FilterBar>

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
          <ColumnToggle columns={COLUMNS} visible={visible} onToggle={toggle} />
        </div>

        {chosen.size > 0 && (
          <BulkBar
            count={chosen.size}
            buyers={buyers}
            onStatus={bulkStatus}
            onBuyer={bulkBuyer}
            onCreateBuyer={bulkCreateBuyer}
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
                below `md` the row collapses to what it IS on the left and
                what it is WORTH on the right — same shape as Beli Stock and
                Harga. The leading select-all/select checkboxes and the
                trailing hide/delete actions have nowhere else to go on a
                phone, so they ride along on the product side; status and
                pembeli stay their full interactive selves (the badge-styled
                dropdown and the buyer picker) rather than flattening to
                plain text, since neither the phone layout nor the desktop
                one should be able to do something the other can't. The Kolom
                toggle applies here as on the wide table: each column switched
                on restacks into the row, each switched off leaves it. Only the
                product name stays regardless — it holds the checkbox and the
                link, so it is the row. */}
            <div className="md:hidden">
              <MobileList
                left="Produk"
                right={visible.totalHarga !== false ? "Total" : ""}
              >
                {sections.map((s) => (
                  <Fragment key={s.key}>
                    {s.label !== null && (
                      <tr className="bg-brand-soft border-t-2 border-brand-line">
                        <td className={tdClass}>
                          <div className="flex items-center gap-2">
                            <SelectAllBox
                              ids={s.items.map((i) => i.id)}
                              selected={chosen}
                              onToggle={toggleAll}
                              title={`Pilih semua item ${s.label}`}
                            />
                            <span className="font-bold text-brand-strong">
                              {s.label}
                              <span className="ml-1 font-normal text-brand-edge">
                                · {s.items.length} item
                              </span>
                            </span>
                          </div>
                        </td>
                        <td
                          className={`${tdClass} text-right font-bold tabular-nums text-brand-strong`}
                        >
                          {formatRupiah(s.total)}
                        </td>
                      </tr>
                    )}
                    {s.dates.map((g) => (
                      <Fragment key={g.tanggal}>
                        {/* Scrolling a long day, the one thing you lose
                            first is which day you are looking at — the
                            amounts below stop meaning anything without it.
                            The date row pins under the fixed app bar
                            (`top-14`) and carries its own background, since
                            a `<tr>`'s paint does not travel with a stuck
                            `<td>`. "Beli stok" rides along inside it instead
                            of costing a row of its own. */}
                        <tr className="font-bold">
                          <td
                            className={`${tdClass} sticky top-14 z-10 bg-surface-hover`}
                          >
                            <div className="flex items-center gap-2">
                              <SelectAllBox
                                ids={g.items.map((i) => i.id)}
                                selected={chosen}
                                onToggle={toggleAll}
                                title={`Pilih semua item ${formatTanggalID(g.tanggal)}`}
                              />
                              {formatTanggalID(g.tanggal)}
                            </div>
                          </td>
                          <td
                            className={`${tdClass} sticky top-14 z-10 bg-surface-hover text-right font-bold tabular-nums`}
                          >
                            <div className="flex items-center justify-end gap-2">
                              {formatRupiah(g.total)}
                              <Button
                                size="sm"
                                className="min-h-9 min-w-0 px-2 py-1 text-xs font-semibold"
                                onClick={() =>
                                  setBuying({
                                    tanggal: g.tanggal,
                                    buyerId: s.buyerId,
                                  })
                                }
                                title="Catat pembelian stok untuk tanggal ini"
                              >
                                Beli stok
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {g.items.map((it) => (
                          <MobileRow
                            key={it.id}
                            // Same row-state paint as the desktop `<tr>`: a
                            // line excluded from the total reads dimmed, a
                            // selected one reads tinted.
                            className={`${hidden.has(it.id) ? "opacity-40" : ""} ${chosen.has(it.id) ? "bg-brand-soft" : ""}`}
                            title={
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="accent-brand shrink-0"
                                  checked={chosen.has(it.id)}
                                  onChange={() => toggleSelected(it.id)}
                                  aria-label={`Pilih ${it.namaProduk}`}
                                />
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
                                    onClick={() => setLinking(it)}
                                  >
                                    ⚠ {it.namaProduk}
                                  </button>
                                )}
                              </div>
                            }
                            meta={
                              <>
                                {visible.satuan !== false && (
                                  <span>{it.satuan}</span>
                                )}
                                {visible.status !== false && (
                                  <Select
                                    className={`w-auto py-0.5 text-xs ${statusSelectClass(it.status)}`}
                                    value={it.status}
                                    onChange={(e) =>
                                      setOrderStatus(
                                        it.id,
                                        e.target.value as OrderStatus,
                                      )
                                    }
                                  >
                                    <option value="pending">Pending</option>
                                    <option value="paid">Paid</option>
                                  </Select>
                                )}
                                {visible.buyer !== false && (
                                <BuyerCell
                                  item={it}
                                  buyers={buyers}
                                  buyerById={buyerById}
                                  picking={assigning === it.id}
                                  onPick={() => setAssigning(it.id)}
                                  onChange={(buyerId) => {
                                    setOrderBuyer(it.id, buyerId);
                                    setAssigning(null);
                                  }}
                                  onCreate={(nama) =>
                                    createBuyerFor(it.id, nama)
                                  }
                                  onCancel={() => setAssigning(null)}
                                />
                                )}
                                {visible.modalSatuan !== false && (
                                  <MobileField label="Dasar">
                                    <ModalValue
                                      modal={orderModal(
                                        it,
                                        productById,
                                        productByName,
                                      )}
                                    />
                                  </MobileField>
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
                                <MobileBy show={byVisible} row={it} />
                                {/* No `w-full` wrapper: forcing the two row
                                    actions onto a line of their own cost a
                                    full 44px band of empty space under every
                                    item. They wrap with the rest of the meta
                                    now, and fill the tail of whichever line
                                    they land on. */}
                                <span className="ml-auto flex items-center gap-0.5">
                                  <GhostButton
                                    size="sm"
                                    onClick={() => toggleHidden(it.id)}
                                    title={
                                      hidden.has(it.id)
                                        ? "Tampilkan & hitung di total"
                                        : "Sembunyikan dari total"
                                    }
                                    aria-label={
                                      hidden.has(it.id)
                                        ? "Tampilkan & hitung di total"
                                        : "Sembunyikan dari total"
                                    }
                                  >
                                    {hidden.has(it.id) ? (
                                      <EyeOffIcon />
                                    ) : (
                                      <EyeIcon />
                                    )}
                                  </GhostButton>
                                  <DangerGhostButton
                                    size="sm"
                                    onClick={() => removeItem(it.id)}
                                    title={`Hapus "${it.namaProduk}"`}
                                    aria-label={`Hapus "${it.namaProduk}"`}
                                  >
                                    <TrashIcon />
                                  </DangerGhostButton>
                                </span>
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
                  </Fragment>
                ))}
              </MobileList>
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
                          onToggleHidden={toggleHidden}
                          onRemove={removeItem}
                          onSetStatus={setOrderStatus}
                          onBuy={() =>
                            setBuying({
                              tanggal: g.tanggal,
                              buyerId: s.buyerId,
                            })
                          }
                          onLink={setLinking}
                          productById={productById}
                          productByName={productByName}
                          buyers={buyers}
                          buyerById={buyerById}
                          assigning={assigning}
                          onAssign={setAssigning}
                          onSetBuyer={setOrderBuyer}
                          onCreateBuyer={createBuyerFor}
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

      {buying && (
        <BuyFromOrderDialog
          tanggal={buying.tanggal}
          items={orders.filter(
            (o) =>
              o.tanggal === buying.tanggal &&
              (buying.buyerId === null || o.buyerId === buying.buyerId),
          )}
          products={products}
          onConfirm={commitPurchases}
          onClose={() => setBuying(null)}
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

function GroupRows({
  group,
  visible,
  hidden,
  onToggleHidden,
  onRemove,
  onSetStatus,
  onBuy,
  onLink,
  productById,
  productByName,
  buyers,
  buyerById,
  assigning,
  onAssign,
  onSetBuyer,
  onCreateBuyer,
  selected,
  onToggleSelected,
  onToggleAll,
}: {
  group: DateGroup;
  visible: Record<string, boolean>;
  hidden: Set<string>;
  onToggleHidden: (id: string) => void;
  onRemove: (id: string) => void;
  onSetStatus: (id: string, status: OrderStatus) => void;
  onBuy: () => void;
  onLink: (item: OrderItem) => void;
  productById: Map<string, Product>;
  productByName: Map<string, Product>;
  buyers: Buyer[];
  buyerById: Map<string, Buyer>;
  assigning: string | null;
  onAssign: (id: string | null) => void;
  onSetBuyer: (id: string, buyerId: string) => void;
  onCreateBuyer: (orderId: string, nama: string) => void;
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
        <td className={`${tdClass} text-right`} colSpan={afterCount}>
          <Button
            size="sm"
            onClick={onBuy}
            title="Catat pembelian stok untuk tanggal ini"
          >
            Beli stok
          </Button>
        </td>
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
              <Select
                className={`w-auto py-1 ${statusSelectClass(it.status)}`}
                value={it.status}
                onChange={(e) =>
                  onSetStatus(it.id, e.target.value as OrderStatus)
                }
              >
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
              </Select>
            </td>
          )}
          {visible.buyer !== false && (
            <td className={tdClass}>
              <BuyerCell
                item={it}
                buyers={buyers}
                buyerById={buyerById}
                picking={assigning === it.id}
                onPick={() => onAssign(it.id)}
                onChange={(buyerId) => {
                  onSetBuyer(it.id, buyerId);
                  onAssign(null);
                }}
                onCreate={(nama) => onCreateBuyer(it.id, nama)}
                onCancel={() => onAssign(null)}
              />
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
              className="mr-1"
              onClick={() => onToggleHidden(it.id)}
              title={
                hidden.has(it.id)
                  ? "Tampilkan & hitung di total"
                  : "Sembunyikan dari total"
              }
              aria-label={
                hidden.has(it.id)
                  ? "Tampilkan & hitung di total"
                  : "Sembunyikan dari total"
              }
            >
              {hidden.has(it.id) ? <EyeOffIcon /> : <EyeIcon />}
            </GhostButton>
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
  onClear,
}: {
  count: number;
  buyers: Buyer[];
  onStatus: (status: OrderStatus) => void;
  onBuyer: (buyerId: string) => void;
  onCreateBuyer: (nama: string) => void;
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
      <GhostButton size="sm" onClick={onClear}>
        Batal pilih
      </GhostButton>
    </div>
  );
}

// Three states, and the middle one is the point: a row with no buyer gets a
// grey chip, not the amber one an unlinked product gets. An unlinked product is
// a data defect; a buyerless order is very often just the truth.
//
// All three reach the picker, including the two that already name a buyer: an
// order handed to the wrong pembeli is an ordinary mistake, and the name is the
// one field on the row that cannot be corrected any other way (deleting and
// re-adding the order would lose its stock links). The reassign affordance is a
// separate ✎ button rather than making the name itself clickable, because the
// name has to stay a link to the buyer's page — that is how you check you are
// about to correct the right row.
function BuyerCell({
  item,
  buyers,
  buyerById,
  picking,
  onPick,
  onChange,
  onCreate,
  onCancel,
}: {
  item: OrderItem;
  buyers: Buyer[];
  buyerById: Map<string, Buyer>;
  picking: boolean;
  onPick: () => void;
  onChange: (buyerId: string) => void;
  onCreate: (nama: string) => void;
  onCancel: () => void;
}) {
  if (picking)
    return (
      <div className="flex items-center gap-1">
        <div className="w-52">
          <BuyerSelect
            value={item.buyerId}
            options={buyers}
            onChange={onChange}
            onCreate={onCreate}
          />
        </div>
        {/* Without this the cell is a one-way door: BuyerSelect closes its own
            dropdown but never unsets `assigning`, so a user who opens the picker
            on an already-assigned row and changes their mind would have to pick
            the same buyer again to get the name back. */}
        <GhostButton
          size="sm"
          onClick={onCancel}
          title="Batal"
          aria-label="Batal"
        >
          <CloseIcon />
        </GhostButton>
      </div>
    );

  if (!item.buyerId)
    return (
      <button
        type="button"
        className="text-faint bg-surface-sunken border border-line rounded px-1.5 py-0.5 font-medium whitespace-nowrap hover:bg-surface-hover"
        title="Belum ada pembeli — klik untuk memilih"
        onClick={onPick}
      >
        — tanpa pembeli —
      </button>
    );

  const buyer = buyerById.get(item.buyerId);
  // deleteBuyer does not cascade, so a live order can point at a tombstoned
  // buyer. Say so instead of rendering a link that lands on a not-found page —
  // and keep the ✎, since this is the state that most needs repairing.
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {buyer ? (
        <Link
          to="/pembeli/$id"
          params={{ id: buyer.id }}
          className="text-brand hover:underline font-medium"
        >
          {buyer.nama}
        </Link>
      ) : (
        <span className="text-faint italic">(pembeli dihapus)</span>
      )}
      <GhostButton
        size="sm"
        onClick={onPick}
        title="Ganti pembeli"
        aria-label="Ganti pembeli"
      >
        <PencilIcon />
      </GhostButton>
    </span>
  );
}
