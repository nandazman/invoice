# Sync stops entirely while a hidden window holds the leader lock

**Status:** fixed in the working tree, not yet deployed.
**Files:** `src/lib/sync/tabs.ts`, `src/lib/sync/client.ts`

## Symptom

> "where the hell the sync happened, i add/update the buyer, does not show
> anything on the network"

A row added on the writing device never appeared on the reading account — not
after a hard refresh, and not after `Ambil dari cloud`, which is the strongest
read the app can make. The devtools Network tab showed **no request at all**
when a row was saved: not a failed push, not a 401, nothing. Every other sign
looked healthy. The chip did not show an error.

It started with buyers and then reproduced with products, which is what ruled
out anything table-specific.

## What it actually was

Only one tab per origin is allowed to talk to the API. That gate is a Web Lock
(`LOCK_NAME`, `tabs.ts:36`), and `scheduleSync` refuses to do anything without
it (`client.ts:940`):

```ts
if (!status.available) return;
if (!isLeader()) return;
```

**Web Locks have no expiry.** Whoever holds this one holds it until its document
goes away. That is right when the holder is alive and wrong when it is a window
nobody is going to close — an installed PWA left open, a pinned tab, a second
window behind the one you are using.

A hidden document has its timers throttled, and is eventually frozen outright.
So the holder heard the write over BroadcastChannel, scheduled its 3-second
push, and never ran the timer. Meanwhile the tab actually being typed into was
declining to push, correctly, on the grounds that somebody else was the leader.

The result is a deadlock that survives reloading, because reloading the *wrong*
tab changes nothing — the new document just joins the back of the same queue.

The original design knew the leader might be hidden and covered it with the wake
broadcast (a non-leader asks the leader to sync instead of syncing itself). That
holds while the leader is merely throttled. It stops holding once the leader is
frozen, because a frozen document does not receive broadcasts either, and the
wake reaches nobody.

## How it was confirmed

`navigator.locks.query()` in the console of the tab being typed into:

```
held:    1     ← the zombie
pending: 3     ← every tab the user was actually using
```

`pending > 0` is the signal. `held: 1` is correct and permanent; it is the queue
behind it that should always be empty within milliseconds.

The cloud agreed: D1's newest `buyers` row was a month old, while `products` had
been written 15 minutes earlier — sync had been alive that afternoon and had
stopped since.

## Fix

Leadership follows the user instead of first-come-first-served.

- A tab that is **visible** and still not the leader after `STEAL_AFTER_MS`
  (3s, `tabs.ts:58`) **steals** the lock. Stealing is what the Web Locks API
  provides for exactly this, and it preserves the one-syncer invariant: the
  previous holder is rejected with `AbortError` and stands down.
- Two arming points (`claimLeadership`, `tabs.ts:284`): once at boot, for the
  tab already in front of the user — no `visibilitychange` will ever fire for
  it — and again on each transition to visible.
- Hidden tabs never steal (`visible()` answers false when it cannot tell). Two
  background windows trading the lock would be a fight nobody is watching.
- A tab that is stolen from re-queues, so closing the thief hands leadership
  back rather than leaving the origin with no syncer.
- The plain request carries an `AbortSignal`, cancelled before stealing
  (`acquire`, `tabs.ts:220`). Without that a thief would still be standing in
  its own queue and would inherit the lock ahead of the tab actually waiting.

Four tests in `src/lib/sync/tabs.test.ts` pin it: steal from a background
window, no steal while hidden, steal on return-to-visible, hand back on close.

## Lesson

A lock with no expiry is a liveness assumption about its holder. Browsers do not
honour that assumption for hidden documents, and there is no event that tells
the queue its holder has stopped being useful — so the queue has to be able to
take the lock rather than wait for it.
