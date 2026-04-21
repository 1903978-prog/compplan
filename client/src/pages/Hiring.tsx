import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, GripVertical, UserCheck, ChevronLeft, ChevronRight, RefreshCw, Lock, UserPlus } from "lucide-react";

// ─── Stage config ────────────────────────────────────────────────────────────

const STAGES = [
  {
    id: "potential",
    label: "Good Potential",
    color: "bg-blue-50 border-blue-200",
    header: "bg-blue-600",
    badge: "bg-blue-100 text-blue-800",
    dot: "bg-blue-400",
  },
  {
    id: "after_intro",
    label: "After Intro",
    color: "bg-violet-50 border-violet-200",
    header: "bg-violet-600",
    badge: "bg-violet-100 text-violet-800",
    dot: "bg-violet-400",
  },
  {
    id: "after_csi_asc",
    label: "After CSI ASC-EM",
    color: "bg-amber-50 border-amber-200",
    header: "bg-amber-500",
    badge: "bg-amber-100 text-amber-800",
    dot: "bg-amber-400",
  },
  {
    id: "after_csi_lm",
    label: "After CSI LM",
    color: "bg-emerald-50 border-emerald-200",
    header: "bg-emerald-600",
    badge: "bg-emerald-100 text-emerald-800",
    dot: "bg-emerald-400",
  },
  {
    id: "hired",
    label: "Hired",
    color: "bg-green-50 border-green-300",
    header: "bg-green-700",
    badge: "bg-green-100 text-green-800",
    dot: "bg-green-500",
  },
  {
    id: "out",
    label: "Out",
    color: "bg-red-50 border-red-200",
    header: "bg-red-600",
    badge: "bg-red-100 text-red-800",
    dot: "bg-red-400",
  },
] as const;

type StageId = typeof STAGES[number]["id"];

interface Candidate {
  id: number;
  name: string;
  info: string;
  stage: StageId;
  sort_order: number;
  external_id?: string;
  sync_locked?: number;
  created_at: string;
}

// ─── Candidate card ──────────────────────────────────────────────────────────

interface CardProps {
  candidate: Candidate;
  stageIndex: number;
  onUpdate: (id: number, patch: Partial<Candidate>) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, direction: "left" | "right") => void;
  // drag
  onDragStart: (e: React.DragEvent, id: number) => void;
  onDragOver: (e: React.DragEvent, id: number) => void;
  onDrop: (e: React.DragEvent, id: number) => void;
  draggingId: number | null;
}

function CandidateCard({
  candidate, stageIndex, onUpdate, onDelete, onMove,
  onDragStart, onDragOver, onDrop, draggingId,
}: CardProps) {
  const [editingName, setEditingName] = useState(false);
  const [editingInfo, setEditingInfo] = useState(false);
  const [nameBuf, setNameBuf] = useState(candidate.name);
  const [infoBuf, setInfoBuf] = useState(candidate.info);
  const nameRef = useRef<HTMLInputElement>(null);
  const infoRef = useRef<HTMLTextAreaElement>(null);

  const commitName = () => {
    setEditingName(false);
    if (nameBuf !== candidate.name) onUpdate(candidate.id, { name: nameBuf, sync_locked: 1 });
  };

  const commitInfo = () => {
    setEditingInfo(false);
    if (infoBuf !== candidate.info) onUpdate(candidate.id, { info: infoBuf, sync_locked: 1 });
  };

  const isDragging = draggingId === candidate.id;

  return (
    <div
      onDragOver={e => onDragOver(e, candidate.id)}
      onDrop={e => onDrop(e, candidate.id)}
      className={`group relative bg-white border rounded-lg shadow-sm transition-all ${
        isDragging ? "opacity-40 scale-95 border-dashed" : "hover:shadow-md"
      }`}
    >
      {/* Drag handle — drag only from here */}
      <div
        draggable
        onDragStart={e => onDragStart(e, candidate.id)}
        className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing select-none"
      >
        <GripVertical className="w-3 h-3 text-muted-foreground" />
      </div>

      <div className="p-3 pl-5 space-y-1.5">
        {/* Name row */}
        <div className="flex items-center justify-between gap-2">
          {editingName ? (
            <Input
              ref={nameRef}
              value={nameBuf}
              onChange={e => setNameBuf(e.target.value)}
              onBlur={commitName}
              onKeyDown={e => { if (e.key === "Enter") commitName(); if (e.key === "Escape") { setNameBuf(candidate.name); setEditingName(false); }}}
              className="h-6 text-sm font-semibold px-1 py-0 border-0 border-b rounded-none focus-visible:ring-0 focus-visible:border-primary"
              autoFocus
            />
          ) : (
            <button
              className="text-sm font-semibold text-left truncate max-w-[160px] hover:text-primary transition-colors"
              onClick={() => { setNameBuf(candidate.name); setEditingName(true); setTimeout(() => nameRef.current?.select(), 10); }}
            >
              {candidate.name || <span className="text-muted-foreground font-normal italic">Unnamed</span>}
            </button>
          )}

          {/* Actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              disabled={stageIndex === 0}
              onClick={() => onMove(candidate.id, "left")}
              className="p-0.5 rounded hover:bg-muted disabled:opacity-20 transition-colors"
              title="Move left"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button
              disabled={stageIndex === STAGES.length - 1}
              onClick={() => onMove(candidate.id, "right")}
              className="p-0.5 rounded hover:bg-muted disabled:opacity-20 transition-colors"
              title="Move right"
            >
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button
              onClick={() => onDelete(candidate.id)}
              className="p-0.5 rounded hover:bg-red-50 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        </div>

        {/* Info text */}
        {editingInfo ? (
          <Textarea
            ref={infoRef}
            value={infoBuf}
            onChange={e => setInfoBuf(e.target.value)}
            onBlur={commitInfo}
            onKeyDown={e => { if (e.key === "Escape") { setInfoBuf(candidate.info); setEditingInfo(false); }}}
            className="text-xs resize-none min-h-[60px] p-1 border-dashed"
            placeholder="Add notes, CV link, contact, LinkedIn…"
            autoFocus
            rows={3}
          />
        ) : (
          <button
            className="text-xs text-left w-full text-muted-foreground hover:text-foreground transition-colors leading-relaxed"
            onClick={() => { setInfoBuf(candidate.info); setEditingInfo(true); setTimeout(() => infoRef.current?.focus(), 10); }}
          >
            {candidate.info ? (
              <span className="whitespace-pre-wrap line-clamp-4">{candidate.info}</span>
            ) : (
              <span className="italic opacity-50">Click to add notes…</span>
            )}
          </button>
        )}

        {/* Date chip + lock indicator */}
        <div className="flex items-center gap-1.5 pt-0.5">
          {(() => {
            const created = new Date(candidate.created_at);
            const days = Math.floor((Date.now() - created.getTime()) / 86400000);
            const dd = String(created.getDate()).padStart(2, "0");
            const mm = String(created.getMonth() + 1).padStart(2, "0");
            const ageColor = days > 5 ? "text-red-500 font-semibold" : days > 3 ? "text-orange-500 font-semibold" : "text-muted-foreground/50";
            return (
              <span className={`text-[9px] ${ageColor}`} title={`Created ${dd}/${mm}, ${days} day${days !== 1 ? "s" : ""} in funnel`}>
                {dd}/{mm} · {days}d
              </span>
            );
          })()}
          {candidate.sync_locked === 1 && (
            <span title="Manually positioned — sync won't move this card">
              <Lock className="w-2.5 h-2.5 text-muted-foreground/40" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Column drop zone ─────────────────────────────────────────────────────────

interface ColumnProps {
  stage: typeof STAGES[number];
  stageIndex: number;
  candidates: Candidate[];
  onAdd: (stageId: StageId) => void;
  onUpdate: (id: number, patch: Partial<Candidate>) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, direction: "left" | "right") => void;
  onDragStart: (e: React.DragEvent, id: number) => void;
  onDragOver: (e: React.DragEvent, id: number) => void;
  onDrop: (e: React.DragEvent, id: number) => void;
  onDropIntoColumn: (e: React.DragEvent, stageId: StageId) => void;
  draggingId: number | null;
}

function KanbanColumn({
  stage, stageIndex, candidates, onAdd,
  onUpdate, onDelete, onMove,
  onDragStart, onDragOver, onDrop, onDropIntoColumn, draggingId,
}: ColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div className={`flex flex-col rounded-xl border-2 ${stage.color} min-h-[500px] w-64 shrink-0`}>
      {/* Header */}
      <div className={`${stage.header} rounded-t-[9px] px-3 py-2.5 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <span className="text-white font-semibold text-sm">{stage.label}</span>
        </div>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white`}>
          {candidates.length}
        </span>
      </div>

      {/* Cards */}
      <div
        className={`flex-1 p-2 space-y-2 transition-colors ${isDragOver ? "bg-white/60" : ""}`}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={e => { setIsDragOver(false); onDropIntoColumn(e, stage.id); }}
      >
        {candidates.map(c => (
          <CandidateCard
            key={c.id}
            candidate={c}
            stageIndex={stageIndex}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onMove={onMove}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            draggingId={draggingId}
          />
        ))}
        {candidates.length === 0 && (
          <div className="flex items-center justify-center h-24 text-xs text-muted-foreground/40 border-2 border-dashed rounded-lg">
            Drop here
          </div>
        )}
      </div>

      {/* Add button */}
      <div className="p-2 pt-0">
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-8 text-xs text-muted-foreground hover:text-foreground hover:bg-white/60 border border-dashed border-current/20 hover:border-current/40"
          onClick={() => onAdd(stage.id)}
        >
          <Plus className="w-3 h-3 mr-1" /> Add candidate
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Hiring() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualStage, setManualStage] = useState<StageId>("potential");
  const [addingManual, setAddingManual] = useState(false);
  const { toast } = useToast();

  const load = async () => {
    try {
      const res = await fetch("/api/hiring/candidates", { credentials: "include" });
      if (res.ok) setCandidates(await res.json());
    } catch {
      // network error — show empty board, don't stay stuck on loading
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const api = async (method: string, path: string, body?: object) => {
    const res = await fetch(path, {
      method, credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.ok ? res.json() : null;
  };

  const addCandidate = async (stage: StageId) => {
    const maxOrder = Math.max(0, ...candidates.filter(c => c.stage === stage).map(c => c.sort_order));
    const c = await api("POST", "/api/hiring/candidates", {
      name: "", info: "", stage, sort_order: maxOrder + 1,
    });
    if (c) setCandidates(prev => [...prev, c]);
  };

  const addManualCandidate = async (name: string, email: string, stage: StageId) => {
    if (!name.trim()) return;
    const info = email.trim() ? `Email: ${email.trim()}` : "";
    const maxOrder = Math.max(0, ...candidates.filter(c => c.stage === stage).map(c => c.sort_order));
    const c = await api("POST", "/api/hiring/candidates", {
      name: name.trim(), info, stage, sort_order: maxOrder + 1, sync_locked: 1,
    });
    if (c) {
      setCandidates(prev => [...prev, c]);
      toast({ title: `Added ${name.trim()} to ${STAGES.find(s => s.id === stage)?.label}` });
    }
  };

  const parseManualInput = (text: string): { name: string; email: string }[] => {
    // Parse formats like "Name <email>" or "Name email@domain.com" or just "Name"
    const results: { name: string; email: string }[] = [];
    for (const line of text.split("\n").map(l => l.trim()).filter(Boolean)) {
      const angleMatch = line.match(/^(.+?)\s*<([^>]+)>/);
      if (angleMatch) {
        results.push({ name: angleMatch[1].trim(), email: angleMatch[2].trim() });
      } else {
        const emailMatch = line.match(/\S+@\S+\.\S+/);
        if (emailMatch) {
          const email = emailMatch[0];
          const name = line.replace(email, "").trim() || email.split("@")[0];
          results.push({ name, email });
        } else {
          results.push({ name: line, email: "" });
        }
      }
    }
    return results;
  };

  const updateCandidate = async (id: number, patch: Partial<Candidate>) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
    await api("PUT", `/api/hiring/candidates/${id}`, patch);
  };

  const deleteCandidate = async (id: number) => {
    if (!confirm("Remove this candidate?")) return;
    setCandidates(prev => prev.filter(c => c.id !== id));
    await fetch(`/api/hiring/candidates/${id}`, { method: "DELETE", credentials: "include" });
  };

  const moveCandidate = async (id: number, direction: "left" | "right") => {
    const c = candidates.find(x => x.id === id);
    if (!c) return;
    const idx = STAGES.findIndex(s => s.id === c.stage);
    const newIdx = direction === "left" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= STAGES.length) return;
    const newStage = STAGES[newIdx].id;
    await updateCandidate(id, { stage: newStage, sync_locked: 1 });
    toast({ title: `Moved to ${STAGES[newIdx].label}` });
  };

  const importFromEendigo = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/hiring/sync", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (data.error) {
        toast({ title: "Import failed", description: data.error, variant: "destructive" });
      } else {
        setLastSync(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
        toast({
          title: `Import complete`,
          description: `${data.created} new, ${data.updated} updated (${data.synced} total)`,
        });
        await load();
      }
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const dragOverId = useRef<number | null>(null);

  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("candidateId", String(id));
  };

  const handleDragOver = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    dragOverId.current = targetId;
  };

  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    const sourceId = parseInt(e.dataTransfer.getData("candidateId"));
    if (!sourceId || sourceId === targetId) { setDraggingId(null); return; }

    const source = candidates.find(c => c.id === sourceId);
    const target = candidates.find(c => c.id === targetId);
    if (!source || !target) { setDraggingId(null); return; }

    // Move to same stage at target position
    const newStage = target.stage;
    const stageCandidates = candidates.filter(c => c.stage === newStage && c.id !== sourceId);
    const targetPos = stageCandidates.findIndex(c => c.id === targetId);
    const reordered = [...stageCandidates.slice(0, targetPos), source, ...stageCandidates.slice(targetPos)];
    reordered.forEach((c, i) => updateCandidate(c.id, {
      stage: newStage, sort_order: i,
      ...(c.id === sourceId ? { sync_locked: 1 } : {}),
    }));
    setDraggingId(null);
  };

  const handleDropIntoColumn = (e: React.DragEvent, stageId: StageId) => {
    e.preventDefault();
    const sourceId = parseInt(e.dataTransfer.getData("candidateId") || "0");
    if (!sourceId) { setDraggingId(null); return; }
    const source = candidates.find(c => c.id === sourceId);
    if (!source || source.stage === stageId) { setDraggingId(null); return; }

    const maxOrder = Math.max(0, ...candidates.filter(c => c.stage === stageId).map(c => c.sort_order));
    updateCandidate(sourceId, { stage: stageId, sort_order: maxOrder + 1, sync_locked: 1 });
    setDraggingId(null);
  };

  const byStage = (stageId: StageId) =>
    candidates.filter(c => c.stage === stageId).sort((a, b) => a.sort_order - b.sort_order);

  const total = candidates.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserCheck className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Hiring Pipeline</h1>
            <p className="text-sm text-muted-foreground">
              {total} candidate{total !== 1 ? "s" : ""} across {STAGES.length} stages
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {STAGES.map(s => (
              <Button key={s.id} variant="outline" size="sm" className="text-xs h-8" onClick={() => addCandidate(s.id)}>
                <Plus className="w-3 h-3 mr-1" /> {s.label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2 pl-2 border-l">
            {lastSync && <span className="text-xs text-muted-foreground">Last import: {lastSync}</span>}
            <Button size="sm" onClick={importFromEendigo} disabled={syncing} className="h-8">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Importing…" : "Import from Eendigo"}
            </Button>
          </div>
        </div>
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="text-center py-20 text-muted-foreground">Loading…</div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage, idx) => (
            <KanbanColumn
              key={stage.id}
              stage={stage}
              stageIndex={idx}
              candidates={byStage(stage.id)}
              onAdd={addCandidate}
              onUpdate={updateCandidate}
              onDelete={deleteCandidate}
              onMove={moveCandidate}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDropIntoColumn={handleDropIntoColumn}
              draggingId={draggingId}
            />
          ))}
        </div>
      )}

      {/* ── Back up — manual candidate input ────────────────────────────────
          Lets you add a candidate whose CV/email lives outside the Eendigo
          sync (e.g. a personal referral, LinkedIn cold-outreach reply,
          coffee-chat intro). Drops the new card into the chosen stage with
          `sync_locked = 1` so the Eendigo import won't wipe or move it.
          Supports single-line entry ("Name <email>") and bulk paste
          (one candidate per line — each parsed with parseManualInput).
      */}
      <div className="border-2 border-dashed border-amber-300 rounded-xl p-4 bg-amber-50/30 space-y-3">
        <div className="flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-amber-700" />
          <h3 className="font-bold text-amber-900">Back Up — Manual entry</h3>
          <span className="text-xs text-amber-700/70">
            For candidates outside the Eendigo sync (referrals, cold replies, offline intros)
          </span>
        </div>

        {/* Single-entry row */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-0.5">
            <label className="text-[10px] font-semibold text-amber-900/80 uppercase">Name</label>
            <Input
              value={manualName}
              onChange={e => setManualName(e.target.value)}
              placeholder="e.g. Ahmed Elkassas"
              className="h-8 text-sm w-48 bg-background"
              onKeyDown={e => {
                if (e.key === "Enter" && manualName.trim()) {
                  addManualCandidate(manualName, manualEmail, manualStage);
                  setManualName(""); setManualEmail("");
                }
              }}
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] font-semibold text-amber-900/80 uppercase">Email</label>
            <Input
              value={manualEmail}
              onChange={e => setManualEmail(e.target.value)}
              placeholder="ahmed_2assas@hotmail.com"
              className="h-8 text-sm w-64 bg-background"
              onKeyDown={e => {
                if (e.key === "Enter" && manualName.trim()) {
                  addManualCandidate(manualName, manualEmail, manualStage);
                  setManualName(""); setManualEmail("");
                }
              }}
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] font-semibold text-amber-900/80 uppercase">Stage</label>
            <select
              value={manualStage}
              onChange={e => setManualStage(e.target.value as StageId)}
              className="h-8 text-sm rounded border px-2 bg-background"
            >
              {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <Button
            size="sm"
            disabled={!manualName.trim() || addingManual}
            onClick={async () => {
              setAddingManual(true);
              await addManualCandidate(manualName, manualEmail, manualStage);
              setManualName(""); setManualEmail("");
              setAddingManual(false);
            }}
            className="h-8 bg-amber-600 hover:bg-amber-700"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add candidate
          </Button>
        </div>

        {/* Bulk-paste helper */}
        <details className="text-xs">
          <summary className="cursor-pointer text-amber-800 hover:text-amber-900 select-none font-semibold">
            Bulk paste — one candidate per line
          </summary>
          <div className="mt-2 space-y-2">
            <Textarea
              placeholder={`Ahmed Elkassas <ahmed_2assas@hotmail.com>\nJane Doe jane@example.com\nJohn Smith`}
              className="text-xs min-h-[80px] bg-background font-mono"
              onKeyDown={e => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  const ta = e.currentTarget;
                  const parsed = parseManualInput(ta.value);
                  (async () => {
                    for (const row of parsed) {
                      await addManualCandidate(row.name, row.email, manualStage);
                    }
                    ta.value = "";
                  })();
                }
              }}
              id="bulk-candidate-paste"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-amber-800/70 italic">
                Formats supported: "Name &lt;email&gt;", "Name email", or just "Name". Ctrl+Enter to submit.
              </span>
              <Button
                size="sm" variant="outline"
                onClick={async () => {
                  const ta = document.getElementById("bulk-candidate-paste") as HTMLTextAreaElement | null;
                  if (!ta) return;
                  const parsed = parseManualInput(ta.value);
                  for (const row of parsed) {
                    await addManualCandidate(row.name, row.email, manualStage);
                  }
                  ta.value = "";
                }}
                className="h-7 text-xs"
              >
                Add all
              </Button>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
