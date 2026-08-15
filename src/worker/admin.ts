import { HttpError, json } from "./http";
import type { Role } from "./roles";
import { recentRows, tableStats } from "./sync";

// Role management. Every route here sits behind the admin Access application,
// so reaching this code already means Access matched the owner-only policy.

interface RoleRow {
  email: string;
  role: Role;
  createdAt: string;
  createdBy: string | null;
}

const VALID: Role[] = ["read", "write", "admin"];

export async function listRoles(db: D1Database): Promise<Response> {
  const { results } = await db
    .prepare("SELECT email, role, createdAt, createdBy FROM roles ORDER BY email")
    .all<RoleRow>();
  return json({ roles: results });
}

export async function putRole(
  db: D1Database,
  body: unknown,
  actor: string,
): Promise<Response> {
  const { email, role } = readRoleBody(body);
  await guardLastAdmin(db, email, role);

  await db
    .prepare(
      "INSERT INTO roles (email, role, createdAt, createdBy) VALUES (?, ?, ?, ?) " +
        // Only `role` changes on a re-grant: createdAt/createdBy record when the
        // person was first let in, which a promotion should not rewrite.
        "ON CONFLICT(email) DO UPDATE SET role = excluded.role",
    )
    .bind(email, role, new Date().toISOString(), actor)
    .run();

  return json({ email, role });
}

export async function deleteRole(db: D1Database, email: string | null): Promise<Response> {
  const normalized = normalizeEmail(email);
  await guardLastAdmin(db, normalized, null);
  await db.prepare("DELETE FROM roles WHERE email = ?").bind(normalized).run();
  return json({ email: normalized, role: "none" });
}

export async function stats(db: D1Database): Promise<Response> {
  return json({ tables: await tableStats(db), recent: await recentRows(db) });
}

function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string" || !raw.includes("@")) {
    throw new HttpError(400, "bad_email", "Alamat email tidak valid.");
  }
  // Lower-cased to match access.ts, which normalizes the token's email the same
  // way. A row stored as "Owner@" would never match a lookup for "owner@".
  return raw.trim().toLowerCase();
}

function readRoleBody(body: unknown): { email: string; role: Role } {
  if (body === null || typeof body !== "object") {
    throw new HttpError(400, "bad_body", "Body harus objek JSON.");
  }
  const { email, role } = body as { email?: unknown; role?: unknown };
  if (typeof role !== "string" || !VALID.includes(role as Role)) {
    throw new HttpError(400, "bad_role", `Peran harus salah satu dari: ${VALID.join(", ")}.`);
  }
  return { email: normalizeEmail(email), role: role as Role };
}

// Removing or demoting the last admin would leave nobody able to grant the role
// back — the roles table would be unmanageable from inside the app, and the
// only fix would be a wrangler d1 execute against production. Refuse instead.
// `next` is null for a delete.
async function guardLastAdmin(
  db: D1Database,
  email: string,
  next: Role | null,
): Promise<void> {
  if (next === "admin") return;

  const current = await db
    .prepare("SELECT role FROM roles WHERE email = ?")
    .bind(email)
    .first<{ role: Role }>();
  if (current?.role !== "admin") return;

  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM roles WHERE role = 'admin'")
    .first<{ n: number }>();
  if ((row?.n ?? 0) <= 1) {
    throw new HttpError(
      409,
      "last_admin",
      "Tidak bisa menghapus atau menurunkan admin terakhir. Tambahkan admin lain dulu.",
    );
  }
}
