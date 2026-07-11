import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
