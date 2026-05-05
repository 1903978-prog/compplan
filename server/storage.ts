import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  employees, roleGridEntries, appSettings, daysOffEntries, salaryHistoryEntries,
  pricingSettingsTable, pricingCases, pricingProposals, hiringCandidates, employeeTasks,
  performanceIssues, timeTrackingTopics, timeTrackingEntries,
  proposals, proposalTemplates, slideMethodologyConfigs, deckTemplateConfigs, projectTypeSlideDefaults,
  slideBackgrounds, slideTemplates, wonProjects,
  type Employee, type InsertEmployee,
  type AdminSettings, type RoleGridRow, type DaysOffEntry, type SalaryHistoryEntry,
  type EmployeeTask, type PerformanceIssue,
  type TimeTrackingTopic, type TimeTrackingEntry,
  type Proposal, type ProposalTemplate,
  type SlideMethodologyConfig,
  type DeckTemplateConfig,
  type SlideBackground,
  type SlideTemplate,
} from "@shared/schema";

export interface IStorage {
  // Employees
  getEmployees(): Promise<Employee[]>;
  getEmployee(id: string): Promise<Employee | undefined>;
  createEmployee(emp: InsertEmployee): Promise<Employee>;
  updateEmployee(id: string, emp: Partial<InsertEmployee>): Promise<Employee>;
  deleteEmployee(id: string): Promise<void>;
  retireEmployee(id: string): Promise<void>;
  unretireEmployee(id: string): Promise<void>;

  // Role grid
  getRoleGrid(): Promise<RoleGridRow[]>;
  replaceRoleGrid(rows: RoleGridRow[]): Promise<RoleGridRow[]>;

  // Settings
  getSettings(): Promise<AdminSettings>;
  updateSettings(data: Partial<AdminSettings>): Promise<AdminSettings>;

  // Days off
  getDaysOff(year?: number): Promise<DaysOffEntry[]>;
  createDaysOff(entry: Omit<DaysOffEntry, "id">): Promise<DaysOffEntry>;
  deleteDaysOff(id: number): Promise<void>;

  // Salary history
  getSalaryHistory(employeeId: string): Promise<SalaryHistoryEntry[]>;
  createSalaryHistoryEntry(entry: Omit<SalaryHistoryEntry, "id">): Promise<SalaryHistoryEntry>;
  updateSalaryHistoryEntry(id: number, patch: Partial<SalaryHistoryEntry>): Promise<SalaryHistoryEntry>;
  deleteSalaryHistoryEntry(id: number): Promise<void>;

  // Pricing
  getPricingSettings(): Promise<Record<string, any>>;
  upsertPricingSettings(data: Record<string, any>): Promise<Record<string, any>>;
  getPricingCases(): Promise<any[]>;
  getPricingCase(id: number): Promise<any | undefined>;
  createPricingCase(data: any): Promise<any>;
  updatePricingCase(id: number, data: any): Promise<any>;
  deletePricingCase(id: number): Promise<void>;
  getPricingProposals(): Promise<any[]>;
  createPricingProposal(data: any): Promise<any>;
  updatePricingProposal(id: number, data: any): Promise<any>;
  deletePricingProposal(id: number): Promise<void>;

  // Hiring
  getHiringCandidates(): Promise<any[]>;
  createHiringCandidate(data: any): Promise<any>;
  updateHiringCandidate(id: number, data: any): Promise<any>;
  deleteHiringCandidate(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getEmployees(): Promise<Employee[]> {
    return db.select().from(employees).orderBy(employees.name);
  }

  async getEmployee(id: string): Promise<Employee | undefined> {
    const rows = await db.select().from(employees).where(eq(employees.id, id));
    return rows[0];
  }

  async createEmployee(emp: InsertEmployee): Promise<Employee> {
    const rows = await db.insert(employees).values(emp).returning();
    return rows[0];
  }

  async updateEmployee(id: string, data: Partial<InsertEmployee>): Promise<Employee> {
    const rows = await db.update(employees).set(data).where(eq(employees.id, id)).returning();
    return rows[0];
  }

  async deleteEmployee(id: string): Promise<void> {
    await db.delete(employees).where(eq(employees.id, id));
  }

  async retireEmployee(id: string): Promise<void> {
    // Look up name first (read-only, outside transaction).
    const rows = await db.select({ name: employees.name }).from(employees).where(eq(employees.id, id)).limit(1);
    const empName: string | null = rows[0]?.name ?? null;

    // Wrap status update + cascade cleanup in one transaction (FIX-7).
    await db.transaction(async (tx) => {
      await tx.update(employees)
        .set({ status: "former", retired_at: new Date().toISOString().slice(0, 10) } as any)
        .where(eq(employees.id, id));

      if (empName) {
        const nameLower = empName.trim().toLowerCase();
        const now = new Date().toISOString();
        await tx.execute(sql`
          UPDATE pricing_proposals
          SET manager_name = NULL
          WHERE LOWER(TRIM(manager_name)) = ${nameLower}
        `);
        await tx.execute(sql`
          UPDATE pricing_proposals
          SET team_members = (
            SELECT COALESCE(jsonb_agg(el), '[]'::jsonb)
            FROM jsonb_array_elements(COALESCE(team_members, '[]'::jsonb)) AS el
            WHERE LOWER(TRIM(el->>'name')) <> ${nameLower}
          )
          WHERE team_members IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(team_members) AS el
              WHERE LOWER(TRIM(el->>'name')) = ${nameLower}
            )
        `);
      }
    });
  }

  async unretireEmployee(id: string): Promise<void> {
    await db.update(employees)
      .set({ status: "active", retired_at: null } as any)
      .where(eq(employees.id, id));
  }

  async getRoleGrid(): Promise<RoleGridRow[]> {
    const rows = await db.select().from(roleGridEntries).orderBy(roleGridEntries.sort_order);
    return rows.map((r) => ({
      role_code: r.role_code,
      role_name: r.role_name,
      next_role_code: r.next_role_code ?? null,
      promo_years_fast: r.promo_years_fast,
      promo_years_normal: r.promo_years_normal,
      promo_years_slow: r.promo_years_slow,
      ral_min_k: r.ral_min_k,
      ral_max_k: r.ral_max_k,
      gross_fixed_min_month: r.gross_fixed_min_month,
      gross_fixed_max_month: r.gross_fixed_max_month,
      bonus_pct: r.bonus_pct,
      meal_voucher_eur_per_day: r.meal_voucher_eur_per_day,
      months_paid: r.months_paid,
    }));
  }

  async replaceRoleGrid(rows: RoleGridRow[]): Promise<RoleGridRow[]> {
    await db.delete(roleGridEntries);
    if (rows.length === 0) return [];
    await db.insert(roleGridEntries).values(
      rows.map((r, i) => ({ ...r, sort_order: i }))
    );
    return this.getRoleGrid();
  }

  private rowToSettings(row: typeof appSettings.$inferSelect): AdminSettings {
    return {
      net_factor: row.net_factor,
      meal_voucher_days_per_month: row.meal_voucher_days_per_month,
      min_promo_increase_pct: row.min_promo_increase_pct,
      promotion_windows: (row.promotion_windows ?? ["01-01", "05-01", "09-01"]) as string[],
      window_tolerance_days: row.window_tolerance_days,
      track_fast_threshold: row.track_fast_threshold ?? 8.5,
      track_slow_threshold: row.track_slow_threshold ?? 7.0,
      tests: (row.tests ?? []) as import("@shared/schema").Test[],
      benchmark_data: (row.benchmark_data ?? []) as import("@shared/schema").BenchmarkRow[],
      benchmark_updated_at: row.benchmark_updated_at ?? null,
    };
  }

  async getSettings(): Promise<AdminSettings> {
    const rows = await db.select().from(appSettings);
    if (rows.length === 0) {
      throw new Error("Settings not seeded");
    }
    return this.rowToSettings(rows[0]);
  }

  async updateSettings(data: Partial<AdminSettings>): Promise<AdminSettings> {
    const rows = await db.update(appSettings).set(data).where(eq(appSettings.id, 1)).returning();
    return this.rowToSettings(rows[0]);
  }

  async getDaysOff(year?: number): Promise<DaysOffEntry[]> {
    const rows = year
      ? await db.select().from(daysOffEntries).where(eq(daysOffEntries.year, year))
      : await db.select().from(daysOffEntries);
    return rows.map((r) => ({
      id: r.id,
      employee_id: r.employee_id,
      type: r.type as "taken" | "carryover",
      year: r.year,
      start_date: r.start_date ?? undefined,
      end_date: r.end_date ?? undefined,
      days: r.days,
      note: r.note ?? undefined,
    }));
  }

  async createDaysOff(entry: Omit<DaysOffEntry, "id">): Promise<DaysOffEntry> {
    const rows = await db.insert(daysOffEntries).values(entry).returning();
    const r = rows[0];
    return { id: r.id, employee_id: r.employee_id, type: r.type as "taken" | "carryover", year: r.year, start_date: r.start_date ?? undefined, end_date: r.end_date ?? undefined, days: r.days, note: r.note ?? undefined };
  }

  async deleteDaysOff(id: number): Promise<void> {
    await db.delete(daysOffEntries).where(eq(daysOffEntries.id, id));
  }

  async getSalaryHistory(employeeId: string): Promise<SalaryHistoryEntry[]> {
    const rows = await db
      .select()
      .from(salaryHistoryEntries)
      .where(eq(salaryHistoryEntries.employee_id, employeeId));
    return rows.map(r => ({
      id: r.id,
      employee_id: r.employee_id,
      effective_date: r.effective_date,
      role_code: r.role_code ?? null,
      gross_fixed_year: r.gross_fixed_year,
      months_paid: r.months_paid ?? null,
      bonus_pct: r.bonus_pct ?? null,
      meal_voucher_daily: r.meal_voucher_daily ?? null,
      note: r.note ?? null,
    }));
  }

  async createSalaryHistoryEntry(entry: Omit<SalaryHistoryEntry, "id">): Promise<SalaryHistoryEntry> {
    const rows = await db.insert(salaryHistoryEntries).values(entry).returning();
    const r = rows[0];
    return {
      id: r.id,
      employee_id: r.employee_id,
      effective_date: r.effective_date,
      role_code: r.role_code ?? null,
      gross_fixed_year: r.gross_fixed_year,
      months_paid: r.months_paid ?? null,
      bonus_pct: r.bonus_pct ?? null,
      meal_voucher_daily: r.meal_voucher_daily ?? null,
      note: r.note ?? null,
    };
  }

  async updateSalaryHistoryEntry(id: number, patch: Partial<SalaryHistoryEntry>): Promise<SalaryHistoryEntry> {
    const rows = await db.update(salaryHistoryEntries).set(patch).where(eq(salaryHistoryEntries.id, id)).returning();
    const r = rows[0];
    return {
      id: r.id,
      employee_id: r.employee_id,
      effective_date: r.effective_date,
      role_code: r.role_code ?? null,
      gross_fixed_year: r.gross_fixed_year,
      months_paid: r.months_paid ?? null,
      bonus_pct: r.bonus_pct ?? null,
      meal_voucher_daily: r.meal_voucher_daily ?? null,
      note: r.note ?? null,
    };
  }

  async deleteSalaryHistoryEntry(id: number): Promise<void> {
    await db.delete(salaryHistoryEntries).where(eq(salaryHistoryEntries.id, id));
  }

  // ── Pricing ────────────────────────────────────────────────────────────────
  async getPricingSettings(): Promise<Record<string, any>> {
    const rows = await db.select().from(pricingSettingsTable);
    return rows.length > 0 ? (rows[0].data as Record<string, any>) : {};
  }

  async upsertPricingSettings(data: Record<string, any>): Promise<Record<string, any>> {
    const rows = await db.select().from(pricingSettingsTable);
    if (rows.length === 0) {
      await db.insert(pricingSettingsTable).values({ data });
    } else {
      await db.update(pricingSettingsTable).set({ data }).where(eq(pricingSettingsTable.id, rows[0].id));
    }
    return data;
  }

  async getPricingCases(): Promise<any[]> {
    return await db.select().from(pricingCases).orderBy(pricingCases.id);
  }

  async getPricingCase(id: number): Promise<any | undefined> {
    const rows = await db.select().from(pricingCases).where(eq(pricingCases.id, id));
    return rows[0];
  }

  async createPricingCase(data: any): Promise<any> {
    const now = new Date().toISOString();
    const rows = await db.insert(pricingCases).values({ ...data, created_at: now, updated_at: now }).returning();
    return rows[0];
  }

  async updatePricingCase(id: number, data: any): Promise<any> {
    const now = new Date().toISOString();
    const rows = await db.update(pricingCases).set({ ...data, updated_at: now }).where(eq(pricingCases.id, id)).returning();
    return rows[0];
  }

  async deletePricingCase(id: number): Promise<void> {
    await db.delete(pricingCases).where(eq(pricingCases.id, id));
  }

  async getPricingProposals(): Promise<any[]> {
    return await db.select().from(pricingProposals).orderBy(pricingProposals.proposal_date);
  }

  async createPricingProposal(data: any): Promise<any> {
    const now = new Date().toISOString();
    const rows = await db.insert(pricingProposals).values({ ...data, created_at: now }).returning();
    return rows[0];
  }

  async updatePricingProposal(id: number, data: any): Promise<any> {
    const rows = await db.update(pricingProposals).set(data).where(eq(pricingProposals.id, id)).returning();
    return rows[0];
  }

  async deletePricingProposal(id: number): Promise<void> {
    await db.delete(pricingProposals).where(eq(pricingProposals.id, id));
  }

  async getHiringCandidates(): Promise<any[]> {
    return await db.select().from(hiringCandidates).orderBy(hiringCandidates.sort_order);
  }

  async createHiringCandidate(data: any): Promise<any> {
    const now = new Date().toISOString();
    const rows = await db.insert(hiringCandidates).values({ ...data, created_at: now }).returning();
    return rows[0];
  }

  async updateHiringCandidate(id: number, data: any): Promise<any> {
    const rows = await db.update(hiringCandidates).set(data).where(eq(hiringCandidates.id, id)).returning();
    return rows[0];
  }

  async deleteHiringCandidate(id: number): Promise<void> {
    await db.delete(hiringCandidates).where(eq(hiringCandidates.id, id));
  }

  // ── Employee Tasks (TDL) ──────────────────────────────────────────────────
  async getEmployeeTasks(): Promise<EmployeeTask[]> {
    const rows = await db.select().from(employeeTasks).orderBy(employeeTasks.created_at);
    return rows as EmployeeTask[];
  }

  async createEmployeeTask(data: Omit<EmployeeTask, "id">): Promise<EmployeeTask> {
    const now = new Date().toISOString();
    const rows = await db.insert(employeeTasks).values({ ...data, created_at: now }).returning();
    return rows[0] as EmployeeTask;
  }

  async updateEmployeeTask(id: number, data: Partial<EmployeeTask>): Promise<EmployeeTask> {
    const rows = await db.update(employeeTasks).set(data).where(eq(employeeTasks.id, id)).returning();
    return rows[0] as EmployeeTask;
  }

  async deleteEmployeeTask(id: number): Promise<void> {
    await db.delete(employeeTasks).where(eq(employeeTasks.id, id));
  }

  // ── Performance Issues ────────────────────────────────────────────────────
  async getPerformanceIssues(): Promise<PerformanceIssue[]> {
    const rows = await db.select().from(performanceIssues).orderBy(performanceIssues.date);
    return rows as PerformanceIssue[];
  }

  async createPerformanceIssue(data: Omit<PerformanceIssue, "id">): Promise<PerformanceIssue> {
    const rows = await db.insert(performanceIssues).values(data).returning();
    return rows[0] as PerformanceIssue;
  }

  async updatePerformanceIssue(id: number, data: Partial<PerformanceIssue>): Promise<PerformanceIssue> {
    const rows = await db.update(performanceIssues).set(data).where(eq(performanceIssues.id, id)).returning();
    return rows[0] as PerformanceIssue;
  }

  async deletePerformanceIssue(id: number): Promise<void> {
    await db.delete(performanceIssues).where(eq(performanceIssues.id, id));
  }

  // ── Time Tracking ─────────────────────────────────────────────────────────
  async getTimeTrackingTopics(): Promise<TimeTrackingTopic[]> {
    const rows = await db.select().from(timeTrackingTopics).orderBy(timeTrackingTopics.sort_order);
    return rows as TimeTrackingTopic[];
  }

  async createTimeTrackingTopic(data: Omit<TimeTrackingTopic, "id">): Promise<TimeTrackingTopic> {
    const rows = await db.insert(timeTrackingTopics).values(data).returning();
    return rows[0] as TimeTrackingTopic;
  }

  async updateTimeTrackingTopic(id: number, data: Partial<TimeTrackingTopic>): Promise<TimeTrackingTopic> {
    const rows = await db.update(timeTrackingTopics).set(data).where(eq(timeTrackingTopics.id, id)).returning();
    return rows[0] as TimeTrackingTopic;
  }

  async deleteTimeTrackingTopic(id: number): Promise<void> {
    await db.delete(timeTrackingTopics).where(eq(timeTrackingTopics.id, id));
  }

  async getTimeTrackingEntries(): Promise<TimeTrackingEntry[]> {
    const rows = await db.select().from(timeTrackingEntries).orderBy(timeTrackingEntries.start_time);
    return rows as TimeTrackingEntry[];
  }

  async createTimeTrackingEntry(data: Omit<TimeTrackingEntry, "id">): Promise<TimeTrackingEntry> {
    const rows = await db.insert(timeTrackingEntries).values(data).returning();
    return rows[0] as TimeTrackingEntry;
  }

  async updateTimeTrackingEntry(id: number, data: Partial<TimeTrackingEntry>): Promise<TimeTrackingEntry> {
    const rows = await db.update(timeTrackingEntries).set(data).where(eq(timeTrackingEntries.id, id)).returning();
    return rows[0] as TimeTrackingEntry;
  }

  async deleteTimeTrackingEntry(id: number): Promise<void> {
    await db.delete(timeTrackingEntries).where(eq(timeTrackingEntries.id, id));
  }

  // ── Proposals ───────────────────────────────────────────────────────────────
  async getProposals() {
    return await db.select().from(proposals).orderBy(proposals.created_at);
  }
  async getProposal(id: number) {
    const rows = await db.select().from(proposals).where(eq(proposals.id, id));
    return rows[0] || null;
  }
  async createProposal(data: any) {
    const now = new Date().toISOString();
    const rows = await db.insert(proposals).values({ ...data, created_at: now, updated_at: now }).returning();
    return rows[0];
  }
  async updateProposal(id: number, data: any) {
    const rows = await db.update(proposals).set({ ...data, updated_at: new Date().toISOString() }).where(eq(proposals.id, id)).returning();
    return rows[0];
  }
  async deleteProposal(id: number) {
    await db.delete(proposals).where(eq(proposals.id, id));
  }
  // Delete every proposal where company_name is null, empty, or whitespace.
  // Used by the cleanup-blank admin endpoint to remove auto-save debris.
  async deleteBlankProposals(): Promise<number> {
    const result: any = await db.execute(
      sql`DELETE FROM proposals WHERE company_name IS NULL OR trim(company_name) = ''`
    );
    // Neon/pg returns rowCount on the command tag.
    return Number(result?.rowCount ?? result?.rows?.length ?? 0);
  }

  // ── Proposal Templates ──────────────────────────────────────────────────────
  async getProposalTemplates() {
    return await db.select().from(proposalTemplates).orderBy(proposalTemplates.uploaded_at);
  }
  async getActiveProposalTemplate() {
    const rows = await db.select().from(proposalTemplates).where(eq(proposalTemplates.is_active, 1));
    return rows[0] || null;
  }
  async createProposalTemplate(data: any) {
    // Deactivate all existing
    await db.update(proposalTemplates).set({ is_active: 0 });
    const rows = await db.insert(proposalTemplates).values({ ...data, is_active: 1, uploaded_at: new Date().toISOString() }).returning();
    return rows[0];
  }
  async activateProposalTemplate(id: number) {
    await db.update(proposalTemplates).set({ is_active: 0 });
    const rows = await db.update(proposalTemplates).set({ is_active: 1 }).where(eq(proposalTemplates.id, id)).returning();
    return rows[0];
  }
  async deleteProposalTemplate(id: number) {
    await db.delete(proposalTemplates).where(eq(proposalTemplates.id, id));
  }

  // ── Slide Methodology Config ──────────────────────────────────────────────
  async getSlideMethodologyConfigs(): Promise<SlideMethodologyConfig[]> {
    return db.select().from(slideMethodologyConfigs);
  }
  async getSlideMethodologyConfig(slideId: string): Promise<SlideMethodologyConfig | undefined> {
    const [row] = await db.select().from(slideMethodologyConfigs).where(eq(slideMethodologyConfigs.slide_id, slideId));
    return row;
  }
  async upsertSlideMethodologyConfig(data: SlideMethodologyConfig): Promise<SlideMethodologyConfig> {
    const existing = await this.getSlideMethodologyConfig(data.slide_id);
    if (existing) {
      const [updated] = await db.update(slideMethodologyConfigs)
        .set(data)
        .where(eq(slideMethodologyConfigs.slide_id, data.slide_id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(slideMethodologyConfigs).values(data).returning();
    return created;
  }
  async deleteSlideMethodologyConfig(slideId: string): Promise<void> {
    await db.delete(slideMethodologyConfigs).where(eq(slideMethodologyConfigs.slide_id, slideId));
  }

  // ── Project Type Slide Defaults ─────────────────────────────────────────────
  async getProjectTypeSlideDefault(projectType: string) {
    const [row] = await db.select().from(projectTypeSlideDefaults).where(eq(projectTypeSlideDefaults.project_type, projectType));
    return row || null;
  }
  async upsertProjectTypeSlideDefault(projectType: string, slideIds: string[], slideOrder: string[]) {
    const existing = await this.getProjectTypeSlideDefault(projectType);
    const now = new Date().toISOString();
    if (existing) {
      const [updated] = await db.update(projectTypeSlideDefaults)
        .set({ slide_ids: slideIds, slide_order: slideOrder, updated_at: now })
        .where(eq(projectTypeSlideDefaults.project_type, projectType))
        .returning();
      return updated;
    }
    const [created] = await db.insert(projectTypeSlideDefaults)
      .values({ project_type: projectType, slide_ids: slideIds, slide_order: slideOrder, updated_at: now })
      .returning();
    return created;
  }

  // ── Slide Backgrounds ─────────────────────────────────────────────────────
  // One row per slide_id, keyed by the MASTER_SLIDES id. `file_data` is a
  // data URL (data:image/png;base64,...) so it can be dropped directly into
  // CSS or an <img>. Kept in a table rather than object storage to stay
  // inside the existing single-DB deploy model.
  async getSlideBackgrounds(): Promise<SlideBackground[]> {
    return db.select().from(slideBackgrounds);
  }
  async getSlideBackground(slideId: string): Promise<SlideBackground | undefined> {
    const [row] = await db.select().from(slideBackgrounds).where(eq(slideBackgrounds.slide_id, slideId));
    return row as SlideBackground | undefined;
  }
  async upsertSlideBackground(data: SlideBackground): Promise<SlideBackground> {
    const existing = await this.getSlideBackground(data.slide_id);
    const now = new Date().toISOString();
    const payload = { ...data, updated_at: now };
    if (existing) {
      const [updated] = await db.update(slideBackgrounds)
        .set(payload)
        .where(eq(slideBackgrounds.slide_id, data.slide_id))
        .returning();
      return updated as SlideBackground;
    }
    const [created] = await db.insert(slideBackgrounds).values(payload).returning();
    return created as SlideBackground;
  }
  async deleteSlideBackground(slideId: string): Promise<void> {
    await db.delete(slideBackgrounds).where(eq(slideBackgrounds.slide_id, slideId));
  }

  // ── Slide Templates (deterministic JSON specs) ────────────────────────────
  // One row per slide_id. `spec` is a JSONB blob — see slideTemplateSpecSchema
  // in shared/schema.ts for the exact shape. The background PNG (if any) is
  // embedded inside `spec.background` as a data URL, not stored separately,
  // so the whole template is self-contained and a single SELECT gets you
  // everything needed to render the slide.
  async getSlideTemplates(): Promise<SlideTemplate[]> {
    return db.select().from(slideTemplates) as unknown as Promise<SlideTemplate[]>;
  }
  async getSlideTemplate(slideId: string): Promise<SlideTemplate | undefined> {
    const [row] = await db.select().from(slideTemplates).where(eq(slideTemplates.slide_id, slideId));
    return row as SlideTemplate | undefined;
  }
  async upsertSlideTemplate(data: SlideTemplate): Promise<SlideTemplate> {
    const existing = await this.getSlideTemplate(data.slide_id);
    const now = new Date().toISOString();
    const payload = { ...data, updated_at: now };
    if (existing) {
      const [updated] = await db.update(slideTemplates)
        .set(payload)
        .where(eq(slideTemplates.slide_id, data.slide_id))
        .returning();
      return updated as SlideTemplate;
    }
    const [created] = await db.insert(slideTemplates).values(payload).returning();
    return created as SlideTemplate;
  }
  async deleteSlideTemplate(slideId: string): Promise<void> {
    await db.delete(slideTemplates).where(eq(slideTemplates.slide_id, slideId));
  }

  // ── Deck Template Config ──────────────────────────────────────────────────
  async getDeckTemplateConfig(): Promise<DeckTemplateConfig | null> {
    const rows = await db.select().from(deckTemplateConfigs);
    return rows[0] || null;
  }
  async upsertDeckTemplateConfig(data: Partial<DeckTemplateConfig>): Promise<DeckTemplateConfig> {
    const existing = await this.getDeckTemplateConfig();
    if (existing) {
      const [updated] = await db.update(deckTemplateConfigs)
        .set({ ...data, updated_at: new Date().toISOString() })
        .where(eq(deckTemplateConfigs.id, existing.id!))
        .returning();
      return updated;
    }
    const [created] = await db.insert(deckTemplateConfigs)
      .values({ ...data, updated_at: new Date().toISOString() } as any)
      .returning();
    return created;
  }
}

export const storage = new DatabaseStorage();

// ── Trash Bin / Soft-Delete Layer ──────────────────────────────────────
// Wraps DELETE on whitelisted tables. The full row is copied to
// trash_bin (JSONB snapshot) then removed from the source table. Items
// auto-expire after 30 days unless restored. Restore re-INSERTs the
// snapshot back into the source.
//
// Adding a new table to the safety net:
//   1. Import its Drizzle table object
//   2. Add an entry to TRASH_REGISTRY below
//   3. Replace `db.delete(table).where(eq(table.id, id))` calls in
//      routes.ts with `await trashAndDelete("<table_name>", id)`
//
// SAFETY: only tables in TRASH_REGISTRY can be operated on, so the
// table-name parameter cannot be used for SQL injection.

interface TrashEntry {
  table: any;          // Drizzle table object
  pk: any;             // Drizzle column for the primary key
  pkType: "int" | "text";
  displayType: string; // Human-readable label shown in the UI
  nameField?: string;  // Column whose value labels the row in the UI
}

const TRASH_REGISTRY: Record<string, TrashEntry> = {
  pricing_cases:        { table: pricingCases,         pk: pricingCases.id,         pkType: "int",  displayType: "Pricing Case",       nameField: "project_name" },
  pricing_proposals:    { table: pricingProposals,     pk: pricingProposals.id,     pkType: "int",  displayType: "Past Project",       nameField: "project_name" },
  hiring_candidates:    { table: hiringCandidates,     pk: hiringCandidates.id,     pkType: "int",  displayType: "Candidate",          nameField: "name" },
  proposals:            { table: proposals,            pk: proposals.id,            pkType: "int",  displayType: "Proposal Deck",      nameField: "company_name" },
  won_projects:         { table: wonProjects,          pk: wonProjects.id,          pkType: "int",  displayType: "Won Project",        nameField: "project_name" },
  // ── Added: previously hard-deleted endpoints now soft-delete to trash
  employees:            { table: employees,            pk: employees.id,            pkType: "text", displayType: "Employee",           nameField: "name" },
  salary_history:       { table: salaryHistoryEntries, pk: salaryHistoryEntries.id, pkType: "int",  displayType: "Salary History",     nameField: "effective_date" },
  days_off_entries:     { table: daysOffEntries,       pk: daysOffEntries.id,       pkType: "int",  displayType: "Days Off",           nameField: "start_date" },
  employee_tasks:       { table: employeeTasks,        pk: employeeTasks.id,        pkType: "int",  displayType: "Employee Task" },
  performance_issues:   { table: performanceIssues,    pk: performanceIssues.id,    pkType: "int",  displayType: "Performance Issue" },
  time_tracking_topics: { table: timeTrackingTopics,   pk: timeTrackingTopics.id,   pkType: "int",  displayType: "Time-Tracking Topic" },
  time_tracking_entries:{ table: timeTrackingEntries,  pk: timeTrackingEntries.id,  pkType: "int",  displayType: "Time-Tracking Entry" },
};

const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Schema version stamp. Bump this string whenever a TRASH_REGISTRY-tracked
// table gains or loses a column. Trash rows older than the bump may not
// restore cleanly — see TrashRestoreError.SchemaMismatch handling.
const TRASH_APP_VERSION = "2026-04-27";

/**
 * Soft-delete: copy the row to trash_bin, then erase from source.
 * Returns true if a row was found+trashed, false if no row matched.
 */
export async function trashAndDelete(tableName: string, idRaw: string | number): Promise<boolean> {
  const reg = TRASH_REGISTRY[tableName];
  if (!reg) throw new Error(`trashAndDelete: table "${tableName}" is not in TRASH_REGISTRY`);
  const id = reg.pkType === "int" ? Number(idRaw) : String(idRaw);
  // Fetch the row first — we need a snapshot before deleting.
  const rows = await db.select().from(reg.table).where(eq(reg.pk, id));
  if (rows.length === 0) return false;
  const row = rows[0];
  const expires = new Date(Date.now() + TRASH_TTL_MS).toISOString();
  const displayName = reg.nameField ? String((row as any)[reg.nameField] ?? "") : "";
  await db.execute(sql`
    INSERT INTO trash_bin (table_name, row_id, row_data, display_name, display_type, expires_at, app_version)
    VALUES (${tableName}, ${String(id)}, ${JSON.stringify(row)}::jsonb, ${displayName}, ${reg.displayType}, ${expires}, ${TRASH_APP_VERSION})
  `);
  await db.delete(reg.table).where(eq(reg.pk, id));
  return true;
}

/** Structured error so the API can surface a 409 conflict cleanly to the UI. */
export class TrashRestoreConflictError extends Error {
  constructor(public readonly tableName: string, public readonly rowId: string) {
    super(`Cannot restore: a row with id="${rowId}" already exists in "${tableName}". Delete or rename the conflicting row, then try again.`);
    this.name = "TrashRestoreConflictError";
  }
}

export interface TrashItem {
  id: number;
  table_name: string;
  row_id: string;
  display_name: string | null;
  display_type: string | null;
  deleted_at: string;
  expires_at: string;
}

export async function listTrash(): Promise<TrashItem[]> {
  const result = await db.execute(sql`
    SELECT id, table_name, row_id, display_name, display_type, deleted_at, expires_at
    FROM trash_bin
    WHERE restored_at IS NULL AND expires_at > NOW()
    ORDER BY deleted_at DESC
  `);
  return result.rows as unknown as TrashItem[];
}

/**
 * Re-insert a trashed row back into its source table. Marks the trash
 * row as restored (kept for audit trail). Throws if the row's original
 * id collides with an existing row (which can happen if the user
 * created a new entity with the reused id while the old was in trash).
 */
export async function restoreTrash(trashId: number): Promise<{ tableName: string; rowData: any }> {
  const result = await db.execute(sql`
    SELECT id, table_name, row_id, row_data
    FROM trash_bin
    WHERE id = ${trashId} AND restored_at IS NULL
  `);
  if (result.rows.length === 0) throw new Error("Trash item not found or already restored");
  const item = result.rows[0] as any;
  const reg = TRASH_REGISTRY[item.table_name];
  if (!reg) throw new Error(`Cannot restore: table "${item.table_name}" not in TRASH_REGISTRY`);
  // Pre-flight PK collision check so the UI can show a clear 409 instead
  // of the raw Postgres unique-violation. Most likely cause: user created
  // a new entity with the original id (or a deterministic id like
  // project_name) while the old was sitting in trash.
  const idVal = reg.pkType === "int" ? Number(item.row_id) : String(item.row_id);
  const existing = await db.select().from(reg.table).where(eq(reg.pk, idVal));
  if (existing.length > 0) {
    throw new TrashRestoreConflictError(item.table_name, String(item.row_id));
  }
  // Re-insert the original row data (including its old id, so links/
  // foreign keys from elsewhere still resolve).
  await db.insert(reg.table).values(item.row_data as any);
  await db.execute(sql`UPDATE trash_bin SET restored_at = NOW() WHERE id = ${trashId}`);
  return { tableName: item.table_name, rowData: item.row_data };
}

/** Permanently delete a single trash item (skips the 30-day wait). */
export async function purgeTrashItem(trashId: number): Promise<void> {
  await db.execute(sql`DELETE FROM trash_bin WHERE id = ${trashId}`);
}

/** Permanently delete every expired (>30d) trash item. Run on boot. */
export async function purgeExpiredTrash(): Promise<number> {
  const r = await db.execute(sql`
    DELETE FROM trash_bin
    WHERE expires_at < NOW() AND restored_at IS NULL
  `);
  return (r as any).rowCount ?? 0;
}

/**
 * One-time idempotent cleanup: strip ALL retired employees from
 * pricing_proposals manager_name and team_members. Safe to run on every boot.
 * Handles employees retired before the cascade code was deployed (FIX-1).
 */
export async function cleanupRetiredEmployeeAssignments(): Promise<void> {
  await db.execute(sql`
    UPDATE pricing_proposals
    SET manager_name = NULL
    WHERE manager_name IS NOT NULL
      AND LOWER(TRIM(manager_name)) IN (
        SELECT LOWER(TRIM(name)) FROM employees WHERE status = 'former'
      )
  `);
  await db.execute(sql`
    UPDATE pricing_proposals
    SET team_members = (
      SELECT COALESCE(jsonb_agg(el), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(team_members, '[]'::jsonb)) AS el
      WHERE LOWER(TRIM(el->>'name')) NOT IN (
        SELECT LOWER(TRIM(name)) FROM employees WHERE status = 'former'
      )
    )
    WHERE team_members IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(team_members, '[]'::jsonb)) AS el
        WHERE LOWER(TRIM(el->>'name')) IN (
          SELECT LOWER(TRIM(name)) FROM employees WHERE status = 'former'
        )
      )
  `);
}
