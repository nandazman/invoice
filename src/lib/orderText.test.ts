import { describe, it, expect } from "vitest";
import { buildOrdersText } from "./orderText";
import { sumRupiah, formatRupiah, formatTanggalID } from "./format";
import type { LineItem } from "./types";

function line(over: Partial<LineItem> = {}): LineItem {
  return {
    tanggal: "2026-06-01",
    namaProduk: "Produk",
    satuan: "pcs",
    kuantitas: 1,
    hargaSatuan: 1000,
    totalHarga: 1000,
    ...over,
  };
}

describe("buildOrdersText totals", () => {
  it("grand total equals sumRupiah over all lines (fractional case: 999 not 1000)", () => {
    const items = [
      line({ kuantitas: 0.1, hargaSatuan: 3333, totalHarga: 333.3 }),
      line({ kuantitas: 0.1, hargaSatuan: 3333, totalHarga: 333.3 }),
      line({ kuantitas: 0.1, hargaSatuan: 3333, totalHarga: 333.3 }),
    ];
    const text = buildOrdersText(items);
    expect(text).toContain(`💰 Total: ${formatRupiah(999)}`);
    expect(text).not.toContain(formatRupiah(1000));
  });

  it("subtotal per date equals the sum of that date's displayed lines", () => {
    const items = [
      line({ tanggal: "2026-06-01", totalHarga: 333.3 }),
      line({ tanggal: "2026-06-01", totalHarga: 333.3 }),
      line({ tanggal: "2026-06-02", totalHarga: 500 }),
    ];
    const text = buildOrdersText(items);
    const sub1 = sumRupiah([333.3, 333.3]); // 666
    expect(text).toContain(`Subtotal: ${formatRupiah(sub1)}`);
    expect(text).toContain(`Subtotal: ${formatRupiah(500)}`);
  });

  it("grand total equals the sum of the per-date subtotals", () => {
    const items = [
      line({ tanggal: "2026-06-01", totalHarga: 333.3 }),
      line({ tanggal: "2026-06-01", totalHarga: 333.3 }),
      line({ tanggal: "2026-06-02", totalHarga: 500.4 }),
    ];
    const sub1 = sumRupiah([333.3, 333.3]); // 666
    const sub2 = sumRupiah([500.4]); // 500
    const grand = sumRupiah([333.3, 333.3, 500.4]); // 1166
    expect(grand).toBe(sub1 + sub2);
    expect(buildOrdersText(items)).toContain(`💰 Total: ${formatRupiah(grand)}`);
  });

  it("omits money when showPrice is false", () => {
    const text = buildOrdersText([line()], { showPrice: false });
    expect(text).not.toContain("Total:");
    expect(text).not.toContain("Subtotal:");
    expect(text).toContain(formatTanggalID("2026-06-01"));
  });
});
