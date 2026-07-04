import { useMemo, useState } from "react";
import type { OrderItem, OrderStatus } from "../lib/types";
import { useOrders } from "../lib/store";
import { formatRupiah, formatAngka, formatTanggalID } from "../lib/format";
import { downloadOrdersXLSX } from "../lib/excel";
import { copyOrdersImage, downloadOrdersImage } from "../lib/orderImage";
import { copyOrdersText } from "../lib/orderText";
import { Button, PrimaryButton, DangerButton } from "../components/Button";
import { Input } from "../components/Input";
import { Select } from "../components/Select";
import { Panel } from "../components/Panel";
import { Field } from "../components/Field";

type StatusFilter = "semua" | OrderStatus;

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

export function ExcelPage() {
  const orders = useOrders();

  const [exact, setExact] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [produk, setProduk] = useState("");
  const [status, setStatus] = useState<StatusFilter>("semua");

  const [staged, setStaged] = useState<OrderItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [textState, setTextState] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  function clearFilters() {
    setExact("");
    setFrom("");
    setTo("");
    setProduk("");
    setStatus("semua");
  }

  const filtered = useMemo(() => {
    const q = produk.trim().toLowerCase();
    return orders.filter((o) => {
      if (exact && o.tanggal !== exact) return false;
      if (!exact) {
        if (from && o.tanggal < from) return false;
        if (to && o.tanggal > to) return false;
      }
      if (q && !o.namaProduk.toLowerCase().includes(q)) return false;
      if (status !== "semua" && o.status !== status) return false;
      return true;
    });
  }, [orders, exact, from, to, produk, status]);

  function appendFiltered() {
    setStaged((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      const additions = filtered.filter((f) => !seen.has(f.id));
      return [...prev, ...additions];
    });
  }
  function replaceFiltered() {
    setStaged(filtered);
    setSelected(new Set());
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) =>
      prev.size === staged.length ? new Set() : new Set(staged.map((s) => s.id)),
    );
  }
  function removeSelected() {
    setStaged((prev) => prev.filter((s) => !selected.has(s.id)));
    setSelected(new Set());
  }

  async function copyImage() {
    try {
      await copyOrdersImage(stagedSorted);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 2500);
    }
  }

  async function copyText() {
    try {
      await copyOrdersText(stagedSorted);
      setTextState("copied");
      setTimeout(() => setTextState("idle"), 2000);
    } catch {
      setTextState("error");
      setTimeout(() => setTextState("idle"), 2500);
    }
  }

  // Show staging sorted by date ascending (matches export grouping).
  const stagedSorted = useMemo(
    () => [...staged].sort((a, b) => a.tanggal.localeCompare(b.tanggal)),
    [staged],
  );

  const grandTotal = staged.reduce((s, i) => s + i.totalHarga, 0);
  const allChecked = staged.length > 0 && selected.size === staged.length;
  const hasFilter = exact || from || to || produk || status !== "semua";

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Ekspor Excel</h1>
      <p className="text-slate-500 mb-4">
        Pilih item ke area staging, lalu ekspor ke berkas <b>order.xlsx</b>.
      </p>

      <Panel>
        <div className="flex gap-3 flex-wrap items-end">
          <Field label="Tanggal spesifik" className="w-36">
            <Input
              type="date"
              value={exact}
              onChange={(e) => setExact(e.target.value)}
            />
          </Field>
          <Field label="Dari tanggal" className="w-36">
            <Input
              type="date"
              value={from}
              disabled={!!exact}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="Sampai tanggal" className="w-36">
            <Input
              type="date"
              value={to}
              disabled={!!exact}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label="Cari produk" className="flex-1 min-w-[160px]">
            <Input
              value={produk}
              onChange={(e) => setProduk(e.target.value)}
              placeholder="Nama produk…"
            />
          </Field>
          <Field label="Status" className="w-36">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="semua">Semua</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
            </Select>
          </Field>
          {hasFilter && <Button onClick={clearFilters}>Reset</Button>}
        </div>
        <div className="flex gap-3 flex-wrap items-center mt-3">
          <span className="text-slate-400">{filtered.length} item cocok</span>
          <span className="flex-1" />
          <Button onClick={appendFiltered}>Tambah (sesuai filter)</Button>
          <Button onClick={replaceFiltered}>Ganti semua</Button>
        </div>
      </Panel>

      <Panel>
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <span className="text-lg font-bold">
            Total: {formatRupiah(grandTotal)}
          </span>
          <span className="text-slate-400">· {staged.length} item</span>
          <span className="flex-1" />
          <DangerButton onClick={removeSelected} disabled={selected.size === 0}>
            Hapus terpilih
          </DangerButton>
          <Button onClick={copyText} disabled={staged.length === 0}>
            {textState === "copied"
              ? "✓ Tersalin"
              : textState === "error"
                ? "Gagal menyalin"
                : "Salin teks"}
          </Button>
          <Button onClick={copyImage} disabled={staged.length === 0}>
            {copyState === "copied"
              ? "✓ Tersalin"
              : copyState === "error"
                ? "Gagal menyalin"
                : "Salin gambar"}
          </Button>
          <Button
            onClick={() => downloadOrdersImage(stagedSorted)}
            disabled={staged.length === 0}
          >
            Unduh gambar
          </Button>
          <PrimaryButton
            onClick={() => downloadOrdersXLSX(stagedSorted)}
            disabled={staged.length === 0}
          >
            Ekspor XLSX
          </PrimaryButton>
        </div>

        {staged.length === 0 ? (
          <div className="text-center text-slate-400 py-8">
            Belum ada data di staging. Gunakan filter lalu tambahkan.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={`${thClass} w-8`}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className={thClass}>Tanggal</th>
                  <th className={thClass}>Nama Produk</th>
                  <th className={`${thClass} text-right`}>Kuantitas</th>
                  <th className={`${thClass} text-right`}>Harga Satuan</th>
                  <th className={`${thClass} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {stagedSorted.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50">
                    <td className={tdClass}>
                      <input
                        type="checkbox"
                        checked={selected.has(it.id)}
                        onChange={() => toggleRow(it.id)}
                      />
                    </td>
                    <td className={tdClass}>{formatTanggalID(it.tanggal)}</td>
                    <td className={tdClass}>{it.namaProduk}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatAngka(it.kuantitas)}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatRupiah(it.hargaSatuan)}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatRupiah(it.totalHarga)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
