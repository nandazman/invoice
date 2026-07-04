import type { CSSProperties } from "react";
import type {
  InvoiceData,
  Template,
  TemplateElement,
  TextStyle,
} from "../../lib/template-types";
import { fieldKey } from "../../lib/template-types";
import {
  formatRupiah,
  formatAngka,
  formatTanggalID,
} from "../../lib/format";

// Replace {{business.x}} / {{customer.x}} tokens with values from the template.
function resolveText(text: string, t: Template): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    switch (key) {
      case "business.nama":
        return t.business.nama;
      case "business.alamat":
        return t.business.alamat;
      case "business.telepon":
        return t.business.telepon;
      case "customer.nama":
        return t.customer.nama;
      case "customer.alamat":
        return t.customer.alamat;
      default:
        return `{{${key}}}`;
    }
  });
}

export function styleToCss(s: TextStyle): CSSProperties {
  return {
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    fontStyle: s.italic ? "italic" : "normal",
    textAlign: s.align,
    color: s.color,
    background: s.bg ?? undefined,
  };
}

function fieldValue(el: TemplateElement, data: InvoiceData | null): string {
  const label = el.fieldLabel ?? "";
  if (!label) return "";
  if (!data) return `(${label})`; // editor placeholder
  const raw = data.fields?.[fieldKey(label)] ?? "";
  if (!raw) return "—";
  if (el.fieldType === "date") return formatTanggalID(raw);
  if (el.fieldType === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? formatAngka(n) : raw;
  }
  return raw;
}

// Sample rows shown in the editor so the items table has visible content.
const SAMPLE_ROWS = [
  { tanggal: "2026-06-01", namaProduk: "Contoh Produk A", satuan: "box", kuantitas: 2, hargaSatuan: 50000, totalHarga: 100000 },
  { tanggal: "2026-06-02", namaProduk: "Contoh Produk B", satuan: "pcs", kuantitas: 5, hargaSatuan: 12000, totalHarga: 60000 },
];

function cellValue(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (key === "tanggal") return formatTanggalID(String(v));
  if (key === "kuantitas") return formatAngka(Number(v));
  if (key === "hargaSatuan" || key === "totalHarga") return formatRupiah(Number(v));
  return String(v ?? "");
}

export function ElementContent({
  el,
  template,
  data,
}: {
  el: TemplateElement;
  template: Template;
  data: InvoiceData | null;
}) {
  const css = styleToCss(el.style);

  if (el.type === "text") {
    return (
      <div style={{ ...css, whiteSpace: "pre-wrap", lineHeight: 1.35, width: "100%", height: "100%" }}>
        {resolveText(el.content ?? "", template)}
      </div>
    );
  }

  if (el.type === "logo") {
    const src = template.business.logo;
    if (!src) {
      return (
        <div className="w-full h-full grid place-items-center text-xs text-slate-400 border border-dashed border-slate-300">
          Logo
        </div>
      );
    }
    return <img src={src} alt="logo" className="w-full h-full object-contain" />;
  }

  if (el.type === "image") {
    if (!el.src) {
      return (
        <div className="w-full h-full grid place-items-center text-xs text-slate-400 border border-dashed border-slate-300">
          Gambar
        </div>
      );
    }
    return <img src={el.src} alt="" className="w-full h-full object-contain" />;
  }

  if (el.type === "line") {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center" }}>
        <div style={{ width: "100%", borderTop: `2px solid ${el.style.color}` }} />
      </div>
    );
  }

  if (el.type === "field") {
    return (
      <div style={{ ...css, width: "100%", height: "100%" }}>
        <span style={{ fontWeight: 700 }}>{el.fieldLabel ?? ""}: </span>
        {fieldValue(el, data)}
      </div>
    );
  }

  if (el.type === "total") {
    const total = data ? data.total : 160000;
    return (
      <div style={{ ...css, width: "100%", height: "100%" }}>
        <span>TOTAL: </span>
        {formatRupiah(total)}
      </div>
    );
  }

  if (el.type === "items") {
    const cols = (el.columns ?? []).filter((c) => c.visible);
    const rows = data ? data.items : SAMPLE_ROWS;
    return (
      <table
        style={{ ...css, width: "100%", borderCollapse: "collapse" }}
        className="tabular-nums"
      >
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign:
                    c.key === "kuantitas" || c.key === "hargaSatuan" || c.key === "totalHarga"
                      ? "right"
                      : "left",
                  borderBottom: "2px solid #334155",
                  padding: "4px 6px",
                  fontWeight: 700,
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td
                  key={c.key}
                  style={{
                    textAlign:
                      c.key === "kuantitas" || c.key === "hargaSatuan" || c.key === "totalHarga"
                        ? "right"
                        : "left",
                    borderBottom: "1px solid #e2e8f0",
                    padding: "4px 6px",
                  }}
                >
                  {cellValue(row as Record<string, unknown>, c.key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return null;
}
