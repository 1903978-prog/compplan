import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Plus, Trash2, Target, Sparkles, ListTodo, Activity, ShieldCheck, BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Agent {
  id: number; name: string; mission: string | null;
  boss_id: number | null; status: string;
  app_sections_assigned: string | null;
  decision_rights_autonomous: string | null;
  decision_rights_boss: string | null;
  decision_rights_ceo: string | null;
  decision_rights_livio: string | null;
}
interface Objective { id: number; agent_id: number; title: string; description: string | null; target_date: string | null; status: string; }
interface KeyResult { id: number; objective_id: number; title: string; target_value: string | null; current_value: string | null; unit: string | null; }
interface Idea { id: number; title: string; description: string | null; status: string; impact_score: number | null; effort_score: number | null; risk_score: number | null; total_score: number | null; created_at: string; }
interface Task { id: number; title: string; description: string | null; deadline: string | null; priority: number; status: string; approval_level: string; approval_status: string; }
interface LogRow { id: number; timestamp: string; event_type: string; payload: any; }

export default function AgentDetail() {
  const [, params] = useRoute("/agents/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const id = params ? parseInt(params.id, 10) : null;

  const [agent, setAgent]           = useState<Agent | null>(null);
  const [allAgents, setAllAgents]   = useState<Agent[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [krs, setKrs]               = useState<KeyResult[]>([]);
  const [ideas, setIdeas]           = useState<Idea[]>([]);
  const [tasks, setTasks]           = useState<Task[]>([]);
  const [log, setLog]               = useState<LogRow[]>([]);

  async function load() {
    if (!id) return;
    try {
      const [a, all, objs, ideasRes, tasksRes, logRes] = await Promise.all([
        fetch(`/api/agentic/agents/${id}`,                   { credentials: "include" }).then(r => r.ok ? r.json() : null),
        fetch(`/api/agentic/agents`,                          { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch(`/api/agentic/objectives?agent_id=${id}`,       { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch(`/api/agentic/ideas?agent_id=${id}`,            { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch(`/api/agentic/tasks?agent_id=${id}`,            { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch(`/api/agentic/log?agent_id=${id}`,              { credentials: "include" }).then(r => r.ok ? r.json() : []),
      ]);
      setAgent(a);
      setAllAgents(Array.isArray(all) ? all : []);
      setObjectives(Array.isArray(objs) ? objs : []);
      setIdeas(Array.isArray(ideasRes) ? ideasRes : []);
      setTasks(Array.isArray(tasksRes) ? tasksRes : []);
      setLog(Array.isArray(logRes) ? logRes : []);
      // Pull KRs for these objectives.
      if (Array.isArray(objs) && objs.length > 0) {
        const krRows = await Promise.all((objs as Objective[]).map(o =>
          fetch(`/api/agentic/key-results?objective_id=${o.id}`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
        ));
        setKrs(krRows.flat() as KeyResult[]);
      } else {
        setKrs([]);
      }
    } catch {
      toast({ title: "Failed to load agent", variant: "destructive" });
    }
  }
  useEffect(() => { void load(); }, [id]);

  if (!id || !agent) {
    return <div className="container mx-auto py-8 text-sm text-muted-foreground">Loading agent…</div>;
  }

  async function patchAgent(patch: Partial<Agent>) {
    setAgent(prev => prev ? { ...prev, ...patch } : prev);
    await fetch(`/api/agentic/agents/${id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function addObjective() {
    const title = prompt("New objective title:")?.trim();
    if (!title) return;
    await fetch("/api/agentic/objectives", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: id, title }),
    });
    void load();
  }

  async function addKR(objective_id: number) {
    const title = prompt("New key result:")?.trim();
    if (!title) return;
    await fetch("/api/agentic/key-results", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective_id, title }),
    });
    void load();
  }

  // Last 7 days activity feed.
  const sevenDaysAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString(); })();
  const recentLog = log.filter(l => l.timestamp > sevenDaysAgo).slice(0, 100);

  const directReports = allAgents.filter(a => a.boss_id === agent.id);
  const boss = agent.boss_id ? allAgents.find(a => a.id === agent.boss_id) : null;

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" onClick={() => navigate("/agents")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-bold">{agent.name}</h1>
        <Badge variant="outline">{agent.status}</Badge>
      </div>

      {/* 1. Mission */}
      <Section title="Mission" icon={<Activity className="w-4 h-4" />}>
        <Textarea
          defaultValue={agent.mission ?? ""}
          rows={3}
          onBlur={(e) => void patchAgent({ mission: e.target.value })}
          placeholder="What this agent exists to do…"
        />
      </Section>

      {/* 2. Boss / DRs */}
      <Section title="Boss & direct reports" icon={<Activity className="w-4 h-4" />}>
        <div className="text-sm space-y-1">
          <div><span className="text-muted-foreground">Reports to:</span> <strong>{boss?.name ?? "Livio"}</strong></div>
          <div>
            <span className="text-muted-foreground">Direct reports:</span>{" "}
            {directReports.length === 0 ? <span className="italic text-muted-foreground">none</span> : directReports.map(d => (
              <button key={d.id} onClick={() => navigate(`/agents/${d.id}`)} className="text-primary hover:underline mr-2">{d.name}</button>
            ))}
          </div>
        </div>
      </Section>

      {/* 3-4. Objectives + KRs */}
      <Section
        title="Objectives + Key Results"
        icon={<Target className="w-4 h-4" />}
        right={<Button size="sm" variant="outline" className="h-7 text-xs" onClick={addObjective}><Plus className="w-3 h-3 mr-1" /> Add objective</Button>}
      >
        {objectives.length === 0 ? <p className="text-xs text-muted-foreground italic">No objectives yet.</p> : (
          <div className="space-y-3">
            {objectives.map(o => (
              <div key={o.id} className="border-l-2 border-primary/30 pl-3 py-1">
                <div className="flex items-center gap-2 mb-1">
                  <Input
                    defaultValue={o.title}
                    onBlur={(e) => fetch(`/api/agentic/objectives/${o.id}`, {
                      method: "PUT", credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ title: e.target.value }),
                    })}
                    className="h-7 text-sm font-medium flex-1"
                  />
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => addKR(o.id)} title="Add key result">
                    <Plus className="w-3 h-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2"
                    onClick={() => fetch(`/api/agentic/objectives/${o.id}`, { method: "DELETE", credentials: "include" }).then(load)}
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                </div>
                {krs.filter(k => k.objective_id === o.id).map(k => (
                  <div key={k.id} className="flex items-center gap-1.5 text-xs ml-3 my-0.5">
                    <span className="text-muted-foreground">–</span>
                    <Input defaultValue={k.title} className="h-6 text-xs flex-1"
                      onBlur={(e) => fetch(`/api/agentic/key-results/${k.id}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: e.target.value }) })}
                    />
                    <Input defaultValue={k.target_value ?? ""} placeholder="target" className="h-6 text-xs w-20"
                      onBlur={(e) => fetch(`/api/agentic/key-results/${k.id}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target_value: e.target.value }) })}
                    />
                    <Input defaultValue={k.current_value ?? ""} placeholder="current" className="h-6 text-xs w-20"
                      onBlur={(e) => fetch(`/api/agentic/key-results/${k.id}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_value: e.target.value }) })}
                    />
                    <Input defaultValue={k.unit ?? ""} placeholder="unit" className="h-6 text-xs w-14"
                      onBlur={(e) => fetch(`/api/agentic/key-results/${k.id}`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unit: e.target.value }) })}
                    />
                    <button onClick={() => fetch(`/api/agentic/key-results/${k.id}`, { method: "DELETE", credentials: "include" }).then(load)}
                      className="text-muted-foreground hover:text-destructive p-0.5"
                    ><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 5. App sections */}
      <Section title="App sections assigned" icon={<BookOpen className="w-4 h-4" />}>
        <Textarea
          defaultValue={agent.app_sections_assigned ?? ""}
          rows={3}
          onBlur={(e) => void patchAgent({ app_sections_assigned: e.target.value })}
          placeholder="One section per line, e.g.&#10;/bd&#10;/proposals&#10;/exec/staffing"
        />
      </Section>

      {/* 6. Ideas backlog */}
      <Section title={`Ideas backlog (${ideas.length})`} icon={<Sparkles className="w-4 h-4" />}>
        {ideas.length === 0 ? <p className="text-xs text-muted-foreground italic">No ideas yet.</p> : (
          <div className="text-xs">
            <div className="grid grid-cols-[1fr_60px_60px_60px_60px_90px] gap-2 px-2 py-1 font-bold text-[10px] uppercase text-muted-foreground border-b">
              <div>Title</div><div className="text-right">Score</div><div className="text-right">Impact</div><div className="text-right">Effort</div><div className="text-right">Risk</div><div>Status</div>
            </div>
            {ideas.sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0)).map(i => (
              <div key={i.id} className="grid grid-cols-[1fr_60px_60px_60px_60px_90px] gap-2 px-2 py-1 border-b items-center">
                <div className="truncate" title={i.description ?? ""}>{i.title}</div>
                <div className="text-right font-mono">{i.total_score ?? "—"}</div>
                <div className="text-right font-mono text-muted-foreground">{i.impact_score ?? "—"}</div>
                <div className="text-right font-mono text-muted-foreground">{i.effort_score ?? "—"}</div>
                <div className="text-right font-mono text-muted-foreground">{i.risk_score ?? "—"}</div>
                <Badge variant="outline" className="text-[10px]">{i.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 7. Tasks */}
      <Section title={`Tasks + deadlines (${tasks.length})`} icon={<ListTodo className="w-4 h-4" />}>
        {tasks.length === 0 ? <p className="text-xs text-muted-foreground italic">No tasks yet.</p> : (
          <div className="text-xs space-y-1">
            {tasks.sort((a, b) => b.priority - a.priority).map(t => (
              <div key={t.id} className="border rounded p-2 flex items-center gap-2 flex-wrap">
                <span className="font-medium flex-1 truncate">{t.title}</span>
                {t.deadline && <Badge variant="outline" className="text-[10px]">{t.deadline}</Badge>}
                <Badge variant="outline" className="text-[10px]">{t.status}</Badge>
                <Badge variant="outline" className={`text-[10px] ${
                  t.approval_level === "livio" ? "border-red-300 text-red-700"
                  : t.approval_level === "ceo" ? "border-orange-300 text-orange-700"
                  : t.approval_level === "boss" ? "border-amber-300 text-amber-700"
                  : "border-emerald-300 text-emerald-700"
                }`}>{t.approval_level}</Badge>
                {t.approval_status !== "not_required" && (
                  <Badge variant="outline" className="text-[10px]">{t.approval_status}</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 8. Decision rights */}
      <Section title="Decision rights" icon={<ShieldCheck className="w-4 h-4" />}>
        <div className="grid md:grid-cols-2 gap-3">
          {[
            { key: "decision_rights_autonomous", label: "Autonomous (no approval)",  tone: "border-emerald-300" },
            { key: "decision_rights_boss",       label: "Boss approval",              tone: "border-amber-300" },
            { key: "decision_rights_ceo",        label: "CEO approval",               tone: "border-orange-300" },
            { key: "decision_rights_livio",      label: "Livio approval",             tone: "border-red-300" },
          ].map(({ key, label, tone }) => (
            <div key={key} className={`border-2 rounded p-2 ${tone}`}>
              <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1">{label}</div>
              <Textarea
                defaultValue={(agent as any)[key] ?? ""}
                rows={3}
                onBlur={(e) => void patchAgent({ [key]: e.target.value } as any)}
                placeholder="One item per line"
                className="text-xs"
              />
            </div>
          ))}
        </div>
      </Section>

      {/* 9. Last 7 days activity */}
      <Section title={`Last 7 days activity (${recentLog.length})`} icon={<Activity className="w-4 h-4" />}>
        {recentLog.length === 0 ? <p className="text-xs text-muted-foreground italic">Nothing logged yet.</p> : (
          <div className="text-xs space-y-0.5 max-h-64 overflow-y-auto">
            {recentLog.map(l => (
              <div key={l.id} className="flex items-start gap-2 py-0.5">
                <span className="text-[10px] text-muted-foreground font-mono w-32 shrink-0">{l.timestamp.slice(0, 16).replace("T", " ")}</span>
                <Badge variant="outline" className="text-[9px] shrink-0">{l.event_type}</Badge>
                <span className="flex-1 truncate">{l.payload?.title ?? l.payload?.task_id ?? ""}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, icon, right, children }: { title: string; icon: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h2 className="text-sm font-bold flex items-center gap-2">{icon} {title}</h2>
        {right}
      </div>
      {children}
    </Card>
  );
}
