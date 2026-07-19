import { useEffect, useMemo, useState } from "react";
import type { LineItem } from "../lib/types";
import { buildOrdersText } from "../lib/orderText";
import { Button, PrimaryButton } from "./Button";
import { Modal } from "./Modal";

interface Props {
  items: LineItem[];
  title: string;
  showPrice: boolean;
  onShowPriceChange: (v: boolean) => void;
  onClose: () => void;
}

// Preview of the plain-text export before it lands on the clipboard. showPrice
// is owned by the page (the XLSX and image exports read the same value), so it
// arrives as a prop and is written straight back — the dialog keeps no copy.
export function CopyTextDialog({
  items,
  title,
  showPrice,
  onShowPriceChange,
  onClose,
}: Props) {
  const text = useMemo(
    () => buildOrdersText(items, { title, showPrice }),
    [items, title, showPrice],
  );
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  // Reset the transient label whenever the text changes underneath it, so a
  // stale "✓ Tersalin" never describes something other than what's shown.
  useEffect(() => setCopyState("idle"), [text]);

  async function copy() {
    // Fails on non-secure origins (no navigator.clipboard at all) and when the
    // permission is denied — both surface as the error label.
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 2500);
    }
  }

  return (
    <Modal
      onClose={onClose}
      className="bg-white rounded-xl p-5 w-full max-w-2xl max-h-[90vh] overflow-auto"
    >
        <h2 className="text-xl font-bold mb-1">Salin Teks</h2>
        <p className="text-slate-500 mb-4">
          Pratinjau teks yang akan disalin — {items.length} item.
        </p>

        <textarea
          readOnly
          value={text}
          rows={14}
          className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-md bg-slate-50 text-slate-700 resize-y focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
        />

        <div className="flex items-center gap-3 mt-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showPrice}
              onChange={(e) => onShowPriceChange(e.target.checked)}
            />
            Tampilkan harga
          </label>
          {copyState === "error" && (
            <span className="text-sm text-red-600">
              Gagal menyalin — salin manual dari kotak di atas.
            </span>
          )}
          <span className="flex-1" />
          <Button onClick={onClose}>Tutup</Button>
          <PrimaryButton onClick={copy} disabled={items.length === 0}>
            {copyState === "copied"
              ? "✓ Tersalin"
              : copyState === "error"
                ? "Gagal menyalin"
                : "Salin"}
          </PrimaryButton>
        </div>
    </Modal>
  );
}
