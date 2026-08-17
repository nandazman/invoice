-- `roles` gains `canPush`: may what this account writes leave the device?
--
-- Deliberately a column beside `role`, not a third rung on the ladder. The
-- ladder answers "how much of the app do you get"; this answers "does what you
-- write reach anybody else". The two are independent — an admin can be
-- local-only and a plain user can publish — so folding it in would need four
-- rungs to say what one boolean says, and `atLeast()` would stop meaning
-- anything.
--
-- DEFAULT 1 because that is what every existing account already does. This
-- migration must be invisible to the people on the table when it runs;
-- local-only is something an admin turns ON, never a state anyone lands in by
-- being migrated.
--
-- ADD COLUMN rather than the rebuild 0002 needed: there is no CHECK being
-- narrowed here, and SQLite accepts a NOT NULL column as long as the default
-- is not itself null.

ALTER TABLE roles
  ADD COLUMN canPush INTEGER NOT NULL DEFAULT 1 CHECK (canPush IN (0, 1));
