# Requirement — Generate Beli Stock from Orders

Source: WhatsApp chat with Amenna, 13 Jul 2026.
Author: N. Status: Draft (approved to build).

## Background / Context

The business currently **buys by order** — nothing is stocked up front. For every
order that comes in, the goods that need to be purchased are exactly the contents
of that order.

Problem: on the **Beli Stock** page (`BeliStockPage`), every purchase has to be
**typed in manually**, even though the same data already exists in **Pesanan**
(`OrdersPage`). That is duplicate work.

> Amenna: "for buying stock, do I have to input it manually again? can't I just
> pick the date from the order and the items to be bought show up?"

## Goal

Let the user create Beli Stock entries **from an order** without retyping: pick an
order date → the goods to buy appear automatically → review → save. Because the
model is buy-by-order, the same goods are immediately sold, so stock should show
them coming **in and then straight back out** on the same date.

## User Flow

### Primary flow — from the Orders page (preferred)
1. On `OrdersPage`, the user clicks a **date** (a date group / a "Beli stok"
   action on that date).
2. A **modal** opens listing all order items on that date, **all pre-selected by
   default**.
3. The user can **deselect** any items they don't want to purchase; qty and
   buy-price are editable (price defaults from `hargaDasar`/modal).
4. The user clicks **Save once** — all selected items are committed together.
5. Before committing, a **confirmation modal** appears warning that the entry is
   **permanent / cannot be edited afterwards** — if something is wrong it must be
   fixed by a **manual stock adjustment**. Confirm → commit; Cancel → back to the
   selection modal.

> N: "add items one by one, or add all then click save?" —
> Amenna: "once everything's in, then save."

### Secondary flow — from the Beli Stock page
- Same capability reachable from `BeliStockPage`: pick a date → same modal →
  save. (Same modal component, different entry point.)

## Functional Requirements

- **FR-1** Selecting an order date surfaces every order item on that date as a
  candidate purchase line (pre-filled: product, unit, quantity). No manual typing.
- **FR-2** Each candidate maps to a `PurchaseItem` (same product/unit/qty;
  `hargaSatuan` defaults from modal, editable). Qty is editable too.
- **FR-3** Modal defaults to **select-all**; user may unselect any subset before
  saving.
- **FR-4** **Batch save** — items are staged, committed in one Save action, not
  per item.
- **FR-5 (stock effect — in then out).** Because it's buy-by-order, each purchased
  item produces two `StockMovement` rows on the same `tanggal`:
  - `+qty`, `reason: "purchase"`, `purchaseId` set (the buy).
  - `−qty`, `reason: "sale"`, `orderId` set (the sale from the order).
  - The **sale** movement should already come from the order when
    `affectsStock = true`. This feature must add the **purchase** movement
    **without duplicating** the sale. Net stock ≈ 0.

  > N: "so in stock it'll show goods in then straight back out?" —
  > Amenna: "correct."

- **FR-6 (confirmation before commit).** Saving opens a confirmation modal stating
  the stock entry is **permanent and not editable** — a wrong input must be
  corrected via a **manual stock adjustment**. Only on confirm are the movements
  written.

## Testing

- **Unit tests required** for the order → purchase conversion and the stock
  effect. At minimum:
  - Selected order items map to correct `PurchaseItem`s (product/unit/qty/price).
  - Each purchased item yields a `+qty` purchase movement on the same date, and
    net stock ≈ 0 without duplicating the order's sale movement.
  - Deselected items produce no purchase/movement.
  - Batch save commits all selected items in one action.

## Non-Goals (for now)
- No stocking up front / buying more than ordered.
- No change to the existing order flow beyond linking it to Beli Stock.
- Edit-after-save of a committed stock entry — corrections are manual adjustments.
