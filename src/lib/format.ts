const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatRupiah(n: number): string {
  return rupiah.format(n);
}

export function formatAngka(n: number): string {
  return new Intl.NumberFormat("id-ID").format(n);
}

// Whole-rupiah rounding used for every displayed money value (formatRupiah uses
// maximumFractionDigits: 0, i.e. Math.round for display).
export function roundRupiah(n: number): number {
  return Math.round(n);
}

// Sum a list of rupiah line totals the way they are displayed: round each line,
// then add. This enforces the invariant Σ(displayed lines) === displayed total,
// so a printed total always equals the sum of the printed per-line amounts.
export function sumRupiah(nums: number[]): number {
  return nums.reduce((s, n) => s + roundRupiah(n), 0);
}

// "2026-06-01" -> "1 Juni 2026"
export function formatTanggalID(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${BULAN[m - 1]} ${y}`;
}

// "1 Juni 2026" -> "2026-06-01" (best effort, for importing legacy order.json)
export function parseTanggalID(text: string): string {
  const m = text.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return text;
  const bulan = BULAN.findIndex(
    (b) => b.toLowerCase() === m[2].toLowerCase(),
  );
  if (bulan < 0) return text;
  const dd = String(Number(m[1])).padStart(2, "0");
  const mm = String(bulan + 1).padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

export function todayISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Full ISO datetime stamp for createdAt/updatedAt.
export function nowISO(): string {
  return new Date().toISOString();
}

// "2026-06-27T08:30:00.000Z" -> "27 Jun 2026, 15.30" (best effort, local time)
export function formatDateTimeID(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = d.getDate();
  const mon = BULAN[d.getMonth()]?.slice(0, 3) ?? "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dd} ${mon} ${d.getFullYear()}, ${hh}.${mm}`;
}
