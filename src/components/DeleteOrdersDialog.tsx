import { orderDeleteImpact, type DeleteOrderOptions } from "../lib/store";
import { formatRupiah } from "../lib/format";
import { Button, DangerButton } from "./Button";
import { Modal } from "./Modal";

// Delete used to be one tap with no question. It now says how many rows go, and
// when the orders were tied to Beli Stok purchases it asks what to do with them,
// because those purchases are real buys that may still be on the shelf.
export function DeleteOrdersDialog({
  ids,
  onConfirm,
  onClose,
}: {
  ids: Set<string>;
  onConfirm: (opts: DeleteOrderOptions) => void;
  onClose: () => void;
}) {
  const impact = orderDeleteImpact(ids);
  const n = impact.orders;
  const buys = impact.purchases;
  const buyTotal = buys.reduce((s, p) => s + p.totalHarga, 0);

  function go(opts: DeleteOrderOptions) {
    onConfirm(opts);
    onClose();
  }

  return (
    <Modal onClose={onClose} className="bg-surface p-5 w-full max-w-md overflow-auto">
      <h2 className="text-lg font-bold mb-2">Hapus {n} pesanan?</h2>
      <p className="text-sm text-muted mb-1">
        {impact.movements > 0
          ? `${impact.movements} catatan stok dari pesanan ini ikut dihapus, jadi stok kembali.`
          : "Pesanan ini tidak tercatat di stok."}
      </p>
      {buys.length > 0 && (
        <p className="text-sm text-muted mb-1">
          {buys.length} pembelian Beli Stok terkait ({formatRupiah(buyTotal)}):{" "}
          {buys.map((p) => p.namaProduk).join(", ")}.
        </p>
      )}
      <p className="text-sm text-danger font-medium mt-2 mb-4">
        Penghapusan tidak bisa dibatalkan dari sini.
      </p>

      <div className="flex flex-col gap-2">
        <DangerButton onClick={() => go({})}>
          {buys.length > 0 ? "Hapus pesanan saja" : "Hapus"}
        </DangerButton>
        {buys.length > 0 && (
          <DangerButton onClick={() => go({ cancelPurchases: true })}>
            Hapus pesanan + batalkan pembelian stok ({buys.length})
          </DangerButton>
        )}
        <Button onClick={onClose}>Batal</Button>
      </div>
      {buys.length > 0 && (
        <p className="text-xs text-faint mt-3">
          "Hapus pesanan saja" menyisakan pembelian di Beli Stok, stok yang sudah
          dibeli tetap ada.
        </p>
      )}
    </Modal>
  );
}
