import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Product } from "../lib/types";
import {
  buildSections,
  summarize,
  CATALOG_COLUMNS,
  type CatalogColumnId,
} from "../lib/catalog";
import { LOGO_STORE_MAX } from "../lib/template-types";
import { downscaleImage } from "../lib/image";
import { useTemplates } from "../lib/template-store";
import { formatRupiah } from "../lib/format";
import { CatalogPreview, type CatalogOptions } from "./CatalogPreview";
import { Modal } from "./Modal";
import { Input } from "./Input";
import { Select } from "./Select";
import { Field } from "./Field";
import { Button, PrimaryButton } from "./Button";

const OPTS_KEY = "invoice.katalog.opts.v1";

// What survives between sessions. The logo is stored as a *reference* to a
// template (whose logo already lives in IndexedDB) rather than as a data URL —
// localStorage is a 5MB origin-wide budget and base64 logos are what blew it
// for templates. A one-off uploaded logo therefore lasts for the dialog only.
interface SavedOptions {
  judul: string;
  subjudul: string;
  footer: string;
  columns: CatalogColumnId[];
  tipes: string[];
  logoTemplateId: string;
  showKategori: boolean;
}

const DEFAULTS: SavedOptions = {
  judul: "KATALOG PRODUK & HARGA",
  subjudul: "",
  footer: "Harga dapat berubah sewaktu-waktu.",
  columns: ["ukuran", "hargaDasar", "hargaJual", "margin"],
  tipes: [],
  logoTemplateId: "",
  showKategori: true,
};

function loadOptions(): SavedOptions {
  try {
    const raw = localStorage.getItem(OPTS_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as SavedOptions) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const checkboxRow =
  "flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-slate-100 cursor-pointer text-slate-700";

export function CatalogDialog({
  products,
  types,
  onClose,
}: {
  products: Product[];
  types: string[];
  onClose: () => void;
}) {
  const templates = useTemplates();
  const [saved, setSaved] = useState<SavedOptions>(loadOptions);
  const [uploadedLogo, setUploadedLogo] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Tipe that no longer exist are dropped; an empty selection means "all", so a
  // newly added kategori shows up instead of silently missing from the catalog.
  const selectedTipes = useMemo(() => {
    const kept = saved.tipes.filter((t) => types.includes(t));
    return kept.length > 0 ? kept : types;
  }, [saved.tipes, types]);

  useEffect(() => {
    localStorage.setItem(OPTS_KEY, JSON.stringify(saved));
  }, [saved]);

  function patch(next: Partial<SavedOptions>) {
    setSaved((prev) => ({ ...prev, ...next }));
  }

  function toggleTipe(tipe: string) {
    const next = selectedTipes.includes(tipe)
      ? selectedTipes.filter((t) => t !== tipe)
      : [...selectedTipes, tipe];
    patch({ tipes: next });
  }

  function toggleColumn(id: CatalogColumnId) {
    patch({
      columns: saved.columns.includes(id)
        ? saved.columns.filter((c) => c !== id)
        : CATALOG_COLUMNS.filter(
            (c) => c.id === id || saved.columns.includes(c.id),
          ).map((c) => c.id), // keep the printed column order stable
    });
  }

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setUploadError("");
    try {
      setUploadedLogo(
        await downscaleImage(file, LOGO_STORE_MAX, LOGO_STORE_MAX),
      );
      patch({ logoTemplateId: "" });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Gagal memuat gambar");
    }
  }

  const logo =
    uploadedLogo ??
    templates.find((t) => t.id === saved.logoTemplateId)?.business.logo ??
    null;

  const options: CatalogOptions = {
    judul: saved.judul.trim() || DEFAULTS.judul,
    subjudul: saved.subjudul,
    footer: saved.footer,
    logo,
    columns: saved.columns,
    showKategori: saved.showKategori,
  };

  // Ordered by the tipe list so sections print in the same order every time.
  const sections = useMemo(
    () => buildSections(products, types.filter((t) => selectedTipes.includes(t))),
    [products, types, selectedTipes],
  );
  const { total, perTipe } = summarize(sections);
  const nilaiJual = sections.reduce(
    (s, sec) => s + sec.products.reduce((n, p) => n + p.hargaJual, 0),
    0,
  );

  return (
    <>
      <Modal
        onClose={onClose}
        closeOnOverlay={false}
        className="bg-white rounded-xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200">
          <h2 className="font-bold text-lg">Ekspor Katalog</h2>
          <span className="text-xs text-slate-400">
            {total} produk · {perTipe.length} kategori
          </span>
          <PrimaryButton
            className="ml-auto"
            onClick={() => window.print()}
            disabled={total === 0}
          >
            Cetak / PDF
          </PrimaryButton>
          <Button onClick={onClose}>Tutup</Button>
        </div>

        <div className="flex gap-4 p-5 overflow-auto">
          <div className="w-72 shrink-0 space-y-4">
            <section>
              <h3 className="font-bold text-sm text-slate-700 mb-2">Ringkasan</h3>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-sm">
                <Summary label="Total produk" value={String(total)} />
                <Summary label="Kategori" value={String(perTipe.length)} />
                <Summary label="Total harga jual" value={formatRupiah(nilaiJual)} />
                {perTipe.map((t) => (
                  <Summary
                    key={t.tipe}
                    label={t.tipe}
                    value={`${t.count} produk`}
                    muted
                  />
                ))}
              </div>
            </section>

            <section>
              <h3 className="font-bold text-sm text-slate-700 mb-1">Kategori</h3>
              <div className="max-h-44 overflow-auto border border-slate-200 rounded-lg p-1">
                {types.map((t) => (
                  <label key={t} className={checkboxRow}>
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      checked={selectedTipes.includes(t)}
                      onChange={() => toggleTipe(t)}
                    />
                    {t}
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Tanpa pilihan = semua kategori.
              </p>
              <label className={`${checkboxRow} mt-1`}>
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={saved.showKategori}
                  onChange={() => patch({ showKategori: !saved.showKategori })}
                />
                Kelompokkan per kategori
              </label>
              <p className="text-xs text-slate-400">
                Nonaktif: semua produk digabung jadi satu tabel, tanpa judul
                kategori.
              </p>
            </section>

            <section>
              <h3 className="font-bold text-sm text-slate-700 mb-1">Kolom</h3>
              <div className="border border-slate-200 rounded-lg p-1">
                <label className={`${checkboxRow} opacity-60`}>
                  <input type="checkbox" checked disabled className="accent-blue-600" />
                  Nama Produk
                </label>
                {CATALOG_COLUMNS.map((c) => (
                  <label key={c.id} className={checkboxRow}>
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      checked={saved.columns.includes(c.id)}
                      onChange={() => toggleColumn(c.id)}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="font-bold text-sm text-slate-700">Tampilan</h3>
              <Field label="Judul">
                <Input
                  value={saved.judul}
                  onChange={(e) => patch({ judul: e.target.value })}
                  placeholder={DEFAULTS.judul}
                />
              </Field>
              <Field label="Subjudul">
                <Input
                  value={saved.subjudul}
                  onChange={(e) => patch({ subjudul: e.target.value })}
                  placeholder="mis. Daftar bahan baku & inventaris"
                />
              </Field>
              <Field label="Teks footer">
                <Input
                  value={saved.footer}
                  onChange={(e) => patch({ footer: e.target.value })}
                />
              </Field>
              <Field label="Logo">
                <Select
                  value={uploadedLogo ? "upload" : saved.logoTemplateId}
                  onChange={(e) => {
                    setUploadedLogo(null);
                    patch({ logoTemplateId: e.target.value });
                  }}
                >
                  <option value="">Tanpa logo</option>
                  {templates
                    .filter((t) => t.business.logo)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        Logo template: {t.nama}
                      </option>
                    ))}
                  {uploadedLogo && <option value="upload">Logo yang diunggah</option>}
                </Select>
              </Field>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void onUpload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                Unggah logo…
              </Button>
              {uploadError && (
                <p
                  role="alert"
                  className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md px-2 py-1.5"
                >
                  {uploadError}
                </p>
              )}
              <p className="text-xs text-slate-400">
                Logo unggahan hanya dipakai sekali. Untuk logo tetap, simpan di
                halaman Desain Template.
              </p>
            </section>
          </div>

          <div className="flex-1 min-w-0 bg-slate-100 rounded-xl p-4">
            <CatalogPreview sections={sections} options={options} />
          </div>
        </div>
      </Modal>

      {/* Full-size sheets rendered into <body> (outside #root) so the catalog
          paginates onto real A4 pages when printed — same mechanism as the
          invoice print portal. */}
      {createPortal(
        <div className="print-portal">
          <CatalogPreview sections={sections} options={options} fit={false} />
        </div>,
        document.body,
      )}
    </>
  );
}

function Summary({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className={muted ? "text-slate-400 text-xs" : "text-slate-500"}>
        {label}
      </span>
      <span
        className={`font-semibold tabular-nums ${muted ? "text-slate-500 text-xs" : "text-slate-700"}`}
      >
        {value}
      </span>
    </div>
  );
}
