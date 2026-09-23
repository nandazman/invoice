import { describe, it, expect } from "vitest";
import { checkIntegrity } from "./integrity";
import type { OrderItem, PurchaseItem, StockMovement } from "./types";

function movement(over: Partial<StockMovement>): StockMovement {
  return {
    id: "m1",
    productId: "p1",
    tanggal: "2026-09-07",
    qty: -3,
    satuan: "pcs",
    reason: "sale",
    hargaModal: null,
    orderId: null,
    purchaseId: null,
    note: "",
    createdAt: "2026-09-07T01:45:00.000Z",
    updatedAt: "2026-09-07T01:45:00.000Z",
    deletedAt: null,
    ...over,
  };
}

const order = { id: "o1" } as OrderItem;
const purchase = { id: "pu1" } as PurchaseItem;

describe("checkIntegrity", () => {
  it("is silent when every link resolves", () => {
    const stock = [
      movement({ id: "m1", orderId: "o1" }),
      movement({ id: "m2", purchaseId: "pu1", reason: "purchase" }),
    ];
    expect(checkIntegrity(stock, [order], [purchase]).total).toBe(0);
  });

  it("is silent on movements that link to nothing at all", () => {
    // A manual adjustment has neither id. Absence is not a dangling pointer.
    const stock = [movement({ reason: "adjustment" })];
    expect(checkIntegrity(stock, [], []).total).toBe(0);
  });

  // The 2026-09-07 shape, exactly: the sale movements survived and their
  // orders did not. This is the check that would have caught it in a day.
  it("reports a movement whose order is gone, with the date", () => {
    const stock = [
      movement({ id: "m1", orderId: "gone1" }),
      movement({ id: "m2", orderId: "gone2" }),
      movement({ id: "m3", orderId: "o1" }),
    ];
    const report = checkIntegrity(stock, [order], []);

    expect(report.total).toBe(2);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].kind).toBe("order");
    expect(report.findings[0].missingIds).toEqual(["gone1", "gone2"]);
    expect(report.findings[0].dates).toEqual(["2026-09-07"]);
  });

  it("reports a movement whose purchase is gone", () => {
    const stock = [movement({ purchaseId: "gone", reason: "purchase" })];
    const report = checkIntegrity(stock, [], []);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].kind).toBe("purchase");
  });

  it("counts distinct parents, not movements", () => {
    // One order deleted, two movements left behind — one loss, not two.
    const stock = [
      movement({ id: "m1", orderId: "gone" }),
      movement({ id: "m2", orderId: "gone" }),
    ];
    const report = checkIntegrity(stock, [], []);

    expect(report.total).toBe(2);
    expect(report.findings[0].missingIds).toEqual(["gone"]);
  });

  it("sorts the dates so the earliest broken session leads", () => {
    const stock = [
      movement({ id: "m1", orderId: "a", tanggal: "2026-09-09" }),
      movement({ id: "m2", orderId: "b", tanggal: "2026-09-05" }),
    ];
    expect(checkIntegrity(stock, [], []).findings[0].dates).toEqual([
      "2026-09-05",
      "2026-09-09",
    ]);
  });

  it("treats a tombstoned parent as missing", () => {
    // store.ts holds LIVE rows only, so a soft-deleted order is absent from the
    // array. That is correct here: deleting an order tombstones its movements
    // in the same transaction, so a LIVE movement pointing at one is broken.
    const stock = [movement({ orderId: "o1" })];
    expect(checkIntegrity(stock, [], []).total).toBe(1);
  });
});
