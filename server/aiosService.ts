/**
 * AIOS Daily Cycle Service
 * Orchestrates the full "8am — Start AIOS" round 1 process.
 */
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db.js";
import { sql, eq, and } from "drizzle-orm";
import {
  agents as agentsTable,
  objectives,
  tasks,
  conflicts as conflictsTable,
  agentSectionMap,
  agentKnowledge,
  aiosCycles,
  aiosExecLogs,
  aiosDeliverables,
  bossConsolidations,
  ceoBriefs,
  coworkOutputs,
  coworkLetters,
} from "../shared/schema.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── In-memory event bus for SSE streaming ────────────────────────────────────
// Maps cycleId → array of SSE subscribers (response objects)
const cycleSubscribers = new Map<number, Set<any>>();

export function subscribeToCycle(cycleId: number, res: any) {
  if (!cycleSubscribers.has(cycleId)) cycleSubscribers.set(cycleId, new Set());
  cycleSubscribers.get(cycleId)!.add(res);
}
export function unsubscribeFromCycle(cycleId: number, res: any) {
  cycleSubscribers.get(cycleId)?.delete(res);
}

function pushSSE(cycleId: number, data: object) {
  const subs = cycleSubscribers.get(cycleId);
  if (!subs || subs.size === 0) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  Array.from(subs).forEach(res => {
    try { res.write(msg); } catch { subs.delete(res); }
  });
}

// ── Logging helper ────────────────────────────────────────────────────────────
async function log(
  cycleId: number,
  actorType: string,
  actorName: string | null,
  actionType: string,
  message: string,
  status: "working" | "completed" | "warning" | "blocked" | "failed" = "working",
  severity: "info" | "warning" | "critical" = "info",
  metadata?: object
) {
  const now = new Date().toISOString();
  const row = {
    cycle_id: cycleId,
    timestamp: now,
    actor_type: actorType,
    actor_name: actorName,
    action_type: actionType,
    message,
    status,
    severity,
    metadata: metadata as any,
    created_at: now,
  };
  await db.insert(aiosExecLogs).values(row as any);
  pushSSE(cycleId, { type: "log", ...row });
}

// ── Claude helper ─────────────────────────────────────────────────────────────
async function askClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return (msg.content[0] as any).text ?? "";
}

// ── Create a new AIOS cycle ───────────────────────────────────────────────────
export async function createAiosCycle(startedBy = "President"): Promise<number> {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const [row] = await db.insert(aiosCycles).values({
    cycle_date: today,
    cycle_type: "daily",
    status: "not_started",
    started_by: startedBy,
    created_at: now,
    updated_at: now,
  } as any).returning();
  return row.id;
}

// ── Pause / resume ────────────────────────────────────────────────────────────
export async function pauseAiosCycle(cycleId: number) {
  const now = new Date().toISOString();
  await db.update(aiosCycles).set({ status: "paused", updated_at: now } as any).where(eq(aiosCycles.id, cycleId));
  await log(cycleId, "system", null, "cycle_paused", "Cycle paused by President.", "completed", "info");
  pushSSE(cycleId, { type: "status", status: "paused" });
}
export async function resumeAiosCycle(cycleId: number) {
  const now = new Date().toISOString();
  await db.update(aiosCycles).set({ status: "running", updated_at: now } as any).where(eq(aiosCycles.id, cycleId));
  await log(cycleId, "system", null, "cycle_resumed", "Cycle resumed by President.", "working", "info");
  pushSSE(cycleId, { type: "status", status: "running" });
}

// ── Main orchestration ────────────────────────────────────────────────────────
export async function runDailyAiosCycle(cycleId: number): Promise<void> {
  const now = () => new Date().toISOString();
  try {
    // Mark running
    await db.update(aiosCycles).set({ status: "running", started_at: now(), updated_at: now() } as any).where(eq(aiosCycles.id, cycleId));
    await log(cycleId, "system", null, "cycle_started", "AIOS Daily Cycle started.", "working", "info");

    // Load all active agents
    const allAgents = await db.select().from(agentsTable);
    const activeAgents = allAgents.filter(a => a.status === "active" || a.status === "working");
    await log(cycleId, "system", null, "agents_loaded", `Loaded ${activeAgents.length} active agents.`, "completed", "info");

    // Load section map
    const sectionMap = await db.select().from(agentSectionMap);
    await log(cycleId, "system", null, "section_map_loaded", `Loaded ${sectionMap.length} agent-section assignments.`, "completed", "info");

    // Load all objectives + tasks
    const allObjectives = await db.select().from(objectives);
    const allTasks = await db.select().from(tasks);
    const allKnowledge = await db.select().from(agentKnowledge);

    // Process each agent
    let totalInsights = 0, totalIdeas = 0, totalActions = 0, totalCowork = 0;
    let agentsProcessed = 0;

    // Process all agents (Claude generates per agent), then consolidate
    for (const agent of activeAgents) {
      await log(cycleId, "agent", agent.name, "agent_started", `${agent.name} starting daily work.`, "working", "info");

      // Check for pause
      const [cycleRow] = await db.select().from(aiosCycles).where(eq(aiosCycles.id, cycleId));
      if (cycleRow?.status === "paused") {
        await log(cycleId, "system", null, "cycle_paused_mid", "Cycle paused mid-execution.", "warning", "warning");
        return; // stop processing; can be resumed
      }

      const agentObjectives = allObjectives.filter(o => o.agent_id === agent.id);
      const agentTasks = allTasks.filter(t => t.agent_id === agent.id);
      const agentSections = sectionMap.filter(sm =>
        sm.primary_agent.toLowerCase().includes(agent.name.toLowerCase().split(" ")[0]) ||
        agent.name.toLowerCase().includes(sm.primary_agent.toLowerCase().split(" ")[0])
      );
      const agentKb = allKnowledge.filter(k =>
        k.role_key && agent.name.toLowerCase().includes(k.role_key.toLowerCase().replace(/-/g, " ").split(" ")[0])
      );

      // Log reading steps
      if ((agent as any).job_description) {
        await log(cycleId, "agent", agent.name, "read_job_description", `${agent.name} reviewed job description.`, "completed", "info");
      } else {
        await log(cycleId, "agent", agent.name, "missing_job_description", `${agent.name} has no job description. Using function_area fallback.`, "warning", "warning");
      }
      if (agentKb.length > 0) {
        await log(cycleId, "agent", agent.name, "read_knowledge_base", `${agent.name} reviewed ${agentKb.length} knowledge base items.`, "completed", "info");
      } else {
        await log(cycleId, "agent", agent.name, "missing_knowledge_base", `${agent.name} has no knowledge base items.`, "warning", "warning");
      }
      if (agentSections.length > 0) {
        await log(cycleId, "agent", agent.name, "read_app_sections", `${agent.name} reviewing ${agentSections.length} assigned app sections.`, "working", "info");
      } else {
        await log(cycleId, "agent", agent.name, "missing_app_sections", `${agent.name} has no assigned app sections.`, "warning", "warning");
      }

      // Build context for this agent
      const agentContext = buildAgentContext(agent, agentObjectives, agentTasks, agentSections, agentKb);

      // Call Claude to generate deliverables
      const deliverables = await generateAgentDeliverables(cycleId, agent, agentContext);

      // Store deliverables
      for (const d of deliverables) {
        await db.insert(aiosDeliverables).values({
          cycle_id: cycleId,
          agent_id: agent.id,
          agent_name: agent.name,
          ...d,
          created_at: now(),
        } as any);
      }

      const insights = deliverables.filter(d => d.deliverable_type === "insight");
      const ideas = deliverables.filter(d => d.deliverable_type === "idea");
      const actions = deliverables.filter(d => d.deliverable_type === "action");
      const cowork = deliverables.filter(d => d.deliverable_type === "cowork_request");

      totalInsights += insights.length;
      totalIdeas += ideas.length;
      totalActions += actions.length;
      totalCowork += cowork.length;
      agentsProcessed++;

      await log(cycleId, "agent", agent.name, "agent_completed",
        `${agent.name} completed: ${insights.length} insights, ${ideas.length} ideas, ${actions.length} actions, ${cowork.length} CoWork requests.`,
        "completed", "info");

      // Update cycle counters
      await db.update(aiosCycles).set({
        agents_processed: agentsProcessed,
        sections_analyzed: totalInsights + totalIdeas + totalActions,
        insights_count: totalInsights,
        ideas_count: totalIdeas,
        actions_count: totalActions,
        cowork_requests_count: totalCowork,
        updated_at: now(),
      } as any).where(eq(aiosCycles.id, cycleId));
      pushSSE(cycleId, { type: "progress", agentsProcessed, total: activeAgents.length });
    }

    // Boss consolidation
    await log(cycleId, "system", null, "boss_consolidation_started", "Starting boss consolidation.", "working", "info");
    const bosses = activeAgents.filter(a => activeAgents.some(r => r.boss_id === a.id));
    for (const boss of bosses) {
      await runBossConsolidation(cycleId, boss, activeAgents);
    }

    // Conflict detection
    await log(cycleId, "system", null, "conflict_detection", "Detecting conflicts across agent outputs.", "working", "info");
    const detectedConflicts = await detectConflicts(cycleId, activeAgents);
    await db.update(aiosCycles).set({ conflicts_count: detectedConflicts, updated_at: now() } as any).where(eq(aiosCycles.id, cycleId));

    // CEO consolidation
    await log(cycleId, "ceo", "CEO", "ceo_consolidation_started", "CEO consolidating all outputs.", "working", "info");
    await runCeoConsolidation(cycleId, activeAgents);

    // Generate CoWork prompt
    await log(cycleId, "ceo", "CEO", "cowork_prompt_generating", "Generating comprehensive CoWork prompt.", "working", "info");
    await generateCoworkPrompt(cycleId, activeAgents);

    // Mark complete
    await db.update(aiosCycles).set({ status: "completed", completed_at: now(), updated_at: now() } as any).where(eq(aiosCycles.id, cycleId));
    await log(cycleId, "system", null, "cycle_completed", "AIOS Round 1 complete. CoWork prompt ready.", "completed", "info");
    pushSSE(cycleId, { type: "status", status: "completed" });

  } catch (err: any) {
    console.error("[AIOS] Cycle failed:", err);
    const now2 = new Date().toISOString();
    await db.update(aiosCycles).set({ status: "failed", updated_at: now2 } as any).where(eq(aiosCycles.id, cycleId));
    await log(cycleId, "system", null, "cycle_failed", `Cycle failed: ${err.message}`, "failed", "critical");
    pushSSE(cycleId, { type: "status", status: "failed", error: err.message });
  }
}

// ── Agent context builder ─────────────────────────────────────────────────────
function buildAgentContext(agent: any, agentObjectives: any[], agentTasks: any[], agentSections: any[], agentKb: any[]): string {
  const lines: string[] = [];
  lines.push(`# Agent: ${agent.name}`);
  if ((agent as any).role_title) lines.push(`Role: ${(agent as any).role_title}`);
  if (agent.mission) lines.push(`Mission: ${agent.mission}`);
  if ((agent as any).function_area) lines.push(`Function area: ${(agent as any).function_area}`);
  if ((agent as any).job_description) {
    lines.push(`\n## Job Description\n${(agent as any).job_description}`);
  }
  if (agent.decision_rights_autonomous) lines.push(`\nAutonomous decisions: ${agent.decision_rights_autonomous}`);
  if (agentObjectives.length > 0) {
    lines.push("\n## OKRs / Objectives");
    agentObjectives.forEach(o => lines.push(`- ${o.title} (${o.status})`));
  }
  if (agentTasks.length > 0) {
    lines.push("\n## Open Tasks");
    agentTasks.filter(t => t.status !== "done").slice(0, 10).forEach(t => lines.push(`- [${t.status}] ${t.title} (due: ${t.deadline ?? "no deadline"})`));
  }
  if (agentSections.length > 0) {
    lines.push("\n## Assigned App Sections (must analyze)");
    agentSections.forEach(s => lines.push(`- ${s.module} > ${s.section} > ${s.subsection} (${s.frequency})`));
  }
  if (agentKb.length > 0) {
    lines.push("\n## Knowledge Base");
    agentKb.slice(0, 5).forEach(k => lines.push(`- ${k.title ?? k.role_key}: ${(k.content ?? "").slice(0, 200)}`));
  }
  return lines.join("\n");
}

// ── Generate agent deliverables via Claude ───────────────────────────────────
async function generateAgentDeliverables(cycleId: number, agent: any, context: string): Promise<any[]> {
  const system = `You are ${agent.name}, an AI agent at Eendigo, an AI-powered management consulting firm.
You are executing your daily AIOS analysis cycle.
Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.`;

  const user = `${context}

Generate your 12 daily deliverables as JSON:
{
  "insights": [
    { "rank": 1, "title": "...", "description": "...", "source_app_section": "...", "okr_link": "...", "okr_relevance_score": 75, "business_impact_score": 80, "urgency_score": 60, "confidence_score": 70, "total_score": 72, "scoring_rationale": "..." },
    { "rank": 2, "title": "...", "description": "...", "source_app_section": "...", "okr_link": "...", "okr_relevance_score": 70, "business_impact_score": 75, "urgency_score": 55, "confidence_score": 65, "total_score": 67, "scoring_rationale": "..." },
    { "rank": 3, "title": "...", "description": "...", "source_app_section": "...", "okr_link": "...", "okr_relevance_score": 65, "business_impact_score": 70, "urgency_score": 50, "confidence_score": 60, "total_score": 62, "scoring_rationale": "..." }
  ],
  "ideas": [
    { "rank": 1, "title": "...", "description": "...", "okr_link": "...", "business_impact_score": 80, "feasibility_score": 70, "urgency_score": 65, "total_score": 73, "scoring_rationale": "...", "decision_right_level": "autonomous" },
    { "rank": 2, "title": "...", "description": "...", "okr_link": "...", "business_impact_score": 75, "feasibility_score": 65, "urgency_score": 60, "total_score": 68, "scoring_rationale": "...", "decision_right_level": "autonomous" },
    { "rank": 3, "title": "...", "description": "...", "okr_link": "...", "business_impact_score": 70, "feasibility_score": 60, "urgency_score": 55, "total_score": 63, "scoring_rationale": "...", "decision_right_level": "autonomous" }
  ],
  "actions": [
    { "rank": 1, "title": "...", "description": "...", "okr_link": "...", "urgency_score": 80, "business_impact_score": 75, "feasibility_score": 85, "total_score": 78, "scoring_rationale": "...", "decision_right_level": "autonomous", "deadline": "2026-05-07" },
    { "rank": 2, "title": "...", "description": "...", "okr_link": "...", "urgency_score": 75, "business_impact_score": 70, "feasibility_score": 80, "total_score": 73, "scoring_rationale": "...", "decision_right_level": "autonomous", "deadline": "2026-05-07" },
    { "rank": 3, "title": "...", "description": "...", "okr_link": "...", "urgency_score": 70, "business_impact_score": 65, "feasibility_score": 75, "total_score": 68, "scoring_rationale": "...", "decision_right_level": "autonomous", "deadline": "2026-05-07" }
  ],
  "cowork_requests": [
    { "rank": 1, "title": "...", "research_topic": "...", "business_question": "...", "expected_output": "...", "request_type": "web_search", "okr_link": "...", "urgency_score": 75, "business_impact_score": 80, "total_score": 77, "scoring_rationale": "..." },
    { "rank": 2, "title": "...", "research_topic": "...", "business_question": "...", "expected_output": "...", "request_type": "web_search", "okr_link": "...", "urgency_score": 70, "business_impact_score": 75, "total_score": 72, "scoring_rationale": "..." },
    { "rank": 3, "title": "...", "research_topic": "...", "business_question": "...", "expected_output": "...", "request_type": "web_search", "okr_link": "...", "urgency_score": 65, "business_impact_score": 70, "total_score": 67, "scoring_rationale": "..." }
  ]
}

Make insights specific to your role. Be concrete and evidence-based.
If you lack real data, flag it in scoring_rationale (lower confidence_score).`;

  try {
    const raw = await askClaude(system, user);
    const json = JSON.parse(extractJson(raw));
    const result: any[] = [];
    for (const ins of (json.insights ?? []).slice(0, 3)) {
      result.push({ deliverable_type: "insight", ...ins });
    }
    for (const idea of (json.ideas ?? []).slice(0, 3)) {
      result.push({ deliverable_type: "idea", ...idea });
    }
    for (const act of (json.actions ?? []).slice(0, 3)) {
      result.push({ deliverable_type: "action", ...act });
    }
    for (const cw of (json.cowork_requests ?? []).slice(0, 3)) {
      result.push({ deliverable_type: "cowork_request", ...cw });
    }
    return result;
  } catch (e: any) {
    console.error(`[AIOS] Deliverable generation failed for ${agent.name}:`, e.message);
    return [];
  }
}

function extractJson(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

// ── Boss consolidation ────────────────────────────────────────────────────────
async function runBossConsolidation(cycleId: number, boss: any, allAgents: any[]) {
  const now = new Date().toISOString();
  const directReports = allAgents.filter(a => a.boss_id === boss.id);
  if (directReports.length === 0) return;

  await log(cycleId, "boss", boss.name, "boss_consolidation_started", `${boss.name} consolidating ${directReports.length} direct reports.`, "working", "info");

  // Load all deliverables from direct reports + boss
  const reportIds = [...directReports.map(r => r.id), boss.id];
  const allDeliverables: any[] = [];
  for (const id of reportIds) {
    const rows = await db.select().from(aiosDeliverables).where(
      and(eq(aiosDeliverables.cycle_id, cycleId), eq(aiosDeliverables.agent_id, id))
    );
    allDeliverables.push(...rows);
  }

  const system = `You are ${boss.name}, consolidating your team's daily AIOS outputs.
Respond with valid JSON only.`;

  const user = `Your direct reports: ${directReports.map(r => r.name).join(", ")}.

Their combined deliverables:
${JSON.stringify(allDeliverables.map(d => ({ type: d.deliverable_type, title: d.title, score: d.total_score, agent: d.agent_name })), null, 2)}

Select top 5 items per category, remove duplicates, identify conflicts.
Return JSON:
{
  "top_insights": [{"title":"...","description":"...","from_agent":"...","score":80}],
  "top_ideas": [{"title":"...","description":"...","from_agent":"...","score":80}],
  "top_actions": [{"title":"...","description":"...","from_agent":"...","score":80}],
  "top_cowork_requests": [{"title":"...","description":"...","from_agent":"...","score":80}],
  "conflicts": [{"title":"...","agents_involved":"...","description":"...","severity":"medium"}],
  "boss_summary": "One paragraph summary of team status and top priorities."
}`;

  try {
    const raw = await askClaude(system, user);
    const json = JSON.parse(extractJson(raw));
    await db.insert(bossConsolidations).values({
      cycle_id: cycleId,
      boss_agent_id: boss.id,
      boss_agent_name: boss.name,
      direct_reports_included: directReports.map(r => r.id),
      top_insights: json.top_insights ?? [],
      top_ideas: json.top_ideas ?? [],
      top_actions: json.top_actions ?? [],
      top_cowork_requests: json.top_cowork_requests ?? [],
      conflicts: json.conflicts ?? [],
      boss_summary: json.boss_summary ?? "",
      created_at: now,
    } as any);
    await log(cycleId, "boss", boss.name, "boss_consolidation_completed", `${boss.name} consolidation complete.`, "completed", "info");
  } catch (e: any) {
    console.error(`[AIOS] Boss consolidation failed for ${boss.name}:`, e.message);
    await log(cycleId, "boss", boss.name, "boss_consolidation_failed", `${boss.name} consolidation failed: ${e.message}`, "failed", "critical");
  }
}

// ── Conflict detection ────────────────────────────────────────────────────────
async function detectConflicts(cycleId: number, _agents: any[]): Promise<number> {
  // Collect conflicts from boss consolidations
  const bossReports = await db.select().from(bossConsolidations).where(eq(bossConsolidations.cycle_id, cycleId));
  let count = 0;
  for (const report of bossReports) {
    const conflicts = (report.conflicts as any[]) ?? [];
    for (const c of conflicts) {
      await db.insert(conflictsTable).values({
        title: c.title ?? "Unnamed conflict",
        agents_involved: c.agents_involved ?? "",
        okrs_affected: c.okrs_affected ?? "",
        severity: c.severity ?? "medium",
        ceo_recommendation: c.description ?? "",
        status: "open",
        created_at: new Date().toISOString(),
      } as any);
      await log(cycleId, "system", null, "conflict_detected", `Conflict detected: ${c.title}`, "warning", "warning");
      count++;
    }
  }
  return count;
}

// ── CEO consolidation ────────────────────────────────────────────────────────
async function runCeoConsolidation(cycleId: number, _agents: any[]) {
  const now = new Date().toISOString();
  const bossReports = await db.select().from(bossConsolidations).where(eq(bossConsolidations.cycle_id, cycleId));
  const allDeliverables = await db.select().from(aiosDeliverables).where(eq(aiosDeliverables.cycle_id, cycleId));

  const system = `You are the Eendigo CEO, consolidating all AIOS daily cycle outputs.
Respond with valid JSON only.`;

  const topByScore = (items: any[], n = 5) =>
    [...items].sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0)).slice(0, n);

  const user = `Boss consolidation reports: ${JSON.stringify(bossReports.map(r => ({ boss: r.boss_agent_name, summary: r.boss_summary, top_insights: r.top_insights, top_cowork: r.top_cowork_requests })), null, 2)}

All deliverables summary (top by score):
- Top insights: ${JSON.stringify(topByScore(allDeliverables.filter(d => d.deliverable_type === "insight")))}
- Top ideas: ${JSON.stringify(topByScore(allDeliverables.filter(d => d.deliverable_type === "idea")))}
- Top actions: ${JSON.stringify(topByScore(allDeliverables.filter(d => d.deliverable_type === "action")))}
- Top CoWork requests: ${JSON.stringify(topByScore(allDeliverables.filter(d => d.deliverable_type === "cowork_request")))}

Generate CEO brief as JSON:
{
  "executive_summary": "...",
  "top_insights": [{"title":"...","description":"...","score":80}],
  "top_ideas": [{"title":"...","description":"...","score":80}],
  "top_actions": [{"title":"...","description":"...","score":80}],
  "top_cowork_requests": [{"title":"...","description":"...","score":80}],
  "conflicts": [{"title":"...","description":"..."}],
  "decisions_required": [{"title":"...","description":"...","urgency":"high"}],
  "autonomous_actions": [{"title":"...","description":"..."}],
  "coo_proposals": [{"title":"...","type":"workflow_change","problem":"...","impact":"...","approval_required":"ceo"}]
}`;

  try {
    const raw = await askClaude(system, user);
    const json = JSON.parse(extractJson(raw));
    await db.insert(ceoBriefs).values({
      cycle_id: cycleId,
      executive_summary: json.executive_summary ?? "",
      top_insights: json.top_insights ?? [],
      top_ideas: json.top_ideas ?? [],
      top_actions: json.top_actions ?? [],
      top_cowork_requests: json.top_cowork_requests ?? [],
      conflicts: json.conflicts ?? [],
      decisions_required: json.decisions_required ?? [],
      autonomous_actions: json.autonomous_actions ?? [],
      coo_proposals: json.coo_proposals ?? [],
      created_at: now,
    } as any);
    await log(cycleId, "ceo", "CEO", "ceo_brief_generated", "CEO brief generated.", "completed", "info");
  } catch (e: any) {
    console.error("[AIOS] CEO consolidation failed:", e.message);
    await log(cycleId, "ceo", "CEO", "ceo_brief_failed", `CEO brief failed: ${e.message}`, "failed", "critical");
  }
}

// ── Generate CoWork prompt ────────────────────────────────────────────────────
export async function generateCoworkPrompt(cycleId: number, _agents?: any[]): Promise<string> {
  const now = new Date().toISOString();
  const [cycle] = await db.select().from(aiosCycles).where(eq(aiosCycles.id, cycleId));
  const [ceoBrief] = await db.select().from(ceoBriefs).where(eq(ceoBriefs.cycle_id, cycleId));
  const deliverables = await db.select().from(aiosDeliverables).where(eq(aiosDeliverables.cycle_id, cycleId));
  const coworkReqs = deliverables.filter(d => d.deliverable_type === "cowork_request");
  const bossReports = await db.select().from(bossConsolidations).where(eq(bossConsolidations.cycle_id, cycleId));

  const groupedCowork = coworkReqs.reduce((acc: Record<string, any[]>, r) => {
    const name = r.agent_name ?? "Unknown";
    if (!acc[name]) acc[name] = [];
    acc[name].push(r);
    return acc;
  }, {});

  const lines: string[] = [];
  lines.push("# AIOS First CEO Brief for Claude CoWork");
  lines.push(`\nCycle date: ${cycle?.cycle_date ?? now.slice(0, 10)}`);
  lines.push(`Generated: ${now}`);

  lines.push("\n## Context");
  lines.push("Eendigo AIOS completed Round 1 of the daily operating cycle. Every active agent analyzed its assigned app sections, reviewed its knowledge base and job description, and generated 12 deliverables (3 insights, 3 ideas, 3 actions, 3 CoWork requests). Bosses consolidated team outputs. The CEO consolidated all boss reports into this brief.");

  if (ceoBrief) {
    lines.push("\n## CEO Executive Summary");
    lines.push(ceoBrief.executive_summary ?? "");

    lines.push("\n## Top 5 Company Insights");
    ((ceoBrief.top_insights as any[]) ?? []).forEach((i, n) => lines.push(`${n+1}. **${i.title}**: ${i.description}`));

    lines.push("\n## Top 5 Ideas");
    ((ceoBrief.top_ideas as any[]) ?? []).forEach((i, n) => lines.push(`${n+1}. **${i.title}**: ${i.description}`));

    lines.push("\n## Top 5 Actions");
    ((ceoBrief.top_actions as any[]) ?? []).forEach((i, n) => lines.push(`${n+1}. **${i.title}**: ${i.description}`));

    lines.push("\n## Top 5 CoWork Research Requests");
    ((ceoBrief.top_cowork_requests as any[]) ?? []).forEach((i, n) => lines.push(`${n+1}. **${i.title}**: ${i.description ?? i.research_topic}`));

    if (((ceoBrief.decisions_required as any[]) ?? []).length > 0) {
      lines.push("\n## Decisions Required from President");
      ((ceoBrief.decisions_required as any[]) ?? []).forEach((d, n) => lines.push(`${n+1}. **${d.title}** [${d.urgency ?? "medium"}]: ${d.description}`));
    }

    if (((ceoBrief.coo_proposals as any[]) ?? []).length > 0) {
      lines.push("\n## COO Self-Improvement Proposals");
      ((ceoBrief.coo_proposals as any[]) ?? []).forEach((p, n) => lines.push(`${n+1}. **${p.title}** (${p.type}): ${p.problem} → ${p.impact}`));
    }
  }

  lines.push("\n## Agent-Specific Research Requests");
  for (const [agentName, reqs] of Object.entries(groupedCowork)) {
    lines.push(`\n### ${agentName}`);
    reqs.forEach((r, n) => {
      lines.push(`${n+1}. **${r.title}**`);
      if (r.research_topic) lines.push(`   Topic: ${r.research_topic}`);
      if (r.business_question) lines.push(`   Question: ${r.business_question}`);
      if (r.expected_output) lines.push(`   Expected output: ${r.expected_output}`);
      if (r.request_type) lines.push(`   Type: ${r.request_type}`);
    });
  }

  lines.push("\n## Instructions to Claude CoWork");
  lines.push(`- Run all requested research using reputable, current sources.
- Return output as agent-specific letters, each addressed to the named agent.
- Separate facts from interpretation clearly.
- Include source references where possible.
- Include recommended next actions, risks, and data to update in AIOS.
- Flag any conflicts or trade-offs you identify.`);

  lines.push("\n## Required Output Format");
  lines.push(`
# CoWork Executive Synthesis for CEO

# Agent-Specific Letters

## Letter to [Agent Name]

Dear [Agent Name],

Based on your request, I researched:
[findings]

Key facts:
1.
2.
3.

Implications for your OKRs:
[...]

Recommended updated insights / ideas / actions:
[...]

Risks / conflicts:
[...]

Signed,
Claude CoWork

---
(repeat for each agent with requests)
---

# Updated Company-Level View

# Recommended Decisions for President

# Conflicts / Trade-offs

# App / Workflow / Agent Improvements Suggested
`);

  const prompt = lines.join("\n");
  await db.update(aiosCycles).set({ cowork_prompt: prompt, updated_at: now } as any).where(eq(aiosCycles.id, cycleId));
  if (ceoBrief) {
    await db.update(ceoBriefs).set({ cowork_prompt: prompt } as any).where(eq(ceoBriefs.cycle_id, cycleId));
  }
  return prompt;
}

// ── Store CoWork output ───────────────────────────────────────────────────────
export async function storeCoworkOutput(cycleId: number, rawText: string, pastedBy = "President"): Promise<void> {
  const now = new Date().toISOString();
  const [output] = await db.insert(coworkOutputs).values({
    cycle_id: cycleId,
    raw_output_text: rawText,
    pasted_by: pastedBy,
    pasted_at: now,
    parsed_status: "not_parsed",
    created_at: now,
  } as any).returning();

  await db.update(aiosCycles).set({
    cowork_output_raw: rawText,
    status: "cowork_output_received",
    updated_at: now,
  } as any).where(eq(aiosCycles.id, cycleId));

  // Try to parse agent letters by "## Letter to [Agent Name]"
  const letterRegex = /##\s+Letter to\s+([^\n]+)\n([\s\S]*?)(?=##\s+Letter to|\s*$)/gi;
  let match;
  let parsed = 0;
  const letters: any[] = [];
  while ((match = letterRegex.exec(rawText)) !== null) {
    letters.push({ agentName: match[1].trim(), text: match[2].trim() });
  }
  if (letters.length > 0) {
    for (const letter of letters) {
      await db.insert(coworkLetters).values({
        cycle_id: cycleId,
        agent_name: letter.agentName,
        raw_letter_text: letter.text,
        status: "received",
        created_at: now,
      } as any);
      parsed++;
    }
    await db.update(coworkOutputs).set({ parsed_status: "parsed" } as any).where(eq(coworkOutputs.id, output.id));
  } else {
    await db.update(coworkOutputs).set({ parsed_status: "not_parsed" } as any).where(eq(coworkOutputs.id, output.id));
  }
  await log(cycleId, "president", "President", "cowork_output_pasted",
    `CoWork output stored. ${parsed} agent letters parsed.`, "completed", "info");
}

// ── Round 2 — agents incorporate CoWork findings ──────────────────────────────
export async function runRound2(cycleId: number): Promise<void> {
  const nowStr = () => new Date().toISOString();
  try {
    await db.update(aiosCycles).set({ status: "round2_running", updated_at: nowStr() } as any).where(eq(aiosCycles.id, cycleId));
    pushSSE(cycleId, { type: "status", status: "round2_running" });
    await log(cycleId, "system", null, "round2_started",
      "Round 2 started — agents reviewing CoWork letters.", "working", "info");

    const allAgents = await db.select().from(agentsTable);
    const activeAgents = allAgents.filter(a => a.status === "active" || a.status === "working");
    const letters = await db.select().from(coworkLetters).where(eq(coworkLetters.cycle_id, cycleId));
    const sectionMap = await db.select().from(agentSectionMap);
    const allObjectives = await db.select().from(objectives);
    const allTasks = await db.select().from(tasks);
    const allKnowledge = await db.select().from(agentKnowledge);

    let total = 0;

    for (const agent of activeAgents) {
      // Match letter to agent by name (case-insensitive, first-word fallback)
      const letter = letters.find(l => {
        if (!l.agent_name) return false;
        const ln = l.agent_name.toLowerCase();
        const an = agent.name.toLowerCase();
        return ln === an || ln.split(" ")[0] === an.split(" ")[0] || an.includes(ln.split(" ")[0]);
      });
      if (!letter) {
        await log(cycleId, "agent", agent.name, "round2_no_letter",
          `${agent.name} has no CoWork letter — skipping Round 2.`, "warning", "warning");
        continue;
      }

      await log(cycleId, "agent", agent.name, "round2_reading_letter",
        `${agent.name} reviewing CoWork findings.`, "working", "info");

      const agentObjectives = allObjectives.filter(o => o.agent_id === agent.id);
      const agentTasks = allTasks.filter(t => t.agent_id === agent.id);
      const agentSections = sectionMap.filter(sm =>
        sm.primary_agent.toLowerCase().includes(agent.name.toLowerCase().split(" ")[0]) ||
        agent.name.toLowerCase().includes(sm.primary_agent.toLowerCase().split(" ")[0])
      );
      const agentKb = allKnowledge.filter(k =>
        k.role_key && agent.name.toLowerCase().includes(k.role_key.toLowerCase().replace(/-/g, " ").split(" ")[0])
      );

      const context = buildAgentContext(agent, agentObjectives, agentTasks, agentSections, agentKb);
      const deliverables = await generateRound2Deliverables(cycleId, agent, context, letter.raw_letter_text);

      for (const d of deliverables) {
        await db.insert(aiosDeliverables).values({
          cycle_id: cycleId,
          agent_id: agent.id,
          agent_name: agent.name,
          ...d,
          status: "round2",
          created_at: nowStr(),
        } as any);
        total++;
      }

      await log(cycleId, "agent", agent.name, "round2_agent_completed",
        `${agent.name} Round 2: ${deliverables.length} updated deliverables.`, "completed", "info");
    }

    await db.update(aiosCycles).set({ status: "round2_completed", updated_at: nowStr() } as any).where(eq(aiosCycles.id, cycleId));
    await log(cycleId, "system", null, "round2_finished",
      `Round 2 complete — ${total} updated deliverables generated.`, "completed", "info");
    pushSSE(cycleId, { type: "status", status: "round2_completed" });
  } catch (err: any) {
    console.error("[AIOS] Round 2 failed:", err);
    await db.update(aiosCycles).set({ status: "round2_failed", updated_at: new Date().toISOString() } as any).where(eq(aiosCycles.id, cycleId));
    await log(cycleId, "system", null, "round2_failed", `Round 2 failed: ${err.message}`, "failed", "critical");
    pushSSE(cycleId, { type: "status", status: "round2_failed" });
  }
}

async function generateRound2Deliverables(cycleId: number, agent: any, context: string, letterText: string): Promise<any[]> {
  const system = `You are ${agent.name}, an AI agent at Eendigo.
You completed your morning analysis (Round 1). Claude CoWork has now researched your requests and sent you findings.
Read the CoWork letter addressed to you and generate UPDATED, more informed deliverables.
Respond ONLY with valid JSON. No markdown outside the JSON.`;

  const user = `## Your original context
${context}

## CoWork Letter Addressed to You
${letterText.slice(0, 6000)}

Based on these research findings, generate 9 updated deliverables (3 insights, 3 ideas, 3 actions).
These should incorporate the new information from CoWork and supersede or refine your Round 1 outputs.

{
  "insights": [
    { "rank": 1, "title": "...", "description": "...", "source_app_section": "CoWork Research", "okr_link": "...", "okr_relevance_score": 80, "business_impact_score": 85, "urgency_score": 70, "confidence_score": 80, "total_score": 79, "scoring_rationale": "Informed by CoWork findings." }
  ],
  "ideas": [
    { "rank": 1, "title": "...", "description": "...", "okr_link": "...", "business_impact_score": 85, "feasibility_score": 75, "urgency_score": 70, "total_score": 77, "scoring_rationale": "...", "decision_right_level": "autonomous" }
  ],
  "actions": [
    { "rank": 1, "title": "...", "description": "...", "okr_link": "...", "urgency_score": 85, "business_impact_score": 80, "feasibility_score": 80, "total_score": 82, "scoring_rationale": "...", "decision_right_level": "autonomous", "deadline": "${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}" }
  ]
}

Return exactly 3 insights, 3 ideas, 3 actions.`;

  try {
    const raw = await askClaude(system, user);
    const json = JSON.parse(extractJson(raw));
    const result: any[] = [];
    for (const ins of (json.insights ?? []).slice(0, 3)) result.push({ deliverable_type: "insight", ...ins });
    for (const idea of (json.ideas ?? []).slice(0, 3)) result.push({ deliverable_type: "idea", ...idea });
    for (const act of (json.actions ?? []).slice(0, 3)) result.push({ deliverable_type: "action", ...act });
    return result;
  } catch (e: any) {
    console.error(`[AIOS] Round 2 generation failed for ${agent.name}:`, e.message);
    return [];
  }
}
