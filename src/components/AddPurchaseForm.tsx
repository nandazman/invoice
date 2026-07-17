import { useMemo, useState } from "react";
import type { Product, PurchaseItem } from "../lib/types";
import { formatRupiah, todayISO, uid, nowISO } from "../lib/format";
import { Button, PrimaryButton, GhostButton } from "./Button";
import { Input } from "./Input";
import { Select } from "./Select";
import { Panel } from "./Panel";
import { Field } from "./Field";

interface UnitOption {
  label: string; // displayed unit name
  jumlah: number; // base units per this unit
  harga: number; // default cost per this unit (from hargaDasar/modal)
}

function unitOptions(p: Product): UnitOption[] {
  const base: UnitOption = {
    label: p.satuan ? `${p.satuan} (satuan)` : "satuan",
    jumlah: 1,
    harga: p.hargaDasar,
  };
  const conv = p.konversi.map((k) => ({
    label: `${k.nama} (= ${k.jumlah} satuan)`,
    jumlah: k.jumlah,
    // Product carries no per-konversi modal, so default to hargaDasar × jumlah.
    harga: p.hargaDasar * k.jumlah,
  }));
  return [base, ...conv];
}

// One editable row of the form. Keyed by an ephemeral uid that is NOT persisted.
interface Row {
  uid: string;
  tanggal: string;
  productId: string;
  unitIdx: number;
  kuantitas: string;
  harga: string; // editable cost per chosen unit ("" = use unit default)
}

function emptyRow(): Row {
  return {
    uid: uid(),
    tanggal: todayISO(),
    productId: "",
    unitIdx: 0,
    kuantitas: "1",
    harga: "",
  };
}

interface Props {
  products: Product[];
  onAdd: (items: PurchaseItem[]) => void;
}

export function AddPurchaseForm({ products, onAdd }: Props) {
  const sorted = useMemo(
    () => [...products].sort((a, b) => a.namaProduk.localeCompare(b.namaProduk)),
    [products],
  );
  const [rows, setRows] = useState<Row[]>(() => [emptyRow()]);

  function patchRow(id: string, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => (r.uid === id ? { ...r, ...patch } : r)),
    );
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(id: string) {
    setRows((prev) => {
      const next = prev.filter((r) => r.uid !== id);
      // Never leave the form with zero rows.
      return next.length > 0 ? next : [emptyRow()];
    });
  }

  // The effective cost per chosen unit: the edited value, else the unit default.
  function unitPrice(r: Row, unit: UnitOption | undefined): number {
    if (r.harga.trim() !== "") return Number(r.harga) || 0;
    return unit ? unit.harga : 0;
  }

  // A row with no product AND default/empty qty is "blank" → skipped silently.
  function isBlank(r: Row): boolean {
    return !r.productId && (r.kuantitas === "" || r.kuantitas === "1");
  }

  // A row that has a product but qty <= 0 is invalid → highlighted, blocks save.
  function isInvalid(r: Row): boolean {
    if (isBlank(r)) return false;
    return !r.productId || (Number(r.kuantitas) || 0) <= 0;
  }

  function buildRow(r: Row): PurchaseItem | null {
    const product = sorted.find((p) => p.id === r.productId) ?? null;
    if (!product) return null;
    const units = unitOptions(product);
    const unit = units[r.unitIdx] ?? units[0];
    const qtyNum = Number(r.kuantitas) || 0;
    if (!unit || qtyNum <= 0) return null;
    const harga = unitPrice(r, unit);
    const cleanUnit = unit.label.replace(/\s*\(.*\)\s*$/, "").trim();
    const now = nowISO();
    return {
      id: uid(),
      tanggal: r.tanggal,
      productId: product.id,
      namaProduk: product.namaProduk,
      satuan: cleanUnit,
      kuantitas: qtyNum,
      hargaSatuan: harga,
      totalHarga: qtyNum * harga,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  }

  const validCount = rows.filter((r) => !isBlank(r) && !isInvalid(r)).length;

  function commit() {
    // Block the save if any row is invalid; keep rows as-is so it can be fixed.
    if (rows.some(isInvalid)) return;
    const items = rows
      .filter((r) => !isBlank(r))
      .map(buildRow)
      .filter(Boolean) as PurchaseItem[];
    if (items.length === 0) return;
    onAdd(items);
    setRows([emptyRow()]);
  }

  return (
    <Panel>
      <strong className="text-slate-700">Tambah Pembelian</strong>

      <div className="flex flex-col gap-2 mt-3">
        {rows.map((r) => {
          const product = sorted.find((p) => p.id === r.productId) ?? null;
          const units = product ? unitOptions(product) : [];
          const unit = units[r.unitIdx] ?? units[0];
          const qtyNum = Number(r.kuantitas) || 0;
          const harga = unitPrice(r, unit);
          const total = qtyNum * harga;
          const invalid = isInvalid(r);
          return (
            <div
              key={r.uid}
              className={`rounded-lg border border-slate-100 bg-slate-50/40 ${
                invalid ? "ring-1 ring-red-400" : ""
              }`}
            >
              <div className="flex flex-wrap gap-3 items-end p-2">
                <Field label="Tanggal" className="w-36">
                  <Input
                    type="date"
                    value={r.tanggal}
                    onChange={(e) => patchRow(r.uid, { tanggal: e.target.value })}
                  />
                </Field>
                <Field label="Produk" className="w-56">
                  <Select
                    value={r.productId}
                    onChange={(e) =>
                      // Reset unit + custom price when the product changes.
                      patchRow(r.uid, {
                        productId: e.target.value,
                        unitIdx: 0,
                        harga: "",
                      })
                    }
                  >
                    <option value="">— pilih produk —</option>
                    {sorted.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.namaProduk}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Satuan / Konversi" className="w-52">
                  <Select
                    value={r.unitIdx}
                    onChange={(e) =>
                      // Switching unit clears the custom price so the new default shows.
                      patchRow(r.uid, {
                        unitIdx: Number(e.target.value),
                        harga: "",
                      })
                    }
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
                    value={r.kuantitas}
                    onChange={(e) =>
                      patchRow(r.uid, { kuantitas: e.target.value })
                    }
                  />
                </Field>
                <Field label="Harga Satuan" className="w-36">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={r.harga}
                    placeholder={unit ? String(unit.harga) : ""}
                    disabled={!product}
                    onChange={(e) => patchRow(r.uid, { harga: e.target.value })}
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
                <GhostButton
                  onClick={() => removeRow(r.uid)}
                  title="Hapus baris"
                  className="shrink-0 mb-0.5"
                >
                  ✕
                </GhostButton>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <Button onClick={addRow}>+ Tambah baris</Button>
        <span className="flex-1" />
        <PrimaryButton onClick={commit} disabled={validCount === 0}>
          Simpan {validCount > 1 ? `(${validCount})` : ""}
        </PrimaryButton>
      </div>
    </Panel>
  );
}
