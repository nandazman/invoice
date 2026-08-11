// `vitest/config` re-exports vite's defineConfig with the `test` block typed.
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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

export default defineConfig({
  base: BASE,
  define: {
    __RELEASE__: JSON.stringify(RELEASE),
  },
  plugins: [react(), tailwindcss(), releaseMetaPlugin()],
  test: {
    // Installs fake-indexeddb + a localStorage stub before any module loads.
    setupFiles: ["./src/test-setup.ts"],
  },
});
