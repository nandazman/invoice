import type { OrderItem } from "./types";

// ---------- Canvas geometry ----------
// Design coordinate system = A4 portrait at 96 DPI.
// 210mm ≈ 794px, 297mm ≈ 1123px. Elements are stored in these px units.
export const PAGE_W = 794;
export const PAGE_H = 1123;

export const LOGO_MAX_W = 120;
export const LOGO_MAX_H = 60;
export const PHOTO_MAX = 800; // max edge for non-logo images

// ---------- Elements ----------
export type ElementType =
  | "text"
  | "image"
  | "logo" // renders template.business.logo
  | "field"
  | "items"
  | "total"
  | "line";

// Default gray "LOGO" placeholder (inline SVG, sized to the logo cap).
export const PLACEHOLDER_LOGO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${LOGO_MAX_W}" height="${LOGO_MAX_H}">` +
      `<rect width="100%" height="100%" rx="6" fill="#e2e8f0"/>` +
      `<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#64748b">LOGO</text>` +
      `</svg>`,
  );

export interface TextStyle {
  fontSize: number;
  fontWeight: number; // 400 | 600 | 700
  italic: boolean;
  align: "left" | "center" | "right";
  color: string;
  bg: string | null; // background color, null = transparent
}

// A Field element carries its own definition: a title and a data type. Every
// field element becomes an input on the Buat Invoice page, keyed by its title
// (so the same title placed twice shares one value).
export type FieldType = "text" | "number" | "date" | "select";

// Normalized key used to group/collect field values by title.
export function fieldKey(label: string): string {
  return label.trim().toLowerCase();
}

// Default fields seeded into every new template — editable/removable.
export function defaultFields(): { label: string; type: FieldType }[] {
  return [
    { label: "No. Invoice", type: "text" },
    { label: "Tanggal Terbit", type: "date" },
    { label: "Jatuh Tempo", type: "date" },
  ];
}

export type ItemColumnKey =
  | "tanggal"
  | "namaProduk"
  | "satuan"
  | "kuantitas"
  | "hargaSatuan"
  | "totalHarga";

export interface ItemColumn {
  key: ItemColumnKey;
  label: string;
  visible: boolean;
}

export interface TemplateElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  style: TextStyle;
  content?: string; // text
  src?: string; // image dataURL
  fieldLabel?: string; // field title, e.g. "No. Invoice"
  fieldType?: FieldType; // field data type
  fieldOptions?: string[]; // choices when fieldType === "select"
  columns?: ItemColumn[]; // items table
}

export interface Template {
  id: string;
  nama: string;
  business: { nama: string; alamat: string; telepon: string; logo: string | null };
  customer: { nama: string; alamat: string };
  elements: TemplateElement[];
  createdAt: string;
  updatedAt: string;
}

// Data injected into a template at generation time.
export interface InvoiceData {
  items: OrderItem[];
  total: number;
  fields: Record<string, string>; // field values, keyed by fieldKey(title)
}

export function defaultStyle(): TextStyle {
  return {
    fontSize: 14,
    fontWeight: 400,
    italic: false,
    align: "left",
    color: "#0f172a",
    bg: null,
  };
}

export function defaultColumns(): ItemColumn[] {
  return [
    { key: "tanggal", label: "Tanggal", visible: false },
    { key: "namaProduk", label: "Produk", visible: true },
    { key: "satuan", label: "Satuan", visible: true },
    { key: "kuantitas", label: "Qty", visible: true },
    { key: "hargaSatuan", label: "Harga", visible: true },
    { key: "totalHarga", label: "Total", visible: true },
  ];
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Teks",
  number: "Angka",
  date: "Tanggal",
  select: "Dropdown",
};
