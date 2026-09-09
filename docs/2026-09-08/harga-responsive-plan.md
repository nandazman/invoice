# Daftar Harga: responsive + UI/UX plan

Target: `src/routes/PricesPage.tsx`, plus the shell it lives in
(`src/routes/RootLayout.tsx`) and the table/toolbar primitives it shares with
twelve other pages.

Constraint set by the user: **UI/UX only. No flow changes without asking
first.** Moving an action to a different place, hiding it behind a menu, or
changing what a control does is a flow change and needs confirmation.

## What already exists

| Thing | Where | Reuse or replace |
|---|---|---|
| `Panel` (white card, `rounded-xl`, `p-4`) | `src/components/Panel.tsx` | Reuse, add responsive padding |
| `Button` / `PrimaryButton` / `DangerButton` / `GhostButton` | `src/components/Button.tsx` | Reuse, fix touch height |
| `Field` (visible label above control, error via context) | `src/components/Field.tsx` | Reuse as-is, it is correct |
| `Input` | `src/components/Input.tsx` | Reuse |
| `Modal` (Escape, backdrop, nesting stack) | `src/components/Modal.tsx` | Reuse, add mobile sheet variant |
| `ColumnToggle` | `src/components/ColumnToggle.tsx` | Reuse, fix dropdown overflow |
| `SyncChip` | `src/components/SyncChip.tsx` | Reuse in the mobile app bar |
| `thClass` / `tdClass` | copy-pasted in **13 files** | Replace with one shared table |
| `no-scrollbar` utility | `src/styles.css` | Reuse for the toolbar overflow row |
| Tailwind v4 slate/blue/emerald palette | throughout | Formalise as tokens |

No `DESIGN.md` exists. No `CLAUDE.md` design conventions existed before today.
`docs/2026-07-04/tasks.md:24` records "Verify responsive layout (scroll/wrap)"
as done, which is where the current assumption came from: wrap and scroll were
treated as responsiveness.

## Current state, measured

- **Zero responsive breakpoints in the whole app.** `grep -rn "sm:|md:|lg:" src/`
  returns nothing. `index.html:5` has the viewport meta, so a phone renders the
  desktop layout squeezed, not reflowed.
- `RootLayout.tsx:427` — sidebar is `w-56 sticky h-screen`, unconditional. 57%
  of a 390px screen. No drawer, no overlay.
- `RootLayout.tsx:448` — content capped at `max-w-5xl` (1024px). Wrong cap for a
  data page: huge empty margins on a wide monitor while the table is cramped.
- `PricesPage.tsx:213` — toolbar is one `flex-wrap` row. Below ~700px it wraps
  ragged, and `ColumnToggle`'s `absolute right-0` panel hangs off-screen once
  its button wraps to the left edge.
- `PricesPage.tsx:238` — `overflow-x-auto` exists, but no sticky header, no
  sticky name column, no scroll shadow.
- `PricesPage.tsx:250` — sortable headers are `<th onClick>`: no `aria-sort`,
  not keyboard reachable, no hover affordance, and the `▲` shifts the label.
- `Button.tsx:12` — `size="sm"` is `px-2.5 py-1` ≈ 26px tall. Touch minimum is 44px.

## Phases

1. **Shell** (`RootLayout.tsx`): off-canvas drawer under `md`, top app bar,
   raise the content cap.
2. **Primitives**: extract `DataTable` + `Toolbar`, migrate Harga onto them.
3. **Harga content**: the responsive layout and the density fixes.
4. **Polish**: dialogs at 390px, touch targets, badge colour.

## Outside voice: Codex (gpt-5.6-luna, high reasoning)

Classification: **APP UI**. Hard rejections: all clear (0 of 7 triggered).
Litmus: 5 YES, 2 NO — "cards actually necessary" NO (the outer `Panel` does not
earn its width) and "motion improves hierarchy" NO (no motion is specified).

Nine findings. Where I stand on each:

| # | Codex finding | My call |
|---|---|---|
| 1 | Keep a real `<table>` at 390px with a sticky name column; cards destroy column alignment and slow price comparison | **Partly agree** — correct about semantics and comparison, overconfident about the dominant mobile task. This is the user's decision, see D4 |
| 2 | Column priority and per-column min-widths are unspecified; never auto-hide columns without approval | **Agree** — auto-hiding on viewport would silently diverge from the persisted `invoice.harga.cols.v2` state |
| 3 | The drawer + app bar is a flow change and needs explicit approval | **Agree** — matches the user's own constraint |
| 4 | Toolbar mobile order undefined; `ColumnToggle` must not overflow the viewport | **Agree** |
| 5 | Sortable `<th>` needs a real `<button>`, `aria-sort`, focus-visible, stable icon slot | **Agree** |
| 6 | "Density fixes" needs numbers: row height, nowrap on money, conversion truncation, filtered count, two empty states | **Agree** |
| 7 | Drop the outer `Panel` — it costs width and makes the table read as a dashboard tile | **Agree on mobile, disagree on desktop.** Edge-to-edge under `md`, keep the panel above it where the width is free and it matches the other 12 pages |
| 8 | Define semantic CSS variables; replace `system-ui` with a real typeface | **Split.** Tokens: agree, but that is a 13-file refactor, so it is a TODO not this branch. Typeface: **disagree** — this is an offline-first PWA for cheap Android phones; a webfont buys a network request and a FOUT on exactly the device class this app targets. The "no system-ui" rule is a marketing-page rule |
| 9 | Specify one drawer transition on transform/opacity, honour `prefers-reduced-motion` | **Agree** — cheap, and `RootLayout.tsx:427` already animates width, which is the wrong property |

Second Claude voice skipped: Codex's nine points already overlap my own audit and
name the same decisions. A third opinion on the same list would not change what
is in front of the user.

## Pass ratings (before fixes)

| Pass | Score | Why |
|---|---|---|
| 1 Information architecture | 4/10 | Names the containers, never says what the user reads first on a phone |
| 2 Interaction states | 2/10 | Only distinguishes two empty states. No loading, no error, no partial, no sync-pending row state |
| 3 User journey | 3/10 | No account of the actual mobile task: standing in a shop, one hand, looking up one price |
| 4 AI slop risk | 7/10 | Utility language throughout, no hero, no card grid. Loses points for unspecified visual decisions that an implementer will fill with defaults |
| 5 Design system | 2/10 | No DESIGN.md, no tokens, colour literals in 13 route files |
| 6 Responsive + a11y | 4/10 | Breakpoints named, but no per-viewport layout, no keyboard spec, one touch-target number |
| 7 Unresolved decisions | 6 open | Listed below |

## Decisions made in review

| # | Decision | Chosen | Note |
|---|---|---|---|
| D4 | Mobile table layout | **Two-column table**: `Produk` (name, type badge, size stacked) and `Harga Satuan` (laba beneath) | Fallback to stacked cards is pre-approved. Build the mobile row as ONE component so the swap is a component swap, not a rewrite |
| D5 | Mobile navigation | **Off-canvas drawer + top app bar** | Approved flow change |
| D6 | Desktop row actions | **Restyle in place**, no flow change | Ubah as quiet text action, Hapus as muted icon that reddens on hover/focus |
| D7 | Mobile row actions | **None in the table**; edit via the existing `/produk/$id` detail page | Two-tap edit is the deliberate test of D4. If it bites, that is the signal to take the cards fallback |

## Breakpoints

One breakpoint does the structural work. Tailwind defaults, no custom screens.

- `< md` (under 768px) — phone. Drawer nav, two-column table, edge-to-edge, stacked toolbar.
- `md` to `lg` — tablet. Sidebar returns, table shows the core columns.
- `>= lg` — desktop. Today's layout, wider content cap.

## Phase 1 — Shell (`RootLayout.tsx`)

**Top app bar**, `md:hidden`, sticky, 56px tall, white on `border-b border-slate-200`:
hamburger 44x44, then the app name, then `SyncChip` pushed right. The chip stays
in the bar rather than the drawer — sync state is the one thing that must never
need a tap to see.

**Drawer**: the existing `aside` gains `fixed inset-y-0 left-0 z-40 w-64
-translate-x-full transition-transform md:static md:translate-x-0 md:w-56`.
Open state adds `translate-x-0`. Backdrop is `fixed inset-0 bg-black/40 z-30
md:hidden`.

Required behaviour:
- Escape closes. Reuse the mount-order stack pattern from `Modal.tsx:3` rather
  than adding a second window listener.
- Backdrop click closes.
- Focus moves to the drawer's first link on open, and returns to the hamburger
  on close.
- `aria-expanded` on the hamburger, with Indonesian labels.
- Closes on route change. `useRouterState` is already subscribed at
  `RootLayout.tsx:88`.
- `body` gets `overflow-hidden` while open.
- The `collapsed` localStorage state stays desktop-only. Drawer open/close is
  transient and must not be persisted.

**Motion**: `transition-transform duration-200 ease-out` on the drawer,
`transition-opacity` on the backdrop. Transform and opacity only. Wrap in
`motion-safe:` so `prefers-reduced-motion` gets an instant show and hide.
Also fix `RootLayout.tsx:427`, which animates `width` — the wrong property, it
lays out on every frame. Switch the desktop collapse to the same treatment.

**Content cap**: `max-w-5xl` becomes `max-w-[1400px]`, padding `p-4 md:p-6`.

**Boot skeleton**: `main.tsx:40` renders nothing until `bootstrap()` resolves, so
a cold PWA start on a slow phone is a blank white document. Put a static
skeleton inside `#root` in `index.html` — an app-bar strip plus four grey row
placeholders — which the first React render replaces. No JS, no flash.

## Phase 2 — Primitives

`src/components/DataTable.tsx` owns what is currently copy-pasted across 13
files: `thClass` and `tdClass`, the scroll container, sticky `thead`, sortable
headers, and both empty states. Migrate `PricesPage` onto it; the other twelve
follow in separate commits.

Sortable header markup, replacing `PricesPage.tsx:250`:

    <th scope="col" aria-sort={ariaSort}>
      <button
        type="button"
        onClick={h.column.getToggleSortingHandler()}
        className="inline-flex items-center gap-1 w-full focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        {label}
        <span aria-hidden className="w-3 text-slate-400">{arrow}</span>
      </button>
    </th>

The arrow lives in a fixed-width `w-3` span that is always rendered, so the
header label never shifts when sorting changes.

`Toolbar`: search full width, actions in a second row that scrolls horizontally
using the existing `no-scrollbar` utility. `ColumnToggle`'s panel gets
`max-w-[calc(100vw-2rem)]` and flips to `left-0` when its button sits left of
centre, so it can never render off-screen.

## Phase 3 — Harga content

**Column priority.** Never auto-hide by viewport — that would silently diverge
from the persisted `invoice.harga.cols.v2` state and give two devices different
views of the same toggle.

| Column | under md | md to lg | lg and up | Min width |
|---|---|---|---|---|
| Nama Produk | inside `Produk` cell | shown | shown | 180px |
| Tipe | inside `Produk` cell | shown | shown | 80px |
| Ukuran | inside `Produk` cell | shown | shown | 90px |
| Harga Dasar | detail page | shown | shown | 110px |
| Harga Satuan | own column | shown | shown | 110px |
| Laba | under Harga Satuan | shown | shown | 100px |
| Konversi | detail page | badge under name | own column | 140px |
| Dibuat / Diperbarui / Dibuat oleh / Diubah oleh | user toggle only | user toggle only | user toggle only | 120px |
| Aksi | none, see D7 | shown | shown | 96px |

**Money.** Move `Rp` into the header and drop it from the cells; `formatRupiah`
currently prints it roughly 600 times per screen. Keep `tabular-nums` and right
alignment. Add `whitespace-nowrap` — a wrapped price is a misread price.

**Konversi.** A column of em-dashes in the current screenshot, and multiple
badges make a row disproportionately tall (`PricesPage.tsx:150`). Cap at two
badges plus a `+N` chip; the full list lives on the detail page. At `md` it moves
under the product name instead of holding its own column.

**Tipe badge.** All grey today, so the column reads as texture rather than
information. Derive a colour from a hash of the type string across a fixed set of
four token pairs, so `Bar` and `Kitchen` separate at a glance and any new type
still gets a stable colour without a config entry.

**Row actions (D6).** `Ubah` becomes a ghost button in slate that darkens on
hover. `Hapus` stays the word, not an icon, in the same quiet slate as Ubah, going
`text-red-600 bg-red-50` only on hover and focus-visible, with an Indonesian
`aria-label` naming the product. Both keep 44px hit areas via padding.

**Surface.** Drop `Panel` under `md` — its `p-4` costs 32 of 390 horizontal
pixels, and it makes the table read as a dashboard tile. Edge-to-edge table with
`border-y` only. Keep `Panel` at `md` and up, where the width is free and it
matches the other twelve pages.

**Counts and empty states.** The footer becomes a "showing N of M" line driven by
`table.getRowModel().rows.length`. The current line at `PricesPage.tsx:276` never
changes when you filter.

**Search.** Leading magnifier, and a clear button at 44px that appears only when
the field has content. Keep the visible `Cari produk` label from `Field` — never
placeholder-as-label.

## Interaction states

| Surface | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| App boot | static skeleton in `index.html` (new) | — | `renderBootError` at `main.tsx:26`, already good | app renders | — |
| Price table | none needed, stores are synchronous after boot | two distinct states, below | — | — | — |
| Empty, no products | — | "Belum ada produk." plus a subline and the `+ Tambah Produk` primary button | — | — | — |
| Empty, search miss | — | "Tidak ada produk yang cocok" naming the query, plus a clear-search button | — | — | — |
| Sync | — | — | existing `SyncChip`, now in the app bar on mobile | — | chip shows the pending count |
| Delete | existing `ConfirmDialog` | — | — | row disappears | — |

The current single "Tidak ada produk." at `PricesPage.tsx:271` is neither of the
two empty states it has to serve.

## Phase 4 — Polish

- `Button` at `size="sm"`: `px-2.5 py-1` becomes `px-2.5 py-2.5 md:py-1`, clearing
  44px on touch without changing desktop density.
- `Modal`: add a mobile sheet variant — `items-end md:items-center`,
  `rounded-t-2xl md:rounded-xl`, `max-h-[85vh]`. `CatalogDialog.tsx:149` is
  `max-w-6xl` and needs it most.
- `ProductDialog` form fields to a single column under `md`.
- `inputMode="numeric"` on every price and quantity field, so the phone opens the
  number pad.

## Accessibility acceptance criteria

- Every interactive control reachable by Tab, in visual order.
- A `focus-visible` ring on every control. The app has none today.
- Sort headers: real `button`, `aria-sort` on the `th`, Indonesian labels.
- Drawer: focus moves in on open, returns to the hamburger on close, Escape closes.
- Touch targets 44x44 minimum below `md`.
- Body text never below 16px. The `text-xs` timestamps stay secondary and are
  toggled off by default.
- Contrast 4.5:1 on body text. `text-slate-400` on white is 3.1:1, so it fails —
  and it is currently used for the row count, the em-dashes, and the timestamps.
  Move those to `text-slate-500` at 4.8:1.
- `prefers-reduced-motion` honoured on the drawer.

## NOT in scope

| Deferred | Why |
|---|---|
| Semantic CSS colour tokens | Codex is right that colour literals across 13 route files will drift, but converting them is a whole-app refactor, not a Harga change. Tracked as a TODO |
| Replacing `system-ui` with a real typeface | Disagreed with the rule here. This is an offline-first PWA on cheap Android phones; a webfont costs a request and a FOUT on exactly the target device. `system-ui` is the correct call for a utility tool |
| Migrating the other twelve tables to `DataTable` | Separate commits, mechanical, and no design decisions are left once Harga lands |
| Virtualising the row list | 212 rows renders fine. Revisit past roughly 2000 |
| Per-row sync-pending state | `SyncChip` reports globally; per-row would be new UI for a rare state |
| Dark mode | Never requested, and there is no token layer to hang it on yet |

## Assumption stated, not asked

`DataTable` is extracted in this branch rather than after a second page needs it.
The responsive work rewrites the table markup anyway, and doing it once beats
doing it twice. Reversible: if extraction fights `PricesPage`'s column meta,
inline it and extract later.
## Scope (D8)

Shell work (drawer, app bar, touch targets, dialogs, contrast) lands for all 13
pages in this branch. Only the Harga table is redesigned. The other twelve
tables each need their own answer to "which two columns survive at 390px" — a
short decision per page, taken when that page is migrated in T13, not guessed
now.

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Harga phone + desktop + empty states | `~/.gstack/projects/nandazman-invoice/designs/harga-responsive-20260908/wireframe.html` | Two-column phone table, drawer app bar, restyled row actions, split empty states | Hand-built wireframe. The gstack designer is installed but has no OpenAI key on this machine, so AI mockups were unavailable |

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific
finding above. Checkbox as you ship.

- [x] **T1 (P1, human: ~4h / CC: ~25min)** — RootLayout — off-canvas drawer, top app bar, wider content cap
  - Surfaced by: D5, and Codex finding 3 — the shell change is a flow change and needs the full behaviour spec
  - Files: `src/routes/RootLayout.tsx`, `src/components/Modal.tsx` (reuse the Escape stack)
  - Verify: at 390px the nav is off-screen until the hamburger is tapped; Escape and backdrop close it; focus returns to the hamburger; the drawer closes on navigation; `prefers-reduced-motion` kills the slide
- [x] **T2 (P1, human: ~3h / CC: ~20min)** — DataTable — extract the shared table and make sorting accessible
  - Surfaced by: Codex finding 5, plus `thClass` duplicated across 13 files
  - Files: new `src/components/DataTable.tsx`, `src/routes/PricesPage.tsx`
  - Verify: Tab reaches every sort header, Enter sorts, `aria-sort` updates, the header label does not shift when the arrow appears, `thead` stays stuck while scrolling
- [x] **T3 (P1, human: ~4h / CC: ~25min)** — PricesPage — two-column phone layout as one swappable component
  - Surfaced by: D4, D7
  - Files: `src/routes/PricesPage.tsx`
  - Verify: at 390px only Produk and Harga Satuan render, no horizontal scrollbar, product name links to the detail page, swapping the mobile row component to cards touches one file
- [x] **T4 (P2, human: ~1h / CC: ~10min)** — index.html — static boot skeleton
  - Surfaced by: Pass 2 — `main.tsx:40` renders nothing until bootstrap resolves, so a cold PWA start is a blank white document
  - Files: `index.html`
  - Verify: throttle to slow 3G with a large IndexedDB; a skeleton shows instead of white, and is replaced without a flash
- [x] **T5 (P2, human: ~2h / CC: ~15min)** — Toolbar — responsive layout and a ColumnToggle that cannot leave the viewport
  - Surfaced by: Codex finding 4, and `ColumnToggle.tsx:47` being `absolute right-0`
  - Files: new `src/components/Toolbar.tsx`, `src/components/ColumnToggle.tsx`, `src/routes/PricesPage.tsx`
  - Verify: at 390px search is full width, the action row scrolls horizontally, and the column panel is fully on screen at every width from 320px up
- [x] **T6 (P2, human: ~1h / CC: ~10min)** — PricesPage — restyle row actions without changing flow
  - Surfaced by: D6 — the delete button is the most prominent element on the page
  - Files: `src/routes/PricesPage.tsx`, `src/components/Button.tsx`
  - Verify: product names read louder than the actions; the trash icon reddens on hover and on keyboard focus; both actions are still one click; hit areas are 44px on touch
- [x] **T7 (P2, human: ~1.5h / CC: ~12min)** — PricesPage — money and conversion density
  - Surfaced by: Codex finding 6, plus `formatRupiah` printing Rp in every cell
  - Files: `src/routes/PricesPage.tsx`, `src/lib/format.ts`
  - Verify: Rp appears once per header and zero times per cell; no price wraps at any width; a product with five conversions is no taller than one with two
- [x] **T8 (P2, human: ~1h / CC: ~8min)** — PricesPage — split the empty states and report the filtered count
  - Surfaced by: Pass 2, plus `PricesPage.tsx:271` and `:276`
  - Files: `src/routes/PricesPage.tsx`
  - Verify: a fresh install shows the add-product CTA; a search miss names the query and offers to clear it; the footer count changes as you type
- [x] **T9 (P2, human: ~2h / CC: ~15min)** — Dialogs and controls — touch targets, mobile sheet, numeric keypad
  - Surfaced by: Pass 6 — `Button.tsx:12` is ~26px tall, `CatalogDialog.tsx:149` is `max-w-6xl`
  - Files: `src/components/Button.tsx`, `src/components/Modal.tsx`, `src/components/CatalogDialog.tsx`, `src/components/ProductDialog.tsx`, `src/components/Input.tsx`
  - Verify: every control clears 44px at 390px; dialogs sit as bottom sheets and never exceed 85vh; price fields open the number pad
- [x] **T10 (P2, human: ~30min / CC: ~5min)** — Contrast — retire text-slate-400 from anything readable
  - Surfaced by: Pass 6 — slate-400 on white is 3.1:1, below the 4.5:1 floor
  - Files: `src/routes/PricesPage.tsx`, `src/components/*`
  - Verify: a contrast checker passes on the row count, the em-dashes, and the timestamps
- [x] **T11 (P3, human: ~45min / CC: ~8min)** — Tipe badge — derive a stable colour per type
  - Surfaced by: Pass 1 — a single grey makes the Tipe column read as texture
  - Files: `src/routes/PricesPage.tsx`, new small helper
  - Verify: Bar and Kitchen are distinguishable at a glance; a newly created type gets a colour with no config change; all pairs clear 4.5:1
- [x] **T12 (P3, human: ~1 day / CC: ~40min)** — Semantic colour tokens across the app
  - Surfaced by: Codex finding 8 — colour literals across 13 route files will drift
  - Files: `src/styles.css`, all route files
  - Verify: no raw palette class remains in a route file; the app looks unchanged
- [x] **T13 (P3, human: ~1 day / CC: ~45min)** — Migrate the remaining 12 tables onto DataTable
  - Surfaced by: `thClass` duplicated in 13 files
  - Files: the 12 remaining route and component files holding a `thClass`
  - Verify: no `const thClass` remains outside `DataTable.tsx`; every page keeps its current columns and sorting

## GSTACK REVIEW REPORT

| Run | Status | Findings |
|---|---|---|
| plan-design-review (7 passes) | complete | 6 decisions surfaced, 4 resolved by the user, 2 resolved by stated assumption |
| Codex design critique (gpt-5.6-luna, high) | complete | 9 findings; 6 agreed, 2 agreed with scope limits, 1 rejected with reasoning |
| Claude second voice | skipped | Codex overlapped the self-audit; a third opinion on the same 9 points would not have changed a decision |
| Visual mockups | fallback | gstack designer installed but keyless; hand-built HTML wireframe produced instead |

| Pass | Before | After |
|---|---|---|
| 1 Information architecture | 4/10 | 9/10 |
| 2 Interaction states | 2/10 | 9/10 |
| 3 User journey | 3/10 | 8/10 |
| 4 AI slop risk | 7/10 | 9/10 |
| 5 Design system | 2/10 | 5/10 — tokens deliberately deferred to T12 |
| 6 Responsive + accessibility | 4/10 | 9/10 |
| 7 Unresolved decisions | 6 open | 0 open |

Overall design score: 4/10 to 8/10.

CODEX absorbed: findings 1 through 7 and 9 are written into the plan above.
Finding 8 is split — tokens deferred to T12, the typeface rule rejected on the
grounds that this is an offline-first PWA for low-end Android and a webfont costs
a request and a FOUT on exactly the target device.

VERDICT: CLEARED — the plan specifies the mobile contract, column priority,
toolbar geometry, interaction states, accessibility criteria, and motion. Pass 5
stays below 8 by the user's implied scope, not by omission; T12 tracks it.

NO UNRESOLVED DECISIONS

### T13 scope note

The shared table chrome is now a single source: `thClass`/`tdClass` are exported
from `DataTable.tsx` and imported by the twelve files that used to declare their
own (HistoryPage keeps its `align-top` as `${tdBase} align-top`). Sorting and
columns are untouched because no page except Harga has sorting, and every table
already had its own `overflow-x-auto` container.

What is NOT done, deliberately: none of the twelve tables were converted to a
TanStack `useReactTable` instance, and none got a phone layout. Per D8 above,
each needs its own answer to "which two columns survive at 390px" — twelve
design decisions, not a mechanical migration. Those stay open.

### T12 scope note

Tokens cover ROLES. Two categorical palettes stay raw palette classes on
purpose, because a colour that means "this row is about a buyer" is not a role
and a token would only rename it: `entityBadgeClass` in `HistoryPage.tsx` and
`src/lib/typeColor.ts`. `Canvas.tsx`'s `bg-pink-500` alignment guides are an
editor affordance, not app chrome, and stay raw for the same reason.
