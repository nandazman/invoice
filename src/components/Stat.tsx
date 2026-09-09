// A labelled figure: small uppercase caption over a bold tabular number. Used
// wherever a page shows a handful of summary values side by side — the Ringkasan
// block on a buyer, the laba-rugi and piutang blocks on Laporan.
export function Stat({
  label,
  value,
  hint,
  className = "",
}: {
  label: string;
  value: string;
  // One quiet line under the number, for the scope the figure covers —
  // "Agustus 2026" against "posisi hari ini". Laporan puts period flows and
  // moment balances side by side, and without this the filter bar at the top of
  // the page silently claims all of them. Optional: a block where every figure
  // shares one scope says it once in the panel text instead.
  hint?: string;
  className?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-faint font-semibold">
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${className}`}>
        {value}
      </div>
      {hint && <div className="text-xs text-faint mt-0.5">{hint}</div>}
    </div>
  );
}
