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

// Minimal download plumbing. `io.ts:downloadJSON` is the one browser boundary
// the data layer reaches through, and since the unsynced-row rescue (rescue.ts)
// every destructive store operation now goes through it — a restore aborts if
// the file cannot be written, which is the point, but in the node environment
// that would mean "aborts always".
//
// Same category as the two stubs above: not a seam cut into the app for tests,
// just the browser API the app legitimately uses, present. Downloads land in
// `capturedDownloads` so a test can assert what a destructive action saved.
export interface CapturedDownload {
  filename: string;
  text: string;
}
export const capturedDownloads: CapturedDownload[] = [];

if (!("document" in globalThis)) {
  let pending = "";
  // Augmented in place, never replaced: URL is a real constructor that other
  // code (and Vite itself) calls with `new`, and swapping it for a plain object
  // breaks every suite before a single test runs.
  //
  // Blob.text() is async and downloadJSON is not, so the text is stashed on the
  // way past rather than read back out of the blob.
  Object.assign(URL, {
    createObjectURL: (blob: { __text?: string }) => {
      pending = blob.__text ?? "";
      return "blob:test";
    },
    revokeObjectURL: () => {},
  });
  Object.defineProperty(globalThis, "Blob", {
    value: class {
      __text: string;
      constructor(parts: string[]) {
        this.__text = parts.join("");
      }
    },
    writable: true,
  });
  // `configurable: true` is load-bearing: the tabs tests install their own
  // `document` and delete it again between cases (clearEnv/installDocument in
  // sync/tabs.test.ts), and a non-configurable property here makes both of
  // those throw. This stub must be replaceable, not authoritative.
  //
  // `visibilityState` is included for the same reason tabs.ts reads it — a
  // document that exists but cannot answer "am I visible?" is a shape the real
  // code never sees, and leaving it out would make this stub a source of
  // behaviour rather than a stand-in for a browser API.
  Object.defineProperty(globalThis, "document", {
    value: {
      visibilityState: "visible",
      addEventListener: () => {},
      removeEventListener: () => {},
      createElement: () => ({
        href: "",
        download: "",
        click(this: { download: string }) {
          capturedDownloads.push({ filename: this.download, text: pending });
        },
      }),
    },
    writable: true,
    configurable: true,
  });
}
