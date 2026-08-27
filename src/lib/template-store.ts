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
import { db, persist, touch, fresh, type Snapshot } from "./db";

// Templates were the store that actually hit the 5MB localStorage cap: logos and
// image elements are base64 data URLs (~33% larger than the bytes they encode),
// embedded in a JSON string, in an origin-wide 5MB budget shared with every
// other store. The QuotaExceededError alert that used to live here is gone —
// the bug it reported is what moving to IndexedDB fixes.


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

// Fill from the boot snapshot, running `migrate()` to fix up older template
// shapes (missing logo, legacy `bind` fields). It persists only when it
// actually changed something.
//
// It deliberately does NOT seed an example template into an empty store any
// more. That used to live here and was the same bug as the product catalogue,
// only worse: this function runs on every `rehydrate()` — after a pull, after a
// cross-tab broadcast — not just at boot, so "the table is empty" was answered
// over and over, each time with a fresh `uid()`. Two consequences, both of
// which people hit:
//
//   - a new device seeded its own "Template Contoh" before the first pull
//     arrived, so it ended up beside the cloud's copy instead of merging with
//     it — and then pushed, adding one per device, forever;
//   - deleting your last template resurrected it on the very next pull, and
//     published the resurrection.
//
// The seed is now deferred to `resolveSeed()` in db.ts, which runs once the
// cloud's answer is actually known. See SEED_PENDING_KEY there.
export function hydrateTemplates(snap: Snapshot): void {
  const { list, changed } = migrate(snap.templates);
  templates = list;
  if (changed) persist("migrateTemplates", () => db.templates.bulkPut(list));
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
//
// `fresh` for the same reason store.ts's bulk setters use it: the backup file
// carries whatever the server had stamped at export time, and replaying it is a
// local write the server has not seen. See the block above those setters.
export function setTemplates(next: Template[]): void {
  const rows = next.map(fresh);
  templates = rows;
  emit();
  persist("setTemplates", () =>
    db.transaction("rw", db.templates, async () => {
      await db.templates.clear();
      await db.templates.bulkPut(rows);
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

// Soft delete: the row stays in IndexedDB with a `deletedAt` and only leaves the
// in-memory list.
export function deleteTemplate(id: string): void {
  const prev = templates.find((t) => t.id === id);
  if (!prev) return;
  const now = nowISO();
  const row: Template = touch({ ...prev, deletedAt: now }, now);
  templates = templates.filter((t) => t.id !== id);
  emit();
  persist("deleteTemplate", () => db.templates.put(row));
}
