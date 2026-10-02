import { useSyncExternalStore } from "react";
import type { Template } from "./template-types";
import {
  LOGO_MAX_W,
  LOGO_MAX_H,
  PLACEHOLDER_LOGO,
  defaultStyle,
  defaultFields,
} from "./template-types";
import { el } from "./template-seed";
import { uid, nowISO } from "./format";
import { persist, touch, fresh, type Snapshot } from "./db";

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

// Fill from a snapshot, running `migrate()` to fix up older template shapes
// (missing logo, legacy `bind` fields). The fix-up is display-time only: it is
// not written back, and lands in D1 the next time someone saves the template.
export function hydrateTemplates(snap: Snapshot): void {
  templates = migrate(snap.templates).list;
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

// Insert-or-update ONE template.
function putTemplate(t: Template): void {
  const exists = templates.some((x) => x.id === t.id);
  templates = exists
    ? templates.map((x) => (x.id === t.id ? t : x))
    : [...templates, t];
  emit();
  persist("putTemplate", (b) => b.put("templates", t));
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
  const copy: Template = fresh({
    ...structuredClone(src),
    id: uid(),
    nama: `${src.nama} (salinan)`,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  putTemplate(copy);
  return copy;
}

export function saveTemplate(t: Template): void {
  const prev = templates.find((x) => x.id === t.id);
  if (!prev) return;
  putTemplate(touch({ ...t, createdAt: prev.createdAt, deletedAt: null }, nowISO()));
}

// Soft delete: the row stays in D1 with a `deletedAt` and only leaves the
// in-memory list.
export function deleteTemplate(id: string): void {
  const prev = templates.find((t) => t.id === id);
  if (!prev) return;
  const now = nowISO();
  const row: Template = touch({ ...prev, deletedAt: now }, now);
  templates = templates.filter((t) => t.id !== id);
  emit();
  persist("deleteTemplate", (b) => b.put("templates", row));
}
