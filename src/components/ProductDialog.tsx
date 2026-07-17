import { useState } from "react";
import type { Product, Conversion } from "../lib/types";
import { uid, nowISO, formatRupiah } from "../lib/format";
import { addType } from "../lib/store";
import { Button, PrimaryButton, GhostButton } from "./Button";
import { Input } from "./Input";
import { Field } from "./Field";
import { TypeSelect } from "./TypeSelect";

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
      alert("Nama produk wajib diisi.");
      return;
    }
    const harga = Number(hargaJual);
    if (!Number.isFinite(harga) || harga < 0) {
      alert("Harga satuan tidak valid.");
      return;
    }
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
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl p-5 w-full max-w-xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-4">
          {product ? "Ubah Produk" : "Tambah Produk"}
        </h2>

        <div className="flex gap-3 flex-wrap mb-3">
          <Field label="Nama Produk *" className="flex-[2] min-w-[200px]">
            <Input
              value={namaProduk}
              onChange={(e) => setNama(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Tipe" className="flex-1 min-w-[140px]">
            <TypeSelect
              value={tipe}
              options={types}
              onChange={setTipe}
              onCreate={addType}
            />
          </Field>
        </div>

        <div className="flex gap-3 flex-wrap mb-3">
          <Field label="Ukuran" className="flex-1 min-w-[120px]">
            <Input
              type="number"
              value={ukuran}
              onChange={(e) => setUkuran(e.target.value)}
              placeholder="mis. 1000"
            />
          </Field>
          <Field label="Satuan dasar" className="flex-1 min-w-[120px]">
            <Input
              value={satuan}
              onChange={(e) => setSatuan(e.target.value)}
              placeholder="mis. gr, ml, pcs"
            />
          </Field>
          <Field label="Harga Dasar" className="flex-1 min-w-[120px]">
            <Input
              type="number"
              value={hargaDasar}
              onChange={(e) => setHargaDasar(e.target.value)}
              placeholder="mis. 30000"
            />
          </Field>
          <Field label="Harga Satuan *" className="flex-1 min-w-[120px]">
            <Input
              type="number"
              value={hargaJual}
              onChange={(e) => setHarga(e.target.value)}
              placeholder="mis. 45000"
            />
          </Field>
          <Field label="Stok minimum" className="flex-1 min-w-[120px]">
            <Input
              type="number"
              value={stokMin}
              onChange={(e) => setStokMin(e.target.value)}
              placeholder="mis. 10 (satuan dasar)"
            />
          </Field>
        </div>

        <p className="text-xs mb-3">
          <span className="text-slate-500">Laba per satuan: </span>
          <span
            className={
              laba < 0 ? "font-semibold text-red-600" : "font-semibold text-emerald-600"
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
        <p className="text-xs text-slate-500 mt-0 mb-3">
          Harga tiap konversi dihitung otomatis dari Harga Satuan × jumlah. Mis.
          1 box = 12 unit → harga box = 12 × harga satuan.
        </p>

        {konversi.length === 0 && (
          <p className="text-sm text-slate-400">Belum ada konversi.</p>
        )}

        {konversi.map((k, i) => (
          <div className="flex gap-3 flex-wrap items-end mb-2" key={i}>
            <Field label="Nama unit" className="flex-[1.4] min-w-[110px]">
              <Input
                value={k.nama}
                onChange={(e) => updateKonversi(i, { nama: e.target.value })}
                placeholder="box / dus"
              />
            </Field>
            <Field label="= berapa satuan" className="flex-1 min-w-[100px]">
              <Input
                type="number"
                value={k.jumlah}
                onChange={(e) =>
                  updateKonversi(i, { jumlah: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Harga unit (otomatis)" className="flex-[1.2] min-w-[110px]">
              <Input
                value={formatRupiah((Number(k.jumlah) || 0) * (Number(hargaJual) || 0))}
                readOnly
                tabIndex={-1}
                className="bg-slate-50 text-slate-500"
              />
            </Field>
            <GhostButton
              onClick={() => removeKonversi(i)}
              title="Hapus konversi"
            >
              ✕
            </GhostButton>
          </div>
        ))}

        <div className="flex gap-3 justify-end mt-5">
          <Button onClick={onClose}>Batal</Button>
          <PrimaryButton onClick={submit}>Simpan</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
