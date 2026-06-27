import { PAGE_W, PAGE_H } from "./template-types";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// A guide line to draw on the canvas while snapping.
export interface Guide {
  axis: "v" | "h"; // vertical line at x, or horizontal line at y
  pos: number; // design-px coordinate
}

const THRESHOLD = 6; // design px

// Snap targets along each axis: page edges + center, plus every other box's
// left/center/right (vertical) and top/middle/bottom (horizontal).
function targets(others: Box[]) {
  const vert = [0, PAGE_W / 2, PAGE_W];
  const horiz = [0, PAGE_H / 2, PAGE_H];
  for (const b of others) {
    vert.push(b.x, b.x + b.w / 2, b.x + b.w);
    horiz.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { vert, horiz };
}

// Snap a moving box. Returns adjusted x/y and the guides to render.
export function snapMove(box: Box, others: Box[]): { x: number; y: number; guides: Guide[] } {
  const { vert, horiz } = targets(others);
  const guides: Guide[] = [];
  let { x, y } = box;

  // candidate edges on the box: left/center/right, top/middle/bottom
  const vEdges = [
    { val: box.x, off: 0 },
    { val: box.x + box.w / 2, off: box.w / 2 },
    { val: box.x + box.w, off: box.w },
  ];
  const hEdges = [
    { val: box.y, off: 0 },
    { val: box.y + box.h / 2, off: box.h / 2 },
    { val: box.y + box.h, off: box.h },
  ];

  let bestV: { dist: number; x: number; pos: number } | null = null;
  for (const e of vEdges) {
    for (const t of vert) {
      const d = Math.abs(e.val - t);
      if (d <= THRESHOLD && (!bestV || d < bestV.dist)) {
        bestV = { dist: d, x: t - e.off, pos: t };
      }
    }
  }
  if (bestV) {
    x = bestV.x;
    guides.push({ axis: "v", pos: bestV.pos });
  }

  let bestH: { dist: number; y: number; pos: number } | null = null;
  for (const e of hEdges) {
    for (const t of horiz) {
      const d = Math.abs(e.val - t);
      if (d <= THRESHOLD && (!bestH || d < bestH.dist)) {
        bestH = { dist: d, y: t - e.off, pos: t };
      }
    }
  }
  if (bestH) {
    y = bestH.y;
    guides.push({ axis: "h", pos: bestH.pos });
  }

  return { x, y, guides };
}
