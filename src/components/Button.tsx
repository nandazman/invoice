import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "md" | "sm";
}

const base =
  "inline-flex items-center justify-center gap-1 font-semibold rounded-lg border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

function sizeClass(size: "md" | "sm") {
  return size === "sm" ? "px-2.5 py-1 text-sm" : "px-3.5 py-2 text-sm";
}

export function Button({ size = "md", className = "", ...rest }: Props) {
  return (
    <button
      className={`${base} ${sizeClass(size)} border-slate-200 bg-white text-slate-700 hover:bg-slate-100 ${className}`}
      {...rest}
    />
  );
}

export function PrimaryButton({ size = "md", className = "", ...rest }: Props) {
  return (
    <button
      className={`${base} ${sizeClass(size)} border-blue-600 bg-blue-600 text-white hover:bg-blue-700 ${className}`}
      {...rest}
    />
  );
}

export function DangerButton({ size = "md", className = "", ...rest }: Props) {
  return (
    <button
      className={`${base} ${sizeClass(size)} border-red-200 bg-white text-red-600 hover:bg-red-50 ${className}`}
      {...rest}
    />
  );
}

export function GhostButton({ size = "md", className = "", ...rest }: Props) {
  return (
    <button
      className={`${base} ${sizeClass(size)} border-transparent bg-transparent text-slate-400 hover:text-slate-700 ${className}`}
      {...rest}
    />
  );
}
