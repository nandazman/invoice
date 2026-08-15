# Access, the admin page, and the D1 dashboard — design

Follows `sync-plan.md`, which built the D1 mirror. That document's constraints
hold unchanged. This one revises the permission model it shipped, fixes a bug it
left behind, and adds a dashboard it never had.

## Decisions taken before writing this

Six questions were raised and settled. Several closed off alternatives that were
explored in some detail first and will look attractive again later, so the
reasoning is recorded, not just the outcome.

### 1. IndexedDB stays. We are not going D1-only.

The question was whether to delete the local database and read straight from D1,
on the grounds that a cloud app should talk to the cloud.

**Rejected for structural reasons, not preference.** Every store in
`src/lib/store.ts` is a module-level array read *synchronously* through
`useSyncExternalStore`. Every page calls `getProducts()` and expects the answer
on that line. Making reads async and networked is not a data-layer swap — it is
loading and error states on every page, plus a rewrite of everything derived:
Laba Rugi, stock levels and the per-buyer order tables all iterate full arrays in
memory, and over D1 they become either large fetches per render or SQL.

Three costs would have been felt immediately:

- **Every save becomes a round trip.** Today a save is instant with IndexedDB
  behind it. D1-only puts a spinner on every entry, on a phone, on mobile data.
- **Offline stops working**, for everyone.
- **The 5M-rows-read/day free tier** is burnt far faster by re-reading whole
  tables per page load than by the watermark sweep, which reads only rows past
  the cursor.

The important part: **this is already a cloud app.** D1 is authoritative,
attribution is stamped server-side from a verified JWT and cannot be forged by a
client, and the role is re-read from D1 on every request. IndexedDB is not a
competing source of truth — it is a cache. That is the harder version of the
pattern, not an avoidance of it.

> The one thing that would reverse this: if the goal becomes *learning* the
> request/response cloud pattern rather than shipping a fast invoice app. That is
> a different project and should be started as one, not arrived at through a
> rewrite.

### 2. Independent permission flags were designed, then abandoned.

An earlier draft of this document replaced the ladder with independent grants —
`canRead` / `canWrite` / `canAdmin` as separate columns — so that "admin who does
not write" would be expressible.

**It was dropped as confusing, and that judgement was right.** Independent flags
produce combinations nobody wants to reason about (admin without write, write
without read) and a UI of three checkboxes where two of the eight states are
nonsense and have to be defended against. The distinction it bought was never
needed in a two-person shop.

Do not reintroduce it without a concrete case that the ladder genuinely cannot
express.

### 3. Two roles, and the list is what grants use of the app.

The ladder survives, minus one rung. `read` is deleted as a role value.

| | means |
|---|---|
| **not on the list** | cannot use the app — see decision 4 |
| **`write`** | full use of the app; changes auto-sync to cloud |
| **`admin`** | that, plus the admin page: the roles list and the D1 dashboard |

Being on the list *is* the grant. There is no longer a role that can look but not
save, which is what makes decision 4 possible.

The `roles` table therefore answers exactly one question — "whose changes reach
the cloud, and who can manage that list" — rather than doubling as an access
list layered on top of Access's own.

### 4. Someone through Access but not on the list is blocked outright.

The alternative was letting them view everything with editing disabled. That was
rejected, and the reason is worth keeping: **it cost an eleven-page sweep**
(`BeliStock`, `BuyerDetail`, `Buyers`, `Excel`, `History`, `Invoice`, `Orders`,
`Prices`, `ProductDetail`, `Template`, plus dialogs) against 42 exported store
mutators, and the realistic failure mode was not "we won't do it" but "a locked
button on one page and a live one on another" — the kind of half-done gate that
looks finished.

Blocking is one screen. It also deletes **Mode coba-coba** entirely (§C), since
there is no longer a user who is prevented from editing but still inside the app.

The two lists move together in practice anyway: adding a person means adding
their email to the Access policy *and* to this list, in the same sitting.

### 5. The owner-only Access application in front of `/api/admin/*` stays.

Deleting it and letting the `admin` role be the sole authorization was
considered. It is kept as a second layer.

**The cost is real and must reach the UI:** granting admin in this app does
nothing on its own. That person is still stopped by Access before the Worker
runs. The grant takes effect only once their email is also added to the
owner-only Access application's policy in the Cloudflare dashboard. The roles
panel has to say so at the point of granting, or the feature silently does not
work and reads as a bug.

### 6. The D1 dashboard stays inside D1. No API token.

Cloudflare's GraphQL analytics API would give real platform metrics, and needs an
account-scoped API token stored as a Worker secret. Everything actually wanted
can be derived from D1 itself, so no new secret is introduced. Same rule for the
local DB viewer (§E): local file access and snapshots only.

### Security precondition, checked

Decision 3 removes the roles table as a second gate on *reading*, which is only
safe if the Access policy is an explicit allow-list. **Confirmed:** both Access
applications — the hostname app and the admin app — currently contain one email,
the owner's. Nothing is exposed by the change.

This is now load-bearing in a way it was not before. If that policy is ever
widened to a domain rule or "any authenticated user", every person it admits
reaches the gate screen with no data — but the hostname app is the only thing
standing between the outside world and `/api/sync/pull`. Widen it only to
specific emails.

---

## What is being built

### A. Permission model

Migration `0002`. D1 cannot alter a CHECK constraint, so this is a table rebuild:
create, copy, drop, rename.

```sql
CREATE TABLE roles_new (
  email     TEXT PRIMARY KEY,
  role      TEXT NOT NULL CHECK (role IN ('write', 'admin')),
  createdAt TEXT NOT NULL,
  createdBy TEXT
);

-- 'read' rows are dropped, not migrated: that role no longer exists, and
-- someone who held it is now blocked until explicitly granted 'write'.
INSERT INTO roles_new SELECT email, role, createdAt, createdBy
  FROM roles WHERE role IN ('write', 'admin');
```

`createdAt`/`createdBy` carry across unchanged — they record when the person was
first let in, and a schema change is not a re-grant.

**Migration safety.** A botched backfill that drops the owner's `admin` row makes
the roles UI unreachable from inside the app — `guardLastAdmin` exists precisely
because of this — and the only recovery is `wrangler d1 execute --remote` against
production. So, in order, without exception:

1. `wrangler d1 export invoice --remote --output backup-pre-0002.sql`
2. apply `--local`, then `SELECT * FROM roles` and read the owner's row
3. write down the recovery `INSERT` before applying remotely
4. apply `--remote`, then `SELECT` again and confirm before closing the terminal

Worker. `src/worker/roles.ts` keeps `Role`, `RANK` and `atLeast`; `'read'` leaves
the type and the rank map becomes `{ none: 0, write: 1, admin: 2 }`. `roleOf`
still returns `'none'` for a missing row — that now means *blocked*, not
*reader*.

`/api/sync/push` and `requireAdmin` are untouched: `atLeast(role, 'write')` and
`atLeast(role, 'admin')` still mean exactly what they did.

`/api/sync/pull` **keeps its check**, changed from `'read'` to `'write'`. It
would have been tempting to delete it on the grounds that Access is the read
gate, but the gate screen is client-side and the API must not be the only thing
trusting it. A blocked account gets 403 from every endpoint.

UI. The roles panel's `<select>` at `AdminPage.tsx:738` becomes a single **Admin**
checkbox per row: being listed already means write, so the only thing left to
choose is whether they also administer. `ROLE_LABEL`, `ROLE_BADGE`, `ROLE_EFFECT`
and `ROLE_RANK` all lose their `read` entries, and `ROLE_EFFECT` needs rewriting
— its current text describes a reader whose edits stop at their device, which
will no longer be true of anybody. The admin checkbox carries the decision-5
warning about the Access policy.

### B. The gate screen

One screen for `role === 'none'`: who you are, that the owner has not granted
access yet, and nothing else. No nav, no data.

**Three conditions it must not fire on**, each of which would be a worse bug than
the one it fixes:

- **The GitHub Pages copy.** `initSync` returns before setting `available` when
  there is no API, so that build must never gate. The condition is
  `status.available && status.role === 'none'`, never `role === 'none'` alone.
- **Offline at boot.** `available` only becomes true after a successful
  `/api/sync/me` (`client.ts:697`). A user who opens the app on bad signal has an
  unknown role, not a denied one — and blanking a legitimate user's app because
  their train went into a tunnel would break the offline-first property this
  whole design exists to protect. The last known role is cached in localStorage
  and used while the server has not answered; only a confirmed `'none'` from a
  live `/api/sync/me` gates.
- **A stale cache after revocation.** The inverse risk: a cached `'write'` must
  not outlive the grant. It does not need to — the cache only decides what the UI
  shows, and every endpoint re-reads the role from D1 on every request. A revoked
  user with a stale cache sees the app and gets 403 on their next sync, which is
  the correct outcome and the reason the API check in §A stays.

The screen offers **"Backup semua"**. Someone who was listed and then removed has
local data, and taking away their access should not silently take away their
ability to get a copy of what they typed.

### C. Sync chip in the navigation

Replaces the reader-facing half of `/admin`.

A **status chip that is also a button**, not a bare "Sync Cloud" button. A bare
button says nothing about whether sync is working; a chip reading `☁ 3 menunggu`
or `☁ tersinkron` answers the question you have *before* clicking. Clicking opens
a small panel: online/offline, pending rows, last push, last pull, "Sinkronkan
sekarang", and a collapsed **Lanjutan** holding "Buang perubahan lokal".

Pulling stays automatic — the 60s poll and visibility listener already in
`client.ts` do it. The button forces a sync; it is not the mechanism by which
sync happens, and the panel copy must not suggest otherwise.

**Mode coba-coba is deleted**, not moved. It existed for a role that no longer
exists. Remove `SCRATCH_KEY`, `isScratchMode`, `setScratchMode`, `ScratchPanel`,
and the test at `client.test.ts:754`.

`/admin` becomes genuinely admin-only: roles and dashboard, nothing else. The
comment in `src/router.tsx:108` explaining that the route stays registered for
non-admins who need scratch mode and discard **stops being true** and must be
rewritten, not left to mislead the next reader.

### D. D1 dashboard

Added to `/api/admin/stats`, all derived from D1:

- **Database size** — `meta.size_after` in bytes, returned free on every query.
  The number most likely to bite first: templates embed base64 logos, and that
  table is the only one whose rows approach D1's ~2MB cap.
- **Per-table last-write time** — `MAX(updatedAt)`. "Pesanan: 412 baris, terakhir
  2 jam lalu" says sync is alive in a way a count never does.
- **Write volume, 24h and 7d**, counted off `updatedAt`.
- **Last seen per person** — a `lastSeenAt` column on `roles`, stamped by
  `/api/sync/me`. Answers "did the access I granted ever get used?"

`lastSeenAt` costs one write per session, not per sync: `/api/sync/me` has
exactly one call site (`client.ts:697`, on boot) and the 60s poll does not touch
it. Verify that stays true if the poll is ever changed — a write per tab per
minute would be a different proposition against the 100k/day free tier.

Now that every listed person can write, `lastSeenAt` covers everyone on the list,
with no caveat needed in the UI.

### E. Local D1 access

There is no pgAdmin equivalent, and the reason is structural: **D1 has no wire
protocol.** It is HTTP-only, so nothing can hold a connection open.

**Local — a real SQLite file, already on disk:**

```
.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite
```

Open it in DB Browser for SQLite (the closest thing to pgAdmin here), DBeaver,
TablePlus, or the VS Code SQLite extension. Full browse, query and edit. Stop
`wrangler dev` first, or the two fight over the lock.

**Remote — no live GUI.** Query with `wrangler d1 execute invoice --remote
--command`, or the Cloudflare dashboard's D1 console, or snapshot it down with
`wrangler d1 export` and browse the copy locally. Per decision 6 there is no
token-backed studio; a snapshot is the supported way to look at production data.

Scripts to add:

| script | does |
|---|---|
| `d1:sql` | ad-hoc query against local |
| `d1:sql:remote` | same against production |
| `d1:export` | snapshot production to a gitignored `.sql` |
| `d1:path` | print the local `.sqlite` path to paste into a GUI |

The exact viewer tooling is to be verified against what actually exists at
implementation time rather than named from memory here.

### F. Stale documentation

- `setup.md:53` gives `ACCESS_TEAM_DOMAIN` as `"xutopia"`; the deployed value in
  `wrangler.jsonc` is `"long-shadow-af9f"`. Anyone following the doc builds a
  broken certs URL and gets an authentication failure with no obvious cause.
- `setup.md:84` ("policy *and* give them a role") is still correct and becomes
  more important — it is now the only thing granting use of the app.
- `sync-plan.md` documents the three-rung ladder including `read`, and its
  "Identity and roles" section needs updating to match decision 3.

---

## Order of work

1. **A** — migration `0002`, `roles.ts`, roles UI. Ships alone; the app works
   fully afterwards, just with the old page layout.
2. **B** — gate screen. Depends on A for `role === 'none'` to mean *blocked*.
3. **C** — sync chip, scratch-mode removal, `/admin` split.
4. **D** — dashboard and `lastSeenAt`. Independent of B and C.
5. **E** and **F** — scripts and docs. Independent of everything.

## What must not be broken

- **Attribution stays server-only.** `pick()` on the push path and `shed()` in
  `backup.ts` enforce it in opposite directions. Neither is touched by this work.
- **The server check is the security boundary.** The gate screen in B is a UI
  affordance. Deleting an `index.ts` role check because "the screen blocks them
  anyway" is the one change that turns this plan into a vulnerability.
- **The GitHub Pages copy must keep working with no API at all.** Every new gate
  reads `status.available` first.
- **No new secrets.** `.dev.vars` remains the only home for `DEV_IDENTITY`; it
  must never reach `wrangler.jsonc` or `wrangler secret put`.
