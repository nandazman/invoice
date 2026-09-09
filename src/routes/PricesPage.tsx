import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type Row,
  type SortingState,
  type Table,
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
import {
  Button,
  PrimaryButton,
  DangerGhostButton,
  GhostButton,
} from "../components/Button";
import { Input } from "../components/Input";
import { Panel } from "../components/Panel";
import { DataTable, SortHeader, tdClass } from "../components/DataTable";
import { Field } from "../components/Field";
import { Toolbar } from "../components/Toolbar";
import { typeBadgeClass } from "../lib/typeColor";
import { TrashIcon, PencilIcon } from "../components/icons";

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

// The phone layout: two columns, because eight will not fit on 390px and a
// horizontally scrolled price table is a table nobody reads. Produk carries
// the name, type, and size; Harga Satuan carries the price with the margin
// beneath it. Editing happens on the product's detail page, which the name
// already links to, so there is no action column to squeeze in.
//
// This is the swap point: replacing rows with cards means rewriting this
// component and nothing else.
function MobilePriceRow({ row }: { row: Row<Product> }) {
  const p = row.original;
  const laba = p.hargaJual - p.hargaDasar;
  const ukuran = `${p.ukuran ?? ""} ${p.satuan ?? ""}`.trim();
  return (
    <tr>
      <td className={`${tdClass} align-top`}>
        <Link
          to="/produk/$id"
          params={{ id: p.id }}
          className="flex items-center min-h-11 font-medium text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {p.namaProduk}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 pb-1">
          <span className={`${badgeClass} ${typeBadgeClass(p.tipe)}`}>
            {p.tipe}
          </span>
          {ukuran && <span className="text-xs text-faint">{ukuran}</span>}
        </div>
      </td>
      <td
        className={`${tdClass} align-top text-right tabular-nums whitespace-nowrap`}
      >
        <div className="flex items-center justify-end min-h-11 font-medium">
          {formatUang(p.hargaJual)}
        </div>
        <div
          className={`text-xs pb-1 ${laba < 0 ? "text-danger" : "text-ok"}`}
        >
          {formatUang(laba)}
        </div>
      </td>
    </tr>
  );
}

function MobilePriceTable({ table }: { table: Table<Product> }) {
  // Sorting stays reachable on a phone: the two headers drive the same
  // TanStack columns the desktop table sorts by, so the order matches across
  // both layouts.
  const nama = table.getColumn("namaProduk");
  const harga = table.getColumn("hargaJual");
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {nama && <SortHeader column={nama} label="Produk" />}
          {harga && <SortHeader column={harga} label="Harga Satuan (Rp)" num />}
        </tr>
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <MobilePriceRow key={row.id} row={row} />
        ))}
      </tbody>
    </table>
  );
}

export function PricesPage() {
  const products = useProducts();
  const types = useTypes();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [filter, setFilter] = useState("");
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
        // Same two actions, same single click each (D6 — no flow change).
        // Icon-only per the row-action convention: Ubah (✎) and Hapus (🗑️),
        // each carrying its Indonesian wording in title/aria-label instead of
        // as visible text.
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
              <DangerGhostButton
                size="sm"
                title={`Hapus ${p.namaProduk}`}
                aria-label={`Hapus ${p.namaProduk}`}
                onClick={() => setDeleting(p)}
              >
                <TrashIcon />
              </DangerGhostButton>
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
      <h1 className="text-2xl font-bold mb-1">Daftar Harga</h1>
      <p className="text-faint mb-4">
        Produk, harga satuan, dan konversi kemasan (mis. 1 box = 12 unit).
      </p>

      <Panel flush className="-mx-4 md:mx-0">
        <div className="px-4 md:px-0">
          <Toolbar
            search={
              <Field label="Cari produk">
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Ketik nama produk…"
                />
              </Field>
            }
            actions={
              <>
                <PrimaryButton onClick={() => setCreating(true)}>
                  + Tambah Produk
                </PrimaryButton>
                <Button
                  onClick={() => setCatalogOpen(true)}
                  disabled={products.length === 0}
                >
                  Ekspor Katalog
                </Button>
                <ColumnToggle
                  columns={TOGGLE_COLUMNS}
                  visible={visible}
                  onToggle={toggleColumn}
                />
              </>
            }
          />
        </div>

        <DataTable
          table={table}
          mobile={<MobilePriceTable table={table} />}
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
          {filtering ? `Menampilkan ${shown} dari ${total} produk` : `${total} produk`}
        </div>
      </Panel>

      {(creating || editing) && (
        <ProductDialog
          product={editing}
          types={types}
          onSave={upsert}
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
            <strong>{deleting.namaProduk}</strong> akan hilang dari daftar
            harga. Tidak bisa dibatalkan.
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
