import { describe, it, expect, beforeEach } from "vitest";
import {
  collectUnsynced,
  rescueUnsynced,
  describeCounts,
  stalenessDays,
  type RescueFile,
} from "./rescue";
import { db, WATERMARKS_KEY } from "./db";
import { capturedDownloads } from "../test-setup";

async function reset(): Promise<void> {
  await db.open();
  await Promise.all([db.orders.clear(), db.purchases.clear(), db.meta.clear()]);
  capturedDownloads.length = 0;
}

function order(id: string, updatedAt: string) {
  return {
    id,
    tanggal: "2026-09-07",
    productId: "p1",
    buyerId: "b1",
    namaProduk: "Yakult",
    satuan: "pcs",
    kuantitas: 50,
    hargaSatuan: 2700,
    totalHarga: 135000,
    status: "pending" as const,
    affectsStock: true,
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null,
  };
}

async function watermark(marks: Record<string, string | null>) {
  await db.meta.put({ key: WATERMARKS_KEY, value: marks });
}

describe("collectUnsynced", () => {
  beforeEach(reset);

  it("treats every row as pending when the table has never synced", async () => {
    // A null watermark means the cloud has never confirmed anything. For a
    // local-only account that is permanent, and the honest rescue is the whole
    // dataset — there is no cloud copy to fall back on.
    await db.orders.bulkPut([order("a", "2026-09-07T01:45:00.000Z")]);

    const found = await collectUnsynced();
    expect(found.total).toBe(1);
    expect(found.counts.orders).toBe(1);
  });

  it("excludes rows the cloud has already confirmed", async () => {
    await db.orders.bulkPut([
      order("synced", "2026-09-01T00:00:00.000Z"),
      order("pending", "2026-09-07T01:45:00.000Z"),
    ]);
    await watermark({ orders: "2026-09-03T00:00:00.000Z" });

    const found = await collectUnsynced();
    expect(found.total).toBe(1);
    expect((found.tables.orders[0] as { id: string }).id).toBe("pending");
  });

  it("reads the watermark fresh rather than trusting a cached copy", async () => {
    await db.orders.bulkPut([order("a", "2026-09-07T01:45:00.000Z")]);
    await watermark({ orders: "2026-09-08T00:00:00.000Z" });
    expect((await collectUnsynced()).total).toBe(0);

    // The leader tab pushes nothing new but rolls the watermark back, as a
    // discard does. The next call must see that.
    await watermark({ orders: null });
    expect((await collectUnsynced()).total).toBe(1);
  });

  it("reports the oldest pending cursor across tables", async () => {
    await db.orders.bulkPut([
      order("new", "2026-09-10T00:00:00.000Z"),
      order("old", "2026-09-07T01:45:00.000Z"),
    ]);
    expect((await collectUnsynced()).oldest).toBe("2026-09-07T01:45:00.000Z");
  });

  it("is empty, not absent, when everything has synced", async () => {
    await db.orders.bulkPut([order("a", "2026-09-01T00:00:00.000Z")]);
    await watermark({ orders: "2026-09-02T00:00:00.000Z" });

    const found = await collectUnsynced();
    expect(found.total).toBe(0);
    expect(found.counts).toEqual({});
  });
});

describe("rescueUnsynced", () => {
  beforeEach(reset);

  // The regression this whole module exists for. Six orders were entered on
  // 2026-09-07, never reached D1, and were then cleared by a whole-table
  // replace — leaving nothing but six dangling foreign keys. Whatever clears
  // the table now has to produce this file first.
  it("writes the rows a destructive action is about to destroy", async () => {
    await db.orders.bulkPut([
      order("xhxc1l5cmtqkw8qt", "2026-09-07T01:45:15.000Z"),
      order("1hhhaj2wmtqkx0fn", "2026-09-07T01:45:50.000Z"),
    ]);

    const found = await rescueUnsynced("buang-perubahan-lokal");

    expect(found.total).toBe(2);
    expect(capturedDownloads).toHaveLength(1);
    expect(capturedDownloads[0].filename).toMatch(
      /^invoice-unsynced-buang-perubahan-lokal-.*\.json$/,
    );

    const file = JSON.parse(capturedDownloads[0].text) as RescueFile;
    expect(file.reason).toBe("buang-perubahan-lokal");
    // Ids intact: that is what makes the file usable for recovery SQL.
    expect(file.tables.orders.map((r) => (r as { id: string }).id)).toEqual([
      "1hhhaj2wmtqkx0fn",
      "xhxc1l5cmtqkw8qt",
    ]);
    // And the values, not just the keys — a file of ids recovers nothing.
    expect((file.tables.orders[0] as { totalHarga: number }).totalHarga).toBe(135000);
  });

  it("writes no file when nothing is at risk", async () => {
    await db.orders.bulkPut([order("a", "2026-09-01T00:00:00.000Z")]);
    await watermark({ orders: "2026-09-02T00:00:00.000Z" });

    expect((await rescueUnsynced("pulihkan-cadangan")).total).toBe(0);
    expect(capturedDownloads).toHaveLength(0);
  });
});

describe("describeCounts", () => {
  it("names the tables in Indonesian so a dialog can print it", () => {
    expect(describeCounts({ orders: 6, purchases: 6, stock: 12 })).toBe(
      "6 Pesanan, 6 Beli Stok, 12 Stok",
    );
  });

  it("drops empty tables rather than printing zeroes", () => {
    expect(describeCounts({ orders: 2, stock: 0 })).toBe("2 Pesanan");
  });

  it("is empty when nothing is pending", () => {
    expect(describeCounts({})).toBe("");
  });
});

describe("stalenessDays", () => {
  const now = Date.parse("2026-09-13T12:00:00.000Z");

  it("counts the days the September batch went unnoticed", () => {
    expect(stalenessDays("2026-09-07T01:45:15.000Z", now)).toBe(6);
  });

  it("is null when nothing is pending", () => {
    expect(stalenessDays(null, now)).toBeNull();
  });

  it("is null rather than NaN on an unreadable cursor", () => {
    expect(stalenessDays("not a date", now)).toBeNull();
  });
});
