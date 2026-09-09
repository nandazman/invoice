import type { ReactNode } from "react";
import { formatPersen, formatRupiah, formatRupiahRingkas } from "../lib/format";

// The two charts Laporan draws, built out of divs rather than SVG or a chart
// library. Every value one of these paints is ALSO printed beside it as text:
// the bar is the fast read, the number is the answer, and nothing on the page
// can only be learned by measuring a rectangle with your eye. That is also what
// makes them accessible without an ARIA description nobody maintains — the bars
// are `aria-hidden` and the figures are ordinary text.
//
// Bars are horizontal on purpose. A vertical bar has to fit its label
// underneath, which on a 390px phone means either three months on screen or
// rotated text; a row gives the label the full width and stacks as far down the
// page as the data goes.

// A row of the composition chart: what the sales were made of.
export interface CompositionRow {
  key: string;
  label: string;
  penjualan: number;
  hpp: number;
  laba: number;
  marginPct: number | null;
}

// Penjualan split into the part that was modal and the part that was profit.
//
// Scaled against the LARGEST row's penjualan, not each row's own, so the bars
// are comparable down the column: a month that sold twice as much draws twice
// as long a bar. Scaling each to 100% would have drawn every month the same
// size and turned the chart into a margin chart wearing a sales chart's clothes.
export function CompositionChart({
  rows,
  empty,
}: {
  rows: CompositionRow[];
  empty?: ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;
  const max = Math.max(...rows.map((r) => r.penjualan), 1);

  return (
    <div>
      <Legend
        items={[
          { className: "bg-ghost", label: "Modal (HPP)" },
          { className: "bg-ok", label: "Laba" },
        ]}
      />
      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const width = (r.penjualan / max) * 100;
          // A loss means the modal was bigger than the sale, so there is no
          // profit slice to draw: the whole bar is cost, tinted to say so. The
          // number beside it still carries the real figure.
          const rugi = r.laba < 0;
          const labaShare = rugi ? 0 : (r.laba / (r.penjualan || 1)) * 100;
          return (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium truncate">{r.label}</span>
                <span className="tabular-nums whitespace-nowrap text-faint">
                  {formatRupiah(r.penjualan)}
                </span>
              </div>
              <div
                aria-hidden
                className="mt-1 h-3 rounded-full bg-surface-hover overflow-hidden"
              >
                <div
                  className="h-full flex rounded-full overflow-hidden"
                  style={{ width: `${width}%` }}
                >
                  <div
                    className={`h-full ${rugi ? "bg-negative" : "bg-ghost"}`}
                    style={{ width: `${100 - labaShare}%` }}
                  />
                  <div
                    className="h-full bg-ok"
                    style={{ width: `${labaShare}%` }}
                  />
                </div>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3 text-xs text-faint tabular-nums">
                <span>Modal {formatRupiahRingkas(r.hpp)}</span>
                <span
                  className={rugi ? "text-negative font-semibold" : "text-ok-text font-semibold"}
                >
                  Laba {formatRupiahRingkas(r.laba)} ({formatPersen(r.marginPct)})
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// A row of the contribution chart: who or what earned the profit.
export interface ContributionRow {
  key: string;
  label: ReactNode;
  value: number;
}

// Ranked bars for a single figure — the profit each product or buyer brought in.
//
// Scaled against the largest ABSOLUTE value, so a big loss draws as long a bar
// as a big win. A loss-making row is the one a shop owner most needs to see, and
// scaling on the maximum alone would have drawn it as a sliver.
export function ContributionChart({
  rows,
  empty,
}: {
  rows: ContributionRow[];
  empty?: ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const negative = r.value < 0;
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{r.label}</span>
              <span
                className={`tabular-nums whitespace-nowrap font-semibold ${
                  negative ? "text-negative" : ""
                }`}
              >
                {formatRupiah(r.value)}
              </span>
            </div>
            <div aria-hidden className="mt-1 h-2 rounded-full bg-surface-hover">
              <div
                className={`h-full rounded-full ${negative ? "bg-negative" : "bg-brand"}`}
                style={{ width: `${(Math.abs(r.value) / max) * 100}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Legend({
  items,
}: {
  items: { className: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-4 mb-3 text-xs text-faint">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={`w-3 h-3 rounded-sm ${i.className}`}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}
