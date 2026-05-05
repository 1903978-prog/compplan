/**
 * B9 — Decision-Right Assigner
 * Pure rules: maps action properties to L0/L1/L2/L3.
 * Zero LLM calls. Zero latency. Replaces the "what approval level?" Claude call.
 *
 * Rules (in priority order):
 *   L3 (President) — budget > €5k OR headcount change
 *   L2 (CEO)       — external party (client, vendor, press)
 *   L1 (Boss)      — cross-agent dependency (≥2 agents involved)
 *   L0 (Autonomous)— everything else
 */
import { logMicroAI } from "./logger.js";

export type DecisionLevel = "L0" | "L1" | "L2" | "L3";

export interface ActionDescriptor {
  title:              string;
  description?:       string;
  budgetEur?:         number;
  affectsHeadcount?:  boolean;
  externalParty?:     boolean;
  crossAgent?:        boolean;
  agentsInvolved?:    string[];
}

// Patterns that indicate a headcount change
const HEADCOUNT_RE = /\b(hire|fire|terminat|promot|demot|reassign|new (role|position|headcount|employee|staff)|lay.?off|redundan)\b/i;
// Patterns that indicate an external party is involved
const EXTERNAL_RE  = /\b(client|vendor|supplier|partner|candidate|prospect|press|media|journalist|investor|bank|agency|customer)\b/i;
// Budget extraction: "€5,000" | "5k EUR" | "€ 5000" | "5000 eur"
const BUDGET_RE    = /€\s*([\d,]+)|([\d]+)\s*k\s*(?:eur|€)|([\d,]+)\s*(?:eur|euro)/i;

function parseBudget(text: string): number | null {
  const m = text.match(BUDGET_RE);
  if (!m) return null;
  const raw = (m[1] ?? m[3])?.replace(/,/g, "") ?? null;
  if (raw) return parseInt(raw, 10);
  if (m[2]) return parseInt(m[2], 10) * 1_000;
  return null;
}

export async function assignLevel(action: ActionDescriptor): Promise<DecisionLevel> {
  const t0 = Date.now();
  const text = `${action.title} ${action.description ?? ""}`;

  // L3: budget > €5k or headcount change
  const budget = action.budgetEur ?? parseBudget(text);
  if ((budget != null && budget > 5_000) || action.affectsHeadcount || HEADCOUNT_RE.test(text)) {
    await logMicroAI({ module_name: "decisionRights", latency_ms: Date.now() - t0, saved_tokens_estimate: 200 });
    return "L3";
  }

  // L2: external party
  if (action.externalParty || EXTERNAL_RE.test(text)) {
    await logMicroAI({ module_name: "decisionRights", latency_ms: Date.now() - t0, saved_tokens_estimate: 200 });
    return "L2";
  }

  // L1: cross-agent dependency
  if (action.crossAgent || (action.agentsInvolved?.length ?? 0) > 1) {
    await logMicroAI({ module_name: "decisionRights", latency_ms: Date.now() - t0, saved_tokens_estimate: 200 });
    return "L1";
  }

  // L0: autonomous
  await logMicroAI({ module_name: "decisionRights", latency_ms: Date.now() - t0, saved_tokens_estimate: 200 });
  return "L0";
}

/** Map L0-L3 to the schema enum used by aios_deliverables.decision_right_level */
export function levelToSchema(level: DecisionLevel): string {
  const map: Record<DecisionLevel, string> = {
    L0: "autonomous",
    L1: "boss_approval",
    L2: "ceo_approval",
    L3: "president_approval",
  };
  return map[level];
}

/** Map schema enum back to the short label */
export function schemaToLevel(schema: string | null | undefined): DecisionLevel {
  const map: Record<string, DecisionLevel> = {
    autonomous:           "L0",
    boss_approval:        "L1",
    ceo_approval:         "L2",
    president_approval:   "L3",
    // Legacy values from the CoWork prompt parser
    autonomous_l0:        "L0",
    boss:                 "L1",
    ceo:                  "L2",
    livio:                "L3",
  };
  return map[schema ?? ""] ?? "L0";
}
