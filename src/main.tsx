import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { bootstrap } from "./lib/bootstrap";
import { initSync } from "./lib/sync/client";
import { initTabs } from "./lib/sync/tabs";
import { UpdatePrompt } from "./components/UpdatePrompt";
import "./styles.css";

// Expose the build's release hash so the running code version can be
// determined from the console: `window.__RELEASE__`.
declare global {
  const __RELEASE__: string;
  interface Window {
    __RELEASE__: string;
  }
}
window.__RELEASE__ = __RELEASE__;

const root = ReactDOM.createRoot(document.getElementById("root")!);

// A boot failure means we could not read the user's data. Rendering the app
// anyway would show empty tables — indistinguishable from data loss, and the
// user might start typing into them. Show the error instead.
function renderBootError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  root.render(
    <div className="mx-auto max-w-lg p-8 text-slate-800">
      <h1 className="mb-2 text-lg font-semibold text-red-600">Gagal memuat data</h1>
      <p className="mb-4 text-sm">{message}</p>
      <p className="text-sm text-slate-500">
        Data lama Anda tidak dihapus. Muat ulang halaman untuk mencoba lagi.
      </p>
    </div>,
  );
}

// The stores serve synchronous reads off in-memory arrays, so hydration must
// finish before the first render — otherwise every page renders empty.
bootstrap()
  .then(() => {
    // Before the render and before `initSync`, but AFTER bootstrap has hydrated
    // the stores — a `changed` message arriving first would otherwise re-read
    // into arrays that were never filled. Called here rather than inside
    // bootstrap() to keep the import graph acyclic: tabs.ts needs
    // bootstrap.rehydrate, so bootstrap must not need tabs.
    //
    // Unconditional, unlike initSync: tabs share an IndexedDB whether or not the
    // build has a Worker behind it, so the GitHub Pages copy gets cross-tab
    // freshness too.
    initTabs();

    root.render(
      <React.StrictMode>
        <RouterProvider router={router} />
        {/* Outside the router on purpose: it must also be reachable from the
            gate screen, which replaces the whole routed tree. */}
        <UpdatePrompt />
      </React.StrictMode>,
    );

    // AFTER the render, and deliberately not awaited. The D1 mirror is not part
    // of booting: every read is served from IndexedDB and every write has
    // already landed there, so a slow or unreachable sync must never delay the
    // first paint — and must never reach `renderBootError`, which would replace
    // a working app with an error page over a mirror that is merely behind.
    void initSync();
  })
  .catch(renderBootError);
