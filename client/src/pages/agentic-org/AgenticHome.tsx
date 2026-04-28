import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sun, Coffee, Users, Sparkles, Download, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  buildCoworkPrompt,
  type AgentLite, type ObjectiveLite, type IdeaLite, type TaskLite, type ConflictLite,
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
  const [paused, setPaused] = useState(() => {
    try { return localStorage.getItem("agents_paused_v1") === "true"; } catch { return false; }
  });

  async function loadAll() {
    try {
      const [a, o, i, t, c] = await Promise.all([
        fetch("/api/agentic/agents",     { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/objectives", { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/ideas",      { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/tasks",      { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/conflicts",  { credentials: "include" }).then(r => r.ok ? r.json() : []),
      ]);
      setAgents(a); setObjectives(o); setIdeas(i); setTasks(t); setConflicts(c);
    } catch {
      toast({ title: "Failed to load agentic state", variant: "destructive" });
    }
  }
  useEffect(() => { void loadAll(); }, []);

  function generate8am() {
    const today = new Date().toISOString().slice(0, 10);
    const overdueTasks = tasks.filter(t => t.deadline && t.deadline < today && t.status !== "done");
    const openTasks    = tasks.filter(t => t.status === "open" || t.status === "in_progress");
    const recentByAgent = new Map<number, IdeaLite[]>();
    for (const i of ideas) {
      const arr = recentByAgent.get(i.agent_id) ?? [];
      arr.push(i);
      recentByAgent.set(i.agent_id, arr);
    }
    for (const arr of recentByAgent.values()) arr.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const text = buildCoworkPrompt({
      date: today,
      agents,
      objectives,
      openTasks,
      overdueTasks,
      recentIdeasByAgent: recentByAgent,
      openConflicts: conflicts.filter(c => c.status === "open"),
    });
    setGenerated(text);
    // Log the event.
    void fetch("/api/agentic/log", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_type: "prompt_generated", payload: { kind: "cowork-8am", agents: agents.length, tasks: tasks.length } }),
    });
    toast({ title: "Prompt ready", description: "Copy + paste into Cowork." });
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
    toast({ title: "Executive Committee logged", description: "Phase 1 placeholder — Phase 2 will trigger cross-agent reasoning." });
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
            <h1 className="text-2xl font-bold tracking-tight">Agentic Operating Layer</h1>
            <p className="text-sm text-muted-foreground">
              Phase 1 · {agents.length} agents · {openTaskCount} open tasks · {pendingApprovals} pending approvals · {openConflicts} open conflicts
              {paused && <Badge variant="destructive" className="ml-2">Paused</Badge>}
            </p>
          </div>
        </div>
      </div>

      {/* 3 big buttons */}
      <Card className="p-4">
        <div className="flex gap-2 flex-wrap">
          <Button size="lg" onClick={generate8am} className="flex-1 min-w-[200px]" disabled={paused}>
            <Sun className="w-5 h-5 mr-2" /> 8am at work!
          </Button>
          <Button size="lg" variant={paused ? "default" : "outline"} onClick={toggleCoffee} className="flex-1 min-w-[180px]">
            <Coffee className="w-5 h-5 mr-2" /> {paused ? "Resume agents" : "Coffee break"}
          </Button>
          <Button size="lg" variant="outline" onClick={callCommittee} className="flex-1 min-w-[200px]" disabled={paused}>
            <Users className="w-5 h-5 mr-2" /> Call Executive Committee
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          The 8am button gathers live state into the Cowork prompt. You paste it into Claude Cowork → reasoning happens there → paste output back at <button onClick={() => navigate("/executive")} className="underline text-primary">/executive</button>.
        </p>
      </Card>

      {/* Generated prompt */}
      {generated && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> Cowork prompt — copy + paste
            </h2>
            <Button size="sm" onClick={() => copy(generated)}>
              <Download className="w-3.5 h-3.5 mr-1" /> Copy to clipboard
            </Button>
          </div>
          <Textarea value={generated} readOnly rows={20} className="font-mono text-xs" />
        </Card>
      )}

      {/* Quick links */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <button onClick={() => navigate("/agents")} className="text-left p-4 border rounded hover:shadow transition-shadow bg-card">
          <Users className="w-5 h-5 text-primary mb-1" />
          <div className="font-bold text-sm">Agent Registry</div>
          <div className="text-xs text-muted-foreground">{agents.length} agents</div>
        </button>
        <button onClick={() => navigate("/executive")} className="text-left p-4 border rounded hover:shadow transition-shadow bg-card">
          <Sparkles className="w-5 h-5 text-primary mb-1" />
          <div className="font-bold text-sm">Executive OKR</div>
          <div className="text-xs text-muted-foreground">prompts · RACI · paste output</div>
        </button>
        <button onClick={() => navigate("/approvals")} className="text-left p-4 border rounded hover:shadow transition-shadow bg-card">
          <Sparkles className="w-5 h-5 text-primary mb-1" />
          <div className="font-bold text-sm">Approval Center</div>
          <div className="text-xs text-muted-foreground">{pendingApprovals} pending</div>
        </button>
        <button onClick={() => navigate("/logs")} className="text-left p-4 border rounded hover:shadow transition-shadow bg-card">
          {openConflicts > 0
            ? <AlertTriangle className="w-5 h-5 text-red-600 mb-1" />
            : <Sparkles className="w-5 h-5 text-primary mb-1" />}
          <div className="font-bold text-sm">Executive Log</div>
          <div className="text-xs text-muted-foreground">{openConflicts > 0 ? `${openConflicts} open conflicts` : "activity feed"}</div>
        </button>
      </div>
    </div>
  );
}
