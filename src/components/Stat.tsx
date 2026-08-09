// A labelled figure: small uppercase caption over a bold tabular number. Used
// wherever a page shows a handful of summary values side by side — the Ringkasan
// block on a buyer, the laba-rugi and piutang blocks on Laporan.
export function Stat({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
        {label}
      </div>
      <div className={`text-lg font-bold tabular-nums ${className}`}>
        {value}
      </div>
    </div>
  );
}
