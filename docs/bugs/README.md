# Bugs

One file per bug, kept for reference rather than as a tracker. Each one records
the symptom as it was actually reported, the cause as it was actually found, and
why the thing was invisible for as long as it was — that last part is usually
the reusable lesson.

All of these come from the same period: the weeks after the D1 mirror went in
(`docs/2026-08-15/sync-plan.md`). Sync is the common thread, and so is the
common shape: **the app kept working locally, so nothing looked broken.**

| Bug | Status |
|---|---|
| [Sync stops entirely while a hidden window holds the leader lock](sync-leader-lock-held-by-hidden-window.md) | Fixed, needs deploy |
| [A JSON restore never reaches the cloud](json-restore-never-reaches-the-cloud.md) | Fixed, needs deploy |
| [The starter template is re-seeded on every rehydrate](starter-template-reseeded-on-every-rehydrate.md) | Fixed, needs deploy |
| [The starter catalogue is re-seeded on a device that already has one](starter-catalogue-reseeded-on-a-synced-device.md) | Fixed, needs deploy |
| [`canPush` is stale until a hard reload](canpush-stale-until-hard-reload.md) | Open |

## The pattern worth remembering

Four of the five were silent. No error, no failed request, no red chip — the
write landed in IndexedDB (which is the commit point, by design), the UI showed
success, and the mirror simply did not follow. The design makes local writes
independent of the network on purpose; the cost is that "the mirror stopped" and
"the mirror is idle" look identical from the inside.

Two consequences, both learned the hard way:

1. **A gate that returns early needs a way to be seen.** `scheduleSync` has two
   of them (`client.ts:940`) and both produce total silence.
2. **The cloud is the only witness worth asking.** Every one of these was
   settled in minutes by querying D1 directly, and none of them by reading the
   client's own status.

```
wrangler d1 execute invoice --remote --command \
  "select 'buyers' t, max(updatedAt) m, count(*) c from buyers
   union all select 'products', max(updatedAt), count(*) from products"
```
