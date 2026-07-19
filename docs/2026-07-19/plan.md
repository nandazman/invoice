# Plan — 2026-07-19

Three changes, in this order:

1. **Delete the per-page JSON import/export.** Full backup/restore already covers it.
2. **Preview modal before copying text**, shared by Ekspor Excel and Buat Invoice.
   Invoice gains copy-text, which it does not have today.
3. **Richer, shared filters** — date presets and a type filter — extracted into one
   hook plus one component, used by Invoice, Excel, and Pesanan.

> Scope: routes + two small new files. **No schema change, no store change, no
> exporter rewrite.** Explicit non-goals below.

## 1. The JSON import/export is dead weight

Four pages carry an `Impor JSON` / `Ekspor JSON` pair — `OrdersPage.tsx:285`,
`PricesPage.tsx:242`, `StockPage.tsx:127`, `BeliStockPage.tsx:205`. Each is backed
by a `serialize*`/`parse*` pair in `io.ts` (~330 lines of hand-rolled Indonesian-
column mapping, with its own date parsing and id regeneration).

Every one of them is a worse version of Cadangkan/Pulihkan in the sidebar
(`RootLayout.tsx:79-105`). Backup writes every table at once, preserves ids
byte-for-byte, versions the file (`BACKUP_VERSION = 3`), and upgrades v2 files on
read. The per-page exports regenerate ids, cover one table, and have no version
field — so a "restore" from one silently detaches every cross-table link
(`OrderItem.productId`, `StockMovement.orderId`).

The import path is worse than useless, it is a footgun: `OrdersPage`'s
`doImport` calls `setOrders(imported)`, **replacing the whole table** behind a
single `confirm()`.

`backup.ts` shares no code with `io.ts` — it imports from `store`, `audit`, and
`template-store` only. So this is pure subtraction with no coupling to unpick.

**Kept:** `downloadJSON` and `pickJSONFile`. `RootLayout` uses both, and they are
the only part of `io.ts` that is about files rather than about schemas.

## 2. Copy text should show what it is about to copy

Today `Salin teks` copies straight to the clipboard and reports success with a
transient `✓ Tersalin` label (`ExcelPage.tsx:139-148`). You find out what you
copied by pasting it somewhere. With `showPrice` in the mix the same button
produces two very different outputs, and the only way to check which one you got
is to paste and look.

A preview modal makes the output visible before it leaves the app: the text in a
read-only `<textarea>`, the `Tampilkan harga` checkbox beside it, and a Copy
button.

`buildOrdersText(items, { title, showPrice })` already produces exactly that
string (`orderText.ts:18`), grouping, subtotals, grand total and all. The modal
renders its return value. No second text builder.

**`showPrice` stays one piece of state, on the page.** It already exists there
(`ExcelPage.tsx:243`) and already feeds the XLSX and image exports. The modal
edits that same state rather than owning a copy, so the preview shows what the
other export buttons will produce too. Toggling it re-runs `buildOrdersText` —
a string join over staged rows, cheap enough to run on render.

**Invoice gets the same modal.** It has staged `OrderItem[]` and no copy-text at
all right now. Same component, same builder, `title: "🧾 Invoice"`.

### Why no "harga dasar" toggle

Considered and dropped. `hargaDasar` lives on `Product` (`types.ts:21`), not on
the row, and it is the product's **current** cost. Exporting a March order in July
would print July's cost against March's sale price, with nothing marking the two
as different eras. Rows with `productId: ""` (legacy unmatched, `types.ts:35`)
resolve to no cost at all.

Doing it honestly means snapshotting cost onto the row when the order is created —
a schema change, a backfill, and a `BACKUP_VERSION` bump. Not worth it for a column
nobody has asked to read yet.

This is also why `excel.ts` and `orderImage.ts` are **not** being refactored. Both
hardcode two layouts around `showPrice` (`lastCol = showPrice ? 5 : 3`, literal
cell letters in the formulas). A third money column would have forced those into a
column list. Without one, the existing two shapes are fine, and rewriting the
formula construction risks the Σ(lines) === subtotal === grand-total invariant that
`excel.ts` is commented to protect. Left alone.

## 3. The filter block exists three times

`InvoicePage.tsx:50-77`, `ExcelPage.tsx:36-88` and `OrdersPage.tsx:117-176` each
declare the same five `useState`s (`exact`, `from`, `to`, `produk`, `status`), the
same `clearFilters`, the same `hasFilter`, and a `filtered` `useMemo` whose body is
identical apart from Excel's guard for status on purchases. Three copies of one
idea — any new filter means writing it three times and keeping three copies honest.

### Shape: a hook and a presentational component

```
useOrderFilter(rows, products) -> { values, set, filtered, clear, hasFilter }
<FilterBar filter={f} className="...">{extras}</FilterBar>
```

The hook owns state and filtering. `<FilterBar>` renders inputs and calls
`filter.set`. No context, no provider, no compound component — there is exactly one
consumer per page and nothing nested to reach past.

**No boolean props.** `<FilterBar>` renders only what all three pages always show:
the date fields and the product search. Everything page-specific goes in as
`children` — Excel's `Sumber` select, the `Status` select on the pages that have it.
Layout differs (Invoice is a 320px sidebar stack, the others a horizontal row), so
that is a `className`, not a `vertical` prop. A `showStatus`/`compact`/`vertical`
prop set is how this file becomes unreadable by the fourth caller.

**`hasFilter` returns a real boolean.** Today it is
`exact || from || to || produk || status !== "semua"` — a *string* in most cases.
Harmless in `{hasFilter && ...}` since `""` renders nothing, but it is a bug waiting
for someone to render it.

### Date presets

Buttons filling `from`/`to`: Hari ini, Kemarin, 7 hari, Bulan ini, Bulan lalu.
One pure function, `presetRange(key) => [from, to]`, built on `Date` and
`toISOString().slice(0,10)`. No date library — month-boundary arithmetic is
`new Date(y, m + 1, 0)` and that is the whole hard part.

Because they write to existing `from`/`to` state, nothing downstream changes.

### Type filter

Filter by `Product.tipe`. The catch: neither `OrderItem` nor `PurchaseItem` stores
`tipe` — only `productId` (`types.ts:35`). Resolving it per row means a product
lookup inside the filter predicate, which runs on every keystroke of the product
search: O(rows × products).

So the hook builds `Map<productId, tipe>` once in a `useMemo` over `products`, and
the predicate does a `Map.get`. The same Map is why `products` is a hook argument
rather than something `<FilterBar>` fetches itself.

Options come from `useTypes()`. A plain `<Select>` — **not** `TypeSelect`, which
requires `onCreate` and offers "+ Buat tipe". Creating a type while filtering by
type makes no sense.

Rows with `productId: ""` match no type and drop out whenever a type is selected.
That is correct, and visible: the `N cocok` count reflects it.

### Search responsiveness

The product search filters every row on every keystroke. `useDeferredValue` on that
one string keeps typing smooth if the list grows (React 18.3 — available). Two
lines, in the hook, where all three pages get it.

## Not in this change

- **No filter persistence.** Filters stay ephemeral. Column visibility and hidden
  ids persist because they are long-lived view preferences; a date range is not.
  Also dodges owning a versioned localStorage schema for state that costs seconds
  to retype.
- **No sort controls, no min/max qty or total.** Not asked for.
- **No `hargaDasar` anywhere** — see above.
- **No changes to `excel.ts` / `orderImage.ts`** — see above.
- **No changes to storage, stores, or entity types.**
