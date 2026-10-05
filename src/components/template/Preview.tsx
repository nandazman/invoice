import { useLayoutEffect, useRef, useState } from "react";
import type { InvoiceData, Template, TemplateElement } from "../../lib/template-types";
import { PAGE_W, PAGE_H } from "../../lib/template-types";
import {
  splitZones,
  footerTop,
  footerShifts,
  paginateInvoice,
  CONT_TOP_PAD,
  type PageSlice,
} from "../../lib/invoice-layout";
import { ElementContent } from "./ElementContent";

// Renders the bound template as discrete A4 sheets. Item rows that overflow a
// sheet flow onto the next one (the column header repeats; the letterhead does
// not). Page breaks are computed here from measured row heights so the on-screen
// preview and the printed PDF show the *same* pages (WYSIWYG). Templates with no
// items table render as a single fixed page.
export function Preview({
  template,
  data,
  fit = true,
  className = "",
}: {
  template: Template;
  data: InvoiceData;
  fit?: boolean;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [rowHeights, setRowHeights] = useState<number[]>([]);
  const [theadH, setTheadH] = useState(0);
  const [customH, setCustomH] = useState<Record<string, number>>({});

  const itemsEl = template.elements.find((el) => el.type === "items");
  const customEls = template.elements.filter((el) => el.type === "custom");

  // Custom tables have no fixed height — measure each at its designed width.
  const customRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = customRef.current;
    if (!node) return;
    const measure = () => {
      const next: Record<string, number> = {};
      for (const c of node.querySelectorAll<HTMLElement>("[data-cid]")) {
        next[c.dataset.cid!] = c.getBoundingClientRect().height;
      }
      setCustomH((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [data.tables, template]);

  // Measure the fully-rendered item table (all rows, 1:1) so we can compute page
  // breaks. Runs off-screen; re-measures whenever the data or template change.
  useLayoutEffect(() => {
    const node = measureRef.current;
    if (!node) return;
    const measure = () => {
      const thead = node.querySelector("thead");
      const rows = node.querySelectorAll("tbody tr");
      setTheadH(thead ? thead.getBoundingClientRect().height : 0);
      setRowHeights(Array.from(rows, (r) => r.getBoundingClientRect().height));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [data.items, template, itemsEl]);

  // Scale each sheet to the container width for the on-screen preview.
  useLayoutEffect(() => {
    if (!fit) return;
    const node = wrapRef.current;
    if (!node) return;
    const measure = () => setScale(Math.min(1, node.clientWidth / PAGE_W));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [fit]);

  const s = fit ? scale : 1;

  const customMeasure = (
    <div
      aria-hidden
      ref={customRef}
      style={{ position: "absolute", left: -100000, top: 0, visibility: "hidden", pointerEvents: "none" }}
    >
      {customEls.map((el) => (
        <div key={el.id} data-cid={el.id} style={{ width: el.w }}>
          <ElementContent el={el} template={template} data={data} />
        </div>
      ))}
    </div>
  );

  // No items table → nothing to flow; render one fixed page.
  if (!itemsEl) {
    const sorted = [...template.elements].sort((a, b) => a.z - b.z);
    // No items table to anchor the flow, but custom tables still grow with their
    // rows and push whatever sits below them.
    const grow: Record<string, number> = {};
    for (const el of customEls) grow[el.id] = (customH[el.id] ?? el.h) - el.h;
    const fixedShifts = footerShifts(sorted, grow);
    return (
      <div ref={wrapRef} className={fit ? `w-full ${className}` : className}>
        {customMeasure}
        <Sheet fit={fit} s={s}>
          <FixedPage template={template} data={data} sorted={sorted} shifts={fixedShifts} />
        </Sheet>
      </div>
    );
  }

  const zones = splitZones(template.elements, itemsEl);
  const grow: Record<string, number> = {};
  for (const el of zones.footer) {
    if (el.type === "custom") grow[el.id] = (customH[el.id] ?? el.h) - el.h;
  }
  const shifts = footerShifts(zones.footer, grow);
  const footerHeight = zones.footer.reduce(
    (max, el) =>
      Math.max(
        max,
        footerTop(el, zones.itemsBottom) + (shifts[el.id] ?? 0) +
          (el.type === "custom" ? (customH[el.id] ?? el.h) : el.h),
      ),
    0,
  );
  const pages = paginateInvoice(rowHeights, {
    pageHeight: PAGE_H,
    headerHeight: zones.headerHeight,
    footerHeight,
    theadHeight: theadH,
  });

  return (
    <div ref={wrapRef} className={fit ? `w-full ${className}` : className}>
      {customMeasure}
      {/* Hidden measuring copy of the full item table (1:1). */}
      <div
        aria-hidden
        ref={measureRef}
        style={{
          position: "absolute",
          left: -100000,
          top: 0,
          width: itemsEl.w,
          visibility: "hidden",
          pointerEvents: "none",
        }}
      >
        <ElementContent el={itemsEl} template={template} data={data} />
      </div>

      {pages.map((page, i) => (
        <Sheet key={i} fit={fit} s={s} isLast={i === pages.length - 1}>
          <PageContent
            template={template}
            data={data}
            itemsEl={itemsEl}
            zones={zones}
            page={page}
            rowHeights={rowHeights}
            theadH={theadH}
            shifts={shifts}
          />
        </Sheet>
      ))}
    </div>
  );
}

// A single A4 sheet: scaled + stacked on screen, 1:1 with a page break for print.
function Sheet({
  children,
  fit,
  s,
  isLast = true,
}: {
  children: React.ReactNode;
  fit: boolean;
  s: number;
  isLast?: boolean;
}) {
  if (!fit) {
    return (
      <div className={isLast ? "invoice-page" : "invoice-page invoice-page-break"}>
        {children}
      </div>
    );
  }
  return (
    <div
      className="bg-surface mx-auto shadow-sm ring-1 ring-line overflow-hidden"
      style={{ width: PAGE_W * s, height: PAGE_H * s, marginBottom: isLast ? 0 : 20 }}
    >
      <div className="origin-top-left" style={{ width: PAGE_W, transform: `scale(${s})` }}>
        {children}
      </div>
    </div>
  );
}

// One paginated sheet's content: header zone (page 1), the sliced item table,
// and the footer zone (after the last row).
function PageContent({
  template,
  data,
  itemsEl,
  zones,
  page,
  rowHeights,
  theadH,
  shifts,
}: {
  template: Template;
  data: InvoiceData;
  itemsEl: TemplateElement;
  zones: ReturnType<typeof splitZones>;
  page: PageSlice;
  rowHeights: number[];
  theadH: number;
  shifts: Record<string, number>;
}) {
  const tableTop = page.header ? zones.headerHeight : CONT_TOP_PAD;
  const hasRows = page.end > page.start;
  const pageData: InvoiceData = { ...data, items: data.items.slice(page.start, page.end) };

  let sliceH = 0;
  for (let r = page.start; r < page.end; r++) sliceH += rowHeights[r] ?? 0;
  const listEndY = tableTop + (hasRows ? theadH + sliceH : 0);

  return (
    <div className="invoice-doc relative bg-surface" style={{ width: PAGE_W, height: PAGE_H, overflow: "hidden" }}>
      {page.header &&
        zones.header.map((el) => (
          <div
            key={el.id}
            className={el.type === "custom" ? "absolute" : "absolute overflow-hidden"}
            style={{
              left: el.x,
              top: el.y,
              width: el.w,
              ...(el.type === "custom" ? {} : { height: el.h }),
              zIndex: el.z,
            }}
          >
            <ElementContent el={el} template={template} data={data} />
          </div>
        ))}

      {hasRows && (
        <div style={{ position: "absolute", left: itemsEl.x, top: tableTop, width: itemsEl.w }}>
          <ElementContent el={itemsEl} template={template} data={pageData} />
        </div>
      )}

      {page.footer &&
        zones.footer.map((el) => (
          <div
            key={el.id}
            className={el.type === "custom" ? "absolute" : "absolute overflow-hidden"}
            style={{
              left: el.x,
              top: Math.max(
                listEndY,
                listEndY + footerTop(el, zones.itemsBottom) + (shifts[el.id] ?? 0),
              ),
              width: el.w,
              ...(el.type === "custom" ? {} : { height: el.h }),
              zIndex: el.z,
            }}
          >
            <ElementContent el={el} template={template} data={data} />
          </div>
        ))}
    </div>
  );
}

// Single fixed A4 page for templates without an items table.
function FixedPage({
  template,
  data,
  sorted,
  shifts,
}: {
  template: Template;
  data: InvoiceData;
  sorted: TemplateElement[];
  shifts: Record<string, number>;
}) {
  return (
    <div className="invoice-doc relative bg-surface" style={{ width: PAGE_W, height: PAGE_H, overflow: "hidden" }}>
      {sorted.map((el) => (
        <div
          key={el.id}
          className={el.type === "custom" ? "absolute" : "absolute overflow-hidden"}
          style={{
            left: el.x,
            top: Math.max(0, el.y + (shifts[el.id] ?? 0)),
            width: el.w,
            ...(el.type === "custom" ? {} : { height: el.h }),
            zIndex: el.z,
          }}
        >
          <ElementContent el={el} template={template} data={data} />
        </div>
      ))}
    </div>
  );
}
