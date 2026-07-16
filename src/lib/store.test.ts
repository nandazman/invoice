import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
    },
  });
});
import type { OrderItem, Product, PurchaseItem } from "./types";
import {
  addPurchase,
  deletePurchase,
  getStock,
  setProducts,
  setPurchases,
  setStock,
} from "./store";

const product: Product = {
  id: "p1", namaProduk: "Almond", tipe: "Bar", ukuran: null,
  satuan: "pcs", hargaDasar: 2000, hargaJual: 5000, konversi: [],
  stokMin: 0, createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
};
const purchase: PurchaseItem = {
  id: "buy-1", tanggal: "2026-07-16", productId: "p1",
  namaProduk: "Almond", satuan: "pcs", kuantitas: 5,
  hargaSatuan: 2000, totalHarga: 10000,
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
};
const order: OrderItem = {
  id: "order-1", tanggal: "2026-07-16", productId: "p1",
  namaProduk: "Almond", satuan: "pcs", kuantitas: 5,
  hargaSatuan: 5000, totalHarga: 25000, status: "pending", affectsStock: false,
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
};

afterEach(() => {
  setProducts([]); setPurchases([]); setStock([]);
});

describe("addPurchase", () => {
  it("links the original order and removes both movements when deleted", () => {
    setProducts([product]);
    addPurchase(purchase, "from order", order);

    expect(getStock()).toMatchObject([
      { qty: 5, reason: "purchase", purchaseId: "buy-1", orderId: null },
      { qty: -5, reason: "sale", purchaseId: "buy-1", orderId: "order-1" },
    ]);
    expect(getStock().reduce((sum, movement) => sum + movement.qty, 0)).toBe(0);

    deletePurchase(purchase.id);
    expect(getStock()).toEqual([]);
  });
});
