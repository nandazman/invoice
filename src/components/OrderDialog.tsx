import { useMemo, useState } from "react";
import type { Product, OrderItem, OrderStatus, Buyer } from "../lib/types";
import { formatRupiah, formatAngka, todayISO, uid, nowISO } from "../lib/format";
import { useBuyers, upsertBuyer, previewOrderEdit } from "../lib/store";
import type { OrderEdit } from "../lib/orderEdit";
import { modalCostFor } from "../lib/purchaseFromOrder";
import { Button, PrimaryButton, DangerButton, DangerGhostButton } from "./Button";
import { Input } from "./Input";
import { Select } from "./Select";
import { Field } from "./Field";
import { BuyerSelect } from "./BuyerSelect";
import { Modal } from "./Modal";
import { CloseIcon, TrashIcon } from "./icons";

// One Add dialog, one Edit dialog, one set of fields. Add takes many rows (a
// customer rarely orders one thing); Edit takes the one order it was opened on.

interface UnitOption {
  nama: string; // the satuan label stored on the order
  label: string; // shown in the picker
  harga: number; // selling price per this unit
}

function unitOptions(p: Product): UnitOption[] {
  const base: UnitOption = {
    nama: p.satuan || "satuan",
    label: p.satuan ? `${p.satuan} (satuan)` : "satuan",
    harga: p.hargaJual,
  };
  const conv = p.konversi.map((k) => ({
    nama: k.nama,
    label: `${k.nama} (= ${k.jumlah} satuan)`,
    harga: k.harga,
  }));
  return [base, ...conv];
}

function newBuyer(nama: string): Buyer {
  const now = nowISO();
  return {
    id: uid(),
    nama: nama.trim(),
    telepon: "",
    email: "",
    alamat: "",
    catatan: "",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

function useSortedProducts(products: Product[]) {
  return useMemo(
    () => [...products].sort((a, b) => a.namaProduk.localeCompare(b.namaProduk)),
    [products],
  );
}

// What a new row does to stock. "beli" is the Beli Stok button's job done in the
// same step: buy at Harga Dasar, then the offsetting sale for this order.
export type StockMode = "none" | "kurangi" | "beli";

const STOCK_MODES: { id: StockMode; label: string }[] = [
  { id: "none", label: "Tidak ubah stok" },
  { id: "kurangi", label: "Kurangi stok" },
  { id: "beli", label: "Beli stok" },
];

function Segmented({
  value,
  onChange,
  name,
}: {
  value: StockMode;
  onChange: (m: StockMode) => void;
  name: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Stok"
      className="inline-flex rounded-lg border border-line-strong overflow-hidden"
    >
      {STOCK_MODES.map((m, i) => (
        <label
          key={m.id}
          className={`px-3 py-1.5 text-sm font-semibold cursor-pointer select-none has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-brand ${
            i > 0 ? "border-l border-line-strong" : ""
          } ${
            value === m.id
              ? "bg-brand-soft text-brand"
              : "bg-surface text-muted hover:bg-surface-hover"
          }`}
        >
          <input
            type="radio"
            name={name}
            className="sr-only"
            checked={value === m.id}
            onChange={() => onChange(m.id)}
          />
          {m.label}
        </label>
      ))}
    </div>
  );
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

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

interface AddRow {
  uid: string;
  tanggal: string;
  productId: string;
  unitIdx: number;
  kuantitas: string;
  stock: StockMode;
}

function emptyRow(): AddRow {
  return {
    uid: uid(),
    tanggal: todayISO(),
    productId: "",
    unitIdx: 0,
    kuantitas: "1",
    stock: "none",
  };
}

export interface NewOrder {
  order: OrderItem;
  // True when the order should be bought for stock too ("Beli stok").
  buyStock: boolean;
}

export function AddOrderDialog({
  products,
  buyerId,
  onBuyerChange,
  onSave,
  onClose,
}: {
  products: Product[];
  // Owned by the page so the buyer survives the dialog closing: consecutive
  // orders for one buyer are the common case.
  buyerId: string;
  onBuyerChange: (id: string) => void;
  onSave: (items: NewOrder[]) => void;
  onClose: () => void;
}) {
  const sorted = useSortedProducts(products);
  const buyers = useBuyers();
  const [rows, setRows] = useState<AddRow[]>(() => [emptyRow()]);

  function patchRow(id: string, patch: Partial<AddRow>) {
    setRows((prev) => prev.map((r) => (r.uid === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: string) {
    setRows((prev) => {
      const next = prev.filter((r) => r.uid !== id);
      // Never leave the dialog with zero rows.
      return next.length > 0 ? next : [emptyRow()];
    });
  }

  // No product and the untouched default qty: a blank row, skipped silently.
  const isBlank = (r: AddRow) =>
    !r.productId && (r.kuantitas === "" || r.kuantitas === "1");
  // A product with qty <= 0: highlighted, and it blocks the save.
  const isInvalid = (r: AddRow) =>
    !isBlank(r) && (!r.productId || (Number(r.kuantitas) || 0) <= 0);

  function build(r: AddRow): NewOrder | null {
    const product = sorted.find((p) => p.id === r.productId);
    if (!product) return null;
    const units = unitOptions(product);
    const unit = units[r.unitIdx] ?? units[0];
    const qty = Number(r.kuantitas) || 0;
    if (!unit || qty <= 0) return null;
    const now = nowISO();
    return {
      buyStock: r.stock === "beli",
      order: {
        id: uid(),
        tanggal: r.tanggal,
        productId: product.id,
        buyerId,
        namaProduk: product.namaProduk,
        satuan: unit.nama,
        kuantitas: qty,
        hargaSatuan: unit.harga,
        totalHarga: qty * unit.harga,
        status: "pending",
        affectsStock: r.stock === "kurangi",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    };
  }

  const validCount = rows.filter((r) => !isBlank(r) && !isInvalid(r)).length;

  function save() {
    // Pembeli is mandatory: nothing created here may add another buyer-less row.
    if (!buyerId || rows.some(isInvalid)) return;
    const items = rows
      .filter((r) => !isBlank(r))
      .map(build)
      .filter(Boolean) as NewOrder[];
    if (items.length === 0) return;
    onSave(items);
    onClose();
  }

  function createBuyer(nama: string) {
    const row = newBuyer(nama);
    upsertBuyer(row);
    onBuyerChange(row.id);
  }

  return (
    <Modal
      onClose={onClose}
      closeOnOverlay={false}
      className="bg-surface p-4 md:p-5 w-full max-w-3xl overflow-auto"
    >
      <DialogHeader title="Tambah pesanan" onClose={onClose} />

      <Field label="Pembeli" className="w-full md:w-72">
        <BuyerSelect
          value={buyerId}
          options={buyers}
          onChange={onBuyerChange}
          onCreate={createBuyer}
        />
      </Field>

      <div className="flex flex-col gap-3 mt-4">
        {rows.map((r, n) => {
          const product = sorted.find((p) => p.id === r.productId) ?? null;
          const units = product ? unitOptions(product) : [];
          const unit = units[r.unitIdx] ?? units[0];
          const total = unit ? (Number(r.kuantitas) || 0) * unit.harga : 0;
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

              <div className="grid grid-cols-2 md:grid-cols-[9rem_1fr_13rem_6rem] gap-2">
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
                    onChange={(e) =>
                      patchRow(r.uid, { productId: e.target.value, unitIdx: 0 })
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
                <Field label="Satuan" className="col-span-2 md:col-span-1">
                  <Select
                    value={r.unitIdx}
                    onChange={(e) =>
                      patchRow(r.uid, { unitIdx: Number(e.target.value) })
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
                <Field label="Qty" className="col-span-1">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={r.kuantitas}
                    onChange={(e) => patchRow(r.uid, { kuantitas: e.target.value })}
                  />
                </Field>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
                <Segmented
                  name={`stok-${r.uid}`}
                  value={r.stock}
                  onChange={(m) => patchRow(r.uid, { stock: m })}
                />
                <span className="flex-1" />
                <span className="text-sm text-faint">
                  Total{" "}
                  <b className="text-body text-base tabular-nums">
                    {formatRupiah(total)}
                  </b>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Button onClick={() => setRows((p) => [...p, emptyRow()])}>
          + Tambah item
        </Button>
        <span className="flex-1" />
        {/* Say WHY the button is dead: a disabled Simpan with a filled form and
            no explanation reads as a bug. */}
        {validCount > 0 && !buyerId && (
          <span className="text-sm text-danger">Pilih pembeli dulu.</span>
        )}
        <Button onClick={onClose}>Batal</Button>
        <PrimaryButton onClick={save} disabled={validCount === 0 || !buyerId}>
          Simpan{validCount > 1 ? ` (${validCount})` : ""}
        </PrimaryButton>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

function numOrNull(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function EditOrderDialog({
  order,
  products,
  hidden,
  onSave,
  onDelete,
  onClose,
}: {
  order: OrderItem;
  products: Product[];
  hidden: boolean;
  // `hidden` is the "Sembunyikan dari total" flag, which lives outside the order
  // (it is a per-device view preference, not data).
  onSave: (edit: Partial<OrderEdit>, hidden: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const sorted = useSortedProducts(products);
  const buyers = useBuyers();

  const [tanggal, setTanggal] = useState(order.tanggal);
  const [buyerId, setBuyerId] = useState(order.buyerId);
  const [productId, setProductId] = useState(order.productId);
  const [satuan, setSatuan] = useState(order.satuan);
  const [kuantitas, setKuantitas] = useState(String(order.kuantitas));
  const [harga, setHarga] = useState(String(order.hargaSatuan));
  const [modal, setModal] = useState(
    order.modalSatuan == null ? "" : String(order.modalSatuan),
  );
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [hide, setHide] = useState(hidden);
  const [confirm, setConfirm] = useState<Partial<OrderEdit> | null>(null);

  const product = sorted.find((p) => p.id === productId) ?? null;
  const units = product ? unitOptions(product) : [];

  // Picking a product or unit re-fills the two prices from the price list, since
  // keeping the old product's price on a new product is never what you want. Both
  // stay editable afterwards.
  function pick(p: Product | null, unitNama: string) {
    if (!p) return;
    const unit = unitOptions(p).find((u) => u.nama === unitNama) ?? unitOptions(p)[0];
    setSatuan(unit.nama);
    setHarga(String(unit.harga));
    setModal(p.hargaDasar > 0 ? String(modalCostFor(p, unit.nama)) : "");
  }

  const qtyNum = Number(kuantitas);
  const hargaNum = Number(harga);
  const errors = {
    tanggal: tanggal ? "" : "Wajib diisi",
    buyer: !buyerId && order.buyerId !== "" ? "Pilih pembeli" : "",
    kuantitas: qtyNum > 0 ? "" : "Harus lebih dari 0",
    harga: harga.trim() !== "" && hargaNum >= 0 ? "" : "Tidak valid",
    modal: modal.trim() === "" || (numOrNull(modal) ?? -1) >= 0 ? "" : "Tidak valid",
  };
  const valid = Object.values(errors).every((e) => !e);

  const edit: Partial<OrderEdit> = {
    tanggal,
    buyerId,
    productId,
    namaProduk: product?.namaProduk ?? order.namaProduk,
    satuan,
    kuantitas: qtyNum,
    hargaSatuan: hargaNum,
    modalSatuan: numOrNull(modal),
    status,
  };

  function submit() {
    if (!valid) return;
    const plan = previewOrderEdit(order.id, edit);
    if (plan && plan.moves.length > 0) {
      setConfirm(edit);
      return;
    }
    commit(edit);
  }
  function commit(e: Partial<OrderEdit>) {
    onSave(e, hide);
    onClose();
  }

  const plan = confirm ? previewOrderEdit(order.id, confirm) : null;

  return (
    <Modal
      onClose={onClose}
      closeOnOverlay={false}
      className="bg-surface p-4 md:p-5 w-full max-w-xl overflow-auto"
    >
      <DialogHeader title="Ubah pesanan" onClose={onClose} />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tanggal" error={errors.tanggal}>
          <Input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
          </Select>
        </Field>

        <Field label="Pembeli" className="col-span-2" error={errors.buyer}>
          <BuyerSelect
            value={buyerId}
            options={buyers}
            onChange={setBuyerId}
            onCreate={(nama) => {
              const row = newBuyer(nama);
              upsertBuyer(row);
              setBuyerId(row.id);
            }}
          />
        </Field>

        <Field label="Produk" className="col-span-2">
          <Select
            value={productId}
            onChange={(e) => {
              const p = sorted.find((x) => x.id === e.target.value) ?? null;
              setProductId(e.target.value);
              pick(p, "");
            }}
          >
            {!product && <option value={productId}>{order.namaProduk} (tak tertaut)</option>}
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namaProduk}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Satuan">
          {product ? (
            <Select
              value={satuan}
              onChange={(e) => pick(product, e.target.value)}
            >
              {/* A unit the product no longer offers must stay selectable, or
                  opening Edit would silently rewrite the sold unit. */}
              {!units.some((u) => u.nama === satuan) && (
                <option value={satuan}>{satuan}</option>
              )}
              {units.map((u) => (
                <option key={u.nama} value={u.nama}>
                  {u.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input value={satuan} onChange={(e) => setSatuan(e.target.value)} />
          )}
        </Field>
        <Field label="Qty" error={errors.kuantitas}>
          <Input
            type="number"
            min="0"
            step="any"
            value={kuantitas}
            onChange={(e) => setKuantitas(e.target.value)}
          />
        </Field>

        <Field label="Harga satuan" error={errors.harga}>
          <Input
            type="number"
            min="0"
            step="any"
            value={harga}
            onChange={(e) => setHarga(e.target.value)}
          />
        </Field>
        <Field label="Harga dasar" error={errors.modal}>
          <Input
            type="number"
            min="0"
            step="any"
            placeholder="kosong = ikut daftar harga"
            value={modal}
            onChange={(e) => setModal(e.target.value)}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted cursor-pointer mt-4">
        <input
          type="checkbox"
          checked={hide}
          onChange={(e) => setHide(e.target.checked)}
          className="w-4 h-4 accent-brand cursor-pointer"
        />
        Sembunyikan dari total
      </label>

      <div className="flex flex-wrap items-center gap-2 mt-5">
        <DangerButton onClick={onDelete}>
          <TrashIcon /> Hapus
        </DangerButton>
        <span className="flex-1" />
        <span className="text-sm text-faint">
          Total{" "}
          <b className="text-body text-base tabular-nums">
            {formatRupiah((qtyNum > 0 ? qtyNum : 0) * (hargaNum >= 0 ? hargaNum : 0))}
          </b>
        </span>
        <Button onClick={onClose}>Batal</Button>
        <PrimaryButton onClick={submit} disabled={!valid}>
          Simpan
        </PrimaryButton>
      </div>

      {confirm && plan && (
        <Modal
          onClose={() => setConfirm(null)}
          overlayClassName="z-[60]"
          className="bg-surface p-5 w-full max-w-md overflow-auto"
        >
          <h3 className="text-lg font-bold mb-2">Ubah stok juga?</h3>
          <p className="text-sm text-muted mb-2">
            Pesanan ini tercatat di stok. Menyimpan akan mengubah{" "}
            <b>{plan.moves.length} catatan stok</b>:
          </p>
          <ul className="text-sm mb-3 flex flex-col gap-1">
            {plan.moves.map((m) => (
              <li key={m.prev.id} className="tabular-nums">
                {order.namaProduk}: {formatAngka(m.prev.qty)} →{" "}
                <b>{formatAngka(m.next.qty)}</b>
                {m.prev.tanggal !== m.next.tanggal && (
                  <span className="text-faint"> · tanggal {m.next.tanggal}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-faint mb-4">
            Angka dalam satuan dasar produk. Pembelian stok yang terkait tidak
            berubah.
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirm(null)}>Kembali</Button>
            <PrimaryButton onClick={() => commit(confirm)}>
              Simpan dan ubah stok
            </PrimaryButton>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
