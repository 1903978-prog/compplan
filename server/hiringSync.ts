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
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(m => stripTags(m[1]));

    const cellAt = (i: number) => (cells[i] ?? "").trim();

    // Pull a numeric score out of a cell ("60.0" or "60.0%" → "60.0%").
    // Returning empty string for blanks keeps buildInfo concise.
    const numCell = (i: number): string => {
      const raw = cellAt(i);
      if (!raw) return "";
      const m = raw.match(/(\d+\.?\d*)/);
      return m ? `${m[1]}%` : "";
    };

    const excel    = numCell(6);
    const pres1    = numCell(7);
    const pres2    = numCell(8);
    const tgScore  = numCell(10);
    const introRating = numCell(13);
    const csRating = numCell(16);

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
      rowStatus,
      stage,
    });
  }

  return results;
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
  if (c.rowStatus) lines.push(`Status: ${c.rowStatus}`);

  return lines.join("\n");
}

/** Merge new info into existing info, adding new lines that aren't already present */
function mergeInfo(existingInfo: string, newInfo: string): string {
  const existingLines = new Set(existingInfo.split("\n").map(l => l.trim()).filter(Boolean));
  const newLines = newInfo.split("\n").map(l => l.trim()).filter(Boolean);
  const toAdd: string[] = [];
  for (const line of newLines) {
    // Check if any existing line contains the same key data (before the first value)
    const isNew = ![...existingLines].some(existing => {
      // Same line exactly
      if (existing === line) return true;
      // Same prefix (e.g. "Logic 68.2%" vs "Logic 70.1%" — update the value)
      const existKey = existing.split(/[\d%]/)[0].trim();
      const newKey = line.split(/[\d%]/)[0].trim();
      return existKey.length > 3 && existKey === newKey;
    });
    if (isNew) toAdd.push(line);
  }
  // Update existing lines where the key matches but value changed
  let merged = existingInfo;
  for (const line of newLines) {
    const newKey = line.split(/[\d%]/)[0].trim();
    if (newKey.length <= 3) continue;
    const existingLine = [...existingLines].find(e => {
      const eKey = e.split(/[\d%]/)[0].trim();
      return eKey === newKey && e !== line;
    });
    if (existingLine) {
      merged = merged.replace(existingLine, line);
    }
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
        await storage.updateHiringCandidate(existing.id, { name: cand.name || existing.name, info: mergedInfo, stage: advancedStage });
      } else {
        // Not locked — update everything, but still merge info to preserve history
        const mergedInfo = mergeInfo(existing.info, info);
        await storage.updateHiringCandidate(existing.id, { name: cand.name || existing.name, info: mergedInfo, stage: cand.stage });
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
      });
      created++;
    }
  }

  return { synced: parsed.length, created, updated, skipped };
}
