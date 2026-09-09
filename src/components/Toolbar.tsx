import type { ReactNode } from "react";

// Toolbar shell shared by every list page: a search field plus a cluster of
// actions. Below `md` there is not room for both on one row, so the search
// takes its own full-width row and the actions drop to a second row that
// scrolls sideways — wrapping them instead would stack buttons into a tower
// tall enough to push the table off the first screen.
export function Toolbar({
  search,
  actions,
}: {
  search?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 mb-3 md:flex-row md:items-end">
      {search && <div className="w-full md:flex-1 md:min-w-0">{search}</div>}
      {actions && (
        // `[&>*]:shrink-0` keeps each action at its natural width while
        // scrolling, rather than letting flex squeeze their labels first.
        <div className="flex items-end gap-3 overflow-x-auto no-scrollbar [&>*]:shrink-0 md:flex-none md:ml-auto md:overflow-visible">
          {actions}
        </div>
      )}
    </div>
  );
}
