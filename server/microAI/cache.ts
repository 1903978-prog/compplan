/**
 * E21 — Response Cache
 * SHA-256 keyed DB cache with configurable TTL.
 * Wraps any async function: same input → same output, never recompute.
 *
 * Usage:
 *   const result = await cached("scorer", input, () => expensiveClaudeCall(input), { ttlDays: 30, savedTokensEstimate: 800 });
 */
import { createHash } from "crypto";
import { db } from "../db.js";
import { aiResponseCache } from "../../shared/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { logMicroAI } from "./logger.js";

export function hashInput(module: string, input: unknown): string {
  const raw = JSON.stringify({ module, input });
  return createHash("sha256").update(raw).digest("hex");
}

export async function cacheGet<T>(hash: string, moduleName: string): Promise<T | null> {
  try {
    const now = new Date().toISOString();
    const rows = await db
      .select()
      .from(aiResponseCache)
      .where(
        and(
          eq(aiResponseCache.input_hash, hash),
          eq(aiResponseCache.module_name, moduleName),
          sql`${aiResponseCache.expires_at} > ${now}`,
        ),
      )
      .limit(1);
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].output_json) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(
  hash: string,
  moduleName: string,
  output: unknown,
  ttlDays = 30,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
    // Delete stale entry then insert — avoids upsert dialect differences.
    await db
      .delete(aiResponseCache)
      .where(
        and(
          eq(aiResponseCache.input_hash, hash),
          eq(aiResponseCache.module_name, moduleName),
        ),
      );
    await db.insert(aiResponseCache).values({
      input_hash:  hash,
      module_name: moduleName,
      output_json: JSON.stringify(output),
      created_at:  now,
      expires_at:  expiresAt,
    } as any);
  } catch {
    // Non-fatal — cache writes must never crash the caller.
  }
}

/**
 * Wrap any async function with cache + telemetry logging.
 * Checks cache first; on miss calls fn(), stores result, logs both paths.
 */
export async function cached<T>(
  module: string,
  input: unknown,
  fn: () => Promise<T>,
  opts?: { ttlDays?: number; savedTokensEstimate?: number },
): Promise<T> {
  const t0 = Date.now();
  const hash = hashInput(module, input);

  const hit = await cacheGet<T>(hash, module);
  if (hit !== null) {
    await logMicroAI({
      module_name:           module,
      latency_ms:            Date.now() - t0,
      hit_cache:             true,
      saved_tokens_estimate: opts?.savedTokensEstimate ?? 0,
    });
    return hit;
  }

  const result = await fn();
  await cacheSet(hash, module, result, opts?.ttlDays ?? 30);
  await logMicroAI({
    module_name:           module,
    latency_ms:            Date.now() - t0,
    hit_cache:             false,
    saved_tokens_estimate: opts?.savedTokensEstimate ?? 0,
  });
  return result;
}

/** Purge all rows whose expires_at is in the past. Returns count deleted. */
export async function pruneExpiredCache(): Promise<number> {
  try {
    const now = new Date().toISOString();
    const result = await db
      .delete(aiResponseCache)
      .where(sql`${aiResponseCache.expires_at} <= ${now}`);
    return (result as any).rowCount ?? 0;
  } catch {
    return 0;
  }
}
