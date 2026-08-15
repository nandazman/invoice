// Role lookup against D1.
//
// Every check is a live query. The role is deliberately NOT carried in the
// Access token or cached in the isolate: a demotion has to take effect on the
// next request, not whenever a token happens to expire. Writes are rare enough
// that the extra read costs nothing.

export type Role = "write" | "admin";
export type RoleOrNone = Role | "none";

export async function roleOf(db: D1Database, email: string): Promise<RoleOrNone> {
  const row = await db
    .prepare("SELECT role FROM roles WHERE email = ?")
    .bind(email)
    .first<{ role: Role }>();
  // "none" means blocked, not "reader": there is no longer a role that may look
  // without saving, so a missing row is a person who cannot use the app at all.
  return row?.role ?? "none";
}

// admin implies write, so permissions are still a ladder rather than a set of
// independent flags — it is just a two-rung one now.
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
