import { useLayoutEffect, useRef, useState } from "react";
import type { Product } from "../lib/types";
import {
  paginateCatalog,
  summarize,
  namaWidth,
  ukuranText,
  margin,
  CATALOG_COLUMNS,
  NO_W,
  TABLE_W,
  MARGIN_X,
  TOP_PAD,
  HEADER_H,
  SECTION_H,
  THEAD_H,
  ROW_H,
  PAGE_W,
  PAGE_H,
  INK,
  MUTED,
  RULE,
  RULE_STRONG,
  type CatalogColumn,
  type CatalogColumnId,
  type CatalogSection,
} from "../lib/catalog";
import { formatRupiah } from "../lib/format";

export interface CatalogOptions {
  judul: string;
  subjudul: string;
  footer: string;
  logo: string | null;
  columns: CatalogColumnId[];
  showKategori: boolean;
}

// The catalog rendered as discrete A4 sheets — the same two-mode component the
// invoice Preview is: `fit` scales the sheets to the container for the on-screen
// preview, `fit={false}` renders them 1:1 with page breaks for printing.
//
// Styling deliberately mirrors the seeded invoice template: plain white paper,
// one bold title beside the logo, a 2px rule under the column header and a 1px
// rule under each row. No fills, no accent colors.
export function CatalogPreview({
  sections,
  options,
  fit = true,
}: {
  sections: CatalogSection[];
  options: CatalogOptions;
  fit?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

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
  const pages = paginateCatalog(sections, {
    showKategori: options.showKategori,
  });
  const cols = CATALOG_COLUMNS.filter((c) => options.columns.includes(c.id));
  const namaW = namaWidth(cols);

  return (
    <div ref={wrapRef} className={fit ? "w-full" : undefined}>
      {pages.map((page, i) => (
        <Sheet key={i} fit={fit} s={s} isLast={i === pages.length - 1}>
          <div
            className="relative bg-white overflow-hidden"
            style={{ width: PAGE_W, height: PAGE_H, color: INK }}
          >
            <div
              className="absolute"
              style={{ left: MARGIN_X, top: 0, width: TABLE_W }}
            >
              {i === 0 ? (
                <Masthead sections={sections} options={options} />
              ) : (
                <div style={{ height: TOP_PAD }} />
              )}

              {page.map((block, b) => {
                if (block.kind === "section")
                  return (
                    <SectionHeading
                      key={b}
                      tipe={block.tipe}
                      count={block.count}
                      cont={block.cont}
                    />
                  );
                if (block.kind === "thead")
                  return <HeadRow key={b} cols={cols} namaW={namaW} />;
                return (
                  <BodyRow
                    key={b}
                    product={block.product}
                    no={block.no}
                    cols={cols}
                    namaW={namaW}
                  />
                );
              })}

              {page.length === 0 && (
                <div className="text-center py-10" style={{ color: MUTED, fontSize: 12 }}>
                  Tidak ada produk untuk kategori yang dipilih.
                </div>
              )}
            </div>

            <PageFooter text={options.footer} page={i + 1} total={pages.length} />
          </div>
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
  isLast,
}: {
  children: React.ReactNode;
  fit: boolean;
  s: number;
  isLast: boolean;
}) {
  if (!fit)
    return <div className={isLast ? "" : "invoice-page-break"}>{children}</div>;
  return (
    <div
      className="bg-white mx-auto shadow-sm ring-1 ring-slate-200 overflow-hidden"
      style={{
        width: PAGE_W * s,
        height: PAGE_H * s,
        marginBottom: isLast ? 0 : 20,
      }}
    >
      <div
        className="origin-top-left"
        style={{ width: PAGE_W, transform: `scale(${s})` }}
      >
        {children}
      </div>
    </div>
  );
}

const LOGO_BOX = 76; // square, so a round stamp logo is not letterboxed

// Page-1 letterhead: logo + title on the left, counts on the right — the same
// arrangement as the invoice template's logo / "INVOICE" / business block. Its
// total height is pinned to HEADER_H because paginateCatalog reserves exactly
// that much.
function Masthead({
  sections,
  options,
}: {
  sections: CatalogSection[];
  options: CatalogOptions;
}) {
  const { total, perTipe } = summarize(sections);
  // Beyond three categories the per-tipe lines stop fitting; they collapse into
  // a single count. With kategori switched off none are listed at all, matching
  // the single merged table below. The dialog always shows the full breakdown.
  const lines = !options.showKategori
    ? []
    : perTipe.length <= 3
      ? perTipe.map((t) => `${t.tipe}: ${t.count} produk`)
      : [`${perTipe.length} kategori`];

  return (
    <div
      className="flex items-center gap-4"
      style={{ height: HEADER_H, paddingTop: TOP_PAD }}
    >
      {options.logo && (
        <img
          src={options.logo}
          alt=""
          className="object-contain shrink-0"
          style={{ width: LOGO_BOX, height: LOGO_BOX }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div
          className="font-bold truncate"
          style={{ fontSize: 28, lineHeight: "34px" }}
        >
          {options.judul}
        </div>
        {options.subjudul && (
          <div style={{ fontSize: 12, lineHeight: "18px", color: MUTED }}>
            {options.subjudul}
          </div>
        )}
      </div>
      <div
        className="shrink-0 text-right"
        style={{ fontSize: 12, lineHeight: "18px", color: MUTED }}
      >
        <div style={{ fontWeight: 700, color: INK }}>{total} produk</div>
        {lines.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
    </div>
  );
}

function SectionHeading({
  tipe,
  count,
  cont,
}: {
  tipe: string;
  count: number;
  cont: boolean;
}) {
  return (
    <div
      className="flex items-end justify-between"
      style={{ height: SECTION_H, paddingTop: 14, paddingBottom: 4 }}
    >
      <span className="font-bold truncate" style={{ fontSize: 14 }}>
        {tipe}
        {cont && (
          <span style={{ fontWeight: 400, color: MUTED }}> (lanjutan)</span>
        )}
      </span>
      <span className="shrink-0" style={{ fontSize: 11, color: MUTED }}>
        {count} produk
      </span>
    </div>
  );
}

const cell = "px-1.5 overflow-hidden whitespace-nowrap text-ellipsis";

function HeadRow({ cols, namaW }: { cols: CatalogColumn[]; namaW: number }) {
  return (
    <div
      className="flex items-center font-bold"
      style={{ height: THEAD_H, fontSize: 12, borderBottom: `2px solid ${RULE_STRONG}` }}
    >
      <div className={cell} style={{ width: NO_W }}>
        No
      </div>
      <div className={cell} style={{ width: namaW }}>
        Nama Produk
      </div>
      {cols.map((c) => (
        <div
          key={c.id}
          className={`${cell} ${c.align === "right" ? "text-right" : ""}`}
          style={{ width: c.width }}
        >
          {c.label}
        </div>
      ))}
    </div>
  );
}

function BodyRow({
  product,
  no,
  cols,
  namaW,
}: {
  product: Product;
  no: number;
  cols: CatalogColumn[];
  namaW: number;
}) {
  const laba = margin(product);
  return (
    <div
      className="flex items-center tabular-nums"
      style={{ height: ROW_H, fontSize: 12, borderBottom: `1px solid ${RULE}` }}
    >
      <div className={cell} style={{ width: NO_W, color: MUTED }}>
        {no}
      </div>
      <div className={cell} style={{ width: namaW }} title={product.namaProduk}>
        {product.namaProduk}
      </div>
      {cols.map((c) => {
        if (c.id === "ukuran")
          return (
            <div key={c.id} className={cell} style={{ width: c.width }}>
              {ukuranText(product)}
            </div>
          );
        const value =
          c.id === "margin"
            ? `${laba > 0 ? "+" : ""}${formatRupiah(laba)}`
            : formatRupiah(
                c.id === "hargaDasar" ? product.hargaDasar : product.hargaJual,
              );
        return (
          <div
            key={c.id}
            className={`${cell} text-right`}
            style={{ width: c.width }}
          >
            {value}
          </div>
        );
      })}
    </div>
  );
}

// Running footer, inside the BOTTOM_PAD strip pagination keeps clear.
function PageFooter({
  text,
  page,
  total,
}: {
  text: string;
  page: number;
  total: number;
}) {
  return (
    <div
      className="absolute flex items-end justify-between"
      style={{
        left: MARGIN_X,
        right: MARGIN_X,
        bottom: 24,
        fontSize: 11,
        color: MUTED,
      }}
    >
      <span className="truncate pr-4 italic">{text}</span>
      <span className="shrink-0 tabular-nums">
        Halaman {page} / {total}
      </span>
    </div>
  );
}
