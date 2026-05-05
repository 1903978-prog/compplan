/**
 * MicroAI — Module Registry & Entry Point
 *
 * Central registry for all Wave 1 micro-AI modules.
 * Exports:
 *   MODULE_REGISTRY   — metadata about every module
 *   useLocalAiFirst() — reads USE_LOCAL_AI_FIRST env flag (default true)
 *   Re-exports all public APIs for convenience imports
 */

// ── Feature flag ────────────────────────────────────────────────────────────
/**
 * Returns true when local micro-AI modules should be tried before Claude.
 * Controlled by the USE_LOCAL_AI_FIRST environment variable (default: true).
 */
export function useLocalAiFirst(): boolean {
  const v = process.env.USE_LOCAL_AI_FIRST;
  if (v === undefined || v === null) return true;   // Default ON
  return v.trim().toLowerCase() !== "false" && v !== "0";
}

// ── Module metadata registry ─────────────────────────────────────────────────
export interface ModuleMeta {
  id:               string;
  name:             string;
  wave:             number;
  category:         "nlp" | "reasoning" | "cache" | "scoring" | "compose" | "extract";
  description:      string;
  tokensPerCallSaved: number;   // Estimate of Claude tokens saved per invocation
  file:             string;
}

export const MODULE_REGISTRY: ModuleMeta[] = [
  {
    id:               "A1",
    name:             "Local Embedder",
    wave:             1,
    category:         "nlp",
    description:      "Generates 384-dim embeddings via Xenova/all-MiniLM-L6-v2. Semantic search, dedup, similarity without Claude.",
    tokensPerCallSaved: 300,
    file:             "embedder.js",
  },
  {
    id:               "A2",
    name:             "Classifier",
    wave:             1,
    category:         "nlp",
    description:      "Keyword-lexicon classification for urgency, sentiment, intent, reply_status. Zero-shot fallback via distilbert-mnli.",
    tokensPerCallSaved: 200,
    file:             "classifier.js",
  },
  {
    id:               "A3",
    name:             "NER",
    wave:             1,
    category:         "nlp",
    description:      "Named-entity recognition (people, orgs, dates, money, places) via compromise.js. ~1 MB, no model download.",
    tokensPerCallSaved: 150,
    file:             "ner.js",
  },
  {
    id:               "B7",
    name:             "Scoring Engine",
    wave:             1,
    category:         "scoring",
    description:      "Pure SQL aggregations for the 6-dimension CHRO agent scorecard. No LLM.",
    tokensPerCallSaved: 800,
    file:             "scoring.js",
  },
  {
    id:               "B8",
    name:             "Pricing Reasoner",
    wave:             1,
    category:         "reasoning",
    description:      "Decision-tree fee estimation: geography × client size × complexity × PE-ownership. DB rules first, hardcoded fallback.",
    tokensPerCallSaved: 500,
    file:             "pricingReasoner.js",
  },
  {
    id:               "B9",
    name:             "Decision-Right Assigner",
    wave:             1,
    category:         "reasoning",
    description:      "Maps action descriptors to L0–L3 approval levels via pure regex rules. Zero latency, zero LLM.",
    tokensPerCallSaved: 200,
    file:             "decisionRights.js",
  },
  {
    id:               "C13",
    name:             "Email Composer",
    wave:             1,
    category:         "compose",
    description:      "20 slot-based email templates for BD, hiring, delivery, internal, and vendor comms.",
    tokensPerCallSaved: 600,
    file:             "emailComposer.js",
  },
  {
    id:               "D17",
    name:             "Commitment Extractor",
    wave:             1,
    category:         "extract",
    description:      "Regex + NER extraction of action-item commitments (who, what, when) from emails and meeting notes.",
    tokensPerCallSaved: 400,
    file:             "commitmentExtractor.js",
  },
  {
    id:               "D18",
    name:             "Reply Classifier",
    wave:             1,
    category:         "nlp",
    description:      "Classifies inbound email replies: intent, sentiment, urgency, next-action. Lexicon-based, no LLM.",
    tokensPerCallSaved: 300,
    file:             "replyClassifier.js",
  },
  {
    id:               "E21",
    name:             "Response Cache",
    wave:             1,
    category:         "cache",
    description:      "SHA-256 keyed DB cache for any module output. 30-day TTL, auto-prune.",
    tokensPerCallSaved: 0,   // Passthrough — saves whatever the underlying module saves
    file:             "cache.js",
  },
  {
    id:               "E22",
    name:             "Embedding Cache",
    wave:             1,
    category:         "cache",
    description:      "Caches embedding vectors (90-day TTL) so the same text is never re-embedded.",
    tokensPerCallSaved: 300,
    file:             "embedder.js",   // Provided by embedCached() in embedder.ts
  },
  {
    id:               "E23",
    name:             "Context Pre-loader",
    wave:             1,
    category:         "cache",
    description:      "Memoized agent context loader (in-process). One DB query replaces a ~4k-token context prefix per call.",
    tokensPerCallSaved: 4_000,
    file:             "contextLoader.js",
  },
];

/** Total estimated tokens saved per full AIOS cycle (all modules × avg call frequency) */
export function estimatedDailySavings(): number {
  // Conservative: each module called ~20× per day on average
  return MODULE_REGISTRY.reduce((sum, m) => sum + m.tokensPerCallSaved * 20, 0);
}

// ── Re-exports ───────────────────────────────────────────────────────────────
export { embed, cosineSimilarity, embedCached } from "./embedder.js";
export { classify } from "./classifier.js";
export { extractEntities } from "./ner.js";
export { scoreAgent } from "./scoring.js";
export { suggestFee } from "./pricingReasoner.js";
export { assignLevel, levelToSchema, schemaToLevel } from "./decisionRights.js";
export { composeEmail, findTemplate, listTemplates } from "./emailComposer.js";
export { extractCommitments } from "./commitmentExtractor.js";
export { classifyReply } from "./replyClassifier.js";
export { cached, cacheGet, cacheSet, hashInput, pruneExpiredCache } from "./cache.js";
export { loadAgentContext, formatContextBlock, clearContextCache } from "./contextLoader.js";
export { logMicroAI } from "./logger.js";
