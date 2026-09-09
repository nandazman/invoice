import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";
import { Button, PrimaryButton } from "./Button";

// Service worker registration, and the one piece of UI it needs.
//
// The worker is registered in "prompt" mode rather than "autoUpdate", which is
// the whole reason this component exists. autoUpdate reloads every open tab the
// moment a new build activates, and this is a data-ENTRY app: rows are safe the
// instant they are saved (IndexedDB is the commit point), but a half-typed order
// lives in React state and a reload underneath the user throws it away. A deploy
// landing mid-form is rare; silently losing the form is not a rare-enough cost.
//
// So the new build waits, and the user picks the moment. Doing nothing is a
// valid answer too: an untaken update activates on its own once every tab of the
// app has been closed, which is what would have happened without a prompt.

// Registration happens ONCE, at module load, outside React. Putting it in an
// effect would register twice under StrictMode's double-invoke and again on
// every remount; the browser tolerates that, but the callbacks below would then
// be replaced mid-flight and the waiting worker could be lost.
let waiting = false;
let notify: () => void = () => {};

// Not called during a test run: nothing imports this module outside main.tsx,
// and the virtual module only exists inside a Vite build.
const updateSW = registerSW({
  onNeedRefresh() {
    waiting = true;
    notify();
  },
});

// Same external-store shape as store.ts and sync/client.ts, so subscribing works
// the way it does everywhere else in this codebase.
function subscribe(listener: () => void): () => void {
  notify = listener;
  return () => {
    notify = () => {};
  };
}

export function UpdatePrompt() {
  const needsRefresh = useSyncExternalStore(
    subscribe,
    () => waiting,
    () => false,
  );

  if (!needsRefresh) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 max-w-xs rounded-xl border border-line bg-surface p-4 shadow-lg"
    >
      <p className="mb-1 text-sm font-semibold text-ink">
        Versi baru tersedia
      </p>
      <p className="mb-3 text-sm text-faint">
        Data Anda tidak terpengaruh — semuanya sudah tersimpan di perangkat ini.
        Muat ulang kalau sedang tidak mengisi form.
      </p>
      <div className="flex gap-2">
        {/* `true` reloads the page once the new worker has taken over. */}
        <PrimaryButton onClick={() => void updateSW(true)}>
          Muat ulang
        </PrimaryButton>
        <Button
          onClick={() => {
            waiting = false;
            notify();
          }}
        >
          Nanti
        </Button>
      </div>
    </div>
  );
}
