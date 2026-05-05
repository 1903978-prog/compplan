import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Plus, Trash2, Target, Sparkles, ListTodo, Activity, ShieldCheck, BookOpen, Map, RefreshCw, TrendingUp, GraduationCap, Brain, Library, ChevronRight, BarChart2, BarChart3 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Agent {
  id: number; name: string; mission: string | null;
  boss_id: number | null; status: string;
  app_sections_assigned: string | null;
  decision_rights_autonomous: string | null;
  decision_rights_boss: string | null;
  decision_rights_ceo: string | null;
  decision_rights_livio: string | null;
  skill_gaps: string | null;
  training_plan: string | null;
  readiness_scores: string | null;  // JSON string
  // AIOS cycle fields (added for 8am cycle)
  role_title: string | null;
  job_description: string | null;
  function_area: string | null;
  // Structured spec arrays seeded from agentSpecsData.ts
  knowledge: string[] | null;
  training: string[] | null;
  skills: string[] | null;
  deliverables: string[] | null;
}

interface AgentSource {
  id: number; role_key: string; title: string; content: string;
  tags: string[] | null; source: string; status: string; created_at: string;
}

const READINESS_DIMS = [
  { key: "role_clarity",         label: "Role clarity" },
  { key: "data_access",          label: "Data access" },
  { key: "skill_knowledge",      label: "Skill & knowledge" },
  { key: "output_quality",       label: "Output quality" },
  { key: "decision_discipline",  label: "Decision discipline" },
  { key: "okr_progress",         label: "OKR progress" },
] as const;

function parseReadiness(raw: string | null): Record<string, number> {
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
interface SectionMapRow {
  id: number; module: string; section: string; subsection: string;
  primary_agent: string; secondary_agents: string;
  why: string; frequency: string;
}
interface Objective { id: number; agent_id: number; title: string; description: string | null; target_date: string | null; status: string; }
interface KeyResult { id: number; objective_id: number; title: string; target_value: string | null; current_value: string | null; unit: string | null; }
interface Idea { id: number; title: string; description: string | null; status: string; impact_score: number | null; effort_score: number | null; risk_score: number | null; total_score: number | null; created_at: string; }
interface Task { id: number; title: string; description: string | null; deadline: string | null; priority: number; status: string; approval_level: string; approval_status: string; }
interface LogRow { id: number; timestamp: string; event_type: string; payload: any; }
interface AgentKpi {
  id: number; cycle_id: number; agent_name: string; round: string;
  deliverable_count: number; insight_count: number; idea_count: number; action_count: number;
  avg_total_score: number | null; insight_score: number | null; action_score: number | null;
  created_at: string;
}

interface AgentScore {
  agentId:                 number;
  days:                    number;
  outputQuality:           number;
  deliverableCompleteness: number;
  okrAlignment:            number;
  decisionRightCompliance: number;
  conflictRate:            number;
  knowledgeUtilisation:    number;
  overall:                 number;
}

const SCORE_DIMS: { key: keyof AgentScore; label: string; description: string }[] = [
  { key: "outputQuality",           label: "Output quality",          description: "Mean total_score of scored deliverables" },
  { key: "deliverableCompleteness", label: "Deliverable completeness",description: "% cycles with ≥ 9 deliverables" },
  { key: "okrAlignment",            label: "OKR alignment",           description: "% deliverables linked to an objective" },
  { key: "decisionRightCompliance", label: "Decision-right compliance",description: "% deliverables with a valid L0-L3 level" },
  { key: "conflictRate",            label: "Conflict rate",           description: "Inverted conflict score (100 = no conflicts)" },
  { key: "knowledgeUtilisation",    label: "Knowledge utilisation",   description: "% deliverables with source_app_section set" },
];

function scoreColour(v: number): string {
  if (v >= 80) return "text-green-600";
  if (v >= 60) return "text-amber-600";
  return "text-red-500";
}

export default function AgentDetail() {
  const [, params] = useRoute("/agents/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const id = params ? parseInt(params.id, 10) : null;

  const [agent, setAgent]                       = useState<Agent | null>(null);
  const [allAgents, setAllAgents]               = useState<Agent[]>([]);
  const [objectives, setObjectives]             = useState<Objective[]>([]);
  const [krs, setKrs]                           = useState<KeyResult[]>([]);
  const [ideas, setIdeas]                       = useState<Idea[]>([]);
  const [tasks, setTasks]                       = useState<Task[]>([]);
  const [log, setLog]                           = useState<LogRow[]>([]);
  // Section map
  const [sectionsPrimary, setSectionsPrimary]   = useState<SectionMapRow[]>([]);
  const [sectionsSecondary, setSectionsSecondary] = useState<SectionMapRow[]>([]);
  const [sources, setSources]                   = useState<AgentSource[]>([]);
  const [kpis, setKpis]                         = useState<AgentKpi[]>([]);
  // Re-route modal
  const [rerouteRow, setRerouteRow]             = useState<SectionMapRow | null>(null);
  const [rerouteDraft, setRerouteDraft]         = useState("");
  // B7 scorecard
  const [score, setScore]                       = useState<AgentScore | null>(null);
  const [scoreDays, setScoreDays]               = useState(7);
  const [scoreLoading, setScoreLoading]         = useState(false);

  async function load() {
    if (!id) return;
    try {
      const [a, all, objs, ideasRes, tasksRes, logRes, srcs] = await Promise.all([
        fetch(`/api/agentic/agents/${id}`,                   { credentials: "include" }).then(r => r.ok ? r.json() : null),
        fetch(`/api/agentic/agents`,                          { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch(`/api/agentic/objectives?agent_id=${id}`,       { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch(`/api/agentic/ideas?agent_id=${id}`,            { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch(`/api/agentic/tasks?agent_id=${id}`,            { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch(`/api/agentic/log?agent_id=${id}`,              { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch(`/api/agentic/agent-sources?agent_id=${id}`,   { credentials: "include" }).then(r => r.ok ? r.json() : []),
      ]);
      setAgent(a);
      setAllAgents(Array.isArray(all) ? all : []);
      setObjectives(Array.isArray(objs) ? objs : []);
      setIdeas(Array.isArray(ideasRes) ? ideasRes : []);
      setTasks(Array.isArray(tasksRes) ? tasksRes : []);
      setLog(Array.isArray(logRes) ? logRes : []);
      setSources(Array.isArray(srcs) ? srcs : []);
      // Pull KRs for these objectives.
      if (Array.isArray(objs) && objs.length > 0) {
        const krRows = await Promise.all((objs as Objective[]).map(o =>
          fetch(`/api/agentic/key-results?objective_id=${o.id}`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
        ));
        setKrs(krRows.flat() as KeyResult[]);
      } else {
        setKrs([]);
      }
      // Section map + KPI history — loaded after we know the agent name
      if (a?.name) {
        const encoded = encodeURIComponent(a.name);
        const [sm, kpiRows] = await Promise.all([
          fetch(`/api/agentic/section-map/by-agent/${encoded}`, { credentials: "include" }).then(r => r.ok ? r.json() : { primary: [], secondary: [] }),
          fetch(`/api/aios/agent-kpis/${encoded}`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
        ]);
        setSectionsPrimary(Array.isArray(sm.primary) ? sm.primary : []);
        setSectionsSecondary(Array.isArray(sm.secondary) ? sm.secondary : []);
        setKpis(Array.isArray(kpiRows) ? kpiRows : []);
      }
    } catch {
      toast({ title: "Failed to load agent", variant: "destructive" });
    }
  }
  async function loadScore(days = scoreDays) {
    if (!id) return;
    setScoreLoading(true);
    try {
      const r = await fetch(`/api/agentic/agents/${id}/score?days=${days}`, { credentials: "include" });
      if (r.ok) setScore(await r.json());
    } catch { /* silently ignore */ } finally { setScoreLoading(false); }
  }

  useEffect(() => { void load(); }, [id]);
  useEffect(() => { void loadScore(scoreDays); }, [id, scoreDays]);

  if (!id || !agent) {
    return <div className="container mx-auto py-8 text-sm text-muted-foreground">Loading agent…</div>;
  }

  async function rerouteSection(row: SectionMapRow, newPrimaryAgent: string) {
    const r = await fetch(`/api/agentic/section-map/${row.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ primary_agent: newPrimaryAgent.trim() }),
    });
    if (r.ok) {
      toast({ title: "Re-routed", description: `${row.subsection} → ${newPrimaryAgent.trim()}` });
      setRerouteRow(null);
      setRerouteDraft("");
      void load();
    } else {
      toast({ title: "Re-route failed", variant: "destructive" });
    }
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
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground block mb-1">Role title</label>
            <Input
              defaultValue={agent.role_title ?? ""}
              onBlur={(e) => void patchAgent({ role_title: e.target.value || null })}
              placeholder="e.g. Chief Financial Officer"
              className="h-8 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground block mb-1">Function area</label>
            <Input
              defaultValue={agent.function_area ?? ""}
              onBlur={(e) => void patchAgent({ function_area: e.target.value || null })}
              placeholder="e.g. Finance & Accounting"
              className="h-8 text-sm"
            />
          </div>
        </div>
        <label className="text-[10px] uppercase font-semibold text-muted-foreground block mb-1">Mission</label>
        <Textarea
          defaultValue={agent.mission ?? ""}
          rows={2}
          onBlur={(e) => void patchAgent({ mission: e.target.value })}
          placeholder="What this agent exists to do…"
        />
      </Section>

      {/* 1b. Job Description — read by AIOS cycle */}
      <Section title="Job Description (Atlas)" icon={<BookOpen className="w-4 h-4" />}>
        <p className="text-[11px] text-muted-foreground mb-2">
          Read by the Atlas 8am cycle. Include: mandatory daily activities, KPIs, decision rights, professional behaviour, escalation rules. The richer this is, the better the agent's daily deliverables.
        </p>
        <Textarea
          defaultValue={agent.job_description ?? ""}
          rows={10}
          onBlur={(e) => void patchAgent({ job_description: e.target.value || null })}
          placeholder={`## Role: ${agent.name}\n\n### Mission\n...\n\n### Mandatory daily activities\n1. ...\n\n### KPIs / OKRs\n...\n\n### Decision rights\n- Autonomous: ...\n- Boss approval: ...\n\n### Escalation rules\n...`}
          className="font-mono text-xs"
        />
      </Section>

      {/* 2. Boss / DRs */}
      <Section title="Boss & direct reports" icon={<Activity className="w-4 h-4" />}>
        <div className="text-sm space-y-1">
          <div><span className="text-muted-foreground">Reports to:</span> <strong>{boss?.name ?? "President"}</strong></div>
          <div>
            <span className="text-muted-foreground">Direct reports:</span>{" "}
            {directReports.length === 0 ? <span className="italic text-muted-foreground">none</span> : directReports.map(d => (
              <button key={d.id} onClick={() => navigate(`/agents/${d.id}`)} className="text-primary hover:underline mr-2">{d.name}</button>
            ))}
          </div>
        </div>
      </Section>

      {/* 2b. B7 Performance Scorecard */}
      <Section
        title="Performance Scorecard (CHRO)"
        icon={<BarChart3 className="w-4 h-4" />}
        right={
          <div className="flex items-center gap-1">
            {[7, 14, 30].map(d => (
              <button key={d}
                onClick={() => setScoreDays(d)}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${scoreDays === d ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted border-muted-foreground/30"}`}>
                {d}d
              </button>
            ))}
            <Button size="sm" variant="ghost" className="h-6 px-2 ml-1" onClick={() => void loadScore(scoreDays)}>
              <RefreshCw className={`w-3 h-3 ${scoreLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        }
      >
        {score ? (
          <div className="space-y-2">
            {/* Overall badge */}
            <div className="flex items-center gap-3 mb-3">
              <div className="text-center">
                <div className={`text-3xl font-bold font-mono ${scoreColour(score.overall)}`}>{score.overall}</div>
                <div className="text-[10px] text-muted-foreground">Overall ({scoreDays}d)</div>
              </div>
              <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-1">
                {SCORE_DIMS.map(dim => {
                  const val = score[dim.key] as number;
                  return (
                    <div key={dim.key} className="flex items-center justify-between text-xs" title={dim.description}>
                      <span className="text-muted-foreground truncate max-w-[140px]">{dim.label}</span>
                      <span className={`font-mono font-semibold ml-2 shrink-0 ${scoreColour(val)}`}>{val}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Mini bar chart */}
            <div className="space-y-1">
              {SCORE_DIMS.map(dim => {
                const val = score[dim.key] as number;
                return (
                  <div key={dim.key} className="flex items-center gap-2 text-[10px]">
                    <span className="w-36 text-muted-foreground truncate shrink-0">{dim.label}</span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${val >= 80 ? "bg-green-500" : val >= 60 ? "bg-amber-400" : "bg-red-400"}`}
                        style={{ width: `${val}%` }}
                      />
                    </div>
                    <span className={`w-7 text-right font-mono font-semibold ${scoreColour(val)}`}>{val}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Computed by B7 Scoring Engine — pure SQL, no LLM.</p>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-4 text-center">
            {scoreLoading ? "Computing scorecard…" : "No deliverable data yet for this agent."}
          </div>
        )}
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

      {/* 4b. Knowledge base */}
      <Section
        title={`Knowledge base (${(agent.knowledge?.length ?? 0) + (agent.training?.length ?? 0)})`}
        icon={<Brain className="w-4 h-4" />}
      >
        {(!agent.knowledge?.length && !agent.training?.length) ? (
          <p className="text-xs text-muted-foreground italic">No knowledge entries yet.</p>
        ) : (
          <div className="space-y-4">
            {agent.knowledge && agent.knowledge.length > 0 && (
              <div>
                <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5">Domain knowledge</div>
                <ul className="space-y-1">
                  {agent.knowledge.map((k, i) => (
                    <li key={i} className="text-xs flex gap-2">
                      <span className="text-primary shrink-0 font-bold">·</span>
                      <span>{k}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {agent.training && agent.training.length > 0 && (
              <div>
                <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1.5">Training curriculum</div>
                <ul className="space-y-1">
                  {agent.training.map((t, i) => (
                    <li key={i} className="text-xs flex gap-2">
                      <span className="text-primary shrink-0 font-bold">·</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* 4c. Sources */}
      <Section
        title={`Sources (${sources.length})`}
        icon={<Library className="w-4 h-4" />}
      >
        {sources.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No sources yet.</p>
        ) : (
          <SourcesPanel sources={sources} />
        )}
      </Section>

      {/* 5. App sections (live from agent_section_map) */}
      <Section
        title={`App sections assigned (${sectionsPrimary.length} primary · ${sectionsSecondary.length} secondary)`}
        icon={<Map className="w-4 h-4" />}
        right={
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void load()} title="Refresh">
            <RefreshCw className="w-3 h-3" />
          </Button>
        }
      >
        {sectionsPrimary.length === 0 && sectionsSecondary.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No sections mapped yet.{" "}
            <a href="/exec/section-map" className="text-primary hover:underline">Open Section Map</a> to add.
          </p>
        ) : (
          <div className="space-y-3">
            {sectionsPrimary.length > 0 && (
              <div>
                <div className="text-[10px] uppercase font-bold text-emerald-700 mb-1">Primary owner</div>
                <SectionMapTable rows={sectionsPrimary} onReroute={row => { setRerouteRow(row); setRerouteDraft(row.primary_agent); }} />
              </div>
            )}
            {sectionsSecondary.length > 0 && (
              <div>
                <div className="text-[10px] uppercase font-bold text-blue-700 mb-1">Secondary contributor</div>
                <SectionMapTable rows={sectionsSecondary} onReroute={row => { setRerouteRow(row); setRerouteDraft(row.primary_agent); }} />
              </div>
            )}
          </div>
        )}
        {/* Re-route modal */}
        {rerouteRow && (
          <div className="mt-3 border rounded-lg p-3 bg-muted/40 space-y-2">
            <p className="text-xs font-medium">Re-route primary owner for: <strong>{rerouteRow.subsection}</strong></p>
            <Input
              value={rerouteDraft}
              onChange={e => setRerouteDraft(e.target.value)}
              placeholder="New primary agent name…"
              className="h-7 text-xs"
            />
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={() => void rerouteSection(rerouteRow, rerouteDraft)}>Save</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setRerouteRow(null); setRerouteDraft(""); }}>Cancel</Button>
            </div>
          </div>
        )}
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
                }`}>{t.approval_level === "livio" ? "president" : t.approval_level}</Badge>
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
            { key: "decision_rights_livio",      label: "President approval",         tone: "border-red-300" },
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

      {/* 10. Atlas KPI history */}
      <Section title="Atlas output history" icon={<BarChart2 className="w-4 h-4" />}>
        <KpiSparkline kpis={kpis} />
      </Section>

      {/* 11. Performance Review — computed stats + 6-dimension readiness score */}
      <PerformanceReviewSection
        agent={agent}
        tasks={tasks}
        ideas={ideas}
        objectives={objectives}
        krs={krs}
        onSave={(scores) => void patchAgent({ readiness_scores: JSON.stringify(scores) })}
      />

      {/* 11. Training Plan */}
      <Section title="Training plan" icon={<GraduationCap className="w-4 h-4" />}>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground block mb-1">Skill gaps</label>
            <Textarea
              defaultValue={agent.skill_gaps ?? ""}
              rows={3}
              onBlur={(e) => void patchAgent({ skill_gaps: e.target.value })}
              placeholder="List identified skill or knowledge gaps, one per line…"
              className="text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase font-bold text-muted-foreground block mb-1">Training plan</label>
            <Textarea
              defaultValue={agent.training_plan ?? ""}
              rows={5}
              onBlur={(e) => void patchAgent({ training_plan: e.target.value })}
              placeholder={"Format:\nSkill Gap: …\nTraining Objective: …\nMaterial Assigned: …\nExpected Behaviour Change: …\nDeadline: …\nHow Measured: …"}
              className="text-xs font-mono"
            />
          </div>
        </div>
      </Section>
    </div>
  );
}

// ── KPI Sparkline sub-component ──────────────────────────────────────────────
function KpiSparkline({ kpis }: { kpis: AgentKpi[] }) {
  // Show only round1 rows, sorted oldest → newest, last 10
  const r1 = [...kpis.filter(k => k.round === "round1")].reverse().slice(0, 10);
  if (r1.length === 0) return <p className="text-xs text-muted-foreground italic">No cycle data yet.</p>;

  const latest = r1[r1.length - 1];
  const maxD = Math.max(...r1.map(k => k.deliverable_count), 1);

  // SVG sparkline — 200×40 viewBox
  const W = 200; const H = 40; const PAD = 4;
  const xs = r1.map((_, i) => PAD + (i / Math.max(r1.length - 1, 1)) * (W - PAD * 2));
  const ys = r1.map(k => H - PAD - ((k.deliverable_count / maxD) * (H - PAD * 2)));
  const polyline = xs.map((x, i) => `${x},${ys[i]}`).join(" ");

  return (
    <div className="space-y-3">
      {/* Stat pills for latest cycle */}
      <div className="flex items-center flex-wrap gap-2 text-xs">
        {[
          { label: "Deliverables", value: latest.deliverable_count, color: "bg-indigo-100 text-indigo-700" },
          { label: "Insights",     value: latest.insight_count,     color: "bg-blue-100 text-blue-700" },
          { label: "Ideas",        value: latest.idea_count,        color: "bg-violet-100 text-violet-700" },
          { label: "Actions",      value: latest.action_count,      color: "bg-emerald-100 text-emerald-700" },
        ].map(s => (
          <span key={s.label} className={`px-2 py-0.5 rounded-full font-medium ${s.color}`}>
            {s.value} {s.label}
          </span>
        ))}
        {latest.avg_total_score != null && (
          <span className="px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
            avg score {latest.avg_total_score.toFixed(1)}
          </span>
        )}
        <span className="text-muted-foreground text-[10px] ml-auto">latest cycle · {r1.length} data point{r1.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Sparkline + axis label */}
      <div className="flex items-end gap-3">
        <div>
          <div className="text-[9px] text-muted-foreground mb-1 uppercase tracking-wide">Deliverables / cycle (R1)</div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-48 h-10 overflow-visible">
            <polyline
              points={polyline}
              fill="none"
              stroke="hsl(239 84% 67%)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            {xs.map((x, i) => (
              <circle key={i} cx={x} cy={ys[i]} r="2.5"
                fill="hsl(239 84% 67%)"
                className="cursor-default"
              >
                <title>Cycle {r1[i].cycle_id}: {r1[i].deliverable_count} deliverables</title>
              </circle>
            ))}
          </svg>
        </div>

        {/* Round 2 comparison pills if any R2 data */}
        {kpis.some(k => k.round === "round2") && (() => {
          const latestR2 = kpis.find(k => k.round === "round2" && k.cycle_id === latest.cycle_id);
          if (!latestR2) return null;
          return (
            <div className="border-l pl-3">
              <div className="text-[9px] text-muted-foreground mb-1 uppercase tracking-wide">Round 2 (latest)</div>
              <div className="flex flex-col gap-0.5 text-[10px]">
                <span className="font-mono">{latestR2.deliverable_count} deliverables</span>
                {latestR2.avg_total_score != null && (
                  <span className="text-amber-600 font-mono">avg {latestR2.avg_total_score.toFixed(1)}</span>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Performance Review sub-component ────────────────────────────────────────
interface ReadinessReview {
  id: number; agent_id: number; reviewed_at: string; overall: number;
  role_clarity: number; data_access: number; skill_knowledge: number;
  output_quality: number; decision_discipline: number; okr_progress: number;
  notes: string | null;
}

function PerformanceReviewSection({ agent, tasks, ideas, objectives, krs, onSave }: {
  agent: Agent;
  tasks: Task[];
  ideas: Idea[];
  objectives: Objective[];
  krs: KeyResult[];
  onSave: (scores: Record<string, number>) => void;
}) {
  const { toast } = useToast();
  const [scores, setScores] = useState<Record<string, number>>(() => parseReadiness(agent.readiness_scores));
  const [history, setHistory] = useState<ReadinessReview[]>([]);
  const [savingReview, setSavingReview] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  // Reparse when agent changes (e.g. after save)
  useEffect(() => { setScores(parseReadiness(agent.readiness_scores)); }, [agent.readiness_scores]);

  // Load history from DB
  useEffect(() => {
    fetch(`/api/agentic/readiness/${agent.id}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((rows: ReadinessReview[]) => setHistory(Array.isArray(rows) ? rows : []))
      .catch(() => {/* non-fatal */});
  }, [agent.id]);

  // Computed stats from live data
  const totalTasks   = tasks.length;
  const doneTasks    = tasks.filter(t => t.status === "done").length;
  const completionPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const avgIdeaScore = ideas.length > 0
    ? Math.round(ideas.reduce((s, i) => s + (i.total_score ?? 0), 0) / ideas.length)
    : 0;
  const openIdeas    = ideas.filter(i => i.status === "proposed").length;
  const krCount      = krs.length;
  const krWithProgress = krs.filter(k => k.current_value && k.target_value && k.current_value !== "0").length;

  const overallReadiness = READINESS_DIMS.length > 0
    ? Math.round(READINESS_DIMS.reduce((s, d) => s + (scores[d.key] ?? 0), 0) / READINESS_DIMS.length)
    : 0;

  // Delta vs last DB review
  const lastReview = history[0] ?? null;
  function delta(key: string): number | null {
    if (!lastReview) return null;
    const prev = (lastReview as any)[key] ?? null;
    const curr = scores[key] ?? 0;
    return prev != null ? curr - prev : null;
  }

  function setDim(key: string, val: number) {
    const next = { ...scores, [key]: val };
    setScores(next);
    onSave(next);
  }

  async function saveReview() {
    setSavingReview(true);
    try {
      const r = await fetch("/api/agentic/readiness", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agent.id,
          reviewed_at: new Date().toISOString().slice(0, 10),
          notes: reviewNotes || null,
          ...Object.fromEntries(READINESS_DIMS.map(d => [d.key, scores[d.key] ?? 0])),
        }),
      });
      if (!r.ok) throw new Error("save failed");
      const saved: ReadinessReview = await r.json();
      setHistory(prev => [saved, ...prev]);
      setReviewNotes("");
      toast({ title: `Readiness snapshot saved — overall ${saved.overall}/100` });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSavingReview(false);
    }
  }

  const readinessColor = overallReadiness >= 70 ? "text-emerald-600" : overallReadiness >= 40 ? "text-amber-600" : "text-red-600";

  return (
    <Section title="Performance review" icon={<TrendingUp className="w-4 h-4" />}>
      {/* Computed stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Task completion", value: `${completionPct}%`, sub: `${doneTasks}/${totalTasks} tasks` },
          { label: "Avg idea score",  value: avgIdeaScore > 0 ? String(avgIdeaScore) : "—", sub: `${openIdeas} proposed` },
          { label: "KR coverage",     value: krCount > 0 ? `${krWithProgress}/${krCount}` : "—", sub: "key results with progress" },
          { label: "Readiness",       value: `${overallReadiness}`, sub: `/ 100 avg · ${history.length} review${history.length === 1 ? "" : "s"}`,
            valueClass: readinessColor },
        ].map(stat => (
          <div key={stat.label} className="border rounded p-2 text-center">
            <div className={`text-xl font-bold ${stat.valueClass ?? ""}`}>{stat.value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{stat.label}</div>
            <div className="text-[9px] text-muted-foreground">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* 6-dimension readiness bars + delta vs last review */}
      <div className="text-[10px] uppercase font-bold text-muted-foreground mb-2">Agent readiness (0–100)</div>
      <div className="grid md:grid-cols-2 gap-x-6 gap-y-2 mb-4">
        {READINESS_DIMS.map(d => {
          const val = scores[d.key] ?? 0;
          const d_ = delta(d.key);
          const barColor = val >= 70 ? "bg-emerald-500" : val >= 40 ? "bg-amber-500" : "bg-red-500";
          return (
            <div key={d.key} className="flex items-center gap-2">
              <span className="text-xs w-36 shrink-0">{d.label}</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${val}%` }} />
              </div>
              <input
                type="number" min={0} max={100}
                value={val}
                onChange={e => setDim(d.key, Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-12 h-6 text-xs text-center border rounded bg-background"
              />
              {d_ !== null && (
                <span className={`text-[10px] w-8 text-right shrink-0 font-mono ${d_ > 0 ? "text-emerald-600" : d_ < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                  {d_ > 0 ? `+${d_}` : d_ < 0 ? String(d_) : "="}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Save snapshot */}
      <div className="border rounded p-3 bg-muted/20 space-y-2">
        <div className="text-[10px] uppercase font-bold text-muted-foreground">Save readiness snapshot to history</div>
        <input
          className="w-full border rounded px-2 py-1 text-xs bg-background"
          placeholder="Notes (optional) — e.g. 'After onboarding Q1' or 'Post training on pricing'"
          value={reviewNotes}
          onChange={e => setReviewNotes(e.target.value)}
        />
        <Button size="sm" onClick={saveReview} disabled={savingReview} className="h-7">
          <TrendingUp className="w-3.5 h-3.5 mr-1" /> {savingReview ? "Saving…" : "Save snapshot"}
        </Button>
      </div>

      {/* Review history */}
      {history.length > 0 && (
        <div className="mt-3">
          <button
            className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1 mb-2"
            onClick={() => setShowHistory(h => !h)}
          >
            <Activity className="w-3 h-3" /> History ({history.length}) {showHistory ? "▲" : "▼"}
          </button>
          {showHistory && (
            <div className="overflow-x-auto">
              <table className="text-[10px] w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left p-1 font-semibold">Date</th>
                    <th className="text-right p-1 font-semibold">Overall</th>
                    {READINESS_DIMS.map(d => (
                      <th key={d.key} className="text-right p-1 font-semibold whitespace-nowrap">{d.label.split(" ")[0]}</th>
                    ))}
                    <th className="text-left p-1 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((r, i) => {
                    const prevOverall = history[i + 1]?.overall ?? null;
                    const trend = prevOverall != null ? r.overall - prevOverall : null;
                    return (
                      <tr key={r.id} className="border-b hover:bg-muted/20">
                        <td className="p-1 font-mono">{r.reviewed_at}</td>
                        <td className="p-1 text-right font-bold">
                          <span className={r.overall >= 70 ? "text-emerald-600" : r.overall >= 40 ? "text-amber-600" : "text-red-600"}>
                            {r.overall}
                          </span>
                          {trend !== null && (
                            <span className={`ml-1 ${trend > 0 ? "text-emerald-500" : trend < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                              {trend > 0 ? `↑${trend}` : trend < 0 ? `↓${Math.abs(trend)}` : "="}
                            </span>
                          )}
                        </td>
                        {READINESS_DIMS.map(d => (
                          <td key={d.key} className="p-1 text-right tabular-nums">
                            {(r as any)[d.key] ?? "—"}
                          </td>
                        ))}
                        <td className="p-1 text-muted-foreground max-w-[160px] truncate">{r.notes ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── SourcesPanel ─────────────────────────────────────────────────────────────
const SRC_PRIORITY = new Set(["Must", "Should", "Nice"]);
function parseSrcTags(tags: string[] | null) {
  const t = tags ?? [];
  const priority = t.find(x => SRC_PRIORITY.has(x)) ?? "";
  const category = t.find(x => !SRC_PRIORITY.has(x)) ?? "";
  const cost = [...t].reverse().find(x => !SRC_PRIORITY.has(x) && x !== category) ?? "";
  return { priority, category, cost };
}
function SourcesPanel({ sources }: { sources: AgentSource[] }) {
  const [filter, setFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const filtered = filter ? sources.filter(s => parseSrcTags(s.tags).priority === filter) : sources;
  const counts = { Must: 0, Should: 0, Nice: 0 } as Record<string, number>;
  sources.forEach(s => { const p = parseSrcTags(s.tags).priority; if (p) counts[p] = (counts[p] ?? 0) + 1; });

  function toggle(id: number) {
    setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  return (
    <div>
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        {([["", "All", sources.length], ["Must", "Must", counts.Must], ["Should", "Should", counts.Should], ["Nice", "Nice", counts.Nice]] as [string, string, number][]).map(([f, label, cnt]) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${filter === f ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted border-muted-foreground/30"}`}>
            {label} <span className="opacity-60">({cnt})</span>
          </button>
        ))}
      </div>
      <div className="space-y-0.5">
        {filtered.map(s => {
          const { priority, category, cost } = parseSrcTags(s.tags);
          const isOpen = expanded.has(s.id);
          const prStyle = priority === "Must" ? "border-red-300 text-red-700 bg-red-50"
            : priority === "Should" ? "border-amber-300 text-amber-700 bg-amber-50"
            : "border-gray-300 text-gray-600";
          return (
            <div key={s.id} className="border rounded overflow-hidden">
              <button onClick={() => toggle(s.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/20 transition-colors">
                <ChevronRight className={`w-3 h-3 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                <span className="text-xs flex-1 font-medium">{s.title}</span>
                {priority && <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${prStyle}`}>{priority}</span>}
                {category && <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline">{category}</span>}
                {cost && <span className="text-[10px] text-muted-foreground shrink-0">{cost}</span>}
              </button>
              {isOpen && (
                <div className="px-3 py-2 text-xs bg-muted/10 border-t whitespace-pre-wrap leading-relaxed">
                  {s.content.replace(/^\*\*[^*]+\*\*\n?/, "")}
                </div>
              )}
            </div>
          );
        })}
      </div>
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

const FREQ_COLORS: Record<string, string> = {
  Daily:     "border-emerald-300 text-emerald-700",
  Weekly:    "border-blue-300 text-blue-700",
  Monthly:   "border-purple-300 text-purple-700",
  Quarterly: "border-amber-300 text-amber-700",
  Triggered: "border-slate-300 text-slate-600",
};

function SectionMapTable({ rows, onReroute }: { rows: SectionMapRow[]; onReroute: (row: SectionMapRow) => void }) {
  return (
    <div className="text-xs border rounded overflow-hidden">
      <div className="grid grid-cols-[100px_100px_1fr_80px_auto] gap-0 px-2 py-1 font-bold text-[10px] uppercase text-muted-foreground bg-muted/50 border-b">
        <div>Module</div><div>Section</div><div>Subsection</div><div>Freq</div><div></div>
      </div>
      {rows.map(row => (
        <div key={row.id} className="grid grid-cols-[100px_100px_1fr_80px_auto] gap-0 px-2 py-1 border-b last:border-0 items-center hover:bg-muted/20">
          <div className="truncate text-muted-foreground" title={row.module}>{row.module}</div>
          <div className="truncate text-muted-foreground" title={row.section}>{row.section}</div>
          <div className="truncate font-medium" title={row.why || row.subsection}>{row.subsection}</div>
          <div>
            <Badge variant="outline" className={`text-[9px] px-1 ${FREQ_COLORS[row.frequency] ?? ""}`}>{row.frequency}</Badge>
          </div>
          <div>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => onReroute(row)} title="Re-route primary owner">
              ↺ Re-route
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
