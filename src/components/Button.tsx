import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "primary" | "danger" | "ghost";
type Size = "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-1 font-semibold rounded-lg border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  default: "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
  primary: "border-blue-600 bg-blue-600 text-white hover:bg-blue-700",
  danger: "border-red-200 bg-white text-red-600 hover:bg-red-50",
  ghost: "border-transparent bg-transparent text-slate-400 hover:text-slate-700",
};

const sizes: Record<Size, string> = {
  md: "px-3.5 py-2 text-sm",
  sm: "px-2.5 py-1 text-sm",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "default",
  size = "md",
  className = "",
  ...rest
}: Props) {
  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}
