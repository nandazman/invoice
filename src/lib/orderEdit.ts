import type { OrderItem, OrderStatus, Product, StockMovement } from "./types";
import { baseUnitsFor } from "./purchaseFromOrder";
import { diff } from "./audit";

// Every field the Edit dialog can change on one order. totalHarga is not here:
// it is always kuantitas × hargaSatuan, derived below so the two cannot drift.
export interface OrderEdit {
  tanggal: string;
  buyerId: string;
  productId: string;
  namaProduk: string;
  satuan: string;
  kuantitas: number;
  hargaSatuan: number;
  // Harga Dasar per chosen unit; null clears the snapshot (reports fall back to
  // the price list again).
  modalSatuan: number | null;
  status: OrderStatus;
}

export interface MovementChange {
  prev: StockMovement;
  next: StockMovement;
}

export interface OrderEditPlan {
  next: OrderItem;
  // The order's own sale movements that must follow the edit. Empty when the
  // order never touched stock or the edit does not move stock.
  moves: MovementChange[];
  changes: { field: string; from: unknown; to: unknown }[];
}

const FIELDS: (keyof OrderEdit)[] = [
  "tanggal",
  "buyerId",
  "productId",
  "namaProduk",
  "satuan",
  "kuantitas",
  "hargaSatuan",
  "modalSatuan",
  "status",
];

// Work out what an edit changes, without writing anything. The Edit dialog uses
// `moves` to warn before saving; the store uses the same plan to write, so the
// warning and the write can never disagree.
//
// Only the order's SALE movements follow the edit (qty, date, product). A linked
// Beli Stok purchase is a separate real-world buy and is left alone, so editing
// the qty of a "Beli stok" order changes net stock by the difference: that is
// exactly what the confirmation tells the user.
export function planOrderEdit(
  prev: OrderItem,
  edit: Partial<OrderEdit>,
  products: Product[],
  stock: StockMovement[],
): OrderEditPlan {
  const merged = { ...prev, ...edit };
  const next: OrderItem = {
    ...merged,
    totalHarga: merged.kuantitas * merged.hargaSatuan,
  };
  // modalSatuan is optional on legacy rows; treat missing and null as the same
  // "no snapshot" so an untouched legacy row does not log a phantom change.
  const before = { ...prev, modalSatuan: prev.modalSatuan ?? null };
  const after = { ...next, modalSatuan: next.modalSatuan ?? null };
  const changes = diff(before, after, FIELDS);

  const product =
    products.find((p) => p.id === next.productId) ??
    products.find((p) => p.namaProduk === next.namaProduk);
  const moves: MovementChange[] = [];
  for (const m of stock) {
    if (m.orderId !== prev.id || m.reason !== "sale") continue;
    const moved: StockMovement = {
      ...m,
      tanggal: next.tanggal,
      ...(product
        ? {
            productId: product.id,
            satuan: product.satuan ?? "",
            qty: -Math.abs(next.kuantitas * baseUnitsFor(product, next.satuan)),
          }
        : {}),
    };
    if (
      moved.tanggal !== m.tanggal ||
      moved.productId !== m.productId ||
      moved.qty !== m.qty ||
      moved.satuan !== m.satuan
    ) {
      moves.push({ prev: m, next: moved });
    }
  }
  return { next, moves, changes };
}
