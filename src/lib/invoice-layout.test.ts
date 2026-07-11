import { describe, it, expect } from "vitest";
import { splitZones, footerTop, paginateInvoice } from "./invoice-layout";
import { defaultStyle } from "./template-types";
import type { TemplateElement } from "./template-types";

function el(over: Partial<TemplateElement> & { id: string }): TemplateElement {
  return {
    type: "text",
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    z: 0,
    style: defaultStyle(),
    ...over,
  };
}

describe("splitZones", () => {
  const items = el({ id: "items", type: "items", y: 300, h: 200 }); // box 300..500
  const logo = el({ id: "logo", type: "logo", y: 40 });
  const customer = el({ id: "cust", type: "text", y: 120 });
  const total = el({ id: "total", type: "total", y: 540, h: 30 });
  const sign = el({ id: "sign", type: "text", y: 620, h: 60 });

  const elements = [logo, customer, items, total, sign];

  it("puts elements above the items box in the header, below in the footer", () => {
    const z = splitZones(elements, items);
    expect(z.header.map((e) => e.id)).toEqual(["logo", "cust"]);
    expect(z.footer.map((e) => e.id)).toEqual(["total", "sign"]);
  });

  it("excludes the items element itself from both zones", () => {
    const z = splitZones(elements, items);
    expect([...z.header, ...z.footer].some((e) => e.id === "items")).toBe(false);
  });

  it("headerHeight reserves the space above the items box", () => {
    expect(splitZones(elements, items).headerHeight).toBe(300);
  });

  it("itemsBottom is the bottom edge of the items box", () => {
    expect(splitZones(elements, items).itemsBottom).toBe(500);
  });

  it("footerHeight spans to the bottom of the lowest footer element (relative to the list end)", () => {
    // sign: y 620, h 60, itemsBottom 500 → 620-500+60 = 180.
    expect(splitZones(elements, items).footerHeight).toBe(180);
  });

  it("sorts each zone by z so stacking order is preserved", () => {
    const a = el({ id: "a", y: 10, z: 2 });
    const b = el({ id: "b", y: 20, z: 1 });
    const z = splitZones([a, b, items], items);
    expect(z.header.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("handles a template whose only element is the items table", () => {
    const z = splitZones([items], items);
    expect(z.header).toEqual([]);
    expect(z.footer).toEqual([]);
    expect(z.footerHeight).toBe(0);
  });
});

describe("footerTop", () => {
  it("preserves an element's original gap below the items box", () => {
    expect(footerTop(el({ id: "t", y: 540 }), 500)).toBe(40);
  });
  it("clamps a slightly-overlapping element to the top of the footer", () => {
    expect(footerTop(el({ id: "t", y: 480 }), 500)).toBe(0);
  });
});

describe("paginateInvoice", () => {
  const base = {
    pageHeight: 1000,
    headerHeight: 300,
    footerHeight: 80,
    theadHeight: 30,
    contTopPad: 40,
    bottomPad: 40,
  };

  it("keeps a short order on one page with header and footer", () => {
    const rows = Array(5).fill(30); // 150px of rows
    const pages = paginateInvoice(rows, base);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ start: 0, end: 5, header: true, footer: true });
  });

  it("spills overflow onto more pages and never drops or duplicates a row", () => {
    const rows = Array(60).fill(30);
    const pages = paginateInvoice(rows, base);
    expect(pages.length).toBeGreaterThan(1);
    // Rows are contiguous and cover 0..60 with no gaps or overlaps.
    let cursor = 0;
    for (const p of pages) {
      if (p.end > p.start) {
        expect(p.start).toBe(cursor);
        cursor = p.end;
      }
    }
    expect(cursor).toBe(60);
  });

  it("shows the header only on the first page", () => {
    const pages = paginateInvoice(Array(60).fill(30), base);
    expect(pages[0].header).toBe(true);
    expect(pages.slice(1).every((p) => !p.header)).toBe(true);
  });

  it("shows the footer exactly once, on the last page", () => {
    const pages = paginateInvoice(Array(60).fill(30), base);
    expect(pages.filter((p) => p.footer)).toHaveLength(1);
    expect(pages[pages.length - 1].footer).toBe(true);
  });

  it("page 1 fits fewer rows than continuation pages (header eats space)", () => {
    const rows = Array(200).fill(30);
    const pages = paginateInvoice(rows, base);
    const p1 = pages[0].end - pages[0].start;
    const p2 = pages[1].end - pages[1].start;
    expect(p1).toBeLessThan(p2);
  });

  it("pushes the footer to its own page when it won't fit after the last row", () => {
    // Fill page 1 body exactly, leaving no room for an 80px footer.
    // avail = 1000 - 300 - 40 - 30 = 630 → 21 rows of 30.
    const pages = paginateInvoice(Array(21).fill(30), base);
    const withRows = pages.filter((p) => p.end > p.start);
    expect(withRows).toHaveLength(1);
    expect(pages[pages.length - 1]).toMatchObject({ start: 21, end: 21, footer: true });
  });

  it("renders a single header+footer page when there are no items", () => {
    expect(paginateInvoice([], base)).toEqual([
      { start: 0, end: 0, header: true, footer: true },
    ]);
  });

  it("always advances even if a row is taller than the page", () => {
    const pages = paginateInvoice([2000, 2000], base);
    expect(pages.filter((p) => p.end > p.start)).toHaveLength(2);
  });
});
