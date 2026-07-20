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
import { db, persist, type Snapshot } from "./db";

// Templates were the store that actually hit the 5MB localStorage cap: logos and
// image elements are base64 data URLs (~33% larger than the bytes they encode),
// embedded in a JSON string, in an origin-wide 5MB budget shared with every
// other store. The QuotaExceededError alert that used to live here is gone —
// the bug it reported is what moving to IndexedDB fixes.

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
    deletedAt: null,
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
    // A bug in "send to back" produced negative z values, which made the
    // element invisible in the invoice preview (it painted behind the page
    // background). Lift the whole stack back to a non-negative range.
    const minZ = elements.reduce((m, e) => Math.min(m, e.z), 0);
    if (minZ < 0) {
      elements = elements.map((e) => ({ ...e, z: e.z - minZ }));
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

let templates: Template[] = [];

// Fill from the boot snapshot. Two legacy paths still run here:
//   - an empty store seeds the example template;
//   - `migrate()` fixes up older template shapes (missing logo, legacy `bind`
//     fields). Both persist only when they actually changed something.
export function hydrateTemplates(snap: Snapshot): void {
  if (snap.templates.length === 0) {
    const seeded = seedTemplate();
    templates = [seeded];
    persist("seedTemplate", () => db.templates.put(seeded));
  } else {
    const { list, changed } = migrate(snap.templates);
    templates = list;
    if (changed) persist("migrateTemplates", () => db.templates.bulkPut(list));
  }
  emit();
}

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

// Whole-table replace. Only correct for Restore, where the caller is replacing
// the entire dataset; `clear()` drops tombstones because a restore is an
// authoritative replacement, not a merge. Every other mutation writes one row.
export function setTemplates(next: Template[]): void {
  templates = next;
  emit();
  persist("setTemplates", () =>
    db.transaction("rw", db.templates, async () => {
      await db.templates.clear();
      await db.templates.bulkPut(next);
    }),
  );
}

// Insert-or-update ONE template.
function putTemplate(t: Template): void {
  const exists = templates.some((x) => x.id === t.id);
  templates = exists
    ? templates.map((x) => (x.id === t.id ? t : x))
    : [...templates, t];
  emit();
  persist("putTemplate", () => db.templates.put(t));
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
    deletedAt: null,
  };
  putTemplate(t);
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
    deletedAt: null,
  };
  putTemplate(copy);
  return copy;
}

export function saveTemplate(t: Template): void {
  const prev = templates.find((x) => x.id === t.id);
  if (!prev) return;
  putTemplate({
    ...t,
    createdAt: prev.createdAt,
    updatedAt: nowISO(),
    deletedAt: null,
  });
}

// Soft delete: the row stays in IndexedDB with a `deletedAt` and only leaves the
// in-memory list.
export function deleteTemplate(id: string): void {
  const prev = templates.find((t) => t.id === id);
  if (!prev) return;
  const now = nowISO();
  const row: Template = { ...prev, deletedAt: now, updatedAt: now };
  templates = templates.filter((t) => t.id !== id);
  emit();
  persist("deleteTemplate", () => db.templates.put(row));
}
