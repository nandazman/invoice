import { describe, it, expect } from "vitest";
import { roundRupiah, sumRupiah, formatRupiah } from "./format";

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
