import { useState, useEffect, useCallback } from "react";
import {
  Hammer, CheckCircle2, Circle, SkipForward, ChevronDown, ChevronUp,
  Copy, Check, X, Zap, Users, Map, BookOpen, Shield, Target,
  Building2, Brain, Activity, Layers, Network, BarChart3
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type DayStatus = "pending" | "done" | "skipped";

interface Task {
  id: string;
  text: string;
}

interface BuildItem {
  day: number;
  week: 1 | 2;
  title: string;
  focus: string;
  icon: React.ElementType;
  tasks: Task[];
}

/* ─── System context for prompt generation ───────────────────────────────── */

const SYSTEM_CONTEXT = `# Atlas — Eendigo AI Operating System: Build Plan Context

## What Atlas is
Atlas is Eendigo's autonomous intelligence operating system. It runs a daily 8am cycle where six specialised agents (CEO, COO, CFO, BD, CHRO, Proposal) each read their section of the company data (HR, financials, proposals, hiring, BD pipeline), produce structured deliverables (insights, ideas, actions), and surface a consolidated CEO brief. A second "Round 2" pass runs after CoWork research letters are received, updating all deliverables with external intelligence before the brief is finalised.

## Current architecture
- Agent registry with skills and section mappings (agent_section_map)
- Daily cycle engine (aiosService.ts) — Round 1 + Round 2
- CEO brief consolidation and history
- Approvals / decisions queue
- OKR tree with agent linkage
- Section map (which agent owns which subsection)
- CoWork letter parser (Round 2 input)
- Knowledge base (agent reference docs)
- Skills factory (reusable prompt building blocks)
- EXCOM meeting digest

## Known gaps and build priorities
1. Agent-level KPIs are not tracked over time — no trend view
2. The BD agent lacks live HubSpot enrichment hooks
3. Finance agent has no forecast model integration
4. CHRO agent does not yet cross-reference open hiring against org chart gaps
5. Section map coverage is manual — needs auto-discovery from data patterns
6. Deliverable quality scoring (human feedback loop) is missing
7. Prompt versioning — agents cannot A/B test prompt variants
8. CoWork letter ingestion is manual (paste) — email/webhook intake missing
9. CEO brief formatting is unstructured prose — no structured JSON export
10. Cross-agent dependency resolution (e.g., BD informs Finance forecast) is absent

## Build philosophy
Each day in the plan targets one gap or capability. Output is always: (1) a schema or route change, (2) a UI surface, (3) a test prompt. Do the smallest thing that proves the concept, then wire it live.`;

/* ─── 14-Day Plan ────────────────────────────────────────────────────────── */

const PLAN: BuildItem[] = [
  {
    day: 1, week: 1, title: "Agent KPI Baseline", icon: Activity, focus: "Track agent output quality over time",
    tasks: [
      { id: "1-1", text: "Add agent_kpis table: cycle_id, agent_name, deliverable_count, insight_score, action_score" },
      { id: "1-2", text: "Populate after each Round 1 + Round 2 run in aiosService.ts" },
      { id: "1-3", text: "Render per-agent sparkline on AgentDetail page (last 10 cycles)" },
      { id: "1-4", text: "Add cycle summary KPI row to CEO brief header" },
    ],
  },
  {
    day: 2, week: 1, title: "Deliverable Feedback Loop", icon: CheckCircle2, focus: "Human-in-the-loop quality rating",
    tasks: [
      { id: "2-1", text: "Add 'thumbs up / thumbs down' buttons to each deliverable card in AiosCycle" },
      { id: "2-2", text: "Store rating in aios_deliverables.human_rating column" },
      { id: "2-3", text: "Surface average rating per agent in AgentRegistry list" },
      { id: "2-4", text: "Use rating history as few-shot quality signal in prompt header" },
    ],
  },
  {
    day: 3, week: 1, title: "Prompt Version Control", icon: Layers, focus: "A/B test prompt variants per agent",
    tasks: [
      { id: "3-1", text: "Add prompt_versions table: agent_name, version_tag, prompt_text, created_at, is_active" },
      { id: "3-2", text: "Route: POST /api/agents/:name/prompt-versions, GET list, PATCH activate" },
      { id: "3-3", text: "UI: version switcher on AgentDetail page with diff view" },
      { id: "3-4", text: "aiosService reads active version at cycle start" },
    ],
  },
  {
    day: 4, week: 1, title: "CoWork Email Intake", icon: Zap, focus: "Auto-ingest CoWork letters via webhook",
    tasks: [
      { id: "4-1", text: "POST /api/cowork/ingest — accepts raw email body, parses agent headers" },
      { id: "4-2", text: "Add cowork_raw_emails table: received_at, raw_body, parsed_cycle_id" },
      { id: "4-3", text: "Link cowork_letters records to raw email source for auditability" },
      { id: "4-4", text: "UI: 'Paste email' shortcut in AiosCycle CoWork panel" },
    ],
  },
  {
    day: 5, week: 1, title: "BD × Finance Cross-link", icon: BarChart3, focus: "BD pipeline feeds Finance forecast",
    tasks: [
      { id: "5-1", text: "BD agent prompt: include open_opportunities total value from BD pipeline" },
      { id: "5-2", text: "Finance agent prompt: include BD weighted_pipeline_eur from same cycle data" },
      { id: "5-3", text: "Add cross_agent_signals table: source_agent, target_agent, signal_key, value, cycle_id" },
      { id: "5-4", text: "CEO brief section: pipeline vs forecast gap highlight" },
    ],
  },
  {
    day: 6, week: 1, title: "CHRO × Org Chart Gap", icon: Users, focus: "Open roles mapped to org chart gaps",
    tasks: [
      { id: "6-1", text: "CHRO agent prompt: include open_positions count and their departments" },
      { id: "6-2", text: "Cross-reference against org_chart nodes where direct_report_count < expected" },
      { id: "6-3", text: "Surface 'coverage gap score' per department in CHRO deliverables" },
      { id: "6-4", text: "Hiring page: banner when CHRO gap score exceeds threshold" },
    ],
  },
  {
    day: 7, week: 1, title: "Section Map Auto-Discovery", icon: Map, focus: "Infer section ownership from data patterns",
    tasks: [
      { id: "7-1", text: "Script: scan last 20 cycle deliverables, count per-agent mentions of each app section" },
      { id: "7-2", text: "Surface suggestion list on SectionMap page: 'BD Agent covers this 80% of the time — assign?'" },
      { id: "7-3", text: "One-click confirm writes to agent_section_map" },
      { id: "7-4", text: "Add 'last_auto_suggested' timestamp to agent_section_map rows" },
    ],
  },
  {
    day: 8, week: 2, title: "CEO Brief JSON Export", icon: Network, focus: "Structured brief for downstream tools",
    tasks: [
      { id: "8-1", text: "Add brief_json JSONB column to ceo_briefs: { date, agents: [{name, top_insight, top_action}], priorities: string[] }" },
      { id: "8-2", text: "Populate during runCeoConsolidation by parsing Claude output" },
      { id: "8-3", text: "GET /api/ceo-brief/latest/json — returns structured JSON" },
      { id: "8-4", text: "CEO Brief page: 'Export JSON' button + copy to clipboard" },
    ],
  },
  {
    day: 9, week: 2, title: "Agent Dependency Graph", icon: Network, focus: "Visualise cross-agent signal flow",
    tasks: [
      { id: "9-1", text: "Read cross_agent_signals from Day 5 — render directional graph on AgenticHome" },
      { id: "9-2", text: "Node = agent, Edge = signal type (BD→Finance, CHRO→COO)" },
      { id: "9-3", text: "Edge weight = signal frequency over last 30 cycles" },
      { id: "9-4", text: "Click edge → modal showing signal history + values" },
    ],
  },
  {
    day: 10, week: 2, title: "HubSpot Live Enrichment", icon: Target, focus: "BD agent pulls live deal data",
    tasks: [
      { id: "10-1", text: "Store HubSpot API key in settings table (encrypted at rest)" },
      { id: "10-2", text: "GET /api/integrations/hubspot/opportunities — paginated deal list" },
      { id: "10-3", text: "BD agent prompt: inject live deal count + stage breakdown from HubSpot" },
      { id: "10-4", text: "BD page: 'Sync from HubSpot' button + last-synced badge" },
    ],
  },
  {
    day: 11, week: 2, title: "Finance Forecast Model", icon: BarChart3, focus: "CFO agent projects cash position",
    tasks: [
      { id: "11-1", text: "Add cash_forecast table: month, projected_inflow, projected_outflow, confidence" },
      { id: "11-2", text: "CFO agent prompt: include last 6 months actuals, generate next 3-month forecast" },
      { id: "11-3", text: "Parse forecast from CFO deliverables and persist to cash_forecast" },
      { id: "11-4", text: "ExecDashboard: mini cash-runway chart (months of runway at current burn)" },
    ],
  },
  {
    day: 12, week: 2, title: "EXCOM Auto-Agenda", icon: Building2, focus: "Build EXCOM agenda from daily cycle",
    tasks: [
      { id: "12-1", text: "After each cycle: extract top 1 action per agent → propose as EXCOM agenda item" },
      { id: "12-2", text: "Add excom_agenda_items table: cycle_id, agent_name, proposed_item, approved" },
      { id: "12-3", text: "ExcomPage: 'Import from latest cycle' button populates draft agenda" },
      { id: "12-4", text: "Approval flow: mark items approved → appear in EXCOM minutes export" },
    ],
  },
  {
    day: 13, week: 2, title: "Cycle Health Dashboard", icon: Activity, focus: "At-a-glance Atlas operating health",
    tasks: [
      { id: "13-1", text: "AgenticHome: add health scorecard — last 7 days: cycle completion rate, avg R2 quality, open approvals" },
      { id: "13-2", text: "Red/amber/green thresholds configurable in Admin settings" },
      { id: "13-3", text: "Daily streak counter: consecutive days with a completed R2 cycle" },
      { id: "13-4", text: "Alert banner when cycle hasn't run by 09:00 (configurable time)" },
    ],
  },
  {
    day: 14, week: 2, title: "Full Cycle Integration Test", icon: CheckCircle2, focus: "End-to-end Atlas smoke test",
    tasks: [
      { id: "14-1", text: "Script: trigger a full cycle run, inject mock CoWork letters, assert R2 completes" },
      { id: "14-2", text: "Verify: CEO brief contains deliverables from all 6 agents, Round 2 badge present" },
      { id: "14-3", text: "Verify: KPI row updated, cross-agent signals written, EXCOM draft populated" },
      { id: "14-4", text: "Output: test summary in logs page with pass/fail per check" },
    ],
  },
];

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function SectionHeader({ week, count, done }: { week: 1 | 2; count: number; done: number }) {
  const pct = Math.round((done / count) * 100);
  return (
    <div className="flex items-center gap-3 mb-4 mt-8 first:mt-0">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-2">
        Week {week}
      </span>
      <span className="text-xs text-muted-foreground">{done}/{count} done</span>
      <div className="h-1.5 w-20 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function StatusPill({ status, onChange }: { status: DayStatus; onChange: (s: DayStatus) => void }) {
  const map: Record<DayStatus, { label: string; color: string; next: DayStatus }> = {
    pending:  { label: "Pending",  color: "bg-muted text-muted-foreground",             next: "done"    },
    done:     { label: "Done",     color: "bg-emerald-100 text-emerald-700",             next: "skipped" },
    skipped:  { label: "Skipped",  color: "bg-orange-100 text-orange-700",               next: "pending" },
  };
  const { label, color, next } = map[status];
  return (
    <button
      onClick={() => onChange(next)}
      className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors hover:opacity-80 ${color}`}
      title="Click to cycle status"
    >
      {label}
    </button>
  );
}

interface DayCardProps {
  item: BuildItem;
  status: DayStatus;
  expanded: boolean;
  onToggle: () => void;
  onStatus: (s: DayStatus) => void;
  onPrompt: () => void;
}

function DayCard({ item, status, expanded, onToggle, onStatus, onPrompt }: DayCardProps) {
  const Icon = item.icon;
  const borderColor =
    status === "done"    ? "border-l-emerald-400" :
    status === "skipped" ? "border-l-orange-300"  :
                           "border-l-indigo-300";

  return (
    <div className={`border border-border border-l-4 ${borderColor} rounded-lg bg-card transition-all`}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex items-center justify-center w-7 h-7 rounded-md bg-indigo-50 text-indigo-600 shrink-0">
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">Day {item.day}</span>
            <span className="font-medium text-sm truncate">{item.title}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{item.focus}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusPill status={status} onChange={onStatus} />
          <Button
            variant="ghost"
            size="sm"
            onClick={onPrompt}
            className="h-7 px-2 text-xs text-indigo-600 hover:bg-indigo-50"
            title="Generate Claude prompt for this day"
          >
            <Zap className="w-3.5 h-3.5 mr-1" />
            Prompt
          </Button>
          <button onClick={onToggle} className="p-1 rounded hover:bg-accent text-muted-foreground">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Task list */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          {item.tasks.map((task, i) => (
            <div key={task.id} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="font-mono text-xs text-indigo-400 shrink-0 mt-0.5">{i + 1}.</span>
              <span>{task.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Prompt modal ───────────────────────────────────────────────────────── */

function buildPrompt(item: BuildItem): string {
  const tasks = item.tasks.map((t, i) => `${i + 1}. ${t.text}`).join("\n");
  return `${SYSTEM_CONTEXT}

---

# Day ${item.day}: ${item.title}

**Focus:** ${item.focus}

## Tasks to implement today

${tasks}

## Instructions

Work through each task in order. For each:
- Explain what you will do and why
- Make the code change
- Run \`npm run check\` before moving to the next task
- If a task requires a DB migration (new column or table), confirm before running \`npm run db:push\`

Start with Task 1.`;
}

/* ─── Main component ─────────────────────────────────────────────────────── */

const STORAGE_KEY = "atlas-buildup-status";

export default function BuildUp() {
  const [statuses, setStatuses] = useState<Record<number, DayStatus>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [promptDay, setPromptDay] = useState<BuildItem | null>(null);
  const [copied, setCopied] = useState(false);

  // Persist statuses
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(statuses)); } catch {}
  }, [statuses]);

  const setStatus = useCallback((day: number, s: DayStatus) => {
    setStatuses(prev => ({ ...prev, [day]: s }));
  }, []);

  const toggleExpanded = useCallback((day: number) => {
    setExpanded(prev => ({ ...prev, [day]: !prev[day] }));
  }, []);

  // Progress
  const doneCount  = PLAN.filter(p => statuses[p.day] === "done").length;
  const totalCount = PLAN.length;
  const pct        = Math.round((doneCount / totalCount) * 100);

  // Week splits
  const week1 = PLAN.filter(p => p.week === 1);
  const week2 = PLAN.filter(p => p.week === 2);
  const w1Done = week1.filter(p => statuses[p.day] === "done").length;
  const w2Done = week2.filter(p => statuses[p.day] === "done").length;

  const handleCopy = async () => {
    if (!promptDay) return;
    await navigator.clipboard.writeText(buildPrompt(promptDay));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600">
            <Hammer className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Atlas Build Plan</h1>
            <p className="text-sm text-muted-foreground">14-day capability roadmap</p>
          </div>
        </div>
        <Badge variant="outline" className="text-indigo-700 border-indigo-300 bg-indigo-50">
          {doneCount} / {totalCount} days
        </Badge>
      </div>

      {/* Overall progress bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{pct}% complete</span>
          <span>{totalCount - doneCount} remaining</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Week 1 */}
      <div>
        <SectionHeader week={1} count={week1.length} done={w1Done} />
        <div className="space-y-2">
          {week1.map(item => (
            <DayCard
              key={item.day}
              item={item}
              status={statuses[item.day] ?? "pending"}
              expanded={expanded[item.day] ?? false}
              onToggle={() => toggleExpanded(item.day)}
              onStatus={(s) => setStatus(item.day, s)}
              onPrompt={() => { setPromptDay(item); setCopied(false); }}
            />
          ))}
        </div>
      </div>

      {/* Week 2 */}
      <div>
        <SectionHeader week={2} count={week2.length} done={w2Done} />
        <div className="space-y-2">
          {week2.map(item => (
            <DayCard
              key={item.day}
              item={item}
              status={statuses[item.day] ?? "pending"}
              expanded={expanded[item.day] ?? false}
              onToggle={() => toggleExpanded(item.day)}
              onStatus={(s) => setStatus(item.day, s)}
              onPrompt={() => { setPromptDay(item); setCopied(false); }}
            />
          ))}
        </div>
      </div>

      {/* Prompt modal */}
      {promptDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setPromptDay(null)} />
          <div className="relative z-10 w-full max-w-2xl bg-background border rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <div>
                <div className="font-semibold">Day {promptDay.day}: {promptDay.title}</div>
                <div className="text-xs text-muted-foreground">{promptDay.focus}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                  className={copied ? "text-emerald-600 border-emerald-300" : ""}
                >
                  {copied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                  {copied ? "Copied!" : "Copy"}
                </Button>
                <button onClick={() => setPromptDay(null)} className="p-1.5 rounded hover:bg-accent text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Prompt text */}
            <pre className="flex-1 overflow-y-auto p-5 text-xs font-mono whitespace-pre-wrap text-foreground bg-muted/30">
              {buildPrompt(promptDay)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
