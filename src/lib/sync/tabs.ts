import { onWrite } from "../db";
import { rehydrate } from "../bootstrap";

// Cross-tab coordination. Two jobs, both of which exist because several tabs of
// this app share ONE IndexedDB and each keeps its own copy of the data in
// memory.
//
//   1. FRESHNESS. `store.ts` serves every read synchronously from module-level
//      arrays filled once at boot. When tab A saves an order, the row is on disk
//      immediately and tab B's disk view is already correct — only tab B's
//      ARRAYS are stale. So the fix is local: tell tab B to re-read IndexedDB.
//      No request, no server round trip, and it works on the GitHub Pages copy
//      that has no Worker behind it at all.
//
//   2. ONE SYNCER. Without this, every open tab runs its own poll against
//      /api/sync/pull, so four tabs cost four times the D1 reads for identical
//      data. Worse, `watermarks` in client.ts is a per-tab memory cache over a
//      single shared Dexie `meta` row: two tabs syncing at once can write each
//      other's watermark back. Losing the race in one direction just re-sends
//      rows (upserts are idempotent); losing it in the other direction persists
//      a watermark NEWER than what was actually sent, and those rows drop out of
//      the sweep permanently. Electing one syncer removes the race rather than
//      detecting it.
//
// This module deliberately does not import the sync client — client.ts imports
// this one. Reactions are registered, the same inversion db.ts already uses for
// `onWrite` and `onPersistError`.

// Versioned like the other persisted keys. An old tab left open across a deploy
// keeps talking on the old channel rather than exchanging messages it cannot
// read.
const CHANNEL_NAME = "invoice.tabs.v1";

// Web Locks are keyed by name within an origin. Holding this one IS being the
// leader; there is no separate registry to keep correct.
const LOCK_NAME = "invoice.sync.leader.v1";

// A burst of writes (one form save is several `persist()` calls) becomes one
// rehydrate in the receiving tabs. Short enough to feel instant.
const REHYDRATE_MS = 150;

// How long a VISIBLE tab waits for the leader lock before taking it by force.
//
// Web Locks have no expiry: whoever holds this one holds it until its document
// goes away. That is exactly right when the holder is alive and exactly wrong
// when it is a window the user forgot about — an installed PWA left open, a
// pinned tab, a second window behind this one. Browsers freeze timers in hidden
// documents, so a leader in that state hears the write, schedules the push, and
// then does not run the timer for minutes or hours. Every other tab is
// meanwhile refusing to push on the grounds that somebody else is the leader,
// and the whole origin stops syncing with no error anywhere: rows land in
// IndexedDB, the chip counts them as pending, and no request is ever made.
//
// So leadership follows the user. A tab that is visible and still not the
// leader after this long steals the lock. Stealing is what Web Locks offer for
// exactly this case, and it keeps the "one syncer" invariant the gate exists to
// protect — the previous holder is told it was stolen from and stands down.
const STEAL_AFTER_MS = 3_000;

type TabMessage =
  // IndexedDB changed — either a local write here or a pull that landed rows.
  // Every other tab must re-read; the leader must also sync it onward.
  | { kind: "changed" }
  // A visible non-leader tab wants fresh data. Only the leader acts.
  | { kind: "wake" };

// ---------- Capability detection ----------

// Both features are checked once, together, and treated as a package. That
// coupling is deliberate: leadership gating is only SAFE if the leader can hear
// about the other tabs' writes. A browser with Web Locks but no BroadcastChannel
// would otherwise elect a leader that never learns a non-leader wrote something,
// and that tab's rows would sit unsent forever. Falling back to "every tab is
// its own leader" restores exactly the previous per-tab behaviour: more requests
// than necessary, but nothing lost.
function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof BroadcastChannel !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.locks !== undefined
  );
}

// ---------- State ----------

let channel: BroadcastChannel | null = null;
let rehydrateTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeWrite: (() => void) | null = null;
let stealTimer: ReturnType<typeof setTimeout> | null = null;
// The still-queued plain request, if there is one. A steal has to cancel it
// first: a queued request is not cancelled by winning the lock some other way,
// so without this the tab would sit in its own queue holding a place it no
// longer needs — and inherit the lock again, ahead of the tab that was actually
// waiting, the moment the current holder goes away.
let pendingRequest: AbortController | null = null;
let removeVisibility: (() => void) | null = null;
// Held so a re-election can announce itself. `claimLeadership` is called once,
// but this tab may win, be stolen from, and win again.
let elected: (() => void) | null = null;

// True when this tab is the only one allowed to talk to the API. Starts true so
// a browser without the two APIs above, or a build that never calls
// `claimLeadership`, behaves exactly as it did before this module existed.
let leader = true;

const changeHandlers = new Set<() => void>();
const wakeHandlers = new Set<() => void>();

export function isLeader(): boolean {
  return leader;
}

// ---------- Sending ----------

function post(message: TabMessage): void {
  // A closed or absent channel is not an error: single-tab and unsupported
  // browsers are the normal case, not a degraded one.
  try {
    channel?.postMessage(message);
  } catch {
    // Firefox throws on postMessage to a channel whose document is unloading.
    // The message is worth nothing at that point anyway.
  }
}

// "IndexedDB changed under you." Called automatically after every local write,
// and by the sync client after a pull applies rows — that path writes through
// Dexie's `bulkPut` rather than `persist()` (deliberately, so applying a pull
// cannot schedule the sync that would loop), so it raises no write event and has
// to announce itself.
export function broadcastChanged(): void {
  post({ kind: "changed" });
}

// "I am visible and would like fresh data." Sent by non-leader tabs instead of
// making their own request. The leader decides whether to act — the rate floor
// lives there, at the one point that actually spends requests, so N tabs waking
// still cost at most one sync.
export function requestSync(): void {
  post({ kind: "wake" });
}

// ---------- Receiving ----------

// Registered by the sync client: re-read the watermark cache, then schedule a
// push if this tab is the leader. Fired AFTER the local rehydrate, so a handler
// sees the fresh arrays.
export function onRemoteChange(handler: () => void): () => void {
  changeHandlers.add(handler);
  return () => {
    changeHandlers.delete(handler);
  };
}

export function onWake(handler: () => void): () => void {
  wakeHandlers.add(handler);
  return () => {
    wakeHandlers.delete(handler);
  };
}

function fan(handlers: Set<() => void>): void {
  for (const handler of handlers) {
    try {
      handler();
    } catch (err) {
      console.error("[tabs] handler failed", err);
    }
  }
}

function handleChanged(): void {
  if (rehydrateTimer !== null) clearTimeout(rehydrateTimer);
  rehydrateTimer = setTimeout(() => {
    rehydrateTimer = null;
    // Never awaited by anything and never allowed to throw outward: a failed
    // re-read leaves this tab showing slightly stale rows, which is where it
    // already was. It is not a reason to break the app.
    void rehydrate()
      .then(() => fan(changeHandlers))
      .catch((err) => console.error("[tabs] rehydrate failed", err));
  }, REHYDRATE_MS);
}

// ---------- Boot ----------

let initialized = false;

// Called from the boot path, unconditionally — including on the GitHub Pages
// copy. Multi-tab freshness is a property of sharing an IndexedDB, not of having
// a server, so it must not be gated on the sync API being reachable.
export function initTabs(): void {
  if (initialized || !supported()) return;
  initialized = true;

  channel = new BroadcastChannel(CHANNEL_NAME);
  // BroadcastChannel does NOT deliver a message back to the context that posted
  // it, so there is no echo to filter and no risk of a tab rehydrating over its
  // own write.
  channel.onmessage = (event: MessageEvent<TabMessage>) => {
    const message = event.data;
    if (message?.kind === "changed") handleChanged();
    else if (message?.kind === "wake" && leader) fan(wakeHandlers);
  };

  unsubscribeWrite = onWrite(broadcastChanged);
}

// True only when we can SEE that this document is in front of the user. A
// missing `document` — the tests, any non-browser host — answers false rather
// than true: stealing is a privilege of the tab the user is looking at, and a
// context that cannot say whether it is visible must not claim it.
function visible(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "visible"
  );
}

function acquire(steal: boolean): void {
  // `steal` and `signal` are mutually exclusive in the API, and each request
  // only ever needs one of them: a steal is granted immediately, so there is
  // nothing to cancel; a plain request may wait forever, so there has to be.
  const controller = steal ? null : new AbortController();
  pendingRequest = controller;
  const options = controller ? { signal: controller.signal } : { steal: true };

  void navigator.locks
    .request(LOCK_NAME, options, () => {
      pendingRequest = null;
      leader = true;
      elected?.();
      // Never resolves. Holding the lock IS the leadership, so it is released
      // only when this document goes away, at which point the browser hands it
      // to the next tab waiting, with no heartbeat or timeout to tune and no way
      // for a crashed tab to keep it.
      return new Promise<never>(() => {});
    })
    .catch((err) => {
      // Our own cancellation, on the way to stealing. Not an outcome, just the
      // first half of one — and it must not be mistaken for the case below,
      // which would re-queue the request we just cancelled.
      if (controller?.signal.aborted) return;
      // Being stolen from is the one rejection that is not a failure: another
      // tab, in front of the user, has taken over. Stand down and queue again,
      // so this tab still inherits the lock when that one closes.
      if ((err as { name?: string } | null)?.name === "AbortError") {
        leader = false;
        acquire(false);
        return;
      }
      // Any other rejection would leave this tab permanently convinced it is
      // not the leader AND unable to become one, i.e. a tab whose writes never
      // leave the device. Failing back to "leader" costs a duplicated poll at
      // worst.
      console.error("[tabs] leader election failed, syncing locally", err);
      leader = true;
      elected?.();
    });
}

// Arm the steal. A timer rather than an immediate steal because the ordinary
// case is a lock that is free or whose holder is closing, and the plain request
// wins those within milliseconds. The steal is for the case where nobody is
// coming.
function scheduleSteal(): void {
  if (stealTimer !== null) clearTimeout(stealTimer);
  stealTimer = setTimeout(() => {
    stealTimer = null;
    if (leader || !visible()) return;
    pendingRequest?.abort();
    pendingRequest = null;
    acquire(true);
  }, STEAL_AFTER_MS);
}

// Take part in the election. Separate from `initTabs` because it is only
// meaningful once the sync API is known to exist: on a build with no Worker
// there is nothing to be leader OF, and every tab staying its own leader is the
// honest state.
//
// `onElected` fires when this tab wins, which may be long after boot, and may
// fire more than once: a tab that is stolen from can win the lock back.
export function claimLeadership(onElected: () => void): void {
  if (!supported()) {
    // `leader` is already true. Every tab syncs for itself, as before.
    onElected();
    return;
  }

  elected = onElected;
  leader = false;
  acquire(false);

  // Two arming points, because there are two ways to be a visible tab that is
  // not the leader. This one is for the tab that was already in front of the
  // user at boot: no visibility change is ever going to fire for it.
  scheduleSteal();

  if (typeof document !== "undefined") {
    // And this one is for coming BACK to a tab, which is also the moment the
    // user says which window they actually want syncing.
    const onVisibility = () => {
      if (!leader && visible()) scheduleSteal();
    };
    document.addEventListener("visibilitychange", onVisibility);
    removeVisibility = () =>
      document.removeEventListener("visibilitychange", onVisibility);
  }
}

// Test seam, mirroring `__resetSyncForTests`. The module holds process-wide
// state that a fresh test case has to be able to clear.
export function __resetTabsForTests(): void {
  if (rehydrateTimer !== null) clearTimeout(rehydrateTimer);
  rehydrateTimer = null;
  if (stealTimer !== null) clearTimeout(stealTimer);
  stealTimer = null;
  pendingRequest = null;
  removeVisibility?.();
  removeVisibility = null;
  elected = null;
  unsubscribeWrite?.();
  unsubscribeWrite = null;
  channel?.close();
  channel = null;
  changeHandlers.clear();
  wakeHandlers.clear();
  initialized = false;
  leader = true;
}
