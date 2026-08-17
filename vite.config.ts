// `vitest/config` re-exports vite's defineConfig with the `test` block typed.
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Release identifier from the current commit, resolved at build time.
// Prefer the CI-provided SHA (GitHub Actions), fall back to local git.
function releaseHash(): string {
  const ci = process.env.GITHUB_SHA;
  if (ci) return ci.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

const RELEASE = releaseHash();

// Injects <meta name="release" content="<hash>"> into index.html so the
// running version is visible in the served HTML without executing any JS.
function releaseMetaPlugin(): Plugin {
  return {
    name: "release-meta",
    transformIndexHtml(html) {
      return html.replace(
        "</head>",
        `  <meta name="release" content="${RELEASE}" />\n  </head>`,
      );
    },
  };
}

// Where the built site is mounted. GitHub Pages serves this as a project page
// under /invoice/, Cloudflare Pages serves it at the domain root; the deploy
// workflow sets VITE_BASE to override the GitHub Pages default.
// Hash routing is used in the app so refreshes never 404.
const BASE = process.env.VITE_BASE ?? "/invoice/";

// The offline shell.
//
// The DATA layer was already offline-capable: IndexedDB is the commit point, so
// every read is local and a write that cannot reach D1 just leaves the mirror
// behind (see sync/client.ts). What was missing was the app itself — with no
// service worker, opening the page offline got whatever the HTTP cache happened
// to be holding, which is to say luck.
//
// `injectManifest`, not `generateSW`: the caching policy this app needs turns on
// Cloudflare Access being in front of it, and that reasoning belongs in readable
// code with the reasons attached. src/sw.ts is the whole strategy; this block
// only builds it.
function pwaPlugin() {
  return VitePWA({
    strategies: "injectManifest",
    srcDir: "src",
    filename: "sw.ts",
    // main.tsx registers the worker itself (UpdatePrompt.tsx) so it can offer
    // the update rather than reloading underneath someone mid-form.
    injectRegister: null,
    registerType: "prompt",
    // Emits crossorigin="use-credentials" on the manifest link. Required here,
    // not cosmetic: a web app manifest is fetched WITHOUT credentials by
    // default, so behind Cloudflare Access it is answered with the login page
    // instead of the manifest, and the app silently stops being installable.
    useCredentials: true,
    manifest: {
      name: "Invoice & Pesanan",
      short_name: "Invoice",
      description: "Pencatatan pesanan, stok, dan invoice.",
      lang: "id",
      start_url: BASE,
      scope: BASE,
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#0f172a",
      // Installability turns on this array. An empty one is a valid manifest
      // and a working offline app, but Chrome and Android refuse the install
      // prompt without at least a 192 and a 512, so the app could only ever
      // live in a tab. Generated from brand/logo.webp into public/.
      //
      // Relative `src`, deliberately: the manifest sits at the base root on
      // both targets, so these resolve to /invoice/pwa-192.png on Pages and
      // /pwa-192.png on Workers without this file knowing which build it is.
      icons: [
        { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
        { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
        // Separate art, not the same file relabelled. Android crops a maskable
        // icon to the launcher's shape, so this one is the logo inset on its
        // own field; pointing `maskable` at the full-bleed version above is how
        // icons come out with their edges shaved off.
        {
          src: "maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    injectManifest: {
      // The manifest icons are precached automatically; the favicons are not,
      // because the default patterns cover js/css/html only. Adding png picks
      // up favicon-*.png and apple-touch-icon.png — 36 KB for a shell that is
      // complete offline, tab icon included, instead of one that goes blank in
      // the tab strip the moment the network drops.
      globPatterns: ["**/*.{js,css,html,png}"],
      // exceljs is large and lands in one chunk; the default 2MB cap would drop
      // it from the precache silently, and the Excel page would then be the one
      // route that does not work offline.
      maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
    },
    devOptions: {
      // Off in dev. A service worker caching the module graph is a debugging
      // trap that costs more than the fidelity is worth.
      enabled: false,
    },
  });
}

export default defineConfig({
  base: BASE,
  define: {
    __RELEASE__: JSON.stringify(RELEASE),
  },
  plugins: [react(), tailwindcss(), releaseMetaPlugin(), pwaPlugin()],
  test: {
    // Installs fake-indexeddb + a localStorage stub before any module loads.
    setupFiles: ["./src/test-setup.ts"],
  },
});
