import type { ReactNode } from "react";
import { thClass, tdClass } from "./DataTable";
import { formatAngka, formatRupiah } from "../lib/format";

// The phone layout every wide table falls back to below `md`.
//
// A six-column table at 390px is either a horizontal scroll nobody discovers or
// a font size nobody can read. The answer this app settled on with Harga is to
// keep the table element — so the two sides stay aligned down the column — and
// give it two columns only: what the row IS on the left, what it is WORTH on
// the right. Nothing is dropped; the other columns restack as small lines under
// whichever of the two they belong to.
//
// `min-h-11` on the first line of each side is the 44px touch target: on pages
// where that line is a link, the tap area is the whole line rather than the
// text's own height.
export function MobileList({
  left,
  right,
  children,
}: {
  left: ReactNode;
  right: ReactNode;
  children: ReactNode;
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={thClass}>{left}</th>
          <th className={`${thClass} text-right`}>{right}</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

// One toggleable column restacked into a MobileRow's meta line, labelled because
// out of its column a bare value ("12", an email, a date) no longer says what it
// is. Pages render one per column the user has switched on, so the phone layout
// honours the same column toggle as the wide table.
export function MobileField({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 min-w-0 break-words">
      <span className="text-faint">{label}:</span>
      <span className="text-body">{children}</span>
    </span>
  );
}

// The "qty × harga" line under a phone row's total, built from whichever of the
// two columns are switched on — hiding Harga Satuan on the wide table and still
// seeing it here would make the toggle mean nothing on a phone.
export function qtyTimesHarga(
  visible: Record<string, boolean>,
  kuantitas: number,
  hargaSatuan: number,
): string | undefined {
  const q = visible.kuantitas !== false;
  const h = visible.hargaSatuan !== false;
  if (q && h) return `${formatAngka(kuantitas)} × ${formatRupiah(hargaSatuan)}`;
  if (q) return `Qty ${formatAngka(kuantitas)}`;
  if (h) return `@ ${formatRupiah(hargaSatuan)}`;
  return undefined;
}

// The row's own cell padding. `tdClass` pays for a desktop table, where a cell
// is one line tall and `py-2` is the only breathing room it gets. Here a cell is
// already two or three stacked lines with a 44px touch target on the first, so
// the same padding landed on top of space the content had itself — the phone
// rows read as mostly gap. Half the vertical padding, and the sub-lines tuck up
// under their line instead of adding a `pb-1` of their own.
const cellClass = `${tdClass} py-1 align-top`;

export function MobileRow({
  title,
  meta,
  value,
  note,
  className,
}: {
  title: ReactNode;
  // Badges, units, dates — anything that qualifies the identity.
  meta?: ReactNode;
  value: ReactNode;
  // The arithmetic behind the number, or a second amount.
  note?: ReactNode;
  // Row-level state the desktop table paints on its own `<tr>`: Pesanan dims a
  // line excluded from the total and tints a selected one. Without this the
  // phone layout would still hold the checkbox and the eye button but show no
  // sign of what they did, which is the one thing a row-level tint is for.
  className?: string;
}) {
  return (
    <tr className={className}>
      <td className={cellClass}>
        {/* A table column can never be narrower than its min-content, and a
            `whitespace-nowrap` link reports its ENTIRE text as that. One buyer
            named "Kantin Sekolah Harapan Bangsa Nusantara" was enough to push
            Pesanan's phone table past 390px and hand the whole page a sideways
            scroll. Letting links wrap here drops the minimum to the longest
            single word, which fits any phone. Desktop keeps its nowrap. */}
        <div className="flex items-center min-h-11 font-medium min-w-0 [&_a]:whitespace-normal [&_a]:break-words">
          {title}
        </div>
        {/* Same rule as above, plus `<select>`: a select reports the width of
            its WIDEST OPTION as its min-content, so Pesanan's inline buyer
            picker would have done this on its own. `min-w-0` lets the control
            shrink and truncate inside itself instead. */}
        {meta && (
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-faint min-w-0 [&_a]:whitespace-normal [&_a]:break-words [&_select]:min-w-0 [&_select]:max-w-full">
            {meta}
          </div>
        )}
      </td>
      <td className={`${cellClass} text-right tabular-nums whitespace-nowrap`}>
        <div className="flex items-center justify-end min-h-11 font-medium">
          {value}
        </div>
        {note && <div className="text-xs text-faint">{note}</div>}
      </td>
    </tr>
  );
}
