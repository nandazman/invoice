# The starter catalogue is re-seeded on a device that already has one

**Status:** fixed in the working tree, not yet deployed. Duplicate rows already
in D1 are cleaned up with **Kirim ke cloud**, not by this fix.
**Files:** `src/lib/db.ts`, `src/lib/seed.ts`

## Symptom

Duplicate products in the list, and more of them after each new device or
browser was signed in. Attempts to fix it locally — deleting the copies, or
restoring a clean JSON backup — did not stick, because
[a restore never reaches the cloud](json-restore-never-reaches-the-cloud.md).

## What it actually was

`migrateFromLocalStorage()` seeded the example catalogue as part of deciding
that this was a fresh install. That was correct when IndexedDB was the whole
world: no local data meant a new user, and a new user wants something to look
at.

It stopped being correct the moment D1 existed. "This browser has no products"
and "this account has no products" became different statements, and the seed was
answering the first one while meaning the second. Every new device therefore
minted its own copy of the catalogue with **fresh ids**, pushed it, and the
cloud accumulated one set per device — with no way to tell a seeded row from a
real one, since by then they were ordinary rows with ordinary history.

## Fix

Seeding is deferred until the cloud has answered. A fresh install sets a
`SEED_PENDING_KEY` meta flag (`db.ts:70`) instead of writing rows; the first
successful pull calls `resolveSeed()` (`db.ts:386`), which seeds only what is
still genuinely empty and then clears the flag:

```ts
if ((await db.products.count()) === 0) {
  await db.products.bulkPut(withTombstoneField(seedProducts()));
  wrote = true;
}
```

Three details that are load-bearing:

- The flag is re-checked **inside** the transaction. Two tabs can reach this on
  the same pull, and the loser must not write a second catalogue.
- There is deliberately no in-memory "already resolved" cache. It would need a
  reset seam for the tests and would save one indexed `get` per pull.
- A build with **no Worker at all** (the GitHub Pages copy) still seeds: the
  `unavailable` failure is the one failure that is also an answer. Every other
  failure — offline, a lapsed Access session — leaves the flag set for the next
  boot, because guessing "the cloud is empty" is the exact mistake this
  mechanism exists to prevent.

## Lesson

Any "first run" heuristic written before sync existed is now asking the wrong
question. The honest version of "is this a new user?" cannot be answered before
the first pull comes back, so the answer has to wait rather than be guessed.
