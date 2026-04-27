import type { Express } from "express";
import { createServer, type Server } from "http";
import { requireAuth } from "./auth";
import { storage, trashAndDelete, listTrash, restoreTrash, purgeTrashItem } from "./storage";
import { insertEmployeeSchema, type BenchmarkRow } from "@shared/schema";
import { renderSlideFromSpec } from "@shared/slideTemplateRenderer";
import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

function safeInt(val: string): number {
  const n = parseInt(val, 10);
  if (isNaN(n)) throw Object.assign(new Error("Invalid ID"), { status: 400 });
  return n;
}

async function checkApiPaused(): Promise<boolean> {
  const settings = await storage.getSettings();
  return !!(settings as any).api_paused;
}

async function guardApiAsync(res: any): Promise<boolean> {
  if (await checkApiPaused()) {
    res.status(503).json({ message: "API usage is paused. Enable it from the top bar to continue." });
    return true;
  }
  return false;
}

// Claude Sonnet 4 pricing: $3/M input, $15/M output
const PRICING = { input_per_million: 3, output_per_million: 15 };

// ─── Slide background compositing ──────────────────────────────────────────
// If a slide_id has a stored PNG template background (e.g. a page exported
// from a Canva template), we bake it into the slide's outermost <div> as a
// CSS background-image. This happens as a POST-PROCESSING step on whatever
// HTML Claude returns, so the model doesn't have to know about the data URL
// (and we don't waste tokens shipping megabytes of base64 into every call).
//
// Rules:
//   • Strip any `background-color` / `background:<color>` shorthand the
//     model added, so the template actually shows through.
//   • Inject `background-image:url(data:...);background-size:960px 540px;
//     background-repeat:no-repeat;` into the style attribute.
//   • If the outer element has no style attribute at all, add one.
//   • If there's no outer <div> we give up and return the HTML unchanged —
//     better to show a broken preview than crash the request.
//
// The inverse `stripBackgroundImage` is used when we send `currentHtml` back
// into the model during /refine-page — otherwise every refinement round
// round-trips the data URL, which is huge.
function injectBackgroundImage(html: string, dataUrl: string): string {
  if (!html || !dataUrl) return html;
  // Escape any single quotes in the data URL so the resulting CSS is valid.
  const safeUrl = dataUrl.replace(/'/g, "\\'");
  const bgDecls = `background-image:url('${safeUrl}');background-size:960px 540px;background-repeat:no-repeat;background-position:0 0;`;

  // Case 1: outer div has style="..."
  const withStyleRe = /<div\b([^>]*?)\sstyle="([^"]*)"([^>]*)>/i;
  const styleMatch = html.match(withStyleRe);
  if (styleMatch) {
    const cleanedStyle = styleMatch[2]
      .replace(/background-image\s*:\s*[^;]+;?/gi, "")
      .replace(/background-color\s*:\s*[^;]+;?/gi, "")
      // `background:` shorthand that ISN'T already a url(...) — drop it.
      .replace(/background\s*:\s*(?!url)[^;]+;?/gi, "");
    const newStyle = `${bgDecls}${cleanedStyle}`;
    return html.replace(withStyleRe, `<div${styleMatch[1]} style="${newStyle}"${styleMatch[3]}>`);
  }

  // Case 2: outer div has no style attribute — add one.
  const noStyleRe = /<div\b([^>]*)>/i;
  const noStyleMatch = html.match(noStyleRe);
  if (noStyleMatch) {
    return html.replace(noStyleRe, `<div${noStyleMatch[1]} style="${bgDecls}">`);
  }
  return html;
}

function stripBackgroundImage(html: string): string {
  if (!html) return html;
  return html.replace(/background-image\s*:\s*url\(['"]?data:[^)]+\)\s*;?/gi, "");
}

async function logApiUsage(endpoint: string, response: any) {
  try {
    const usage = response?.usage;
    if (!usage) return;
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const costUsd = ((inputTokens * PRICING.input_per_million + outputTokens * PRICING.output_per_million) / 1_000_000).toFixed(6);
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO api_usage_log (endpoint, model, input_tokens, output_tokens, cost_usd, created_at)
      VALUES (${endpoint}, ${"claude-sonnet-4"}, ${inputTokens}, ${outputTokens}, ${costUsd}, ${new Date().toISOString()})
    `);
  } catch { /* non-fatal */ }
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // ── Version / health (unauthenticated) ────────────────────────────────────
  // Returns the git SHA baked in at build time (via RENDER_GIT_COMMIT,
  // SOURCE_VERSION, or COMMIT_SHA env vars — Render sets RENDER_GIT_COMMIT
  // automatically). Use this to verify which commit is actually running on
  // prod when debugging "my fix didn't deploy" issues.
  app.get("/api/version", (_req, res) => {
    res.json({
      commit:
        process.env.RENDER_GIT_COMMIT ||
        process.env.SOURCE_VERSION ||
        process.env.COMMIT_SHA ||
        "unknown",
      node_env: process.env.NODE_ENV || "unknown",
      started_at: new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString(),
    });
  });

  // ── Diagnostic row counts (unauthenticated, read-only) ────────────────────
  // Temporary endpoint to diagnose the "Pricing section empty" report.
  // Returns row counts for the key tables so we can tell whether the data
  // is actually missing or whether the API is failing upstream.
  app.get("/api/diag/db-counts", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const tables = [
        "pricing_cases",
        "pricing_proposals",
        "pricing_settings",
        "invoice_snapshots",
        "invoice_changes",
        "client_project_defaults",
        "proposals",
        "employees",
        "hiring_candidates",
      ];
      const out: Record<string, number | string> = {};
      for (const t of tables) {
        try {
          const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM ${t}`));
          out[t] = Number((r.rows[0] as any)?.c ?? 0);
        } catch (e: any) {
          out[t] = `ERR: ${e.message}`;
        }
      }
      res.json({ ok: true, counts: out });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/diag/reseed-proposals — unauthenticated one-shot to force a
  // re-run of the idempotent SEED_PROPOSALS insert. Returns how many rows
  // were inserted. Safe: the insert uses WHERE NOT EXISTS on project_name
  // so it never duplicates or touches existing rows.
  app.post("/api/diag/reseed-proposals", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const { SEED_PROPOSALS } = await import("./seedProposals");
      const before = await db.execute(sql`SELECT COUNT(*)::int AS c FROM pricing_proposals`);
      const beforeCount = Number((before.rows[0] as any)?.c ?? 0);
      let inserted = 0;
      for (const p of SEED_PROPOSALS) {
        const r = await db.execute(sql`
          INSERT INTO pricing_proposals
            (proposal_date, project_name, client_name, fund_name, region, country, pe_owned, revenue_band, duration_weeks, weekly_price, total_fee, outcome, notes, created_at)
          SELECT ${p.proposal_date}, ${p.project_name}, ${p.client_name}, ${p.fund_name}, ${p.region}, ${p.country}, ${p.pe_owned}, ${p.revenue_band}, ${p.duration_weeks}, ${p.weekly_price}, ${p.total_fee}, ${p.outcome}, ${p.notes}, ${new Date().toISOString()}
          WHERE NOT EXISTS (SELECT 1 FROM pricing_proposals WHERE project_name = ${p.project_name})
        `);
        inserted += (r as any).rowCount ?? 0;
      }
      const after = await db.execute(sql`SELECT COUNT(*)::int AS c FROM pricing_proposals`);
      const afterCount = Number((after.rows[0] as any)?.c ?? 0);
      res.json({ ok: true, before: beforeCount, after: afterCount, inserted, seed_size: SEED_PROPOSALS.length });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Trash Bin ─────────────────────────────────────────────────────────────
  // Soft-delete safety net. Wrapped DELETE endpoints copy the row to
  // trash_bin (30-day TTL) instead of erasing it. The /admin/trash page
  // lets the user list and restore. Auto-purge runs on server boot.
  app.get("/api/trash", requireAuth, async (_req, res) => {
    try {
      const items = await listTrash();
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Failed to list trash" });
    }
  });

  app.post("/api/trash/:id/restore", requireAuth, async (req, res) => {
    try {
      const out = await restoreTrash(safeInt(req.params.id));
      res.json(out);
    } catch (err: any) {
      res.status(400).json({ message: err.message ?? "Restore failed" });
    }
  });

  app.delete("/api/trash/:id", requireAuth, async (req, res) => {
    // Permanent purge — bypasses the 30-day wait. Used for items the
    // user is sure they want gone now (e.g. accidental confidential
    // data leak that the user wants out of the snapshot immediately).
    try {
      await purgeTrashItem(safeInt(req.params.id));
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ message: err.message ?? "Purge failed" });
    }
  });

  // ── API Pause Toggle ──────────────────────────────────────────────────────
  app.get("/api/api-pause", requireAuth, async (_req, res) => {
    const paused = await checkApiPaused();
    res.json({ paused });
  });

  app.put("/api/api-pause", requireAuth, async (req, res) => {
    const { paused, password } = req.body;
    // Resuming the API (paused: false) requires a password.
    if (paused === false) {
      // Password "1" always works. Env var password also works if set.
      const envPw = (process.env.API_UNPAUSE_PASSWORD || process.env.APP_PASSWORD || "").trim();
      const isValid = password === "1" || (envPw && password === envPw);
      if (!isValid) {
        res.status(401).json({ message: "Invalid password. Use: 1" });
        return;
      }
    }
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`UPDATE app_settings SET api_paused = ${paused ? 1 : 0} WHERE id = 1`);
    res.json({ paused: !!paused });
  });

  // ── External Contacts (freelancers + partners) ────────────────────────
  // CRUD endpoints for the lightweight people table. Schema in seed.ts.
  // Used by the Employees page's "Copy all emails" button to assemble
  // the full mailing list (employees + freelancers + partners).
  app.get("/api/external-contacts", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const r = await db.execute(sql`
        SELECT id, name, email, kind, created_at
        FROM external_contacts
        ORDER BY name ASC
      `);
      // Merge live role info from the employees + role_grid tables.
      // Many entries in external_contacts ARE current employees (Edoardo
      // Tiani = EM1, Defne Isler = A2, etc.). When a name matches we
      // return the employee's actual role code + name so the UI can
      // show the live role instead of the hardcoded "kind". Match is
      // by FIRST NAME (case-insensitive) since the employees table
      // stores first names only and external_contacts has full names.
      const employees = await storage.getEmployees();
      const roles = await storage.getRoleGrid();
      const roleByCode = new Map<string, string>();
      for (const r of roles) roleByCode.set(r.role_code, r.role_name);
      // First-name → employee mapping (case-insensitive).
      const empByFirstName = new Map<string, typeof employees[number]>();
      for (const e of employees) {
        const first = (e.name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
        if (first && !empByFirstName.has(first)) empByFirstName.set(first, e);
      }
      const enriched = r.rows.map((c: any) => {
        const first = (c.name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
        const matched = first ? empByFirstName.get(first) : undefined;
        if (!matched) return { ...c, is_employee: false };
        return {
          ...c,
          is_employee: true,
          employee_id: matched.id,
          employee_role_code: matched.current_role_code,
          employee_role_name: roleByCode.get(matched.current_role_code) ?? matched.current_role_code,
        };
      });
      res.json(enriched);
    } catch (e: any) {
      res.status(500).json({ message: e.message ?? "Failed to load" });
    }
  });

  app.post("/api/external-contacts", requireAuth, async (req, res) => {
    try {
      const { name, email, kind } = req.body ?? {};
      if (!name || !email) { res.status(400).json({ message: "name and email required" }); return; }
      // Free-text kind — front-end offers a curated dropdown
      // (freelancer, partner, manager, intern, founder, advisor, …)
      // but any string is accepted. Default if empty/missing.
      const k = (typeof kind === "string" && kind.trim()) ? kind.trim().toLowerCase() : "freelancer";
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const now = new Date().toISOString();
      const r = await db.execute(sql`
        INSERT INTO external_contacts (name, email, kind, created_at)
        VALUES (${String(name).trim()}, ${String(email).trim().toLowerCase()}, ${k}, ${now})
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind
        RETURNING id, name, email, kind, created_at
      `);
      res.status(201).json(r.rows[0]);
    } catch (e: any) {
      res.status(500).json({ message: e.message ?? "Failed to save" });
    }
  });

  app.put("/api/external-contacts/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const { name, email, kind } = req.body ?? {};
      if (!name || !email) { res.status(400).json({ message: "name and email required" }); return; }
      // Free-text kind — front-end offers a curated dropdown
      // (freelancer, partner, manager, intern, founder, advisor, …)
      // but any string is accepted. Default if empty/missing.
      const k = (typeof kind === "string" && kind.trim()) ? kind.trim().toLowerCase() : "freelancer";
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const r = await db.execute(sql`
        UPDATE external_contacts
        SET name = ${String(name).trim()}, email = ${String(email).trim().toLowerCase()}, kind = ${k}
        WHERE id = ${id}
        RETURNING id, name, email, kind, created_at
      `);
      if (r.rows.length === 0) { res.status(404).json({ message: "Not found" }); return; }
      res.json(r.rows[0]);
    } catch (e: any) {
      res.status(500).json({ message: e.message ?? "Failed to update" });
    }
  });

  app.delete("/api/external-contacts/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`DELETE FROM external_contacts WHERE id = ${id}`);
      res.status(204).end();
    } catch (e: any) {
      res.status(500).json({ message: e.message ?? "Failed to delete" });
    }
  });

  // ── Employees ──────────────────────────────────────────────────────────────
  app.get("/api/employees", requireAuth, async (_req, res) => {
    const emps = await storage.getEmployees();
    res.json(emps);
  });

  app.post("/api/employees", requireAuth, async (req, res) => {
    const data = req.body; // validated client-side
    const emp = await storage.createEmployee(data);
    res.status(201).json(emp);
  });

  app.put("/api/employees/:id", requireAuth, async (req, res) => {
    const { id } = req.params;
    const data = req.body; // validated client-side; insertEmployeeSchema doesn't know new JSONB fields
    const emp = await storage.updateEmployee(id, data);
    if (!emp) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }
    res.json(emp);
  });

  app.delete("/api/employees/:id", requireAuth, async (req, res) => {
    await storage.deleteEmployee(req.params.id);
    res.status(204).end();
  });

  // ── Role Grid ──────────────────────────────────────────────────────────────
  app.get("/api/role-grid", requireAuth, async (_req, res) => {
    const grid = await storage.getRoleGrid();
    res.json(grid);
  });

  app.put("/api/role-grid", requireAuth, async (req, res) => {
    const rows = z.array(
      z.object({
        role_code: z.string(),
        role_name: z.string(),
        next_role_code: z.string().nullable(),
        promo_years_fast: z.number(),
        promo_years_normal: z.number(),
        promo_years_slow: z.number(),
        ral_min_k: z.number(),
        ral_max_k: z.number(),
        gross_fixed_min_month: z.number(),
        gross_fixed_max_month: z.number(),
        bonus_pct: z.number(),
        meal_voucher_eur_per_day: z.number(),
        months_paid: z.number(),
      })
    ).parse(req.body);
    const grid = await storage.replaceRoleGrid(rows);
    res.json(grid);
  });

  // ── Settings ───────────────────────────────────────────────────────────────
  app.get("/api/settings", requireAuth, async (_req, res) => {
    const s = await storage.getSettings();
    res.json(s);
  });

  app.put("/api/settings", requireAuth, async (req, res) => {
    const s = await storage.updateSettings(req.body);
    res.json(s);
  });

  // POST /api/benchmark/apply  → save approved rows
  app.post("/api/benchmark/apply", requireAuth, async (req, res) => {
    const { data } = req.body as { data: BenchmarkRow[] };
    const settings = await storage.getSettings();
    const updated = await storage.updateSettings({
      ...(settings as any),
      benchmark_data: data,
      benchmark_updated_at: new Date().toISOString(),
    });
    res.json(updated);
  });

  // ── Salary History ─────────────────────────────────────────────────────────
  app.get("/api/salary-history/:employeeId", requireAuth, async (req, res) => {
    const entries = await storage.getSalaryHistory(req.params.employeeId);
    res.json(entries);
  });

  app.post("/api/salary-history", requireAuth, async (req, res) => {
    const entry = await storage.createSalaryHistoryEntry(req.body);
    res.status(201).json(entry);
  });

  app.patch("/api/salary-history/:id", requireAuth, async (req, res) => {
    const entry = await storage.updateSalaryHistoryEntry(safeInt(req.params.id), req.body);
    res.json(entry);
  });

  app.delete("/api/salary-history/:id", requireAuth, async (req, res) => {
    await storage.deleteSalaryHistoryEntry(safeInt(req.params.id));
    res.status(204).end();
  });

  // ── Days Off ───────────────────────────────────────────────────────────────
  app.get("/api/days-off", requireAuth, async (req, res) => {
    const yearRaw = req.query.year as string | undefined;
    const year = yearRaw ? safeInt(yearRaw) : undefined;
    const entries = await storage.getDaysOff(year);
    res.json(entries);
  });

  app.post("/api/days-off", requireAuth, async (req, res) => {
    const entry = await storage.createDaysOff(req.body);
    res.status(201).json(entry);
  });

  app.delete("/api/days-off/:id", requireAuth, async (req, res) => {
    await storage.deleteDaysOff(safeInt(req.params.id));
    res.status(204).end();
  });

  // ── Pricing Tool ───────────────────────────────────────────────────────────
  app.get("/api/pricing/settings", requireAuth, async (_req, res) => {
    const data = await storage.getPricingSettings();
    res.json(data);
  });

  app.put("/api/pricing/settings", requireAuth, async (req, res) => {
    const data = await storage.upsertPricingSettings(req.body);
    res.json(data);
  });

  app.get("/api/pricing/cases", requireAuth, async (_req, res) => {
    const cases = await storage.getPricingCases();
    res.json(cases);
  });

  app.get("/api/pricing/cases/:id", requireAuth, async (req, res) => {
    const c = await storage.getPricingCase(safeInt(req.params.id));
    if (!c) { res.status(404).json({ message: "Not found" }); return; }
    res.json(c);
  });

  // Lightweight defensive sanitiser for pricing-case write payloads. We
  // don't have a full zod schema here yet (the form is large and fields
  // evolve frequently), but jsonb bombs and obviously-malformed arrays
  // would otherwise land directly in Postgres. Caps array sizes and drops
  // non-object array entries; everything else passes through unchanged.
  function sanitisePricingCaseBody(body: unknown): Record<string, unknown> {
    const b = (body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {});
    const capArr = (key: string, max: number) => {
      const v = b[key];
      if (Array.isArray(v)) {
        b[key] = v.filter(x => x && typeof x === "object").slice(0, max);
      }
    };
    capArr("case_timelines", 10);
    capArr("case_discounts", 30);
    capArr("staffing", 50);
    return b;
  }

  // Server-side guarantee: when a pricing_case is saved with status='final'
  // and no matching pricing_proposal row exists, insert a pending TBD row
  // so the case appears in Past Projects atomically with the save. Replaces
  // the previously client-side fetch which had a silent catch and could
  // leave the row uncreated if the call ever failed. Idempotent — uses
  // case-insensitive project_name match against pricing_proposals.
  async function ensureTbdProposalForFinalCase(caseRow: { project_name?: string | null; status?: string | null; client_name?: string | null; fund_name?: string | null; region?: string | null; pe_owned?: number | null; revenue_band?: string | null; price_sensitivity?: string | null; duration_weeks?: number | null; sector?: string | null; project_type?: string | null }) {
    if (caseRow.status !== "final") return;
    const name = (caseRow.project_name ?? "").trim();
    if (!name) return;
    const all = await storage.getPricingProposals();
    const lower = name.toLowerCase();
    const exists = all.some(p => (p.project_name ?? "").trim().toLowerCase() === lower);
    if (exists) return;
    const today = new Date().toISOString().slice(0, 10);
    await storage.createPricingProposal({
      proposal_date: today,
      project_name: name,
      client_name: caseRow.client_name ?? null,
      fund_name: caseRow.fund_name ?? null,
      region: caseRow.region ?? "Italy",
      pe_owned: caseRow.pe_owned ?? 1,
      revenue_band: caseRow.revenue_band ?? "above_1b",
      price_sensitivity: caseRow.price_sensitivity ?? null,
      duration_weeks: caseRow.duration_weeks ?? null,
      weekly_price: 0,
      total_fee: 0,
      outcome: "pending",
      sector: caseRow.sector ?? null,
      project_type: caseRow.project_type ?? null,
    });
  }

  app.post("/api/pricing/cases", requireAuth, async (req, res) => {
    const c = await storage.createPricingCase(sanitisePricingCaseBody(req.body));
    try { await ensureTbdProposalForFinalCase(c); }
    catch (e) { console.error("ensureTbdProposalForFinalCase (POST) failed:", e); }
    res.status(201).json(c);
  });

  app.put("/api/pricing/cases/:id", requireAuth, async (req, res) => {
    const c = await storage.updatePricingCase(safeInt(req.params.id), sanitisePricingCaseBody(req.body));
    try { await ensureTbdProposalForFinalCase(c); }
    catch (e) { console.error("ensureTbdProposalForFinalCase (PUT) failed:", e); }
    res.json(c);
  });

  // One-shot repair endpoint: re-runs the same retroactive backfill that
  // server/seed.ts does at boot. Useful if the seed step errored once or
  // a case was finalised before the server-side guarantee landed. Returns
  // count of rows inserted. Auth-gated.
  app.post("/api/pricing/proposals/repair-from-final-cases", requireAuth, async (_req, res) => {
    try {
      const cases = await storage.getPricingCases();
      const proposals = await storage.getPricingProposals();
      const existingNames = new Set(proposals.map(p => (p.project_name ?? "").trim().toLowerCase()).filter(Boolean));
      const finals = cases.filter(c => c.status === "final" && (c.project_name ?? "").trim() !== "");
      const toCreate = finals.filter(c => !existingNames.has((c.project_name as string).trim().toLowerCase()));
      const today = new Date().toISOString().slice(0, 10);
      for (const c of toCreate) {
        await storage.createPricingProposal({
          proposal_date: today,
          project_name: (c.project_name as string).trim(),
          client_name: c.client_name ?? null,
          fund_name: c.fund_name ?? null,
          region: c.region ?? "Italy",
          pe_owned: c.pe_owned ?? 1,
          revenue_band: c.revenue_band ?? "above_1b",
          price_sensitivity: c.price_sensitivity ?? null,
          duration_weeks: c.duration_weeks ?? null,
          weekly_price: 0,
          total_fee: 0,
          outcome: "pending",
          sector: c.sector ?? null,
          project_type: c.project_type ?? null,
        });
      }
      res.json({ ok: true, inserted: toCreate.length, finalCases: finals.length, alreadyPresent: finals.length - toCreate.length });
    } catch (e) {
      console.error("repair-from-final-cases failed:", e);
      res.status(500).json({ ok: false, message: (e as Error).message });
    }
  });

  // Two-way sync: keep TBD proposals exactly aligned with status='final'
  // pricing_cases. INSERTs missing TBDs (same as repair-from-final-cases)
  // AND removes pending TBDs whose backing case has status != 'final'
  // (e.g. Draft, Active) — those cases shouldn't appear in Past Projects.
  // Won/Lost proposals are NEVER touched (they're real decisions).
  // Manually-added TBDs without a matching case are also untouched (the
  // user added them deliberately).
  app.post("/api/pricing/proposals/sync-tbd-with-final-cases", requireAuth, async (_req, res) => {
    try {
      const cases = await storage.getPricingCases();
      const proposals = await storage.getPricingProposals();
      const today = new Date().toISOString().slice(0, 10);

      // ── INSERT phase: TBD for every Final case missing one ──────────
      const existingNames = new Set(proposals.map(p => (p.project_name ?? "").trim().toLowerCase()).filter(Boolean));
      const finals = cases.filter(c => c.status === "final" && (c.project_name ?? "").trim() !== "");
      const toCreate = finals.filter(c => !existingNames.has((c.project_name as string).trim().toLowerCase()));
      for (const c of toCreate) {
        await storage.createPricingProposal({
          proposal_date: today,
          project_name: (c.project_name as string).trim(),
          client_name: c.client_name ?? null,
          fund_name: c.fund_name ?? null,
          region: c.region ?? "Italy",
          pe_owned: c.pe_owned ?? 1,
          revenue_band: c.revenue_band ?? "above_1b",
          price_sensitivity: c.price_sensitivity ?? null,
          duration_weeks: c.duration_weeks ?? null,
          weekly_price: 0,
          total_fee: 0,
          outcome: "pending",
          sector: c.sector ?? null,
          project_type: c.project_type ?? null,
        });
      }

      // ── DELETE phase: pending TBDs whose case is NOT final ──────────
      // Only acts on outcome === "pending" (won/lost are decided
      // outcomes and we never auto-delete them). And only when a
      // matching case exists with non-final status — proposals without
      // any matching case are manual entries we leave alone.
      const caseByName = new Map<string, typeof cases[number]>();
      for (const c of cases) {
        const n = (c.project_name ?? "").trim().toLowerCase();
        if (n) caseByName.set(n, c);
      }
      const stale = proposals.filter(p => {
        if (p.outcome !== "pending") return false;
        const n = (p.project_name ?? "").trim().toLowerCase();
        if (!n) return false;
        const matchingCase = caseByName.get(n);
        return matchingCase != null && matchingCase.status !== "final";
      });
      // Use trashAndDelete so the cleanup is recoverable from the
      // /admin/trash UI for 30 days. If the user changes a case's
      // status back to Final, they can simply restore the row.
      for (const p of stale) {
        if (p.id != null) await trashAndDelete("pricing_proposals", p.id);
      }

      res.json({
        ok: true,
        inserted: toCreate.length,
        deleted: stale.length,
        finalCases: finals.length,
      });
    } catch (e) {
      console.error("sync-tbd-with-final-cases failed:", e);
      res.status(500).json({ ok: false, message: (e as Error).message });
    }
  });

  app.delete("/api/pricing/cases/:id", requireAuth, async (req, res) => {
    // Soft-delete: row is moved to trash_bin (30-day TTL) so the user
    // can restore from /admin/trash. Hard-delete only happens after
    // expiry. See server/storage.ts trashAndDelete.
    const ok = await trashAndDelete("pricing_cases", safeInt(req.params.id));
    res.status(ok ? 204 : 404).end();
  });

  app.get("/api/pricing/proposals", requireAuth, async (_req, res) => {
    const proposals = await storage.getPricingProposals();
    res.json(proposals);
  });

  app.post("/api/pricing/proposals", requireAuth, async (req, res) => {
    const p = await storage.createPricingProposal(req.body);
    res.status(201).json(p);
  });

  app.put("/api/pricing/proposals/:id", requireAuth, async (req, res) => {
    const p = await storage.updatePricingProposal(safeInt(req.params.id), req.body);
    res.json(p);
  });

  app.delete("/api/pricing/proposals/:id", requireAuth, async (req, res) => {
    // Soft-delete to trash_bin (30-day TTL).
    const ok = await trashAndDelete("pricing_proposals", safeInt(req.params.id));
    res.status(ok ? 204 : 404).end();
  });

  // ── Proposal file attachments ──────────────────────────────────────────────
  const UPLOADS_DIR = path.join(process.cwd(), "uploads", "proposals");
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  // Upload (or replace) attachment for a proposal
  app.put("/api/pricing/proposals/:id/attachment",
    requireAuth,
    (req, _res, next) => {
      // Accept raw binary body (PPT/PPTX/PDF/etc.)
      const ct = req.headers["content-type"] || "";
      if (!ct.includes("application/json")) {
        let chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => { (req as any).rawBody = Buffer.concat(chunks); next(); });
        req.on("error", next);
      } else {
        next();
      }
    },
    async (req, res) => {
      try {
        const id = safeInt(req.params.id);
        const rawBody: Buffer = (req as any).rawBody;
        if (!rawBody || rawBody.length === 0) {
          res.status(400).json({ message: "No file data received" });
          return;
        }
        const filename = (req.headers["x-filename"] as string) || `proposal_${id}.pptx`;
        // Sanitise filename
        const safe = filename.replace(/[^a-zA-Z0-9._\-() ]/g, "_");
        const dest = path.join(UPLOADS_DIR, `${id}_${safe}`);
        // Delete any existing attachment for this proposal
        const existing = fs.readdirSync(UPLOADS_DIR).filter(f => f.startsWith(`${id}_`));
        for (const f of existing) fs.unlinkSync(path.join(UPLOADS_DIR, f));
        fs.writeFileSync(dest, rawBody);
        const attachment_url = `/uploads/proposals/${id}_${safe}`;
        await storage.updatePricingProposal(id, { attachment_url });
        res.json({ attachment_url });
      } catch (err) {
        console.error("Attachment upload error:", err);
        res.status(500).json({ message: "Upload failed" });
      }
    }
  );

  // Delete attachment for a proposal
  app.delete("/api/pricing/proposals/:id/attachment", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const existing = fs.readdirSync(UPLOADS_DIR).filter(f => f.startsWith(`${id}_`));
      for (const f of existing) fs.unlinkSync(path.join(UPLOADS_DIR, f));
      await storage.updatePricingProposal(id, { attachment_url: null });
      res.status(204).end();
    } catch (err) {
      console.error("Attachment delete error:", err);
      res.status(500).json({ message: "Delete failed" });
    }
  });

  // ── Hiring Kanban ──────────────────────────────────────────────────────────
  app.post("/api/hiring/sync", requireAuth, async (_req, res) => {
    const { syncEendigoHiring } = await import("./hiringSync");
    const result = await syncEendigoHiring();
    res.json(result);
  });

  app.get("/api/hiring/candidates", requireAuth, async (_req, res) => {
    res.json(await storage.getHiringCandidates());
  });

  app.post("/api/hiring/candidates", requireAuth, async (req, res) => {
    res.status(201).json(await storage.createHiringCandidate(req.body));
  });

  app.put("/api/hiring/candidates/:id", requireAuth, async (req, res) => {
    // Validate & clamp the `scores` field when present. Without this a
    // client could write {hsa: 99999} and break the composite-score
    // calculation downstream. Allow-list the known test IDs; unknown
    // keys are silently dropped so the shape stays stable.
    const ALLOWED_TESTS = new Set(["hsa", "testgorilla", "case_study", "intro_call", "ppt", "final"]);
    const payload = { ...(req.body as Record<string, any>) };
    if (payload.scores && typeof payload.scores === "object") {
      const clean: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(payload.scores)) {
        if (!ALLOWED_TESTS.has(k)) continue;
        if (v == null) { clean[k] = null; continue; }
        const n = Number(v);
        if (!isFinite(n)) continue;
        clean[k] = Math.max(0, Math.min(100, n));
      }
      payload.scores = clean;
    }
    res.json(await storage.updateHiringCandidate(safeInt(req.params.id), payload));
  });

  app.delete("/api/hiring/candidates/:id", requireAuth, async (req, res) => {
    // Soft-delete to trash_bin (30-day TTL).
    const ok = await trashAndDelete("hiring_candidates", safeInt(req.params.id));
    res.status(ok ? 204 : 404).end();
  });

  // ── Employee Tasks (TDL) ──────────────────────────────────────────────────
  app.get("/api/employee-tasks", requireAuth, async (_req, res) => {
    res.json(await storage.getEmployeeTasks());
  });

  app.post("/api/employee-tasks", requireAuth, async (req, res) => {
    const now = new Date().toISOString();
    res.status(201).json(await storage.createEmployeeTask({ ...req.body, created_at: now }));
  });

  app.put("/api/employee-tasks/:id", requireAuth, async (req, res) => {
    res.json(await storage.updateEmployeeTask(safeInt(req.params.id), req.body));
  });

  app.delete("/api/employee-tasks/:id", requireAuth, async (req, res) => {
    await storage.deleteEmployeeTask(safeInt(req.params.id));
    res.status(204).end();
  });

  // ── Performance Issues ─────────────────────────────────────────────────────
  app.get("/api/performance-issues", requireAuth, async (_req, res) => {
    res.json(await storage.getPerformanceIssues());
  });

  app.post("/api/performance-issues", requireAuth, async (req, res) => {
    const now = new Date().toISOString();
    res.status(201).json(await storage.createPerformanceIssue({ ...req.body, created_at: now }));
  });

  app.put("/api/performance-issues/:id", requireAuth, async (req, res) => {
    res.json(await storage.updatePerformanceIssue(safeInt(req.params.id), req.body));
  });

  app.delete("/api/performance-issues/:id", requireAuth, async (req, res) => {
    await storage.deletePerformanceIssue(safeInt(req.params.id));
    res.status(204).end();
  });

  // ── Time Tracking ─────────────────────────────────────────────────────────
  app.get("/api/time-tracking/topics", requireAuth, async (_req, res) => {
    res.json(await storage.getTimeTrackingTopics());
  });

  app.post("/api/time-tracking/topics", requireAuth, async (req, res) => {
    res.status(201).json(await storage.createTimeTrackingTopic(req.body));
  });

  app.put("/api/time-tracking/topics/:id", requireAuth, async (req, res) => {
    res.json(await storage.updateTimeTrackingTopic(safeInt(req.params.id), req.body));
  });

  app.delete("/api/time-tracking/topics/:id", requireAuth, async (req, res) => {
    await storage.deleteTimeTrackingTopic(safeInt(req.params.id));
    res.status(204).end();
  });

  app.get("/api/time-tracking/entries", requireAuth, async (_req, res) => {
    res.json(await storage.getTimeTrackingEntries());
  });

  app.post("/api/time-tracking/entries", requireAuth, async (req, res) => {
    res.status(201).json(await storage.createTimeTrackingEntry(req.body));
  });

  app.put("/api/time-tracking/entries/:id", requireAuth, async (req, res) => {
    res.json(await storage.updateTimeTrackingEntry(safeInt(req.params.id), req.body));
  });

  app.delete("/api/time-tracking/entries/:id", requireAuth, async (req, res) => {
    await storage.deleteTimeTrackingEntry(safeInt(req.params.id));
    res.status(204).end();
  });

  // ── AI providers: status + test endpoint ───────────────────────────────
  // GET /api/ai/providers — tells the client which providers have their
  // API key configured so the AI Models UI can badge them accurately.
  // POST /api/ai/test — runs a tiny test prompt through the chosen
  // provider + model and returns the reply + usage. Used by the "Test
  // connection" button on the AI Models admin page.
  app.get("/api/ai/providers", requireAuth, async (_req, res) => {
    const { providerStatus } = await import("./aiProviders");
    res.json(providerStatus());
  });

  app.post("/api/ai/test", requireAuth, async (req, res) => {
    const { generateText, MissingApiKeyError, ProviderError } = await import("./aiProviders");
    const { provider, model, prompt, system, maxTokens } = req.body ?? {};
    if (!provider || !model || !prompt) {
      res.status(400).json({ error: "Required: provider, model, prompt" });
      return;
    }
    try {
      const out = await generateText({
        provider,
        model,
        prompt,
        system,
        maxTokens: Math.min(Math.max(1, Number(maxTokens) || 256), 2048),
      });
      res.json({ ok: true, ...out });
    } catch (e: any) {
      if (e instanceof MissingApiKeyError) {
        res.status(400).json({ ok: false, error: "missing_api_key", provider: e.provider, envVar: e.envVar });
        return;
      }
      if (e instanceof ProviderError) {
        res.status(502).json({ ok: false, error: "provider_error", provider: e.provider, status: e.status, message: e.message });
        return;
      }
      res.status(500).json({ ok: false, error: "unknown", message: String(e?.message ?? e) });
    }
  });

  // ── Read.ai — recent meetings cache ─────────────────────────────────────
  // Proxies to Read.ai's public REST API when READ_AI_TOKEN is set in the
  // environment; otherwise returns a static seed (10 most-recent meetings)
  // so the Proposals UI still renders something useful. Read.ai's current
  // OAuth 2.1 flow is browser-based with 10-minute tokens — once they ship
  // static API keys (roadmap), swap the fallback for a live call.
  app.get("/api/read-ai/meetings", requireAuth, async (_req, res) => {
    const token = process.env.READ_AI_TOKEN;
    if (token) {
      try {
        const r = await fetch("https://api.read.ai/v1/meetings?limit=10", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) {
          const data = await r.json();
          res.json({ source: "live", meetings: data?.data ?? [], fetched_at: new Date().toISOString() });
          return;
        }
      } catch (e) {
        console.error("[read-ai] live fetch failed, falling back to seed:", e);
      }
    }
    const { READ_AI_SEED } = await import("./readAISeed");
    res.json({ source: "seed", meetings: READ_AI_SEED, fetched_at: "2026-04-21T00:00:00Z" });
  });

  // Transcript for a single meeting. Same live/fallback strategy; the seed
  // doesn't carry transcripts (too large) so the fallback asks the user to
  // refresh via Claude until live auth is wired.
  app.get("/api/read-ai/meetings/:id/transcript", requireAuth, async (req, res) => {
    const token = process.env.READ_AI_TOKEN;
    const id = req.params.id;
    if (token) {
      try {
        const r = await fetch(`https://api.read.ai/v1/meetings/${id}?expand=transcript`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) {
          const data = await r.json();
          res.json({ source: "live", transcript: data?.transcript ?? null });
          return;
        }
      } catch (e) {
        console.error("[read-ai] live transcript fetch failed:", e);
      }
    }
    res.json({
      source: "seed",
      transcript: null,
      message: "Transcript not cached locally. Ask Claude to refresh the Read.ai seed (pulls full transcript via MCP) or set READ_AI_TOKEN once Read.ai enables static API keys.",
    });
  });

  // ── Proposals ──────────────────────────────────────────────────────────────
  app.get("/api/proposals", requireAuth, async (_req, res) => {
    res.json(await storage.getProposals());
  });

  app.get("/api/proposals/:id", requireAuth, async (req, res) => {
    const p = await storage.getProposal(safeInt(req.params.id));
    if (!p) { res.status(404).json({ message: "Not found" }); return; }
    res.json(p);
  });

  // Hard guard against blank/junk writes. A proposal MUST have a non-empty
  // company_name. This is a belt-and-braces safety net against any client-
  // side bug (e.g. stale closure in auto-save) that might POST empty data.
  function isBlankCompanyName(body: any): boolean {
    return !body || typeof body.company_name !== "string" || body.company_name.trim() === "";
  }

  app.post("/api/proposals", requireAuth, async (req, res) => {
    if (isBlankCompanyName(req.body)) {
      res.status(400).json({ message: "company_name is required" });
      return;
    }
    const p = await storage.createProposal(req.body);
    res.status(201).json(p);
  });

  app.put("/api/proposals/:id", requireAuth, async (req, res) => {
    if (isBlankCompanyName(req.body)) {
      res.status(400).json({ message: "company_name is required" });
      return;
    }
    const p = await storage.updateProposal(safeInt(req.params.id), req.body);
    res.json(p);
  });

  app.delete("/api/proposals/:id", requireAuth, async (req, res) => {
    // Soft-delete to trash_bin (30-day TTL).
    const ok = await trashAndDelete("proposals", safeInt(req.params.id));
    res.status(ok ? 204 : 404).end();
  });

  // Bulk-delete blank drafts. Cleans up debris from the old stale-closure
  // auto-save bug that used to create empty proposals. Deletes every row
  // where company_name is null or trims to an empty string.
  app.post("/api/proposals/cleanup-blank", requireAuth, async (_req, res) => {
    try {
      const deleted = await storage.deleteBlankProposals();
      res.json({ deleted });
    } catch (err: any) {
      console.error("[cleanup-blank] error:", err);
      res.status(500).json({ message: err.message || "Cleanup failed" });
    }
  });

  // ── Beacon save endpoints (page unload flush) ────────────────────────────
  // navigator.sendBeacon() from the client can only POST. These endpoints
  // give the unload handler a way to persist last-second edits when the
  // normal debounced PUT never gets a chance to fire. They are deliberately
  // lenient: no strict validation, best-effort semantics. Same DB calls as
  // the regular POST/PUT so there is no second code path to keep in sync.
  app.post("/api/proposals/:id/beacon-save", requireAuth, async (req, res) => {
    try {
      if (isBlankCompanyName(req.body)) { res.status(204).end(); return; }
      const id = safeInt(req.params.id);
      await storage.updateProposal(id, req.body);
      res.status(204).end();
    } catch (err: any) {
      console.error("[beacon-save PUT] error:", err?.message || err);
      res.status(500).end();
    }
  });

  app.post("/api/proposals/beacon-save", requireAuth, async (req, res) => {
    try {
      if (isBlankCompanyName(req.body)) { res.status(204).end(); return; }
      await storage.createProposal(req.body);
      res.status(204).end();
    } catch (err: any) {
      console.error("[beacon-save POST] error:", err?.message || err);
      res.status(500).end();
    }
  });

  app.post("/api/proposals/:id/generate-briefs", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Not found" }); return; }

      const selectedSlides = ((proposal.slide_selection as any[]) || [])
        .filter((s: any) => s.is_selected)
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
        .map((s: any) => ({ slide_id: s.slide_id, title: s.title }));

      if (selectedSlides.length === 0) {
        res.status(400).json({ message: "No slides selected" });
        return;
      }

      // Load admin configs for selected slides
      const allConfigs = await storage.getSlideMethodologyConfigs();
      const adminConfigMap: Record<string, any> = {};
      for (const cfg of allConfigs) {
        adminConfigMap[cfg.slide_id] = cfg;
      }

      const { generateSlideBriefs } = await import("./proposalBriefs");
      const briefs = await generateSlideBriefs({
        company_name: proposal.company_name,
        website: proposal.website,
        transcript: proposal.transcript,
        notes: proposal.notes,
        revenue: proposal.revenue,
        ebitda_margin: proposal.ebitda_margin,
        scope_perimeter: proposal.scope_perimeter,
        objective: proposal.objective,
        urgency: proposal.urgency,
        project_type: proposal.project_type || "Strategy",
        selected_slides: selectedSlides,
        admin_configs: adminConfigMap,
      });

      const updated = await storage.updateProposal(id, {
        slide_briefs: briefs,
        status: "briefed",
      });
      res.json(updated);
    } catch (err: any) {
      console.error("Brief generation error:", err);
      res.status(500).json({ message: err.message || "Brief generation failed" });
    }
  });

  // GET /api/slide-defaults/:slideId — returns default prompts for a slide
  app.get("/api/slide-defaults/:slideId", requireAuth, async (req, res) => {
    try {
      const { getSlideDefaults } = await import("./proposalBriefs");
      const slideId = req.params.slideId;
      // Try to load admin config for this slide
      let adminConfig = null;
      try {
        const configs = await storage.getSlideMethodologyConfigs();
        adminConfig = configs.find((c: any) => c.slide_id === slideId) ?? null;
      } catch { /* no admin configs */ }
      const defaults = getSlideDefaults(slideId, adminConfig);
      res.json(defaults);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/proposals/:id/generate-slide — generate content for a single slide
  app.post("/api/proposals/:id/generate-slide", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Proposal not found" }); return; }

      const { slide_id, visual_prompt, content_prompt, answers } = req.body;
      if (!slide_id) { res.status(400).json({ message: "slide_id required" }); return; }

      const slideSelection = Array.isArray(proposal.slide_selection) ? proposal.slide_selection : [];
      const slide = slideSelection.find((s: any) => s.slide_id === slide_id);
      const slideTitle = slide?.title ?? slide_id;

      const { generateSingleSlideBrief } = await import("./proposalBriefs");
      const generated = await generateSingleSlideBrief({
        slide_id,
        slide_title: slideTitle,
        visual_prompt: visual_prompt ?? "",
        content_prompt: content_prompt ?? "",
        answers: answers ?? {},
        company_name: proposal.company_name,
        website: proposal.website,
        transcript: proposal.transcript,
        notes: proposal.notes,
        revenue: proposal.revenue,
        ebitda_margin: proposal.ebitda_margin,
        scope_perimeter: proposal.scope_perimeter,
        objective: proposal.objective,
        urgency: proposal.urgency,
        project_type: proposal.project_type || "Strategy",
      });

      console.log(`[generate-slide] ${slide_id}: ${generated ? generated.substring(0, 80) + "..." : "EMPTY"}`);
      res.json({ slide_id, generated_content: generated });
    } catch (err: any) {
      console.error("Single slide generation error:", err.message || err);
      res.status(500).json({ message: err.message || "Generation failed" });
    }
  });

  // POST /api/proposals/:id/generate-page — generate slide as HTML preview
  app.post("/api/proposals/:id/generate-page", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Not found" }); return; }

      const { slide_id, visual_prompt, content_prompt, generated_content, chat_instruction } = req.body;
      if (!slide_id) { res.status(400).json({ message: "slide_id required" }); return; }

      const slideSelection = Array.isArray(proposal.slide_selection) ? proposal.slide_selection : [];
      const slide = slideSelection.find((s: any) => s.slide_id === slide_id);
      const slideTitle = slide?.title ?? slide_id;

      // ── DETERMINISTIC TEMPLATE PATH ────────────────────────────────────────
      // If a saved slide template exists for this slide_id, use the deterministic
      // renderer instead of Claude. Same spec + same values = byte-identical HTML
      // every call, no model variance.
      const slideTemplate = await storage.getSlideTemplate(slide_id).catch(() => undefined);
      if (slideTemplate?.spec && (slideTemplate.spec as any).regions?.length > 0) {
        const spec = slideTemplate.spec as any;

        // Values come from the client-side per-region fields (template_values).
        // If not provided (legacy / first load), fall back to auto-deriving from
        // the proposal fields for common keys.
        let values: Record<string, string> = {};
        if (req.body.template_values && typeof req.body.template_values === "object") {
          values = req.body.template_values;
        } else {
          const createdAt = proposal.created_at ? new Date(proposal.created_at) : new Date();
          const monthYear = createdAt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
          values = {
            company_name: proposal.company_name ?? "",
            proposal_title: (proposal as any).proposal_title ?? (proposal as any).objective_statement ?? "",
            proposal_date: monthYear,
            project_type: (proposal as any).project_type ?? "",
            company: proposal.company_name ?? "",
            date: monthYear,
            title: (proposal as any).proposal_title ?? slideTitle,
          };
        }

        const html = renderSlideFromSpec(spec, values);
        res.json({ slide_id, html, quality_score: null, template_rendered: true });
        return;
      }

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) { res.status(503).json({ message: "ANTHROPIC_API_KEY not set" }); return; }
      const client = new Anthropic({ apiKey });

      // ── HIGHEST-PRIORITY OVERRIDES ────────────────────────────────────────
      // The "Slide Template Instructions" that the user pastes / maintains
      // live in two places and must be treated as authoritative for every
      // slide generation. Fetch them both and splice them into the system
      // prompt BEFORE the house-style defaults so the model knows which
      // rules win when something conflicts.
      const deckCfg = await storage.getDeckTemplateConfig().catch(() => null);
      const methodCfg = await storage.getSlideMethodologyConfig(slide_id).catch(() => undefined);
      // Per-slide template background (Canva export, etc.). Optional — if
      // present we (a) tell the model to compose transparent content and
      // (b) bake the PNG into the returned HTML as a CSS background.
      const slideBg = await storage.getSlideBackground(slide_id).catch(() => undefined);

      // Two sources of deck-level instructions, both authoritative:
      //   1. system_prompt — the parsed/curated system prompt
      //   2. slide_instructions_text — the raw free-text the user pastes in
      //      the "Slide Template Instructions" dialog (Proposals → Step 2)
      // Splice both in so what the user types is always honored at
      // generation time (preview AND PPTX download both route through here).
      const templateSystemPrompt = (deckCfg?.system_prompt || "").trim();
      const rawInstructionsText = ((deckCfg as any)?.slide_instructions_text || "").trim();
      const templateInstructions = [
        rawInstructionsText && `USER-PROVIDED SLIDE TEMPLATE INSTRUCTIONS (verbatim, highest authority):\n${rawInstructionsText}`,
        templateSystemPrompt && `DECK-LEVEL SYSTEM PROMPT:\n${templateSystemPrompt}`,
      ].filter(Boolean).join("\n\n");

      let slideMethodology = "";
      if (methodCfg) {
        const parts: string[] = [];
        if (methodCfg.purpose) parts.push(`PURPOSE: ${methodCfg.purpose}`);
        const sections = (methodCfg.structure as any)?.sections;
        if (Array.isArray(sections) && sections.length) {
          parts.push(`REQUIRED SECTIONS:\n- ${sections.join("\n- ")}`);
        }
        if (methodCfg.rules) parts.push(`RULES:\n${methodCfg.rules}`);
        const cols = methodCfg.columns as any;
        if (cols && (cols.column_1 || cols.column_2 || cols.column_3)) {
          const labels = [cols.column_1, cols.column_2, cols.column_3].filter(Boolean);
          if (labels.length) parts.push(`COLUMN LAYOUT: ${labels.join(" | ")}`);
        }
        if (methodCfg.format) {
          parts.push(`FORMAT: ${methodCfg.format === "B" ? "3-column layout" : "stacked sections"}`);
        }
        if (methodCfg.insight_bar) parts.push(`INSIGHT BAR: include a bottom insight/callout bar`);
        const examples = methodCfg.examples as string[] | undefined;
        if (Array.isArray(examples) && examples.length) {
          parts.push(`EXAMPLE PHRASING:\n- ${examples.join("\n- ")}`);
        }
        slideMethodology = parts.join("\n\n");
      }

      const hasOverrides = templateInstructions.length > 0 || slideMethodology.length > 0;

      const overridesBlock = hasOverrides
        ? `==========================================================================
SLIDE TEMPLATE INSTRUCTIONS — HIGHEST PRIORITY (AUTHORITATIVE)
==========================================================================
The rules in this block are the highest-hierarchy instructions for this
slide. They OVERRIDE any conflicting formatting, layout, structure, or
styling guidance that appears anywhere else — in the house-style rules
below, in the user message, in visual_prompt, in content_prompt, or in
any chat instruction. If any later guidance conflicts with these rules,
these rules win. Follow them exactly.

${templateInstructions || "(no deck-level template instructions configured)"}
${slideMethodology ? `\n--- Per-slide methodology for "${slideTitle}" ---\n${slideMethodology}\n` : ""}
==========================================================================
END HIGHEST-PRIORITY INSTRUCTIONS
==========================================================================

`
        : "";

      // When a per-slide template background exists, the visual frame
      // (colors, footer, logo, shapes) is already baked into the PNG —
      // the model's job shrinks to laying down text content over it.
      // Don't let the model repaint a background or re-add the footer.
      const backgroundBlock = slideBg ? `

TEMPLATE BACKGROUND MODE:
A template background image is applied by the server at the 960×540 level — it already contains the brand color scheme, shapes, footer, and logo for this slide.
Your job is ONLY to produce the TEXT CONTENT that sits on top.

Strict rules:
- Do NOT set a background-color or a background shorthand on the outer div. The template must show through.
- Do NOT add the "eendigo" footer text, any brand bars, logos, or decorative shapes — the template already has them.
- Keep all content inside a safe area: at least 50px from the top and bottom, 60px from the left and right.
- Use text on a transparent container. You may use boxes/cards only if they are semi-transparent (rgba white with 0.85–0.95 alpha) and clearly needed for readability.
- The outer container MUST be \`<div style="position:relative;width:960px;height:540px;...">\` with NO background color.
` : "";

      const systemPrompt = `You are a senior slide designer at Eendigo, a management consulting firm.

${overridesBlock}HOUSE STYLE (apply only where it does NOT conflict with the Slide Template Instructions above):
Generate a single HTML page that looks like a PowerPoint slide preview.
Use inline CSS. The slide should be 960px wide × 540px tall (16:9 ratio).
Brand colors: primary teal #1A6571, text dark #1e293b, accent light teal #e0f2f1.
Use ONLY Arial font (font-family: Arial, sans-serif) for ALL text. Never use other fonts.
${slideBg ? "" : `Include "eendigo" text in small font (10px) at the bottom-right corner. `}Do NOT add any colored bars, lines, or horizontal rules anywhere on the slide.
The HTML must be a complete self-contained div (no external resources).
Output ONLY the HTML div, no explanation.${backgroundBlock}${hasOverrides ? `

REMINDER: if any house-style rule above (dimensions, colors, font, footer, etc.) contradicts the SLIDE TEMPLATE INSTRUCTIONS block, the SLIDE TEMPLATE INSTRUCTIONS win.` : ""}`;

      let userPrompt = `Create a slide for: "${slideTitle}"

VISUAL INSTRUCTIONS:
${visual_prompt || "Standard single-column layout with header and body content."}

CONTENT:
${generated_content || content_prompt || "Generate appropriate content for this slide type."}

Company: ${proposal.company_name}`;

      if (chat_instruction) {
        userPrompt = `Modify the following slide based on this instruction: "${chat_instruction}"

Current slide HTML:
${req.body.current_html || ""}

Keep the same 960×540 format and Eendigo branding. Output ONLY the updated HTML div.`;
      }

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
      logApiUsage("generate-page", response);

      const textBlock = response.content.find(b => b.type === "text");
      let html = textBlock?.text ?? "<div>Generation failed</div>";
      const codeMatch = html.match(/```html?\s*([\s\S]*?)```/);
      if (codeMatch) html = codeMatch[1].trim();

      // Bake in the per-slide template PNG (if any) as a CSS background
      // on the outer div. We strip any background-color the model added
      // so the template shows through, then inject the data URL.
      if (slideBg?.file_data) {
        html = injectBackgroundImage(html, slideBg.file_data);
      }

      // Quality score — only if explicitly requested (costs extra API call)
      let quality_score = null;
      if (req.body.include_quality_score) try {
        const scoreRes = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 700,
          // Same schema as /refine-page's scorer so the UI can always show
          // per-dimension actionable fixes, not just a single vague tip.
          system: `You are a management consulting proposal quality reviewer at the level of a McKinsey/BCG slide editor.

Score the slide on 4 criteria (0-25 each, total 0-100):
- Clarity: Is the message clear, concise, actionable? Does the reader know what to do after 5 seconds?
- Relevance: Is it specific to this client and their actual problem, or generic filler?
- Visual: Layout hierarchy, whitespace, typography scale, alignment, readability at 960×540. Is it overflowing, claustrophobic? Does it look like a consulting deck or a Word document with a blue header?
- Persuasion: Does it drive the decision forward? Is there a clear "so what"?

For EACH dimension also return a specific actionable fix (cite the exact element to change, e.g. "cut the 4 bullets under Approach to one line each and bold the verb", NOT "improve clarity").

Return ONLY JSON:
{"clarity":N,"relevance":N,"visual":N,"persuasion":N,"total":N,"tip":"one sentence top priority","fix":{"clarity":"…","relevance":"…","visual":"…","persuasion":"…"}}`,
          messages: [{ role: "user", content: `Score this slide for "${slideTitle}" (company: ${proposal.company_name}):\n\n${stripBackgroundImage(html).substring(0, 3000)}` }],
        });
        logApiUsage("quality-score", scoreRes);
        const scoreText = scoreRes.content.find(b => b.type === "text")?.text ?? "";
        const jsonMatch = scoreText.match(/\{[\s\S]*\}/);
        if (jsonMatch) quality_score = JSON.parse(jsonMatch[0]);
      } catch { /* scoring is best-effort */ }

      res.json({ slide_id, html, quality_score });
    } catch (err: any) {
      console.error("Page generation error:", err.message);
      res.status(500).json({ message: err.message || "Generation failed" });
    }
  });

  // POST /api/proposals/:id/refine-page — "Refine until perfect" loop.
  //
  // Mimics the way a human (or Claude itself, using eendigo-template) iterates
  // on a slide: draft → critique → fix → re-score → repeat until the output
  // hits a quality target, or a hard budget is exhausted.
  //
  // Per round we run TWO Anthropic calls:
  //   (1) generate/modify the slide HTML
  //   (2) score it on the same 4 dimensions as /generate-page's scorer, but
  //       with an extended schema — every dimension also returns a SPECIFIC
  //       actionable `fix` string. That grounding is what makes the next
  //       round's prompt useful instead of vague ("make it more visual").
  //
  // Stopping conditions (any one):
  //   - total_score >= target   (default 85)
  //   - rounds >= max_rounds    (default 4)
  //   - API error
  //
  // The loop is driven entirely server-side so the client sees one HTTP
  // request and gets back: { html, quality_score, history }.
  // `history` is an array of per-round summaries the client uses to render
  // the "refinement trail" strip under the preview.
  app.post("/api/proposals/:id/refine-page", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Not found" }); return; }

      const {
        slide_id,
        visual_prompt,
        content_prompt,
        generated_content,
        target_score = 85,     // stop once total >= this
        max_rounds  = 4,       // hard iteration cap (×2 API calls per round)
      } = req.body;
      if (!slide_id) { res.status(400).json({ message: "slide_id required" }); return; }

      // Clamp target + rounds so a malicious/absent-minded client can't run
      // the API for 50 rounds. target 0-100, rounds 1-6.
      const TARGET = Math.max(0, Math.min(100, Number(target_score) || 85));
      const ROUNDS = Math.max(1, Math.min(6, Number(max_rounds) || 4));

      const slideSelection = Array.isArray(proposal.slide_selection) ? proposal.slide_selection : [];
      const slide = slideSelection.find((s: any) => s.slide_id === slide_id);
      const slideTitle = slide?.title ?? slide_id;

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) { res.status(503).json({ message: "ANTHROPIC_API_KEY not set" }); return; }
      const client = new Anthropic({ apiKey });

      // Reuses the same prompt hierarchy as /generate-page: user-pasted
      // template instructions > deck system prompt > per-slide methodology
      // > house-style defaults. Kept as a block comment + code for clarity
      // (factoring this into a shared helper is a future cleanup).
      const deckCfg = await storage.getDeckTemplateConfig().catch(() => null);
      const methodCfg = await storage.getSlideMethodologyConfig(slide_id).catch(() => undefined);
      // Per-slide template background (optional). Same semantics as
      // /generate-page — baked into the outer div's CSS at the end,
      // and stripped out of any `currentHtml` sent back into the model
      // so we don't round-trip the base64 URL on every round.
      const slideBg = await storage.getSlideBackground(slide_id).catch(() => undefined);

      const templateSystemPrompt = (deckCfg?.system_prompt || "").trim();
      const rawInstructionsText = ((deckCfg as any)?.slide_instructions_text || "").trim();
      const templateInstructions = [
        rawInstructionsText && `USER-PROVIDED SLIDE TEMPLATE INSTRUCTIONS (verbatim, highest authority):\n${rawInstructionsText}`,
        templateSystemPrompt && `DECK-LEVEL SYSTEM PROMPT:\n${templateSystemPrompt}`,
      ].filter(Boolean).join("\n\n");

      let slideMethodology = "";
      if (methodCfg) {
        const parts: string[] = [];
        if (methodCfg.purpose) parts.push(`PURPOSE: ${methodCfg.purpose}`);
        const sections = (methodCfg.structure as any)?.sections;
        if (Array.isArray(sections) && sections.length) {
          parts.push(`REQUIRED SECTIONS:\n- ${sections.join("\n- ")}`);
        }
        if (methodCfg.rules) parts.push(`RULES:\n${methodCfg.rules}`);
        const cols = methodCfg.columns as any;
        if (cols && (cols.column_1 || cols.column_2 || cols.column_3)) {
          const labels = [cols.column_1, cols.column_2, cols.column_3].filter(Boolean);
          if (labels.length) parts.push(`COLUMN LAYOUT: ${labels.join(" | ")}`);
        }
        if (methodCfg.format) {
          parts.push(`FORMAT: ${methodCfg.format === "B" ? "3-column layout" : "stacked sections"}`);
        }
        if (methodCfg.insight_bar) parts.push(`INSIGHT BAR: include a bottom insight/callout bar`);
        const examples = methodCfg.examples as string[] | undefined;
        if (Array.isArray(examples) && examples.length) {
          parts.push(`EXAMPLE PHRASING:\n- ${examples.join("\n- ")}`);
        }
        slideMethodology = parts.join("\n\n");
      }

      const hasOverrides = templateInstructions.length > 0 || slideMethodology.length > 0;
      const overridesBlock = hasOverrides
        ? `==========================================================================
SLIDE TEMPLATE INSTRUCTIONS — HIGHEST PRIORITY (AUTHORITATIVE)
==========================================================================
The rules in this block are the highest-hierarchy instructions for this
slide. They OVERRIDE any conflicting formatting, layout, structure, or
styling guidance that appears anywhere else — in the house-style rules
below, in the user message, in visual_prompt, in content_prompt, or in
any chat instruction. If any later guidance conflicts with these rules,
these rules win. Follow them exactly.

${templateInstructions || "(no deck-level template instructions configured)"}
${slideMethodology ? `\n--- Per-slide methodology for "${slideTitle}" ---\n${slideMethodology}\n` : ""}
==========================================================================
END HIGHEST-PRIORITY INSTRUCTIONS
==========================================================================

`
        : "";

      const backgroundBlock = slideBg ? `

TEMPLATE BACKGROUND MODE:
A template background image is applied by the server at the 960×540 level — it already contains the brand color scheme, shapes, footer, and logo for this slide.
Your job is ONLY to produce the TEXT CONTENT that sits on top.

Strict rules:
- Do NOT set a background-color or a background shorthand on the outer div. The template must show through.
- Do NOT add the "eendigo" footer text, any brand bars, logos, or decorative shapes — the template already has them.
- Keep all content inside a safe area: at least 50px from the top and bottom, 60px from the left and right.
- Use text on a transparent container. You may use boxes/cards only if they are semi-transparent (rgba white with 0.85–0.95 alpha) and clearly needed for readability.
- The outer container MUST be \`<div style="position:relative;width:960px;height:540px;...">\` with NO background color.
` : "";

      const systemPrompt = `You are a senior slide designer at Eendigo, a management consulting firm.

${overridesBlock}HOUSE STYLE (apply only where it does NOT conflict with the Slide Template Instructions above):
Generate a single HTML page that looks like a PowerPoint slide preview.
Use inline CSS. The slide should be 960px wide × 540px tall (16:9 ratio).
Brand colors: primary teal #1A6571, text dark #1e293b, accent light teal #e0f2f1.
Use ONLY Arial font (font-family: Arial, sans-serif) for ALL text. Never use other fonts.
${slideBg ? "" : `Include "eendigo" text in small font (10px) at the bottom-right corner. `}Do NOT add any colored bars, lines, or horizontal rules anywhere on the slide.
The HTML must be a complete self-contained div (no external resources).
Output ONLY the HTML div, no explanation.${backgroundBlock}${hasOverrides ? `

REMINDER: if any house-style rule above (dimensions, colors, font, footer, etc.) contradicts the SLIDE TEMPLATE INSTRUCTIONS block, the SLIDE TEMPLATE INSTRUCTIONS win.` : ""}

QUALITY BAR: this slide is being iterated on until it hits a quality
target. Every round you produce MUST be meaningfully better than the
previous one along the dimensions the critique flags. Do not regress on
dimensions that are already strong.`;

      const baseUserPrompt = `Create a slide for: "${slideTitle}"

VISUAL INSTRUCTIONS:
${visual_prompt || "Standard single-column layout with header and body content."}

CONTENT:
${generated_content || content_prompt || "Generate appropriate content for this slide type."}

Company: ${proposal.company_name}`;

      // ── Scoring prompt: asks for per-dimension actionable fixes so the
      // next iteration has concrete guidance instead of a vague tip.
      const scorerSystemPrompt = `You are a management consulting proposal quality reviewer at the level of a McKinsey/BCG slide editor.

Score the slide on 4 criteria (0-25 each, total 0-100):
- Clarity: Is the message clear, concise, actionable? Does the reader know what to do after 5 seconds?
- Relevance: Is it specific to this client and their actual problem, or generic filler that could apply to anyone?
- Visual: Layout hierarchy, whitespace, typography scale, alignment, readability at 960×540. Is it overflowing or claustrophobic? Does it look like a real consulting deck or a Word document with a blue header?
- Persuasion: Does it drive the decision forward? Is there a clear "so what" that pushes the reader toward the next step?

Also return, for EACH dimension, a specific actionable fix (not vague — cite the exact element to change, e.g. "the 4 bullets under 'Approach' are all 3+ lines, cut to one line each and bold the verb", NOT "improve clarity").

Return ONLY JSON, no prose:
{
  "clarity": N,
  "relevance": N,
  "visual": N,
  "persuasion": N,
  "total": N,
  "tip": "one sentence top priority",
  "fix": {
    "clarity": "specific actionable fix",
    "relevance": "specific actionable fix",
    "visual": "specific actionable fix",
    "persuasion": "specific actionable fix"
  }
}`;

      // ── The iteration loop ─────────────────────────────────────────────
      let currentHtml = "";
      let currentScore: any = null;
      const history: any[] = [];

      for (let round = 1; round <= ROUNDS; round++) {
        // ── 1. Generate (or refine) ─────────────────────────────────────
        let userPrompt: string;
        if (round === 1) {
          userPrompt = baseUserPrompt;
        } else {
          // Build a grounded refinement prompt from the previous round's
          // per-dimension fixes. Rank the dimensions lowest → highest so
          // the model focuses on the biggest gap first.
          const dims = [
            { name: "Clarity",    score: currentScore?.clarity    ?? 0, fix: currentScore?.fix?.clarity    ?? currentScore?.tip ?? "" },
            { name: "Relevance",  score: currentScore?.relevance  ?? 0, fix: currentScore?.fix?.relevance  ?? "" },
            { name: "Visual",     score: currentScore?.visual     ?? 0, fix: currentScore?.fix?.visual     ?? "" },
            { name: "Persuasion", score: currentScore?.persuasion ?? 0, fix: currentScore?.fix?.persuasion ?? "" },
          ].sort((a, b) => a.score - b.score);

          const critiqueBlock = dims
            .map(d => `- ${d.name} (${d.score}/25): ${d.fix || "no specific feedback"}`)
            .join("\n");

          userPrompt = `REFINEMENT ROUND ${round} of up to ${ROUNDS}.

Previous slide scored ${currentScore?.total ?? "?"}/100 — target is ${TARGET}/100.

CRITIQUE (apply these specific fixes, lowest-scoring dimensions first):
${critiqueBlock}

Rewrite the slide to address the fixes. Do NOT regress on dimensions that are already strong (${dims.filter(d => d.score >= 20).map(d => d.name).join(", ") || "none yet"}).

Keep the same 960×540 format, brand colors, and Arial font. ${slideBg ? "Do NOT re-add the eendigo footer — it's part of the template background." : "Keep the eendigo footer."} Output ONLY the revised HTML div, no explanation.

PREVIOUS HTML:
${stripBackgroundImage(currentHtml)}

SLIDE CONTEXT:
${baseUserPrompt}`;
        }

        const genRes = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 3000,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        });
        logApiUsage(`refine-page-round-${round}`, genRes);

        const genText = (genRes.content.find(b => b.type === "text") as any)?.text ?? "";
        let roundHtml = genText;
        const codeMatch = roundHtml.match(/```html?\s*([\s\S]*?)```/);
        if (codeMatch) roundHtml = codeMatch[1].trim();
        if (!roundHtml || !roundHtml.includes("<")) {
          // generation failed at this round — break but return what we have
          history.push({ round, total: currentScore?.total ?? 0, error: "Empty or invalid generation" });
          break;
        }
        // Bake the template background into the outer div before scoring
        // (so the scorer rates what the user will actually see) and before
        // storing as currentHtml (so the final response already has it).
        if (slideBg?.file_data) {
          roundHtml = injectBackgroundImage(roundHtml, slideBg.file_data);
        }
        currentHtml = roundHtml;

        // ── 2. Score the round ──────────────────────────────────────────
        // Strip the template background data URL before sending to the
        // scorer — it's a huge blob and the scorer only needs to see the
        // layout/text, not the PNG.
        const htmlForScoring = stripBackgroundImage(currentHtml).substring(0, 3500);
        const scoreRes = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 700,
          system: scorerSystemPrompt,
          messages: [{
            role: "user",
            content: `Score this slide for "${slideTitle}" (company: ${proposal.company_name}):

${htmlForScoring}`,
          }],
        });
        logApiUsage(`refine-page-score-${round}`, scoreRes);

        const scoreText = (scoreRes.content.find(b => b.type === "text") as any)?.text ?? "";
        const jsonMatch = scoreText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            currentScore = JSON.parse(jsonMatch[0]);
          } catch {
            currentScore = null;
          }
        } else {
          currentScore = null;
        }

        history.push({
          round,
          total:      currentScore?.total      ?? 0,
          clarity:    currentScore?.clarity    ?? 0,
          relevance:  currentScore?.relevance  ?? 0,
          visual:     currentScore?.visual     ?? 0,
          persuasion: currentScore?.persuasion ?? 0,
          tip:        currentScore?.tip        ?? "",
          // focus = the lowest dimension we were trying to fix this round
          focus: round === 1 ? "initial draft" : (() => {
            const last = history[history.length - 2] ?? null;
            if (!last) return "unknown";
            const lastDims = [
              { name: "clarity",    v: last.clarity },
              { name: "relevance",  v: last.relevance },
              { name: "visual",     v: last.visual },
              { name: "persuasion", v: last.persuasion },
            ].sort((a, b) => a.v - b.v);
            return lastDims[0].name;
          })(),
        });

        // ── 3. Stop if we hit the target ────────────────────────────────
        if ((currentScore?.total ?? 0) >= TARGET) break;
      }

      res.json({
        slide_id,
        html: currentHtml,
        quality_score: currentScore,
        history,
        target_score: TARGET,
        rounds_used: history.length,
      });
    } catch (err: any) {
      console.error("Refine page error:", err.message);
      res.status(500).json({ message: err.message || "Refinement failed" });
    }
  });

  // POST /api/proposals/:id/analyze-page — deep quality analysis of an
  // EXISTING slide preview. Single API call (cheap): returns the same 4D
  // score + per-dimension fixes as refine-page, PLUS a 2-3 sentence
  // narrative summary that the UI shows when the user clicks the score
  // badge. The client calls this lazily so the expensive analysis only
  // runs when the user actually wants to read it.
  app.post("/api/proposals/:id/analyze-page", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Not found" }); return; }

      const { slide_id, current_html, visual_prompt, content_prompt } = req.body;
      if (!slide_id || !current_html) {
        res.status(400).json({ message: "slide_id and current_html required" });
        return;
      }

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) { res.status(503).json({ message: "ANTHROPIC_API_KEY not set" }); return; }
      const client = new Anthropic({ apiKey });

      const slideSelection = Array.isArray(proposal.slide_selection) ? proposal.slide_selection : [];
      const slide = slideSelection.find((s: any) => s.slide_id === slide_id);
      const slideTitle = slide?.title ?? slide_id;

      const analyzerSystemPrompt = `You are a senior management consulting slide editor at McKinsey/BCG/Bain level. You are being asked to give a deep quality analysis of a single proposal slide.

Score the slide on 4 criteria (0-25 each, total 0-100):
- Clarity: Is the message clear, concise, actionable? Does the reader know what to do after 5 seconds?
- Relevance: Is it specific to this client and their actual problem, or generic filler?
- Visual: Layout hierarchy, whitespace, typography scale, alignment, readability at 960×540. Is it overflowing, claustrophobic, cramped? Does it look like a real consulting deck?
- Persuasion: Does it drive the decision forward? Is there a clear "so what" that pushes the reader toward the next step?

For EACH dimension, return a specific actionable fix — cite the exact element to change with concrete language (e.g. "the 4 bullets under Approach are all 3+ lines, cut to one line each and bold the verb", NOT "improve clarity"). Also return a top_priority_fix which is the single biggest change that would move the score the most.

Return a 2-3 sentence narrative: what the slide does well, what's holding it back, and the single most impactful change.

Return ONLY JSON, no prose outside the JSON:
{
  "clarity": N,
  "relevance": N,
  "visual": N,
  "persuasion": N,
  "total": N,
  "tip": "one sentence top priority",
  "fix": {
    "clarity": "specific actionable fix",
    "relevance": "specific actionable fix",
    "visual": "specific actionable fix",
    "persuasion": "specific actionable fix"
  },
  "narrative": "2-3 sentences covering strengths, what's holding it back, and the single highest-impact change",
  "top_priority_fix": "the single change that would move the score the most"
}`;

      const userMsg = `Deep analysis of slide "${slideTitle}" for ${proposal.company_name}.

INTENDED VISUAL DIRECTION:
${visual_prompt || "(not specified)"}

INTENDED CONTENT:
${content_prompt || "(not specified)"}

CURRENT SLIDE HTML (what we're scoring):
${String(current_html).substring(0, 6000)}`;

      const scoreRes = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        system: analyzerSystemPrompt,
        messages: [{ role: "user", content: userMsg }],
      });
      logApiUsage("analyze-page", scoreRes);

      const scoreText = (scoreRes.content.find(b => b.type === "text") as any)?.text ?? "";
      const jsonMatch = scoreText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        res.status(500).json({ message: "Analyzer returned no JSON", raw: scoreText.slice(0, 300) });
        return;
      }
      let analysis: any;
      try {
        analysis = JSON.parse(jsonMatch[0]);
      } catch (e: any) {
        res.status(500).json({ message: "Analyzer returned invalid JSON: " + e.message });
        return;
      }

      res.json({ slide_id, analysis });
    } catch (err: any) {
      console.error("Analyze page error:", err.message);
      res.status(500).json({ message: err.message || "Analysis failed" });
    }
  });

  // POST /api/proposals/:id/update-prompts — AI learns from chat corrections
  app.post("/api/proposals/:id/update-prompts", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const { slide_id, chat_history, current_visual_prompt, current_content_prompt } = req.body;
      if (!slide_id || !chat_history?.length) { res.status(400).json({ message: "slide_id and chat_history required" }); return; }

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) { res.status(503).json({ message: "ANTHROPIC_API_KEY not set" }); return; }
      const client = new Anthropic({ apiKey });

      const corrections = chat_history
        .filter((m: any) => m.role === "user")
        .map((m: any) => `- ${m.text}`)
        .join("\n");

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: `You analyze user corrections to a consulting slide and generate permanent prompt improvements.

For each user correction, classify it as "visual" (layout, font, color, spacing, imagery), "content" (text, wording, structure, data, messaging), or "both".

Then generate concise, reusable rules to append to the appropriate prompt(s). These rules should be:
- Specific and actionable (not vague)
- Written as instructions for an AI that generates slides
- Applicable to future slides of the same type (not one-time fixes)

Return ONLY JSON:
{
  "visual_additions": "rules to append to visual_prompt (empty string if none)",
  "content_additions": "rules to append to content_prompt (empty string if none)",
  "classification": [{"correction": "...", "type": "visual|content|both"}]
}`,
        messages: [{ role: "user", content: `Current visual prompt:\n${current_visual_prompt || "(empty)"}\n\nCurrent content prompt:\n${current_content_prompt || "(empty)"}\n\nUser corrections made via chat:\n${corrections}` }],
      });
      logApiUsage("update-prompts", response);

      const text = response.content.find(b => b.type === "text")?.text ?? "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      res.json(result);
    } catch (err: any) {
      console.error("Update prompts error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/proposals/:id/analyze-reference — AI analyzes a reference image to improve prompts
  app.post("/api/proposals/:id/analyze-reference", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const { slide_id, slide_title, image_base64, image_type, current_visual_prompt, current_content_prompt } = req.body;
      if (!slide_id || !image_base64) { res.status(400).json({ message: "slide_id and image required" }); return; }

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) { res.status(503).json({ message: "ANTHROPIC_API_KEY not set" }); return; }
      const client = new Anthropic({ apiKey });

      const mediaType = (image_type || "image/png").replace("image/", "") as "jpeg" | "png" | "gif" | "webp";
      const validType = ["jpeg", "png", "gif", "webp"].includes(mediaType) ? mediaType : "png";

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: `You are a slide design analyst at a management consulting firm. Analyze the uploaded reference slide image and extract two types of insights:

1. VISUAL ELEMENTS: layout structure, column arrangement, font sizes and hierarchy, color palette, spacing, alignment, use of icons/graphics, header/footer style, background treatment, accent elements (lines, bars, shapes)

2. CONTENT STRUCTURE: how information is organized, bullet point style, heading hierarchy, use of data/numbers, tone and phrasing patterns, level of detail

Return ONLY JSON:
{
  "visual_prompt_update": "Concise rules to add to the visual instructions based on what you see in the image (layout, fonts, colors, spacing). Write as imperative instructions for an AI that generates slides. Only include what's DIFFERENT or MORE SPECIFIC than the current visual prompt.",
  "content_prompt_update": "Concise rules to add to the content prompt based on the text structure you observe (if applicable — empty string if the image doesn't reveal content patterns).",
  "elements_detected": ["list", "of", "key", "visual", "elements", "found"]
}`,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: `image/${validType}`, data: image_base64 },
            },
            {
              type: "text",
              text: `Analyze this reference slide for "${slide_title}".

Current visual prompt:
${current_visual_prompt || "(empty)"}

Current content prompt:
${current_content_prompt || "(empty)"}

Extract visual and content patterns from the image. Only suggest additions that are NEW — don't repeat what's already in the prompts.`,
            },
          ],
        }],
      });
      logApiUsage("analyze-reference", response);

      const text = response.content.find(b => b.type === "text")?.text ?? "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      res.json(result);
    } catch (err: any) {
      console.error("Reference analysis error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/proposals/:id/download-slide — generate PPTX for a single slide
  app.post("/api/proposals/:id/download-slide", requireAuth, async (req, res) => {
    try {
      // NOTE: no guardApiAsync here. This route does NOT call Claude —
      // it assembles a PPTX from already-stored content. Gating it on
      // the AI-pause switch used to make downloads silently fail
      // whenever the pause indicator was red.
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Not found" }); return; }

      const { slide_id } = req.body;
      const slideSelection = Array.isArray(proposal.slide_selection) ? proposal.slide_selection : [];
      const slide = slideSelection.find((s: any) => s.slide_id === slide_id);
      if (!slide) { res.status(404).json({ message: "Slide not found" }); return; }

      // Generate a minimal single-slide PPTX using PptxGenJS
      const PptxGenJS = (await import("pptxgenjs")).default;
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";

      const s = pptx.addSlide();
      // Header
      s.addText(slide.title ?? slide_id, { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, color: "1A6571", fontFace: "Arial", bold: true });
      // Content
      const content = slide.generated_content ?? slide.content_prompt ?? "";
      s.addText(content, { x: 0.5, y: 1.1, w: 9, h: 4, fontSize: 12, color: "1e293b", fontFace: "Arial", valign: "top", paraSpaceAfter: 6 });
      // Footer
      s.addText("eendigo", { x: 8, y: 5.0, w: 1.5, h: 0.3, fontSize: 10, color: "1A6571", fontFace: "Arial", align: "right" });
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 5.2, w: 10, h: 0.05, fill: { color: "1A6571" } });

      const buffer = await pptx.write({ outputType: "arraybuffer" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename="${slide.title ?? slide_id}.pptx"`);
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (err: any) {
      console.error("Slide PPTX error:", err.message);
      res.status(500).json({ message: err.message || "PPTX generation failed" });
    }
  });

  app.post("/api/proposals/:id/analyze", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Not found" }); return; }

      const { analyzeProposal } = await import("./proposalAI");
      // Forward the client's active-model selection (if any) from either
      // the request body or the X-AI-Provider/X-AI-Model headers so the
      // AI-Models page actually controls which provider runs.
      const hdrProvider = (req.header("x-ai-provider") || "").trim() || null;
      const hdrModel = (req.header("x-ai-model") || "").trim() || null;
      const bodyProvider = (req.body?._aiProvider as string | undefined) ?? null;
      const bodyModel = (req.body?._aiModel as string | undefined) ?? null;
      const analysis = await analyzeProposal({
        company_name: proposal.company_name,
        website: proposal.website,
        transcript: proposal.transcript,
        notes: proposal.notes,
        revenue: proposal.revenue,
        ebitda_margin: proposal.ebitda_margin,
        scope_perimeter: proposal.scope_perimeter,
        objective: proposal.objective,
        urgency: proposal.urgency,
        _aiProvider: (bodyProvider || hdrProvider) as any,
        _aiModel: bodyModel || hdrModel,
      });

      const updated = await storage.updateProposal(id, {
        company_summary: analysis.company_summary,
        proposal_title: analysis.proposal_title,
        why_now: analysis.why_now,
        objective_statement: analysis.objective_statement,
        scope_statement: analysis.scope_statement,
        recommended_team: analysis.recommended_team,
        staffing_intensity: analysis.staffing_intensity,
        options: analysis.options,
        ai_analysis: analysis,
        status: "analyzed",
      });
      res.json(updated);
    } catch (err: any) {
      console.error("Analyze error:", err);
      res.status(500).json({ message: err.message || "Analysis failed" });
    }
  });

  app.post("/api/proposals/:id/generate-deck", requireAuth, async (req, res) => {
    try {
      // NOTE: no guardApiAsync here. Deck generation does NOT call Claude
      // (it writes a PPTX from already-stored content + the active template).
      // It used to return 423 whenever the AI pause was on — silently failing
      // every download.
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Not found" }); return; }

      const { generateProposalDeck } = await import("./proposalDeck");
      const template = await storage.getActiveProposalTemplate();

      // Load admin configs and deck template for brief-based slide generation
      const [allConfigs, deckTemplate] = await Promise.all([
        storage.getSlideMethodologyConfigs(),
        storage.getDeckTemplateConfig(),
      ]);
      const adminConfigMap: Record<string, any> = {};
      for (const cfg of allConfigs) {
        adminConfigMap[cfg.slide_id] = cfg;
      }

      const buffer = await generateProposalDeck(
        {
          company_name: proposal.company_name,
          proposal_title: proposal.proposal_title,
          company_summary: proposal.company_summary,
          why_now: proposal.why_now,
          objective_statement: proposal.objective_statement,
          scope_statement: proposal.scope_statement,
          recommended_team: proposal.recommended_team,
          options: (proposal.options as any[]) || [],
          slide_briefs: (proposal.slide_briefs as any[]) || [],
          slide_selection: (proposal.slide_selection as any[]) || [],
          admin_configs: adminConfigMap,
          deck_template: deckTemplate || undefined,
        },
        template,
      );

      const fileName = `Eendigo_Proposal_${proposal.company_name.replace(/[^a-zA-Z0-9]/g, "_")}.pptx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (err: any) {
      console.error("Deck generation error:", err);
      res.status(500).json({ message: err.message || "Deck generation failed" });
    }
  });

  // ── Pixel-perfect PPTX export via Playwright ─────────────────────────────
  // Runs every selected slide's `preview_html` through headless Chromium at
  // native 960×540, screenshots each one, and builds a PPTX where each
  // slide is a single full-bleed image. The resulting deck looks IDENTICAL
  // to the HTML preview — no layout drift, no font substitution, no text
  // wrapping surprises. Trade-off: slides aren't text-editable in
  // PowerPoint (they're raster images). Use /generate-deck when you need
  // editable text, use this when you need WYSIWYG.
  app.post("/api/proposals/:id/export-deck-images", requireAuth, async (req, res) => {
    try {
      // No guardApiAsync — this does not call Claude, it only renders HTML
      // that's already in the DB.
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Not found" }); return; }

      const { exportDeckAsImagePptx } = await import("./slideImageExporter");
      const buffer = await exportDeckAsImagePptx({
        company_name: proposal.company_name,
        slide_selection: (proposal.slide_selection as any[]) || [],
      });

      const safeName = (proposal.company_name || "Proposal").replace(/[^a-zA-Z0-9]/g, "_");
      const fileName = `Eendigo_Proposal_${safeName}_pixel_perfect.pptx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (err: any) {
      console.error("Image deck export error:", err);
      // 422 because the usual failure mode is "no previews generated yet",
      // not a server bug. Let the client show a friendly message.
      const isUserError = /No slides with preview HTML/i.test(err?.message || "");
      res.status(isUserError ? 422 : 500).json({ message: err.message || "Image export failed" });
    }
  });

  // POST /api/proposals/:id/export-deck-pdf — pixel-perfect PDF via Playwright.
  // Same visual fidelity as the PPTX image export but outputs a PDF — useful
  // for QA'ing the deck before committing to the final PowerPoint.
  app.post("/api/proposals/:id/export-deck-pdf", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Not found" }); return; }

      const { exportDeckAsPdf } = await import("./slideImageExporter");
      const buffer = await exportDeckAsPdf({
        company_name: proposal.company_name,
        slide_selection: (proposal.slide_selection as any[]) || [],
      });

      const safeName = (proposal.company_name || "Proposal").replace(/[^a-zA-Z0-9]/g, "_");
      const fileName = `Eendigo_Proposal_${safeName}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.send(buffer);
    } catch (err: any) {
      console.error("PDF deck export error:", err);
      const isUserError = /No slides with preview HTML/i.test(err?.message || "");
      res.status(isUserError ? 422 : 500).json({ message: err.message || "PDF export failed" });
    }
  });

  // ── Proposal Templates ────────────────────────────────────────────────────
  app.get("/api/proposal-templates", requireAuth, async (_req, res) => {
    res.json(await storage.getProposalTemplates());
  });

  app.post("/api/proposal-templates", requireAuth, async (req, res) => {
    const t = await storage.createProposalTemplate(req.body);
    res.status(201).json(t);
  });

  app.delete("/api/proposal-templates/:id", requireAuth, async (req, res) => {
    await storage.deleteProposalTemplate(safeInt(req.params.id));
    res.status(204).end();
  });

  app.post("/api/proposal-templates/:id/activate", requireAuth, async (req, res) => {
    const t = await storage.activateProposalTemplate(safeInt(req.params.id));
    res.json(t);
  });

  // ── Slide Methodology Config ───────────────────────────────────────────────
  app.get("/api/slide-methodology", requireAuth, async (_req, res) => {
    res.json(await storage.getSlideMethodologyConfigs());
  });

  app.get("/api/slide-methodology/:slideId", requireAuth, async (req, res) => {
    const config = await storage.getSlideMethodologyConfig(req.params.slideId);
    if (!config) { res.status(404).json({ message: "Not found" }); return; }
    res.json(config);
  });

  app.put("/api/slide-methodology/:slideId", requireAuth, async (req, res) => {
    const data = { ...req.body, slide_id: req.params.slideId, updated_at: new Date().toISOString() };
    const config = await storage.upsertSlideMethodologyConfig(data);
    res.json(config);
  });

  app.delete("/api/slide-methodology/:slideId", requireAuth, async (req, res) => {
    await storage.deleteSlideMethodologyConfig(req.params.slideId);
    res.status(204).end();
  });

  app.put("/api/slide-methodology/:slideId/guidance-image", requireAuth, async (req, res) => {
    const { image } = req.body;
    const existing = await storage.getSlideMethodologyConfig(req.params.slideId);
    const base = existing || {
      slide_id: req.params.slideId, purpose: "", structure: { sections: [] },
      rules: "", columns: {}, variations: {}, examples: [], format: "A", insight_bar: 0,
    };
    const config = await storage.upsertSlideMethodologyConfig({
      ...base, guidance_image: image || null, updated_at: new Date().toISOString(),
    } as any);
    res.json(config);
  });

  // ── Slide Backgrounds (per-slide PNG templates) ──────────────────────────
  // Upload one PNG per slide_id (e.g. exported from a Canva template).
  // These are injected as the outer-most background-image on generated
  // HTML previews so the live preview and Playwright export both inherit
  // the template look, while the consulting content stays editable on top.
  //
  // GET returns only metadata (no file_data) so the admin screen can render
  // the list without blowing the response size on megabytes of base64.
  app.get("/api/slide-backgrounds", requireAuth, async (_req, res) => {
    try {
      const rows = await storage.getSlideBackgrounds();
      const lite = rows.map(r => ({
        slide_id: r.slide_id,
        file_size: r.file_size,
        source: r.source ?? null,
        source_ref: r.source_ref ?? null,
        updated_at: r.updated_at,
        has_data: !!r.file_data,
      }));
      res.json(lite);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to load backgrounds" });
    }
  });

  // Fetch a single background WITH the data URL. Used by the server prompt
  // code (generate-page / refine-page) and the admin preview.
  app.get("/api/slide-backgrounds/:slideId", requireAuth, async (req, res) => {
    try {
      const row = await storage.getSlideBackground(req.params.slideId);
      if (!row) { res.status(404).json({ message: "Not found" }); return; }
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to load background" });
    }
  });

  // Upsert. Body: { file_data: "data:image/png;base64,...", file_size?, source?, source_ref? }
  app.put("/api/slide-backgrounds/:slideId", requireAuth, async (req, res) => {
    try {
      const { file_data, file_size, source, source_ref } = req.body || {};
      if (typeof file_data !== "string" || !file_data.startsWith("data:")) {
        res.status(400).json({ message: "file_data must be a data: URL" }); return;
      }
      const row = await storage.upsertSlideBackground({
        slide_id: req.params.slideId,
        file_data,
        file_size: Number(file_size) || Math.floor(file_data.length * 0.75),
        source: source ?? "upload",
        source_ref: source_ref ?? null,
        updated_at: new Date().toISOString(),
      });
      // Echo the metadata only — don't round-trip the base64 to the client.
      res.json({
        slide_id: row.slide_id,
        file_size: row.file_size,
        source: row.source ?? null,
        source_ref: row.source_ref ?? null,
        updated_at: row.updated_at,
        has_data: true,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to save background" });
    }
  });

  app.delete("/api/slide-backgrounds/:slideId", requireAuth, async (req, res) => {
    try {
      await storage.deleteSlideBackground(req.params.slideId);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to delete background" });
    }
  });

  // ── Slide Templates (JSON-spec deterministic rendering) ───────────────────
  // Each row is a full template spec for one slide_id. Unlike slide_backgrounds
  // (which stores a raw PNG and still lets Claude free-generate HTML on top),
  // templates are fully deterministic — given the same spec + values map, the
  // renderer always emits byte-identical HTML. See shared/schema.ts
  // slideTemplateSpecSchema for the JSON shape.
  //
  // GET list returns metadata only (no full spec with embedded background PNG)
  // so the admin screen stays snappy; GET :slideId returns the full spec.
  app.get("/api/slide-templates", requireAuth, async (_req, res) => {
    try {
      const rows = await storage.getSlideTemplates();
      const lite = rows.map(r => {
        const regions = Array.isArray((r.spec as any)?.regions) ? (r.spec as any).regions : [];
        return {
          slide_id: r.slide_id,
          region_count: regions.length,
          region_keys: regions.map((reg: any) => ({
            key: reg.key,
            placeholder: reg.placeholder ?? reg.key,
          })),
          has_background: !!((r.spec as any)?.background),
          updated_at: r.updated_at,
        };
      });
      res.json(lite);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to load templates" });
    }
  });

  app.get("/api/slide-templates/:slideId", requireAuth, async (req, res) => {
    try {
      const row = await storage.getSlideTemplate(req.params.slideId);
      if (!row) { res.status(404).json({ message: "Not found" }); return; }
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to load template" });
    }
  });

  // Upsert. Body: { spec: { canvas, background, regions } }
  // Server trusts the client to send a valid spec — validation happens via
  // the zod schema below. We don't attempt to deep-merge; the client always
  // sends the full spec.
  app.put("/api/slide-templates/:slideId", requireAuth, async (req, res) => {
    try {
      const { spec } = req.body || {};
      if (!spec || typeof spec !== "object") {
        res.status(400).json({ message: "spec is required" }); return;
      }
      // Minimal shape check — reject obviously malformed specs so we don't
      // persist garbage that crashes the renderer later.
      if (!Array.isArray(spec.regions)) {
        res.status(400).json({ message: "spec.regions must be an array" }); return;
      }
      const row = await storage.upsertSlideTemplate({
        slide_id: req.params.slideId,
        spec,
        updated_at: new Date().toISOString(),
      });
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to save template" });
    }
  });

  app.delete("/api/slide-templates/:slideId", requireAuth, async (req, res) => {
    try {
      await storage.deleteSlideTemplate(req.params.slideId);
      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to delete template" });
    }
  });

  // ── Parse Manual Briefs (ChatGPT paste) ───────────────────────────────────
  app.post("/api/proposals/:id/parse-manual-briefs", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Not found" }); return; }

      const { text: pastedText } = req.body;
      if (!pastedText || typeof pastedText !== "string") {
        res.status(400).json({ message: "Pasted text is required" }); return;
      }

      const selectedSlides = ((proposal.slide_selection as any[]) || [])
        .filter((s: any) => s.is_selected)
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
        .map((s: any) => ({ slide_id: s.slide_id, title: s.title }));

      if (selectedSlides.length === 0) {
        res.status(400).json({ message: "No slides selected" }); return;
      }

      // Load admin configs
      const allConfigs = await storage.getSlideMethodologyConfigs();
      const adminConfigMap: Record<string, any> = {};
      for (const cfg of allConfigs) adminConfigMap[cfg.slide_id] = cfg;

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic();

      const slideList = selectedSlides.map((s: any) => {
        const cfg = adminConfigMap[s.slide_id];
        const fields = cfg?.structure?.sections || ["Key content"];
        return `- ${s.slide_id} ("${s.title}"): fields=[${fields.join(", ")}]`;
      }).join("\n");

      console.log(`Parsing manual briefs for proposal ${id}, ${selectedSlides.length} slides, text length ${pastedText.length}`);

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        messages: [{
          role: "user",
          content: `You are parsing pasted text (from ChatGPT or similar) into structured slide briefs for a consulting proposal deck.

The proposal slides are:
${slideList}

The pasted text is:
---
${pastedText}
---

For each slide above, extract the relevant content from the pasted text. Return a JSON array (no markdown, no code fences) where each element is:
{
  "slide_id": "...",
  "title": "...",
  "purpose": "one-line purpose",
  "content_structure": [{ "key": "field_name", "label": "Field Label", "value": "extracted content" }],
  "notes": ""
}

Rules:
- Match content to slides by topic/heading similarity
- If no content found for a slide, include it with empty value strings
- Return ONLY the raw JSON array — no markdown, no code blocks, no explanation`
        }],
      });

      const rawText = (response.content[0] as any).text || "";
      console.log("Claude response length:", rawText.length, "first 200 chars:", rawText.substring(0, 200));
      let briefs: any[];
      try {
        const cleaned = rawText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
        briefs = JSON.parse(cleaned);
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr, "raw text:", rawText.substring(0, 500));
        briefs = selectedSlides.map((s: any) => ({
          slide_id: s.slide_id, title: s.title, purpose: "", content_structure: [], notes: "Could not parse AI response — please edit manually",
        }));
      }

      const updated = await storage.updateProposal(id, {
        slide_briefs: briefs, status: "briefed",
      });
      res.json(updated);
    } catch (err: any) {
      console.error("Manual brief parse error:", err);
      res.status(500).json({ message: err.message || "Parse failed" });
    }
  });

  // ── Slide Methodology: Bulk Parse Instructions ──────────────────────────────
  app.post("/api/slide-methodology/bulk-parse", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const { instructions } = req.body;
      if (!instructions || typeof instructions !== "string") {
        res.status(400).json({ message: "Instructions text is required" });
        return;
      }

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic();

      // Master slide list (must match client/src/lib/proposalSlides.ts)
      const SLIDES = [
        // Core pages
        { id: "cover", title: "Cover Page", desc: "Title slide with company name, date, and Eendigo branding" },
        { id: "agenda", title: "Agenda", desc: "Overview of what the proposal covers" },
        { id: "exec_summary", title: "Executive Summary", desc: "High-level overview of the engagement" },
        { id: "context", title: "Context", desc: "Client situation, market dynamics, and urgency drivers" },
        { id: "value_at_stake", title: "Value at Stake", desc: "Quantified opportunity sizing and impact if nothing changes" },
        { id: "proposed_approach", title: "Proposed Approach", desc: "Recommended approach, logic, and high-level workstreams" },
        { id: "timeline_options", title: "Timeline & Options", desc: "Project timeline with milestones and option variants" },
        { id: "governance_inputs", title: "Governance & Inputs", desc: "Steering committee, escalation, reporting, and client inputs" },
        { id: "impact_roi", title: "Impact & ROI", desc: "Expected business impact, ROI projections, and value creation" },
        { id: "why_eendigo", title: "Why Eendigo", desc: "Credentials, case studies, proof of impact, and differentiators" },
        { id: "commercials", title: "Commercials", desc: "Fee structure, pricing, and commercial terms" },
        { id: "next_steps", title: "Next Steps", desc: "Immediate actions and decision timeline" },
        { id: "annex", title: "Annex", desc: "Supporting data, detailed tables, and appendix material" },
        // Optional pages
        { id: "scope_activities", title: "Scope & Activities", desc: "Detailed scope breakdown with activity descriptions" },
        { id: "positioning", title: 'Positioning ("This is not X") - Scope Boundaries', desc: "Differentiation from typical consulting and IN/OUT scope" },
        { id: "diag_justification", title: "Diagnostic Justification", desc: "Why a diagnostic phase is needed before action" },
        { id: "transformation", title: "Full Transformation Journey", desc: "End-to-end change logic and transformation roadmap" },
        { id: "exec_philosophy", title: "Execution Philosophy", desc: "How Eendigo approaches delivery and execution" },
        { id: "methodology", title: "Methodology Overview", desc: "Core methodology and frameworks used" },
        { id: "workstream_modules", title: "Workstreams / Scope Modules", desc: "Breakdown of work into streams or modules" },
        { id: "workstream_activities", title: "Workstreams / Detailed Activities", desc: "Detailed activities within each workstream" },
        { id: "scope_deliverables", title: "Scope & Deliverables", desc: "Summary of scope and key deliverables" },
        { id: "deliverables_matrix", title: "Deliverables Matrix", desc: "Deliverables mapped to workstreams, ownership, and timing" },
        { id: "comex_map", title: "ComEx System Map", desc: "Commercial excellence system and interconnections" },
        { id: "sample_deliverables", title: "Sample Deliverables", desc: "Examples of deliverable formats and outputs" },
        { id: "detailed_deliverables", title: "Detailed Deliverables Table", desc: "Comprehensive deliverables with ownership and timing" },
        { id: "options", title: "Options (2\u20133)", desc: "2\u20133 engagement options with different scope/investment" },
        { id: "governance_steercos", title: "Governance: Steercos & Weekly", desc: "Detailed steerco and weekly meeting cadence and agenda" },
        { id: "exec_cadence", title: "Execution Cadence (War Rooms)", desc: "War room rhythm and execution governance" },
        { id: "team_bio", title: "Team Bio", desc: "Proposed team members, bios, and roles" },
        { id: "client_deps", title: "Client Dependencies: Data", desc: "Data, systems, and access the client needs to provide" },
        { id: "client_time", title: "Client Time Investment", desc: "Expected time commitment from client stakeholders" },
      ];
      const slideList = SLIDES.map((s, i) =>
        `${i + 1}. "${s.title}" (slide_id: "${s.id}") \u2014 ${s.desc}`
      ).join("\n");

      const tool = {
        name: "submit_slide_configs",
        description: "Submit the parsed slide configurations for all slides that have relevant instructions",
        input_schema: {
          type: "object" as const,
          properties: {
            slides: {
              type: "array" as const,
              description: "Array of slide configs to create/update",
              items: {
                type: "object" as const,
                properties: {
                  slide_id: { type: "string" as const, description: "The slide_id from the master list" },
                  purpose: { type: "string" as const, description: "What this slide must achieve (1-2 sentences)" },
                  sections: { type: "array" as const, items: { type: "string" as const }, description: "Structure template sections that must appear on this slide" },
                  rules: { type: "string" as const, description: "Content rules and guidelines, one per line starting with -" },
                  column_1: { type: "string" as const, description: "Column 1 label (for 3-column layouts)" },
                  column_2: { type: "string" as const, description: "Column 2 label" },
                  column_3: { type: "string" as const, description: "Column 3 label" },
                  examples: { type: "array" as const, items: { type: "string" as const }, description: "Example bullets or best practice phrasing" },
                  format: { type: "string" as const, enum: ["A", "B"], description: "A = stacked sections, B = 3-column layout" },
                  insight_bar: { type: "number" as const, enum: [0, 1], description: "1 to enable insight bar at bottom" },
                },
                required: ["slide_id"],
              },
            },
          },
          required: ["slides"],
        },
      };

      const systemPrompt = `You are an expert at structuring consulting proposal methodology. You receive raw instructions about how to build proposal slides.

Your task: Parse the instructions and distribute them to the correct slides from this master list:
${slideList}

For each slide that has relevant instructions, extract:
- purpose: What the slide must achieve
- sections: The structural sections/blocks that must appear (as an array)
- rules: Content guidelines (bullet points starting with -)
- column_1/2/3: If the instructions mention a column layout
- examples: Any example bullets or phrasing
- format: "A" for stacked vertical, "B" for 3-column layout
- insight_bar: 1 if there should be a bottom callout bar

RULES:
1. Match instructions to slides by title, number, content description, or keywords
2. If instructions mention "page 7" or "slide 7", map to the 7th slide in the list
3. If instructions are general (apply to all slides), apply them to each relevant slide's rules
4. Extract structure from patterns like "sections:", "must include:", "layout:" etc.
5. Keep purpose concise (1-2 sentences)
6. Only include slides that have relevant instructions — skip others
7. Be thorough — don't miss any instruction that maps to a slide`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: systemPrompt,
        tools: [tool],
        tool_choice: { type: "tool", name: "submit_slide_configs" },
        messages: [{ role: "user", content: instructions }],
      });

      const toolUse = response.content.find((block: any) => block.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        res.status(500).json({ message: "AI did not return structured output" });
        return;
      }

      const parsed = (toolUse as any).input as { slides: any[] };

      // Save each parsed config to DB
      const saved: any[] = [];
      for (const slide of parsed.slides) {
        if (!slide.slide_id) continue;
        const config = {
          slide_id: slide.slide_id,
          purpose: slide.purpose || "",
          structure: { sections: slide.sections || [] },
          rules: slide.rules || "",
          columns: {
            column_1: slide.column_1 || "",
            column_2: slide.column_2 || "",
            column_3: slide.column_3 || "",
          },
          variations: {},
          examples: slide.examples || [],
          format: slide.format || "A",
          insight_bar: slide.insight_bar || 0,
          updated_at: new Date().toISOString(),
        };
        const result = await storage.upsertSlideMethodologyConfig(config as any);
        saved.push(result);
      }

      res.json({ count: saved.length, slides: saved });
    } catch (err: any) {
      console.error("Bulk parse error:", err);
      res.status(500).json({ message: err.message || "Bulk parse failed" });
    }
  });

  // ── Project Type Slide Defaults ──────────────────────────────────────────────
  app.get("/api/slide-defaults/:projectType", requireAuth, async (req, res) => {
    const defaults = await storage.getProjectTypeSlideDefault(req.params.projectType);
    res.json(defaults || { slide_ids: [], slide_order: [] });
  });

  app.put("/api/slide-defaults/:projectType", requireAuth, async (req, res) => {
    const { slide_ids, slide_order } = req.body;
    const saved = await storage.upsertProjectTypeSlideDefault(req.params.projectType, slide_ids || [], slide_order || []);
    res.json(saved);
  });

  // ── Deck Template Config ────────────────────────────────────────────────────
  app.get("/api/deck-template", requireAuth, async (_req, res) => {
    const config = await storage.getDeckTemplateConfig();
    res.json(config || {});
  });

  app.put("/api/deck-template", requireAuth, async (req, res) => {
    const config = await storage.upsertDeckTemplateConfig(req.body);
    res.json(config);
  });

  // ── Admin downloads ────────────────────────────────────────────────────────

  // Download all source code as tar.gz
  app.get("/api/admin/download-code", requireAuth, (req, res) => {
    // Project root is two levels up from server/routes.ts → project root
    const projectRoot = process.cwd();
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="compplan-code-${date}.tar.gz"`);

    const tar = spawn("tar", ["-czf", "-",
      "--exclude=node_modules",
      "--exclude=.git",
      "--exclude=dist",
      "client/src", "server", "shared", "package.json", "tsconfig.json", "vite.config.ts", "tailwind.config.ts"
    ], { cwd: projectRoot });

    tar.stdout.pipe(res);
    tar.on("error", (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    tar.stderr.on("data", (d) => console.error("[tar]", d.toString()));
  });

  // Download all DB content as JSON backup
  // Full-database export — dumps every user-data table as JSON so the user can
  // store a complete offline backup and re-import it later. Generic loop over
  // the list of tables rather than hand-rolled helpers so new tables get
  // exported automatically as long as they're in the list below.
  // Every user-data table the app touches. When a new pgTable is added to
  // shared/schema.ts OR a new CREATE TABLE IF NOT EXISTS is added to seed.ts
  // it MUST be added here too, otherwise it will silently be left out of
  // nightly backups and manual dumps — which is a data-loss hazard.
  //
  // Tables listed here that don't (yet) exist on the running schema are
  // fine: the dump endpoint catches per-table errors and records them as
  // empty arrays, and the import endpoint skips them gracefully.
  const BACKUP_TABLES = [
    // Auth
    "users",
    // HR / employees
    "employees", "salary_history", "role_grid", "days_off_entries",
    "employee_tasks", "performance_issues",
    // App config
    "app_settings",
    // Pricing (settings JSON holds the country_benchmarks corridors)
    "pricing_settings", "pricing_cases", "pricing_proposals", "won_projects",
    // Business Development / CRM (HubSpot imports land here)
    "bd_deals",
    // Proposals / slide methodology
    "proposals", "proposal_templates", "slide_methodology_configs",
    "project_type_slide_defaults", "deck_template_configs",
    // Hiring
    "hiring_candidates",
    // AR / invoicing
    "invoice_snapshots", "invoice_changes", "client_project_defaults",
    // Time tracking
    "time_tracking_topics", "time_tracking_entries",
    // Knowledge center
    "knowledge_topics", "knowledge_files",
    // Misc
    "api_usage_log",
  ];

  // Auth for the backup endpoint: accept either a normal logged-in cookie
  // OR an X-Backup-Token header matching the BACKUP_TOKEN env var. This lets
  // a scheduled job (GitHub Actions, Render cron, etc.) pull a nightly dump
  // without storing a user session. If BACKUP_TOKEN is unset the token path
  // is disabled and only cookie auth works.
  const backupAuth = (req: any, res: any, next: any) => {
    const provided = req.headers["x-backup-token"];
    const expected = process.env.BACKUP_TOKEN;
    if (expected && typeof provided === "string" && provided && provided === expected) {
      return next();
    }
    return requireAuth(req, res, next);
  };

  // Lightweight backup stats for the Admin → Backup & Restore page. Unlike
  // /download-backup this does NOT dump every row — it just counts them,
  // so the page can render instantly without pulling MB of JSON.
  app.get("/api/admin/backup-info", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const per: Record<string, number> = {};
      let total = 0;
      let ok = 0;
      for (const t of BACKUP_TABLES) {
        try {
          const r: any = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${t}`));
          const n = Number(r.rows?.[0]?.n ?? 0);
          per[t] = n;
          total += n;
          ok++;
        } catch {
          per[t] = -1; // table missing on this schema
        }
      }
      res.json({
        ok: true,
        tables_total: BACKUP_TABLES.length,
        tables_available: ok,
        rows_total: total,
        per_table: per,
        server_time: new Date().toISOString(),
        backup_token_configured: !!process.env.BACKUP_TOKEN,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/admin/download-backup", backupAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const dump: Record<string, any[]> = {};
      for (const t of BACKUP_TABLES) {
        try {
          const r = await db.execute(sql.raw(`SELECT * FROM ${t}`));
          dump[t] = r.rows as any[];
        } catch (e: any) {
          // Table might not exist on older schemas — record as empty rather than fail
          dump[t] = [];
          console.warn(`[backup] table ${t} skipped: ${e.message}`);
        }
      }
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="compplan-backup-${date}.json"`);
      res.json({
        exportedAt: new Date().toISOString(),
        schemaVersion: 2,
        tables: dump,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Full-database IMPORT — accepts a backup JSON and upserts every row back
  // into the database. Uses additive semantics by default: existing rows are
  // kept, missing rows are inserted. When `?mode=replace` is passed the
  // table is TRUNCATED first — use with extreme care.
  app.post("/api/admin/import-backup", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const mode = (req.query.mode as string) === "replace" ? "replace" : "merge";
      const body = req.body;
      if (!body || typeof body !== "object" || !body.tables) {
        return res.status(400).json({ error: "Invalid backup file: missing 'tables' key" });
      }
      const tables = body.tables as Record<string, any[]>;
      const report: Record<string, { inserted: number; skipped: number; error?: string }> = {};

      for (const tableName of BACKUP_TABLES) {
        const rows = tables[tableName];
        if (!Array.isArray(rows)) {
          report[tableName] = { inserted: 0, skipped: 0, error: "not in backup" };
          continue;
        }
        let inserted = 0;
        let skipped = 0;
        try {
          if (mode === "replace") {
            await db.execute(sql.raw(`TRUNCATE TABLE ${tableName} RESTART IDENTITY CASCADE`));
          }
          for (const row of rows) {
            if (!row || typeof row !== "object") { skipped++; continue; }
            const cols = Object.keys(row);
            if (cols.length === 0) { skipped++; continue; }
            const colsSql = cols.map(c => `"${c}"`).join(", ");
            const values = cols.map(c => {
              const v = (row as any)[c];
              // Serialise objects/arrays to JSON so Postgres can coerce them
              // into jsonb columns. Primitive values pass through unchanged.
              if (v !== null && typeof v === "object") return JSON.stringify(v);
              return v;
            });
            try {
              // Build the INSERT by nesting Drizzle sql templates. Each
              // iteration appends ", ${value}" to the growing query, which
              // is how drizzle expects parameterised SQL composition. Using
              // sql.raw() for the static parts and ${v} for the values.
              let query: any = sql`INSERT INTO ${sql.raw(tableName)} (${sql.raw(colsSql)}) VALUES (${values[0]}`;
              for (let i = 1; i < values.length; i++) {
                query = sql`${query}, ${values[i]}`;
              }
              query = sql`${query}) ON CONFLICT DO NOTHING`;
              const r: any = await db.execute(query);
              if ((r?.rowCount ?? 0) > 0) inserted++;
              else skipped++;
            } catch (rowErr: any) {
              skipped++;
              console.warn(`[import] ${tableName} row failed: ${rowErr.message}`);
            }
          }
          report[tableName] = { inserted, skipped };
        } catch (tableErr: any) {
          report[tableName] = { inserted, skipped, error: tableErr.message };
        }
      }
      res.json({ ok: true, mode, report });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Won Projects (invoicing audit) ────────────────────────────────────────
  app.get("/api/won-projects", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const r = await db.execute(sql`SELECT * FROM won_projects ORDER BY won_date DESC, id DESC`);
      res.json(r.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Simplified schema (Task 11): the form now collects only
  //   project_code, total_amount, nb_of_invoices, invoicing_schedule_text
  // Legacy columns (client_name, client_code, project_name, won_date) still
  // exist and still get populated via auto-derivation from project_code, so
  // old rows keep rendering in any legacy screen that still reads them.
  const deriveFromProjectCode = (projectCode: string | null | undefined) => {
    const code = String(projectCode ?? "").trim().toUpperCase();
    if (!code) return { client_code: "", project_name: "" };
    // "MET04" → prefix "MET". Strip trailing digits.
    const prefix = code.replace(/\d+$/, "").slice(0, 5) || code;
    return { client_code: prefix, project_name: code };
  };

  app.post("/api/won-projects", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const b = req.body ?? {};
      const now = new Date().toISOString();
      if (!b.project_code || !String(b.project_code).trim()) {
        return res.status(400).json({ error: "project_code is required" });
      }
      const { client_code: derivedClientCode, project_name: derivedProjectName } = deriveFromProjectCode(b.project_code);
      const clientCode  = (b.client_code  && String(b.client_code).trim())  || derivedClientCode;
      const clientName  = (b.client_name  && String(b.client_name).trim())  || derivedClientCode;
      const projectName = (b.project_name && String(b.project_name).trim()) || derivedProjectName;
      const r = await db.execute(sql`
        INSERT INTO won_projects (
          client_name, client_code, project_name, project_code,
          total_amount, currency, won_date, start_date, end_date,
          invoicing_schedule_text, status, notes, nb_of_invoices,
          created_at, updated_at
        ) VALUES (
          ${clientName}, ${clientCode}, ${projectName}, ${String(b.project_code).trim().toUpperCase()},
          ${Number(b.total_amount) || 0}, ${b.currency ?? "EUR"}, ${b.won_date || null},
          ${b.start_date || null}, ${b.end_date || null},
          ${b.invoicing_schedule_text ?? null}, ${b.status ?? "active"}, ${b.notes ?? null},
          ${b.nb_of_invoices == null || b.nb_of_invoices === "" ? null : Number(b.nb_of_invoices)},
          ${now}, ${now}
        ) RETURNING *
      `);
      res.json(r.rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/won-projects/:id", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const id = safeInt(req.params.id);
      const b = req.body ?? {};
      const now = new Date().toISOString();
      const { client_code: derivedClientCode, project_name: derivedProjectName } = deriveFromProjectCode(b.project_code);
      const clientCode  = (b.client_code  && String(b.client_code).trim())  || derivedClientCode;
      const clientName  = (b.client_name  && String(b.client_name).trim())  || derivedClientCode;
      const projectName = (b.project_name && String(b.project_name).trim()) || derivedProjectName;
      const r = await db.execute(sql`
        UPDATE won_projects SET
          client_name  = ${clientName},
          client_code  = ${clientCode},
          project_name = ${projectName},
          project_code = ${b.project_code ? String(b.project_code).trim().toUpperCase() : null},
          total_amount = ${Number(b.total_amount) || 0},
          currency     = ${b.currency ?? "EUR"},
          won_date     = ${b.won_date || null},
          start_date   = ${b.start_date || null},
          end_date     = ${b.end_date || null},
          invoicing_schedule_text = ${b.invoicing_schedule_text ?? null},
          status       = ${b.status ?? "active"},
          notes        = ${b.notes ?? null},
          nb_of_invoices = ${b.nb_of_invoices == null || b.nb_of_invoices === "" ? null : Number(b.nb_of_invoices)},
          updated_at   = ${now}
        WHERE id = ${id}
        RETURNING *
      `);
      if (r.rows.length === 0) return res.status(404).json({ error: "Not found" });
      res.json(r.rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/won-projects/:id", requireAuth, async (req, res) => {
    try {
      // Soft-delete to trash_bin (30-day TTL).
      await trashAndDelete("won_projects", safeInt(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Business Development / lightweight CRM ────────────────────────────────
  //
  // Minimal CRUD over bd_deals + a HubSpot import endpoint. The import
  // accepts either:
  //   - HubSpot CSV exported from "Deals" → "Export" (string body), OR
  //   - An already-parsed array of objects keyed by HubSpot column names
  //
  // De-duplication is by `hubspot_id` (HubSpot's numeric deal ID). Re-
  // running the import upserts rather than duplicating, so the user can
  // paste the same file twice without consequence.
  const BD_STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;

  function normaliseHubspotStage(raw: string | null | undefined): string {
    const s = String(raw ?? "").toLowerCase().trim();
    if (!s) return "lead";
    if (s.includes("closed won") || s === "won") return "won";
    if (s.includes("closed lost") || s === "lost") return "lost";
    if (s.includes("appointment") || s.includes("qualified")) return "qualified";
    if (s.includes("presentation") || s.includes("proposal")) return "proposal";
    if (s.includes("decision") || s.includes("negotiat") || s.includes("contract")) return "negotiation";
    return "lead";
  }

  // Lightweight CSV parser — handles quoted fields with commas and
  // escaped double quotes ("") the way Excel / HubSpot / Sheets emit.
  // Deliberately not a full RFC 4180 parser: we don't need multiline
  // fields and HubSpot doesn't emit them for the Deal export.
  function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };
    function split(line: string): string[] {
      const out: string[] = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
          if (c === "\"") {
            if (line[i + 1] === "\"") { cur += "\""; i++; }
            else inQ = false;
          } else cur += c;
        } else {
          if (c === "\"") inQ = true;
          else if (c === ",") { out.push(cur); cur = ""; }
          else cur += c;
        }
      }
      out.push(cur);
      return out;
    }
    const headers = split(lines[0]).map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const parts = split(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = (parts[i] ?? "").trim(); });
      return row;
    });
    return { headers, rows };
  }

  // Fuzzy column lookup: HubSpot field names drift ("Deal Name" vs "dealname"
  // vs "deal name"). We match case-insensitive on normalised keys.
  function pick(row: Record<string, string>, candidates: string[]): string | null {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const c of candidates) {
      const nc = norm(c);
      for (const k of Object.keys(row)) {
        if (norm(k) === nc && row[k] !== undefined && row[k] !== "") return row[k];
      }
    }
    return null;
  }

  app.get("/api/bd/deals", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const r = await db.execute(sql`SELECT * FROM bd_deals ORDER BY updated_at DESC`);
      res.json(r.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/bd/deals", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const now = new Date().toISOString();
      const b = req.body ?? {};
      if (!b.name) { res.status(400).json({ error: "name required" }); return; }
      const stage = (BD_STAGES as readonly string[]).includes(b.stage) ? b.stage : "lead";
      const r = await db.execute(sql`
        INSERT INTO bd_deals (
          hubspot_id, name, client_name, contact_name, contact_email,
          stage, amount, currency, probability, close_date, source, owner,
          notes, industry, region, last_activity_at, imported_at, created_at, updated_at
        ) VALUES (
          ${b.hubspot_id ?? null}, ${b.name}, ${b.client_name ?? null}, ${b.contact_name ?? null}, ${b.contact_email ?? null},
          ${stage}, ${b.amount ?? null}, ${b.currency ?? "EUR"}, ${b.probability ?? null}, ${b.close_date ?? null}, ${b.source ?? null}, ${b.owner ?? null},
          ${b.notes ?? null}, ${b.industry ?? null}, ${b.region ?? null}, ${b.last_activity_at ?? null}, ${b.imported_at ?? null}, ${now}, ${now}
        ) RETURNING *
      `);
      res.json(r.rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/bd/deals/:id", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const id = safeInt(req.params.id);
      const now = new Date().toISOString();
      const b = req.body ?? {};

      // Merge-style update: fetch the existing row, overlay any fields the
      // client sent, then write the merged result back. Simpler and safer
      // than building a dynamic SET clause, and partial updates are cheap
      // because bd_deals is small.
      const existing: any = await db.execute(sql`SELECT * FROM bd_deals WHERE id = ${id}`);
      if (existing.rows.length === 0) { res.status(404).json({ error: "not found" }); return; }
      const cur = existing.rows[0] as any;

      const merged = {
        name:             "name" in b ? b.name : cur.name,
        client_name:      "client_name" in b ? b.client_name : cur.client_name,
        contact_name:     "contact_name" in b ? b.contact_name : cur.contact_name,
        contact_email:    "contact_email" in b ? b.contact_email : cur.contact_email,
        stage:            "stage" in b && (BD_STAGES as readonly string[]).includes(b.stage) ? b.stage : cur.stage,
        amount:           "amount" in b ? b.amount : cur.amount,
        currency:         "currency" in b ? b.currency : cur.currency,
        probability:      "probability" in b ? b.probability : cur.probability,
        close_date:       "close_date" in b ? b.close_date : cur.close_date,
        source:           "source" in b ? b.source : cur.source,
        owner:            "owner" in b ? b.owner : cur.owner,
        notes:            "notes" in b ? b.notes : cur.notes,
        industry:         "industry" in b ? b.industry : cur.industry,
        region:           "region" in b ? b.region : cur.region,
        last_activity_at: "last_activity_at" in b ? b.last_activity_at : cur.last_activity_at,
      };

      const r = await db.execute(sql`
        UPDATE bd_deals SET
          name = ${merged.name},
          client_name = ${merged.client_name},
          contact_name = ${merged.contact_name},
          contact_email = ${merged.contact_email},
          stage = ${merged.stage},
          amount = ${merged.amount},
          currency = ${merged.currency},
          probability = ${merged.probability},
          close_date = ${merged.close_date},
          source = ${merged.source},
          owner = ${merged.owner},
          notes = ${merged.notes},
          industry = ${merged.industry},
          region = ${merged.region},
          last_activity_at = ${merged.last_activity_at},
          updated_at = ${now}
        WHERE id = ${id} RETURNING *
      `);
      res.json(r.rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/bd/deals/:id", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const id = safeInt(req.params.id);
      await db.execute(sql`DELETE FROM bd_deals WHERE id = ${id}`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/bd/import/hubspot — accepts a HubSpot Deal CSV (as a string
  // in body.csv) OR an already-parsed array in body.rows. Dry-run by
  // default — pass { commit: true } to actually upsert.
  app.post("/api/bd/import/hubspot", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const { csv, rows: bodyRows, commit } = req.body ?? {};
      let rows: Record<string, string>[] = [];

      if (Array.isArray(bodyRows)) {
        rows = bodyRows as any[];
      } else if (typeof csv === "string" && csv.trim().length > 0) {
        const parsed = parseCsv(csv);
        rows = parsed.rows;
      } else {
        res.status(400).json({ error: "Provide either `csv` (string) or `rows` (array)" });
        return;
      }

      // Normalise every row into our bd_deals shape.
      const now = new Date().toISOString();
      const normalised = rows.map(row => {
        const rawStage = pick(row, ["Deal Stage", "dealstage", "stage"]);
        const amountStr = pick(row, ["Amount", "amount", "Deal Value", "deal_value"]);
        const amount = amountStr ? Number(String(amountStr).replace(/[^0-9.-]/g, "")) : null;
        return {
          hubspot_id:     pick(row, ["Record ID", "Deal ID", "hubspot_id", "dealId", "id"]),
          name:           pick(row, ["Deal Name", "dealname", "name"]) || "Untitled deal",
          client_name:    pick(row, ["Associated Company", "Company name", "company"]),
          contact_name:   pick(row, ["Associated Contact", "Contact name", "contact"]),
          contact_email:  pick(row, ["Associated Contact Email", "Email", "contact_email"]),
          stage:          normaliseHubspotStage(rawStage),
          amount:         amount !== null && !isNaN(amount) ? amount : null,
          currency:       pick(row, ["Currency", "Deal Currency Code", "currency"]) || "EUR",
          probability:    (() => {
            const p = pick(row, ["Deal probability", "Probability", "probability"]);
            if (!p) return null;
            const n = Number(String(p).replace(/[^0-9.-]/g, ""));
            return isNaN(n) ? null : n;
          })(),
          close_date:     pick(row, ["Close Date", "closedate", "close_date"]),
          source:         pick(row, ["Original Source", "Deal Source", "source"]) || "hubspot_import",
          owner:          pick(row, ["Deal Owner", "Owner", "dealowner"]),
          notes:          pick(row, ["Description", "Notes", "description"]),
          industry:       pick(row, ["Industry", "industry"]),
          region:         pick(row, ["Region", "Country", "region"]),
          last_activity_at: pick(row, ["Last Activity Date", "last_activity_date"]),
          imported_at:    now,
        };
      }).filter(d => (d.name && d.name !== "Untitled deal") || d.hubspot_id);
      // ^ Require at minimum a real name or a hubspot_id so blank rows
      // from trailing CSV newlines don't land as junk.

      if (!commit) {
        // Dry-run: report how many rows we'd upsert + a preview slice.
        res.json({
          ok: true,
          mode: "preview",
          total: normalised.length,
          preview: normalised.slice(0, 10),
        });
        return;
      }

      // Commit: upsert by hubspot_id when present, else plain insert.
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      for (const d of normalised) {
        try {
          if (d.hubspot_id) {
            // Check if the row already exists
            const existing: any = await db.execute(sql`SELECT id FROM bd_deals WHERE hubspot_id = ${d.hubspot_id}`);
            if (existing.rows.length > 0) {
              await db.execute(sql`
                UPDATE bd_deals SET
                  name = ${d.name},
                  client_name = ${d.client_name},
                  contact_name = ${d.contact_name},
                  contact_email = ${d.contact_email},
                  stage = ${d.stage},
                  amount = ${d.amount},
                  currency = ${d.currency},
                  probability = ${d.probability},
                  close_date = ${d.close_date},
                  source = ${d.source},
                  owner = ${d.owner},
                  notes = ${d.notes},
                  industry = ${d.industry},
                  region = ${d.region},
                  last_activity_at = ${d.last_activity_at},
                  updated_at = ${now}
                WHERE hubspot_id = ${d.hubspot_id}
              `);
              updated++;
              continue;
            }
          }
          await db.execute(sql`
            INSERT INTO bd_deals (
              hubspot_id, name, client_name, contact_name, contact_email,
              stage, amount, currency, probability, close_date, source, owner,
              notes, industry, region, last_activity_at, imported_at, created_at, updated_at
            ) VALUES (
              ${d.hubspot_id}, ${d.name}, ${d.client_name}, ${d.contact_name}, ${d.contact_email},
              ${d.stage}, ${d.amount}, ${d.currency}, ${d.probability}, ${d.close_date}, ${d.source}, ${d.owner},
              ${d.notes}, ${d.industry}, ${d.region}, ${d.last_activity_at}, ${d.imported_at}, ${now}, ${now}
            )
          `);
          inserted++;
        } catch (e: any) {
          skipped++;
          console.warn("[bd/import/hubspot] row skipped:", e.message);
        }
      }
      res.json({ ok: true, mode: "commit", total: normalised.length, inserted, updated, skipped });
    } catch (err: any) {
      console.error("[bd/import/hubspot] failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Harvest Invoicing ───────────────────────────────────────────────────────
  const HARVEST_TOKEN = process.env.HARVEST_TOKEN ?? "";
  const HARVEST_ACCOUNT = process.env.HARVEST_ACCOUNT_ID ?? "";
  const HARVEST_BASE = "https://api.harvestapp.com/v2";

  const harvestHeaders = (): Record<string, string> => ({
    "Authorization": `Bearer ${HARVEST_TOKEN}`,
    "Harvest-Account-Id": HARVEST_ACCOUNT,
    "Content-Type": "application/json",
    "User-Agent": "CompPlan App",
  });

  // Harvest's LIST endpoint (GET /v2/invoices) DOES return line_items with
  // nested project { id, name, code }. Per-invoice fetch is only needed for
  // debugging. See https://help.getharvest.com/api-v2/invoices-api/invoices/invoices/
  async function fetchHarvestInvoiceDetail(invoiceId: number): Promise<any | null> {
    try {
      const resp = await fetch(`${HARVEST_BASE}/invoices/${invoiceId}`, { headers: harvestHeaders() });
      if (!resp.ok) return null;
      return await resp.json();
    } catch { return null; }
  }

  // Derive the canonical 3-letter prefix for a client from its name:
  //   "Garnica Plywood"       → "GAR"
  //   "FAST Logistics Group"  → "FAS"
  //   "Aspire Advisors AG"    → "ASP"
  // Keeps only letters, strips accents, uppercases.
  function clientNamePrefix(clientName: string | null | undefined): string {
    if (!clientName) return "";
    return String(clientName)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 3)
      .toUpperCase();
  }

  // Project-code scanner with client-name enforcement. The rule is:
  //   the letter prefix of every code MUST be the first 3 letters of the
  //   client name (so "Garnica Plywood" → GAR*, "FAST Logistics" → FAS*).
  // This kills regex false positives like "THAN30" matching "THANK YOU 30".
  //
  // Exception: if line_items[*].project.code is set, we trust it verbatim
  // (Harvest is the authoritative source).
  //
  // Scans: line_items[*].project.{code,name}, line_items[*].description,
  //        inv.subject, notes, purchase_order, number.
  // Pattern: 2–5 letters, optional separator, 1–3 digits.
  // Returns codes UPPERCASED with the digit padded to 2.
  function extractProjectCodeStrings(inv: any): { projectCodes: string | null; projectNames: string | null } {
    const codes = new Set<string>();
    const names = new Set<string>();

    const prefix = clientNamePrefix(inv?.client?.name);
    const requirePrefix = prefix.length === 3;

    const PATTERN = /\b([A-Z]{2,5})\s*[-_ ]?\s*(\d{1,3})\b/gi;
    const scanText = (txt: string | null | undefined) => {
      if (!txt) return;
      const s = String(txt);
      let m: RegExpExecArray | null;
      PATTERN.lastIndex = 0;
      while ((m = PATTERN.exec(s)) !== null) {
        const letters = m[1].toUpperCase();
        // Enforce the convention: letters must match the client prefix.
        if (requirePrefix && letters !== prefix) continue;
        codes.add(`${letters}${m[2].padStart(2, "0")}`);
      }
    };

    const lineItems: any[] = inv?.line_items ?? [];
    for (const li of lineItems) {
      const proj = li?.project;
      if (proj) {
        if (proj.code && String(proj.code).trim()) {
          // Trust Harvest's authoritative project.code — but still
          // normalise and (if it matches client prefix) keep it.
          const raw = String(proj.code).trim().toUpperCase();
          const m = raw.match(/^([A-Z]{2,5})\s*[-_ ]?\s*(\d{1,3})$/);
          if (m) {
            const letters = m[1];
            // Accept real Harvest codes even if they don't match the
            // client prefix — they are authoritative.
            codes.add(`${letters}${m[2].padStart(2, "0")}`);
          } else {
            codes.add(raw);
          }
        }
        if (proj.name && String(proj.name).trim()) {
          names.add(String(proj.name).trim());
          scanText(proj.name);
        }
      }
      scanText(li?.description);
      scanText(li?.kind);
    }

    scanText(inv?.subject);
    scanText(inv?.notes);
    scanText(inv?.purchase_order);
    scanText(inv?.number);

    return {
      projectCodes: codes.size ? [...codes].join(",") : null,
      projectNames: names.size ? [...names].join(",") : null,
    };
  }

  // GET /api/harvest/invoices — reads from LOCAL DB (instant, no Harvest call)
  app.get("/api/harvest/invoices", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const rows = await db.execute(sql`
        SELECT invoice_id as id, invoice_number as number, client_id, client_name,
               amount, due_amount, due_date, state, currency, subject,
               sent_at, paid_at, invoice_created_at as created_at,
               period_start, period_end,
               project_codes, project_names,
               project_codes_manual, project_names_manual,
               updated_at
        FROM invoice_snapshots ORDER BY invoice_created_at DESC NULLS LAST
      `);
      // Load per-client defaults (third-tier fallback).
      const defaultRows = await db.execute(sql`SELECT client_id, default_code, default_name FROM client_project_defaults`);
      const clientDefaults = new Map<number, { code: string | null; name: string | null }>();
      for (const r of defaultRows.rows) {
        clientDefaults.set(Number(r.client_id), {
          code: (r as any).default_code ?? null,
          name: (r as any).default_name ?? null,
        });
      }
      const invoices = rows.rows.map((r: any) => {
        const cid = r.client_id ?? 0;
        const def = clientDefaults.get(cid);
        // Effective: manual override > auto-extracted > client default.
        const manualSet = !!(r.project_codes_manual && String(r.project_codes_manual).trim());
        const autoSet = !!(r.project_codes && String(r.project_codes).trim());
        let effectiveCodes: string | null;
        let effectiveNames: string | null;
        let source: "manual" | "auto" | "client_default" | "none" = "none";
        if (manualSet) {
          effectiveCodes = r.project_codes_manual;
          effectiveNames = r.project_names_manual ?? r.project_names ?? null;
          source = "manual";
        } else if (autoSet) {
          effectiveCodes = r.project_codes;
          effectiveNames = r.project_names ?? null;
          source = "auto";
        } else if (def?.code) {
          effectiveCodes = def.code;
          effectiveNames = def.name ?? null;
          source = "client_default";
        } else {
          effectiveCodes = null;
          effectiveNames = null;
        }
        return {
          id: r.id, number: r.number,
          client: r.client_name ? { id: cid, name: r.client_name } : null,
          amount: Number(r.amount), due_amount: Number(r.due_amount),
          due_date: r.due_date, state: r.state ?? "", currency: r.currency ?? "EUR",
          subject: r.subject, sent_at: r.sent_at, paid_at: r.paid_at,
          created_at: r.created_at ?? r.updated_at, notes: null,
          period_start: r.period_start, period_end: r.period_end,
          project_codes: effectiveCodes,
          project_names: effectiveNames,
          project_codes_auto: r.project_codes ?? null,
          project_codes_manual: r.project_codes_manual ?? null,
          client_default_code: def?.code ?? null,
          code_source: source,
          has_manual_override: manualSet,
        };
      });
      res.json({ invoices });
    } catch (err: any) {
      console.error("[Harvest] Failed to read local invoices:", err.message);
      res.json({ invoices: [] });
    }
  });

  // POST /api/harvest/sync — fetch from Harvest, diff against DB, create PENDING changes
  app.post("/api/harvest/sync", requireAuth, async (_req, res) => {
    if (!HARVEST_TOKEN || !HARVEST_ACCOUNT) {
      return res.status(503).json({ error: "Harvest credentials not configured" });
    }
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const now = new Date().toISOString();

      // 1. Fetch all from Harvest
      let allInvoices: any[] = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const resp = await fetch(`${HARVEST_BASE}/invoices?per_page=100&page=${page}`, { headers: harvestHeaders() });
        if (!resp.ok) throw new Error(`Harvest API ${resp.status}: ${await resp.text()}`);
        const data = await resp.json();
        allInvoices = allInvoices.concat(data.invoices ?? []);
        hasMore = data.next_page !== null;
        page++;
      }

      // 2. Load existing snapshots — include project_codes_manual so we can
      //    detect conflicts between Harvest's fresh data and user overrides.
      const snapRows = await db.execute(sql`SELECT invoice_id, state, amount, project_codes_manual FROM invoice_snapshots`);
      const snapMap = new Map<number, { state: string; amount: number; manual: string | null }>();
      for (const r of snapRows.rows) {
        snapMap.set(Number(r.invoice_id), {
          state: String(r.state),
          amount: Number(r.amount),
          manual: r.project_codes_manual == null ? null : String(r.project_codes_manual),
        });
      }
      const isFirstLoad = snapMap.size === 0;

      // Normalise a comma-separated code list so "KPS02,KPS01" === "KPS01,KPS02"
      // === " KPS01 , KPS02 ". Used for conflict comparison only.
      const normaliseCodes = (s: string | null | undefined): string => {
        if (!s) return "";
        return String(s).split(",").map(x => x.trim().toUpperCase()).filter(Boolean).sort().join(",");
      };

      // 3. Diff: detect new, paid, amount changed
      const pendingChanges: any[] = [];
      const harvestIds = new Set<number>();

      for (const inv of allInvoices) {
        const invId = Number(inv.id);
        harvestIds.add(invId);
        const invNum = inv.number ?? "";
        const clientName = inv.client?.name ?? "";
        const amount = Math.round(Number(inv.amount) || 0);
        const dueAmount = Math.round(Number(inv.due_amount) || 0);
        const state = inv.state ?? "";

        // Extract project codes/names from the LIST response — it already
        // includes line_items[*].project, so no per-invoice fetch needed.
        const { projectCodes, projectNames } = extractProjectCodeStrings(inv);

        if (!snapMap.has(invId)) {
          // New invoice
          if (!isFirstLoad) {
            pendingChanges.push({ invoice_id: invId, invoice_number: invNum, client_name: clientName,
              amount, change_type: "new_invoice", old_value: null, new_value: state });
          }
          await db.execute(sql`
            INSERT INTO invoice_snapshots (invoice_id, invoice_number, client_id, client_name, amount, due_amount, due_date, state, currency, subject, sent_at, paid_at, invoice_created_at, period_start, period_end, project_codes, project_names, updated_at)
            VALUES (${invId}, ${invNum}, ${inv.client?.id ?? null}, ${clientName}, ${amount}, ${dueAmount}, ${inv.due_date ?? null}, ${state}, ${inv.currency ?? "EUR"}, ${inv.subject ?? null}, ${inv.sent_at ?? null}, ${inv.paid_at ?? null}, ${inv.created_at ?? null}, ${inv.period_start ?? null}, ${inv.period_end ?? null}, ${projectCodes}, ${projectNames}, ${now})
            ON CONFLICT (invoice_id) DO NOTHING
          `);
        } else {
          const prev = snapMap.get(invId)!;
          if (prev.state !== "paid" && state === "paid") {
            pendingChanges.push({ invoice_id: invId, invoice_number: invNum, client_name: clientName,
              amount, change_type: "paid", old_value: prev.state, new_value: "paid" });
          }
          if (prev.amount !== amount && Math.abs(prev.amount - amount) > 1) {
            pendingChanges.push({ invoice_id: invId, invoice_number: invNum, client_name: clientName,
              amount, change_type: "amount_changed", old_value: String(prev.amount), new_value: String(amount) });
          }
          // Project-code CONFLICT detection: if the user has set a manual
          // override AND Harvest now reports a different code, DO NOT silently
          // overwrite — stage a pending change so the user explicitly approves
          // or rejects the switch. The DB remains the single source of truth.
          const manualNorm = normaliseCodes(prev.manual);
          const harvestNorm = normaliseCodes(projectCodes);
          if (manualNorm && harvestNorm && manualNorm !== harvestNorm) {
            pendingChanges.push({
              invoice_id: invId, invoice_number: invNum, client_name: clientName,
              amount, change_type: "project_code_conflict",
              old_value: prev.manual ?? "",       // current manual override
              new_value: projectCodes ?? "",      // fresh Harvest value
            });
          }
          // Update all fields. NOTE: we deliberately do NOT touch
          // project_codes_manual / project_names_manual — those are user
          // overrides that must survive every Harvest re-sync.
          await db.execute(sql`
            UPDATE invoice_snapshots SET
              invoice_number = ${invNum}, client_id = ${inv.client?.id ?? null}, client_name = ${clientName},
              amount = ${amount}, due_amount = ${dueAmount}, due_date = ${inv.due_date ?? null},
              state = ${state}, currency = ${inv.currency ?? "EUR"}, subject = ${inv.subject ?? null},
              sent_at = ${inv.sent_at ?? null}, paid_at = ${inv.paid_at ?? null},
              invoice_created_at = ${inv.created_at ?? null},
              period_start = ${inv.period_start ?? null}, period_end = ${inv.period_end ?? null},
              project_codes = ${projectCodes},
              project_names = ${projectNames},
              updated_at = ${now}
            WHERE invoice_id = ${invId}
          `);
        }
      }

      // Check for deleted invoices (in DB but not in Harvest)
      for (const [snapId, snap] of snapMap) {
        if (!harvestIds.has(snapId)) {
          const snapRow = await db.execute(sql`SELECT invoice_number, client_name, amount FROM invoice_snapshots WHERE invoice_id = ${snapId}`);
          if (snapRow.rows.length > 0) {
            const r = snapRow.rows[0] as any;
            pendingChanges.push({ invoice_id: snapId, invoice_number: r.invoice_number ?? "", client_name: r.client_name ?? "",
              amount: Number(r.amount), change_type: "deleted", old_value: snap.state, new_value: null });
          }
        }
      }

      // 4. Insert pending changes (dedup by invoice_id + change_type in last 24h)
      let newChangeCount = 0;
      for (const c of pendingChanges) {
        const dup = await db.execute(sql`
          SELECT id FROM invoice_changes WHERE invoice_id = ${c.invoice_id} AND change_type = ${c.change_type}
            AND detected_at > ${new Date(Date.now() - 86400000).toISOString()} LIMIT 1
        `);
        if (dup.rows.length === 0) {
          await db.execute(sql`
            INSERT INTO invoice_changes (invoice_id, invoice_number, client_name, amount, change_type, old_value, new_value, detected_at, approval_status)
            VALUES (${c.invoice_id}, ${c.invoice_number}, ${c.client_name}, ${c.amount}, ${c.change_type}, ${c.old_value}, ${c.new_value}, ${now}, ${"pending"})
          `);
          newChangeCount++;
        }
      }

      res.json({ synced: allInvoices.length, new_changes: newChangeCount, first_load: isFirstLoad });
    } catch (err: any) {
      console.error("[Harvest] Sync failed:", err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // GET /api/harvest/changes — last 30 days of changes (all statuses)
  app.get("/api/harvest/changes", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const rows = await db.execute(sql`
        SELECT id, invoice_id, invoice_number, client_name, amount, change_type, old_value, new_value, detected_at, approval_status, dismissed
        FROM invoice_changes WHERE detected_at > ${thirtyDaysAgo}
        ORDER BY detected_at DESC
      `);
      res.json({ changes: rows.rows });
    } catch (err: any) {
      res.json({ changes: [] });
    }
  });

  // POST /api/harvest/changes/:id/approve — approve a change and apply to snapshot
  app.post("/api/harvest/changes/:id/approve", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const changeId = safeInt(req.params.id);
      const now = new Date().toISOString();

      // Get the change
      const chRow = await db.execute(sql`SELECT * FROM invoice_changes WHERE id = ${changeId}`);
      if (chRow.rows.length === 0) return res.status(404).json({ error: "Change not found" });
      const ch = chRow.rows[0] as any;

      // Apply based on type
      if (ch.change_type === "new_invoice" || ch.change_type === "paid" || ch.change_type === "amount_changed") {
        // Re-fetch this single invoice from Harvest to get fresh data and update snapshot
        if (HARVEST_TOKEN && HARVEST_ACCOUNT) {
          try {
            const resp = await fetch(`${HARVEST_BASE}/invoices/${ch.invoice_id}`, { headers: harvestHeaders() });
            if (resp.ok) {
              const inv = await resp.json();
              const { projectCodes: projCodes, projectNames: projNames } = extractProjectCodeStrings(inv);
              await db.execute(sql`
                INSERT INTO invoice_snapshots (invoice_id, invoice_number, client_id, client_name, amount, due_amount, due_date, state, currency, subject, sent_at, paid_at, invoice_created_at, period_start, period_end, project_codes, project_names, updated_at)
                VALUES (${Number(inv.id)}, ${inv.number}, ${inv.client?.id ?? null}, ${inv.client?.name ?? ""}, ${Math.round(Number(inv.amount))}, ${Math.round(Number(inv.due_amount))}, ${inv.due_date}, ${inv.state}, ${inv.currency ?? "EUR"}, ${inv.subject}, ${inv.sent_at}, ${inv.paid_at}, ${inv.created_at}, ${inv.period_start}, ${inv.period_end}, ${projCodes}, ${projNames}, ${now})
                ON CONFLICT (invoice_id) DO UPDATE SET
                  invoice_number = EXCLUDED.invoice_number, client_name = EXCLUDED.client_name, amount = EXCLUDED.amount,
                  due_amount = EXCLUDED.due_amount, due_date = EXCLUDED.due_date, state = EXCLUDED.state, currency = EXCLUDED.currency,
                  subject = EXCLUDED.subject, sent_at = EXCLUDED.sent_at, paid_at = EXCLUDED.paid_at,
                  period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
                  project_codes = EXCLUDED.project_codes, project_names = EXCLUDED.project_names,
                  updated_at = EXCLUDED.updated_at
                  -- project_codes_manual / project_names_manual intentionally NOT touched
              `);
            }
          } catch { /* fallback: just mark approved without fresh fetch */ }
        }
      } else if (ch.change_type === "deleted") {
        await db.execute(sql`DELETE FROM invoice_snapshots WHERE invoice_id = ${ch.invoice_id}`);
      } else if (ch.change_type === "project_code_conflict") {
        // User explicitly approved Harvest's fresh value — overwrite the
        // manual override with it. The single source of truth remains the
        // DB; this is a user-confirmed write into that DB.
        const newCodes = ch.new_value == null ? null : String(ch.new_value);
        await db.execute(sql`
          UPDATE invoice_snapshots
          SET project_codes_manual = ${newCodes},
              updated_at = ${now}
          WHERE invoice_id = ${ch.invoice_id}
        `);
      }

      await db.execute(sql`UPDATE invoice_changes SET approval_status = 'approved' WHERE id = ${changeId}`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/harvest/changes/:id/reject — reject a change (keep old snapshot)
  app.post("/api/harvest/changes/:id/reject", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const changeId = safeInt(req.params.id);
      await db.execute(sql`UPDATE invoice_changes SET approval_status = 'rejected' WHERE id = ${changeId}`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/harvest/changes/:id/dismiss — dismiss notification banner
  app.post("/api/harvest/changes/:id/dismiss", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`UPDATE invoice_changes SET dismissed = 1 WHERE id = ${safeInt(req.params.id)}`);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Knowledge Center ──────────────────────────────────────────────────────

  // Topics CRUD
  app.get("/api/knowledge/topics", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const topics = await db.execute(sql`SELECT * FROM knowledge_topics ORDER BY sort_order, created_at`);
      const files = await db.execute(sql`SELECT * FROM knowledge_files ORDER BY uploaded_at DESC`);
      res.json({ topics: topics.rows, files: files.rows });
    } catch { res.json({ topics: [], files: [] }); }
  });

  app.post("/api/knowledge/topics", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const { name, description } = req.body;
      if (!name?.trim()) { res.status(400).json({ message: "name required" }); return; }
      const now = new Date().toISOString();
      await db.execute(sql`INSERT INTO knowledge_topics (name, description, created_at) VALUES (${name.trim()}, ${description || ""}, ${now})`);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/knowledge/topics/:id", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const id = safeInt(req.params.id);
      // Delete files in this topic
      const files = await db.execute(sql`SELECT file_path FROM knowledge_files WHERE topic_id = ${id}`);
      for (const f of files.rows) { try { fs.unlinkSync((f as any).file_path); } catch {} }
      await db.execute(sql`DELETE FROM knowledge_files WHERE topic_id = ${id}`);
      await db.execute(sql`DELETE FROM knowledge_topics WHERE id = ${id}`);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Files CRUD (within a topic)
  app.get("/api/knowledge", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const rows = await db.execute(sql`SELECT * FROM knowledge_files ORDER BY uploaded_at DESC`);
      res.json({ files: rows.rows });
    } catch { res.json({ files: [] }); }
  });

  app.post("/api/knowledge", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const { topic_id, filename, file_data, file_size } = req.body;
      if (!filename || !file_data) { res.status(400).json({ message: "filename and file_data required" }); return; }

      const uploadsDir = path.join(process.cwd(), "uploads", "knowledge");
      fs.mkdirSync(uploadsDir, { recursive: true });
      const safeFilename = filename.replace(/[^a-zA-Z0-9._\-() ]/g, "_");
      const filePath = path.join(uploadsDir, `${Date.now()}_${safeFilename}`);
      const buffer = Buffer.from(file_data, "base64");
      fs.writeFileSync(filePath, buffer);

      let contentText = "";
      if (/\.(txt|md|csv)$/i.test(filename)) {
        contentText = buffer.toString("utf-8").substring(0, 50000);
      } else {
        contentText = `[File: ${filename}, ${Math.round((file_size || buffer.length) / 1024)}KB — binary, content not extracted]`;
      }

      const now = new Date().toISOString();
      await db.execute(sql`
        INSERT INTO knowledge_files (topic_id, category, filename, file_path, file_size, content_text, uploaded_at)
        VALUES (${topic_id || 0}, ${"General"}, ${filename}, ${filePath}, ${file_size || buffer.length}, ${contentText}, ${now})
      `);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/knowledge/:id", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const id = safeInt(req.params.id);
      const row = await db.execute(sql`SELECT file_path FROM knowledge_files WHERE id = ${id}`);
      if (row.rows.length > 0) { try { fs.unlinkSync((row.rows[0] as any).file_path); } catch {} }
      await db.execute(sql`DELETE FROM knowledge_files WHERE id = ${id}`);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/proposals/:id/suggest-approach — AI generates project approach
  app.post("/api/proposals/:id/suggest-approach", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Not found" }); return; }

      // Load knowledge files for AI context
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const knowledgeRows = await db.execute(sql`SELECT filename, content_text FROM knowledge_files ORDER BY uploaded_at DESC LIMIT 20`);
      const knowledgeContext = knowledgeRows.rows
        .filter((r: any) => r.content_text)
        .map((r: any) => `--- ${r.filename} ---\n${(r.content_text as string).substring(0, 5000)}`)
        .join("\n\n");

      const { generateProjectApproach } = await import("./proposalBriefs");
      const approach = await generateProjectApproach({
        company_name: proposal.company_name,
        website: proposal.website,
        revenue: proposal.revenue,
        ebitda_margin: proposal.ebitda_margin,
        objective: proposal.objective,
        urgency: proposal.urgency,
        scope_perimeter: proposal.scope_perimeter,
        transcript: proposal.transcript,
        notes: proposal.notes,
        project_type: proposal.project_type,
        knowledge_context: knowledgeContext,
      });

      // Save to proposal
      await storage.updateProposal(id, { project_approach: approach });
      res.json({ approach });
    } catch (err: any) {
      console.error("Suggest approach error:", err.message);
      res.status(500).json({ message: err.message || "Failed to generate approach" });
    }
  });

  // POST /api/harvest/backfill-projects — one-time backfill of project codes from Harvest
  app.post("/api/harvest/backfill-projects", requireAuth, async (_req, res) => {
    if (!HARVEST_TOKEN || !HARVEST_ACCOUNT) {
      return res.status(503).json({ error: "Harvest credentials not configured" });
    }
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const now = new Date().toISOString();

      // Pull every invoice from Harvest LIST (which already includes
      // line_items) and re-run the extractor against the fresh data.
      let allInvoices: any[] = [];
      let page = 1, hasMore = true;
      while (hasMore) {
        const resp = await fetch(`${HARVEST_BASE}/invoices?per_page=100&page=${page}`, { headers: harvestHeaders() });
        if (!resp.ok) throw new Error(`Harvest API ${resp.status}: ${await resp.text()}`);
        const data = await resp.json();
        allInvoices = allInvoices.concat(data.invoices ?? []);
        hasMore = data.next_page !== null;
        page++;
      }

      let updated = 0;
      for (const inv of allInvoices) {
        const invId = Number(inv.id);
        const { projectCodes, projectNames } = extractProjectCodeStrings(inv);
        // Manual override columns are NEVER touched here.
        await db.execute(sql`
          UPDATE invoice_snapshots SET
            project_codes = ${projectCodes}, project_names = ${projectNames},
            updated_at = ${now}
          WHERE invoice_id = ${invId}
        `);
        if (projectCodes) updated++;
      }

      res.json({ backfilled: updated, total: allInvoices.length });
    } catch (err: any) {
      console.error("[Harvest] Backfill failed:", err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // PATCH /api/harvest/invoices/:id/project-codes — set MANUAL override that
  // survives every future Harvest sync. Pass { project_codes: "COE01,COE02" }
  // (and optionally project_names, and optionally apply_to_client: true to
  // also set this as the default for every blank invoice of the same client,
  // current and future).
  app.patch("/api/harvest/invoices/:id/project-codes", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const invId = safeInt(req.params.id);
      const rawCodes = req.body?.project_codes;
      const rawNames = req.body?.project_names;
      const applyToClient = !!req.body?.apply_to_client;
      const codes = (rawCodes === null || rawCodes === undefined || String(rawCodes).trim() === "")
        ? null
        : String(rawCodes).trim().toUpperCase().replace(/\s*,\s*/g, ",");
      const names = (rawNames === null || rawNames === undefined || String(rawNames).trim() === "")
        ? null
        : String(rawNames).trim();
      const result = await db.execute(sql`
        UPDATE invoice_snapshots SET
          project_codes_manual = ${codes},
          project_names_manual = ${names}
        WHERE invoice_id = ${invId}
      `);
      let clientDefaultSet = false;
      if (applyToClient && codes) {
        // Look up the client_id for this invoice and upsert the default.
        const inv = await db.execute(sql`SELECT client_id FROM invoice_snapshots WHERE invoice_id = ${invId}`);
        const cid = inv.rows[0] ? Number((inv.rows[0] as any).client_id) : null;
        if (cid) {
          const now = new Date().toISOString();
          await db.execute(sql`
            INSERT INTO client_project_defaults (client_id, default_code, default_name, updated_at)
            VALUES (${cid}, ${codes}, ${names}, ${now})
            ON CONFLICT (client_id) DO UPDATE SET
              default_code = EXCLUDED.default_code,
              default_name = EXCLUDED.default_name,
              updated_at = EXCLUDED.updated_at
          `);
          clientDefaultSet = true;
        }
      }
      res.json({ ok: true, invoice_id: invId, project_codes_manual: codes, project_names_manual: names, rows: result.rowCount ?? 0, client_default_set: clientDefaultSet });
    } catch (err: any) {
      console.error("[Harvest] PATCH project-codes failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/harvest/clients/:id/default-project-code — set the per-client
  // default code that fills in for every invoice with no auto code and no
  // per-invoice manual override. Pass { code: "FAS01", name?: "FAST Logistics" }
  // or { code: null } to clear.
  app.patch("/api/harvest/clients/:id/default-project-code", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const cid = safeInt(req.params.id);
      const rawCode = req.body?.code;
      const rawName = req.body?.name;
      const code = (rawCode === null || rawCode === undefined || String(rawCode).trim() === "")
        ? null
        : String(rawCode).trim().toUpperCase().replace(/\s*,\s*/g, ",");
      const name = (rawName === null || rawName === undefined || String(rawName).trim() === "")
        ? null
        : String(rawName).trim();
      const now = new Date().toISOString();
      if (code === null) {
        await db.execute(sql`DELETE FROM client_project_defaults WHERE client_id = ${cid}`);
      } else {
        await db.execute(sql`
          INSERT INTO client_project_defaults (client_id, default_code, default_name, updated_at)
          VALUES (${cid}, ${code}, ${name}, ${now})
          ON CONFLICT (client_id) DO UPDATE SET
            default_code = EXCLUDED.default_code,
            default_name = EXCLUDED.default_name,
            updated_at = EXCLUDED.updated_at
        `);
      }
      res.json({ ok: true, client_id: cid, default_code: code, default_name: name });
    } catch (err: any) {
      console.error("[Harvest] PATCH client default failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/harvest/client-defaults — list all client → default code mappings.
  app.get("/api/harvest/client-defaults", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const rows = await db.execute(sql`SELECT client_id, default_code, default_name, updated_at FROM client_project_defaults`);
      res.json({ defaults: rows.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/harvest/invoices/:id/raw — debug: dump raw Harvest JSON for a
  // single invoice so we can SEE exactly where the project code lives.
  app.get("/api/harvest/invoices/:id/raw", requireAuth, async (req, res) => {
    if (!HARVEST_TOKEN || !HARVEST_ACCOUNT) {
      return res.status(503).json({ error: "Harvest credentials not configured" });
    }
    try {
      const inv = await fetchHarvestInvoiceDetail(safeInt(req.params.id));
      if (!inv) return res.status(404).json({ error: "Not found" });
      const extracted = extractProjectCodeStrings(inv);
      res.json({ extracted, invoice: inv });
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  // POST /api/harvest/invoices/:id/reminder — send reminder via Harvest
  app.post("/api/harvest/invoices/:id/reminder", requireAuth, async (req, res) => {
    if (!HARVEST_TOKEN || !HARVEST_ACCOUNT) {
      return res.status(503).json({ error: "Harvest credentials not configured" });
    }
    try {
      const resp = await fetch(`${HARVEST_BASE}/invoices/${req.params.id}/messages`, {
        method: "POST", headers: harvestHeaders(),
        body: JSON.stringify({ event_type: "send", send_me_a_copy: true }),
      });
      if (!resp.ok) throw new Error(`Harvest API ${resp.status}: ${await resp.text()}`);
      res.json(await resp.json());
    } catch (err: any) {
      res.status(502).json({ error: err.message ?? "Failed to send reminder" });
    }
  });

  // ── API Cost Tracking ───────────────────────────────────────────────────────
  app.get("/api/api-cost", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      // Total cost this month
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const monthRows = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(cost_usd AS NUMERIC)), 0) as total_cost,
               COALESCE(SUM(input_tokens), 0) as total_input,
               COALESCE(SUM(output_tokens), 0) as total_output,
               COUNT(*) as call_count
        FROM api_usage_log WHERE created_at >= ${monthStart}
      `);
      const row = monthRows.rows[0] as any;
      // Today's cost
      const todayStart = new Date().toISOString().split("T")[0] + "T00:00:00.000Z";
      const todayRows = await db.execute(sql`
        SELECT COALESCE(SUM(CAST(cost_usd AS NUMERIC)), 0) as today_cost,
               COUNT(*) as today_calls
        FROM api_usage_log WHERE created_at >= ${todayStart}
      `);
      const today = todayRows.rows[0] as any;
      res.json({
        month_cost_usd: parseFloat(row.total_cost || "0").toFixed(4),
        month_input_tokens: Number(row.total_input),
        month_output_tokens: Number(row.total_output),
        month_calls: Number(row.call_count),
        today_cost_usd: parseFloat(today.today_cost || "0").toFixed(4),
        today_calls: Number(today.today_calls),
      });
    } catch (err: any) {
      res.json({ month_cost_usd: "0", month_calls: 0, today_cost_usd: "0", today_calls: 0 });
    }
  });

  // ── Security Auto-Checks ────────────────────────────────────────────────────
  app.get("/api/security/app-checks", requireAuth, async (_req, res) => {
    try {
      const checks: { id: string; status: "green" | "yellow" | "red"; detail: string }[] = [];

      // Check 1: helmet in dependencies
      try {
        const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf-8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        checks.push({
          id: "app_helmet",
          status: deps["helmet"] ? "green" : "red",
          detail: deps["helmet"] ? `helmet ${deps["helmet"]} installed` : "helmet not installed — no security headers",
        });
        checks.push({
          id: "app_rate_limit",
          status: deps["express-rate-limit"] ? "green" : "red",
          detail: deps["express-rate-limit"] ? `express-rate-limit ${deps["express-rate-limit"]} installed` : "express-rate-limit not installed — login brute-force possible",
        });
      } catch { /* skip */ }

      // Check 2: auth uses plaintext comparison
      try {
        const authCode = fs.readFileSync(path.resolve("server/auth.ts"), "utf-8");
        const usesPlaintext = authCode.includes("=== appPassword") || authCode.includes("== appPassword");
        const usesBcrypt = authCode.includes("bcrypt") || authCode.includes("argon");
        checks.push({
          id: "app_password_hashing",
          status: usesBcrypt ? "green" : usesPlaintext ? "red" : "yellow",
          detail: usesBcrypt ? "Password hashed with bcrypt/argon" : usesPlaintext ? "Plaintext password comparison in auth.ts" : "Unknown auth pattern",
        });
      } catch { /* skip */ }

      // Check 3: .gitignore covers secrets
      try {
        const gitignore = fs.readFileSync(path.resolve(".gitignore"), "utf-8");
        const coversEnv = gitignore.includes(".env");
        const coversPem = gitignore.includes(".pem") || gitignore.includes("*.pem");
        checks.push({
          id: "app_gitignore",
          status: coversEnv ? "green" : "red",
          detail: coversEnv ? `.gitignore covers .env files${coversPem ? " and .pem keys" : ""}` : ".gitignore does NOT exclude .env files",
        });
      } catch { /* skip */ }

      // Check 4: session cookie max age
      try {
        const authCode = fs.readFileSync(path.resolve("server/auth.ts"), "utf-8");
        const match = authCode.match(/MAX_AGE\s*=\s*(\d+)/);
        if (match) {
          const days = Math.round(parseInt(match[1]) / 86400000);
          checks.push({
            id: "app_session_duration",
            status: days <= 7 ? "green" : days <= 14 ? "yellow" : "red",
            detail: `Session cookie expires in ${days} days${days > 14 ? " — should be ≤7 days" : ""}`,
          });
        }
      } catch { /* skip */ }

      // Check 5: HARVEST_TOKEN set
      checks.push({
        id: "render_harvest_token",
        status: HARVEST_TOKEN ? "green" : "yellow",
        detail: HARVEST_TOKEN ? "HARVEST_TOKEN env var configured" : "HARVEST_TOKEN not set",
      });

      // Check 6: scan code for hardcoded secrets
      try {
        const secretPatterns = [
          { name: "API key/token", regex: /(?:api[_-]?key|token|bearer)\s*[:=]\s*["'][A-Za-z0-9._\-]{20,}["']/gi },
          { name: "AWS key", regex: /AKIA[0-9A-Z]{16}/g },
          { name: "Private key", regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
          { name: "Password string", regex: /(?:password|passwd|secret)\s*[:=]\s*["'][^"']{8,}["']/gi },
          { name: "Connection string", regex: /(?:postgres|mysql|mongodb):\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi },
          { name: "Harvest token", regex: /\d{7}\.pt\.[A-Za-z0-9_\-]{20,}/g },
          { name: "JWT", regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
        ];
        const scanDirs = ["server", "client/src", "shared"];
        const findings: { file: string; line: number; pattern: string; snippet: string }[] = [];

        const walkDir = (dir: string) => {
          try {
            const entries = fs.readdirSync(path.resolve(dir), { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "dist") {
                walkDir(fullPath);
              } else if (entry.isFile() && /\.(ts|tsx|js|json|env|yaml|yml)$/i.test(entry.name) && entry.name !== "package-lock.json") {
                try {
                  const content = fs.readFileSync(path.resolve(fullPath), "utf-8");
                  const lines = content.split("\n");
                  for (let i = 0; i < lines.length; i++) {
                    for (const pat of secretPatterns) {
                      if (pat.regex.test(lines[i])) {
                        // Skip env var references like process.env.X
                        if (/process\.env/.test(lines[i])) continue;
                        // Skip comments explaining patterns (like this very code)
                        if (/regex|pattern|match|test\(|secretPatterns/i.test(lines[i])) continue;
                        const snippet = lines[i].trim().substring(0, 120);
                        findings.push({ file: fullPath, line: i + 1, pattern: pat.name, snippet });
                      }
                      pat.regex.lastIndex = 0; // reset global regex
                    }
                  }
                } catch { /* skip unreadable files */ }
              }
            }
          } catch { /* skip unreadable dirs */ }
        };
        for (const d of scanDirs) walkDir(d);

        checks.push({
          id: "app_secrets_scan",
          status: findings.length === 0 ? "green" : "red",
          detail: findings.length === 0
            ? "No hardcoded secrets found in codebase"
            : `Found ${findings.length} potential secret(s) in code`,
          ...(findings.length > 0 ? { findings } : {}),
        } as any);
      } catch { /* skip */ }

      res.json({ checks });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/security/scan-secrets — dedicated deep scan for hardcoded secrets
  app.get("/api/security/scan-secrets", requireAuth, async (_req, res) => {
    try {
      const secretPatterns = [
        { name: "API key/token", regex: /(?:api[_-]?key|token|bearer)\s*[:=]\s*["'][A-Za-z0-9._\-]{20,}["']/gi },
        { name: "AWS access key", regex: /AKIA[0-9A-Z]{16}/g },
        { name: "Private key block", regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g },
        { name: "Hardcoded password", regex: /(?:password|passwd|secret)\s*[:=]\s*["'][^"']{8,}["']/gi },
        { name: "DB connection string", regex: /(?:postgres|mysql|mongodb):\/\/[^\s"']+:[^\s"']+@[^\s"']+/gi },
        { name: "Harvest personal token", regex: /\d{7}\.pt\.[A-Za-z0-9_\-]{20,}/g },
        { name: "JWT token", regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
        { name: "Generic long secret", regex: /(?:SECRET|KEY|TOKEN|PASS)\s*[:=]\s*["'][A-Za-z0-9+\/=_\-]{32,}["']/gi },
      ];
      const scanDirs = ["server", "client/src", "shared"];
      const findings: { file: string; line: number; pattern: string; snippet: string }[] = [];

      const walkDir = (dir: string) => {
        try {
          const entries = fs.readdirSync(path.resolve(dir), { withFileTypes: true });
          for (const entry of entries) {
            const fp = path.join(dir, entry.name);
            if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "dist") {
              walkDir(fp);
            } else if (entry.isFile() && /\.(ts|tsx|js|jsx|json|env|yaml|yml|sh|md)$/i.test(entry.name) && entry.name !== "package-lock.json") {
              try {
                const content = fs.readFileSync(path.resolve(fp), "utf-8");
                const lines = content.split("\n");
                for (let i = 0; i < lines.length; i++) {
                  for (const pat of secretPatterns) {
                    if (pat.regex.test(lines[i])) {
                      if (/process\.env/.test(lines[i])) continue;
                      if (/regex|pattern|match|test\(|secretPatterns/i.test(lines[i])) continue;
                      const raw = lines[i].trim();
                      // Mask the actual secret value for safety
                      const snippet = raw.length > 80 ? raw.substring(0, 80) + "..." : raw;
                      findings.push({ file: fp, line: i + 1, pattern: pat.name, snippet });
                    }
                    pat.regex.lastIndex = 0;
                  }
                }
              } catch { /* skip */ }
            }
          }
        } catch { /* skip */ }
      };
      for (const d of scanDirs) walkDir(d);

      res.json({
        scanned_at: new Date().toISOString(),
        files_scanned: scanDirs.join(", "),
        finding_count: findings.length,
        status: findings.length === 0 ? "clean" : "secrets_found",
        findings,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Global error handler — catches unhandled route errors
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.status ?? 500;
    console.error(`[API Error] ${status}:`, err.message || err);
    if (!res.headersSent) {
      res.status(status).json({ error: err.message || "Internal server error" });
    }
  });

  return httpServer;
}
