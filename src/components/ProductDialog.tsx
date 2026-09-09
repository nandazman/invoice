import { useState } from "react";
import type { Product, Conversion } from "../lib/types";
import { uid, nowISO, formatRupiah } from "../lib/format";
import { addType } from "../lib/store";
import { Button, PrimaryButton, DangerGhostButton } from "./Button";
import { Input } from "./Input";
import { Field } from "./Field";
import { TypeSelect } from "./TypeSelect";
import { Modal } from "./Modal";
import { TrashIcon } from "./icons";

interface Props {
  product: Product | null; // null = creating new
  types: string[]; // existing type names for the dropdown
  onSave: (p: Product) => void;
  onClose: () => void;
}

export function ProductDialog({ product, types, onSave, onClose }: Props) {
  const [namaProduk, setNama] = useState(product?.namaProduk ?? "");
  const [tipe, setTipe] = useState(product?.tipe ?? "Bar");
  const [ukuran, setUkuran] = useState(
    product?.ukuran != null ? String(product.ukuran) : "",
  );
  const [satuan, setSatuan] = useState(product?.satuan ?? "");
  const [hargaDasar, setHargaDasar] = useState(
    product?.hargaDasar ? String(product.hargaDasar) : "",
  );
  const [hargaJual, setHarga] = useState(
    product ? String(product.hargaJual) : "",
  );
  const [stokMin, setStokMin] = useState(
    product?.stokMin ? String(product.stokMin) : "",
  );

  const [namaError, setNamaError] = useState("");
  const [hargaError, setHargaError] = useState("");

  const laba = (Number(hargaJual) || 0) - (Number(hargaDasar) || 0);
  const [konversi, setKonversi] = useState<Conversion[]>(
    product?.konversi ?? [],
  );

  function addKonversi() {
    setKonversi([...konversi, { nama: "", jumlah: 1, harga: 0 }]);
  }
  function updateKonversi(i: number, patch: Partial<Conversion>) {
    setKonversi(konversi.map((k, idx) => (idx === i ? { ...k, ...patch } : k)));
  }
  function removeKonversi(i: number) {
    setKonversi(konversi.filter((_, idx) => idx !== i));
  }

  function submit() {
    if (!namaProduk.trim()) {
      setNamaError("Nama produk wajib diisi.");
      return;
    }
    setNamaError("");
    const harga = Number(hargaJual);
    if (!Number.isFinite(harga) || harga < 0) {
      setHargaError("Harga satuan tidak valid.");
      return;
    }
    setHargaError("");
    const cleanKonv = konversi
      .filter((k) => k.nama.trim())
      .map((k) => {
        const jumlah = Number(k.jumlah) || 0;
        return { nama: k.nama.trim(), jumlah, harga: jumlah * harga };
      });
    const now = nowISO();
    onSave({
      id: product?.id ?? uid(),
      namaProduk: namaProduk.trim(),
      tipe: tipe.trim() || "Bar",
      ukuran: ukuran.trim() === "" ? null : Number(ukuran),
      satuan: satuan.trim() === "" ? null : satuan.trim(),
      hargaDasar: Number(hargaDasar) || 0,
      hargaJual: harga,
      konversi: cleanKonv,
      stokMin: Number(stokMin) || 0,
      createdAt: product?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  return (
    <Modal
      onClose={onClose}
      className="bg-surface p-5 w-full max-w-xl overflow-auto"
    >
        <h2 className="text-xl font-bold mb-4">
          {product ? "Ubah Produk" : "Tambah Produk"}
        </h2>

        {/* Single column on a phone — five side-by-side fields don't fit —
            back to the row layout from `md` up. */}
        <div className="flex flex-col md:flex-row gap-3 mb-3">
          <Field
            label="Nama Produk *"
            className="md:flex-[2] md:min-w-[200px]"
            error={namaError}
          >
            <Input
              value={namaProduk}
              onChange={(e) => {
                setNama(e.target.value);
                setNamaError("");
              }}
              autoFocus
            />
          </Field>
          <Field label="Tipe" className="md:flex-1 md:min-w-[140px]">
            <TypeSelect
              value={tipe}
              options={types}
              onChange={setTipe}
              onCreate={addType}
            />
          </Field>
        </div>

        <div className="flex flex-col md:flex-row md:flex-wrap gap-3 mb-3">
          <Field label="Ukuran" className="md:flex-1 md:min-w-[120px]">
            <Input
              type="number"
              inputMode="numeric"
              value={ukuran}
              onChange={(e) => setUkuran(e.target.value)}
              placeholder="mis. 1000"
            />
          </Field>
          <Field label="Satuan dasar" className="md:flex-1 md:min-w-[120px]">
            <Input
              value={satuan}
              onChange={(e) => setSatuan(e.target.value)}
              placeholder="mis. gr, ml, pcs"
            />
          </Field>
          <Field label="Harga Dasar" className="md:flex-1 md:min-w-[120px]">
            <Input
              type="number"
              inputMode="numeric"
              value={hargaDasar}
              onChange={(e) => setHargaDasar(e.target.value)}
              placeholder="mis. 30000"
            />
          </Field>
          <Field
            label="Harga Satuan *"
            className="md:flex-1 md:min-w-[120px]"
            error={hargaError}
          >
            <Input
              type="number"
              inputMode="numeric"
              value={hargaJual}
              onChange={(e) => {
                setHarga(e.target.value);
                setHargaError("");
              }}
              placeholder="mis. 45000"
            />
          </Field>
          <Field label="Stok minimum" className="md:flex-1 md:min-w-[120px]">
            <Input
              type="number"
              inputMode="numeric"
              value={stokMin}
              onChange={(e) => setStokMin(e.target.value)}
              placeholder="mis. 10 (satuan dasar)"
            />
          </Field>
        </div>

        <p className="text-xs mb-3">
          <span className="text-faint">Laba per satuan: </span>
          <span
            className={
              laba < 0 ? "font-semibold text-danger" : "font-semibold text-ok"
            }
          >
            {formatRupiah(laba)}
          </span>
        </p>

        <div className="flex items-center mb-1">
          <strong>Konversi kemasan</strong>
          <span className="flex-1" />
          <Button size="sm" onClick={addKonversi}>
            + Tambah konversi
          </Button>
        </div>
        <p className="text-xs text-faint mt-0 mb-3">
          Harga tiap konversi dihitung otomatis dari Harga Satuan × jumlah. Mis.
          1 box = 12 unit → harga box = 12 × harga satuan.
        </p>

        {konversi.length === 0 && (
          <p className="text-sm text-faint">Belum ada konversi.</p>
        )}

        {konversi.map((k, i) => (
          <div
            className="flex flex-col md:flex-row md:flex-wrap gap-3 md:items-end mb-2"
            key={i}
          >
            <Field label="Nama unit" className="md:flex-[1.4] md:min-w-[110px]">
              <Input
                value={k.nama}
                onChange={(e) => updateKonversi(i, { nama: e.target.value })}
                placeholder="box / dus"
              />
            </Field>
            <Field label="= berapa satuan" className="md:flex-1 md:min-w-[100px]">
              <Input
                type="number"
                inputMode="numeric"
                value={k.jumlah}
                onChange={(e) =>
                  updateKonversi(i, { jumlah: Number(e.target.value) })
                }
              />
            </Field>
            <Field
              label="Harga unit (otomatis)"
              className="md:flex-[1.2] md:min-w-[110px]"
            >
              <Input
                value={formatRupiah((Number(k.jumlah) || 0) * (Number(hargaJual) || 0))}
                readOnly
                tabIndex={-1}
                className="bg-surface-sunken text-faint"
              />
            </Field>
            <DangerGhostButton
              onClick={() => removeKonversi(i)}
              title="Hapus konversi"
              aria-label="Hapus konversi"
            >
              <TrashIcon />
            </DangerGhostButton>
          </div>
        ))}

        <div className="flex gap-3 justify-end mt-5">
          <Button onClick={onClose}>Batal</Button>
          <PrimaryButton onClick={submit}>Simpan</PrimaryButton>
        </div>
    </Modal>
  );
}
