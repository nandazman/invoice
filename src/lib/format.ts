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

// The date presets offered by the shared filter bar.
export type PresetKey =
  | "hari-ini"
  | "kemarin"
  | "7-hari"
  | "bulan-ini"
  | "bulan-lalu";

export const PRESET_LABELS: Record<PresetKey, string> = {
  "hari-ini": "Hari ini",
  kemarin: "Kemarin",
  "7-hari": "7 hari",
  "bulan-ini": "Bulan ini",
  "bulan-lalu": "Bulan lalu",
};

// Local-calendar yyyy-mm-dd. Not toISOString(), which is UTC and shifts the day
// for anyone east/west of Greenwich.
function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// [from, to] as inclusive ISO dates for a preset. `now` is injectable so the
// tests can pin a date; callers pass one argument.
//
// Month boundaries lean on Date's overflow normalisation: new Date(y, m + 1, 0)
// is "day 0 of next month" = the last day of month m, and a month index of -1
// rolls back into December of the previous year (the January `bulan-lalu` case).
export function presetRange(
  key: PresetKey,
  now: Date = new Date(),
): [string, string] {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (key) {
    case "hari-ini": {
      const today = isoLocal(new Date(y, m, d));
      return [today, today];
    }
    case "kemarin": {
      const yest = isoLocal(new Date(y, m, d - 1));
      return [yest, yest];
    }
    case "7-hari":
      // Inclusive of today, so 7 calendar days total.
      return [isoLocal(new Date(y, m, d - 6)), isoLocal(new Date(y, m, d))];
    case "bulan-ini":
      return [isoLocal(new Date(y, m, 1)), isoLocal(new Date(y, m + 1, 0))];
    case "bulan-lalu":
      return [isoLocal(new Date(y, m - 1, 1)), isoLocal(new Date(y, m, 0))];
  }
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
