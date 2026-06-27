import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Template, TemplateElement } from "../../lib/template-types";
import { PAGE_W, PAGE_H } from "../../lib/template-types";
import { snapMove, type Box, type Guide } from "../../lib/snap";
import { ElementContent } from "./ElementContent";

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface DragState {
  mode: "move" | "resize";
  dir?: ResizeDir;
  id: string;
  startX: number; // client px
  startY: number;
  box: Box; // starting box in design px
}

const HANDLES: { dir: ResizeDir; cls: string }[] = [
  { dir: "nw", cls: "left-0 top-0 -ml-1 -mt-1 cursor-nwse-resize" },
  { dir: "n", cls: "left-1/2 top-0 -ml-1 -mt-1 cursor-ns-resize" },
  { dir: "ne", cls: "right-0 top-0 -mr-1 -mt-1 cursor-nesw-resize" },
  { dir: "e", cls: "right-0 top-1/2 -mr-1 -mt-1 cursor-ew-resize" },
  { dir: "se", cls: "right-0 bottom-0 -mr-1 -mb-1 cursor-nwse-resize" },
  { dir: "s", cls: "left-1/2 bottom-0 -ml-1 -mb-1 cursor-ns-resize" },
  { dir: "sw", cls: "left-0 bottom-0 -ml-1 -mb-1 cursor-nesw-resize" },
  { dir: "w", cls: "left-0 top-1/2 -ml-1 -mt-1 cursor-ew-resize" },
];

const MIN = 16;

function resizeBox(
  b: Box,
  dir: ResizeDir,
  dx: number,
  dy: number,
  keepAspect: boolean,
): Box {
  const right = b.x + b.w;
  const bottom = b.y + b.h;
  let w = b.w;
  let h = b.h;
  if (dir.includes("e")) w = Math.max(MIN, b.w + dx);
  if (dir.includes("w")) w = Math.max(MIN, b.w - dx);
  if (dir.includes("s")) h = Math.max(MIN, b.h + dy);
  if (dir.includes("n")) h = Math.max(MIN, b.h - dy);

  if (keepAspect) {
    const aspect = b.w / b.h;
    const horiz = dir.includes("e") || dir.includes("w");
    const vert = dir.includes("n") || dir.includes("s");
    // Edge-only handles drive the matching axis; corners drive by width.
    if (vert && !horiz) w = h * aspect;
    else h = w / aspect;
    w = Math.max(MIN, w);
    h = Math.max(MIN, h);
  }

  // West/north handles keep the opposite edge anchored.
  const x = dir.includes("w") ? right - w : b.x;
  const y = dir.includes("n") ? bottom - h : b.y;
  return { x, y, w, h };
}

export function Canvas({
  template,
  selectedId,
  onSelect,
  onChange,
}: {
  template: Template;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, box: Partial<Box>) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [guides, setGuides] = useState<Guide[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const scaleRef = useRef(1);
  const elsRef = useRef<TemplateElement[]>(template.elements);
  elsRef.current = template.elements;
  scaleRef.current = scale;

  // Fit the page width to the available container width.
  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => {
      const w = node.clientWidth;
      setScale(Math.min(1, w / PAGE_W));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const s = scaleRef.current;
      const dx = (e.clientX - d.startX) / s;
      const dy = (e.clientY - d.startY) / s;
      const others = elsRef.current.filter((el) => el.id !== d.id).map((el) => ({
        x: el.x,
        y: el.y,
        w: el.w,
        h: el.h,
      }));

      if (d.mode === "move") {
        const moved = { ...d.box, x: d.box.x + dx, y: d.box.y + dy };
        const snapped = snapMove(moved, others);
        setGuides(snapped.guides);
        onChange(d.id, { x: Math.round(snapped.x), y: Math.round(snapped.y) });
      } else {
        const b = resizeBox(d.box, d.dir!, dx, dy, e.shiftKey || e.ctrlKey);
        setGuides([]);
        onChange(d.id, {
          x: Math.round(b.x),
          y: Math.round(b.y),
          w: Math.round(b.w),
          h: Math.round(b.h),
        });
      }
    }
    function onUp() {
      dragRef.current = null;
      setGuides([]);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onChange]);

  function startMove(e: ReactPointerEvent, el: TemplateElement) {
    e.stopPropagation();
    onSelect(el.id);
    dragRef.current = {
      mode: "move",
      id: el.id,
      startX: e.clientX,
      startY: e.clientY,
      box: { x: el.x, y: el.y, w: el.w, h: el.h },
    };
  }

  function startResize(e: ReactPointerEvent, el: TemplateElement, dir: ResizeDir) {
    e.stopPropagation();
    onSelect(el.id);
    dragRef.current = {
      mode: "resize",
      dir,
      id: el.id,
      startX: e.clientX,
      startY: e.clientY,
      box: { x: el.x, y: el.y, w: el.w, h: el.h },
    };
  }

  const sorted = [...template.elements].sort((a, b) => a.z - b.z);

  return (
    <div ref={wrapRef} className="w-full">
      <div
        className="relative bg-white shadow-md mx-auto overflow-hidden"
        style={{ width: PAGE_W * scale, height: PAGE_H * scale }}
        onPointerDown={() => onSelect(null)}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})` }}
        >
          {sorted.map((el) => {
            const selected = el.id === selectedId;
            return (
              <div
                key={el.id}
                onPointerDown={(e) => startMove(e, el)}
                className="absolute select-none"
                style={{
                  left: el.x,
                  top: el.y,
                  width: el.w,
                  height: el.h,
                  zIndex: el.z,
                  outline: selected ? "1.5px solid #2563eb" : "1px dashed transparent",
                  cursor: "move",
                }}
                onMouseEnter={(e) => {
                  if (!selected) e.currentTarget.style.outline = "1px dashed #93c5fd";
                }}
                onMouseLeave={(e) => {
                  if (!selected) e.currentTarget.style.outline = "1px dashed transparent";
                }}
              >
                <div className="w-full h-full overflow-hidden pointer-events-none">
                  <ElementContent el={el} template={template} data={null} />
                </div>

                {selected &&
                  HANDLES.map((h) => (
                    <div
                      key={h.dir}
                      onPointerDown={(e) => startResize(e, el, h.dir)}
                      className={`absolute w-2 h-2 bg-white border border-blue-600 rounded-sm ${h.cls}`}
                      style={{ zIndex: 1000 }}
                    />
                  ))}
              </div>
            );
          })}

          {/* snap guides */}
          {guides.map((g, i) =>
            g.axis === "v" ? (
              <div
                key={i}
                className="absolute top-0 bg-pink-500"
                style={{ left: g.pos, width: 1, height: PAGE_H, zIndex: 2000 }}
              />
            ) : (
              <div
                key={i}
                className="absolute left-0 bg-pink-500"
                style={{ top: g.pos, height: 1, width: PAGE_W, zIndex: 2000 }}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
