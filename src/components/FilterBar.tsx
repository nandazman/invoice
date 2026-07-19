import type { ReactNode } from "react";
import { Button } from "./Button";
import { Field } from "./Field";
import { Input } from "./Input";
import { Panel } from "./Panel";
import { Select } from "./Select";
import { PRESET_LABELS, type PresetKey } from "../lib/format";
import { useTypes } from "../lib/store";
import type { FilterableRow, OrderFilter } from "../lib/useOrderFilter";

const PRESETS = Object.keys(PRESET_LABELS) as PresetKey[];

// The universal half of the filter UI: dates, presets, product search, type.
// Anything one page shows and another does not comes in as `children` — that is
// why there are no booleans here. Layout differs per page (Invoice stacks in a
// sidebar, Orders and Excel run horizontally), so that is `className`, not a
// `vertical` prop.
export function FilterBar({
  filter,
  className = "flex gap-3 flex-wrap items-end",
  fieldClassName = "w-36",
  children,
}: {
  filter: OrderFilter<FilterableRow>;
  className?: string;
  // Width of the fixed-size fields. Sized for the horizontal row by default;
  // a vertical stack passes "w-full" so they fill the column like the others.
  fieldClassName?: string;
  children?: ReactNode;
}) {
  const { values, set, preset, filtered, clear, hasFilter } = filter;
  const types = useTypes();

  return (
    <Panel>
      <div className="flex flex-col gap-3">
        <div className={className}>
          <Field label="Tanggal spesifik" className={fieldClassName}>
            <Input
              type="date"
              value={values.exact}
              onChange={(e) => set({ exact: e.target.value })}
            />
          </Field>
          <Field label="Dari tanggal" className={fieldClassName}>
            <Input
              type="date"
              value={values.from}
              disabled={!!values.exact}
              onChange={(e) => set({ from: e.target.value })}
            />
          </Field>
          <Field label="Sampai tanggal" className={fieldClassName}>
            <Input
              type="date"
              value={values.to}
              disabled={!!values.exact}
              onChange={(e) => set({ to: e.target.value })}
            />
          </Field>
          <Field label="Cari produk" className="flex-1 min-w-[160px]">
            <Input
              value={values.produk}
              onChange={(e) => set({ produk: e.target.value })}
              placeholder="Nama produk…"
            />
          </Field>
          <Field label="Tipe" className={fieldClassName}>
            <Select
              value={values.tipe}
              onChange={(e) => set({ tipe: e.target.value })}
            >
              <option value="">Semua</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          {children}
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          {PRESETS.map((key) => (
            <Button key={key} size="sm" onClick={() => preset(key)}>
              {PRESET_LABELS[key]}
            </Button>
          ))}
          <span className="flex-1" />
          <span className="text-sm text-slate-400">
            {filtered.length} cocok
          </span>
          {hasFilter && (
            <Button size="sm" onClick={clear}>
              Reset
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
