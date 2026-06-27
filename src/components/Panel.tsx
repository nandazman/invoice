import type { ReactNode } from "react";

export function Panel({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl p-4 mb-4 ${className}`}
    >
      {children}
    </div>
  );
}
