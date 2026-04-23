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
