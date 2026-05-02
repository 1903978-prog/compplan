/**
 * B7 — Agent Scoring Engine
 * Pure SQL aggregations for the CHRO 6-dimension performance scorecard.
 * Replaces the CHRO's Claude call for routine daily scoring.
 *
 * Dimensions (0-100 each):
 *   1. Output Quality       — mean total_score of deliverables
 *   2. Deliverable Completeness — % cycles where agent hit ≥9 deliverables
 *   3. OKR Alignment        — % deliverables linked to an objective
 *   4. Decision-Right Compliance — % deliverables with a valid level
 *   5. Conflict Rate        — inverted (100 = no conflicts raised)
 *   6. Knowledge Utilisation — % deliverables with source_app_section filled
 */
import { db } from "../db.js";
import { aiosDeliverables, objectives, conflicts as conflictsTable } from "../../shared/schema.js";
import { eq, and, gte } from "drizzle-orm";
import { logMicroAI } from "./logger.js";

export interface AgentScore {
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

const VALID_LEVELS = new Set(["autonomous", "boss_approval", "ceo_approval", "president_approval"]);

export async function scoreAgent(agentId: number, days = 7): Promise<AgentScore> {
  const t0 = Date.now();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const [delivs, objs] = await Promise.all([
    db.select().from(aiosDeliverables).where(
      and(eq(aiosDeliverables.agent_id, agentId), gte(aiosDeliverables.created_at, since)),
    ),
    db.select().from(objectives).where(eq(objectives.agent_id, agentId)),
  ]);

  // 1. Output Quality: mean total_score of deliverables that have one
  const scored = delivs.filter(d => d.total_score != null);
  const outputQuality = scored.length > 0
    ? Math.round(scored.reduce((s, d) => s + (d.total_score ?? 0), 0) / scored.length)
    : 50;

  // 2. Deliverable Completeness: % cycles with ≥ 9 deliverables
  const cycleGroups: Record<number, number> = {};
  for (const d of delivs) cycleGroups[d.cycle_id] = (cycleGroups[d.cycle_id] ?? 0) + 1;
  const cycles = Object.values(cycleGroups);
  const deliverableCompleteness = cycles.length === 0 ? 0
    : Math.round((cycles.filter(n => n >= 9).length / cycles.length) * 100);

  // 3. OKR Alignment: % deliverables with a linked objective
  const withOkr = delivs.filter(d => d.okr_link && d.okr_link !== "none" && d.okr_link.trim() !== "");
  const okrAlignment = delivs.length === 0 ? 0
    : Math.round((withOkr.length / delivs.length) * 100);

  // 4. Decision-Right Compliance: % with a valid level string
  const withLevel = delivs.filter(d => d.decision_right_level && VALID_LEVELS.has(d.decision_right_level));
  const decisionRightCompliance = delivs.length === 0 ? 100
    : Math.round((withLevel.length / delivs.length) * 100);

  // 5. Conflict Rate (inverted): proxy — 90 if agent has deliverables, else 50
  //    (no direct deliverable→conflict FK; a future Wave 3 module will refine this)
  const conflictRate = delivs.length > 0 ? 90 : 50;

  // 6. Knowledge Utilisation: % deliverables with source_app_section populated
  const withSection = delivs.filter(d => d.source_app_section && d.source_app_section.trim() !== "");
  const knowledgeUtilisation = delivs.length === 0 ? 0
    : Math.round((withSection.length / delivs.length) * 100);

  const overall = Math.round(
    (outputQuality + deliverableCompleteness + okrAlignment + decisionRightCompliance + conflictRate + knowledgeUtilisation) / 6,
  );

  await logMicroAI({ module_name: "scoring", latency_ms: Date.now() - t0, saved_tokens_estimate: 800 });
  return {
    agentId, days,
    outputQuality,
    deliverableCompleteness,
    okrAlignment,
    decisionRightCompliance,
    conflictRate,
    knowledgeUtilisation,
    overall,
  };
}
