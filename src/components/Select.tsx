import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

const cls =
  "w-full px-2.5 py-1.5 text-base md:text-sm border border-line-strong rounded-lg bg-surface text-left flex items-center justify-between gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-focus focus:border-brand-edge disabled:bg-surface-sunken disabled:text-ghost disabled:cursor-not-allowed";

interface Opt {
  value: string;
  label: string;
  disabled: boolean;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

// Reads the <option> children the way a native <select> would, so every caller
// keeps writing plain <option>s (arrays, fragments and conditionals included).
function readOptions(children: ReactNode, out: Opt[] = []): Opt[] {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ children?: ReactNode; value?: unknown; disabled?: boolean }>(child)) return;
    if (child.type === Fragment) {
      readOptions(child.props.children, out);
    } else if (child.type === "option") {
      const label = textOf(child.props.children);
      out.push({
        value: child.props.value == null ? label : String(child.props.value),
        label,
        disabled: !!child.props.disabled,
      });
    }
  });
  return out;
}

const POPUP_MAX = 260;

// A drop-in for <select>: same props, same <option> children, same
// `onChange(e)` with `e.target.value` — but the list opens with a search box,
// like the buyer picker. The list is portalled and fixed-positioned so a dialog
// with `overflow-auto` cannot clip it.
export function Select({
  className = "",
  children,
  value,
  onChange,
  disabled,
  id,
  title,
  "aria-label": ariaLabel,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = readOptions(children);
  const current = String(value ?? "");
  const selected = options.find((o) => o.value === current) ?? options[0];

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const needle = query.trim().toLowerCase();
  const filtered = options.filter((o) => o.label.toLowerCase().includes(needle));

  function close() {
    setOpen(false);
    setQuery("");
  }

  function openList() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const flip = below < POPUP_MAX && r.top > below;
    setPos({
      left: r.left,
      width: Math.max(r.width, 160),
      ...(flip
        ? { bottom: window.innerHeight - r.top + 4 }
        : { top: r.bottom + 4 }),
    });
    setActive(Math.max(0, options.findIndex((o) => o.value === current)));
    setOpen(true);
  }

  function pick(o: Opt) {
    if (o.disabled) return;
    const target = { value: o.value, name: "" };
    onChange?.({
      target,
      currentTarget: target,
    } as unknown as ChangeEvent<HTMLSelectElement>);
    close();
    btnRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    }
    // The popup is fixed to where the button was; scrolling or resizing the
    // page behind it would leave it floating, so close instead of chasing.
    function onMove(e: Event) {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      close();
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const inline = /\bw-auto\b/.test(className);
  const btnClass = `${cls} ${className.replace(/\bw-auto\b/, "").trim()}`;

  const popup =
    open && pos ? (
      <div
        ref={popRef}
        className="fixed z-[70] bg-surface border border-line rounded-lg shadow-[0_8px_24px_rgb(20_32_31/0.12)] p-1"
        style={{
          left: Math.min(pos.left, window.innerWidth - pos.width - 8),
          width: pos.width,
          top: pos.top,
          bottom: pos.bottom,
        }}
      >
        <input
          autoFocus={options.length > 6}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (filtered[active]) pick(filtered[active]);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Escape") {
              // Only the list closes, not the dialog it sits in.
              e.stopPropagation();
              close();
              btnRef.current?.focus();
            }
          }}
          placeholder="Cari…"
          aria-label="Cari pilihan"
          className="w-full px-2 py-1.5 text-base md:text-sm border border-line rounded-md mb-1 focus:outline-none focus:ring-2 focus:ring-brand-focus focus:border-brand-edge"
        />
        <div className="max-h-48 overflow-auto" role="listbox">
          {filtered.map((o, i) => (
            <button
              type="button"
              key={o.value + i}
              role="option"
              aria-selected={o.value === current}
              disabled={o.disabled}
              onClick={() => pick(o)}
              onMouseEnter={() => setActive(i)}
              className={`w-full text-left px-2 py-1.5 text-sm rounded-md disabled:text-ghost disabled:cursor-not-allowed ${
                i === active ? "bg-surface-hover" : ""
              } ${o.value === current ? "font-semibold text-brand" : "text-body"}`}
            >
              {o.label || "—"}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-faint">Tidak ada yang cocok.</div>
          )}
        </div>
      </div>
    ) : null;

  return (
    <div className={`relative ${inline ? "inline-block" : "block"}`}>
      <button
        ref={btnRef}
        type="button"
        id={id}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className={btnClass}
        onClick={() => (open ? close() : openList())}
      >
        <span className={`truncate ${current === "" ? "text-faint" : ""}`}>
          {selected?.label || "—"}
        </span>
        <span className="text-ghost shrink-0">▾</span>
      </button>
      {popup && typeof document !== "undefined" && document.body
        ? createPortal(popup, document.body)
        : popup}
    </div>
  );
}
