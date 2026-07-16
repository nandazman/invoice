# Order stock history design

## Goal

When stock is purchased from an order, retain the purchase record and show a
paired stock increase and decrease in history. The two movements must cancel,
so available stock does not change.

## Flow

`OrdersPage` passes the source order ID to `addPurchase`. `addPurchase` keeps
creating its existing purchase movement (`+qty`) and adds one linked order
movement (`-qty`) for the same product, date, and base-unit quantity.

Manual purchases remain unchanged.

## History

Each item purchased from an order creates:

1. a purchase audit entry;
2. a positive stock movement with reason `purchase`;
3. a negative stock movement with reason `sale`, linked to the source order.

## Verification

Add a regression test that confirms the two stock movements created for an
order purchase have equal and opposite quantities, and that a manual purchase
still creates only its positive movement.
