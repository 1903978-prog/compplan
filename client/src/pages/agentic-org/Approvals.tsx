import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X as XIcon, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Task {
  id: number; agent_id: number; title: string; description: string | null;
  deadline: string | null; approval_level: string; approval_status: string; status: string;
}
interface Agent { id: number; name: string; }

export default function Approvals() {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [t, a] = await Promise.all([
        fetch("/api/agentic/tasks?approval_status=pending", { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/agents",                          { credentials: "include" }).then(r => r.ok ? r.json() : []),
      ]);
      setTasks(Array.isArray(t) ? t : []);
      setAgents(Array.isArray(a) ? a : []);
    } catch {
      toast({ title: "Failed to load approvals", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const agentName = (id: number) => agents.find(a => a.id === id)?.name ?? `#${id}`;

  async function decide(t: Task, decision: "approved" | "rejected") {
    await fetch(`/api/agentic/tasks/${t.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approval_status: decision }),
    });
    toast({ title: decision === "approved" ? "Approved" : "Rejected" });
    void load();
  }

  // Group by approval level — Livio first, then CEO, then boss.
  const groups = useMemo(() => {
    const order = ["livio", "ceo", "boss"];
    const out: Record<string, Task[]> = { livio: [], ceo: [], boss: [] };
    for (const t of tasks) (out[t.approval_level] ?? out.boss).push(t);
    return order.map(k => ({ key: k, tasks: out[k] ?? [] }));
  }, [tasks]);

  const toneFor = (level: string) =>
    level === "livio" ? "border-red-300 bg-red-50/40"
    : level === "ceo"   ? "border-orange-300 bg-orange-50/40"
    :                     "border-amber-300 bg-amber-50/40";

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Approval Center</h1>
          <p className="text-sm text-muted-foreground">{tasks.length} pending · grouped by approval level</p>
        </div>
      </div>

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground italic">Loading…</Card>
      ) : tasks.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground italic">Nothing pending. The queue clears as agents file new tasks at non-autonomous approval levels.</Card>
      ) : groups.map(g => g.tasks.length === 0 ? null : (
        <Card key={g.key} className={`p-4 border-2 ${toneFor(g.key)}`}>
          <h2 className="text-sm font-bold uppercase tracking-wide mb-2">{g.key} approval ({g.tasks.length})</h2>
          <div className="space-y-2">
            {g.tasks.map(t => (
              <div key={t.id} className="border rounded p-2 bg-background flex items-start gap-2 flex-wrap">
                <div className="flex-1 min-w-[300px]">
                  <div className="text-sm font-semibold">{t.title}</div>
                  {t.description && <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>}
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">{agentName(t.agent_id)}</Badge>
                    {t.deadline && <Badge variant="outline" className="text-[10px]">due {t.deadline}</Badge>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700" onClick={() => decide(t, "approved")}>
                    <Check className="w-3 h-3 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => decide(t, "rejected")}>
                    <XIcon className="w-3 h-3 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
