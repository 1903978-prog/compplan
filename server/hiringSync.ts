/**
 * Eendigo → Hiring Kanban sync
 * Logs into https://56.228.34.234/ (the dashboard is now behind a
 * session-cookie login), fetches the candidate table, and upserts into
 * hiring_candidates (keyed by email). Candidates manually moved by the
 * user (sync_locked=1) keep their stage.
 *
 * Credentials are read from env vars EENDIGO_USERNAME / EENDIGO_PASSWORD.
 * Never hard-code them.
 */

import { storage } from "./storage";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

const EENDIGO_BASE = "https://56.228.34.234";
const EENDIGO_URL = `${EENDIGO_BASE}/`;
const EENDIGO_LOGIN_URL = `${EENDIGO_BASE}/login`;

// Stage ordering: higher = more advanced
const STAGE_ORDER: Record<string, number> = {
  potential: 0,
  after_intro: 1,
  after_csi_asc: 2,
  after_csi_lm: 3,
};

interface RawResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Raw request returning status, headers, and body. Does not follow redirects. */
function request(
  method: "GET" | "POST",
  url: string,
  opts: { cookie?: string; body?: string; contentType?: string } = {}
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === "https:" ? https : http;
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (compatible; CompPlan/1.0)",
      "Accept": "text/html,application/xhtml+xml",
    };
    if (opts.cookie) headers["Cookie"] = opts.cookie;
    if (opts.body) {
      headers["Content-Type"] = opts.contentType || "application/x-www-form-urlencoded";
      headers["Content-Length"] = String(Buffer.byteLength(opts.body));
    }
    const req = lib.request(
      url,
      { method, rejectUnauthorized: false, headers },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: data,
        }));
      }
    );
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Extract the session cookie(s) from a Set-Cookie header into a Cookie header value. */
function collectCookies(setCookie: string | string[] | undefined, prev = ""): string {
  if (!setCookie) return prev;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  const jar = new Map<string, string>();
  // Seed with previous cookies
  prev.split(";").map(s => s.trim()).filter(Boolean).forEach(pair => {
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  });
  for (const c of list) {
    const first = c.split(";")[0].trim();
    const eq = first.indexOf("=");
    if (eq > 0) jar.set(first.slice(0, eq), first.slice(eq + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Log into Eendigo and fetch the dashboard HTML.
 * Throws a descriptive error on auth failure.
 */
async function loginAndFetchDashboard(): Promise<string> {
  const username = process.env.EENDIGO_USERNAME;
  const password = process.env.EENDIGO_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "Eendigo credentials not configured. Set EENDIGO_USERNAME and EENDIGO_PASSWORD env vars in Render."
    );
  }

  // 1. GET /login to seed any initial session cookie.
  let cookie = "";
  const loginPage = await request("GET", EENDIGO_LOGIN_URL);
  cookie = collectCookies(loginPage.headers["set-cookie"], cookie);

  // 2. POST credentials.
  const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const loginRes = await request("POST", EENDIGO_LOGIN_URL, { cookie, body });
  cookie = collectCookies(loginRes.headers["set-cookie"], cookie);

  // 3. Follow the post-login redirect (typically 302 → /).
  let landingUrl = EENDIGO_URL;
  if (loginRes.statusCode >= 300 && loginRes.statusCode < 400 && loginRes.headers.location) {
    landingUrl = new URL(loginRes.headers.location, EENDIGO_BASE).toString();
  } else if (loginRes.statusCode === 200 && /name=["']password["']/i.test(loginRes.body)) {
    // Still on the login form — credentials rejected.
    throw new Error("Eendigo login rejected: invalid EENDIGO_USERNAME / EENDIGO_PASSWORD.");
  }

  // 4. GET the dashboard, following up to 5 redirects with the session cookie.
  let hops = 0;
  let url = landingUrl;
  while (hops++ < 5) {
    const res = await request("GET", url, { cookie });
    cookie = collectCookies(res.headers["set-cookie"], cookie);
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      url = new URL(res.headers.location, url).toString();
      // If we are being redirected back to /login after POST, auth failed.
      if (/\/login(\?|$)/.test(url)) {
        throw new Error("Eendigo session lost — redirected back to /login after authentication.");
      }
      continue;
    }
    if (res.statusCode !== 200) {
      throw new Error(`Eendigo dashboard returned HTTP ${res.statusCode}`);
    }
    // Sanity check: we should be on a candidate page, not the login form.
    if (/name=["']password["']/i.test(res.body) && /login/i.test(res.body)) {
      throw new Error("Eendigo returned the login form after authentication — session cookie not accepted.");
    }
    return res.body;
  }
  throw new Error("Too many redirects fetching Eendigo dashboard.");
}

// ─── Stage mapping ────────────────────────────────────────────────────────────
//
// Stride exposes the pipeline value verbatim as data-pipeline="..." on every
// candidate <tr>. The full enum we've observed:
//
//   Awaiting Intro, Intro Scheduled, Intro Sent, Intro Passed, Intro Failed,
//   Awaiting CS, CS Scheduled, CS Sent, CS Passed, CS Failed, Failed HSA,
//   Failed TG.
//
// Map it to our 4 Kanban stages. "Failed HSA" and "Failed TG" are dropped
// (dead-ends, no value showing them on the board). "Intro Failed" is kept
// in the Good-Potential column so you can still see who dropped out recently.

/**
 * Map a Stride pipeline value → Kanban stage, or null to skip the row.
 * Precedence matters: check the most-advanced status first so we don't
 * park an "Awaiting CS" candidate back in Good Potential.
 */
function detectStageFromPipeline(pipeline: string): string | null {
  const p = (pipeline || "").toLowerCase().trim();

  // Dead-end filters — skip entirely.
  if (p.startsWith("failed hsa") || p === "hsa failed") return null;
  if (p.startsWith("failed tg")  || p === "tg failed")  return null;

  // CS pipeline (furthest right on the board)
  if (/^cs\s*(rated|passed|failed)/.test(p)) return "after_csi_asc";
  if (/^cs\s*(sent|scheduled)/.test(p))      return "after_intro";
  if (/^awaiting\s*cs/.test(p))              return "after_intro";

  // Intro pipeline
  if (/^intro\s*passed/.test(p))             return "after_intro";
  if (/^intro\s*failed/.test(p))             return "potential";   // keep for visibility
  if (/^intro\s*(scheduled|sent)/.test(p))   return "potential";
  if (/^awaiting\s*intro/.test(p))           return "potential";

  return "potential"; // unknown new status → default to Good Potential
}

// ─── HTML parser ──────────────────────────────────────────────────────────────

interface RawCandidate {
  name: string;
  email: string;
  date: string;
  logic: string;
  verbal: string;
  excel: string;
  pres1: string;
  pres2: string;
  tgScore: string;
  introOwner: string;
  introRating: string;
  csRating: string;
  /** CS LM rating — case-study rating given by the partner in the
   *  LM (Learning Manager) review round. Column 17 in the Stride
   *  dashboard table. Shown prominently on each candidate tile so the
   *  user can see the partner's verdict at a glance without opening
   *  the detail popup. */
  csLM: string;
  rowStatus: string;
  stage: string;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

/** Read a `data-foo="..."` attribute off a tag string (first match only). */
function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : "";
}

/**
 * Parse candidates from the Stride dashboard HTML.
 *
 * Stride rebuilt its table and removed the email <td>, so the old approach
 * — regex-scanning cell text for "@domain.com" + percentages — now drops
 * every row. The rewrite targets the structured data the new template
 * exposes on each <tr>:
 *
 *   <tr data-status="passed"
 *       data-pipeline="Intro Scheduled"
 *       data-name="riccardo del torre"
 *       data-fullname="Riccardo Del Torre"
 *       data-email="riccardo.deltorre@gmail.com"
 *       data-date="2026-04-11"
 *       data-stage="Intro Scheduled"
 *       data-logic="81.8"
 *       data-verbal="100.0"
 *       ...>
 *
 * Attributes are authoritative; cell text is only used for values that
 * aren't exposed as attrs yet (excel, p1, p2, TG score, ratings). The
 * parser is tolerant of column re-ordering because we find each score
 * by its cell position within the row + fallback to matching the %
 * next to known labels.
 */
function parseCandidates(html: string): RawCandidate[] {
  // Pick the candidateTable tbody if it exists; otherwise fall back to the
  // largest tbody (old behavior). Being specific stops us from mis-parsing
  // a funnel/summary table if one is ever re-added above it.
  const namedTbody = html.match(/<tbody[^>]*id=["']candidateTable["'][^>]*>([\s\S]*?)<\/tbody>/i);
  let tbodyContent: string;
  if (namedTbody) {
    tbodyContent = namedTbody[1];
  } else {
    const tbodies = [...html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi)];
    if (!tbodies.length) return [];
    tbodyContent = tbodies.reduce((a, b) => (a[1].length >= b[1].length ? a : b))[1];
  }

  // Split into <tr ...> ... </tr>, keeping the opening tag so we can read
  // its data-* attributes.
  const rowMatches = [...tbodyContent.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)];
  const results: RawCandidate[] = [];

  for (const match of rowMatches) {
    const openTag = match[1] || "";
    const rowHtml = match[2] || "";

    // Only candidate rows — skip any ghost/header row that lacks data-email.
    const email = attr(openTag, "data-email");
    if (!email) continue;

    // Stage comes from data-pipeline (preferred) or data-stage as fallback.
    const pipeline = attr(openTag, "data-pipeline") || attr(openTag, "data-stage");
    const stage = detectStageFromPipeline(pipeline);
    if (!stage) continue; // dead-end (HSA/TG failed) — drop

    // Identity
    const name =
      attr(openTag, "data-fullname") ||
      // Title-case data-name ("riccardo del torre" → "Riccardo Del Torre")
      (attr(openTag, "data-name") || "")
        .split(/\s+/).filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

    const date = attr(openTag, "data-date"); // ISO like "2026-04-11"

    // Scores that *are* data-attributes
    const logic  = attr(openTag, "data-logic");
    const verbal = attr(openTag, "data-verbal");

    // Everything else needs cell parsing (no data-attr exposed). Extract
    // cells in order and rely on the template's stable column sequence:
    //   0 Status | 1 Name | 2 CV | 3 Date | 4 Logic | 5 Verbal | 6 Excel
    //   7 P1 | 8 P2 | 9 TG✓ | 10 TG | 11 I.Owner | 12 I.Sched | 13 I.Rate
    //   14 CS.Own | 15 CS.Sch | 16 CS.Rate | 17 CS LM
    // Keep BOTH the raw HTML (so we can dig out value="..." / data-* attrs
    // on child <input>/<button> elements) and the stripped text (for plain
    // label cells like I.OWNER).
    const rawCells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(m => m[1] ?? "");
    const cells = rawCells.map(h => stripTags(h));

    const cellAt = (i: number) => (cells[i] ?? "").trim();

    // Pull a numeric score out of a cell. Looks at THREE sources in order:
    //   (a) the rendered text after stripTags ("51 Notes" → "51")
    //   (b) any value="..." attr on a child <input> ("<input value=\"67\">")
    //   (c) any data-rate / data-score / data-value attr on a child element
    // Sources (b) + (c) catch cells that render as editable form inputs
    // rather than read-only text — which is how Stride displays I.RATE +
    // CS.RATE on candidates whose ratings are still being edited (Briccoli
    // is the canonical reproduction case). Without these fallbacks the
    // parser silently returned "" for those cells.
    //
    // Strategy: prefer the highest-signal source, but cap at 0-100 since
    // ratings are pct or 0-100 numeric. If multiple match, the FIRST sane
    // value wins.
    const numCellFromHtml = (i: number): string => {
      const cellHtml = (rawCells[i] ?? "");
      // (b) <input value="67"> — common after Stride re-renders the cell as editable
      const inputMatch = cellHtml.match(/<input\b[^>]*\bvalue\s*=\s*["']?([\d.]+)["']?/i);
      if (inputMatch) {
        const n = parseFloat(inputMatch[1]);
        if (isFinite(n) && n >= 0 && n <= 1000) return `${inputMatch[1]}%`;
      }
      // (c) data-rate / data-score / data-value="67" on any child
      const dataMatch = cellHtml.match(/\bdata-(?:rate|score|value)\s*=\s*["']([\d.]+)["']/i);
      if (dataMatch) {
        const n = parseFloat(dataMatch[1]);
        if (isFinite(n) && n >= 0 && n <= 1000) return `${dataMatch[1]}%`;
      }
      // (a) plain text fallback — same as before
      const raw = stripTags(cellHtml);
      if (!raw) return "";
      const m = raw.match(/(\d+\.?\d*)/);
      return m ? `${m[1]}%` : "";
    };
    const numCell = (i: number): string => numCellFromHtml(i);

    const excel    = numCell(6);
    const pres1    = numCell(7);
    const pres2    = numCell(8);
    const tgScore  = numCell(10);
    const introRating = numCell(13);
    const csRating = numCell(16);
    // CS LM — column 17 in the Stride table, the partner's rating
    // after the Learning Manager review of the case study. Can be a
    // numeric percentage ("85%") or a textual grade ("Strong",
    // "Pass", "Fail", "🟢"); we capture whichever the cell carries.
    const csLMRaw = cellAt(17);
    const csLM = csLMRaw
      ? (csLMRaw.match(/(\d+\.?\d*)/)?.[0]
          ? `${csLMRaw.match(/(\d+\.?\d*)/)?.[1]}%`
          : csLMRaw.slice(0, 32))
      : "";

    const introOwner = cellAt(11);
    const rowStatus  = cellAt(0) || pipeline;

    results.push({
      name,
      email,
      date,
      logic:  logic  ? `${logic}%`  : "",
      verbal: verbal ? `${verbal}%` : "",
      excel,
      pres1,
      pres2,
      tgScore,
      introOwner,
      introRating,
      csRating,
      csLM,
      rowStatus,
      stage,
    });
  }

  return results;
}

/**
 * Pull the percentage-scored fields out of a parsed candidate and shape them
 * for the structured DB columns added alongside the legacy `info` blob. Empty
 * strings become null so "not yet measured" stays distinct from a real 0%.
 * cs_lm passes through as text — it's the only one that can be a textual
 * grade ("Strong", "Pass", "Fail") instead of a percentage.
 */
function extractScoreColumns(c: RawCandidate): {
  logic_pct: number | null;
  verbal_pct: number | null;
  excel_pct: number | null;
  p1_pct: number | null;
  p2_pct: number | null;
  intro_rate_pct: number | null;
  cs_rate_pct: number | null;
  cs_lm: string | null;
} {
  const toNum = (s: string): number | null => {
    if (!s) return null;
    const m = s.match(/(\d+\.?\d*)/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return isFinite(n) ? n : null;
  };
  return {
    logic_pct: toNum(c.logic),
    verbal_pct: toNum(c.verbal),
    excel_pct: toNum(c.excel),
    p1_pct: toNum(c.pres1),
    p2_pct: toNum(c.pres2),
    intro_rate_pct: toNum(c.introRating),
    cs_rate_pct: toNum(c.csRating),
    cs_lm: c.csLM || null,
  };
}

function buildInfo(c: RawCandidate): string {
  const lines: string[] = [];
  lines.push(`📧 ${c.email}`);
  if (c.date) lines.push(`Applied: ${c.date}`);

  const scores: string[] = [];
  if (c.logic)  scores.push(`Logic ${c.logic}`);
  if (c.verbal) scores.push(`Verbal ${c.verbal}`);
  if (c.excel)  scores.push(`Excel ${c.excel}`);
  if (c.pres1)  scores.push(`Pres1 ${c.pres1}`);
  if (c.pres2)  scores.push(`Pres2 ${c.pres2}`);
  if (scores.length) lines.push(scores.join(" | "));

  if (c.tgScore)    lines.push(`TG Score: ${c.tgScore}`);
  if (c.introOwner || c.introRating) {
    const intro = [c.introOwner, c.introRating ? `${c.introRating}` : ""].filter(Boolean).join(" → ");
    lines.push(`Intro: ${intro}`);
  }
  // Case-study ratings — CS Rate is the assessor's score, CS LM is the
  // partner's review. The latter is the more authoritative signal for
  // the go/no-go decision so we label it clearly and surface it on the
  // card.
  if (c.csRating) lines.push(`CS Rate: ${c.csRating}`);
  if (c.csLM)     lines.push(`CS LM: ${c.csLM}`);
  if (c.rowStatus) lines.push(`Status: ${c.rowStatus}`);

  return lines.join("\n");
}

/**
 * Merge new info into existing info, adding new lines that aren't already
 * present and updating the value of any line whose "key" already exists.
 *
 * Key derivation:
 *   - "Key: value" lines → prefix before the first ":" (handles ALL
 *     structured lines: "CS LM: Strong", "TG Score: 76%", "Email: x@y.com").
 *   - Score lines like "Logic 68.2%" → prefix before the first digit/%
 *     (legacy fallback, for lines that don't use "Key: value" form).
 *
 * Previously the implementation keyed every line off split(/[\d%]/) which
 * failed on textual values ("CS LM: Strong" has no digits, so the key was
 * the whole line — causing a re-sync with "CS LM: Pass" to append rather
 * than update). The "Key:" form is now the authoritative path.
 */
function mergeInfo(existingInfo: string, newInfo: string): string {
  const keyOf = (line: string): string => {
    // Prefer "Key: value" — anything before the first colon.
    const colon = line.indexOf(":");
    if (colon > 0 && colon < 40) {
      const k = line.slice(0, colon).trim();
      if (k.length >= 2) return k;
    }
    // Legacy: score-style "Logic 68.2%" — prefix before first digit.
    const digitMatch = line.match(/^([^\d%]+)/);
    return digitMatch ? digitMatch[1].trim() : "";
  };

  const existingLines = existingInfo.split("\n").map(l => l.trim()).filter(Boolean);
  const existingSet = new Set(existingLines);
  const newLines = newInfo.split("\n").map(l => l.trim()).filter(Boolean);

  // Pass 1 — update lines whose key already exists with a different value.
  let merged = existingInfo;
  for (const line of newLines) {
    const nk = keyOf(line);
    if (!nk || nk.length < 2) continue;
    const existingLine = existingLines.find(e => keyOf(e) === nk && e !== line);
    if (existingLine) {
      merged = merged.replace(existingLine, line);
      existingSet.delete(existingLine);
      existingSet.add(line);
    }
  }

  // Pass 2 — append lines that have no matching key in the merged result.
  const mergedSet = new Set(merged.split("\n").map(l => l.trim()).filter(Boolean));
  const mergedKeys = new Set([...mergedSet].map(keyOf).filter(k => k.length >= 2));
  const toAdd: string[] = [];
  for (const line of newLines) {
    if (mergedSet.has(line)) continue;
    const nk = keyOf(line);
    if (nk && nk.length >= 2 && mergedKeys.has(nk)) continue; // key already present, handled in pass 1
    toAdd.push(line);
    if (nk) mergedKeys.add(nk);
  }
  if (toAdd.length) merged = merged + "\n" + toAdd.join("\n");
  return merged.trim();
}

// ─── Public sync function ─────────────────────────────────────────────────────

export async function syncEendigoHiring(): Promise<{ synced: number; created: number; updated: number; skipped: number; error?: string }> {
  let html: string;
  try {
    html = await loginAndFetchDashboard();
  } catch (err: any) {
    return { synced: 0, created: 0, updated: 0, skipped: 0, error: String(err.message ?? err) };
  }

  const parsed = parseCandidates(html);
  if (!parsed.length) {
    return { synced: 0, created: 0, updated: 0, skipped: 0, error: "No candidates found in page. The page structure may have changed." };
  }

  const existing = await storage.getHiringCandidates();
  const byEmail = new Map<string, any>(
    existing.filter(c => c.external_id).map(c => [c.external_id, c])
  );

  // Terminal stages — once a candidate lands here, the ATS process is over.
  // The Eendigo sync must leave them untouched (no stage move, no info
  // overwrite, no re-import) so we can keep them as historical records
  // without upstream churn re-promoting them through the pipeline.
  const TERMINAL_STAGES = new Set(["offer", "hired", "out"]);

  let created = 0, updated = 0, skipped = 0;

  for (const [i, cand] of parsed.entries()) {
    const info = buildInfo(cand);
    const scoreCols = extractScoreColumns(cand);
    const existing = byEmail.get(cand.email);

    if (existing) {
      if (TERMINAL_STAGES.has(existing.stage)) {
        // Candidate's process is finished — don't touch them.
        skipped++;
        continue;
      }
      if (existing.sync_locked) {
        // User manually moved — only advance stage if new is further, always merge info
        const currentOrder = STAGE_ORDER[existing.stage] ?? 0;
        const newOrder = STAGE_ORDER[cand.stage] ?? 0;
        const advancedStage = newOrder > currentOrder ? cand.stage : existing.stage;
        // Merge info: append new data that isn't already present
        const mergedInfo = mergeInfo(existing.info, info);
        await storage.updateHiringCandidate(existing.id, { name: cand.name || existing.name, info: mergedInfo, stage: advancedStage, ...scoreCols });
      } else {
        // Not locked — update everything, but still merge info to preserve history
        const mergedInfo = mergeInfo(existing.info, info);
        await storage.updateHiringCandidate(existing.id, { name: cand.name || existing.name, info: mergedInfo, stage: cand.stage, ...scoreCols });
      }
      updated++;
    } else {
      await storage.createHiringCandidate({
        name: cand.name,
        info,
        stage: cand.stage,
        external_id: cand.email,
        sync_locked: 0,
        sort_order: i,
        ...scoreCols,
      });
      created++;
    }
  }

  return { synced: parsed.length, created, updated, skipped };
}

/**
 * Diagnostic helper — fetch the dashboard, find rows whose email contains
 * the given substring, and return a verbose dump of the row HTML + all
 * cells (raw + stripped) + extracted score columns. The aim is to tell us
 * EXACTLY where the parser is missing data on a specific candidate without
 * having to ship test cases. Read-only.
 */
export async function fetchAndDebug(emailSubstring: string): Promise<{
  rows: Array<{
    email: string;
    name: string;
    pipeline: string;
    cellsRaw: string[];
    cellsText: string[];
    parsed: RawCandidate;
    extracted: ReturnType<typeof extractScoreColumns>;
  }>;
  totalRows: number;
  matchedRows: number;
  error?: string;
}> {
  let html: string;
  try {
    html = await loginAndFetchDashboard();
  } catch (err: any) {
    return { rows: [], totalRows: 0, matchedRows: 0, error: String(err.message ?? err) };
  }
  // Re-do the same parsing the main sync does, but keep the raw cell HTML
  // alongside the stripped text + the extracted score columns. We open up
  // parseCandidates' internals here rather than re-implementing them so we
  // catch the same bugs the live import does.
  const namedTbody = html.match(/<tbody[^>]*id=["']candidateTable["'][^>]*>([\s\S]*?)<\/tbody>/i);
  let tbodyContent: string;
  if (namedTbody) tbodyContent = namedTbody[1];
  else {
    const tbodies = [...html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi)];
    if (!tbodies.length) return { rows: [], totalRows: 0, matchedRows: 0, error: "No <tbody> found" };
    tbodyContent = tbodies.reduce((a, b) => (a[1].length >= b[1].length ? a : b))[1];
  }

  const rowMatches = [...tbodyContent.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)];
  const out: Array<{
    email: string;
    name: string;
    pipeline: string;
    cellsRaw: string[];
    cellsText: string[];
    parsed: RawCandidate;
    extracted: ReturnType<typeof extractScoreColumns>;
  }> = [];

  // Parse every row using the SAME logic as parseCandidates so the debug
  // dump shows what the live importer would do. Then filter by email.
  const allParsed = parseCandidates(html);
  const byEmail = new Map(allParsed.map(c => [c.email.toLowerCase(), c]));

  for (const match of rowMatches) {
    const openTag = match[1] || "";
    const rowHtml = match[2] || "";
    const email = attr(openTag, "data-email");
    if (!email) continue;
    if (emailSubstring && !email.toLowerCase().includes(emailSubstring)) continue;

    const pipeline = attr(openTag, "data-pipeline") || attr(openTag, "data-stage");
    const name = attr(openTag, "data-fullname") || attr(openTag, "data-name") || "";

    const rawCells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1] ?? "");
    const cellsText = rawCells.map(stripTags);

    const parsedCand = byEmail.get(email.toLowerCase());
    if (!parsedCand) continue;
    out.push({
      email,
      name,
      pipeline,
      cellsRaw: rawCells,
      cellsText,
      parsed: parsedCand,
      extracted: extractScoreColumns(parsedCand),
    });
  }
  return { rows: out, totalRows: rowMatches.length, matchedRows: out.length };
}
