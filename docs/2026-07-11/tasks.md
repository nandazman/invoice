# Tasks — 2026-07-11

Fix the two reported "total sum is not the same" bugs: **invoice generator** and
**Excel export**. See `plan.md` for root cause (totals derived on a different
basis than the displayed per-line amounts) and the target invariant.

## 0. Shared helper

- [x] `src/lib/format.ts`: add `roundRupiah(n)` (`Math.round`) and
      `sumRupiah(nums)` (`Σ round(n)`), with a comment stating the invariant
      "Σ(displayed lines) === displayed total".

## 1. Bug A — Invoice generator

- [x] `src/routes/InvoicePage.tsx:112`: replace
      `staged.reduce((s,i)=>s+i.totalHarga,0)` with
      `sumRupiah(staged.map((i) => i.totalHarga))`.
- [x] Confirm `ElementContent.tsx` needs no change (items table `:70` and total
      `:134` already render via `formatRupiah`, i.e. rounded). The TOTAL element
      now equals the sum of the displayed line "Total" values.

## 2. Bug B — Excel export (`src/lib/excel.ts`)

**Decision: keep live formulas but round each line** (user chose formulas over
static numbers, to preserve the editable/recalculating spreadsheet).

- [x] Per-line Total (`excel.ts` E cell): formula `ROUND(C*D,0)` (was `C*D`),
      keep `numFmt = NUM_FMT`. `ROUND` is what fixes the rounding half of the bug.
- [x] Subtotal: `SUM(E..)` over the now-rounded E cells, bold, `numFmt`.
- [x] Grand total: sum of the subtotal cells (`E4+E9+…`), bold, `numFmt`.
- [x] Keep column D (`hargaSatuan`) a literal with `NUM_FMT`.
- [x] Trade-off resolved: formulas retained (sheet stays live). Valid because
      in-app `totalHarga === kuantitas × hargaSatuan`, so `ROUND(C*D,0)` matches
      the stored total. Residual: won't honor imported hand-edited totals that
      differ from `qty × price` — acceptable (app never produces those).

## 3. Related (optional — same helper, only if touching)

- [x] `routes/OrdersPage.tsx:152` & `:157` → `sumRupiah`.
- [x] `routes/BeliStockPage.tsx:137` & `:142` → `sumRupiah`.
- [x] `lib/orderText.ts:35` & `:41` → `sumRupiah`.
- [x] `lib/orderImage.ts:135` & `:168` → `sumRupiah`.

## 4. Verification

- [x] Logic test: `[{q:0.1,h:3333}×3]` → lines `333/333/333`, invoice total `999`,
      Excel grand `999` (not `1000`).
- [x] Parity test: `excelGrand === textTotal === imageTotal === app grandTotal`,
      including an **imported** row whose `totalHarga` was overridden to differ
      from `kuantitas × hargaSatuan` (proves Excel stops recomputing).
- [x] `tsc -b` + `vite build` clean.
- [~] Live UI (not yet run): fractional-qty invoice — TOTAL matches the summed line column in
      preview + print; XLSX cells, subtotals, grand total match on-screen and the
      text/image exports. *(live-UI)*

## 5. Automated tests + CI

- [x] Add **Vitest** (`bun add -d vitest`); scripts `test` (`vitest run`) and
      `test:watch`.
- [x] `src/lib/format.test.ts` — `roundRupiah`/`sumRupiah` invariant, the
      `[0.1×3333]×3 → 999` case.
- [x] `src/lib/orderText.test.ts` — subtotals/grand total via `sumRupiah`;
      fractional case; showPrice off.
- [x] `src/lib/excel.test.ts` — asserts `ROUND(C*D,0)`/`SUM`/additive-grand
      formula wiring, plus a mini formula-evaluator proving evaluated grand
      total `=== sumRupiah` (parity), across multiple dates.
- [x] 13 tests pass (`bun run test`).
- [x] CI: `.github/workflows/ci.yml` runs build + tests on **PR** and on
      **push to main/master** (merge). Also added the `Test` step to
      `deploy.yml` so a failing test blocks the Pages deploy.
