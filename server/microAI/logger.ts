/**
 * Shared telemetry logger for every Micro-AI module.
 * Writes one row to micro_ai_log per call — powers the /admin/micro-ai dashboard.
 * Never throws; logging failures are silently swallowed.
 */
import { db } from "../db.js";
import { microAiLog } from "../../shared/schema.js";

export async function logMicroAI(opts: {
  module_name:           string;
  latency_ms?:           number;
  hit_cache?:            boolean;
  saved_tokens_estimate?: number;
  fallback_to_claude?:   boolean;
}): Promise<void> {
  try {
    await db.insert(microAiLog).values({
      module_name:           opts.module_name,
      called_at:             new Date().toISOString(),
      latency_ms:            opts.latency_ms ?? 0,
      hit_cache:             opts.hit_cache ? 1 : 0,
      saved_tokens_estimate: opts.saved_tokens_estimate ?? 0,
      fallback_to_claude:    opts.fallback_to_claude ? 1 : 0,
    } as any);
  } catch {
    // Non-fatal — logging must never crash the caller.
  }
}
