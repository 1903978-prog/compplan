import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollText, AlertTriangle, Filter, ChevronDown, ChevronRight, CheckCircle2, Circle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface LogRow { id: number; timestamp: string; agent_id: number | null; event_type: string; payload: any; }
interface Conflict {
  id: number; title: string; agents_involved: string | null;
  okrs_affected: string | null; severity: string | null; status: string;
  ceo_recommendation: string | null; livio_decision: string | null;
  created_at: string; resolved_at: string | null;
}
interface Agent { id: number; name: string; }

// 5-step resolution workflow
// step 1: open         — conflict identified, not yet being worked
// step 2: analysing    — CEO writing root-cause analysis
// step 3: ceo_recommended — CEO recommendation ready, pending Livio review
// step 4: livio_deciding  — Livio writing decision
// step 5: resolved     — closed
const STEPS = [
  { status: "open",             label: "1 · Identify" },
  { status: "analysing",        label: "2 · CEO Analyse" },
  { status: "ceo_recommended",  label: "3 · CEO Recommends" },
  { status: "livio_deciding",   label: "4 · Livio Decides" },
  { status: "resolved",         label: "5 · Resolved" },
] as const;
type ConflictStatus = typeof STEPS[number]["status"];

const EVENT_TYPES = [
  "all",
  "idea_generated",
  "action_proposed",
  "task_created",
  "approval_requested",
  "approval_granted",
  "approval_rejected",
  "conflict_detected",
  "prompt_generated",
  "output_imported",
  "decision_logged",
  "coffee_break",
  "exec_committee_called",
];

export default function Logs() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"log" | "conflicts">("log");
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  // Resolution state
  const [expanded, setExpanded]           = useState<Record<number, boolean>>({});
  const [ceoDraft, setCeoDraft]           = useState<Record<number, string>>({});
  const [livioDraft, setLivioDraft]       = useState<Record<number, string>>({});
  const [saving, setSaving]               = useState<Record<number, boolean>>({});

  async function load() {
    try {
      const [l, c, a] = await Promise.all([
        fetch("/api/agentic/log",       { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/conflicts", { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/agents",    { credentials: "include" }).then(r => r.ok ? r.json() : []),
      ]);
      setLogs(Array.isArray(l) ? l : []);
      setConflicts(Array.isArray(c) ? c : []);
      setAgents(Array.isArray(a) ? a : []);
    } catch {
      toast({ title: "Failed to load logs", variant: "destructive" });
    }
  }
  useEffect(() => { void load(); }, []);

  const agentName = (id: number | null) => id == null ? "system" : agents.find(a => a.id === id)?.name ?? `#${id}`;

  function stepIndex(status: string): number {
    const i = STEPS.findIndex(s => s.status === status);
    return i === -1 ? 0 : i;
  }
  function nextStatus(current: string): ConflictStatus | null {
    const i = STEPS.findIndex(s => s.status === current);
    if (i === -1 || i >= STEPS.length - 1) return null;
    return STEPS[i + 1].status;
  }

  async function patchConflict(id: number, patch: Partial<Conflict>) {
    setSaving(s => ({ ...s, [id]: true }));
    try {
      const r = await fetch(`/api/agentic/conflicts/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error("patch failed");
      await load();
      toast({ title: "Conflict updated" });
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    } finally {
      setSaving(s => ({ ...s, [id]: false }));
    }
  }

  async function advanceStep(c: Conflict) {
    const next = nextStatus(c.status);
    if (!next) return;
    const patch: Partial<Conflict> = { status: next };
    if (next === "resolved") patch.resolved_at = new Date().toISOString();
    await patchConflict(c.id, patch);
  }

  async function saveCeoRec(c: Conflict) {
    const text = (ceoDraft[c.id] ?? "").trim();
    if (!text) return;
    await patchConflict(c.id, { ceo_recommendation: text, status: "ceo_recommended" });
    setCeoDraft(d => ({ ...d, [c.id]: "" }));
  }

  async function saveLivioDecision(c: Conflict) {
    const text = (livioDraft[c.id] ?? "").trim();
    if (!text) return;
    await patchConflict(c.id, {
      livio_decision: text,
      status: "resolved",
      resolved_at: new Date().toISOString(),
    });
    setLivioDraft(d => ({ ...d, [c.id]: "" }));
  }

  const filtered = useMemo(() => logs.filter(l => {
    if (filterAgent !== "all" && String(l.agent_id) !== filterAgent) return false;
    if (filterType !== "all" && l.event_type !== filterType) return false;
    return true;
  }), [logs, filterAgent, filterType]);

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-4">
      <div className="flex items-center gap-3">
        <ScrollText className="w-7 h-7 text-primary" />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Atlas</p>
          <h1 className="text-2xl font-bold tracking-tight">Decision Log</h1>
          <p className="text-sm text-muted-foreground">{logs.length} events · {conflicts.length} conflicts · full audit trail</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab("log")}
          className={`text-sm px-3 py-1.5 rounded ${tab === "log" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
        >Activity log</button>
        <button
          onClick={() => setTab("conflicts")}
          className={`text-sm px-3 py-1.5 rounded flex items-center gap-1 ${tab === "conflicts" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
        ><AlertTriangle className="w-3.5 h-3.5" /> Conflict Area ({conflicts.filter(c => c.status !== "resolved").length})</button>
      </div>

      {tab === "log" ? (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-3.5 h-3.5 text-muted-foreground" />
            <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)} className="h-7 text-xs rounded border px-2 bg-background">
              <option value="all">All agents</option>
              <option value="null">System</option>
              {agents.map(a => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="h-7 text-xs rounded border px-2 bg-background">
              {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <span className="text-[10px] text-muted-foreground ml-auto">showing {filtered.length} / {logs.length}</span>
          </div>
          {filtered.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No events match.</p>
          ) : (
            <div className="text-xs space-y-0.5 max-h-[60vh] overflow-y-auto">
              {filtered.map(l => (
                <div key={l.id} className="grid grid-cols-[140px_140px_180px_1fr] gap-2 py-1 border-b items-center">
                  <span className="text-[10px] text-muted-foreground font-mono">{l.timestamp.slice(0, 16).replace("T", " ")}</span>
                  <Badge variant="outline" className="text-[10px] justify-self-start">{l.event_type}</Badge>
                  <span className="text-muted-foreground truncate">{agentName(l.agent_id)}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground" title={JSON.stringify(l.payload)}>
                    {l.payload?.title ?? l.payload?.task_id ?? l.payload?.idea_id ?? l.payload?.conflict_id ?? ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {conflicts.length === 0 ? (
            <Card className="p-4">
              <p className="text-xs italic text-muted-foreground">No conflicts logged. Conflicts arrive automatically when two agents propose incompatible actions, or when the CoWork output emits TYPE: conflict blocks.</p>
            </Card>
          ) : conflicts.map(c => {
            const si = stepIndex(c.status);
            const isExpanded = expanded[c.id] ?? (c.status !== "resolved");
            const isSaving = saving[c.id] ?? false;
            const severityClass =
              c.severity === "high"   ? "border-red-300 bg-red-50/40"
              : c.severity === "medium" ? "border-amber-300 bg-amber-50/40"
              : "border-slate-200";

            return (
              <Card key={c.id} className={`p-0 overflow-hidden border-2 ${severityClass}`}>
                {/* Header — always visible */}
                <button
                  className="w-full text-left p-3 flex items-center gap-2 flex-wrap"
                  onClick={() => setExpanded(e => ({ ...e, [c.id]: !isExpanded }))}
                >
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
                  <Badge variant="outline" className={
                    c.severity === "high"   ? "text-red-700 border-red-300 bg-red-50 shrink-0"
                    : c.severity === "medium" ? "text-amber-700 border-amber-300 bg-amber-50 shrink-0"
                    : "shrink-0"
                  }>{c.severity ?? "?"}</Badge>
                  <span className="font-semibold text-sm flex-1">{c.title}</span>
                  {/* Step progress pills */}
                  <div className="flex items-center gap-1 ml-auto">
                    {STEPS.map((s, i) => (
                      <div key={s.status} className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                        i < si  ? "bg-emerald-100 text-emerald-700"
                        : i === si ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                      }`}>{i + 1}</div>
                    ))}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{c.created_at.slice(0, 10)}</span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-4 text-xs border-t pt-3">

                    {/* Step tracker */}
                    <div className="flex items-center gap-0">
                      {STEPS.map((s, i) => (
                        <div key={s.status} className="flex items-center gap-0 flex-1 min-w-0">
                          <div className={`flex items-center gap-1 text-[10px] font-semibold whitespace-nowrap ${
                            i < si  ? "text-emerald-600"
                            : i === si ? "text-primary"
                            : "text-muted-foreground"
                          }`}>
                            {i < si
                              ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              : <Circle className={`w-3.5 h-3.5 shrink-0 ${i === si ? "text-primary" : ""}`} />}
                            <span className="hidden sm:inline">{s.label}</span>
                          </div>
                          {i < STEPS.length - 1 && <div className={`flex-1 h-px mx-1 ${i < si ? "bg-emerald-300" : "bg-border"}`} />}
                        </div>
                      ))}
                    </div>

                    {/* Meta */}
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      {c.agents_involved && (
                        <div><span className="text-muted-foreground font-semibold">Agents: </span>{c.agents_involved}</div>
                      )}
                      {c.okrs_affected && (
                        <div><span className="text-muted-foreground font-semibold">OKRs affected: </span>{c.okrs_affected}</div>
                      )}
                    </div>

                    {/* ── Step 1 / 2: open or analysing — CEO writes recommendation ── */}
                    {(c.status === "open" || c.status === "analysing") && (
                      <div className="space-y-2 border rounded p-3 bg-background">
                        <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                          Step 2 — CEO: root-cause analysis + recommendation
                        </div>
                        {c.status === "open" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => patchConflict(c.id, { status: "analysing" })} disabled={isSaving}>
                            Start resolution
                          </Button>
                        )}
                        {c.status === "analysing" && (
                          <>
                            <Textarea
                              rows={4}
                              className="text-xs"
                              placeholder="Describe root cause, agents involved, trade-offs, and your recommendation…"
                              value={ceoDraft[c.id] ?? c.ceo_recommendation ?? ""}
                              onChange={e => setCeoDraft(d => ({ ...d, [c.id]: e.target.value }))}
                            />
                            <Button size="sm" onClick={() => saveCeoRec(c)} disabled={isSaving || !(ceoDraft[c.id] ?? "").trim()}>
                              Submit CEO recommendation →
                            </Button>
                          </>
                        )}
                      </div>
                    )}

                    {/* ── Step 3: ceo_recommended — show rec, await Livio ── */}
                    {c.status === "ceo_recommended" && (
                      <div className="space-y-2">
                        <div className="border rounded p-3 bg-background space-y-1">
                          <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">CEO Recommendation</div>
                          <p className="whitespace-pre-wrap">{c.ceo_recommendation}</p>
                        </div>
                        <div className="border rounded p-3 bg-background space-y-2">
                          <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">Step 4 — Livio: write your decision</div>
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => patchConflict(c.id, { status: "livio_deciding" })} disabled={isSaving}>
                            I'm ready to decide →
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* ── Step 4: livio_deciding — Livio writes decision ── */}
                    {c.status === "livio_deciding" && (
                      <div className="space-y-2">
                        {c.ceo_recommendation && (
                          <div className="border rounded p-3 bg-background space-y-1">
                            <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">CEO Recommendation</div>
                            <p className="whitespace-pre-wrap text-[11px]">{c.ceo_recommendation}</p>
                          </div>
                        )}
                        <div className="border rounded p-3 bg-background space-y-2">
                          <div className="text-[10px] uppercase tracking-wider font-bold text-primary">Step 4 — Livio Decision</div>
                          <Textarea
                            rows={4}
                            className="text-xs"
                            placeholder="Your decision: which agent gets priority, what the resolution is, and any follow-up actions…"
                            value={livioDraft[c.id] ?? c.livio_decision ?? ""}
                            onChange={e => setLivioDraft(d => ({ ...d, [c.id]: e.target.value }))}
                          />
                          <Button size="sm" onClick={() => saveLivioDecision(c)} disabled={isSaving || !(livioDraft[c.id] ?? "").trim()}>
                            Close conflict ✓
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* ── Step 5: resolved — full summary ── */}
                    {c.status === "resolved" && (
                      <div className="space-y-2">
                        {c.ceo_recommendation && (
                          <div className="border rounded p-3 bg-emerald-50/40 space-y-1">
                            <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">CEO Recommendation</div>
                            <p className="whitespace-pre-wrap text-[11px]">{c.ceo_recommendation}</p>
                          </div>
                        )}
                        {c.livio_decision && (
                          <div className="border rounded p-3 bg-blue-50/40 space-y-1">
                            <div className="text-[10px] uppercase tracking-wider font-bold text-blue-700">Livio Decision</div>
                            <p className="whitespace-pre-wrap text-[11px]">{c.livio_decision}</p>
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground">
                          Resolved {c.resolved_at ? c.resolved_at.slice(0, 16).replace("T", " ") : ""}
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
