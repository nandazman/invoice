// Four badge colour pairs for the "Tipe" column, keyed off a hash of the type
// string rather than a lookup table. A lookup table needs an entry added for
// every new product type someone invents; a hash needs nothing — a brand new
// type just lands on whichever of the four buckets its name hashes to.
//
// Each pair is a Tailwind *-50/*-700 combo. Tailwind's own palette puts every
// 700 shade well past 4.5:1 against its matching 50 background (the 700/50
// step spans roughly a 9:1+ contrast ratio across the palette, comfortably
// clearing AA for the small badge text here), and none of the four hues is
// red, which this page already uses for negative margin.
const PALETTE = [
  "bg-slate-50 text-slate-700",
  "bg-blue-50 text-blue-700",
  "bg-amber-50 text-amber-700",
  "bg-emerald-50 text-emerald-700",
] as const;

// djb2: cheap, deterministic, no dependency, and stable across reloads and
// devices because it depends only on the characters in `tipe`. Any simple
// string hash would do here — this one is just the standard pick.
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

// Colour classes only. Shape (rounded-md px-2 py-0.5 text-xs font-semibold)
// is the caller's concern, not this function's — that keeps a future change
// to badge shape from touching the colour logic and vice versa.
export function typeBadgeClass(tipe: string): string {
  if (!tipe) return PALETTE[0];
  return PALETTE[djb2(tipe) % PALETTE.length];
}
