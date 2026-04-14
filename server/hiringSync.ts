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

/**
 * Map Eendigo pipeline status → our Kanban stage.
 * Precedence: check for the most-advanced status first.
 */
function detectStage(rowText: string): string | null {
  if (/hsa.?fail/i.test(rowText)) return null;              // skip HSA failed only
  if (/cs.?rated/i.test(rowText))   return "after_csi_asc";
  if (/cs.?sent/i.test(rowText))    return "after_intro";
  if (/awaiting.?cs/i.test(rowText)) return "after_intro";
  if (/intro.?pass/i.test(rowText)) return "after_intro";
  if (/intro.?fail/i.test(rowText)) return "potential";     // keep but in Good Potential
  if (/awaiting.?intro/i.test(rowText)) return "potential";
  return "potential"; // default
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

function parseCandidates(html: string): RawCandidate[] {
  // Find the last tbody (the candidates table, not the funnel)
  const tbodyMatches = [...html.matchAll(/<tbody[^>]*>([\s\S]*?)<\/tbody>/gi)];
  if (!tbodyMatches.length) return [];

  // Use the largest tbody (candidates table)
  const tbody = tbodyMatches.reduce((a, b) => (a[1].length >= b[1].length ? a : b))[1];

  const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const results: RawCandidate[] = [];

  for (const rowMatch of rows) {
    const rowHtml = rowMatch[1];
    const rowText = stripTags(rowHtml);

    // Extract all cell texts
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => stripTags(m[1]));
    if (cells.length < 3) continue;

    // Email (required for dedup)
    const emailMatch = rowText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    if (!emailMatch) continue;
    const email = emailMatch[0];

    // Skip HSA failed only
    if (/hsa.?fail/i.test(rowText)) continue;

    const stage = detectStage(rowText);
    if (!stage) continue;

    // Extract percentages in order
    const pcts = (rowText.match(/\d+\.?\d*\s*%/g) ?? []).map(s => s.replace(/\s/, ""));

    // Try to find name: first cell that looks like a name (no @, not a %, not a date)
    const nameCell = cells.find(c =>
      c.length > 1 &&
      !c.includes("@") &&
      !/^\d+\.?\d*\s*%$/.test(c) &&
      !/^\d{4}-\d{2}-\d{2}/.test(c) &&
      !/^(Send|Upload|Import|Select|All|Passed|Logic|Verbal|Excel|Pres|Files|Intro|CS|TG|HSA)/i.test(c)
    ) ?? "";

    const dateCell = cells.find(c => /^\d{4}-\d{2}-\d{2}/.test(c)) ?? "";

    // Intro rating: look for a % preceded by "Intro" context, or the 5th+ %
    const introRatingMatch = rowText.match(/intro[^%\d]{0,30}(\d+\.?\d*\s*%)/i) ??
                             rowText.match(/(\d+\.?\d*\s*%).*notes/i);
    const introRating = introRatingMatch ? introRatingMatch[1] : (pcts[4] ?? "");

    // TG Score (TestGorilla) — look for a % near "TG" or "Score"
    const tgMatch = rowText.match(/(?:tg|soft.?skill|gorilla)[^\d%]{0,20}(\d+\.?\d*\s*%)/i);
    const tgScore = tgMatch ? tgMatch[1] : "";

    // Intro owner — look for a name that appears near "Intro" keyword
    const introOwnerMatch = rowText.match(/(?:intro[^@]{0,60}?)\b([A-Z][a-z]+ [A-Z][a-z]+)\b/);
    const introOwner = introOwnerMatch ? introOwnerMatch[1] : "";

    // Row status keywords
    const statusMatch = rowText.match(/\b(Awaiting Intro|Awaiting CS|CS Sent|CS Rated|Intro Passed|Intro Failed|HSA Failed)\b/i);
    const rowStatus = statusMatch ? statusMatch[1] : "";

    results.push({
      name: nameCell,
      email,
      date: dateCell,
      logic: pcts[0] ?? "",
      verbal: pcts[1] ?? "",
      excel: pcts[2] ?? "",
      pres1: pcts[3] ?? "",
      pres2: pcts[4] ?? "",
      tgScore,
      introOwner,
      introRating,
      csRating: "",
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

  let created = 0, updated = 0, skipped = 0;

  for (const [i, cand] of parsed.entries()) {
    const info = buildInfo(cand);
    const existing = byEmail.get(cand.email);

    if (existing) {
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
