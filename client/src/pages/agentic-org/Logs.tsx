import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollText, AlertTriangle, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface LogRow { id: number; timestamp: string; agent_id: number | null; event_type: string; payload: any; }
interface Conflict { id: number; title: string; agents_involved: string | null; severity: string | null; status: string; created_at: string; }
interface Agent { id: number; name: string; }

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
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">AIOS</p>
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
        ><AlertTriangle className="w-3.5 h-3.5" /> Conflict Area ({conflicts.filter(c => c.status === "open").length})</button>
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
        <Card className="p-4">
          {conflicts.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No conflicts logged. Conflicts arrive automatically when two agents propose incompatible actions or when the Cowork output emits TYPE: conflict blocks.</p>
          ) : (
            <div className="text-xs space-y-2">
              {conflicts.map(c => (
                <div key={c.id} className="border rounded p-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={
                      c.severity === "high" ? "text-red-700 border-red-300 bg-red-50"
                      : c.severity === "medium" ? "text-amber-700 border-amber-300 bg-amber-50"
                      : "text-slate-700"
                    }>{c.severity ?? "?"}</Badge>
                    <Badge variant="outline">{c.status}</Badge>
                    <span className="font-semibold">{c.title}</span>
                    <span className="text-muted-foreground ml-auto">{c.created_at.slice(0, 10)}</span>
                  </div>
                  {c.agents_involved && <div className="text-[10px] text-muted-foreground mt-1">Agents: {c.agents_involved}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
