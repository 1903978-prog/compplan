import type { Express } from "express";
import { createServer, type Server } from "http";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { insertEmployeeSchema, DEFAULT_BENCHMARK, type BenchmarkRow } from "@shared/schema";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "child_process";

function safeInt(val: string): number {
  const n = parseInt(val, 10);
  if (isNaN(n)) throw Object.assign(new Error("Invalid ID"), { status: 400 });
  return n;
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

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

  // ── Benchmark ──────────────────────────────────────────────────────────────
  // POST /api/benchmark/refresh  → runs web search via Claude, returns proposed changes (no save yet)
  app.post("/api/benchmark/refresh", requireAuth, async (_req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "ANTHROPIC_API_KEY not set on server" });
      return;
    }
    try {
      const client = new Anthropic({ apiKey });
      const currentSettings = await storage.getSettings();
      const current: BenchmarkRow[] = (currentSettings as any).benchmark_data?.length
        ? (currentSettings as any).benchmark_data
        : DEFAULT_BENCHMARK;

      const prompt = `You are a salary research assistant. Search the web for the most current (2024-2025) Italian management consulting / strategy consulting salary benchmarks by years of experience (1-5 years), focusing on reputable sources like McKinsey, BCG, Bain, Deloitte, PwC, KPMG, EY, Accenture salary surveys, Glassdoor Italy, LinkedIn Salary Italy, Mercer Italy, Willis Towers Watson Italy, or similar.

Return ONLY a JSON array with exactly 5 rows (tenure_years 1-5), with these columns in k€ gross annual:
- gen_p10, gen_median, gen_p75 (general consulting roles)
- strat_p10, strat_median, strat_p75 (strategy/top-tier consulting roles)

Current values for reference:
${JSON.stringify(current, null, 2)}

Return ONLY valid JSON array, no explanation:`;

      const message = await client.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305" as any, name: "web_search", max_uses: 5 }],
        messages: [{ role: "user", content: prompt }],
      });

      // Extract JSON from the response
      let proposed: BenchmarkRow[] = current;
      for (const block of message.content) {
        if (block.type === "text") {
          const match = block.text.match(/\[[\s\S]*\]/);
          if (match) {
            try { proposed = JSON.parse(match[0]); } catch {}
          }
        }
      }

      // Build diff: list only changed cells
      const changes: { tenure_years: number; field: string; old: number; new: number }[] = [];
      for (const proposed_row of proposed) {
        const cur_row = current.find(r => r.tenure_years === proposed_row.tenure_years);
        if (!cur_row) continue;
        const fields: (keyof BenchmarkRow)[] = ["gen_p10","gen_median","gen_p75","strat_p10","strat_median","strat_p75"];
        for (const f of fields) {
          if (proposed_row[f] !== cur_row[f]) {
            changes.push({ tenure_years: proposed_row.tenure_years, field: f, old: cur_row[f] as number, new: proposed_row[f] as number });
          }
        }
      }

      res.json({ proposed, current, changes });
    } catch (err: any) {
      res.status(500).json({ error: String(err.message ?? err) });
    }
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

  app.post("/api/pricing/cases", requireAuth, async (req, res) => {
    const c = await storage.createPricingCase(req.body);
    res.status(201).json(c);
  });

  app.put("/api/pricing/cases/:id", requireAuth, async (req, res) => {
    const c = await storage.updatePricingCase(safeInt(req.params.id), req.body);
    res.json(c);
  });

  app.delete("/api/pricing/cases/:id", requireAuth, async (req, res) => {
    await storage.deletePricingCase(safeInt(req.params.id));
    res.status(204).end();
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
    await storage.deletePricingProposal(safeInt(req.params.id));
    res.status(204).end();
  });

  // ── AI Pricing Suggestion ──────────────────────────────────────────────────
  app.post("/api/pricing/ai-suggest", requireAuth, async (req, res) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(503).json({ error: "ANTHROPIC_API_KEY not set on server" }); return; }
    const anthropic = new Anthropic({ apiKey });
    const { currentCase, proposals } = req.body as {
      currentCase: {
        region: string;
        pe_owned: boolean;
        revenue_band: string;
        price_sensitivity: string;
        duration_weeks: number;
        staffing: { role_name: string; days_per_week: number; daily_rate_used: number; count: number }[];
        fund_name?: string;
        engineBaseline?: number;
        engineLow?: number;
        engineTarget?: number;
        engineHigh?: number;
      };
      proposals: {
        project_name?: string;
        client_name?: string;
        fund_name?: string;
        region: string;
        pe_owned: boolean;
        revenue_band: string;
        weekly_price: number;
        duration_weeks?: number;
        outcome: string;
        notes?: string;
      }[];
    };

    const wonProposals = proposals.filter(p => p.outcome === "won");
    const lostProposals = proposals.filter(p => p.outcome === "lost");

    const fmtP = (p: typeof proposals[0]) =>
      `  - ${p.project_name || "Project"}${p.fund_name ? ` [${p.fund_name}]` : ""}: €${p.weekly_price.toLocaleString()}/wk${p.duration_weeks ? `, ${p.duration_weeks}w` : ""}, ${p.region}, ${p.pe_owned ? "PE" : "Non-PE"}, ${p.revenue_band}${p.notes ? ` — "${p.notes}"` : ""}`;

    const staffingDesc = currentCase.staffing
      .map(s => `${s.count > 1 ? s.count + "× " : ""}${s.role_name} ${s.days_per_week}d/wk @€${s.daily_rate_used.toLocaleString()}/day`)
      .join(", ");

    const prompt = `You are a senior pricing advisor for a management consulting firm specialising in PE-backed transformation projects.

## Historical deal database

WON deals (${wonProposals.length}):
${wonProposals.length ? wonProposals.map(fmtP).join("\n") : "  (none on record yet)"}

LOST deals (${lostProposals.length}):
${lostProposals.length ? lostProposals.map(fmtP).join("\n") : "  (none on record yet)"}

## Engagement to price

- Region: ${currentCase.region}
- PE-owned client: ${currentCase.pe_owned ? "Yes" : "No"}
- Revenue band: ${currentCase.revenue_band}
- Price sensitivity: ${currentCase.price_sensitivity}
- Duration: ${currentCase.duration_weeks} weeks
- Staffing: ${staffingDesc}${currentCase.fund_name ? `\n- Fund: ${currentCase.fund_name}` : ""}
- Internal engine range: Low €${(currentCase.engineLow ?? 0).toLocaleString()} · Target €${(currentCase.engineTarget ?? 0).toLocaleString()} · High €${(currentCase.engineHigh ?? 0).toLocaleString()}/week

## Task

Based on the historical deal data and engagement profile above, return a JSON object (no markdown, no explanation outside the JSON) with this exact shape:
{
  "suggested_low": <number — weekly €>,
  "suggested_high": <number — weekly €>,
  "win_probability_pct": <number 0-100>,
  "recommendation": "low" | "target" | "high",
  "risks": [<string>, <string>],
  "reasoning": "<2-3 sentences citing specific data points from the history>"
}`;

    try {
      const message = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });
      const text = message.content[0].type === "text" ? message.content[0].text : "{}";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      res.json(JSON.parse(jsonMatch[0]));
    } catch (err) {
      console.error("AI suggest error:", err);
      res.status(500).json({ error: String(err) });
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
    res.json(await storage.updateHiringCandidate(safeInt(req.params.id), req.body));
  });

  app.delete("/api/hiring/candidates/:id", requireAuth, async (req, res) => {
    await storage.deleteHiringCandidate(safeInt(req.params.id));
    res.status(204).end();
  });

  // ── AI Smart Paste ─────────────────────────────────────────────────────────

  app.post("/api/ai/parse-employee-data", requireAuth, async (req, res) => {
    const { text, employees, tests } = req.body as {
      text: string;
      employees: { id: string; name: string }[];
      tests: { id: string; name: string }[];
    };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(503).json({ error: "ANTHROPIC_API_KEY not set on server" }); return; }
    const anthropic = new Anthropic({ apiKey });
    const today = new Date().toISOString().slice(0, 10);
    const year = new Date().getFullYear();

    const prompt = `You are an HR data extraction assistant. Extract structured employee data from the pasted text.

Today: ${today}. Current year: ${year}.

Known employees:
${employees.map(e => `  - "${e.name}" (id: ${e.id})`).join("\n")}

Known tests (with their IDs):
${tests.map(t => `  - "${t.name}" (id: ${t.id})`).join("\n")}

Pasted text:
"""
${text}
"""

Return ONLY a valid JSON object (no markdown, no explanation):
{
  "employee_id": "<id from the list above, or null if not identified>",
  "employee_name": "<name as found in text>",
  "tests": [{"id": "<test id>", "name": "<test name>", "score": <0-100 number or null if passed/failed only>}],
  "days_off": [{"days": <number>, "start_date": "<YYYY-MM-DD or null>", "end_date": "<YYYY-MM-DD or null>", "note": "<description>"}],
  "monthly_rating": {"month": "<YYYY-MM>", "score": <1-10 number>} or null,
  "unrecognized": "<any info that could not be mapped>"
}

Rules:
- Match employee name case-insensitively to the known list
- Match test names case-insensitively; "passed" without score means score=100, "failed"=0
- Days off: infer count and dates from context; year defaults to ${year}
- Monthly rating: only if explicitly mentioned as a performance score/rating 1-10
- Return empty arrays [] when nothing found, not null`;

    try {
      const message = await anthropic.messages.create({
        model: "claude-opus-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });

      const raw = (message.content[0] as { type: string; text: string }).text.trim();
      const parsed = JSON.parse(raw);
      res.json(parsed);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? "Parse failed" });
    }
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
  app.get("/api/admin/download-backup", requireAuth, async (_req, res) => {
    const [employees, settings, pricingCases, pricingProposals, hiringCandidates] = await Promise.all([
      storage.getEmployees(),
      storage.getPricingSettings(),
      storage.getPricingCases(),
      storage.getPricingProposals().catch(() => []),
      storage.getHiringCandidates(),
    ]);

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="compplan-backup-${date}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      employees,
      pricingSettings: settings,
      pricingCases,
      pricingProposals,
      hiringCandidates,
    });
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
