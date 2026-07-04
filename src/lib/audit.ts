import { useSyncExternalStore } from "react";
import type { AuditEntry } from "./types";
import { uid, nowISO } from "./format";
import { loadAudit, saveAudit } from "./storage";

let entries: AuditEntry[] = loadAudit();

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

export function useAudit(): AuditEntry[] {
  return useSyncExternalStore(subscribe, () => entries);
}

export function getAudit(): AuditEntry[] {
  return entries;
}

// Replace the whole log (used by Restore). No id regeneration.
export function setAudit(next: AuditEntry[]): void {
  entries = next;
  saveAudit(next);
  emit();
}

// Append one entry, stamping id + timestamp. This is the ONLY writer besides
// setAudit; the log is append-only during normal use.
export function logAudit(
  entry: Omit<AuditEntry, "id" | "timestamp">,
): void {
  const full: AuditEntry = { ...entry, id: uid(), timestamp: nowISO() };
  entries = [...entries, full];
  saveAudit(entries);
  emit();
}

// Field-level diff between two objects. Only keys in `fields` are compared;
// values that differ (by strict !==) become { field, from, to }.
export function diff<T extends object>(
  oldObj: T,
  newObj: T,
  fields: (keyof T)[],
): { field: string; from: unknown; to: unknown }[] {
  const out: { field: string; from: unknown; to: unknown }[] = [];
  for (const f of fields) {
    const from = oldObj[f];
    const to = newObj[f];
    if (!Object.is(from, to)) {
      out.push({ field: String(f), from, to });
    }
  }
  return out;
}
