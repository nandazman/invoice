import { useEffect, useRef, useState } from "react";
import type { Template, TemplateElement, ElementType } from "../lib/template-types";
import {
  PAGE_W,
  LOGO_MAX_W,
  LOGO_MAX_H,
  defaultStyle,
  defaultColumns,
} from "../lib/template-types";
import {
  useTemplates,
  createTemplate,
  duplicateTemplate,
  saveTemplate,
  deleteTemplate,
} from "../lib/template-store";
import { uid } from "../lib/format";
import { Canvas } from "../components/template/Canvas";
import { Inspector } from "../components/template/Inspector";
import { Panel } from "../components/Panel";
import { Select } from "../components/Select";
import { Button, PrimaryButton, DangerButton } from "../components/Button";

export function TemplatePage() {
  const templates = useTemplates();
  const [activeId, setActiveId] = useState<string | null>(templates[0]?.id ?? null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  // ---------- Undo / redo history ----------
  // Snapshots of the draft. A burst of rapid edits (e.g. a single drag) is
  // coalesced into one history entry via the debounce in scheduleCommit().
  const history = useRef<{ past: Template[]; future: Template[] }>({ past: [], future: [] });
  const baseline = useRef<Template | null>(null); // state before the current burst
  const baselineSet = useRef(false);
  const commitTimer = useRef<number | null>(null);
  const [, bump] = useState(0); // force re-render for undo/redo button state

  function flushHistory() {
    if (commitTimer.current) {
      window.clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    if (baselineSet.current && baseline.current) {
      history.current.past.push(baseline.current);
      history.current.future = [];
    }
    baseline.current = null;
    baselineSet.current = false;
  }

  function scheduleCommit() {
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      flushHistory();
      bump((n) => n + 1);
    }, 400);
  }

  // Apply a change, recording the pre-change state as a history baseline.
  // Baseline is captured inside the updater so this works from any closure
  // (e.g. keyboard handlers) without depending on the current `draft`.
  function update(mutator: (d: Template) => Template) {
    setDraft((prev) => {
      if (!prev) return prev;
      if (!baselineSet.current) {
        baseline.current = prev;
        baselineSet.current = true;
      }
      return mutator(prev);
    });
    scheduleCommit();
  }

  function undo() {
    flushHistory();
    const h = history.current;
    setDraft((cur) => {
      if (!cur || h.past.length === 0) return cur;
      h.future.push(cur);
      return h.past.pop()!;
    });
    setSelectedId(null);
    bump((n) => n + 1);
  }

  function redo() {
    const h = history.current;
    setDraft((cur) => {
      if (!cur || h.future.length === 0) return cur;
      h.past.push(cur);
      return h.future.pop()!;
    });
    setSelectedId(null);
    bump((n) => n + 1);
  }

  // Load the active template into a local working draft.
  useEffect(() => {
    const id = activeId ?? templates[0]?.id ?? null;
    const t = templates.find((x) => x.id === id) ?? templates[0] ?? null;
    if (t && (!draft || draft.id !== t.id)) {
      setDraft(structuredClone(t));
      setActiveId(t.id);
      setSelectedId(null);
      // Reset history for the newly loaded template.
      history.current = { past: [], future: [] };
      baseline.current = null;
      baselineSet.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, templates]);

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z or Ctrl+Y = redo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ae = document.activeElement as HTMLElement | null;
      const typing =
        ae?.tagName === "INPUT" ||
        ae?.tagName === "TEXTAREA" ||
        ae?.isContentEditable;

      // Delete / Backspace removes the selected element (unless typing).
      if ((e.key === "Delete" || e.key === "Backspace") && !typing) {
        if (selectedIdRef.current) {
          e.preventDefault();
          deleteElement(selectedIdRef.current);
        }
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced auto-save of the working draft.
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!draft) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveTemplate(draft), 400);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [draft]);

  if (!draft) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Desain Template</h1>
        <Panel>
          <p className="text-slate-500 mb-3">Belum ada template.</p>
          <PrimaryButton onClick={() => setActiveId(createTemplate().id)}>
            Buat Template
          </PrimaryButton>
        </Panel>
      </div>
    );
  }

  const selected = draft.elements.find((e) => e.id === selectedId) ?? null;

  function patchTemplate(patch: Partial<Template>) {
    update((d) => ({ ...d, ...patch }));
  }

  function patchElement(id: string, patch: Partial<TemplateElement>) {
    update((d) => ({
      ...d,
      elements: d.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }

  function addElement(type: ElementType) {
    const maxZ = draft!.elements.reduce((m, e) => Math.max(m, e.z), 0);
    const base: TemplateElement = {
      id: uid(),
      type,
      x: 60,
      y: 60,
      w: 220,
      h: 40,
      z: maxZ + 1,
      style: defaultStyle(),
    };
    if (type === "text") base.content = "Teks baru";
    if (type === "field") {
      base.fieldLabel = "Field Baru";
      base.fieldType = "text";
    }
    if (type === "items") {
      base.w = PAGE_W - 120;
      base.h = 200;
      base.columns = defaultColumns();
    }
    if (type === "total") {
      base.w = 280;
      base.style = { ...defaultStyle(), fontWeight: 700, fontSize: 16, align: "right" };
    }
    if (type === "line") base.h = 8;
    if (type === "image" || type === "logo") {
      base.w = LOGO_MAX_W;
      base.h = LOGO_MAX_H;
    }
    update((d) => ({ ...d, elements: [...d.elements, base] }));
    setSelectedId(base.id);
  }

  function deleteElement(id: string) {
    update((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== id) }));
    setSelectedId(null);
  }

  function duplicateElement(id: string) {
    const src = draft!.elements.find((e) => e.id === id);
    if (!src) return;
    const maxZ = draft!.elements.reduce((m, e) => Math.max(m, e.z), 0);
    const copy = {
      ...structuredClone(src),
      id: uid(),
      x: src.x + 16,
      y: src.y + 16,
      z: maxZ + 1,
    };
    update((d) => ({ ...d, elements: [...d.elements, copy] }));
    setSelectedId(copy.id);
  }

  function bringFront(id: string) {
    const maxZ = draft!.elements.reduce((m, e) => Math.max(m, e.z), 0);
    patchElement(id, { z: maxZ + 1 });
  }
  function sendBack(id: string) {
    const minZ = draft!.elements.reduce((m, e) => Math.min(m, e.z), 0);
    patchElement(id, { z: minZ - 1 });
  }

  // Persist the current draft before changing which template is active, so
  // pending (debounced) edits aren't lost and clones use the latest data.
  function switchTemplate(id: string | null) {
    flushHistory();
    if (draft) saveTemplate(draft);
    setActiveId(id);
  }

  function handleNew() {
    if (draft) saveTemplate(draft);
    switchTemplate(createTemplate().id);
  }

  function handleDuplicate() {
    if (draft) saveTemplate(draft);
    const copy = duplicateTemplate(draft!.id);
    switchTemplate(copy?.id ?? null);
  }

  function handleDelete() {
    if (!confirm(`Hapus template "${draft!.nama}"?`)) return;
    deleteTemplate(draft!.id);
    const next = templates.find((t) => t.id !== draft!.id);
    setActiveId(next?.id ?? null);
    setDraft(null);
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <h1 className="text-2xl font-bold mr-2">Desain Template</h1>
        <Select
          value={draft.id}
          onChange={(e) => switchTemplate(e.target.value)}
          className="w-auto"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nama}
            </option>
          ))}
        </Select>
        <Button onClick={handleNew}>+ Baru</Button>
        <Button onClick={handleDuplicate}>Duplikat</Button>
        <DangerButton onClick={handleDelete}>Hapus</DangerButton>
        <span className="text-xs text-slate-400 ml-auto">Tersimpan otomatis</span>
      </div>

      <div className="flex gap-2 flex-wrap mb-3 items-center">
        <Button
          size="sm"
          onClick={undo}
          disabled={history.current.past.length === 0 && baseline.current === null}
          title="Urungkan (Ctrl+Z)"
        >
          ↶ Urungkan
        </Button>
        <Button
          size="sm"
          onClick={redo}
          disabled={history.current.future.length === 0}
          title="Ulangi (Ctrl+Shift+Z)"
        >
          ↷ Ulangi
        </Button>
        <span className="w-px h-5 bg-slate-200 mx-1" />
        <Button size="sm" onClick={() => addElement("text")}>+ Teks</Button>
        <Button size="sm" onClick={() => addElement("image")}>+ Gambar</Button>
        <Button
          size="sm"
          onClick={() => addElement("logo")}
          disabled={!draft.business.logo}
          title={draft.business.logo ? "" : "Atur logo dulu di Pengaturan Template"}
        >
          + Logo
        </Button>
        <Button size="sm" onClick={() => addElement("field")}>+ Field</Button>
        <Button size="sm" onClick={() => addElement("items")}>+ Item Pesanan</Button>
        <Button size="sm" onClick={() => addElement("total")}>+ Total</Button>
        <Button size="sm" onClick={() => addElement("line")}>+ Garis</Button>
      </div>

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 bg-slate-100 rounded-xl p-4">
          <Canvas
            template={draft}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={(id, box) => patchElement(id, box)}
          />
        </div>
        <div className="w-72 shrink-0 bg-white border border-slate-200 rounded-xl p-4 sticky top-4">
          <Inspector
            template={draft}
            selected={selected}
            onTemplateChange={patchTemplate}
            onElementChange={patchElement}
            onDelete={deleteElement}
            onDuplicate={duplicateElement}
            onBringFront={bringFront}
            onSendBack={sendBack}
            onShowSettings={() => setSelectedId(null)}
          />
        </div>
      </div>
    </div>
  );
}
