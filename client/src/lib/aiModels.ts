// ── AI model catalog ──────────────────────────────────────────────────────
// Single source of truth for every model the app can address plus the
// per-million-token price used for cost estimation. Prices are USD as of
// April 2026 (public docs). Update this file when providers publish new
// pricing — downstream code (AdminAIModels page, top-bar badge, any
// server-side dispatcher) reads from here.

export type AIProvider = "anthropic" | "openai" | "gemini";

export interface AIModel {
  provider: AIProvider;
  id: string;                    // vendor model ID (used in API calls)
  label: string;                 // user-facing label
  abbrev: string;                // short tag shown in the top bar, 6 chars max
  /** USD per 1M input tokens.  */ inputPerM: number;
  /** USD per 1M output tokens. */ outputPerM: number;
  /** USD per 1M cached-read input tokens (prompt caching). */
  cachedReadPerM?: number;
  contextTokens: number;         // total context window
  notes?: string;                // free-text caveat for the selector row
  recommendedFor?: string[];     // tags to help the user pick
}

export const PROVIDER_LABEL: Record<AIProvider, string> = {
  anthropic: "Claude (Anthropic)",
  openai:    "OpenAI",
  gemini:    "Google Gemini",
};

export const AI_MODELS: AIModel[] = [
  // ── Anthropic (Claude) ──────────────────────────────────────────────
  {
    provider: "anthropic", id: "claude-opus-4-5-20250929", label: "Claude Opus 4.5", abbrev: "Opus4.5",
    inputPerM: 15, outputPerM: 75, cachedReadPerM: 1.5, contextTokens: 1_000_000,
    recommendedFor: ["most demanding reasoning", "long context", "analysis"],
  },
  {
    provider: "anthropic", id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", abbrev: "Son4.5",
    inputPerM: 3, outputPerM: 15, cachedReadPerM: 0.30, contextTokens: 200_000,
    recommendedFor: ["daily use", "balance of speed + quality"],
  },
  {
    provider: "anthropic", id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", abbrev: "Hai4.5",
    inputPerM: 1, outputPerM: 5, cachedReadPerM: 0.10, contextTokens: 200_000,
    recommendedFor: ["cheap bulk jobs", "fast drafts"],
  },
  {
    provider: "anthropic", id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (legacy)", abbrev: "Son4",
    inputPerM: 3, outputPerM: 15, cachedReadPerM: 0.30, contextTokens: 200_000,
    notes: "Older model; prefer 4.5 unless reproducing past outputs.",
  },

  // ── OpenAI ──────────────────────────────────────────────────────────
  {
    provider: "openai", id: "gpt-5", label: "GPT-5", abbrev: "GPT5",
    inputPerM: 10, outputPerM: 40, contextTokens: 400_000,
    recommendedFor: ["reasoning", "tool use"],
  },
  {
    provider: "openai", id: "gpt-5-mini", label: "GPT-5 mini", abbrev: "GPT5m",
    inputPerM: 0.5, outputPerM: 2, contextTokens: 400_000,
    recommendedFor: ["volume", "classification", "extraction"],
  },
  {
    provider: "openai", id: "gpt-4.1", label: "GPT-4.1", abbrev: "GPT41",
    inputPerM: 2, outputPerM: 8, contextTokens: 1_000_000,
    notes: "Long-context flagship before GPT-5 family.",
  },
  {
    provider: "openai", id: "gpt-4o", label: "GPT-4o", abbrev: "GPT4o",
    inputPerM: 2.5, outputPerM: 10, contextTokens: 128_000,
    recommendedFor: ["multimodal"],
  },
  {
    provider: "openai", id: "o3", label: "o3", abbrev: "o3",
    inputPerM: 10, outputPerM: 40, contextTokens: 200_000,
    recommendedFor: ["hard reasoning chains"],
  },
  {
    provider: "openai", id: "o3-mini", label: "o3-mini", abbrev: "o3m",
    inputPerM: 1.1, outputPerM: 4.4, contextTokens: 200_000,
    recommendedFor: ["reasoning at lower cost"],
  },

  // ── Google Gemini ───────────────────────────────────────────────────
  {
    provider: "gemini", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", abbrev: "Gem2.5P",
    inputPerM: 1.25, outputPerM: 10, contextTokens: 2_000_000,
    recommendedFor: ["massive context", "multimodal"],
  },
  {
    provider: "gemini", id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", abbrev: "Gem2.5F",
    inputPerM: 0.30, outputPerM: 2.5, contextTokens: 1_000_000,
    recommendedFor: ["cheap high-volume", "fast"],
  },
  {
    provider: "gemini", id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", abbrev: "GemL",
    inputPerM: 0.10, outputPerM: 0.40, contextTokens: 1_000_000,
    recommendedFor: ["extreme cost sensitivity"],
  },
];

export const DEFAULT_MODEL_ID = "claude-sonnet-4-5-20250929";

// localStorage key used by the AdminAIModels page and the top-bar hook.
// Versioned so we can migrate later without stepping on users' selections.
export const MODEL_SELECTION_KEY = "app_ai_model_v1";

export function findModel(id: string | null | undefined): AIModel | undefined {
  if (!id) return undefined;
  return AI_MODELS.find(m => m.id === id);
}

export function modelsForProvider(provider: AIProvider): AIModel[] {
  return AI_MODELS.filter(m => m.provider === provider);
}
