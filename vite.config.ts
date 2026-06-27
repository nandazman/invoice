import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Project page on GitHub Pages: served at /invoice/.
// Hash routing is used in the app so refreshes never 404.
export default defineConfig({
  base: "/invoice/",
  plugins: [react(), tailwindcss()],
});
