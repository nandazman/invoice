import type { ReactNode } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend as RcLegend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatPersen,
  formatRupiah,
  formatRupiahRingkas,
} from "../lib/format";

// The three charts Laporan draws. Each answers a different question, and the
// chart type follows the question rather than the other way round:
//
//   Waterfall - where did the money GO between penjualan and laba?
//   Trend     - is the business getting better or worse over time?
//   Pareto    - which few products carry the profit?
//
// All three are built from divs plus, where a line is genuinely the right mark,
// one inline SVG. No chart dependency: the whole set is under 300 lines, and a
// library would have brought its own tooltip, its own focus behaviour and its
// own colours to fight with the tokens in styles.css.
//
// Shared rule: every value a bar paints is ALSO reachable as text - printed
// beside it, or in the `sr-only` table a dense chart carries. The bars are
// `aria-hidden`; nothing here can only be learned by measuring a rectangle with
// your eye.

// ---------- 1. Waterfall: the laba-rugi bridge ----------

export interface WaterfallStep {
  key: string;
  label: string;
  // Signed: what this step does to the running total. A `total` step carries the
  // running total itself rather than a change to it.
  delta: number;
  kind: "start" | "sub" | "total";
  // A deduction the app cannot price (quarantined revenue). Drawn in warn, not
  // in negative: that money is unknown, not lost.
  unknown?: boolean;
}

// The picture of the number block above it: each bar starts where the last one
// ended, so the eye follows the money down from penjualan to laba instead of
// re-adding a column of figures. This is the one chart type that shows where a
// total WENT, which is the question the laba-rugi block is answering.
//
// Horizontal, not the textbook vertical: the labels are Indonesian sentences
// ("Stok hilang, rusak, atau dipakai sendiri"), and a vertical waterfall would
// have to rotate or truncate them to fit 40px of column width on a phone.
export function WaterfallChart({ steps }: { steps: WaterfallStep[] }) {
  // The scale has to hold every running total, including a negative bottom line.
  let run = 0;
  const spans = steps.map((s) => {
    if (s.kind === "total") return { from: 0, to: s.delta };
    const from = run;
    run += s.delta;
    return { from, to: run };
  });
  const lo = Math.min(0, ...spans.map((s) => Math.min(s.from, s.to)));
  const hi = Math.max(...spans.map((s) => Math.max(s.from, s.to)), 1);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;

  return (
    <ul className="flex flex-col gap-2">
      {steps.map((s, i) => {
        const { from, to } = spans[i];
        const left = Math.min(pos(from), pos(to));
        const width = Math.abs(pos(to) - pos(from));
        const tone =
          s.kind === "total"
            ? to < 0
              ? "bg-negative"
              : "bg-ok"
            : s.kind === "start"
              ? "bg-brand"
              : s.unknown
                ? "bg-warn"
                : "bg-negative";
        return (
          <li
            key={s.key}
            className={s.kind === "total" ? "pt-2 border-t border-line" : ""}
          >
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span
                className={s.kind === "total" ? "font-semibold" : "text-muted"}
              >
                {s.label}
              </span>
              <span
                className={`tabular-nums whitespace-nowrap ${
                  s.kind === "total" ? "font-bold" : "text-faint"
                }`}
              >
                {s.kind === "sub"
                  ? `− ${formatRupiah(Math.abs(s.delta))}`
                  : formatRupiah(s.delta)}
              </span>
            </div>
            <div
              aria-hidden
              className="mt-1 h-3 relative rounded-full bg-surface-hover"
            >
              {/* A step worth 0.2% of the scale still gets a visible sliver:
                  a bar that rounds away to nothing reads as a missing row. */}
              <div
                className={`absolute h-full rounded-full ${tone}`}
                style={{ left: `${left}%`, width: `${Math.max(width, 0.6)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- 2. Trend: grouped columns plus a real margin axis ----------

export interface TrendPoint {
  key: string;
  label: string;
  penjualan: number;
  hpp: number;
  laba: number;
  marginPct: number | null;
  // Drawn faded: in view for context, outside the period the page is filtered
  // to. A trend only reads against its neighbours, so this chart keeps drawing
  // twelve months whatever the date filter says, and marks the filtered ones
  // instead of dropping the rest — a one-bar "trend" is not a trend.
  dim?: boolean;
}

// This one IS a charting-library chart, and it is the only one that needed to
// be. The hand-rolled version drew the margin as a polyline on a scale fitted
// to the data with no axis and no ticks: the line's height meant nothing you
// could read off it. An axis with labelled ticks is exactly the boring
// machinery a chart library exists to provide, so recharts provides it.
//
// Penjualan and modal are GROUPED, not stacked. Stacking has to special-case a
// losing month (the cost is taller than the sale, so the "profit" segment would
// hang below the axis), and every explanation of that special case was a
// paragraph of Indonesian above the chart. Side by side, a losing month is a
// grey bar taller than a blue one, and nobody needs it explained.
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const data = points.map((p) => ({
    label: p.label,
    penjualan: p.penjualan,
    hpp: p.hpp,
    laba: p.laba,
    margin: p.marginPct,
    fade: p.dim ? 0.3 : 1,
  }));
  const adaRugi = points.some((p) => p.marginPct !== null && p.marginPct < 0);

  return (
    <div className="h-72 -ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
            tick={{ fill: "var(--color-faint)", fontSize: 11 }}
          />
          {/* Left axis is money, right axis is percent. Two units, two axes —
              which is the whole reason the old single-box version could not be
              read. */}
          <YAxis
            yAxisId="rp"
            tickLine={false}
            axisLine={false}
            width={56}
            tick={{ fill: "var(--color-faint)", fontSize: 11 }}
            tickFormatter={(v: number) => formatRupiahRingkas(v)}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fill: "var(--color-faint)", fontSize: 11 }}
            tickFormatter={(v: number) => `${Math.round(v)}%`}
          />
          {adaRugi && (
            <ReferenceLine
              yAxisId="pct"
              y={0}
              stroke="var(--color-negative-line)"
              strokeDasharray="4 4"
            />
          )}
          <Tooltip content={<TrendTooltip />} cursor={{ fill: "var(--color-surface-hover)" }} />
          <RcLegend
            verticalAlign="top"
            height={28}
            wrapperStyle={{ fontSize: 12, color: "var(--color-faint)" }}
          />
          <Bar
            yAxisId="rp"
            dataKey="penjualan"
            name="Penjualan"
            fill="var(--color-brand)"
            radius={[3, 3, 0, 0]}
            maxBarSize={38}
          >
            {data.map((d) => (
              <Cell key={d.label} fillOpacity={d.fade} />
            ))}
          </Bar>
          <Bar
            yAxisId="rp"
            dataKey="hpp"
            name="Modal (HPP)"
            fill="var(--color-ghost)"
            radius={[3, 3, 0, 0]}
            maxBarSize={38}
          >
            {data.map((d) => (
              <Cell key={d.label} fillOpacity={d.fade} />
            ))}
          </Bar>
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="margin"
            name="Margin %"
            stroke="var(--color-warn)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--color-warn)", strokeWidth: 0 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Recharts' default tooltip is a white box with inline styles that ignore the
// tokens in styles.css, so it reads as a foreign object in dark mode. This one
// is the same surface as every Panel, and prints rupiah as rupiah.
function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; dataKey?: string; value?: number | null }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const get = (k: string) => payload.find((p) => p.dataKey === k)?.value ?? null;
  const laba = get("laba");
  return (
    <div className="rounded-lg border border-line bg-surface shadow-lg px-3 py-2 text-xs">
      <div className="font-semibold mb-1">{label}</div>
      <Baris label="Penjualan" value={formatRupiah(get("penjualan") ?? 0)} />
      <Baris label="Modal (HPP)" value={formatRupiah(get("hpp") ?? 0)} />
      <Baris
        label="Laba"
        value={formatRupiah(laba ?? 0)}
        className={laba !== null && laba < 0 ? "text-negative-text" : "text-ok-text"}
      />
      <Baris label="Margin" value={formatPersen(get("margin"))} />
    </div>
  );
}

function Baris({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-faint">{label}</span>
      <span className={`tabular-nums font-medium ${className}`}>{value}</span>
    </div>
  );
}

// ---------- 3. Pareto: how concentrated the profit is ----------

export interface ParetoBar {
  key: string;
  label: ReactNode;
  value: number;
}

// A ranked list where the bar is the row's own background, not a separate
// stripe under it. The old version put name and rupiah on one line and the bar
// on the next, which read as a link with a loading bar beneath it rather than
// as a measured quantity.
//
// `inti` is how many rows carry 80% of the total. It used to be a running
// percentage printed on every row, which asked the reader to decide for
// themselves where the line was, and was invisible anyway whenever the cutoff
// fell past the last row shown. Now it is one rule drawn across the list where
// the cutoff actually is, captioned. When the cutoff falls outside the visible
// rows nothing is drawn - the ChartNote above the list says it in words.
export function ParetoBars({
  bars,
  inti = 0,
  negatif = false,
}: {
  bars: ParetoBar[];
  inti?: number;
  negatif?: boolean;
}) {
  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
  const fill = negatif ? "bg-negative-soft" : "bg-brand-soft";
  return (
    <ul className="flex flex-col gap-1">
      {bars.map((b, i) => (
        <li key={b.key}>
          {inti > 0 && i === inti && (
            <div className="flex items-center gap-2 my-2">
              <span className="text-xs text-faint whitespace-nowrap">
                80% laba ada di atas garis ini
              </span>
              <span className="flex-1 border-t border-dashed border-line" />
            </div>
          )}
          <div className="relative rounded overflow-hidden">
            {/* The measured quantity, behind the text it belongs to. */}
            <div
              aria-hidden
              className={`absolute inset-y-0 left-0 ${fill}`}
              style={{ width: `${(Math.abs(b.value) / max) * 100}%` }}
            />
            <div className="relative flex items-baseline gap-3 text-sm px-2 py-1.5">
              <span className="flex-1 min-w-0 truncate">{b.label}</span>
              <span
                className={`tabular-nums whitespace-nowrap font-semibold ${
                  negatif ? "text-negative" : ""
                }`}
              >
                {formatRupiah(b.value)}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// A one-line takeaway, above the chart it belongs to. The chart shows the shape;
// this says what the shape MEANS, in the words a shop owner would use. Without
// it a chart is a shape the reader has to interpret on their own, which is how
// the first version of this page ended up decorating numbers instead of
// explaining them.
export function ChartNote({
  tone = "netral",
  children,
}: {
  tone?: "netral" | "baik" | "buruk";
  children: ReactNode;
}) {
  const cls =
    tone === "baik"
      ? "bg-ok-soft border-ok-line text-ok-text"
      : tone === "buruk"
        ? "bg-negative-soft border-negative-line text-negative-text"
        : "bg-surface-sunken border-line text-muted";
  return (
    <p className={`mb-3 text-sm font-medium border rounded-lg px-3 py-2 ${cls}`}>
      {children}
    </p>
  );
}
