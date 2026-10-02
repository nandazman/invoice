import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { initSync } from "./lib/sync/client";
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

// A boot failure means we could not load the data from the server. Rendering the
// app anyway would show empty tables — indistinguishable from data loss, and the
// user might start typing into them. Show the error and a retry instead.
function renderBootError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  root.render(
    <div className="mx-auto max-w-lg p-8 text-ink">
      <h1 className="mb-2 text-lg font-semibold text-danger">Gagal memuat data</h1>
      <p className="mb-4 text-sm">{message}</p>
      <p className="mb-4 text-sm text-faint">
        Data tersimpan di server, bukan di perangkat ini, jadi tidak ada yang
        hilang. Periksa koneksi lalu coba lagi.
      </p>
      <button
        onClick={boot}
        className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white cursor-pointer"
      >
        Coba lagi
      </button>
    </div>,
  );
}

// The stores serve synchronous reads off in-memory arrays, so the first full
// load must finish before the first render — otherwise every page renders empty.
function boot(): void {
  initSync()
    .then(() => {
      root.render(
        <React.StrictMode>
          <RouterProvider router={router} />
          {/* Outside the router on purpose: it must also be reachable from the
              gate screen, which replaces the whole routed tree. */}
          <UpdatePrompt />
        </React.StrictMode>,
      );
    })
    .catch(renderBootError);
}

boot();
