import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  employees, roleGridEntries, appSettings, daysOffEntries,
  type Employee, type InsertEmployee,
  type AdminSettings, type RoleGridRow, type DaysOffEntry,
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

  async getSettings(): Promise<AdminSettings> {
    const rows = await db.select().from(appSettings);
    if (rows.length === 0) {
      throw new Error("Settings not seeded");
    }
    const row = rows[0];
    return {
      net_factor: row.net_factor,
      meal_voucher_days_per_month: row.meal_voucher_days_per_month,
      min_promo_increase_pct: row.min_promo_increase_pct,
      promotion_windows: row.promotion_windows as string[],
      window_tolerance_days: row.window_tolerance_days,
      tests: row.tests as import("@shared/schema").Test[],
    };
  }

  async updateSettings(data: Partial<AdminSettings>): Promise<AdminSettings> {
    const rows = await db.update(appSettings).set(data).where(eq(appSettings.id, 1)).returning();
    const row = rows[0];
    return {
      net_factor: row.net_factor,
      meal_voucher_days_per_month: row.meal_voucher_days_per_month,
      min_promo_increase_pct: row.min_promo_increase_pct,
      promotion_windows: row.promotion_windows as string[],
      window_tolerance_days: row.window_tolerance_days,
      track_fast_threshold: row.track_fast_threshold,
      track_slow_threshold: row.track_slow_threshold,
      tests: row.tests as import("@shared/schema").Test[],
    };
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
}

export const storage = new DatabaseStorage();
