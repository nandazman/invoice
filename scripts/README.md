# scripts/

DevTools console scripts. Not part of the build — paste them into the browser
console **on the app's page**.

| Script | Does |
| --- | --- |
| `copy-localstorage.js` | Dumps every `invoice.*` localStorage key to a JSON file |
| `paste-localstorage.js` | Writes those keys back into another browser's localStorage |

localStorage in, localStorage out. Neither script reads or writes IndexedDB.
The result is a target browser whose `invoice.*` localStorage keys are
byte-for-byte identical to the source browser's.

## Usage

**Copy** — on the browser that has the data:

1. Open the app, DevTools → Console.
2. Paste all of `copy-localstorage.js`, Enter. (Chrome may make you type
   `allow pasting` first.)
3. It downloads `invoice-localstorage-<date>.json` and prints a per-key size
   table.

**Paste** — on the target browser:

1. Open the app, DevTools → Console.
2. Paste all of `paste-localstorage.js`, Enter.
3. Pick the JSON file, confirm the prompt.
4. It reads every key back and verifies it matches the dump.

By default the paste is an **exact copy**: any `invoice.*` key present in the
target but absent from the dump is removed. Set `EXACT_COPY = false` at the top
of the script to overwrite only the dump's keys and leave the rest alone.

## Worth knowing

**A browser that has already migrated will not read these keys.** Since
2026-07-17 (`docs/2026-07-17/plan.md`) the app reads localStorage exactly once —
on its first boot after the new release — then sets a flag in IndexedDB and
skips localStorage from then on. That flag is what stops a stale localStorage
copy from clobbering everything typed since.

So these scripts are for putting the legacy bytes *in place*. They show up in
the app on a browser that has not migrated yet (its first boot will pick them
up). On an already-migrated browser the keys will sit there unread.

**For moving current data between machines, use the app instead** — **Backup
semua / Pulihkan** in the sidebar footer. That is the supported path, it
round-trips IDs, and it reads the live IndexedDB data. These scripts are for the
narrower job of transplanting the **pre-migration localStorage dataset**:
seeding a test browser, reproducing a migration bug, or checking the migration
against a real dataset.

## Notes

- **localStorage is per-origin.** `localhost:5173` and the GitHub Pages URL have
  separate stores. Copying between them is a normal thing to want; the paste
  script warns when origins differ rather than blocking it.
- Values move as **raw strings**, never parsed and re-stringified, so the
  round-trip is exact.
- Both scripts cover UI prefs (`invoice.sidebar.*`, `invoice.cols.*`) too, since
  they share the prefix — harmless, and a transplanted browser looks the same.
- localStorage caps at ~5MB per origin. If the source browser is near the cap,
  `setItem` can throw `QuotaExceededError` on the target; the paste script's
  read-back check will also flag any value that landed truncated.
