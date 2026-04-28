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

// ── Cowork prompt: business reasoning, executive synthesis ─────────────────
export function buildCoworkPrompt(input: {
  date: string;
  agents: AgentLite[];
  objectives: ObjectiveLite[];
  openTasks: TaskLite[];
  overdueTasks: TaskLite[];
  recentIdeasByAgent: Map<number, IdeaLite[]>;
  openConflicts: ConflictLite[];
}): string {
  const lines: string[] = [];
  lines.push(`# Eendigo Daily CEO Brief — ${input.date}`);
  lines.push("");
  lines.push("You are the CEO of a small consulting firm. Your direct reports (8 agents) need a daily synthesis. Below is the live state of the company.");
  lines.push("");

  // Agents + missions
  lines.push("## Agents");
  for (const a of input.agents) {
    const okrCount = input.objectives.filter(o => o.agent_id === a.id).length;
    lines.push(`- **${a.name}** (${a.status}) — ${a.mission ?? "(no mission yet)"} · ${okrCount} objectives`);
  }
  lines.push("");

  // Recent ideas
  lines.push("## Recent ideas (top 5 per agent)");
  for (const a of input.agents) {
    const ideas = (input.recentIdeasByAgent.get(a.id) ?? []).slice(0, 5);
    if (ideas.length === 0) continue;
    lines.push(`### ${a.name}`);
    for (const i of ideas) lines.push(`- [${i.status}] ${i.title} (score=${i.total_score ?? "—"})`);
  }
  lines.push("");

  // Open tasks
  lines.push("## Open tasks");
  if (input.openTasks.length === 0) lines.push("(none)");
  for (const t of input.openTasks) {
    const agentName = input.agents.find(a => a.id === t.agent_id)?.name ?? "?";
    lines.push(`- [${t.approval_status}] ${agentName}: ${t.title}${t.deadline ? ` (due ${t.deadline})` : ""}`);
  }
  lines.push("");

  // Overdue
  if (input.overdueTasks.length > 0) {
    lines.push("## ⚠ Overdue tasks");
    for (const t of input.overdueTasks) {
      const agentName = input.agents.find(a => a.id === t.agent_id)?.name ?? "?";
      lines.push(`- ${agentName}: ${t.title} (was due ${t.deadline})`);
    }
    lines.push("");
  }

  // Conflicts
  lines.push("## Open conflicts");
  if (input.openConflicts.length === 0) lines.push("(none)");
  for (const c of input.openConflicts) {
    lines.push(`- [${c.severity ?? "?"}] ${c.title}`);
  }
  lines.push("");

  // Mandate
  lines.push("## Your mandate");
  lines.push("For each agent, propose **3 ideas** and **3 actions** for today. Each must:");
  lines.push("- link to one objective the agent already owns (or `none` if it's a meta-task)");
  lines.push("- carry an explicit approval level: `autonomous` | `boss` | `ceo` | `livio`");
  lines.push("- include impact / effort / risk on a 0-100 scale");
  lines.push("- prioritise actions whose absence would cost EBITDA, cash, reputation, or capacity in the next 30 days");
  lines.push("");
  lines.push("Detect any conflicts (two agents proposing incompatible actions; resource collisions; pricing vs margin tension) and surface them as `TYPE: conflict` blocks.");
  lines.push("");

  // The structured-output contract — MUST be the last thing in the prompt
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
