import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildOrdersWorkbook } from "./excel";
import { sumRupiah } from "./format";
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

async function loadSheet(items: LineItem[], showPrice = true) {
  const buf = await buildOrdersWorkbook(items, { showPrice });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb.worksheets[0];
}

// Minimal evaluator for the ROUND(Cn*Dn,0) / SUM(range) / cell-add formulas we
// emit, so we can assert the sheet's totals numerically match sumRupiah.
function evalSheet(ws: ExcelJS.Worksheet): Map<string, number> {
  const vals = new Map<string, number>();
  const cellNum = (addr: string): number => {
    if (vals.has(addr)) return vals.get(addr)!;
    const cell = ws.getCell(addr);
    const v = cell.value as unknown;
    let n = 0;
    if (typeof v === "number") n = v;
    else if (v && typeof v === "object" && "formula" in v) {
      n = evalFormula((v as { formula: string }).formula);
    }
    vals.set(addr, n);
    return n;
  };
  const evalFormula = (f: string): number => {
    let m: RegExpMatchArray | null;
    if ((m = f.match(/^ROUND\((\w+)\*(\w+),0\)$/))) {
      return Math.round(cellNum(m[1]) * cellNum(m[2]));
    }
    if ((m = f.match(/^SUM\((\w+):(\w+)\)$/))) {
      const [c1, r1] = splitRef(m[1]);
      const [, r2] = splitRef(m[2]);
      let s = 0;
      for (let r = r1; r <= r2; r++) s += cellNum(`${c1}${r}`);
      return s;
    }
    // cell + cell + ... (grand total)
    return f.split("+").reduce((s, ref) => s + cellNum(ref.trim()), 0);
  };
  const splitRef = (ref: string): [string, number] => {
    const mm = ref.match(/^([A-Z]+)(\d+)$/)!;
    return [mm[1], Number(mm[2])];
  };

  ws.eachRow((row) => {
    row.eachCell((cell) => {
      cellNum(cell.address);
    });
  });
  return vals;
}

describe("buildOrdersWorkbook", () => {
  it("writes ROUND(C*D,0) line formulas, SUM subtotals, and an additive grand total", async () => {
    const ws = await loadSheet([
      line({ tanggal: "2026-06-01", kuantitas: 2, hargaSatuan: 500, totalHarga: 1000 }),
      line({ tanggal: "2026-06-01", kuantitas: 3, hargaSatuan: 400, totalHarga: 1200 }),
    ]);
    // Row 1 header, rows 2-3 items, row 4 subtotal, row 5 grand.
    const e2 = ws.getCell("E2").value as { formula: string };
    expect(e2.formula).toBe("ROUND(C2*D2,0)");
    const sub = ws.getCell("E4").value as { formula: string };
    expect(sub.formula).toBe("SUM(E2:E3)");
    const grand = ws.getCell("E5").value as { formula: string };
    expect(grand.formula).toBe("E4");
  });

  it("keeps the money invariant: evaluated grand total === sumRupiah (fractional qty)", async () => {
    const items = [
      line({ tanggal: "2026-06-01", kuantitas: 0.1, hargaSatuan: 3333, totalHarga: 333.3 }),
      line({ tanggal: "2026-06-01", kuantitas: 0.1, hargaSatuan: 3333, totalHarga: 333.3 }),
      line({ tanggal: "2026-06-01", kuantitas: 0.1, hargaSatuan: 3333, totalHarga: 333.3 }),
    ];
    const ws = await loadSheet(items);
    const vals = evalSheet(ws);
    // Grand total lives in the last row's E cell.
    const grandAddr = `E${ws.rowCount}`;
    expect(vals.get(grandAddr)).toBe(999);
    expect(vals.get(grandAddr)).toBe(sumRupiah(items.map((i) => i.totalHarga)));
  });

  it("evaluated totals match sumRupiah across multiple dates (parity)", async () => {
    const items = [
      line({ tanggal: "2026-06-01", kuantitas: 0.1, hargaSatuan: 3333, totalHarga: 333.3 }),
      line({ tanggal: "2026-06-01", kuantitas: 0.1, hargaSatuan: 3333, totalHarga: 333.3 }),
      line({ tanggal: "2026-06-02", kuantitas: 2, hargaSatuan: 750, totalHarga: 1500 }),
    ];
    const ws = await loadSheet(items);
    const vals = evalSheet(ws);
    const grandAddr = `E${ws.rowCount}`;
    expect(vals.get(grandAddr)).toBe(sumRupiah(items.map((i) => i.totalHarga))); // 666 + 1500 = 2166
  });

  it("summary mode (showPrice: false) writes no price columns or totals", async () => {
    const ws = await loadSheet([line()], false);
    expect(ws.columnCount).toBeLessThanOrEqual(3);
    // No 'Total Keseluruhan' row.
    let hasGrand = false;
    ws.eachRow((row) => {
      if (row.getCell(2).value === "Total Keseluruhan") hasGrand = true;
    });
    expect(hasGrand).toBe(false);
  });
});
