/**
 * A2 — Local Classifier Hub
 * Keyword-lexicon classification for known categories (urgency, sentiment, intent).
 * Falls back to @xenova/transformers zero-shot for unknown label sets.
 * Claude fallback preserved via USE_LOCAL_AI_FIRST flag.
 */
import { logMicroAI } from "./logger.js";

export interface ClassifierResult {
  label: string;
  score: number;  // [0, 1], sums to 1 across results
}

// ── Keyword lexicons for common categories ──────────────────────────────────
const LEXICON: Record<string, Record<string, string[]>> = {
  urgency: {
    high:   ["urgent", "asap", "immediately", "critical", "blocking", "overdue", "emergency", "deadline today", "action required"],
    medium: ["soon", "this week", "priority", "important", "follow up", "reminder", "please respond"],
    low:    ["whenever", "no rush", "fyi", "for your info", "nice to have", "when you get a chance"],
  },
  sentiment: {
    positive: ["great", "excellent", "perfect", "happy", "pleased", "good news", "success", "won", "signed", "delighted", "thrilled"],
    negative: ["disappointed", "problem", "issue", "concern", "unhappy", "lost", "cancelled", "delay", "wrong", "failed", "rejected"],
    neutral:  ["noted", "understood", "received", "ok", "acknowledged"],
  },
  intent: {
    request:  ["can you", "could you", "please", "would you", "i need", "we need", "help with", "asking you to"],
    confirm:  ["confirmed", "agreed", "yes", "correct", "approved", "sounds good", "let's go", "proceed"],
    decline:  ["no", "not possible", "can't", "unable", "decline", "not interested", "pass", "won't"],
    question: ["?", "what", "when", "where", "who", "why", "how"],
  },
  reply_status: {
    completed: ["done", "completed", "finished", "delivered", "resolved", "signed off", "paid"],
    blocked:   ["blocked", "stuck", "waiting for", "on hold", "escalate", "dependency", "no response"],
    at_risk:   ["delay", "delayed", "behind", "struggling", "concern", "at risk", "might miss", "tight"],
    on_track:  ["on track", "progressing", "going well", "good progress", "as planned", "in progress"],
  },
};

function labelKeys(cats: Record<string, string[]>): string[] {
  return Object.keys(cats);
}

function keywordScore(text: string, cats: Record<string, string[]>): ClassifierResult[] {
  const lower = text.toLowerCase();
  const raw: { label: string; hits: number }[] = Object.entries(cats).map(([label, kws]) => ({
    label,
    hits: kws.filter(kw => lower.includes(kw)).length,
  }));
  const total = raw.reduce((s, r) => s + r.hits, 0);
  if (total === 0) {
    // No keyword match — return uniform distribution
    const n = raw.length;
    return raw.map(r => ({ label: r.label, score: 1 / n })).sort((a, b) => b.score - a.score);
  }
  return raw
    .map(r => ({ label: r.label, score: r.hits / total }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Classify text against the provided label set.
 * Returns sorted [{label, score}] where scores sum to ~1.
 */
export async function classify(text: string, labels: string[]): Promise<ClassifierResult[]> {
  const t0 = Date.now();

  // Check if labels match a known lexicon exactly
  for (const [, cats] of Object.entries(LEXICON)) {
    const known = labelKeys(cats);
    if (labels.length === known.length && labels.every(l => known.includes(l))) {
      const results = keywordScore(text, Object.fromEntries(labels.map(l => [l, cats[l] ?? []])));
      await logMicroAI({ module_name: "classifier", latency_ms: Date.now() - t0, saved_tokens_estimate: 200 });
      return results;
    }
  }

  // Unknown label set — try @xenova/transformers zero-shot
  try {
    // @ts-ignore — @xenova/transformers has no bundled types; installed at runtime
    const { pipeline } = await import("@xenova/transformers");
    const zs = await pipeline("zero-shot-classification", "Xenova/distilbert-base-uncased-mnli");
    const out: any = await zs(text, labels);
    const results: ClassifierResult[] = (out.labels as string[]).map((label: string, i: number) => ({
      label,
      score: (out.scores as number[])[i],
    }));
    await logMicroAI({ module_name: "classifier", latency_ms: Date.now() - t0, saved_tokens_estimate: 300 });
    return results.sort((a, b) => b.score - a.score);
  } catch {
    // Final fallback — equal distribution, flag for Claude
    await logMicroAI({
      module_name: "classifier",
      latency_ms:  Date.now() - t0,
      saved_tokens_estimate: 0,
      fallback_to_claude: true,
    });
    return labels.map(label => ({ label, score: 1 / labels.length }));
  }
}
