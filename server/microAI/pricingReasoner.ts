/**
 * B8 — Pricing Reasoner
 * Decision tree: geography × client size × complexity × PE-ownership → fee corridor.
 * Queries the pricing_rules table first (seeded, editable by Pricing Agent).
 * Falls back to hardcoded Eendigo baseline if no matching DB rule.
 * Replaces pricing-estimation Claude calls.
 */
import { db } from "../db.js";
import { pricingRules } from "../../shared/schema.js";
import { eq, and } from "drizzle-orm";
import { logMicroAI } from "./logger.js";

export interface PricingInput {
  geography?:  string;   // NL | BE | DE | FR | UK | other
  clientSize?: string;   // small | mid | large | enterprise
  complexity?: string;   // low | medium | high
  peOwned?:    boolean;
}

export interface PricingOutput {
  feeMin:    number;   // EUR / week
  feeMid:    number;
  feeMax:    number;
  rationale: string;
  ruleUsed?: string;
}

// Hardcoded fallback decision tree — Eendigo's baseline fee corridors
const DEFAULTS: Record<string, Record<string, { min: number; mid: number; max: number }>> = {
  small: {
    low:    { min: 3_000, mid: 5_000,  max: 8_000  },
    medium: { min: 4_000, mid: 6_500,  max: 10_000 },
    high:   { min: 5_000, mid: 8_000,  max: 12_000 },
  },
  mid: {
    low:    { min: 6_000,  mid: 9_000,  max: 14_000 },
    medium: { min: 8_000,  mid: 12_000, max: 18_000 },
    high:   { min: 10_000, mid: 15_000, max: 22_000 },
  },
  large: {
    low:    { min: 10_000, mid: 15_000, max: 22_000 },
    medium: { min: 13_000, mid: 18_000, max: 26_000 },
    high:   { min: 16_000, mid: 22_000, max: 30_000 },
  },
  enterprise: {
    low:    { min: 15_000, mid: 20_000, max: 28_000 },
    medium: { min: 18_000, mid: 25_000, max: 35_000 },
    high:   { min: 22_000, mid: 30_000, max: 40_000 },
  },
};

// Geography multipliers relative to NL baseline
const GEO_FACTOR: Record<string, number> = {
  UK: 1.15, DE: 1.05, NL: 1.0, BE: 0.95, FR: 0.90, other: 0.90,
};

function applyPremiums(base: { min: number; mid: number; max: number }, input: PricingInput) {
  const geo = GEO_FACTOR[input.geography ?? "NL"] ?? 1.0;
  let { min, mid, max } = base;
  min = Math.round(min * geo);
  mid = Math.round(mid * geo);
  max = Math.round(max * geo);
  // PE-owned client: +20 % — sponsors expect premium consulting
  if (input.peOwned) { min = Math.round(min * 1.2); mid = Math.round(mid * 1.2); max = Math.round(max * 1.2); }
  return { min, mid, max };
}

export async function suggestFee(input: PricingInput): Promise<PricingOutput> {
  const t0 = Date.now();

  // Try DB rules first — most specific match wins
  try {
    const conditions: any[] = [eq(pricingRules.is_active, 1)];
    if (input.geography)  conditions.push(eq(pricingRules.geography,   input.geography));
    if (input.clientSize) conditions.push(eq(pricingRules.client_size, input.clientSize));
    if (input.complexity) conditions.push(eq(pricingRules.complexity,  input.complexity));
    if (input.peOwned != null) conditions.push(eq(pricingRules.pe_owned, input.peOwned ? 1 : 0));

    const rows = await db.select().from(pricingRules).where(and(...conditions)).limit(1);
    if (rows.length > 0) {
      const r = rows[0];
      await logMicroAI({ module_name: "pricingReasoner", latency_ms: Date.now() - t0, saved_tokens_estimate: 500 });
      return {
        feeMin:   r.fee_min ?? 5_000,
        feeMid:   r.fee_mid ?? 10_000,
        feeMax:   r.fee_max ?? 15_000,
        rationale: r.rationale ?? `Rule: ${r.rule_name}`,
        ruleUsed:  r.rule_name,
      };
    }
  } catch {
    // DB error — fall through to hardcoded defaults
  }

  // Hardcoded fallback
  const size = input.clientSize ?? "mid";
  const complexity = input.complexity ?? "medium";
  const sizeTable = DEFAULTS[size] ?? DEFAULTS.mid;
  const baseRange = sizeTable[complexity] ?? sizeTable.medium;
  const { min, mid, max } = applyPremiums(baseRange, input);

  await logMicroAI({ module_name: "pricingReasoner", latency_ms: Date.now() - t0, saved_tokens_estimate: 500 });
  return {
    feeMin: min,
    feeMid: mid,
    feeMax: max,
    rationale: `Baseline: ${size} ${input.geography ?? "NL"} client, ${complexity} complexity${input.peOwned ? ", PE-owned +20%" : ""}`,
  };
}
