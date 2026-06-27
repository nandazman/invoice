import { useEffect, useRef, useState } from "react";

const fieldCls =
  "w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg bg-white text-left flex items-center justify-between cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500";

// GitHub-style type picker: open the dropdown to pick an existing type,
// or type a new name and click "Buat tipe" to create it.
export function TypeSelect({
  value,
  options,
  onChange,
  onCreate,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onCreate: (value: string) => void;
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
  const filtered = options.filter((t) =>
    t.toLowerCase().includes(q.toLowerCase()),
  );
  const canCreate =
    q !== "" && !options.some((t) => t.toLowerCase() === q.toLowerCase());

  function pick(t: string) {
    onChange(t);
    setOpen(false);
    setQuery("");
  }
  function create(t: string) {
    onCreate(t);
    pick(t);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={fieldCls}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{value || "— pilih tipe —"}</span>
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
                else if (filtered.length) pick(filtered[0]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Cari atau buat tipe…"
            className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-md mb-1 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
          />
          <div className="max-h-48 overflow-auto">
            {filtered.map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => pick(t)}
                className={`w-full text-left px-2 py-1.5 text-sm rounded-md hover:bg-slate-100 ${
                  t === value ? "font-semibold text-blue-600" : "text-slate-700"
                }`}
              >
                {t}
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                onClick={() => create(q)}
                className="w-full text-left px-2 py-1.5 text-sm rounded-md hover:bg-blue-50 text-blue-600 font-semibold"
              >
                + Buat tipe “{q}”
              </button>
            )}
            {filtered.length === 0 && !canCreate && (
              <div className="px-2 py-1.5 text-sm text-slate-400">
                Ketik untuk membuat tipe baru.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
