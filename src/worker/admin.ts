import { HttpError, json } from "./http";
import type { Role } from "./roles";
import { databaseSize, recentRows, tableStats, writeVolume } from "./sync";

// Role management. Every route here sits behind the admin Access application,
// so reaching this code already means Access matched the owner-only policy.

interface StoredRoleRow {
  email: string;
  role: Role;
  createdAt: string;
  createdBy: string | null;
  lastSeenAt: string | null;
  // SQLite has no boolean. Converted at the edge (see `listRoles`) rather than
  // in the page, so the wire shape is JSON's own true/false.
  canPush: number;
}

const VALID: Role[] = ["write", "admin"];

export async function listRoles(db: D1Database): Promise<Response> {
  const { results } = await db
    .prepare(
      "SELECT email, role, createdAt, createdBy, lastSeenAt, canPush FROM roles ORDER BY email",
    )
    .all<StoredRoleRow>();
  return json({
    roles: results.map((r) => ({ ...r, canPush: r.canPush === 1 })),
  });
}

export async function putRole(
  db: D1Database,
  body: unknown,
  actor: string,
): Promise<Response> {
  const { email, role, canPush } = readRoleBody(body);
  await guardLastAdmin(db, email, role);

  // `canPush` is null when the body left it out, and COALESCE turns that into
  // "leave it alone" on an update and into the column default on an insert.
  // The alternative — defaulting to 1 in the handler — would mean every role
  // change silently re-published somebody who had been set to local-only.
  const flag = canPush === null ? null : canPush ? 1 : 0;

  await db
    .prepare(
      "INSERT INTO roles (email, role, createdAt, createdBy, canPush) " +
        "VALUES (?, ?, ?, ?, COALESCE(?, 1)) " +
        // Only `role` and `canPush` change on a re-grant: createdAt/createdBy
        // record when the person was first let in, which a promotion should not
        // rewrite.
        "ON CONFLICT(email) DO UPDATE SET role = excluded.role, " +
        "canPush = COALESCE(?, roles.canPush)",
    )
    .bind(email, role, new Date().toISOString(), actor, flag, flag)
    .run();

  return json({ email, role, canPush });
}

export async function deleteRole(db: D1Database, email: string | null): Promise<Response> {
  const normalized = normalizeEmail(email);
  await guardLastAdmin(db, normalized, null);
  await db.prepare("DELETE FROM roles WHERE email = ?").bind(normalized).run();
  return json({ email: normalized, role: "none" });
}

// The D1 dashboard. Everything here is derived from D1 itself — size comes off
// the query metadata, activity off the same `updatedAt` the sync cursor uses —
// so no Cloudflare API token and no new Worker secret are involved.
export async function stats(db: D1Database): Promise<Response> {
  return json({
    tables: await tableStats(db),
    recent: await recentRows(db),
    size: await databaseSize(db),
    volume: await writeVolume(db),
    people: await peopleSeen(db),
  });
}

// Who has been let in, and whether the grant was ever used. NULL lastSeenAt =
// never booted the app since the grant (or since migration 0002, which starts
// everyone at NULL).
async function peopleSeen(db: D1Database): Promise<
  { email: string; role: Role; lastSeenAt: string | null }[]
> {
  const { results } = await db
    .prepare("SELECT email, role, lastSeenAt FROM roles ORDER BY email")
    .all<{ email: string; role: Role; lastSeenAt: string | null }>();
  return results;
}

function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string" || !raw.includes("@")) {
    throw new HttpError(400, "bad_email", "Alamat email tidak valid.");
  }
  // Lower-cased to match access.ts, which normalizes the token's email the same
  // way. A row stored as "Owner@" would never match a lookup for "owner@".
  return raw.trim().toLowerCase();
}

// `canPush` comes back as null for "not mentioned", which is a third state and
// not the same as false — see the COALESCE in putRole.
function readRoleBody(body: unknown): {
  email: string;
  role: Role;
  canPush: boolean | null;
} {
  if (body === null || typeof body !== "object") {
    throw new HttpError(400, "bad_body", "Body harus objek JSON.");
  }
  const { email, role, canPush } = body as {
    email?: unknown;
    role?: unknown;
    canPush?: unknown;
  };
  if (typeof role !== "string" || !VALID.includes(role as Role)) {
    throw new HttpError(400, "bad_role", `Peran harus salah satu dari: ${VALID.join(", ")}.`);
  }
  // Strict: a stray "false" string or a 0 is rejected rather than coerced.
  // Guessing wrong here either publishes somebody who should not be, or
  // silently stops somebody's data reaching the cloud.
  if (canPush !== undefined && typeof canPush !== "boolean") {
    throw new HttpError(400, "bad_can_push", "Field `canPush` harus true atau false.");
  }
  return {
    email: normalizeEmail(email),
    role: role as Role,
    canPush: canPush === undefined ? null : canPush,
  };
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
