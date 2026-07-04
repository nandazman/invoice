import type { OrderItem } from "./types";
import { formatTanggalID, formatRupiah, formatAngka } from "./format";

// Build a chat-friendly plain-text summary of the staged orders, grouped by
// date with per-date subtotals and a grand total. Meant for pasting into
// WhatsApp/Telegram.

function groupByDate(items: OrderItem[]): [string, OrderItem[]][] {
  const byDate = new Map<string, OrderItem[]>();
  for (const it of items) {
    const arr = byDate.get(it.tanggal) ?? [];
    arr.push(it);
    byDate.set(it.tanggal, arr);
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function buildOrdersText(items: OrderItem[]): string {
  const groups = groupByDate(items);
  const lines: string[] = ["🧾 Pesanan"];

  for (const [iso, group] of groups) {
    lines.push("");
    lines.push(`📅 ${formatTanggalID(iso)}`);
    for (const it of group) {
      const unit = it.satuan ? ` (${it.satuan})` : "";
      lines.push(
        `• ${it.namaProduk}${unit} ×${formatAngka(it.kuantitas)} — ${formatRupiah(it.totalHarga)}`,
      );
    }
    const subtotal = group.reduce((s, it) => s + it.totalHarga, 0);
    lines.push(`  Subtotal: ${formatRupiah(subtotal)}`);
  }

  const grandTotal = items.reduce((s, it) => s + it.totalHarga, 0);
  lines.push("");
  lines.push(`💰 Total: ${formatRupiah(grandTotal)}`);

  return lines.join("\n");
}

export async function copyOrdersText(items: OrderItem[]): Promise<void> {
  await navigator.clipboard.writeText(buildOrdersText(items));
}
