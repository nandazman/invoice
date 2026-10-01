import { useState } from "react";
import type { PurchaseItem } from "../lib/types";
import {
  formatRupiah,
  formatAngka,
  formatTanggalID,
  formatDateTimeID,
} from "../lib/format";
import { Button, DangerButton, DangerGhostButton } from "./Button";
import { Modal } from "./Modal";
import { AlertIcon, CloseIcon, TrashIcon } from "./icons";

// The one dialog a Beli Stok row opens. Purchases have no edit path in the
// store (a purchase is tied to the stock it added, so changing qty or price
// would have to rewrite that movement), so the dialog holds the row's details,
// the one change that IS allowed (linking an orphan to a product) and delete.
// Delete asks first and says how many rows go.
export function PurchaseDialog({
  item,
  onLink,
  onDelete,
  onClose,
}: {
  item: PurchaseItem;
  onLink: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <Modal onClose={() => setConfirming(false)} className="bg-surface p-5 w-full max-w-md overflow-auto">
        <h2 className="text-lg font-bold mb-2">Hapus 1 pembelian?</h2>
        <p className="text-sm text-muted mb-1">
          {item.namaProduk}: {formatAngka(item.kuantitas)} {item.satuan} (
          {formatRupiah(item.totalHarga)}).
        </p>
        <p className="text-sm text-muted mb-1">
          Stok yang ditambahkan pembelian ini ikut dihapus, jadi stok berkurang
          lagi.
        </p>
        <p className="text-sm text-danger font-medium mt-2 mb-4">
          Penghapusan tidak bisa dibatalkan dari sini.
        </p>
        <div className="flex flex-col gap-2">
          <DangerButton
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            Hapus
          </DangerButton>
          <Button onClick={() => setConfirming(false)}>Batal</Button>
        </div>
      </Modal>
    );
  }

  const kv: [string, React.ReactNode][] = [
    ["Tanggal", formatTanggalID(item.tanggal)],
    ["Satuan", item.satuan],
    ["Qty", formatAngka(item.kuantitas)],
    ["Harga satuan", formatRupiah(item.hargaSatuan)],
    ["Total", formatRupiah(item.totalHarga)],
    ["Dibuat", formatDateTimeID(item.createdAt)],
    ["Diperbarui", formatDateTimeID(item.updatedAt)],
  ];

  return (
    <Modal
      onClose={onClose}
      className="bg-surface p-4 md:p-5 w-full max-w-md overflow-auto"
    >
      <div className="flex items-center mb-4">
        <h2 className="text-lg font-bold flex-1 min-w-0 break-words">
          {item.namaProduk}
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

      {!item.productId && (
        <div className="flex items-center gap-2 mb-3 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">
          <AlertIcon className="h-4 w-4 shrink-0" />
          <span className="flex-1">Belum tertaut ke produk.</span>
          <Button size="sm" onClick={onLink}>
            Tautkan
          </Button>
        </div>
      )}

      <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1.5 text-sm">
        {kv.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-faint">{label}</dt>
            <dd className="text-right tabular-nums font-medium break-words">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center gap-2 mt-5">
        <DangerButton onClick={() => setConfirming(true)}>
          <TrashIcon /> Hapus
        </DangerButton>
        <span className="flex-1" />
        <Button onClick={onClose}>Tutup</Button>
      </div>
    </Modal>
  );
}
