// Drizzle Studio against the LIVE D1 database — a browser table editor, the
// nearest thing D1 gets to pgAdmin. Only the dev tooling uses drizzle; the app
// and the Worker do not, and migrations/ stays the source of truth for schema.
//
// D1 has no wire protocol, so this goes through the Cloudflare HTTP API with an
// API token (D1:Edit). Put it in .env (gitignored):
//   CLOUDFLARE_D1_TOKEN=...
//
// Edits made in Studio hit production immediately.

import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile();
} catch {
  // no .env — fall through to whatever is already in the environment
}

export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  // Introspected by `bun run db:pull`, gitignored — regenerate after a migration.
  out: "./drizzle",
  schema: "./drizzle/schema.ts",
  dbCredentials: {
    accountId: "cfcf768d4aa53e2ddb6e4f317ab1eed8",
    // Same id as wrangler.jsonc.
    databaseId: "65936d38-f8dc-4aeb-9678-cc159cead889",
    token: process.env.CLOUDFLARE_D1_TOKEN!,
  },
});
