import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// What these tests pin, all of it invisible in a single-tab run:
//
//   1. a write in one tab makes the OTHER tabs re-read IndexedDB, with no
//      request involved;
//   2. exactly one tab holds the lock, and only that one is told to sync;
//   3. a non-leader's wake reaches the leader and nobody else;
//   4. when the leader goes away the next tab takes over — otherwise closing a
//      window would silently stop the whole origin from syncing;
//   5. a browser missing either API falls back to "every tab is its own
//      leader", i.e. the behaviour from before this module existed. That
//      fallback is the difference between "more requests than necessary" and
//      "a tab whose writes never leave the device".
//
// db and bootstrap are mocked out: the subject here is the coordination, and
// driving it through a real Dexie would test Dexie.

const h = vi.hoisted(() => ({
  writeHandlers: new Set<() => void>(),
  rehydrate: vi.fn(async () => {}),
}));

vi.mock("../db", () => ({
  onWrite: (fn: () => void) => {
    h.writeHandlers.add(fn);
    return () => {
      h.writeHandlers.delete(fn);
    };
  },
}));

vi.mock("../bootstrap", () => ({ rehydrate: h.rehydrate }));

// ---------- fake BroadcastChannel ----------

// Faithful in the one respect the module depends on: a channel does NOT receive
// its own messages. tabs.ts leans on that to avoid filtering echoes, so a fake
// that echoed would hide a real bug rather than expose one.
const channels = new Map<string, Set<FakeChannel>>();

class FakeChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(public readonly name: string) {
    let set = channels.get(name);
    if (!set) channels.set(name, (set = new Set()));
    set.add(this);
  }

  postMessage(data: unknown): void {
    for (const other of channels.get(this.name) ?? []) {
      if (other === this) continue;
      other.onmessage?.({ data: structuredClone(data) });
    }
  }

  close(): void {
    channels.get(this.name)?.delete(this);
  }
}

// ---------- fake Web Locks ----------

// Only the shape tabs.ts uses: an exclusive request whose callback returns a
// promise that never settles, so the lock is held until the document goes away.
// `closeLeader` stands in for that.
const queues = new Map<string, (() => void)[]>();
const holders = new Map<string, boolean>();

function fakeLocks() {
  return {
    request(name: string, cb: () => Promise<never>): Promise<void> {
      if (!holders.get(name)) {
        holders.set(name, true);
        void cb();
        return new Promise<void>(() => {});
      }
      return new Promise<void>((_resolve) => {
        const waiters = queues.get(name) ?? [];
        waiters.push(() => void cb());
        queues.set(name, waiters);
      });
    },
  };
}

// The leader tab closing: the browser releases its lock and grants it to the
// next waiter.
function closeLeader(name = "invoice.sync.leader.v1"): void {
  const next = queues.get(name)?.shift();
  holders.set(name, false);
  if (next) {
    holders.set(name, true);
    next();
  }
}

// ---------- environment ----------

function installEnv(withLocks = true): void {
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  Object.defineProperty(globalThis, "BroadcastChannel", {
    value: FakeChannel,
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: withLocks ? { locks: fakeLocks() } : {},
    configurable: true,
  });
}

function clearEnv(): void {
  for (const key of ["window", "BroadcastChannel", "navigator"]) {
    Reflect.deleteProperty(globalThis, key);
  }
}

// A fresh module instance stands in for a fresh TAB: tabs.ts holds its state at
// module scope, exactly one set per document.
type Tabs = typeof import("./tabs");
async function openTab(): Promise<Tabs> {
  vi.resetModules();
  const mod = await import("./tabs");
  mod.initTabs();
  return mod;
}

// The receiving side debounces then awaits `rehydrate`, so the timer and the
// microtask queue both have to be drained before asserting.
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(200);
}

function write(): void {
  for (const handler of h.writeHandlers) handler();
}

beforeEach(() => {
  vi.useFakeTimers();
  installEnv();
  channels.clear();
  queues.clear();
  holders.clear();
  h.writeHandlers.clear();
  h.rehydrate.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  clearEnv();
});

describe("cross-tab freshness", () => {
  it("makes the other tab re-read IndexedDB after a local write", async () => {
    const a = await openTab();
    const b = await openTab();

    // `write()` fires every registered handler, which is both tabs' — but only
    // one of them is the writer in reality. Narrow it to A's by clearing first.
    h.rehydrate.mockClear();
    a.broadcastChanged();
    await settle();

    expect(h.rehydrate).toHaveBeenCalledTimes(1);
    expect(b).toBeDefined();
  });

  it("does not re-read in the tab that did the writing", async () => {
    const a = await openTab();
    h.rehydrate.mockClear();

    a.broadcastChanged();
    await settle();

    // No other tab is open, and a channel never hears itself.
    expect(h.rehydrate).not.toHaveBeenCalled();
  });

  it("coalesces a burst of writes into one re-read", async () => {
    await openTab();
    const b = await openTab();
    h.rehydrate.mockClear();

    // One form save is several persist() calls, which is the case this debounce
    // exists for.
    b.broadcastChanged();
    b.broadcastChanged();
    b.broadcastChanged();
    await settle();

    expect(h.rehydrate).toHaveBeenCalledTimes(1);
  });

  it("registers a write handler so a persist() broadcasts without being asked", async () => {
    await openTab();
    await openTab();
    h.rehydrate.mockClear();

    // Both tabs' handlers fire here, which is not realistic, but it proves the
    // subscription exists — a tab that never registered would leave the others
    // stale after every save.
    write();
    await settle();

    expect(h.rehydrate).toHaveBeenCalled();
  });
});

describe("leader election", () => {
  it("elects exactly one leader across tabs", async () => {
    const a = await openTab();
    const b = await openTab();
    const electedA = vi.fn();
    const electedB = vi.fn();

    a.claimLeadership(electedA);
    b.claimLeadership(electedB);

    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);
    expect(electedA).toHaveBeenCalledTimes(1);
    expect(electedB).not.toHaveBeenCalled();
  });

  it("hands leadership to the next tab when the leader closes", async () => {
    const a = await openTab();
    const b = await openTab();
    a.claimLeadership(vi.fn());
    const electedB = vi.fn();
    b.claimLeadership(electedB);

    closeLeader();

    // Without this, closing one window would stop the whole origin from ever
    // syncing again — the failure mode that makes leader election dangerous if
    // it is done with a flag instead of a lock.
    expect(b.isLeader()).toBe(true);
    expect(electedB).toHaveBeenCalledTimes(1);
  });

  it("delivers a wake to the leader only", async () => {
    const a = await openTab();
    const b = await openTab();
    a.claimLeadership(vi.fn());
    b.claimLeadership(vi.fn());

    const wokeA = vi.fn();
    const wokeB = vi.fn();
    a.onWake(wokeA);
    b.onWake(wokeB);

    // The non-leader asks instead of fetching. This is what keeps the request
    // rate per-origin rather than per-tab.
    b.requestSync();

    expect(wokeA).toHaveBeenCalledTimes(1);
    expect(wokeB).not.toHaveBeenCalled();
  });

  it("ignores a wake aimed at a tab that is not the leader", async () => {
    const a = await openTab();
    const b = await openTab();
    a.claimLeadership(vi.fn());
    b.claimLeadership(vi.fn());

    const wokeB = vi.fn();
    b.onWake(wokeB);

    a.requestSync();

    expect(wokeB).not.toHaveBeenCalled();
  });

  it("fires remote-change handlers after the stores are re-read", async () => {
    const a = await openTab();
    const b = await openTab();
    const seen: string[] = [];
    h.rehydrate.mockImplementation(async () => {
      seen.push("rehydrate");
    });
    b.onRemoteChange(() => seen.push("handler"));

    a.broadcastChanged();
    await settle();

    // Order matters: the sync client's handler schedules a push off the state
    // this re-read produces.
    expect(seen).toEqual(["rehydrate", "handler"]);
  });
});

describe("unsupported browsers", () => {
  it("leaves every tab its own leader when Web Locks are missing", async () => {
    clearEnv();
    installEnv(false);

    const a = await openTab();
    const b = await openTab();
    const electedA = vi.fn();
    const electedB = vi.fn();

    a.claimLeadership(electedA);
    b.claimLeadership(electedB);

    // Both, deliberately. Gating on leadership is only safe when the leader can
    // hear the others' writes; without the pair of APIs, every tab must keep
    // syncing for itself or its rows would never be sent.
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(true);
    expect(electedA).toHaveBeenCalledTimes(1);
    expect(electedB).toHaveBeenCalledTimes(1);
  });

  it("starts out as leader before any election is run", async () => {
    const a = await openTab();

    // The GitHub Pages copy never calls claimLeadership — there is no API to be
    // leader of. Defaulting to false there would gate `scheduleSync` off and
    // quietly disable the write path.
    expect(a.isLeader()).toBe(true);
  });
});
