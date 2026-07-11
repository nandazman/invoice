# Plan — 2026-07-11

Fix two "total sum is not the same" bugs reported against the **invoice
generator** and the **Excel export**. Both have the *same root cause*: a total is
derived from a **different basis** than the per-line amounts a reader sees, so the
printed lines don't add up to the printed total.

> Scope: document + fix `InvoicePage`/template total and `excel.ts`. The identical
> rounding pattern also exists on `OrdersPage`, `BeliStockPage`, `orderText.ts`,
> and `orderImage.ts`; those are called out as **related** and fixed opportunistically
> via a shared helper, but the reported defects are invoice + Excel.

## The invariant we want

> **A displayed grand total must equal the sum of the per-line amounts as they are
> displayed.** Since every money cell is rendered with `formatRupiah`
> (`maximumFractionDigits: 0`, i.e. rounded to whole rupiah), every total must be
> `Σ round(lineTotal)` — never `round(Σ rawLineTotal)`, and never a value
> recomputed from a different column.

---

## Bug A — Invoice generator: lines don't sum to TOTAL

**Where**

- `src/routes/InvoicePage.tsx:112`
  ```ts
  const total = staged.reduce((s, i) => s + i.totalHarga, 0); // raw sum
  ```
- `src/components/template/ElementContent.tsx:70` — items table renders each line
  as `formatRupiah(Number(row.totalHarga))` → **rounded per line**.
- `src/components/template/ElementContent.tsx:134` — the `total` element renders
  `formatRupiah(data.total)` → **round of the raw sum**.

**Symptom**

Printed line amounts = `Σ round(totalHarga_i)`; printed TOTAL =
`round(Σ totalHarga_i)`. These differ whenever line totals have fractional parts.

**Reachable because** quantity input is `step="any"` (`AddItemForm.tsx:189`), so a
fractional qty × price yields a fractional `totalHarga` (e.g. `0.1 × 3333 = 333.3`).
Three such lines print `333 + 333 + 333 = 999` but TOTAL prints `round(999.9) = 1000`.

**Fix**

Compute the invoice total as the sum of per-line **rounded** rupiah:

```ts
const total = sumRupiah(staged.map((i) => i.totalHarga));
```

Now the TOTAL element equals the sum of the line amounts the customer reads. No
change needed in `ElementContent` (it already rounds each line via `formatRupiah`).

---

## Bug B — Excel export: total computed on a different basis

**Where** — `src/lib/excel.ts`

1. **Recomputes the line total instead of using stored `totalHarga`.**
   - `excel.ts:80`: `eCell.value = { formula: `C${rowNum}*D${rowNum}` }`
     → Excel's Total column = `kuantitas × hargaSatuan`, **not** the stored
     `totalHarga`.
   - `excel.ts:108`: subtotal = `SUM(E…)`; `excel.ts:126`: grand = `E…+E…`.
   - Everywhere else uses the stored field: `orderText.ts:35/41`,
     `orderImage.ts:135/168`, JSON `serializeOrders` (`io.ts:120`), and both list
     pages sum `it.totalHarga`.
   - **Divergence:** `parseOrders`/`parsePurchases` trust the file's
     `"Total Harga"` verbatim (`io.ts:165`, `io.ts:250`:
     `Number(it["Total Harga"] ?? kuantitas * hargaSatuan)`). Any imported/legacy
     row whose stored total ≠ `kuantitas × hargaSatuan` (hand-edited sheet,
     discount, pre-rounded value) makes the **Excel sheet disagree with the app and
     the text/image exports** for the same data. This is the concrete "the total
     sum is not the same."

2. **Displayed cells vs. `SUM` rounding.**
   - `excel.ts:70` (`NUM_FMT = "#,##0"`) rounds the *display* of D and E, but the
     `C*D` and `SUM` formulas run on **exact** underlying values. A reader adding
     the visible line amounts gets `Σ round(...)`; the sheet's subtotal shows
     `round(Σ exact)` — same mismatch class as Bug A, visible inside one file.

**Fix (chosen: keep formulas, round each line)**

Keep the sheet a *live* spreadsheet but round each line so the visible cells add
up to the subtotals/grand total:

- Column E per line = formula `ROUND(C*D, 0)` (was `C*D`) with `numFmt = NUM_FMT`.
- Subtotal cell = `SUM(E..)` over the now-rounded E cells, bold.
- Grand total cell = sum of the subtotal cells (`E4+E9+…`).
- Column D (`hargaSatuan`) stays a literal value with `NUM_FMT`.

**Why formulas, not literals:** in-app `totalHarga` is *always* set to
`kuantitas × hargaSatuan` (`AddItemForm.tsx:106`, `AddPurchaseForm.tsx:117`), so
`ROUND(C*D,0)` produces the **same** number as `roundRupiah(totalHarga)` for real
app data — the sheet stays in parity with the app/text/image/JSON *and* keeps
recalculating when the recipient edits a qty or price. `ROUND` (not bare `C*D`)
is what fixes the displayed-lines-don't-sum-to-subtotal half of the bug.

**Residual limitation (acceptable):** a formula recomputes from `qty × price`, so
it cannot honor an *imported* row whose stored `totalHarga` was hand-edited to
differ from `qty × price` (`io.ts:165/250`). This only occurs with externally
edited/discounted import files, which the app never produces; if that ever
becomes a real workflow, switch the E cells to literal `roundRupiah(it.totalHarga)`.

---

## Shared helper (`src/lib/format.ts`)

Add and reuse so the invariant lives in one place:

```ts
// Whole-rupiah rounding used for every displayed money value.
export function roundRupiah(n: number): number {
  return Math.round(n);
}
// Sum a list of rupiah line totals the way they are displayed: round each line,
// then add. Guarantees Σ(displayed lines) === displayed total.
export function sumRupiah(nums: number[]): number {
  return nums.reduce((s, n) => s + roundRupiah(n), 0);
}
```

Use `sumRupiah` for the invoice total and the Excel literal subtotals/grand total.
The Excel export keeps live formulas (`ROUND(C*D,0)` + `SUM`), so it does not use
these helpers directly — `ROUND(C*D,0)` equals `roundRupiah(totalHarga)` for app
data. The helpers back the invoice total, the two list pages, and the text/image
exports.

## Related (optional, same helper)

Same `raw-sum vs Σ-rounded` gap exists in — fix if touching, low risk:

- `routes/OrdersPage.tsx:152` (group total) & `:157` (grandTotal)
- `routes/BeliStockPage.tsx:137` & `:142`
- `lib/orderText.ts:35` (subtotal) & `:41` (grandTotal)
- `lib/orderImage.ts:135` (grandTotal) & `:168` (subtotal)
- `routes/InvoicePage.tsx` — the sidebar `total` at `:112` is the same value being fixed.

These only ever surface with fractional line totals; batching them behind
`sumRupiah` removes the whole class.

---

## Verification

- **Logic test** (node/bun, vs. shipped helpers): items
  `[{q:0.1,h:3333},{q:0.1,h:3333},{q:0.1,h:3333}]` → each line `333`, total `999`
  (not `1000`). Confirms invoice + Excel now agree with the printed lines.
- **Parity test:** for a dataset, assert
  `excelGrandTotal === buildOrdersText-total === renderImage-total === app-grandTotal`,
  including an imported row where `totalHarga` was overridden to differ from
  `kuantitas × hargaSatuan`.
- `tsc -b` + `vite build` clean.
- **Live UI:** stage fractional-qty orders in Buat Invoice → TOTAL equals the sum
  of the line "Total" column in the preview and print; export the same to XLSX →
  E column, subtotals, and grand total match the on-screen figures and the
  text/image exports.

See `tasks.md` for the itemized checklist.
