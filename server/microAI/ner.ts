/**
 * A3 — Local NER
 * Uses the `compromise` library (~1 MB, no model download) for named-entity
 * recognition: people, organisations, dates, money amounts, places.
 * Falls back to empty result if compromise is not installed.
 */
import { logMicroAI } from "./logger.js";

export interface EntityResult {
  people: string[];
  orgs:   string[];
  dates:  string[];
  money:  string[];
  places: string[];
}

let _nlp: any = null;

async function getNlp(): Promise<any | null> {
  if (_nlp) return _nlp;
  try {
    // @ts-ignore — compromise has no bundled types; installed at runtime
    const mod = await import("compromise");
    _nlp = (mod as any).default ?? mod;
    return _nlp;
  } catch (e: any) {
    console.warn("[MicroAI/ner] compromise unavailable:", e?.message);
    return null;
  }
}

/** Extract named entities from arbitrary text. */
export async function extractEntities(text: string): Promise<EntityResult> {
  const t0 = Date.now();
  const nlp = await getNlp();

  if (!nlp) {
    await logMicroAI({ module_name: "ner", latency_ms: Date.now() - t0, fallback_to_claude: true });
    return { people: [], orgs: [], dates: [], money: [], places: [] };
  }

  const doc = nlp(text);
  const unique = (arr: string[]) => Array.from(new Set(arr.map((s: string) => s.trim()).filter(Boolean)));

  const result: EntityResult = {
    people: unique(doc.people().out("array")),
    orgs:   unique(doc.organizations().out("array")),
    dates:  unique(doc.dates().out("array")),
    money:  unique(doc.money().out("array")),
    places: unique(doc.places().out("array")),
  };

  await logMicroAI({ module_name: "ner", latency_ms: Date.now() - t0, saved_tokens_estimate: 150 });
  return result;
}
