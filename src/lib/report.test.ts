import { describe, it, expect } from "vitest";
import type { Buyer, OrderItem, Product, StockMovement } from "./types";
import {
  buildFifoIndex,
  joinOrderCosts,
  summarize,
  byProduct,
  byBuyer,
  receivables,
  stockLoss,
} from "./report";

const product: Product = {
  id: "p1",
  namaProduk: "Almond Kacang",
  tipe: "Bar",
  ukuran: null,
  satuan: "pcs",
  hargaDasar: 2000, // fallback cost per base unit
  hargaJual: 5000,
  konversi: [{ nama: "box", jumlah: 12, harga: 54000 }],
  stokMin: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const other: Product = { ...product, id: "p2", namaProduk: "Kurma Bar" };

function order(over: Partial<OrderItem> = {}): OrderItem {
  return {
    id: "o1",
    tanggal: "2026-07-15",
    productId: "p1",
    buyerId: "",
    namaProduk: "Almond Kacang",
    satuan: "pcs",
    kuantitas: 5,
    hargaSatuan: 5000,
    totalHarga: 25000,
    status: "pending",
    affectsStock: true,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    deletedAt: null,
    ...over,
  };
}

function movement(over: Partial<StockMovement> = {}): StockMovement {
  return {
    id: "m1",
    productId: "p1",
    tanggal: "2026-07-15",
    qty: -5,
    satuan: "pcs",
    reason: "sale",
    hargaModal: null,
    orderId: "o1",
    purchaseId: null,
    note: "",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    deletedAt: null,
    ...over,
  };
}

// A purchase lot: qty in, at a known cost per base unit.
function lot(
  id: string,
  tanggal: string,
  qty: number,
  hargaModal: number,
  over: Partial<StockMovement> = {},
): StockMovement {
  return movement({
    id,
    tanggal,
    qty,
    hargaModal,
    reason: "purchase",
    orderId: null,
    createdAt: `${tanggal}T00:00:00.000Z`,
    ...over,
  });
}

// The cost half of the pipeline as a page runs it: always off the FULL movement
// history. Takes no orders — that is the point. Costs are derived from stock
// alone and joined to orders afterwards, by id.
function run(stock: StockMovement[], products = [product]) {
  return joinOrderCosts(stock, buildFifoIndex(stock, products));
}

// An OrderCost as `joinOrderCosts` would produce it: complete, one movement,
// costed against `productId` unless overridden.
function cost(
  hpp: number,
  over: Partial<{ productId: string; complete: boolean; saleMovements: number }> = {},
) {
  return { hpp, productId: "p1", complete: true, saleMovements: 1, ...over };
}

describe("buildFifoIndex / joinOrderCosts", () => {
  it("charges a sale at the cost of the lot it consumed", () => {
    const stock = [
      lot("in1", "2026-07-01", 10, 1800),
      movement({ id: "out1", tanggal: "2026-07-15", qty: -5, orderId: "o1" }),
    ];
    expect(run(stock).get("o1")?.hpp).toBe(9000); // 5 × 1800
  });

  it("falls back to hargaDasar when a lot carries no hargaModal", () => {
    const stock = [
      lot("in1", "2026-07-01", 10, 0, { hargaModal: null }),
      movement({ id: "out1", qty: -5, orderId: "o1" }),
    ];
    expect(run(stock).get("o1")?.hpp).toBe(10000); // 5 × 2000
  });

  it("ignores movements with no orderId", () => {
    const stock = [
      lot("in1", "2026-07-01", 10, 1800),
      movement({ id: "out1", qty: -5, orderId: null, reason: "adjustment" }),
    ];
    expect(run(stock).size).toBe(0);
  });

  it("sums when several movements carry the same orderId", () => {
    const stock = [
      lot("in1", "2026-07-01", 10, 1800),
      movement({ id: "out1", qty: -3, orderId: "o1" }),
      movement({ id: "out2", qty: -2, orderId: "o1" }),
    ];
    expect(run(stock).get("o1")?.hpp).toBe(9000); // 5400 + 3600
  });

  it("keeps each product's lots separate", () => {
    const stock = [
      lot("in1", "2026-07-01", 10, 1000),
      lot("in2", "2026-07-01", 10, 5000, { productId: "p2" }),
      movement({ id: "out1", qty: -2, orderId: "o1" }),
      movement({ id: "out2", qty: -2, orderId: "o2", productId: "p2" }),
    ];
    const costs = run(stock, [product, other]);
    expect(costs.get("o1")?.hpp).toBe(2000);
    expect(costs.get("o2")?.hpp).toBe(10000);
  });
});

describe("the FIFO window invariant", () => {
  // The regression this whole module is shaped around: costs must be replayed
  // from the beginning of history, then filtered. Slicing movements to the
  // reporting period first would start FIFO with an empty lot stack, and this
  // sale would be charged at July's price — or at nothing at all.
  const stock = [
    lot("in-june", "2026-06-01", 10, 1000), // old, cheap lot
    lot("in-july", "2026-07-01", 10, 3000), // new, dearer lot
    movement({ id: "out", tanggal: "2026-07-15", qty: -10, orderId: "o1" }),
  ];

  it("charges a July sale at June's lot cost", () => {
    expect(run(stock).get("o1")?.hpp).toBe(10000); // 10 × 1000, not 3000
  });

  it("spills into the newer lot once the older one is exhausted", () => {
    const bigger = [
      ...stock.slice(0, 2),
      movement({ id: "out", tanggal: "2026-07-15", qty: -12, orderId: "o1" }),
    ];
    // 10 × 1000 (June, all of it) + 2 × 3000 (July)
    expect(run(bigger).get("o1")?.hpp).toBe(16000);
  });

  it("would break if movements were sliced to the period first", () => {
    // Documents the wrong way round, so the difference is visible in the suite.
    const julyOnly = stock.filter((m) => m.tanggal >= "2026-07-01");
    expect(run(julyOnly).get("o1")?.hpp).not.toBe(10000);
  });
});

// The whole point of `complete`: FIFO reports an uncovered sale at a LOWER cost,
// not at no cost, so nothing downstream can tell it from a genuinely cheap sale
// unless the shortfall is tracked separately.
describe("sales FIFO cannot fully cost", () => {
  it("marks a sale with no purchase history incomplete, not free", () => {
    const stock = [movement({ id: "out1", qty: -5, orderId: "o1" })];
    const entry = run(stock).get("o1");
    expect(entry?.hpp).toBe(0);
    expect(entry?.complete).toBe(false);
  });

  it("keeps such an order OUT of penjualan, so margin is not 100%", () => {
    const stock = [movement({ id: "out1", qty: -5, orderId: "o1" })];
    const s = summarize([order()], run(stock));
    expect(s.penjualan).toBe(0);
    expect(s.marginPct).toBe(null); // NOT 100, and not 0 either
    expect(s.tanpaStokCount).toBe(1);
    expect(s.tanpaStokNilai).toBe(25000);
  });

  it("marks a PARTIALLY covered sale incomplete too", () => {
    // 2 units of lot against a 5-unit sale: cost 2000 covers 40% of the goods.
    // Reported as-is it would look like a 92% margin.
    const stock = [
      lot("in1", "2026-07-01", 2, 1000),
      movement({ id: "out1", qty: -5, orderId: "o1" }),
    ];
    const entry = run(stock).get("o1");
    expect(entry?.hpp).toBe(2000);
    expect(entry?.complete).toBe(false);
    expect(summarize([order()], run(stock)).tanpaStokCount).toBe(1);
  });

  it("still counts an exactly-covered sale as complete", () => {
    const stock = [
      lot("in1", "2026-07-01", 5, 1000),
      movement({ id: "out1", qty: -5, orderId: "o1" }),
    ];
    expect(run(stock).get("o1")?.complete).toBe(true);
  });
});

// "Beli stok dari pesanan": addPurchase writes the purchase AND its paired sale
// in one call, so both carry the same tanggal and the same createdAt. IndexedDB
// hands them back keyed on a random uid, so the array order after a reload is
// arbitrary — FIFO must not depend on it.
describe("a purchase and its paired sale at the same instant", () => {
  const at = "2026-07-15T10:00:00.000Z";
  const buy = lot("in", "2026-07-15", 10, 2000, {
    purchaseId: "b1",
    createdAt: at,
  });
  const sell = movement({
    id: "out",
    tanggal: "2026-07-15",
    qty: -10,
    orderId: "o1",
    purchaseId: "b1",
    createdAt: at,
  });
  const boughtOrder = order({ affectsStock: false, kuantitas: 10 });

  it("costs the sale when the purchase happens to come first", () => {
    const entry = run([buy, sell]).get("o1");
    expect(entry?.hpp).toBe(20000);
    expect(entry?.complete).toBe(true);
  });

  it("costs it identically when the sale comes first", () => {
    // Goods cannot leave before they arrive: the tie breaks toward arrival.
    const entry = run([sell, buy]).get("o1");
    expect(entry?.hpp).toBe(20000);
    expect(entry?.complete).toBe(true);
  });

  it("keeps the order in the report either way round", () => {
    for (const stock of [[buy, sell], [sell, buy]]) {
      const s = summarize([boughtOrder], run(stock));
      expect(s.tanpaStokCount).toBe(0);
      expect(s.penjualan).toBe(25000);
      expect(s.hpp).toBe(20000);
    }
  });

  it("leaves no phantom inventory behind when the sale comes first", () => {
    // The other half of the bug: with the sale replayed first, the purchase was
    // left in `value` as stock that had already gone out — inflating the Stok
    // page's Nilai persediaan for goods that no longer exist.
    expect(buildFifoIndex([sell, buy], [product]).inventoryValue).toBe(0);
  });
});

describe("orders whose stock was deducted twice", () => {
  // addPurchase(item, note, order) writes a SECOND sale movement for an order
  // that may already have one from addOrder — "Beli stok dari pesanan" has no
  // affectsStock guard. The ledger really did deduct twice, so the cost really
  // is doubled; the report must say so rather than pick a number.
  const stock = [
    lot("in1", "2026-07-01", 20, 1000),
    movement({ id: "out1", qty: -5, orderId: "o1" }),
    movement({ id: "out2", qty: -5, orderId: "o1", purchaseId: "b1" }),
  ];

  it("counts the sale movements", () => {
    expect(run(stock).get("o1")?.saleMovements).toBe(2);
  });

  it("flags it in the summary instead of hiding the inflated HPP", () => {
    const s = summarize([order()], run(stock));
    expect(s.hpp).toBe(10000); // 5000 twice — faithful to the ledger
    expect(s.dobelCount).toBe(1);
  });

  it("reports dobelCount 0 for a normal single-movement order", () => {
    const clean = [
      lot("in1", "2026-07-01", 20, 1000),
      movement({ id: "out1", qty: -5, orderId: "o1" }),
    ];
    expect(summarize([order()], run(clean)).dobelCount).toBe(0);
  });
});

describe("summarize", () => {
  const costByOrder = new Map([["o1", cost(9000)]]);

  it("computes laba kotor and margin from priced orders", () => {
    const s = summarize([order()], costByOrder);
    expect(s.penjualan).toBe(25000);
    expect(s.hpp).toBe(9000);
    expect(s.labaKotor).toBe(16000);
    expect(s.marginPct).toBeCloseTo(64);
    expect(s.tanpaStokCount).toBe(0);
  });

  it("quarantines an affectsStock: false order instead of pricing it", () => {
    const rows = [order(), order({ id: "o2", affectsStock: false, totalHarga: 8000 })];
    const s = summarize(rows, costByOrder);
    expect(s.penjualan).toBe(25000); // o2's revenue is NOT counted
    expect(s.hpp).toBe(9000);
    expect(s.tanpaStokCount).toBe(1);
    expect(s.tanpaStokNilai).toBe(8000);
  });

  it("quarantines an unmatched legacy row (productId '')", () => {
    const rows = [order(), order({ id: "o2", productId: "", totalHarga: 3000 })];
    const s = summarize(rows, costByOrder);
    expect(s.tanpaStokCount).toBe(1);
    expect(s.tanpaStokNilai).toBe(3000);
    expect(s.labaKotor).toBe(16000); // unchanged by the quarantined row
  });

  it("goes negative when the lot cost exceeds the sale price", () => {
    // The supplier-price-rise case: sold at 5000/unit, bought at 6000/unit.
    const s = summarize([order()], new Map([["o1", cost(30000)]]));
    expect(s.labaKotor).toBe(-5000);
    expect(s.marginPct).toBeCloseTo(-20);
  });

  it("returns null, not NaN, when there is no revenue", () => {
    const s = summarize([], new Map());
    expect(s.marginPct).toBe(null);
  });

  // A bonus/sample line: priced at 0, but the goods still came out of a lot.
  // The old `penjualan === 0 ? 0` guard printed "0.0%" beside a total loss.
  it("returns null rather than 0% when revenue is 0 but cost is not", () => {
    const s = summarize(
      [order({ totalHarga: 0 })],
      new Map([["o1", cost(12000)]]),
    );
    expect(s.penjualan).toBe(0);
    expect(s.hpp).toBe(12000);
    expect(s.labaKotor).toBe(-12000);
    expect(s.marginPct).toBe(null);
  });

  it("leads with total revenue and reconciles down to the priced part", () => {
    const s = summarize(
      [order({ id: "o1" }), order({ id: "o2", totalHarga: 8000 })],
      new Map([["o1", cost(20000)]]),
    );
    expect(s.penjualanTotal).toBe(33000); // both orders
    expect(s.penjualan).toBe(25000); // the one with a cost basis
    expect(s.tanpaStokNilai).toBe(8000);
    expect(s.penjualan + s.tanpaStokNilai).toBe(s.penjualanTotal);
  });

  // The two banners contradicted each other when they described the same row.
  it("does not count a quarantined order as double-deducted", () => {
    const s = summarize(
      [order()],
      new Map([["o1", { ...cost(20000), complete: false, saleMovements: 2 }]]),
    );
    expect(s.tanpaStokCount).toBe(1);
    expect(s.dobelCount).toBe(0);
  });

  it("still counts a priced order that was deducted twice", () => {
    const s = summarize(
      [order()],
      new Map([["o1", { ...cost(20000), saleMovements: 2 }]]),
    );
    expect(s.tanpaStokCount).toBe(0);
    expect(s.dobelCount).toBe(1);
  });
});

describe("conversion units", () => {
  it("charges a box order for its base units, not for one unit", () => {
    const stock = [
      lot("in1", "2026-07-01", 24, 1500),
      // addOrder converts through baseUnitsFor: 2 box × 12 = 24 base units.
      movement({ id: "out1", qty: -24, orderId: "o1" }),
    ];
    const boxOrder = order({
      satuan: "box",
      kuantitas: 2,
      hargaSatuan: 54000,
      totalHarga: 108000,
    });
    const costs = run(stock);
    expect(costs.get("o1")?.hpp).toBe(36000); // 24 × 1500, not 1500

    const s = summarize([boxOrder], costs);
    expect(s.labaKotor).toBe(72000);
  });
});

describe("byProduct", () => {
  const products = [product, other];

  it("groups, sums and sorts by profit descending", () => {
    const rows = [
      order({ id: "o1", totalHarga: 25000 }),
      order({ id: "o2", totalHarga: 25000 }),
      order({
        id: "o3",
        productId: "p2",
        namaProduk: "Kurma Bar",
        totalHarga: 90000,
      }),
    ];
    const costs = new Map([
      ["o1", cost(9000)],
      ["o2", cost(9000)],
      ["o3", cost(20000, { productId: "p2" })],
    ]);
    const out = byProduct(rows, costs, products);
    expect(out.map((r) => r.key)).toEqual(["p2", "p1"]); // 70000 then 32000
    expect(out[1].penjualan).toBe(50000);
    expect(out[1].qty).toBe(10);
    expect(out[1].laba).toBe(32000);
  });

  it("surfaces a below-cost product as a negative row, sorted last", () => {
    const rows = [
      order({ id: "o1", totalHarga: 25000 }),
      order({ id: "o2", productId: "p2", namaProduk: "Kurma Bar", totalHarga: 10000 }),
    ];
    const costs = new Map([
      ["o1", cost(9000)],
      ["o2", cost(14000, { productId: "p2" })], // bought dearer than it sold
    ]);
    const out = byProduct(rows, costs, products);
    expect(out[out.length - 1].key).toBe("p2");
    expect(out[out.length - 1].laba).toBe(-4000);
  });

  it("excludes orders with no cost basis, so rows sum back to the totals", () => {
    const rows = [order(), order({ id: "o2", affectsStock: false, totalHarga: 8000 })];
    const costs = new Map([["o1", cost(9000)]]);
    const out = byProduct(rows, costs, products);
    const s = summarize(rows, costs);
    expect(out.reduce((t, r) => t + r.penjualan, 0)).toBe(s.penjualan);
    expect(out.reduce((t, r) => t + r.laba, 0)).toBe(s.labaKotor);
  });

  it("groups legacy rows on the MOVEMENT's productId, not the order's ''", () => {
    // addOrder resolves a product by NAME when productId is "" and stamps the
    // real id on the movement it writes. Grouping on the order's empty string
    // would merge two genuinely different products into one mislabelled row.
    const rows = [
      order({ id: "o1", productId: "", namaProduk: "Almond Kacang", totalHarga: 25000 }),
      order({ id: "o2", productId: "", namaProduk: "Kurma Bar", totalHarga: 40000 }),
    ];
    const costs = new Map([
      ["o1", cost(9000, { productId: "p1" })],
      ["o2", cost(15000, { productId: "p2" })],
    ]);
    const out = byProduct(rows, costs, products);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.label).sort()).toEqual(["Almond Kacang", "Kurma Bar"]);
  });

  it("sums qty in BASE units, so pcs and box are addable", () => {
    const rows = [
      order({ id: "o1", satuan: "pcs", kuantitas: 5 }),
      order({ id: "o2", satuan: "box", kuantitas: 2 }), // 2 × 12 = 24 base
    ];
    const costs = new Map([
      ["o1", cost(9000)],
      ["o2", cost(9000)],
    ]);
    expect(byProduct(rows, costs, products)[0].qty).toBe(29); // not 7
  });

  it("falls back to the order's namaProduk for a deleted product", () => {
    const rows = [order({ productId: "gone", namaProduk: "Produk Lama" })];
    const out = byProduct(rows, new Map([["o1", cost(1000, { productId: "gone" })]]), products);
    expect(out[0].label).toBe("Produk Lama");
  });
});

describe("byBuyer", () => {
  const buyers: Buyer[] = [
    {
      id: "b1",
      nama: "Bu Ani",
      telepon: "",
      email: "",
      alamat: "",
      catatan: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    },
  ];

  it("groups on buyerId and names the buyer", () => {
    const rows = [order({ buyerId: "b1" })];
    const out = byBuyer(rows, new Map([["o1", cost(9000)]]), buyers);
    expect(out[0].label).toBe("Bu Ani");
    expect(out[0].laba).toBe(16000);
  });

  it("collapses unassigned orders into one 'Tanpa pembeli' row", () => {
    const rows = [order({ id: "o1" }), order({ id: "o2" })];
    const costs = new Map([
      ["o1", cost(9000)],
      ["o2", cost(9000)],
    ]);
    const out = byBuyer(rows, costs, buyers);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("Tanpa pembeli");
    expect(out[0].penjualan).toBe(50000);
  });
});

describe("receivables", () => {
  const today = "2026-08-09";

  it("counts only pending orders", () => {
    const rows = [
      order({ id: "o1", status: "pending", tanggal: today }),
      order({ id: "o2", status: "paid", tanggal: today, totalHarga: 99000 }),
    ];
    const a = receivables(rows, today);
    expect(a.count).toBe(1);
    expect(a.total).toBe(25000);
  });

  it("puts an exactly-30-day-old order in 0-30", () => {
    const a = receivables([order({ tanggal: "2026-07-10" })], today);
    expect(a.d0_30).toBe(25000);
    expect(a.d31_60).toBe(0);
  });

  it("puts a 31-day-old order in 31-60", () => {
    const a = receivables([order({ tanggal: "2026-07-09" })], today);
    expect(a.d0_30).toBe(0);
    expect(a.d31_60).toBe(25000);
  });

  it("puts an exactly-60-day-old order in 31-60", () => {
    const a = receivables([order({ tanggal: "2026-06-10" })], today);
    expect(a.d31_60).toBe(25000);
    expect(a.d60plus).toBe(0);
  });

  it("puts a 61-day-old order in 60+", () => {
    const a = receivables([order({ tanggal: "2026-06-09" })], today);
    expect(a.d31_60).toBe(0);
    expect(a.d60plus).toBe(25000);
  });

  it("buckets a future-dated order with the newest", () => {
    const a = receivables([order({ tanggal: "2026-09-01" })], today);
    expect(a.d0_30).toBe(25000);
  });

  it("ignores the reporting period entirely — every pending order counts", () => {
    const rows = [
      order({ id: "o1", tanggal: "2026-01-05" }),
      order({ id: "o2", tanggal: "2026-08-01" }),
    ];
    const a = receivables(rows, today);
    expect(a.count).toBe(2);
    expect(a.total).toBe(50000);
  });

  // parseTanggalID returns its input unchanged when it cannot read it, so an
  // imported row can hold free text here. Aging it as 0 days hid it in the
  // bucket nobody chases.
  it("ages an unreadable date into the OLDEST bucket, and says so", () => {
    const a = receivables([order({ tanggal: "15 Juli" })], today);
    expect(a.d0_30).toBe(0);
    expect(a.d60plus).toBe(25000);
    expect(a.tanggalTidakValid).toBe(1);
    expect(a.total).toBe(25000);
  });
});

describe("deleted products", () => {
  // Products are soft deleted while their movements stay live, so a deleted
  // product simply drops out of the list the store hands in.
  const stock = [
    lot("in1", "2026-07-01", 10, 1800),
    movement({ id: "out1", tanggal: "2026-07-15", qty: -5, orderId: "o1" }),
  ];

  it("still costs the sales of a product that has since been deleted", () => {
    const entry = joinOrderCosts(stock, buildFifoIndex(stock, [])).get("o1");
    expect(entry?.hpp).toBe(9000);
    expect(entry?.complete).toBe(true);
  });

  it("does not erase historical revenue when a product is deleted", () => {
    const costs = joinOrderCosts(stock, buildFifoIndex(stock, []));
    const s = summarize([order()], costs);
    expect(s.penjualan).toBe(25000);
    expect(s.hpp).toBe(9000);
    expect(s.tanpaStokCount).toBe(0);
  });

  it("drops its leftovers from the inventory figure all the same", () => {
    // 5 of 10 units left. On the price list that is Rp 9.000 of persediaan;
    // once the product is gone the Stok page no longer shows it either.
    expect(buildFifoIndex(stock, [product]).inventoryValue).toBe(9000);
    expect(buildFifoIndex(stock, []).inventoryValue).toBe(0);
  });

  it("marks an order incomplete when a sale movement has no cost entry", () => {
    // The defensive path: an index built from a different ledger than the one
    // being joined. The order must be quarantined, never silently dropped.
    const empty = { cost: new Map(), uncovered: new Map(), inventoryValue: 0 };
    const entry = joinOrderCosts(stock, empty).get("o1");
    expect(entry?.complete).toBe(false);
    expect(entry?.hpp).toBe(0);
  });
});

describe("stockLoss", () => {
  const all = () => true;

  it("charges stock that left with no order behind it", () => {
    const stock = [
      lot("in1", "2026-07-01", 10, 1800),
      // A stock-take correction: 3 units gone, no sale, no order.
      movement({ id: "adj", qty: -3, reason: "adjustment", orderId: null }),
    ];
    const loss = stockLoss(stock, buildFifoIndex(stock, [product]), all);
    expect(loss.nilai).toBe(5400); // 3 × 1800, at the lot's cost
    expect(loss.count).toBe(1);
  });

  it("leaves sales alone — those are already HPP", () => {
    const stock = [
      lot("in1", "2026-07-01", 10, 1800),
      movement({ id: "out1", qty: -5, orderId: "o1" }),
    ];
    const loss = stockLoss(stock, buildFifoIndex(stock, [product]), all);
    expect(loss.count).toBe(0);
    expect(loss.nilai).toBe(0);
  });

  it("leaves stock coming IN alone", () => {
    const stock = [lot("in1", "2026-07-01", 10, 1800)];
    expect(stockLoss(stock, buildFifoIndex(stock, [product]), all).count).toBe(0);
  });

  it("honours the caller's period predicate", () => {
    const stock = [
      lot("in1", "2026-07-01", 20, 1000),
      movement({ id: "a", tanggal: "2026-07-10", qty: -2, orderId: null }),
      movement({ id: "b", tanggal: "2026-08-10", qty: -3, orderId: null }),
    ];
    const index = buildFifoIndex(stock, [product]);
    const july = (m: StockMovement) => m.tanggal < "2026-08-01";
    expect(stockLoss(stock, index, july)).toEqual({ nilai: 2000, count: 1 });
    expect(stockLoss(stock, index, all)).toEqual({ nilai: 5000, count: 2 });
  });

  // The whole point of the line: without it, losing stock improved the margin.
  it("is the gap between Laba Kotor and what is actually left", () => {
    const stock = [
      lot("in1", "2026-07-01", 10, 2000), // Rp 20.000 in
      movement({ id: "out1", qty: -5, orderId: "o1" }), // sold, HPP 10.000
      movement({ id: "lost", qty: -5, orderId: null }), // gone, charged nowhere
    ];
    const index = buildFifoIndex(stock, [product]);
    const s = summarize([order()], joinOrderCosts(stock, index));
    expect(s.labaKotor).toBe(15000); // 25.000 − 10.000
    const loss = stockLoss(stock, index, all);
    expect(loss.nilai).toBe(10000);
    expect(s.labaKotor - loss.nilai).toBe(5000); // what the till really sees
    expect(index.inventoryValue).toBe(0); // and nothing is left to sell
  });
});

// A ledger started mid-stream: goods sold before the purchase covering them was
// ever recorded. The first units in are settling that debt, not restocking.
describe("stock sold before it was bought", () => {
  it("leaves no inventory value behind once the deficit is settled", () => {
    const stock = [
      movement({ id: "out1", tanggal: "2026-07-01", qty: -10, orderId: "o1" }),
      lot("in1", "2026-07-20", 10, 2000),
    ];
    const index = buildFifoIndex(stock, [product]);
    // qty nets to 0, so value must too. It used to hold the full Rp 20.000.
    expect(index.inventoryValue).toBe(0);
  });

  it("does not retroactively price the sale that ran the deficit", () => {
    const stock = [
      movement({ id: "out1", tanggal: "2026-07-01", qty: -10, orderId: "o1" }),
      lot("in1", "2026-07-20", 10, 2000),
    ];
    const entry = joinOrderCosts(stock, buildFifoIndex(stock, [product])).get(
      "o1",
    );
    // The goods had no cost basis when they left, and a later purchase cannot
    // give them one — it would make HPP depend on what happens next.
    expect(entry?.complete).toBe(false);
    expect(entry?.hpp).toBe(0);
  });

  it("shelves only the surplus when the purchase overshoots the deficit", () => {
    const stock = [
      movement({ id: "out1", tanggal: "2026-07-01", qty: -4, orderId: "o1" }),
      lot("in1", "2026-07-20", 10, 2000),
    ];
    // 4 units settle the debt, 6 remain on hand at 2000.
    expect(buildFifoIndex(stock, [product]).inventoryValue).toBe(12000);
  });

  it("charges a later sale against the surplus, at the real lot cost", () => {
    const stock = [
      movement({ id: "out1", tanggal: "2026-07-01", qty: -4, orderId: "o1" }),
      lot("in1", "2026-07-20", 10, 2000),
      movement({ id: "out2", tanggal: "2026-07-25", qty: -6, orderId: "o2" }),
    ];
    const costs = joinOrderCosts(stock, buildFifoIndex(stock, [product]));
    expect(costs.get("o1")?.complete).toBe(false);
    expect(costs.get("o2")?.hpp).toBe(12000); // 6 × 2000
    expect(costs.get("o2")?.complete).toBe(true);
  });

  it("carries the deficit across several purchases", () => {
    const stock = [
      movement({ id: "out1", tanggal: "2026-07-01", qty: -10, orderId: "o1" }),
      lot("in1", "2026-07-10", 4, 2000),
      lot("in2", "2026-07-20", 4, 3000),
      lot("in3", "2026-07-25", 4, 1000),
    ];
    // 4 + 4 settle the first 8; in3 covers the last 2 and shelves 2 at 1000.
    const index = buildFifoIndex(stock, [product]);
    expect(index.inventoryValue).toBe(2000);
  });
});
