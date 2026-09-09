import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Product, StockMovement } from "../lib/types";
import {
  useProducts,
  useStock,
  addMovement,
} from "../lib/store";
import { computeFifo } from "../lib/stock";
import { formatRupiah, formatAngka } from "../lib/format";
import { usePersistentAttribution } from "../lib/columns";
import {
  AttributionToggle,
  ByCells,
  ByHeaders,
  bothBy,
} from "../components/Attribution";
import { AddMovementForm } from "../components/AddMovementForm";
import { Input } from "../components/Input";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";
import { thClass, tdClass } from "../components/DataTable";
import { MobileList, MobileRow } from "../components/MobileList";


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
  // The row here IS a product — the stock figures are derived — so the
  // attribution shown is the product's, not the movements'.
  const [showBy, setShowBy] = usePersistentAttribution("invoice.stok.by.v1");

  function addMovements(ms: StockMovement[]) {
    for (const m of ms) addMovement(m);
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
      <p className="text-faint mb-4">
        Catat stok masuk & keluar, pantau stok menipis, dan nilai persediaan.
      </p>

      {products.length === 0 ? (
        <Panel className="text-center text-faint py-8">
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
            <span className="text-sm font-semibold text-warn bg-warn-soft border border-warn-line rounded-lg px-2 py-1">
              {lowCount} produk stok menipis
            </span>
          )}
          <span className="flex-1" />
          <AttributionToggle show={showBy} onChange={setShowBy} />
          <Field label="" className="w-48">
            <Input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari produk…"
            />
          </Field>
        </div>

        {rows.length === 0 ? (
          <div className="text-center text-faint py-8">
            {cari ? "Tidak ada produk cocok." : "Belum ada produk."}
          </div>
        ) : (
          <>
            {/* The phone layout: six columns will not fit on 390px, so the row
                collapses to what the product IS on the left and what its stock
                is WORTH on the right. Stok, min, and satuan restack under the
                name; modal/satuan sits under the value. The attribution
                columns stay a desktop affordance — the toggle above still
                drives the wide table. */}
            <div className="md:hidden">
              <MobileList left="Produk" right="Nilai">
                {rows.map((r) => {
                  const satuan = r.product.satuan ?? "satuan";
                  return (
                    <MobileRow
                      key={r.product.id}
                      title={
                        <Link
                          to="/produk/$id"
                          params={{ id: r.product.id }}
                          className="flex items-center w-full min-h-11 text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        >
                          {r.product.namaProduk}
                        </Link>
                      }
                      meta={
                        <>
                          <span
                            className={`tabular-nums font-semibold ${
                              r.qty < 0
                                ? "text-danger"
                                : r.low
                                  ? "text-warn"
                                  : "text-body"
                            }`}
                          >
                            {formatAngka(r.qty)} {satuan}
                          </span>
                          {r.product.stokMin > 0 && (
                            <span className="tabular-nums">
                              min {formatAngka(r.product.stokMin)}
                            </span>
                          )}
                          {r.low && (
                            <span className="font-semibold text-warn">
                              ⚠ menipis
                            </span>
                          )}
                        </>
                      }
                      value={formatRupiah(r.value)}
                      note={
                        r.qty > 0
                          ? `${formatRupiah(r.unitCost)}/${satuan}`
                          : `—/${satuan}`
                      }
                    />
                  );
                })}
              </MobileList>
            </div>

            <div className="overflow-x-auto hidden md:block">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Produk</th>
                  <th className={`${thClass} text-right`}>Stok</th>
                  <th className={thClass}>Satuan</th>
                  <th className={`${thClass} text-right`}>Min</th>
                  <th className={`${thClass} text-right`}>Modal/satuan</th>
                  <th className={`${thClass} text-right`}>Nilai</th>
                  <ByHeaders show={bothBy(showBy)} className={thClass} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const satuan = r.product.satuan ?? "satuan";
                  return (
                    <tr
                      key={r.product.id}
                      className={`hover:bg-surface-sunken ${r.low ? "bg-warn-soft" : ""}`}
                    >
                      <td className={tdClass}>
                        <Link
                          to="/produk/$id"
                          params={{ id: r.product.id }}
                          className="text-brand hover:underline font-medium"
                        >
                          {r.product.namaProduk}
                        </Link>
                        {r.low && (
                          <span className="ml-2 text-xs font-semibold text-warn">
                            ⚠ menipis
                          </span>
                        )}
                      </td>
                      <td
                        className={`${tdClass} text-right tabular-nums font-semibold ${
                          r.qty < 0 ? "text-danger" : ""
                        }`}
                      >
                        {formatAngka(r.qty)}
                      </td>
                      <td className={tdClass}>{satuan}</td>
                      <td
                        className={`${tdClass} text-right tabular-nums text-faint`}
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
                      <ByCells
                        show={bothBy(showBy)}
                        row={r.product}
                        className={tdClass}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
