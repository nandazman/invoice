import type { ChangeEvent } from "react";
import type {
  FieldType,
  Template,
  TemplateElement,
  TextStyle,
} from "../../lib/template-types";
import {
  LOGO_STORE_MAX,
  LOGO_FIT_MAX,
  PHOTO_MAX,
  FIELD_TYPE_LABELS,
} from "../../lib/template-types";
import { downscaleImage, imageSize } from "../../lib/image";
import { Input } from "../Input";
import { Select } from "../Select";
import { Field } from "../Field";
import { Button, DangerButton } from "../Button";

const TOKENS = [
  "{{business.nama}}",
  "{{business.alamat}}",
  "{{business.telepon}}",
  "{{customer.nama}}",
  "{{customer.alamat}}",
];

function StyleControls({
  style,
  onChange,
}: {
  style: TextStyle;
  onChange: (patch: Partial<TextStyle>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Ukuran font">
        <Input
          type="number"
          value={style.fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) || 1 })}
        />
      </Field>
      <Field label="Perataan">
        <Select
          value={style.align}
          onChange={(e) => onChange({ align: e.target.value as TextStyle["align"] })}
        >
          <option value="left">Kiri</option>
          <option value="center">Tengah</option>
          <option value="right">Kanan</option>
        </Select>
      </Field>
      <Field label="Warna teks">
        <input
          type="color"
          value={style.color}
          onChange={(e) => onChange({ color: e.target.value })}
          className="h-9 w-full rounded-lg border border-slate-200"
        />
      </Field>
      <Field label="Warna latar">
        <div className="flex gap-1 items-center">
          <input
            type="color"
            value={style.bg ?? "#ffffff"}
            onChange={(e) => onChange({ bg: e.target.value })}
            className="h-9 flex-1 rounded-lg border border-slate-200"
          />
          <Button size="sm" onClick={() => onChange({ bg: null })} title="Hapus latar">
            ✕
          </Button>
        </div>
      </Field>
      <div className="col-span-2 flex gap-2">
        <Button
          size="sm"
          onClick={() => onChange({ fontWeight: style.fontWeight >= 700 ? 400 : 700 })}
          className={style.fontWeight >= 700 ? "bg-slate-200" : ""}
        >
          <b>B</b>
        </Button>
        <Button
          size="sm"
          onClick={() => onChange({ italic: !style.italic })}
          className={style.italic ? "bg-slate-200" : ""}
        >
          <i>I</i>
        </Button>
      </div>
    </div>
  );
}

export function Inspector({
  template,
  selected,
  onTemplateChange,
  onElementChange,
  onDelete,
  onDuplicate,
  onBringFront,
  onSendBack,
  onShowSettings,
}: {
  template: Template;
  selected: TemplateElement | null;
  onTemplateChange: (patch: Partial<Template>) => void;
  onElementChange: (id: string, patch: Partial<TemplateElement>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onBringFront: (id: string) => void;
  onSendBack: (id: string) => void;
  onShowSettings: () => void;
}) {
  function setStyle(el: TemplateElement, patch: Partial<TextStyle>) {
    onElementChange(el.id, { style: { ...el.style, ...patch } });
  }

  // Resize every logo box to the image's own aspect ratio, scaled to fit inside
  // LOGO_FIT_MAX, so the logo isn't letterboxed in the default placeholder box.
  function fitLogoElements(size: { w: number; h: number }) {
    const ratio = Math.min(LOGO_FIT_MAX / size.w, LOGO_FIT_MAX / size.h, 1);
    const w = Math.round(size.w * ratio);
    const h = Math.round(size.h * ratio);
    for (const logoEl of template.elements) {
      if (logoEl.type === "logo") onElementChange(logoEl.id, { w, h });
    }
  }

  async function onLogoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const src = await downscaleImage(file, LOGO_STORE_MAX, LOGO_STORE_MAX, "image/webp");
    const size = await imageSize(src);
    onTemplateChange({ business: { ...template.business, logo: src } });
    fitLogoElements(size);
    e.target.value = "";
  }

  async function onImageReplace(el: TemplateElement, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const src = await downscaleImage(file, PHOTO_MAX, PHOTO_MAX, "image/webp");
    const size = await imageSize(src);
    onElementChange(el.id, { src, w: size.w, h: size.h });
    e.target.value = "";
  }

  async function applyImageUrl(el: TemplateElement, raw: string) {
    const url = raw.trim();
    if (!url || url === el.src) return;
    try {
      const size = await imageSize(url);
      const ratio = Math.min(PHOTO_MAX / size.w, PHOTO_MAX / size.h, 1);
      onElementChange(el.id, {
        src: url,
        w: Math.round(size.w * ratio),
        h: Math.round(size.h * ratio),
      });
    } catch {
      // Couldn't read dimensions (CORS/404) — still set the src and keep size.
      onElementChange(el.id, { src: url });
    }
  }

  async function applyLogoUrl(raw: string) {
    const url = raw.trim();
    if (!url) return;
    onTemplateChange({ business: { ...template.business, logo: url } });
    try {
      fitLogoElements(await imageSize(url));
    } catch {
      // Couldn't read dimensions (CORS/404) — keep the current box size.
    }
  }

  // ---------- Template settings (nothing selected) ----------
  if (!selected) {
    return (
      <div className="space-y-3">
        <h3 className="font-bold text-sm text-slate-700">Pengaturan Template</h3>
        <Field label="Nama template">
          <Input
            value={template.nama}
            onChange={(e) => onTemplateChange({ nama: e.target.value })}
          />
        </Field>

        <div className="border-t border-slate-200 pt-3 space-y-2">
          <h4 className="font-semibold text-xs uppercase text-slate-400">Bisnis</h4>
          <Field label="Nama bisnis">
            <Input
              value={template.business.nama}
              onChange={(e) =>
                onTemplateChange({ business: { ...template.business, nama: e.target.value } })
              }
            />
          </Field>
          <Field label="Alamat">
            <Input
              value={template.business.alamat}
              onChange={(e) =>
                onTemplateChange({ business: { ...template.business, alamat: e.target.value } })
              }
            />
          </Field>
          <Field label="Telepon">
            <Input
              value={template.business.telepon}
              onChange={(e) =>
                onTemplateChange({ business: { ...template.business, telepon: e.target.value } })
              }
            />
          </Field>
          <Field label={`Logo (otomatis pas ke maks ${LOGO_FIT_MAX}px, rasio asli)`}>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                {template.business.logo && (
                  <img
                    src={template.business.logo}
                    alt="logo"
                    className="h-8 border border-slate-200 rounded"
                  />
                )}
                <input type="file" accept="image/*" onChange={onLogoUpload} className="text-xs" />
              </div>
              <Input
                key={template.id}
                defaultValue={
                  template.business.logo?.startsWith("http") ? template.business.logo : ""
                }
                placeholder="atau URL logo: https://…"
                onBlur={(e) => applyLogoUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
              />
            </div>
          </Field>
        </div>

        <div className="border-t border-slate-200 pt-3 space-y-2">
          <h4 className="font-semibold text-xs uppercase text-slate-400">Pelanggan</h4>
          <Field label="Nama pelanggan">
            <Input
              value={template.customer.nama}
              onChange={(e) =>
                onTemplateChange({ customer: { ...template.customer, nama: e.target.value } })
              }
            />
          </Field>
          <Field label="Alamat">
            <Input
              value={template.customer.alamat}
              onChange={(e) =>
                onTemplateChange({ customer: { ...template.customer, alamat: e.target.value } })
              }
            />
          </Field>
        </div>

        <p className="text-xs text-slate-400 pt-2">
          Klik sebuah elemen di kanvas untuk mengeditnya. Tambah data isian lewat
          tombol <b>+ Field</b>, lalu atur judul & tipenya.
        </p>
      </div>
    );
  }

  // ---------- Element editing ----------
  const el = selected;
  return (
    <div className="space-y-3">
      <Button size="sm" onClick={onShowSettings} className="w-full">
        ← Pengaturan Template
      </Button>
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm text-slate-700 capitalize">{el.type}</h3>
        <div className="flex gap-1">
          <Button size="sm" onClick={() => onBringFront(el.id)} title="Ke depan">
            ⬆
          </Button>
          <Button size="sm" onClick={() => onSendBack(el.id)} title="Ke belakang">
            ⬇
          </Button>
          <Button size="sm" onClick={() => onDuplicate(el.id)} title="Duplikat">
            ⧉
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <Field key={k} label={k.toUpperCase()}>
            <Input
              type="number"
              value={Math.round(el[k])}
              onChange={(e) => onElementChange(el.id, { [k]: Number(e.target.value) || 0 })}
            />
          </Field>
        ))}
      </div>

      {el.type === "text" && (
        <Field label="Teks">
          <textarea
            value={el.content ?? ""}
            onChange={(e) => onElementChange(el.id, { content: e.target.value })}
            rows={4}
            className="w-full px-2.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
          />
        </Field>
      )}

      {el.type === "text" && (
        <div className="text-[11px] text-slate-400 leading-relaxed">
          Token tersedia:{" "}
          {TOKENS.map((t) => (
            <code
              key={t}
              className="cursor-pointer bg-slate-100 rounded px-1 mr-1"
              onClick={() =>
                onElementChange(el.id, { content: (el.content ?? "") + t })
              }
            >
              {t}
            </code>
          ))}
        </div>
      )}

      {el.type === "field" && (
        <>
          <Field label="Judul field">
            <Input
              value={el.fieldLabel ?? ""}
              onChange={(e) => onElementChange(el.id, { fieldLabel: e.target.value })}
              placeholder="mis. No. Invoice"
            />
          </Field>
          <Field label="Tipe isian">
            <Select
              value={el.fieldType ?? "text"}
              onChange={(e) =>
                onElementChange(el.id, { fieldType: e.target.value as FieldType })
              }
            >
              {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          {el.fieldType === "select" && (
            <Field label="Pilihan (pisahkan dengan koma)">
              <Input
                value={(el.fieldOptions ?? []).join(", ")}
                onChange={(e) =>
                  onElementChange(el.id, {
                    fieldOptions: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="mis. Tunai, Transfer"
              />
            </Field>
          )}
          <p className="text-[11px] text-slate-400">
            Judul ini menjadi input otomatis di halaman <b>Buat Invoice</b>. Judul
            yang sama dipakai ulang berbagi satu isian.
          </p>
        </>
      )}

      {el.type === "image" && (
        <div className="space-y-2">
          <Field label="Unggah gambar">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onImageReplace(el, e)}
              className="text-xs"
            />
          </Field>
          <Field label="atau URL gambar">
            <Input
              key={el.id}
              defaultValue={el.src?.startsWith("http") ? el.src : ""}
              placeholder="https://…"
              onBlur={(e) => applyImageUrl(el, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </Field>
        </div>
      )}

      {el.type === "logo" && (
        <p className="text-xs text-slate-400">
          Logo diambil dari <b>Pengaturan Template</b>. Ubah gambar logo di sana.
        </p>
      )}

      {el.type === "items" && (
        <Field label="Kolom">
          <div className="space-y-1">
            {(el.columns ?? []).map((c, i) => (
              <div key={c.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={c.visible}
                  onChange={(e) => {
                    const cols = [...(el.columns ?? [])];
                    cols[i] = { ...c, visible: e.target.checked };
                    onElementChange(el.id, { columns: cols });
                  }}
                />
                <Input
                  value={c.label}
                  onChange={(e) => {
                    const cols = [...(el.columns ?? [])];
                    cols[i] = { ...c, label: e.target.value };
                    onElementChange(el.id, { columns: cols });
                  }}
                />
              </div>
            ))}
          </div>
        </Field>
      )}

      {el.type !== "image" && el.type !== "logo" && el.type !== "line" && (
        <StyleControls style={el.style} onChange={(p) => setStyle(el, p)} />
      )}

      {el.type === "line" && (
        <Field label="Warna garis">
          <input
            type="color"
            value={el.style.color}
            onChange={(e) => setStyle(el, { color: e.target.value })}
            className="h-9 w-full rounded-lg border border-slate-200"
          />
        </Field>
      )}

      <DangerButton onClick={() => onDelete(el.id)} className="w-full">
        Hapus elemen
      </DangerButton>
    </div>
  );
}
