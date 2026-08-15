import {
  isAvailable,
  migrateFromLocalStorage,
  readAll,
  requestPersistence,
  type MigrationResult,
} from "./db";
import { hydrateStores } from "./store";
import { hydrateAudit } from "./audit";
import { hydrateTemplates } from "./template-store";

// Boot sequence, run once before the first render.
//
// This module exists to break a cycle: the stores import `db` to write, so `db`
// cannot import the stores to hydrate them. Orchestration lives here instead,
// above both.
//
// Order is not negotiable:
//   1. migrate  — copy localStorage -> IndexedDB, verify, then flag
//   2. readAll  — one bulk read per table
//   3. hydrate  — fill the in-memory arrays
// Only after (3) may anything render, because every store read is synchronous
// and would otherwise return an empty array.

// Steps 2 and 3 on their own: re-read every table and refill the in-memory
// arrays. Boot uses it, and so does a D1 pull — a pull writes into IndexedDB
// and cannot feed the stores directly, so it has to re-run exactly this. It
// lives here rather than in the sync client so there is only one copy of the
// sequence to keep correct as stores are added.
export async function rehydrate(): Promise<void> {
  const snap = await readAll();
  hydrateStores(snap);
  hydrateAudit(snap);
  hydrateTemplates(snap);
}

export interface BootResult {
  migration: MigrationResult;
  persisted: boolean;
}

export async function bootstrap(): Promise<BootResult> {
  if (!(await isAvailable())) {
    throw new Error(
      "IndexedDB tidak tersedia di browser ini. Aplikasi tidak dapat menyimpan " +
        "data — coba keluar dari mode penyamaran (incognito/private).",
    );
  }

  const migration = await migrateFromLocalStorage();

  await rehydrate();

  // Best-effort and deliberately last: never let this block or fail the boot.
  const persisted = await requestPersistence();

  return { migration, persisted };
}
