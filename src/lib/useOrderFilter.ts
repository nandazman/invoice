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
  // Optional because PurchaseItem has no buyer — Beli Stok records what we
  // bought, and its counterpart is a supplier, not a pembeli.
  buyerId?: string;
};

export interface FilterValues {
  exact: string; // single ISO date; when set, from/to are ignored
  from: string;
  to: string;
  produk: string; // product-name substring search
  status: StatusFilter;
  tipe: string; // Product.tipe; "" = no constraint
  pembeli: string; // Buyer id; "" = no constraint
}

const EMPTY: FilterValues = {
  exact: "",
  from: "",
  to: "",
  produk: "",
  status: "semua",
  tipe: "",
  pembeli: "",
};

export interface OrderFilter<T extends FilterableRow> {
  values: FilterValues;
  /**
   * `values` with the product search replaced by its deferred copy — i.e. the
   * filter that actually produced `filtered`. A page applying this filter to a
   * SECOND list must use these, not `values`: `values` is a keystroke ahead, so
   * the two lists would briefly disagree, and the extra pass would run on the
   * render the deferral exists to keep cheap.
   */
  applied: FilterValues;
  /** Merge a partial update, e.g. set({ produk: e.target.value }). */
  set: (patch: Partial<FilterValues>) => void;
  /** Apply a date preset: writes from/to and clears exact. */
  preset: (key: PresetKey) => void;
  filtered: T[];
  clear: () => void;
  hasFilter: boolean;
}

// Neither OrderItem nor PurchaseItem stores `tipe`, only productId. Resolving it
// needs this index; built once by the caller because the predicate runs per row
// per keystroke, and products.find() in there is O(rows × products).
export function buildTipeIndex(products: Product[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of products) map.set(p.id, p.tipe);
  return map;
}

// The filter predicate, applied to a list. Exported because a page can need the
// SAME filter values applied to a second list the hook does not own — Laporan
// runs its purchases through here so pembelian covers the period the user picked
// for everything else, rather than the hook's state being copied by hand.
export function filterRows<T extends FilterableRow>(
  rows: T[],
  values: FilterValues,
  tipeById: Map<string, string>,
): T[] {
  const { exact, from, to, status, tipe, pembeli } = values;
  const q = values.produk.trim().toLowerCase();
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
    // Same shape as the status filter above: rows with no buyerId field
    // (purchases) pass through untouched, so callers need no source-specific
    // guard. An order with buyerId "" (unassigned) is a real value and does
    // drop out once a buyer is selected.
    if (pembeli && o.buyerId !== undefined && o.buyerId !== pembeli) return false;
    return true;
  });
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

  const tipeById = useMemo(() => buildTipeIndex(products), [products]);

  // The product search filters every row on every keystroke; deferring it keeps
  // typing responsive as the list grows.
  const deferredProduk = useDeferredValue(values.produk);

  const { exact, from, to, status, tipe, pembeli } = values;

  // Depends on the individual fields, not on `values` — `set()` returns a new
  // object every keystroke, so keying the memo on it would re-filter once with
  // the stale deferred query and again when the deferral lands, undoing the
  // deferral's whole purpose.
  const applied = useMemo(
    () => ({ exact, from, to, status, tipe, pembeli, produk: deferredProduk }),
    [exact, from, to, status, tipe, pembeli, deferredProduk],
  );

  const filtered = useMemo(
    () => filterRows(rows, applied, tipeById),
    [rows, applied, tipeById],
  );

  const hasFilter = Boolean(
    exact ||
      from ||
      to ||
      values.produk ||
      tipe ||
      pembeli ||
      status !== "semua",
  );

  return { values, applied, set, preset, filtered, clear, hasFilter };
}
