import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Minus, Users, ChevronRight, BookOpen, ThumbsUp, ThumbsDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Agent {
  id: number; name: string; mission: string | null;
  boss_id: number | null; status: string;
  agent_type?: string;
}

export default function AgentRegistry() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ideaCounts, setIdeaCounts] = useState<Record<number, number>>({});
  const [taskCounts, setTaskCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [kmExpanded, setKmExpanded] = useState(false);
  const [agentRatings, setAgentRatings] = useState<Record<string, { up: number; down: number }>>({});

  async function load() {
    setLoading(true);
    try {
      const [aRes, iRes, tRes, rRes] = await Promise.all([
        fetch("/api/agentic/agents",                      { credentials: "include" }),
        fetch("/api/agentic/ideas",                       { credentials: "include" }),
        fetch("/api/agentic/tasks",                       { credentials: "include" }),
        fetch("/api/aios/deliverables/agent-ratings",     { credentials: "include" }),
      ]);
      const [a, i, t, r] = await Promise.all([aRes.json(), iRes.json(), tRes.json(), rRes.ok ? rRes.json() : []]);
      setAgents(Array.isArray(a) ? a : []);
      const ic: Record<number, number> = {};
      for (const idea of (Array.isArray(i) ? i : []) as any[]) {
        if (idea.status === "proposed" || idea.status === "approved") ic[idea.agent_id] = (ic[idea.agent_id] ?? 0) + 1;
      }
      setIdeaCounts(ic);
      const tc: Record<number, number> = {};
      for (const tk of (Array.isArray(t) ? t : []) as any[]) {
        if (tk.status === "open" || tk.status === "in_progress") tc[tk.agent_id] = (tc[tk.agent_id] ?? 0) + 1;
      }
      setTaskCounts(tc);
      const rc: Record<string, { up: number; down: number }> = {};
      for (const row of (Array.isArray(r) ? r : []) as any[]) {
        rc[row.agent_name] = { up: Number(row.thumbs_up ?? 0), down: Number(row.thumbs_down ?? 0) };
      }
      setAgentRatings(rc);
    } catch {
      toast({ title: "Failed to load agents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const bossById = useMemo(() => new Map(agents.map(a => [a.id, a.name])), [agents]);

  // Split into AIOS classic vs KM system agents
  const classicAgents  = useMemo(() => agents.filter(a => !a.agent_type || a.agent_type === "aios_classic"), [agents]);
  const kmRouter       = useMemo(() => agents.find(a => a.agent_type === "km_router"), [agents]);
  const kmSpecialists  = useMemo(() => agents.filter(a => a.agent_type === "km_specialist"), [agents]);

  async function addAgent() {
    if (!newName.trim()) return;
    const r = await fetch("/api/agentic/agents", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (r.ok) {
      setNewName("");
      void load();
      toast({ title: "Agent added" });
    } else {
      toast({ title: "Failed to add", variant: "destructive" });
    }
  }

  const COLS = "grid grid-cols-[1fr_180px_120px_80px_80px_80px_40px] gap-3 px-4";

  function AgentRow({ a, indent = false }: { a: Agent; indent?: boolean }) {
    return (
      <button
        key={a.id}
        onClick={() => navigate(`/agents/${a.id}`)}
        className={`w-full ${COLS} py-2.5 border-b text-left hover:bg-muted/40 items-center`}
      >
        <div className={`flex flex-col ${indent ? "pl-7" : ""}`}>
          <span className="font-semibold text-sm">{a.name}</span>
          {a.mission && <span className="text-[11px] text-muted-foreground truncate max-w-md">{a.mission}</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          {a.boss_id ? bossById.get(a.boss_id) ?? `#${a.boss_id}` : <span className="italic">President</span>}
        </div>
        <div>
          <Badge variant="outline" className={
            a.status === "active"  ? "text-emerald-700 border-emerald-300 bg-emerald-50"
            : a.status === "paused" ? "text-amber-700 border-amber-300 bg-amber-50"
            : "text-slate-700 border-slate-300 bg-slate-50"
          }>{a.status}</Badge>
        </div>
        <div className="text-right font-mono text-sm">{ideaCounts[a.id] ?? 0}</div>
        <div className="text-right font-mono text-sm">{taskCounts[a.id] ?? 0}</div>
        <div className="flex items-center gap-1 justify-end">
          {agentRatings[a.name] ? (
            <>
              <ThumbsUp className="w-3 h-3 text-emerald-500" />
              <span className="text-[11px] text-emerald-700 font-mono">{agentRatings[a.name].up}</span>
              <ThumbsDown className="w-3 h-3 text-red-400 ml-1" />
              <span className="text-[11px] text-red-500 font-mono">{agentRatings[a.name].down}</span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground/40">—</span>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Users className="w-7 h-7 text-primary" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Atlas</p>
            <h1 className="text-2xl font-bold tracking-tight">Agent Registry</h1>
            <p className="text-sm text-muted-foreground">{agents.length} agents · all members of the Autonomous Intelligence Operating System</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New agent name…"
            className="h-9 w-64"
            onKeyDown={(e) => { if (e.key === "Enter") void addAgent(); }}
          />
          <Button size="sm" onClick={addAgent} disabled={!newName.trim()}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        {/* Column headers */}
        <div className={`${COLS} py-2 border-b bg-muted/30 text-[11px] font-bold uppercase tracking-wide text-muted-foreground`}>
          <div>Name</div>
          <div>Boss</div>
          <div>Status</div>
          <div className="text-right">Open ideas</div>
          <div className="text-right">Open tasks</div>
          <div className="text-right">Ratings</div>
          <div></div>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-sm text-muted-foreground italic">Loading…</div>
        ) : (
          <>
            {/* AIOS Classic agents */}
            {classicAgents.map(a => <AgentRow key={a.id} a={a} />)}

            {/* KM System group — only if KM agents exist */}
            {(kmRouter || kmSpecialists.length > 0) && (
              <>
                {/* KM group header row */}
                <div className={`${COLS} py-2.5 border-b bg-violet-50/60 items-center`}>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setKmExpanded(v => !v)}
                      className="flex-shrink-0 w-5 h-5 rounded-full bg-white border border-violet-300 flex items-center justify-center hover:bg-violet-100 transition-colors"
                      aria-label={kmExpanded ? "Collapse KM agents" : "Expand KM agents"}
                    >
                      {kmExpanded
                        ? <Minus className="w-3 h-3 text-violet-600" />
                        : <Plus className="w-3 h-3 text-violet-600" />}
                    </button>
                    <BookOpen className="w-4 h-4 text-violet-500 flex-shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm text-violet-900">KM Agent System</span>
                      <span className="text-[11px] text-violet-600">
                        1 router · {kmSpecialists.length} specialists — knowledge base query layer
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground italic">—</div>
                  <div>
                    <Badge variant="outline" className="text-violet-700 border-violet-300 bg-violet-50">
                      {kmRouter ? kmRouter.status : "active"}
                    </Badge>
                  </div>
                  <div className="text-right font-mono text-sm text-muted-foreground">—</div>
                  <div className="text-right font-mono text-sm text-muted-foreground">—</div>
                  <div />
                </div>

                {/* KM agents — visible only when expanded */}
                {kmExpanded && (
                  <>
                    {kmRouter && <AgentRow a={kmRouter} indent />}
                    {kmSpecialists.map(a => <AgentRow key={a.id} a={a} indent />)}
                  </>
                )}
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
