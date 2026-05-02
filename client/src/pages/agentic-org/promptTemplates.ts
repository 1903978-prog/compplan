// ─── Phase 1 — Prompt templates + parser ───────────────────────────────────
// Two prompt generators (Cowork + Claude Code) and one parser for the
// structured Cowork output. Reasoning: these MUST live in their own
// module so future phases can swap templates / add validators without
// touching page code.

export interface AgentLite {
  id: number;
  name: string;
  mission: string | null;
  status: string;
  boss_id: number | null;
  app_sections_assigned: string | null;
}
export interface ObjectiveLite { id: number; agent_id: number; title: string; status: string; }
export interface IdeaLite      { id: number; agent_id: number; title: string; total_score: number | null; status: string; created_at: string; }
export interface TaskLite      { id: number; agent_id: number; title: string; deadline: string | null; status: string; approval_level: string; approval_status: string; }
export interface ConflictLite  { id: number; title: string; severity: string | null; status: string; }

// App-section data shapes (fetched client-side for the 8am prompt)
export interface BdDeal        { name: string; client_name: string | null; stage: string | null; amount: number | null; probability: number | null; close_date: string | null; currency: string | null; }
export interface ProposalLite  { project_name: string; client_name: string | null; outcome: string | null; total_fee?: number | null; net_total?: number | null; weekly_price?: number | null; duration_weeks?: number | null; win_probability: number | null; loss_reason: string | null; }
export interface InvoiceLite   { client_name: string | null; due_amount: number | null; due_date: string | null; state: string | null; currency: string | null; }
export interface WonProjectLite{ project_name: string; client_name: string | null; status: string | null; start_date: string | null; end_date: string | null; total_amount: number | null; currency: string | null; }
export interface HiringStage   { stage: string; count: number; }
export interface CrossAlert    { agent: string; severity: "high" | "medium" | "low"; text: string; }
export interface SectionMapEntry { module: string; section: string; subsection: string; frequency: string; why: string; }

// Returns true if a section with the given frequency should be read on the given date.
function shouldReadToday(frequency: string, date: string): boolean {
  if (frequency === "Daily") return true;
  if (frequency === "Triggered") return false;
  const d = new Date(date + "T00:00:00");
  if (frequency === "Weekly") return d.getDay() === 1; // Monday
  if (frequency === "Monthly") return d.getDate() === 1;
  if (frequency === "Quarterly") {
    return d.getDate() === 1 && [0, 3, 6, 9].includes(d.getMonth()); // Jan/Apr/Jul/Oct
  }
  return false;
}

function eur(n: number | null, ccy?: string | null) {
  return n == null ? "?" : `${ccy ?? "€"}${Math.round(n).toLocaleString("en")}`;
}

// ── Cowork prompt: business reasoning, executive synthesis ─────────────────
export function buildCoworkPrompt(input: {
  date: string;
  agents: AgentLite[];
  objectives: ObjectiveLite[];
  openTasks: TaskLite[];
  overdueTasks: TaskLite[];
  recentIdeasByAgent: Map<number, IdeaLite[]>;
  openConflicts: ConflictLite[];
  // App-section enrichment (optional — falls back to AIOS-only if absent)
  bdDeals?: BdDeal[];
  recentProposals?: ProposalLite[];
  openInvoices?: InvoiceLite[];
  wonProjects?: WonProjectLite[];
  hiringByStage?: HiringStage[];
  employeeCount?: number;
  alerts?: CrossAlert[];
  // Agent ↔ section map: keyed by agent name → sections to read today
  agentSections?: Map<string, SectionMapEntry[]>;
}): string {
  const lines: string[] = [];
  lines.push(`# Eendigo Daily CEO Brief — ${input.date}`);
  lines.push("");
  lines.push("You are the CEO of Eendigo, a boutique management consulting firm. This brief is compiled from the live state of every section of the company. Study each agent's section, synthesise across them, and respond with concrete decisions.");
  lines.push("");

  // ── Cross-agent alerts ────────────────────────────────────────────────
  if (input.alerts && input.alerts.length > 0) {
    lines.push("## 🚨 Cross-agent alerts");
    for (const a of input.alerts)
      lines.push(`- **[${a.severity.toUpperCase()}] ${a.agent}**: ${a.text}`);
    lines.push("");
  }

  // ── SVP Sales / BD ───────────────────────────────────────────────────
  if (input.bdDeals) {
    lines.push("## SVP Sales / BD — Pipeline");
    if (input.bdDeals.length === 0) {
      lines.push("(no deals in CRM)");
    } else {
      const weighted = input.bdDeals.reduce((s, d) => s + (d.amount ?? 0) * ((d.probability ?? 0) / 100), 0);
      const highProb = input.bdDeals.filter(d => (d.probability ?? 0) >= 60);
      lines.push(`Deals: ${input.bdDeals.length} · Weighted pipeline: ${eur(weighted)} · High-prob (≥60%): ${highProb.length}`);
      for (const d of input.bdDeals.slice(0, 10))
        lines.push(`- **${d.name}** (${d.client_name ?? "?"}) — ${d.stage ?? "?"} · ${eur(d.amount, d.currency)} · ${d.probability ?? "?"}% · close ${d.close_date ?? "?"}`);
      if (input.bdDeals.length > 10) lines.push(`  … and ${input.bdDeals.length - 10} more`);
    }
    lines.push("");
    if (input.recentProposals && input.recentProposals.length > 0) {
      lines.push("### Recent proposals");
      const won  = input.recentProposals.filter(p => p.outcome === "won").length;
      const lost = input.recentProposals.filter(p => p.outcome === "lost").length;
      lines.push(`Won: ${won} · Lost: ${lost} · Open: ${input.recentProposals.length - won - lost}`);
      for (const p of input.recentProposals.slice(0, 8)) {
        const loss = p.loss_reason ? ` · loss: ${p.loss_reason}` : "";
        // net_total = weekly_price × weeks (set by ensureTbdProposalForFinalCase = NET1 × weeks).
        // Falls back to total_fee for legacy rows without weekly_price sync.
        const netVal = p.net_total ?? (p.weekly_price && p.duration_weeks ? p.weekly_price * p.duration_weeks : (p.total_fee ?? null));
        lines.push(`- ${p.project_name} (${p.client_name ?? "?"}) — ${p.outcome ?? "open"} · ${eur(netVal)}${p.win_probability != null ? ` · ${p.win_probability}% prob` : ""}${loss}`);
      }
      lines.push("");
    }
  }

  // ── CFO ──────────────────────────────────────────────────────────────
  if (input.openInvoices) {
    lines.push("## CFO — Invoices & Revenue");
    const overdueInv = input.openInvoices.filter(i => i.due_date && i.due_date < input.date && i.state !== "paid");
    const dueInv     = input.openInvoices.filter(i => i.due_date && i.due_date >= input.date && i.state !== "paid");
    lines.push(`Overdue: ${overdueInv.length} · ${eur(overdueInv.reduce((s, i) => s + (i.due_amount ?? 0), 0))} | Due soon: ${dueInv.length} · ${eur(dueInv.reduce((s, i) => s + (i.due_amount ?? 0), 0))}`);
    for (const i of overdueInv.slice(0, 5))
      lines.push(`  - ${i.client_name ?? "?"} · ${eur(i.due_amount, i.currency)} overdue since ${i.due_date}`);
    if (input.wonProjects) {
      const activeRev = input.wonProjects.filter(p => p.status === "active").reduce((s, p) => s + (p.total_amount ?? 0), 0);
      lines.push(`Active project revenue: ${eur(activeRev)}`);
    }
    lines.push("");
  }

  // ── CHRO ─────────────────────────────────────────────────────────────
  if (input.hiringByStage) {
    lines.push("## CHRO — Hiring & Headcount");
    if (input.employeeCount != null) lines.push(`Headcount: ${input.employeeCount} employees`);
    if (input.hiringByStage.length === 0) {
      lines.push("No candidates in pipeline.");
    } else {
      lines.push("Hiring pipeline:");
      for (const s of input.hiringByStage) lines.push(`  - ${s.stage}: ${s.count}`);
      const lateCount = input.hiringByStage.filter(s => /case|lm|final|offer/i.test(s.stage)).reduce((n, s) => n + s.count, 0);
      if (lateCount > 0) lines.push(`  → ${lateCount} in late stages — offer decisions possible this week`);
    }
    lines.push("");
  }

  // ── COO / Delivery ───────────────────────────────────────────────────
  if (input.wonProjects) {
    const active = input.wonProjects.filter(p => p.status === "active");
    if (active.length > 0) {
      const in45d = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
      lines.push("## COO / Delivery — Active Projects");
      lines.push(`Active: ${active.length} · Ending within 45 days: ${active.filter(p => p.end_date && p.end_date <= in45d).length}`);
      for (const p of active)
        lines.push(`  - ${p.project_name} (${p.client_name ?? "?"}) · ${eur(p.total_amount)} · ends ${p.end_date ?? "?"}`);
      lines.push("");
    }
  }

  // ── AIOS agent tasks & ideas ─────────────────────────────────────────
  lines.push("## Atlas — Agent tasks & ideas");
  for (const a of input.agents) {
    const ideas = (input.recentIdeasByAgent.get(a.id) ?? []).slice(0, 3);
    const tasks = input.openTasks.filter(t => t.agent_id === a.id).slice(0, 3);
    const sections = input.agentSections?.get(a.name)?.filter(s => shouldReadToday(s.frequency, input.date)) ?? [];
    if (ideas.length === 0 && tasks.length === 0 && sections.length === 0) continue;
    lines.push(`### ${a.name}`);
    if (sections.length > 0) {
      lines.push("Sections to read today:");
      for (const s of sections) lines.push(`  - [${s.frequency}] ${s.module} › ${s.section} › ${s.subsection}${s.why ? ` — ${s.why}` : ""}`);
    }
    if (ideas.length > 0) {
      lines.push("Ideas:");
      for (const i of ideas) lines.push(`  - [${i.status}] ${i.title} (score=${i.total_score ?? "—"})`);
    }
    if (tasks.length > 0) {
      lines.push("Tasks:");
      for (const t of tasks) lines.push(`  - [${t.approval_status}] ${t.title}${t.deadline ? ` due ${t.deadline}` : ""}`);
    }
  }
  if (input.overdueTasks.length > 0) {
    lines.push("### ⚠ Overdue agent tasks");
    for (const t of input.overdueTasks) {
      const agentName = input.agents.find(a => a.id === t.agent_id)?.name ?? "?";
      lines.push(`  - ${agentName}: ${t.title} (was due ${t.deadline})`);
    }
  }
  lines.push("");

  // ── Agent maturity scorecard ──────────────────────────────────────────
  // Deliverables = open tasks + ideas + objectives. Target: ≥ 9 per agent.
  // Agents below threshold are flagged for COO development planning.
  lines.push("## Agent maturity — deliverable scorecard");
  lines.push("Target: each agent must have ≥ 9 active deliverables (open tasks + ideas + objectives combined).");
  lines.push("Agents below threshold require a COO development plan (see mandate below).");
  lines.push("");
  const DELIVERABLE_THRESHOLD = 9;
  const underperforming: string[] = [];
  for (const a of input.agents) {
    const objCount  = input.objectives.filter(o => o.agent_id === a.id).length;
    const taskCount = input.openTasks.filter(t => t.agent_id === a.id).length;
    const ideaCount = (input.recentIdeasByAgent.get(a.id) ?? []).length;
    const total     = objCount + taskCount + ideaCount;
    const flag      = total < DELIVERABLE_THRESHOLD ? " ⚠ BELOW THRESHOLD" : "";
    lines.push(`- **${a.name}**: objectives=${objCount} · tasks=${taskCount} · ideas=${ideaCount} → total=${total}${flag}`);
    if (total < DELIVERABLE_THRESHOLD) underperforming.push(a.name);
  }
  if (underperforming.length === 0) {
    lines.push("✅ All agents meet the 9-deliverable threshold.");
  } else {
    lines.push("");
    lines.push(`⚠️ Agents below threshold: ${underperforming.join(", ")}`);
    lines.push("COO must produce a development plan for each (see mandate).");
  }
  lines.push("");

  // Conflicts
  if (input.openConflicts.length > 0) {
    lines.push("## Open conflicts");
    for (const c of input.openConflicts) lines.push(`- [${c.severity ?? "?"}] ${c.title}`);
    lines.push("");
  }

  // Mandate
  lines.push("## Your mandate");
  lines.push("Study the full brief above. For **each agent**, propose **3 ideas** and **3 actions** for today. Each must:");
  lines.push("- Be grounded in the specific data shown for that agent's section above.");
  lines.push("- Link to one objective the agent already owns (or `none` if meta-task).");
  lines.push("- Carry an explicit approval level: `autonomous` | `boss` | `ceo` | `livio`.");
  lines.push("- Include impact / effort / risk on a 0-100 scale.");
  lines.push("- Prioritise items whose absence would cost EBITDA, cash, reputation, or capacity in the next 30 days.");
  lines.push("");
  lines.push("**Cross-agent reasoning required**: if high-probability deals would overwhelm delivery capacity, alert CHRO. If projects end with no follow-on in pipeline, alert SVP Sales. If invoices are overdue > 30 days, escalate to CFO.");
  lines.push("");
  lines.push("**Agent development (COO mandate)**: For every agent listed as ⚠ BELOW THRESHOLD in the maturity scorecard above, the COO must immediately produce a structured development plan that covers: (1) **Knowledge expansion** — identify missing knowledge notes and create at least 3 new knowledge items covering the agent's domain and responsibilities; (2) **Mission & objectives improvement** — rewrite the agent's mission to be more specific and measurable, and add at least 3 new objectives aligned to company OKRs; (3) **Process creation** — define at least 3 repeatable processes or playbooks the agent must follow. Surface each development plan as an ACTION block with AGENT: COO and APPROVAL_LEVEL: boss.");
  lines.push("");
  lines.push("Detect any conflicts (incompatible actions, resource collisions, pricing/margin tension) and surface them as `TYPE: conflict` blocks.");
  lines.push("");

  // Structured output contract — MUST be last
  lines.push("---");
  lines.push("");
  lines.push("Return your answer ONLY in the following format. One block per decision, separated by '---'. Do not add prose before or after.");
  lines.push("");
  lines.push("DECISION_ID: <unique id>");
  lines.push("TYPE: idea | action | conflict | proposal");
  lines.push("AGENT: <agent name>");
  lines.push("TITLE: <short>");
  lines.push("DESCRIPTION: <one sentence>");
  lines.push("OKR_LINK: <objective id or 'none'>");
  lines.push("DEADLINE: <YYYY-MM-DD or 'none'>");
  lines.push("APPROVAL_LEVEL: autonomous | boss | ceo | livio");
  lines.push("IMPACT: 0-100");
  lines.push("EFFORT: 0-100");
  lines.push("RISK: 0-100");
  return lines.join("\n");
}

// ── Claude Code prompt: app/code changes ───────────────────────────────────
export function buildClaudeCodePrompt(input: {
  date: string;
  approvedAgentChanges: AgentLite[];
  pendingAppChanges: string[];
  raciGaps: string[];
}): string {
  const lines: string[] = [];
  lines.push(`# Eendigo Claude Code Work Package — ${input.date}`);
  lines.push("");
  lines.push("You are working in the existing compplan repo. Apply the following changes only — do not refactor anything else, do not break existing functionality.");
  lines.push("");

  if (input.approvedAgentChanges.length > 0) {
    lines.push("## Approved agent changes");
    for (const a of input.approvedAgentChanges) {
      lines.push(`### ${a.name}`);
      if (a.mission) lines.push(`Mission: ${a.mission}`);
      if (a.app_sections_assigned) lines.push(`App sections: ${a.app_sections_assigned}`);
      lines.push("");
    }
  } else {
    lines.push("## Approved agent changes\n(none)\n");
  }

  if (input.pendingAppChanges.length > 0) {
    lines.push("## App changes pending");
    for (const c of input.pendingAppChanges) lines.push(`- ${c}`);
    lines.push("");
  }

  if (input.raciGaps.length > 0) {
    lines.push("## RACI gaps to fill");
    for (const g of input.raciGaps) lines.push(`- ${g}`);
    lines.push("");
  }

  lines.push("## Output contract");
  lines.push("- Make the smallest possible diff that achieves the change.");
  lines.push("- Preserve existing API contracts.");
  lines.push("- Add idempotent migrations for any new columns / tables.");
  lines.push("- Build verified locally before commit.");
  lines.push("- Report back with a one-paragraph summary of what changed and how to test it.");
  return lines.join("\n");
}

// ── Parser for Cowork output ──────────────────────────────────────────────
// Splits on '---' (line of dashes), reads each key:value pair, validates,
// and returns parsed records with a normalised type. Skips malformed blocks
// but reports them so the user knows what was dropped.

export interface ParsedDecision {
  decision_id: string;
  type: "idea" | "action" | "conflict" | "proposal";
  agent_name: string;
  title: string;
  description: string;
  okr_link: number | null;
  deadline: string | null;
  approval_level: "autonomous" | "boss" | "ceo" | "livio";
  impact: number | null;
  effort: number | null;
  risk: number | null;
  total_score: number | null;
}

export interface ParseResult {
  decisions: ParsedDecision[];
  errors: { block: string; reason: string }[];
}

function readField(block: string, key: string): string | null {
  const rx = new RegExp(`^${key}:\\s*(.*)$`, "im");
  const m = block.match(rx);
  return m ? m[1].trim() : null;
}

export function parseCoworkOutput(raw: string): ParseResult {
  const decisions: ParsedDecision[] = [];
  const errors: { block: string; reason: string }[] = [];
  // Split on lines of three or more dashes (the output contract uses '---').
  const blocks = raw.split(/^\s*-{3,}\s*$/m).map(b => b.trim()).filter(Boolean);

  for (const block of blocks) {
    const decision_id = readField(block, "DECISION_ID");
    const typeRaw     = readField(block, "TYPE");
    const agent_name  = readField(block, "AGENT");
    const title       = readField(block, "TITLE");
    if (!decision_id || !typeRaw || !agent_name || !title) {
      errors.push({ block: block.slice(0, 80), reason: "Missing one of DECISION_ID / TYPE / AGENT / TITLE" });
      continue;
    }
    const type = typeRaw.toLowerCase().trim() as ParsedDecision["type"];
    if (!["idea", "action", "conflict", "proposal"].includes(type)) {
      errors.push({ block: block.slice(0, 80), reason: `Invalid TYPE: ${typeRaw}` });
      continue;
    }
    const description = readField(block, "DESCRIPTION") ?? "";
    const okrRaw = readField(block, "OKR_LINK");
    const okr_link = okrRaw && okrRaw.toLowerCase() !== "none" && /^\d+$/.test(okrRaw)
      ? parseInt(okrRaw, 10) : null;
    const deadlineRaw = readField(block, "DEADLINE");
    const deadline = deadlineRaw && deadlineRaw.toLowerCase() !== "none" ? deadlineRaw : null;

    const approvalRaw = (readField(block, "APPROVAL_LEVEL") ?? "autonomous").toLowerCase().trim();
    const approval_level = (["autonomous", "boss", "ceo", "livio"].includes(approvalRaw)
      ? approvalRaw : "autonomous") as ParsedDecision["approval_level"];

    const num = (v: string | null) => {
      if (!v) return null;
      const n = parseFloat(v);
      return isFinite(n) ? Math.round(n) : null;
    };
    const impact = num(readField(block, "IMPACT"));
    const effort = num(readField(block, "EFFORT"));
    const risk   = num(readField(block, "RISK"));
    const total_score = (impact != null)
      ? Math.max(0, Math.min(100, Math.round(impact - (effort ?? 0) / 2 - (risk ?? 0) / 2)))
      : null;

    decisions.push({
      decision_id, type, agent_name, title, description,
      okr_link, deadline, approval_level,
      impact, effort, risk, total_score,
    });
  }
  return { decisions, errors };
}

// ── Weekly Executive Committee prompt ────────────────────────────────────────
// Cross-agent reasoning: each agent shares status, dependencies, conflicts,
// and resource needs. CEO consolidates and decides what to escalate to Livio.

export interface CommitteeInput {
  date: string;
  agents: AgentLite[];
  objectives: ObjectiveLite[];
  ideas: IdeaLite[];
  tasks: TaskLite[];
  conflicts: ConflictLite[];
}

export function buildCommitteePrompt(d: CommitteeInput): string {
  const eur = (n: number | null) => n != null ? `€${Math.round(n).toLocaleString()}` : "—";

  const agentSummary = d.agents.map(a => {
    const objs = d.objectives.filter(o => o.agent_id === a.id);
    const openTasks = d.tasks.filter(t => t.agent_id === a.id && (t.status === "open" || t.status === "in_progress"));
    const pendingApprovals = d.tasks.filter(t => t.agent_id === a.id && t.approval_status === "pending");
    const topIdeas = d.ideas.filter(i => i.agent_id === a.id && i.status === "proposed")
      .sort((a2, b) => (b.total_score ?? 0) - (a2.total_score ?? 0)).slice(0, 3);
    return [
      `### ${a.name} (${a.status})`,
      objs.length > 0 ? `Objectives: ${objs.map(o => o.title).join(" · ")}` : "No objectives set.",
      openTasks.length > 0 ? `Open tasks (${openTasks.length}): ${openTasks.slice(0, 5).map(t => t.title).join(" · ")}` : "No open tasks.",
      pendingApprovals.length > 0 ? `⚠️ Pending approvals: ${pendingApprovals.map(t => `${t.title} [${t.approval_level}]`).join(" · ")}` : "",
      topIdeas.length > 0 ? `Top ideas: ${topIdeas.map(i => `${i.title} (score ${i.total_score ?? "?"} )`).join(" · ")}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  const conflictBlock = d.conflicts.filter(c => c.status !== "resolved").length > 0
    ? "## Open conflicts\n" + d.conflicts.filter(c => c.status !== "resolved")
        .map(c => `- [${c.severity ?? "?"}] ${c.title} (${c.status})`).join("\n")
    : "## Open conflicts\nNone.";

  const overdueCount = d.tasks.filter(t => t.deadline && t.deadline < d.date && t.status !== "done").length;

  return `# Atlas Weekly Executive Committee — ${d.date}

You are running a structured weekly Executive Committee for Eendigo's AI agent organisation. Every agent briefly shares: (1) status vs their objectives, (2) main tasks in flight, (3) cross-agent dependencies or resource needs, (4) ideas they want to propose, (5) decisions they need from a boss or Livio.

The CEO synthesises the inputs, detects cross-functional conflicts, identifies the 3 most important company-level decisions to make this week, and prepares a recommendation pack for Livio.

## Live state summary
Date: ${d.date}
Agents: ${d.agents.length} | Open tasks: ${d.tasks.filter(t => t.status === "open" || t.status === "in_progress").length} | Overdue: ${overdueCount} | Pending approvals: ${d.tasks.filter(t => t.approval_status === "pending").length}

## Agent status round-table

${agentSummary}

${conflictBlock}

## Committee agenda
1. Each agent: status on objectives, blockers, cross-agent dependencies.
2. Resource conflicts: who needs what from whom, in which timeframe.
3. Top 3 ideas to advance this week — selected by CEO from all agent proposals.
4. Top 3 decisions required from Livio this week.
5. Action assignments with deadlines and approval levels.

## Output format
Return ONLY structured blocks separated by '---'. One block per decision.

DECISION_ID: WEC-${d.date}-01
TYPE: idea | action | conflict | proposal
AGENT: <agent name>
TITLE: <short title>
DESCRIPTION: <one sentence>
OKR_LINK: <objective id or none>
DEADLINE: <YYYY-MM-DD or none>
APPROVAL_LEVEL: autonomous | boss | ceo | livio
IMPACT: 0-100
EFFORT: 0-100
RISK: 0-100`;
}

// ── Monthly Board Meeting prompt ─────────────────────────────────────────────
// Full monthly review: OKRs, EBITDA tree, pipeline, cash, agent performance,
// strategic priorities. Participants: Livio + all C-suite agents.

export interface BoardMeetingInput {
  date: string;
  agents: AgentLite[];
  objectives: ObjectiveLite[];
  tasks: TaskLite[];
  conflicts: ConflictLite[];
  ideas: IdeaLite[];
  proposals: ProposalLite[];
  invoices: InvoiceLite[];
}

export function buildBoardMeetingPrompt(d: BoardMeetingInput): string {
  const openConflicts = d.conflicts.filter(c => c.status !== "resolved");
  const pendingApprovals = d.tasks.filter(t => t.approval_status === "pending");
  const highApprovals = pendingApprovals.filter(t => t.approval_level === "livio");

  const won = d.proposals.filter(p => p.outcome === "won");
  const lost = d.proposals.filter(p => p.outcome === "lost");
  const tbd = d.proposals.filter(p => !p.outcome || p.outcome === "pending");

  const overdue = d.invoices.filter(i => i.due_date && i.due_date < d.date && i.state !== "paid");

  const agentOKRBlock = d.agents.map(a => {
    const objs = d.objectives.filter(o => o.agent_id === a.id);
    const doneTasks = d.tasks.filter(t => t.agent_id === a.id && t.status === "done").length;
    const allTasks = d.tasks.filter(t => t.agent_id === a.id).length;
    const topIdea = d.ideas.filter(i => i.agent_id === a.id && i.status === "proposed")
      .sort((a2, b) => (b.total_score ?? 0) - (a2.total_score ?? 0))[0];
    return `${a.name}: ${objs.length} objectives | ${doneTasks}/${allTasks} tasks done${topIdea ? ` | Top idea: "${topIdea.title}"` : ""}`;
  }).join("\n");

  return `# Atlas Monthly Board Meeting — ${d.date}

You are running the monthly Board Meeting for Eendigo's AI-powered consulting firm. Participants: Livio (Chair), CEO, COO, CFO, CHRO, CMO, SVP Sales.

The Board reviews: (1) company OKR progress, (2) EBITDA issue tree health, (3) pipeline and staffing, (4) cash collection, (5) agent performance, (6) major decisions requiring Livio approval, (7) strategic priorities for next month.

## Company snapshot — ${d.date}

**Commercial pipeline**
- Won (last period): ${won.length} engagements
- Lost: ${lost.length} | Pending: ${tbd.length}

**Cash & AR**
- Overdue invoices: ${overdue.length}

**Agent performance**
${agentOKRBlock}

**Open conflicts requiring resolution: ${openConflicts.length}**
${openConflicts.map(c => `- [${c.severity}] ${c.title}`).join("\n") || "None."}

**Decisions requiring Livio approval: ${highApprovals.length}**
${highApprovals.slice(0, 10).map(t => `- ${t.title} (${t.deadline ?? "no deadline"})`).join("\n") || "None."}

## Board agenda
1. OKR review: which objectives are on-track, at-risk, or failed?
2. EBITDA issue tree: which branches are improving, which are deteriorating?
3. Pipeline: conversion, pricing, capacity. Are we on track for revenue targets?
4. Staffing: hiring needs, churn risk, agent re-training needs.
5. Cash: overdue invoices, payment escalations, cash runway.
6. Agent governance: hire/fire/merge/retrain any agents?
7. Strategic priorities for next month: top 3 actions for the company.
8. Approval pack: all Livio-level decisions pending.

## Output format
Return ONLY structured blocks separated by '---'. One block per decision.

DECISION_ID: BM-${d.date}-01
TYPE: idea | action | conflict | proposal
AGENT: <agent name>
TITLE: <short title>
DESCRIPTION: <one sentence>
OKR_LINK: <objective id or none>
DEADLINE: <YYYY-MM-DD or none>
APPROVAL_LEVEL: autonomous | boss | ceo | livio
IMPACT: 0-100
EFFORT: 0-100
RISK: 0-100`;
}
