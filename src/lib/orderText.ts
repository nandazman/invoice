import type { LineItem } from "./types";
import { formatTanggalID, formatRupiah, formatAngka, sumRupiah } from "./format";

// Build a chat-friendly plain-text summary of the staged orders, grouped by
// date with per-date subtotals and a grand total. Meant for pasting into
// WhatsApp/Telegram.

function groupByDate(items: LineItem[]): [string, LineItem[]][] {
  const byDate = new Map<string, LineItem[]>();
  for (const it of items) {
    const arr = byDate.get(it.tanggal) ?? [];
    arr.push(it);
    byDate.set(it.tanggal, arr);
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function buildOrdersText(
  items: LineItem[],
  opts?: { title?: string; showPrice?: boolean },
): string {
  const showPrice = opts?.showPrice ?? true;
  const groups = groupByDate(items);
  const lines: string[] = [opts?.title ?? "🧾 Pesanan"];

  for (const [iso, group] of groups) {
    lines.push("");
    lines.push(`📅 ${formatTanggalID(iso)}`);
    for (const it of group) {
      const unit = it.satuan ? ` (${it.satuan})` : "";
      const price = showPrice ? ` — ${formatRupiah(it.totalHarga)}` : "";
      lines.push(`• ${it.namaProduk}${unit} ×${formatAngka(it.kuantitas)}${price}`);
    }
    if (showPrice) {
      const subtotal = sumRupiah(group.map((it) => it.totalHarga));
      lines.push(`  Subtotal: ${formatRupiah(subtotal)}`);
    }
  }

  if (showPrice) {
    const grandTotal = sumRupiah(items.map((it) => it.totalHarga));
    lines.push("");
    lines.push(`💰 Total: ${formatRupiah(grandTotal)}`);
  }

  return lines.join("\n");
}

export async function copyOrdersText(
  items: LineItem[],
  opts?: { title?: string; showPrice?: boolean },
): Promise<void> {
  await navigator.clipboard.writeText(buildOrdersText(items, opts));
}
