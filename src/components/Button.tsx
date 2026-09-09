import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "md" | "sm";
}

const base =
  "inline-flex items-center justify-center gap-1 font-semibold rounded-lg border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

// Padding is taller below `md` so every button clears the ~44px touch target,
// then drops back to today's tighter desktop padding at `md` and up.
//
// Padding alone did not get there. It was sized against a text label, whose
// line-height did half the work; an icon-only button holds a 1em SVG instead
// and came out 36px square. `min-h-11`/`min-w-11` (44px) states the target
// outright rather than hoping the content adds up to it, and is released at
// `md` where a pointer, not a fingertip, is doing the clicking.
function sizeClass(size: "md" | "sm") {
  const touch = "min-h-11 min-w-11 md:min-h-0 md:min-w-0";
  return size === "sm"
    ? `px-2.5 py-2.5 md:py-1 text-sm ${touch}`
    : `px-3.5 py-3 md:py-2 text-sm ${touch}`;
}

export function Button({ size = "md", className = "", ...rest }: Props) {
  return (
    <button
      className={`${base} ${sizeClass(size)} border-line bg-surface text-body hover:bg-surface-hover ${className}`}
      {...rest}
    />
  );
}

export function PrimaryButton({ size = "md", className = "", ...rest }: Props) {
  return (
    <button
      className={`${base} ${sizeClass(size)} border-brand bg-brand text-white hover:bg-brand-hover ${className}`}
      {...rest}
    />
  );
}

export function DangerButton({ size = "md", className = "", ...rest }: Props) {
  return (
    <button
      className={`${base} ${sizeClass(size)} border-danger-line bg-surface text-danger hover:bg-danger-soft ${className}`}
      {...rest}
    />
  );
}

// A row action that happens to be destructive. Ghost-quiet at rest like its
// neighbours, red only on hover and focus.
//
// The bordered `DangerButton` is right for a standalone "Hapus terpilih (3)" —
// a deliberate button someone goes looking for. Inside a table row it made the
// delete the loudest thing on every line, shouting on rows nobody intends to
// touch, and it did not pair with the ghost-quiet edit beside it. The colour
// still arrives before the click, on hover and on keyboard focus.
export function DangerGhostButton({
  size = "md",
  className = "",
  ...rest
}: Props) {
  return (
    <button
      className={`${base} ${sizeClass(size)} border-transparent bg-transparent text-faint hover:bg-danger-soft hover:text-danger focus-visible:text-danger ${className}`}
      {...rest}
    />
  );
}

export function GhostButton({ size = "md", className = "", ...rest }: Props) {
  return (
    <button
      className={`${base} ${sizeClass(size)} border-transparent bg-transparent text-faint hover:text-body ${className}`}
      {...rest}
    />
  );
}
