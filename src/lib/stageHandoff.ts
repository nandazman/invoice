import { useEffect } from "react";

// Order ids ticked on Pesanan, waiting for Ekspor Excel / Buat Invoice to pick
// them up. In memory on purpose: a URL would have to carry hundreds of ids, and
// a stale handoff surviving a reload would stage rows nobody asked for.
let pending: string[] | null = null;

export function handOffToStaging(ids: Iterable<string>) {
  pending = [...ids];
}

// Calls `apply` once with the handed-off rows. `rows` may still be empty on the
// first render (the store loads async), so the handoff is only consumed once
// there is something to match against.
export function useStagedHandoff<T extends { id: string }>(
  rows: T[],
  apply: (picked: T[]) => void,
) {
  useEffect(() => {
    if (!pending || rows.length === 0) return;
    const ids = new Set(pending);
    pending = null;
    apply(rows.filter((r) => ids.has(r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
}
