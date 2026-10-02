# scripts/

| Script | Does |
| --- | --- |
| `build-cloudflare.mjs` | Builds the client for Cloudflare Workers (`bun run build:cf`) |
| `d1-path.mjs` | Prints the path of the local D1 SQLite file (`bun run d1:path`) |
| `generate-icons.mjs` | Regenerates the PWA icons in `public/` |

The old `copy-localstorage.js` / `paste-localstorage.js` console scripts were
removed on 2026-10-02: the browser no longer holds any data to copy.
