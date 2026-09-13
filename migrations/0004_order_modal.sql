-- `orders` gains `modalSatuan`: the modal per chosen unit, snapshot when the
-- order was added (Harga Dasar × base units). See OrderItem in src/lib/types.ts.
--
-- Nullable with no default, because null is the honest value for every row that
-- already exists: nobody recorded what those sales cost at the time, and
-- stamping today's Harga Dasar onto them here would pass a guess off as a
-- snapshot. The report falls back to the product's current Harga Dasar for them.
--
-- Must be applied BEFORE the client that pushes this column is deployed: the
-- Worker builds its upsert from tables.ts, so a push naming a column D1 does not
-- have fails the whole orders batch.

ALTER TABLE orders ADD COLUMN modalSatuan REAL;
