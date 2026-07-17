// Copy every `invoice.*` localStorage key out of the app, as JSON.
//
// USAGE: open the app, open DevTools -> Console, paste this whole file, Enter.
// (Chrome may ask you to type "allow pasting" first.)
//
// Produces two things:
//   1. a downloaded file, invoice-localstorage-<date>.json  <- use this one
//   2. the same JSON on your clipboard, if it is small enough to be useful
//
// Values are copied as RAW STRINGS, never parsed and re-stringified, so what
// comes back out is byte-for-byte what was in there. Restore with
// paste-localstorage.js.
//
// localStorage is per-origin: run this ON the app's page. Data copied from
// localhost:5173 will not appear on the GitHub Pages URL and vice versa — which
// is exactly how you move a dataset between the two.

(() => {
  const PREFIX = "invoice.";

  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PREFIX)) data[key] = localStorage.getItem(key);
  }

  const keys = Object.keys(data).sort();
  if (keys.length === 0) {
    console.warn(
      `[copy] No "${PREFIX}*" keys found on ${location.origin}.\n` +
        `If this app has already migrated to IndexedDB, that is expected for a\n` +
        `browser that never ran the old version — the legacy keys only exist\n` +
        `where the pre-IndexedDB release actually stored data.`,
    );
    return;
  }

  const payload = {
    kind: "invoice-localstorage-dump",
    version: 1,
    origin: location.origin,
    exportedAt: new Date().toISOString(),
    release: window.__RELEASE__ ?? "unknown",
    data,
  };

  const json = JSON.stringify(payload, null, 2);
  const bytes = new Blob([json]).size;
  const kb = (bytes / 1024).toFixed(1);

  // Per-key size report: the base64 logos inside invoice.templates.v1 are
  // usually what fills the 5MB budget, so it is worth seeing the breakdown.
  console.log(`[copy] ${keys.length} key(s), ${kb} KB total:`);
  console.table(
    keys.map((k) => ({
      key: k,
      KB: (new Blob([data[k]]).size / 1024).toFixed(1),
    })),
  );

  // The download is the reliable path — a multi-MB string is miserable to move
  // through a console.
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `invoice-localstorage-${stamp}.json`;
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  console.log(`[copy] Downloaded ${filename} (${kb} KB).`);

  // `copy()` is a DevTools console helper, absent when this runs anywhere else.
  if (typeof copy === "function" && bytes < 1_000_000) {
    copy(json);
    console.log("[copy] Also on your clipboard.");
  } else if (bytes >= 1_000_000) {
    console.log("[copy] Too big for the clipboard — use the downloaded file.");
  }

  return payload;
})();
