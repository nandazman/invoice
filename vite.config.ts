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

// Project page on GitHub Pages: served at /invoice/.
// Hash routing is used in the app so refreshes never 404.
export default defineConfig({
  base: "/invoice/",
  define: {
    __RELEASE__: JSON.stringify(RELEASE),
  },
  plugins: [react(), tailwindcss(), releaseMetaPlugin()],
  test: {
    // Installs fake-indexeddb + a localStorage stub before any module loads.
    setupFiles: ["./src/test-setup.ts"],
  },
});
