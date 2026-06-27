import { useEffect, useRef, useState } from "react";
import type { Visibility } from "../lib/columns";

const btnCls =
  "inline-flex items-center gap-1 px-3.5 py-2 text-sm font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors";

// Dropdown checklist to show/hide table columns one by one.
// Table-agnostic: it just reports visibility state and toggles by column id.
export function ColumnToggle({
  columns,
  visible,
  onToggle,
}: {
  columns: { id: string; label: string }[];
  visible: Visibility;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const shown = columns.filter((c) => visible[c.id] !== false).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={btnCls}
        onClick={() => setOpen((o) => !o)}
        title="Tampilkan / sembunyikan kolom"
      >
        <span>Kolom</span>
        <span className="text-slate-400">
          ({shown}/{columns.length}) ▾
        </span>
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg p-1">
          <div className="max-h-72 overflow-auto">
            {columns.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-slate-100 cursor-pointer text-slate-700"
              >
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={visible[c.id] !== false}
                  onChange={() => onToggle(c.id)}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
