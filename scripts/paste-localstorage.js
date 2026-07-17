// Write `invoice.*` localStorage keys back from a copy-localstorage.js dump.
//
// USAGE: open the app, open DevTools -> Console, paste this whole file, Enter.
// A file picker opens — choose the invoice-localstorage-<date>.json you copied.
// (Chrome may ask you to type "allow pasting" first.)
//
// localStorage in, localStorage out. Nothing else is touched: this does not
// read, write, or delete IndexedDB. When it finishes, the target browser's
// localStorage holds exactly the same `invoice.*` keys, byte-for-byte, as the
// browser you copied from.
//
// localStorage is per-origin — run this ON the app's page, and note that
// localhost and the deployed URL have separate stores.

(async () => {
  // Remove any existing `invoice.*` keys first, so the result is an exact copy
  // of the dump rather than the dump merged over whatever was already there.
  // Set to false to overwrite only the keys present in the dump and leave the
  // rest alone.
  const EXACT_COPY = true;

  const PREFIX = "invoice.";

  function pickFile() {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return reject(new Error("Tidak ada berkas dipilih"));
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      };
      input.click();
    });
  }

  const text = await pickFile();
  const payload = JSON.parse(text);

  if (payload?.kind !== "invoice-localstorage-dump") {
    throw new Error(
      "Berkas ini bukan dump dari copy-localstorage.js (kind tidak cocok).",
    );
  }
  const data = payload.data ?? {};
  const keys = Object.keys(data).sort();
  if (keys.length === 0) throw new Error("Dump kosong — tidak ada kunci.");

  if (payload.origin !== location.origin) {
    console.warn(
      `[paste] Dump came from ${payload.origin}, you are on ${location.origin}.\n` +
        `That is fine and often the point (moving data between localhost and the\n` +
        `deployed app) — just make sure it is what you meant.`,
    );
  }

  // What is already here, so the confirm prompt can say what gets removed.
  const existing = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) existing.push(k);
  }
  const doomed = EXACT_COPY ? existing.filter((k) => !(k in data)) : [];

  if (
    !confirm(
      `Tulis ${keys.length} kunci localStorage dari dump ${payload.exportedAt}?\n\n` +
        keys.map((k) => `  ${k}`).join("\n") +
        (doomed.length > 0
          ? `\n\nDihapus (ada di sini, tidak ada di dump):\n` +
            doomed.map((k) => `  ${k}`).join("\n")
          : "") +
        `\n\nHanya localStorage yang diubah. IndexedDB tidak disentuh.`,
    )
  ) {
    console.log("[paste] Dibatalkan.");
    return;
  }

  for (const key of doomed) localStorage.removeItem(key);
  for (const key of keys) localStorage.setItem(key, data[key]);

  console.log(
    `[paste] Wrote ${keys.length} key(s) to ${location.origin}` +
      (doomed.length > 0 ? `, removed ${doomed.length}.` : "."),
  );

  // Verify: read back and compare, rather than trusting setItem. A quota
  // overflow throws, but a truncated value would not.
  const mismatched = keys.filter((k) => localStorage.getItem(k) !== data[k]);
  if (mismatched.length > 0) {
    console.error("[paste] MISMATCH after write:", mismatched);
  } else {
    console.log("[paste] Verified — every key matches the dump byte-for-byte.");
  }
})();
