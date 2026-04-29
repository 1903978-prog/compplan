import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sun, Coffee, Users, Sparkles, Download, AlertTriangle, Zap, Send, MessageSquare, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  buildCoworkPrompt,
  type AgentLite, type ObjectiveLite, type IdeaLite, type TaskLite, type ConflictLite,
  type BdDeal, type ProposalLite, type InvoiceLite, type WonProjectLite, type HiringStage, type CrossAlert,
} from "./promptTemplates";

// ─── Phase 1 — Agentic Home ────────────────────────────────────────────────
// Lives at /agentic. Holds the three big buttons specified by the blueprint:
//   [8am at work!]            → builds the Cowork prompt from live data
//   [Coffee break]            → flips the agents_paused flag (logged event)
//   [Call Executive Committee] → placeholder logged event
// Also surfaces a quick status panel + links to the other agentic pages.

export default function AgenticHome() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [objectives, setObjectives] = useState<ObjectiveLite[]>([]);
  const [ideas, setIdeas] = useState<IdeaLite[]>([]);
  const [tasks, setTasks] = useState<TaskLite[]>([]);
  const [conflicts, setConflicts] = useState<ConflictLite[]>([]);
  const [generated, setGenerated] = useState<string>("");
  // App-section enrichment for the 8am brief
  const [bdDeals, setBdDeals] = useState<BdDeal[]>([]);
  const [recentProposals, setRecentProposals] = useState<ProposalLite[]>([]);
  const [openInvoices, setOpenInvoices] = useState<InvoiceLite[]>([]);
  const [wonProjects, setWonProjects] = useState<WonProjectLite[]>([]);
  const [hiringByStage, setHiringByStage] = useState<HiringStage[]>([]);
  const [employeeCount, setEmployeeCount] = useState<number>(0);
  const [paused, setPaused] = useState(() => {
    try { return localStorage.getItem("agents_paused_v1") === "true"; } catch { return false; }
  });

  // President → CEO channel
  interface PresidentRequest {
    id: number;
    message: string;
    status: "pending" | "answered" | "needs_committee" | "committee_done";
    ceo_response: string | null;
    committee_prompt: string | null;
    committee_outcome: string | null;
    created_at: string | null;
  }
  const [presidentRequests, setPresidentRequests] = useState<PresidentRequest[]>([]);
  const [presidentDraft, setPresidentDraft] = useState("");
  const [outcomeDraftBy, setOutcomeDraftBy] = useState<Record<number, string>>({});
  const [replyDraftBy, setReplyDraftBy]     = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  async function loadPresidentRequests() {
    try {
      const r = await fetch("/api/agentic/president-requests", { credentials: "include" });
      if (r.ok) setPresidentRequests(await r.json());
    } catch { /* non-fatal */ }
  }

  async function loadAll() {
    try {
      const [a, o, i, t, c, bd, props, inv, wp, hs, emp] = await Promise.all([
        fetch("/api/agentic/agents",     { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/objectives", { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/ideas",      { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/tasks",      { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/conflicts",  { credentials: "include" }).then(r => r.ok ? r.json() : []),
        // App-section enrichment
        fetch("/api/agentic/brief-data/bd-deals",        { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/brief-data/proposals",       { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/brief-data/invoices",        { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/brief-data/won-projects",    { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/brief-data/hiring-pipeline", { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/brief-data/headcount",       { credentials: "include" }).then(r => r.ok ? r.json() : { count: 0 }),
      ]);
      setAgents(a); setObjectives(o); setIdeas(i); setTasks(t); setConflicts(c);
      setBdDeals(Array.isArray(bd) ? bd : []);
      setRecentProposals(Array.isArray(props) ? props : []);
      setOpenInvoices(Array.isArray(inv) ? inv : []);
      setWonProjects(Array.isArray(wp) ? wp : []);
      setHiringByStage(Array.isArray(hs) ? hs : []);
      setEmployeeCount(typeof emp?.count === "number" ? emp.count : 0);
    } catch {
      toast({ title: "Failed to load agentic state", variant: "destructive" });
    }
  }
  useEffect(() => { void loadAll(); void loadPresidentRequests(); }, []);

  async function kickAgents() {
    try {
      const r = await fetch("/api/agentic/agents/kick", { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error("kick failed");
      const j = await r.json();
      toast({ title: `${j.kicked} agents at work`, description: "Status flipped to 'working' · event logged on Decision Log." });
      void loadAll();
    } catch {
      toast({ title: "Kick failed", variant: "destructive" });
    }
  }

  async function submitPresidentRequest() {
    const text = presidentDraft.trim();
    if (!text) return;
    try {
      const r = await fetch("/api/agentic/president-requests", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!r.ok) throw new Error("submit failed");
      setPresidentDraft("");
      toast({ title: "Sent to CEO", description: "The CEO will reply directly or escalate to the Exec Committee." });
      void loadPresidentRequests();
    } catch { toast({ title: "Send failed", variant: "destructive" }); }
  }

  async function ceoReply(id: number) {
    const text = (replyDraftBy[id] ?? "").trim();
    if (!text) return;
    const r = await fetch(`/api/agentic/president-requests/${id}/reply`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ceo_response: text }),
    });
    if (r.ok) {
      toast({ title: "CEO reply saved" });
      setReplyDraftBy(prev => ({ ...prev, [id]: "" }));
      void loadPresidentRequests();
    } else toast({ title: "Reply failed", variant: "destructive" });
  }

  async function ceoEscalate(id: number) {
    const r = await fetch(`/api/agentic/president-requests/${id}/escalate`, {
      method: "POST", credentials: "include",
    });
    if (r.ok) {
      toast({ title: "Cowork prompt generated", description: "Copy + paste into Cowork, then paste outcome back here." });
      void loadPresidentRequests();
    } else toast({ title: "Escalate failed", variant: "destructive" });
  }

  async function importOutcome(id: number) {
    const text = (outcomeDraftBy[id] ?? "").trim();
    if (!text) return;
    const r = await fetch(`/api/agentic/president-requests/${id}/import-outcome`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome: text }),
    });
    if (r.ok) {
      toast({ title: "Committee outcome saved", description: "Open OKR Center to import the DECISION blocks into the system." });
      setOutcomeDraftBy(prev => ({ ...prev, [id]: "" }));
      void loadPresidentRequests();
    } else toast({ title: "Save failed", variant: "destructive" });
  }

  async function archiveRequest(id: number) {
    await fetch(`/api/agentic/president-requests/${id}`, { method: "DELETE", credentials: "include" });
    void loadPresidentRequests();
  }

  function generate8am() {
    const today = new Date().toISOString().slice(0, 10);
    const in45d  = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
    const overdueTasks = tasks.filter(t => t.deadline && t.deadline < today && t.status !== "done");
    const openTasks    = tasks.filter(t => t.status === "open" || t.status === "in_progress");
    const recentByAgent = new Map<number, IdeaLite[]>();
    for (const i of ideas) {
      const arr = recentByAgent.get(i.agent_id) ?? [];
      arr.push(i);
      recentByAgent.set(i.agent_id, arr);
    }
    for (const arr of recentByAgent.values()) arr.sort((a, b) => b.created_at.localeCompare(a.created_at));

    // ── Client-side cross-agent alerts ────────────────────────────────
    const alerts: CrossAlert[] = [];
    const activeProjects = wonProjects.filter(p => p.status === "active");
    const highProbDeals  = bdDeals.filter(d => (d.probability ?? 0) >= 60);
    const projectedDemand = (activeProjects.length + highProbDeals.length) * 2;
    if (projectedDemand > employeeCount * 0.85 && employeeCount > 0) {
      alerts.push({
        agent: "CHRO",
        severity: "high",
        text: `Capacity risk: ${activeProjects.length} active projects + ${highProbDeals.length} high-prob deals may need ~${projectedDemand} consultant-slots but only ${employeeCount} employees. Accelerate hiring.`,
      });
    }
    const endingSoon = activeProjects.filter(p => p.end_date && p.end_date <= in45d);
    for (const p of endingSoon) {
      const hasPipeline = bdDeals.some(d =>
        d.client_name && p.client_name &&
        d.client_name.toLowerCase().includes(p.client_name.toLowerCase().slice(0, 5))
      );
      if (!hasPipeline) {
        alerts.push({
          agent: "SVP Sales / BD",
          severity: "medium",
          text: `Pipeline gap: "${p.project_name}" ends ${p.end_date} — no follow-on deal in CRM for ${p.client_name ?? "this client"}.`,
        });
      }
    }
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const longOverdue = openInvoices.filter(i => i.due_date && i.due_date < thirtyDaysAgo && i.state !== "paid");
    if (longOverdue.length > 0) {
      const amt = longOverdue.reduce((s, i) => s + (i.due_amount ?? 0), 0);
      alerts.push({ agent: "CFO", severity: longOverdue.length >= 3 ? "high" : "medium", text: `${longOverdue.length} invoice(s) overdue >30d · €${Math.round(amt).toLocaleString("en")} — escalate collections.` });
    }
    const lateStages = hiringByStage.filter(s => /case|lm|final|offer/i.test(s.stage));
    const lateCount  = lateStages.reduce((n, s) => n + s.count, 0);
    if (lateCount > 0) {
      alerts.push({ agent: "CHRO", severity: "low", text: `${lateCount} candidate(s) in final stages — offer decisions possible this week.` });
    }

    const text = buildCoworkPrompt({
      date: today,
      agents,
      objectives,
      openTasks,
      overdueTasks,
      recentIdeasByAgent: recentByAgent,
      openConflicts: conflicts.filter(c => c.status === "open"),
      bdDeals,
      recentProposals,
      openInvoices,
      wonProjects,
      hiringByStage,
      employeeCount,
      alerts,
    });
    setGenerated(text);
    void fetch("/api/agentic/log", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "prompt_generated", payload: { kind: "cowork-8am", agents: agents.length, tasks: tasks.length, alerts: alerts.length } }),
    });
    toast({ title: "Prompt ready", description: `${alerts.length > 0 ? `${alerts.length} cross-agent alert(s) · ` : ""}Copy + paste into Cowork.` });
  }

  function toggleCoffee() {
    const next = !paused;
    setPaused(next);
    try { localStorage.setItem("agents_paused_v1", String(next)); } catch { /* ignore */ }
    void fetch("/api/agentic/log", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "coffee_break", payload: { paused: next } }),
    });
    toast({ title: next ? "Agents paused" : "Agents resumed" });
  }

  function callCommittee() {
    void fetch("/api/agentic/log", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "exec_committee_called", payload: { invoked_at: new Date().toISOString() } }),
    });
    toast({ title: "AIOS Executive Committee logged", description: "Cross-agent reasoning trigger — review on Decision Log." });
  }

  function runBoardMeeting() {
    void fetch("/api/agentic/log", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "decision_logged",
        payload: { kind: "board_meeting", invoked_at: new Date().toISOString() },
      }),
    });
    toast({
      title: "AIOS Board Meeting logged",
      description: "Monthly review trigger — strategy, hires/fires, and OKR cascades. Pair with the AIOS Decisions page.",
    });
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
      .then(() => toast({ title: "Copied to clipboard" }))
      .catch(() => toast({ title: "Copy failed", variant: "destructive" }));
  }

  // Counters
  const openTaskCount = tasks.filter(t => t.status === "open" || t.status === "in_progress").length;
  const pendingApprovals = tasks.filter(t => t.approval_status === "pending").length;
  const openConflicts = conflicts.filter(c => c.status === "open").length;

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Sun className="w-7 h-7 text-primary" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">AIOS · AUTONOMOUS INTELLIGENCE OPERATING SYSTEM</p>
            <h1 className="text-2xl font-bold tracking-tight">Executive Dashboard</h1>
            <p className="text-sm text-muted-foreground italic">
              From OKRs to execution, on autopilot.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {agents.length} agents · {openTaskCount} open tasks · {pendingApprovals} pending decisions · {openConflicts} open conflicts
              {paused && <Badge variant="destructive" className="ml-2">Paused</Badge>}
            </p>
          </div>
        </div>
      </div>

      {/* AIOS control buttons — daily start, pause, exec committee, monthly board */}
      <Card className="p-4">
        <div className="flex gap-2 flex-wrap">
          <Button size="lg" onClick={generate8am} className="flex-1 min-w-[200px]" disabled={paused}>
            <Sun className="w-5 h-5 mr-2" /> 8am — Start AIOS
          </Button>
          <Button size="lg" onClick={kickAgents} className="flex-1 min-w-[200px] bg-emerald-600 hover:bg-emerald-700" disabled={paused}>
            <Zap className="w-5 h-5 mr-2" /> Make agents start work
          </Button>
          <Button size="lg" variant={paused ? "default" : "outline"} onClick={toggleCoffee} className="flex-1 min-w-[160px]">
            <Coffee className="w-5 h-5 mr-2" /> {paused ? "Resume AIOS" : "Pause AIOS"}
          </Button>
          <Button size="lg" variant="outline" onClick={callCommittee} className="flex-1 min-w-[220px]" disabled={paused}>
            <Users className="w-5 h-5 mr-2" /> Call AIOS Executive Committee
          </Button>
          <Button size="lg" variant="outline" onClick={runBoardMeeting} className="flex-1 min-w-[200px]" disabled={paused}>
            <Users className="w-5 h-5 mr-2" /> Run AIOS Board Meeting
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          <strong>Start AIOS</strong> gathers live state into the CoWork prompt — paste into Claude CoWork, reasoning happens there, paste output back at <button onClick={() => navigate("/executive")} className="underline text-primary">OKR Center</button>.
          <strong> Executive Committee</strong> = daily cross-agent reasoning trigger. <strong>Board Meeting</strong> = monthly review (strategy / hires / OKR cascades).
        </p>
      </Card>

      {/* Generated CoWork prompt */}
      {generated && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> AIOS CoWork Prompt — copy + paste
            </h2>
            <Button size="sm" onClick={() => copy(generated)}>
              <Download className="w-3.5 h-3.5 mr-1" /> Copy to clipboard
            </Button>
          </div>
          <Textarea value={generated} readOnly rows={20} className="font-mono text-xs" />
        </Card>
      )}

      {/* President → CEO direct channel */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold">President → CEO</h2>
          <Badge variant="outline" className="text-[10px]">{presidentRequests.filter(r => r.status === "pending" || r.status === "needs_committee").length} open</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Direct channel from you (acting as President) to the CEO agent. The CEO either replies directly, or escalates to the Exec Committee — that generates a Cowork prompt you paste into Cowork, then paste the outcome back here.
        </p>
        <div className="flex gap-2">
          <Textarea
            value={presidentDraft}
            onChange={(e) => setPresidentDraft(e.target.value)}
            rows={3}
            placeholder="e.g. I want a plan to grow MRR by 30% in Q3 — focus on existing accounts."
            className="text-xs flex-1"
          />
          <Button size="sm" onClick={submitPresidentRequest} disabled={!presidentDraft.trim()}>
            <Send className="w-3.5 h-3.5 mr-1" /> Send to CEO
          </Button>
        </div>

        {presidentRequests.length > 0 && (
          <div className="space-y-2 mt-2">
            {presidentRequests.map(r => {
              const isOpen = expanded[r.id] ?? (r.status !== "answered");
              const tone =
                r.status === "answered"        ? "border-emerald-300 bg-emerald-50/40"
                : r.status === "needs_committee" ? "border-amber-300 bg-amber-50/40"
                : r.status === "committee_done"  ? "border-blue-300 bg-blue-50/40"
                :                                  "border-slate-300 bg-slate-50/40";
              return (
                <div key={r.id} className={`border-2 rounded p-2 ${tone}`}>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setExpanded(prev => ({ ...prev, [r.id]: !isOpen }))}
                      className="flex-1 text-left flex items-center gap-2 flex-wrap min-w-0"
                    >
                      <Badge variant="outline" className="text-[10px] shrink-0">#{r.id}</Badge>
                      <Badge variant="outline" className="text-[10px] shrink-0">{r.status}</Badge>
                      <span className="text-xs font-semibold flex-1 truncate">{r.message}</span>
                      {r.created_at && <span className="text-[10px] text-muted-foreground shrink-0">{r.created_at.slice(0, 16).replace("T", " ")}</span>}
                    </button>
                    <button
                      onClick={() => archiveRequest(r.id)}
                      className="shrink-0 text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
                      title="Archive"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {isOpen && (
                    <div className="mt-2 space-y-2 text-xs">
                      <div className="bg-background border rounded p-2">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">Request</div>
                        <div className="whitespace-pre-wrap">{r.message}</div>
                      </div>

                      {r.ceo_response && (
                        <div className="bg-background border rounded p-2">
                          <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold mb-1">CEO Response</div>
                          <div className="whitespace-pre-wrap">{r.ceo_response}</div>
                        </div>
                      )}

                      {r.committee_prompt && (
                        <div className="bg-background border rounded p-2 space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] uppercase tracking-wider text-amber-700 font-bold">Cowork prompt — paste into Cowork</div>
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => copy(r.committee_prompt!)}>
                              <Download className="w-3 h-3 mr-1" /> Copy
                            </Button>
                          </div>
                          <Textarea value={r.committee_prompt} readOnly rows={6} className="font-mono text-[10px]" />
                        </div>
                      )}

                      {r.committee_outcome && (
                        <div className="bg-background border rounded p-2">
                          <div className="text-[10px] uppercase tracking-wider text-blue-700 font-bold mb-1">Committee outcome (raw)</div>
                          <Textarea value={r.committee_outcome} readOnly rows={4} className="font-mono text-[10px]" />
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Open <button onClick={() => navigate("/executive")} className="underline text-primary">OKR Center</button> to import the DECISION blocks into the system.
                          </p>
                        </div>
                      )}

                      {/* Action panel — depends on status */}
                      {r.status === "pending" && (
                        <div className="border rounded p-2 bg-background space-y-2">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">CEO actions</div>
                          <Textarea
                            value={replyDraftBy[r.id] ?? ""}
                            onChange={(e) => setReplyDraftBy(prev => ({ ...prev, [r.id]: e.target.value }))}
                            rows={3}
                            placeholder="Direct CEO reply…"
                            className="text-xs"
                          />
                          <div className="flex gap-2 flex-wrap">
                            <Button size="sm" onClick={() => ceoReply(r.id)} disabled={!(replyDraftBy[r.id] ?? "").trim()}>
                              <Send className="w-3.5 h-3.5 mr-1" /> CEO replies directly
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => ceoEscalate(r.id)}>
                              <Users className="w-3.5 h-3.5 mr-1" /> "Need to discuss with my team"
                            </Button>
                          </div>
                        </div>
                      )}

                      {r.status === "needs_committee" && (
                        <div className="border rounded p-2 bg-background space-y-2">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Paste Cowork outcome</div>
                          <Textarea
                            value={outcomeDraftBy[r.id] ?? ""}
                            onChange={(e) => setOutcomeDraftBy(prev => ({ ...prev, [r.id]: e.target.value }))}
                            rows={6}
                            placeholder={"CEO_RESPONSE_TO_PRESIDENT: …\n\nDECISION_ID: 1\nTYPE: action\n…\n---"}
                            className="font-mono text-[10px]"
                          />
                          <Button size="sm" onClick={() => importOutcome(r.id)} disabled={!(outcomeDraftBy[r.id] ?? "").trim()}>
                            <Send className="w-3.5 h-3.5 mr-1" /> Save committee outcome
                          </Button>
                        </div>
                      )}

                      {r.status === "committee_done" && (
                        <div className="border rounded p-2 bg-background space-y-2">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Finalise CEO reply to President</div>
                          <Textarea
                            value={replyDraftBy[r.id] ?? r.ceo_response ?? ""}
                            onChange={(e) => setReplyDraftBy(prev => ({ ...prev, [r.id]: e.target.value }))}
                            rows={4}
                            placeholder="CEO's final reply (committee-informed)…"
                            className="text-xs"
                          />
                          <Button size="sm" onClick={() => ceoReply(r.id)} disabled={!(replyDraftBy[r.id] ?? "").trim()}>
                            <Send className="w-3.5 h-3.5 mr-1" /> Mark answered
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* AIOS quick-link tiles */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <button onClick={() => navigate("/agents")} className="text-left p-4 border rounded hover:shadow transition-shadow bg-card">
          <Users className="w-5 h-5 text-primary mb-1" />
          <div className="font-bold text-sm">Agent Registry</div>
          <div className="text-xs text-muted-foreground">{agents.length} agents</div>
        </button>
        <button onClick={() => navigate("/executive")} className="text-left p-4 border rounded hover:shadow transition-shadow bg-card">
          <Sparkles className="w-5 h-5 text-primary mb-1" />
          <div className="font-bold text-sm">OKR Center</div>
          <div className="text-xs text-muted-foreground">prompts · RACI · CoWork output</div>
        </button>
        <button onClick={() => navigate("/approvals")} className="text-left p-4 border rounded hover:shadow transition-shadow bg-card">
          <Sparkles className="w-5 h-5 text-primary mb-1" />
          <div className="font-bold text-sm">Decisions</div>
          <div className="text-xs text-muted-foreground">{pendingApprovals} pending</div>
        </button>
        <button onClick={() => navigate("/agentic/skills")} className="text-left p-4 border rounded hover:shadow transition-shadow bg-card">
          <Sparkles className="w-5 h-5 text-primary mb-1" />
          <div className="font-bold text-sm">Skill Factory</div>
          <div className="text-xs text-muted-foreground">core + drafted skills</div>
        </button>
        <button onClick={() => navigate("/logs")} className="text-left p-4 border rounded hover:shadow transition-shadow bg-card">
          {openConflicts > 0
            ? <AlertTriangle className="w-5 h-5 text-red-600 mb-1" />
            : <Sparkles className="w-5 h-5 text-primary mb-1" />}
          <div className="font-bold text-sm">Decision Log</div>
          <div className="text-xs text-muted-foreground">{openConflicts > 0 ? `${openConflicts} open conflicts` : "activity feed"}</div>
        </button>
      </div>
    </div>
  );
}
