import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  employees, roleGridEntries, appSettings, daysOffEntries, salaryHistoryEntries,
  pricingSettingsTable, pricingCases, pricingProposals, hiringCandidates, employeeTasks,
  performanceIssues, timeTrackingTopics, timeTrackingEntries,
  proposals, proposalTemplates, slideMethodologyConfigs, deckTemplateConfigs,
  type Employee, type InsertEmployee,
  type AdminSettings, type RoleGridRow, type DaysOffEntry, type SalaryHistoryEntry,
  type EmployeeTask, type PerformanceIssue,
  type TimeTrackingTopic, type TimeTrackingEntry,
  type Proposal, type ProposalTemplate,
  type SlideMethodologyConfig,
  type DeckTemplateConfig,
} from "@shared/schema";

export interface IStorage {
  // Employees
  getEmployees(): Promise<Employee[]>;
  getEmployee(id: string): Promise<Employee | undefined>;
  createEmployee(emp: InsertEmployee): Promise<Employee>;
  updateEmployee(id: string, emp: Partial<InsertEmployee>): Promise<Employee>;
  deleteEmployee(id: string): Promise<void>;

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
