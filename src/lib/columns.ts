import { useCallback, useState } from "react";

export type Visibility = Record<string, boolean>;

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
