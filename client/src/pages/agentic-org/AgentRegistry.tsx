import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Plus, Users, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Agent {
  id: number; name: string; mission: string | null;
  boss_id: number | null; status: string;
}

export default function AgentRegistry() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ideaCounts, setIdeaCounts] = useState<Record<number, number>>({});
  const [taskCounts, setTaskCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [aRes, iRes, tRes] = await Promise.all([
        fetch("/api/agentic/agents",  { credentials: "include" }),
        fetch("/api/agentic/ideas",   { credentials: "include" }),
        fetch("/api/agentic/tasks",   { credentials: "include" }),
      ]);
      const [a, i, t] = await Promise.all([aRes.json(), iRes.json(), tRes.json()]);
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
    } catch {
      toast({ title: "Failed to load agents", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const bossById = useMemo(() => new Map(agents.map(a => [a.id, a.name])), [agents]);

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

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Users className="w-7 h-7 text-primary" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">AIOS</p>
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
        <div className="grid grid-cols-[1fr_180px_120px_100px_100px_40px] gap-3 px-4 py-2 border-b bg-muted/30 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          <div>Name</div>
          <div>Boss</div>
          <div>Status</div>
          <div className="text-right">Open ideas</div>
          <div className="text-right">Open tasks</div>
          <div></div>
        </div>
        {loading ? (
          <div className="px-4 py-6 text-sm text-muted-foreground italic">Loading…</div>
        ) : agents.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground italic">No agents yet — boot will seed 8 starter agents on the next deploy.</div>
        ) : agents.map(a => (
          <button
            key={a.id}
            onClick={() => navigate(`/agents/${a.id}`)}
            className="w-full grid grid-cols-[1fr_180px_120px_100px_100px_40px] gap-3 px-4 py-2.5 border-b text-left hover:bg-muted/40 items-center"
          >
            <div className="flex flex-col">
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
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </button>
        ))}
      </Card>
    </div>
  );
}
