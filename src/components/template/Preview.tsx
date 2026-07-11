import { useLayoutEffect, useRef, useState } from "react";
import type { InvoiceData, Template, TemplateElement } from "../../lib/template-types";
import { PAGE_W, PAGE_H } from "../../lib/template-types";
import {
  splitZones,
  footerTop,
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

  const itemsEl = template.elements.find((el) => el.type === "items");

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

  // No items table → nothing to flow; render one fixed page.
  if (!itemsEl) {
    const sorted = [...template.elements].sort((a, b) => a.z - b.z);
    return (
      <div ref={wrapRef} className={fit ? `w-full ${className}` : className}>
        <Sheet fit={fit} s={s}>
          <FixedPage template={template} data={data} sorted={sorted} />
        </Sheet>
      </div>
    );
  }

  const zones = splitZones(template.elements, itemsEl);
  const pages = paginateInvoice(rowHeights, {
    pageHeight: PAGE_H,
    headerHeight: zones.headerHeight,
    footerHeight: zones.footerHeight,
    theadHeight: theadH,
  });

  return (
    <div ref={wrapRef} className={fit ? `w-full ${className}` : className}>
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
      className="bg-white mx-auto shadow-sm ring-1 ring-slate-200 overflow-hidden"
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
}: {
  template: Template;
  data: InvoiceData;
  itemsEl: TemplateElement;
  zones: ReturnType<typeof splitZones>;
  page: PageSlice;
  rowHeights: number[];
  theadH: number;
}) {
  const tableTop = page.header ? zones.headerHeight : CONT_TOP_PAD;
  const hasRows = page.end > page.start;
  const pageData: InvoiceData = { ...data, items: data.items.slice(page.start, page.end) };

  let sliceH = 0;
  for (let r = page.start; r < page.end; r++) sliceH += rowHeights[r] ?? 0;
  const listEndY = tableTop + (hasRows ? theadH + sliceH : 0);

  return (
    <div className="invoice-doc relative bg-white" style={{ width: PAGE_W, height: PAGE_H, overflow: "hidden" }}>
      {page.header &&
        zones.header.map((el) => (
          <div
            key={el.id}
            className="absolute overflow-hidden"
            style={{ left: el.x, top: el.y, width: el.w, height: el.h, zIndex: el.z }}
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
            className="absolute overflow-hidden"
            style={{
              left: el.x,
              top: listEndY + footerTop(el, zones.itemsBottom),
              width: el.w,
              height: el.h,
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
}: {
  template: Template;
  data: InvoiceData;
  sorted: TemplateElement[];
}) {
  return (
    <div className="invoice-doc relative bg-white" style={{ width: PAGE_W, height: PAGE_H, overflow: "hidden" }}>
      {sorted.map((el) => (
        <div
          key={el.id}
          className="absolute overflow-hidden"
          style={{ left: el.x, top: el.y, width: el.w, height: el.h, zIndex: el.z }}
        >
          <ElementContent el={el} template={template} data={data} />
        </div>
      ))}
    </div>
  );
}
