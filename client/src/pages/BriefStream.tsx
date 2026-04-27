import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Activity, Search, FileText, Send, CheckCircle2, AlertTriangle, RefreshCw, Brain, ChevronRight, ChevronDown, Bot } from "lucide-react";

interface BriefRun {
  id: number;
  trigger: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  final_summary: string | null;
  proposals_count: number;
}

interface BriefEvent {
  id: number;
  run_id: number;
  role_key: string;
  event_type: string;
  summary: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

const POLL_RUNNING_MS = 2000;   // 2s while a run is active
const POLL_IDLE_MS    = 10000;  // 10s when nothing's running

function eventIcon(t: string) {
  switch (t) {
    case "started":    return <Activity className="w-3.5 h-3.5 text-blue-500" />;
    case "searching":  return <Search className="w-3.5 h-3.5 text-violet-500" />;
    case "gathering":  return <Brain className="w-3.5 h-3.5 text-violet-500" />;
    case "drafting":   return <FileText className="w-3.5 h-3.5 text-amber-500" />;
    case "posted":     return <Send className="w-3.5 h-3.5 text-emerald-500" />;
    case "completed":  return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
    case "escalated":  return <AlertTriangle className="w-3.5 h-3.5 text-red-500" />;
    case "failed":     return <AlertTriangle className="w-3.5 h-3.5 text-red-600" />;
    default:           return <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

function fmtRel(iso: string): string {
  const d = new Date(iso);
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function BriefStream() {
  const { toast } = useToast();
  const [runs, setRuns] = useState<BriefRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [events, setEvents] = useState<BriefEvent[]>([]);
  const [run, setRun] = useState<BriefRun | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Poll the runs list. Cadence depends on whether anything's running.
  useEffect(() => {
    let cancelled = false;
    const fetchRuns = async () => {
      try {
        const r = await fetch("/api/brief-runs?limit=15", { credentials: "include" });
        if (!r.ok) return;
        const data: BriefRun[] = await r.json();
        if (cancelled) return;
        setRuns(data);
        // Auto-select most-recent running run if user hasn't picked one.
        if (activeRunId === null) {
          const running = data.find(x => x.status === "running");
          if (running) setActiveRunId(running.id);
          else if (data[0]) setActiveRunId(data[0].id);
        }
        setLoading(false);
      } catch { /* silent */ }
    };
    fetchRuns();
    const anyRunning = runs.some(r => r.status === "running");
    const interval = setInterval(fetchRuns, anyRunning ? POLL_RUNNING_MS : POLL_IDLE_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeRunId, runs]);

  // Poll the selected run + its events.
  useEffect(() => {
    if (activeRunId === null) return;
    let cancelled = false;
    const fetchOne = async () => {
      try {
        const r = await fetch(`/api/brief-runs/${activeRunId}`, { credentials: "include" });
        if (!r.ok) return;
        const data: { run: BriefRun; events: BriefEvent[] } = await r.json();
        if (cancelled) return;
        setRun(data.run);
        setEvents(data.events);
      } catch { /* silent */ }
    };
    fetchOne();
    const cadence = (run?.status === "running") ? POLL_RUNNING_MS : POLL_IDLE_MS;
    const interval = setInterval(fetchOne, cadence);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeRunId, run?.status]);

  // Group events by role for the per-role-lane view.
  const byRole = useMemo(() => {
    const out = new Map<string, BriefEvent[]>();
    for (const e of events) {
      const arr = out.get(e.role_key) ?? [];
      arr.push(e);
      out.set(e.role_key, arr);
    }
    return out;
  }, [events]);

  const startManualRun = async () => {
    const r = await fetch("/api/brief-runs", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "manual UI start" }),
    });
    if (r.ok) {
      const newRun = await r.json();
      setActiveRunId(newRun.id);
      toast({
        title: `Run #${newRun.id} created`,
        description: "Open Claude Code and type 'ceo brief' — the skill will write into this run.",
      });
    } else {
      toast({ title: "Failed to start run", variant: "destructive" });
    }
  };

  if (loading) {
    return <div className="container mx-auto py-8 text-sm text-muted-foreground">Loading brief stream…</div>;
  }

  return (
    <div className="container mx-auto py-6 max-w-7xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Activity className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Brief Stream — live cascade</h1>
            <p className="text-sm text-muted-foreground">
              Watch the org "think" in real time. When you type <code className="text-xs bg-muted px-1 rounded">ceo brief</code> in Claude Code, the skill posts events here as each role searches, gathers, drafts, and submits proposals. Polls every 2s while a run is live.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={startManualRun}>
          <RefreshCw className="w-4 h-4 mr-1" /> New run
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* ── Recent runs sidebar ────────────────────────────────── */}
        <Card className="p-2 max-h-[80vh] overflow-y-auto">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-2 py-1">Recent runs</h3>
          {runs.length === 0 ? (
            <p className="text-xs text-muted-foreground italic px-2 py-3">
              No runs yet. Type "ceo brief" in Claude Code to start the first cascade.
            </p>
          ) : (
            <ul className="space-y-1">
              {runs.map(r => {
                const isActive = r.id === activeRunId;
                const tone = r.status === "running" ? "border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
                  : r.status === "completed" ? "border-l-emerald-500"
                  : "border-l-red-500";
                return (
                  <li
                    key={r.id}
                    onClick={() => setActiveRunId(r.id)}
                    className={`cursor-pointer border-l-2 ${tone} px-2 py-1.5 rounded ${isActive ? "bg-muted" : "hover:bg-muted/50"}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono text-xs">#{r.id}</span>
                      <Badge variant="outline" className="text-[9px] py-0 h-4 capitalize">
                        {r.status === "running" && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 mr-1 animate-pulse" />}
                        {r.status}
                      </Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate mt-0.5">{r.trigger}</div>
                    <div className="text-[10px] text-muted-foreground">{fmtRel(r.started_at)}</div>
                    {r.proposals_count > 0 && (
                      <div className="text-[10px] text-emerald-600 font-semibold">{r.proposals_count} proposal{r.proposals_count !== 1 ? "s" : ""}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* ── Active run detail ──────────────────────────────────── */}
        <div>
          {run ? (
            <>
              <div className="mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm">#{run.id}</span>
                  <Badge className={
                    run.status === "running" ? "bg-blue-100 text-blue-700 border-blue-200" :
                    run.status === "completed" ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
                    "bg-red-100 text-red-700 border-red-200"
                  }>
                    {run.status === "running" && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 mr-1 animate-pulse" />}
                    {run.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{run.trigger}</span>
                  <span className="text-xs text-muted-foreground">started {fmtRel(run.started_at)}</span>
                  {run.completed_at && <span className="text-xs text-muted-foreground">· finished {fmtRel(run.completed_at)}</span>}
                  <span className="text-xs ml-auto">{events.length} event{events.length !== 1 ? "s" : ""}</span>
                </div>
                {run.final_summary && (
                  <Card className="mt-2 p-3 bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-300">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 mb-1">CEO synthesis</div>
                    <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{run.final_summary}</pre>
                  </Card>
                )}
              </div>

              {/* Per-role lanes */}
              {byRole.size === 0 ? (
                <Card className="p-6 text-center text-sm text-muted-foreground italic">
                  Waiting for the first event… open Claude Code and type "ceo brief" if you haven't already.
                </Card>
              ) : (
                <div className="space-y-3">
                  {Array.from(byRole.entries()).map(([roleKey, roleEvents]) => {
                    const last = roleEvents[roleEvents.length - 1];
                    const isDone = last?.event_type === "completed" || last?.event_type === "posted";
                    const isFailed = last?.event_type === "failed";
                    const tone = isFailed ? "border-l-red-500" : isDone ? "border-l-emerald-500" : "border-l-blue-500";
                    return (
                      <Card key={roleKey} className={`p-3 border-l-4 ${tone}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Bot className="w-4 h-4 text-violet-500" />
                          <span className="font-semibold text-sm">{roleKey}</span>
                          <Badge variant="outline" className="text-[10px]">{roleEvents.length} step{roleEvents.length !== 1 ? "s" : ""}</Badge>
                          {!isDone && !isFailed && (
                            <span className="text-[10px] text-blue-600 ml-auto">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 mr-1 animate-pulse" />
                              working…
                            </span>
                          )}
                        </div>
                        <ol className="space-y-1.5">
                          {roleEvents.map(e => {
                            const isExpanded = expandedEvent === e.id;
                            const hasPayload = e.payload && Object.keys(e.payload).length > 0;
                            return (
                              <li key={e.id} className="text-xs flex items-start gap-2">
                                <span className="shrink-0 mt-0.5">{eventIcon(e.event_type)}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <Badge variant="secondary" className="text-[9px] py-0 h-4 capitalize">{e.event_type}</Badge>
                                    <span className="leading-snug">{e.summary}</span>
                                    {hasPayload && (
                                      <button
                                        onClick={() => setExpandedEvent(isExpanded ? null : e.id)}
                                        className="text-muted-foreground hover:text-foreground"
                                      >
                                        {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                      </button>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">{fmtRel(e.created_at)}</div>
                                  {isExpanded && hasPayload && (
                                    <pre className="mt-1 p-2 bg-muted rounded text-[10px] overflow-x-auto whitespace-pre-wrap">
                                      {JSON.stringify(e.payload, null, 2)}
                                    </pre>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <Card className="p-6 text-center text-sm text-muted-foreground italic">
              Select a run from the sidebar.
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
