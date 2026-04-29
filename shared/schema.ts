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
  email: z.string().email("Invalid email").or(z.literal("")).nullable().optional(),
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
  email: text("email"),
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
  // Three-timeline commercial-proposal comparison. Array of
  // {weeks, commitPct, grossTotal?, commitAmount?} — default curve is
  // 12/16/20 weeks at 0/5/7% commit. The two optional fields pin exact
  // per-option numbers when the engine's derived values don't match
  // the client-facing slide (e.g. mid-project rate reset, or compound-
  // on-post-discount commit math). Null = use engine default.
  case_timelines: jsonb("case_timelines").$type<{ weeks: number; commitPct: number; grossTotal?: number; commitAmount?: number; netTotal?: number; note?: string }[] | null>(),
  // proposal_options_count: how many of the case_timelines columns to render
  // in the Commercial Proposal block. 1 = single-option mode (hides Options
  // 2 & 3); 3 = full 3-option mode (default). State for hidden options is
  // preserved in case_timelines so toggling back doesn't lose user input.
  proposal_options_count: integer("proposal_options_count").notNull().default(3),
  // Revision letter appended to project_name in the display (A / B / C / D).
  // A proposal goes through multiple revisions with the client — each is
  // a separate row (same project_name, different letter). Default "A" —
  // mirrors the raw SQL migration in seed.ts so a future drizzle-kit push
  // doesn't accidentally drop the DB-side default.
  revision_letter: text("revision_letter").default("A"),
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
  // win_probability (0-100): Livio's estimate of closing this deal.
  // Used by the CHRO agent's 24-week staffing demand forecast and by the
  // staffing Gantt's probability-weighted view.
  win_probability: real("win_probability"),
  // start_date (YYYY-MM-DD): expected delivery start. If null, the staffing
  // forecast uses created_at as a proxy. Livio sets this when the case is
  // being prepared; confirms it before signing.
  start_date: text("start_date"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// Insert schema for pricing_cases write endpoints. Server-side validators
// strip unknown keys so the client can't push columns we didn't declare.
// Most fields are optional: the table has DB defaults and the client
// often saves partial state (e.g. just status + staffing).
export const insertPricingCaseSchema = createInsertSchema(pricingCases).partial({
  client_name: true,
  industry: true,
  country: true,
  region: true,
  pe_owned: true,
  revenue_band: true,
  price_sensitivity: true,
  duration_weeks: true,
  notes: true,
  status: true,
  staffing: true,
  recommendation: true,
  case_discounts: true,
  case_timelines: true,
  revision_letter: true,
  win_probability: true,
  start_date: true,
  created_at: true,
  updated_at: true,
}).extend({
  // project_name is the only required-by-the-server field beyond an id.
  project_name: z.string().min(1).max(60),
});
export type InsertPricingCase = z.infer<typeof insertPricingCaseSchema>;

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
  // Structured client debrief captured after a LOST proposal. JSONB
  // instead of individual columns so the survey shape can evolve without
  // running a migration every time we add a question. Default shape
  // mirrors the MS Forms loss-debrief sent to clients:
  //   {
  //     received_date:              "YYYY-MM-DD",
  //     winner_name:                "McKinsey",
  //     would_reconsider:           "yes" | "no" | "maybe",
  //     ratings: {                  // 1-5, higher is better
  //       overall:         4,
  //       team:            5,
  //       price_fairness:  2,       // low = client felt overpriced
  //       deck_quality:    5,
  //       approach:        4,
  //       relationship:    3
  //     },
  //     strengths:                   "what Eendigo did well",
  //     weaknesses:                  "what to improve",
  //     reasons_for_choosing_winner: "price + industry references",
  //     additional_comments:         "free text"
  //   }
  // Any field may be null/missing. An `extra` key is reserved for fields
  // we haven't modelled yet — e.g. when importing MS Forms CSV.
  client_feedback: jsonb("client_feedback"),
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
  // ── Engagement tracking (Won projects)
  // end_date: when the engagement ends (YYYY-MM-DD). When set AND in the
  // future AND outcome='won', the proposal appears in Exec → Ongoing
  // Projects so the team can track delivery + invoicing cadence.
  end_date: text("end_date"),
  // manager_name: the EM running the engagement day-to-day. Free text.
  manager_name: text("manager_name"),
  // team_members: list of { role, name } pairs for everyone working on it
  // beyond the manager (Partner, ASCs, BAs, etc.). Free-text role and name.
  team_members: jsonb("team_members").$type<{ role: string; name: string }[]>(),
  // last_invoice_at: most recent invoice date for this engagement (YYYY-MM-DD).
  // Used to flag "needs invoice" when >30 days have passed AND project is ongoing.
  last_invoice_at: text("last_invoice_at"),
  // win_probability (0-100): only meaningful for outcome='pending'. Sales
  // Director sets/updates this each cycle. Used by the staffing Gantt to
  // compute probability-weighted demand and by the Hiring Manager's
  // buffer-rule hiring trigger.
  win_probability: real("win_probability"),
  // start_date (YYYY-MM-DD): when delivery begins. If null, the staffing
  // Gantt falls back to proposal_date as a proxy. Sales Director should
  // commit start_date only after checking /exec/staffing for capacity.
  start_date: text("start_date"),
  // weekly_reports: per-week delivery status snapshots written by the team.
  // The Delivery Director skill reads these every Monday to compute project
  // health (green/amber/red) and surface risks. Each entry:
  //   { week_of: "YYYY-MM-DD", status: "green"|"amber"|"red", body: free text,
  //     author?: string, blockers?: string[], pct_complete?: number }
  weekly_reports: jsonb("weekly_reports").$type<{
    week_of: string;
    status: "green" | "amber" | "red";
    body: string;
    author?: string;
    blockers?: string[];
    pct_complete?: number;
  }[]>(),
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

// ─── Slide Backgrounds ──────────────────────────────────────────────────────
// Per-slide PNG backgrounds uploaded from a Canva (or any) template.
// When a slide is generated, the server injects the matching background as a
// CSS background-image on the outermost slide div, so the HTML preview —
// and therefore the pixel-perfect Playwright export — visually matches the
// Canva template while keeping the text fully editable.
//
// One row per slide_id from MASTER_SLIDES. file_data is a data: URL
// (e.g. "data:image/png;base64,..."). We store the full data URL rather
// than raw base64 so it can be used directly in <img src> or CSS url(),
// and so the content-type is self-describing.
export const slideBackgroundSchema = z.object({
  slide_id: z.string(),
  file_data: z.string(),            // data URL, e.g. "data:image/png;base64,..."
  file_size: z.number().default(0), // bytes of the underlying binary
  source: z.string().nullable().optional(), // "canva" | "upload" | etc.
  source_ref: z.string().nullable().optional(), // e.g. Canva design_id/page index
  updated_at: z.string(),
});
export type SlideBackground = z.infer<typeof slideBackgroundSchema>;

export const slideBackgrounds = pgTable("slide_backgrounds", {
  slide_id: text("slide_id").primaryKey(),
  file_data: text("file_data").notNull(),
  file_size: integer("file_size").notNull().default(0),
  source: text("source"),
  source_ref: text("source_ref"),
  updated_at: text("updated_at").notNull(),
});

// ─── Slide Templates (JSON-spec deterministic rendering) ─────────────────────
//
// A slide template is a stable JSON spec describing a frozen layout: a canvas
// size, an optional background image (data URL), and a list of positioned
// regions (text / image slots) with fonts, colors, alignment. The template is
// authored once in the visual editor and reused for every proposal — the only
// thing that varies between proposals is the per-region `values` map that
// fills the named slots.
//
// Contrast with slide_backgrounds, which stores a raw PNG and still lets
// Claude free-generate the HTML on top. Templates are fully deterministic:
// given the same spec + values, the renderer emits byte-identical HTML.
//
// `spec` JSON shape:
//   {
//     canvas: { width: 1920, height: 1080 },
//     background: "data:image/png;base64,..." | null,
//     regions: [
//       { id, key, type: "text",
//         x, y, w, h,              // canvas units (1920x1080)
//         font, size, weight, color,
//         align: "left"|"center"|"right",
//         valign: "top"|"middle"|"bottom",
//         placeholder, default_text,
//         line_height?, letter_spacing?, italic?
//       },
//       ...
//     ]
//   }
export const slideTemplateRegionSchema = z.object({
  id: z.string(),
  key: z.string(),
  type: z.literal("text"),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  font: z.string().default("Inter"),
  size: z.number().default(32),
  weight: z.number().default(400),
  color: z.string().default("#111111"),
  align: z.enum(["left", "center", "right"]).default("left"),
  valign: z.enum(["top", "middle", "bottom"]).default("top"),
  line_height: z.number().default(1.2),
  letter_spacing: z.number().default(0),
  italic: z.boolean().default(false),
  placeholder: z.string().default(""),
  default_text: z.string().default(""),
});
export type SlideTemplateRegion = z.infer<typeof slideTemplateRegionSchema>;

export const slideTemplateSpecSchema = z.object({
  canvas: z.object({
    width: z.number().default(1920),
    height: z.number().default(1080),
  }).default({ width: 1920, height: 1080 }),
  background: z.string().nullable().optional(),
  regions: z.array(slideTemplateRegionSchema).default([]),
});
export type SlideTemplateSpec = z.infer<typeof slideTemplateSpecSchema>;

export const slideTemplateSchema = z.object({
  slide_id: z.string(),
  spec: slideTemplateSpecSchema,
  updated_at: z.string(),
});
export type SlideTemplate = z.infer<typeof slideTemplateSchema>;

export const slideTemplates = pgTable("slide_templates", {
  slide_id: text("slide_id").primaryKey(),
  spec: jsonb("spec").notNull(),
  updated_at: text("updated_at").notNull(),
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
  slide_instructions_text: z.string().default(""), // raw bulk-parse source text
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
  // Raw "Slide Template Instructions" free-text the user pastes into the
  // Proposals bulk-parse dialog. Persisted so it survives reloads and can
  // be re-edited later. The parsed output lives in slide_methodology_configs.
  slide_instructions_text: text("slide_instructions_text").notNull().default(""),
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
  // Per-test scores captured across the funnel. Keys are arbitrary (hsa,
  // testgorilla, intro_call, case_study, ppt, final) so the hiring team
  // can add a new test without a schema change. Values are 0-100 or null.
  scores: jsonb("scores").$type<Record<string, number | null>>(),
  // Structured columns for the headline scrape fields the hiring team
  // ranks candidates on. The same numbers are still embedded in `info`
  // for human display/back-compat, but having them as real columns lets
  // us sort, filter, and chart without parsing free text. Populated by
  // server/hiringSync.ts during the Eendigo scrape; null = not measured.
  // cs_lm stays TEXT because the partner's Case-Study LM rating can be
  // a percentage ("85%") OR a textual grade ("Strong", "Pass", "Fail").
  logic_pct: real("logic_pct"),
  verbal_pct: real("verbal_pct"),
  excel_pct: real("excel_pct"),
  p1_pct: real("p1_pct"),
  p2_pct: real("p2_pct"),
  intro_rate_pct: real("intro_rate_pct"),
  cs_rate_pct: real("cs_rate_pct"),
  cs_lm: text("cs_lm"),
  created_at: text("created_at").notNull(),
});

// ── Won Projects (Invoicing Audit) ──────────────────────────────────────────
// Newly won projects entered manually to audit that all expected invoices are
// actually issued by the team. Each won project has a client code (e.g. "MET"),
// a total expected amount, and the pasted invoicing schedule text from the SOW
// contract. Used to reconcile against invoice_snapshots.
export const wonProjects = pgTable("won_projects", {
  id: serial("id").primaryKey(),
  client_name: text("client_name").notNull(),
  client_code: text("client_code").notNull(),             // e.g. "MET" (3-letter prefix used in project codes)
  project_name: text("project_name").notNull(),
  project_code: text("project_code"),                     // e.g. "MET04" — specific invoice code to match against
  total_amount: real("total_amount").notNull(),
  currency: text("currency").notNull().default("EUR"),
  won_date: text("won_date").notNull(),                   // ISO date when deal was won
  start_date: text("start_date"),                         // project start (optional)
  end_date: text("end_date"),                             // project end (optional)
  invoicing_schedule_text: text("invoicing_schedule_text"), // pasted from SOW contract
  status: text("status").notNull().default("active"),     // "active" | "completed" | "cancelled"
  notes: text("notes"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// ── Business Development / CRM ──────────────────────────────────────────────
// Lightweight CRM table seeded by HubSpot imports (or manual entry). Sits
// UPSTREAM of `pricingProposals`: the pricing workflow kicks in once a
// deal is far enough along to actually quote. Stages map 1:1 to HubSpot
// default pipeline so imports don't need translation.
//
// Dedup key: `hubspot_id` when imported from HubSpot, else `id`. Re-running
// an import upserts by `hubspot_id` so nothing duplicates on re-paste.
export const bdDeals = pgTable("bd_deals", {
  id: serial("id").primaryKey(),
  hubspot_id: text("hubspot_id"),                          // HubSpot deal ID, unique across imports; null for manual
  name: text("name").notNull(),                            // Deal name
  client_name: text("client_name"),                        // Company / account
  contact_name: text("contact_name"),                      // Primary contact
  contact_email: text("contact_email"),
  stage: text("stage").notNull().default("lead"),          // lead | qualified | proposal | negotiation | won | lost
  amount: real("amount"),                                  // Expected deal value
  currency: text("currency").default("EUR"),
  probability: real("probability"),                        // 0-100 win %
  close_date: text("close_date"),                          // Expected close (ISO date)
  source: text("source"),                                  // inbound | outbound | referral | hubspot_import | …
  owner: text("owner"),                                    // Who owns the deal internally
  notes: text("notes"),
  industry: text("industry"),
  region: text("region"),
  last_activity_at: text("last_activity_at"),              // Last touchpoint from HubSpot
  imported_at: text("imported_at"),                        // When row first came in from HubSpot
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});
export type BdDeal = typeof bdDeals.$inferSelect;
export type InsertBdDeal = typeof bdDeals.$inferInsert;

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
// API Cost Tracking
export const apiUsageLog = pgTable("api_usage_log", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  model: text("model").notNull().default("claude-sonnet-4"),
  input_tokens: integer("input_tokens").notNull().default(0),
  output_tokens: integer("output_tokens").notNull().default(0),
  cost_usd: text("cost_usd").notNull().default("0"),  // stored as string to avoid float issues
  created_at: text("created_at").notNull(),
});

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

// ── Brief runs (live cascade visualisation) ─────────────────────────────────
// When the user types "ceo brief", the skill POSTs a new brief_run, then
// emits brief_events as the cascade unfolds (CEO → DRs → their DRs).
// /exec/brief-stream polls these tables every 2s and renders the timeline
// live so the user can watch the org "think" in real time.
export const briefRuns = pgTable("brief_runs", {
  id: serial("id").primaryKey(),
  trigger: text("trigger").notNull().default("ceo brief"),       // what the user typed
  status: text("status").notNull().default("running"),           // running | completed | failed
  started_at: text("started_at").notNull(),
  completed_at: text("completed_at"),
  final_summary: text("final_summary"),                          // CEO synthesis
  proposals_count: integer("proposals_count").notNull().default(0),
});

export const briefEvents = pgTable("brief_events", {
  id: serial("id").primaryKey(),
  run_id: integer("run_id").notNull(),
  role_key: text("role_key").notNull(),                          // emitting role
  event_type: text("event_type").notNull(),                      // started | searching | gathering | drafting | posted | completed | escalated | failed
  summary: text("summary").notNull(),                             // one-line headline
  payload: jsonb("payload").$type<Record<string, unknown>>(),    // optional structured detail (links, source titles, etc.)
  created_at: text("created_at").notNull(),
});

// ── Agent Knowledge ─────────────────────────────────────────────────────────
// Per-role memory: every note, instruction, insight, or context the user
// (or another agent) has explicitly given to a specific role. The CEO and
// each role-skill MUST read all `status='active'` knowledge for their
// role on every run before producing a brief or making a decision.
//
// Sources:
//   user  — pasted directly via the "+ Knowledge" button on /exec/org-chart
//   agent — proposed by the CEO during its 9am web-research pass
//           (lands in agent_proposals as category='knowledge'; once user
//            accepts there, a row is created here with source='agent')
//   web   — direct web-research insight (currently equivalent to agent)
//
// Status:
//   active   — currently in the role's memory
//   archived — user removed it (kept for audit trail)
//   rejected — user rejected an agent-proposed insertion
export const agentKnowledge = pgTable("agent_knowledge", {
  id: serial("id").primaryKey(),
  role_key: text("role_key").notNull(),                         // matches org_agents.role_key
  content: text("content").notNull(),                           // the note itself; markdown allowed
  title: text("title"),                                          // optional short label
  source: text("source").notNull().default("user"),             // user | agent | web
  tags: jsonb("tags").$type<string[]>().default([]),
  status: text("status").notNull().default("active"),           // active | archived | rejected
  created_by_role: text("created_by_role"),                     // null for user; e.g. 'ceo' if proposed by an agent
  created_at: text("created_at").notNull(),
  decided_at: text("decided_at"),
  decided_note: text("decided_note"),
});

// ── Agent Proposals ─────────────────────────────────────────────────────────
// Each role-skill (CEO, CFO, Sales Director, etc.) writes structured
// proposals here when its scheduled run produces a recommendation. The
// /exec/org-chart page renders pending proposals at the bottom so the
// user (acting as final decision-maker) can Accept / Reject / Comment.
//
// "Healthy tension" is intentional: pricing-director maximises margin,
// sales-director maximises win-rate, CFO maximises EBITDA, marketing
// maximises pipeline-from-content. They will frequently DISAGREE — that's
// the design. The human resolves.
//
// Lifecycle:
//   pending  → fresh, awaiting human decision
//   accepted → user said yes; the proposing agent should action it
//   rejected → user said no; agent shouldn't re-propose for 14d
//   actioned → user marked it done after acting on it
//   stale    → 14d since pending with no decision; archived
export const agentProposals = pgTable("agent_proposals", {
  id: serial("id").primaryKey(),
  role_key: text("role_key").notNull(),                  // matches org_agents.role_key
  cycle_at: text("cycle_at").notNull(),                  // ISO timestamp the agent run produced this
  cycle_label: text("cycle_label"),                      // "9am-daily" | "2pm-daily" | "manual"
  priority: text("priority").notNull().default("p2"),    // "p0" | "p1" | "p2"
  category: text("category").notNull().default("general"), // "pricing" | "hiring" | "ar" | "pipeline" | "marketing" | "ops" | "general"
  summary: text("summary").notNull(),                    // one-line headline
  rationale: text("rationale"),                          // why — bullets of evidence
  action_required: text("action_required"),              // what the human needs to decide / do
  links: jsonb("links").$type<{ label: string; url: string }[]>().default([]),
  status: text("status").notNull().default("pending"),   // pending | accepted | rejected | actioned | stale
  decided_at: text("decided_at"),
  decided_note: text("decided_note"),                    // free-text user comment when deciding
  created_at: text("created_at").notNull(),
});

// ── Org Chart ───────────────────────────────────────────────────────────────
// One row per agent in the company (CEO + each direct report). Mirrors the
// eendigo-ceo skill's state/org_chart.json so the same data is visible in
// the app and editable by both the user and the CEO skill via the API.
//
// Each role has:
//   • goals          — short bullet list of strategic priorities (the "what")
//   • okrs           — quarterly Objectives + Key Results
//   • tasks_10d      — concrete tasks the agent plans to execute in the
//                       next 10 days. Updated daily (by the agent's cron run
//                       or a CEO refresh). Each task: { id, title, due_date,
//                       status: "todo" | "in_progress" | "done" | "blocked",
//                       linked_url? (e.g. /pricing/cases/123) }
//   • parent_role_key — null for CEO; "ceo" for direct reports; "coo" later
export const orgAgents = pgTable("org_agents", {
  id: serial("id").primaryKey(),
  role_key: text("role_key").notNull().unique(),     // "ceo", "cfo", "sales-director", "marketing-manager", "pricing-director", "hiring-manager", "coo"
  role_name: text("role_name").notNull(),            // human label, e.g. "Chief Financial Officer"
  parent_role_key: text("parent_role_key"),          // null for CEO; primary "solid line" boss
  // dotted_parent_role_keys: secondary "dotted line" matrix bosses. Pattern
  // common in consulting: e.g. CFO reports primarily to CEO but dotted-line
  // to Sales Director because CFO produces contracts + invoicing for sales
  // engagements. Empty by default. UI renders as dashed lines distinct from
  // the solid primary-line.
  dotted_parent_role_keys: jsonb("dotted_parent_role_keys").$type<string[]>().notNull().default([]),
  person_name: text("person_name"),                  // optional human owner (e.g. "Adrian")
  status: text("status").notNull().default("active"),// "active" | "onboarding" | "vacant" | "fired"
  // kind: "agent" = AI role-skill produces briefs/proposals; "human" = real
  // person we coordinate with (e.g. an external freelancer or partner). Email
  // is the primary touchpoint for human roles. Default "agent" preserves
  // existing rows. UI shows a different badge + an "Email instructions" link
  // for human roles.
  kind: text("kind").notNull().default("agent"),
  email: text("email"),
  goals: jsonb("goals").$type<string[]>().notNull().default([]),
  okrs: jsonb("okrs").$type<{ objective: string; key_results: string[] }[]>().notNull().default([]),
  tasks_10d: jsonb("tasks_10d").$type<{
    id: string;
    title: string;
    due_date: string;       // ISO YYYY-MM-DD
    status: "todo" | "in_progress" | "done" | "blocked";
    linked_url?: string;    // optional deep-link to compplan page
    note?: string;
  }[]>().notNull().default([]),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// ── Company assets (laptops, software licenses, monitors, phones, …) ───────
// Two-table design:
//   asset_types  — admin-managed list of categories (PC, ThinkCell, …).
//                  Has a flag for whether the type carries a license_key
//                  (software) so the UI shows the right input.
//   assets       — individual asset rows. Each can be assigned to one
//                  employee and has a status (in_use / out_of_use / spare /
//                  retired). Software-license rows can share the same
//                  license_key across multiple assignments (e.g. a single
//                  ThinkCell key shared by 4 people = 4 rows w/ same key).
export const assetTypes = pgTable("asset_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),                     // "PC", "ThinkCell"
  has_license_key: integer("has_license_key").notNull().default(0), // 1 = software, 0 = hardware
  // Optional template hint shown to the user when adding a new asset of
  // this type ("e.g. LAP05 / Lenovo V15 G4 IRU"). Free text.
  identifier_hint: text("identifier_hint"),
  details_hint: text("details_hint"),
  created_at: text("created_at").notNull(),
});

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  // Denormalised type name (matches asset_types.name) for resilience —
  // avoids a JOIN on every list call. Updated if type is renamed.
  asset_type: text("asset_type").notNull(),
  identifier: text("identifier"),                            // "LAP02"
  details: text("details"),                                  // "Lenovo IdeaPad 3 15ITL6"
  employee_id: text("employee_id"),                          // FK to employees.id (string)
  status: text("status").notNull().default("in_use"),        // "in_use" | "out_of_use" | "spare" | "retired"
  license_key: text("license_key"),                          // software only
  notes: text("notes"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const insertAssetTypeSchema = createInsertSchema(assetTypes).omit({ id: true, created_at: true });
export const insertAssetSchema = createInsertSchema(assets).omit({ id: true, created_at: true, updated_at: true });
export type AssetType = typeof assetTypes.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type InsertAssetType = typeof assetTypes.$inferInsert;
export type InsertAsset = typeof assets.$inferInsert;

// ── OKR node data (per-branch metadata for /exec/okr) ─────────────────────
// The EBITDA Growth Driver Tree itself is a static const in OkrTree.tsx
// (35 nodes, 5 levels). This table stores per-node EDITABLE data: the
// goals/objectives the user wants to track on that branch, KPIs with
// targets + current values, additional dependency edges (cross-branch),
// and override owners (in case the static map's ownersRoleKeys is wrong).
// Keyed by node_id ("A1", "B1", "D1", …) so the tree structure can change
// without breaking the relations.
export const okrNodeData = pgTable("okr_node_data", {
  id: serial("id").primaryKey(),
  node_id: text("node_id").notNull().unique(),
  objectives: jsonb("objectives").$type<{ text: string; target?: string | null }[]>().notNull().default([]),
  kpis: jsonb("kpis").$type<{ name: string; target?: string | null; current?: string | null; unit?: string | null }[]>().notNull().default([]),
  depending_node_ids: jsonb("depending_node_ids").$type<string[]>().notNull().default([]),
  owner_override_role_keys: jsonb("owner_override_role_keys").$type<string[] | null>().default(null),
  notes: text("notes"),
  updated_at: text("updated_at").notNull(),
});
export type OkrNodeData = typeof okrNodeData.$inferSelect;

// ─── PHASE 1 — Agentic Org Foundation ───────────────────────────────────────
// Parallel "agentic operating layer" tables. Coexists with the existing
// org_agents / agent_proposals / agent_knowledge tables — those drive the
// Org Chart visualisation; THESE tables drive the daily-cycle business
// operating loop (3 ideas + 3 actions per agent, approvals, conflicts,
// executive log) per the Phase-1 blueprint.
//
// Naming convention: every Phase-1 table is added under this section so the
// agentic-org module stays easy to find. NO existing table is mutated —
// the two systems can be reconciled in a later phase.

export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  mission: text("mission"),
  boss_id: integer("boss_id"),                                     // self-FK; null = top (Livio)
  status: text("status").notNull().default("active"),              // active | paused | retired
  app_sections_assigned: text("app_sections_assigned"),
  decision_rights_autonomous: text("decision_rights_autonomous"),
  decision_rights_boss: text("decision_rights_boss"),
  decision_rights_ceo: text("decision_rights_ceo"),
  decision_rights_livio: text("decision_rights_livio"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const objectives = pgTable("objectives", {
  id: serial("id").primaryKey(),
  agent_id: integer("agent_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  target_date: text("target_date"),
  status: text("status").notNull().default("open"),                // open | done | dropped
  created_at: text("created_at").notNull(),
});

export const keyResults = pgTable("key_results", {
  id: serial("id").primaryKey(),
  objective_id: integer("objective_id").notNull(),
  title: text("title").notNull(),
  target_value: text("target_value"),
  current_value: text("current_value"),
  unit: text("unit"),
  created_at: text("created_at").notNull(),
});

export const ideas = pgTable("ideas", {
  id: serial("id").primaryKey(),
  agent_id: integer("agent_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  okr_link: integer("okr_link"),                                   // FK → objectives.id (nullable)
  impact_score: integer("impact_score"),
  effort_score: integer("effort_score"),
  risk_score: integer("risk_score"),
  total_score: integer("total_score"),
  status: text("status").notNull().default("proposed"),            // proposed | approved | rejected | postponed | executed
  created_at: text("created_at").notNull(),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  agent_id: integer("agent_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  deadline: text("deadline"),
  priority: integer("priority").notNull().default(50),             // 0-100; higher = more urgent
  status: text("status").notNull().default("open"),                // open | in_progress | done | blocked
  approval_level: text("approval_level").notNull().default("autonomous"),  // autonomous | boss | ceo | livio
  approval_status: text("approval_status").notNull().default("not_required"), // not_required | pending | approved | rejected
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const executiveLog = pgTable("executive_log", {
  id: serial("id").primaryKey(),
  timestamp: text("timestamp").notNull(),
  agent_id: integer("agent_id"),                                   // nullable — system events
  event_type: text("event_type").notNull(),
  // event_type vocabulary (free text but UI filters from this list):
  //   idea_generated | action_proposed | task_created | approval_requested |
  //   approval_granted | approval_rejected | conflict_detected |
  //   prompt_generated | output_imported | decision_logged |
  //   coffee_break | exec_committee_called
  payload: jsonb("payload"),
  created_at: text("created_at").notNull(),
});

export const conflicts = pgTable("conflicts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  agents_involved: text("agents_involved"),                        // free text or comma-separated names
  okrs_affected: text("okrs_affected"),
  severity: text("severity"),                                      // low | medium | high
  ceo_recommendation: text("ceo_recommendation"),
  livio_decision: text("livio_decision"),
  status: text("status").notNull().default("open"),                // open | escalated | resolved
  created_at: text("created_at").notNull(),
  resolved_at: text("resolved_at"),
});

export type Agent      = typeof agents.$inferSelect;
export type Objective  = typeof objectives.$inferSelect;
export type KeyResult  = typeof keyResults.$inferSelect;
export type Idea       = typeof ideas.$inferSelect;
export type Task       = typeof tasks.$inferSelect;
export type LogEntry   = typeof executiveLog.$inferSelect;
export type Conflict   = typeof conflicts.$inferSelect;

// ── Phase 2 — Cowork Skills Library ─────────────────────────────────────
// Stores the markdown text of every Cowork-targeted skill. Two flavours:
//   kind='core'    — handcrafted top-of-org skills (CEO, COO). Seeded
//                    on boot; the user pastes them into Cowork sessions.
//   kind='drafted' — produced by the COO Skill Factory from an approved
//                    CEO proposal (TYPE=proposal). status=draft until the
//                    user reviews + clicks "Mark as ready"; then 'ready';
//                    then 'pasted' once dropped into Cowork.
export const coworkSkills = pgTable("cowork_skills", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),                                    // "Eendigo CEO" / "Eendigo Customer Reactivation Agent"
  agent_key: text("agent_key").notNull().unique(),                 // kebab-case slug, used as anchor
  kind: text("kind").notNull().default("core"),                    // core | drafted
  markdown: text("markdown").notNull(),                            // the full skill body
  status: text("status").notNull().default("ready"),               // draft | ready | pasted | superseded
  source_task_id: integer("source_task_id"),                       // FK→tasks.id (approved proposal that triggered the draft)
  source_agent_id: integer("source_agent_id"),                     // FK→agents.id (who this skill is for)
  notes: text("notes"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});
export type CoworkSkill = typeof coworkSkills.$inferSelect;

// ── President → CEO request channel ─────────────────────────────────────
// Direct one-way input from Livio (acting as President) to the CEO agent.
// Lifecycle:
//   pending           — request just submitted, CEO hasn't replied yet
//   answered          — CEO answered directly (ceo_response filled)
//   needs_committee   — CEO chose to escalate; committee_prompt is generated
//                       for Livio to paste into Cowork
//   committee_done    — Cowork outcome pasted back; CEO can now finalise
// Mirrors the DDL in server/seed.ts (uses TIMESTAMPTZ for date columns).
export const presidentRequests = pgTable("president_requests", {
  id: serial("id").primaryKey(),
  message: text("message").notNull(),
  status: text("status").notNull().default("pending"),
  ceo_response: text("ceo_response"),
  committee_prompt: text("committee_prompt"),
  committee_outcome: text("committee_outcome"),
  created_at: text("created_at"),
  responded_at: text("responded_at"),
  updated_at: text("updated_at"),
});
export type PresidentRequest = typeof presidentRequests.$inferSelect;

// ── Phase 3 — Agent ↔ App-Section Map ────────────────────────────────────
export const agentSectionMap = pgTable("agent_section_map", {
  id:               serial("id").primaryKey(),
  module:           text("module").notNull(),
  section:          text("section").notNull(),
  subsection:       text("subsection").notNull(),
  primary_agent:    text("primary_agent").notNull(),
  secondary_agents: text("secondary_agents").notNull().default(""),
  why:              text("why").notNull().default(""),
  frequency:        text("frequency").notNull().default("Daily"),
  created_at:       text("created_at").notNull(),
  updated_at:       text("updated_at").notNull(),
});
export type AgentSectionMapRow = typeof agentSectionMap.$inferSelect;
