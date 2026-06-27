import { useMemo, useState } from "react";
import type { OrderItem } from "../lib/types";
import { useProducts, useOrders, setOrders } from "../lib/store";
import { formatRupiah, formatAngka, formatTanggalID } from "../lib/format";
import {
  serializeOrders,
  parseOrders,
  downloadJSON,
  pickJSONFile,
} from "../lib/io";
import { AddItemForm } from "../components/AddItemForm";
import { Button, DangerButton } from "../components/Button";
import { Input } from "../components/Input";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";

interface DateGroup {
  tanggal: string;
  items: OrderItem[];
  total: number;
}

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

export function OrdersPage() {
  const products = useProducts();
  const orders = useOrders();

  const [exact, setExact] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [produk, setProduk] = useState("");

  function addItem(item: OrderItem) {
    setOrders([...orders, item]);
  }
  function removeItem(id: string) {
    setOrders(orders.filter((o) => o.id !== id));
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
      const imported = parseOrders(text);
      if (
        !confirm(
          `Impor ${imported.length} item? Ini akan mengganti riwayat saat ini.`,
        )
      )
        return;
      setOrders(imported);
    } catch (e) {
      alert("Gagal impor: " + (e as Error).message);
    }
  }

  const filtered = useMemo(() => {
    const q = produk.trim().toLowerCase();
    return orders.filter((o) => {
      if (exact && o.tanggal !== exact) return false;
      if (!exact) {
        if (from && o.tanggal < from) return false;
        if (to && o.tanggal > to) return false;
      }
      if (q && !o.namaProduk.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [orders, exact, from, to, produk]);

  const groups = useMemo<DateGroup[]>(() => {
    const byDate = new Map<string, OrderItem[]>();
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
      <h1 className="text-2xl font-bold mb-1">Pesanan</h1>
      <p className="text-slate-500 mb-4">
        Tambah item dari daftar harga, lihat riwayat per tanggal.
      </p>

      {products.length === 0 ? (
        <Panel className="text-center text-slate-400 py-8">
          Belum ada produk. Tambahkan produk di halaman <b>Harga</b> dulu.
        </Panel>
      ) : (
        <AddItemForm products={products} onAdd={addItem} />
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
          <Button onClick={doImport}>Impor JSON</Button>
          <Button
            onClick={() => downloadJSON("order.json", serializeOrders(orders))}
          >
            Ekspor JSON
          </Button>
        </div>

        {groups.length === 0 ? (
          <div className="text-center text-slate-400 py-8">
            {hasFilter
              ? "Tidak ada item cocok dengan filter."
              : "Belum ada pesanan."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Produk</th>
                  <th className={thClass}>Satuan</th>
                  <th className={`${thClass} text-right`}>Qty</th>
                  <th className={`${thClass} text-right`}>Harga Satuan</th>
                  <th className={`${thClass} text-right`}>Total</th>
                  <th className={thClass}></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows key={g.tanggal} group={g} onRemove={removeItem} />
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
  onRemove,
}: {
  group: DateGroup;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      <tr className="bg-slate-100 font-bold">
        <td className={`${tdClass} font-bold`} colSpan={4}>
          {formatTanggalID(group.tanggal)}
        </td>
        <td className={`${tdClass} text-right font-bold tabular-nums`}>
          {formatRupiah(group.total)}
        </td>
        <td className={tdClass}></td>
      </tr>
      {group.items.map((it) => (
        <tr key={it.id} className="hover:bg-slate-50">
          <td className={tdClass}>{it.namaProduk}</td>
          <td className={tdClass}>{it.satuan}</td>
          <td className={`${tdClass} text-right tabular-nums`}>
            {formatAngka(it.kuantitas)}
          </td>
          <td className={`${tdClass} text-right tabular-nums`}>
            {formatRupiah(it.hargaSatuan)}
          </td>
          <td className={`${tdClass} text-right tabular-nums`}>
            {formatRupiah(it.totalHarga)}
          </td>
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
