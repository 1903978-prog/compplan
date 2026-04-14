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
  score: z.preprocess(
    v => (v === "" || v === undefined) ? null : (typeof v === "string" ? Number(v) : v),
    z.number().min(0).max(100).nullable().optional()
  ),
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
  tests: z.preprocess(v => v ?? [], z.array(testSchema).default([
    { id: "1", name: "Onboarding",              required_for_role: "BA"  },
    { id: "2", name: "Project zero",             required_for_role: "BA"  },
    { id: "3", name: "Policies",                 required_for_role: "BA"  },
    { id: "4", name: "Cybersecurity",            required_for_role: "BA"  },
    { id: "5", name: "White belt",               required_for_role: "A2"  },
    { id: "6", name: "Consulting foundations",   required_for_role: "S1"  },
    { id: "7", name: "Green belt",               required_for_role: "C1"  },
  ])),
  benchmark_data: z.preprocess(v => v ?? DEFAULT_BENCHMARK, z.array(benchmarkRowSchema)),
  benchmark_updated_at: z.string().nullable().default(null),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

export const onboardingWeekSchema = z.object({
  week: z.number(),          // 1-8
  score: z.number().min(0).max(100).nullable(),
});
export type OnboardingWeek = z.infer<typeof onboardingWeekSchema>;

export const yearlyReviewSchema = z.object({
  year: z.number(),
  summary: z.string().default(""),
  dev_plan: z.string().default(""),
});
export type YearlyReview = z.infer<typeof yearlyReviewSchema>;

export const comexAreaSchema = z.record(z.string(), z.boolean());
export type ComexAreas = z.infer<typeof comexAreaSchema>;

export const COMEX_AREAS = [
  "Diagnostic", "Org Design", "Org Sizing", "SFE", "CapDB",
  "Incentives", "War Rooms", "List Pricing", "GTN",
] as const;

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
  current_bonus_pct: z.number().min(0).max(30).default(0),
  performance_score: z.number().min(1).max(10).nullable().optional(),
  monthly_ratings: z.preprocess(v => v ?? [], z.array(monthlyRatingSchema)),
  completed_tests: z.preprocess(
    v => {
      if (!v || !Array.isArray(v)) return [];
      return v.map((item: any) => typeof item === 'string' ? { id: item, score: null } : item);
    },
    z.array(completedTestSchema)
  ),
  promo_increase_override: z.number().min(0).max(100).nullable().optional(),
  pending_salary_gross: z.number().nullable().optional(),
  pending_salary_date: z.string().nullable().optional(),
  // New fields
  university_grade: z.number().nullable().optional(),        // e.g. 108 or 3.8
  university_grade_type: z.enum(["110", "GPA"]).nullable().optional(),
  promotion_discussion_notes: z.string().nullable().optional(),
  onboarding_ratings: z.preprocess(v => v ?? [], z.array(onboardingWeekSchema)),
  yearly_reviews: z.preprocess(v => v ?? [], z.array(yearlyReviewSchema)),
  comex_areas: z.preprocess(v => v ?? {}, comexAreaSchema),
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
  university_grade: real("university_grade"),
  university_grade_type: text("university_grade_type"),
  promotion_discussion_notes: text("promotion_discussion_notes"),
  onboarding_ratings: jsonb("onboarding_ratings").$type<OnboardingWeek[]>().default([]),
  yearly_reviews: jsonb("yearly_reviews").$type<YearlyReview[]>().default([]),
  comex_areas: jsonb("comex_areas").$type<ComexAreas>().default({}),
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
  api_paused: integer("api_paused").notNull().default(1),
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
  project_type: text("project_type"),
  sector: text("sector"),
  ebitda_margin_pct: real("ebitda_margin_pct"),
  commercial_maturity: real("commercial_maturity"),
  urgency: real("urgency"),
  competitive_intensity: text("competitive_intensity"),
  competitor_type: text("competitor_type"),
  ownership_type: text("ownership_type"),
  strategic_intent: text("strategic_intent"),
  procurement_involvement: text("procurement_involvement"),
  case_discounts: jsonb("case_discounts"),
  // Value-based fields
  company_revenue_m: real("company_revenue_m"),
  aspiration_ebitda_eur: real("aspiration_ebitda_eur"),
  target_roi: real("target_roi"),
  max_fees_ebitda_pct: real("max_fees_ebitda_pct"),
  aspiration_ebitda_pct: real("aspiration_ebitda_pct"),
  // Comprehensive analysis
  relationship_type: text("relationship_type"),
  decision_maker: text("decision_maker"),
  budget_disclosed_eur: real("budget_disclosed_eur"),
  incumbent_advisor: text("incumbent_advisor"),
  geographic_scope: text("geographic_scope"),
  value_driver: text("value_driver"),
  differentiation: text("differentiation"),
  risk_flags: jsonb("risk_flags"),
  problem_statement: text("problem_statement"),
  expected_impact_eur: real("expected_impact_eur"),
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
  sector: text("sector"),
  project_type: text("project_type"),
  currency: text("currency").notNull().default("EUR"),
  company_revenue_m: real("company_revenue_m"),
  ebitda_margin_pct: real("ebitda_margin_pct"),
  expected_ebitda_growth_pct: real("expected_ebitda_growth_pct"),
  team_size: real("team_size").notNull().default(1),
  notes: text("notes"),
  attachment_url: text("attachment_url"),
  excluded_from_analysis: integer("excluded_from_analysis").notNull().default(0),
  created_at: text("created_at").notNull(),
});

// ─── Employee Tasks (TDL) ────────────────────────────────────────────────────

export const employeeTaskSchema = z.object({
  id: z.number().optional(),
  title: z.string().min(1),
  body: z.string().nullable().optional(),
  delegated_to: z.string(),   // employee id
  deadline: z.string().nullable().optional(),
  status: z.enum(["pending", "done"]).default("pending"),
  created_at: z.string(),
});
export type EmployeeTask = z.infer<typeof employeeTaskSchema>;

export const employeeTasks = pgTable("employee_tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body"),
  delegated_to: text("delegated_to").notNull(),
  deadline: text("deadline"),
  status: text("status").notNull().default("pending"),
  created_at: text("created_at").notNull(),
});

// ─── Performance Issues ─────────────────────────────────────────────────────

export const performanceIssueSchema = z.object({
  id: z.number().optional(),
  employee_name: z.string(),
  date: z.string(),
  note: z.string().min(1),
  created_at: z.string(),
});
export type PerformanceIssue = z.infer<typeof performanceIssueSchema>;

export const performanceIssues = pgTable("performance_issues", {
  id: serial("id").primaryKey(),
  employee_name: text("employee_name").notNull(),
  date: text("date").notNull(),
  note: text("note").notNull(),
  created_at: text("created_at").notNull(),
});

// ─── Time Tracking ──────────────────────────────────────────────────────────

export const timeTrackingTopicSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1),
  sort_order: z.number().default(0),
});
export type TimeTrackingTopic = z.infer<typeof timeTrackingTopicSchema>;

export const timeTrackingTopics = pgTable("time_tracking_topics", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sort_order: integer("sort_order").notNull().default(0),
});

export const timeTrackingEntrySchema = z.object({
  id: z.number().optional(),
  topic_id: z.number(),
  topic_name: z.string(),
  start_time: z.string(),            // ISO datetime
  end_time: z.string().nullable(),    // null = still running
});
export type TimeTrackingEntry = z.infer<typeof timeTrackingEntrySchema>;

export const timeTrackingEntries = pgTable("time_tracking_entries", {
  id: serial("id").primaryKey(),
  topic_id: integer("topic_id").notNull(),
  topic_name: text("topic_name").notNull(),
  start_time: text("start_time").notNull(),
  end_time: text("end_time"),
});

// ─── Proposals ──────────────────────────────────────────────────────────────

export const proposalSchema = z.object({
  id: z.number().optional(),
  company_name: z.string().min(1),
  website: z.string().optional().nullable(),
  transcript: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  revenue: z.number().optional().nullable(),
  ebitda_margin: z.number().optional().nullable(),
  scope_perimeter: z.string().optional().nullable(),
  objective: z.string().optional().nullable(),
  urgency: z.string().optional().nullable(),
  // AI-generated fields (editable)
  company_summary: z.string().optional().nullable(),
  proposal_title: z.string().optional().nullable(),
  why_now: z.string().optional().nullable(),
  objective_statement: z.string().optional().nullable(),
  scope_statement: z.string().optional().nullable(),
  recommended_team: z.string().optional().nullable(),
  staffing_intensity: z.string().optional().nullable(),
  project_type: z.string().optional().nullable(),  // e.g. "Strategy", "SPARK (Diagnostic)"
  slide_selection: z.any().default([]),  // JSONB array of SlideSelectionEntry
  slide_briefs: z.any().default([]),  // JSONB array of SlideBrief objects
  options: z.any().default([]),  // JSONB array of 3 option objects
  ai_analysis: z.any().optional().nullable(),  // raw Claude response
  status: z.string().default("draft"),  // draft, analyzed, finalized
  created_at: z.string(),
  updated_at: z.string(),
});
export type Proposal = z.infer<typeof proposalSchema>;

export const proposals = pgTable("proposals", {
  id: serial("id").primaryKey(),
  company_name: text("company_name").notNull(),
  website: text("website"),
  transcript: text("transcript"),
  notes: text("notes"),
  revenue: real("revenue"),
  ebitda_margin: real("ebitda_margin"),
  scope_perimeter: text("scope_perimeter"),
  objective: text("objective"),
  urgency: text("urgency"),
  company_summary: text("company_summary"),
  proposal_title: text("proposal_title"),
  why_now: text("why_now"),
  objective_statement: text("objective_statement"),
  scope_statement: text("scope_statement"),
  recommended_team: text("recommended_team"),
  staffing_intensity: text("staffing_intensity"),
  project_type: text("project_type"),
  slide_selection: jsonb("slide_selection").notNull().default([]),
  slide_briefs: jsonb("slide_briefs").notNull().default([]),
  options: jsonb("options").notNull().default([]),
  ai_analysis: jsonb("ai_analysis"),
  status: text("status").notNull().default("draft"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const proposalTemplateSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(1),
  file_data: z.string(),  // base64 encoded pptx
  file_size: z.number(),
  is_active: z.number().default(1),
  uploaded_at: z.string(),
});
export type ProposalTemplate = z.infer<typeof proposalTemplateSchema>;

export const proposalTemplates = pgTable("proposal_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  file_data: text("file_data").notNull(),
  file_size: integer("file_size").notNull(),
  is_active: integer("is_active").notNull().default(1),
  uploaded_at: text("uploaded_at").notNull(),
});

// ─── Slide Methodology Config ────────────────────────────────────────────────

export const slideMethodologyConfigSchema = z.object({
  slide_id: z.string(),
  purpose: z.string().default(""),
  structure: z.any().default({ sections: [] }),  // { sections: string[] }
  rules: z.string().default(""),
  columns: z.any().default({}),  // { column_1: "", column_2: "", column_3: "" }
  variations: z.any().default({}),  // { "SPARK": "...", "War Rooms": "..." }
  examples: z.any().default([]),  // string[]
  format: z.string().default("A"),  // "A" or "B"
  insight_bar: z.number().default(0),  // 0 or 1
  guidance_image: z.string().nullable().optional(),
  updated_at: z.string(),
});
export type SlideMethodologyConfig = z.infer<typeof slideMethodologyConfigSchema>;

export const slideMethodologyConfigs = pgTable("slide_methodology_configs", {
  slide_id: text("slide_id").primaryKey(),
  purpose: text("purpose").notNull().default(""),
  structure: jsonb("structure").notNull().default({ sections: [] }),
  rules: text("rules").notNull().default(""),
  columns: jsonb("columns").notNull().default({}),
  variations: jsonb("variations").notNull().default({}),
  examples: jsonb("examples").notNull().default([]),
  format: text("format").notNull().default("A"),
  insight_bar: integer("insight_bar").notNull().default(0),
  guidance_image: text("guidance_image"),
  updated_at: text("updated_at").notNull(),
});

// ─── Deck Template Config ───────────────────────────────────────────────────

export const deckTemplateConfigSchema = z.object({
  id: z.number().optional(),
  palette: z.any().default({}),          // { C_TRACKER, C_TITLE, ... }
  typography: z.any().default({}),       // { tracker, title, headers, ... }
  format_a_desc: z.string().default(""),
  format_b_desc: z.string().default(""),
  footer_left: z.string().default(""),
  footer_right: z.string().default(""),
  system_prompt: z.string().default(""), // full combined template instructions
  updated_at: z.string(),
});
export type DeckTemplateConfig = z.infer<typeof deckTemplateConfigSchema>;

export const deckTemplateConfigs = pgTable("deck_template_configs", {
  id: serial("id").primaryKey(),
  palette: jsonb("palette").notNull().default({}),
  typography: jsonb("typography").notNull().default({}),
  format_a_desc: text("format_a_desc").notNull().default(""),
  format_b_desc: text("format_b_desc").notNull().default(""),
  footer_left: text("footer_left").notNull().default(""),
  footer_right: text("footer_right").notNull().default(""),
  system_prompt: text("system_prompt").notNull().default(""),
  updated_at: text("updated_at").notNull(),
});

// ─── Project Type Slide Defaults (learned) ──────────────────────────────────

export const projectTypeSlideDefaults = pgTable("project_type_slide_defaults", {
  project_type: text("project_type").primaryKey(),
  slide_ids: jsonb("slide_ids").notNull().default([]),      // string[] — ordered selected slide IDs
  slide_order: jsonb("slide_order").notNull().default([]),   // string[] — full ordered list of all slide IDs
  updated_at: text("updated_at").notNull(),
});

// ─── Hiring Kanban ───────────────────────────────────────────────────────────

export const hiringCandidates = pgTable("hiring_candidates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default(""),
  info: text("info").notNull().default(""),
  stage: text("stage").notNull().default("potential"),
  sort_order: integer("sort_order").notNull().default(0),
  external_id: text("external_id"),       // email from Eendigo — dedup key
  sync_locked: integer("sync_locked").notNull().default(0), // 1 = user manually moved, don't overwrite
  created_at: text("created_at").notNull(),
});

// ── Harvest Invoice Tracking ────────────────────────────────────────────────
// Snapshot of last-seen state per invoice (for change detection)
export const invoiceSnapshots = pgTable("invoice_snapshots", {
  id: serial("id").primaryKey(),
  invoice_id: integer("invoice_id").notNull().unique(),  // Harvest invoice ID
  invoice_number: text("invoice_number"),
  client_id: integer("client_id"),
  client_name: text("client_name"),
  amount: integer("amount").notNull().default(0),
  due_amount: integer("due_amount").notNull().default(0),
  due_date: text("due_date"),
  state: text("state").notNull().default(""),
  currency: text("currency").notNull().default("EUR"),
  subject: text("subject"),
  sent_at: text("sent_at"),
  paid_at: text("paid_at"),
  invoice_created_at: text("invoice_created_at"),
  period_start: text("period_start"),
  period_end: text("period_end"),
  project_codes: text("project_codes"),    // comma-separated Harvest project codes from line_items (e.g. "COE02,COE03")
  project_names: text("project_names"),    // comma-separated Harvest project names
  updated_at: text("updated_at").notNull(),
});

// Detected changes (notifications shown on AR page)
export const invoiceChanges = pgTable("invoice_changes", {
  id: serial("id").primaryKey(),
  invoice_id: integer("invoice_id").notNull(),
  invoice_number: text("invoice_number"),
  client_name: text("client_name"),
  amount: integer("amount").notNull().default(0),
  change_type: text("change_type").notNull(),              // "new_invoice" | "paid" | "amount_changed" | "deleted"
  old_value: text("old_value"),                            // previous state/amount for context
  new_value: text("new_value"),                            // new state/amount
  detected_at: text("detected_at").notNull(),
  approval_status: text("approval_status").notNull().default("pending"), // "pending" | "approved" | "rejected"
  dismissed: integer("dismissed").notNull().default(0),    // 1 = user dismissed from notification banner
});

// ── Knowledge Center ────────────────────────────────────────────────────────
// Knowledge topics (e.g. "Timelines", "Methodologies", "Past Proposals")
export const knowledgeTopics = pgTable("knowledge_topics", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: text("created_at").notNull(),
});

// Knowledge files — each belongs to a topic
export const knowledgeFiles = pgTable("knowledge_files", {
  id: serial("id").primaryKey(),
  topic_id: integer("topic_id").notNull(),
  category: text("category").notNull().default("General"),
  filename: text("filename").notNull(),
  file_path: text("file_path").notNull(),
  file_size: integer("file_size").notNull().default(0),
  content_text: text("content_text"),
  uploaded_at: text("uploaded_at").notNull(),
});
