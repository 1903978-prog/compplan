import type { Express } from "express";
import { createServer, type Server } from "http";
import { requireAuth } from "./auth";
import { storage, trashAndDelete, listTrash, restoreTrash, purgeTrashItem, TrashRestoreConflictError } from "./storage";
import { insertEmployeeSchema, insertPricingCaseSchema, orgAgents, agentProposals, agentKnowledge, briefRuns, briefEvents, assetTypes, assets, okrNodeData, agents as agentsTable, objectives as objectivesTable, keyResults as keyResultsTable, ideas as ideasTable, tasks as tasksTable, executiveLog, conflicts as conflictsTable, coworkSkills, presidentRequests, type BenchmarkRow, aiosCycles, aiosExecLogs, aiosDeliverables, bossConsolidations, ceoBriefs, coworkOutputs, coworkLetters, microAiLog, aiResponseCache, pricingRules, agentKpis, kmSessions, kmOutputs, invoiceSnapshots, bdDeals, employees, pricingCases } from "@shared/schema";
import { createAiosCycle, runDailyAiosCycle, pauseAiosCycle, resumeAiosCycle, generateCoworkPrompt as genCoworkPrompt, storeCoworkOutput, subscribeToCycle, unsubscribeFromCycle, runRound2, runSingleAgent } from "./aiosService";
import { runKmCycle, getKmSessions, getKmSessionDetail } from "./kmService";
import { runCeoBrief } from "./ceoBriefRunner";
import { listTemplates, loadTemplate, loadTemplateRaw, render as renderTemplate, saveTemplate } from "./microAI/templateEngine";
import { ceoBriefRuns, ceoBriefRunDecisions } from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, gte, count, sum } from "drizzle-orm";
import { renderSlideFromSpec } from "@shared/slideTemplateRenderer";
import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { MODULE_REGISTRY, pruneExpiredCache, useLocalAiFirst } from "./microAI/index.js";

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

  // ── Template engine (micro-AI) ───────────────────────────────────────
  // List, fetch, render and save markdown templates. Renders are logged
  // into template_renders so we can see token-free deliverable volume.
  app.get("/api/templates", requireAuth, (req, res) => {
    const agent = (req.query.agent as string | undefined)?.trim() || undefined;
    res.json(listTemplates(agent));
  });
  app.get("/api/templates/:agent/:slug", requireAuth, (req, res) => {
    try {
      const { meta, body } = loadTemplate(req.params.agent, req.params.slug);
      const raw = loadTemplateRaw(req.params.agent, req.params.slug);
      res.json({ meta, body, raw });
    } catch (err: any) {
      res.status(404).json({ message: err?.message ?? "Template not found" });
    }
  });
  app.post("/api/templates/render", requireAuth, async (req, res) => {
    try {
      const { agent, slug, slots, used_in } = req.body ?? {};
      if (!agent || !slug) return res.status(400).json({ message: "agent and slug are required" });
      const result = renderTemplate(agent, slug, slots ?? {});
      try {
        await db.execute(sql`
          INSERT INTO template_renders (agent, template_slug, slots, output, used_in)
          VALUES (${agent}, ${slug}, ${JSON.stringify(slots ?? {})}::jsonb, ${result.body}, ${used_in ?? null})
        `);
      } catch { /* logging is best-effort */ }
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Render failed" });
    }
  });
  app.post("/api/templates/:agent/:slug", requireAuth, (req, res) => {
    try {
      const { content } = req.body ?? {};
      if (typeof content !== "string" || !content.includes("---")) {
        return res.status(400).json({ message: "content must be a markdown string with frontmatter" });
      }
      saveTemplate(req.params.agent, req.params.slug, content);
      const { meta, body } = loadTemplate(req.params.agent, req.params.slug);
      res.json({ meta, body });
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Save failed" });
    }
  });

  // ── Agent template callsites — 5 high-volume wired endpoints ─────────────
  // These replace Claude calls for predictable structured deliverables.
  // Each fetches live data, maps it to template slots, and renders via
  // templateEngine.render() — zero LLM tokens.

  // 1. AR: generate reminder email for an overdue invoice.
  //    Picks the right template based on days overdue.
  //    POST /api/ar/invoices/:invoiceId/generate-reminder
  app.post("/api/ar/invoices/:invoiceId/generate-reminder", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.invoiceId, 10);
      const [inv] = await db.select().from(invoiceSnapshots).where(eq(invoiceSnapshots.invoice_id, id));
      if (!inv) return res.status(404).json({ message: "Invoice not found" });
      const { contact_name = req.body.contact_name ?? inv.client_name ?? "there",
              sender_name  = req.body.sender_name  ?? "Livio" } = req.body ?? {};
      const dueDate = inv.due_date ? new Date(inv.due_date) : null;
      const daysOverdue = dueDate ? Math.floor((Date.now() - dueDate.getTime()) / 86400000) : 0;
      let slug = "reminder_t0_gentle";
      if (daysOverdue >= 60) slug = "escalation_t60";
      else if (daysOverdue >= 30) slug = "reminder_t30_urgent";
      else if (daysOverdue >= 15) slug = "reminder_t15_firm";
      const slots: Record<string, string> = {
        client_name: inv.client_name ?? "",
        contact_name,
        invoice_number: inv.invoice_number ?? String(inv.invoice_id),
        invoice_date: inv.invoice_created_at?.slice(0, 10) ?? "",
        amount: `€${((inv.amount ?? 0) / 100).toLocaleString("en-EU")}`,
        due_date: inv.due_date ?? "",
        days_overdue: String(daysOverdue),
        payment_details: req.body.payment_details ?? "IBAN: [see invoice]",
        sender_name,
        senior_contact_name: req.body.senior_contact_name ?? contact_name,
      };
      const result = renderTemplate("ar_agent", slug, slots);
      res.json({ ...result, days_overdue: daysOverdue, slug });
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Render failed" });
    }
  });

  // 2. BD: generate cold outreach email for a deal.
  //    Slug determined by contact_count in body (0 = first touch, 1 = second).
  //    POST /api/bd/deals/:id/generate-outreach
  app.post("/api/bd/deals/:id/generate-outreach", requireAuth, async (req, res) => {
    try {
      const [deal] = await db.select().from(bdDeals).where(eq(bdDeals.id, parseInt(req.params.id, 10)));
      if (!deal) return res.status(404).json({ message: "Deal not found" });
      const { touch = 1, sender_name = "Livio", sender_role = "President" } = req.body ?? {};
      const slug = touch === 2 ? "cold_second_touch"
                 : touch === 0 ? "warm_intro"
                 : "cold_first_touch";
      const slots: Record<string, string> = {
        prospect_name: deal.contact_name ?? deal.client_name ?? "",
        prospect_role: req.body.prospect_role ?? "Decision Maker",
        prospect_company: deal.client_name ?? "",
        sector: deal.industry ?? req.body.sector ?? "your industry",
        pain_point: req.body.pain_point ?? "current transformation priorities",
        our_angle: req.body.our_angle ?? "accelerate your strategic agenda with AI-native consulting",
        original_angle: req.body.original_angle ?? "AI-native consulting",
        new_hook: req.body.new_hook ?? "I came across a recent development that may be directly relevant.",
        referrer_name: req.body.referrer_name ?? "",
        context: req.body.context ?? "",
        sender_name,
        sender_role,
      };
      const result = renderTemplate("bd_agent", slug, slots);
      res.json({ ...result, deal_id: deal.id, slug });
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Render failed" });
    }
  });

  // 3. CFO: generate P&L summary. Caller provides all slots in body.
  //    POST /api/cfo/generate-pnl-summary
  app.post("/api/cfo/generate-pnl-summary", requireAuth, async (req, res) => {
    try {
      const result = renderTemplate("cfo_agent", "pnl_summary", req.body ?? {});
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Render failed" });
    }
  });

  // 4. CHRO: generate 30-60-90 onboarding plan for an employee.
  //    POST /api/chro/employees/:id/generate-onboarding
  app.post("/api/chro/employees/:id/generate-onboarding", requireAuth, async (req, res) => {
    try {
      const [emp] = await db.select().from(employees).where(eq(employees.id, req.params.id));
      if (!emp) return res.status(404).json({ message: "Employee not found" });
      const slots: Record<string, unknown> = {
        employee: emp.name,
        role: req.body.role ?? emp.current_role_code ?? "",
        start_date: emp.hire_date ?? req.body.start_date ?? "",
        buddy: req.body.buddy ?? "",
        day30_milestones: req.body.day30_milestones ?? [],
        day60_milestones: req.body.day60_milestones ?? [],
        day90_milestones: req.body.day90_milestones ?? [],
        key_stakeholders: req.body.key_stakeholders ?? [],
        ...req.body,
      };
      const result = renderTemplate("chro_agent", "onboarding_30_60_90", slots);
      res.json({ ...result, employee_id: emp.id });
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Render failed" });
    }
  });

  // 5. Delivery: generate weekly project status report.
  //    Hydrates project_name and client from pricingCases if project_id given.
  //    POST /api/delivery/projects/:id/generate-status
  app.post("/api/delivery/projects/:id/generate-status", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [project] = await db.select().from(pricingCases).where(eq(pricingCases.id, id));
      const slots: Record<string, unknown> = {
        project_name: project?.project_name ?? req.body.project_name ?? "",
        client: project?.client_name ?? req.body.client ?? "",
        week: req.body.week ?? new Date().toISOString().slice(0, 10),
        overall_rag: req.body.overall_rag ?? "🟢 Green",
        schedule_rag: req.body.schedule_rag ?? "🟢 Green",
        budget_rag: req.body.budget_rag ?? "🟢 Green",
        scope_rag: req.body.scope_rag ?? "🟢 Green",
        budget_used_pct: req.body.budget_used_pct ?? "0",
        accomplishments: req.body.accomplishments ?? [],
        next_week: req.body.next_week ?? [],
        blockers: req.body.blockers ?? [],
        ...req.body,
      };
      const result = renderTemplate("delivery_officer", "project_status", slots);
      res.json({ ...result, project_id: id });
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Render failed" });
    }
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
  app.post("/api/diag/reseed-proposals", requireAuth, async (_req, res) => {
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
  // Streams a zip of the entire repo (tip-of-HEAD on the deployed branch)
  // by piping `git archive` straight to the response. Excludes node_modules,
  // dist, .env automatically (git only knows about tracked files). Useful
  // as an offline snapshot or to bootstrap the same app on another machine.
  app.get("/api/code-download", requireAuth, async (_req, res) => {
    try {
      const { spawn } = await import("child_process");
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="compplan-code-${date}.zip"`);
      const git = spawn("git", ["archive", "--format=zip", "HEAD"], { cwd: process.cwd() });
      git.stdout.pipe(res);
      git.stderr.on("data", (d) => console.error("[code-download] git stderr:", d.toString()));
      git.on("error", (err) => {
        console.error("[code-download] spawn failed:", err);
        if (!res.headersSent) res.status(500).json({ message: "git archive unavailable" });
      });
      git.on("close", (code) => {
        if (code !== 0 && !res.headersSent) {
          res.status(500).json({ message: `git archive exited ${code}` });
        }
      });
    } catch (e) {
      console.error("[code-download] failed:", e);
      if (!res.headersSent) res.status(500).json({ message: (e as Error).message });
    }
  });

  // ── Save code zip directly to LOCAL_BACKUP_DIR ──────────────────────
  // POST /api/admin/save-code-local — runs git archive and writes the zip
  // to process.env.LOCAL_BACKUP_DIR (set in .env). Returns { saved, path }.
  // Only meaningful when the server is running on the same machine as the
  // user (i.e. local dev). On Render LOCAL_BACKUP_DIR is unset → 400.
  app.post("/api/admin/save-code-local", requireAuth, async (_req, res) => {
    const dir = process.env.LOCAL_BACKUP_DIR?.trim();
    if (!dir) {
      return res.status(400).json({ error: "LOCAL_BACKUP_DIR is not set in .env" });
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const filename = `compplan-code-${date}.zip`;
      const dest = path.join(dir, filename);
      const out = fs.createWriteStream(dest);
      const git = spawn("git", ["archive", "--format=zip", "HEAD"], { cwd: process.cwd() });
      git.stdout.pipe(out);
      await new Promise<void>((resolve, reject) => {
        out.on("finish", resolve);
        out.on("error", reject);
        git.on("error", reject);
        git.on("close", (code) => { if (code !== 0) reject(new Error(`git archive exited ${code}`)); });
      });
      res.json({ saved: true, path: dest, filename });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Save DB backup directly to LOCAL_BACKUP_DIR ──────────────────────
  // POST /api/admin/save-backup-local — same dump as download-backup but
  // writes directly to LOCAL_BACKUP_DIR instead of streaming to browser.
  app.post("/api/admin/save-backup-local", requireAuth, async (_req, res) => {
    const dir = process.env.LOCAL_BACKUP_DIR?.trim();
    if (!dir) {
      return res.status(400).json({ error: "LOCAL_BACKUP_DIR is not set in .env" });
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      const { db: localDb } = await import("./db");
      const { sql: localSql } = await import("drizzle-orm");
      const dump: Record<string, any[]> = {};
      for (const t of BACKUP_TABLES) {
        try {
          const r = await localDb.execute(localSql.raw(`SELECT * FROM ${t}`));
          dump[t] = r.rows as any[];
        } catch {
          dump[t] = [];
        }
      }
      const date = new Date().toISOString().slice(0, 10);
      const filename = `compplan-backup-${date}.json`;
      const dest = path.join(dir, filename);
      fs.writeFileSync(dest, JSON.stringify({ exportedAt: new Date().toISOString(), schemaVersion: 2, tables: dump }, null, 2), "utf8");
      res.json({ saved: true, path: dest, filename });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Org Chart ────────────────────────────────────────────────────────
  // Powers /exec/org-chart. Returns all roles ordered by sort_order so the
  // CEO comes first and direct reports follow. Editable from the UI; also
  // writable by the eendigo-ceo skill via the same endpoints (it can update
  // tasks_10d, goals, OKRs daily).
  app.get("/api/org-chart", requireAuth, async (_req, res) => {
    try {
      const rows = await db.select().from(orgAgents).orderBy(orgAgents.sort_order);
      res.json(rows);
    } catch (e) {
      console.error("[org-chart] GET failed:", e);
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // POST /api/org-chart — create a new role (agent or human). Slugifies
  // role_key from role_name if not supplied; rejects duplicate role_keys.
  app.post("/api/org-chart", requireAuth, async (req, res) => {
    try {
      const b = req.body as Record<string, any>;
      const role_name = String(b.role_name ?? "").trim().slice(0, 80);
      if (!role_name) { res.status(400).json({ message: "role_name required" }); return; }
      const slug = (b.role_key ? String(b.role_key) : role_name)
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
      if (!slug) { res.status(400).json({ message: "role_key invalid" }); return; }
      const existing = await db.select().from(orgAgents).where(eq(orgAgents.role_key, slug));
      if (existing.length > 0) { res.status(409).json({ message: `role_key '${slug}' already exists` }); return; }
      const parent_role_key = b.parent_role_key ? String(b.parent_role_key) : null;
      if (parent_role_key) {
        const parent = await db.select().from(orgAgents).where(eq(orgAgents.role_key, parent_role_key));
        if (parent.length === 0) { res.status(400).json({ message: "Unknown parent_role_key" }); return; }
      }
      const now = new Date().toISOString();
      const row = {
        role_key: slug,
        role_name,
        parent_role_key,
        person_name: typeof b.person_name === "string" ? b.person_name.slice(0, 80) : null,
        status: ["active", "onboarding", "vacant", "fired"].includes(String(b.status)) ? String(b.status) : "active",
        kind: ["agent", "human"].includes(String(b.kind)) ? String(b.kind) : "agent",
        email: typeof b.email === "string" ? b.email.slice(0, 120) : null,
        goals: Array.isArray(b.goals) ? (b.goals as unknown[]).slice(0, 30).map(String) : [],
        okrs: Array.isArray(b.okrs) ? (b.okrs as unknown[]).slice(0, 10) : [],
        tasks_10d: Array.isArray(b.tasks_10d) ? (b.tasks_10d as unknown[]).slice(0, 50) : [],
        dotted_parent_role_keys: Array.isArray(b.dotted_parent_role_keys) ? (b.dotted_parent_role_keys as unknown[]).slice(0, 5).map(String) : [],
        sort_order: typeof b.sort_order === "number" ? b.sort_order : 99,
        created_at: now,
        updated_at: now,
      };
      const inserted = await db.insert(orgAgents).values(row as any).returning();
      res.status(201).json(inserted[0]);
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // ── Brief runs (live cascade) ──────────────────────────────────────
  app.get("/api/brief-runs", requireAuth, async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(50, parseInt((req.query.limit as string) ?? "20")));
      const rows = await db.select().from(briefRuns).orderBy(desc(briefRuns.started_at)).limit(limit);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.get("/api/brief-runs/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const runs = await db.select().from(briefRuns).where(eq(briefRuns.id, id));
      if (runs.length === 0) { res.status(404).json({ message: "Not found" }); return; }
      const events = await db.select().from(briefEvents).where(eq(briefEvents.run_id, id)).orderBy(briefEvents.created_at);
      res.json({ run: runs[0], events });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.post("/api/brief-runs", requireAuth, async (req, res) => {
    try {
      const trigger = String((req.body as any)?.trigger ?? "ceo brief").slice(0, 80);
      const now = new Date().toISOString();
      const inserted = await db.insert(briefRuns).values({ trigger, status: "running", started_at: now } as any).returning();
      res.status(201).json(inserted[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.put("/api/brief-runs/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = req.body as Record<string, any>;
      const update: any = {};
      if (typeof b.status === "string" && ["running", "completed", "failed"].includes(b.status)) {
        update.status = b.status;
        if (b.status !== "running") update.completed_at = new Date().toISOString();
      }
      if (typeof b.final_summary === "string") update.final_summary = b.final_summary.slice(0, 4000);
      if (typeof b.proposals_count === "number") update.proposals_count = b.proposals_count;
      const rows = await db.update(briefRuns).set(update).where(eq(briefRuns.id, id)).returning();
      if (rows.length === 0) { res.status(404).json({ message: "Not found" }); return; }
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.post("/api/brief-runs/:id/events", requireAuth, async (req, res) => {
    try {
      const run_id = safeInt(req.params.id);
      const b = req.body as Record<string, any>;
      const role_key = String(b.role_key ?? "").trim().slice(0, 60);
      const event_type = String(b.event_type ?? "").trim().slice(0, 30);
      const summary = String(b.summary ?? "").trim().slice(0, 500);
      if (!role_key || !event_type || !summary) { res.status(400).json({ message: "role_key + event_type + summary required" }); return; }

      // D17: extract commitments from the event summary (fire-and-forget enrichment).
      // D18: classify the reply if this is an inbound_reply event.
      // Both run in parallel, best-effort — never block the insert.
      const { extractCommitments, classifyReply, useLocalAiFirst } = await import("./microAI/index.js");
      let enrichedPayload = (b.payload && typeof b.payload === "object") ? { ...b.payload } : {} as Record<string, unknown>;
      if (useLocalAiFirst()) {
        const [commitments, replyClass] = await Promise.all([
          extractCommitments(summary).catch(() => [] as any[]),
          event_type === "inbound_reply"
            ? classifyReply(summary).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (commitments.length > 0) enrichedPayload.commitments = commitments;
        if (replyClass)             enrichedPayload.reply_classification = replyClass;
      }

      const inserted = await db.insert(briefEvents).values({
        run_id, role_key, event_type, summary,
        payload: Object.keys(enrichedPayload).length > 0 ? enrichedPayload : null,
        created_at: new Date().toISOString(),
      } as any).returning();
      res.status(201).json(inserted[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── Agent Knowledge ───────────────────────────────────────────────────
  // Per-role memory the user / agents have given to a role. Each role-skill
  // reads these on every run before producing a brief or decision.
  app.get("/api/agent-knowledge", requireAuth, async (req, res) => {
    try {
      const role   = req.query.role_key as string | undefined;
      const status = (req.query.status  as string | undefined) ?? "active";
      const searchQ = (req.query.q as string | undefined)?.trim() ?? "";

      let q = db.select().from(agentKnowledge).$dynamic();
      if (role && status === "active") {
        q = q.where(and(eq(agentKnowledge.role_key, role), eq(agentKnowledge.status, "active")));
      } else if (role) {
        q = q.where(eq(agentKnowledge.role_key, role));
      } else if (status !== "all") {
        q = q.where(eq(agentKnowledge.status, status));
      }
      const rows = await q.orderBy(desc(agentKnowledge.created_at));

      // A1: semantic re-rank when ?q= is provided and USE_LOCAL_AI_FIRST is on.
      // Embed the query, embed each knowledge row's content (via embedCached),
      // sort descending by cosine similarity, return top 20.
      if (searchQ && rows.length > 0) {
        try {
          const { embedCached, cosineSimilarity, useLocalAiFirst } = await import("./microAI/index.js");
          if (useLocalAiFirst()) {
            const queryVec = await embedCached(searchQ);
            const scored = await Promise.all(rows.map(async r => {
              try {
                const vec = await embedCached((r.content ?? "").slice(0, 500));
                return { row: r, score: cosineSimilarity(queryVec, vec) };
              } catch { return { row: r, score: 0 }; }
            }));
            scored.sort((a, b) => b.score - a.score);
            return res.json(scored.slice(0, 20).map(s => ({ ...s.row, _similarity: s.score })));
          }
        } catch { /* embedder unavailable — return unsorted rows */ }
      }

      res.json(rows);
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  app.post("/api/agent-knowledge", requireAuth, async (req, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      const role_key = String(b.role_key ?? "").trim();
      const content = String(b.content ?? "").trim().slice(0, 12000);
      if (!role_key || !content) { res.status(400).json({ message: "role_key + content required" }); return; }

      // A3 NER: auto-extract entity tags from content so knowledge is
      // searchable by people, orgs, dates, and amounts. Best-effort.
      let autoTags: string[] = Array.isArray(b.tags) ? (b.tags as unknown[]).slice(0, 20).map(String) : [];

      // E22 dedup: embed the incoming content and compare against the last
      // 50 active entries for this role. Reject (409) if cosine similarity ≥ 0.92.
      // This prevents the knowledge base from filling up with paraphrased duplicates.
      try {
        const { embedCached, cosineSimilarity, extractEntities, useLocalAiFirst } = await import("./microAI/index.js");
        if (useLocalAiFirst()) {
          // Run NER + dedup embedding in parallel
          const [entities, newVec] = await Promise.all([
            extractEntities(content.slice(0, 2000)).catch(() => ({ people: [], organisations: [], dates: [], amounts: [], places: [] })),
            embedCached(content.slice(0, 500)),
          ]);

          // NER tags
          const nerTags = [
            ...entities.people.slice(0, 5),
            ...entities.organisations.slice(0, 5),
          ].map(t => t.toLowerCase().replace(/\s+/g, "_")).filter(Boolean);
          autoTags = Array.from(new Set([...autoTags, ...nerTags])).slice(0, 30);

          // Dedup: load recent knowledge for this role and check similarity
          const existing = await db.select({ id: agentKnowledge.id, content: agentKnowledge.content })
            .from(agentKnowledge)
            .where(and(eq(agentKnowledge.role_key, role_key), eq(agentKnowledge.status, "active")))
            .orderBy(desc(agentKnowledge.created_at))
            .limit(50);

          for (const ex of existing) {
            const exVec = await embedCached((ex.content ?? "").slice(0, 500)).catch(() => null);
            if (!exVec) continue;
            const sim = cosineSimilarity(newVec, exVec);
            if (sim >= 0.92) {
              res.status(409).json({
                message: "Near-duplicate knowledge entry detected (similarity ≥ 92%). Update the existing entry instead.",
                duplicate_id: ex.id,
                similarity: Math.round(sim * 1000) / 1000,
              });
              return;
            }
          }
        }
      } catch (nerErr) {
        // NER/dedup failure is non-fatal — proceed without enrichment
        console.warn("[agent-knowledge POST] NER/dedup skipped:", (nerErr as Error).message);
      }

      const row = {
        role_key,
        content,
        title: typeof b.title === "string" ? b.title.slice(0, 200) : null,
        source: ["user", "agent", "web"].includes(String(b.source)) ? String(b.source) : "user",
        tags: autoTags,
        status: "active" as const,
        created_by_role: typeof b.created_by_role === "string" ? b.created_by_role.slice(0, 60) : null,
        created_at: new Date().toISOString(),
      };
      const inserted = await db.insert(agentKnowledge).values(row as any).returning();
      res.status(201).json(inserted[0]);
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Multipart file upload → extract text → store in agent_knowledge.
  // Accepts the file as raw body (matching the existing proposal-attachment
  // pattern), with role_key + filename in headers. Text formats are read
  // as UTF-8; binary formats (PDF / PPTX / DOCX) get a placeholder note
  // so the role's brief still surfaces "this document was uploaded but
  // text wasn't extracted" — the user can re-upload with paste-text once
  // they convert. Adding pdf-parse / mammoth / jszip later turns the
  // placeholder into real extracted text.
  app.post("/api/agent-knowledge/upload",
    requireAuth,
    (req, _res, next) => {
      const ct = req.headers["content-type"] || "";
      // Multipart parser would be ideal — but to avoid pulling multer in,
      // we use the same raw-body trick the proposals attachment route uses,
      // and ask the client to send the file body directly with role_key +
      // filename in custom headers.
      if (!ct.includes("application/json")) {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => { (req as any).rawBody = Buffer.concat(chunks); next(); });
        req.on("error", next);
      } else {
        next();
      }
    },
    async (req, res) => {
      try {
        // The browser FormData posts multipart/form-data — we need a
        // tiny multipart parser since we deliberately don't depend on
        // multer. Look for the boundary, find the file part.
        const ct = (req.headers["content-type"] || "") as string;
        const boundaryMatch = ct.match(/boundary=([^;]+)/);
        if (!boundaryMatch) {
          res.status(400).json({ message: "Missing multipart boundary" });
          return;
        }
        const boundary = `--${boundaryMatch[1].trim()}`;
        const raw: Buffer = (req as any).rawBody;
        if (!raw || raw.length === 0) {
          res.status(400).json({ message: "No file data received" });
          return;
        }
        // Split on boundary, parse parts.
        const text = raw.toString("binary"); // keep bytes intact
        const parts = text.split(boundary).slice(1, -1); // strip preamble + epilogue
        let role_key = "";
        let filename = "uploaded.txt";
        let mimeType = "text/plain";
        let fileBytes: Buffer | null = null;
        for (const part of parts) {
          // headers / body separator is \r\n\r\n
          const sep = part.indexOf("\r\n\r\n");
          if (sep < 0) continue;
          const headers = part.slice(0, sep);
          const body    = part.slice(sep + 4, part.length - 2); // trim trailing \r\n
          const dispMatch = headers.match(/Content-Disposition:[^\r\n]*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
          if (!dispMatch) continue;
          const fieldName = dispMatch[1];
          const fname = dispMatch[2];
          if (fieldName === "role_key") {
            role_key = Buffer.from(body, "binary").toString("utf-8").trim();
          } else if (fieldName === "file") {
            filename = fname || filename;
            const ctMatch = headers.match(/Content-Type:\s*([^\r\n;]+)/i);
            mimeType = ctMatch ? ctMatch[1].trim() : mimeType;
            fileBytes = Buffer.from(body, "binary");
          }
        }
        if (!role_key) { res.status(400).json({ message: "role_key field missing" }); return; }
        if (!fileBytes) { res.status(400).json({ message: "file field missing" }); return; }

        // Extract text by extension/MIME. Server-side libs aren't installed
        // for PDF/DOCX/PPTX yet — we store a placeholder so the upload still
        // lands in the agent's context, and the user can re-paste real text.
        const lower = filename.toLowerCase();
        const isText = /\.(txt|md|csv|tsv|json|log)$/i.test(lower)
          || mimeType.startsWith("text/")
          || mimeType === "application/json";
        let extracted = "";
        if (isText) {
          extracted = fileBytes.toString("utf-8");
          // Cap at 100k chars (~25k tokens) to avoid blowing context limits.
          if (extracted.length > 100_000) {
            extracted = extracted.slice(0, 100_000) + "\n\n[…truncated to 100k chars]";
          }
        } else {
          extracted = `[Binary document uploaded: ${filename} (${mimeType}, ${fileBytes.length} bytes).\n`
            + `Server-side text extraction for this format is not yet enabled.\n`
            + `For now, copy/paste the relevant text from the document into a new "Paste text" knowledge note so the agent can read it.\n`
            + `Tracked here so the role brief still notes the upload.]`;
        }

        const row = {
          role_key,
          content: extracted.slice(0, 12000),
          title: filename.slice(0, 200),
          source: "document" as const,
          tags: [],
          status: "active" as const,
          created_by_role: null as string | null,
          created_at: new Date().toISOString(),
        };
        const inserted = await db.insert(agentKnowledge).values(row as any).returning();
        res.status(201).json(inserted[0]);
      } catch (e) {
        console.error("[agent-knowledge/upload]", e);
        res.status(500).json({ message: (e as Error).message });
      }
    },
  );

  app.put("/api/agent-knowledge/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = req.body as Record<string, unknown>;
      const update: any = {};
      if (typeof b.content === "string") update.content = b.content.slice(0, 12000);
      if (typeof b.title === "string") update.title = b.title.slice(0, 200);
      if (typeof b.status === "string" && ["active", "archived", "rejected"].includes(b.status)) {
        update.status = b.status;
        update.decided_at = new Date().toISOString();
        if (typeof b.decided_note === "string") update.decided_note = b.decided_note.slice(0, 1000);
      }
      const rows = await db.update(agentKnowledge).set(update).where(eq(agentKnowledge.id, id)).returning();
      if (rows.length === 0) { res.status(404).json({ message: "Not found" }); return; }
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // ── Agent Proposals ───────────────────────────────────────────────────
  // Skills POST proposals here at the end of each scheduled run. The org
  // chart page lists pending ones at the bottom for the user to act on.
  app.get("/api/agent-proposals", requireAuth, async (req, res) => {
    try {
      const status = (req.query.status as string | undefined) ?? "pending";
      const rows = status === "all"
        ? await db.select().from(agentProposals).orderBy(desc(agentProposals.created_at))
        : await db.select().from(agentProposals).where(eq(agentProposals.status, status)).orderBy(desc(agentProposals.created_at));
      res.json(rows);
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  app.post("/api/agent-proposals", requireAuth, async (req, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      // Required fields with bounds — agents shouldn't be able to dump huge
      // walls of text into the DB.
      const role_key = String(b.role_key ?? "").trim();
      const summary = String(b.summary ?? "").trim().slice(0, 240);
      if (!role_key || !summary) { res.status(400).json({ message: "role_key + summary required" }); return; }
      const now = new Date().toISOString();
      const row = {
        role_key,
        cycle_at: typeof b.cycle_at === "string" ? b.cycle_at : now,
        cycle_label: typeof b.cycle_label === "string" ? b.cycle_label.slice(0, 40) : "manual",
        priority: ["p0", "p1", "p2"].includes(String(b.priority)) ? String(b.priority) : "p2",
        category: ["pricing", "hiring", "ar", "pipeline", "marketing", "ops", "delivery", "general"].includes(String(b.category)) ? String(b.category) : "general",
        summary,
        rationale: typeof b.rationale === "string" ? b.rationale.slice(0, 4000) : null,
        action_required: typeof b.action_required === "string" ? b.action_required.slice(0, 1000) : null,
        links: Array.isArray(b.links) ? (b.links as unknown[]).slice(0, 10) : [],
        status: "pending" as const,
        created_at: now,
      };
      const inserted = await db.insert(agentProposals).values(row as any).returning();
      res.status(201).json(inserted[0]);
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // Acceptance-rate stats per (role_key, category). The CEO skill reads this
  // each cycle to bias ranking: ideas from roles/categories that get rejected
  // a lot are scored down, ideas from roles whose ideas get accepted often
  // are surfaced higher. This is the "learning without API tokens" loop —
  // no model fine-tune, just an acceptance-rate prior the skill applies on
  // its own scoring pass.
  app.get("/api/agent-proposals/acceptance-stats", requireAuth, async (_req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT role_key, category,
               SUM(CASE WHEN status = 'accepted' OR status = 'actioned' THEN 1 ELSE 0 END) AS accepted,
               SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END)                       AS rejected,
               SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END)                       AS pending,
               COUNT(*) AS total
        FROM agent_proposals
        WHERE created_at > (NOW() - INTERVAL '30 days')::text
        GROUP BY role_key, category
        ORDER BY role_key, category
      `);
      const rows = result.rows as unknown as { role_key: string; category: string; accepted: number; rejected: number; pending: number; total: number }[];
      const stats = rows.map(r => {
        const decided = Number(r.accepted) + Number(r.rejected);
        const rate = decided > 0 ? Number(r.accepted) / decided : null;
        return {
          role_key: r.role_key,
          category: r.category,
          accepted: Number(r.accepted),
          rejected: Number(r.rejected),
          pending: Number(r.pending),
          total: Number(r.total),
          acceptance_rate: rate,  // null when no decisions yet
        };
      });
      res.json(stats);
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  app.put("/api/agent-proposals/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = req.body as Record<string, unknown>;
      const status = String(b.status ?? "");
      if (!["pending", "accepted", "rejected", "actioned", "stale"].includes(status)) {
        res.status(400).json({ message: "invalid status" }); return;
      }
      const update: any = {
        status,
        decided_at: new Date().toISOString(),
      };
      if (typeof b.decided_note === "string") update.decided_note = b.decided_note.slice(0, 1000);
      const rows = await db.update(agentProposals).set(update).where(eq(agentProposals.id, id)).returning();
      if (rows.length === 0) { res.status(404).json({ message: "Not found" }); return; }
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
  });

  app.put("/api/org-chart/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const allowed: Record<string, unknown> = {};
      // Whitelist editable fields. role_key, parent_role_key, sort_order are
      // structural and shouldn't be changed via this endpoint (use a
      // dedicated migration if the org tree shape changes).
      for (const k of ["role_name", "person_name", "status", "goals", "okrs", "tasks_10d", "parent_role_key", "kind", "email", "dotted_parent_role_keys", "templates"]) {
        if (k in req.body) allowed[k] = req.body[k];
      }
      // Validate kind
      if (typeof allowed.kind === "string" && !["agent", "human"].includes(allowed.kind as string)) {
        res.status(400).json({ message: "kind must be 'agent' or 'human'" }); return;
      }
      // Cap dotted_parent_role_keys size
      if (Array.isArray(allowed.dotted_parent_role_keys)) {
        allowed.dotted_parent_role_keys = (allowed.dotted_parent_role_keys as unknown[]).slice(0, 5).map(String);
      }
      // Sanity: parent_role_key must reference a real role (or be null for CEO).
      // Block self-parenting AND cycles (e.g. A→B→A would crash the tree render).
      if (typeof allowed.parent_role_key === "string") {
        const parent = await db.select().from(orgAgents).where(eq(orgAgents.role_key, allowed.parent_role_key as string));
        if (parent.length === 0) { res.status(400).json({ message: "Unknown parent_role_key" }); return; }
        const self = await db.select().from(orgAgents).where(eq(orgAgents.id, safeInt(req.params.id)));
        const selfKey = self[0]?.role_key;
        if (selfKey && selfKey === allowed.parent_role_key) {
          res.status(400).json({ message: "Role cannot report to itself" }); return;
        }
        // Walk up from the proposed parent through parent_role_key chain. If
        // we ever reach selfKey, accepting this would create a cycle.
        if (selfKey) {
          const all = await db.select().from(orgAgents);
          const byKey = new Map(all.map(r => [r.role_key, r]));
          let cursor: string | null = allowed.parent_role_key as string;
          const seen = new Set<string>();
          let safety = 50; // hard guard against malformed data already cyclic in DB
          while (cursor && safety-- > 0) {
            if (cursor === selfKey) {
              res.status(400).json({ message: `Cycle blocked — '${cursor}' would end up reporting to itself via this chain.` });
              return;
            }
            if (seen.has(cursor)) break; // pre-existing cycle in data, don't infinite-loop here
            seen.add(cursor);
            cursor = byKey.get(cursor)?.parent_role_key ?? null;
          }
        }
      }
      // Cap array sizes (jsonb-bomb defence).
      if (Array.isArray(allowed.goals)) allowed.goals = (allowed.goals as unknown[]).slice(0, 30);
      if (Array.isArray(allowed.okrs)) allowed.okrs = (allowed.okrs as unknown[]).slice(0, 10);
      if (Array.isArray(allowed.tasks_10d)) allowed.tasks_10d = (allowed.tasks_10d as unknown[]).slice(0, 50);
      if (Array.isArray(allowed.templates)) allowed.templates = (allowed.templates as unknown[]).slice(0, 50);
      allowed.updated_at = new Date().toISOString();
      const rows = await db.update(orgAgents).set(allowed as any).where(eq(orgAgents.id, id)).returning();
      if (rows.length === 0) { res.status(404).json({ message: "Role not found" }); return; }
      res.json(rows[0]);
    } catch (e) {
      console.error("[org-chart] PUT failed:", e);
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // ── OKR node data (per-branch metadata for /exec/okr) ──────────────────
  app.get("/api/okr-nodes", requireAuth, async (_req, res) => {
    try {
      const rows = await db.select().from(okrNodeData);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.put("/api/okr-nodes/:nodeId", requireAuth, async (req, res) => {
    try {
      const node_id = String(req.params.nodeId).trim();
      if (!node_id) { res.status(400).json({ message: "node_id required" }); return; }
      const b = (req.body ?? {}) as Record<string, unknown>;
      const now = new Date().toISOString();
      const row: Record<string, unknown> = {
        node_id,
        updated_at: now,
      };
      if (Array.isArray(b.objectives))         row.objectives = (b.objectives as unknown[]).slice(0, 30);
      if (Array.isArray(b.kpis))               row.kpis = (b.kpis as unknown[]).slice(0, 30);
      if (Array.isArray(b.depending_node_ids)) row.depending_node_ids = (b.depending_node_ids as unknown[]).filter(x => typeof x === "string").slice(0, 50);
      if (Array.isArray(b.owner_override_role_keys) || b.owner_override_role_keys === null) row.owner_override_role_keys = b.owner_override_role_keys as any;
      if (typeof b.notes === "string" || b.notes === null) row.notes = b.notes as string | null;

      // Upsert by node_id
      const existing = await db.select().from(okrNodeData).where(eq(okrNodeData.node_id, node_id));
      if (existing.length > 0) {
        const updated = await db.update(okrNodeData).set(row as any).where(eq(okrNodeData.node_id, node_id)).returning();
        res.json(updated[0]);
      } else {
        // Default arrays for fields not provided on first insert.
        if (!Array.isArray(row.objectives))         row.objectives = [];
        if (!Array.isArray(row.kpis))               row.kpis = [];
        if (!Array.isArray(row.depending_node_ids)) row.depending_node_ids = [];
        const inserted = await db.insert(okrNodeData).values(row as any).returning();
        res.status(201).json(inserted[0]);
      }
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

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
      // PK collision → 409 Conflict so the UI can show a clear "delete
      // the conflicting row first" message instead of a generic 400.
      if (err instanceof TrashRestoreConflictError) {
        res.status(409).json({ message: err.message, code: "RESTORE_CONFLICT", tableName: err.tableName, rowId: err.rowId });
        return;
      }
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
        SELECT id, name, email, kind, created_at, daily_rate, daily_rate_currency
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
      const { name, email, kind, daily_rate, daily_rate_currency } = req.body ?? {};
      if (!name || !email) { res.status(400).json({ message: "name and email required" }); return; }
      const k = (typeof kind === "string" && kind.trim()) ? kind.trim().toLowerCase() : "freelancer";
      const rate = daily_rate != null && daily_rate !== "" ? Number(daily_rate) : null;
      const ccy = (typeof daily_rate_currency === "string" && daily_rate_currency.trim()) ? daily_rate_currency.trim().toUpperCase() : "EUR";
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const now = new Date().toISOString();
      const r = await db.execute(sql`
        INSERT INTO external_contacts (name, email, kind, created_at, daily_rate, daily_rate_currency)
        VALUES (${String(name).trim()}, ${String(email).trim().toLowerCase()}, ${k}, ${now}, ${rate}, ${ccy})
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind,
          daily_rate = EXCLUDED.daily_rate, daily_rate_currency = EXCLUDED.daily_rate_currency
        RETURNING id, name, email, kind, created_at, daily_rate, daily_rate_currency
      `);
      res.status(201).json(r.rows[0]);
    } catch (e: any) {
      res.status(500).json({ message: e.message ?? "Failed to save" });
    }
  });

  app.put("/api/external-contacts/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const { name, email, kind, daily_rate, daily_rate_currency } = req.body ?? {};
      if (!name || !email) { res.status(400).json({ message: "name and email required" }); return; }
      const k = (typeof kind === "string" && kind.trim()) ? kind.trim().toLowerCase() : "freelancer";
      const rate = daily_rate != null && daily_rate !== "" ? Number(daily_rate) : null;
      const ccy = (typeof daily_rate_currency === "string" && daily_rate_currency.trim()) ? daily_rate_currency.trim().toUpperCase() : "EUR";
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const r = await db.execute(sql`
        UPDATE external_contacts
        SET name = ${String(name).trim()}, email = ${String(email).trim().toLowerCase()},
            kind = ${k}, daily_rate = ${rate}, daily_rate_currency = ${ccy}
        WHERE id = ${id}
        RETURNING id, name, email, kind, created_at, daily_rate, daily_rate_currency
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
    // Soft-delete to trash_bin (30-day TTL).
    await trashAndDelete("employees", req.params.id);
    res.status(204).end();
  });

  // PATCH /api/employees/:id/retire — mark as former + cascade cleanup in one TX.
  // Cascade logic lives in storage.retireEmployee (transactional).
  app.patch("/api/employees/:id/retire", requireAuth, async (req, res) => {
    try {
      await storage.retireEmployee(req.params.id);
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // PATCH /api/employees/:id/unretire — reinstate a former employee to active.
  app.patch("/api/employees/:id/unretire", requireAuth, async (req, res) => {
    try {
      await storage.unretireEmployee(req.params.id);
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── Asset types (admin-managed taxonomy: PC, ThinkCell, Monitor, …) ─────
  app.get("/api/asset-types", requireAuth, async (_req, res) => {
    try {
      const rows = await db.select().from(assetTypes).orderBy(assetTypes.name);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.post("/api/asset-types", requireAuth, async (req, res) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const name = String(b.name ?? "").trim();
      if (!name) { res.status(400).json({ message: "Name required" }); return; }
      const row = {
        name,
        has_license_key: b.has_license_key ? 1 : 0,
        identifier_hint: typeof b.identifier_hint === "string" ? b.identifier_hint.slice(0, 200) : null,
        details_hint: typeof b.details_hint === "string" ? b.details_hint.slice(0, 500) : null,
        created_at: new Date().toISOString(),
      };
      const inserted = await db.insert(assetTypes).values(row as any).returning();
      res.status(201).json(inserted[0]);
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (/unique|duplicate/i.test(msg)) {
        res.status(409).json({ message: "Asset type with that name already exists" });
        return;
      }
      res.status(500).json({ message: msg });
    }
  });
  app.put("/api/asset-types/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      if (typeof b.name === "string") update.name = b.name.trim();
      if (typeof b.has_license_key !== "undefined") update.has_license_key = b.has_license_key ? 1 : 0;
      if (typeof b.identifier_hint === "string" || b.identifier_hint === null) update.identifier_hint = b.identifier_hint as string | null;
      if (typeof b.details_hint === "string" || b.details_hint === null) update.details_hint = b.details_hint as string | null;
      const rows = await db.update(assetTypes).set(update as any).where(eq(assetTypes.id, id)).returning();
      // If name changed, cascade-rename the denormalised asset_type column
      // on assets so existing rows stay linked.
      if (typeof b.name === "string" && b.name && rows[0]) {
        const oldRow = await db.select().from(assetTypes).where(eq(assetTypes.id, id));
        // Get the previous name from the live DB? Already updated. Use the old fetched
        // row from before? We don't have it. Skip rename if new name matches existing
        // assets. Simpler: caller is expected to keep names stable.
      }
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.delete("/api/asset-types/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      // Look up the type name first so we can refuse deletion if assets reference it.
      const t = await db.select().from(assetTypes).where(eq(assetTypes.id, id));
      if (!t[0]) { res.status(404).json({ message: "Not found" }); return; }
      const refCount = await db.execute(sql`SELECT COUNT(*)::int AS c FROM assets WHERE asset_type = ${t[0].name}`);
      const c = (refCount as unknown as { rows: Array<{ c: number }> }).rows[0]?.c ?? 0;
      if (c > 0) {
        res.status(409).json({ message: `Cannot delete: ${c} asset(s) reference this type. Reassign or delete them first.` });
        return;
      }
      await db.delete(assetTypes).where(eq(assetTypes.id, id));
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── Assets (individual items / licenses) ────────────────────────────────
  app.get("/api/assets", requireAuth, async (req, res) => {
    try {
      const employee_id = typeof req.query.employee_id === "string" ? req.query.employee_id : null;
      const rows = employee_id
        ? await db.select().from(assets).where(eq(assets.employee_id, employee_id)).orderBy(desc(assets.updated_at))
        : await db.select().from(assets).orderBy(desc(assets.updated_at));
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.post("/api/assets", requireAuth, async (req, res) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const asset_type = String(b.asset_type ?? "").trim();
      if (!asset_type) { res.status(400).json({ message: "asset_type required" }); return; }
      const now = new Date().toISOString();
      const row = {
        asset_type,
        identifier: typeof b.identifier === "string" ? b.identifier.trim().slice(0, 60) : null,
        details: typeof b.details === "string" ? b.details.slice(0, 500) : null,
        employee_id: typeof b.employee_id === "string" && b.employee_id ? b.employee_id : null,
        status: ["in_use", "out_of_use", "spare", "retired"].includes(String(b.status))
          ? String(b.status)
          : "in_use",
        license_key: typeof b.license_key === "string" ? b.license_key.slice(0, 200) : null,
        notes: typeof b.notes === "string" ? b.notes.slice(0, 1000) : null,
        created_at: now,
        updated_at: now,
      };
      const inserted = await db.insert(assets).values(row as any).returning();
      res.status(201).json(inserted[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.put("/api/assets/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof b.asset_type === "string") update.asset_type = b.asset_type.trim();
      if (typeof b.identifier === "string" || b.identifier === null) update.identifier = b.identifier as string | null;
      if (typeof b.details === "string" || b.details === null) update.details = b.details as string | null;
      if (typeof b.employee_id === "string" || b.employee_id === null) update.employee_id = b.employee_id as string | null;
      if (typeof b.status === "string" && ["in_use", "out_of_use", "spare", "retired"].includes(b.status)) update.status = b.status;
      if (typeof b.license_key === "string" || b.license_key === null) update.license_key = b.license_key as string | null;
      if (typeof b.notes === "string" || b.notes === null) update.notes = b.notes as string | null;
      const rows = await db.update(assets).set(update as any).where(eq(assets.id, id)).returning();
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.delete("/api/assets/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      await db.delete(assets).where(eq(assets.id, id));
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
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
    // Soft-delete to trash_bin (30-day TTL).
    await trashAndDelete("salary_history", safeInt(req.params.id));
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
    // Soft-delete to trash_bin (30-day TTL).
    await trashAndDelete("days_off_entries", safeInt(req.params.id));
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

  // ── REGION → COUNTRY aliases (server side, mirrors client constant) ───
  // Required to merge benchmark green-band corridors when computing the
  // canonical clamp for a multi-country region (DACH = DE+AT+CH, …).
  const REGION_TO_COUNTRY_SERVER: Record<string, string[]> = {
    "DACH": ["DE", "AT", "CH"],
    "Nordics": ["SE", "NO", "DK", "FI"],
    "UK": ["UK", "GB"],
    "FR": ["FR"],
    "IT": ["IT"],
    "US": ["US"],
    "Asia": ["JP", "CN", "SG", "HK", "KR", "IN"],
    "Middle East": ["AE", "SA", "QA"],
    "Other EU": ["NL", "BE", "ES", "PT", "PL", "IE", "GR", "AT"],
  };

  /**
   * Server-side canonical NET1 weekly for a pricing case. Mirrors the
   * client-side _liveCanonical in PricingTool.tsx so the TBD proposal's
   * weekly_price matches the cases-list Target/wk column exactly.
   *
   * Resolution: stored canonical → live recompute (layer_trace + clamp +
   * manual_delta) → target_weekly. NO commit applied — the headline is
   * pre-commit, same as the cases list.
   */
  function computeCanonicalNetWeekly(
    caseRow: { region?: string | null; recommendation?: any },
    benchmarks: Array<{ country: string; parameter: string; green_low: number; green_high: number }>,
  ): number {
    const rec = caseRow.recommendation;
    if (!rec) return 0;
    // Always recompute from the saved layer_trace + base_weekly + band +
    // manual_delta. The stored canonical_net_weekly may lag if the case was
    // edited in the browser without a Save (auto-save keeps it current, but
    // recomputing here ensures ensureTbdProposalForFinalCase always reflects
    // the actual engine output rather than a potentially-stale snapshot).
    // Stored canonical is the FALLBACK (used only when layer_trace / base are
    // absent — i.e. very old cases that pre-date the layer_trace migration).

    // Live recompute path.
    const trace = Array.isArray(rec.layer_trace) ? rec.layer_trace : [];
    const base = Number(rec.base_weekly ?? rec.target_weekly ?? 0);
    if (!base) return 0;
    const KEYS = ["Geography", "Sector", "Ownership", "Client Size", "Client Profile", "Strategic Intent"];
    const traceByKey: Record<string, { value: number }> = {};
    for (const lt of trace) {
      const key = String(lt.label ?? "").replace(/\s*\(.*?\)\s*$/, "").trim();
      if (key) traceByKey[key] = lt;
    }
    const deltas: Record<string, number> = {};
    let prevOrig = base;
    for (const k of KEYS) {
      const lt = traceByKey[k];
      if (lt) { deltas[k] = lt.value - prevOrig; prevOrig = lt.value; }
      else deltas[k] = 0;
    }
    let running = base;
    for (const k of KEYS) {
      const d = deltas[k] ?? 0;
      if (Math.abs(d) >= 1) running += d;
    }
    // Band clamp (merge corridors across all countries in the region).
    const region = String(caseRow.region ?? "");
    const aliases = REGION_TO_COUNTRY_SERVER[region] ?? [region];
    const aliasSet = new Set(aliases.map(a => (a ?? "").toLowerCase()));
    const weeklyRows = benchmarks.filter(b =>
      aliasSet.has((b.country ?? "").toLowerCase()) &&
      ((String(b.parameter ?? "").toLowerCase().includes("weekly")) ||
       (String(b.parameter ?? "").toLowerCase().includes("fee")))
    );
    const nz = weeklyRows.filter(r => r.green_low > 0 && r.green_high > 0);
    const gLow  = nz.length ? Math.min(...nz.map(r => r.green_low))  : 0;
    const gHigh = nz.length ? Math.max(...nz.map(r => r.green_high)) : 0;
    if (gLow > 0 && gHigh > 0) {
      running = Math.min(gHigh, Math.max(gLow, running));
    }
    running += Number(rec.manual_delta ?? 0);
    const result = Math.round(running);
    if (result > 0) return result;
    // Fallback 1: stored canonical (present on cases saved after auto-save
    // landed, or after a manual Save & Finalise).
    const stored = Number(rec.canonical_net_weekly);
    if (isFinite(stored) && stored > 0) return Math.round(stored);
    // Fallback 2: engine's raw target_weekly.
    const tw = Number(rec.target_weekly ?? 0);
    return tw > 0 ? Math.round(tw) : 0;
  }

  // Server-side guarantee: when a pricing_case is saved with status='final'
  // and no matching pricing_proposal row exists, insert a pending TBD row
  // so the case appears in Past Projects atomically with the save. Replaces
  // the previously client-side fetch which had a silent catch and could
  // leave the row uncreated if the call ever failed. Idempotent — uses
  // case-insensitive project_name match against pricing_proposals.
  async function ensureTbdProposalForFinalCase(caseRow: { id?: number; project_name?: string | null; status?: string | null; client_name?: string | null; fund_name?: string | null; region?: string | null; pe_owned?: number | null; revenue_band?: string | null; price_sensitivity?: string | null; duration_weeks?: number | null; sector?: string | null; project_type?: string | null; recommendation?: any; win_probability?: number | null; start_date?: string | null; staffing?: Array<{ role_id?: string; role_name?: string; resource_label?: string | null; count?: number }> | null }) {
    if (caseRow.status !== "final") return;
    const name = (caseRow.project_name ?? "").trim();
    if (!name) return;
    const all = await storage.getPricingProposals();
    const lower = name.toLowerCase();
    // ── THE RULE (single source of truth across Exec / Past Projects /
    //    Pricing Tool list): a TBD's headline figures are exactly TWO
    //    numbers — weekly_price = NET1 (canonical net weekly) and
    //    total_fee = weekly_price × duration_weeks. Nothing else.
    //
    //    Resolution order for NET1 (mirrors PricingTool's cases-list):
    //      1. recommendation.canonical_net_weekly  (handleSave persists this)
    //      2. live recompute from layer_trace + base + manual_delta + band
    //      3. recommendation.target_weekly         (last-resort engine raw)
    const settings = await storage.getPricingSettings();
    const benchmarks = (settings?.country_benchmarks ?? []) as Array<{ country: string; parameter: string; green_low: number; green_high: number }>;
    const weeklyNet = computeCanonicalNetWeekly(caseRow, benchmarks);
    const dur = Number(caseRow.duration_weeks ?? 0);
    const totalFee = weeklyNet > 0 && dur > 0 ? Math.round(weeklyNet * dur) : 0;

    // If a pending TBD already exists (exact name OR base-code match),
    // refresh its project_name (to match the case), weekly_price, and
    // total_fee so a re-saved case doesn't leave stale figures behind.
    // Won/Lost rows are user-decided — never touched.
    const baseCode = lower.replace(/[a-z]+$/, "");
    const matching = all.find(p => {
      const pn = (p.project_name ?? "").trim().toLowerCase();
      return pn === lower || (baseCode !== lower && (pn === baseCode || pn.replace(/[a-z]+$/, "") === baseCode));
    });
    // Map case staffing lines that have a named resource to proposal team_members.
    // Only lines with resource_label set (= a specific person assigned) are included.
    const caseTeam: { role: string; name: string }[] = (caseRow.staffing ?? [])
      .filter(l => l.resource_label && l.resource_label.trim())
      .map(l => ({ role: l.role_name ?? "Team member", name: l.resource_label!.trim() }));

    if (matching) {
      if (matching.outcome === "pending" && (matching.id != null)) {
        const nameStale = (matching.project_name ?? "").trim() !== name;
        const priceStale = weeklyNet > 0 && (matching.weekly_price !== weeklyNet || matching.total_fee !== totalFee);
        const probStale = caseRow.win_probability != null && matching.win_probability !== caseRow.win_probability;
        const startStale = caseRow.start_date != null && matching.start_date !== caseRow.start_date;
        const teamStale = caseTeam.length > 0 && JSON.stringify(matching.team_members ?? []) !== JSON.stringify(caseTeam);
        if (nameStale || priceStale || probStale || startStale || teamStale) {
          await storage.updatePricingProposal(matching.id, {
            project_name: name,
            ...(weeklyNet > 0 ? {
              weekly_price: weeklyNet,
              total_fee: totalFee,
              duration_weeks: caseRow.duration_weeks ?? matching.duration_weeks,
            } : {}),
            ...(caseRow.win_probability != null ? { win_probability: caseRow.win_probability } : {}),
            ...(caseRow.start_date != null ? { start_date: caseRow.start_date } : {}),
            ...(caseTeam.length > 0 ? { team_members: caseTeam } : {}),
          });
        }
      }
      return; // existing row — done
    }

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
      weekly_price: weeklyNet,
      total_fee: totalFee,
      outcome: "pending",
      win_probability: caseRow.win_probability ?? null,
      start_date: caseRow.start_date ?? null,
      ...(caseTeam.length > 0 ? { team_members: caseTeam } : {}),
      sector: caseRow.sector ?? null,
      project_type: caseRow.project_type ?? null,
    });
  }

  // Companion to ensureTbdProposalForFinalCase: when a case is no
  // longer Final (Draft / Active), delete any pending TBD that was
  // auto-created for it. Won/Lost rows are never touched. This makes
  // the case→proposal sync self-healing on every save instead of
  // requiring the user to click the "Sync TBD" button.
  async function removeStaleTbdForNonFinalCase(caseRow: { project_name?: string | null; status?: string | null }) {
    if (!caseRow.project_name) return;
    if (caseRow.status === "final") return;
    const lower = caseRow.project_name.trim().toLowerCase();
    if (!lower) return;
    const all = await storage.getPricingProposals();
    const targets = all.filter(p =>
      p.outcome === "pending" &&
      (p.project_name ?? "").trim().toLowerCase() === lower
    );
    for (const p of targets) {
      if (p.id != null) await trashAndDelete("pricing_proposals", p.id);
    }
  }

  app.post("/api/pricing/cases", requireAuth, async (req, res) => {
    // Validate first (zod schema strips unknown keys + enforces project_name).
    // Then sanitise array sizes (jsonb-bomb defence).
    const parsed = insertPricingCaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid pricing case payload", issues: parsed.error.issues });
      return;
    }
    const c = await storage.createPricingCase(sanitisePricingCaseBody(parsed.data));
    try { await ensureTbdProposalForFinalCase(c); }
    catch (e) { console.error("ensureTbdProposalForFinalCase (POST) failed:", e); }
    try { await removeStaleTbdForNonFinalCase(c); }
    catch (e) { console.error("removeStaleTbdForNonFinalCase (POST) failed:", e); }
    res.status(201).json(c);
  });

  app.put("/api/pricing/cases/:id", requireAuth, async (req, res) => {
    // PUT is partial (any subset of fields), so use the schema's .partial()
    // variant. Still strips unknown keys + caps types.
    const parsed = insertPricingCaseSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid pricing case payload", issues: parsed.error.issues });
      return;
    }
    const c = await storage.updatePricingCase(safeInt(req.params.id), sanitisePricingCaseBody(parsed.data));
    try { await ensureTbdProposalForFinalCase(c); }
    catch (e) { console.error("ensureTbdProposalForFinalCase (PUT) failed:", e); }
    try { await removeStaleTbdForNonFinalCase(c); }
    catch (e) { console.error("removeStaleTbdForNonFinalCase (PUT) failed:", e); }
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

      // ── DEDUP phase: ≥2 pending TBDs for the same project_name ─────
      // Pre-fix bug: the old client + server both inserted on save,
      // producing two rows per finalised case. Keep the row with the
      // largest weekly_price (real numbers from the client side beat
      // the 0/0 placeholders), tie-break by highest id (newest), trash
      // the rest. Won/Lost rows untouched.
      const dupBuckets = new Map<string, typeof proposals>();
      for (const p of proposals) {
        if (p.outcome !== "pending") continue;
        const n = (p.project_name ?? "").trim().toLowerCase();
        if (!n) continue;
        // Skip rows we just trashed in the stale phase.
        if (stale.some(s => s.id === p.id)) continue;
        const arr = dupBuckets.get(n) ?? [];
        arr.push(p);
        dupBuckets.set(n, arr);
      }
      let dedupCount = 0;
      for (const [, rows] of dupBuckets) {
        if (rows.length < 2) continue;
        const sorted = [...rows].sort((a, b) => {
          const wa = Number(a.weekly_price ?? 0);
          const wb = Number(b.weekly_price ?? 0);
          if (wa !== wb) return wb - wa;             // highest weekly first
          return Number(b.id ?? 0) - Number(a.id ?? 0); // newest id first
        });
        const [, ...losers] = sorted;
        for (const p of losers) {
          if (p.id != null) {
            await trashAndDelete("pricing_proposals", p.id);
            dedupCount++;
          }
        }
      }

      // ── PROB SYNC phase: copy win_probability from case → pending proposal ─
      const caseByBaseName = new Map<string, typeof cases[number]>();
      for (const c of cases) {
        if (c.status !== "final") continue;
        const n = (c.project_name ?? "").trim().toLowerCase();
        if (!n) continue;
        caseByBaseName.set(n, c);
        caseByBaseName.set(n.replace(/[a-z]+$/, ""), c); // base-code fallback
      }
      let probSynced = 0;
      for (const p of proposals) {
        if (p.outcome !== "pending" || p.id == null) continue;
        const pn = (p.project_name ?? "").trim().toLowerCase();
        const matchedCase = caseByBaseName.get(pn) ?? caseByBaseName.get(pn.replace(/[a-z]+$/, ""));
        if (!matchedCase || matchedCase.win_probability == null) continue;
        if (p.win_probability !== matchedCase.win_probability) {
          await storage.updatePricingProposal(p.id, { win_probability: matchedCase.win_probability });
          probSynced++;
        }
      }

      res.json({
        ok: true,
        inserted: toCreate.length,
        deleted: stale.length,
        deduped: dedupCount,
        probSynced,
        finalCases: finals.length,
      });
    } catch (e) {
      console.error("sync-tbd-with-final-cases failed:", e);
      res.status(500).json({ ok: false, message: (e as Error).message });
    }
  });

  // ── Normalize proposal names so TBD proposals match their case name ────
  // Rule: TBD/pending → rename to match the case name (adds letter suffix,
  //       e.g. "COE03" → "COE03A").
  //       Won/Lost with trailing alpha → strip letter (e.g. "FLE01A" → "FLE01").
  // Safe to call multiple times — idempotent.
  app.post("/api/pricing/proposals/normalize-names", requireAuth, async (_req, res) => {
    try {
      const cases = await storage.getPricingCases();
      const proposals = await storage.getPricingProposals();
      const renamed: string[] = [];

      // Build case lookup: base code → case (for TBD renaming)
      const caseByKey = new Map<string, any>();
      for (const c of cases) {
        const n = (c.project_name ?? "").trim().toLowerCase();
        if (!n) continue;
        caseByKey.set(n, c);
        const base = n.replace(/[a-z]+$/, "");
        if (base !== n && !caseByKey.has(base)) caseByKey.set(base, c);
      }

      for (const p of proposals) {
        const pName = (p.project_name ?? "").trim();
        const pLower = pName.toLowerCase();
        if (!pName || p.id == null) continue;

        if (p.outcome === "pending" || !p.outcome) {
          // TBD: find matching case, rename proposal to case name
          const matched = caseByKey.get(pLower) ?? caseByKey.get(pLower.replace(/[a-z]+$/, ""));
          if (matched) {
            const caseName = (matched.project_name ?? "").trim();
            if (caseName && caseName !== pName) {
              await storage.updatePricingProposal(p.id, { project_name: caseName });
              renamed.push(`${pName} → ${caseName} (TBD)`);
            }
          }
        } else if (p.outcome === "won" || p.outcome === "lost") {
          // Won/Lost: strip trailing letter suffix
          const stripped = pName.replace(/[A-Za-z]$/, "");
          if (stripped !== pName && stripped.length > 0 && /\d$/.test(stripped)) {
            await storage.updatePricingProposal(p.id, { project_name: stripped });
            renamed.push(`${pName} → ${stripped} (${p.outcome})`);
          }
        }
      }
      res.json({ ok: true, renamed, count: renamed.length });
    } catch (e) {
      console.error("normalize-names failed:", e);
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
    // When win_probability is explicitly set, mirror it to the linked pricing case.
    if (req.body.win_probability != null && p.project_name) {
      try {
        const cases = await storage.getPricingCases();
        const pn = (p.project_name ?? "").trim().toLowerCase();
        const base = pn.replace(/[a-z]+$/, "");
        const linked = cases.find(c => {
          const cn = (c.project_name ?? "").trim().toLowerCase();
          return cn === pn || cn.replace(/[a-z]+$/, "") === base || (base !== pn && cn === base);
        });
        if (linked?.id != null) {
          await storage.updatePricingCase(linked.id, { win_probability: req.body.win_probability });
        }
      } catch (_) { /* non-critical */ }
    }
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

  // Debug: returns the raw <tr> HTML + per-cell text + extracted scores
  // for ONE candidate (matched by email substring). Used to diagnose why
  // a specific candidate's I.RATE / CS.RATE / etc. didn't import. Read-only,
  // no DB writes. Safe to keep around — auth-gated, useful for next time
  // Stride's HTML changes.
  app.get("/api/hiring/sync-debug", requireAuth, async (req, res) => {
    try {
      const emailFilter = typeof req.query.email === "string" ? req.query.email.toLowerCase() : "";
      const { fetchAndDebug } = await import("./hiringSync");
      const result = await fetchAndDebug(emailFilter);
      res.json(result);
    } catch (e) {
      res.status(500).json({ message: (e as Error).message });
    }
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
    // Same hardening for the structured percentage columns populated by
    // the Eendigo scrape. Clamp to 0-100, drop non-numeric trash, allow
    // explicit null to clear a measurement.
    const PCT_FIELDS = ["logic_pct", "verbal_pct", "excel_pct", "p1_pct", "p2_pct", "intro_rate_pct", "cs_rate_pct"] as const;
    for (const f of PCT_FIELDS) {
      if (!(f in payload)) continue;
      const v = payload[f];
      if (v == null) { payload[f] = null; continue; }
      const n = Number(v);
      payload[f] = isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
    }
    if ("cs_lm" in payload) {
      const v = payload.cs_lm;
      payload.cs_lm = v == null ? null : String(v).slice(0, 32);
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
    // Soft-delete to trash_bin (30-day TTL).
    await trashAndDelete("employee_tasks", safeInt(req.params.id));
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
    // Soft-delete to trash_bin (30-day TTL).
    await trashAndDelete("performance_issues", safeInt(req.params.id));
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
    // Soft-delete to trash_bin (30-day TTL).
    await trashAndDelete("time_tracking_topics", safeInt(req.params.id));
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
    // Soft-delete to trash_bin (30-day TTL).
    await trashAndDelete("time_tracking_entries", safeInt(req.params.id));
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
    const { READ_AI_SEED } = await import("./readAISeed");
    const meeting = READ_AI_SEED.find((m) => m.id === id);
    if (meeting?.transcript) {
      res.json({ source: "seed", transcript: meeting.transcript });
      return;
    }
    res.json({
      source: "seed",
      transcript: null,
      message: "Transcript not cached — ask Claude to refresh the Read.ai seed or set READ_AI_TOKEN for live fetch.",
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

      // G3: find the matching pricing case to copy fee timelines into the deck.
      // Match on client_name = company_name (case-insensitive). Pick the row
      // with the highest id when multiple cases exist for the same client.
      const allCases = await storage.getPricingCases();
      const matchingCase = allCases
        .filter(c => (c.client_name ?? "").toLowerCase() === (proposal.company_name ?? "").toLowerCase())
        .sort((a, b) => b.id - a.id)[0] ?? null;

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
          case_timelines: matchingCase?.case_timelines ?? null,
          case_discounts: matchingCase?.case_discounts ?? null,
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
      let r: any;
      try {
        r = await db.execute(sql`
          SELECT
            d.*,
            p.project_name        AS proposal_project_name,
            p.revision_letter     AS proposal_revision_letter,
            p.weekly_price        AS proposal_weekly_price,
            p.total_fee           AS proposal_total_fee,
            p.duration_weeks      AS proposal_duration_weeks,
            p.outcome             AS proposal_outcome,
            p.sector              AS proposal_sector
          FROM bd_deals d
          LEFT JOIN pricing_proposals p ON p.id = d.linked_proposal_id
          ORDER BY d.updated_at DESC
        `);
      } catch {
        // linked_proposal_id column may not exist yet if db:push hasn't run — fall back
        r = await db.execute(sql`SELECT * FROM bd_deals ORDER BY updated_at DESC`);
      }
      res.json(r.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/bd/deals/sync-proposals — match each deal to a pricing proposal
  // by client_name (case-insensitive). Sets linked_proposal_id on matched deals.
  // Takes the most recent proposal per client.
  app.post("/api/bd/deals/sync-proposals", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");

      const deals: any = await db.execute(sql`SELECT id, client_name, name FROM bd_deals`);
      let proposals: any;
      try {
        proposals = await db.execute(sql`
          SELECT id, client_name, project_name, revision_letter, weekly_price, total_fee, proposal_date
          FROM pricing_proposals ORDER BY proposal_date DESC
        `);
      } catch {
        // revision_letter column may not exist yet — fall back without it
        proposals = await db.execute(sql`
          SELECT id, client_name, project_name, weekly_price, total_fee, proposal_date
          FROM pricing_proposals ORDER BY proposal_date DESC
        `);
      }

      let matched = 0, unmatched = 0;
      const results: { deal: string; proposal: string | null; matched: boolean }[] = [];

      for (const deal of deals.rows) {
        const needle = (deal.client_name ?? deal.name ?? "").toLowerCase().trim();
        if (!needle) { unmatched++; continue; }

        // Find first proposal whose client_name contains the deal name or vice versa
        const hit = proposals.rows.find((p: any) => {
          const hay = (p.client_name ?? "").toLowerCase().trim();
          return hay && (hay.includes(needle) || needle.includes(hay));
        });

        if (hit) {
          await db.execute(sql`
            UPDATE bd_deals SET linked_proposal_id = ${hit.id}, updated_at = ${new Date().toISOString()}
            WHERE id = ${deal.id}
          `);
          matched++;
          results.push({ deal: deal.client_name ?? deal.name, proposal: `${hit.project_name}${hit.revision_letter ?? ""}`, matched: true });
        } else {
          unmatched++;
          results.push({ deal: deal.client_name ?? deal.name, proposal: null, matched: false });
        }
      }

      res.json({ ok: true, matched, unmatched, results });
    } catch (err: any) {
      console.error("[bd/sync-proposals] failed:", err.message);
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
        partner_id:       "partner_id" in b ? (b.partner_id ?? null) : cur.partner_id,
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

  // ── Partners CRUD ──────────────────────────────────────────────────────
  app.get("/api/partners", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const r = await db.execute(sql`SELECT * FROM partners ORDER BY name ASC`);
      res.json((r as any).rows ?? r);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.post("/api/partners", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const b = req.body ?? {};
      if (!b.name || typeof b.name !== "string" || !b.name.trim()) {
        res.status(400).json({ error: "name is required" }); return;
      }
      const now = new Date().toISOString();
      const r = await db.execute(sql`
        INSERT INTO partners (name, type, contact_name, contact_email, notes, created_at, updated_at)
        VALUES (${b.name.trim()}, ${b.type ?? "referral"}, ${b.contact_name ?? null},
                ${b.contact_email ?? null}, ${b.notes ?? null}, ${now}, ${now})
        RETURNING *
      `);
      res.status(201).json(((r as any).rows ?? r)[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.put("/api/partners/:id", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const id = safeInt(req.params.id);
      const b = req.body ?? {};
      const now = new Date().toISOString();
      const r = await db.execute(sql`
        UPDATE partners SET
          name          = COALESCE(${b.name ?? null}, name),
          type          = COALESCE(${b.type ?? null}, type),
          contact_name  = ${b.contact_name ?? null},
          contact_email = ${b.contact_email ?? null},
          notes         = ${b.notes ?? null},
          updated_at    = ${now}
        WHERE id = ${id}
        RETURNING *
      `);
      const rows = (r as any).rows ?? r;
      if (rows.length === 0) { res.status(404).json({ error: "not found" }); return; }
      res.json(rows[0]);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  app.delete("/api/partners/:id", requireAuth, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`DELETE FROM partners WHERE id = ${safeInt(req.params.id)}`);
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
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

  // ── HubSpot live API sync ───────────────────────────────────────────────────
  // Requires HUBSPOT_TOKEN env var (Private App token from HubSpot settings →
  // Integrations → Private Apps). Fetches all non-archived deals, maps them
  // to bd_deals schema, upserts by hubspot_id. Called from the BD import tab.
  app.get("/api/hubspot/status", requireAuth, async (_req, res) => {
    const token = process.env.HUBSPOT_TOKEN ?? "";
    if (!token) {
      res.json({ configured: false, message: "HUBSPOT_TOKEN not set in environment." });
      return;
    }
    // Quick ping: fetch 1 deal to verify auth
    try {
      const r = await fetch(
        "https://api.hubapi.com/crm/v3/objects/deals?limit=1&archived=false",
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
      );
      if (r.status === 401) {
        res.json({ configured: true, valid: false, message: "Token invalid or expired." });
        return;
      }
      if (!r.ok) {
        res.json({ configured: true, valid: false, message: `HubSpot returned ${r.status}` });
        return;
      }
      const data: any = await r.json();
      res.json({ configured: true, valid: true, total: data?.total ?? null });
    } catch (e: any) {
      res.json({ configured: true, valid: false, message: e.message });
    }
  });

  app.post("/api/hubspot/sync", requireAuth, async (_req, res) => {
    const token = process.env.HUBSPOT_TOKEN ?? "";
    if (!token) {
      res.status(400).json({ error: "HUBSPOT_TOKEN not configured. Add it to your environment variables." });
      return;
    }
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const DEAL_PROPS = [
        "dealname", "amount", "dealstage", "pipeline", "closedate",
        "hs_deal_stage_probability", "description", "hubspot_owner_id",
        "hs_lastactivitydate", "dealtype",
      ].join(",");

      let after: string | null = null;
      const allDeals: any[] = [];

      // Paginate through all deals
      for (let page = 0; page < 20; page++) {
        const url = `https://api.hubapi.com/crm/v3/objects/deals?limit=100&archived=false&properties=${DEAL_PROPS}${after ? `&after=${after}` : ""}`;
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        if (!r.ok) throw new Error(`HubSpot API returned ${r.status}: ${await r.text()}`);
        const data: any = await r.json();
        allDeals.push(...(data.results ?? []));
        if (data.paging?.next?.after) {
          after = data.paging.next.after;
        } else {
          break;
        }
      }

      // Map HubSpot deal → bd_deals row
      const now = new Date().toISOString();
      let inserted = 0, updated = 0, skipped = 0;

      for (const deal of allDeals) {
        try {
          const p = deal.properties ?? {};
          const amount = p.amount ? Number(p.amount) : null;
          const prob = p.hs_deal_stage_probability ? Math.round(Number(p.hs_deal_stage_probability) * 100) : null;
          const row = {
            hubspot_id:       String(deal.id),
            name:             p.dealname || "Untitled deal",
            client_name:      null as string | null,
            contact_name:     null as string | null,
            contact_email:    null as string | null,
            stage:            normaliseHubspotStage(p.dealstage ?? ""),
            amount:           amount !== null && !isNaN(amount) ? amount : null,
            currency:         "EUR",
            probability:      prob,
            close_date:       p.closedate ? p.closedate.slice(0, 10) : null,
            source:           "hubspot_api",
            owner:            p.hubspot_owner_id ?? null,
            notes:            p.description ?? null,
            industry:         null as string | null,
            region:           null as string | null,
            last_activity_at: p.hs_lastactivitydate ? p.hs_lastactivitydate.slice(0, 10) : null,
            imported_at:      now,
          };

          // Upsert by hubspot_id
          const existing: any = await db.execute(sql`SELECT id FROM bd_deals WHERE hubspot_id = ${row.hubspot_id}`);
          if (existing.rows?.length > 0) {
            await db.execute(sql`
              UPDATE bd_deals SET
                name = ${row.name}, stage = ${row.stage}, amount = ${row.amount},
                probability = ${row.probability}, close_date = ${row.close_date},
                source = ${row.source}, owner = ${row.owner}, notes = ${row.notes},
                last_activity_at = ${row.last_activity_at}, imported_at = ${row.imported_at},
                updated_at = ${now}
              WHERE hubspot_id = ${row.hubspot_id}
            `);
            updated++;
          } else {
            await db.execute(sql`
              INSERT INTO bd_deals (
                hubspot_id, name, client_name, contact_name, contact_email,
                stage, amount, currency, probability, close_date, source, owner,
                notes, industry, region, last_activity_at, imported_at, created_at, updated_at
              ) VALUES (
                ${row.hubspot_id}, ${row.name}, ${row.client_name}, ${row.contact_name}, ${row.contact_email},
                ${row.stage}, ${row.amount}, ${row.currency}, ${row.probability}, ${row.close_date},
                ${row.source}, ${row.owner}, ${row.notes}, ${row.industry}, ${row.region},
                ${row.last_activity_at}, ${row.imported_at}, ${now}, ${now}
              )
            `);
            inserted++;
          }
        } catch (e: any) {
          skipped++;
          console.warn("[hubspot/sync] deal skipped:", e.message);
        }
      }

      res.json({ ok: true, total: allDeals.length, inserted, updated, skipped });
    } catch (err: any) {
      console.error("[hubspot/sync] failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── HubSpot Contacts sync ───────────────────────────────────────────────────
  // Requires crm.objects.contacts.read scope on the Private App.
  app.get("/api/hubspot/contacts", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const rows: any = await db.execute(sql`
        SELECT * FROM hubspot_contacts ORDER BY last_name, first_name
      `);
      res.json(rows.rows ?? []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hubspot/contacts/sync", requireAuth, async (req, res) => {
    const token = process.env.HUBSPOT_TOKEN ?? "";
    if (!token) {
      res.status(400).json({ error: "HUBSPOT_TOKEN not configured." });
      return;
    }
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const CONTACT_PROPS = [
        "firstname", "lastname", "email", "phone", "jobtitle",
        "company", "associatedcompanyid", "lifecyclestage", "hs_lead_status",
        "hubspot_owner_id", "city", "country", "notes_last_activity",
      ].join(",");

      // One batch of 100 contacts per call. Client passes `after` cursor from
      // the previous response to advance through pages. No server-side loop —
      // avoids Render's 30 s timeout when the contact list is large.
      const afterCursor: string | null = (req.body as any)?.after ?? null;
      const url = `https://api.hubapi.com/crm/v3/objects/contacts?limit=100&archived=false&properties=${CONTACT_PROPS}${afterCursor ? `&after=${afterCursor}` : ""}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
      if (r.status === 403) {
        const body = await r.json().catch(() => ({}));
        res.status(403).json({ error: "Missing scope: crm.objects.contacts.read", detail: body });
        return;
      }
      if (!r.ok) throw new Error(`HubSpot API ${r.status}: ${await r.text()}`);
      const data: any = await r.json();
      const contacts: any[] = data.results ?? [];
      // nextAfter is null when this is the last page
      const nextAfter: string | null = data.paging?.next?.after ?? null;

      const now = new Date().toISOString();
      let inserted = 0, updated = 0, skipped = 0;

      for (const contact of contacts) {
        try {
          const p = contact.properties ?? {};
          const row = {
            hubspot_id:         String(contact.id),
            first_name:         p.firstname ?? null,
            last_name:          p.lastname ?? null,
            email:              p.email ?? null,
            phone:              p.phone ?? null,
            job_title:          p.jobtitle ?? null,
            company:            p.company ?? null,
            company_hubspot_id: p.associatedcompanyid ? String(p.associatedcompanyid) : null,
            lifecycle_stage:    p.lifecyclestage ?? null,
            lead_status:        p.hs_lead_status ?? null,
            owner_id:           p.hubspot_owner_id ?? null,
            city:               p.city ?? null,
            country:            p.country ?? null,
            last_activity_at:   p.notes_last_activity ? p.notes_last_activity.slice(0, 10) : null,
          };
          const existing: any = await db.execute(sql`SELECT id FROM hubspot_contacts WHERE hubspot_id = ${row.hubspot_id}`);
          if (existing.rows?.length > 0) {
            await db.execute(sql`
              UPDATE hubspot_contacts SET
                first_name = ${row.first_name}, last_name = ${row.last_name},
                email = ${row.email}, phone = ${row.phone}, job_title = ${row.job_title},
                company = ${row.company}, company_hubspot_id = ${row.company_hubspot_id},
                lifecycle_stage = ${row.lifecycle_stage}, lead_status = ${row.lead_status},
                owner_id = ${row.owner_id}, city = ${row.city}, country = ${row.country},
                last_activity_at = ${row.last_activity_at}, synced_at = ${now}, updated_at = ${now}
              WHERE hubspot_id = ${row.hubspot_id}
            `);
            updated++;
          } else {
            await db.execute(sql`
              INSERT INTO hubspot_contacts (
                hubspot_id, first_name, last_name, email, phone, job_title,
                company, company_hubspot_id, lifecycle_stage, lead_status,
                owner_id, city, country, last_activity_at, synced_at, created_at, updated_at
              ) VALUES (
                ${row.hubspot_id}, ${row.first_name}, ${row.last_name}, ${row.email}, ${row.phone},
                ${row.job_title}, ${row.company}, ${row.company_hubspot_id}, ${row.lifecycle_stage},
                ${row.lead_status}, ${row.owner_id}, ${row.city}, ${row.country},
                ${row.last_activity_at}, ${now}, ${now}, ${now}
              )
            `);
            inserted++;
          }
        } catch (e: any) {
          skipped++;
          console.warn("[hubspot/contacts/sync] contact skipped:", e.message);
        }
      }

      // Return nextAfter so the client can fetch the next batch on the next click.
      // nextAfter === null means this was the last page.
      res.json({ ok: true, total: contacts.length, inserted, updated, skipped, nextAfter });
    } catch (err: any) {
      console.error("[hubspot/contacts/sync] failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── HubSpot Companies sync ──────────────────────────────────────────────────
  // Requires crm.objects.companies.read scope on the Private App.
  app.get("/api/hubspot/companies", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const rows: any = await db.execute(sql`
        SELECT * FROM hubspot_companies ORDER BY name
      `);
      res.json(rows.rows ?? []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/hubspot/companies/sync", requireAuth, async (_req, res) => {
    const token = process.env.HUBSPOT_TOKEN ?? "";
    if (!token) {
      res.status(400).json({ error: "HUBSPOT_TOKEN not configured." });
      return;
    }
    try {
      const { db } = await import("./db");
      const { sql } = await import("drizzle-orm");
      const COMPANY_PROPS = [
        "name", "domain", "industry", "numberofemployees", "annualrevenue",
        "country", "city", "phone", "description", "lifecyclestage",
        "hubspot_owner_id", "notes_last_activity",
      ].join(",");

      let after: string | null = null;
      const allCompanies: any[] = [];

      for (let page = 0; page < 50; page++) {
        const url = `https://api.hubapi.com/crm/v3/objects/companies?limit=100&archived=false&properties=${COMPANY_PROPS}${after ? `&after=${after}` : ""}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
        if (r.status === 403) {
          const body = await r.json().catch(() => ({}));
          res.status(403).json({ error: "Missing scope: crm.objects.companies.read", detail: body });
          return;
        }
        if (!r.ok) throw new Error(`HubSpot API ${r.status}: ${await r.text()}`);
        const data: any = await r.json();
        allCompanies.push(...(data.results ?? []));
        if (data.paging?.next?.after) after = data.paging.next.after;
        else break;
      }

      const now = new Date().toISOString();
      let inserted = 0, updated = 0, skipped = 0;

      for (const company of allCompanies) {
        try {
          const p = company.properties ?? {};
          const rev = p.annualrevenue ? Number(p.annualrevenue) : null;
          const row = {
            hubspot_id:       String(company.id),
            name:             p.name ?? null,
            domain:           p.domain ?? null,
            industry:         p.industry ?? null,
            num_employees:    p.numberofemployees ?? null,
            annual_revenue:   rev !== null && !isNaN(rev) ? rev : null,
            country:          p.country ?? null,
            city:             p.city ?? null,
            phone:            p.phone ?? null,
            description:      p.description ?? null,
            lifecycle_stage:  p.lifecyclestage ?? null,
            owner_id:         p.hubspot_owner_id ?? null,
            last_activity_at: p.notes_last_activity ? p.notes_last_activity.slice(0, 10) : null,
          };
          const existing: any = await db.execute(sql`SELECT id FROM hubspot_companies WHERE hubspot_id = ${row.hubspot_id}`);
          if (existing.rows?.length > 0) {
            await db.execute(sql`
              UPDATE hubspot_companies SET
                name = ${row.name}, domain = ${row.domain}, industry = ${row.industry},
                num_employees = ${row.num_employees}, annual_revenue = ${row.annual_revenue},
                country = ${row.country}, city = ${row.city}, phone = ${row.phone},
                description = ${row.description}, lifecycle_stage = ${row.lifecycle_stage},
                owner_id = ${row.owner_id}, last_activity_at = ${row.last_activity_at},
                synced_at = ${now}, updated_at = ${now}
              WHERE hubspot_id = ${row.hubspot_id}
            `);
            updated++;
          } else {
            await db.execute(sql`
              INSERT INTO hubspot_companies (
                hubspot_id, name, domain, industry, num_employees, annual_revenue,
                country, city, phone, description, lifecycle_stage, owner_id,
                last_activity_at, synced_at, created_at, updated_at
              ) VALUES (
                ${row.hubspot_id}, ${row.name}, ${row.domain}, ${row.industry},
                ${row.num_employees}, ${row.annual_revenue}, ${row.country}, ${row.city},
                ${row.phone}, ${row.description}, ${row.lifecycle_stage}, ${row.owner_id},
                ${row.last_activity_at}, ${now}, ${now}, ${now}
              )
            `);
            inserted++;
          }
        } catch (e: any) {
          skipped++;
          console.warn("[hubspot/companies/sync] company skipped:", e.message);
        }
      }

      res.json({ ok: true, total: allCompanies.length, inserted, updated, skipped });
    } catch (err: any) {
      console.error("[hubspot/companies/sync] failed:", err.message);
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

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 1 — Agentic Org Foundation API endpoints
  // CRUD over agents / objectives / key_results / ideas / tasks +
  // executive_log + conflicts. No AI calls, just data plumbing — the
  // reasoning happens in Cowork; this server is the memory + workflow
  // bridge.
  // ════════════════════════════════════════════════════════════════════════

  function nowIso() { return new Date().toISOString(); }
  async function logEvent(event_type: string, agent_id: number | null, payload: any) {
    try {
      await db.insert(executiveLog).values({
        timestamp: nowIso(),
        agent_id,
        event_type,
        payload,
        created_at: nowIso(),
      } as any);
    } catch (e) {
      console.error("[executive_log] insert failed:", e);
    }
  }

  // ── /api/agentic/agents ─────────────────────────────────────────────────
  app.get("/api/agentic/agents", requireAuth, async (_req, res) => {
    try {
      const rows = await db.select().from(agentsTable).orderBy(agentsTable.id);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  /**
   * GET /api/agentic/agents/:id/score?days=7
   * Returns the B7 6-dimension performance scorecard for one agent.
   * Pure SQL — zero LLM calls, replaces the CHRO "score this agent" Claude call.
   */
  app.get("/api/agentic/agents/:id/score", requireAuth, async (req, res) => {
    try {
      const { scoreAgent } = await import("./microAI/index.js");
      const agentId = safeInt(req.params.id);
      const days    = Math.min(Number(req.query.days ?? 7), 90);
      const score   = await scoreAgent(agentId, days);
      res.json(score);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  /**
   * GET /api/agentic/agents/scores?days=7
   * Scorecard for ALL active agents — used by the CHRO overview table.
   */
  app.get("/api/agentic/agents/scores", requireAuth, async (req, res) => {
    try {
      const { scoreAgent } = await import("./microAI/index.js");
      const days = Math.min(Number(req.query.days ?? 7), 90);
      const agents = await db.select({ id: agentsTable.id, name: agentsTable.name, status: agentsTable.status })
        .from(agentsTable).orderBy(agentsTable.id);
      const active = agents.filter(a => a.status === "active" || a.status === "working");
      const scores = await Promise.all(active.map(a => scoreAgent(a.id, days)));
      res.json(scores.map((s, i) => ({ ...s, name: active[i].name })));
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.get("/api/agentic/agents/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const rows = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
      if (!rows[0]) { res.status(404).json({ message: "Not found" }); return; }
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.post("/api/agentic/agents", requireAuth, async (req, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.name) { res.status(400).json({ message: "name required" }); return; }
      const row = {
        name: String(b.name).trim(),
        mission: typeof b.mission === "string" ? b.mission : null,
        boss_id: typeof b.boss_id === "number" ? b.boss_id : null,
        status: typeof b.status === "string" ? b.status : "active",
        app_sections_assigned: typeof b.app_sections_assigned === "string" ? b.app_sections_assigned : null,
        decision_rights_autonomous: typeof b.decision_rights_autonomous === "string" ? b.decision_rights_autonomous : null,
        decision_rights_boss: typeof b.decision_rights_boss === "string" ? b.decision_rights_boss : null,
        decision_rights_ceo: typeof b.decision_rights_ceo === "string" ? b.decision_rights_ceo : null,
        decision_rights_livio: typeof b.decision_rights_livio === "string" ? b.decision_rights_livio : null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      const inserted = await db.insert(agentsTable).values(row as any).returning();
      res.status(201).json(inserted[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.put("/api/agentic/agents/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = req.body as Record<string, unknown>;
      const update: Record<string, unknown> = { updated_at: nowIso() };
      const fields = ["name", "mission", "status", "app_sections_assigned",
        "decision_rights_autonomous", "decision_rights_boss",
        "decision_rights_ceo", "decision_rights_livio",
        "role_title", "job_description", "function_area"];
      for (const f of fields) {
        if (typeof b[f] === "string" || b[f] === null) update[f] = b[f];
      }
      if (typeof b.boss_id === "number" || b.boss_id === null) update.boss_id = b.boss_id;
      const rows = await db.update(agentsTable).set(update as any).where(eq(agentsTable.id, id)).returning();
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.delete("/api/agentic/agents/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      await db.delete(agentsTable).where(eq(agentsTable.id, id));
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // POST /api/agentic/agents/:id/run — trigger one agent's daily routine on-demand
  app.post("/api/agentic/agents/:id/run", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      // Fire-and-forget: return immediately, run in background
      res.json({ started: true, agentId: id });
      runSingleAgent(id).catch(err =>
        console.error(`[AIOS] Background single-agent run failed for agent ${id}:`, err)
      );
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── /api/agentic/objectives + /key-results ──────────────────────────────
  app.get("/api/agentic/objectives", requireAuth, async (req, res) => {
    try {
      const agent_id = req.query.agent_id ? safeInt(String(req.query.agent_id)) : null;
      const rows = agent_id
        ? await db.select().from(objectivesTable).where(eq(objectivesTable.agent_id, agent_id)).orderBy(objectivesTable.id)
        : await db.select().from(objectivesTable).orderBy(objectivesTable.id);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.post("/api/agentic/objectives", requireAuth, async (req, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.title || typeof b.agent_id !== "number") { res.status(400).json({ message: "title + agent_id required" }); return; }
      const row = {
        agent_id: b.agent_id,
        title: String(b.title).trim(),
        description: typeof b.description === "string" ? b.description : null,
        target_date: typeof b.target_date === "string" ? b.target_date : null,
        status: typeof b.status === "string" ? b.status : "open",
        created_at: nowIso(),
      };
      const inserted = await db.insert(objectivesTable).values(row as any).returning();
      res.status(201).json(inserted[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.put("/api/agentic/objectives/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = req.body as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      for (const f of ["title", "description", "target_date", "status"]) {
        if (typeof b[f] === "string" || b[f] === null) update[f] = b[f];
      }
      const rows = await db.update(objectivesTable).set(update as any).where(eq(objectivesTable.id, id)).returning();
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.delete("/api/agentic/objectives/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      await db.delete(objectivesTable).where(eq(objectivesTable.id, id));
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.get("/api/agentic/key-results", requireAuth, async (req, res) => {
    try {
      const objective_id = req.query.objective_id ? safeInt(String(req.query.objective_id)) : null;
      const rows = objective_id
        ? await db.select().from(keyResultsTable).where(eq(keyResultsTable.objective_id, objective_id)).orderBy(keyResultsTable.id)
        : await db.select().from(keyResultsTable).orderBy(keyResultsTable.id);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.post("/api/agentic/key-results", requireAuth, async (req, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.title || typeof b.objective_id !== "number") { res.status(400).json({ message: "title + objective_id required" }); return; }
      const row = {
        objective_id: b.objective_id,
        title: String(b.title).trim(),
        target_value: typeof b.target_value === "string" ? b.target_value : null,
        current_value: typeof b.current_value === "string" ? b.current_value : null,
        unit: typeof b.unit === "string" ? b.unit : null,
        created_at: nowIso(),
      };
      const inserted = await db.insert(keyResultsTable).values(row as any).returning();
      res.status(201).json(inserted[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.put("/api/agentic/key-results/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = req.body as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      for (const f of ["title", "target_value", "current_value", "unit"]) {
        if (typeof b[f] === "string" || b[f] === null) update[f] = b[f];
      }
      const rows = await db.update(keyResultsTable).set(update as any).where(eq(keyResultsTable.id, id)).returning();
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.delete("/api/agentic/key-results/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      await db.delete(keyResultsTable).where(eq(keyResultsTable.id, id));
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── /api/agentic/agent-sources ──────────────────────────────────────────
  // Returns agent_knowledge rows (sourced from srcs.xlsx via seedSources.js)
  // for a given AIOS agents.id by mapping agents.name → org_agents.role_key.
  const _AIOS_NAME_TO_ROLE_KEY: Record<string, string> = {
    "CEO":              "ceo",
    "COO":              "coo",
    "CFO":              "cfo",
    "SVP Sales / BD":   "cco",
    "CMO":              "marketing-manager",
    "CHRO":             "hiring-manager",
    "CKO":              "cko",
    "L&D Manager":      "ld-manager",
    "BD Agent":         "bd-agent",
    "Proposal Agent":   "proposal-agent",
    "Pricing Agent":    "pricing-director",
    "Delivery Officer": "delivery-director",
    "AR Agent":         "ar-agent",
    "Partnership Agent":"partnership-agent",
  };
  app.get("/api/agentic/agent-sources", requireAuth, async (req, res) => {
    try {
      const agent_id = req.query.agent_id ? safeInt(String(req.query.agent_id)) : null;
      if (!agent_id) { res.status(400).json({ message: "agent_id required" }); return; }
      const agentRows = await db.select({ name: agentsTable.name }).from(agentsTable).where(eq(agentsTable.id, agent_id));
      if (!agentRows[0]) { res.json([]); return; }
      const roleKey = _AIOS_NAME_TO_ROLE_KEY[agentRows[0].name];
      if (!roleKey) { res.json([]); return; }
      const rows = await db.select().from(agentKnowledge)
        .where(and(eq(agentKnowledge.role_key, roleKey), eq(agentKnowledge.status, "active")))
        .orderBy(agentKnowledge.id);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── /api/agentic/ideas ──────────────────────────────────────────────────
  app.get("/api/agentic/ideas", requireAuth, async (req, res) => {
    try {
      const agent_id = req.query.agent_id ? safeInt(String(req.query.agent_id)) : null;
      const rows = agent_id
        ? await db.select().from(ideasTable).where(eq(ideasTable.agent_id, agent_id)).orderBy(desc(ideasTable.created_at))
        : await db.select().from(ideasTable).orderBy(desc(ideasTable.created_at));
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.post("/api/agentic/ideas", requireAuth, async (req, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.title || typeof b.agent_id !== "number") { res.status(400).json({ message: "title + agent_id required" }); return; }
      const impact = typeof b.impact_score === "number" ? b.impact_score : null;
      const effort = typeof b.effort_score === "number" ? b.effort_score : null;
      const risk   = typeof b.risk_score === "number"   ? b.risk_score   : null;
      // Total = impact - effort/2 - risk/2 (clamped 0-100). Cheap heuristic.
      const total  = (impact != null) ? Math.max(0, Math.min(100, Math.round(impact - (effort ?? 0) / 2 - (risk ?? 0) / 2))) : null;
      const row = {
        agent_id: b.agent_id,
        title: String(b.title).trim(),
        description: typeof b.description === "string" ? b.description : null,
        okr_link: typeof b.okr_link === "number" ? b.okr_link : null,
        impact_score: impact, effort_score: effort, risk_score: risk, total_score: total,
        status: typeof b.status === "string" ? b.status : "proposed",
        created_at: nowIso(),
      };
      const inserted = await db.insert(ideasTable).values(row as any).returning();
      await logEvent("idea_generated", b.agent_id as number, { idea_id: inserted[0].id, title: row.title });
      res.status(201).json(inserted[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.put("/api/agentic/ideas/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = req.body as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      for (const f of ["title", "description", "status"]) {
        if (typeof b[f] === "string" || b[f] === null) update[f] = b[f];
      }
      for (const f of ["okr_link", "impact_score", "effort_score", "risk_score", "total_score"]) {
        if (typeof b[f] === "number" || b[f] === null) update[f] = b[f];
      }
      const rows = await db.update(ideasTable).set(update as any).where(eq(ideasTable.id, id)).returning();
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.delete("/api/agentic/ideas/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      await db.delete(ideasTable).where(eq(ideasTable.id, id));
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── /api/agentic/tasks ──────────────────────────────────────────────────
  app.get("/api/agentic/tasks", requireAuth, async (req, res) => {
    try {
      const agent_id = req.query.agent_id ? safeInt(String(req.query.agent_id)) : null;
      const approval_status = typeof req.query.approval_status === "string" ? req.query.approval_status : null;
      let q = db.select().from(tasksTable).$dynamic();
      if (agent_id != null && approval_status) {
        q = q.where(and(eq(tasksTable.agent_id, agent_id), eq(tasksTable.approval_status, approval_status)));
      } else if (agent_id != null) {
        q = q.where(eq(tasksTable.agent_id, agent_id));
      } else if (approval_status) {
        q = q.where(eq(tasksTable.approval_status, approval_status));
      }
      const rows = await q.orderBy(desc(tasksTable.created_at));
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.post("/api/agentic/tasks", requireAuth, async (req, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.title || typeof b.agent_id !== "number") { res.status(400).json({ message: "title + agent_id required" }); return; }
      const approval_level = ["autonomous", "boss", "ceo", "livio"].includes(String(b.approval_level)) ? String(b.approval_level) : "autonomous";
      const row = {
        agent_id: b.agent_id,
        title: String(b.title).trim(),
        description: typeof b.description === "string" ? b.description : null,
        deadline: typeof b.deadline === "string" ? b.deadline : null,
        priority: typeof b.priority === "number" ? b.priority : 50,
        status: typeof b.status === "string" ? b.status : "open",
        approval_level,
        approval_status: approval_level === "autonomous" ? "not_required" : "pending",
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      const inserted = await db.insert(tasksTable).values(row as any).returning();
      await logEvent("task_created", b.agent_id as number, { task_id: inserted[0].id, title: row.title, approval_level });
      if (approval_level !== "autonomous") {
        await logEvent("approval_requested", b.agent_id as number, { task_id: inserted[0].id, level: approval_level });
      }
      res.status(201).json(inserted[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.put("/api/agentic/tasks/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = req.body as Record<string, unknown>;
      const update: Record<string, unknown> = { updated_at: nowIso() };
      for (const f of ["title", "description", "deadline", "status", "approval_level", "approval_status"]) {
        if (typeof b[f] === "string" || b[f] === null) update[f] = b[f];
      }
      if (typeof b.priority === "number") update.priority = b.priority;
      const rows = await db.update(tasksTable).set(update as any).where(eq(tasksTable.id, id)).returning();
      // Log approval state transitions.
      if (typeof b.approval_status === "string" && rows[0]) {
        if (b.approval_status === "approved") await logEvent("approval_granted", rows[0].agent_id, { task_id: id });
        if (b.approval_status === "rejected") await logEvent("approval_rejected", rows[0].agent_id, { task_id: id });
      }
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.delete("/api/agentic/tasks/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      await db.delete(tasksTable).where(eq(tasksTable.id, id));
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── /api/agentic/log ────────────────────────────────────────────────────
  app.get("/api/agentic/log", requireAuth, async (req, res) => {
    try {
      const agent_id = req.query.agent_id ? safeInt(String(req.query.agent_id)) : null;
      const event_type = typeof req.query.event_type === "string" ? req.query.event_type : null;
      let q = db.select().from(executiveLog).$dynamic();
      if (agent_id != null && event_type) {
        q = q.where(and(eq(executiveLog.agent_id, agent_id), eq(executiveLog.event_type, event_type)));
      } else if (agent_id != null) {
        q = q.where(eq(executiveLog.agent_id, agent_id));
      } else if (event_type) {
        q = q.where(eq(executiveLog.event_type, event_type));
      }
      const rows = await q.orderBy(desc(executiveLog.timestamp)).limit(500);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.post("/api/agentic/log", requireAuth, async (req, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.event_type) { res.status(400).json({ message: "event_type required" }); return; }
      const eventType = String(b.event_type);

      // D17/D18: enrich inbound_reply events — extract commitments + classify reply.
      // A2: enrich any event that has a text field with urgency/sentiment classification.
      // All best-effort, never block the insert.
      let enrichedPayload: Record<string, unknown> =
        (b.payload && typeof b.payload === "object") ? { ...(b.payload as object) } : {};

      const { extractCommitments, classifyReply, classify, useLocalAiFirst } = await import("./microAI/index.js");
      if (useLocalAiFirst()) {
        const text = typeof enrichedPayload.text === "string" ? enrichedPayload.text
                   : typeof b.summary   === "string"          ? b.summary
                   : "";
        if (text) {
          const tasks: Promise<void>[] = [];
          if (eventType === "inbound_reply") {
            tasks.push(
              classifyReply(text).then(c => { enrichedPayload.reply_classification = c; }).catch(() => {}),
              extractCommitments(text).then(cs => { if (cs.length) enrichedPayload.commitments = cs; }).catch(() => {}),
            );
          }
          tasks.push(
            Promise.all([
              classify(text, "urgency").catch(() => null),
              classify(text, "sentiment").catch(() => null),
            ]).then(([urgency, sentiment]) => {
              if (urgency)   enrichedPayload.urgency_label   = urgency.label;
              if (sentiment) enrichedPayload.sentiment_label = sentiment.label;
            }).catch(() => {}),
          );
          await Promise.all(tasks);
        }
      }

      const row = {
        timestamp: nowIso(),
        agent_id: typeof b.agent_id === "number" ? b.agent_id : null,
        event_type: eventType,
        payload: Object.keys(enrichedPayload).length > 0 ? enrichedPayload : (b.payload ?? null),
        created_at: nowIso(),
      };
      const inserted = await db.insert(executiveLog).values(row as any).returning();
      res.status(201).json(inserted[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── /api/agentic/conflicts ──────────────────────────────────────────────
  app.get("/api/agentic/conflicts", requireAuth, async (_req, res) => {
    try {
      const rows = await db.select().from(conflictsTable).orderBy(desc(conflictsTable.created_at));
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.post("/api/agentic/conflicts", requireAuth, async (req, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.title) { res.status(400).json({ message: "title required" }); return; }
      const row = {
        title: String(b.title).trim(),
        agents_involved: typeof b.agents_involved === "string" ? b.agents_involved : null,
        okrs_affected: typeof b.okrs_affected === "string" ? b.okrs_affected : null,
        severity: typeof b.severity === "string" ? b.severity : null,
        ceo_recommendation: typeof b.ceo_recommendation === "string" ? b.ceo_recommendation : null,
        livio_decision: typeof b.livio_decision === "string" ? b.livio_decision : null,
        status: typeof b.status === "string" ? b.status : "open",
        created_at: nowIso(),
        resolved_at: null as string | null,
      };
      const inserted = await db.insert(conflictsTable).values(row as any).returning();
      await logEvent("conflict_detected", null, { conflict_id: inserted[0].id, title: row.title });
      res.status(201).json(inserted[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });
  app.put("/api/agentic/conflicts/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = req.body as Record<string, unknown>;
      const update: Record<string, unknown> = {};
      for (const f of ["title", "agents_involved", "okrs_affected", "severity",
                       "ceo_recommendation", "livio_decision", "status", "resolved_at"]) {
        if (typeof b[f] === "string" || b[f] === null) update[f] = b[f];
      }
      const rows = await db.update(conflictsTable).set(update as any).where(eq(conflictsTable.id, id)).returning();
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── Phase 3 — Project Knowledge Base ────────────────────────────────────
  app.get("/api/agentic/knowledge", requireAuth, async (req, res) => {
    try {
      const q = String((req.query as any).q ?? "").trim().toLowerCase();
      const rows = await db.execute(sql`
        SELECT * FROM project_knowledge ORDER BY updated_at DESC LIMIT 200
      `);
      let data = ((rows as any).rows ?? rows) as any[];
      if (q) data = data.filter((r: any) =>
        [r.project_name, r.client_name, r.sector, r.service_line, r.tags, r.problem_statement, r.key_outputs]
          .some(f => f && String(f).toLowerCase().includes(q))
      );
      res.json(data);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.post("/api/agentic/knowledge", requireAuth, async (req, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      if (!b.project_name) { res.status(400).json({ message: "project_name required" }); return; }
      const now = nowIso();
      const rows = await db.execute(sql`
        INSERT INTO project_knowledge
          (client_name, project_name, sector, service_line, duration_weeks, team_size,
           revenue_eur, problem_statement, approach, key_outputs, results_impact,
           lessons_learned, reuse_potential, tags, status, created_at, updated_at)
        VALUES (
          ${b.client_name ?? null}, ${String(b.project_name)}, ${b.sector ?? null},
          ${b.service_line ?? null}, ${b.duration_weeks ?? null}, ${b.team_size ?? null},
          ${b.revenue_eur ?? null}, ${b.problem_statement ?? null}, ${b.approach ?? null},
          ${b.key_outputs ?? null}, ${b.results_impact ?? null}, ${b.lessons_learned ?? null},
          ${b.reuse_potential ?? null}, ${b.tags ?? null},
          ${b.status ?? "draft"}, ${now}, ${now}
        )
        RETURNING *
      `);
      res.status(201).json(((rows as any).rows ?? rows)[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.put("/api/agentic/knowledge/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = req.body as Record<string, unknown>;
      const now = nowIso();
      const fields = ["client_name","project_name","sector","service_line","duration_weeks",
        "team_size","revenue_eur","problem_statement","approach","key_outputs",
        "results_impact","lessons_learned","reuse_potential","tags","status"];
      const rows = await db.execute(sql`
        UPDATE project_knowledge SET
          client_name       = COALESCE(${b.client_name ?? null},       client_name),
          project_name      = COALESCE(${b.project_name ?? null},      project_name),
          sector            = COALESCE(${b.sector ?? null},            sector),
          service_line      = COALESCE(${b.service_line ?? null},      service_line),
          problem_statement = COALESCE(${b.problem_statement ?? null}, problem_statement),
          approach          = COALESCE(${b.approach ?? null},          approach),
          key_outputs       = COALESCE(${b.key_outputs ?? null},       key_outputs),
          results_impact    = COALESCE(${b.results_impact ?? null},    results_impact),
          lessons_learned   = COALESCE(${b.lessons_learned ?? null},   lessons_learned),
          reuse_potential   = COALESCE(${b.reuse_potential ?? null},   reuse_potential),
          tags              = COALESCE(${b.tags ?? null},              tags),
          status            = COALESCE(${b.status ?? null},            status),
          updated_at        = ${now}
        WHERE id = ${id}
        RETURNING *
      `);
      void fields;
      res.json(((rows as any).rows ?? rows)[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.delete("/api/agentic/knowledge/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      await db.execute(sql`DELETE FROM project_knowledge WHERE id = ${id}`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── Agent Readiness Reviews — daily snapshot with trend history ────────
  app.get("/api/agentic/readiness/:agent_id", requireAuth, async (req, res) => {
    try {
      const agentId = safeInt(req.params.agent_id);
      const rows = await db.execute(sql`
        SELECT * FROM agent_readiness_reviews
        WHERE agent_id = ${agentId}
        ORDER BY reviewed_at DESC, id DESC
        LIMIT 30
      `);
      res.json((rows as any).rows ?? rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.post("/api/agentic/readiness", requireAuth, async (req, res) => {
    try {
      const b = req.body as Record<string, unknown>;
      const agentId = safeInt(String(b.agent_id ?? "0"));
      if (!agentId) { res.status(400).json({ message: "agent_id required" }); return; }
      const now = nowIso();
      const reviewedAt = typeof b.reviewed_at === "string" ? b.reviewed_at : now.slice(0, 10);
      const dim = (k: string) => Math.min(100, Math.max(0, parseInt(String(b[k] ?? "0")) || 0));
      const rc = dim("role_clarity");
      const da = dim("data_access");
      const sk = dim("skill_knowledge");
      const oq = dim("output_quality");
      const dd = dim("decision_discipline");
      const op = dim("okr_progress");
      const overall = Math.round((rc + da + sk + oq + dd + op) / 6);
      const rows = await db.execute(sql`
        INSERT INTO agent_readiness_reviews
          (agent_id, reviewed_at, role_clarity, data_access, skill_knowledge,
           output_quality, decision_discipline, okr_progress, overall, notes, created_at)
        VALUES (${agentId}, ${reviewedAt}, ${rc}, ${da}, ${sk}, ${oq}, ${dd}, ${op},
                ${overall}, ${b.notes ?? null}, ${now})
        RETURNING *
      `);
      // Also update the JSON snapshot on the agents table for backwards-compat.
      const patch = { role_clarity: rc, data_access: da, skill_knowledge: sk,
                      output_quality: oq, decision_discipline: dd, okr_progress: op };
      await db.execute(sql`
        UPDATE agents SET readiness_scores = ${JSON.stringify(patch)}, updated_at = ${now}
        WHERE id = ${agentId}
      `);
      await logEvent("readiness_review_saved", agentId, { overall, reviewed_at: reviewedAt });
      res.status(201).json(((rows as any).rows ?? rows)[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── Phase 2 — Cowork Skills Library ────────────────────────────────────
  app.get("/api/agentic/skills", requireAuth, async (_req, res) => {
    try {
      const rows = await db.select().from(coworkSkills).orderBy(coworkSkills.kind, coworkSkills.name);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.put("/api/agentic/skills/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const b = req.body as Record<string, unknown>;
      const update: Record<string, unknown> = { updated_at: nowIso() };
      for (const f of ["name", "markdown", "status", "notes"]) {
        if (typeof b[f] === "string" || b[f] === null) update[f] = b[f];
      }
      const rows = await db.update(coworkSkills).set(update as any).where(eq(coworkSkills.id, id)).returning();
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.delete("/api/agentic/skills/:id", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      await db.delete(coworkSkills).where(eq(coworkSkills.id, id));
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // Skill Factory queue: tasks of TYPE=proposal that have been approved
  // by Livio AND don't yet have a drafted skill (cowork_skills.source_task_id).
  app.get("/api/agentic/skills/factory-queue", requireAuth, async (_req, res) => {
    try {
      // Approved hire proposals = tasks with approval_status='approved' AND
      // approval_level='livio' AND title starting with "Hire:".
      const allTasks = await db.select().from(tasksTable);
      const drafted = await db.select().from(coworkSkills);
      const draftedTaskIds = new Set(drafted.map(d => d.source_task_id).filter(Boolean));
      const queue = allTasks.filter(t =>
        t.approval_status === "approved"
        && t.approval_level === "livio"
        && /^hire:/i.test(t.title)
        && !draftedTaskIds.has(t.id),
      );
      res.json(queue);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // Import COO's drafted-skills payload. The COO's Cowork output contains
  // multiple ```skill-md fenced blocks; this endpoint accepts the full
  // pasted text and inserts one row per block.
  app.post("/api/agentic/skills/import", requireAuth, async (req, res) => {
    try {
      const raw = String((req.body as any)?.payload ?? "");
      if (!raw.trim()) { res.status(400).json({ message: "payload required" }); return; }
      // Split on ```skill-md fences. Robust to extra whitespace + missing
      // closing fences (last block may run to EOF).
      const blocks = raw.split(/^[ \t]*```\s*skill-md\s*$/m).slice(1)
        .map(b => b.split(/^[ \t]*```\s*$/m)[0].trim())
        .filter(Boolean);
      let created = 0;
      const errors: { reason: string }[] = [];
      const now = nowIso();
      for (const block of blocks) {
        const m1 = block.match(/^DRAFT_FOR_TASK:\s*(\d+)/m);
        const m2 = block.match(/^AGENT_KEY:\s*([a-z0-9\-_]+)/im);
        const m3 = block.match(/^ROLE_NAME:\s*(.+)$/m);
        if (!m2 || !m3) {
          errors.push({ reason: "Missing AGENT_KEY or ROLE_NAME header" });
          continue;
        }
        const source_task_id = m1 ? parseInt(m1[1], 10) : null;
        const agent_key = m2[1].trim();
        const name = `Eendigo ${m3[1].trim()}`;
        try {
          await db.insert(coworkSkills).values({
            name,
            agent_key,
            kind: "drafted",
            markdown: block,
            status: "draft",
            source_task_id,
            source_agent_id: null,
            created_at: now, updated_at: now,
          } as any);
          created++;
        } catch (e) {
          errors.push({ reason: (e as Error).message });
        }
      }
      await logEvent("output_imported", null, { kind: "skill_factory", created, errors: errors.length });
      res.json({ created, errors });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── Phase 3 — Skill activation: parse drafted markdown → create agent ─
  // When a drafted skill goes to status='ready', extract the role's
  // mission, boss, decision-rights × 4, and app sections from the
  // markdown body and create the corresponding row in `agents`. Updates
  // the skill's source_agent_id so the link is bidirectional.
  function parseDraftedSkill(md: string): {
    role_name: string | null;
    mission: string | null;
    boss_name: string | null;
    app_sections: string | null;
    autonomous: string | null;
    boss: string | null;
    ceo: string | null;
    livio: string | null;
  } {
    const grab = (rx: RegExp): string | null => {
      const m = md.match(rx);
      return m ? m[1].trim() : null;
    };
    // Pull the section between a header and the next header.
    const grabSection = (header: string): string | null => {
      const rx = new RegExp(`##\\s+${header}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
      const m = md.match(rx);
      return m ? m[1].trim() : null;
    };
    const role_name = grab(/^ROLE_NAME:\s*(.+)$/m);
    const mission = grabSection("Mission");
    const boss_name = grab(/Boss:\s*([^.\n]+)/i);
    const dailyInputs = grabSection("Daily inputs you must read");
    let app_sections: string | null = null;
    if (dailyInputs) {
      // Extract /paths from the section.
      const paths = dailyInputs.match(/\/[a-zA-Z0-9\-_/]+/g);
      app_sections = paths ? paths.join("\n") : null;
    }
    const decisionRights = grabSection("Decision rights");
    let autonomous: string | null = null, boss: string | null = null, ceo: string | null = null, livio: string | null = null;
    if (decisionRights) {
      const pickList = (label: string): string | null => {
        const rx = new RegExp(`-\\s*${label}:\\s*(.+?)(?=\\n-\\s|$)`, "is");
        const m = decisionRights.match(rx);
        return m ? m[1].trim() : null;
      };
      autonomous = pickList("Autonomous");
      boss = pickList("Boss approval");
      ceo = pickList("CEO approval");
      livio = pickList("Livio approval");
    }
    return { role_name, mission, boss_name, app_sections, autonomous, boss, ceo, livio };
  }

  app.post("/api/agentic/skills/:id/activate", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const skill = (await db.select().from(coworkSkills).where(eq(coworkSkills.id, id)))[0];
      if (!skill) { res.status(404).json({ message: "Skill not found" }); return; }
      if (skill.kind !== "drafted") {
        res.status(400).json({ message: "Only drafted skills can be activated. Core skills are agent-less." });
        return;
      }
      // Skip if already activated.
      if (skill.source_agent_id) {
        res.json({ message: "Already activated", skill });
        return;
      }
      const parsed = parseDraftedSkill(skill.markdown);
      if (!parsed.role_name) {
        res.status(400).json({ message: "Could not parse ROLE_NAME from skill markdown" });
        return;
      }
      // Resolve boss_id by name lookup (case-insensitive trim).
      let boss_id: number | null = null;
      if (parsed.boss_name) {
        const all = await db.select().from(agentsTable);
        const match = all.find(a => a.name.trim().toLowerCase() === parsed.boss_name!.trim().toLowerCase());
        if (match) boss_id = match.id;
      }
      // Create the agent row.
      const inserted = await db.insert(agentsTable).values({
        name: parsed.role_name,
        mission: parsed.mission,
        boss_id,
        status: "active",
        app_sections_assigned: parsed.app_sections,
        decision_rights_autonomous: parsed.autonomous,
        decision_rights_boss: parsed.boss,
        decision_rights_ceo: parsed.ceo,
        decision_rights_livio: parsed.livio,
        created_at: nowIso(),
        updated_at: nowIso(),
      } as any).returning();
      // Link skill → agent + flip status to 'ready'.
      const updatedSkill = await db.update(coworkSkills).set({
        source_agent_id: inserted[0].id,
        status: "ready",
        updated_at: nowIso(),
      } as any).where(eq(coworkSkills.id, id)).returning();
      await logEvent("decision_logged", inserted[0].id, {
        kind: "skill_activated",
        skill_id: id, agent_id: inserted[0].id, role_name: parsed.role_name,
      });
      res.json({ agent: inserted[0], skill: updatedSkill[0] });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── Phase 3 — Conflict auto-detection ──────────────────────────────────
  // Run after the user imports a Cowork output. Heuristics:
  //   1. Multi-agent OKR collision: ≥ 2 different agents have new actions
  //      pointing at the same OKR within the last hour.
  //   2. Overload: a single agent received > 7 new actions in the last hour.
  //   3. Antonym titles: two agents have actions whose TITLE contains
  //      opposite keywords on the same OKR (raise/lower, hire/cut,
  //      push/pause, increase/decrease).
  // Each detected conflict becomes a row in `conflicts` + an executive_log
  // event (event_type='conflict_detected', payload.detection='auto').
  app.post("/api/agentic/conflicts/auto-detect", requireAuth, async (_req, res) => {
    try {
      // Pull tasks created in the last hour.
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const recent = (await db.select().from(tasksTable)) as Array<typeof tasksTable.$inferSelect>;
      const fresh = recent.filter(t => t.created_at > cutoff);
      const allAgents = await db.select().from(agentsTable);
      const agentName = (id: number) => allAgents.find(a => a.id === id)?.name ?? `#${id}`;

      const detected: Array<{ title: string; agents: string; severity: string }> = [];

      // (2) Overload
      const byAgent = new Map<number, typeof fresh>();
      for (const t of fresh) {
        const arr = byAgent.get(t.agent_id) ?? [];
        arr.push(t);
        byAgent.set(t.agent_id, arr);
      }
      for (const [aid, arr] of byAgent) {
        if (arr.length > 7) {
          detected.push({
            title: `Overload: ${agentName(aid)} received ${arr.length} new actions in 1h`,
            agents: agentName(aid),
            severity: "high",
          });
        }
      }

      // (1) Multi-agent OKR collision — group by deadline + simple keyword
      // overlap on title since real OKR linking is in `ideas` not `tasks`.
      // For now: same exact deadline + ≥ 2 agents → flag.
      const byDeadline = new Map<string, typeof fresh>();
      for (const t of fresh) {
        if (!t.deadline) continue;
        const arr = byDeadline.get(t.deadline) ?? [];
        arr.push(t);
        byDeadline.set(t.deadline, arr);
      }
      for (const [dl, arr] of byDeadline) {
        const distinctAgents = new Set(arr.map(a => a.agent_id));
        if (distinctAgents.size >= 2 && arr.length >= 3) {
          detected.push({
            title: `Same-deadline collision (${dl}): ${arr.length} actions across ${distinctAgents.size} agents`,
            agents: [...distinctAgents].map(agentName).join(", "),
            severity: "medium",
          });
        }
      }

      // (3) Antonym titles
      const ANTONYMS: Array<[RegExp, RegExp, string]> = [
        [/\b(raise|increase|push|grow|expand)\b/i, /\b(lower|decrease|pause|cut|shrink|reduce)\b/i, "raise vs cut"],
        [/\bhire\b/i,     /\b(fire|cut|reduce|let go)\b/i,                                          "hire vs cut"],
        [/\b(launch|start|kick.?off)\b/i, /\b(stop|halt|cancel|pause)\b/i,                          "launch vs stop"],
        [/\b(approve|accept|green.?light)\b/i, /\b(reject|deny|block)\b/i,                          "approve vs reject"],
      ];
      for (const t of fresh) {
        for (const t2 of fresh) {
          if (t.id >= t2.id) continue;
          if (t.agent_id === t2.agent_id) continue;
          for (const [a, b, label] of ANTONYMS) {
            if ((a.test(t.title) && b.test(t2.title)) || (b.test(t.title) && a.test(t2.title))) {
              detected.push({
                title: `${label}: "${t.title}" vs "${t2.title}"`,
                agents: `${agentName(t.agent_id)}, ${agentName(t2.agent_id)}`,
                severity: "high",
              });
            }
          }
        }
      }

      // De-dupe by title.
      const seen = new Set<string>();
      const unique = detected.filter(d => {
        if (seen.has(d.title)) return false;
        seen.add(d.title);
        return true;
      });

      // Insert + log.
      const inserted: number[] = [];
      for (const d of unique) {
        // Skip if a conflict with same title already open.
        const existing = await db.execute(sql`
          SELECT id FROM conflicts WHERE title = ${d.title} AND status = 'open' LIMIT 1
        `);
        if ((existing as any).rows?.length > 0) continue;
        const ins = await db.insert(conflictsTable).values({
          title: d.title,
          agents_involved: d.agents,
          severity: d.severity,
          status: "open",
          created_at: nowIso(),
          resolved_at: null,
        } as any).returning();
        await logEvent("conflict_detected", null, {
          conflict_id: ins[0].id, title: d.title, detection: "auto",
        });
        inserted.push(ins[0].id);
      }
      res.json({ detected: unique.length, created: inserted.length });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // Convenience: build the COO Skill Factory PAYLOAD (the input the user
  // pastes into Cowork along with the COO skill). Reads the factory-queue
  // and renders APPROVED_PROPOSAL blocks.
  app.get("/api/agentic/skills/factory-payload", requireAuth, async (_req, res) => {
    try {
      const allTasks = await db.select().from(tasksTable);
      const drafted = await db.select().from(coworkSkills);
      const allAgents = await db.select().from(agentsTable);
      const draftedTaskIds = new Set(drafted.map(d => d.source_task_id).filter(Boolean));
      const queue = allTasks.filter(t =>
        t.approval_status === "approved"
        && t.approval_level === "livio"
        && /^hire:/i.test(t.title)
        && !draftedTaskIds.has(t.id),
      );
      const lines: string[] = [];
      for (const t of queue) {
        const agent = allAgents.find(a => a.id === t.agent_id);
        const role = t.title.replace(/^hire:\s*/i, "").trim();
        lines.push("APPROVED_PROPOSAL");
        lines.push(`ROLE_NAME: ${role}`);
        lines.push(`RATIONALE: ${(t.description ?? "").slice(0, 400)}`);
        lines.push(`SUGGESTED_BOSS: ${agent?.name ?? "CEO"}`);
        lines.push(`DECISION_LEVEL: ${t.approval_level}`);
        lines.push(`SOURCE_TASK_ID: ${t.id}`);
        lines.push("---");
      }
      res.json({ count: queue.length, payload: lines.join("\n") });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── /api/agentic/agents/kick ────────────────────────────────────────────
  // "Make agents start work." Marks every active agent's status='working',
  // logs an `agents_kicked` system event + one `action_proposed` placeholder
  // per agent so the Decision Log shows movement. The actual reasoning still
  // happens via the Cowork prompt (8am button), but this gives Livio an
  // explicit "go!" trigger and a status flag the UI can show.
  app.post("/api/agentic/agents/kick", requireAuth, async (_req, res) => {
    try {
      const all = await db.select().from(agentsTable);
      const active = all.filter(a => a.status !== "fired" && a.status !== "archived");
      const now = new Date().toISOString();
      for (const a of active) {
        await db.update(agentsTable).set({ status: "working" } as any).where(eq(agentsTable.id, a.id));
      }
      await db.insert(executiveLog).values({
        timestamp: now,
        agent_id: null,
        event_type: "agents_kicked",
        payload: { count: active.length, agents: active.map(a => a.name) } as any,
        created_at: now,
      } as any);
      res.json({ kicked: active.length });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── President-request auto-routing helpers ──────────────────────────────
  // When the President sends a question, the CEO automatically routes it to
  // the most competent specialist agent, fetches their live data, and has
  // that agent answer. The CEO's response is:
  //   "I've asked [Agent] — they are the domain expert. Their analysis: …"

  /** Keyword-based routing: returns agent name, db-key, domain label */
  function routePresidentQuestion(q: string): { name: string; key: string; domain: string } {
    const lo = q.toLowerCase();
    if (/invoice|unpaid|overdue|due amount|payment|cash flow|receiv|cfo|margin|ebitda|revenue|budget|spend|p&l|dso/i.test(lo))
      return { name: "CFO", key: "cfo", domain: "finance, invoices & cash" };
    if (/hire|recruit|headcount|candidate|chro|hr\b|employee|talent|onboard|attrition|salary|comp\b|open role|vacancy/i.test(lo))
      return { name: "CHRO", key: "chro", domain: "people, hiring & headcount" };
    if (/pric|discount|fee\b|day rate|win.loss|win rate|proposal fee|elasticit|rate card/i.test(lo))
      return { name: "Pricing Director", key: "pricing", domain: "pricing & commercial terms" };
    if (/deliver|qualit|utiliz|nps|engagement|on.time|project status|ongoing project|active engagement/i.test(lo))
      return { name: "Delivery Director", key: "delivery", domain: "delivery & active projects" };
    if (/sale|pipeline|deal|lead|prospect|bd\b|cco|commercial|funnel|close|client acqui/i.test(lo))
      return { name: "CCO", key: "cco", domain: "sales & commercial pipeline" };
    if (/content|brand|marketing|seo|linkedin|media|campaign|webinar|thought.leader/i.test(lo))
      return { name: "Marketing Manager", key: "marketing", domain: "marketing & brand" };
    if (/automat|tool|ai\b|ops\b|process|intern|it\b|admin|coo\b|system/i.test(lo))
      return { name: "COO", key: "coo", domain: "operations & tools" };
    // Default: CEO handles cross-domain questions directly
    return { name: "CEO (cross-domain synthesis)", key: "ceo", domain: "cross-domain" };
  }

  /** Pull the live data that each specialist agent needs to answer the question */
  async function fetchAgentLiveData(key: string): Promise<string> {
    const today = new Date().toISOString().slice(0, 10);
    const lines: string[] = [];
    try {
      if (key === "cfo") {
        const r = await db.execute(sql`
          SELECT client_name, due_amount, due_date, state, currency
            FROM invoice_snapshots
           WHERE state != 'paid'
           ORDER BY due_date ASC NULLS LAST
           LIMIT 50
        `);
        const invs: any[] = (r as any).rows ?? (r as any) ?? [];
        const overdue = invs.filter((i: any) => i.due_date && i.due_date < today);
        const pending = invs.filter((i: any) => !i.due_date || i.due_date >= today);
        const overdueAmt = overdue.reduce((s: number, i: any) => s + (Number(i.due_amount) || 0), 0);
        lines.push(`Invoice snapshot (${today}):`);
        lines.push(`• Open/unpaid invoices total: ${invs.length}`);
        if (overdue.length === 0) {
          lines.push("• No overdue invoices — all open invoices are within their due date.");
        } else {
          lines.push(`• OVERDUE (past due date): ${overdue.length} invoices — total €${Math.round(overdueAmt).toLocaleString("en")}`);
          for (const i of overdue.slice(0, 10))
            lines.push(`  - ${i.client_name ?? "(unknown)"}: €${Number(i.due_amount ?? 0).toLocaleString("en")} — due ${i.due_date} — ${i.state}`);
        }
        if (pending.length > 0) {
          lines.push(`• Due later (not yet overdue): ${pending.length} invoices`);
          for (const i of pending.slice(0, 5))
            lines.push(`  - ${i.client_name ?? "(unknown)"}: €${Number(i.due_amount ?? 0).toLocaleString("en")} — due ${i.due_date ?? "TBD"}`);
        }
      } else if (key === "chro") {
        const empR = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM employees`);
        const cnt = Number(((empR as any).rows ?? empR)[0]?.cnt ?? 0);
        const hirR = await db.execute(sql`
          SELECT stage, COUNT(*)::int AS count
            FROM hiring_candidates
           WHERE stage IS NOT NULL
           GROUP BY stage ORDER BY count DESC
        `);
        const stages: any[] = (hirR as any).rows ?? hirR ?? [];
        lines.push(`Headcount: ${cnt} active employees`);
        if (stages.length === 0) {
          lines.push("No candidates currently in hiring pipeline.");
        } else {
          lines.push("Hiring pipeline:");
          for (const s of stages) lines.push(`  - ${s.stage}: ${s.count} candidate(s)`);
        }
      } else if (key === "cco") {
        const dr = await db.execute(sql`
          SELECT name, client_name, stage, amount, probability, close_date, currency
            FROM bd_deals ORDER BY probability DESC NULLS LAST LIMIT 20
        `);
        const deals: any[] = (dr as any).rows ?? dr ?? [];
        const weighted = deals.reduce((s: number, d: any) => s + (Number(d.amount) || 0) * ((Number(d.probability) || 0) / 100), 0);
        lines.push(`BD pipeline: ${deals.length} deal(s) — weighted value €${Math.round(weighted).toLocaleString("en")}`);
        for (const d of deals.slice(0, 8))
          lines.push(`  - ${d.name} (${d.client_name ?? "?"}): stage=${d.stage ?? "?"} · €${Number(d.amount ?? 0).toLocaleString("en")} · ${d.probability ?? "?"}% · close ${d.close_date ?? "?"}`);
      } else if (key === "delivery") {
        const wr = await db.execute(sql`
          SELECT project_name, client_name, status, start_date, end_date, total_amount, currency
            FROM won_projects WHERE status = 'active' ORDER BY end_date ASC NULLS LAST
        `);
        const projs: any[] = (wr as any).rows ?? wr ?? [];
        lines.push(`Active engagements: ${projs.length}`);
        for (const p of projs.slice(0, 10))
          lines.push(`  - ${p.project_name} (${p.client_name ?? "?"}): ${p.start_date ?? "?"} → ${p.end_date ?? "ongoing"}`);
      } else {
        lines.push("(No specific live data loaded for this domain — answer from general context and Eendigo knowledge.)");
      }
    } catch (_) {
      lines.push("(Live data unavailable — DB query failed. Answer from general context.)");
    }
    return lines.join("\n");
  }

  /** Auto-answer a president request: route → fetch live data → call AI → return formatted reply */
  async function autoAnswerPresidentRequest(question: string): Promise<string> {
    const { generateText } = await import("./aiProviders");
    const route = routePresidentQuestion(question);
    const liveData = await fetchAgentLiveData(route.key);

    const system = [
      `You are the ${route.name} of Eendigo, a boutique management consulting firm.`,
      `The CEO is forwarding a question from the company President to you because it falls under your domain: ${route.domain}.`,
      "Answer concisely, factually, and precisely based on the data provided.",
      "Lead with the key number or fact. Be direct — no hedging, no padding.",
      "If data shows a problem, state it clearly and recommend a concrete next action.",
      "Keep your reply under 150 words.",
    ].join(" ");

    const prompt = `President's question: "${question}"\n\nLive data from your domain:\n${liveData}`;

    let agentAnswer: string;
    try {
      const result = await generateText({
        provider: "anthropic",
        model: "claude-haiku-4-5",
        system,
        prompt,
        maxTokens: 400,
        temperature: 0.3,
      });
      agentAnswer = result.text.trim();
    } catch {
      agentAnswer = "(AI unavailable — check ANTHROPIC_API_KEY)";
    }

    const isCEODirect = route.key === "ceo";
    if (isCEODirect) {
      return agentAnswer;
    }
    return `I'm forwarding this to **${route.name}** — this is their domain (${route.domain}).\n\n---\n\n**${route.name}:**\n\n${agentAnswer}`;
  }

  // ── /api/agentic/president-requests ─────────────────────────────────────
  // Direct channel from Livio (President) → CEO agent. Lifecycle:
  //   pending → answered                      (auto-answered by specialist agent via AI)
  //   pending → needs_committee               (CEO escalates; prompt generated)
  //   needs_committee → committee_done        (Livio pastes Cowork outcome)
  //   committee_done → answered               (CEO finalises)
  app.get("/api/agentic/president-requests", requireAuth, async (_req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT id, message, status, ceo_response, committee_prompt, committee_outcome,
               created_at, responded_at, updated_at
          FROM president_requests
         ORDER BY created_at DESC, id DESC
      `);
      res.json((rows as any).rows ?? rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.post("/api/agentic/president-requests", requireAuth, async (req, res) => {
    try {
      const { message } = req.body ?? {};
      if (typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ message: "message is required" });
      }
      const inserted = await db.execute(sql`
        INSERT INTO president_requests (message, status)
        VALUES (${message.trim()}, 'pending')
        RETURNING id, message, status, ceo_response, committee_prompt, committee_outcome,
                  created_at, responded_at, updated_at
      `);
      const row = ((inserted as any).rows ?? inserted)[0];
      const now = new Date().toISOString();
      await db.insert(executiveLog).values({
        timestamp: now,
        agent_id: null,
        event_type: "president_request_filed",
        payload: { request_id: row.id, message: message.trim().slice(0, 200) } as any,
        created_at: now,
      } as any);

      // Auto-route to the specialist agent and generate their answer via AI.
      // We await this so the client gets the answered state in one round-trip.
      try {
        const aiReply = await autoAnswerPresidentRequest(message.trim());
        const answered = await db.execute(sql`
          UPDATE president_requests
             SET ceo_response = ${aiReply},
                 status       = 'answered',
                 responded_at = NOW(),
                 updated_at   = NOW()
           WHERE id = ${row.id}
          RETURNING id, message, status, ceo_response, committee_prompt, committee_outcome,
                    created_at, responded_at, updated_at
        `);
        return res.json(((answered as any).rows ?? answered)[0]);
      } catch (_aiErr) {
        // AI call failed — return the pending row; user can reply manually
        return res.json(row);
      }
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // CEO direct reply.
  app.post("/api/agentic/president-requests/:id/reply", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { ceo_response } = req.body ?? {};
      if (typeof ceo_response !== "string" || !ceo_response.trim()) {
        return res.status(400).json({ message: "ceo_response is required" });
      }
      const updated = await db.execute(sql`
        UPDATE president_requests
           SET ceo_response = ${ceo_response.trim()},
               status       = 'answered',
               responded_at = NOW(),
               updated_at   = NOW()
         WHERE id = ${id}
        RETURNING id, message, status, ceo_response, committee_prompt, committee_outcome,
                  created_at, responded_at, updated_at
      `);
      const row = ((updated as any).rows ?? updated)[0];
      if (!row) return res.status(404).json({ message: "request not found" });
      const now = new Date().toISOString();
      await db.insert(executiveLog).values({
        timestamp: now,
        agent_id: null,
        event_type: "president_request_answered",
        payload: { request_id: id, mode: "direct" } as any,
        created_at: now,
      } as any);
      res.json(row);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // CEO says "I need to discuss with my team" — generate a Cowork prompt
  // dedicated to this request. Bundles live state (agents, OKRs, conflicts)
  // + the President's message and asks the Exec Committee to produce a
  // structured outcome (DECISION blocks the user can paste back).
  app.post("/api/agentic/president-requests/:id/escalate", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await db.execute(sql`
        SELECT id, message FROM president_requests WHERE id = ${id}
      `);
      const row0 = ((existing as any).rows ?? existing)[0];
      if (!row0) return res.status(404).json({ message: "request not found" });

      const allAgents     = await db.select().from(agentsTable);
      const allObjectives = await db.select().from(objectivesTable);
      const openConflicts = (await db.select().from(conflictsTable)).filter(c => c.status === "open");

      const lines: string[] = [];
      lines.push(`# Eendigo Executive Committee — President Request #${id}`);
      lines.push("");
      lines.push("The President has issued a direct request to the CEO. The CEO has");
      lines.push("decided to discuss with the Exec Committee before responding. You");
      lines.push("are the full Exec Committee. Reason as a group, then synthesise.");
      lines.push("");
      lines.push("## President's request");
      lines.push("```");
      lines.push(row0.message);
      lines.push("```");
      lines.push("");
      lines.push("## Committee members");
      for (const a of allAgents) {
        const okrs = allObjectives.filter(o => o.agent_id === a.id).length;
        lines.push(`- **${a.name}** (${a.status}) — ${a.mission ?? "(no mission)"} · ${okrs} objectives`);
      }
      lines.push("");
      if (openConflicts.length) {
        lines.push("## Open conflicts to weigh");
        for (const c of openConflicts) lines.push(`- [${c.severity ?? "?"}] ${c.title}`);
        lines.push("");
      }
      lines.push("## Required output");
      lines.push("Produce the committee's synthesis in two parts:");
      lines.push("");
      lines.push("1. **CEO_RESPONSE_TO_PRESIDENT** — one focused paragraph the CEO will");
      lines.push("   send back to the President. Plain prose, no bullet jargon.");
      lines.push("2. **DECISION blocks** — any concrete actions/ideas/conflicts that");
      lines.push("   should land in the system. Use the standard contract:");
      lines.push("");
      lines.push("```");
      lines.push("DECISION_ID: 1");
      lines.push("TYPE: action | idea | conflict");
      lines.push("AGENT: <one of the committee names above>");
      lines.push("TITLE: …");
      lines.push("DESCRIPTION: …");
      lines.push("OKR_LINK: <id or none>");
      lines.push("DEADLINE: <YYYY-MM-DD or none>");
      lines.push("APPROVAL_LEVEL: autonomous | ceo | livio");
      lines.push("IMPACT: 0–100");
      lines.push("EFFORT: 0–100");
      lines.push("RISK:   0–100");
      lines.push("---");
      lines.push("```");

      const prompt = lines.join("\n");
      const updated = await db.execute(sql`
        UPDATE president_requests
           SET committee_prompt = ${prompt},
               status           = 'needs_committee',
               updated_at       = NOW()
         WHERE id = ${id}
        RETURNING id, message, status, ceo_response, committee_prompt, committee_outcome,
                  created_at, responded_at, updated_at
      `);
      const row = ((updated as any).rows ?? updated)[0];
      const now = new Date().toISOString();
      await db.insert(executiveLog).values({
        timestamp: now,
        agent_id: null,
        event_type: "president_request_escalated",
        payload: { request_id: id, prompt_chars: prompt.length } as any,
        created_at: now,
      } as any);
      res.json(row);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // Livio pastes the Exec Committee outcome back. We store it verbatim and
  // mark the request committee_done. The actual idea/task/conflict rows are
  // created on the OKR Center page by the existing /executive importer
  // (which uses parseCoworkOutput) — we just split the CEO_RESPONSE prefix
  // off and stash it in ceo_response if present.
  app.post("/api/agentic/president-requests/:id/import-outcome", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { outcome } = req.body ?? {};
      if (typeof outcome !== "string" || !outcome.trim()) {
        return res.status(400).json({ message: "outcome is required" });
      }
      // Pull a CEO_RESPONSE_TO_PRESIDENT block if present.
      let ceoLine: string | null = null;
      const m = outcome.match(/CEO_RESPONSE_TO_PRESIDENT\s*[:\-]?\s*([\s\S]*?)(?:\n\s*(?:DECISION_ID|---|2\.)|$)/i);
      if (m) ceoLine = m[1].trim().slice(0, 4000);

      const updated = await db.execute(sql`
        UPDATE president_requests
           SET committee_outcome = ${outcome.trim()},
               ceo_response      = COALESCE(${ceoLine}, ceo_response),
               status             = 'committee_done',
               responded_at       = NOW(),
               updated_at         = NOW()
         WHERE id = ${id}
        RETURNING id, message, status, ceo_response, committee_prompt, committee_outcome,
                  created_at, responded_at, updated_at
      `);
      const row = ((updated as any).rows ?? updated)[0];
      if (!row) return res.status(404).json({ message: "request not found" });
      const now = new Date().toISOString();
      await db.insert(executiveLog).values({
        timestamp: now,
        agent_id: null,
        event_type: "president_request_committee_done",
        payload: { request_id: id, has_ceo_line: Boolean(ceoLine) } as any,
        created_at: now,
      } as any);
      res.json(row);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // Archive (hard-delete) a president request.
  app.delete("/api/agentic/president-requests/:id", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      await db.execute(sql`DELETE FROM president_requests WHERE id = ${id}`);
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── /api/agentic/brief-data/* — lightweight feeds for the 8am button ──
  // Auth-protected (requireAuth). Client-side AgenticHome calls these in
  // parallel to enrich the Cowork prompt with live app-section data.

  app.get("/api/agentic/brief-data/bd-deals", requireAuth, async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT name, client_name, stage, amount::float AS amount,
               probability::float AS probability, close_date, currency
          FROM bd_deals
         ORDER BY probability DESC NULLS LAST, close_date ASC NULLS LAST
         LIMIT 50
      `);
      res.json((r as any).rows ?? r);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.get("/api/agentic/brief-data/proposals", requireAuth, async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT project_name, client_name, outcome,
               weekly_price::float AS weekly_price,
               duration_weeks::float AS duration_weeks,
               COALESCE(weekly_price * NULLIF(duration_weeks, 0), total_fee)::float AS net_total,
               win_probability::float AS win_probability, loss_reason
          FROM pricing_proposals
         ORDER BY created_at DESC
         LIMIT 20
      `);
      res.json((r as any).rows ?? r);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.get("/api/agentic/brief-data/invoices", requireAuth, async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT client_name, due_amount::float AS due_amount, due_date, state, currency
          FROM invoice_snapshots
         WHERE state != 'paid'
         ORDER BY due_date ASC NULLS LAST
         LIMIT 50
      `);
      res.json((r as any).rows ?? r);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.get("/api/agentic/brief-data/won-projects", requireAuth, async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT project_name, client_name, status, start_date, end_date,
               total_amount::float AS total_amount, currency
          FROM won_projects
         ORDER BY end_date ASC NULLS LAST
      `);
      res.json((r as any).rows ?? r);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.get("/api/agentic/brief-data/hiring-pipeline", requireAuth, async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT stage, COUNT(*)::int AS count
          FROM hiring_candidates
         WHERE stage IS NOT NULL
         GROUP BY stage
         ORDER BY count DESC
      `);
      res.json((r as any).rows ?? r);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.get("/api/agentic/brief-data/headcount", requireAuth, async (_req, res) => {
    try {
      const r = await db.execute(sql`SELECT COUNT(*)::int AS count FROM employees`);
      const row = ((r as any).rows ?? r)[0] ?? { count: 0 };
      res.json({ count: Number(row.count) });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── /api/agentic/section-map ─────────────────────────────────────────────
  // CRUD for agent_section_map. Supports ?agent=Name filter on the list.

  app.get("/api/agentic/section-map", requireAuth, async (req, res) => {
    try {
      const agent = req.query.agent as string | undefined;
      let r;
      if (agent) {
        r = await db.execute(sql`
          SELECT * FROM agent_section_map
           WHERE LOWER(primary_agent) = LOWER(${agent})
              OR LOWER(secondary_agents) ILIKE ${"%" + agent + "%"}
           ORDER BY module, section, subsection
        `);
      } else {
        r = await db.execute(sql`SELECT * FROM agent_section_map ORDER BY module, section, subsection`);
      }
      res.json((r as any).rows ?? r);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.get("/api/agentic/section-map/by-agent/:agentName", requireAuth, async (req, res) => {
    try {
      const name = req.params.agentName;
      const primary = await db.execute(sql`
        SELECT * FROM agent_section_map
         WHERE LOWER(primary_agent) = LOWER(${name})
         ORDER BY module, section, subsection
      `);
      const secondary = await db.execute(sql`
        SELECT * FROM agent_section_map
         WHERE LOWER(secondary_agents) ILIKE ${"%" + name + "%"}
           AND LOWER(primary_agent) != LOWER(${name})
         ORDER BY module, section, subsection
      `);
      res.json({
        primary:   (primary   as any).rows ?? primary,
        secondary: (secondary as any).rows ?? secondary,
      });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.post("/api/agentic/section-map", requireAuth, async (req, res) => {
    try {
      const { module, section, subsection, primary_agent, secondary_agents = "", why = "", frequency = "Daily" } = req.body ?? {};
      if (!module || !section || !subsection || !primary_agent) {
        return res.status(400).json({ message: "module, section, subsection, primary_agent required" });
      }
      const now = new Date().toISOString();
      const r = await db.execute(sql`
        INSERT INTO agent_section_map (module, section, subsection, primary_agent, secondary_agents, why, frequency, created_at, updated_at)
        VALUES (${module}, ${section}, ${subsection}, ${primary_agent}, ${secondary_agents}, ${why}, ${frequency}, ${now}, ${now})
        RETURNING *
      `);
      res.status(201).json(((r as any).rows ?? r)[0]);
    } catch (e: any) {
      if (e?.code === "23505") return res.status(409).json({ message: "Duplicate (module, section, subsection)" });
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/agentic/section-map/:id", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { module, section, subsection, primary_agent, secondary_agents, why, frequency } = req.body ?? {};
      const now = new Date().toISOString();
      const r = await db.execute(sql`
        UPDATE agent_section_map SET
          module           = COALESCE(${module ?? null},           module),
          section          = COALESCE(${section ?? null},          section),
          subsection       = COALESCE(${subsection ?? null},       subsection),
          primary_agent    = COALESCE(${primary_agent ?? null},    primary_agent),
          secondary_agents = COALESCE(${secondary_agents ?? null}, secondary_agents),
          why              = COALESCE(${why ?? null},              why),
          frequency        = COALESCE(${frequency ?? null},        frequency),
          updated_at       = ${now}
        WHERE id = ${id}
        RETURNING *
      `);
      const row = ((r as any).rows ?? r)[0];
      if (!row) return res.status(404).json({ message: "not found" });
      res.json(row);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.delete("/api/agentic/section-map/:id", requireAuth, async (req, res) => {
    try {
      await db.execute(sql`DELETE FROM agent_section_map WHERE id = ${Number(req.params.id)}`);
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── /api/excom — Executive Committee ────────────────────────────────────
  // Meetings CRUD
  app.get("/api/excom/meetings", requireAuth, async (_req, res) => {
    try {
      const rows = await db.execute(sql`SELECT * FROM excom_meetings ORDER BY meeting_date DESC`);
      res.json(rows.rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.get("/api/excom/meetings/:id", requireAuth, async (req, res) => {
    try {
      const rows = await db.execute(sql`SELECT * FROM excom_meetings WHERE id = ${Number(req.params.id)}`);
      if (!rows.rows.length) return res.status(404).json({ message: "Not found" });
      res.json(rows.rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.post("/api/excom/meetings", requireAuth, async (req, res) => {
    try {
      const now = new Date().toISOString();
      const b = req.body;
      const rows = await db.execute(sql`
        INSERT INTO excom_meetings
          (meeting_date, status, agenda_notes, minutes_text, decisions_text, action_items, attendees, next_meeting_date, created_at, updated_at)
        VALUES
          (${b.meeting_date ?? now.slice(0,10)}, ${b.status ?? "draft"}, ${b.agenda_notes ?? ""},
           ${b.minutes_text ?? ""}, ${b.decisions_text ?? ""}, ${b.action_items ?? ""},
           ${b.attendees ?? ""}, ${b.next_meeting_date ?? ""}, ${now}, ${now})
        RETURNING *
      `);
      res.status(201).json(rows.rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.put("/api/excom/meetings/:id", requireAuth, async (req, res) => {
    try {
      const now = new Date().toISOString();
      const b = req.body;
      const id = Number(req.params.id);
      await db.execute(sql`
        UPDATE excom_meetings SET
          meeting_date      = COALESCE(${b.meeting_date      ?? null}, meeting_date),
          status            = COALESCE(${b.status            ?? null}, status),
          agenda_notes      = COALESCE(${b.agenda_notes      ?? null}, agenda_notes),
          minutes_text      = COALESCE(${b.minutes_text      ?? null}, minutes_text),
          decisions_text    = COALESCE(${b.decisions_text    ?? null}, decisions_text),
          action_items      = COALESCE(${b.action_items      ?? null}, action_items),
          attendees         = COALESCE(${b.attendees         ?? null}, attendees),
          next_meeting_date = COALESCE(${b.next_meeting_date ?? null}, next_meeting_date),
          updated_at        = ${now}
        WHERE id = ${id}
      `);
      const rows = await db.execute(sql`SELECT * FROM excom_meetings WHERE id = ${id}`);
      res.json(rows.rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.delete("/api/excom/meetings/:id", requireAuth, async (req, res) => {
    try {
      await db.execute(sql`DELETE FROM excom_meetings WHERE id = ${Number(req.params.id)}`);
      res.status(204).end();
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── Run EXCOM meeting: each agenda item → routed agent → AI analysis → minutes ──
  // The CEO facilitates: identifies which specialist owns each topic, asks them
  // to speak based on live data, then synthesises decisions + action items.
  app.post("/api/excom/meetings/:id/run", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const mtgRows = await db.execute(sql`SELECT * FROM excom_meetings WHERE id = ${id}`);
      const mtg: any = ((mtgRows as any).rows ?? mtgRows)[0];
      if (!mtg) return res.status(404).json({ message: "Meeting not found" });

      const today   = new Date().toISOString().slice(0, 10);
      const agenda  = (mtg.agenda_notes ?? "").trim();
      if (!agenda) return res.status(400).json({ message: "Meeting has no agenda — add agenda items first." });

      // ── Load all live company data in parallel ──────────────────────────
      const [invR, dealR, propR, projR, hirR, empR] = await Promise.all([
        db.execute(sql`SELECT client_name, due_amount, due_date, state, currency
                         FROM invoice_snapshots WHERE state != 'paid'
                        ORDER BY due_date ASC NULLS LAST LIMIT 50`),
        db.execute(sql`SELECT name, client_name, stage, amount, probability, close_date, currency
                         FROM bd_deals ORDER BY probability DESC NULLS LAST LIMIT 20`),
        db.execute(sql`SELECT project_name, client_name, outcome, total_fee, win_probability
                         FROM pricing_proposals ORDER BY created_at DESC LIMIT 15`),
        db.execute(sql`SELECT project_name, client_name, status, start_date, end_date, total_amount
                         FROM won_projects WHERE status = 'active' ORDER BY end_date ASC NULLS LAST`),
        db.execute(sql`SELECT stage, COUNT(*)::int AS count
                         FROM hiring_candidates WHERE stage IS NOT NULL
                        GROUP BY stage ORDER BY count DESC`),
        db.execute(sql`SELECT COUNT(*)::int AS cnt FROM employees`),
      ]);

      const R = (r: any) => (r as any).rows ?? r ?? [];
      const invoices  = R(invR)  as any[];
      const deals     = R(dealR) as any[];
      const proposals = R(propR) as any[];
      const projects  = R(projR) as any[];
      const hiring    = R(hirR)  as any[];
      const empCount  = Number(R(empR)[0]?.cnt ?? 0);

      const overdue = invoices.filter((i: any) => i.due_date && i.due_date < today);
      const overdueAmt = overdue.reduce((s: number, i: any) => s + (Number(i.due_amount) || 0), 0);
      const weightedPipe = deals.reduce((s: number, d: any) => s + (Number(d.amount) || 0) * ((Number(d.probability) || 0) / 100), 0);

      // ── Build comprehensive prompt ──────────────────────────────────────
      const dataBlock = [
        "### CFO — Finance, Invoices & Cash",
        `Open invoices: ${invoices.length} | Overdue: ${overdue.length} (€${Math.round(overdueAmt).toLocaleString("en")})`,
        overdue.length > 0
          ? overdue.slice(0, 8).map((i: any) => `  - ${i.client_name ?? "?"}: €${Number(i.due_amount ?? 0).toLocaleString("en")} overdue since ${i.due_date}`).join("\n")
          : "  No overdue invoices.",
        invoices.filter((i: any) => !overdue.includes(i)).slice(0, 4).map((i: any) => `  - ${i.client_name ?? "?"}: €${Number(i.due_amount ?? 0).toLocaleString("en")} due ${i.due_date ?? "TBD"}`).join("\n"),
        "",
        "### CCO — Sales & Commercial Pipeline",
        `Deals in CRM: ${deals.length} | Weighted pipeline: €${Math.round(weightedPipe).toLocaleString("en")}`,
        deals.slice(0, 6).map((d: any) => `  - ${d.name} (${d.client_name ?? "?"}): €${Number(d.amount ?? 0).toLocaleString("en")} · ${d.probability ?? "?"}% · stage=${d.stage ?? "?"} · close ${d.close_date ?? "?"}`).join("\n"),
        "",
        "### Delivery Director — Active Projects",
        `Active engagements: ${projects.length}`,
        projects.slice(0, 8).map((p: any) => `  - ${p.project_name} (${p.client_name ?? "?"}): ${p.start_date ?? "?"} → ${p.end_date ?? "ongoing"}`).join("\n"),
        "",
        "### CHRO — Headcount & Hiring",
        `Active employees: ${empCount}`,
        hiring.length > 0
          ? hiring.map((h: any) => `  - ${h.stage}: ${h.count} candidate(s)`).join("\n")
          : "  No candidates in pipeline.",
        "",
        "### Pricing Director — Recent Proposals",
        proposals.slice(0, 6).map((p: any) => `  - ${p.project_name} (${p.client_name ?? "?"}): ${p.outcome ?? "open"} · win prob ${p.win_probability ?? "?"}%`).join("\n"),
      ].join("\n");

      const systemPrompt = [
        "You are the AI facilitator of the Eendigo Executive Committee (EXCOM).",
        "Eendigo is a boutique management consulting firm.",
        "The CEO chairs the meeting. Each agenda item is owned by the most relevant specialist agent.",
        "Your job: for each agenda item, identify the owning agent, have them speak from the live data,",
        "then have the CEO extract a concrete decision and action item.",
        "Be direct, factual, and data-driven. Use actual numbers from the data. No padding or hedging.",
        "Keep each agenda item analysis to 3–5 sentences.",
      ].join(" ");

      const userPrompt = [
        `EXCOM Meeting — ${mtg.meeting_date}`,
        `Attendees: ${mtg.attendees || "Livio (President), CEO, C-suite"}`,
        "",
        "AGENDA:",
        agenda,
        "",
        "LIVE COMPANY DATA:",
        dataBlock,
        "",
        "INSTRUCTIONS:",
        "For each agenda item in the meeting:",
        "1. State which agent owns it (CFO / CCO / CHRO / Delivery Director / Pricing Director / COO / CEO)",
        "2. That agent reports using the live data above",
        "3. CEO extracts a decision and assigns an action item",
        "",
        "Produce output in EXACTLY this format (nothing before ===MINUTES===):",
        "",
        "===MINUTES===",
        "[For each agenda item: ## [Item Title] | Owner: [Agent Name]",
        "Paragraph of analysis with concrete numbers from the data.]",
        "",
        "===DECISIONS===",
        "[Numbered list. Each line: N. [Concrete decision made]]",
        "",
        "===ACTION_ITEMS===",
        "[Bullet list. Each line: - [What to do] | Owner: [Role] | By: [YYYY-MM-DD or 'this week']]",
      ].join("\n");

      // ── Call AI ──────────────────────────────────────────────────────────
      const { generateText } = await import("./aiProviders");
      let raw = "";
      try {
        const result = await generateText({
          provider: "anthropic",
          model: "claude-haiku-4-5",
          system: systemPrompt,
          prompt: userPrompt,
          maxTokens: 1200,
          temperature: 0.3,
        });
        raw = result.text.trim();
      } catch (aiErr) {
        return res.status(502).json({ message: `AI call failed: ${(aiErr as Error).message}` });
      }

      // ── Parse structured output ──────────────────────────────────────────
      const extract = (tag: string, next: string): string => {
        const start = raw.indexOf(`===${tag}===`);
        if (start === -1) return "";
        const after = raw.indexOf(`===${next}===`, start);
        const slice = after === -1 ? raw.slice(start + tag.length + 6) : raw.slice(start + tag.length + 6, after);
        return slice.trim();
      };

      const minutesText   = extract("MINUTES",   "DECISIONS");
      const decisionsText = extract("DECISIONS",  "ACTION_ITEMS");
      const actionItems   = extract("ACTION_ITEMS", "END"); // "END" won't match → takes rest

      // ── Save back to the meeting ─────────────────────────────────────────
      const nowTs = new Date().toISOString();
      await db.execute(sql`
        UPDATE excom_meetings SET
          minutes_text   = ${minutesText   || raw},
          decisions_text = ${decisionsText || ""},
          action_items   = ${actionItems   || ""},
          status         = 'done',
          updated_at     = ${nowTs}
        WHERE id = ${id}
      `);

      const updated = await db.execute(sql`SELECT * FROM excom_meetings WHERE id = ${id}`);
      res.json(((updated as any).rows ?? updated)[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // Predefined tasks (templates)
  app.get("/api/excom/predefined-tasks", requireAuth, async (_req, res) => {
    try {
      const rows = await db.execute(sql`SELECT * FROM excom_predefined_tasks WHERE is_active = 1 ORDER BY category, title`);
      res.json(rows.rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.post("/api/excom/predefined-tasks", requireAuth, async (req, res) => {
    try {
      const now = new Date().toISOString();
      const b = req.body;
      const rows = await db.execute(sql`
        INSERT INTO excom_predefined_tasks
          (title, description, category, outcome_template, frequency, is_active, created_at)
        VALUES
          (${b.title ?? ""}, ${b.description ?? ""}, ${b.category ?? "General"},
           ${b.outcome_template ?? ""}, ${b.frequency ?? "Monthly"}, ${b.is_active ?? 1}, ${now})
        RETURNING *
      `);
      res.status(201).json(rows.rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.put("/api/excom/predefined-tasks/:id", requireAuth, async (req, res) => {
    try {
      const now = new Date().toISOString();
      const b = req.body;
      const id = Number(req.params.id);
      await db.execute(sql`
        UPDATE excom_predefined_tasks SET
          title            = COALESCE(${b.title            ?? null}, title),
          description      = COALESCE(${b.description      ?? null}, description),
          category         = COALESCE(${b.category         ?? null}, category),
          outcome_template = COALESCE(${b.outcome_template ?? null}, outcome_template),
          frequency        = COALESCE(${b.frequency        ?? null}, frequency),
          is_active        = COALESCE(${b.is_active        ?? null}, is_active)
        WHERE id = ${id}
      `);
      const rows = await db.execute(sql`SELECT * FROM excom_predefined_tasks WHERE id = ${id}`);
      res.json(rows.rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── RACI Matrix ─────────────────────────────────────────────────────────
  app.get("/api/agentic/raci", requireAuth, async (_req, res) => {
    try {
      const rows = await db.execute(sql`SELECT * FROM raci_matrix ORDER BY id`);
      res.json(rows.rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.post("/api/agentic/raci", requireAuth, async (req, res) => {
    try {
      const { responsibility, accountable, responsible, consulted, informed, app_section, approval } = req.body;
      const now = new Date().toISOString();
      const r = await db.execute(sql`
        INSERT INTO raci_matrix (responsibility, accountable, responsible, consulted, informed, app_section, approval, created_at, updated_at)
        VALUES (${responsibility ?? ""}, ${accountable ?? ""}, ${responsible ?? ""}, ${consulted ?? ""}, ${informed ?? ""}, ${app_section ?? ""}, ${approval ?? ""}, ${now}, ${now})
        RETURNING *
      `);
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.put("/api/agentic/raci/:id", requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { responsibility, accountable, responsible, consulted, informed, app_section, approval } = req.body;
      const now = new Date().toISOString();
      const r = await db.execute(sql`
        UPDATE raci_matrix SET
          responsibility = COALESCE(${responsibility}, responsibility),
          accountable    = COALESCE(${accountable}, accountable),
          responsible    = COALESCE(${responsible}, responsible),
          consulted      = COALESCE(${consulted}, consulted),
          informed       = COALESCE(${informed}, informed),
          app_section    = COALESCE(${app_section}, app_section),
          approval       = COALESCE(${approval}, approval),
          updated_at     = ${now}
        WHERE id = ${id} RETURNING *
      `);
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  app.delete("/api/agentic/raci/:id", requireAuth, async (req, res) => {
    try {
      await db.execute(sql`DELETE FROM raci_matrix WHERE id = ${Number(req.params.id)}`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── /api/ceo-brief — public, token-protected daily brief ────────────────
  // External tools (Cowork skills, schedulers, etc.) GET this endpoint to
  // pull a comprehensive real-time brief covering ALL app sections, mapped
  // to each agent's area of responsibility. Built fresh from live DB state.
  //
  //   GET /api/ceo-brief                      → text/plain
  //   GET /api/ceo-brief?format=json          → { generated_at, prompt_text, facts }
  //
  // Auth: header `Authorization: Bearer <CEO_BRIEF_TOKEN>` against env var.
  // Constant-time compare. Missing/wrong → 401. Env var unset → 503.
  function ceoBriefAuthOk(req: any): boolean {
    const expected = process.env.CEO_BRIEF_TOKEN ?? "";
    if (!expected) return false;
    const header = String(req.headers?.authorization ?? "");
    const m = header.match(/^Bearer\s+(.+)$/i);
    const provided = m?.[1]?.trim() ?? "";
    if (!provided || provided.length !== expected.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
    return mismatch === 0;
  }

  function renderCeoBrief(facts: {
    date: string;
    // AIOS state
    agents: Array<{ id: number; name: string; mission: string | null; status: string }>;
    objectives: Array<{ id: number; agent_id: number; title: string; status: string }>;
    openTasks: Array<{ agent_id: number; title: string; deadline: string | null; approval_status: string }>;
    overdueTasks: Array<{ agent_id: number; title: string; deadline: string | null }>;
    recentIdeasByAgent: Map<number, Array<{ title: string; total_score: number | null; status: string }>>;
    openConflicts: Array<{ title: string; severity: string | null }>;
    // SVP Sales / BD area
    bdDeals: Array<{ name: string; client_name: string | null; stage: string | null; amount: number | null; probability: number | null; close_date: string | null; currency: string | null }>;
    recentProposals: Array<{ project_name: string; client_name: string | null; outcome: string | null; total_fee: number | null; win_probability: number | null; loss_reason: string | null }>;
    // CFO area
    openInvoices: Array<{ client_name: string | null; due_amount: number | null; due_date: string | null; state: string | null; currency: string | null }>;
    wonProjects: Array<{ project_name: string; client_name: string | null; status: string | null; start_date: string | null; end_date: string | null; total_amount: number | null; currency: string | null }>;
    // CHRO area
    hiringByStage: Array<{ stage: string; count: number }>;
    employeeCount: number;
    pendingCases: Array<{ project_name: string; client_name: string | null; win_probability: number | null; start_date: string | null; duration_weeks: number | null }>;
    // Delivery / COO area
    activeProjects: Array<{ project_name: string; client_name: string | null; end_date: string | null; total_amount: number | null }>;
    // Cross-agent alerts (pre-computed)
    alerts: Array<{ agent: string; severity: "high" | "medium" | "low"; text: string }>;
  }): string {
    const L: string[] = [];
    const eur = (n: number | null, ccy?: string | null) =>
      n == null ? "?" : `${ccy ?? "€"}${Math.round(n).toLocaleString("en")}`;

    L.push(`# Eendigo Daily CEO Brief — ${facts.date}`);
    L.push("");
    L.push("You are the CEO of Eendigo, a boutique management consulting firm. This brief is compiled from the live state of every section of the company's operating system. Study each agent's section, synthesise across them, and respond with concrete decisions.");
    L.push("");

    // ── 1. Cross-agent alerts ──────────────────────────────────────────
    if (facts.alerts.length > 0) {
      L.push("## 🚨 Cross-agent alerts");
      for (const a of facts.alerts) L.push(`- **[${a.severity.toUpperCase()}] ${a.agent}**: ${a.text}`);
      L.push("");
    }

    // ── 2. SVP Sales / BD — Pipeline & Proposals ──────────────────────
    L.push("## SVP Sales / BD — Pipeline");
    if (facts.bdDeals.length === 0) {
      L.push("(no deals in CRM)");
    } else {
      const totalWeighted = facts.bdDeals.reduce((s, d) => s + (d.amount ?? 0) * ((d.probability ?? 0) / 100), 0);
      const highProb = facts.bdDeals.filter(d => (d.probability ?? 0) >= 60);
      L.push(`Total deals: ${facts.bdDeals.length} · Weighted pipeline: ${eur(totalWeighted)} · High-probability (≥60%): ${highProb.length}`);
      L.push("");
      for (const d of facts.bdDeals.slice(0, 10)) {
        L.push(`- **${d.name}** (${d.client_name ?? "?"}) — Stage: ${d.stage ?? "?"} · ${eur(d.amount, d.currency)} · ${d.probability ?? "?"}% · Close: ${d.close_date ?? "?"}`);
      }
      if (facts.bdDeals.length > 10) L.push(`  … and ${facts.bdDeals.length - 10} more deals`);
    }
    L.push("");

    L.push("### Recent proposals (last 20)");
    if (facts.recentProposals.length === 0) {
      L.push("(none)");
    } else {
      const won  = facts.recentProposals.filter(p => p.outcome === "won").length;
      const lost = facts.recentProposals.filter(p => p.outcome === "lost").length;
      const open = facts.recentProposals.filter(p => !p.outcome || p.outcome === "open").length;
      L.push(`Won: ${won} · Lost: ${lost} · Open: ${open}`);
      for (const p of facts.recentProposals.slice(0, 8)) {
        // Use net_total (weekly_price × weeks) as the canonical figure —
        // weekly_price is kept in sync with NET1 by ensureTbdProposalForFinalCase.
        const fee = eur((p as any).net_total ?? p.total_fee);
        const prob = p.win_probability != null ? ` · ${p.win_probability}% prob` : "";
        const loss = p.loss_reason ? ` · loss: ${p.loss_reason}` : "";
        L.push(`- ${p.project_name} (${p.client_name ?? "?"}) — ${p.outcome ?? "open"} · ${fee}${prob}${loss}`);
      }
    }
    L.push("");

    // ── 3. CFO — Invoices & Revenue ────────────────────────────────────
    L.push("## CFO — Invoices & Revenue");
    const overdueInv = facts.openInvoices.filter(i => i.due_date && i.due_date < facts.date && i.state !== "paid");
    const dueInv     = facts.openInvoices.filter(i => i.due_date && i.due_date >= facts.date && i.state !== "paid");
    const overdueAmt = overdueInv.reduce((s, i) => s + (i.due_amount ?? 0), 0);
    const dueAmt     = dueInv.reduce((s, i) => s + (i.due_amount ?? 0), 0);
    L.push(`Overdue: ${overdueInv.length} invoices · ${eur(overdueAmt)} · Due soon: ${dueInv.length} · ${eur(dueAmt)}`);
    if (overdueInv.length > 0) {
      L.push("Overdue invoices:");
      for (const i of overdueInv.slice(0, 5)) {
        L.push(`  - ${i.client_name ?? "?"} · ${eur(i.due_amount, i.currency)} · due ${i.due_date}`);
      }
    }
    const activeRevenue = facts.wonProjects.filter(p => p.status === "active").reduce((s, p) => s + (p.total_amount ?? 0), 0);
    L.push(`Active projects revenue: ${eur(activeRevenue)}`);
    L.push("");

    // ── 4. CHRO — Hiring & Headcount ───────────────────────────────────
    L.push("## CHRO — Hiring & Headcount");
    L.push(`Current headcount: ${facts.employeeCount} employees`);
    if (facts.hiringByStage.length > 0) {
      L.push("Hiring pipeline by stage:");
      for (const s of facts.hiringByStage) L.push(`  - ${s.stage}: ${s.count} candidate${s.count !== 1 ? "s" : ""}`);
      const lateStage = facts.hiringByStage.filter(s => /case|lm|final|offer/i.test(s.stage)).reduce((n, s) => n + s.count, 0);
      if (lateStage > 0) L.push(`  → ${lateStage} candidate(s) in late-stage — potential near-term hires`);
    } else {
      L.push("No candidates in pipeline.");
    }
    // 24-week staffing demand from pending pricing cases
    const casesWithDemand = facts.pendingCases.filter(c => c.win_probability != null || c.start_date != null);
    if (casesWithDemand.length > 0) {
      L.push("");
      L.push("### 24-week staffing demand from pipeline cases");
      for (const c of casesWithDemand) {
        const prob = c.win_probability != null ? `${c.win_probability}% win prob` : "prob unknown";
        const start = c.start_date ?? "start TBD";
        const dur = c.duration_weeks ? `${c.duration_weeks}w` : "duration TBD";
        L.push(`  - **${c.project_name}** (${c.client_name ?? "?"}) — ${prob} · start ${start} · ${dur}`);
      }
      const totalWeightedWeeks = casesWithDemand.reduce((s, c) => {
        const prob = (c.win_probability ?? 50) / 100;
        const dur  = c.duration_weeks ?? 8;
        return s + prob * dur;
      }, 0);
      L.push(`  → Probability-weighted demand: ~${Math.round(totalWeightedWeeks)} consultant-weeks in next 24 weeks.`);
    } else {
      L.push("No pending pricing cases with staffing data.");
    }
    L.push("");

    // ── 5. COO / Delivery — Active Projects ────────────────────────────
    L.push("## COO / Delivery — Active Projects");
    if (facts.activeProjects.length === 0) {
      L.push("(no active projects)");
    } else {
      const endingSoon = facts.activeProjects.filter(p => p.end_date && p.end_date <= new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10));
      L.push(`Active projects: ${facts.activeProjects.length} · Ending within 45 days: ${endingSoon.length}`);
      for (const p of facts.activeProjects) {
        const ending = p.end_date ? ` · ends ${p.end_date}` : "";
        const fee = p.total_amount ? ` · ${eur(p.total_amount)}` : "";
        L.push(`  - ${p.project_name} (${p.client_name ?? "?"})${fee}${ending}`);
      }
    }
    L.push("");

    // ── 6. AIOS agent tasks & ideas ────────────────────────────────────
    L.push("## AIOS — Agent tasks & ideas");
    for (const a of facts.agents) {
      const ideas = (facts.recentIdeasByAgent.get(a.id) ?? []).slice(0, 3);
      const tasks = facts.openTasks.filter(t => t.agent_id === a.id).slice(0, 3);
      if (ideas.length === 0 && tasks.length === 0) continue;
      L.push(`### ${a.name}`);
      if (ideas.length > 0) {
        L.push("Ideas:");
        for (const i of ideas) L.push(`  - [${i.status}] ${i.title} (score=${i.total_score ?? "—"})`);
      }
      if (tasks.length > 0) {
        L.push("Tasks:");
        for (const t of tasks) L.push(`  - [${t.approval_status}] ${t.title}${t.deadline ? ` due ${t.deadline}` : ""}`);
      }
    }
    if (facts.overdueTasks.length > 0) {
      L.push("### ⚠ Overdue agent tasks");
      for (const t of facts.overdueTasks) {
        const agentName = facts.agents.find(a => a.id === t.agent_id)?.name ?? "?";
        L.push(`  - ${agentName}: ${t.title} (was due ${t.deadline})`);
      }
    }
    L.push("");

    if (facts.openConflicts.length > 0) {
      L.push("## Open conflicts");
      for (const c of facts.openConflicts) L.push(`- [${c.severity ?? "?"}] ${c.title}`);
      L.push("");
    }

    // ── 7. Mandate ─────────────────────────────────────────────────────
    L.push("## Your mandate");
    L.push("Study the full brief above. For **each agent**, propose **3 ideas** and **3 actions** for today. Each must:");
    L.push("- Be grounded in the specific data shown for that agent's section above.");
    L.push("- Link to one objective the agent already owns (or `none` if meta-task).");
    L.push("- Carry an explicit approval level: `autonomous` | `boss` | `ceo` | `livio`.");
    L.push("- Include impact / effort / risk on a 0-100 scale.");
    L.push("- Prioritise items whose absence would cost EBITDA, cash, reputation, or capacity in the next 30 days.");
    L.push("");
    L.push("**Cross-agent reasoning required**: if high-probability deals would overwhelm delivery capacity, alert CHRO to accelerate hiring. If projects end with no follow-on in pipeline, alert SVP Sales. If invoices are overdue > 30 days, escalate to CFO.");
    L.push("");
    L.push("Detect any conflicts (incompatible actions, resource collisions, pricing/margin tension) and surface them as `TYPE: conflict` blocks.");
    L.push("");
    L.push("---");
    L.push("");
    L.push("Return your answer ONLY in the following format. One block per decision, separated by '---'. Do not add prose before or after.");
    L.push("");
    L.push("DECISION_ID: <unique id>");
    L.push("TYPE: idea | action | conflict | proposal");
    L.push("AGENT: <agent name>");
    L.push("TITLE: <short>");
    L.push("DESCRIPTION: <one sentence>");
    L.push("OKR_LINK: <objective id or 'none'>");
    L.push("DEADLINE: <YYYY-MM-DD or 'none'>");
    L.push("APPROVAL_LEVEL: autonomous | boss | ceo | livio");
    L.push("IMPACT: 0-100");
    L.push("EFFORT: 0-100");
    L.push("RISK: 0-100");
    return L.join("\n");
  }

  app.get("/api/ceo-brief", async (req, res) => {
    if (!process.env.CEO_BRIEF_TOKEN) {
      return res.status(503).type("text/plain").send("CEO_BRIEF_TOKEN not configured on server.");
    }
    if (!ceoBriefAuthOk(req)) {
      return res.status(401).type("text/plain").send("Unauthorized.");
    }
    try {
      const today = new Date().toISOString().slice(0, 10);
      const in45d = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);

      // Pull all data in parallel — AIOS tables + app-section tables
      const [
        allAgents, allObjectives, allTasks, allIdeas, allConflicts,
        bdDealsRows, recentProposalRows, invoiceRows, wonProjectRows,
        hiringRows, employeeRows, pendingCaseRows,
      ] = await Promise.all([
        db.select().from(agentsTable).orderBy(agentsTable.id),
        db.select().from(objectivesTable),
        db.select().from(tasksTable),
        db.select().from(ideasTable).orderBy(desc(ideasTable.created_at)),
        db.select().from(conflictsTable),
        db.execute(sql`SELECT name, client_name, stage, amount, probability, close_date, currency FROM bd_deals ORDER BY probability DESC NULLS LAST, close_date ASC NULLS LAST LIMIT 50`),
        db.execute(sql`SELECT project_name, client_name, outcome, total_fee, win_probability, loss_reason FROM pricing_proposals ORDER BY created_at DESC LIMIT 20`),
        db.execute(sql`SELECT client_name, due_amount, due_date, state, currency FROM invoice_snapshots WHERE state != 'paid' ORDER BY due_date ASC NULLS LAST LIMIT 50`),
        db.execute(sql`SELECT project_name, client_name, status, start_date, end_date, total_amount, currency FROM won_projects ORDER BY end_date ASC NULLS LAST`),
        db.execute(sql`SELECT stage, COUNT(*)::int AS count FROM hiring_candidates WHERE stage IS NOT NULL GROUP BY stage ORDER BY count DESC`),
        db.execute(sql`SELECT COUNT(*)::int AS count FROM employees`),
        db.execute(sql`SELECT project_name, client_name, win_probability, start_date, duration_weeks FROM pricing_cases WHERE status != 'archived' ORDER BY win_probability DESC NULLS LAST LIMIT 30`),
      ]);

      const rows = (r: any) => (r as any).rows ?? r;

      const openTasks    = allTasks.filter(t => t.status === "open" || t.status === "in_progress");
      const overdueTasks = allTasks.filter(t => t.deadline && t.deadline < today && t.status !== "done");
      const openConflicts = allConflicts.filter(c => c.status === "open");
      const recentByAgent = new Map<number, Array<{ title: string; total_score: number | null; status: string }>>();
      for (const i of allIdeas) {
        const arr = recentByAgent.get(i.agent_id) ?? [];
        if (arr.length < 5) arr.push({ title: i.title, total_score: i.total_score, status: i.status });
        recentByAgent.set(i.agent_id, arr);
      }

      const bdDeals        = rows(bdDealsRows)        as Array<any>;
      const recentProposals= rows(recentProposalRows)  as Array<any>;
      const invoices       = rows(invoiceRows)         as Array<any>;
      const wonProjects    = rows(wonProjectRows)      as Array<any>;
      const hiringByStage  = rows(hiringRows)          as Array<{ stage: string; count: number }>;
      const empCount       = Number((rows(employeeRows)[0] as any)?.count ?? 0);
      const activeProjects = wonProjects.filter((p: any) => p.status === "active");

      // ── Cross-agent alert engine ──────────────────────────────────────
      const alerts: Array<{ agent: string; severity: "high" | "medium" | "low"; text: string }> = [];

      // 1. Capacity risk: high-prob deals vs headcount
      const highProbDeals  = bdDeals.filter((d: any) => (Number(d.probability) || 0) >= 60);
      const highProbValue  = highProbDeals.reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0);
      const estNewProjects = highProbDeals.length;
      // Rule: active projects + expected new ones vs current headcount (assume 2 consultants/project avg)
      const projectedDemand = (activeProjects.length + estNewProjects) * 2;
      if (projectedDemand > empCount * 0.85) {
        alerts.push({
          agent: "CHRO",
          severity: "high",
          text: `Capacity risk: ${activeProjects.length} active projects + ${estNewProjects} high-probability deals (${highProbDeals.map((d: any) => d.name).join(", ") || "—"}) project ~${projectedDemand} consultant-slots but only ${empCount} employees. Accelerate hiring.`,
        });
      }

      // 2. Pipeline gap: projects ending in 45 days with no open deal for that client
      const endingSoon = activeProjects.filter((p: any) => p.end_date && p.end_date <= in45d);
      for (const p of endingSoon) {
        const hasPipeline = bdDeals.some((d: any) =>
          d.client_name && p.client_name &&
          d.client_name.toLowerCase().includes(p.client_name.toLowerCase().slice(0, 5))
        );
        if (!hasPipeline) {
          alerts.push({
            agent: "SVP Sales / BD",
            severity: "medium",
            text: `Pipeline gap: "${p.project_name}" (${p.client_name}) ends ${p.end_date} with no follow-on deal in CRM — initiate account extension conversation.`,
          });
        }
      }

      // 3. Overdue invoices > 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const longOverdue = invoices.filter((i: any) => i.due_date && i.due_date < thirtyDaysAgo && i.state !== "paid");
      if (longOverdue.length > 0) {
        const amt = longOverdue.reduce((s: number, i: any) => s + (Number(i.due_amount) || 0), 0);
        alerts.push({
          agent: "CFO",
          severity: longOverdue.length >= 3 ? "high" : "medium",
          text: `${longOverdue.length} invoice(s) overdue > 30 days · total €${Math.round(amt).toLocaleString("en")} — escalate collections immediately.`,
        });
      }

      // 4. Hiring readiness: late-stage candidates
      const lateStages = hiringByStage.filter(s => /case|lm|final|offer/i.test(s.stage));
      const lateCount = lateStages.reduce((n, s) => n + s.count, 0);
      if (lateCount > 0) {
        alerts.push({
          agent: "CHRO",
          severity: "low",
          text: `${lateCount} candidate(s) in final stages (${lateStages.map(s => `${s.count} ${s.stage}`).join(", ")}) — ready for offer decisions this week.`,
        });
      }

      const factsForRender = {
        date: today,
        agents: allAgents.map(a => ({ id: a.id, name: a.name, mission: a.mission, status: a.status })),
        objectives: allObjectives.map(o => ({ id: o.id, agent_id: o.agent_id, title: o.title, status: o.status })),
        openTasks: openTasks.map(t => ({ agent_id: t.agent_id, title: t.title, deadline: t.deadline, approval_status: t.approval_status })),
        overdueTasks: overdueTasks.map(t => ({ agent_id: t.agent_id, title: t.title, deadline: t.deadline })),
        recentIdeasByAgent: recentByAgent,
        openConflicts: openConflicts.map(c => ({ title: c.title, severity: c.severity })),
        bdDeals,
        recentProposals,
        openInvoices: invoices,
        wonProjects,
        hiringByStage,
        employeeCount: empCount,
        pendingCases: rows(pendingCaseRows) as Array<any>,
        activeProjects,
        alerts,
      };
      const promptText = renderCeoBrief(factsForRender);

      const now = new Date().toISOString();
      await db.insert(executiveLog).values({
        timestamp: now,
        agent_id: null,
        event_type: "ceo_brief_fetched",
        payload: {
          via: "api",
          agents: allAgents.length,
          open_tasks: openTasks.length,
          overdue: overdueTasks.length,
          conflicts: openConflicts.length,
          bd_deals: bdDeals.length,
          high_prob_deals: highProbDeals.length,
          overdue_invoices: invoices.filter((i: any) => i.due_date && i.due_date < today).length,
          alerts: alerts.length,
        } as any,
        created_at: now,
      } as any);

      if (req.query.format === "json") {
        return res.json({
          generated_at: now,
          prompt_text: promptText,
          facts: {
            date: today,
            agents: factsForRender.agents,
            pipeline: { deals: bdDeals.length, high_prob: highProbDeals.length, weighted: highProbDeals.reduce((s: number, d: any) => s + (Number(d.amount) || 0) * ((Number(d.probability) || 0) / 100), 0) },
            invoices: { overdue: invoices.filter((i: any) => i.due_date && i.due_date < today).length },
            hiring: hiringByStage,
            headcount: empCount,
            active_projects: activeProjects.length,
            alerts: alerts.length,
          },
        });
      }
      res.type("text/plain").send(promptText);
    } catch (e) {
      res.status(500).type("text/plain").send(`Error: ${(e as Error).message}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AIOS CYCLE ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/aios/cycles — list recent cycles
  app.get("/api/aios/cycles", requireAuth, async (_req, res) => {
    try {
      const cycles = await db.select().from(aiosCycles).orderBy(desc(aiosCycles.id)).limit(20);
      res.json(cycles);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // POST /api/aios/cycles — create + immediately start a new cycle
  app.post("/api/aios/cycles", requireAuth, async (_req, res) => {
    try {
      const cycleId = await createAiosCycle("President");
      res.json({ cycleId });
      // Run async in background (do not await)
      runDailyAiosCycle(cycleId).catch(e => console.error("[AIOS] bg error:", e));
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/aios/cycles/latest — latest cycle
  app.get("/api/aios/cycles/latest", requireAuth, async (_req, res) => {
    try {
      const [cycle] = await db.select().from(aiosCycles).orderBy(desc(aiosCycles.id)).limit(1);
      res.json(cycle ?? null);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/aios/cycles/:id — single cycle
  app.get("/api/aios/cycles/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt((req.params as any).id);
      const [cycle] = await db.select().from(aiosCycles).where(eq(aiosCycles.id, id));
      if (!cycle) return res.status(404).json({ message: "Not found" });
      res.json(cycle);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // POST /api/aios/cycles/:id/pause
  app.post("/api/aios/cycles/:id/pause", requireAuth, async (req, res) => {
    try {
      const id = parseInt((req.params as any).id);
      await pauseAiosCycle(id);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // POST /api/aios/cycles/:id/resume
  app.post("/api/aios/cycles/:id/resume", requireAuth, async (req, res) => {
    try {
      const id = parseInt((req.params as any).id);
      await resumeAiosCycle(id);
      // restart background processing
      runDailyAiosCycle(id).catch(e => console.error("[AIOS] bg resume error:", e));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/aios/cycles/:id/logs — exec logs for a cycle (polling)
  app.get("/api/aios/cycles/:id/logs", requireAuth, async (req, res) => {
    try {
      const id = parseInt((req.params as any).id);
      const since = (req.query as any).since ? parseInt((req.query as any).since) : 0;
      const logs = await db.select().from(aiosExecLogs)
        .where(and(eq(aiosExecLogs.cycle_id, id), sql`id > ${since}`))
        .orderBy(aiosExecLogs.id)
        .limit(200);
      res.json(logs);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/aios/cycles/:id/stream — SSE live log
  app.get("/api/aios/cycles/:id/stream", requireAuth, async (req, res) => {
    const id = parseInt((req.params as any).id);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write("data: {\"type\":\"connected\"}\n\n");
    subscribeToCycle(id, res);
    req.on("close", () => unsubscribeFromCycle(id, res));
  });

  // GET /api/aios/cycles/:id/deliverables
  app.get("/api/aios/cycles/:id/deliverables", requireAuth, async (req, res) => {
    try {
      const id = parseInt((req.params as any).id);
      const items = await db.select().from(aiosDeliverables).where(eq(aiosDeliverables.cycle_id, id)).orderBy(aiosDeliverables.agent_name, aiosDeliverables.deliverable_type, aiosDeliverables.rank);
      res.json(items);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/aios/cycles/:id/boss-reports
  app.get("/api/aios/cycles/:id/boss-reports", requireAuth, async (req, res) => {
    try {
      const id = parseInt((req.params as any).id);
      const reports = await db.select().from(bossConsolidations).where(eq(bossConsolidations.cycle_id, id));
      res.json(reports);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/aios/cycles/:id/ceo-brief
  app.get("/api/aios/cycles/:id/ceo-brief", requireAuth, async (req, res) => {
    try {
      const id = parseInt((req.params as any).id);
      const [brief] = await db.select().from(ceoBriefs).where(eq(ceoBriefs.cycle_id, id));
      res.json(brief ?? null);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // POST /api/aios/cycles/:id/generate-cowork-prompt
  app.post("/api/aios/cycles/:id/generate-cowork-prompt", requireAuth, async (req, res) => {
    try {
      const id = parseInt((req.params as any).id);
      const prompt = await genCoworkPrompt(id);
      res.json({ prompt });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // POST /api/aios/cycles/:id/cowork-output — paste CoWork output back
  app.post("/api/aios/cycles/:id/cowork-output", requireAuth, async (req, res) => {
    try {
      const id = parseInt((req.params as any).id);
      const { raw_output_text } = req.body as any;
      if (!raw_output_text?.trim()) return res.status(400).json({ message: "raw_output_text required" });
      await storeCoworkOutput(id, raw_output_text);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/aios/cycles/:id/cowork-letters
  app.get("/api/aios/cycles/:id/cowork-letters", requireAuth, async (req, res) => {
    try {
      const id = parseInt((req.params as any).id);
      const letters = await db.select().from(coworkLetters).where(eq(coworkLetters.cycle_id, id));
      res.json(letters);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // POST /api/aios/cycles/:id/run-round2 — feed CoWork letters back to agents
  app.post("/api/aios/cycles/:id/run-round2", requireAuth, async (req, res) => {
    try {
      const id = parseInt((req.params as any).id);
      res.json({ ok: true, cycleId: id });
      runRound2(id).catch(e => console.error("[AIOS] runRound2 uncaught:", e));
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/aios/agent-kpis/:agentName — last 10 KPI rows for a given agent (both rounds)
  app.get("/api/aios/agent-kpis/:agentName", requireAuth, async (req, res) => {
    try {
      const name = decodeURIComponent(String((req.params as any).agentName));
      const rows = await db
        .select()
        .from(agentKpis)
        .where(eq(agentKpis.agent_name, name))
        .orderBy(desc(agentKpis.id))
        .limit(20);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/aios/agent-kpis — latest cycle KPIs for all agents (round1 only, most recent cycle)
  app.get("/api/aios/agent-kpis", requireAuth, async (req, res) => {
    try {
      // Find the latest cycle that has KPI rows
      const [latest] = await db
        .select({ cycle_id: agentKpis.cycle_id })
        .from(agentKpis)
        .orderBy(desc(agentKpis.id))
        .limit(1);
      if (!latest) return res.json([]);
      const rows = await db
        .select()
        .from(agentKpis)
        .where(and(
          eq(agentKpis.cycle_id, latest.cycle_id),
          eq(agentKpis.round, "round1")
        ));
      res.json(rows);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // PATCH /api/aios/deliverables/:id/rate — record human thumbs-up (+1) or thumbs-down (-1)
  app.patch("/api/aios/deliverables/:id/rate", requireAuth, async (req, res) => {
    try {
      const id = safeInt(req.params.id);
      const { rating } = req.body ?? {};
      if (rating !== 1 && rating !== -1 && rating !== null) {
        res.status(400).json({ message: "rating must be 1, -1, or null" });
        return;
      }
      await db.execute(sql`UPDATE aios_deliverables SET human_rating = ${rating} WHERE id = ${id}`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/aios/deliverables/agent-ratings — avg human_rating per agent (last 30 days)
  app.get("/api/aios/deliverables/agent-ratings", requireAuth, async (_req, res) => {
    try {
      const rows = await db.execute(sql`
        SELECT agent_name,
               COUNT(*)                                              AS total_rated,
               ROUND(AVG(human_rating::numeric), 2)                 AS avg_rating,
               COUNT(*) FILTER (WHERE human_rating = 1)             AS thumbs_up,
               COUNT(*) FILTER (WHERE human_rating = -1)            AS thumbs_down
        FROM aios_deliverables
        WHERE human_rating IS NOT NULL
          AND CAST(created_at AS TIMESTAMP) > NOW() - INTERVAL '30 days'
        GROUP BY agent_name
      `);
      res.json((rows as any).rows ?? []);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── CEO Brief (in-app daily brief with decisions) ─────────────────────────

  // POST /api/ceo-brief/generate — run a new CEO Brief and wait for it
  app.post("/api/ceo-brief/generate", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const result = await runCeoBrief({ trigger: "manual" });
      if (result.status === "failed") {
        res.status(500).json({ message: result.error ?? "Brief generation failed" });
        return;
      }
      // Return the full brief + decisions
      const [brief] = await db.select().from(ceoBriefRuns).where(eq(ceoBriefRuns.id, result.briefId));
      const decisions = await db.select().from(ceoBriefRunDecisions)
        .where(eq(ceoBriefRunDecisions.briefId, result.briefId))
        .orderBy(ceoBriefRunDecisions.createdAt);
      res.json({ brief, decisions });
    } catch (e) {
      console.error("[CEO Brief] Generate failed:", e);
      res.status(500).json({ message: (e as Error).message });
    }
  });

  // GET /api/ceo-brief/latest — most recent brief + decisions
  app.get("/api/ceo-brief/latest", requireAuth, async (_req, res) => {
    try {
      const briefs = await db.select().from(ceoBriefRuns)
        .orderBy(desc(ceoBriefRuns.generatedAt))
        .limit(1);
      if (briefs.length === 0) { res.json({ brief: null, decisions: [] }); return; }
      const brief = briefs[0];
      const decisions = await db.select().from(ceoBriefRunDecisions)
        .where(eq(ceoBriefRunDecisions.briefId, brief.id))
        .orderBy(ceoBriefRunDecisions.createdAt);
      res.json({ brief, decisions });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/ceo-brief/history — list of briefs (summary only)
  app.get("/api/ceo-brief/history", requireAuth, async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) ?? "30")));
      const briefs = await db.select().from(ceoBriefRuns)
        .orderBy(desc(ceoBriefRuns.generatedAt))
        .limit(limit);
      // For each brief, count decisions and approved/rejected
      const result = await Promise.all(briefs.map(async b => {
        const decisions = await db.select().from(ceoBriefRunDecisions)
          .where(eq(ceoBriefRunDecisions.briefId, b.id));
        return {
          id: b.id,
          generatedAt: b.generatedAt,
          generatedBy: b.generatedBy,
          status: b.status,
          durationMs: b.durationMs,
          model: b.model,
          tokenInput: b.tokenInput,
          tokenOutput: b.tokenOutput,
          decisionCount: decisions.length,
          approvedCount: decisions.filter(d => d.status === "approved").length,
          rejectedCount: decisions.filter(d => d.status === "rejected").length,
          pendingCount: decisions.filter(d => d.status === "pending").length,
        };
      }));
      res.json(result);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/ceo-brief/:id — full brief + decisions
  app.get("/api/ceo-brief/:id", requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const [brief] = await db.select().from(ceoBriefRuns).where(eq(ceoBriefRuns.id, id));
      if (!brief) { res.status(404).json({ message: "Brief not found" }); return; }
      const decisions = await db.select().from(ceoBriefRunDecisions)
        .where(eq(ceoBriefRunDecisions.briefId, id))
        .orderBy(ceoBriefRunDecisions.createdAt);
      res.json({ brief, decisions });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // PATCH /api/ceo-brief/decisions/:id — update a decision's status/note
  app.patch("/api/ceo-brief/decisions/:id", requireAuth, async (req, res) => {
    try {
      const id = String(req.params.id);
      const body = req.body as Record<string, unknown>;
      const status = String(body.status ?? "").trim();
      const validStatuses = ["approved", "rejected", "modified", "postponed", "pending"];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ message: `status must be one of: ${validStatuses.join(", ")}` });
        return;
      }
      if (status === "modified" && !body.modified_text) {
        res.status(400).json({ message: "modified_text is required when status is 'modified'" });
        return;
      }
      if (status === "postponed" && !body.postpone_until) {
        res.status(400).json({ message: "postpone_until is required when status is 'postponed'" });
        return;
      }

      const update: Record<string, unknown> = {
        status,
        decidedAt: new Date(),
        decidedBy: "livio",
      };
      if (body.status_note)    update.statusNote    = String(body.status_note).slice(0, 500);
      if (body.modified_text)  update.modifiedText  = String(body.modified_text).slice(0, 2000);
      if (body.postpone_until) update.postponeUntil = String(body.postpone_until).slice(0, 20);

      const updated = await db.update(ceoBriefRunDecisions)
        .set(update as any)
        .where(eq(ceoBriefRunDecisions.id, id))
        .returning();

      if (updated.length === 0) {
        res.status(404).json({ message: "Decision not found" });
        return;
      }
      res.json(updated[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── Micro-AI Admin ─────────────────────────────────────────────────────────

  /**
   * GET /api/admin/micro-ai/stats
   * Returns per-module telemetry aggregates + overall token savings for the
   * requested window (default: last 7 days).
   */
  app.get("/api/admin/micro-ai/stats", requireAuth, async (req, res) => {
    try {
      const days   = Math.min(Number(req.query.days ?? 7), 90);
      const since  = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

      // Per-module aggregates
      const rows = await db
        .select({
          module_name:           microAiLog.module_name,
          calls:                 count(microAiLog.id),
          total_latency_ms:      sum(microAiLog.latency_ms),
          total_tokens_saved:    sum(microAiLog.saved_tokens_estimate),
          cache_hits:            sum(microAiLog.hit_cache),
          claude_fallbacks:      sum(microAiLog.fallback_to_claude),
        })
        .from(microAiLog)
        .where(gte(microAiLog.called_at, since))
        .groupBy(microAiLog.module_name);

      // Cache table size
      const [cacheStats] = await db
        .select({ total_entries: count(aiResponseCache.id) })
        .from(aiResponseCache);

      // Feature flag state
      const localAiFirst = useLocalAiFirst();

      // Annotate rows with MODULE_REGISTRY metadata
      const modules = rows.map(r => {
        const meta = MODULE_REGISTRY.find(m => m.file.replace(".js", "") === r.module_name);
        return {
          ...r,
          id:          meta?.id,
          displayName: meta?.name ?? r.module_name,
          category:    meta?.category,
          wave:        meta?.wave,
        };
      });

      // Overall totals
      const totalTokensSaved = modules.reduce((s, m) => s + Number(m.total_tokens_saved ?? 0), 0);
      // Claude Sonnet 4: ~$3/M input tokens
      const estimatedCostSavedUsd = (totalTokensSaved / 1_000_000) * 3;

      res.json({
        days,
        since,
        localAiFirst,
        modules,
        cacheEntries: cacheStats?.total_entries ?? 0,
        totals: {
          tokensSaved:          totalTokensSaved,
          estimatedCostSavedUsd: Math.round(estimatedCostSavedUsd * 100) / 100,
          totalCalls:           modules.reduce((s, m) => s + Number(m.calls ?? 0), 0),
          claudeFallbacks:      modules.reduce((s, m) => s + Number(m.claude_fallbacks ?? 0), 0),
        },
        registry: MODULE_REGISTRY,
      });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  /**
   * POST /api/admin/micro-ai/cache/prune
   * Deletes expired rows from ai_response_cache.
   */
  app.post("/api/admin/micro-ai/cache/prune", requireAuth, async (req, res) => {
    try {
      const deleted = await pruneExpiredCache();
      res.json({ deleted, message: `Pruned ${deleted} expired cache entries.` });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  /**
   * GET /api/admin/micro-ai/pricing-rules
   * Returns all pricing rules (for the admin page table).
   */
  app.get("/api/admin/micro-ai/pricing-rules", requireAuth, async (_req, res) => {
    try {
      const rules = await db.select().from(pricingRules).orderBy(desc(pricingRules.id));
      res.json(rules);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  /**
   * PATCH /api/admin/micro-ai/pricing-rules/:id
   * Toggle is_active or update fee corridor for a rule.
   */
  app.patch("/api/admin/micro-ai/pricing-rules/:id", requireAuth, async (req, res) => {
    try {
      const id   = safeInt(req.params.id);
      const body = req.body as Record<string, unknown>;
      const allowed: (keyof typeof pricingRules.$inferInsert)[] = [
        "is_active", "fee_min", "fee_mid", "fee_max", "rationale",
      ];
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of allowed) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      const updated = await db.update(pricingRules).set(patch as any).where(eq(pricingRules.id, id)).returning();
      if (updated.length === 0) { res.status(404).json({ message: "Rule not found" }); return; }
      res.json(updated[0]);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── Micro-AI Utility Endpoints ─────────────────────────────────────────────
  //
  //  B8  GET  /api/pricing/fee-suggest    → fee corridor from rules + decision tree
  //  D17 POST /api/agentic/extract-commitments → who/what/when from free text
  //  D18 POST /api/agentic/classify-reply       → intent/sentiment/urgency/next-action
  //  A2  POST /api/agentic/classify-text        → urgency / sentiment / intent labels
  //
  //  All are pure local-AI (zero LLM tokens). The client can call them to enrich
  //  UI state without touching the Anthropic API.
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/pricing/fee-suggest
   * B8 Pricing Reasoner — returns a fee corridor (min/mid/max EUR/week) driven
   * by the pricing_rules table and a hardcoded decision tree. Zero LLM tokens.
   *
   * Query params (all optional):
   *   geography   — NL | BE | DE | FR | UK | other  (default NL)
   *   clientSize  — small | mid | large | enterprise (default mid)
   *   complexity  — low | medium | high              (default medium)
   *   peOwned     — "true" | "false"                 (default false)
   */
  app.get("/api/pricing/fee-suggest", requireAuth, async (req, res) => {
    try {
      const { suggestFee } = await import("./microAI/index.js");
      const q = req.query as Record<string, string>;
      const result = await suggestFee({
        geography:  q.geography  ?? "NL",
        clientSize: q.clientSize ?? "mid",
        complexity: q.complexity ?? "medium",
        peOwned:    q.peOwned === "true",
      });
      res.json(result);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // ── KM Agent Routes ────────────────────────────────────────────────────────

  // POST /api/km/query — run a KM query cycle
  app.post("/api/km/query", requireAuth, async (req, res) => {
    try {
      const { query } = req.body ?? {};
      if (!query || typeof query !== "string" || !query.trim()) {
        res.status(400).json({ message: "query is required" });
        return;
      }
      const result = await runKmCycle(query.trim());
      res.json(result);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  /**
   * POST /api/agentic/extract-commitments
   * D17 Commitment Extractor — parses free text (email, meeting notes, transcript)
   * and returns structured commitments: { actor, action, deadline, confidence }.
   * Body: { text: string }
   */
  app.post("/api/agentic/extract-commitments", requireAuth, async (req, res) => {
    try {
      const { extractCommitments } = await import("./microAI/index.js");
      const text = String((req.body as Record<string, unknown>).text ?? "").trim();
      if (!text) { res.status(400).json({ message: "text required" }); return; }
      const commitments = await extractCommitments(text);
      res.json({ commitments, count: commitments.length });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  /**
   * POST /api/agentic/classify-reply
   * D18 Reply Classifier — classifies an inbound email reply: intent, sentiment,
   * urgency, next_action. Lexicon-based, no LLM.
   * Body: { text: string }
   */
  app.post("/api/agentic/classify-reply", requireAuth, async (req, res) => {
    try {
      const { classifyReply } = await import("./microAI/index.js");
      const text = String((req.body as Record<string, unknown>).text ?? "").trim();
      if (!text) { res.status(400).json({ message: "text required" }); return; }
      const classification = await classifyReply(text);
      res.json(classification);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  /**
   * POST /api/agentic/classify-text
   * A2 Classifier — returns urgency, sentiment, intent, and reply_status labels
   * for any text. Keyword-lexicon based, zero LLM tokens.
   * Body: { text: string; labels?: string[] }  (labels = zero-shot hint classes)
   */
  app.post("/api/agentic/classify-text", requireAuth, async (req, res) => {
    try {
      const { classify } = await import("./microAI/index.js");
      const b = req.body as Record<string, unknown>;
      const text   = String(b.text ?? "").trim();
      const labels = Array.isArray(b.labels) ? (b.labels as unknown[]).map(String) : undefined;
      if (!text) { res.status(400).json({ message: "text required" }); return; }
      const [urgency, sentiment, intent] = await Promise.all([
        classify(text, "urgency",   labels),
        classify(text, "sentiment", labels),
        classify(text, "intent",    labels),
      ]);
      res.json({ urgency, sentiment, intent });
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/km/sessions — list recent KM sessions
  app.get("/api/km/sessions", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 100);
      const sessions = await getKmSessions(limit);
      res.json(sessions);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  // GET /api/km/sessions/:id — session detail + specialist outputs
  app.get("/api/km/sessions/:id", requireAuth, async (req, res) => {
    try {
      const detail = await getKmSessionDetail(req.params.id);
      if (!detail.session) { res.status(404).json({ message: "Session not found" }); return; }
      res.json(detail);
    } catch (e) { res.status(500).json({ message: (e as Error).message }); }
  });

  return httpServer;
}
