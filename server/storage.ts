import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  employees, roleGridEntries, appSettings, daysOffEntries, salaryHistoryEntries,
  pricingSettingsTable, pricingCases, pricingProposals, hiringCandidates,
  type Employee, type InsertEmployee,
  type AdminSettings, type RoleGridRow, type DaysOffEntry, type SalaryHistoryEntry,
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
    return db.select().from(pricingCases).orderBy(pricingCases.id);
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
    return db.select().from(pricingProposals).orderBy(pricingProposals.proposal_date);
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
    return db.select().from(hiringCandidates).orderBy(hiringCandidates.sort_order);
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
}

export const storage = new DatabaseStorage();
