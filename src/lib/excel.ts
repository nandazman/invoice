import type ExcelJSNS from "exceljs";
import type { LineItem } from "./types";
import { formatTanggalID } from "./format";

const HEADER_FULL = ["Tanggal", "Nama Produk", "Kuantitas", "Harga Satuan", "Total Harga"];
const HEADER_SUMMARY = ["Tanggal", "Nama Produk", "Kuantitas"];
const NUM_FMT = "#,##0";

const HEADER_FILL = "FF4F81BD";
const SUBTOTAL_FILL = "FFDCE6F1";
const GRAND_FILL = "FFC5D9F1";
const BORDER_COLOR = "FFB0B0B0";

function thinBorder(): ExcelJSNS.Borders {
  const side = { style: "thin" as const, color: { argb: BORDER_COLOR } };
  return { top: side, left: side, right: side, bottom: side } as ExcelJSNS.Borders;
}

function fill(argb: string): ExcelJSNS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function groupByDate(items: LineItem[]): Map<string, LineItem[]> {
  const byDate = new Map<string, LineItem[]>();
  for (const it of items) {
    const arr = byDate.get(it.tanggal) ?? [];
    arr.push(it);
    byDate.set(it.tanggal, arr);
  }
  return byDate;
}

export async function buildOrdersWorkbook(
  items: LineItem[],
  opts?: { sheetName?: string; showPrice?: boolean },
): Promise<ExcelJSNS.Buffer> {
  // Lazy-load exceljs so the heavy library is only fetched on export,
  // keeping it out of the main app bundle.
  const { default: ExcelJS } = await import("exceljs");
  const showPrice = opts?.showPrice ?? true;
  // Last populated column: price mode spans A–E, summary mode only A–C.
  const lastCol = showPrice ? 5 : 3;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts?.sheetName ?? "Orders");

  ws.columns = showPrice
    ? [{ width: 16 }, { width: 26 }, { width: 11 }, { width: 14 }, { width: 16 }]
    : [{ width: 16 }, { width: 26 }, { width: 11 }];

  // Header row.
  const header = ws.addRow(showPrice ? HEADER_FULL : HEADER_SUMMARY);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = fill(HEADER_FILL);
    cell.alignment = { horizontal: "center" };
    cell.border = thinBorder();
  });

  const byDate = groupByDate(items);
  const dates = [...byDate.keys()].sort();
  const subtotalCells: string[] = [];

  for (const iso of dates) {
    const group = byDate.get(iso)!;
    const firstRow = ws.rowCount + 1;

    group.forEach((it, i) => {
      const r = ws.addRow(
        showPrice
          ? [i === 0 ? formatTanggalID(iso) : null, it.namaProduk, it.kuantitas, it.hargaSatuan, null]
          : [i === 0 ? formatTanggalID(iso) : null, it.namaProduk, it.kuantitas],
      );
      const rowNum = r.number;

      if (showPrice) {
        const dCell = r.getCell(4);
        dCell.numFmt = NUM_FMT;

        const eCell = r.getCell(5);
        eCell.value = { formula: `C${rowNum}*D${rowNum}` };
        eCell.numFmt = NUM_FMT;
      }

      r.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col >= 1 && col <= lastCol) cell.border = thinBorder();
      });
    });

    const lastRow = ws.rowCount;

    // Merge the Tanggal cell vertically when the group has more than one row.
    if (lastRow > firstRow) {
      ws.mergeCells(`A${firstRow}:A${lastRow}`);
    }
    const tanggalCell = ws.getCell(`A${firstRow}`);
    tanggalCell.alignment = { horizontal: "center", vertical: "middle" };

    // Subtotal/grand-total rows only make sense when prices are shown; in
    // summary mode the sheet is just a grouped listing with no money totals.
    if (!showPrice) continue;

    // Subtotal row.
    const sub = ws.addRow([null, `Total ${formatTanggalID(iso)}`, null, null, null]);
    const subNum = sub.number;
    const bCell = sub.getCell(2);
    bCell.font = { bold: true };
    const eSub = sub.getCell(5);
    eSub.value = { formula: `SUM(E${firstRow}:E${lastRow})` };
    eSub.numFmt = NUM_FMT;
    eSub.font = { bold: true };
    sub.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col >= 1 && col <= lastCol) {
        cell.fill = fill(SUBTOTAL_FILL);
        cell.border = thinBorder();
      }
    });
    subtotalCells.push(`E${subNum}`);
  }

  // Grand total row.
  if (showPrice && subtotalCells.length > 0) {
    const grand = ws.addRow([null, "Total Keseluruhan", null, null, null]);
    const bCell = grand.getCell(2);
    bCell.font = { bold: true };
    const eGrand = grand.getCell(5);
    eGrand.value = { formula: subtotalCells.join("+") };
    eGrand.numFmt = NUM_FMT;
    eGrand.font = { bold: true };
    grand.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col >= 1 && col <= lastCol) {
        cell.fill = fill(GRAND_FILL);
        cell.border = thinBorder();
      }
    });
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];

  return wb.xlsx.writeBuffer();
}

export async function downloadOrdersXLSX(
  items: LineItem[],
  opts?: { sheetName?: string; filename?: string; showPrice?: boolean },
): Promise<void> {
  const buf = await buildOrdersWorkbook(items, opts);
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = opts?.filename ?? "order.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}
