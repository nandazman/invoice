import { useCallback, useState } from "react";

export type Visibility = Record<string, boolean>;

// ---------- Attribution columns ----------

// "Who made this row" / "who touched it last", server-stamped from Cloudflare
// Access and merged onto the row on pull (lib/sync/tables.ts). One definition
// for every table on every page, so the two columns are labelled identically
// wherever they appear.
//
// HIDDEN BY DEFAULT, everywhere. On a single-user install both columns are the
// same address on every row, and on the GitHub Pages copy — which has no Worker
// — they are empty on every row. Neither is worth the width until asked for.
export const CREATED_BY_COLUMN = { id: "createdBy", label: "Dibuat oleh" };
export const UPDATED_BY_COLUMN = { id: "updatedBy", label: "Diubah oleh" };
export const ATTRIBUTION_COLUMNS = [CREATED_BY_COLUMN, UPDATED_BY_COLUMN];
export const ATTRIBUTION_COLUMN_IDS = ATTRIBUTION_COLUMNS.map((c) => c.id);

// Persisted per-column show/hide state, keyed in localStorage.
// `defaults` lists every column id with its initial visibility; unknown keys
// from an older saved state are ignored, new columns fall back to `defaults`.
export function usePersistentVisibility(
  storageKey: string,
  defaults: Visibility,
): [Visibility, (id: string) => void, () => void] {
  const [visible, setVisible] = useState<Visibility>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const saved = raw ? (JSON.parse(raw) as Visibility) : {};
      const merged: Visibility = {};
      for (const id of Object.keys(defaults))
        merged[id] = saved[id] ?? defaults[id];
      return merged;
    } catch {
      return { ...defaults };
    }
  });

  const persist = useCallback(
    (next: Visibility) => {
      setVisible(next);
      localStorage.setItem(storageKey, JSON.stringify(next));
    },
    [storageKey],
  );

  const toggle = useCallback(
    (id: string) => persist({ ...visible, [id]: !visible[id] }),
    [visible, persist],
  );

  const reset = useCallback(() => persist({ ...defaults }), [defaults, persist]);

  return [visible, toggle, reset];
}

// The same preference, for the hand-rolled tables that have no per-column
// dropdown to hang the two attribution columns off. A dropdown reading
// "Kolom (0/2)" would be a worse control than a checkbox, so those pages get a
// checkbox — but it persists through the same localStorage mechanism as
// `usePersistentVisibility`, rather than a second one.
export function usePersistentAttribution(
  storageKey: string,
): [boolean, (next: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });

  const set = useCallback(
    (next: boolean) => {
      setOn(next);
      try {
        localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // Private-mode browsers throw on write. The toggle still works for this
        // session; a lost preference is not worth failing a click over.
      }
    },
    [storageKey],
  );

  return [on, set];
}
