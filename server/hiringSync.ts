/**
 * Eendigo → Hiring Kanban sync
 * Fetches https://56.228.34.234/, parses the candidate table,
 * and upserts into hiring_candidates (keyed by email).
 * Candidates manually moved by the user (sync_locked=1) keep their stage.
 */

import { storage } from "./storage";

const EENDIGO_URL = "https://56.228.34.234/";

// ─── Stage mapping ────────────────────────────────────────────────────────────

/**
 * Map Eendigo pipeline status → our Kanban stage.
 * Precedence: check for the most-advanced status first.
 */
function detectStage(rowText: string): string | null {
  if (/hsa.?fail/i.test(rowText)) return null;              // skip
  if (/intro.?fail/i.test(rowText)) return null;            // skip failed
  if (/cs.?rated/i.test(rowText))   return "after_csi_asc";
  if (/cs.?sent/i.test(rowText))    return "after_intro";
  if (/awaiting.?cs/i.test(rowText)) return "after_intro";
  if (/intro.?pass/i.test(rowText)) return "after_intro";
  if (/awaiting.?intro/i.test(rowText)) return "potential";
  // Candidate with intro owner + high intro rating but still listed as "Awaiting Intro"
  // → treat as after_intro if they have an intro rating
  return "potential"; // default: passed HSA, waiting for intro
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

    // Skip HSA failed immediately
    if (/hsa.?fail/i.test(rowText) || /intro.?fail/i.test(rowText)) continue;

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

// ─── Public sync function ─────────────────────────────────────────────────────

export async function syncEendigoHiring(): Promise<{ synced: number; created: number; updated: number; skipped: number; error?: string }> {
  let html: string;
  try {
    const res = await fetch(EENDIGO_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CompPlan/1.0)",
        "Accept": "text/html",
      },
      // @ts-ignore
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
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
        // User manually moved this card — update info but keep stage
        await storage.updateHiringCandidate(existing.id, { name: cand.name, info });
      } else {
        await storage.updateHiringCandidate(existing.id, { name: cand.name, info, stage: cand.stage });
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
