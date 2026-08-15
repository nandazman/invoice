// Role lookup against D1.
//
// Every check is a live query. The role is deliberately NOT carried in the
// Access token or cached in the isolate: a demotion has to take effect on the
// next request, not whenever a token happens to expire. Writes are rare enough
// that the extra read costs nothing.

export type Role = "read" | "write" | "admin";
export type RoleOrNone = Role | "none";

export async function roleOf(db: D1Database, email: string): Promise<RoleOrNone> {
  const row = await db
    .prepare("SELECT role FROM roles WHERE email = ?")
    .bind(email)
    .first<{ role: Role }>();
  return row?.role ?? "none";
}

// admin implies write implies read, so permissions are a ladder rather than a
// set of independent flags.
const RANK: Record<RoleOrNone, number> = { none: 0, read: 1, write: 2, admin: 3 };

export function atLeast(role: RoleOrNone, required: Role): boolean {
  return RANK[role] >= RANK[required];
}
