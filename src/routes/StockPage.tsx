import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Product, StockMovement } from "../lib/types";
import {
  useProducts,
  useStock,
  addMovement,
  setStock,
} from "../lib/store";
import { computeFifo } from "../lib/stock";
import { formatRupiah, formatAngka } from "../lib/format";
import {
  serializeStock,
  parseStock,
  downloadJSON,
  pickJSONFile,
} from "../lib/io";
import { AddMovementForm } from "../components/AddMovementForm";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

interface Row {
  product: Product;
  qty: number; // current stock, base units
  unitCost: number; // effective FIFO cost per base unit on hand
  value: number; // remaining inventory value (FIFO)
  low: boolean;
}

export function StockPage() {
  const products = useProducts();
  const stock = useStock();
  const [cari, setCari] = useState("");

  function addMovements(ms: StockMovement[]) {
    for (const m of ms) addMovement(m);
  }

  async function doImport() {
    try {
      const text = await pickJSONFile();
      const imported = parseStock(text);
      if (
        !confirm(
          `Impor ${imported.length} pergerakan? Ini akan mengganti data stok saat ini.`,
        )
      )
        return;
      setStock(imported);
    } catch (e) {
      alert("Gagal impor: " + (e as Error).message);
    }
  }

  const rows = useMemo<Row[]>(() => {
    // Group movements by product to derive per-product FIFO totals.
    const byProduct = new Map<string, StockMovement[]>();
    for (const m of stock) {
      const arr = byProduct.get(m.productId) ?? [];
      arr.push(m);
      byProduct.set(m.productId, arr);
    }
    for (const arr of byProduct.values()) {
      arr.sort((a, b) =>
        (b.tanggal + b.createdAt).localeCompare(a.tanggal + a.createdAt),
      );
    }
    const q = cari.trim().toLowerCase();
    return products
      .filter((p) => !q || p.namaProduk.toLowerCase().includes(q))
      .map((p) => {
        const movements = byProduct.get(p.id) ?? [];
        const fifo = computeFifo(movements, p.hargaDasar);
        return {
          product: p,
          qty: fifo.qty,
          unitCost: fifo.unitCost,
          value: fifo.value,
          low: p.stokMin > 0 && fifo.qty <= p.stokMin,
        };
      })
      .sort((a, b) => a.product.namaProduk.localeCompare(b.product.namaProduk));
  }, [products, stock, cari]);

  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const lowCount = rows.filter((r) => r.low).length;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Stok</h1>
      <p className="text-slate-500 mb-4">
        Catat stok masuk & keluar, pantau stok menipis, dan nilai persediaan.
      </p>

      {products.length === 0 ? (
        <Panel className="text-center text-slate-400 py-8">
          Belum ada produk. Tambahkan produk di halaman <b>Harga</b> dulu.
        </Panel>
      ) : (
        <AddMovementForm products={products} onAdd={addMovements} />
      )}

      <Panel>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <span className="text-lg font-bold">
            Nilai persediaan: {formatRupiah(totalValue)}
          </span>
          {lowCount > 0 && (
            <span className="text-sm font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
              {lowCount} produk stok menipis
            </span>
          )}
          <span className="flex-1" />
          <Field label="" className="w-48">
            <Input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari produk…"
            />
          </Field>
          <Button onClick={doImport}>Impor JSON</Button>
          <Button
            onClick={() => downloadJSON("stock.json", serializeStock(stock))}
          >
            Ekspor JSON
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className="text-center text-slate-400 py-8">
            {cari ? "Tidak ada produk cocok." : "Belum ada produk."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Produk</th>
                  <th className={`${thClass} text-right`}>Stok</th>
                  <th className={thClass}>Satuan</th>
                  <th className={`${thClass} text-right`}>Min</th>
                  <th className={`${thClass} text-right`}>Modal/satuan</th>
                  <th className={`${thClass} text-right`}>Nilai</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const satuan = r.product.satuan ?? "satuan";
                  return (
                    <tr
                      key={r.product.id}
                      className={`hover:bg-slate-50 ${r.low ? "bg-amber-50" : ""}`}
                    >
                      <td className={tdClass}>
                        <Link
                          to="/produk/$id"
                          params={{ id: r.product.id }}
                          className="text-blue-600 hover:underline font-medium"
                        >
                          {r.product.namaProduk}
                        </Link>
                        {r.low && (
                          <span className="ml-2 text-xs font-semibold text-amber-600">
                            ⚠ menipis
                          </span>
                        )}
                      </td>
                      <td
                        className={`${tdClass} text-right tabular-nums font-semibold ${
                          r.qty < 0 ? "text-red-600" : ""
                        }`}
                      >
                        {formatAngka(r.qty)}
                      </td>
                      <td className={tdClass}>{satuan}</td>
                      <td
                        className={`${tdClass} text-right tabular-nums text-slate-400`}
                      >
                        {r.product.stokMin > 0
                          ? formatAngka(r.product.stokMin)
                          : "—"}
                      </td>
                      <td className={`${tdClass} text-right tabular-nums`}>
                        {r.qty > 0 ? formatRupiah(r.unitCost) : "—"}
                      </td>
                      <td className={`${tdClass} text-right tabular-nums`}>
                        {formatRupiah(r.value)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
