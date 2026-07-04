import type { OrderItem } from "./types";
import { formatTanggalID, formatRupiah, formatAngka } from "./format";

// Render the staged orders as a table image (PNG), grouped by date with
// subtotals and a grand total — mirroring the XLSX layout. Drawn directly on a
// canvas so no rendering dependency is needed. Useful for pasting into chat
// apps (WhatsApp/Telegram) or saving as a picture.

type Col = { key: string; label: string; width: number; align: "left" | "right" };

const COLS: Col[] = [
  { key: "tanggal", label: "Tanggal", width: 130, align: "left" },
  { key: "produk", label: "Nama Produk", width: 230, align: "left" },
  { key: "qty", label: "Kuantitas", width: 100, align: "right" },
  { key: "harga", label: "Harga Satuan", width: 140, align: "right" },
  { key: "total", label: "Total Harga", width: 150, align: "right" },
];

const PAD = 10; // horizontal cell padding
const ROW_H = 34;
const HEADER_H = 38;
const FONT = "13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
const FONT_BOLD =
  "bold 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

const HEADER_FILL = "#4F81BD";
const SUBTOTAL_FILL = "#DCE6F1";
const GRAND_FILL = "#C5D9F1";
const BORDER = "#B0B0B0";
const TEXT = "#1e293b";

function groupByDate(items: OrderItem[]): [string, OrderItem[]][] {
  const byDate = new Map<string, OrderItem[]>();
  for (const it of items) {
    const arr = byDate.get(it.tanggal) ?? [];
    arr.push(it);
    byDate.set(it.tanggal, arr);
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function renderOrdersImage(items: OrderItem[]): Promise<Blob> {
  const groups = groupByDate(items);

  // Count total drawn rows: header + (item rows + subtotal per group) + grand.
  let bodyRows = 0;
  for (const [, grp] of groups) bodyRows += grp.length + 1;
  const grandRows = groups.length > 0 ? 1 : 0;

  const width = COLS.reduce((s, c) => s + c.width, 0);
  const height = HEADER_H + bodyRows * ROW_H + grandRows * ROW_H;

  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas tidak didukung"));
  const g: CanvasRenderingContext2D = ctx;
  g.scale(dpr, dpr);
  g.textBaseline = "middle";

  // Background.
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, width, height);

  const colX: number[] = [];
  let acc = 0;
  for (const c of COLS) {
    colX.push(acc);
    acc += c.width;
  }

  function drawCell(
    text: string,
    colIdx: number,
    y: number,
    opts: { bold?: boolean; color?: string } = {},
  ) {
    const c = COLS[colIdx];
    const x = colX[colIdx];
    g.fillStyle = opts.color ?? TEXT;
    g.font = opts.bold ? FONT_BOLD : FONT;
    g.textAlign = c.align;
    const tx = c.align === "right" ? x + c.width - PAD : x + PAD;
    g.fillText(text, tx, y + ROW_H / 2, c.width - PAD * 2);
  }

  function fillRow(y: number, h: number, color: string) {
    g.fillStyle = color;
    g.fillRect(0, y, width, h);
  }

  function borderRow(y: number, h: number) {
    g.strokeStyle = BORDER;
    g.lineWidth = 1;
    // Cell borders.
    for (let i = 0; i <= COLS.length; i++) {
      const x = i < COLS.length ? colX[i] : width;
      g.beginPath();
      g.moveTo(x + 0.5, y);
      g.lineTo(x + 0.5, y + h);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(width, y + 0.5);
    g.stroke();
    g.beginPath();
    g.moveTo(0, y + h - 0.5);
    g.lineTo(width, y + h - 0.5);
    g.stroke();
  }

  // Header.
  let y = 0;
  fillRow(y, HEADER_H, HEADER_FILL);
  g.textBaseline = "middle";
  COLS.forEach((c, i) => {
    g.fillStyle = "#ffffff";
    g.font = FONT_BOLD;
    g.textAlign = "center";
    g.fillText(c.label, colX[i] + c.width / 2, y + HEADER_H / 2, c.width - PAD * 2);
  });
  borderRow(y, HEADER_H);
  y += HEADER_H;

  const grandTotal = items.reduce((s, it) => s + it.totalHarga, 0);

  for (const [iso, group] of groups) {
    const groupTop = y;
    group.forEach((it, i) => {
      if (i % 2 === 1) fillRow(y, ROW_H, "#f8fafc");
      // Tanggal only on the first row of the group (visual merge).
      if (i === 0) drawCell(formatTanggalID(iso), 0, y);
      drawCell(it.namaProduk, 1, y);
      drawCell(formatAngka(it.kuantitas), 2, y);
      drawCell(formatRupiah(it.hargaSatuan), 3, y);
      drawCell(formatRupiah(it.totalHarga), 4, y);
      borderRow(y, ROW_H);
      y += ROW_H;
    });

    // Erase inner horizontal borders in the Tanggal column to fake a merge.
    if (group.length > 1) {
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1;
      for (let r = 1; r < group.length; r++) {
        const ly = groupTop + r * ROW_H;
        g.beginPath();
        g.moveTo(1, ly + 0.5);
        g.lineTo(colX[1] - 0.5, ly + 0.5);
        g.stroke();
      }
    }

    // Subtotal row.
    const subtotal = group.reduce((s, it) => s + it.totalHarga, 0);
    fillRow(y, ROW_H, SUBTOTAL_FILL);
    drawCell(`Total ${formatTanggalID(iso)}`, 1, y, { bold: true });
    drawCell(formatRupiah(subtotal), 4, y, { bold: true });
    borderRow(y, ROW_H);
    y += ROW_H;
  }

  // Grand total.
  if (grandRows) {
    fillRow(y, ROW_H, GRAND_FILL);
    drawCell("Total Keseluruhan", 1, y, { bold: true });
    drawCell(formatRupiah(grandTotal), 4, y, { bold: true });
    borderRow(y, ROW_H);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Gagal membuat gambar"));
    }, "image/png");
  });
}

export async function copyOrdersImage(items: OrderItem[]): Promise<void> {
  const blob = await renderOrdersImage(items);
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": blob }),
  ]);
}

export async function downloadOrdersImage(items: OrderItem[]): Promise<void> {
  const blob = await renderOrdersImage(items);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "order.png";
  a.click();
  URL.revokeObjectURL(url);
}
