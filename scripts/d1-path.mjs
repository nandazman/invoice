// Print the path of the LOCAL D1 database file, so it can be pasted into a
// SQLite GUI (DB Browser for SQLite, DBeaver, TablePlus, the VS Code SQLite
// extension).
//
// This exists because D1 has no wire protocol — it is HTTP-only, so nothing can
// hold a connection open and there is no pgAdmin-style "connect to the server".
// What there IS, locally, is an ordinary SQLite file that miniflare keeps on
// disk. Any SQLite tool opens it. The only hard part is finding it.
//
// The file is named after a hash of the binding, not the database, so it is
// resolved by globbing rather than hardcoding — the hash changes if the binding
// is renamed or the local state is wiped, and a hardcoded path would then point
// at a file that quietly does not exist.

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows the latter yields "/F:/..." which
// is not a path any fs call accepts.
const dir = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject",
);

let files = [];
try {
  files = readdirSync(dir)
    // metadata.sqlite is miniflare's own bookkeeping, not the database.
    .filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite")
    .map((f) => join(dir, f));
} catch {
  // directory missing — same failure as no files, handled below
}

if (files.length === 0) {
  console.error(
    "\nNo local D1 database found.\n\n" +
      "Expected something like:\n" +
      "  .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite\n\n" +
      "That file is created the first time the local database is used. Run:\n" +
      "  bun run d1:migrate:local\n",
  );
  process.exit(1);
}

// More than one means more than one D1 binding has been used locally; print all
// of them with sizes rather than guessing which one was meant.
for (const file of files) {
  const kb = Math.round(statSync(file).size / 1024);
  console.log(files.length > 1 ? `${file}  (${kb} KB)` : file);
}

console.log(
  "\nOpen that file in DB Browser for SQLite, DBeaver, TablePlus, or the\n" +
    "VS Code SQLite extension. Stop `wrangler dev` first — both processes\n" +
    "want the same write lock.\n",
);
