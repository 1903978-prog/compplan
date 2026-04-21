// ── Benchmark notes editor ──────────────────────────────────────────────────
// Compact editor used by BOTH the Pricing Admin rate grid and the live
// Pricing Case chart. Given a notes-map key, shows the existing list (each
// with inline edit/delete) and a single "add new" textarea at the bottom.
// Collapsed-by-default — the parent decides when to render it.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Check, Pencil, X, Plus } from "lucide-react";
import type { BenchmarkNote } from "@/lib/benchmarkNotes";

interface Props {
  title: string;                    // shown at the top of the editor
  placeholder?: string;             // placeholder for the "new note" textarea
  notes: BenchmarkNote[];
  onAdd: (text: string) => void;
  onUpdate: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onClose?: () => void;             // optional — lets parent close the panel
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
  } catch { return ""; }
}

export function BenchmarkNotesEditor({ title, placeholder, notes, onAdd, onUpdate, onDelete, onClose }: Props) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const submitNew = () => {
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft("");
  };

  return (
    <div className="space-y-2.5 p-3 rounded border border-amber-300 bg-amber-50/60">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-wide text-amber-900">
          {title}
          <span className="font-normal text-amber-800/70 ml-2">
            {notes.length} note{notes.length !== 1 ? "s" : ""}
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-amber-800/60 hover:text-amber-900 p-0.5" title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Existing notes list */}
      {notes.length > 0 && (
        <div className="space-y-1.5">
          {notes.map(n => {
            const isEditingThis = editingId === n.id;
            if (isEditingThis) {
              return (
                <div key={n.id} className="rounded bg-background border border-amber-300 p-1.5 space-y-1">
                  <Textarea
                    value={editDraft}
                    onChange={e => setEditDraft(e.target.value)}
                    className="text-[11px] min-h-[60px]"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === "Escape") { setEditingId(null); setEditDraft(""); }
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        onUpdate(n.id, editDraft);
                        setEditingId(null);
                        setEditDraft("");
                      }
                    }}
                  />
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2"
                      onClick={() => { setEditingId(null); setEditDraft(""); }}>
                      Cancel
                    </Button>
                    <Button size="sm" className="h-6 text-[10px] px-2"
                      onClick={() => { onUpdate(n.id, editDraft); setEditingId(null); setEditDraft(""); }}>
                      <Check className="w-3 h-3 mr-1" /> Save
                    </Button>
                  </div>
                </div>
              );
            }
            return (
              <div key={n.id} className="group rounded bg-background border border-amber-200 p-1.5 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] whitespace-pre-wrap text-amber-950 leading-snug">{n.text}</div>
                  <div className="text-[9px] text-amber-800/60 mt-0.5">
                    {fmtDate(n.created_at)}
                    {n.updated_at && ` · edited ${fmtDate(n.updated_at)}`}
                  </div>
                </div>
                <div className="flex gap-0.5 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { setEditingId(n.id); setEditDraft(n.text); }}
                    className="p-1 rounded hover:bg-amber-100 text-amber-800"
                    title="Edit"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onDelete(n.id)}
                    className="p-1 rounded hover:bg-red-50 text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add new note */}
      <div className="space-y-1">
        <Textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={placeholder ?? "Paste new market intel…"}
          className="text-[11px] min-h-[60px] bg-background"
          onKeyDown={e => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitNew();
            if (e.key === "Escape" && onClose) onClose();
          }}
        />
        <div className="flex justify-between items-center">
          <span className="text-[9px] text-amber-800/70 italic">
            Ctrl+Enter to add · notes are saved locally
          </span>
          <Button size="sm" onClick={submitNew} disabled={!draft.trim()} className="h-6 text-[10px] px-2">
            <Plus className="w-3 h-3 mr-1" /> Add note
          </Button>
        </div>
      </div>
    </div>
  );
}
