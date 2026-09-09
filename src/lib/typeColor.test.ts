import { describe, it, expect } from "vitest";
import { typeBadgeClass } from "./typeColor";

// New in this diff, previously untested: the "Tipe" badge colour, hashed off
// the type string instead of looked up in a table.

describe("typeBadgeClass", () => {
  it("falls back to the first palette entry for an empty tipe", () => {
    // `!tipe` short-circuits the hash entirely — a product with no tipe set
    // must not crash djb2 on an empty string, nor land on a random bucket.
    expect(typeBadgeClass("")).toBe("bg-slate-50 text-slate-700");
  });

  it("is deterministic: the same tipe always gets the same class", () => {
    expect(typeBadgeClass("Bar")).toBe(typeBadgeClass("Bar"));
    expect(typeBadgeClass("Snack Kemasan")).toBe(typeBadgeClass("Snack Kemasan"));
  });

  it("always returns one of the four fixed palette classes", () => {
    const palette = [
      "bg-slate-50 text-slate-700",
      "bg-blue-50 text-blue-700",
      "bg-amber-50 text-amber-700",
      "bg-emerald-50 text-emerald-700",
    ];
    for (const tipe of ["Bar", "Kacang", "Minuman", "Kue Kering", "Lainnya"]) {
      expect(palette).toContain(typeBadgeClass(tipe));
    }
  });

  it("does not collapse every distinct tipe onto the same bucket", () => {
    // Not a claim about the hash's exact distribution, only that it varies —
    // a bug that always returned PALETTE[0] would defeat the point of hashing
    // and pass the single-value tests above while failing this one.
    const classes = new Set(
      ["Bar", "Kacang", "Minuman", "Kue Kering", "Rokok", "Lainnya"].map(
        typeBadgeClass,
      ),
    );
    expect(classes.size).toBeGreaterThan(1);
  });
});
