import type { Template, TemplateElement } from "./template-types";
import {
  PAGE_W,
  LOGO_MAX_W,
  LOGO_MAX_H,
  PLACEHOLDER_LOGO,
  defaultStyle,
  defaultColumns,
} from "./template-types";
import { uid, nowISO } from "./format";

// The starter template, split out of template-store.ts so that db.ts can reach
// it without importing the store — template-store imports db, so the seed had
// to move to a leaf or the two would form a cycle.
//
// It lives here rather than in template-types.ts because it is DATA, not shape:
// nothing type-level needs it, and every consumer wants exactly one of the two
// functions below.
//
// ---------- Seed: one ready-to-use example template ----------
export function el(e: Partial<TemplateElement> & Pick<TemplateElement, "type">): TemplateElement {
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

export function seedTemplate(): Template {
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
