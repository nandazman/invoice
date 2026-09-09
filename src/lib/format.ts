const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

// The symbol-less twin of `rupiah`: same whole-rupiah rounding, no "Rp". Kept
// as a sibling Intl instance (not derived from `rupiah`) so both share the
// `maximumFractionDigits: 0` option by construction rather than by a caller
// remembering to pass it.
const angkaUang = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

// Anything that rounds to zero prints as "0", never "-0". Intl keeps the sign
// of -0 and of any small negative, so a float residue left by a division — or
// a subtraction of two equal amounts, like the Laba column's hargaJual minus
// hargaDasar — surfaced as a minus sign on a zero, which reads as a loss that
// is not there. Both money formatters below apply this before formatting, so
// they can't drift apart on it.
function zeroGuard(n: number): number {
  return Math.round(n) === 0 ? 0 : n;
}

export function formatRupiah(n: number): string {
  return rupiah.format(zeroGuard(n));
}

// Whole-rupiah amount without the currency symbol, for a column (like Prices'
// "Rp" header) that states the currency once instead of on every row.
export function formatUang(n: number): string {
  return angkaUang.format(zeroGuard(n));
}

// Plain thousands-grouped number, no currency semantics: no fraction
// rounding, no -0 guard. Used for byte counts, quantities, and the like —
// values that were never money and don't need money's rules.
export function formatAngka(n: number): string {
  return new Intl.NumberFormat("id-ID").format(n);
}

// A signed percentage with one decimal, in Indonesian notation: "34,3%",
// "-12,0%". Null (no revenue to divide by) has no percentage to print — see
// `marginOf` in report.ts — and shows as an em dash.
export function formatPersen(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const s = new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
  return `${s}%`;
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

// "2026-06" (or a full ISO date) -> "Jun 2026". The chart's x-axis: the full
// month name does not fit under a bar on a phone, and the year has to stay —
// two Julis from different years side by side is the one label that misleads.
export function formatBulanPendek(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return iso;
  return `${BULAN[m - 1].slice(0, 3)} ${y}`;
}

// Money shortened to fit a chart label: "Rp 1,2 jt", "Rp 950 rb". Only ever for
// a bar's caption, never for a figure the user might copy into a total — the
// rounding here is deliberately lossy, and every real amount on Laporan still
// prints through `formatRupiah`.
export function formatRupiahRingkas(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const short = (v: number, suffix: string) =>
    `${sign}Rp ${new Intl.NumberFormat("id-ID", {
      maximumFractionDigits: v < 10 ? 1 : 0,
    }).format(v)} ${suffix}`;
  if (abs >= 1_000_000_000) return short(abs / 1_000_000_000, "M");
  if (abs >= 1_000_000) return short(abs / 1_000_000, "jt");
  if (abs >= 1_000) return short(abs / 1_000, "rb");
  return formatRupiah(n);
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

// The last stamp handed out, so the next one can be forced past it.
let lastStamp = "";

// Full ISO datetime stamp for createdAt/updatedAt.
//
// STRICTLY INCREASING, which is a sync requirement rather than a display one.
// `updatedAt` is the sync cursor (tables.ts), and the sweep in sync/client.ts
// keeps a single scalar watermark per table: rows are pending when
// `updatedAt > watermark`. That only works if no two rows in a table can share
// a cursor value — if they do, a push advances the watermark to that value on
// the strength of one row and its twin is filtered out on the cursor before
// anything else runs. Not "sent late": never sent, and never reported again.
//
// Date resolution is milliseconds and a single form save fires several
// `persist()` calls (db.ts), so the collision is ordinary rather than exotic.
// Stepping one millisecond past the previous stamp is invisible in every
// display format we use and makes the value unique per tab.
//
// This also absorbs a clock that jumps BACKWARDS — an NTP correction, a user
// fixing their timezone. Stamps carry on increasing and drift back to real time
// as the wall clock catches up, which is what a cursor needs; a cursor that
// went backwards would strand every row written before the jump.
//
// Two tabs in the same millisecond are still theoretically possible, since this
// counter is per-document. That window is much smaller than the one this
// closes, and sync/tabs.ts narrows it further by routing all pushes through a
// single leader tab.
export function nowISO(): string {
  const s = new Date().toISOString();
  const next = s > lastStamp ? s : new Date(Date.parse(lastStamp) + 1).toISOString();
  lastStamp = next;
  return next;
}

// Byte counts for humans: "812 B", "41,2 KB", "3,7 MB". Decimal units (1000,
// not 1024) because that is what Cloudflare's own D1 numbers use, and a size
// that disagrees with the dashboard is worse than no size at all.
export function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n < 1000) return `${formatAngka(Math.round(n))} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const s = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(value);
  return `${s} ${units[unit]}`;
}

// "2 jam lalu". Coarse on purpose — this answers "is sync alive?", so the
// difference between 118 and 119 minutes is noise, while the difference between
// minutes and days is the whole point. Anything in the future (a clock skewed
// between two devices) reads as "baru saja" rather than a negative age.
export function formatRelatifID(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const detik = Math.round((Date.now() - t) / 1000);
  if (detik < 60) return "baru saja";
  const menit = Math.floor(detik / 60);
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  if (hari < 30) return `${hari} hari lalu`;
  const bulan = Math.floor(hari / 30);
  if (bulan < 12) return `${bulan} bulan lalu`;
  return `${Math.floor(bulan / 12)} tahun lalu`;
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
