import { useState } from "react";
import type { Buyer } from "../lib/types";
import { uid, nowISO } from "../lib/format";
import { Button, PrimaryButton, DangerButton, DangerGhostButton } from "./Button";
import { Input } from "./Input";
import { Field } from "./Field";
import { Modal } from "./Modal";
import { CloseIcon, TrashIcon } from "./icons";

interface Props {
  buyer: Buyer | null; // null = creating new
  onSave: (b: Buyer) => void;
  onClose: () => void;
  // Edit only: the Hapus button. The page owns the confirmation.
  onDelete?: () => void;
}

export function BuyerDialog({ buyer, onSave, onClose, onDelete }: Props) {
  const [nama, setNama] = useState(buyer?.nama ?? "");
  const [telepon, setTelepon] = useState(buyer?.telepon ?? "");
  const [email, setEmail] = useState(buyer?.email ?? "");
  const [alamat, setAlamat] = useState(buyer?.alamat ?? "");
  const [catatan, setCatatan] = useState(buyer?.catatan ?? "");
  const [namaError, setNamaError] = useState("");

  function submit() {
    // Only `nama` is checked. Nothing else in this app validates an email or a
    // phone number, and a picker that rejects "0812-3456" because of a dash
    // would be the first place a user is stopped from writing down what they
    // actually have.
    if (!nama.trim()) {
      setNamaError("Nama pembeli wajib diisi.");
      return;
    }
    setNamaError("");
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
      closeOnOverlay={false}
      className="bg-surface p-4 md:p-5 w-full max-w-lg overflow-auto"
    >
      <div className="flex items-center mb-4">
        <h2 className="text-lg font-bold flex-1">
          {buyer ? "Ubah pembeli" : "Tambah pembeli"}
        </h2>
        <DangerGhostButton
          onClick={onClose}
          aria-label="Tutup"
          title="Tutup"
          className="hover:!bg-surface-hover hover:!text-body"
        >
          <CloseIcon />
        </DangerGhostButton>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Nama *" className="col-span-2 md:col-span-1" error={namaError}>
          <Input
            value={nama}
            onChange={(e) => {
              setNama(e.target.value);
              setNamaError("");
            }}
            placeholder="mis. Bu Ani"
            autoFocus
          />
        </Field>
        <Field label="Telepon" className="col-span-2 md:col-span-1">
          <Input
            value={telepon}
            onChange={(e) => setTelepon(e.target.value)}
            placeholder="mis. 0812-3456-7890"
          />
        </Field>
        <Field label="Email" className="col-span-2">
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="mis. ani@email.com"
          />
        </Field>
        <Field label="Alamat" className="col-span-2">
          <Input
            value={alamat}
            onChange={(e) => setAlamat(e.target.value)}
            placeholder="mis. Jl. Melati No. 12"
          />
        </Field>
        <Field label="Catatan" className="col-span-2">
          <Input
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="mis. warung kopi depan pasar"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-5">
        {buyer && onDelete && (
          <DangerButton onClick={onDelete}>
            <TrashIcon /> Hapus
          </DangerButton>
        )}
        <span className="flex-1" />
        <Button onClick={onClose}>Batal</Button>
        <PrimaryButton onClick={submit}>Simpan</PrimaryButton>
      </div>
    </Modal>
  );
}
