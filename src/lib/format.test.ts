import { describe, it, expect, vi, afterEach } from "vitest";
import {
  roundRupiah,
  sumRupiah,
  formatRupiah,
  formatUang,
  formatBulanPendek,
  formatRupiahRingkas,
  formatBytes,
  formatRelatifID,
  formatDateTimeID,
  presetRange,
  nowISO,
} from "./format";

describe("nowISO — the sync cursor invariant", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never repeats a stamp, even inside one millisecond", () => {
    // Why this matters is not display: `updatedAt` is the sync cursor, and the
    // sweep keeps ONE scalar watermark per table. Two rows sharing a cursor
    // means a push advances past both on the strength of one, and the other is
    // filtered out on the cursor forever after. A single form save fires several
    // writes, so the same-millisecond case is ordinary.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));

    const stamps = Array.from({ length: 5 }, () => nowISO());

    expect(new Set(stamps).size).toBe(5);
    // And strictly increasing, since the watermark comparison is ordering, not
    // just equality. ISO-8601 sorts lexically, which is what the sweep relies on.
    expect([...stamps].sort()).toEqual(stamps);
  });

  it("keeps increasing when the wall clock jumps backwards", () => {
    // An NTP correction or a timezone fix. A cursor that went backwards would
    // strand every row written before the jump below the watermark.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const before = nowISO();

    vi.setSystemTime(new Date("2026-08-17T11:00:00.000Z"));
    const after = nowISO();

    expect(after > before).toBe(true);
  });
});

describe("roundRupiah", () => {
  it("rounds to whole rupiah (matches formatRupiah's maximumFractionDigits: 0)", () => {
    expect(roundRupiah(333.3)).toBe(333);
    expect(roundRupiah(333.5)).toBe(334);
    expect(roundRupiah(1000)).toBe(1000);
  });
});

describe("sumRupiah — the money invariant", () => {
  it("rounds each line THEN sums, so Σ(displayed lines) === displayed total", () => {
    // The reported bug: 3 lines of 0.1 × 3333 = 333.3 each.
    const lines = [333.3, 333.3, 333.3];

    // What the reader sees per line (formatRupiah rounds each).
    const displayed = lines.map((n) => roundRupiah(n)); // [333, 333, 333]
    const shownSum = displayed.reduce((a, b) => a + b, 0); // 999

    // The buggy "raw sum then round" produced 1000.
    const rawThenRound = roundRupiah(lines.reduce((a, b) => a + b, 0)); // round(999.9) = 1000
    expect(rawThenRound).toBe(1000);

    // sumRupiah gives 999 — equal to the sum of the displayed lines.
    expect(sumRupiah(lines)).toBe(999);
    expect(sumRupiah(lines)).toBe(shownSum);
  });

  it("is a no-op-safe sum for already-whole values", () => {
    expect(sumRupiah([100000, 60000])).toBe(160000);
  });

  it("empty list sums to 0", () => {
    expect(sumRupiah([])).toBe(0);
  });

  it("the formatted total equals the concatenated formatted lines' arithmetic", () => {
    const lines = [333.3, 333.3, 333.3];
    // Each rendered line is formatRupiah(333.3) → "Rp 333"; the total must render
    // the sum of those, i.e. formatRupiah(999), never formatRupiah(1000).
    expect(formatRupiah(sumRupiah(lines))).toBe(formatRupiah(999));
    expect(formatRupiah(sumRupiah(lines))).not.toBe(formatRupiah(1000));
  });
});

describe("presetRange", () => {
  // Pinned mid-month, local time. Every case below is read off this date.
  const now = new Date(2026, 6, 19); // 19 July 2026

  it("hari-ini is a single day", () => {
    expect(presetRange("hari-ini", now)).toEqual(["2026-07-19", "2026-07-19"]);
  });

  it("kemarin is a single day, the one before", () => {
    expect(presetRange("kemarin", now)).toEqual(["2026-07-18", "2026-07-18"]);
  });

  it("7-hari spans 7 calendar days INCLUDING today", () => {
    expect(presetRange("7-hari", now)).toEqual(["2026-07-13", "2026-07-19"]);
  });

  it("bulan-ini runs from the 1st to the real last day of the month", () => {
    expect(presetRange("bulan-ini", now)).toEqual(["2026-07-01", "2026-07-31"]);
  });

  it("bulan-lalu runs across the whole previous month", () => {
    expect(presetRange("bulan-lalu", now)).toEqual(["2026-06-01", "2026-06-30"]);
  });

  it("bulan-ini ends on the 30th in a 30-day month", () => {
    expect(presetRange("bulan-ini", new Date(2026, 3, 10))).toEqual([
      "2026-04-01",
      "2026-04-30",
    ]);
  });

  it("bulan-ini ends on the 28th in a non-leap February", () => {
    expect(presetRange("bulan-ini", new Date(2026, 1, 10))).toEqual([
      "2026-02-01",
      "2026-02-28",
    ]);
  });

  it("bulan-ini ends on the 29th in a leap February", () => {
    expect(presetRange("bulan-ini", new Date(2024, 1, 10))).toEqual([
      "2024-02-01",
      "2024-02-29",
    ]);
  });

  it("bulan-lalu in January rolls back into the previous YEAR", () => {
    expect(presetRange("bulan-lalu", new Date(2026, 0, 15))).toEqual([
      "2025-12-01",
      "2025-12-31",
    ]);
  });

  it("bulan-lalu from 31 March lands on all of February, not 31 Feb", () => {
    expect(presetRange("bulan-lalu", new Date(2026, 2, 31))).toEqual([
      "2026-02-01",
      "2026-02-28",
    ]);
  });

  it("kemarin on 1 January rolls back into the previous year", () => {
    expect(presetRange("kemarin", new Date(2026, 0, 1))).toEqual([
      "2025-12-31",
      "2025-12-31",
    ]);
  });

  it("7-hari crosses a month boundary", () => {
    expect(presetRange("7-hari", new Date(2026, 6, 3))).toEqual([
      "2026-06-27",
      "2026-07-03",
    ]);
  });

  it("defaults to the current date when no Date is passed", () => {
    const [from, to] = presetRange("hari-ini");
    expect(from).toBe(to);
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// The two chart labels. Both are display-only — see the notes on them in
// format.ts — so what is pinned here is the SHAPE, not an accounting rule.
describe("formatBulanPendek", () => {
  it("shortens a month key, keeping the year", () => {
    expect(formatBulanPendek("2026-07")).toBe("Jul 2026");
  });

  it("accepts a full ISO date too", () => {
    expect(formatBulanPendek("2026-01-31")).toBe("Jan 2026");
  });

  it("hands back anything it cannot read, rather than a wrong month", () => {
    expect(formatBulanPendek("15 Juli")).toBe("15 Juli");
    expect(formatBulanPendek("2026-13")).toBe("2026-13");
  });
});

describe("formatRupiahRingkas", () => {
  it("shortens millions and thousands", () => {
    expect(formatRupiahRingkas(1_250_000)).toBe("Rp 1,3 jt");
    expect(formatRupiahRingkas(950_000)).toBe("Rp 950 rb");
    expect(formatRupiahRingkas(2_400_000_000)).toBe("Rp 2,4 M");
  });

  it("keeps small amounts exact — there is nothing to shorten", () => {
    expect(formatRupiahRingkas(750)).toBe(formatRupiah(750));
  });

  it("keeps the sign on a loss", () => {
    expect(formatRupiahRingkas(-1_200_000)).toBe("-Rp 1,2 jt");
  });
});

// formatUang shares formatRupiah's zero-guard and rounding but drops the "Rp"
// symbol, for a column that states the currency once in its header.
describe("formatUang", () => {
  it("formats without the currency symbol", () => {
    expect(formatUang(54000)).toBe("54.000");
  });

  it("applies the same -0 guard as formatRupiah", () => {
    expect(formatUang(-0.2)).toBe("0");
  });
});

// Untested prior to this diff: byte counts for the Admin storage panel. Decimal
// units (1000, not 1024) because that is what Cloudflare's own D1 numbers use.
describe("formatBytes", () => {
  it("shows a null size as an em dash", () => {
    expect(formatBytes(null)).toBe("—");
  });

  it("prints small counts in bytes, no decimal", () => {
    expect(formatBytes(812)).toBe("812 B");
  });

  it("steps up to KB once the count reaches 1000", () => {
    expect(formatBytes(1000)).toBe("1 KB");
    expect(formatBytes(41_200)).toBe("41,2 KB");
  });

  it("steps up through MB and GB for larger sizes", () => {
    expect(formatBytes(3_700_000)).toBe("3,7 MB");
    expect(formatBytes(2_100_000_000)).toBe("2,1 GB");
  });

  it("stops at GB rather than inventing a TB unit", () => {
    // units = ["KB", "MB", "GB"]; the loop guard (unit < units.length - 1)
    // must stop advancing once GB is reached, however large the count.
    expect(formatBytes(5_000_000_000_000)).toBe("5.000 GB");
  });
});

// "is sync alive?" — coarse buckets, deliberately. Untested prior to this diff.
describe("formatRelatifID", () => {
  it("shows a null timestamp as an em dash", () => {
    expect(formatRelatifID(null)).toBe("—");
  });

  it("hands back the raw string for an unparseable timestamp", () => {
    expect(formatRelatifID("not-a-date")).toBe("not-a-date");
  });

  it("reads under a minute as 'baru saja'", () => {
    expect(formatRelatifID(new Date(Date.now() - 30_000).toISOString())).toBe(
      "baru saja",
    );
  });

  it("reads minutes, then hours, then days, once each threshold is crossed", () => {
    expect(
      formatRelatifID(new Date(Date.now() - 5 * 60_000).toISOString()),
    ).toBe("5 menit lalu");
    expect(
      formatRelatifID(new Date(Date.now() - 3 * 3_600_000).toISOString()),
    ).toBe("3 jam lalu");
    expect(
      formatRelatifID(new Date(Date.now() - 2 * 86_400_000).toISOString()),
    ).toBe("2 hari lalu");
  });

  it("reads a clock-skewed future timestamp as 'baru saja', not a negative age", () => {
    expect(
      formatRelatifID(new Date(Date.now() + 60_000).toISOString()),
    ).toBe("baru saja");
  });
});

// "2026-06-27T08:30:00.000Z" -> "27 Jun 2026, HH.MM" local time. Untested prior
// to this diff.
describe("formatDateTimeID", () => {
  it("shows an empty string as an em dash", () => {
    expect(formatDateTimeID("")).toBe("—");
  });

  it("hands back the raw string for an unparseable ISO value", () => {
    expect(formatDateTimeID("not-a-date")).toBe("not-a-date");
  });

  it("formats a real timestamp with a short month name", () => {
    expect(formatDateTimeID("2026-06-27T08:30:00.000Z")).toMatch(
      /^27 Jun 2026, \d{2}\.\d{2}$/,
    );
  });
});
