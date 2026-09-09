import type { InputHTMLAttributes } from "react";
import { useFieldError } from "./Field";

// Border/ring colours are split out of the base class because Tailwind decides
// the order of same-property utilities itself — a conditional append of
// `border-danger-line-strong` next to `border-line` is not guaranteed to win.
const base =
  "w-full px-2.5 py-2 text-sm border rounded-lg bg-surface focus:outline-none focus:ring-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:bg-surface-sunken disabled:text-faint";
const normal = "border-line focus:ring-brand-focus focus:border-brand-edge";
const invalidCls = "border-danger-line-strong focus:ring-danger-focus-soft focus:border-danger-edge";

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
