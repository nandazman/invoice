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

// Take part in the election. Separate from `initTabs` because it is only
// meaningful once the sync API is known to exist: on a build with no Worker
// there is nothing to be leader OF, and every tab staying its own leader is the
// honest state.
//
// `onElected` fires when this tab wins, which may be long after boot — the lock
// is held for the lifetime of the winning document, so a second tab becomes
// leader at the moment the first one closes.
export function claimLeadership(onElected: () => void): void {
  if (!supported()) {
    // `leader` is already true. Every tab syncs for itself, as before.
    onElected();
    return;
  }

  leader = false;
  void navigator.locks
    .request(LOCK_NAME, () => {
      leader = true;
      onElected();
      // Never resolves. Holding the lock IS the leadership, so it is released
      // only when this document goes away — at which point the browser hands it
      // to the next tab waiting, with no heartbeat or timeout to tune and no way
      // for a crashed tab to keep it.
      return new Promise<never>(() => {});
    })
    .catch((err) => {
      // A rejected lock request would otherwise leave this tab permanently
      // convinced it is not the leader AND unable to become one, i.e. a tab
      // whose writes never leave the device. Failing back to "leader" costs a
      // duplicated poll at worst.
      console.error("[tabs] leader election failed, syncing locally", err);
      leader = true;
      onElected();
    });
}

// Test seam, mirroring `__resetSyncForTests`. The module holds process-wide
// state that a fresh test case has to be able to clear.
export function __resetTabsForTests(): void {
  if (rehydrateTimer !== null) clearTimeout(rehydrateTimer);
  rehydrateTimer = null;
  unsubscribeWrite?.();
  unsubscribeWrite = null;
  channel?.close();
  channel = null;
  changeHandlers.clear();
  wakeHandlers.clear();
  initialized = false;
  leader = true;
}
