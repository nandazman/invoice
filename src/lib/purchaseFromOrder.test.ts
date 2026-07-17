import { describe, it, expect } from "vitest";
import type { OrderItem, Product } from "./types";
import {
  baseUnitsFor,
  modalCostFor,
  purchaseFromOrderItem,
} from "./purchaseFromOrder";

const product: Product = {
  id: "p1",
  namaProduk: "Almond Kacang",
  tipe: "Bar",
  ukuran: null,
  satuan: "pcs",
  hargaDasar: 2000, // cost per base unit (modal)
  hargaJual: 5000, // selling price per base unit
  konversi: [{ nama: "box", jumlah: 12, harga: 24000 }],
  stokMin: 0,
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
  deletedAt: null,
};

function order(over: Partial<OrderItem> = {}): OrderItem {
  return {
    id: "o1",
    tanggal: "2026-07-15",
    productId: "p1",
    namaProduk: "Almond Kacang",
    satuan: "pcs",
    kuantitas: 5,
    hargaSatuan: 5000, // SELLING price on the order
    totalHarga: 25000,
    status: "pending",
    affectsStock: true,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    deletedAt: null,
    ...over,
  };
}

describe("baseUnitsFor", () => {
  it("returns 1 for the base unit", () => {
    expect(baseUnitsFor(product, "pcs")).toBe(1);
  });
  it("returns the konversi jumlah for a packaging unit", () => {
    expect(baseUnitsFor(product, "box")).toBe(12);
  });
  it("falls back to 1 for an unknown unit label", () => {
    expect(baseUnitsFor(product, "karung")).toBe(1);
  });
});

describe("modalCostFor", () => {
  it("uses hargaDasar for a base unit", () => {
    expect(modalCostFor(product, "pcs")).toBe(2000);
  });
  it("scales hargaDasar by base units for a konversi unit", () => {
    expect(modalCostFor(product, "box")).toBe(24000); // 2000 × 12
  });
});

describe("purchaseFromOrderItem", () => {
  it("carries product/unit/qty/date from the order", () => {
    const p = purchaseFromOrderItem(order(), product);
    expect(p.productId).toBe("p1");
    expect(p.namaProduk).toBe("Almond Kacang");
    expect(p.satuan).toBe("pcs");
    expect(p.kuantitas).toBe(5);
    expect(p.tanggal).toBe("2026-07-15");
  });

  it("defaults the price to the modal COST, not the order's selling price", () => {
    const p = purchaseFromOrderItem(order(), product);
    expect(p.hargaSatuan).toBe(2000); // modal, not the 5000 selling price
    expect(p.totalHarga).toBe(10000); // 5 × 2000
  });

  it("uses the konversi modal cost when the ordered unit is a package", () => {
    const p = purchaseFromOrderItem(
      order({ satuan: "box", kuantitas: 2 }),
      product,
    );
    expect(p.hargaSatuan).toBe(24000);
    expect(p.totalHarga).toBe(48000); // 2 × 24000
  });

  it("prices at 0 when the product cannot be resolved", () => {
    const p = purchaseFromOrderItem(order(), undefined);
    expect(p.hargaSatuan).toBe(0);
    expect(p.totalHarga).toBe(0);
  });

  it("honours qty/price overrides and recomputes the total", () => {
    const p = purchaseFromOrderItem(order(), product, {
      kuantitas: 3,
      hargaSatuan: 2500,
    });
    expect(p.kuantitas).toBe(3);
    expect(p.hargaSatuan).toBe(2500);
    expect(p.totalHarga).toBe(7500); // 3 × 2500
  });

  it("generates a fresh id distinct from the order id", () => {
    const p = purchaseFromOrderItem(order(), product);
    expect(p.id).not.toBe("o1");
    expect(p.id).toBeTruthy();
  });
});
