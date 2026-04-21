// ── Shared market-benchmark notes ────────────────────────────────────────────
// Both the Pricing Admin rate grid and the live Pricing Case chart need to
// read/write the same local-only pool of market intel notes. The data lives
// in localStorage (these are personal observations, not a shared team asset)
// and is keyed by one of two shapes:
//
//   • Cell notes  — `${region}::${tier.label}`   e.g. "Italy::Tier 1 (MBB)"
//   • Tier notes  — `__tier__::${tier.label}`    e.g. "__tier__::Tier 1 (MBB)"
//                   (general commentary about the whole tier, not a country)
//
// Each key maps to an ORDERED ARRAY of notes — users accumulate multiple
// observations over time (different sources, different dates) and we never
// silently collapse them. Older note shape (v1 = single string) is migrated
// transparently on first load.

import { useCallback, useEffect, useState } from "react";

export interface BenchmarkNote {
  id: string;            // short random id, stable across edits
  text: string;
  created_at: string;    // ISO
  updated_at?: string;   // ISO, present only if the note was edited
}

export type BenchmarkNotesMap = Record<string, BenchmarkNote[]>;

const STORAGE_KEY_V2 = "pricing_benchmark_notes_v2";
const STORAGE_KEY_V1 = "pricing_benchmark_notes_v1"; // legacy (single string per key)

export const cellKey = (region: string, tierLabel: string) => `${region}::${tierLabel}`;
export const tierKey = (tierLabel: string) => `__tier__::${tierLabel}`;
export const isTierKey = (key: string) => key.startsWith("__tier__::");

function randomId(): string {
  // localStorage-only; doesn't need crypto-strength uniqueness.
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Read-and-migrate: if only v1 exists, wrap each string as a 1-item array and
 *  persist under v2. Returns the v2 map. Pure — safe to call repeatedly. */
function loadAndMigrate(): BenchmarkNotesMap {
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (parsed && typeof parsed === "object") return parsed as BenchmarkNotesMap;
    }
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (!rawV1) return {};
    const legacy: Record<string, string> = JSON.parse(rawV1);
    const migrated: BenchmarkNotesMap = {};
    for (const [k, text] of Object.entries(legacy)) {
      if (typeof text === "string" && text.trim()) {
        migrated[k] = [{ id: randomId(), text: text.trim(), created_at: new Date().toISOString() }];
      }
    }
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(migrated));
    return migrated;
  } catch {
    return {};
  }
}

function persist(map: BenchmarkNotesMap) {
  try { localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(map)); } catch { /* quota */ }
}

/** Subscribe to cross-tab + cross-component updates. All consumers use the
 *  same `window.dispatchEvent` channel so edits in one tab/component reflect
 *  live in the other without a page reload. */
const BUS_EVENT = "benchmark-notes-updated";

export function useBenchmarkNotes() {
  const [notes, setNotes] = useState<BenchmarkNotesMap>(() => loadAndMigrate());

  useEffect(() => {
    const handler = () => setNotes(loadAndMigrate());
    window.addEventListener(BUS_EVENT, handler);
    // Also listen to storage events for cross-tab sync
    window.addEventListener("storage", (e) => {
      if (e.key === STORAGE_KEY_V2) handler();
    });
    return () => {
      window.removeEventListener(BUS_EVENT, handler);
    };
  }, []);

  const writeAndNotify = useCallback((updater: (prev: BenchmarkNotesMap) => BenchmarkNotesMap) => {
    setNotes(prev => {
      const next = updater(prev);
      persist(next);
      window.dispatchEvent(new Event(BUS_EVENT));
      return next;
    });
  }, []);

  const addNote = useCallback((key: string, text: string) => {
    const t = text.trim();
    if (!t) return;
    writeAndNotify(prev => {
      const list = prev[key] ?? [];
      const newNote: BenchmarkNote = { id: randomId(), text: t, created_at: new Date().toISOString() };
      return { ...prev, [key]: [...list, newNote] };
    });
  }, [writeAndNotify]);

  const updateNote = useCallback((key: string, id: string, text: string) => {
    const t = text.trim();
    writeAndNotify(prev => {
      const list = prev[key] ?? [];
      // Empty text = delete (keeps the UI consistent with the trash button)
      const nextList = t
        ? list.map(n => n.id === id ? { ...n, text: t, updated_at: new Date().toISOString() } : n)
        : list.filter(n => n.id !== id);
      if (nextList.length === 0) {
        const { [key]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: nextList };
    });
  }, [writeAndNotify]);

  const deleteNote = useCallback((key: string, id: string) => {
    writeAndNotify(prev => {
      const list = prev[key] ?? [];
      const nextList = list.filter(n => n.id !== id);
      if (nextList.length === 0) {
        const { [key]: _dropped, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: nextList };
    });
  }, [writeAndNotify]);

  const countFor = useCallback((key: string) => (notes[key]?.length ?? 0), [notes]);

  return { notes, addNote, updateNote, deleteNote, countFor };
}
