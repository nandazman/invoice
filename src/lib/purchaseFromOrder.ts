import type { OrderItem, Product, PurchaseItem } from "./types";
import { uid, nowISO } from "./format";

// How many BASE units one `satuan` label represents for a product (base unit = 1,
// otherwise the matching konversi's `jumlah`; unknown labels fall back to 1).
// Mirrors the resolver in store.ts so the in/out quantities reconcile.
export function baseUnitsFor(product: Product, satuan: string): number {
  if (product.satuan && satuan === product.satuan) return 1;
  const conv = product.konversi.find((k) => k.nama === satuan);
  return conv ? conv.jumlah : 1;
}

// Default buy cost (modal) for one `satuan` of this product: hargaDasar per base
// unit × base units in the chosen unit. This is the COST, not the order's selling
// price — a purchase should default to what the item costs to buy.
export function modalCostFor(product: Product, satuan: string): number {
  return product.hargaDasar * baseUnitsFor(product, satuan);
}

// Convert a selected order item into a Beli Stock purchase line. Product/unit/qty
// carry over from the order; the price defaults to the product's modal cost, not
// the order's selling `hargaSatuan`. Callers may override kuantitas/hargaSatuan
// (the modal lets the user tweak them) — pass them via `overrides`.
export function purchaseFromOrderItem(
  order: OrderItem,
  product: Product | undefined,
  overrides?: { kuantitas?: number; hargaSatuan?: number },
): PurchaseItem {
  const kuantitas = overrides?.kuantitas ?? order.kuantitas;
  const hargaSatuan =
    overrides?.hargaSatuan ??
    (product ? modalCostFor(product, order.satuan) : 0);
  const now = nowISO();
  return {
    id: uid(),
    tanggal: order.tanggal,
    productId: order.productId,
    namaProduk: order.namaProduk,
    satuan: order.satuan,
    kuantitas,
    hargaSatuan,
    totalHarga: kuantitas * hargaSatuan,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}
