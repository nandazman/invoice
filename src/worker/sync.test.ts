import { describe, it, expect } from "vitest";
import { handlePull, handlePush } from "./sync";
import { CREATED_BY, UPDATED_BY, type Row } from "../lib/sync/tables";

// The two halves of the attribution contract, pinned from the Worker side:
//
//   PULL  carries createdBy/updatedBy out, on top of the spec columns.
//   PUSH  ignores them completely — whatever the body says, the stamp comes
//         from the verified Access email and nothing else.
//
// A hand-rolled D1 stub rather than miniflare: these tests are about which
// columns cross the boundary, so recording the SQL and the bound values is
// exactly the observation needed, and running real SQLite would only hide it.

interface Recorded {
  sql: string;
  values: unknown[];
}

function fakeDb(rowsByTable: Record<string, Row[]>): {
  db: D1Database;
  recorded: Recorded[];
} {
  const recorded: Recorded[] = [];

  const prepare = (sql: string): D1PreparedStatement => {
    const rec: Recorded = { sql, values: [] };
    recorded.push(rec);
    const stmt = {
      bind: (...values: unknown[]) => {
        rec.values = values;
        return stmt;
      },
      all: async () => {
        // `SELECT * FROM <name>` / `... WHERE <cursor> > ?`
        const name = /FROM (\w+)/.exec(sql)?.[1] ?? "";
        return { results: rowsByTable[name] ?? [] };
      },
      first: async () => null,
    };
    return stmt as unknown as D1PreparedStatement;
  };

  const db = {
    prepare,
    batch: async () => [],
  } as unknown as D1Database;

  return { db, recorded };
}

const storedProduct = (over: Record<string, unknown> = {}): Row => ({
  id: "p1",
  namaProduk: "Kopi",
  tipe: "Bar",
  ukuran: null,
  satuan: "pcs",
  hargaDasar: 1000,
  hargaJual: 2000,
  konversi: "[]", // JSON TEXT in D1
  stokMin: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  deletedAt: null,
  [CREATED_BY]: "andi@example.com",
  [UPDATED_BY]: "budi@example.com",
  ...over,
});

async function pull(rows: Record<string, Row[]>): Promise<Record<string, Row[]>> {
  const { db } = fakeDb(rows);
  const res = await handlePull(db, new URL("https://x/api/sync/pull"));
  const body = (await res.json()) as { tables: Record<string, Row[]> };
  return body.tables;
}

describe("pull carries attribution", () => {
  it("returns createdBy/updatedBy alongside the spec columns", async () => {
    const tables = await pull({ products: [storedProduct()] });
    const row = tables.products[0];

    expect(row.createdBy).toBe("andi@example.com");
    expect(row.updatedBy).toBe("budi@example.com");
    // And the ordinary deserialization still happened: konversi came back as a
    // real array, not the JSON text D1 holds.
    expect(row.konversi).toEqual([]);
    expect(row.updatedAt).toBe("2026-08-02T00:00:00.000Z");
  });

  it("omits the keys entirely for a row D1 never stamped", async () => {
    // Absence has to stay absence: writing `undefined` into IndexedDB stores it
    // verbatim, and the UI's "never synced" case is exactly `!row.createdBy`.
    const bare = storedProduct();
    delete bare[CREATED_BY];
    delete bare[UPDATED_BY];

    const row = (await pull({ products: [bare] })).products[0];
    expect(CREATED_BY in row).toBe(false);
    expect(UPDATED_BY in row).toBe(false);
  });

  it("leaks nothing else: the row is still spec columns plus the two", async () => {
    const row = (await pull({
      products: [storedProduct({ someFutureColumn: "x" })],
    })).products[0];
    expect("someFutureColumn" in row).toBe(false);
  });
});

describe("push ignores attribution in the body", () => {
  it("stamps the verified email and never the client's value", async () => {
    const { db, recorded } = fakeDb({});
    await handlePush(
      db,
      {
        tables: {
          products: [
            {
              ...storedProduct({ konversi: [] }),
              // A client trying to forge attribution — including impersonating
              // someone else. Both must be dropped before the bind list.
              [CREATED_BY]: "attacker@example.com",
              [UPDATED_BY]: "attacker@example.com",
            },
          ],
        },
      },
      "verified@example.com",
    );

    const upsert = recorded.find((r) => r.sql.startsWith("INSERT INTO products"));
    expect(upsert).toBeDefined();
    // The forged values are nowhere in the statement's bound parameters...
    expect(upsert!.values).not.toContain("attacker@example.com");
    // ...and the last two bindings are the verified address, twice: the
    // createdBy/updatedBy pair the Worker appends after spec.columns.
    expect(upsert!.values.slice(-2)).toEqual([
      "verified@example.com",
      "verified@example.com",
    ]);
    // COALESCE keeps the original creator on an update.
    expect(upsert!.sql).toContain(
      "createdBy = COALESCE(products.createdBy, excluded.createdBy)",
    );
  });

  it("does not add attribution to the excluded-column update list", async () => {
    // Attribution is not in spec.columns, so the generated `SET` clause must
    // mention it exactly twice — the two lines buildUpsert appends by hand —
    // and never as an ordinary `col = excluded.col`.
    const { db, recorded } = fakeDb({});
    await handlePush(
      db,
      { tables: { products: [storedProduct({ konversi: [] })] } },
      "verified@example.com",
    );
    const sql = recorded.find((r) => r.sql.startsWith("INSERT INTO products"))!.sql;
    expect(sql.match(/updatedBy = excluded\.updatedBy/g)).toHaveLength(1);
    expect(sql.match(/createdBy/g)).toHaveLength(4); // insert list, COALESCE x3
  });
});
