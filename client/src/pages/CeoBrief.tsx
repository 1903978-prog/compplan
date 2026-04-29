import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Play, Check, X, Pencil, Clock, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CeoBriefRun {
  id: string;
  generatedAt: string;
  generatedBy: string;
  model: string | null;
  tokenInput: number | null;
  tokenOutput: number | null;
  durationMs: number | null;
  status: string;
  error: string | null;
}

interface Decision {
  id: string;
  briefId: string;
  decisionId: string;
  type: "idea" | "action" | "conflict" | "proposal";
  agent: string;
  title: string;
  description: string;
  okrLink: string | null;
  deadline: string | null;
  approvalLevel: "autonomous" | "boss" | "ceo" | "livio";
  impact: number | null;
  effort: number | null;
  risk: number | null;
  status: "pending" | "approved" | "rejected" | "modified" | "postponed";
  statusNote: string | null;
  modifiedText: string | null;
  postponeUntil: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  createdAt: string;
}

interface BriefResponse {
  brief: CeoBriefRun | null;
  decisions: Decision[];
}

// ─── Colour mappings ──────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  idea:     "bg-blue-100 text-blue-800 border-blue-300",
  action:   "bg-emerald-100 text-emerald-800 border-emerald-300",
  conflict: "bg-red-100 text-red-800 border-red-300",
  proposal: "bg-purple-100 text-purple-800 border-purple-300",
};

const APPROVAL_BORDER: Record<string, string> = {
  livio:     "border-l-red-500",
  ceo:       "border-l-orange-400",
  boss:      "border-l-blue-400",
  autonomous:"border-l-emerald-400",
};

const STATUS_BADGE: Record<string, string> = {
  pending:   "bg-slate-100 text-slate-600",
  approved:  "bg-emerald-100 text-emerald-700",
  rejected:  "bg-red-100 text-red-700",
  modified:  "bg-amber-100 text-amber-700",
  postponed: "bg-slate-200 text-slate-600",
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="border-l-4 border-l-slate-200 rounded-lg p-4 bg-white border animate-pulse">
      <div className="h-3 w-24 bg-slate-200 rounded mb-2" />
      <div className="h-4 w-3/4 bg-slate-200 rounded mb-2" />
      <div className="h-3 w-full bg-slate-100 rounded mb-1" />
      <div className="h-3 w-2/3 bg-slate-100 rounded" />
    </div>
  );
}

// ─── Decision Card ────────────────────────────────────────────────────────────

interface DecisionCardProps {
  decision: Decision;
  readOnly: boolean;
  onDecide: (id: string, status: string, extra?: Record<string, string>) => Promise<void>;
}

function DecisionCard({ decision: d, readOnly, onDecide }: DecisionCardProps) {
  const [busy, setBusy] = useState(false);
  const [showModify, setShowModify] = useState(false);
  const [modifyText, setModifyText] = useState(d.description);
  const [modifyNote, setModifyNote] = useState("");
  const [showPostpone, setShowPostpone] = useState(false);
  const tomorrow = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [postponeDate, setPostponeDate] = useState(tomorrow);

  const act = async (status: string, extra?: Record<string, string>) => {
    setBusy(true);
    try {
      await onDecide(d.id, status, extra);
    } finally {
      setBusy(false);
      setShowModify(false);
      setShowPostpone(false);
    }
  };

  const borderColor = APPROVAL_BORDER[d.approvalLevel] ?? "border-l-slate-300";

  return (
    <div className={`border-l-4 ${borderColor} rounded-lg p-4 bg-white border border-slate-200 flex flex-col gap-2`}>
      {/* Top row: decision_id + type badge + agent badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-xs text-muted-foreground">{d.decisionId}</span>
        <Badge variant="outline" className={`text-xs ${TYPE_COLORS[d.type] ?? ""}`}>{d.type}</Badge>
        <Badge variant="secondary" className="text-xs">{d.agent}</Badge>
        {d.status !== "pending" && (
          <Badge className={`text-xs ml-auto ${STATUS_BADGE[d.status] ?? ""}`}>{d.status}</Badge>
        )}
      </div>

      {/* Title */}
      <p className="font-semibold text-sm leading-snug">{d.title}</p>

      {/* Description */}
      <p className="text-sm text-muted-foreground leading-relaxed">{d.description}</p>

      {/* Meta row: deadline · I/E/R */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {d.deadline && <span>Due: {d.deadline}</span>}
        {(d.impact != null || d.effort != null || d.risk != null) && (
          <span className="font-mono">
            I:{d.impact ?? "?"} E:{d.effort ?? "?"} R:{d.risk ?? "?"}
          </span>
        )}
        {d.okrLink && d.okrLink !== "none" && (
          <span className="text-blue-600">OKR: {d.okrLink}</span>
        )}
        <span className={`ml-auto font-medium ${
          d.approvalLevel === "livio" ? "text-red-600" :
          d.approvalLevel === "ceo"   ? "text-orange-500" :
          d.approvalLevel === "boss"  ? "text-blue-600" : "text-emerald-600"
        }`}>{d.approvalLevel}</span>
      </div>

      {/* Modified text shown when modified */}
      {d.status === "modified" && d.modifiedText && (
        <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
          <span className="font-medium">Modified: </span>{d.modifiedText}
        </div>
      )}
      {d.status === "postponed" && d.postponeUntil && (
        <div className="text-xs text-slate-500">Postponed until: {d.postponeUntil}</div>
      )}
      {d.statusNote && (
        <div className="text-xs text-muted-foreground italic">Note: {d.statusNote}</div>
      )}

      {/* Action buttons (pending only, not readOnly) */}
      {d.status === "pending" && !readOnly && (
        <div className="flex gap-2 flex-wrap pt-1">
          <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-300 hover:bg-emerald-50 h-7 px-2 text-xs" onClick={() => act("approved")} disabled={busy}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 mr-1" />} Approve
          </Button>
          <Button size="sm" variant="outline" className="text-red-700 border-red-300 hover:bg-red-50 h-7 px-2 text-xs" onClick={() => act("rejected")} disabled={busy}>
            <X className="w-3 h-3 mr-1" /> Reject
          </Button>
          <Button size="sm" variant="outline" className="text-amber-700 border-amber-300 hover:bg-amber-50 h-7 px-2 text-xs" onClick={() => setShowModify(v => !v)} disabled={busy}>
            <Pencil className="w-3 h-3 mr-1" /> Modify
          </Button>
          <Button size="sm" variant="outline" className="text-slate-600 border-slate-300 hover:bg-slate-50 h-7 px-2 text-xs" onClick={() => setShowPostpone(v => !v)} disabled={busy}>
            <Clock className="w-3 h-3 mr-1" /> Postpone
          </Button>
        </div>
      )}

      {/* Modify inline form */}
      {showModify && (
        <div className="flex flex-col gap-2 pt-1">
          <Textarea
            className="text-sm"
            rows={3}
            value={modifyText}
            onChange={e => setModifyText(e.target.value)}
            placeholder="Modified description..."
          />
          <Input
            className="text-sm h-8"
            value={modifyNote}
            onChange={e => setModifyNote(e.target.value)}
            placeholder="Optional note..."
          />
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={() => act("modified", { modified_text: modifyText, status_note: modifyNote })} disabled={busy || !modifyText.trim()}>
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowModify(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Postpone inline form */}
      {showPostpone && (
        <div className="flex items-center gap-2 pt-1">
          <Input
            type="date"
            className="text-sm h-8 w-40"
            value={postponeDate}
            onChange={e => setPostponeDate(e.target.value)}
          />
          <Button size="sm" className="h-7 text-xs" onClick={() => act("postponed", { postpone_until: postponeDate })} disabled={busy || !postponeDate}>
            Confirm
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowPostpone(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

interface Filters {
  agents: string[];
  types: string[];
  approvalLevels: string[];
  statuses: string[];
}

function FilterBar({
  decisions,
  filters,
  onChange,
}: {
  decisions: Decision[];
  filters: Filters;
  onChange: (f: Filters) => void;
}) {
  const allAgents = useMemo(() => Array.from(new Set(decisions.map(d => d.agent))).sort(), [decisions]);

  const toggle = (key: keyof Filters, val: string) => {
    const arr = filters[key] as string[];
    onChange({
      ...filters,
      [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val],
    });
  };

  const chip = (key: keyof Filters, val: string, label: string, color: string) => {
    const active = (filters[key] as string[]).includes(val);
    return (
      <button
        key={val}
        onClick={() => toggle(key, val)}
        className={`px-2 py-0.5 rounded-full text-xs font-medium border transition-colors ${
          active ? `${color} border-transparent` : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
        }`}
      >
        {label}
      </button>
    );
  };

  const hasFilters = Object.values(filters).some(a => a.length > 0);

  return (
    <div className="flex flex-wrap gap-2 items-center p-3 bg-slate-50 rounded-lg border border-slate-200">
      {allAgents.map(a => chip("agents", a, a, "bg-indigo-100 text-indigo-800 border-indigo-300"))}
      <div className="w-px h-4 bg-slate-300 mx-1" />
      {(["idea", "action", "conflict", "proposal"] as const).map(t =>
        chip("types", t, t, TYPE_COLORS[t] ?? "")
      )}
      <div className="w-px h-4 bg-slate-300 mx-1" />
      {(["livio", "ceo", "boss", "autonomous"] as const).map(l =>
        chip("approvalLevels", l, l, "bg-slate-200 text-slate-700")
      )}
      <div className="w-px h-4 bg-slate-300 mx-1" />
      {(["pending", "approved", "rejected", "modified", "postponed"] as const).map(s =>
        chip("statuses", s, s, STATUS_BADGE[s] ?? "")
      )}
      {hasFilters && (
        <button
          onClick={() => onChange({ agents: [], types: [], approvalLevels: [], statuses: [] })}
          className="ml-2 px-2 py-0.5 text-xs text-slate-500 hover:text-slate-800 underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

interface CeoBriefProps {
  readOnly?: boolean;
}

export default function CeoBrief({ readOnly: readOnlyProp }: CeoBriefProps) {
  const { toast } = useToast();
  const params = useParams<{ id?: string }>();
  const briefIdFromUrl = params?.id;
  // If a specific brief ID is in the URL, treat it as read-only (historical view)
  const readOnly = readOnlyProp ?? !!briefIdFromUrl;

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [data, setData] = useState<BriefResponse>({ brief: null, decisions: [] });
  const [filters, setFilters] = useState<Filters>({
    agents: [], types: [], approvalLevels: [], statuses: [],
  });

  const fetchBrief = useCallback(async () => {
    setLoading(true);
    try {
      const url = briefIdFromUrl
        ? `/api/ceo-brief/${briefIdFromUrl}`
        : `/api/ceo-brief/latest`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to load brief", description: e.message });
    } finally {
      setLoading(false);
    }
  }, [briefIdFromUrl, toast]);

  useEffect(() => { fetchBrief(); }, [fetchBrief]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/ceo-brief/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Unknown error" }));
        throw new Error(err.message);
      }
      const result = await res.json() as BriefResponse;
      setData(result);
      toast({ title: "Brief generated", description: `${result.decisions.length} decisions ready` });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Generation failed", description: e.message });
    } finally {
      setGenerating(false);
    }
  };

  const handleDecide = useCallback(async (id: string, status: string, extra?: Record<string, string>) => {
    const res = await fetch(`/api/ceo-brief/decisions/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...extra }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: "Unknown error" }));
      throw new Error(err.message);
    }
    const updated = await res.json() as Decision;
    setData(prev => ({
      ...prev,
      decisions: prev.decisions.map(d => d.id === id ? updated : d),
    }));
    toast({ title: `Decision ${status}`, description: updated.title });
  }, [toast]);

  // Filtered decisions
  const visibleDecisions = useMemo(() => {
    return data.decisions.filter(d => {
      if (filters.agents.length > 0 && !filters.agents.includes(d.agent)) return false;
      if (filters.types.length > 0 && !filters.types.includes(d.type)) return false;
      if (filters.approvalLevels.length > 0 && !filters.approvalLevels.includes(d.approvalLevel)) return false;
      if (filters.statuses.length > 0 && !filters.statuses.includes(d.status)) return false;
      return true;
    });
  }, [data.decisions, filters]);

  // Stats
  const stats = useMemo(() => ({
    pending:   data.decisions.filter(d => d.status === "pending").length,
    approved:  data.decisions.filter(d => d.status === "approved").length,
    rejected:  data.decisions.filter(d => d.status === "rejected").length,
    postponed: data.decisions.filter(d => d.status === "postponed").length,
  }), [data.decisions]);

  const brief = data.brief;

  // ── Empty state: no brief yet ──────────────────────────────────────────────
  if (!loading && !brief) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground text-lg">No CEO Brief generated yet for today.</p>
        {!readOnly && (
          <Button
            size="lg"
            onClick={handleGenerate}
            disabled={generating}
            className="gap-2"
          >
            {generating
              ? <><Loader2 className="w-5 h-5 animate-spin" /> Generating brief... (~30s)</>
              : <><Play className="w-5 h-5" /> Run Today's Brief</>
            }
          </Button>
        )}
      </div>
    );
  }

  const formattedDate = brief?.generatedAt
    ? new Date(brief.generatedAt).toLocaleString("en-GB", {
        dateStyle: "full", timeStyle: "short",
      })
    : "";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            CEO Brief
            {brief && <span className="text-base font-normal text-muted-foreground ml-2">— {formattedDate}</span>}
          </h1>
          {brief && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {stats.pending} pending · {stats.approved} approved · {stats.rejected} rejected · {stats.postponed} postponed
              {brief.generatedBy === "scheduled" && <span className="ml-2 text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">scheduled</span>}
            </p>
          )}
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchBrief}
              disabled={loading}
              title="Reload"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generating || loading}
              className="gap-1.5"
            >
              {generating
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                : <><Play className="w-4 h-4" /> Run Now</>
              }
            </Button>
          </div>
        )}
      </div>

      {/* Filter bar */}
      {!loading && data.decisions.length > 0 && (
        <FilterBar decisions={data.decisions} filters={filters} onChange={setFilters} />
      )}

      {/* Decision grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : visibleDecisions.length === 0 && data.decisions.length > 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No decisions match the current filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {visibleDecisions.map(d => (
            <DecisionCard
              key={d.id}
              decision={d}
              readOnly={readOnly}
              onDecide={handleDecide}
            />
          ))}
        </div>
      )}

      {/* Brief metadata */}
      {brief && (
        <div className="text-xs text-muted-foreground border-t pt-3 flex flex-wrap gap-4">
          <span>Model: {brief.model ?? "—"}</span>
          <span>Tokens in: {brief.tokenInput?.toLocaleString() ?? "—"} / out: {brief.tokenOutput?.toLocaleString() ?? "—"}</span>
          <span>Duration: {brief.durationMs != null ? `${(brief.durationMs / 1000).toFixed(1)}s` : "—"}</span>
          <span>Trigger: {brief.generatedBy}</span>
        </div>
      )}
    </div>
  );
}
