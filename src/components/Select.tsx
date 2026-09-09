import type { SelectHTMLAttributes } from "react";

const cls =
  "w-full px-2.5 py-2 text-sm border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-brand-focus focus:border-brand-edge disabled:bg-surface-sunken disabled:text-ghost";

export function Select({
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${cls} ${className}`} {...rest}>
      {children}
    </select>
  );
}
