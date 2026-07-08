import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { PurchaseItem } from "../lib/types";
import {
  useProducts,
  usePurchases,
  setPurchases,
  addPurchase,
  deletePurchase,
} from "../lib/store";
import {
  formatRupiah,
  formatAngka,
  formatTanggalID,
  formatDateTimeID,
} from "../lib/format";
import {
  serializePurchases,
  parsePurchases,
  downloadJSON,
  pickJSONFile,
} from "../lib/io";
import { usePersistentVisibility } from "../lib/columns";
import { AddPurchaseForm } from "../components/AddPurchaseForm";
import { Button, DangerButton } from "../components/Button";
import { Input } from "../components/Input";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";
import { ColumnToggle } from "../components/ColumnToggle";

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

  const [exact, setExact] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [produk, setProduk] = useState("");

  function addItems(items: PurchaseItem[]) {
    for (const item of items) addPurchase(item);
  }
  function removeItem(id: string) {
    deletePurchase(id);
  }
  function clearFilters() {
    setExact("");
    setFrom("");
    setTo("");
    setProduk("");
  }

  async function doImport() {
    try {
      const text = await pickJSONFile();
      const imported = parsePurchases(text);
      if (
        !confirm(
          `Impor ${imported.length} item? Ini akan mengganti data saat ini.`,
        )
      )
        return;
      setPurchases(imported);
    } catch (e) {
      alert("Gagal impor: " + (e as Error).message);
    }
  }

  const filtered = useMemo(() => {
    const q = produk.trim().toLowerCase();
    return purchases.filter((o) => {
      if (exact && o.tanggal !== exact) return false;
      if (!exact) {
        if (from && o.tanggal < from) return false;
        if (to && o.tanggal > to) return false;
      }
      if (q && !o.namaProduk.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [purchases, exact, from, to, produk]);

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
          total: items.reduce((s, i) => s + i.totalHarga, 0),
        };
      });
  }, [filtered]);

  const grandTotal = filtered.reduce((s, i) => s + i.totalHarga, 0);
  const hasFilter = exact || from || to || produk;

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

      <Panel>
        <div className="flex gap-3 flex-wrap items-end">
          <Field label="Tanggal spesifik" className="w-36">
            <Input
              type="date"
              value={exact}
              onChange={(e) => setExact(e.target.value)}
            />
          </Field>
          <Field label="Dari tanggal" className="w-36">
            <Input
              type="date"
              value={from}
              disabled={!!exact}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="Sampai tanggal" className="w-36">
            <Input
              type="date"
              value={to}
              disabled={!!exact}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label="Cari produk" className="flex-1 min-w-[160px]">
            <Input
              value={produk}
              onChange={(e) => setProduk(e.target.value)}
              placeholder="Nama produk…"
            />
          </Field>
          {hasFilter && <Button onClick={clearFilters}>Reset</Button>}
        </div>
      </Panel>

      <Panel>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <span className="text-lg font-bold">
            Total: {formatRupiah(grandTotal)}
          </span>
          <span className="text-slate-400">· {filtered.length} item</span>
          <span className="flex-1" />
          <ColumnToggle columns={COLUMNS} visible={visible} onToggle={toggle} />
          <Button onClick={doImport}>Impor JSON</Button>
          <Button
            onClick={() =>
              downloadJSON("beli-stok.json", serializePurchases(purchases))
            }
          >
            Ekspor JSON
          </Button>
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
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function GroupRows({
  group,
  visible,
  onRemove,
}: {
  group: DateGroup;
  visible: Record<string, boolean>;
  onRemove: (id: string) => void;
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
                it.namaProduk
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
