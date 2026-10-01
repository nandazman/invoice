import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import type { Product } from "../lib/types";
import {
  useProducts,
  useTypes,
  upsertProduct,
  deleteProduct,
} from "../lib/store";
import {
  formatRupiah,
  formatUang,
  formatAngka,
  formatDateTimeID,
} from "../lib/format";
import {
  ATTRIBUTION_COLUMNS,
  ATTRIBUTION_COLUMN_IDS,
  usePersistentVisibility,
} from "../lib/columns";
import { ByCell } from "../components/Attribution";
import { ProductDialog } from "../components/ProductDialog";
import { CatalogDialog } from "../components/CatalogDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ColumnToggle } from "../components/ColumnToggle";
import { Button, PrimaryButton, GhostButton } from "../components/Button";
import { SearchInput } from "../components/SearchInput";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Toolbar } from "../components/Toolbar";
import { typeBadgeClass } from "../lib/typeColor";
import { PencilIcon, PlusIcon, ChevronDownIcon } from "../components/icons";

const TOGGLE_COLUMNS = [
  { id: "namaProduk", label: "Nama Produk" },
  { id: "tipe", label: "Tipe" },
  { id: "ukuran", label: "Ukuran" },
  { id: "hargaDasar", label: "Harga Dasar" },
  { id: "hargaJual", label: "Harga Satuan" },
  { id: "laba", label: "Laba" },
  { id: "konversi", label: "Konversi" },
  { id: "createdAt", label: "Dibuat" },
  { id: "updatedAt", label: "Diperbarui" },
  ...ATTRIBUTION_COLUMNS,
];

// createdAt/updatedAt and the two attribution columns are hidden by default;
// users can re-enable them. No storage-key bump: usePersistentVisibility merges
// the saved object over `defaults` key by key, so an id the saved state has
// never heard of resolves to its default rather than to `undefined`.
const HIDDEN_BY_DEFAULT = ["createdAt", "updatedAt", ...ATTRIBUTION_COLUMN_IDS];
const COLUMN_DEFAULTS = Object.fromEntries(
  TOGGLE_COLUMNS.map((c) => [c.id, !HIDDEN_BY_DEFAULT.includes(c.id)]),
);

const col = createColumnHelper<Product>();

// Shape classes for the Tipe badge. The colour comes from `typeBadgeClass`,
// which derives it from the type name, so the two stay separable.
const badgeClass = "inline-block rounded-md px-2 py-0.5 text-xs font-semibold";

// Always on the collapsed phone row, so the phone Kolom menu leaves them out.
const PHONE_FIXED = ["namaProduk", "tipe", "hargaJual"];

// The phone layout. Eight columns do not fit on 390px, so below `md` a row is
// name, type badge and price; tapping it opens a label / value card with the
// rest, plus Detail and Edit. The Kolom menu in the toolbar chooses which lines
// the card shows, from the same state as the desktop table.
function PhoneRow({
  p,
  open,
  onToggleOpen,
  onEdit,
  visible,
}: {
  visible: Record<string, boolean>;
  p: Product;
  open: boolean;
  onToggleOpen: () => void;
  onEdit: () => void;
}) {
  const laba = p.hargaJual - p.hargaDasar;
  const ukuran = `${p.ukuran ?? ""} ${p.satuan ?? ""}`.trim();
  // Harga Satuan is the price on the collapsed row, so its line is not optional.
  const all: [string, string, ReactNode][] = [
    ["ukuran", "Ukuran", ukuran || <span className="text-faint">—</span>],
    ["hargaDasar", "Harga Dasar", formatUang(p.hargaDasar)],
    ["hargaJual", "Harga Satuan", formatUang(p.hargaJual)],
    [
      "laba",
      "Laba",
      <span key="l" className={laba < 0 ? "text-danger" : "text-ok"}>
        {formatUang(laba)}
      </span>,
    ],
    [
      "konversi",
      "Konversi",
      p.konversi.length === 0 ? (
        <span className="text-faint">—</span>
      ) : (
        <span key="k" className="flex flex-col items-end gap-1">
          {p.konversi.map((kv, i) => (
            <span key={i}>
              1 {kv.nama} = {formatAngka(kv.jumlah)} · {formatRupiah(kv.harga)}
            </span>
          ))}
        </span>
      ),
    ],
    ["createdAt", "Dibuat", formatDateTimeID(p.createdAt)],
    ["updatedAt", "Diperbarui", formatDateTimeID(p.updatedAt)],
    ["createdBy", "Dibuat oleh", <ByCell key="c" email={p.createdBy} />],
    ["updatedBy", "Diubah oleh", <ByCell key="u" email={p.updatedBy} />],
  ];
  const kv: [string, ReactNode][] = all
    .filter(([id]) => id === "hargaJual" || visible[id] !== false)
    .map(([, label, value]) => [label, value]);
  return (
    <div className="border-b border-line">
      <div
        className="flex items-center gap-2 pl-4 pr-3 min-h-11 cursor-pointer"
        onClick={onToggleOpen}
      >
        <button
          type="button"
          aria-expanded={open}
          className="flex-1 min-w-0 text-left font-medium break-words py-1"
        >
          {p.namaProduk}
        </button>
        <span className={`${badgeClass} ${typeBadgeClass(p.tipe)}`}>
          {p.tipe}
        </span>
        <span className="tabular-nums font-medium whitespace-nowrap">
          {formatUang(p.hargaJual)}
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-faint ${open ? "rotate-180" : ""}`}
        />
      </div>
      {open && (
        <div className="bg-surface-sunken border-t border-line px-4 py-3 text-sm">
          <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1.5">
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
            <Link
              to="/produk/$id"
              params={{ id: p.id }}
              className="inline-flex items-center min-h-8 px-3 text-sm font-medium text-brand hover:underline"
            >
              Detail
            </Link>
            <Button size="sm" onClick={onEdit}>
              <PencilIcon /> Edit
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PricesPage() {
  const products = useProducts();
  const types = useTypes();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  const [sorting, setSorting] = useState<SortingState>([
    { id: "namaProduk", desc: false },
  ]);
  const [visible, toggleColumn] = usePersistentVisibility(
    "invoice.harga.cols.v2",
    COLUMN_DEFAULTS,
  );

  // Which product is waiting for its delete confirmation. Holding the row —
  // not just the id — is what lets the dialog name the product it is about to
  // remove; a native confirm could only ever say "produk ini".
  const [deleting, setDeleting] = useState<Product | null>(null);

  function removeProduct() {
    if (deleting) deleteProduct(deleting.id);
    setDeleting(null);
  }

  function upsert(product: Product) {
    upsertProduct(product);
    setEditing(null);
    setCreating(false);
  }

  const columns = useMemo(
    () => [
      col.accessor("namaProduk", {
        header: "Nama Produk",
        cell: (c) => (
          <Link
            to="/produk/$id"
            params={{ id: c.row.original.id }}
            className="text-brand hover:underline font-medium"
          >
            {c.getValue()}
          </Link>
        ),
      }),
      col.accessor("tipe", {
        header: "Tipe",
        cell: (c) => (
          <span className={`${badgeClass} ${typeBadgeClass(c.getValue())}`}>
            {c.getValue()}
          </span>
        ),
      }),
      col.display({
        id: "ukuran",
        header: "Ukuran",
        cell: (c) => {
          const p = c.row.original;
          if (p.ukuran == null && !p.satuan)
            return <span className="text-faint">—</span>;
          return `${p.ukuran ?? ""} ${p.satuan ?? ""}`.trim();
        },
      }),
      // "Rp" is stated once in each money header instead of once per cell.
      // Three money columns over 200 products printed it roughly 600 times a
      // screen, which is 600 repetitions of the one thing that never varies.
      col.accessor("hargaDasar", {
        header: "Harga Dasar (Rp)",
        cell: (c) => formatUang(c.getValue()),
        meta: { num: true },
      }),
      col.accessor("hargaJual", {
        header: "Harga Satuan (Rp)",
        cell: (c) => formatUang(c.getValue()),
        meta: { num: true },
      }),
      col.display({
        id: "laba",
        header: "Laba (Rp)",
        cell: (c) => {
          const p = c.row.original;
          const laba = p.hargaJual - p.hargaDasar;
          return (
            <span className={laba < 0 ? "text-danger" : "text-ok"}>
              {formatUang(laba)}
            </span>
          );
        },
        meta: { num: true },
      }),
      col.display({
        id: "konversi",
        header: "Konversi",
        cell: (c) => {
          const k = c.row.original.konversi;
          if (k.length === 0) return <span className="text-faint">—</span>;
          // Capped at two badges: a product with five conversions used to be
          // five lines tall and dragged every other row's height with it. The
          // full list is on the detail page, which the product name links to.
          const shown = k.slice(0, 2);
          const rest = k.length - shown.length;
          return (
            <div className="flex flex-wrap items-center gap-1">
              {shown.map((kv, i) => (
                <span
                  key={i}
                  className="inline-block bg-brand-soft text-brand-text rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
                >
                  1 {kv.nama} = {formatAngka(kv.jumlah)} ·{" "}
                  {formatRupiah(kv.harga)}
                </span>
              ))}
              {rest > 0 && (
                <span className="inline-block bg-surface-hover text-muted rounded-md px-2 py-0.5 text-xs font-semibold">
                  +{rest}
                </span>
              )}
            </div>
          );
        },
      }),
      col.accessor("createdAt", {
        header: "Dibuat",
        cell: (c) => (
          <span className="text-faint text-xs">
            {formatDateTimeID(c.getValue())}
          </span>
        ),
      }),
      col.accessor("updatedAt", {
        header: "Diperbarui",
        cell: (c) => (
          <span className="text-faint text-xs">
            {formatDateTimeID(c.getValue())}
          </span>
        ),
      }),
      // Server-stamped, so they are display-only and never sortable-by-accident
      // in a way that matters — they sort like any other string column.
      col.accessor("createdBy", {
        header: "Dibuat oleh",
        cell: (c) => <ByCell email={c.getValue()} />,
      }),
      col.accessor("updatedBy", {
        header: "Diubah oleh",
        cell: (c) => <ByCell email={c.getValue()} />,
      }),
      col.display({
        id: "aksi",
        header: "",
        enableHiding: false,
        // One pencil opens the single edit dialog; Hapus lives inside it.
        cell: (c) => {
          const p = c.row.original;
          return (
            <div className="flex gap-1 justify-end items-center">
              <GhostButton
                size="sm"
                title={`Ubah ${p.namaProduk}`}
                aria-label={`Ubah ${p.namaProduk}`}
                onClick={() => setEditing(p)}
              >
                <PencilIcon />
              </GhostButton>
            </div>
          );
        },
      }),
    ],
    [products],
  );

  const table = useReactTable({
    data: products,
    columns,
    state: { sorting, globalFilter: filter, columnVisibility: visible },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const total = products.length;
  const shown = table.getRowModel().rows.length;
  const filtering = filter.trim().length > 0;

  return (
    <div>
      <div className="hidden md:flex items-start gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold mb-1">Daftar Harga</h1>
          <p className="text-faint">
            Produk, harga satuan, dan konversi kemasan (mis. 1 box = 12 unit).
          </p>
        </div>
        <PrimaryButton onClick={() => setCreating(true)}>
          <PlusIcon /> Tambah Produk
        </PrimaryButton>
      </div>

      <Panel flush className="-mx-4 md:mx-0">
        <div className="px-4 md:px-0">
          <Toolbar
            search={
              <div className="flex gap-2">
                <SearchInput
                  className="flex-1"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Cari produk…"
                  aria-label="Cari produk"
                />
                <PrimaryButton
                  className="md:hidden"
                  onClick={() => setCreating(true)}
                >
                  <PlusIcon /> Tambah
                </PrimaryButton>
              </div>
            }
            actions={
              <>
                <Button
                  size="sm"
                  onClick={() => setCatalogOpen(true)}
                  disabled={products.length === 0}
                >
                  Ekspor Katalog
                </Button>
                <Button
                  size="sm"
                  className="md:!hidden"
                  onClick={() =>
                    setExpanded(
                      expanded.size > 0
                        ? new Set()
                        : new Set(
                            table.getRowModel().rows.map((r) => r.original.id),
                          ),
                    )
                  }
                >
                  <ChevronDownIcon
                    className={expanded.size > 0 ? "rotate-180" : undefined}
                  />
                  {expanded.size > 0 ? "Tutup semua" : "Buka semua"}
                </Button>
                <div className="md:hidden">
                  <ColumnToggle
                    columns={TOGGLE_COLUMNS.filter(
                      (c) => !PHONE_FIXED.includes(c.id),
                    )}
                    visible={visible}
                    onToggle={toggleColumn}
                  />
                </div>
                <div className="hidden md:block">
                  <ColumnToggle
                    columns={TOGGLE_COLUMNS}
                    visible={visible}
                    onToggle={toggleColumn}
                  />
                </div>
              </>
            }
          />
        </div>

        <DataTable
          table={table}
          mobile={table.getRowModel().rows.map((row) => (
            <PhoneRow
              key={row.id}
              p={row.original}
              open={expanded.has(row.original.id)}
              onToggleOpen={() => toggleExpanded(row.original.id)}
              onEdit={() => setEditing(row.original)}
              visible={visible}
            />
          ))}
          empty={
            // Two different situations wearing one message until now. "Belum
            // ada produk" is a setup problem and wants the add button; a search
            // miss is a filter problem and wants the query named and a way out
            // of it. Telling someone with 39 products that there are no
            // products is just wrong.
            total === 0 ? (
              <div className="text-center py-10 px-4">
                <p className="font-medium text-body">Belum ada produk.</p>
                <p className="text-sm text-faint mt-1 mb-4">
                  Tambahkan produk pertama untuk mulai menyusun daftar harga.
                </p>
                <PrimaryButton onClick={() => setCreating(true)}>
                  + Tambah Produk
                </PrimaryButton>
              </div>
            ) : (
              <div className="text-center py-10 px-4">
                <p className="font-medium text-body">
                  Tidak ada produk yang cocok dengan “{filter}”.
                </p>
                <p className="text-sm text-faint mt-1 mb-4">
                  Coba kata kunci lain, atau hapus pencarian untuk melihat
                  seluruh {total} produk.
                </p>
                <Button onClick={() => setFilter("")}>Hapus pencarian</Button>
              </div>
            )
          }
        />
        <div className="text-faint mt-2 mb-2 px-4 md:px-0 md:mb-0 text-xs">
          {/* The old line printed the unfiltered total and never moved while
              you typed, so it contradicted the table right above it. */}
          {filtering
            ? `Menampilkan ${shown} dari ${total} produk`
            : `${total} produk`}
        </div>
      </Panel>

      {(creating || editing) && (
        <ProductDialog
          product={editing}
          types={types}
          onSave={upsert}
          onDelete={
            editing
              ? () => {
                  setDeleting(editing);
                  setEditing(null);
                }
              : undefined
          }
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}

      {catalogOpen && (
        <CatalogDialog
          products={products}
          types={types}
          onClose={() => setCatalogOpen(false)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          danger
          title="Hapus produk ini?"
          confirmLabel="Ya, hapus produk"
          onConfirm={removeProduct}
          onClose={() => setDeleting(null)}
        >
          <p>
            <strong>1 produk</strong> ({deleting.namaProduk}) akan hilang dari
            daftar harga. Tidak bisa dibatalkan.
          </p>
          <p>
            Pesanan, pembelian, dan stok yang sudah tercatat tidak ikut
            terhapus.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
