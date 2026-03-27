import { pgTable, text, serial, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Zod schemas (used by both client and server) ───────────────────────────

export const monthlyRatingSchema = z.object({
  month: z.string(), // YYYY-MM
  score: z.number().min(1).max(10),
});
export type MonthlyRating = z.infer<typeof monthlyRatingSchema>;

export const testSchema = z.object({
  id: z.string(),
  name: z.string(),
  required_for_role: z.string().default(""),
  // legacy field kept optional so old DB data doesn't break on parse
  due_from_hire_months: z.number().optional(),
});
export type Test = z.infer<typeof testSchema>;

export const completedTestSchema = z.object({
  id: z.string(),
  score: z.number().min(0).max(100).nullable().optional(),
});
export type CompletedTest = z.infer<typeof completedTestSchema>;

export const roleGridSchema = z.object({
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
});
export type RoleGridRow = z.infer<typeof roleGridSchema>;

export const benchmarkRowSchema = z.object({
  tenure_years: z.number(),
  gen_p10: z.number(),
  gen_median: z.number(),
  gen_p75: z.number(),
  strat_p10: z.number(),
  strat_median: z.number(),
  strat_p75: z.number(),
});
export type BenchmarkRow = z.infer<typeof benchmarkRowSchema>;

export const DEFAULT_BENCHMARK: BenchmarkRow[] = [
  { tenure_years: 1, gen_p10: 25, gen_median: 30, gen_p75: 38, strat_p10: 32, strat_median: 40, strat_p75: 48 },
  { tenure_years: 2, gen_p10: 29, gen_median: 34, gen_p75: 42, strat_p10: 36, strat_median: 45, strat_p75: 55 },
  { tenure_years: 3, gen_p10: 33, gen_median: 39, gen_p75: 47, strat_p10: 40, strat_median: 50, strat_p75: 63 },
  { tenure_years: 4, gen_p10: 37, gen_median: 43, gen_p75: 53, strat_p10: 48, strat_median: 60, strat_p75: 75 },
  { tenure_years: 5, gen_p10: 40, gen_median: 48, gen_p75: 60, strat_p10: 55, strat_median: 68, strat_p75: 82 },
];

export const adminSettingsSchema = z.object({
  net_factor: z.number().default(0.75),
  meal_voucher_days_per_month: z.number().default(20),
  min_promo_increase_pct: z.number().default(10),
  promotion_windows: z.array(z.string()).default(["01-01", "05-01", "09-01"]),
  window_tolerance_days: z.number().default(21),
  track_fast_threshold: z.number().default(8.5),
  track_slow_threshold: z.number().default(7.0),
  tests: z.array(testSchema).default([
    { id: "1", name: "Onboarding",              required_for_role: "BA"  },
    { id: "2", name: "Project zero",             required_for_role: "BA"  },
    { id: "3", name: "Policies",                 required_for_role: "BA"  },
    { id: "4", name: "Cybersecurity",            required_for_role: "BA"  },
    { id: "5", name: "White belt",               required_for_role: "A2"  },
    { id: "6", name: "Consulting foundations",   required_for_role: "S1"  },
    { id: "7", name: "Green belt",               required_for_role: "C1"  },
  ]),
  benchmark_data: z.array(benchmarkRowSchema).default(DEFAULT_BENCHMARK),
  benchmark_updated_at: z.string().nullable().default(null),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

export const employeeInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1, "Name is required"),
  date_of_birth: z.string(),
  current_role_code: z.string(),
  hire_date: z.string(),
  last_promo_date: z.string().optional(),
  tenure_before_years: z.number().default(0),
  current_gross_fixed_year: z.number(),
  meal_voucher_daily: z.number().min(0),
  months_paid: z.number().refine((v) => v === 12 || v === 13),
  current_bonus_pct: z.number().min(0).max(30),
  performance_score: z.number().min(1).max(10),
  monthly_ratings: z.array(monthlyRatingSchema).default([]),
  completed_tests: z.array(completedTestSchema).default([]),
  promo_increase_override: z.number().min(0).max(100).nullable().optional(),
  pending_salary_gross: z.number().nullable().optional(),
  pending_salary_date: z.string().nullable().optional(),
});
export type EmployeeInput = z.infer<typeof employeeInputSchema>;

export interface EmployeeCalculationResult {
  employeeId: string;
  normalized_tenure: number;
  gross_month: number;
  net_month: number;
  recommended_track: "Fast" | "Normal" | "Slow" | "No promotion";
  next_promo_date: string | "No promotion";
  next_role_code: string | null;
  target_ral_min: number;
  target_ral_max: number;
  future_gross_month: number;
  increase_amount_monthly: number;
  increase_pct: number;
  band_status: "Under" | "In band" | "Over";
  policy_applied: string;
}

// ─── PostgreSQL tables ───────────────────────────────────────────────────────

export const employees = pgTable("employees", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  date_of_birth: text("date_of_birth").notNull(),
  current_role_code: text("current_role_code").notNull(),
  hire_date: text("hire_date").notNull(),
  last_promo_date: text("last_promo_date"),
  tenure_before_years: real("tenure_before_years").notNull().default(0),
  current_gross_fixed_year: real("current_gross_fixed_year").notNull(),
  meal_voucher_daily: real("meal_voucher_daily").notNull().default(8),
  months_paid: integer("months_paid").notNull().default(13),
  current_bonus_pct: real("current_bonus_pct").notNull().default(0),
  performance_score: real("performance_score").notNull().default(7),
  monthly_ratings: jsonb("monthly_ratings").$type<MonthlyRating[]>().notNull().default([]),
  completed_tests: jsonb("completed_tests").$type<CompletedTest[]>().notNull().default([]),
  promo_increase_override: real("promo_increase_override"),
  pending_salary_gross: real("pending_salary_gross"),
  pending_salary_date: text("pending_salary_date"),
});

export const insertEmployeeSchema = createInsertSchema(employees);
export type Employee = typeof employees.$inferSelect;
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;

export const roleGridEntries = pgTable("role_grid", {
  role_code: text("role_code").primaryKey(),
  role_name: text("role_name").notNull(),
  next_role_code: text("next_role_code"),
  promo_years_fast: real("promo_years_fast").notNull(),
  promo_years_normal: real("promo_years_normal").notNull(),
  promo_years_slow: real("promo_years_slow").notNull(),
  ral_min_k: real("ral_min_k").notNull(),
  ral_max_k: real("ral_max_k").notNull(),
  gross_fixed_min_month: real("gross_fixed_min_month").notNull(),
  gross_fixed_max_month: real("gross_fixed_max_month").notNull(),
  bonus_pct: real("bonus_pct").notNull(),
  meal_voucher_eur_per_day: real("meal_voucher_eur_per_day").notNull(),
  months_paid: integer("months_paid").notNull(),
  sort_order: integer("sort_order").notNull().default(0),
});

export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  net_factor: real("net_factor").notNull().default(0.75),
  meal_voucher_days_per_month: real("meal_voucher_days_per_month").notNull().default(20),
  min_promo_increase_pct: real("min_promo_increase_pct").notNull().default(10),
  promotion_windows: jsonb("promotion_windows").$type<string[]>().notNull().default(["01-01", "05-01", "09-01"]),
  window_tolerance_days: integer("window_tolerance_days").notNull().default(21),
  track_fast_threshold: real("track_fast_threshold").notNull().default(8.5),
  track_slow_threshold: real("track_slow_threshold").notNull().default(7.0),
  tests: jsonb("tests").$type<Test[]>().notNull().default([]),
  benchmark_data: jsonb("benchmark_data").$type<BenchmarkRow[]>().default([]),
  benchmark_updated_at: text("benchmark_updated_at"),
});

// Minimal users table for auth
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

// ─── Salary History ──────────────────────────────────────────────────────────

export const salaryHistoryEntrySchema = z.object({
  id: z.number().optional(),
  employee_id: z.string(),
  effective_date: z.string(),          // YYYY-MM-DD
  role_code: z.string().optional().nullable(),
  gross_fixed_year: z.number(),
  months_paid: z.number().optional().nullable(),
  bonus_pct: z.number().optional().nullable(),
  meal_voucher_daily: z.number().optional().nullable(),
  note: z.string().optional().nullable(),
});
export type SalaryHistoryEntry = z.infer<typeof salaryHistoryEntrySchema>;

export const salaryHistoryEntries = pgTable("salary_history", {
  id: serial("id").primaryKey(),
  employee_id: text("employee_id").notNull(),
  effective_date: text("effective_date").notNull(),
  role_code: text("role_code"),
  gross_fixed_year: real("gross_fixed_year").notNull(),
  months_paid: integer("months_paid"),
  bonus_pct: real("bonus_pct"),
  meal_voucher_daily: real("meal_voucher_daily"),
  note: text("note"),
});

// ─── Days Off ────────────────────────────────────────────────────────────────

export const daysOffEntrySchema = z.object({
  id: z.number().optional(),
  employee_id: z.string(),
  type: z.enum(["taken", "carryover"]),
  year: z.number(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  days: z.number(),
  note: z.string().optional().nullable(),
});
export type DaysOffEntry = z.infer<typeof daysOffEntrySchema>;

export const daysOffEntries = pgTable("days_off_entries", {
  id: serial("id").primaryKey(),
  employee_id: text("employee_id").notNull(),
  type: text("type").notNull().default("taken"),
  year: integer("year").notNull(),
  start_date: text("start_date"),
  end_date: text("end_date"),
  days: real("days").notNull(),
  note: text("note"),
});

// ─── Pricing Tool ─────────────────────────────────────────────────────────────

export const pricingSettingsTable = pgTable("pricing_settings", {
  id: serial("id").primaryKey(),
  data: jsonb("data").notNull().default({}),
});

export const pricingCases = pgTable("pricing_cases", {
  id: serial("id").primaryKey(),
  project_name: text("project_name").notNull(),
  client_name: text("client_name").notNull().default(""),
  fund_name: text("fund_name"),
  industry: text("industry"),
  country: text("country"),
  region: text("region").notNull().default("Italy"),
  pe_owned: integer("pe_owned").notNull().default(1), // 1=true, 0=false
  revenue_band: text("revenue_band").notNull().default("above_1b"),
  price_sensitivity: text("price_sensitivity").notNull().default("medium"),
  duration_weeks: real("duration_weeks").notNull().default(8),
  notes: text("notes"),
  status: text("status").notNull().default("draft"),
  staffing: jsonb("staffing").notNull().default([]),
  recommendation: jsonb("recommendation"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const pricingProposals = pgTable("pricing_proposals", {
  id: serial("id").primaryKey(),
  proposal_date: text("proposal_date").notNull(),
  project_name: text("project_name").notNull(),
  client_name: text("client_name"),
  fund_name: text("fund_name"),
  region: text("region").notNull(),
  country: text("country"),
  pe_owned: integer("pe_owned").notNull().default(1),
  revenue_band: text("revenue_band").notNull().default("above_1b"),
  price_sensitivity: text("price_sensitivity"),
  duration_weeks: real("duration_weeks"),
  weekly_price: real("weekly_price").notNull(),
  total_fee: real("total_fee"),
  outcome: text("outcome").notNull().default("pending"),
  loss_reason: text("loss_reason"),
  notes: text("notes"),
  created_at: text("created_at").notNull(),
});

// ─── Hiring Kanban ───────────────────────────────────────────────────────────

export const hiringCandidates = pgTable("hiring_candidates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default(""),
  info: text("info").notNull().default(""),
  stage: text("stage").notNull().default("potential"),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: text("created_at").notNull(),
});
