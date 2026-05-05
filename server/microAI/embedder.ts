/**
 * A1 — Local Embedder
 * Uses @xenova/transformers with Xenova/all-MiniLM-L6-v2 (~23 MB, quantized).
 * Lazy-loads on first call (server boot stays fast).
 * Singleton pipeline — subsequent calls reuse the loaded model.
 * Falls back gracefully if @xenova/transformers is not installed.
 *
 * E22 — Embedding Cache is built in via embedCached().
 * Same text never re-embeds within a 90-day window.
 */
import { logMicroAI } from "./logger.js";
import { cached } from "./cache.js";

let _pipeline: any = null;
let _loadError: string | null = null;

async function getPipeline(): Promise<any | null> {
  if (_loadError) return null;
  if (_pipeline) return _pipeline;
  try {
    // Dynamic import so the module is not required at boot.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — @xenova/transformers has no bundled types; installed at runtime
    const { pipeline } = await import("@xenova/transformers");
    _pipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      quantized: true,
    });
    return _pipeline;
  } catch (e: any) {
    _loadError = String(e?.message ?? e);
    console.warn("[MicroAI/embedder] @xenova/transformers unavailable:", _loadError);
    return null;
  }
}

/**
 * Embed a string. Returns a 384-dim Float32Array, or null if the model is unavailable.
 * Logs every call to micro_ai_log.
 */
export async function embed(text: string): Promise<Float32Array | null> {
  const t0 = Date.now();
  const pipe = await getPipeline();
  if (!pipe) {
    await logMicroAI({ module_name: "embedder", latency_ms: Date.now() - t0, fallback_to_claude: false });
    return null;
  }
  const output = await pipe(text, { pooling: "mean", normalize: true });
  await logMicroAI({
    module_name: "embedder",
    latency_ms:  Date.now() - t0,
    saved_tokens_estimate: 50,
  });
  return output.data as Float32Array;
}

/** Cosine similarity between two equal-length float arrays. Range [-1, 1]. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * E22 — Cached embed. Same text → same vector, never re-computed within 90 days.
 * Returns null (not Float32Array) from cache so JSON serialization works;
 * callers should handle null as "model unavailable".
 */
export async function embedCached(text: string): Promise<number[] | null> {
  return cached<number[] | null>(
    "embedder",
    text,
    async () => {
      const vec = await embed(text);
      return vec ? Array.from(vec) : null;
    },
    { ttlDays: 90, savedTokensEstimate: 50 },
  );
}
