/**
 * KM File-Reading Tool
 * Implements read_km_files(folder_path, query) for KM specialist agents.
 *
 * Two-phase scoring:
 *   Phase 1 — filename match (all files, O(n) fast)
 *   Phase 2 — content match (top N by filename score)
 * Returns top 5 excerpts, max 40 KB total.
 */
import fs from "fs";
import path from "path";

const KM_ROOT =
  process.env.KM_ROOT ??
  "C:\\Users\\moret\\OneDrive - Eendigo LLC\\3 PROF\\1. EENDIGO\\0. EENDIGO\\3. KM, Templates";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_TOTAL_CHARS = 40_000;
const TOP_K_CONTENT = 20; // content-read candidates
const TOP_K_RESULTS = 5;  // final returned files

const SKIP_DIRS = new Set(["_archive", "99. Empty folders", "node_modules"]);

// ── Supported extensions ──────────────────────────────────────────────────────
const TEXT_EXTS = new Set([".md", ".txt", ".csv"]);
const SUPPORTED_EXTS = new Set([".docx", ".pdf", ".xlsx", ".pptx", ".md", ".txt", ".csv"]);

// ── Lazy dynamic imports (heavy parsers only loaded when needed) ──────────────
async function readDocx(filePath: string): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

async function readPdf(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParse = (await import("pdf-parse" as any)) as any;
  const fn = pdfParse.default ?? pdfParse;
  const buf = fs.readFileSync(filePath);
  const data = await fn(buf);
  return data.text;
}

async function readXlsx(filePath: string): Promise<string> {
  // xlsx ships its own types via @types/xlsx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX = (await import("xlsx" as any)) as any;
  const lib = XLSX.default ?? XLSX;
  const wb = lib.readFile(filePath);
  return (wb.SheetNames as string[]).map((name: string) => {
    const sheet = wb.Sheets[name];
    return `[Sheet: ${name}]\n${lib.utils.sheet_to_csv(sheet)}`;
  }).join("\n\n");
}

async function readPptx(filePath: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unzipper = (await import("unzipper" as any)) as any;
  const lib = unzipper.default ?? unzipper;
  const chunks: string[] = [];
  const directory = await lib.Open.file(filePath);
  for (const entry of directory.files) {
    if (!entry.path.startsWith("ppt/slides/slide") || !entry.path.endsWith(".xml")) continue;
    const content = await entry.buffer();
    const xml = content.toString("utf8");
    // Strip XML tags, keep text
    const text = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text.length > 20) chunks.push(text);
  }
  return chunks.join("\n\n");
}

// ── Walk directory, collect file list ─────────────────────────────────────────
interface FileEntry {
  absPath: string;
  relPath: string;
  ext: string;
  sizeBytes: number;
}

function walkDir(dir: string, base: string): FileEntry[] {
  let entries: FileEntry[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return entries;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = path.join(dir, name);
    let stat: fs.Stats;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (stat.isDirectory()) {
      entries = entries.concat(walkDir(abs, base));
    } else {
      const ext = path.extname(name).toLowerCase();
      if (!SUPPORTED_EXTS.has(ext)) continue;
      if (stat.size > MAX_FILE_BYTES) continue;
      entries.push({ absPath: abs, relPath: path.relative(base, abs), ext, sizeBytes: stat.size });
    }
  }
  return entries;
}

// ── Keyword scoring ───────────────────────────────────────────────────────────
function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

function filenameScore(relPath: string, queryTokens: string[]): number {
  const nameTokens = tokenize(relPath);
  let hits = 0;
  for (const qt of queryTokens) {
    if (nameTokens.some(t => t.includes(qt) || qt.includes(t))) hits++;
  }
  return hits / Math.max(queryTokens.length, 1);
}

function contentScore(text: string, queryTokens: string[]): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const qt of queryTokens) {
    if (lower.includes(qt)) hits++;
  }
  return hits / Math.max(queryTokens.length, 1);
}

// ── Extract the most relevant excerpt from text ───────────────────────────────
function extractExcerpt(text: string, queryTokens: string[], maxLen = 3000): string {
  const lower = text.toLowerCase();
  let bestIdx = 0;
  let bestHits = 0;
  const step = 200;
  for (let i = 0; i < text.length - step; i += step) {
    const window = lower.slice(i, i + maxLen);
    const hits = queryTokens.filter(t => window.includes(t)).length;
    if (hits > bestHits) { bestHits = hits; bestIdx = i; }
  }
  const raw = text.slice(bestIdx, bestIdx + maxLen).trim();
  return raw.length > maxLen ? raw.slice(0, maxLen) + "…" : raw;
}

// ── Read file content ─────────────────────────────────────────────────────────
async function readFile(entry: FileEntry): Promise<string> {
  try {
    if (TEXT_EXTS.has(entry.ext)) return fs.readFileSync(entry.absPath, "utf8");
    if (entry.ext === ".docx") return await readDocx(entry.absPath);
    if (entry.ext === ".pdf")  return await readPdf(entry.absPath);
    if (entry.ext === ".xlsx") return await readXlsx(entry.absPath);
    if (entry.ext === ".pptx") return await readPptx(entry.absPath);
  } catch {
    // Parser failure — skip silently
  }
  return "";
}

// ── Main exported function ────────────────────────────────────────────────────
export interface KmFileResult {
  path: string;
  excerpt: string;
}

export async function readKmFiles(
  folderPath: string,
  query: string
): Promise<{ files: KmFileResult[] }> {
  const absFolder = path.join(KM_ROOT, folderPath);
  if (!fs.existsSync(absFolder)) {
    return { files: [] };
  }

  const queryTokens = tokenize(query).filter(t => t.length > 2);
  const allFiles = walkDir(absFolder, absFolder);

  // Phase 1: score by filename
  const phase1 = allFiles.map(f => ({
    entry: f,
    fnScore: filenameScore(f.relPath, queryTokens),
  }));
  phase1.sort((a, b) => b.fnScore - a.fnScore);

  // Take top-K for content reading
  const candidates = phase1.slice(0, TOP_K_CONTENT);

  // Phase 2: read + score by content
  const scored: { relPath: string; score: number; text: string }[] = [];
  for (const { entry, fnScore } of candidates) {
    const text = await readFile(entry);
    if (!text) continue;
    const cScore = contentScore(text, queryTokens);
    const combined = fnScore * 0.4 + cScore * 0.6;
    scored.push({ relPath: entry.relPath, score: combined, text });
  }
  scored.sort((a, b) => b.score - a.score);

  // Build final results with excerpts, respecting total char budget
  const results: KmFileResult[] = [];
  let totalChars = 0;
  for (const { relPath, text } of scored.slice(0, TOP_K_RESULTS)) {
    if (totalChars >= MAX_TOTAL_CHARS) break;
    const remaining = MAX_TOTAL_CHARS - totalChars;
    const excerpt = extractExcerpt(text, queryTokens, Math.min(3000, remaining));
    results.push({ path: relPath, excerpt });
    totalChars += excerpt.length;
  }

  return { files: results };
}

// ── Anthropic tool definition (for messages.create tools array) ───────────────
export const KM_READ_TOOL_DEF = {
  name: "read_km_files",
  description:
    "Search and read files from a specific KM knowledge base folder. " +
    "Returns the top 5 most relevant file excerpts for the given query.",
  input_schema: {
    type: "object" as const,
    properties: {
      folder_path: {
        type: "string",
        description:
          "Relative path within the KM root to search. Example: '01. By topic/05. Pricing/'",
      },
      query: {
        type: "string",
        description: "The search query to find relevant files.",
      },
    },
    required: ["folder_path", "query"],
  },
};
