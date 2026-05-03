/**
 * templateEngine.ts — slot-based markdown template engine for agent deliverables.
 *
 * Templates live at: server/microAI/templates/{agent}/{slug}.md
 * Format: YAML frontmatter between `---` delimiters + markdown body.
 * Slots use {{slot_name}} syntax and are substituted at render time.
 *
 * Exported API (consumed by /api/templates/* routes in routes.ts):
 *   listTemplates(agent?)           → Template[]
 *   loadTemplate(agent, slug)       → { meta, body }
 *   loadTemplateRaw(agent, slug)    → string
 *   render(agent, slug, slots)      → { meta, body }
 *   saveTemplate(agent, slug, raw)  → void
 */

import fs from "fs";
import path from "path";

// Templates live under the repo at server/microAI/templates/<agent>/<slug>.md.
// Resolved from process.cwd() so it works in both dev (tsx) and the bundled
// CJS production build — `import.meta.url` is empty in CJS output, so we
// can't rely on it.
const TEMPLATES_DIR = path.resolve(process.cwd(), "server", "microAI", "templates");

// ── Types ────────────────────────────────────────────────────────────────────

export interface TemplateMeta {
  title?: string;
  description?: string;
  slots?: string[];
  agent?: string;
  slug?: string;
  [key: string]: unknown;
}

export interface Template {
  agent: string;
  slug: string;
  meta: TemplateMeta;
  body: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a markdown string with optional YAML frontmatter (--- ... ---) */
function parseFrontmatter(raw: string): { meta: TemplateMeta; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };

  const yamlStr = match[1];
  const body    = match[2].trim();

  // Minimal single-level YAML parser: handles "key: value" and "key: [a, b]"
  const meta: TemplateMeta = {};
  for (const line of yamlStr.split(/\r?\n/)) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (val.startsWith("[")) {
      try { (meta as Record<string, unknown>)[key] = JSON.parse(val); } catch { (meta as Record<string, unknown>)[key] = val; }
    } else {
      (meta as Record<string, unknown>)[key] = val.replace(/^["']|["']$/g, "");
    }
  }

  return { meta, body };
}

/** Sanitise agent/slug to safe filesystem names */
function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Resolve the absolute path for a template file */
function templatePath(agent: string, slug: string): string {
  return path.join(TEMPLATES_DIR, safe(agent), `${safe(slug)}.md`);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * List all templates. If `agent` is provided, only return that agent's templates.
 * Returns [] if the templates directory doesn't exist yet.
 */
export function listTemplates(agent?: string): Template[] {
  const results: Template[] = [];
  try {
    if (!fs.existsSync(TEMPLATES_DIR)) return [];
    const agentDirs: string[] = agent
      ? [agent]
      : fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);

    for (const ag of agentDirs) {
      const agDir = path.join(TEMPLATES_DIR, ag);
      if (!fs.existsSync(agDir)) continue;
      const files = fs.readdirSync(agDir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        const slug = file.replace(/\.md$/, "");
        try {
          const raw = fs.readFileSync(path.join(agDir, file), "utf-8");
          const { meta, body } = parseFrontmatter(raw);
          results.push({ agent: ag, slug, meta: { ...meta, agent: ag, slug }, body });
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* directory read errors are non-fatal */ }
  return results;
}

/**
 * Load a template and return parsed { meta, body }.
 * Throws if the template file does not exist.
 */
export function loadTemplate(agent: string, slug: string): { meta: TemplateMeta; body: string } {
  const p = templatePath(agent, slug);
  if (!fs.existsSync(p)) throw new Error(`Template not found: ${agent}/${slug}`);
  const raw = fs.readFileSync(p, "utf-8");
  return parseFrontmatter(raw);
}

/**
 * Load a template and return raw file content (frontmatter + body, unparsed).
 * Throws if the template file does not exist.
 */
export function loadTemplateRaw(agent: string, slug: string): string {
  const p = templatePath(agent, slug);
  if (!fs.existsSync(p)) throw new Error(`Template not found: ${agent}/${slug}`);
  return fs.readFileSync(p, "utf-8");
}

/**
 * Render a template by substituting {{slot}} placeholders with `slots` values.
 * Unresolved placeholders are left as-is ({{slot_name}}).
 */
export function render(
  agent: string,
  slug: string,
  slots: Record<string, string>,
): { meta: TemplateMeta; body: string } {
  const { meta, body } = loadTemplate(agent, slug);
  const rendered = body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => slots[key] ?? `{{${key}}}`);
  return { meta, body: rendered };
}

/**
 * Save (create or overwrite) a template.
 * `content` must be a markdown string containing at least one `---` frontmatter block.
 * Creates parent directories as needed.
 */
export function saveTemplate(agent: string, slug: string, content: string): void {
  const p = templatePath(agent, slug);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
}
