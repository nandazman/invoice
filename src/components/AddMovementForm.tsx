import { useMemo, useState } from "react";
import type { Product, StockMovement, StockReason } from "../lib/types";
import { todayISO, uid, nowISO } from "../lib/format";
import { Button, PrimaryButton, GhostButton } from "./Button";
import { Input } from "./Input";
import { Select } from "./Select";
import { Panel } from "./Panel";
import { Field } from "./Field";

interface UnitOption {
  label: string; // displayed unit name
  faktor: number; // base units per one of this unit
}

function unitOptions(p: Product): UnitOption[] {
  const base: UnitOption = {
    label: p.satuan ? `${p.satuan} (satuan)` : "satuan",
    faktor: 1,
  };
  const conv = p.konversi.map((k) => ({
    label: `${k.nama} (= ${k.jumlah} satuan)`,
    faktor: k.jumlah,
  }));
  return [base, ...conv];
}

// purchase/return bring stock in (+), sale/adjustment take it out (−).
const IN_REASONS: StockReason[] = ["purchase", "return"];

const REASON_LABEL: Record<StockReason, string> = {
  purchase: "Pembelian (masuk)",
  return: "Retur (masuk)",
  sale: "Penjualan (keluar)",
  adjustment: "Penyesuaian (keluar)",
};

// One editable row of the form. Keyed by an ephemeral uid that is NOT persisted.
interface Row {
  uid: string;
  tanggal: string;
  productId: string;
  reason: StockReason;
  unitIdx: number;
  kuantitas: string;
  hargaModal: string;
  editCost: boolean; // false = locked to the product's Harga Dasar
  note: string;
}

function emptyRow(): Row {
  return {
    uid: uid(),
    tanggal: todayISO(),
    productId: "",
    reason: "purchase",
    unitIdx: 0,
    kuantitas: "1",
    hargaModal: "",
    editCost: false,
    note: "",
  };
}

interface Props {
  products: Product[];
  onAdd: (movements: StockMovement[]) => void;
}

export function AddMovementForm({ products, onAdd }: Props) {
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

  // When the product changes, cost defaults back to the product's Harga Dasar
  // and stays locked until the user hits ✎.
  function selectProduct(id: string, productId: string) {
    const product = sorted.find((p) => p.id === productId) ?? null;
    patchRow(id, {
      productId,
      unitIdx: 0,
      editCost: false,
      hargaModal: product ? String(product.hargaDasar) : "",
    });
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

  // A row with no product AND default/empty qty is "blank" → skipped silently.
  function isBlank(r: Row): boolean {
    return !r.productId && (r.kuantitas === "" || r.kuantitas === "1");
  }

  // A row that has a product but qty <= 0 is invalid → highlighted, blocks save.
  function isInvalid(r: Row): boolean {
    if (isBlank(r)) return false;
    return !r.productId || (Number(r.kuantitas) || 0) <= 0;
  }

  function buildRow(r: Row): StockMovement | null {
    const product = sorted.find((p) => p.id === r.productId) ?? null;
    if (!product) return null;
    const units = unitOptions(product);
    const unit = units[r.unitIdx] ?? units[0];
    const qtyNum = Number(r.kuantitas) || 0;
    if (!unit || qtyNum <= 0) return null;
    const isIn = IN_REASONS.includes(r.reason);
    const baseQty = qtyNum * unit.faktor;
    const signedBase = isIn ? Math.abs(baseQty) : -Math.abs(baseQty);
    const now = nowISO();
    return {
      id: uid(),
      productId: product.id,
      tanggal: r.tanggal,
      qty: signedBase,
      satuan: product.satuan ?? "",
      reason: r.reason,
      hargaModal: isIn ? Number(r.hargaModal) || 0 : null,
      orderId: null,
      note: r.note.trim(),
      createdAt: now,
      updatedAt: now,
    };
  }

  const validCount = rows.filter((r) => !isBlank(r) && !isInvalid(r)).length;

  function commit() {
    // Block the save if any row is invalid; keep rows as-is so it can be fixed.
    if (rows.some(isInvalid)) return;
    const items = rows
      .filter((r) => !isBlank(r))
      .map(buildRow)
      .filter(Boolean) as StockMovement[];
    if (items.length === 0) return;
    onAdd(items);
    setRows([emptyRow()]);
  }

  return (
    <Panel>
      <strong className="text-slate-700">Catat Pergerakan Stok</strong>

      <div className="flex flex-col gap-2 mt-3">
        {rows.map((r) => {
          const product = sorted.find((p) => p.id === r.productId) ?? null;
          const units = product ? unitOptions(product) : [];
          const unit = units[r.unitIdx] ?? units[0];
          const qtyNum = Number(r.kuantitas) || 0;
          const isIn = IN_REASONS.includes(r.reason);
          const baseQty = unit ? qtyNum * unit.faktor : 0;
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
                    onChange={(e) => selectProduct(r.uid, e.target.value)}
                  >
                    <option value="">— pilih produk —</option>
                    {sorted.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.namaProduk}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Jenis" className="w-48">
                  <Select
                    value={r.reason}
                    onChange={(e) =>
                      patchRow(r.uid, { reason: e.target.value as StockReason })
                    }
                  >
                    {(Object.keys(REASON_LABEL) as StockReason[]).map((rr) => (
                      <option key={rr} value={rr}>
                        {REASON_LABEL[rr]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Satuan / Konversi" className="w-48">
                  <Select
                    value={r.unitIdx}
                    onChange={(e) =>
                      patchRow(r.uid, { unitIdx: Number(e.target.value) })
                    }
                    disabled={!product}
                  >
                    {units.map((u, i) => (
                      <option key={i} value={i}>
                        {u.label}
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
                {isIn && (
                  <Field label="Harga modal /satuan" className="w-44">
                    <div className="flex gap-1">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={r.hargaModal}
                        onChange={(e) =>
                          patchRow(r.uid, { hargaModal: e.target.value })
                        }
                        readOnly={!r.editCost}
                        className={
                          !r.editCost ? "bg-slate-50 text-slate-500" : ""
                        }
                        title={r.editCost ? "" : "Default dari Harga Dasar produk"}
                      />
                      <GhostButton
                        onClick={() =>
                          patchRow(r.uid, { editCost: !r.editCost })
                        }
                        title={
                          r.editCost
                            ? "Kunci ke Harga Dasar"
                            : "Ubah harga manual"
                        }
                        className="shrink-0"
                      >
                        {r.editCost ? "🔓" : "✎"}
                      </GhostButton>
                    </div>
                  </Field>
                )}
                <Field label="Catatan" className="w-40">
                  <Input
                    value={r.note}
                    onChange={(e) => patchRow(r.uid, { note: e.target.value })}
                    placeholder="opsional"
                  />
                </Field>
                <div className="flex items-center h-9 shrink-0">
                  {product && qtyNum > 0 && (
                    <span className="text-xs text-slate-500 whitespace-nowrap mr-1">
                      {isIn ? "Menambah" : "Mengurangi"}{" "}
                      <b>
                        {baseQty} {product.satuan ?? "satuan"}
                      </b>
                    </span>
                  )}
                  <GhostButton
                    onClick={() => removeRow(r.uid)}
                    title="Hapus baris"
                    className="shrink-0"
                  >
                    ✕
                  </GhostButton>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <Button onClick={addRow}>+ Tambah item</Button>
        <span className="flex-1" />
        <PrimaryButton onClick={commit} disabled={validCount === 0}>
          Simpan {validCount > 1 ? `(${validCount})` : ""}
        </PrimaryButton>
      </div>
    </Panel>
  );
}
