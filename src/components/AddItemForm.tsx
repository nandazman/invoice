import { useMemo, useState } from "react";
import type { Product, OrderItem } from "../lib/types";
import { formatRupiah, todayISO, uid, nowISO } from "../lib/format";
import { Button, PrimaryButton, GhostButton } from "./Button";
import { Input } from "./Input";
import { Select } from "./Select";
import { Panel } from "./Panel";
import { Field } from "./Field";

interface UnitOption {
  label: string; // displayed unit name
  harga: number; // price per this unit
}

function unitOptions(p: Product): UnitOption[] {
  const base: UnitOption = {
    label: p.satuan ? `${p.satuan} (satuan)` : "satuan",
    harga: p.hargaJual,
  };
  const conv = p.konversi.map((k) => ({
    label: `${k.nama} (= ${k.jumlah} satuan)`,
    harga: k.harga,
  }));
  return [base, ...conv];
}

interface Props {
  products: Product[];
  onAdd: (items: OrderItem[]) => void;
}

export function AddItemForm({ products, onAdd }: Props) {
  const sorted = useMemo(
    () => [...products].sort((a, b) => a.namaProduk.localeCompare(b.namaProduk)),
    [products],
  );
  const [tanggal, setTanggal] = useState(todayISO());
  const [productId, setProductId] = useState("");
  const [unitIdx, setUnitIdx] = useState(0);
  const [kuantitas, setKuantitas] = useState("1");
  const [affectsStock, setAffectsStock] = useState(false);
  const [pending, setPending] = useState<OrderItem[]>([]);

  const product = sorted.find((p) => p.id === productId) ?? null;
  const units = product ? unitOptions(product) : [];
  const unit = units[unitIdx] ?? units[0];
  const qtyNum = Number(kuantitas) || 0;
  const total = unit ? qtyNum * unit.harga : 0;

  function buildCurrent(): OrderItem | null {
    if (!product || !unit) {
      alert("Pilih produk dahulu.");
      return null;
    }
    if (qtyNum <= 0) {
      alert("Kuantitas harus lebih dari 0.");
      return null;
    }
    const cleanUnit = unit.label.replace(/\s*\(.*\)\s*$/, "").trim();
    const now = nowISO();
    return {
      id: uid(),
      tanggal,
      namaProduk: product.namaProduk,
      satuan: cleanUnit,
      kuantitas: qtyNum,
      hargaSatuan: unit.harga,
      totalHarga: total,
      status: "pending",
      affectsStock,
      createdAt: now,
      updatedAt: now,
    };
  }

  function addToList() {
    const it = buildCurrent();
    if (!it) return;
    setPending((prev) => [...prev, it]);
    setKuantitas("1");
  }

  function removePending(id: string) {
    setPending((prev) => prev.filter((i) => i.id !== id));
  }

  function commit() {
    const items = pending.length > 0 ? pending : ([buildCurrent()].filter(Boolean) as OrderItem[]);
    if (items.length === 0) return;
    onAdd(items);
    setPending([]);
    setKuantitas("1");
  }

  const saveCount = pending.length || 1;

  return (
    <Panel>
      <strong className="text-slate-700">Tambah Item</strong>
      <div className="flex gap-3 flex-wrap items-end mt-3">
        <Field label="Tanggal" className="w-36">
          <Input
            type="date"
            value={tanggal}
            onChange={(e) => setTanggal(e.target.value)}
          />
        </Field>
        <Field label="Produk" className="flex-[2] min-w-[200px]">
          <Select
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setUnitIdx(0);
            }}
          >
            <option value="">— pilih produk —</option>
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namaProduk}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Satuan / Konversi" className="flex-[1.5] min-w-[160px]">
          <Select
            value={unitIdx}
            onChange={(e) => setUnitIdx(Number(e.target.value))}
            disabled={!product}
          >
            {units.map((u, i) => (
              <option key={i} value={i}>
                {u.label} — {formatRupiah(u.harga)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Qty" className="w-24">
          <Input
            type="number"
            min="0"
            step="any"
            value={kuantitas}
            onChange={(e) => setKuantitas(e.target.value)}
          />
        </Field>
        <Field label="Total" className="w-36">
          <Input
            className="font-semibold"
            value={formatRupiah(total)}
            readOnly
            tabIndex={-1}
          />
        </Field>
      </div>

      <div className="flex gap-3 flex-wrap items-center mt-3">
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={affectsStock}
            onChange={(e) => setAffectsStock(e.target.checked)}
            className="w-4 h-4 accent-blue-600 cursor-pointer"
          />
          Tambah ke stok saat disimpan
        </label>
        <span className="flex-1" />
        <Button onClick={addToList}>+ Tambah ke daftar</Button>
        <PrimaryButton onClick={commit}>
          Simpan {saveCount > 1 ? `(${saveCount})` : ""}
        </PrimaryButton>
      </div>

      {pending.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold text-slate-500 mb-2">
            Daftar ({pending.length})
          </div>
          <div className="flex flex-col gap-1">
            {pending.map((it) => (
              <div
                key={it.id}
                className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-2.5 py-1.5"
              >
                <span className="flex-1 min-w-0 truncate">
                  {it.namaProduk} · {it.kuantitas} {it.satuan}
                  {it.affectsStock && (
                    <span className="ml-1 text-xs text-emerald-600 font-semibold">
                      +stok
                    </span>
                  )}
                </span>
                <span className="tabular-nums font-semibold">
                  {formatRupiah(it.totalHarga)}
                </span>
                <GhostButton
                  size="sm"
                  onClick={() => removePending(it.id)}
                  title="Hapus dari daftar"
                >
                  ✕
                </GhostButton>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
