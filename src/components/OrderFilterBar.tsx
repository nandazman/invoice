import { useState } from "react";
import { Button, PrimaryButton } from "./Button";
import { Field } from "./Field";
import { Input } from "./Input";
import { Modal } from "./Modal";
import { Panel } from "./Panel";
import { Select } from "./Select";
import { CloseIcon, FilterIcon, PlusIcon, SearchIcon } from "./icons";
import {
  PRESET_LABELS,
  periodeLabel,
  presetRange,
  type PresetKey,
} from "../lib/format";
import { useBuyers, useTypes } from "../lib/store";
import type { FilterableRow, OrderFilter } from "../lib/useOrderFilter";

const PRESETS = Object.keys(PRESET_LABELS) as PresetKey[];

// The compact filter for Pesanan: product search and the date presets stay on
// the bar, everything else lives behind one "Filter (n)" button, and whatever is
// applied shows as a chip you can remove with one tap. Same values and same
// rules as FilterBar; only the layout differs.
export function OrderFilterBar({
  filter,
  perBuyer,
  onPerBuyer,
  showStatus = true,
  showBuyer = true,
  onAdd,
}: {
  filter: OrderFilter<FilterableRow>;
  // A view switch, not a filter: it lives in the panel but Reset leaves it alone.
  // Only Pesanan has one; the other pages leave both out.
  perBuyer?: boolean;
  onPerBuyer?: (next: boolean) => void;
  // Beli Stok rows have no paid/pending state, so that page hides the control.
  showStatus?: boolean;
  // Nor do they have a buyer: stock is bought from suppliers, not for someone.
  showBuyer?: boolean;
  // Phone only: the page header (and its Tambah) is hidden there, so the add
  // button rides the search row, as in the mockup.
  onAdd?: () => void;
}) {
  const { values, set, preset, filtered, clear, hasFilter } = filter;
  const [open, setOpen] = useState(false);
  const types = useTypes();
  const buyers = useBuyers();

  const activePreset = PRESETS.find((key) => {
    const [from, to] = presetRange(key);
    return !values.exact && values.from === from && values.to === to;
  });

  // The product search is not counted or chipped: it is already on the bar.
  const periode = periodeLabel(values);
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (periode)
    chips.push({
      key: "periode",
      label: periode,
      clear: () => set({ exact: "", from: "", to: "" }),
    });
  if (values.tipe)
    chips.push({
      key: "tipe",
      label: `Tipe: ${values.tipe}`,
      clear: () => set({ tipe: "" }),
    });
  if (showBuyer && values.pembeli) {
    const nama = buyers.find((b) => b.id === values.pembeli)?.nama;
    chips.push({
      key: "pembeli",
      label: `Pembeli: ${nama ?? "tidak dikenal"}`,
      clear: () => set({ pembeli: "" }),
    });
  }
  if (showStatus && values.status !== "semua")
    chips.push({
      key: "status",
      label: values.status === "paid" ? "Sudah dibayar" : "Belum dibayar",
      clear: () => set({ status: "semua" }),
    });

  return (
    <Panel className="!p-3">
      <div className="@container flex flex-col gap-2.5">
        {/* One row on desktop (search, presets, Filter); on a phone the presets
            wrap under the search row. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-0 @2xl:flex-none @2xl:w-60">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-faint pointer-events-none" />
            <Input
              className="!pl-8"
              value={values.produk}
              onChange={(e) => set({ produk: e.target.value })}
              placeholder="Cari produk…"
              aria-label="Cari produk"
            />
          </div>
          {/* Presets scroll sideways on a phone instead of wrapping into a block. */}
          <div className="order-last w-full flex items-center gap-2 overflow-x-auto @2xl:order-none @2xl:w-auto @2xl:overflow-visible -mx-1 px-1 pb-0.5 @2xl:m-0 @2xl:p-0">
            {PRESETS.map((key) => (
              <Button
                key={key}
                size="sm"
                className={`shrink-0 !rounded-full ${
                  activePreset === key
                    ? "!bg-brand-soft !border-brand !text-brand-text"
                    : ""
                }`}
                onClick={() => preset(key)}
              >
                {PRESET_LABELS[key]}
              </Button>
            ))}
          </div>
          <span className="hidden @2xl:block flex-1" />
          <Button
            onClick={() => setOpen(true)}
            aria-label={`Filter${chips.length > 0 ? ` (${chips.length})` : ""}`}
          >
            <FilterIcon />
            <span className="hidden @2xl:inline">Filter</span>
            {chips.length > 0 && (
              <span className="rounded-full bg-brand text-white text-[11px] leading-[18px] min-w-[18px] px-1.5 text-center">
                {chips.length}
              </span>
            )}
          </Button>
          {onAdd && (
            <PrimaryButton className="md:hidden" onClick={onAdd}>
              <PlusIcon /> Tambah
            </PrimaryButton>
          )}
        </div>

        {hasFilter && (
          <div className="flex gap-1.5 flex-wrap items-center">
            {chips.map((c) => (
              <span
                key={c.key}
                className="inline-flex items-center gap-1 rounded border border-brand-line bg-brand-soft text-brand-text pl-2 pr-1 py-0.5 text-xs font-semibold"
              >
                {c.label}
                <button
                  type="button"
                  onClick={c.clear}
                  aria-label={`Hapus filter ${c.label}`}
                  className="rounded p-0.5 hover:bg-brand-line cursor-pointer"
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              </span>
            ))}
            <span className="flex-1" />
            <span className="text-xs text-faint">{filtered.length} cocok</span>
            <Button size="sm" onClick={clear}>
              Reset
            </Button>
          </div>
        )}
      </div>

      {open && (
        <Modal
          onClose={() => setOpen(false)}
          className="bg-surface p-4 md:p-5 w-full max-w-md overflow-auto"
        >
          <div className="flex items-center mb-3">
            <h2 className="text-lg font-bold flex-1">Filter</h2>
            <Button
              size="sm"
              className="!border-transparent"
              onClick={() => setOpen(false)}
              aria-label="Tutup"
            >
              <CloseIcon />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Tanggal spesifik" className="col-span-2">
              <Input
                type="date"
                value={values.exact}
                onChange={(e) => set({ exact: e.target.value })}
              />
            </Field>
            <Field label="Dari tanggal">
              <Input
                type="date"
                value={values.from}
                disabled={!!values.exact}
                onChange={(e) => set({ from: e.target.value })}
              />
            </Field>
            <Field label="Sampai tanggal">
              <Input
                type="date"
                value={values.to}
                disabled={!!values.exact}
                onChange={(e) => set({ to: e.target.value })}
              />
            </Field>
            <Field label="Tipe">
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
            {/* A plain <Select>, not BuyerSelect: "+ Buat pembeli" belongs on a
                form that records an order, not on a filter, where creating a
                buyer could only ever narrow the list to nothing. */}
            {showBuyer && (
              <Field label="Pembeli">
                <Select
                  value={values.pembeli}
                  onChange={(e) => set({ pembeli: e.target.value })}
                >
                  <option value="">Semua pembeli</option>
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nama}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {showStatus && (
              <Field label="Status" className="col-span-2">
                <Select
                  value={values.status}
                  onChange={(e) =>
                    set({ status: e.target.value as typeof values.status })
                  }
                >
                  <option value="semua">Semua</option>
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                </Select>
              </Field>
            )}
          </div>

          {onPerBuyer && (
            <label className="md:hidden flex items-center gap-2 text-sm text-muted cursor-pointer mt-3">
              <input
                type="checkbox"
                checked={!!perBuyer}
                onChange={(e) => onPerBuyer(e.target.checked)}
                className="w-4 h-4 accent-brand cursor-pointer"
              />
              Pisahkan per pembeli
            </label>
          )}

          <div className="flex items-center gap-2 mt-4">
            <span className="text-sm text-faint">{filtered.length} cocok</span>
            <span className="flex-1" />
            {hasFilter && <Button onClick={clear}>Reset</Button>}
            <PrimaryButton onClick={() => setOpen(false)}>
              Selesai
            </PrimaryButton>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
