# The starter template is re-seeded on every rehydrate

**Status:** fixed in the working tree, not yet deployed.
**Files:** `src/lib/template-store.ts`, `src/lib/template-seed.ts`, `src/lib/db.ts`

## Symptom

One "Template Contoh" per device, all of them alongside whatever template the
cloud already had. Worse, and stranger: **the last template could not be
deleted.** Delete it, and it was back — with a different id — the next time
anything synced.

## What it actually was

`hydrateTemplates()` (`template-store.ts:95`) used to answer "is this table
empty?" by seeding one, and it is called from `rehydrate()` — which runs at
boot, after any pull that applied rows, and on every cross-tab `changed`
broadcast.

So the question was not asked once at install. It was re-asked continuously, and
each time it was answered with a **fresh `uid()`**:

- On a device whose cloud already had a template, boot found the local table
  empty (the pull had not landed yet), seeded one, and then the pull added the
  cloud's copy on top. Two templates. Repeat per device.
- Deleting the last template emptied the table, which made the next rehydrate
  seed a new one — and that new row was a legitimate local write, so it was
  pushed to the cloud and handed to everyone else.

The second effect is the one that made it feel haunted. A delete that
resurrects itself under a new id looks nothing like a seeding bug.

## Fix

The decision happens **once**, after the cloud has answered, in `resolveSeed()`
(`db.ts:386`), gated on a `SEED_PENDING_KEY` meta flag (`db.ts:70`) that a fresh
install sets and the first successful pull clears:

```ts
if ((await db.templates.count()) === 0) {
  await db.templates.put(seedTemplate());
  wrote = true;
}
```

Counted separately from products: a deployment whose cloud has a catalogue but
no template yet is a real state, and the two seeds are independent answers to
independent questions. The re-check happens inside the transaction, because two
tabs can reach it on the same pull and the loser must not write a second copy.

`hydrateTemplates` now only hydrates.

The seed itself moved to a new leaf module, `src/lib/template-seed.ts`, purely
to break a cycle: `template-store.ts` imports `db`, so `db.ts` could not import
the seed back out of it.

## Lesson

A hydrate function must not make decisions. It runs whenever the data changes,
which means anything it decides is decided over and over, against whatever
partial state happens to exist at that instant — and "the table is empty" is
never a safe thing to conclude on a device that is still waiting for its first
pull.

See also: [the same bug in the product catalogue](starter-catalogue-reseeded-on-a-synced-device.md).
