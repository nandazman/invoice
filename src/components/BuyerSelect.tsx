import { useEffect, useRef, useState } from "react";
import type { Buyer } from "../lib/types";

const fieldCls =
  "w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg bg-white text-left flex items-center justify-between cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500";

// A deliberate copy of TypeSelect, not a shared `EntitySelect`. Generalising the
// two would cost a `labelSingular` prop, an `itemKey` for `string` vs `Buyer`,
// and a render prop for the row (buyers show a phone number, types do not) —
// three props and a render prop to serve two callers, after which every change
// to either picker has to be justified against the other. If a third picker
// ever appears, extract then, with three real call sites to design against.
export function BuyerSelect({
  value,
  options,
  onChange,
  onCreate,
}: {
  value: string; // a Buyer id, "" = unassigned
  options: Buyer[];
  onChange: (id: string) => void;
  onCreate: (nama: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const q = query.trim();
  const needle = q.toLowerCase();
  // Search matches telepon too: two buyers named "Bu Ani" are exactly why the
  // phone number is stored, so it has to be searchable, not just displayed.
  const filtered = options.filter(
    (b) =>
      b.nama.toLowerCase().includes(needle) ||
      b.telepon.toLowerCase().includes(needle),
  );
  const canCreate =
    q !== "" && !options.some((b) => b.nama.toLowerCase() === needle);

  const selected = options.find((b) => b.id === value) ?? null;

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }
  function create(nama: string) {
    // The caller creates the row and reports the id back through `onChange`,
    // the same handshake ProductDialog has with addType.
    onCreate(nama);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={fieldCls}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected ? "" : "text-slate-400"}>
          {selected ? selected.nama : "— pilih pembeli —"}
        </span>
        <span className="text-slate-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg p-1">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (canCreate) create(q);
                else if (filtered.length) pick(filtered[0].id);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Cari atau buat pembeli…"
            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md mb-1 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
          />
          <div className="max-h-48 overflow-auto">
            {/* No "— tanpa pembeli —" row: pembeli is mandatory, so there is no
                UI path that unsets one. `setOrderBuyer` still accepts "" — the
                backfill and legacy rows need it — but nothing here reaches it. */}
            {filtered.map((b) => (
              <button
                type="button"
                key={b.id}
                onClick={() => pick(b.id)}
                className={`w-full text-left px-2 py-1.5 text-sm rounded-md hover:bg-slate-100 ${
                  b.id === value
                    ? "font-semibold text-blue-600"
                    : "text-slate-700"
                }`}
              >
                <span className="block">{b.nama}</span>
                {b.telepon && (
                  <span className="block text-xs text-slate-400">
                    {b.telepon}
                  </span>
                )}
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                onClick={() => create(q)}
                className="w-full text-left px-2 py-1.5 text-sm rounded-md hover:bg-blue-50 text-blue-600 font-semibold"
              >
                + Buat pembeli “{q}”
              </button>
            )}
            {filtered.length === 0 && !canCreate && (
              <div className="px-2 py-1.5 text-sm text-slate-400">
                Ketik untuk membuat pembeli baru.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
