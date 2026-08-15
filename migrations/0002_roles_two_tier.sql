-- The role ladder loses its `read` rung, and `roles` gains `lastSeenAt`.
--
-- Two roles remain: being on this table means full use of the app, and `admin`
-- adds the admin page on top. Someone who is not on the table is blocked
-- outright — `roleOf` still answers 'none' for a missing row, but that now
-- means "cannot use the app" rather than "may look but not save".
--
-- D1 cannot ALTER a CHECK constraint, so narrowing the allowed set is a table
-- rebuild: create, copy, drop, rename. `lastSeenAt` rides along in the same
-- rebuild rather than in a second migration — it is the same table, once.
--
-- See docs/2026-08-15/permissions-plan.md §A. Take the pre-migration export
-- (`wrangler d1 export`) before running this against production: a roles table
-- left without an admin row is unmanageable from inside the app.

CREATE TABLE roles_new (
  email      TEXT PRIMARY KEY,
  role       TEXT NOT NULL CHECK (role IN ('write', 'admin')),
  createdAt  TEXT NOT NULL,
  createdBy  TEXT,
  -- Last successful /api/sync/me, stamped by the Worker on boot. NULL means
  -- the grant has never been used. One write per session, not per sync.
  lastSeenAt TEXT
);

-- 'read' rows are DROPPED, not migrated: that role no longer exists, and
-- keeping the row would silently promote a reader to a writer. Anyone who held
-- it is blocked until explicitly granted 'write' again.
INSERT INTO roles_new (email, role, createdAt, createdBy, lastSeenAt)
  SELECT email, role, createdAt, createdBy, NULL
  FROM roles
  WHERE role IN ('write', 'admin');

DROP TABLE roles;
ALTER TABLE roles_new RENAME TO roles;
