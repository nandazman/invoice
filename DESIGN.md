---
# gstack: design-md-format=spec
name: Invoice & Pesanan
description: A calm, dense ledger for prices, orders and stock. Hairlines, tabular numbers, one petrol-blue accent.
colors:
  primary: "#1B5E7A"
  primary-hover: "#144A62"
  primary-soft: "#E7F0F4"
  on-primary: "#FFFFFF"
  surface: "#FFFFFF"
  surface-sunken: "#F3F5F5"
  surface-hover: "#EBEFEF"
  line: "#E0E5E5"
  line-strong: "#C9D1D1"
  text: "#14201F"
  text-body: "#2B3837"
  text-muted: "#55625F"
  text-faint: "#67736F"
  accent: "#1B5E7A"
  success: "#1F7A55"
  warning: "#A8620A"
  error: "#B3261E"
typography:
  display:
    fontFamily: "Source Sans 3"
    fontWeight: 700
    fontSize: 1.75rem
    letterSpacing: -0.01em
  body:
    fontFamily: "Source Sans 3"
    fontSize: 0.875rem
    lineHeight: 1.45
  label:
    fontFamily: "Source Sans 3"
    fontWeight: 600
    fontSize: 0.75rem
    letterSpacing: 0.02em
  mono:
    fontFamily: "JetBrains Mono"
    fontFeature: tnum
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  input:
    borderColor: "{colors.line-strong}"
    rounded: "{rounded.md}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  nav-link:
    textColor: "{colors.text-muted}"
---

# Invoice & Pesanan

## Overview

**Creative North Star:** A well-kept ledger. The numbers are the content, so everything else steps back.
**Product context:** Offline-first internal operations app (Harga, Pesanan, Pembeli, Stok, Beli Stock, Riwayat, Laporan, Invoice, Excel, sync to Cloudflare D1). Indonesian UI. Used by the owner and a small team, at a desk and on a phone.
**Mode per surface:** Operate everywhere (tables, forms, dialogs). Read for Laporan. No Persuade or Experience surface.
**Key characteristics:**
- Hairline structure instead of cards on cards; shadows only on overlays.
- Every money and quantity column is tabular and right-aligned.
- One accent. Color is rare, so when status colors appear they mean something.
- Phone is a first-class layout, not a squeezed desktop: bottom tab bar, one-line rows.

## Colors

**Strategy:** Restrained. Cool green-grey neutrals plus one petrol-blue accent (`primary`). Neutrals carry a slight green-blue cast so white panels on the page tone read as paper on a desk, not as grey on grey.
**Light or dark:** Light only. Use scene is an office desk and a phone in daylight; a dark theme is a different project.
`primary` is for the one main action per view, the active nav item, links and focus rings. `primary-soft` is the active-row and active-nav tint. Status uses `success` (in stock, positive margin, paid), `warning` (needs attention, nothing broken), `error` (loss, overdue, failed sync, destructive intent). Destructive confirmations use `error`, never `primary`. Text on every surface must clear 4.5:1; `text-faint` is the floor and is for secondary text only, never placeholder-as-label.

## Typography

**Face:** Source Sans 3 (Google Fonts) for all UI; JetBrains Mono only for invoice numbers and IDs. Source Sans 3 and JetBrains Mono were on gstack's freely-available list; re-verify they load at implementation time, with a `system-ui` fallback in the stack so a failed load degrades instead of reflowing wildly.
**Scale:** 12 / 14 / 16 / 20 / 28. Body and tables are 14, form fields 16 on phone (prevents iOS zoom-on-focus), page titles 20, the one big number on a report 28.
**Display:** None separate. This is an Operate surface; hierarchy comes from size steps and weight 600/700, not a second face.
**Numbers:** `font-variant-numeric: tabular-nums` on every money, quantity and date column.

## Layout

- Desktop: left sidebar 224px (64px collapsed), content max-width fluid, page padding 24px.
- Phone (<768px): fixed top bar (page title + sync chip), content, fixed **bottom tab bar** with four primary destinations and a fifth "Lainnya" that opens a sheet listing the rest. Same routes as today; only the control that reaches them changes.
- Base unit 4px. Desktop table rows 40px, phone list rows 48px. Section gaps 24px, panel padding 16px (phone: edge-to-edge, no side borders).
- Safe-area insets respected on the tab bar and sheets.

## Elevation & Depth

Flat by default. Separation comes from `line` hairlines and the page/surface tone step. Overlays (dialogs, sheets, popovers) get one offset soft shadow (`0 8px 24px rgb(20 32 31 / 0.12)`) and a 40% scrim. No colored or zero-offset glows.

## Shapes

`sm` 4px for chips and checkboxes, `md` 6px for buttons and inputs, `lg` 8px for panels and dialogs, `full` only for status dots and avatars. A nested element's radius is its parent's minus the gap. Not everything gets the same radius.

## Components

- **Icons:** one SVG line set, 1.5px stroke, 20px in nav and 16px inline, `currentColor`. No emoji anywhere in UI chrome. Lives in `src/components/icons.tsx`.
- **Button:** primary (solid `primary`), secondary (surface + `line-strong`), ghost, danger (outlined `error`, fills on hover). Hover, `focus-visible` (2px `primary` outline, 2px offset), active (one step darker), disabled (50%, `not-allowed`). Phone: 36px visible height with horizontal padding 12px; the hit area is extended to 44px with transparent padding (`::after` inset -4px) so the button looks compact but stays easy to tap. Desktop: 32px.
- **Input / Select:** phone 36px high with no vertical padding (text centered), 16px font size on text inputs so iOS does not zoom on focus; toolbar rows use 8px/12px outer padding. 1px `line-strong`, `md` radius, `primary` focus ring, error state with `error` border plus message text (never color alone).
- **Table:** sticky header on `surface-sunken`, 12px label-case column heads, `line` row dividers, hover `surface-hover`, selected `primary-soft`. Numeric columns right-aligned and tabular.
- **MobileList row:** one 48px line (name left, amount right), meta as one muted 12px line beneath, no extra row padding, section totals sticky. Honors the same column toggles as the table.
- **Bottom tab bar:** 56px + safe-area, icon over 11px label, active item `primary` with `primary-soft` pill, 44px minimum target each.
- **Dialog / Sheet:** `lg` radius, scrim, focus trapped, Esc closes. Destructive confirmations state the row count (see CLAUDE.md data safety).
- **Chip / Stat:** quiet, tinted background plus label, never a colored edge.
- **States:** every list and form needs empty, loading, error and long-content versions, not just the happy path.

## Do's and Don'ts

- Do right-align and tabularize every number.
- Do use `primary` for at most one main action per view.
- Do signal state with tint, icon or label.
- Do keep every touch target 44px on phone.
- Don't use emoji as icons or bullets.
- Don't nest a panel inside a panel.
- Don't put a colored left border on rows or cards.
- Don't add gradients, glows, blurred glass or decorative shapes.
- Don't change routes, field order, data behavior or confirmation wording of destructive actions as part of a visual pass.

## Motion

- **Approach:** minimal-functional.
- **Easing:** enter ease-out, exit ease-in, move ease-in-out.
- **Duration:** hover/press 120ms, drawer, sheet and dialog 160-200ms. Nothing animates on data load. `prefers-reduced-motion` removes transforms and keeps opacity fades.
- **The one authored moment:** the sync chip settling from "menyinkron" to "tersimpan" (a quick check-mark swap), because sync is the one status that must feel trustworthy.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-01 | Initial design system created | Created by /design-consultation. Retheme with no flow change; phone felt "weird" (14-item drawer, 44px rows that read as mostly gap). |
| 2026-10-01 | Phone nav becomes a bottom tab bar, with the drawer replaced by a "Lainnya" sheet | User asked for it. Same routes and groups; only the control changes. |
| 2026-10-01 | No emoji icons, replaced by a single SVG line icon set | User asked for proper nav icons. |
