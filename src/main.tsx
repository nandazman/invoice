import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { bootstrap } from "./lib/bootstrap";
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
    root.render(
      <React.StrictMode>
        <RouterProvider router={router} />
      </React.StrictMode>,
    );
  })
  .catch(renderBootError);
