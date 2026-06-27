import { useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import type { Product } from "../lib/types";
import {
  useProducts,
  setProducts,
  useTypes,
  addType,
  upsertProduct,
  deleteProduct,
} from "../lib/store";
import { formatRupiah, formatAngka, formatDateTimeID } from "../lib/format";
import {
  serializeProducts,
  parseProducts,
  downloadJSON,
  pickJSONFile,
} from "../lib/io";
import { usePersistentVisibility } from "../lib/columns";
import { ProductDialog } from "../components/ProductDialog";
import { ColumnToggle } from "../components/ColumnToggle";
import { Button, PrimaryButton, DangerButton } from "../components/Button";
import { Input } from "../components/Input";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";

const TOGGLE_COLUMNS = [
  { id: "namaProduk", label: "Nama Produk" },
  { id: "tipe", label: "Tipe" },
  { id: "ukuran", label: "Ukuran" },
  { id: "hargaJual", label: "Harga Satuan" },
  { id: "konversi", label: "Konversi" },
  { id: "createdAt", label: "Dibuat" },
  { id: "updatedAt", label: "Diperbarui" },
];

const COLUMN_DEFAULTS = Object.fromEntries(
  TOGGLE_COLUMNS.map((c) => [c.id, true]),
);

const col = createColumnHelper<Product>();

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

export function PricesPage() {
  const products = useProducts();
  const types = useTypes();
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "namaProduk", desc: false },
  ]);
  const [visible, toggleColumn] = usePersistentVisibility(
    "invoice.harga.cols.v1",
    COLUMN_DEFAULTS,
  );

  function removeProduct(id: string) {
    if (!confirm("Hapus produk ini?")) return;
    deleteProduct(id);
  }

  function upsert(product: Product) {
    upsertProduct(product);
    setEditing(null);
    setCreating(false);
  }

  async function doImport() {
    try {
      const text = await pickJSONFile();
      const imported = parseProducts(text);
      if (
        !confirm(
          `Impor ${imported.length} produk? Ini akan mengganti daftar saat ini.`,
        )
      )
        return;
      setProducts(imported);
      for (const p of imported) addType(p.tipe);
    } catch (e) {
      alert("Gagal impor: " + (e as Error).message);
    }
  }

  const columns = useMemo(
    () => [
      col.accessor("namaProduk", { header: "Nama Produk" }),
      col.accessor("tipe", {
        header: "Tipe",
        cell: (c) => (
          <span className="inline-block bg-slate-100 text-slate-600 rounded-md px-2 py-0.5 text-xs font-semibold">
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
            return <span className="text-slate-400">—</span>;
          return `${p.ukuran ?? ""} ${p.satuan ?? ""}`.trim();
        },
      }),
      col.accessor("hargaJual", {
        header: "Harga Satuan",
        cell: (c) => formatRupiah(c.getValue()),
        meta: { num: true },
      }),
      col.display({
        id: "konversi",
        header: "Konversi",
        cell: (c) => {
          const k = c.row.original.konversi;
          if (k.length === 0) return <span className="text-slate-400">—</span>;
          return k.map((kv, i) => (
            <span
              key={i}
              className="inline-block bg-blue-50 text-blue-700 rounded-md px-2 py-0.5 text-xs font-semibold mr-1 mb-1"
            >
              1 {kv.nama} = {formatAngka(kv.jumlah)} · {formatRupiah(kv.harga)}
            </span>
          ));
        },
      }),
      col.accessor("createdAt", {
        header: "Dibuat",
        cell: (c) => (
          <span className="text-slate-400 text-xs">
            {formatDateTimeID(c.getValue())}
          </span>
        ),
      }),
      col.accessor("updatedAt", {
        header: "Diperbarui",
        cell: (c) => (
          <span className="text-slate-400 text-xs">
            {formatDateTimeID(c.getValue())}
          </span>
        ),
      }),
      col.display({
        id: "aksi",
        header: "",
        enableHiding: false,
        cell: (c) => (
          <div className="flex gap-1 justify-end">
            <Button size="sm" onClick={() => setEditing(c.row.original)}>
              Ubah
            </Button>
            <DangerButton
              size="sm"
              onClick={() => removeProduct(c.row.original.id)}
            >
              Hapus
            </DangerButton>
          </div>
        ),
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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Daftar Harga</h1>
      <p className="text-slate-500 mb-4">
        Produk, harga satuan, dan konversi kemasan (mis. 1 box = 12 unit).
      </p>

      <Panel>
        <div className="flex gap-3 flex-wrap items-end mb-3">
          <Field label="Cari produk" className="flex-1 min-w-[220px]">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Ketik nama produk…"
            />
          </Field>
          <PrimaryButton onClick={() => setCreating(true)}>
            + Tambah Produk
          </PrimaryButton>
          <Button onClick={doImport}>Impor JSON</Button>
          <Button
            onClick={() =>
              downloadJSON("price.json", serializeProducts(products))
            }
          >
            Ekspor JSON
          </Button>
          <ColumnToggle
            columns={TOGGLE_COLUMNS}
            visible={visible}
            onToggle={toggleColumn}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const num = (h.column.columnDef.meta as { num?: boolean })
                      ?.num;
                    const sortable = h.column.getCanSort();
                    return (
                      <th
                        key={h.id}
                        className={`${thClass} ${num ? "text-right" : ""} ${
                          sortable ? "cursor-pointer select-none" : ""
                        }`}
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          h.column.columnDef.header,
                          h.getContext(),
                        )}
                        {{ asc: " ▲", desc: " ▼" }[
                          h.column.getIsSorted() as string
                        ] ?? ""}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  {row.getVisibleCells().map((cell) => {
                    const num = (cell.column.columnDef.meta as {
                      num?: boolean;
                    })?.num;
                    return (
                      <td
                        key={cell.id}
                        className={`${tdClass} ${
                          num ? "text-right tabular-nums" : ""
                        }`}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {table.getRowModel().rows.length === 0 && (
          <div className="text-center text-slate-400 py-8">
            Tidak ada produk.
          </div>
        )}
        <div className="text-slate-400 mt-2 text-xs">
          {products.length} produk
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
    </div>
  );
}
