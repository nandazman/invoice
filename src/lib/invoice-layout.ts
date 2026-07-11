import type { TemplateElement } from "./template-types";

// Flowing-invoice layout. Instead of duplicating the whole template on every
// page, the invoice is one continuous document:
//   • header zone — elements ABOVE the items table; shown once at the top.
//   • the items table — flows at its natural height (the browser repeats the
//     column header and breaks between rows across pages).
//   • footer zone — elements BELOW the items table (TOTAL, signature…); they
//     flow right AFTER the list, pushed down by however tall the list grows.
// Footer elements keep their horizontal position and their vertical gap to the
// bottom of the items box, but that gap is now measured from where the list
// actually ends rather than a fixed Y.

export interface LayoutZones {
  header: TemplateElement[]; // above the items table (absolute, original x/y)
  footer: TemplateElement[]; // below the items table (absolute, offset applied)
  headerHeight: number; // reserved height for the header zone (= itemsEl.y)
  footerHeight: number; // height needed by the footer zone
  itemsBottom: number; // itemsEl.y + itemsEl.h — origin footer offsets measure from
}

// Split a template's elements into header/footer zones around the items table.
// `footerTop(el)` gives an element's top within the footer container (i.e. its
// original distance below the items box).
export function splitZones(
  elements: TemplateElement[],
  itemsEl: TemplateElement,
): LayoutZones {
  const itemsBottom = itemsEl.y + itemsEl.h;
  const header: TemplateElement[] = [];
  const footer: TemplateElement[] = [];

  for (const el of elements) {
    if (el.id === itemsEl.id) continue;
    // An element belongs to the header when it starts above the items box;
    // otherwise it flows below the list.
    if (el.y < itemsEl.y) header.push(el);
    else footer.push(el);
  }

  header.sort((a, b) => a.z - b.z);
  footer.sort((a, b) => a.z - b.z);

  const footerHeight = footer.reduce(
    (max, el) => Math.max(max, el.y - itemsBottom + el.h),
    0,
  );

  return {
    header,
    footer,
    headerHeight: itemsEl.y,
    footerHeight,
    itemsBottom,
  };
}

// An element's top position inside the footer container: its original vertical
// gap below the items box (clamped at 0 so a slightly-overlapping element still
// lands right after the list rather than above it).
export function footerTop(el: TemplateElement, itemsBottom: number): number {
  return Math.max(0, el.y - itemsBottom);
}

// ---------- Measured pagination (WYSIWYG) ----------
// We compute page breaks ourselves from measured row heights so the on-screen
// preview and the printed PDF render the *same* discrete A4 pages.

// Top padding on continuation pages (page 2+). Page 1 already gets breathing
// room from the header zone; without this, continued rows sit flush at the very
// top edge. Bottom padding keeps the last row on a page off the sheet edge.
export const CONT_TOP_PAD = 24;
export const PAGE_BOTTOM_PAD = 20;

export interface PaginateOpts {
  pageHeight: number; // full sheet height (PAGE_H)
  headerHeight: number; // page-1 header zone height
  footerHeight: number; // footer zone height
  theadHeight: number; // repeated table column-header height
  contTopPad?: number; // top padding on continuation pages
  bottomPad?: number; // bottom breathing room on every page
}

// One rendered sheet: which item rows it carries and whether it shows the header
// zone (page 1) / footer zone (after the last row).
export interface PageSlice {
  start: number; // first row index (inclusive)
  end: number; // one past last row index (exclusive)
  header: boolean;
  footer: boolean;
}

// Greedily pack measured rows into A4 sheets. The table's column header repeats
// on every page that carries rows; the header zone is page 1 only; the footer
// zone lands after the last row if it fits, otherwise on a trailing page.
export function paginateInvoice(
  rowHeights: number[],
  o: PaginateOpts,
): PageSlice[] {
  const contTop = o.contTopPad ?? CONT_TOP_PAD;
  const bottom = o.bottomPad ?? PAGE_BOTTOM_PAD;
  const n = rowHeights.length;

  if (n === 0) {
    return [{ start: 0, end: 0, header: true, footer: true }];
  }

  const pages: PageSlice[] = [];
  let i = 0;
  let first = true;
  while (i < n) {
    const top = first ? o.headerHeight : contTop;
    const avail = o.pageHeight - top - bottom - o.theadHeight;
    const start = i;
    let used = 0;
    // Always take at least one row (i === start) to guarantee progress even if a
    // single row is taller than the available space.
    while (i < n && (i === start || used + rowHeights[i] <= avail)) {
      used += rowHeights[i];
      i++;
    }
    pages.push({ start, end: i, header: first, footer: false });
    first = false;
  }

  // Place the footer after the last row if there's room; else its own page.
  const last = pages[pages.length - 1];
  const lastTop = pages.length === 1 ? o.headerHeight : contTop;
  let lastUsed = 0;
  for (let r = last.start; r < last.end; r++) lastUsed += rowHeights[r];
  const remaining = o.pageHeight - lastTop - o.theadHeight - lastUsed - bottom;
  if (o.footerHeight <= remaining) {
    last.footer = true;
  } else {
    pages.push({ start: n, end: n, header: false, footer: true });
  }
  return pages;
}
