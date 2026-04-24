// ── Unified AI provider interface ────────────────────────────────────────
// Gives the server a single call shape (generateText) that maps onto any
// of the supported providers — Anthropic (SDK), OpenAI, or Google Gemini
// (REST). New providers only need to implement the same tiny interface.
//
// This module is intentionally thin: it covers the 80% case (chat-style
// completion with system + user message) so callers can migrate off
// Anthropic-hardcoded code incrementally. Tool calls / streaming are NOT
// here yet — if a call site needs either, keep using the provider-
// specific SDK directly for that path.

import Anthropic from "@anthropic-ai/sdk";

export type ProviderId = "anthropic" | "openai" | "gemini";

export interface GenerateTextInput {
  provider: ProviderId;
  model: string;              // vendor model ID, e.g. "gemini-2.5-flash"
  system?: string;            // optional system instruction
  prompt: string;             // user message
  maxTokens?: number;         // defaults to 2048
  temperature?: number;       // defaults to 0.7
}

export interface GenerateTextOutput {
  text: string;               // model reply
  provider: ProviderId;
  model: string;
  /** Rough token counts from the provider's usage metadata (when available). */
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  raw?: unknown;              // raw response for debugging (omit in prod logs)
}

/** Thrown when the provider's API key env var is not set. */
export class MissingApiKeyError extends Error {
  constructor(public provider: ProviderId, public envVar: string) {
    super(`${provider} is missing env var ${envVar}`);
    this.name = "MissingApiKeyError";
  }
}

/** Thrown when the provider returns a non-2xx response or a malformed body. */
export class ProviderError extends Error {
  constructor(public provider: ProviderId, public status: number, message: string) {
    super(`${provider} returned ${status}: ${message}`);
    this.name = "ProviderError";
  }
}

// ── Anthropic (Claude) ─────────────────────────────────────────────────────
async function generateAnthropic(input: GenerateTextInput): Promise<GenerateTextOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new MissingApiKeyError("anthropic", "ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: input.model,
    max_tokens: input.maxTokens ?? 2048,
    temperature: input.temperature,
    system: input.system,
    messages: [{ role: "user", content: input.prompt }],
  });
  const textBlock = resp.content.find((b: any) => b.type === "text");
  const text = (textBlock && "text" in textBlock) ? String(textBlock.text) : "";
  return {
    text,
    provider: "anthropic",
    model: input.model,
    usage: {
      input_tokens: resp.usage?.input_tokens,
      output_tokens: resp.usage?.output_tokens,
      total_tokens: (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
    },
  };
}

// ── OpenAI ─────────────────────────────────────────────────────────────────
// Uses the plain REST `/v1/chat/completions` endpoint so we don't need the
// openai SDK. Compatible with GPT-4.1, GPT-4o, GPT-5, o3, o3-mini, etc.
async function generateOpenAI(input: GenerateTextInput): Promise<GenerateTextOutput> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new MissingApiKeyError("openai", "OPENAI_API_KEY");
  const messages: { role: "system" | "user"; content: string }[] = [];
  if (input.system) messages.push({ role: "system", content: input.system });
  messages.push({ role: "user", content: input.prompt });
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages,
      max_tokens: input.maxTokens ?? 2048,
      temperature: input.temperature ?? 0.7,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "<no body>");
    throw new ProviderError("openai", resp.status, body.slice(0, 500));
  }
  const json: any = await resp.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  return {
    text,
    provider: "openai",
    model: input.model,
    usage: {
      input_tokens: json?.usage?.prompt_tokens,
      output_tokens: json?.usage?.completion_tokens,
      total_tokens: json?.usage?.total_tokens,
    },
  };
}

// ── Google Gemini ──────────────────────────────────────────────────────────
// Uses the v1beta REST endpoint. Docs:
// https://ai.google.dev/api/rest/v1beta/models/generateContent
// The API key is passed as a query parameter (Google's standard scheme),
// NOT in an Authorization header.
async function generateGemini(input: GenerateTextInput): Promise<GenerateTextOutput> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new MissingApiKeyError("gemini", "GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body: any = {
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
    generationConfig: {
      maxOutputTokens: input.maxTokens ?? 2048,
      temperature: input.temperature ?? 0.7,
    },
  };
  if (input.system) {
    body.systemInstruction = { parts: [{ text: input.system }] };
  }
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "<no body>");
    throw new ProviderError("gemini", resp.status, errText.slice(0, 500));
  }
  const json: any = await resp.json();
  // Concat every text part in the first candidate — some Gemini responses
  // split long outputs across multiple parts.
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p: any) => typeof p?.text === "string" ? p.text : "").join("");
  return {
    text,
    provider: "gemini",
    model: input.model,
    usage: {
      input_tokens: json?.usageMetadata?.promptTokenCount,
      output_tokens: json?.usageMetadata?.candidatesTokenCount,
      total_tokens: json?.usageMetadata?.totalTokenCount,
    },
  };
}

// ── Public dispatcher ──────────────────────────────────────────────────────
export async function generateText(input: GenerateTextInput): Promise<GenerateTextOutput> {
  switch (input.provider) {
    case "anthropic": return generateAnthropic(input);
    case "openai":    return generateOpenAI(input);
    case "gemini":    return generateGemini(input);
    default:
      throw new Error(`Unknown provider: ${input.provider}`);
  }
}

/** Which providers are usable right now (i.e. have their API key set)? */
export function providerStatus(): Record<ProviderId, { configured: boolean; envVar: string }> {
  return {
    anthropic: { configured: !!process.env.ANTHROPIC_API_KEY, envVar: "ANTHROPIC_API_KEY" },
    openai:    { configured: !!process.env.OPENAI_API_KEY,    envVar: "OPENAI_API_KEY" },
    gemini:    { configured: !!(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY), envVar: "GEMINI_API_KEY" },
  };
}

// ── Structured JSON output ────────────────────────────────────────────────
// Each provider has its own way of guaranteeing a parseable JSON response:
//   • Anthropic: a forced tool call with input_schema
//   • OpenAI: response_format = { type: "json_schema", ... } (or json_object)
//   • Gemini: generationConfig.responseMimeType = "application/json" + responseSchema
// This helper wraps all three so the caller just passes a JSON schema and
// gets a parsed object back — no provider-specific code in call sites.

/**
 * A subset of JSON-schema that every provider understands. Intentionally
 * limited — don't add anyOf/oneOf until you've confirmed all three back-
 * ends support it. For most consulting-app use cases (proposal analysis,
 * briefing extraction, scoring) a plain object with typed properties is
 * enough.
 */
export interface JsonSchema {
  type: "object";
  properties: Record<string, any>;
  required?: string[];
  description?: string;
}

export interface GenerateJSONInput<_T = any> {
  provider: ProviderId;
  model: string;
  system?: string;
  prompt: string;
  /** Name the tool / function. Used by Anthropic (tool name) and OpenAI
   *  (tool function name) — Gemini ignores it but logs better with one. */
  toolName?: string;
  /** What the tool/function does, in natural language. */
  toolDescription?: string;
  schema: JsonSchema;
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateJSONOutput<T = any> {
  data: T;                    // parsed payload matching the schema
  provider: ProviderId;
  model: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  raw?: unknown;
}

// ── Anthropic: forced tool call ────────────────────────────────────────────
async function generateJSONAnthropic<T>(input: GenerateJSONInput<T>): Promise<GenerateJSONOutput<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new MissingApiKeyError("anthropic", "ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey });
  const toolName = input.toolName || "submit_response";
  const tool = {
    name: toolName,
    description: input.toolDescription || "Submit the structured response.",
    input_schema: input.schema as any,
  };
  const resp = await client.messages.create({
    model: input.model,
    max_tokens: input.maxTokens ?? 4096,
    temperature: input.temperature,
    system: input.system,
    tools: [tool],
    tool_choice: { type: "tool", name: toolName },
    messages: [{ role: "user", content: input.prompt }],
  });
  const toolUse = resp.content.find((b: any) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new ProviderError("anthropic", 0, "Anthropic did not return a tool_use block");
  }
  return {
    data: (toolUse as any).input as T,
    provider: "anthropic",
    model: input.model,
    usage: {
      input_tokens: resp.usage?.input_tokens,
      output_tokens: resp.usage?.output_tokens,
      total_tokens: (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
    },
  };
}

// ── OpenAI: response_format json_schema (Structured Outputs) ──────────────
async function generateJSONOpenAI<T>(input: GenerateJSONInput<T>): Promise<GenerateJSONOutput<T>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new MissingApiKeyError("openai", "OPENAI_API_KEY");
  const messages: { role: "system" | "user"; content: string }[] = [];
  if (input.system) messages.push({ role: "system", content: input.system });
  messages.push({ role: "user", content: input.prompt });
  // OpenAI strict-mode requires EVERY nested object to (a) set
  // `additionalProperties: false` and (b) list every property in its
  // `required[]` array. Callers usually write minimal JSON Schema
  // without these, so we walk the tree and fill them in. Without this
  // normalisation, OpenAI 400s any non-trivial schema (e.g. the
  // proposal analysis tool with nested team + options arrays).
  const normaliseForStrictMode = (s: any): any => {
    if (!s || typeof s !== "object") return s;
    const out: any = { ...s };
    if (out.type === "object" && out.properties && typeof out.properties === "object") {
      // Every property must be listed in required[] under strict mode.
      out.required = Object.keys(out.properties);
      out.additionalProperties = false;
      out.properties = Object.fromEntries(
        Object.entries(out.properties).map(([k, v]) => [k, normaliseForStrictMode(v)]),
      );
    }
    if (out.type === "array" && out.items) {
      out.items = normaliseForStrictMode(out.items);
    }
    return out;
  };
  const schemaWithStrict = normaliseForStrictMode(input.schema);
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages,
      max_tokens: input.maxTokens ?? 4096,
      temperature: input.temperature ?? 0.7,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: input.toolName || "response",
          schema: schemaWithStrict,
          strict: true,
        },
      },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "<no body>");
    throw new ProviderError("openai", resp.status, body.slice(0, 500));
  }
  const json: any = await resp.json();
  const content = json?.choices?.[0]?.message?.content ?? "";
  let parsed: T;
  try {
    parsed = JSON.parse(content);
  } catch (e: any) {
    throw new ProviderError("openai", 0, `OpenAI returned invalid JSON: ${String(e?.message ?? e).slice(0, 200)}`);
  }
  return {
    data: parsed,
    provider: "openai",
    model: input.model,
    usage: {
      input_tokens: json?.usage?.prompt_tokens,
      output_tokens: json?.usage?.completion_tokens,
      total_tokens: json?.usage?.total_tokens,
    },
  };
}

// ── Gemini: responseMimeType + responseSchema ─────────────────────────────
async function generateJSONGemini<T>(input: GenerateJSONInput<T>): Promise<GenerateJSONOutput<T>> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new MissingApiKeyError("gemini", "GEMINI_API_KEY");
  // Gemini's schema dialect uses SCREAMING-CASE types (STRING, OBJECT, ARRAY).
  // We accept standard JSON-schema lowercase and up-case here for the user.
  const toGeminiSchema = (s: any): any => {
    if (!s || typeof s !== "object") return s;
    const out: any = { ...s };
    if (typeof out.type === "string") out.type = out.type.toUpperCase();
    if (out.properties) {
      out.properties = Object.fromEntries(
        Object.entries(out.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
      );
    }
    if (out.items) out.items = toGeminiSchema(out.items);
    // Gemini doesn't like additionalProperties; strip it.
    delete out.additionalProperties;
    return out;
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body: any = {
    contents: [{ role: "user", parts: [{ text: input.prompt }] }],
    generationConfig: {
      maxOutputTokens: input.maxTokens ?? 4096,
      temperature: input.temperature ?? 0.7,
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(input.schema),
    },
  };
  if (input.system) body.systemInstruction = { parts: [{ text: input.system }] };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "<no body>");
    throw new ProviderError("gemini", resp.status, errText.slice(0, 500));
  }
  const json: any = await resp.json();
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p: any) => typeof p?.text === "string" ? p.text : "").join("");
  let parsed: T;
  try {
    parsed = JSON.parse(text);
  } catch (e: any) {
    throw new ProviderError("gemini", 0, `Gemini returned non-JSON body: ${text.slice(0, 200)}`);
  }
  return {
    data: parsed,
    provider: "gemini",
    model: input.model,
    usage: {
      input_tokens: json?.usageMetadata?.promptTokenCount,
      output_tokens: json?.usageMetadata?.candidatesTokenCount,
      total_tokens: json?.usageMetadata?.totalTokenCount,
    },
  };
}

/** Dispatcher — picks the right provider-specific implementation. */
export async function generateJSON<T = any>(input: GenerateJSONInput<T>): Promise<GenerateJSONOutput<T>> {
  switch (input.provider) {
    case "anthropic": return generateJSONAnthropic<T>(input);
    case "openai":    return generateJSONOpenAI<T>(input);
    case "gemini":    return generateJSONGemini<T>(input);
    default:
      throw new Error(`Unknown provider: ${input.provider}`);
  }
}

// ── Active-model resolver ─────────────────────────────────────────────────
// A call site that wants to use the "currently selected model" but has no
// direct access to the client preference calls this. Priority order:
//   1. Explicit preference passed in (from the HTTP request body/header)
//   2. Env var ACTIVE_AI_PROVIDER / ACTIVE_AI_MODEL (set on Render for a
//      stable default across all calls)
//   3. Hardcoded default: Anthropic Sonnet 4.5 — matches what the pre-
//      migration code used, so no behavioural change until the user
//      actively picks something else.
export interface ActiveModel { provider: ProviderId; model: string }

const DEFAULT_ACTIVE: ActiveModel = { provider: "anthropic", model: "claude-sonnet-4-5-20250929" };

export function resolveActiveModel(
  explicit?: { provider?: string | null; model?: string | null },
): ActiveModel {
  const p = (explicit?.provider as ProviderId | undefined) ?? (process.env.ACTIVE_AI_PROVIDER as ProviderId | undefined);
  const m = explicit?.model ?? process.env.ACTIVE_AI_MODEL ?? null;
  if (p && m && (p === "anthropic" || p === "openai" || p === "gemini")) {
    return { provider: p, model: m };
  }
  return DEFAULT_ACTIVE;
}
