import type { ReactNode } from "react";

export function Panel({
  className = "",
  flush = false,
  children,
}: {
  className?: string;
  // Below `md`, drop the side borders, the corners, and the padding. A panel
  // holding a table costs 32 of a 390px phone's horizontal pixels on padding
  // alone, and the card framing makes the table read as a dashboard tile
  // rather than as the page. Above `md` the width is free, so nothing changes.
  flush?: boolean;
  children: ReactNode;
}) {
  const shape = flush
    ? "border-y border-x-0 md:border-x md:rounded-xl p-0 md:p-4"
    : "border rounded-xl p-4";
  return (
    <div className={`bg-surface border-line mb-4 ${shape} ${className}`}>
      {children}
    </div>
  );
}
