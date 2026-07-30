import { describe, it, expect } from "vitest";
import {
  buildSections,
  summarize,
  paginateCatalog,
  namaWidth,
  ukuranText,
  margin,
  CATALOG_COLUMNS,
  NAMA_MIN_W,
  TABLE_W,
  PAGE_H,
  HEADER_H,
  TOP_PAD,
  BOTTOM_PAD,
  SECTION_H,
  THEAD_H,
  ROW_H,
  type CatalogPage,
} from "./catalog";
import type { Product } from "./types";

function prod(over: Partial<Product> & { namaProduk: string }): Product {
  return {
    id: over.namaProduk,
    tipe: "Bar",
    ukuran: 1000,
    satuan: "gr",
    hargaDasar: 10000,
    hargaJual: 15000,
    konversi: [],
    stokMin: 0,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    ...over,
  };
}

// Height a page's blocks occupy, given where its content starts.
function usedHeight(page: CatalogPage, start: number): number {
  return page.reduce(
    (y, b) =>
      y + (b.kind === "section" ? SECTION_H : b.kind === "thead" ? THEAD_H : ROW_H),
    start,
  );
}

describe("buildSections", () => {
  const products = [
    prod({ namaProduk: "Susu", tipe: "Bar" }),
    prod({ namaProduk: "Ayam", tipe: "Kitchen" }),
    prod({ namaProduk: "Almond", tipe: "Bar" }),
  ];

  it("groups by tipe in the order given, names sorted inside", () => {
    const s = buildSections(products, ["Kitchen", "Bar"]);
    expect(s.map((x) => x.tipe)).toEqual(["Kitchen", "Bar"]);
    expect(s[1].products.map((p) => p.namaProduk)).toEqual(["Almond", "Susu"]);
  });

  it("drops tipe with no products so no empty section prints", () => {
    expect(buildSections(products, ["Bar", "Gudang"]).map((s) => s.tipe)).toEqual([
      "Bar",
    ]);
  });

  it("ignores products whose tipe was not selected", () => {
    const s = buildSections(products, ["Bar"]);
    expect(summarize(s).total).toBe(2);
  });
});

describe("summarize", () => {
  it("counts the grand total and each tipe", () => {
    const s = buildSections(
      [
        prod({ namaProduk: "A", tipe: "Bar" }),
        prod({ namaProduk: "B", tipe: "Bar" }),
        prod({ namaProduk: "C", tipe: "Kitchen" }),
      ],
      ["Bar", "Kitchen"],
    );
    expect(summarize(s)).toEqual({
      total: 3,
      perTipe: [
        { tipe: "Bar", count: 2 },
        { tipe: "Kitchen", count: 1 },
      ],
    });
  });
});

describe("paginateCatalog", () => {
  function manyOf(tipe: string, n: number) {
    return Array.from({ length: n }, (_, i) =>
      prod({ namaProduk: `${tipe}-${String(i).padStart(3, "0")}`, tipe }),
    );
  }

  it("renders one page even with nothing to list", () => {
    expect(paginateCatalog([])).toEqual([[]]);
  });

  it("keeps a short catalog on a single page", () => {
    const pages = paginateCatalog(buildSections(manyOf("Bar", 5), ["Bar"]));
    expect(pages).toHaveLength(1);
    expect(pages[0].filter((b) => b.kind === "row")).toHaveLength(5);
  });

  it("never overflows a page", () => {
    const pages = paginateCatalog(
      buildSections([...manyOf("Bar", 90), ...manyOf("Kitchen", 40)], [
        "Bar",
        "Kitchen",
      ]),
    );
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((page, i) => {
      expect(usedHeight(page, i === 0 ? HEADER_H : TOP_PAD)).toBeLessThanOrEqual(
        PAGE_H - BOTTOM_PAD,
      );
    });
  });

  it("emits every row exactly once, numbered per section", () => {
    const sections = buildSections(
      [...manyOf("Bar", 90), ...manyOf("Kitchen", 40)],
      ["Bar", "Kitchen"],
    );
    const rows = paginateCatalog(sections)
      .flat()
      .filter((b) => b.kind === "row");
    expect(rows).toHaveLength(130);
    expect(rows.map((r) => r.product.namaProduk)).toEqual(
      sections.flatMap((s) => s.products.map((p) => p.namaProduk)),
    );
    // Numbering restarts at each tipe, matching the printed "NO" column.
    expect(rows[0].no).toBe(1);
    expect(rows[89].no).toBe(90);
    expect(rows[90].no).toBe(1);
  });

  it("repeats the section band and column header after a break", () => {
    const pages = paginateCatalog(buildSections(manyOf("Bar", 90), ["Bar"]));
    const second = pages[1];
    expect(second[0]).toMatchObject({ kind: "section", tipe: "Bar", cont: true });
    expect(second[1]).toEqual({ kind: "thead" });
    expect(pages[0][0]).toMatchObject({ kind: "section", cont: false });
  });

  it("merges everything into one numbered table when kategori are off", () => {
    const sections = buildSections(
      [...manyOf("Bar", 4), ...manyOf("Kitchen", 3)],
      ["Bar", "Kitchen"],
    );
    const pages = paginateCatalog(sections, { showKategori: false });
    expect(pages).toHaveLength(1);
    expect(pages[0].some((b) => b.kind === "section")).toBe(false);
    expect(pages[0].filter((b) => b.kind === "thead")).toHaveLength(1);
    const rows = pages[0].filter((b) => b.kind === "row");
    // One continuous sequence, re-sorted across the former sections.
    expect(rows.map((r) => r.no)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rows.map((r) => r.product.namaProduk)).toEqual(
      [...rows.map((r) => r.product.namaProduk)].sort(),
    );
  });

  it("repeats only the column header across pages when kategori are off", () => {
    const pages = paginateCatalog(
      buildSections(manyOf("Bar", 120), ["Bar"]),
      { showKategori: false },
    );
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat().some((b) => b.kind === "section")).toBe(false);
    pages.forEach((page, i) => {
      expect(page[0]).toEqual({ kind: "thead" });
      expect(usedHeight(page, i === 0 ? HEADER_H : TOP_PAD)).toBeLessThanOrEqual(
        PAGE_H - BOTTOM_PAD,
      );
    });
    expect(pages.flat().filter((b) => b.kind === "row")).toHaveLength(120);
  });

  it("moves a section band that cannot fit at least one row to the next page", () => {
    // Fill page 1 so only a couple of rows' worth of space is left.
    const fill = Math.floor(
      (PAGE_H - BOTTOM_PAD - HEADER_H - SECTION_H - THEAD_H) / ROW_H,
    );
    const pages = paginateCatalog(
      buildSections([...manyOf("Bar", fill), ...manyOf("Kitchen", 3)], [
        "Bar",
        "Kitchen",
      ]),
    );
    expect(pages[0].some((b) => b.kind === "section" && b.tipe === "Kitchen")).toBe(
      false,
    );
    expect(pages[1][0]).toMatchObject({ kind: "section", tipe: "Kitchen", cont: false });
  });
});

describe("namaWidth", () => {
  it("absorbs the width left over by the selected columns", () => {
    expect(namaWidth([])).toBe(TABLE_W - 44);
    expect(namaWidth(CATALOG_COLUMNS)).toBe(
      TABLE_W - 44 - CATALOG_COLUMNS.reduce((s, c) => s + c.width, 0),
    );
  });

  it("never shrinks below the minimum, even if columns overflow", () => {
    const wide = CATALOG_COLUMNS.map((c) => ({ ...c, width: 400 }));
    expect(namaWidth(wide)).toBe(NAMA_MIN_W);
  });
});

describe("cell values", () => {
  it("joins ukuran and satuan, falling back to a dash", () => {
    expect(ukuranText(prod({ namaProduk: "A", ukuran: 250, satuan: "gr" }))).toBe(
      "250 gr",
    );
    expect(ukuranText(prod({ namaProduk: "A", ukuran: null, satuan: "pcs" }))).toBe(
      "pcs",
    );
    expect(ukuranText(prod({ namaProduk: "A", ukuran: null, satuan: null }))).toBe("—");
  });

  it("margin is harga jual minus modal, and may go negative", () => {
    expect(margin(prod({ namaProduk: "A", hargaDasar: 10, hargaJual: 25 }))).toBe(15);
    expect(margin(prod({ namaProduk: "A", hargaDasar: 30, hargaJual: 25 }))).toBe(-5);
  });
});
