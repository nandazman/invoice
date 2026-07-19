import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { presetRange, type PresetKey } from "./format";
import type { LineItem, OrderStatus, Product } from "./types";

// "semua" = no status constraint. Rows without a `status` field (purchases)
// are never excluded by the status filter — see the predicate below.
export type StatusFilter = "semua" | OrderStatus;

// The shape the filter needs from a row: the export-facing LineItem fields,
// plus an id, plus the two optional links it filters on. Both OrderItem and
// PurchaseItem satisfy this structurally.
export type FilterableRow = LineItem & {
  id: string;
  productId?: string;
  status?: OrderStatus;
};

export interface FilterValues {
  exact: string; // single ISO date; when set, from/to are ignored
  from: string;
  to: string;
  produk: string; // product-name substring search
  status: StatusFilter;
  tipe: string; // Product.tipe; "" = no constraint
}

const EMPTY: FilterValues = {
  exact: "",
  from: "",
  to: "",
  produk: "",
  status: "semua",
  tipe: "",
};

export interface OrderFilter<T extends FilterableRow> {
  values: FilterValues;
  /** Merge a partial update, e.g. set({ produk: e.target.value }). */
  set: (patch: Partial<FilterValues>) => void;
  /** Apply a date preset: writes from/to and clears exact. */
  preset: (key: PresetKey) => void;
  filtered: T[];
  clear: () => void;
  hasFilter: boolean;
}

export function useOrderFilter<T extends FilterableRow>(
  rows: T[],
  products: Product[],
): OrderFilter<T> {
  const [values, setValues] = useState<FilterValues>(EMPTY);

  const set = useCallback(
    (patch: Partial<FilterValues>) => setValues((v) => ({ ...v, ...patch })),
    [],
  );

  const clear = useCallback(() => setValues(EMPTY), []);

  // Presets fill from/to, so `exact` must go: the UI disables from/to while
  // exact is set, which would make the preset a silent no-op.
  const preset = useCallback((key: PresetKey) => {
    const [from, to] = presetRange(key);
    setValues((v) => ({ ...v, exact: "", from, to }));
  }, []);

  // Neither OrderItem nor PurchaseItem stores `tipe`, only productId. Resolve
  // it through a Map built once per products change — the predicate runs per
  // row per keystroke, so products.find() in there is O(rows × products).
  const tipeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) map.set(p.id, p.tipe);
    return map;
  }, [products]);

  // The product search filters every row on every keystroke; deferring it keeps
  // typing responsive as the list grows.
  const deferredProduk = useDeferredValue(values.produk);
  const { exact, from, to, status, tipe } = values;

  const filtered = useMemo(() => {
    const q = deferredProduk.trim().toLowerCase();
    return rows.filter((o) => {
      if (exact) {
        if (o.tanggal !== exact) return false;
      } else {
        if (from && o.tanggal < from) return false;
        if (to && o.tanggal > to) return false;
      }
      if (q && !o.namaProduk.toLowerCase().includes(q)) return false;
      // Rows with no status field (purchases) are unaffected by this filter,
      // so callers need no source-specific guard.
      if (status !== "semua" && o.status !== undefined && o.status !== status)
        return false;
      // productId "" (unmatched legacy rows) resolves to no tipe and drops out
      // whenever a type is selected. Intentional, and visible in the count.
      if (tipe && tipeById.get(o.productId ?? "") !== tipe) return false;
      return true;
    });
  }, [rows, exact, from, to, deferredProduk, status, tipe, tipeById]);

  const hasFilter = Boolean(
    exact || from || to || values.produk || tipe || status !== "semua",
  );

  return { values, set, preset, filtered, clear, hasFilter };
}
