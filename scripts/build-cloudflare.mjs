// Build the private copy for Cloudflare Workers, served at the domain root.
//
// This exists because a plain `bun run build` is a trap for this target.
// vite.config defaults `base` to "/invoice/" for the GitHub Pages copy, so a
// default build emits an index.html pointing at /invoice/assets/*. Those paths
// 404 at the domain root: no JavaScript loads and the site serves a blank white
// page, with no error anywhere, because the HTML itself is served fine.
//
// Setting the variable here rather than inline in the script string is not
// stylistic. `VITE_BASE=/ bun run build` fails two ways on Windows: PowerShell
// has no such syntax, and Git Bash's MSYS layer rewrites the bare "/" into a
// Windows path, silently producing src="/Program Files/Git/assets/...".
// `execFileSync`'s `env` option never goes near a shell.
//
// The GitHub Actions workflow sets VITE_BASE=/ and greps the output to prove it
// (deploy-cloudflare.yml). That guard belonged somewhere a laptop deploy would
// hit it too — `wrangler deploy` uploads whatever sits in ./dist and has no
// idea what it is looking at, so the check has to happen before the upload.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

execFileSync("bun", ["run", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  // Root-relative, unlike the GitHub Pages copy which is served under /invoice/.
  env: { ...process.env, VITE_BASE: "/" },
});

const html = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
if (html.includes('src="/invoice/') || html.includes('href="/invoice/')) {
  console.error(
    "\nERROR: dist/ was built for GitHub Pages (/invoice/ base).\n" +
      "Those assets 404 at the domain root and the site renders blank.\n" +
      "VITE_BASE was not applied — refusing to continue.\n",
  );
  process.exit(1);
}

console.log("\nAsset paths are root-relative — dist/ is ready for Cloudflare.\n");
