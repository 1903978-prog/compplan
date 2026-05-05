/**
 * E23 — Context Pre-loader
 * Loads agent + last N deliverables + objectives + conflicts in one pass.
 * Memoized per cycle_id to avoid repeat DB hits within the same AIOS cycle.
 * Replaces the 4k-token context-building prefix that was prepended to every
 * Claude call in the daily cycle.
 *
 * Cache is in-process (Map) — intentionally volatile. It resets on server
 * restart and is keyed by (agentId, cycleId) so stale data never leaks
 * across cycles.
 */
import { db } from "../db.js";
import { agents as agentsTable, objectives as objectivesTable, conflicts as conflictsTable, aiosDeliverables } from "../../shared/schema.js";
import { eq, desc } from "drizzle-orm";
import { logMicroAI } from "./logger.js";

export interface AgentContext {
  agent: {
    id:          number;
    name:        string;
    mission?:    string | null;
    decision_rights_autonomous?: string | null;
    decision_rights_livio?:      string | null;
  };
  objectives: Array<{
    id:     number;
    title:  string;
    status: string | null;
  }>;
  recentDeliverables: Array<{
    id:          number;
    title:       string;
    status:      string | null;
    total_score: number | null;
    created_at:  string | null;
  }>;
  openConflicts: Array<{
    id:    number;
    title: string;
  }>;
  loadedAt: string;  // ISO timestamp
}

// In-process memoization: Map<`${agentId}:${cycleId}`, AgentContext>
const CACHE = new Map<string, AgentContext>();

/** Clear the entire in-process context cache (e.g. at cycle boundary). */
export function clearContextCache(): void {
  CACHE.clear();
}

/** Remove a single entry from the cache. */
export function evictContext(agentId: number, cycleId: number): void {
  CACHE.delete(`${agentId}:${cycleId}`);
}

/**
 * Load (or return cached) rich context for one agent within a given cycle.
 * @param agentId   agent.id (integer PK)
 * @param cycleId   aios_cycles.id — used as the cache scope key
 * @param lastN     Number of recent deliverables to include (default 20)
 */
export async function loadAgentContext(
  agentId: number,
  cycleId: number,
  lastN = 20,
): Promise<AgentContext> {
  const t0 = Date.now();
  const cacheKey = `${agentId}:${cycleId}`;

  if (CACHE.has(cacheKey)) {
    await logMicroAI({
      module_name: "contextLoader",
      latency_ms:  Date.now() - t0,
      hit_cache:   true,
      saved_tokens_estimate: 4_000,
    });
    return CACHE.get(cacheKey)!;
  }

  // Load agent, objectives, recent deliverables, open conflicts in parallel
  const [agentRows, objRows, delivRows, conflictRows] = await Promise.all([
    db.select({
      id:                          agentsTable.id,
      name:                        agentsTable.name,
      mission:                     agentsTable.mission,
      decision_rights_autonomous:  agentsTable.decision_rights_autonomous,
      decision_rights_livio:       agentsTable.decision_rights_livio,
    }).from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1),

    db.select({
      id:     objectivesTable.id,
      title:  objectivesTable.title,
      status: objectivesTable.status,
    }).from(objectivesTable).where(eq(objectivesTable.agent_id, agentId)),

    db.select({
      id:          aiosDeliverables.id,
      title:       aiosDeliverables.title,
      status:      aiosDeliverables.status,
      total_score: aiosDeliverables.total_score,
      created_at:  aiosDeliverables.created_at,
    }).from(aiosDeliverables)
      .where(eq(aiosDeliverables.agent_id, agentId))
      .orderBy(desc(aiosDeliverables.created_at))
      .limit(lastN),

    // conflicts table has no agent FK — load recent open conflicts globally
    db.select({
      id:    conflictsTable.id,
      title: conflictsTable.title,
    }).from(conflictsTable)
      .where(eq(conflictsTable.status, "open"))
      .limit(10),
  ]);

  if (agentRows.length === 0) {
    throw new Error(`contextLoader: agent ${agentId} not found`);
  }

  const ctx: AgentContext = {
    agent:              agentRows[0],
    objectives:         objRows,
    recentDeliverables: delivRows,
    openConflicts:      conflictRows,
    loadedAt:           new Date().toISOString(),
  };

  CACHE.set(cacheKey, ctx);

  await logMicroAI({
    module_name: "contextLoader",
    latency_ms:  Date.now() - t0,
    hit_cache:   false,
    saved_tokens_estimate: 4_000,
  });

  return ctx;
}

/**
 * Format the loaded context as a compact text block suitable for inserting
 * into a prompt (replaces the ~4k token context prefix).
 */
export function formatContextBlock(ctx: AgentContext): string {
  const lines: string[] = [
    `## Agent: ${ctx.agent.name} (id=${ctx.agent.id})`,
    ctx.agent.mission ? `Mission: ${ctx.agent.mission}` : "",
    "",
    `### Objectives (${ctx.objectives.length})`,
    ...ctx.objectives.map(o => `- [${o.status ?? "?"}] ${o.title}`),
    "",
    `### Recent deliverables (last ${ctx.recentDeliverables.length})`,
    ...ctx.recentDeliverables.map(d =>
      `- [${d.status ?? "?"}] ${d.title}${d.total_score != null ? ` (score: ${d.total_score})` : ""}`
    ),
    "",
    `### Open conflicts (${ctx.openConflicts.length})`,
    ...ctx.openConflicts.map(c => `- ${c.title}`),
  ];
  return lines.filter(l => l !== undefined).join("\n");
}
