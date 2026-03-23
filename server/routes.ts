import type { Express } from "express";
import { createServer, type Server } from "http";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { insertEmployeeSchema, DEFAULT_BENCHMARK, type BenchmarkRow } from "@shared/schema";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // ── Employees ──────────────────────────────────────────────────────────────
  app.get("/api/employees", requireAuth, async (_req, res) => {
    const emps = await storage.getEmployees();
    res.json(emps);
  });

  app.post("/api/employees", requireAuth, async (req, res) => {
    const data = insertEmployeeSchema.parse(req.body);
    const emp = await storage.createEmployee(data);
    res.status(201).json(emp);
  });

  app.put("/api/employees/:id", requireAuth, async (req, res) => {
    const { id } = req.params;
    const data = insertEmployeeSchema.partial().parse(req.body);
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
    const entry = await storage.updateSalaryHistoryEntry(parseInt(req.params.id), req.body);
    res.json(entry);
  });

  app.delete("/api/salary-history/:id", requireAuth, async (req, res) => {
    await storage.deleteSalaryHistoryEntry(parseInt(req.params.id));
    res.status(204).end();
  });

  // ── Days Off ───────────────────────────────────────────────────────────────
  app.get("/api/days-off", requireAuth, async (req, res) => {
    const year = req.query.year ? parseInt(req.query.year as string) : undefined;
    const entries = await storage.getDaysOff(year);
    res.json(entries);
  });

  app.post("/api/days-off", requireAuth, async (req, res) => {
    const entry = await storage.createDaysOff(req.body);
    res.status(201).json(entry);
  });

  app.delete("/api/days-off/:id", requireAuth, async (req, res) => {
    await storage.deleteDaysOff(parseInt(req.params.id));
    res.status(204).end();
  });

  return httpServer;
}
