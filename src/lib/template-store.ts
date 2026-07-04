import { useSyncExternalStore } from "react";
import type { Template, TemplateElement } from "./template-types";
import {
  PAGE_W,
  LOGO_MAX_W,
  LOGO_MAX_H,
  PLACEHOLDER_LOGO,
  defaultStyle,
  defaultColumns,
  defaultFields,
} from "./template-types";
import { uid, nowISO } from "./format";

const TEMPLATES_KEY = "invoice.templates.v1";

function read(): Template[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    if (raw == null) return [];
    return JSON.parse(raw) as Template[];
  } catch {
    return [];
  }
}

function write(list: Template[]): void {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list));
  } catch (e) {
    // Most likely QuotaExceededError — surface it so the user knows the save failed.
    alert(
      "Gagal menyimpan template. Penyimpanan browser penuh — coba kecilkan/hapus gambar.",
    );
    throw e;
  }
}

// ---------- Seed: one ready-to-use example template ----------
function el(e: Partial<TemplateElement> & Pick<TemplateElement, "type">): TemplateElement {
  const { style, ...rest } = e;
  return {
    id: uid(),
    x: 40,
    y: 40,
    w: 200,
    h: 40,
    z: 1,
    ...rest,
    style: { ...defaultStyle(), ...style },
  };
}

function seedTemplate(): Template {
  const now = nowISO();
  return {
    id: uid(),
    nama: "Template Contoh",
    business: {
      nama: "Toko Saya",
      alamat: "Jl. Contoh No. 1, Jakarta",
      telepon: "0812-3456-7890",
      logo: PLACEHOLDER_LOGO,
    },
    customer: { nama: "Pelanggan", alamat: "Alamat pelanggan" },
    elements: [
      el({
        type: "logo",
        x: 40,
        y: 40,
        w: LOGO_MAX_W,
        h: LOGO_MAX_H,
        z: 6,
      }),
      el({
        type: "text",
        content: "INVOICE",
        x: 40 + LOGO_MAX_W + 20, // beside the logo
        y: 48,
        w: 300,
        h: 44,
        z: 5,
        style: { ...defaultStyle(), fontSize: 36, fontWeight: 700 },
      }),
      el({
        type: "text",
        content: "{{business.nama}}\n{{business.alamat}}\n{{business.telepon}}",
        x: PAGE_W - 300 - 40,
        y: 40,
        w: 300,
        h: 70,
        z: 5,
        style: { ...defaultStyle(), align: "right", fontSize: 12, color: "#475569" },
      }),
      el({
        type: "text",
        content: "Ditagihkan kepada:\n{{customer.nama}}\n{{customer.alamat}}",
        x: 40,
        y: 130,
        w: 300,
        h: 70,
        z: 5,
        style: { ...defaultStyle(), fontSize: 12 },
      }),
      el({
        type: "field",
        fieldLabel: "No. Invoice",
        fieldType: "text",
        x: PAGE_W - 240 - 40,
        y: 130,
        w: 240,
        h: 24,
        z: 5,
        style: { ...defaultStyle(), align: "right", fontSize: 12 },
      }),
      el({
        type: "field",
        fieldLabel: "Tanggal Terbit",
        fieldType: "date",
        x: PAGE_W - 240 - 40,
        y: 158,
        w: 240,
        h: 24,
        z: 5,
        style: { ...defaultStyle(), align: "right", fontSize: 12 },
      }),
      el({
        type: "field",
        fieldLabel: "Jatuh Tempo",
        fieldType: "date",
        x: PAGE_W - 240 - 40,
        y: 186,
        w: 240,
        h: 24,
        z: 5,
        style: { ...defaultStyle(), align: "right", fontSize: 12 },
      }),
      el({
        type: "items",
        x: 40,
        y: 240,
        w: PAGE_W - 80,
        h: 300,
        z: 3,
        columns: defaultColumns(),
        style: { ...defaultStyle(), fontSize: 12 },
      }),
      el({
        type: "total",
        x: PAGE_W - 280 - 40,
        y: 560,
        w: 280,
        h: 40,
        z: 5,
        style: { ...defaultStyle(), fontSize: 16, fontWeight: 700, align: "right" },
      }),
      el({
        type: "text",
        content: "Terima kasih atas pesanan Anda.",
        x: 40,
        y: 640,
        w: 400,
        h: 24,
        z: 5,
        style: { ...defaultStyle(), fontSize: 12, italic: true, color: "#475569" },
      }),
    ],
    createdAt: now,
    updatedAt: now,
  };
}

// Ensure older templates (saved before the logo feature) have a logo image and
// a logo box on the canvas, so there is always somewhere to manage the logo.
// Map a legacy field element's `bind` to the new fieldLabel/fieldType shape.
const LEGACY_BIND: Record<string, { label: string; type: "text" | "date" }> = {
  "invoice.number": { label: "No. Invoice", type: "text" },
  "invoice.issued": { label: "Tanggal Terbit", type: "date" },
  "invoice.due": { label: "Jatuh Tempo", type: "date" },
};

// Ensure older templates have a logo, and migrate legacy `bind` fields to the
// self-describing fieldLabel/fieldType shape.
function migrate(list: Template[]): { list: Template[]; changed: boolean } {
  let changed = false;
  const out = list.map((t) => {
    let business = t.business;
    let elements = t.elements;
    if (!business.logo) {
      business = { ...business, logo: PLACEHOLDER_LOGO };
      changed = true;
    }
    // Convert legacy field bindings.
    if (elements.some((e) => e.type === "field" && e.fieldLabel === undefined)) {
      elements = elements.map((e) => {
        if (e.type !== "field" || e.fieldLabel !== undefined) return e;
        const bind = (e as { bind?: string }).bind ?? "";
        const map = LEGACY_BIND[bind] ?? { label: "Field", type: "text" as const };
        return { ...e, fieldLabel: map.label, fieldType: map.type };
      });
      changed = true;
    }
    if (!elements.some((e) => e.type === "logo")) {
      const maxZ = elements.reduce((m, e) => Math.max(m, e.z), 0);
      elements = [
        ...elements,
        el({ type: "logo", x: 40, y: 40, w: LOGO_MAX_W, h: LOGO_MAX_H, z: maxZ + 1 }),
      ];
      changed = true;
    }
    return business === t.business && elements === t.elements
      ? t
      : { ...t, business, elements };
  });
  return { list: out, changed };
}

let templates: Template[] = (() => {
  const existing = read();
  if (existing.length === 0) {
    const seeded = [seedTemplate()];
    write(seeded);
    return seeded;
  }
  const { list, changed } = migrate(existing);
  if (changed) write(list);
  return list;
})();

const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useTemplates(): Template[] {
  return useSyncExternalStore(subscribe, () => templates);
}

export function getTemplates(): Template[] {
  return templates;
}

function setTemplates(next: Template[]): void {
  templates = next;
  write(next);
  emit();
}

export function createTemplate(): Template {
  const now = nowISO();
  const t: Template = {
    id: uid(),
    nama: "Template Baru",
    business: { nama: "", alamat: "", telepon: "", logo: PLACEHOLDER_LOGO },
    customer: { nama: "", alamat: "" },
    elements: [
      el({ type: "logo", x: 40, y: 40, w: LOGO_MAX_W, h: LOGO_MAX_H, z: 1 }),
      ...defaultFields().map((f, i) =>
        el({
          type: "field",
          fieldLabel: f.label,
          fieldType: f.type,
          x: 40,
          y: 120 + i * 30,
          w: 240,
          h: 24,
          z: 2 + i,
          style: { ...defaultStyle(), fontSize: 12 },
        }),
      ),
    ],
    createdAt: now,
    updatedAt: now,
  };
  setTemplates([...templates, t]);
  return t;
}

export function duplicateTemplate(id: string): Template | null {
  const src = templates.find((t) => t.id === id);
  if (!src) return null;
  const now = nowISO();
  const copy: Template = {
    ...structuredClone(src),
    id: uid(),
    nama: `${src.nama} (salinan)`,
    createdAt: now,
    updatedAt: now,
  };
  setTemplates([...templates, copy]);
  return copy;
}

export function saveTemplate(t: Template): void {
  const now = nowISO();
  setTemplates(
    templates.map((x) =>
      x.id === t.id ? { ...t, createdAt: x.createdAt, updatedAt: now } : x,
    ),
  );
}

export function deleteTemplate(id: string): void {
  setTemplates(templates.filter((t) => t.id !== id));
}
