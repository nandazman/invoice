import type { Attribution } from "../lib/types";
import { ATTRIBUTION_COLUMNS } from "../lib/columns";
import { MobileField } from "./MobileList";

// The rendering half of the attribution columns. See lib/columns.ts for the
// labels and lib/sync/tables.ts for where the values come from.

// One "who" cell. Absence is the normal case, not an error: a row written on
// this device and not yet pushed has never been stamped, and the GitHub Pages
// copy has no Worker to stamp it at all. So an em-dash — never "undefined",
// which is what a bare {row.createdBy} would print.
export function ByCell({ email }: { email?: string | null }) {
  if (!email) return <span className="text-faint">—</span>;
  return (
    <span className="text-faint text-xs break-all" title={email}>
      {email}
    </span>
  );
}

// Which of the two are on. Kept as two flags rather than one because the pages
// with a ColumnToggle dropdown list them as two independent entries, and a
// header pair that ignored one of them would drift out of step with its cells.
export interface ByVisibility {
  created: boolean;
  updated: boolean;
}

// The two <th>s, so a page cannot label them differently from its neighbours.
export function ByHeaders({
  show,
  className,
}: {
  show: ByVisibility;
  className: string;
}) {
  return (
    <>
      {ATTRIBUTION_COLUMNS.map((c, i) =>
        (i === 0 ? show.created : show.updated) ? (
          <th key={c.id} className={className}>
            {c.label}
          </th>
        ) : null,
      )}
    </>
  );
}

// The matching two <td>s. Taking the whole row rather than two strings keeps
// the header/cell pair in the same order at every call site.
export function ByCells({
  show,
  row,
  className,
}: {
  show: ByVisibility;
  row: Attribution;
  className: string;
}) {
  return (
    <>
      {show.created && (
        <td className={`${className} whitespace-nowrap`}>
          <ByCell email={row.createdBy} />
        </td>
      )}
      {show.updated && (
        <td className={`${className} whitespace-nowrap`}>
          <ByCell email={row.updatedBy} />
        </td>
      )}
    </>
  );
}

// The phone-layout counterpart of ByCells: the same two toggles, restacked as
// labelled fragments in a MobileRow's meta line. Without it a toggle switched
// on showed its columns on a wide screen and silently nothing on a phone.
export function MobileBy({ show, row }: { show: ByVisibility; row: Attribution }) {
  return (
    <>
      {show.created && (
        <MobileField label={ATTRIBUTION_COLUMNS[0].label}>
          <ByCell email={row.createdBy} />
        </MobileField>
      )}
      {show.updated && (
        <MobileField label={ATTRIBUTION_COLUMNS[1].label}>
          <ByCell email={row.updatedBy} />
        </MobileField>
      )}
    </>
  );
}

// Both columns on or both off — what the checkbox pages want.
export function bothBy(show: boolean): ByVisibility {
  return { created: show, updated: show };
}

// The checkbox that reveals them, for tables with no ColumnToggle dropdown.
export function AttributionToggle({
  show,
  onChange,
}: {
  show: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted cursor-pointer shrink-0">
      <input
        type="checkbox"
        className="w-4 h-4 accent-brand cursor-pointer"
        checked={show}
        onChange={(e) => onChange(e.target.checked)}
      />
      Tampilkan kolom pembuat
    </label>
  );
}
