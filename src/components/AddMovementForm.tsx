import { useEffect, useMemo, useState } from "react";
import type { Product, StockMovement, StockReason } from "../lib/types";
import { todayISO, uid, nowISO, formatRupiah, formatAngka } from "../lib/format";
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

interface Props {
  products: Product[];
  onAdd: (movements: StockMovement[]) => void;
}

export function AddMovementForm({ products, onAdd }: Props) {
  const sorted = useMemo(
    () => [...products].sort((a, b) => a.namaProduk.localeCompare(b.namaProduk)),
    [products],
  );
  const [tanggal, setTanggal] = useState(todayISO());
  const [productId, setProductId] = useState("");
  const [reason, setReason] = useState<StockReason>("purchase");
  const [unitIdx, setUnitIdx] = useState(0);
  const [kuantitas, setKuantitas] = useState("1");
  const [hargaModal, setHargaModal] = useState("");
  const [editCost, setEditCost] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<StockMovement[]>([]);

  const product = sorted.find((p) => p.id === productId) ?? null;
  const units = product ? unitOptions(product) : [];
  const unit = units[unitIdx] ?? units[0];
  const qtyNum = Number(kuantitas) || 0;
  const isIn = IN_REASONS.includes(reason);
  const baseQty = unit ? qtyNum * unit.faktor : 0;

  // Cost defaults to the product's Harga Dasar and stays locked until the user
  // explicitly chooses to override it via the ✎ button.
  useEffect(() => {
    setEditCost(false);
    setHargaModal(product ? String(product.hargaDasar) : "");
  }, [product]);

  const nameById = useMemo(
    () => new Map(products.map((p) => [p.id, p.namaProduk])),
    [products],
  );

  function buildCurrent(): StockMovement | null {
    if (!product || !unit) {
      alert("Pilih produk dahulu.");
      return null;
    }
    if (qtyNum <= 0) {
      alert("Kuantitas harus lebih dari 0.");
      return null;
    }
    const now = nowISO();
    const signedBase = isIn ? Math.abs(baseQty) : -Math.abs(baseQty);
    return {
      id: uid(),
      productId: product.id,
      tanggal,
      qty: signedBase,
      satuan: product.satuan ?? "",
      reason,
      hargaModal: isIn ? Number(hargaModal) || 0 : null,
      orderId: null,
      note: note.trim(),
      createdAt: now,
      updatedAt: now,
    };
  }

  function resetLine() {
    setKuantitas("1");
    setNote("");
  }

  function addToList() {
    const m = buildCurrent();
    if (!m) return;
    setPending((prev) => [...prev, m]);
    resetLine();
  }

  function removePending(id: string) {
    setPending((prev) => prev.filter((m) => m.id !== id));
  }

  function commit() {
    const items = pending.length > 0 ? pending : ([buildCurrent()].filter(Boolean) as StockMovement[]);
    if (items.length === 0) return;
    onAdd(items);
    setPending([]);
    resetLine();
  }

  const saveCount = pending.length || 1;

  return (
    <Panel>
      <strong className="text-slate-700">Catat Pergerakan Stok</strong>
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
        <Field label="Jenis" className="flex-1 min-w-[170px]">
          <Select
            value={reason}
            onChange={(e) => setReason(e.target.value as StockReason)}
          >
            {(Object.keys(REASON_LABEL) as StockReason[]).map((r) => (
              <option key={r} value={r}>
                {REASON_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Satuan / Konversi" className="flex-[1.3] min-w-[150px]">
          <Select
            value={unitIdx}
            onChange={(e) => setUnitIdx(Number(e.target.value))}
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
            value={kuantitas}
            onChange={(e) => setKuantitas(e.target.value)}
          />
        </Field>
        {isIn && (
          <Field label="Harga modal /satuan" className="w-44">
            <div className="flex gap-1">
              <Input
                type="number"
                min="0"
                step="any"
                value={hargaModal}
                onChange={(e) => setHargaModal(e.target.value)}
                readOnly={!editCost}
                className={!editCost ? "bg-slate-50 text-slate-500" : ""}
                title={editCost ? "" : "Default dari Harga Dasar produk"}
              />
              <GhostButton
                onClick={() => setEditCost((v) => !v)}
                title={editCost ? "Kunci ke Harga Dasar" : "Ubah harga manual"}
                className="shrink-0"
              >
                {editCost ? "🔓" : "✎"}
              </GhostButton>
            </div>
          </Field>
        )}
        <Field label="Catatan" className="flex-1 min-w-[120px]">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="opsional"
          />
        </Field>
      </div>

      <div className="flex gap-2 items-center mt-3">
        <Button onClick={addToList}>+ Tambah ke daftar</Button>
        <PrimaryButton onClick={commit}>
          Simpan {saveCount > 1 ? `(${saveCount})` : ""}
        </PrimaryButton>
        {product && qtyNum > 0 && (
          <span className="text-xs text-slate-500">
            {isIn ? "Menambah" : "Mengurangi"} <b>{product.namaProduk}</b>:{" "}
            <b>
              {baseQty} {product.satuan ?? "satuan"}
            </b>
          </span>
        )}
      </div>

      {pending.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold text-slate-500 mb-2">
            Daftar ({pending.length})
          </div>
          <div className="flex flex-col gap-1">
            {pending.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-2.5 py-1.5"
              >
                <span
                  className={`font-semibold tabular-nums w-16 ${
                    m.qty < 0 ? "text-red-600" : "text-emerald-600"
                  }`}
                >
                  {m.qty > 0 ? `+${formatAngka(m.qty)}` : formatAngka(m.qty)}
                </span>
                <span className="flex-1 min-w-0 truncate">
                  {nameById.get(m.productId) ?? "—"} · {REASON_LABEL[m.reason]}
                  {m.hargaModal != null && ` · ${formatRupiah(m.hargaModal)}`}
                </span>
                <GhostButton
                  size="sm"
                  onClick={() => removePending(m.id)}
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
