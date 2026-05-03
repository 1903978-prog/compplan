// Template engine for AIOS agents.
//
// Templates are markdown files with YAML frontmatter living under
// server/microAI/templates/<agent>/<slug>.md. They version with the
// repo so the President can read/edit them as plain text.
//
// Mustache-style:
//   {{slot}}                  — substitution (dotted access supported)
//   {{#each list}}...{{/each}} — loop; inner can use {{prop}} of each item
//
// Token economics: render() touches no LLM. Use renderOrFallback (in
// templateOrClaude.ts) when a slot is genuinely creative and you want
// to fall back to Claude only for that one missing piece.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, "templates");

export type TemplateOutput = "markdown" | "email" | "json";

export interface TemplateMeta {
  /** Display name from frontmatter. */
  name: string;
  /** Owning agent slug, e.g. "ceo_agent". */
  agent: string;
  /** Human-readable trigger condition. */
  trigger: string;
  /** Required slot names. */
  slots: string[];
  /** Output kind — affects how the admin UI renders the preview. */
  output: TemplateOutput;
  /** Slug = filename without .md. Filled by the loader. */
  slug: string;
}

export interface RenderedTemplate {
  meta: TemplateMeta;
  body: string;
  /** Slot names that were declared in frontmatter but not provided. */
  missingSlots: string[];
}

// ─── Frontmatter parser ───────────────────────────────────────────────
// Tiny YAML-ish parser tuned to our specific frontmatter shape. We only
// support `key: value` and `key: [a, b, c]`. Avoids pulling in a YAML
// dep just for ~5 fields.
function parseFrontmatter(raw: string): { meta: Omit<TemplateMeta, "slug">; body: string } {
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!fmMatch) {
    throw new Error("Template missing YAML frontmatter (--- block)");
  }
  const fmText = fmMatch[1];
  const body   = fmMatch[2];

  const meta: Record<string, unknown> = {
    name: "",
    agent: "",
    trigger: "",
    slots: [],
    output: "markdown",
  };
  for (const rawLine of fmText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\w+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val: string = m[2].trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val.startsWith("[") && val.endsWith("]")) {
      const inside = val.slice(1, -1).trim();
      meta[key] = inside === ""
        ? []
        : inside.split(",").map(s => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    } else {
      meta[key] = val;
    }
  }

  return {
    meta: {
      name:    String(meta.name ?? ""),
      agent:   String(meta.agent ?? ""),
      trigger: String(meta.trigger ?? ""),
      slots:   Array.isArray(meta.slots) ? meta.slots as string[] : [],
      output:  ((meta.output as TemplateOutput) ?? "markdown"),
    },
    body: body.replace(/^\r?\n+/, "").replace(/\r?\n+$/, "\n"),
  };
}

// ─── Loaders ──────────────────────────────────────────────────────────
export function loadTemplate(agent: string, slug: string): { meta: TemplateMeta; body: string } {
  const file = path.join(TEMPLATES_DIR, agent, `${slug}.md`);
  const raw  = fs.readFileSync(file, "utf8");
  const { meta, body } = parseFrontmatter(raw);
  return { meta: { ...meta, slug }, body };
}

export function listTemplates(agent?: string): TemplateMeta[] {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  const out: TemplateMeta[] = [];
  const agents = agent
    ? [agent]
    : fs.readdirSync(TEMPLATES_DIR).filter(name => {
        const p = path.join(TEMPLATES_DIR, name);
        return fs.statSync(p).isDirectory();
      });
  for (const a of agents) {
    const dir = path.join(TEMPLATES_DIR, a);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const slug = f.replace(/\.md$/, "");
      try {
        const { meta } = loadTemplate(a, slug);
        out.push(meta);
      } catch (err) {
        console.error(`Failed to load template ${a}/${f}:`, err);
      }
    }
  }
  return out.sort((a, b) =>
    a.agent.localeCompare(b.agent) || a.name.localeCompare(b.name),
  );
}

// ─── Validation ───────────────────────────────────────────────────────
export function validateSlots(
  meta: TemplateMeta,
  slots: Record<string, unknown>,
): string[] {
  return meta.slots.filter(name => {
    const v = slots[name];
    if (v === undefined || v === null) return true;
    if (typeof v === "string" && v.trim() === "") return true;
    return false;
  });
}

// ─── Renderer ─────────────────────────────────────────────────────────
function resolvePath(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>(
    (acc, key) => (acc == null || typeof acc !== "object")
      ? undefined
      : (acc as Record<string, unknown>)[key],
    obj,
  );
}

function renderBody(template: string, ctx: Record<string, unknown>): string {
  // Process each blocks first. Match outermost {{#each X}}...{{/each}}.
  // We use a non-greedy match and run iteratively in case of multiple
  // independent each-blocks. Nested each-blocks: the recursion through
  // renderBody on the inner content handles those.
  const eachRx = /\{\{#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;
  let out = template.replace(eachRx, (_m, key: string, inner: string) => {
    const list = resolvePath(ctx, key);
    if (!Array.isArray(list)) return "";
    return list
      .map(item => {
        const itemCtx = (item && typeof item === "object")
          ? { ...ctx, ...(item as Record<string, unknown>) }
          : { ...ctx, this: item };
        return renderBody(inner, itemCtx);
      })
      .join("");
  });
  // Simple substitutions
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = resolvePath(ctx, key);
    if (v === undefined || v === null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  });
  return out;
}

export function render(
  agent: string,
  slug: string,
  slots: Record<string, unknown>,
): RenderedTemplate {
  const { meta, body } = loadTemplate(agent, slug);
  const missingSlots = validateSlots(meta, slots);
  const rendered = renderBody(body, slots);
  return { meta, body: rendered, missingSlots };
}

// ─── Edit (writeback) ─────────────────────────────────────────────────
// Used by the admin UI's Edit button. In production (Render) writes
// are ephemeral — they survive until the next deploy. For permanent
// changes, edit the file in the repo and redeploy.
export function saveTemplate(
  agent: string,
  slug: string,
  rawContent: string,
): void {
  const dir  = path.join(TEMPLATES_DIR, agent);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.md`);
  fs.writeFileSync(file, rawContent, "utf8");
}

export function loadTemplateRaw(agent: string, slug: string): string {
  const file = path.join(TEMPLATES_DIR, agent, `${slug}.md`);
  return fs.readFileSync(file, "utf8");
}
