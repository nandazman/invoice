# Invoice item clipping → flowing multi-page invoice — 2026-07-11

## The bug (reported by users, distinct from the rounding bug)

> "invoice tanggal 1 ada 30 item dengan total 1.200.000, pas otomasi ke
> gambar/file cuma ada 15 item tapi angka totalnya 1.200.000, sedangkan kalau
> dihitung manual angkanya gak sampe 1.200.000."

The invoice TOTAL is correct (sums **all** items), but the printed item table
shows only the rows that physically fit the items box — the rest are **silently
clipped**, so the visible rows don't add up to the shown total. This is a layout
problem, not the money-rounding bug (`plan.md` / `tasks.md`).

## Root cause

`Preview.tsx` rendered every template element in a fixed-size box with
`overflow-hidden` (`height: el.h`). The items table rendered **all** rows into
that fixed box; rows past `el.h` were clipped. The TOTAL is a separate element
bound to `data.total` (all items), so it stayed correct while rows vanished.

## Fix — measured pagination into discrete A4 sheets (WYSIWYG)

The user chose a **flowing** invoice (not per-page template duplication): only
the **items (pesanan) table** is dynamic; it grows and pushes the footer down.
On overflow, only the table's **column header** repeats — the letterhead does
not. The footer (TOTAL, signature) flows **right after** the list (for short
orders the total moves up, not pinned to the page bottom).

**Critical requirement — WYSIWYG:** the on-screen preview must show the *same*
page breaks as the PDF. Relying on the browser's own print pagination fails this
(screen would be one continuous div while print splits). So we **compute the
breaks ourselves** from measured row heights and render **discrete A4 sheets**
for both screen and print from the identical page list.

### Layout model

Elements are split into zones around the items table (`splitZones`):

1. **Header zone** — elements with `y < itemsEl.y`. Shown once, on page 1.
2. **Items table** — sliced per page at `left: itemsEl.x`, `width: itemsEl.w`;
   each page renders its own `thead` + its row slice.
3. **Footer zone** — elements with `y >= itemsEl.y`. Rendered on the page after
   the last row, each keeping its original gap below the list (`footerTop`).

`paginateInvoice(rowHeights, opts)` greedily packs measured rows into sheets:
page 1's capacity is reduced by the header zone; continuation pages get a top
padding (`CONT_TOP_PAD`, fixes "page 2 too close"); every page keeps a bottom
margin; the footer lands after the last row if it fits, else on a trailing page.

Templates with **no** items table fall back to a single fixed A4 page.

### Changes

- **`src/lib/invoice-layout.ts`** (new, pure/testable) — `splitZones`,
  `footerTop`, and `paginateInvoice` + `CONT_TOP_PAD` / `PAGE_BOTTOM_PAD`.
- **`src/components/template/Preview.tsx`** — rewritten. A hidden 1:1 copy of the
  full item table is measured (`ResizeObserver` on `tbody tr` / `thead`); the
  resulting `PageSlice[]` renders as discrete `Sheet`s — scaled + stacked with a
  gap on screen, 1:1 with a page break for print. Same pages both ways ⇒ WYSIWYG.
- **`src/routes/InvoicePage.tsx`** — print copy `createPortal`-ed into `<body>`.
- **`src/styles.css`** — `.print-portal` is kept rendered but pushed **off-screen**
  (not `display:none`, so its rows still measure); print hides `#root`, makes the
  portal static, and `break-after: page` splits each computed sheet.
- **`src/components/template/ElementContent.tsx`** — unchanged (the short-lived
  `hideTotal` prop from the earlier per-page attempt was removed).

### Why the portal is off-screen, not display:none

Printing must escape the app shell, so the print pages are portaled to `<body>`
and `#root` is hidden in print. But pagination needs real row heights, and
`display:none` measures as 0 — so the portal is positioned off-screen instead,
staying measurable while invisible, and only revealed for print.

## Tasks

- [x] `src/lib/invoice-layout.ts` — `splitZones`, `footerTop`, `paginateInvoice`,
      `CONT_TOP_PAD` / `PAGE_BOTTOM_PAD`.
- [x] `Preview.tsx` — measure rows, compute `PageSlice[]`, render identical
      discrete sheets for screen (scaled, stacked) and print (1:1, page-break).
- [x] `InvoicePage.tsx` — portal print copy into `<body>`.
- [x] `styles.css` — `.print-portal` off-screen (measurable) on screen; print
      hides `#root`, static portal, `break-after: page` per sheet.
- [x] `src/lib/invoice-layout.test.ts` — zones + `paginateInvoice`: no row
      dropped/duplicated, header page-1 only, footer once on last page, page 1
      holds fewer rows than continuation pages, footer overflow → own page,
      empty + oversized-row edge cases (17 tests).
- [x] `bun run build` + `bun run test` clean (30 tests).
- [ ] **Live verification (pending — WYSIWYG is inherently visual):** Buat
      Invoice with a 30+ item order — confirm the on-screen preview shows the
      **same number of pages** as the PDF, every row present, TOTAL right after
      the list, continuation pages have top padding, column header on every page,
      letterhead only on page 1.

## Known limitations (v1)

- Row heights are measured off-screen at the table's width, so wrapping matches;
  pagination is exact for the current data. If a very tall single row exceeds a
  full page it still gets its own page (may clip inside that one sheet).
- Elements are assigned to header/footer by whether their top is above or below
  the items box top. An element placed *beside* the table is treated as footer.
- Header/footer zones are not themselves paginated (letterhead/total are small).
