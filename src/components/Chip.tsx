import type { ReactNode } from "react";

// A small pill of text. Two jobs on Laporan, one shape: the filter bar uses it
// to show which filters are actually applied, and every panel header uses it to
// declare the scope its numbers cover.
//
// The two have to look identical on purpose. The whole confusion this page had
// was that the filter at the top silently claimed figures it did not touch, and
// a reader only believes "this panel covers Agustus 2026" when it is written in
// the same ink as the "Agustus 2026" they set at the top.
//
// `tone` is not decoration. "period" is the default and means the figure moves
// with the filter; "static" means it does not, and is deliberately grey rather
// than a warning colour — an unfiltered balance is correct, just answering a
// different question. "partial" is amber because that one IS a trap: the panel
// looks filtered, moves when you change the dates, and ignores two of the
// dropdowns.
export function Chip({
  tone = "period",
  children,
}: {
  tone?: "period" | "static" | "partial";
  children: ReactNode;
}) {
  const styles = {
    period: "bg-brand-soft text-brand-text border-brand-line",
    static: "bg-surface-sunken text-muted border-line",
    partial: "bg-warn-soft text-warn-text border-warn-line",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${styles}`}
    >
      {children}
    </span>
  );
}
