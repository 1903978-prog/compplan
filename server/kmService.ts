/**
 * KM Cycle Service
 * Orchestrates: router → parallel specialists → CEO synthesis.
 * Writes results to km_sessions and km_outputs.
 */
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db.js";
import { sql } from "drizzle-orm";
import { kmSessions, kmOutputs } from "../shared/schema.js";
import { readKmFiles, KM_READ_TOOL_DEF } from "./kmTool.js";
import {
  KM_ROUTER_PROMPT,
  KM_SPECIALIST_PROMPTS,
  KM_SYNTHESIS_PROMPT,
} from "./kmPrompts.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Types ─────────────────────────────────────────────────────────────────────
interface RouterOutput {
  agents_to_call: string[];
  reasoning: string;
}

interface SpecialistResult {
  agentName: string;
  answer: string;
  sources: string[];
  confidence: string;
  rawResponse: string;
}

// ── Router call ───────────────────────────────────────────────────────────────
async function callRouter(userQuery: string): Promise<RouterOutput> {
  const msg = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 512,
    system: KM_ROUTER_PROMPT,
    messages: [{ role: "user", content: userQuery }],
  });
  const raw = (msg.content[0] as any).text ?? "{}";
  try {
    // Strip markdown code fences if present
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed.agents_to_call)) throw new Error("bad schema");
    return parsed as RouterOutput;
  } catch {
    // Fallback: route to misc
    return { agents_to_call: ["misc-agent"], reasoning: "Router parse error; defaulted to misc-agent." };
  }
}

// ── Specialist call with tool loop ────────────────────────────────────────────
async function callSpecialist(
  agentName: string,
  userQuery: string
): Promise<SpecialistResult> {
  const systemPrompt = KM_SPECIALIST_PROMPTS[agentName];
  if (!systemPrompt) {
    return {
      agentName,
      answer: `No system prompt found for agent "${agentName}".`,
      sources: [],
      confidence: "low",
      rawResponse: "",
    };
  }

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userQuery },
  ];

  let finalText = "";
  const MAX_TOOL_ROUNDS = 5;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4096,
      system: systemPrompt,
      tools: [KM_READ_TOOL_DEF as any],
      messages,
    });

    if (response.stop_reason === "end_turn") {
      finalText = response.content
        .filter(b => b.type === "text")
        .map(b => (b as any).text)
        .join("\n");
      break;
    }

    if (response.stop_reason === "tool_use") {
      // Execute all tool calls in this response
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        if (block.name !== "read_km_files") continue;
        const input = block.input as { folder_path: string; query: string };
        let result: object;
        try {
          result = await readKmFiles(input.folder_path, input.query);
        } catch (err: any) {
          result = { error: String(err?.message ?? err) };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      // Push assistant message + tool results
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // Unexpected stop reason — grab any text and exit
    finalText = response.content
      .filter(b => b.type === "text")
      .map(b => (b as any).text)
      .join("\n");
    break;
  }

  // Parse sources and confidence from finalText
  const sources = parseSourcesFromText(finalText);
  const confidence = parseConfidenceFromText(finalText);

  return {
    agentName,
    answer: finalText,
    sources,
    confidence,
    rawResponse: finalText,
  };
}

function parseSourcesFromText(text: string): string[] {
  const sources: string[] = [];
  const lines = text.split("\n");
  let inSources = false;
  for (const line of lines) {
    if (/key sources|sources:/i.test(line)) { inSources = true; continue; }
    if (inSources && line.startsWith("**")) break;
    if (inSources && line.trim().startsWith("- ")) {
      const match = line.match(/^-\s+([^:]+)/);
      if (match) sources.push(match[1].trim());
    }
  }
  return sources.slice(0, 5);
}

function parseConfidenceFromText(text: string): string {
  const match = text.match(/\*\*Confidence:\*\*\s*(high|medium|low)/i);
  return match ? match[1].toLowerCase() : "medium";
}

// ── CEO synthesis ─────────────────────────────────────────────────────────────
async function synthesize(
  userQuery: string,
  results: SpecialistResult[]
): Promise<string> {
  const formatted = results
    .map(r => `### ${r.agentName}\n${r.answer}`)
    .join("\n\n---\n\n");

  const userMsg = `User question: ${userQuery}\n\nSpecialist answers:\n\n${formatted}`;

  const msg = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4096,
    system: KM_SYNTHESIS_PROMPT,
    messages: [{ role: "user", content: userMsg }],
  });
  return (msg.content[0] as any).text ?? "";
}

// ── Main exported function ────────────────────────────────────────────────────
export async function runKmCycle(userQuery: string): Promise<{
  sessionId: string;
  finalAnswer: string;
  sources: string[];
  agentResults: SpecialistResult[];
}> {
  const now = new Date().toISOString();

  // 1. Create session row
  const [sessionRow] = await db
    .insert(kmSessions)
    .values({
      user_query: userQuery,
      status: "running",
      created_at: now,
    } as any)
    .returning();
  const sessionId: string = sessionRow.id;

  try {
    // 2. Router
    const routerOutput = await callRouter(userQuery);
    await db
      .update(kmSessions)
      .set({ router_output: routerOutput as any } as any)
      .where(sql`id = ${sessionId}`);

    // 3. Parallel specialist calls
    const agentsToCall = (routerOutput.agents_to_call ?? []).slice(0, 3);
    const results = await Promise.all(
      agentsToCall.map(name => callSpecialist(name, userQuery))
    );

    // 4. Write specialist outputs
    const outputRows = results.map(r => ({
      session_id: sessionId,
      agent_name: r.agentName,
      answer: r.answer,
      sources: r.sources as any,
      confidence: r.confidence,
      raw_response: r.rawResponse,
      created_at: new Date().toISOString(),
    }));
    if (outputRows.length > 0) {
      await db.insert(kmOutputs).values(outputRows as any);
    }

    // 5. CEO synthesis (skip if only one result with content)
    let finalAnswer: string;
    if (results.length === 1) {
      finalAnswer = results[0].answer;
    } else {
      finalAnswer = await synthesize(userQuery, results);
    }

    // 6. Collect all unique sources
    const allSources = Array.from(new Set(results.flatMap(r => r.sources)));

    // 7. Close session
    await db
      .update(kmSessions)
      .set({
        status: "completed",
        final_answer: finalAnswer,
        total_sources: allSources as any,
        completed_at: new Date().toISOString(),
      } as any)
      .where(sql`id = ${sessionId}`);

    return { sessionId, finalAnswer, sources: allSources, agentResults: results };
  } catch (err: any) {
    // Mark session failed
    await db
      .update(kmSessions)
      .set({
        status: "failed",
        error: String(err?.message ?? err),
        completed_at: new Date().toISOString(),
      } as any)
      .where(sql`id = ${sessionId}`);
    throw err;
  }
}

// ── Fetch session history ─────────────────────────────────────────────────────
export async function getKmSessions(limit = 20) {
  const rows = await db.execute(
    sql`SELECT id, user_query, status, final_answer, total_sources, router_output, created_at, completed_at
        FROM km_sessions ORDER BY created_at DESC LIMIT ${limit}`
  );
  return (rows as any).rows ?? [];
}

export async function getKmSessionDetail(sessionId: string) {
  const [session] = (
    (await db.execute(
      sql`SELECT * FROM km_sessions WHERE id = ${sessionId}`
    )) as any
  ).rows ?? [];

  const outputs = (
    (await db.execute(
      sql`SELECT * FROM km_outputs WHERE session_id = ${sessionId} ORDER BY created_at`
    )) as any
  ).rows ?? [];

  return { session, outputs };
}
