-- D1 mirror of the IndexedDB schema. One table per entry in
-- src/lib/sync/tables.ts, with exactly that entry's `columns` plus the two
-- attribution columns the client never sees. Read tables.ts before changing
-- anything here: it is the shared definition, this file is the SQLite half.
--
-- Column types follow src/lib/types.ts and src/lib/template-types.ts, with the
-- three deliberate differences tables.ts documents: JSON columns are TEXT,
-- booleans are INTEGER, and `deletedAt` is a real indexed column.
--
-- NULL is used exactly where the TypeScript type says `| null`, so a row that
-- arrives missing a required field fails loudly on push instead of landing
-- half-formed and only breaking once someone reads it back.

-- ---------- products ----------
CREATE TABLE products (
  id         TEXT PRIMARY KEY,
  namaProduk TEXT    NOT NULL,
  tipe       TEXT    NOT NULL,
  ukuran     REAL,
  satuan     TEXT,
  hargaDasar REAL    NOT NULL,
  hargaJual  REAL    NOT NULL,
  konversi   TEXT    NOT NULL, -- JSON Conversion[]
  stokMin    REAL    NOT NULL,
  createdAt  TEXT    NOT NULL,
  updatedAt  TEXT    NOT NULL,
  deletedAt  TEXT,
  createdBy  TEXT,
  updatedBy  TEXT
);
CREATE INDEX idx_products_updatedAt ON products (updatedAt);
CREATE INDEX idx_products_deletedAt ON products (deletedAt);

-- ---------- orders ----------
CREATE TABLE orders (
  id           TEXT PRIMARY KEY,
  tanggal      TEXT    NOT NULL,
  productId    TEXT    NOT NULL,
  buyerId      TEXT    NOT NULL,
  namaProduk   TEXT    NOT NULL,
  satuan       TEXT    NOT NULL,
  kuantitas    REAL    NOT NULL,
  hargaSatuan  REAL    NOT NULL,
  totalHarga   REAL    NOT NULL,
  status       TEXT    NOT NULL,
  affectsStock INTEGER NOT NULL, -- boolean; toStorage() maps it to 0/1
  createdAt    TEXT    NOT NULL,
  updatedAt    TEXT    NOT NULL,
  deletedAt    TEXT,
  createdBy    TEXT,
  updatedBy    TEXT
);
CREATE INDEX idx_orders_updatedAt ON orders (updatedAt);
CREATE INDEX idx_orders_deletedAt ON orders (deletedAt);

-- ---------- purchases ----------
CREATE TABLE purchases (
  id          TEXT PRIMARY KEY,
  tanggal     TEXT NOT NULL,
  productId   TEXT NOT NULL,
  namaProduk  TEXT NOT NULL,
  satuan      TEXT NOT NULL,
  kuantitas   REAL NOT NULL,
  hargaSatuan REAL NOT NULL,
  totalHarga  REAL NOT NULL,
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL,
  deletedAt   TEXT,
  createdBy   TEXT,
  updatedBy   TEXT
);
CREATE INDEX idx_purchases_updatedAt ON purchases (updatedAt);
CREATE INDEX idx_purchases_deletedAt ON purchases (deletedAt);

-- ---------- stock ----------
CREATE TABLE stock (
  id         TEXT PRIMARY KEY,
  productId  TEXT NOT NULL,
  tanggal    TEXT NOT NULL,
  qty        REAL NOT NULL, -- signed, base units; REAL because konversi divides
  satuan     TEXT NOT NULL,
  reason     TEXT NOT NULL,
  hargaModal REAL,
  orderId    TEXT,
  purchaseId TEXT,
  note       TEXT NOT NULL,
  createdAt  TEXT NOT NULL,
  updatedAt  TEXT NOT NULL,
  deletedAt  TEXT,
  createdBy  TEXT,
  updatedBy  TEXT
);
CREATE INDEX idx_stock_updatedAt ON stock (updatedAt);
CREATE INDEX idx_stock_deletedAt ON stock (deletedAt);

-- ---------- buyers ----------
CREATE TABLE buyers (
  id        TEXT PRIMARY KEY,
  nama      TEXT NOT NULL,
  telepon   TEXT NOT NULL,
  email     TEXT NOT NULL,
  alamat    TEXT NOT NULL,
  catatan   TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  createdBy TEXT,
  updatedBy TEXT
);
CREATE INDEX idx_buyers_updatedAt ON buyers (updatedAt);
CREATE INDEX idx_buyers_deletedAt ON buyers (deletedAt);

-- ---------- templates ----------
-- business/customer/elements are JSON TEXT and can each carry base64 image
-- dataURLs, which is why this is the one table where a single row can approach
-- D1's ~2MB row cap. The Worker rejects an oversized row by name rather than
-- letting it fail the whole batch.
CREATE TABLE templates (
  id        TEXT PRIMARY KEY,
  nama      TEXT NOT NULL,
  business  TEXT NOT NULL, -- JSON { nama, alamat, telepon, logo }
  customer  TEXT NOT NULL, -- JSON { nama, alamat }
  elements  TEXT NOT NULL, -- JSON TemplateElement[]
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT,
  createdBy TEXT,
  updatedBy TEXT
);
CREATE INDEX idx_templates_updatedAt ON templates (updatedAt);
CREATE INDEX idx_templates_deletedAt ON templates (deletedAt);

-- ---------- audit ----------
-- Append-only, so `timestamp` is both the sort key and the sync cursor, and
-- there is no deletedAt to index: a restore replaces the whole log.
CREATE TABLE audit (
  id        TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entityId  TEXT NOT NULL,
  action    TEXT NOT NULL,
  label     TEXT NOT NULL,
  changes   TEXT, -- JSON diff; genuinely optional (AuditEntry.changes?)
  createdBy TEXT,
  updatedBy TEXT
);
CREATE INDEX idx_audit_timestamp ON audit (timestamp);

-- ---------- types ----------
-- Cursor-less: keyed on its own name and replaced wholesale on every push, so
-- there is nothing incremental to index.
CREATE TABLE types (
  nama      TEXT PRIMARY KEY,
  createdBy TEXT,
  updatedBy TEXT
);

-- ---------- roles ----------
-- Who may do what, keyed by the verified Cloudflare Access email. The CHECK is
-- the last line of defence: a role value outside this set would silently read
-- as "no permission" everywhere and be near-impossible to spot.
CREATE TABLE roles (
  email     TEXT PRIMARY KEY,
  role      TEXT NOT NULL CHECK (role IN ('read', 'write', 'admin')),
  createdAt TEXT NOT NULL,
  createdBy TEXT
);

-- ---------- sync_meta ----------
-- Server-side bookkeeping. Not user data and never synced to the client.
CREATE TABLE sync_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
