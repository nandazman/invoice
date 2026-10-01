import { useMemo, useState } from "react";
import type { Product, StockMovement, StockReason } from "../lib/types";
import { formatRupiah, todayISO, uid, nowISO } from "../lib/format";
import { Button, PrimaryButton, DangerGhostButton } from "./Button";
import { Input } from "./Input";
import { Select } from "./Select";
import { Modal } from "./Modal";
import { Field } from "./Field";
import { CloseIcon, TrashIcon } from "./icons";

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
// Purchases are always valued at the product's Harga Dasar (no manual cost).
interface Row {
  uid: string;
  tanggal: string;
  productId: string;
  reason: StockReason;
  unitIdx: number;
  kuantitas: string;
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
    note: "",
  };
}

function DialogHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center mb-4">
      <h2 className="text-lg font-bold flex-1">{title}</h2>
      <DangerGhostButton
        onClick={onClose}
        aria-label="Tutup"
        title="Tutup"
        className="hover:!bg-surface-hover hover:!text-body"
      >
        <CloseIcon />
      </DangerGhostButton>
    </div>
  );
}

interface Props {
  products: Product[];
  onAdd: (movements: StockMovement[]) => void;
  onClose: () => void;
}

// The Add dialog: same shape as Pesanan's. Many rows, one Simpan.
export function AddMovementForm({ products, onAdd, onClose }: Props) {
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

  function selectProduct(id: string, productId: string) {
    patchRow(id, { productId, unitIdx: 0 });
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
      hargaModal: isIn ? product.hargaDasar : null,
      orderId: null,
      purchaseId: null,
      note: r.note.trim(),
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
      .filter(Boolean) as StockMovement[];
    if (items.length === 0) return;
    onAdd(items);
    onClose();
  }

  return (
    <Modal
      onClose={onClose}
      closeOnOverlay={false}
      className="bg-surface p-4 md:p-5 w-full max-w-3xl overflow-auto"
    >
      <DialogHeader title="Catat pergerakan stok" onClose={onClose} />

      <div className="flex flex-col gap-3">
        {rows.map((r, n) => {
          const product = sorted.find((p) => p.id === r.productId) ?? null;
          const units = product ? unitOptions(product) : [];
          const unit = units[r.unitIdx] ?? units[0];
          const qtyNum = Number(r.kuantitas) || 0;
          const isIn = IN_REASONS.includes(r.reason);
          const baseQty = unit ? qtyNum * unit.faktor : 0;
          return (
            <div
              key={r.uid}
              className={`relative rounded-lg border bg-surface p-3 pt-8 ${
                isInvalid(r) ? "border-danger-line" : "border-line"
              }`}
            >
              <span className="absolute top-2 left-3 text-sm font-bold">
                Item {n + 1}
              </span>
              <DangerGhostButton
                size="sm"
                onClick={() => removeRow(r.uid)}
                title="Hapus item"
                aria-label={`Hapus item ${n + 1}`}
                className="!absolute top-1 right-1"
              >
                <TrashIcon />
              </DangerGhostButton>

              <div className="grid grid-cols-2 md:grid-cols-[9rem_1fr_13rem] gap-2">
                <Field label="Tanggal" className="col-span-1">
                  <Input
                    type="date"
                    value={r.tanggal}
                    onChange={(e) => patchRow(r.uid, { tanggal: e.target.value })}
                  />
                </Field>
                <Field label="Produk" className="col-span-2 md:col-span-1">
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
                <Field label="Jenis" className="col-span-2 md:col-span-1">
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
              </div>

              <div className="grid grid-cols-2 md:grid-cols-[1fr_6rem_1fr] gap-2 mt-2">
                <Field label="Satuan / Konversi" className="col-span-2 md:col-span-1">
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
                <Field label="Qty" className="col-span-2 md:col-span-1">
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
                <Field label="Catatan" className="col-span-2 md:col-span-1">
                  <Input
                    value={r.note}
                    onChange={(e) => patchRow(r.uid, { note: e.target.value })}
                    placeholder="opsional"
                  />
                </Field>
              </div>

              {product && qtyNum > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-sm text-faint">
                  <span>
                    {isIn ? "Menambah" : "Mengurangi"}{" "}
                    <b className="text-body">
                      {baseQty} {product.satuan ?? "satuan"}
                    </b>
                  </span>
                  <span className="flex-1" />
                  {isIn && (
                    <span title="Otomatis dari Harga Dasar produk">
                      Total (modal){" "}
                      <b className="text-body text-base tabular-nums">
                        {formatRupiah(baseQty * product.hargaDasar)}
                      </b>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Button onClick={addRow}>+ Tambah item</Button>
        <span className="flex-1" />
        <Button onClick={onClose}>Batal</Button>
        <PrimaryButton onClick={commit} disabled={validCount === 0}>
          Simpan{validCount > 1 ? ` (${validCount})` : ""}
        </PrimaryButton>
      </div>
    </Modal>
  );
}
