import type { ReactNode } from "react";
import { flexRender, type Column, type Table } from "@tanstack/react-table";

// The table shell that was copy-pasted across thirteen route files: the scroll
// container, the header and cell classes, sortable headers, and the empty
// state. Column-specific rendering still lives in each page's column defs —
// this owns only what every table shares.
export const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-faint border-b border-line";
export const tdClass = "px-2.5 py-2 text-sm border-b border-line-soft";

// Right-aligned, tabular-figure columns opt in through the column def's meta.
export interface ColumnMeta {
  num?: boolean;
}

// A sortable column header. Exported because a page's phone layout shows a
// different set of columns under different labels but must stay sortable by
// the same TanStack columns — so it needs this markup without the rest of the
// table.
export function SortHeader<T>({
  column,
  label,
  num = false,
}: {
  column: Column<T, unknown>;
  label: ReactNode;
  num?: boolean;
}) {
  const sorted = column.getIsSorted();
  return (
    <th
      scope="col"
      aria-sort={
        !column.getCanSort()
          ? undefined
          : sorted === "asc"
            ? "ascending"
            : sorted === "desc"
              ? "descending"
              : "none"
      }
      // `top-14` clears the fixed mobile app bar; above `md` that bar is
      // gone and the header sticks to the viewport itself.
      className={`${thClass} sticky top-14 md:top-0 z-10 bg-surface ${num ? "text-right" : ""}`}
    >
      {column.getCanSort() ? (
        <button
          type="button"
          onClick={column.getToggleSortingHandler()}
          className={`inline-flex items-center gap-1 w-full min-h-11 md:min-h-0 cursor-pointer select-none uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
            num ? "justify-end" : ""
          }`}
        >
          {label}
          {/* Always rendered at a fixed width, so the label does not shift
              sideways when the arrow appears. */}
          <span aria-hidden className="w-3 shrink-0 text-faint">
            {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : ""}
          </span>
        </button>
      ) : (
        label
      )}
    </th>
  );
}

export function DataTable<T>({
  table,
  empty,
  mobile,
}: {
  table: Table<T>;
  empty?: ReactNode;
  // Rendered below `md` in place of the table. Pages that cannot show every
  // column on a phone pass a purpose-built layout here; swapping that layout
  // (rows for cards, say) is then a one-component change and never touches the
  // column defs, which stay the single source of truth for the desktop table.
  mobile?: ReactNode;
}) {
  const rows = table.getRowModel().rows;
  if (rows.length === 0) return <>{empty}</>;

  return (
    <>
      {mobile && <div className="md:hidden">{mobile}</div>}
      {/* Horizontal scroll only where the columns cannot fit. At `lg` the
          1400px content cap holds every column, so the container stops being a
          scroll box — which is what lets the sticky header stick to the
          viewport instead of to a box that never scrolls vertically. */}
      <div
        className={`overflow-x-auto lg:overflow-x-visible ${mobile ? "hidden md:block" : ""}`}
      >
        <table className="w-full border-collapse">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <SortHeader
                    key={h.id}
                    column={h.column}
                    label={flexRender(
                      h.column.columnDef.header,
                      h.getContext(),
                    )}
                    num={(h.column.columnDef.meta as ColumnMeta)?.num}
                  />
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface-sunken">
                {row.getVisibleCells().map((cell) => {
                  const num = (cell.column.columnDef.meta as ColumnMeta)?.num;
                  return (
                    <td
                      key={cell.id}
                      className={`${tdClass} ${num ? "text-right tabular-nums whitespace-nowrap" : ""}`}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
