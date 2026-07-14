import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { OrderItem, Product, PurchaseItem } from "../lib/types";
import { formatRupiah, formatAngka, formatTanggalID } from "../lib/format";
import { modalCostFor, purchaseFromOrderItem } from "../lib/purchaseFromOrder";
import { Button, PrimaryButton, DangerButton } from "./Button";

interface Props {
  tanggal: string; // the order date the items belong to
  items: OrderItem[]; // order items on that date
  products: Product[];
  onConfirm: (purchases: PurchaseItem[]) => void;
  onClose: () => void;
}

// One line in the dialog: an order item and whether it's picked. Qty and buy
// price are fixed (qty from the order, price from the product's modal cost) —
// not editable here; wrong values are fixed later via a manual stock adjustment.
interface Row {
  order: OrderItem;
  product: Product | undefined;
  harga: number; // modal cost per chosen unit
  selected: boolean;
}

// Animated success check: the ring sweeps in, then the tick draws itself, with a
// small pop. Self-contained (scoped <style>) so it needs no global CSS.
function SuccessCheck() {
  return (
    <div className="flex justify-center mb-3">
      <style>{`
        @keyframes bfo-pop {
          0% { transform: scale(0); }
          70% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
        @keyframes bfo-draw { to { stroke-dashoffset: 0; } }
        .bfo-check { animation: bfo-pop 0.35s ease-out both; }
        .bfo-ring {
          stroke-dasharray: 166; stroke-dashoffset: 166;
          animation: bfo-draw 0.45s ease-out 0.1s forwards;
        }
        .bfo-tick {
          stroke-dasharray: 48; stroke-dashoffset: 48;
          animation: bfo-draw 0.3s ease-out 0.5s forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .bfo-check, .bfo-ring, .bfo-tick { animation: none; }
          .bfo-ring, .bfo-tick { stroke-dashoffset: 0; }
        }
      `}</style>
      <svg
        className="bfo-check"
        width="64"
        height="64"
        viewBox="0 0 52 52"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="bfo-ring"
          cx="26"
          cy="26"
          r="24"
          stroke="#10b981"
          strokeWidth="3"
        />
        <path
          className="bfo-tick"
          d="M15 27 l7 7 l15 -15"
          stroke="#10b981"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function BuyFromOrderDialog({
  tanggal,
  items,
  products,
  onConfirm,
  onClose,
}: Props) {
  const navigate = useNavigate();
  const productById = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  const [rows, setRows] = useState<Row[]>(() =>
    items.map((order) => {
      const product =
        productById.get(order.productId) ??
        products.find((p) => p.namaProduk === order.namaProduk);
      return {
        order,
        product,
        harga: product ? modalCostFor(product, order.satuan) : 0,
        selected: true, // default: select all
      };
    }),
  );
  const [confirming, setConfirming] = useState(false);
  // How many items were committed; non-null flips the dialog to its success view.
  const [savedCount, setSavedCount] = useState<number | null>(null);

  function toggle(id: string, checked: boolean) {
    setRows((prev) =>
      prev.map((r) => (r.order.id === id ? { ...r, selected: checked } : r)),
    );
  }

  const selectedRows = rows.filter((r) => r.selected);
  const total = selectedRows.reduce(
    (s, r) => s + r.order.kuantitas * r.harga,
    0,
  );
  const canSave = selectedRows.length > 0;

  function build(): PurchaseItem[] {
    return selectedRows.map((r) =>
      purchaseFromOrderItem(r.order, r.product, { hargaSatuan: r.harga }),
    );
  }

  function save() {
    const items = build();
    onConfirm(items);
    setConfirming(false);
    setSavedCount(items.length);
  }

  // Success view: purchases committed; offer a jump to the stock page.
  if (savedCount !== null) {
    return (
      <div
        className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-xl p-6 w-full max-w-md text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <SuccessCheck />
          <h2 className="text-xl font-bold mb-1">Tersimpan</h2>
          <p className="text-slate-600 mb-5">
            {savedCount} item dicatat sebagai pembelian stok dari pesanan{" "}
            {formatTanggalID(tanggal)}.
          </p>
          <div className="flex justify-center gap-3">
            <Button onClick={onClose}>Tutup</Button>
            <PrimaryButton
              onClick={() => {
                onClose();
                navigate({ to: "/stok" });
              }}
            >
              Lihat Stok
            </PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-1">Beli Stok dari Pesanan</h2>
        <p className="text-slate-500 mb-4">
          Pesanan {formatTanggalID(tanggal)} — pilih barang yang akan dibeli.
          Semua terpilih otomatis; hilangkan centang bila tak jadi dibeli.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2 border-b border-slate-200"></th>
                <th className="px-2 py-2 border-b border-slate-200">
                  Nama Produk
                </th>
                <th className="px-2 py-2 border-b border-slate-200">Satuan</th>
                <th className="px-2 py-2 border-b border-slate-200 text-right">
                  Qty
                </th>
                <th className="px-2 py-2 border-b border-slate-200 text-right">
                  Harga Dasar
                </th>
                <th className="px-2 py-2 border-b border-slate-200 text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const unmatched = !r.product;
                const lineTotal = r.order.kuantitas * r.harga;
                return (
                  <tr
                    key={r.order.id}
                    className={r.selected ? "" : "opacity-50"}
                  >
                    <td className="px-2 py-2 border-b border-slate-100">
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={(e) => toggle(r.order.id, e.target.checked)}
                      />
                    </td>
                    <td className="px-2 py-2 border-b border-slate-100 text-sm">
                      {r.order.namaProduk}
                      {unmatched && (
                        <span
                          className="ml-1 text-xs text-amber-600"
                          title="Produk tak tertaut — harga default 0"
                        >
                          (tak tertaut)
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 border-b border-slate-100 text-sm">
                      {r.order.satuan}
                    </td>
                    <td className="px-2 py-2 border-b border-slate-100 text-right text-sm tabular-nums">
                      {formatAngka(r.order.kuantitas)}
                    </td>
                    <td className="px-2 py-2 border-b border-slate-100 text-right text-sm tabular-nums">
                      {formatRupiah(r.harga)}
                    </td>
                    <td className="px-2 py-2 border-b border-slate-100 text-right text-sm tabular-nums">
                      {formatRupiah(lineTotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <span className="text-lg font-bold">
            Total: {formatRupiah(total)}
          </span>
          <span className="text-slate-400">
            · {selectedRows.length} item terpilih
          </span>
          <span className="flex-1" />
          <Button onClick={onClose}>Batal</Button>
          <PrimaryButton onClick={() => setConfirming(true)} disabled={!canSave}>
            Simpan ke Stok
          </PrimaryButton>
        </div>

        {confirming && (
          <div
            className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
            onClick={() => setConfirming(false)}
          >
            <div
              className="bg-white rounded-xl p-5 w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-2">Konfirmasi</h3>
              <p className="text-sm text-slate-600 mb-1">
                {selectedRows.length} item akan dicatat sebagai pembelian stok
                ({formatRupiah(total)}).
              </p>
              <p className="text-sm text-red-600 font-medium mb-4">
                Entri stok ini permanen dan tidak bisa diubah. Bila ada salah
                input, perbaiki lewat penyesuaian stok manual.
              </p>
              <div className="flex justify-end gap-3">
                <Button onClick={() => setConfirming(false)}>Batal</Button>
                <DangerButton onClick={save}>Ya, simpan</DangerButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
