import { useLayoutEffect, useRef, useState } from "react";
import type { InvoiceData, Template } from "../../lib/template-types";
import { PAGE_W, PAGE_H } from "../../lib/template-types";
import { ElementContent } from "./ElementContent";

// Renders the bound template page. When `fit` is true it scales to the
// container width (on-screen preview); otherwise it renders 1:1 (for print).
export function Preview({
  template,
  data,
  fit = true,
  className = "",
}: {
  template: Template;
  data: InvoiceData;
  fit?: boolean;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    if (!fit) return;
    const node = wrapRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, node.clientWidth / PAGE_W));
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [fit]);

  const s = fit ? scale : 1;
  const sorted = [...template.elements].sort((a, b) => a.z - b.z);

  return (
    <div ref={wrapRef} className={`w-full ${className}`}>
      <div
        className="relative bg-white mx-auto overflow-hidden"
        style={{ width: PAGE_W * s, height: PAGE_H * s }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${s})` }}
        >
          {sorted.map((el) => (
            <div
              key={el.id}
              className="absolute overflow-hidden"
              style={{ left: el.x, top: el.y, width: el.w, height: el.h, zIndex: el.z }}
            >
              <ElementContent el={el} template={template} data={data} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
