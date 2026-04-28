import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, GripVertical, UserCheck, ChevronLeft, ChevronRight, RefreshCw, Lock, UserPlus, Mail, Calendar, Info, ExternalLink, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
    // Back-up = strong candidate held in reserve. They've passed enough
    // gates to be a viable hire but we don't have a slot for them right
    // now. Keep their data + don't let sync overwrite them. Distinct from
    // "Out" (rejected) and from "Make offer" (active offer in flight).
    id: "back_up",
    label: "Back-up",
    color: "bg-slate-50 border-slate-300",
    header: "bg-slate-500",
    badge: "bg-slate-100 text-slate-700",
    dot: "bg-slate-400",
  },
  {
    // Combined offer-out + hired stage. Once a candidate has a written offer
    // they stay here until the outcome is known; accepted = stays here,
    // declined = moved to "Out". Keeps the column count tight.
    id: "offer",
    label: "Make offer / Hired",
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

// Stages marked here are "terminal" — once a candidate lands in one, the
// Eendigo sync must leave them alone (no move, no overwrite, no re-import).
// The ATS process for them is over; we only track them for history.
const TERMINAL_STAGES: ReadonlySet<string> = new Set(["offer", "out", "hired"]);

// ── Info-blob parser ──────────────────────────────────────────────────────
// Candidate notes arrive as free-form text from the Eendigo sync
// (e.g. "Logic 68.2% | Verbal 83.3% | Excel 35.0%\nTG Score: 76%\n
// Status: Intro Failed"). The popup renders this as STRUCTURED UI
// (progress bars for scores, coloured badges for statuses, link for
// emails) instead of a raw text dump. The parser is intentionally
// tolerant — anything it doesn't recognise falls through as a plain
// text line so nothing is silently dropped.

export interface ParsedInfo {
  email: string | null;
  applied: string | null;            // raw date string, best-effort
  tgScores: { label: string; pct: number }[]; // Logic, Verbal, Excel, Pres1, Pres2…
  tgOverall: number | null;
  introRating: string | null;        // e.g. "DIS → 90%"
  introScore: number | null;         // 0-100 if parseable
  csRate: string | null;             // case-study assessor rating (number or grade)
  csRateScore: number | null;        // 0-100 when parseable
  /** CS LM — partner's rating after the Learning-Manager review of the
   *  case study. The authoritative go/no-go signal, surfaced prominently
   *  on the candidate card (not just in the popup). */
  csLM: string | null;
  csLMScore: number | null;
  statuses: string[];                // ["Intro Failed", "✓ Complete"]
  keyValues: { key: string; value: string }[]; // any other "Key: value" pair
  freeText: string[];                // fallback lines
}

export function parseCandidateInfo(info: string): ParsedInfo {
  const result: ParsedInfo = {
    email: null, applied: null, tgScores: [], tgOverall: null,
    introRating: null, introScore: null,
    csRate: null, csRateScore: null, csLM: null, csLMScore: null,
    statuses: [], keyValues: [], freeText: [],
  };
  if (!info) return result;

  const lines = info.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  // Regex library — built once per call.
  const emailRe = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
  const tgSubRe = /([A-Za-z][A-Za-z0-9 ]{0,20})\s+([\d.]+)\s*%/g;
  const introRe = /^Intro\s*:\s*(.+)$/i;
  const statusRe = /^Status\s*:\s*(.+)$/i;
  const appliedRe = /^Applied\s*:\s*(.+)$/i;
  const tgScoreRe = /^(?:TG|TestGorilla)\s*Score\s*:\s*([\d.]+)\s*%?$/i;
  // CS LM must be tested BEFORE the generic keyValRe, because keyValRe
  // would otherwise eat it as a plain key:value line and bury it under
  // the generic "Other fields" block.
  const csLMRe = /^CS\s*LM\s*:\s*(.+)$/i;
  const csRateRe = /^CS\s*Rate\s*:\s*(.+)$/i;
  const keyValRe = /^([A-Za-z][A-Za-z0-9 _/()+-]*?)\s*[:=]\s*(.+)$/;

  for (const line of lines) {
    let matched = false;

    // Applied: YYYY-MM-DD
    const appliedM = line.match(appliedRe);
    if (appliedM) { result.applied = appliedM[1].trim(); matched = true; continue; }

    // TG / TestGorilla Score: 76%
    const tgOverallM = line.match(tgScoreRe);
    if (tgOverallM) { result.tgOverall = Number(tgOverallM[1]); matched = true; continue; }

    // Intro: DIS → 90%
    const introM = line.match(introRe);
    if (introM) {
      result.introRating = introM[1].trim();
      const numMatch = introM[1].match(/([\d.]+)\s*%/);
      if (numMatch) result.introScore = Number(numMatch[1]);
      matched = true;
      continue;
    }

    // Status: Intro Failed / ✓ Complete
    const statusM = line.match(statusRe);
    if (statusM) { result.statuses.push(statusM[1].trim()); matched = true; continue; }

    // CS LM: 85% / Strong / 🟢 — partner's case-study review rating.
    const csLMM = line.match(csLMRe);
    if (csLMM) {
      const raw = csLMM[1].trim();
      result.csLM = raw;
      const n = raw.match(/([\d.]+)\s*%?/);
      if (n) result.csLMScore = Number(n[1]);
      matched = true;
      continue;
    }

    // CS Rate: 72% / Pass — assessor case-study rating.
    const csRateM = line.match(csRateRe);
    if (csRateM) {
      const raw = csRateM[1].trim();
      result.csRate = raw;
      const n = raw.match(/([\d.]+)\s*%?/);
      if (n) result.csRateScore = Number(n[1]);
      matched = true;
      continue;
    }

    // A score line like "Logic 68.2% | Verbal 83.3% | Excel 35.0% | Pres1 0.0% | Pres2 25.0%"
    // — detect by looking for multiple "LABEL NUM%" patterns on one line.
    const subMatches = [...line.matchAll(tgSubRe)];
    if (subMatches.length >= 2) {
      for (const m of subMatches) {
        result.tgScores.push({ label: m[1].trim(), pct: Number(m[2]) });
      }
      matched = true;
      continue;
    }

    // Standalone email line
    const emailM = line.match(emailRe);
    if (emailM && !result.email && line.replace(emailRe, "").replace(/[^a-z0-9]/gi, "").length === 0) {
      // Line is JUST the email
      result.email = emailM[1];
      matched = true;
      continue;
    }
    if (!result.email && emailM) result.email = emailM[1];

    // Generic Key: value
    const kvM = line.match(keyValRe);
    if (kvM) {
      const key = kvM[1].trim();
      const value = kvM[2].trim();
      if (key.toLowerCase() === "email") {
        result.email = value.match(emailRe)?.[1] ?? value;
      } else {
        result.keyValues.push({ key, value });
      }
      matched = true;
      continue;
    }

    if (!matched) result.freeText.push(line);
  }
  return result;
}

// Coloured badge helper for score percentages — same rules as the
// Candidate Scoring dashboard so the two views stay visually coherent.
function scoreBadgeClass(pct: number): string {
  if (pct >= 85) return "bg-emerald-500 text-white";
  if (pct >= 70) return "bg-emerald-100 text-emerald-800";
  if (pct >= 55) return "bg-amber-100 text-amber-800";
  if (pct >= 40) return "bg-orange-200 text-orange-900";
  return "bg-red-200 text-red-900";
}

// Status-text classifier: red for negative, green for positive, amber for neutral.
function statusTone(s: string): "green" | "red" | "amber" | "neutral" {
  const lower = s.toLowerCase();
  if (/fail|reject|declin|dropped|no[- ]show/.test(lower)) return "red";
  if (/complete|pass|accept|hired|offer|success|✓/.test(lower)) return "green";
  if (/pending|schedul|in[- ]progress|review/.test(lower)) return "amber";
  return "neutral";
}

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
  // Structured score columns populated by /api/hiring/sync. Surfaced on
  // the card + detail dialog so the user can see TestGorilla sub-scores
  // and call ratings without parsing the legacy info blob. cs_lm is text
  // because it can be a partner verdict ("Strong" / "Pass") rather than
  // a number.
  logic_pct?: number | null;
  verbal_pct?: number | null;
  excel_pct?: number | null;
  p1_pct?: number | null;
  p2_pct?: number | null;
  intro_rate_pct?: number | null;
  cs_rate_pct?: number | null;
  cs_lm?: string | null;
}

// ─── Candidate card ──────────────────────────────────────────────────────────

interface CardProps {
  candidate: Candidate;
  stageIndex: number;
  onUpdate: (id: number, patch: Partial<Candidate>) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, direction: "left" | "right") => void;
  onOpenDetail: (candidate: Candidate) => void;
  // drag
  onDragStart: (e: React.DragEvent, id: number) => void;
  onDragOver: (e: React.DragEvent, id: number) => void;
  onDrop: (e: React.DragEvent, id: number) => void;
  draggingId: number | null;
}

function CandidateCard({
  candidate, stageIndex, onUpdate, onDelete, onMove, onOpenDetail,
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

  // Clicking anywhere on the card now opens the detail popup. Inline
  // editing of name and info is disabled on the card surface — users
  // edit both fields inside the popup, where there's room for a
  // structured UI (parsed scores, tags, progress bars). Interactive
  // child elements (drag handle, hover actions) call stopPropagation
  // so their clicks don't also trigger onOpenDetail.
  return (
    <div
      onDragOver={e => onDragOver(e, candidate.id)}
      onDrop={e => onDrop(e, candidate.id)}
      onClick={() => onOpenDetail(candidate)}
      className={`group relative bg-white border rounded-lg shadow-sm transition-all cursor-pointer ${
        isDragging ? "opacity-40 scale-95 border-dashed" : "hover:shadow-md hover:border-primary/40"
      }`}
    >
      {/* Drag handle — drag only from here */}
      <div
        draggable
        onDragStart={e => onDragStart(e, candidate.id)}
        onClick={e => e.stopPropagation()}
        className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 cursor-grab active:cursor-grabbing select-none"
      >
        <GripVertical className="w-3 h-3 text-muted-foreground" />
      </div>

      <div className="p-3 pl-5 space-y-1.5">
        {/* Name row — no longer inline-editable. Edit in the popup. */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold truncate max-w-[160px]">
            {candidate.name || <span className="text-muted-foreground font-normal italic">Unnamed</span>}
          </span>
          {/* Hover actions — stopPropagation so the card's click doesn't fire */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              disabled={stageIndex === 0}
              onClick={e => { e.stopPropagation(); onMove(candidate.id, "left"); }}
              className="p-0.5 rounded hover:bg-muted disabled:opacity-20 transition-colors"
              title="Move left"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button
              disabled={stageIndex === STAGES.length - 1}
              onClick={e => { e.stopPropagation(); onMove(candidate.id, "right"); }}
              className="p-0.5 rounded hover:bg-muted disabled:opacity-20 transition-colors"
              title="Move right"
            >
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete(candidate.id); }}
              className="p-0.5 rounded hover:bg-red-50 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        </div>

        {/* Structured score strip — reads the imported columns directly,
            colour-graded (red <40, amber 40-70, green ≥70). Rendered
            ABOVE the legacy info-blob CS LM block so the user sees the
            authoritative columns first. Only renders rows that have at
            least one number — keeps the card compact for unrated candidates. */}
        {(() => {
          const c = candidate;
          const cells: Array<{ label: string; value: number | string | null | undefined; isPct?: boolean; isText?: boolean }> = [
            { label: "Logic",  value: c.logic_pct,        isPct: true },
            { label: "Verbal", value: c.verbal_pct,       isPct: true },
            { label: "Excel",  value: c.excel_pct,        isPct: true },
            { label: "P1",     value: c.p1_pct,           isPct: true },
            { label: "P2",     value: c.p2_pct,           isPct: true },
            { label: "I.Rate", value: c.intro_rate_pct,   isPct: true },
            { label: "CS.Rate",value: c.cs_rate_pct,      isPct: true },
            { label: "CS-LM",  value: c.cs_lm,            isText: true },
          ];
          const nonEmpty = cells.filter(x => x.value !== null && x.value !== undefined && x.value !== "");
          if (nonEmpty.length === 0) return null;
          const tone = (n: number) => n >= 70 ? "bg-emerald-100 text-emerald-800 border-emerald-200"
            : n >= 40 ? "bg-amber-100 text-amber-800 border-amber-200"
            : "bg-red-100 text-red-800 border-red-200";
          return (
            <div className="flex flex-wrap gap-1">
              {nonEmpty.map(x => {
                const isNum = typeof x.value === "number";
                const cls = isNum ? tone(x.value as number) : "bg-slate-100 text-slate-700 border-slate-200";
                const display = isNum ? `${(x.value as number).toFixed(0)}` : String(x.value);
                return (
                  <span
                    key={x.label}
                    className={`text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border ${cls}`}
                    title={`${x.label}: ${display}${x.isPct ? "%" : ""}`}
                  >
                    {x.label} {display}{x.isPct ? "%" : ""}
                  </span>
                );
              })}
            </div>
          );
        })()}

        {/* CS LM — partner's case-study rating, if the scraper got it.
            Rendered as a prominent colour-coded badge so the user can
            see the partner's verdict without opening the popup. */}
        {(() => {
          const parsed = parseCandidateInfo(candidate.info ?? "");
          if (!parsed.csLM) return null;
          const score = parsed.csLMScore;
          const toneCls =
            score != null
              ? scoreBadgeClass(score)
              : /fail|no|reject|weak|drop/i.test(parsed.csLM)
                ? "bg-red-200 text-red-900"
                : /pass|strong|hire|go|✓|🟢|good|excellent/i.test(parsed.csLM)
                  ? "bg-emerald-200 text-emerald-900"
                  : "bg-muted text-muted-foreground";
          return (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-semibold uppercase text-muted-foreground tracking-wide">CS LM:</span>
              <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${toneCls}`}>
                {parsed.csLM}
              </span>
            </div>
          );
        })()}

        {/* Compact info preview — first 2 lines. Full structured rendering
            lives in the detail popup. */}
        {candidate.info ? (
          <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {candidate.info}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground/50 italic">
            Click to open details…
          </div>
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
  onOpenDetail: (candidate: Candidate) => void;
  onDragStart: (e: React.DragEvent, id: number) => void;
  onDragOver: (e: React.DragEvent, id: number) => void;
  onDrop: (e: React.DragEvent, id: number) => void;
  onDropIntoColumn: (e: React.DragEvent, stageId: StageId) => void;
  draggingId: number | null;
}

function KanbanColumn({
  stage, stageIndex, candidates, onAdd,
  onUpdate, onDelete, onMove, onOpenDetail,
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
            onOpenDetail={onOpenDetail}
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
  // Detail popup — clicked candidate shown in a Dialog with every field
  // (name, info, stage history, email, lock state, created_at, external id).
  const [detailCandidate, setDetailCandidate] = useState<Candidate | null>(null);
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

  // byStage: legacy "hired" records surface under the merged "Make offer /
  // Hired" column so they don't disappear after the stage consolidation.
  // Terminal stages ("offer" / "out") are rendered as-is.
  const byStage = (stageId: StageId) => {
    const match = (c: Candidate) =>
      c.stage === stageId || (stageId === "offer" && (c.stage as string) === "hired");
    return candidates.filter(match).sort((a, b) => a.sort_order - b.sort_order);
  };

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
              onOpenDetail={setDetailCandidate}
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

      {/* Candidate detail popup — opens on "Open →" click inside any card.
          Shows every field the DB holds for this person plus a stage
          timeline and the lock status. All fields are read-only here;
          inline editing continues to live on the card itself. */}
      <Dialog open={!!detailCandidate} onOpenChange={open => { if (!open) setDetailCandidate(null); }}>
        <DialogContent className="max-w-2xl">
          {detailCandidate && (() => {
            const c = detailCandidate;
            const stageObj = STAGES.find(s => s.id === c.stage) ?? null;
            const created = new Date(c.created_at);
            const daysInFunnel = Math.floor((Date.now() - created.getTime()) / 86400000);
            // Extract email from info blob (we store "Email: x@y.com")
            const emailMatch = c.info.match(/Email:\s*(\S+@\S+\.\S+)/i);
            const email = emailMatch ? emailMatch[1] : c.external_id || "";
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <UserCheck className="w-5 h-5 text-primary" />
                    {c.name || <span className="italic text-muted-foreground">Unnamed candidate</span>}
                    {stageObj && (
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${stageObj.badge}`}>
                        {stageObj.label}
                      </span>
                    )}
                  </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                  {/* Meta grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Email:</span>
                      {email ? (
                        <a href={`mailto:${email}`} className="text-primary hover:underline">{email}</a>
                      ) : (
                        <span className="italic text-muted-foreground">not captured</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Added:</span>
                      <span>{created.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                      <span className="text-muted-foreground">·</span>
                      <span>{daysInFunnel}d in funnel</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Stage:</span>
                      {/* Inline stage dropdown — picking a new stage moves
                          the candidate immediately AND locks them (sync_locked=1)
                          so the next Eendigo import doesn't undo the move. */}
                      <select
                        value={c.stage}
                        onChange={async (e) => {
                          const next = e.target.value;
                          if (next === c.stage) return;
                          await updateCandidate(c.id, { stage: next, sync_locked: 1 });
                          const lbl = STAGES.find(s => s.id === next)?.label ?? next;
                          toast({ title: `Moved ${c.name} to ${lbl}` });
                        }}
                        className="h-7 text-xs rounded border px-1.5 bg-background font-semibold"
                      >
                        {STAGES.map(s => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                      {TERMINAL_STAGES.has(c.stage) && (
                        <span className="text-[9px] text-red-600 font-bold uppercase ml-1">terminal — sync skips</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">Lock:</span>
                      <span>{c.sync_locked === 1 ? "Manually positioned (won't be moved by sync)" : "Unlocked (sync may move this card)"}</span>
                    </div>
                    {c.external_id && (
                      <div className="flex items-center gap-1.5 col-span-2">
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-muted-foreground">Eendigo sync ID:</span>
                        <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">{c.external_id}</code>
                      </div>
                    )}
                  </div>

                  {/* Structured rendering of the info blob. Parser extracts
                      email, applied date, TestGorilla sub-scores, TG overall,
                      intro call rating, statuses, and any other Key:value
                      pairs — each rendered with proper UI (progress bars,
                      coloured status badges, etc.) instead of raw text. */}
                  {(() => {
                    const parsed = parseCandidateInfo(c.info ?? "");
                    const hasAnyStructure =
                      parsed.email || parsed.applied || parsed.tgScores.length > 0
                      || parsed.tgOverall != null || parsed.introRating != null
                      || parsed.statuses.length > 0 || parsed.keyValues.length > 0
                      || parsed.freeText.length > 0;
                    if (!c.info) {
                      return (
                        <div className="text-xs italic text-muted-foreground">No notes yet.</div>
                      );
                    }
                    return (
                      <div className="space-y-3">
                        {/* Applied date */}
                        {parsed.applied && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">Applied:</span>
                            <span className="font-medium">{parsed.applied}</span>
                          </div>
                        )}

                        {/* TestGorilla sub-scores as progress bars */}
                        {parsed.tgScores.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <div className="text-[10px] font-bold uppercase text-muted-foreground">TestGorilla sub-scores</div>
                              {parsed.tgOverall != null && (
                                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${scoreBadgeClass(parsed.tgOverall)}`}>
                                  Overall {parsed.tgOverall.toFixed(0)}%
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                              {parsed.tgScores.map((s, i) => (
                                <div key={i} className="space-y-0.5">
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="font-medium">{s.label}</span>
                                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${scoreBadgeClass(s.pct)}`}>
                                      {s.pct.toFixed(1)}%
                                    </span>
                                  </div>
                                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        s.pct >= 70 ? "bg-emerald-500"
                                        : s.pct >= 55 ? "bg-amber-500"
                                        : s.pct >= 40 ? "bg-orange-400"
                                        : "bg-red-400"
                                      }`}
                                      style={{ width: `${Math.min(100, Math.max(0, s.pct))}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* TG overall on its own when no sub-scores */}
                        {parsed.tgOverall != null && parsed.tgScores.length === 0 && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground font-semibold">TestGorilla score:</span>
                            <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${scoreBadgeClass(parsed.tgOverall)}`}>
                              {parsed.tgOverall.toFixed(0)}%
                            </span>
                          </div>
                        )}

                        {/* Intro call rating */}
                        {parsed.introRating && (
                          <div className="space-y-1">
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">Intro call</div>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-medium">{parsed.introRating.replace(/→\s*[\d.]+\s*%/, "").trim()}</span>
                              {parsed.introScore != null && (
                                <span className={`font-mono text-[10px] px-2 py-0.5 rounded ${scoreBadgeClass(parsed.introScore)}`}>
                                  {parsed.introScore.toFixed(0)}%
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* CSI from Manager — the two manager-driven scores:
                            `CS rate` (assessor rating of the case study) and
                            `CSI from LM` (the Line Manager's go/no-go rating
                            after the case study review). Always rendered so
                            the user can see at a glance what's missing and
                            fill it in via "Edit raw notes" below. Source
                            lines in notes:  `CS Rate: …` and `CS LM: …`. */}
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-bold uppercase text-muted-foreground">CSI from Manager</div>
                          <div className="flex flex-wrap gap-3">
                            {/* CS rate */}
                            {(() => {
                              if (!parsed.csRate) {
                                return (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-semibold text-muted-foreground">CS rate:</span>
                                    <span className="text-xs italic text-muted-foreground/70">— not set</span>
                                  </div>
                                );
                              }
                              const score = parsed.csRateScore;
                              const toneCls = score != null ? scoreBadgeClass(score) : "bg-muted text-muted-foreground";
                              return (
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-semibold text-muted-foreground">CS rate:</span>
                                  <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${toneCls}`}>
                                    {parsed.csRate}
                                  </span>
                                </div>
                              );
                            })()}
                            {/* CSI from LM */}
                            {(() => {
                              if (!parsed.csLM) {
                                return (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-semibold text-muted-foreground">CSI from LM:</span>
                                    <span className="text-xs italic text-muted-foreground/70">— not set</span>
                                  </div>
                                );
                              }
                              const score = parsed.csLMScore;
                              const toneCls =
                                score != null
                                  ? scoreBadgeClass(score)
                                  : /fail|no|reject|weak|drop/i.test(parsed.csLM!)
                                    ? "bg-red-200 text-red-900"
                                    : /pass|strong|hire|go|✓|🟢|good|excellent/i.test(parsed.csLM!)
                                      ? "bg-emerald-200 text-emerald-900"
                                      : "bg-muted text-muted-foreground";
                              return (
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-semibold text-muted-foreground">CSI from LM:</span>
                                  <span className={`text-sm font-bold font-mono px-2 py-0.5 rounded ${toneCls}`}>
                                    {parsed.csLM}
                                  </span>
                                </div>
                              );
                            })()}
                          </div>
                          {!parsed.csRate && !parsed.csLM && (
                            <p className="text-[10px] text-muted-foreground/70 italic">
                              Add <code className="text-[10px]">CS Rate: 72%</code> and <code className="text-[10px]">CS LM: Strong</code> lines via "Edit raw notes" below.
                            </p>
                          )}
                        </div>

                        {/* Statuses as tone-coloured badges */}
                        {parsed.statuses.length > 0 && (
                          <div className="space-y-1">
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">Status</div>
                            <div className="flex flex-wrap gap-1.5">
                              {parsed.statuses.map((s, i) => {
                                const tone = statusTone(s);
                                const cls = tone === "red" ? "bg-red-100 text-red-800 border-red-200"
                                  : tone === "green" ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                  : tone === "amber" ? "bg-amber-100 text-amber-800 border-amber-200"
                                  : "bg-muted text-muted-foreground border-border";
                                return (
                                  <span key={i} className={`text-[11px] px-2 py-0.5 rounded border font-medium ${cls}`}>
                                    {s}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Other key:value pairs */}
                        {parsed.keyValues.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            {parsed.keyValues.map((kv, i) => (
                              <div key={i} className="flex items-baseline gap-1.5">
                                <span className="text-muted-foreground">{kv.key}:</span>
                                <span className="font-medium truncate">{kv.value}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Unrecognised free-text lines */}
                        {parsed.freeText.length > 0 && (
                          <div className="space-y-1 border-t pt-2">
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">Other notes</div>
                            {parsed.freeText.map((t, i) => (
                              <div key={i} className="text-xs text-muted-foreground leading-relaxed">{t}</div>
                            ))}
                          </div>
                        )}

                        {/* Inline edit toggle — advanced users can still
                            hand-edit the raw blob when our parser doesn't
                            catch something exotic. */}
                        <details className="pt-2 border-t">
                          <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground select-none">
                            Edit raw notes
                          </summary>
                          <Textarea
                            defaultValue={c.info}
                            onBlur={e => {
                              if (e.target.value !== c.info) {
                                updateCandidate(c.id, { info: e.target.value, sync_locked: 1 });
                              }
                            }}
                            className="text-xs mt-1 min-h-[120px] font-mono"
                          />
                          <div className="text-[9px] text-muted-foreground italic mt-1">Blur to save.</div>
                        </details>

                        {!hasAnyStructure && (
                          <div className="text-xs italic text-muted-foreground">
                            (Parser didn't recognise any structured fields — see raw notes above.)
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button variant="outline" size="sm" onClick={() => setDetailCandidate(null)}>
                      <X className="w-3.5 h-3.5 mr-1" /> Close
                    </Button>
                    <Button
                      variant="destructive" size="sm"
                      onClick={() => {
                        deleteCandidate(c.id);
                        setDetailCandidate(null);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete candidate
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
