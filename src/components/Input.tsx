import type { InputHTMLAttributes } from "react";
import { useFieldError } from "./Field";

// Border/ring colours are split out of the base class because Tailwind decides
// the order of same-property utilities itself — a conditional append of
// `border-red-300` next to `border-slate-200` is not guaranteed to win.
const base =
  "w-full px-2.5 py-2 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400";
const normal = "border-slate-200 focus:ring-blue-100 focus:border-blue-500";
const invalidCls = "border-red-300 focus:ring-red-100 focus:border-red-500";

export function Input({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  const field = useFieldError();
  const invalid = field?.invalid ?? false;
  return (
    <input
      className={`${base} ${invalid ? invalidCls : normal} ${className}`}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? field?.id : undefined}
      {...rest}
    />
  );
}
