# `canPush` is stale until a hard reload

**Status:** open. Known, small, not yet fixed.
**Files:** `src/lib/sync/client.ts`, `src/worker/sync.ts`

## Symptom

An account is switched from local-only to allowed-to-push (or the reverse) in
the admin page. The tab that account already has open does not notice. It keeps
writing locally and never pushes, and the sync panel keeps describing itself in
the local-only voice — until the page is hard-reloaded.

Nothing surfaces the staleness, so from the user's side it reads as "the
permission change did not work".

## What it actually is

`canPush` is read in exactly one place — the `/api/sync/me` response during
`initSync` (`client.ts:1066`):

```ts
const canPush = result.data.canPush !== false;
cacheGrant(role, canPush);
```

`initSync` runs once per document and is guarded by an `initialized` flag. There
is no second read, so the value a tab boots with is the value it dies with. The
same is true of `role`.

The server is still the enforcement — a local-only account that somehow pushed
would be rejected — so this is a staleness bug, not a security one.

## Fix worth making

Have `/api/sync/pull` return `role` and `canPush` alongside `serverTime`, and
patch the status from it on every pull. The pull already happens every 60
seconds, on visibility, and on reconnect, so a grant would take effect within
about a minute with no new request and no new endpoint.

Two things to keep from the existing code when doing it:

- **Absent means allowed.** A missing `canPush` means the Worker predates the
  flag, and such a Worker will accept the push regardless; reading silence as
  "no" would stop syncing for everyone against an older deploy in order to
  enforce a rule that build does not have.
- The grant cache is written in exactly one place today, and that property is
  worth preserving — a second writer is how the two copies drift.

## Lesson

Anything read once at boot is a value the app cannot be told has changed. That
is fine for identity and fine for the shape of the schema; it is not fine for a
permission, which is precisely the kind of thing someone changes *while you are
looking at the page*.
