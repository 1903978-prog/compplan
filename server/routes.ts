import type { Express } from "express";
import { createServer, type Server } from "http";
import { requireAuth } from "./auth";
import { storage } from "./storage";
import { insertEmployeeSchema, type BenchmarkRow } from "@shared/schema";
import { z } from "zod";
import { spawn } from "child_process";

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

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // ── API Pause Toggle ──────────────────────────────────────────────────────
  app.get("/api/api-pause", requireAuth, async (_req, res) => {
    const paused = await checkApiPaused();
    res.json({ paused });
  });

  app.put("/api/api-pause", requireAuth, async (req, res) => {
    const { paused } = req.body;
    const { db } = await import("./db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`UPDATE app_settings SET api_paused = ${paused ? 1 : 0} WHERE id = 1`);
    res.json({ paused: !!paused });
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

  // ── Proposals ──────────────────────────────────────────────────────────────
  app.get("/api/proposals", requireAuth, async (_req, res) => {
    res.json(await storage.getProposals());
  });

  app.get("/api/proposals/:id", requireAuth, async (req, res) => {
    const p = await storage.getProposal(safeInt(req.params.id));
    if (!p) { res.status(404).json({ message: "Not found" }); return; }
    res.json(p);
  });

  app.post("/api/proposals", requireAuth, async (req, res) => {
    const p = await storage.createProposal(req.body);
    res.status(201).json(p);
  });

  app.put("/api/proposals/:id", requireAuth, async (req, res) => {
    const p = await storage.updateProposal(safeInt(req.params.id), req.body);
    res.json(p);
  });

  app.delete("/api/proposals/:id", requireAuth, async (req, res) => {
    await storage.deleteProposal(safeInt(req.params.id));
    res.status(204).end();
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

  app.post("/api/proposals/:id/analyze", requireAuth, async (req, res) => {
    try {
      if (await guardApiAsync(res)) return;
      const id = safeInt(req.params.id);
      const proposal = await storage.getProposal(id);
      if (!proposal) { res.status(404).json({ message: "Not found" }); return; }

      const { analyzeProposal } = await import("./proposalAI");
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
      if (await guardApiAsync(res)) return;
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
