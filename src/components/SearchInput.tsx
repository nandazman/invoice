import type { InputHTMLAttributes } from "react";
import { Input } from "./Input";
import { SearchIcon } from "./icons";

// The search field every list page shares: a magnifier inside the box, no
// separate label (the placeholder and `aria-label` carry the name). One
// component so Harga, Stok and the rest cannot drift apart again.
export function SearchInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`relative min-w-0 ${className}`}>
      <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-faint pointer-events-none" />
      <Input className="!pl-8" {...props} />
    </div>
  );
}
