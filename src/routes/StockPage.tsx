import { Fragment, useCallback, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Product, StockMovement } from "../lib/types";
import {
  useProducts,
  useStock,
  addMovement,
} from "../lib/store";
import { computeFifo } from "../lib/stock";
import { formatRupiah, formatAngka, formatDateTimeID } from "../lib/format";
import { usePersistentAttribution } from "../lib/columns";
import {
  AttributionToggle,
  ByCell,
  ByCells,
  ByHeaders,
  bothBy,
} from "../components/Attribution";
import { AddMovementForm } from "../components/AddMovementForm";
import { Button, PrimaryButton } from "../components/Button";
import { SearchInput } from "../components/SearchInput";
import { Panel } from "../components/Panel";
import { thClass, tdClass } from "../components/DataTable";
import { AlertIcon, ChevronDownIcon, PlusIcon } from "../components/icons";


interface Row {
  product: Product;
  qty: number; // current stock, base units
  unitCost: number; // effective FIFO cost per base unit on hand
  value: number; // remaining inventory value (FIFO)
  low: boolean;
}

// The status a Stok row can carry: running low. Same pill as Pesanan's badges,
// shown only when it applies so the table stays quiet.
function LowBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warn-line bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn whitespace-nowrap">
      <AlertIcon className="h-3 w-3" /> menipis
    </span>
  );
}

export function StockPage() {
  const products = useProducts();
  const stock = useStock();
  const [cari, setCari] = useState("");
  const [adding, setAdding] = useState(false);
  // Phone rows whose detail card is open.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
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
      <div className="hidden md:flex items-start gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold mb-1">Stok</h1>
          <p className="text-faint">
            Catat stok masuk & keluar, pantau stok menipis, dan nilai persediaan.
          </p>
        </div>
        {products.length > 0 && (
          <PrimaryButton onClick={() => setAdding(true)}>
            <PlusIcon /> Tambah
          </PrimaryButton>
        )}
      </div>

      {products.length === 0 && (
        <Panel className="text-center text-faint py-8">
          Belum ada produk. Tambahkan produk di halaman <b>Harga</b> dulu.
        </Panel>
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
          {/* Phone: one switch for every row's detail card. Desktop keeps the
              attribution toggle instead. */}
          <Button
            size="sm"
            className="md:!hidden"
            onClick={() =>
              setExpanded(
                expanded.size > 0
                  ? new Set()
                  : new Set(rows.map((r) => r.product.id)),
              )
            }
          >
            <ChevronDownIcon
              className={expanded.size > 0 ? "rotate-180" : undefined}
            />
            {expanded.size > 0 ? "Tutup semua" : "Buka semua"}
          </Button>
          <div className="hidden md:block">
            <AttributionToggle show={showBy} onChange={setShowBy} />
          </div>
          <div className="flex gap-2 w-full md:w-56">
            <SearchInput
              className="flex-1"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari produk…"
              aria-label="Cari produk"
            />
            {products.length > 0 && (
              <PrimaryButton
                className="md:hidden"
                onClick={() => setAdding(true)}
              >
                <PlusIcon /> Tambah
              </PrimaryButton>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="text-center text-faint py-8">
            {cari ? "Tidak ada produk cocok." : "Belum ada produk."}
          </div>
        ) : (
          <>
            {/* The phone layout: a row is product, low-stock badge and value;
                tapping it opens a label / value card with the rest. */}
            <div className="md:hidden">
              {rows.map((r) => (
                <PhoneRow
                  key={r.product.id}
                  row={r}
                  open={expanded.has(r.product.id)}
                  onToggleOpen={() => toggleExpanded(r.product.id)}
                />
              ))}
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
                    <tr key={r.product.id} className="hover:bg-surface-sunken">
                      <td className={tdClass}>
                        <Link
                          to="/produk/$id"
                          params={{ id: r.product.id }}
                          className="text-brand hover:underline font-medium"
                        >
                          {r.product.namaProduk}
                        </Link>
                        {r.low && (
                          <span className="ml-2">
                            <LowBadge />
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

      {adding && (
        <AddMovementForm
          products={products}
          onAdd={addMovements}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

// One phone row. A Stok row is a product with derived figures, so there is
// nothing to edit here (movements are added from Tambah); the card ends in a
// link to the product instead of Edit.
function PhoneRow({
  row: r,
  open,
  onToggleOpen,
}: {
  row: Row;
  open: boolean;
  onToggleOpen: () => void;
}) {
  const satuan = r.product.satuan ?? "satuan";
  const kv: [string, React.ReactNode][] = [
    [
      "Stok",
      <span key="s" className={r.qty < 0 ? "text-danger" : r.low ? "text-warn" : ""}>
        {formatAngka(r.qty)} {satuan}
      </span>,
    ],
    ["Min", r.product.stokMin > 0 ? formatAngka(r.product.stokMin) : "—"],
    ["Modal/satuan", r.qty > 0 ? formatRupiah(r.unitCost) : "—"],
    ["Nilai", formatRupiah(r.value)],
    ["Dibuat", formatDateTimeID(r.product.createdAt)],
    ["Diperbarui", formatDateTimeID(r.product.updatedAt)],
    ["Dibuat oleh", <ByCell key="c" email={r.product.createdBy} />],
    ["Diperbarui oleh", <ByCell key="u" email={r.product.updatedBy} />],
  ];
  return (
    <div className="border-b border-line">
      <div
        className="flex items-center gap-2 px-3 min-h-11 cursor-pointer"
        onClick={onToggleOpen}
      >
        <button
          type="button"
          aria-expanded={open}
          className="flex-1 min-w-0 text-left font-medium break-words py-1"
        >
          {r.product.namaProduk}
        </button>
        {r.low && <LowBadge />}
        <span className="tabular-nums font-medium whitespace-nowrap">
          {formatRupiah(r.value)}
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-faint ${open ? "rotate-180" : ""}`}
        />
      </div>

      {open && (
        <div className="bg-surface-sunken border-t border-line px-3 py-3 text-sm">
          <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1.5">
            {kv.map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-faint">{label}</dt>
                <dd className="text-right tabular-nums font-medium break-words">
                  {value}
                </dd>
              </Fragment>
            ))}
          </dl>
          <div className="flex justify-end mt-3">
            <Link to="/produk/$id" params={{ id: r.product.id }}>
              <Button size="sm" tabIndex={-1}>
                Buka produk
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
