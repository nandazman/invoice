import { describe, it, expect, vi, afterEach } from "vitest";
import { roundRupiah, sumRupiah, formatRupiah, presetRange, nowISO } from "./format";

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
