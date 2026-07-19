import { useMemo, useState } from "react";
import type { Product } from "../lib/types";
import { formatRupiah } from "../lib/format";
import { Input } from "./Input";
import { Button } from "./Button";
import { Modal } from "./Modal";

// Picks the product a legacy row (productId "") should point at. The row's own
// name is shown as a read-only label, never as the search text: pre-filling the
// input meant clearing it before you could search for anything else.
const LIMIT = 5;

export function LinkProductDialog({
  namaProduk,
  products,
  onPick,
  onClose,
}: {
  namaProduk: string;
  products: Product[];
  onPick: (productId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");

  // `total` is the unsliced count, so the "ada N lagi" hint can tell the
  // difference between a truncated list and a store that just has 5 products.
  const { matches, total } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? products.filter((p) => p.namaProduk.toLowerCase().includes(needle))
      : products;
    return { matches: list.slice(0, LIMIT), total: list.length };
  }, [products, q]);

  return (
    <Modal onClose={onClose}>
        <h2 className="text-xl font-bold mb-2">Tautkan Produk</h2>

        <div className="mb-3">
          <span className="inline-block rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 text-sm font-medium">
            {namaProduk}
          </span>
        </div>
        <p className="text-slate-500 text-sm mb-3">
          Pilih produk yang benar — kuantitas dan harga pesanan tidak berubah.
        </p>

        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari produk…"
          autoFocus
        />

        <div className="mt-3 divide-y divide-slate-100">
          {matches.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              Tidak ada produk cocok.
            </p>
          ) : (
            matches.map((p) => (
              <button
                key={p.id}
                type="button"
                className="w-full text-left px-2 py-2 hover:bg-slate-50 flex items-center gap-2"
                onClick={() => onPick(p.id)}
              >
                {/* Duplicate names are exactly why this dialog exists, so the
                    size/unit has to be visible to tell two of them apart. */}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">
                    {p.namaProduk}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {[p.ukuran, p.satuan].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="text-xs text-slate-400">{p.tipe}</span>
                <span className="text-sm tabular-nums text-slate-500">
                  {formatRupiah(p.hargaJual)}
                </span>
              </button>
            ))
          )}
        </div>

        {total > LIMIT && (
          <p className="text-xs text-slate-400 mt-2">
            Ada {total - LIMIT} produk lagi — ketik untuk mempersempit.
          </p>
        )}

        <div className="flex mt-4">
          <span className="flex-1" />
          <Button onClick={onClose}>Batal</Button>
        </div>
    </Modal>
  );
}
