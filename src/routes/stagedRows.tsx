import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import { formatRupiah } from "../lib/format";
import { Button } from "../components/Button";
import { ChevronDownIcon } from "../components/icons";
import type { OrderStatus } from "../lib/types";

// Phone staging list shared by Ekspor Excel and Buat Invoice: the Pesanan
// pattern. A collapsed row is name, status and price; tapping it opens a
// label/value card. Read-only status (staging never edits a row).
export interface StagedPhoneRow {
  id: string;
  namaProduk: string;
  totalHarga: number;
  status?: OrderStatus;
}

export function StatusTag({ status }: { status: OrderStatus }) {
  const cls =
    status === "paid"
      ? "text-ok bg-ok-soft border-ok-line"
      : "text-warn bg-warn-soft border-warn-line";
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${cls}`}
    >
      {status === "paid" ? "Paid" : "Pending"}
    </span>
  );
}

export function useExpandAll(ids: string[]) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  return {
    open,
    toggle: (id: string) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    toggleAll: () => setOpen(open.size > 0 ? new Set() : new Set(ids)),
  };
}

export function ExpandAllButton({
  anyOpen,
  onClick,
}: {
  anyOpen: boolean;
  onClick: () => void;
}) {
  return (
    <Button size="sm" className="md:!hidden" onClick={onClick}>
      <ChevronDownIcon className={anyOpen ? "rotate-180" : undefined} />
      {anyOpen ? "Tutup semua" : "Buka semua"}
    </Button>
  );
}

export function StagedPhoneList<T extends StagedPhoneRow>({
  rows,
  selected,
  open,
  onToggleSelected,
  onToggleOpen,
  onToggleAll,
  details,
  actions,
  className = "",
}: {
  rows: T[];
  selected: Set<string>;
  open: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleOpen: (id: string) => void;
  onToggleAll: () => void;
  details: (row: T) => [string, ReactNode][];
  actions?: (row: T) => ReactNode;
  className?: string;
}) {
  const allChecked = rows.length > 0 && selected.size === rows.length;
  return (
    <div className={`md:hidden border-t border-line ${className}`}>
      <label className="flex items-center gap-2 px-3 min-h-9 text-xs font-semibold text-muted border-b border-line select-none">
        <input
          type="checkbox"
          className="accent-brand"
          checked={allChecked}
          onChange={onToggleAll}
          aria-label="Pilih semua baris"
        />
        Pilih semua
      </label>
      {rows.map((it) => {
        const isOpen = open.has(it.id);
        return (
          <div
            key={it.id}
            className={`border-b border-line ${selected.has(it.id) ? "bg-brand-soft" : ""}`}
          >
            <div
              className="flex items-center gap-2 pl-3 pr-2 min-h-11 cursor-pointer"
              onClick={() => onToggleOpen(it.id)}
            >
              <input
                type="checkbox"
                className="accent-brand shrink-0"
                checked={selected.has(it.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggleSelected(it.id)}
                aria-label={`Pilih ${it.namaProduk}`}
              />
              <button
                type="button"
                aria-expanded={isOpen}
                className="flex-1 min-w-0 text-left font-medium break-words py-1"
              >
                {it.namaProduk}
              </button>
              {it.status && <StatusTag status={it.status} />}
              <span className="tabular-nums font-medium whitespace-nowrap">
                {formatRupiah(it.totalHarga)}
              </span>
              <ChevronDownIcon
                className={`h-4 w-4 shrink-0 text-faint ${isOpen ? "rotate-180" : ""}`}
              />
            </div>
            {isOpen && (
              <div className="bg-surface-sunken border-t border-line px-3 py-3 text-sm">
                <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1.5">
                  {details(it).map(([label, value]) => (
                    <Fragment key={label}>
                      <dt className="text-faint">{label}</dt>
                      <dd className="text-right tabular-nums font-medium break-words">
                        {value}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
                {actions && (
                  <div className="flex justify-end gap-2 mt-3">{actions(it)}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
