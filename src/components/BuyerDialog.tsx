import { useState } from "react";
import type { Buyer } from "../lib/types";
import { uid, nowISO } from "../lib/format";
import { Button, PrimaryButton } from "./Button";
import { Input } from "./Input";
import { Field } from "./Field";
import { Modal } from "./Modal";

interface Props {
  buyer: Buyer | null; // null = creating new
  onSave: (b: Buyer) => void;
  onClose: () => void;
}

export function BuyerDialog({ buyer, onSave, onClose }: Props) {
  const [nama, setNama] = useState(buyer?.nama ?? "");
  const [telepon, setTelepon] = useState(buyer?.telepon ?? "");
  const [email, setEmail] = useState(buyer?.email ?? "");
  const [alamat, setAlamat] = useState(buyer?.alamat ?? "");
  const [catatan, setCatatan] = useState(buyer?.catatan ?? "");

  function submit() {
    // Only `nama` is checked. Nothing else in this app validates an email or a
    // phone number, and a picker that rejects "0812-3456" because of a dash
    // would be the first place a user is stopped from writing down what they
    // actually have.
    if (!nama.trim()) {
      alert("Nama pembeli wajib diisi.");
      return;
    }
    const now = nowISO();
    onSave({
      id: buyer?.id ?? uid(),
      nama: nama.trim(),
      telepon: telepon.trim(),
      email: email.trim(),
      alamat: alamat.trim(),
      catatan: catatan.trim(),
      createdAt: buyer?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  return (
    <Modal
      onClose={onClose}
      className="bg-white rounded-xl p-5 w-full max-w-lg max-h-[90vh] overflow-auto"
    >
      <h2 className="text-xl font-bold mb-4">
        {buyer ? "Ubah Pembeli" : "Tambah Pembeli"}
      </h2>

      <div className="flex gap-3 flex-wrap mb-3">
        <Field label="Nama *" className="flex-[2] min-w-[200px]">
          <Input
            value={nama}
            onChange={(e) => setNama(e.target.value)}
            placeholder="mis. Bu Ani"
            autoFocus
          />
        </Field>
        <Field label="Telepon" className="flex-1 min-w-[140px]">
          <Input
            value={telepon}
            onChange={(e) => setTelepon(e.target.value)}
            placeholder="mis. 0812-3456-7890"
          />
        </Field>
      </div>

      <div className="flex gap-3 flex-wrap mb-3">
        <Field label="Email" className="flex-1 min-w-[200px]">
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="mis. ani@email.com"
          />
        </Field>
      </div>

      <div className="flex gap-3 flex-wrap mb-3">
        <Field label="Alamat" className="flex-1 min-w-[200px]">
          <Input
            value={alamat}
            onChange={(e) => setAlamat(e.target.value)}
            placeholder="mis. Jl. Melati No. 12"
          />
        </Field>
      </div>

      <div className="flex gap-3 flex-wrap mb-3">
        <Field label="Catatan" className="flex-1 min-w-[200px]">
          <Input
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="mis. warung kopi depan pasar"
          />
        </Field>
      </div>

      <div className="flex gap-3 justify-end mt-5">
        <Button onClick={onClose}>Batal</Button>
        <PrimaryButton onClick={submit}>Simpan</PrimaryButton>
      </div>
    </Modal>
  );
}
