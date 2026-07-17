// Vitest global setup.
//
// Two browser APIs the storage layer depends on do not exist in the node test
// environment, and both must be installed BEFORE any module that touches them
// is imported — db.ts constructs its Dexie instance at module load.

// In-memory IndexedDB. Patches the globals (indexedDB, IDBKeyRange, ...).
import "fake-indexeddb/auto";

// Minimal localStorage. Only the migration reads it, and only via
// getItem/setItem/removeItem — no need for a full Storage implementation.
class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

if (!("localStorage" in globalThis)) {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    writable: true,
  });
}
