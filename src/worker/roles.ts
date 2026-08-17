// Role lookup against D1.
//
// Every check is a live query. The role is deliberately NOT carried in the
// Access token or cached in the isolate: a demotion has to take effect on the
// next request, not whenever a token happens to expire. Writes are rare enough
// that the extra read costs nothing.

export type Role = "write" | "admin";
export type RoleOrNone = Role | "none";

// What one account is allowed to do, in the two dimensions that are actually
// independent of each other.
export interface Grant {
  role: RoleOrNone;
  // May this account's changes leave the device? False makes the app
  // local-only: everything still works, nothing is published. Orthogonal to
  // `role` — see migrations/0003_push_flag.sql for why it is not a rung.
  canPush: boolean;
}

// One query, both answers. Splitting this into `roleOf` + `canPushOf` would put
// two reads on the push path and open a window where the two disagree.
export async function grantOf(db: D1Database, email: string): Promise<Grant> {
  const row = await db
    .prepare("SELECT role, canPush FROM roles WHERE email = ?")
    .bind(email)
    .first<{ role: Role; canPush: number }>();
  // A missing row means blocked, not "reader": there is no longer a role that
  // may look without saving, so this is a person who cannot use the app at all.
  // `canPush` false alongside it is belt-and-braces — nothing that fails the
  // role check ever reaches the push gate anyway.
  if (!row) return { role: "none", canPush: false };
  // The column is NOT NULL with CHECK (canPush IN (0, 1)), so this comparison
  // cannot be tripped by a third value.
  return { role: row.role, canPush: row.canPush === 1 };
}

// admin implies write, so permissions are still a ladder rather than a set of
// independent flags — it is just a two-rung one now. `canPush` is the exception
// that proves it, which is why it is not on this scale.
const RANK: Record<RoleOrNone, number> = { none: 0, write: 1, admin: 2 };

export function atLeast(role: RoleOrNone, required: Role): boolean {
  return RANK[role] >= RANK[required];
}

// "Did the access I granted ever get used?" — stamped from /api/sync/me, which
// has exactly one call site, on boot. That makes this one write per session
// rather than one per sync; do not call it from a polled endpoint.
// An UPDATE (not an upsert) on purpose: someone without a row is blocked, and
// blocked accounts have no business creating rows in the roles table.
export async function touchLastSeen(db: D1Database, email: string): Promise<void> {
  await db
    .prepare("UPDATE roles SET lastSeenAt = ? WHERE email = ?")
    .bind(new Date().toISOString(), email)
    .run();
}
