import { useMemo, useState } from "react";
import type { Product, OrderItem } from "../lib/types";
import { formatRupiah, todayISO, uid, nowISO } from "../lib/format";
import { PrimaryButton } from "./Button";
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
  onAdd: (item: OrderItem) => void;
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

  const product = sorted.find((p) => p.id === productId) ?? null;
  const units = product ? unitOptions(product) : [];
  const unit = units[unitIdx] ?? units[0];
  const qtyNum = Number(kuantitas) || 0;
  const total = unit ? qtyNum * unit.harga : 0;

  function submit() {
    if (!product || !unit) {
      alert("Pilih produk dahulu.");
      return;
    }
    if (qtyNum <= 0) {
      alert("Kuantitas harus lebih dari 0.");
      return;
    }
    const cleanUnit = unit.label.replace(/\s*\(.*\)\s*$/, "").trim();
    const now = nowISO();
    onAdd({
      id: uid(),
      tanggal,
      namaProduk: product.namaProduk,
      satuan: cleanUnit,
      kuantitas: qtyNum,
      hargaSatuan: unit.harga,
      totalHarga: total,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    setKuantitas("1");
  }

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
        <PrimaryButton onClick={submit}>+ Tambah</PrimaryButton>
      </div>
    </Panel>
  );
}
