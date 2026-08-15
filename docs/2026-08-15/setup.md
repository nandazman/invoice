# D1 sync — setup

Everything in the repo is done. What remains is the five things that touch your
Cloudflare account, which the code cannot do for itself.

Design: [sync-plan.md](./sync-plan.md).

---

## 1. Create the database

```bash
bunx wrangler d1 create invoice
```

It prints a `database_id`. Paste it into `wrangler.jsonc`, replacing
`REPLACE_ME_WITH_D1_DATABASE_ID`.

## 2. Apply the schema

```bash
bun run d1:migrate:local    # local copy, for wrangler dev
bun run d1:migrate          # the real one
```

## 3. Add ONE Access application, for the admin API

The application already guarding `invoice.xutopia.my.id` covers `/api/sync/*`
too, so sync needs nothing new. Only the admin API needs narrowing.

Access matches the **most specific path**, so one narrow application layered on
the existing broad one is enough:

| Request | Matched application | Policy |
|---|---|---|
| `/`, the SPA, `/api/sync/*` | the existing hostname app | everyone who may use the app |
| `/api/admin/*` | the new app below | you only |

Zero Trust dashboard (https://one.dash.cloudflare.com) → Access → Applications →
Add a self-hosted application:

| Field | Value |
|---|---|
| Name | invoice-admin |
| Application domain | `invoice.xutopia.my.id` |
| Path | `api/admin` |
| Policy → Include | Emails → **only your address** |

Now copy two **Application Audience (AUD) tags** — each is on its application's
Overview tab — into the `vars` block in `wrangler.jsonc`:

```jsonc
"ACCESS_TEAM_DOMAIN": "xutopia",              // team name only, not the full URL
"ACCESS_AUD_SYNC":    "<EXISTING hostname app's AUD>",
"ACCESS_AUD_ADMIN":   "<new invoice-admin app's AUD>"
```

The two AUDs are what actually separate the tiers. A token minted by the
hostname application carries the hostname AUD, so presenting it to
`/api/admin/*` — which is verified against `ACCESS_AUD_ADMIN` — fails. "Everyone
who can open the app" and "only me on admin" are therefore enforced by Access
itself, with the `roles` table as the second layer rather than the only one.

These are not secrets; they are public identifiers. The security is the JWT
signature check against your team's published keys, which is why they can live
in the repo.

## 4. Give yourself the admin role

The chicken-and-egg step: `PUT /api/admin/roles` requires an existing admin, so
the first one has to be inserted directly.

```bash
bunx wrangler d1 execute invoice --remote \
  --command "INSERT INTO roles (email, role, createdAt) VALUES ('you@example.com','admin',datetime('now'))"
```

Use the **exact** address Access authenticates you as, lower-cased — the Worker
lower-cases the token's email before looking it up.

Everyone after you gets their role from the admin page. Note the two layers:
Access decides who reaches the API at all, the `roles` table decides what they
may do once there. Adding someone means both — put them in the invoice-sync
policy *and* give them a role.

## 5. Deploy

```bash
bun run build
bunx wrangler deploy
```

Or run the existing **Deploy to Cloudflare Workers** workflow, which gates on
the test suite. Deploying from a laptop skips that gate.

---

## Running it locally

`wrangler dev` sits in front of no Access application, so nothing it receives
carries an assertion and every `/api/*` call would 401. `DEV_IDENTITY` stands in
for the email Access would have supplied:

```bash
cp .dev.vars.example .dev.vars     # then edit the address
bun run d1:migrate:local
bunx wrangler dev
```

Give that address the admin role in the **local** database too:

```bash
bunx wrangler d1 execute invoice --local \
  --command "INSERT INTO roles (email, role, createdAt) VALUES ('you@example.com','admin',datetime('now'))"
```

`.dev.vars` is gitignored and `wrangler deploy` does not upload it. There is no
"am I in dev?" check in the code, deliberately — such checks are what get
fooled. **Never** add `DEV_IDENTITY` to `vars` in `wrangler.jsonc` and never
`wrangler secret put` it: in a deployed Worker it turns authentication off.

Plain `bun run dev` (vite, no Worker) still works — the API simply isn't there,
the client reports `available: false`, and the app runs exactly as it does today
on local data.

---

## What each role does

| Role | Pull | Push | Admin page |
|---|---|---|---|
| `admin` | yes | yes | full |
| `write` | yes | yes | status and actions only |
| `read` | yes | **no** | status and actions only |
| none | no | no | "tidak punya akses" |

A `read` user gets a read-only UI, with an opt-in **Mode coba-coba** that
re-enables local editing. Those edits stay on that device, are never pushed, and
show up as divergence until discarded.

The role is re-checked in D1 on **every** push, not read from a cached token —
so a demotion takes effect on the next request, not whenever a session expires.

## Cost

This ends the zero-invocation setup: `wrangler.jsonc` used to have no script at
all, so nothing counted as a Worker invocation. Now `/api/*` executes the
Worker. Static assets still bypass it entirely, and sync traffic is debounced,
so the volume sits far inside the free tier (100k Worker requests/day, 100k D1
writes/day).

## Known limits

- **Pull is unpaged.** A first sync returns every row in one response. Fine at
  this dataset's size; it would need a paging protocol before it isn't.
- **Templates over ~1.8MB are not synced.** They embed base64 logos and D1 caps
  a row at ~2MB. They are named in the admin page's error, and the watermark is
  held below them so they keep being reported and sync themselves once shrunk.
- **The divergence count is an upper bound for a reader.** While a table has
  local divergence its watermark is held back, so rows just pulled from the
  server also sit above it and get counted. A per-row dirty flag would fix it —
  i.e. the outbox this design deliberately does without.
- **The Access JWT path has not been exercised against a real token.** It is the
  one thing that cannot be tested without a live Access application in front of
  it. Check `/api/sync/me` first after deploying.
