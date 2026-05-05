import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Sun, Coffee, Play, RefreshCw, Copy, Upload, FileText,
  AlertTriangle, CheckCircle, Loader2, ChevronDown, ChevronUp, Zap,
  History, ShieldAlert, ChevronRight, BarChart2, ThumbsUp, ThumbsDown
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
interface AiosCycle {
  id: number; cycle_date: string; cycle_type: string; status: string;
  started_at?: string; completed_at?: string; started_by: string;
  agents_processed: number; sections_analyzed: number;
  insights_count: number; ideas_count: number; actions_count: number;
  cowork_requests_count: number; conflicts_count: number;
  cowork_prompt?: string; summary?: string;
}
interface AiosLog {
  id: number; cycle_id: number; timestamp: string; actor_type: string;
  actor_name?: string; action_type: string; message: string;
  status: string; severity: string;
}
interface AiosDeliverable {
  id: number; cycle_id: number; agent_id: number; agent_name?: string;
  deliverable_type: string; rank: number; title: string; description?: string;
  total_score?: number; status: string; human_rating?: number | null;
}
interface CeoBrief {
  id: number; cycle_id: number; executive_summary?: string;
  top_insights: any[]; top_ideas: any[]; top_actions: any[];
  top_cowork_requests: any[]; conflicts: any[]; decisions_required: any[];
  autonomous_actions: any[]; coo_proposals: any[]; cowork_prompt?: string;
}
interface CoworkLetter {
  id: number; cycle_id: number; agent_name?: string;
  raw_letter_text: string; status: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  working:   "text-blue-400",
  completed: "text-emerald-400",
  warning:   "text-amber-400",
  blocked:   "text-orange-400",
  failed:    "text-red-400",
};
const STATUS_ICONS: Record<string, React.ReactNode> = {
  working:   <Loader2 className="w-3 h-3 animate-spin" />,
  completed: <CheckCircle className="w-3 h-3" />,
  warning:   <AlertTriangle className="w-3 h-3" />,
  blocked:   <AlertTriangle className="w-3 h-3" />,
  failed:    <AlertTriangle className="w-3 h-3" />,
};
const CYCLE_STATUS_BADGE: Record<string, string> = {
  not_started:            "bg-slate-100 text-slate-600",
  running:                "bg-blue-100 text-blue-700 animate-pulse",
  paused:                 "bg-amber-100 text-amber-700",
  completed:              "bg-emerald-100 text-emerald-700",
  failed:                 "bg-red-100 text-red-700",
  cowork_output_received: "bg-purple-100 text-purple-700",
  round2_running:         "bg-indigo-100 text-indigo-700 animate-pulse",
  round2_completed:       "bg-teal-100 text-teal-700",
  round2_failed:          "bg-red-100 text-red-700",
};
function fmt(ts?: string) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AiosCycle() {
  const { toast } = useToast();
  const [cycle, setCycle]           = useState<AiosCycle | null>(null);
  const [allCycles, setAllCycles]   = useState<AiosCycle[]>([]);
  const [logs, setLogs]             = useState<AiosLog[]>([]);
  const [deliverables, setDeliverables] = useState<AiosDeliverable[]>([]);
  const [ceoBrief, setCeoBrief]     = useState<CeoBrief | null>(null);
  const [coworkLetters, setCoworkLetters] = useState<CoworkLetter[]>([]);
  const [expandedLetters, setExpandedLetters] = useState<Set<number>>(new Set());
  const [starting, setStarting]     = useState(false);
  const [showPaste, setShowPaste]   = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [pasting, setPasting]       = useState(false);
  const [showCoworkPrompt, setShowCoworkPrompt] = useState(false);
  const [regening, setRegening]     = useState(false);
  const [startingR2, setStartingR2] = useState(false);
  const [showLogs, setShowLogs]     = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLogId = useRef(0);

  // ── Data fetching ──────────────────────────────────────────────────────────
  const loadLatestCycle = useCallback(async () => {
    const r = await fetch("/api/aios/cycles/latest", { credentials: "include" });
    if (r.ok) setCycle(await r.json());
  }, []);

  const loadAllCycles = useCallback(async () => {
    const r = await fetch("/api/aios/cycles", { credentials: "include" });
    if (r.ok) setAllCycles(await r.json());
  }, []);

  const switchToCycle = useCallback(async (c: AiosCycle) => {
    setCycle(c);
    setLogs([]);
    setDeliverables([]);
    setCeoBrief(null);
    setCoworkLetters([]);
    lastLogId.current = 0;
    setShowHistory(false);
    const [logs, d, b, ltrs] = await Promise.all([
      fetch(`/api/aios/cycles/${c.id}/logs`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch(`/api/aios/cycles/${c.id}/deliverables`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch(`/api/aios/cycles/${c.id}/ceo-brief`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`/api/aios/cycles/${c.id}/cowork-letters`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ]);
    setLogs(logs);
    if (logs.length > 0) lastLogId.current = logs[logs.length - 1].id;
    setDeliverables(d);
    if (b) setCeoBrief(b);
    setCoworkLetters(ltrs);
  }, []);

  const rateDeliverable = useCallback(async (id: number, rating: 1 | -1 | null) => {
    await fetch(`/api/aios/deliverables/${id}/rate`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    });
    setDeliverables(prev => prev.map(d => d.id === id ? { ...d, human_rating: rating } : d));
  }, []);

  const loadCycleData = useCallback(async (id: number) => {
    const [d, b, ltrs] = await Promise.all([
      fetch(`/api/aios/cycles/${id}/deliverables`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch(`/api/aios/cycles/${id}/ceo-brief`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`/api/aios/cycles/${id}/cowork-letters`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ]);
    setDeliverables(d);
    if (b) setCeoBrief(b);
    setCoworkLetters(ltrs);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const pollLogs = useCallback(async (id: number) => {
    const r = await fetch(`/api/aios/cycles/${id}/logs?since=${lastLogId.current}`, { credentials: "include" });
    if (!r.ok) return;
    const newLogs: AiosLog[] = await r.json();
    if (newLogs.length > 0) {
      lastLogId.current = newLogs[newLogs.length - 1].id;
      setLogs(prev => [...prev, ...newLogs]);
    }
    // Also refresh cycle status
    const cr = await fetch(`/api/aios/cycles/${id}`, { credentials: "include" });
    if (cr.ok) {
      const updated: AiosCycle = await cr.json();
      setCycle(updated);
      const terminal = ["completed", "failed", "paused", "round2_completed", "round2_failed"];
      if (terminal.includes(updated.status)) {
        stopPolling();
        loadCycleData(id);
      }
    }
  }, [loadCycleData, stopPolling]);

  const startPolling = useCallback((id: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => pollLogs(id), 3000);
  }, [pollLogs]);

  useEffect(() => {
    loadLatestCycle();
    loadAllCycles();
    return () => stopPolling();
  }, [loadLatestCycle, loadAllCycles, stopPolling]);

  useEffect(() => {
    if (!cycle) return;
    const active = ["running", "round2_running"];
    const done   = ["completed", "cowork_output_received", "round2_completed", "round2_failed"];
    if (active.includes(cycle.status) || cycle.status === "paused") {
      loadCycleData(cycle.id);
      if (active.includes(cycle.status)) startPolling(cycle.id);
    } else if (done.includes(cycle.status)) {
      loadCycleData(cycle.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle?.id, cycle?.status]);

  // Auto-scroll logs
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function startCycle() {
    setStarting(true);
    setLogs([]);
    lastLogId.current = 0;
    try {
      const r = await fetch("/api/aios/cycles", { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      const { cycleId } = await r.json();
      await loadLatestCycle();
      startPolling(cycleId);
      toast({ title: "Atlas cycle started", description: `Cycle #${cycleId} running. Watch the activity log.` });
    } catch (e: any) {
      toast({ title: "Failed to start", description: e.message, variant: "destructive" });
    }
    setStarting(false);
  }

  async function pauseCycle() {
    if (!cycle) return;
    await fetch(`/api/aios/cycles/${cycle.id}/pause`, { method: "POST", credentials: "include" });
    stopPolling();
    loadLatestCycle();
    toast({ title: "Cycle paused" });
  }

  async function resumeCycle() {
    if (!cycle) return;
    await fetch(`/api/aios/cycles/${cycle.id}/resume`, { method: "POST", credentials: "include" });
    startPolling(cycle.id);
    loadLatestCycle();
    toast({ title: "Cycle resumed" });
  }

  async function regenCoworkPrompt() {
    if (!cycle) return;
    setRegening(true);
    try {
      const r = await fetch(`/api/aios/cycles/${cycle.id}/generate-cowork-prompt`, { method: "POST", credentials: "include" });
      const { prompt } = await r.json();
      setCycle(prev => prev ? { ...prev, cowork_prompt: prompt } : prev);
      setShowCoworkPrompt(true);
      toast({ title: "CoWork prompt regenerated" });
    } catch { toast({ title: "Failed", variant: "destructive" }); }
    setRegening(false);
  }

  function copyPrompt() {
    if (!cycle?.cowork_prompt) return;
    navigator.clipboard.writeText(cycle.cowork_prompt);
    toast({ title: "Copied to clipboard" });
  }

  async function pasteOutput() {
    if (!cycle || !pasteDraft.trim()) return;
    setPasting(true);
    try {
      await fetch(`/api/aios/cycles/${cycle.id}/cowork-output`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_output_text: pasteDraft }),
      });
      setPasteDraft("");
      setShowPaste(false);
      loadLatestCycle();
      toast({ title: "CoWork output stored", description: "Cycle updated. Agent letters parsed if present." });
    } catch { toast({ title: "Failed", variant: "destructive" }); }
    setPasting(false);
  }

  async function startRound2() {
    if (!cycle) return;
    setStartingR2(true);
    try {
      const r = await fetch(`/api/aios/cycles/${cycle.id}/run-round2`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      startPolling(cycle.id);
      loadLatestCycle();
      toast({ title: "Round 2 started", description: "Agents are incorporating CoWork findings." });
    } catch (e: any) {
      toast({ title: "Round 2 failed to start", description: e.message, variant: "destructive" });
    }
    setStartingR2(false);
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const isRunning   = cycle?.status === "running";
  const isR2Running = cycle?.status === "round2_running";
  const isPaused    = cycle?.status === "paused";
  const isDone      = ["completed", "cowork_output_received", "round2_completed", "round2_failed"].includes(cycle?.status ?? "");
  const canStart    = !cycle || isDone || cycle.status === "failed";
  const canRunR2    = cycle?.status === "cowork_output_received";
  const anyRunning  = isRunning || isR2Running;

  const agentNames = Array.from(new Set(deliverables.map(d => d.agent_name).filter((n): n is string => !!n)));
  const byAgent = (name: string, type: string) => deliverables.filter(d => d.agent_name === name && d.deliverable_type === type);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">
      {/* ── LEFT: main content ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Control Panel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="w-4 h-4 text-amber-500" /> Atlas Daily Control Panel
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button onClick={startCycle} disabled={starting || anyRunning || isPaused} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {starting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sun className="w-4 h-4 mr-2" />}
                8am — Start Atlas
              </Button>
              <Button onClick={startCycle} disabled={starting || anyRunning || isPaused} variant="outline">
                <Play className="w-4 h-4 mr-2" /> Start Work
              </Button>
              {isRunning && (
                <Button onClick={pauseCycle} variant="outline">
                  <Coffee className="w-4 h-4 mr-2" /> Coffee Break
                </Button>
              )}
              {isPaused && (
                <Button onClick={resumeCycle} className="bg-blue-600 hover:bg-blue-700 text-white">
                  <Play className="w-4 h-4 mr-2" /> Resume Atlas
                </Button>
              )}
              {canRunR2 && (
                <Button onClick={startRound2} disabled={startingR2} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  {startingR2 ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Start Round 2
                </Button>
              )}
              {cycle && (
                <>
                  <Button onClick={regenCoworkPrompt} disabled={regening} variant="outline">
                    {regening ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                    Generate CoWork Prompt
                  </Button>
                  <Button onClick={copyPrompt} disabled={!cycle.cowork_prompt} variant="outline">
                    <Copy className="w-4 h-4 mr-2" /> Copy CoWork Prompt
                  </Button>
                  <Button onClick={() => setShowPaste(v => !v)} variant="outline">
                    <Upload className="w-4 h-4 mr-2" /> Paste CoWork Output
                  </Button>
                </>
              )}
              <Button onClick={() => setShowLogs(v => !v)} variant="ghost" size="sm">
                <FileText className="w-4 h-4 mr-1" /> {showLogs ? "Hide" : "View"} Activity Log
              </Button>
              <Button onClick={() => { setShowHistory(v => !v); loadAllCycles(); }} variant="ghost" size="sm">
                <History className="w-4 h-4 mr-1" /> Cycle History
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Cycle history */}
        {showHistory && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <History className="w-4 h-4" /> Cycle History
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {allCycles.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3 italic">No cycles yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {["#","Date","Status","Agents","Insights","Ideas","Actions","CoWork Req",""].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allCycles.map(c => (
                      <tr key={c.id} className={`border-b hover:bg-muted/20 ${c.id === cycle?.id ? "bg-blue-50/40" : ""}`}>
                        <td className="px-3 py-2 font-mono text-muted-foreground">#{c.id}</td>
                        <td className="px-3 py-2">{c.cycle_date}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${CYCLE_STATUS_BADGE[c.status] ?? "bg-slate-100 text-slate-600"}`}>
                            {c.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-3 py-2">{c.agents_processed}</td>
                        <td className="px-3 py-2">{c.insights_count}</td>
                        <td className="px-3 py-2">{c.ideas_count}</td>
                        <td className="px-3 py-2">{c.actions_count}</td>
                        <td className="px-3 py-2">{c.cowork_requests_count}</td>
                        <td className="px-3 py-2">
                          <Button size="sm" variant="ghost" onClick={() => switchToCycle(c)} className="h-6 text-xs">
                            View <ChevronRight className="w-3 h-3 ml-1" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        )}

        {/* Paste CoWork output inline */}
        {showPaste && cycle && (
          <Card className="border-purple-200 bg-purple-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-purple-800">Paste Claude CoWork Output</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Textarea
                value={pasteDraft}
                onChange={e => setPasteDraft(e.target.value)}
                placeholder="Paste the full CoWork output here (including all agent letters)…"
                className="min-h-[200px] font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button onClick={pasteOutput} disabled={pasting || !pasteDraft.trim()} className="bg-purple-600 hover:bg-purple-700 text-white">
                  {pasting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                  Store Output
                </Button>
                <Button onClick={() => { setShowPaste(false); setPasteDraft(""); }} variant="ghost">Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cycle Status */}
        {cycle && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>Current Atlas Cycle — #{cycle.id} · {cycle.cycle_date}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CYCLE_STATUS_BADGE[cycle.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {cycle.status.replace(/_/g, " ")}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {[
                  ["Started", fmt(cycle.started_at)],
                  ["Completed", fmt(cycle.completed_at)],
                  ["Started by", cycle.started_by],
                  ["Type", cycle.cycle_type],
                  ["Agents processed", cycle.agents_processed],
                  ["Insights", cycle.insights_count],
                  ["Ideas", cycle.ideas_count],
                  ["Actions", cycle.actions_count],
                  ["CoWork requests", cycle.cowork_requests_count],
                  ["Conflicts", cycle.conflicts_count],
                  ["CoWork prompt", cycle.cowork_prompt ? "Ready" : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="space-y-0.5">
                    <div className="text-muted-foreground font-medium">{k}</div>
                    <div className="font-semibold">{String(v)}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Agent progress table with drilldown */}
        {agentNames.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <BarChart2 className="w-4 h-4" /> Agent Deliverables
                <span className="text-[10px] text-muted-foreground font-normal ml-auto">Click an agent to expand</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {agentNames.map(name => {
                const ins  = byAgent(name, "insight");
                const ideas = byAgent(name, "idea");
                const acts = byAgent(name, "action");
                const cws  = byAgent(name, "cowork_request");
                const done = ins.length > 0 || ideas.length > 0;
                const expanded = expandedAgents.has(name);
                return (
                  <div key={name} className="border-b last:border-b-0">
                    {/* Summary row */}
                    <button
                      onClick={() => setExpandedAgents(prev => {
                        const s = new Set(prev);
                        if (s.has(name)) s.delete(name); else s.add(name);
                        return s;
                      })}
                      className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-muted/20 text-left"
                    >
                      {expanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                      <span className="font-medium w-36 shrink-0">{name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${done ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-600"}`}>
                        {done ? "done" : "pending"}
                      </span>
                      <span className="text-muted-foreground ml-2">
                        💡{ins.length} · 🔮{ideas.length} · ⚡{acts.length} · 🔍{cws.length}
                      </span>
                    </button>
                    {/* Drilldown */}
                    {expanded && (
                      <div className="px-8 pb-3 space-y-2">
                        {([ ["Insights", ins, "emerald"], ["Ideas", ideas, "blue"], ["Actions", acts, "amber"], ["CoWork Requests", cws, "purple"] ] as [string, AiosDeliverable[], string][]).map(([label, items, color]) => (
                          items.length > 0 && (
                            <div key={label}>
                              <div className={`text-[10px] uppercase font-bold text-${color}-600 mb-1`}>{label}</div>
                              {items.map(d => (
                                <div key={d.id} className="text-xs flex gap-2 items-start py-0.5">
                                  <span className="text-muted-foreground shrink-0">#{d.rank}</span>
                                  <span className="flex-1">{d.title}</span>
                                  {d.status === "round2" && (
                                    <Badge className="text-[10px] h-4 shrink-0 bg-indigo-100 text-indigo-700 border-indigo-300">R2</Badge>
                                  )}
                                  {d.total_score != null && (
                                    <Badge variant="outline" className="text-[10px] h-4 shrink-0">{d.total_score}</Badge>
                                  )}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void rateDeliverable(d.id, d.human_rating === 1 ? null : 1); }}
                                    className={`shrink-0 rounded hover:bg-emerald-100 p-0.5 transition-colors ${d.human_rating === 1 ? "text-emerald-600" : "text-muted-foreground/40 hover:text-emerald-600"}`}
                                    title="Good"
                                  >
                                    <ThumbsUp className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void rateDeliverable(d.id, d.human_rating === -1 ? null : -1); }}
                                    className={`shrink-0 rounded hover:bg-red-100 p-0.5 transition-colors ${d.human_rating === -1 ? "text-red-500" : "text-muted-foreground/40 hover:text-red-500"}`}
                                    title="Not useful"
                                  >
                                    <ThumbsDown className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Conflict Area */}
        {ceoBrief && ((ceoBrief.conflicts as any[]) ?? []).length > 0 && (
          <Card className="border-red-200 bg-red-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-red-700">
                <ShieldAlert className="w-4 h-4" /> Conflict Area — {((ceoBrief.conflicts as any[]) ?? []).length} detected
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {((ceoBrief.conflicts as any[]) ?? []).map((c: any, i: number) => (
                <div key={i} className="border border-red-200 rounded p-2 bg-white/60">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">{c.title}</span>
                    {c.severity && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${c.severity === "high" ? "bg-red-100 text-red-700" : c.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                        {c.severity}
                      </span>
                    )}
                  </div>
                  {c.agents_involved && <div className="text-muted-foreground">Agents: {c.agents_involved}</div>}
                  {c.description && <div className="mt-1">{c.description}</div>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* CEO Brief */}
        {ceoBrief && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">CEO Brief Preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              {ceoBrief.executive_summary && (
                <div>
                  <div className="font-semibold text-muted-foreground mb-1">Executive Summary</div>
                  <p className="leading-relaxed">{ceoBrief.executive_summary}</p>
                </div>
              )}
              {([
                ["Top Insights", ceoBrief.top_insights],
                ["Top Ideas", ceoBrief.top_ideas],
                ["Top Actions", ceoBrief.top_actions],
                ["Top CoWork Requests", ceoBrief.top_cowork_requests],
                ["Decisions Required from President", ceoBrief.decisions_required],
                ["Autonomous Actions", ceoBrief.autonomous_actions],
                ["COO Self-Improvement Proposals", ceoBrief.coo_proposals],
              ] as [string, any[]][]).map(([label, items]) => {
                const arr = items ?? [];
                if (arr.length === 0) return null;
                return (
                  <div key={label}>
                    <div className="font-semibold text-muted-foreground mb-1">{label}</div>
                    <ol className="list-decimal list-inside space-y-1">
                      {arr.map((item: any, i: number) => (
                        <li key={i}><strong>{item.title}</strong>{item.description ? `: ${item.description}` : item.problem ? `: ${item.problem}` : ""}</li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* CoWork Prompt Box */}
        {/* CoWork Letters (parsed from pasted output) */}
        {coworkLetters.length > 0 && (
          <Card className="border-indigo-200">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm text-indigo-700">
                <FileText className="w-4 h-4" /> CoWork Letters — {coworkLetters.length} parsed
                <span className="text-[10px] text-muted-foreground font-normal ml-auto">Click to expand</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {coworkLetters.map(l => {
                const open = expandedLetters.has(l.id);
                return (
                  <div key={l.id} className="border-b last:border-b-0">
                    <button
                      onClick={() => setExpandedLetters(prev => {
                        const s = new Set(prev);
                        if (s.has(l.id)) s.delete(l.id); else s.add(l.id);
                        return s;
                      })}
                      className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-muted/20 text-left"
                    >
                      {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                      <span className="font-medium">Letter to {l.agent_name ?? "Unknown"}</span>
                      <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded font-semibold ${l.status === "round2_processed" ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600"}`}>
                        {l.status}
                      </span>
                    </button>
                    {open && (
                      <div className="px-6 pb-3">
                        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono bg-slate-50 border rounded p-2 max-h-[300px] overflow-y-auto">
                          {l.raw_letter_text}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {cycle?.cowork_prompt && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>CoWork Prompt</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setShowCoworkPrompt(v => !v)}>
                    {showCoworkPrompt ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </Button>
                  <Button size="sm" variant="outline" onClick={copyPrompt}>
                    <Copy className="w-3 h-3 mr-1" /> Copy
                  </Button>
                  <Button size="sm" variant="outline" onClick={regenCoworkPrompt} disabled={regening}>
                    <RefreshCw className="w-3 h-3 mr-1" /> Regenerate
                  </Button>
                </div>
              </CardTitle>
              <div className="text-[10px] text-muted-foreground">
                Cycle #{cycle.id} · {cycle.cowork_prompt.length.toLocaleString()} characters
              </div>
            </CardHeader>
            {showCoworkPrompt && (
              <CardContent>
                <Textarea
                  readOnly
                  value={cycle.cowork_prompt}
                  className="min-h-[300px] font-mono text-xs"
                />
              </CardContent>
            )}
          </Card>
        )}
      </div>

      {/* ── RIGHT: Live Activity Log ────────────────────────────────────────── */}
      {showLogs && (
        <div className="w-[360px] shrink-0 border-l flex flex-col bg-slate-950 text-slate-100">
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">Live Activity</span>
            {isRunning   && <span className="flex items-center gap-1 text-xs text-blue-400"><Loader2 className="w-3 h-3 animate-spin" /> Round 1</span>}
            {isR2Running && <span className="flex items-center gap-1 text-xs text-indigo-400"><Loader2 className="w-3 h-3 animate-spin" /> Round 2</span>}
            {isPaused    && <span className="text-xs text-amber-400">Paused</span>}
            {isDone      && <span className="text-xs text-emerald-400">Complete</span>}
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="p-2 space-y-1 font-mono text-[11px]">
              {logs.length === 0 && (
                <div className="text-slate-500 italic p-2">No activity yet. Click "8am — Start Atlas" to begin.</div>
              )}
              {logs.map(l => (
                <div key={l.id} className={`flex gap-2 items-start leading-snug ${l.severity === "critical" ? "text-red-400" : l.severity === "warning" ? "text-amber-400" : "text-slate-300"}`}>
                  <span className="text-slate-500 shrink-0 mt-0.5">{l.timestamp.slice(11, 19)}</span>
                  <span className={`shrink-0 mt-0.5 ${STATUS_COLORS[l.status] ?? ""}`}>{STATUS_ICONS[l.status]}</span>
                  <span className="text-slate-400 shrink-0">{l.actor_name ?? l.actor_type}</span>
                  <span className="flex-1 break-words">{l.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
