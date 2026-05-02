/**
 * D18 — Reply Classifier
 * Lexicon-based classification of inbound email replies.
 * Classifies: reply_intent (confirm|decline|question|info_only|negotiate)
 *           + sentiment (positive|neutral|negative)
 *           + urgency (high|medium|low)
 *           + next_action (none|follow_up|schedule_call|send_proposal|escalate)
 * Replaces Claude calls for "classify this reply and suggest next action".
 */
import { classify } from "./classifier.js";
import { logMicroAI } from "./logger.js";

export interface ReplyClassification {
  reply_intent: string;         // confirm | decline | question | info_only | negotiate
  sentiment:    string;         // positive | neutral | negative
  urgency:      string;         // high | medium | low
  next_action:  string;         // none | follow_up | schedule_call | send_proposal | escalate
  confidence:   number;         // 0–1, minimum score for top label
  fallbackNeeded: boolean;
}

// ── Supplementary lexicons (beyond what classifier.ts covers) ────────────
const NEGOTIATE_SIGNALS = [
  "can we reduce", "lower the fee", "discount", "negotiate", "budget constraint",
  "better price", "less expensive", "too high", "cheaper", "adjust the rate",
  "counter-offer", "revised proposal", "alternative pricing",
];

const NEXT_ACTION_MAP: Record<string, string> = {
  // reply_intent → default next action
  confirm:    "none",
  decline:    "follow_up",
  question:   "follow_up",
  info_only:  "none",
  negotiate:  "schedule_call",
};

// Urgency-driven escalation override
const ESCALATE_SIGNALS = [
  "legal", "lawsuit", "complaint", "breach of contract", "sla breach",
  "executive", "ceo", "board", "regulator", "press", "media",
];

/** Classify a single inbound email reply body */
export async function classifyReply(replyText: string): Promise<ReplyClassification> {
  const t0 = Date.now();
  const lower = replyText.toLowerCase();

  // Run all three classifier dimensions in parallel
  const [intentRes, sentRes, urgRes] = await Promise.all([
    classify(replyText, ["confirm", "decline", "question", "info_only"]),
    classify(replyText, ["positive", "neutral", "negative"]),
    classify(replyText, ["high", "medium", "low"]),
  ]);

  // Detect negotiate separately (not in standard intent lexicon)
  const isNegotiate = NEGOTIATE_SIGNALS.some(s => lower.includes(s));

  let reply_intent = intentRes[0].label;
  const confidence = intentRes[0].score;

  if (isNegotiate) reply_intent = "negotiate";

  const sentiment = sentRes[0].label;
  const urgency   = urgRes[0].label;

  // Resolve next action
  let next_action = NEXT_ACTION_MAP[reply_intent] ?? "follow_up";
  // Override: escalation signals always trigger escalate
  if (ESCALATE_SIGNALS.some(s => lower.includes(s))) next_action = "escalate";
  // Override: high urgency + question → schedule_call
  if (urgency === "high" && reply_intent === "question") next_action = "schedule_call";
  // Override: positive confirm + no urgency → nothing needed
  if (reply_intent === "confirm" && sentiment === "positive") next_action = "none";

  // Flag low-confidence results for Claude fallback
  const fallbackNeeded = confidence < 0.35;

  await logMicroAI({
    module_name:           "replyClassifier",
    latency_ms:            Date.now() - t0,
    saved_tokens_estimate: fallbackNeeded ? 0 : 300,
    fallback_to_claude:    fallbackNeeded,
  });

  return { reply_intent, sentiment, urgency, next_action, confidence, fallbackNeeded };
}
