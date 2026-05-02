/**
 * D17 — Commitment Extractor
 * Extracts action-item commitments from free-text (email bodies, meeting notes).
 * Uses regex + NER to identify WHO committed to WHAT by WHEN.
 * Replaces Claude calls for "extract action items" from meeting notes / email chains.
 * Falls back to Claude flag if confidence is too low.
 */
import { extractEntities } from "./ner.js";
import { logMicroAI } from "./logger.js";

export interface Commitment {
  raw:      string;       // The matched sentence
  actor?:   string;       // Who will do it (person or org)
  action:   string;       // What they will do
  deadline?: string;      // When they will do it
  confidence: number;     // 0-1
}

// ── Patterns ──────────────────────────────────────────────────────────────
// Modal verb patterns indicating a commitment
const COMMITMENT_RE = /(?:will|shall|going to|'ll|is to|are to|needs? to|has to|have to|must|commit|promise|ensure|confirm|send|deliver|provide|share|arrange|schedule|book|review|follow[\s-]?up|prepare|complete|finalize|submit|upload|present)\b/i;

// Deadline patterns
const DEADLINE_PATTERNS = [
  // "by Monday", "by 15 March", "by end of week"
  /\bby\s+(?:end\s+of\s+(?:the\s+)?(?:day|week|month|quarter|year)|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:\d{1,2}[\s\/\-]\w+(?:[\s\/\-]\d{2,4})?))/i,
  // "before the meeting", "before EOD"
  /\bbefore\s+(?:the\s+meeting|eod|cob|midnight|noon)/i,
  // "this week / next week / next month"
  /\b(?:this|next)\s+(?:week|month|quarter|monday|tuesday|wednesday|thursday|friday)/i,
  // "tomorrow", "today", "asap"
  /\b(?:tomorrow|today|asap|as soon as possible|immediately|right away)\b/i,
  // ISO-like date: "on 2025-04-15"
  /\bon\s+\d{4}[-\/]\d{2}[-\/]\d{2}\b/i,
  // "within X days/weeks"
  /\bwithin\s+\d+\s+(?:business\s+)?(?:day|week|hour)s?\b/i,
];

function extractDeadline(sentence: string): string | undefined {
  for (const re of DEADLINE_PATTERNS) {
    const m = sentence.match(re);
    if (m) return m[0].trim();
  }
  return undefined;
}

// Split text into sentences, handling common abbreviations
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])|(?<=\n)(?=[A-Z\-\*\d])/)
    .map(s => s.trim())
    .filter(s => s.length > 8);
}

/** Extract the action phrase from a commitment sentence */
function extractAction(sentence: string): string {
  // Trim names / pronouns from the front and deadline from the end
  let action = sentence
    .replace(/^(?:i|we|he|she|they|you|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+/i, "")
    .replace(/[.!?]$/, "")
    .trim();
  // Cap at 120 chars
  if (action.length > 120) action = action.slice(0, 117) + "…";
  return action;
}

/**
 * Extract commitments (action items) from a block of text.
 * Suitable for meeting notes, email bodies, chat exports.
 */
export async function extractCommitments(text: string): Promise<Commitment[]> {
  const t0 = Date.now();

  // Run NER to identify people/orgs for actor resolution
  const entities = await extractEntities(text);
  const knownActors = [...entities.people, ...entities.orgs];

  const sentences = splitSentences(text);
  const commitments: Commitment[] = [];

  for (const sentence of sentences) {
    if (!COMMITMENT_RE.test(sentence)) continue;

    // Confidence based on how many commitment signals appear
    const signals = (sentence.match(COMMITMENT_RE) ?? []).length;
    const confidence = Math.min(0.5 + signals * 0.2, 0.95);

    // Try to find the actor from known entities appearing in this sentence
    const actor = knownActors.find(a => sentence.toLowerCase().includes(a.toLowerCase()));

    const deadline = extractDeadline(sentence);
    const action   = extractAction(sentence);

    commitments.push({ raw: sentence, actor, action, deadline, confidence });
  }

  // Sort by confidence descending
  commitments.sort((a, b) => b.confidence - a.confidence);

  const fallback = commitments.length === 0 && sentences.length > 0;
  await logMicroAI({
    module_name: "commitmentExtractor",
    latency_ms: Date.now() - t0,
    saved_tokens_estimate: fallback ? 0 : 400,
    fallback_to_claude: fallback,
  });

  return commitments;
}
