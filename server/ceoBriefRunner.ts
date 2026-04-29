/**
 * CEO Brief Runner
 *
 * Standalone service that generates a daily CEO Brief independently of the
 * AIOS cycle. It:
 *   1. Fetches live data from the DB (same data the buildCoworkPrompt uses)
 *   2. Calls Claude (via aiProviders.generateText) to produce structured decisions
 *   3. Parses the decision blocks
 *   4. Persists a ceoBriefRuns row + ceoBriefRunDecisions rows
 *
 * The service is called both from:
 *   - POST /api/ceo-brief/generate  (manual, from UI)
 *   - The daily cron job at 05:00 UTC (scheduled, from server/index.ts)
 */

import { db } from "./db.js";
import { eq, desc, sql } from "drizzle-orm";
import { generateText } from "./aiProviders.js";
import {
  ceoBriefRuns,
  ceoBriefRunDecisions,
  agents as agentsTable,
  objectives,
  tasks,
  conflicts as conflictsTable,
  bdDeals,
  pricingProposals,
  invoiceSnapshots,
  wonProjects,
  hiringCandidates,
  employees,
  agentSectionMap,
} from "../shared/schema.js";

// ── Data-fetching helpers (mirrors client-side buildCoworkPrompt data) ─────────

async function fetchBriefData(date: string) {
  const [
    allAgents,
    allObjectives,
    allTasks,
    allConflicts,
    allDeals,
    allProposals,
    allInvoices,
    allWonProjects,
    allCandidates,
    allEmployees,
    sectionMap,
  ] = await Promise.all([
    db.select().from(agentsTable).where(eq(agentsTable.status, "active")),
    db.select().from(objectives),
    db.select().from(tasks),
    db.select().from(conflictsTable).where(eq(conflictsTable.status, "open")),
    db.select().from(bdDeals).orderBy(desc(bdDeals.created_at)),
    db.select().from(pricingProposals).orderBy(desc(pricingProposals.created_at)),
    db.select().from(invoiceSnapshots),
    db.select().from(wonProjects),
    db.select().from(hiringCandidates),
    db.select().from(employees),
    db.select().from(agentSectionMap),
  ]);

  const openTasks    = allTasks.filter(t => t.status === "open" || t.status === "in_progress");
  const overdueTasks = allTasks.filter(t =>
    t.deadline && t.deadline < date && t.status !== "done"
  );

  const recentIdeasByAgent = new Map<number, typeof allObjectives>();
  // (no separate ideas table in this fetch — objectives serve as "ideas" proxy here)

  // BD deals
  const bdDealsMapped = allDeals.slice(0, 30).map(d => ({
    name: d.name,
    client_name: d.client_name,
    stage: d.stage,
    amount: d.amount,
    probability: d.probability,
    close_date: d.close_date,
    currency: d.currency,
  }));

  // Proposals
  const recentProposals = allProposals.slice(0, 20).map(p => ({
    project_name: p.project_name,
    client_name: p.client_name,
    outcome: p.outcome,
    total_fee: p.total_fee,
    weekly_price: p.weekly_price,
    duration_weeks: p.duration_weeks,
    win_probability: p.win_probability,
    loss_reason: p.loss_reason,
  }));

  // Invoices
  const openInvoices = allInvoices
    .filter(i => i.state !== "paid" && i.due_amount > 0)
    .map(i => ({
      client_name: i.client_name,
      due_amount: i.due_amount,
      due_date: i.due_date,
      state: i.state,
      currency: i.currency,
    }));

  // Won projects
  const wonProjectsMapped = allWonProjects.map(p => ({
    project_name: p.project_name,
    client_name: p.client_name,
    status: p.status,
    start_date: p.start_date,
    end_date: p.end_date,
    total_amount: p.total_amount,
    currency: p.currency,
  }));

  // Hiring by stage
  const stageCount: Record<string, number> = {};
  for (const c of allCandidates) {
    stageCount[c.stage] = (stageCount[c.stage] ?? 0) + 1;
  }
  const hiringByStage = Object.entries(stageCount).map(([stage, count]) => ({ stage, count }));

  // Agent section map
  const agentSections = new Map<string, typeof sectionMap>();
  for (const s of sectionMap) {
    // sectionMap doesn't have agent_name directly — need to join via agents
    // Use primary_agent field as agent name
    const name = s.primary_agent;
    if (!agentSections.has(name)) agentSections.set(name, []);
    agentSections.get(name)!.push(s);
  }

  return {
    agents: allAgents,
    objectives: allObjectives,
    openTasks,
    overdueTasks,
    openConflicts: allConflicts,
    bdDeals: bdDealsMapped,
    recentProposals,
    openInvoices,
    wonProjects: wonProjectsMapped,
    hiringByStage,
    employeeCount: allEmployees.length,
    agentSections,
  };
}

// ── Prompt builder (server-side, same logic as client's buildCoworkPrompt) ────

function eur(n: number | null, ccy?: string | null) {
  return n == null ? "?" : `${ccy ?? "€"}${Math.round(n).toLocaleString("en")}`;
}

function buildBriefPrompt(date: string, data: Awaited<ReturnType<typeof fetchBriefData>>): string {
  const lines: string[] = [];
  lines.push(`# Eendigo Daily CEO Brief — ${date}`);
  lines.push("");
  lines.push("You are the CEO of Eendigo, a boutique management consulting firm. This brief is compiled from the live state of every section of the company. Study each section, synthesise across them, and respond with concrete decisions.");
  lines.push("");

  // BD + Pipeline
  if (data.bdDeals.length > 0) {
    lines.push("## SVP Sales / BD — Pipeline");
    const weighted = data.bdDeals.reduce((s, d) => s + (d.amount ?? 0) * ((d.probability ?? 0) / 100), 0);
    lines.push(`Deals: ${data.bdDeals.length} · Weighted pipeline: ${eur(weighted)} · High-prob (≥60%): ${data.bdDeals.filter(d => (d.probability ?? 0) >= 60).length}`);
    for (const d of data.bdDeals.slice(0, 10))
      lines.push(`- **${d.name}** (${d.client_name ?? "?"}) — ${d.stage ?? "?"} · ${eur(d.amount, d.currency)} · ${d.probability ?? "?"}% · close ${d.close_date ?? "?"}`);
    lines.push("");
  }

  if (data.recentProposals.length > 0) {
    lines.push("### Recent proposals");
    const won  = data.recentProposals.filter(p => p.outcome === "won").length;
    const lost = data.recentProposals.filter(p => p.outcome === "lost").length;
    lines.push(`Won: ${won} · Lost: ${lost} · Open: ${data.recentProposals.length - won - lost}`);
    for (const p of data.recentProposals.slice(0, 8)) {
      const loss = p.loss_reason ? ` · loss: ${p.loss_reason}` : "";
      const val  = p.weekly_price && p.duration_weeks ? p.weekly_price * p.duration_weeks : (p.total_fee ?? null);
      lines.push(`- ${p.project_name} (${p.client_name ?? "?"}) — ${p.outcome ?? "open"} · ${eur(val)}${loss}`);
    }
    lines.push("");
  }

  // CFO invoices
  if (data.openInvoices.length > 0) {
    lines.push("## CFO — Invoices & Revenue");
    const overdue = data.openInvoices.filter(i => i.due_date && i.due_date < date);
    lines.push(`Overdue: ${overdue.length} · ${eur(overdue.reduce((s, i) => s + (i.due_amount ?? 0), 0))} | Outstanding: ${data.openInvoices.length}`);
    for (const i of overdue.slice(0, 5))
      lines.push(`  - ${i.client_name ?? "?"} · ${eur(i.due_amount, i.currency)} overdue since ${i.due_date}`);
    lines.push("");
  }

  // Active projects
  const activeProjects = data.wonProjects.filter(p => p.status === "active");
  if (activeProjects.length > 0) {
    lines.push("## COO / Delivery — Active Projects");
    const in45d = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
    lines.push(`Active: ${activeProjects.length} · Ending within 45 days: ${activeProjects.filter(p => p.end_date && p.end_date <= in45d).length}`);
    for (const p of activeProjects)
      lines.push(`  - ${p.project_name} (${p.client_name ?? "?"}) · ${eur(p.total_amount, p.currency)} · ends ${p.end_date ?? "?"}`);
    lines.push("");
  }

  // CHRO
  if (data.hiringByStage.length > 0) {
    lines.push("## CHRO — Hiring & Headcount");
    lines.push(`Headcount: ${data.employeeCount} employees`);
    lines.push("Hiring pipeline:");
    for (const s of data.hiringByStage) lines.push(`  - ${s.stage}: ${s.count}`);
    lines.push("");
  }

  // Agents: tasks + objectives
  lines.push("## AIOS — Agent Status");
  for (const a of data.agents) {
    const agentTasks = data.openTasks.filter(t => t.agent_id === a.id).slice(0, 3);
    const agentObjs  = data.objectives.filter(o => o.agent_id === a.id).slice(0, 3);
    if (agentTasks.length === 0 && agentObjs.length === 0) continue;
    lines.push(`### ${a.name}`);
    if (agentObjs.length > 0) {
      lines.push("Objectives:");
      for (const o of agentObjs) lines.push(`  - [${o.status}] ${o.title}`);
    }
    if (agentTasks.length > 0) {
      lines.push("Tasks:");
      for (const t of agentTasks) lines.push(`  - [${t.approval_status}] ${t.title}${t.deadline ? ` due ${t.deadline}` : ""}`);
    }
  }
  if (data.overdueTasks.length > 0) {
    lines.push("### Overdue agent tasks");
    for (const t of data.overdueTasks) {
      const agentName = data.agents.find(a => a.id === t.agent_id)?.name ?? "?";
      lines.push(`  - ${agentName}: ${t.title} (was due ${t.deadline})`);
    }
  }
  lines.push("");

  // Conflicts
  if (data.openConflicts.length > 0) {
    lines.push("## Open conflicts");
    for (const c of data.openConflicts)
      lines.push(`- [${c.severity ?? "?"}] ${c.title}`);
    lines.push("");
  }

  // Mandate + output contract
  lines.push("## Your mandate");
  lines.push("Study the full brief above. Produce concrete decisions covering every agent and business area. Each decision must:");
  lines.push("- Be grounded in the specific data shown above.");
  lines.push("- Carry an explicit approval level: `autonomous` | `boss` | `ceo` | `livio`.");
  lines.push("- Include impact / effort / risk on a 0-100 scale.");
  lines.push("- Prioritise items whose absence would cost EBITDA, cash, reputation, or capacity in the next 30 days.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Return your answer ONLY in the following format. One block per decision, separated by '---'. Do not add prose before or after.");
  lines.push("");
  lines.push("DECISION_ID: <unique id, e.g. CB-2026-04-30-001>");
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

// ── Decision parser ────────────────────────────────────────────────────────────

function readField(block: string, key: string): string | null {
  const rx = new RegExp(`^${key}:\\s*(.*)$`, "im");
  const m = block.match(rx);
  return m ? m[1].trim() : null;
}

interface ParsedDecision {
  decision_id: string;
  type: "idea" | "action" | "conflict" | "proposal";
  agent: string;
  title: string;
  description: string;
  okr_link: string | null;
  deadline: string | null;
  approval_level: "autonomous" | "boss" | "ceo" | "livio";
  impact: number | null;
  effort: number | null;
  risk: number | null;
}

function parseDecisions(raw: string): ParsedDecision[] {
  const blocks = raw.split(/^\s*-{3,}\s*$/m).map(b => b.trim()).filter(Boolean);
  const results: ParsedDecision[] = [];

  for (const block of blocks) {
    const decision_id = readField(block, "DECISION_ID");
    const typeRaw     = readField(block, "TYPE");
    const agent       = readField(block, "AGENT");
    const title       = readField(block, "TITLE");
    if (!decision_id || !typeRaw || !agent || !title) continue;

    const type = typeRaw.toLowerCase().trim() as ParsedDecision["type"];
    if (!["idea", "action", "conflict", "proposal"].includes(type)) continue;

    const description = readField(block, "DESCRIPTION") ?? "";
    const okrRaw = readField(block, "OKR_LINK");
    const okr_link = (okrRaw && okrRaw.toLowerCase() !== "none") ? okrRaw : null;
    const deadlineRaw = readField(block, "DEADLINE");
    const deadline = (deadlineRaw && deadlineRaw.toLowerCase() !== "none") ? deadlineRaw : null;

    const approvalRaw = (readField(block, "APPROVAL_LEVEL") ?? "autonomous").toLowerCase().trim();
    const approval_level = (["autonomous", "boss", "ceo", "livio"].includes(approvalRaw)
      ? approvalRaw : "autonomous") as ParsedDecision["approval_level"];

    const num = (v: string | null) => {
      if (!v) return null;
      const n = parseFloat(v);
      return isFinite(n) ? Math.round(n) : null;
    };

    results.push({
      decision_id,
      type,
      agent,
      title,
      description,
      okr_link,
      deadline,
      approval_level,
      impact: num(readField(block, "IMPACT")),
      effort: num(readField(block, "EFFORT")),
      risk:   num(readField(block, "RISK")),
    });
  }
  return results;
}

// ── Main runner ────────────────────────────────────────────────────────────────

export interface CeoBriefResult {
  briefId: string;
  decisionsCount: number;
  status: "success" | "failed";
  error?: string;
}

export async function runCeoBrief(opts: { trigger: "manual" | "scheduled" }): Promise<CeoBriefResult> {
  const startMs = Date.now();
  const date = new Date().toISOString().slice(0, 10);

  try {
    // 1. Fetch live data
    const data = await fetchBriefData(date);

    // 2. Build prompt
    const prompt = buildBriefPrompt(date, data);

    // 3. Call Claude
    const aiResult = await generateText({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      prompt,
      maxTokens: 4096,
      temperature: 0.4,
    });

    const durationMs = Date.now() - startMs;

    // 4. Parse decisions
    const decisions = parseDecisions(aiResult.text);

    // 5. Persist brief + decisions in sequence (no transaction API in this drizzle setup)
    const [briefRow] = await db.insert(ceoBriefRuns).values({
      generatedBy: opts.trigger,
      rawBriefMarkdown: prompt,
      claudeResponseRaw: aiResult.text,
      model: aiResult.model,
      tokenInput: aiResult.usage?.input_tokens ?? null,
      tokenOutput: aiResult.usage?.output_tokens ?? null,
      durationMs,
      status: "success",
    } as any).returning();

    const briefId: string = briefRow.id;

    if (decisions.length > 0) {
      await db.insert(ceoBriefRunDecisions).values(
        decisions.map(d => ({
          briefId,
          decisionId: d.decision_id,
          type: d.type,
          agent: d.agent,
          title: d.title,
          description: d.description,
          okrLink: d.okr_link,
          deadline: d.deadline,
          approvalLevel: d.approval_level,
          impact: d.impact,
          effort: d.effort,
          risk: d.risk,
          status: "pending",
        }) as any)
      );
    }

    return { briefId, decisionsCount: decisions.length, status: "success" };

  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    // Write a failed brief row so the history shows the attempt
    try {
      const [briefRow] = await db.insert(ceoBriefRuns).values({
        generatedBy: opts.trigger,
        durationMs,
        status: "failed",
        error: String(err?.message ?? err).slice(0, 1000),
      } as any).returning();
      return { briefId: briefRow.id, decisionsCount: 0, status: "failed", error: err.message };
    } catch (insertErr: any) {
      console.error("[CEO Brief] Could not write failure row:", insertErr);
      return { briefId: "", decisionsCount: 0, status: "failed", error: err.message };
    }
  }
}
