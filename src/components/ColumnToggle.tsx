import { useEffect, useRef, useState } from "react";
import type { Visibility } from "../lib/columns";

const btnCls =
  "inline-flex items-center gap-1 px-3.5 py-2 min-h-11 md:min-h-0 text-sm font-semibold rounded-lg border border-line bg-surface text-body hover:bg-surface-hover cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

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
  const btnRef = useRef<HTMLButtonElement>(null);

  // The panel is positioned in viewport coordinates, not against the trigger's
  // offset parent. Two reasons, and the second is the one that actually forces
  // it: an `absolute right-0` panel runs off the left edge at 320px, AND the
  // toolbar this button now lives in scrolls horizontally below `md` — an
  // absolutely positioned child of an `overflow-x-auto` box gets clipped by it,
  // so no amount of left/right flipping would have kept the panel visible.
  const [pos, setPos] = useState({ top: 0, left: 0, width: 224 });

  // Recomputed rather than remembered: the trigger moves under the panel when
  // the page scrolls or the window resizes, and a fixed panel does not follow
  // on its own.
  useEffect(() => {
    if (!open) return;
    function place() {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const margin = 8;
      // 224px is `w-56`; anything narrower is a viewport too small to hold it.
      const width = Math.min(224, window.innerWidth - margin * 2);
      // Right-aligned to the trigger where there is room, then clamped so
      // neither edge can leave the viewport at any width from 320px up.
      const left = Math.min(
        Math.max(r.right - width, margin),
        window.innerWidth - width - margin,
      );
      setPos({ top: r.bottom + 4, left, width });
    }
    place();
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("resize", place);
    // `true` so the toolbar's own horizontal scroll counts, not just the page's.
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function toggleOpen() {
    setOpen((o) => !o);
  }

  const shown = columns.filter((c) => visible[c.id] !== false).length;

  return (
    <div className="relative" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className={btnCls}
        onClick={toggleOpen}
        title="Tampilkan / sembunyikan kolom"
      >
        <span>Kolom</span>
        <span className="text-faint">
          ({shown}/{columns.length}) ▾
        </span>
      </button>

      {open && (
        <div
          className="fixed z-30 bg-surface border border-line rounded-lg shadow-lg p-1"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="max-h-72 overflow-auto">
            {columns.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 px-2 py-1.5 min-h-11 md:min-h-0 text-sm rounded-md hover:bg-surface-hover cursor-pointer text-body focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand"
              >
                <input
                  type="checkbox"
                  className="accent-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
