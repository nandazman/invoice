import { useState } from "react";
import type { Product, Conversion } from "../lib/types";
import { uid } from "../lib/format";
import { Button } from "./Button";
import { Input } from "./Input";
import { Field } from "./Field";

interface Props {
  product: Product | null; // null = creating new
  onSave: (p: Product) => void;
  onClose: () => void;
}

export function ProductDialog({ product, onSave, onClose }: Props) {
  const [namaProduk, setNama] = useState(product?.namaProduk ?? "");
  const [ukuran, setUkuran] = useState(
    product?.ukuran != null ? String(product.ukuran) : "",
  );
  const [satuan, setSatuan] = useState(product?.satuan ?? "");
  const [hargaJual, setHarga] = useState(
    product ? String(product.hargaJual) : "",
  );
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
      .map((k) => ({
        nama: k.nama.trim(),
        jumlah: Number(k.jumlah) || 0,
        harga: Number(k.harga) || 0,
      }));
    onSave({
      id: product?.id ?? uid(),
      namaProduk: namaProduk.trim(),
      ukuran: ukuran.trim() === "" ? null : Number(ukuran),
      satuan: satuan.trim() === "" ? null : satuan.trim(),
      hargaJual: harga,
      konversi: cleanKonv,
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

        <Field label="Nama Produk *" className="mb-3">
          <Input
            value={namaProduk}
            onChange={(e) => setNama(e.target.value)}
            autoFocus
          />
        </Field>

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
          <Field label="Harga Satuan *" className="flex-1 min-w-[120px]">
            <Input
              type="number"
              value={hargaJual}
              onChange={(e) => setHarga(e.target.value)}
              placeholder="mis. 45000"
            />
          </Field>
        </div>

        <div className="flex items-center mb-1">
          <strong>Konversi kemasan</strong>
          <span className="flex-1" />
          <Button size="sm" onClick={addKonversi}>
            + Tambah konversi
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-0 mb-3">
          Setiap konversi punya harga sendiri. Mis. 1 box = 12 unit, harga box Rp
          110.000.
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
            <Field label="Harga unit" className="flex-[1.2] min-w-[110px]">
              <Input
                type="number"
                value={k.harga}
                onChange={(e) =>
                  updateKonversi(i, { harga: Number(e.target.value) })
                }
              />
            </Field>
            <Button
              variant="ghost"
              onClick={() => removeKonversi(i)}
              title="Hapus konversi"
            >
              ✕
            </Button>
          </div>
        ))}

        <div className="flex gap-3 justify-end mt-5">
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={submit}>
            Simpan
          </Button>
        </div>
      </div>
    </div>
  );
}
