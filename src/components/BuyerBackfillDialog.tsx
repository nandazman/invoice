import { useState } from "react";
import type { Buyer } from "../lib/types";
import { uid, nowISO } from "../lib/format";
import {
  useBuyers,
  upsertBuyer,
  backfillOrderBuyer,
  dismissBuyerBackfill,
} from "../lib/store";
import { Button, PrimaryButton } from "./Button";
import { Field } from "./Field";
import { Modal } from "./Modal";
import { BuyerSelect } from "./BuyerSelect";

// Asked once per installation, on /pesanan, with the orders it is asking about
// on screen behind it. Both buttons answer permanently; Escape and
// click-outside write nothing and the prompt returns next visit — a modal that
// appears unannounced and commits on a stray keypress is a trap, so `onClose`
// deliberately does NOT dismiss.
export function BuyerBackfillDialog({
  count,
  onClose,
}: {
  count: number;
  onClose: () => void;
}) {
  const buyers = useBuyers();
  const [buyerId, setBuyerId] = useState("");

  function createBuyer(nama: string) {
    const now = nowISO();
    const row: Buyer = {
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
    upsertBuyer(row);
    setBuyerId(row.id);
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="text-xl font-bold mb-2">Pembeli untuk pesanan lama</h2>

      <p className="text-sm text-slate-600 mb-3">
        Ada <b>{count} pesanan lama</b> yang belum punya pembeli. Pilih satu
        pembeli untuk diterapkan ke semuanya sekaligus.
      </p>

      <Field label="Pembeli" className="mb-3">
        <BuyerSelect
          value={buyerId}
          options={buyers}
          onChange={setBuyerId}
          onCreate={createBuyer}
        />
      </Field>

      <p className="text-xs text-slate-500 mb-4">
        Pilihan ini bisa diubah per pesanan kapan saja lewat kolom{" "}
        <b>Pembeli</b> di tabel — jadi menerapkannya ke semua pesanan tidak
        mengunci apa pun.
      </p>

      <div className="flex gap-3 justify-end">
        <Button onClick={dismissBuyerBackfill}>Lewati</Button>
        <PrimaryButton
          disabled={buyerId === ""}
          onClick={() => backfillOrderBuyer(buyerId)}
        >
          Terapkan ke {count} pesanan
        </PrimaryButton>
      </div>
    </Modal>
  );
}
