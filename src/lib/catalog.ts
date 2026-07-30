import type { Product } from "./types";
import { PAGE_W, PAGE_H } from "./template-types";

// Catalog export — a printable price list built straight from the product
// table. Unlike an invoice (free-form absolute elements, see template-types),
// a catalog is repeating grouped content, so the layout is fixed and only the
// data varies: title, logo, footer note, which tipe to include, which columns
// to show.
//
// Pagination is computed here rather than measured in the DOM (as Preview does
// for invoices) because every catalog row is a single fixed-height line — the
// heights are known up front, so the split is pure and testable, and the
// on-screen preview and the printed sheet stay identical.

export { PAGE_W, PAGE_H };

// ---------- Geometry (design px, A4 portrait at 96 DPI) ----------
export const MARGIN_X = 40;
export const TOP_PAD = 40; // top padding on continuation pages
export const BOTTOM_PAD = 48; // running footer strip, reserved on every page
export const HEADER_H = 128; // page-1 masthead: logo, title, summary
export const SECTION_H = 38; // kategori heading + its gap
export const THEAD_H = 28;
export const ROW_H = 26;
export const TABLE_W = PAGE_W - MARGIN_X * 2; // 714

// ---------- Ink ----------
// Same palette the seeded invoice template uses, so a printed catalog and a
// printed invoice look like they came from the same stationery.
export const INK = "#0f172a";
export const MUTED = "#475569";
export const RULE = "#e2e8f0";
export const RULE_STRONG = "#334155";

// ---------- Columns ----------
// `no` and `namaProduk` are always shown; namaProduk absorbs the leftover width.
export type CatalogColumnId = "ukuran" | "hargaDasar" | "hargaJual" | "margin";

export interface CatalogColumn {
  id: CatalogColumnId;
  label: string;
  width: number;
  align: "left" | "right";
}

export const CATALOG_COLUMNS: CatalogColumn[] = [
  { id: "ukuran", label: "Satuan / Ukuran", width: 130, align: "left" },
  { id: "hargaDasar", label: "Harga Modal", width: 120, align: "right" },
  { id: "hargaJual", label: "Harga Jual", width: 120, align: "right" },
  { id: "margin", label: "Margin", width: 120, align: "right" },
];

export const NO_W = 44;
export const NAMA_MIN_W = 160;

// Width of the "Nama Produk" column once the selected fixed-width columns are
// laid out. Clamped so a fully-expanded catalog still leaves room for a name.
export function namaWidth(selected: CatalogColumn[]): number {
  const used = NO_W + selected.reduce((s, c) => s + c.width, 0);
  return Math.max(NAMA_MIN_W, TABLE_W - used);
}

// ---------- Sections ----------
export interface CatalogSection {
  tipe: string;
  products: Product[];
}

// Group products into one section per tipe, keeping the order of `tipes` and
// sorting products by name inside each. Tipe with no products are dropped, so
// an empty category never prints a bare header.
export function buildSections(
  products: Product[],
  tipes: string[],
): CatalogSection[] {
  const sections: CatalogSection[] = [];
  for (const tipe of tipes) {
    const rows = products
      .filter((p) => p.tipe === tipe)
      .sort((a, b) => a.namaProduk.localeCompare(b.namaProduk));
    if (rows.length > 0) sections.push({ tipe, products: rows });
  }
  return sections;
}

export interface CatalogSummary {
  total: number;
  perTipe: { tipe: string; count: number }[];
}

export function summarize(sections: CatalogSection[]): CatalogSummary {
  return {
    total: sections.reduce((s, sec) => s + sec.products.length, 0),
    perTipe: sections.map((s) => ({ tipe: s.tipe, count: s.products.length })),
  };
}

// ---------- Pagination ----------
// `cont` marks a section band reprinted because its rows spilled onto a new
// page ("KATEGORI: BAR (lanjutan)").
export type CatalogBlock =
  | { kind: "section"; tipe: string; count: number; cont: boolean }
  | { kind: "thead" }
  | { kind: "row"; product: Product; no: number };

export type CatalogPage = CatalogBlock[];

// Merge every section into one unnamed list, re-sorted by name. Used when the
// catalog prints without kategori headings: the products run as a single table
// with continuous numbering.
export function mergeSections(sections: CatalogSection[]): CatalogSection[] {
  const products = sections
    .flatMap((s) => s.products)
    .sort((a, b) => a.namaProduk.localeCompare(b.namaProduk));
  return products.length > 0 ? [{ tipe: "", products }] : [];
}

// Split the sections into A4 pages. Page 1 starts below the masthead; every
// other page starts at TOP_PAD. A section heading is never left stranded at the
// bottom of a page — it needs its heading, column header and at least one row
// to fit, or it moves to the next page.
//
// With `showKategori: false` the sections are merged and no heading is emitted,
// so the table flows continuously from the letterhead.
export function paginateCatalog(
  sections: CatalogSection[],
  { showKategori = true }: { showKategori?: boolean } = {},
): CatalogPage[] {
  const groups = showKategori ? sections : mergeSections(sections);
  const bandH = showKategori ? SECTION_H : 0;
  const limit = PAGE_H - BOTTOM_PAD;
  const pages: CatalogPage[] = [];
  let cur: CatalogPage = [];
  let y = HEADER_H; // page 1 begins under the masthead

  function breakPage() {
    pages.push(cur);
    cur = [];
    y = TOP_PAD;
  }

  for (const section of groups) {
    if (y + bandH + THEAD_H + ROW_H > limit) breakPage();
    if (showKategori) {
      cur.push({
        kind: "section",
        tipe: section.tipe,
        count: section.products.length,
        cont: false,
      });
      y += bandH;
    }
    cur.push({ kind: "thead" });
    y += THEAD_H;

    section.products.forEach((product, i) => {
      if (y + ROW_H > limit) {
        breakPage();
        if (showKategori) {
          cur.push({
            kind: "section",
            tipe: section.tipe,
            count: section.products.length,
            cont: true,
          });
          y += bandH;
        }
        cur.push({ kind: "thead" });
        y += THEAD_H;
      }
      cur.push({ kind: "row", product, no: i + 1 });
      y += ROW_H;
    });
  }

  // The masthead alone is a page, so an empty catalog still prints one sheet.
  if (cur.length > 0 || pages.length === 0) pages.push(cur);
  return pages;
}

// ---------- Cell values ----------
export function ukuranText(p: Product): string {
  const text = `${p.ukuran ?? ""} ${p.satuan ?? ""}`.trim();
  return text || "—";
}

export function margin(p: Product): number {
  return p.hargaJual - p.hargaDasar;
}
