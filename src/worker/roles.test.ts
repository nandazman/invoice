import { describe, it, expect } from "vitest";
import { grantOf, atLeast } from "./roles";
import { putRole } from "./admin";
import { HttpError } from "./http";

// The local-only flag, from the server side. Three things are worth pinning,
// and all three are ways the flag could quietly stop meaning anything:
//
//   1. it is read on the SAME query as the role, so the two can never disagree;
//   2. it is NOT on the role ladder — `atLeast` must not see it;
//   3. a PUT that does not mention it LEAVES IT ALONE. Without that, every
//      promotion would silently re-publish somebody set to local-only.
//
// Same hand-rolled D1 stub as sync.test.ts, for the same reason: what is being
// observed is the SQL and the bound values, and real SQLite would hide them.

interface Recorded {
  sql: string;
  values: unknown[];
}

function fakeDb(roleRow: Record<string, unknown> | null): {
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
      // Only the grant lookup gets a row. guardLastAdmin's own SELECTs land on
      // null, which is its "not currently an admin, nothing to guard" path.
      first: async () => (sql.startsWith("SELECT role, canPush") ? roleRow : null),
      run: async () => ({}),
      all: async () => ({ results: [] }),
    };
    return stmt as unknown as D1PreparedStatement;
  };

  return { db: { prepare } as unknown as D1Database, recorded };
}

describe("grantOf", () => {
  it("reads the role and the flag in one query", async () => {
    const { db, recorded } = fakeDb({ role: "write", canPush: 1 });

    expect(await grantOf(db, "a@b.c")).toEqual({ role: "write", canPush: true });
    // One statement, not two: a second read would open a window where a
    // concurrent change makes the role and the flag describe different states.
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.values).toEqual(["a@b.c"]);
  });

  it("reads 0 as local-only", async () => {
    const { db } = fakeDb({ role: "admin", canPush: 0 });
    expect(await grantOf(db, "a@b.c")).toEqual({ role: "admin", canPush: false });
  });

  it("answers none for an email that is not on the table", async () => {
    const { db } = fakeDb(null);
    expect(await grantOf(db, "stranger@b.c")).toEqual({
      role: "none",
      canPush: false,
    });
  });

  it("keeps the flag off the role ladder", async () => {
    // The ladder is about how much of the app you get. Whether what you write
    // is published is a different question, and `atLeast` must stay unable to
    // answer it — an admin who does not publish is still an admin.
    expect(atLeast("admin", "write")).toBe(true);
    expect(atLeast("none", "write")).toBe(false);
  });
});

describe("putRole and the flag", () => {
  it("leaves the flag alone when the body does not mention it", async () => {
    const { db, recorded } = fakeDb(null);
    await putRole(db, { email: "a@b.c", role: "admin" }, "owner@b.c");

    const insert = recorded.find((r) => r.sql.startsWith("INSERT INTO roles"));
    // Both COALESCE binds are null: the column default on an insert, the
    // existing value on an update. Sending 1 here instead would turn every
    // promotion into an unannounced "start publishing".
    expect(insert?.values.slice(4)).toEqual([null, null]);
    expect(insert?.sql).toContain("canPush = COALESCE(?, roles.canPush)");
  });

  it("stores false as 0", async () => {
    const { db, recorded } = fakeDb(null);
    await putRole(db, { email: "a@b.c", role: "write", canPush: false }, "owner@b.c");

    const insert = recorded.find((r) => r.sql.startsWith("INSERT INTO roles"));
    expect(insert?.values.slice(4)).toEqual([0, 0]);
  });

  it("rejects a canPush that is not a boolean", async () => {
    const { db } = fakeDb(null);
    // Coercing "false" or 0 would guess, and both wrong guesses are bad: one
    // publishes somebody who should not be, the other silently stops somebody's
    // data reaching the cloud.
    await expect(
      putRole(db, { email: "a@b.c", role: "write", canPush: "false" }, "owner@b.c"),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
