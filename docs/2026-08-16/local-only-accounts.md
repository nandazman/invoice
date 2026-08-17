# Local-only accounts

An admin can now say, per person: *this account uses the app fully, and what it
writes stays on its own device.* One column, `roles.canPush`, added by
`migrations/0003_push_flag.sql`.

## Why a flag and not a rung

The role ladder (`none < write < admin`) answers **how much of the app do you
get**. This answers **does what you write reach anybody else**. They are
independent — an admin can be local-only, a plain user can publish — so folding
this into `role` would need four values to say what one boolean says, and
`atLeast()` would stop being a comparison of abilities.

That is also why `atLeast` is deliberately unable to see it, and why
`requireAdmin` does not consult it: administering is a question of authority,
not of where somebody's invoices live.

## What it does and does not stop

| | local-only account |
|---|---|
| the app | unchanged — every page, every write, full speed |
| IndexedDB | unchanged — it was always the commit point |
| **push** | refused, by the Worker |
| **pull** | unchanged, on purpose |

Pulling is not gated. This is an account that does not *publish*, not one that
is cut off; withholding everyone else's rows would make the flag a demotion, and
`role` is the thing that expresses demotions.

## The enforcement is server-side

`/api/sync/push` reads the grant live on every request and answers **403
`local_only`**. The client also refuses to attempt the push, but that is an
affordance — it saves a doomed round trip and lets the UI say something true.
In practice the 403 only ever fires for a tab that has been open since before
the flag was set, or a hand-made request, which is exactly what it is for.

Both come from the same one query (`grantOf`), so the role and the flag can
never describe different moments.

## The pending count changes meaning

`pending` was always documented as the divergence set rather than a queue. For a
local-only account it is *permanently* non-zero and only grows, so the sync chip
changes voice: slate not amber, "3 lokal" not "3 menunggu", and the panel says
outright that this is a difference from the cloud rather than a backlog waiting
to drain. A chip that promised a drain that is never coming would be the one
real bug this feature could ship.

The panel also carries the warning that follows from it: with no copy in the
cloud, clearing browser data loses that work, so **Backup semua** stops being
optional for these accounts.

## Two defaults, both "on"

The column defaults to `1`, the add-user form defaults to checked, and a
`/api/sync/me` that omits `canPush` is read as `true`.

The last one inverts this codebase's usual fail-closed instinct, deliberately: a
missing field means the Worker predates the flag, and a Worker that has never
heard of local-only will accept the push regardless. Reading silence as "no"
would stop sync for everyone on an older deploy in order to enforce a rule that
build does not have.

For the same reason `PUT /api/admin/roles` treats an absent `canPush` as *leave
it alone* (a `COALESCE`, not a default) — otherwise every promotion would
quietly re-publish somebody who had been set to local-only.

## Rolling it out

`0003` is invisible to existing accounts: everyone keeps publishing until an
admin turns the switch off. Apply it before deploying the Worker — the Worker
selects the column on every authenticated request, so an unmigrated database
answers 500 rather than degrading.
