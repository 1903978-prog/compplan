import { db } from "./db";
import { roleGridEntries, appSettings, employees } from "@shared/schema";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { SEED_PROPOSALS } from "./seedProposals";

const SEED_EMPLOYEES = [
  {
    id: "emp-defne",
    name: "Defne",
    date_of_birth: "2001-01-01",
    current_role_code: "A2",
    hire_date: "2023-06",
    last_promo_date: "2024-03-01",
    tenure_before_years: 0.5,
    current_gross_fixed_year: 36387,
    meal_voucher_daily: 8,
    months_paid: 13,
    current_bonus_pct: 15,
    performance_score: 7,
    monthly_ratings: [],
    completed_tests: [],
  },
  {
    id: "emp-malika",
    name: "Malika",
    date_of_birth: "2000-01-01",
    current_role_code: "A1",
    hire_date: "2024-09",
    last_promo_date: "2025-10-21",
    tenure_before_years: 2.0,
    current_gross_fixed_year: 28788,
    meal_voucher_daily: 8,
    months_paid: 12,
    current_bonus_pct: 10,
    performance_score: 7,
    monthly_ratings: [],
    completed_tests: [],
  },
  {
    id: "emp-edoardo",
    name: "Edoardo",
    date_of_birth: "1995-01-01",
    current_role_code: "EM1",
    hire_date: "2026-01",
    last_promo_date: "2026-02-21",
    tenure_before_years: 5.0,
    current_gross_fixed_year: 60000,
    meal_voucher_daily: 8,
    months_paid: 13,
    current_bonus_pct: 20,
    performance_score: 8.1,
    monthly_ratings: [],
    completed_tests: [],
  },
  {
    id: "emp-nicolas",
    name: "Nicolas",
    date_of_birth: "1998-01-01",
    current_role_code: "BA",
    hire_date: "2026-02",
    last_promo_date: "2026-02-21",
    tenure_before_years: 2.5,
    current_gross_fixed_year: 24600,
    meal_voucher_daily: 8,
    months_paid: 12,
    current_bonus_pct: 0,
    performance_score: 7,
    monthly_ratings: [],
    completed_tests: [],
  },
  {
    id: "emp-dior",
    name: "Dior",
    date_of_birth: "1982-01-01",
    current_role_code: "A1",
    hire_date: "2026-02",
    last_promo_date: "2025-07-21",
    tenure_before_years: 0.0,
    current_gross_fixed_year: 28788,
    meal_voucher_daily: 8,
    months_paid: 12,
    current_bonus_pct: 10,
    performance_score: 7,
    monthly_ratings: [],
    completed_tests: [],
  },
  {
    id: "emp-cosmin",
    name: "Cosmin Bunescu",
    date_of_birth: "1990-01-01",
    current_role_code: "ADMIN",
    hire_date: "2024-01-01",
    last_promo_date: null,
    tenure_before_years: 0,
    current_gross_fixed_year: 24000,
    meal_voucher_daily: 0,
    months_paid: 12,
    current_bonus_pct: 0,
    performance_score: 7,
    monthly_ratings: [],
    completed_tests: [],
  },
];

const DEFAULT_ROLE_GRID = [
  { role_code: "ADMIN", role_name: "Admin",               next_role_code: null,  promo_years_fast: 0,    promo_years_normal: 0,    promo_years_slow: 0,    ral_min_k: 0,    ral_max_k: 0,    gross_fixed_min_month: 0,    gross_fixed_max_month: 0,    bonus_pct: 0,  meal_voucher_eur_per_day: 0, months_paid: 12, sort_order: -1 },
  { role_code: "INT",   role_name: "Intern",               next_role_code: "BA",  promo_years_fast: 0.25, promo_years_normal: 0.5,  promo_years_slow: 0.75, ral_min_k: 10,   ral_max_k: 12,   gross_fixed_min_month: 850,  gross_fixed_max_month: 1275, bonus_pct: 0,  meal_voucher_eur_per_day: 0, months_paid: 12, sort_order: 0 },
  { role_code: "BA",  role_name: "Business Analyst",     next_role_code: "A1",  promo_years_fast: 0.75, promo_years_normal: 1.0,  promo_years_slow: 1.5,  ral_min_k: 16.3, ral_max_k: 27.3, gross_fixed_min_month: 1600, gross_fixed_max_month: 2400, bonus_pct: 0,  meal_voucher_eur_per_day: 8, months_paid: 12, sort_order: 1 },
  { role_code: "A1",  role_name: "Associate 1",          next_role_code: "A2",  promo_years_fast: 0.5,  promo_years_normal: 0.75, promo_years_slow: 1.0,  ral_min_k: 19.7, ral_max_k: 23.5, gross_fixed_min_month: 1872, gross_fixed_max_month: 2153, bonus_pct: 10, meal_voucher_eur_per_day: 8, months_paid: 12, sort_order: 2 },
  { role_code: "A2",  role_name: "Associate 2",          next_role_code: "S1",  promo_years_fast: 0.5,  promo_years_normal: 0.75, promo_years_slow: 1.0,  ral_min_k: 24.7, ral_max_k: 30.4, gross_fixed_min_month: 2059, gross_fixed_max_month: 2368, bonus_pct: 10, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 3 },
  { role_code: "S1",  role_name: "Senior 1",             next_role_code: "S2",  promo_years_fast: 0.5,  promo_years_normal: 0.75, promo_years_slow: 1.0,  ral_min_k: 28.4, ral_max_k: 35.1, gross_fixed_min_month: 2265, gross_fixed_max_month: 2605, bonus_pct: 15, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 4 },
  { role_code: "S2",  role_name: "Senior 2",             next_role_code: "C1",  promo_years_fast: 0.5,  promo_years_normal: 0.75, promo_years_slow: 1.0,  ral_min_k: 31.3, ral_max_k: 39.3, gross_fixed_min_month: 2424, gross_fixed_max_month: 2787, bonus_pct: 15, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 5 },
  { role_code: "C1",  role_name: "Consultant 1",         next_role_code: "C2",  promo_years_fast: 0.75, promo_years_normal: 1.0,  promo_years_slow: 1.5,  ral_min_k: 33.7, ral_max_k: 44.3, gross_fixed_min_month: 2545, gross_fixed_max_month: 3054, bonus_pct: 20, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 6 },
  { role_code: "C2",  role_name: "Consultant 2",         next_role_code: "EM1", promo_years_fast: 0.75, promo_years_normal: 1.0,  promo_years_slow: 1.5,  ral_min_k: 40.4, ral_max_k: 50.8, gross_fixed_min_month: 2850, gross_fixed_max_month: 3420, bonus_pct: 20, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 7 },
  { role_code: "EM1", role_name: "Engagement Manager 1", next_role_code: "EM2", promo_years_fast: 1.0,  promo_years_normal: 1.5,  promo_years_slow: 2.0,  ral_min_k: 50.8, ral_max_k: 62.4, gross_fixed_min_month: 3420, gross_fixed_max_month: 4104, bonus_pct: 20, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 8 },
  { role_code: "EM2", role_name: "Engagement Manager 2", next_role_code: null,  promo_years_fast: 1.0,  promo_years_normal: 1.5,  promo_years_slow: 2.0,  ral_min_k: 62.4, ral_max_k: 81.1, gross_fixed_min_month: 4104, gross_fixed_max_month: 4925, bonus_pct: 25, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 9 },
];

const DEFAULT_TESTS = [
  { id: "1", name: "Onboarding", due_from_hire_months: 2 },
  { id: "2", name: "Project zero", due_from_hire_months: 2 },
  { id: "3", name: "Policies", due_from_hire_months: 1 },
  { id: "4", name: "Cybersecurity", due_from_hire_months: 1 },
  { id: "5", name: "White belt", due_from_hire_months: 12 },
  { id: "6", name: "Consulting foundations", due_from_hire_months: 12 },
  { id: "7", name: "Green belt", due_from_hire_months: 24 },
];

export async function seedDatabase() {
  // Ensure days_off_entries table exists
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS days_off_entries (
      id SERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'taken',
      year INTEGER NOT NULL,
      start_date TEXT,
      end_date TEXT,
      days REAL NOT NULL,
      note TEXT
    )
  `);

  // Ensure salary_history table exists
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS salary_history (
      id SERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      role_code TEXT,
      gross_fixed_year REAL NOT NULL,
      months_paid INTEGER,
      bonus_pct REAL,
      meal_voucher_daily REAL,
      note TEXT
    )
  `);
  // Pricing Tool tables
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pricing_settings (
      id SERIAL PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pricing_cases (
      id SERIAL PRIMARY KEY,
      project_name TEXT NOT NULL,
      client_name TEXT NOT NULL DEFAULT '',
      fund_name TEXT,
      industry TEXT,
      country TEXT,
      region TEXT NOT NULL DEFAULT 'Italy',
      pe_owned INTEGER NOT NULL DEFAULT 1,
      revenue_band TEXT NOT NULL DEFAULT 'above_1b',
      price_sensitivity TEXT NOT NULL DEFAULT 'medium',
      duration_weeks REAL NOT NULL DEFAULT 8,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      staffing JSONB NOT NULL DEFAULT '[]',
      recommendation JSONB,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pricing_proposals (
      id SERIAL PRIMARY KEY,
      proposal_date TEXT NOT NULL,
      project_name TEXT NOT NULL,
      client_name TEXT,
      fund_name TEXT,
      region TEXT NOT NULL,
      country TEXT,
      pe_owned INTEGER NOT NULL DEFAULT 1,
      revenue_band TEXT NOT NULL DEFAULT 'above_1b',
      price_sensitivity TEXT,
      duration_weeks REAL,
      weekly_price REAL NOT NULL,
      total_fee REAL,
      outcome TEXT NOT NULL DEFAULT 'pending',
      loss_reason TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS hiring_candidates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      info TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'potential',
      sort_order INTEGER NOT NULL DEFAULT 0,
      external_id TEXT,
      sync_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
  // Employee tasks table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS employee_tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      delegated_to TEXT NOT NULL,
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    )
  `);

  // Add columns if upgrading from older schema
  await db.execute(sql`ALTER TABLE hiring_candidates ADD COLUMN IF NOT EXISTS external_id TEXT`);
  await db.execute(sql`ALTER TABLE hiring_candidates ADD COLUMN IF NOT EXISTS sync_locked INTEGER NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS extended_inputs JSONB`);

  // New employee columns
  await db.execute(sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS university_grade REAL`);
  await db.execute(sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS university_grade_type TEXT`);
  await db.execute(sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS promotion_discussion_notes TEXT`);
  await db.execute(sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS onboarding_ratings JSONB DEFAULT '[]'`);
  await db.execute(sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS yearly_reviews JSONB DEFAULT '[]'`);
  await db.execute(sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS comex_areas JSONB DEFAULT '{}'`);

  // Deal context columns for pricing_cases
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS project_type TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS sector TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS ebitda_margin_pct REAL`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS commercial_maturity REAL`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS urgency REAL`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS competitive_intensity TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS competitor_type TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS ownership_type TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS strategic_intent TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS procurement_involvement TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS case_discounts JSONB`);

  // New columns for pricing_proposals
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS sector TEXT`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS project_type TEXT`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS company_revenue_m REAL`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS ebitda_margin_pct REAL`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS expected_ebitda_growth_pct REAL`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS team_size REAL NOT NULL DEFAULT 1`);

  // Time tracking tables
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS time_tracking_topics (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS time_tracking_entries (
      id SERIAL PRIMARY KEY,
      topic_id INTEGER NOT NULL,
      topic_name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT
    )
  `);

  // Seed default topics if empty
  const topicCount = await db.execute(sql`SELECT COUNT(*) as c FROM time_tracking_topics`);
  if (Number((topicCount as any).rows?.[0]?.c ?? 0) === 0) {
    const defaults = ["ADMIN", "Hunting", "Project", "Hiring", "Cosmin"];
    for (let i = 0; i < defaults.length; i++) {
      await db.execute(sql`INSERT INTO time_tracking_topics (name, sort_order) VALUES (${defaults[i]}, ${i})`);
    }
  }

  // Proposals table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS proposals (
      id SERIAL PRIMARY KEY,
      company_name TEXT NOT NULL,
      website TEXT,
      transcript TEXT,
      notes TEXT,
      revenue REAL,
      ebitda_margin REAL,
      scope_perimeter TEXT,
      objective TEXT,
      urgency TEXT,
      company_summary TEXT,
      proposal_title TEXT,
      why_now TEXT,
      objective_statement TEXT,
      scope_statement TEXT,
      recommended_team TEXT,
      staffing_intensity TEXT,
      options JSONB NOT NULL DEFAULT '[]',
      ai_analysis JSONB,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Proposal templates table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS proposal_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      file_data TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      uploaded_at TEXT NOT NULL
    )
  `);

  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS attachment_url TEXT`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS excluded_from_analysis INTEGER NOT NULL DEFAULT 0`);

  // API pause flag — default paused; reset to paused on every restart.
  // This runs unconditionally so the API cannot silently stay unpaused across deploys.
  await db.execute(sql`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS api_paused INTEGER NOT NULL DEFAULT 1`);
  await db.execute(sql`ALTER TABLE app_settings ALTER COLUMN api_paused SET DEFAULT 1`);
  await db.execute(sql`UPDATE app_settings SET api_paused = 1`);
  console.log("[seed] API set to paused (requires password to resume)");

  // Seed pricing_proposals from historical win/loss Excel (idempotent by project_name)
  // Note: no count-gate here — the WHERE NOT EXISTS guard ensures deleted rows stay deleted.
  try {
    for (const p of SEED_PROPOSALS) {
      await db.execute(sql`
        INSERT INTO pricing_proposals
          (proposal_date, project_name, client_name, fund_name, region, country, pe_owned, revenue_band, duration_weeks, weekly_price, total_fee, outcome, notes, created_at)
        SELECT ${p.proposal_date}, ${p.project_name}, ${p.client_name}, ${p.fund_name}, ${p.region}, ${p.country}, ${p.pe_owned}, ${p.revenue_band}, ${p.duration_weeks}, ${p.weekly_price}, ${p.total_fee}, ${p.outcome}, ${p.notes}, ${new Date().toISOString()}
        WHERE NOT EXISTS (SELECT 1 FROM pricing_proposals WHERE project_name = ${p.project_name})
      `);
    }
  } catch (e) {
    console.error("Failed to seed pricing_proposals:", e);
  }

  // Add comprehensive pricing case columns (idempotent)
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS company_revenue_m REAL`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS aspiration_ebitda_eur REAL`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS target_roi REAL`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS max_fees_ebitda_pct REAL`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS aspiration_ebitda_pct REAL`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS relationship_type TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS decision_maker TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS budget_disclosed_eur REAL`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS incumbent_advisor TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS geographic_scope TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS value_driver TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS differentiation TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS risk_flags JSONB`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS problem_statement TEXT`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS expected_impact_eur REAL`);

  // Add project_type and slide_selection columns to proposals (idempotent)
  await db.execute(sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_type TEXT`);
  await db.execute(sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS slide_selection JSONB NOT NULL DEFAULT '[]'`);
  await db.execute(sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS slide_briefs JSONB NOT NULL DEFAULT '[]'`);
  await db.execute(sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS call_checklist JSONB NOT NULL DEFAULT '[]'`);

  // Slide methodology config table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS slide_methodology_configs (
      slide_id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL DEFAULT '',
      structure JSONB NOT NULL DEFAULT '{"sections":[]}',
      rules TEXT NOT NULL DEFAULT '',
      columns JSONB NOT NULL DEFAULT '{}',
      variations JSONB NOT NULL DEFAULT '{}',
      examples JSONB NOT NULL DEFAULT '[]',
      format TEXT NOT NULL DEFAULT 'A',
      insight_bar INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(sql`ALTER TABLE slide_methodology_configs ADD COLUMN IF NOT EXISTS guidance_image TEXT`);
  await db.execute(sql`ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS body TEXT`);

  // Seed default configs for Executive Summary + Deep Dive (idempotent)
  await db.execute(sql`
    INSERT INTO slide_methodology_configs (slide_id, purpose, structure, rules, columns, variations, examples, format, insight_bar, updated_at)
    VALUES (
      'exec_summary',
      'High-level overview that enables a decision-maker to understand context, recommendation, and impact in one page.',
      '{"sections":["Context","Why now","Recommendation","Impact","How","Scope","Deliverables"]}',
      '- Must include Top 3 priorities
- Must be quantified (revenue, margin, FTE impact)
- No generic consulting language
- Must be decision-oriented (what, why, how much)
- Maximum 7 bullet points
- Each bullet must start with a verb or a number',
      '{"column_1":"Context / problem","column_2":"Recommendation / approach","column_3":"Impact / value"}',
      '{"SPARK (Diagnostic)":"Emphasize diagnostic scope and maturity assessment output","War Rooms (Execution)":"Focus on KPI targets and execution cadence","Pricing":"Highlight price optimization opportunity and GTN leakage"}',
      '["Revenue uplift of EUR 12M through pricing optimization across 3 product lines","Reduce GTN leakage by 3.2pp through systematic discount governance","Deploy 4-week war room cadence with weekly KPI tracking across 12 regions"]',
      'B',
      1,
      ${new Date().toISOString()}
    )
    ON CONFLICT (slide_id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO slide_methodology_configs (slide_id, purpose, structure, rules, columns, variations, examples, format, insight_bar, updated_at)
    VALUES (
      'deep_dive',
      'Detailed analysis of a key workstream showing observation-root cause-action logic with specific drivers.',
      '{"sections":["Drivers (8-12 max)","Key observations","Root causes","Recommendations","Analytical proof (optional)"]}',
      '- MUST follow: Observation → Root cause → Action pattern
- MUST be specific to project type and client industry
- MUST be concrete and data-backed
- Each driver = 1 observation + 1 root cause + 1 action
- Maximum 12 drivers
- Avoid generic recommendations
- Use client-specific language and metrics',
      '{"column_1":"Observation / finding","column_2":"Root cause","column_3":"Recommended action"}',
      '{"Strategy":"Focus on market segmentation gaps and prioritization logic","SPARK (Diagnostic)":"Emphasize maturity gaps across commercial dimensions","War Rooms (Execution)":"Focus on execution bottlenecks and KPI gaps","SFE (Sales Force Excellence)":"Coverage, activity, pipeline, and conversion drivers","Pricing":"Price driver analysis, GTN waterfall, discount governance gaps"}',
      '["Coverage gap: 35% of high-potential accounts have no dedicated coverage → Reallocate 12 reps from low-value territories","Discount leakage: Average discount 28% vs. 22% target → Implement tiered approval workflow with 3 authority levels","Pipeline quality: 60% of pipeline >90 days old → Introduce monthly pipeline hygiene war room with mandatory stage validation"]',
      'A',
      0,
      ${new Date().toISOString()}
    )
    ON CONFLICT (slide_id) DO NOTHING
  `);

  // Project type slide defaults (learned from user selections)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS project_type_slide_defaults (
      project_type TEXT PRIMARY KEY,
      slide_ids JSONB NOT NULL DEFAULT '[]',
      slide_order JSONB NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    )
  `);

  // Deck template config table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS deck_template_configs (
      id SERIAL PRIMARY KEY,
      palette JSONB NOT NULL DEFAULT '{}',
      typography JSONB NOT NULL DEFAULT '{}',
      format_a_desc TEXT NOT NULL DEFAULT '',
      format_b_desc TEXT NOT NULL DEFAULT '',
      footer_left TEXT NOT NULL DEFAULT '',
      footer_right TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    )
  `);

  // Seed default deck template (idempotent)
  const dtCount = await db.execute(sql`SELECT COUNT(*) as c FROM deck_template_configs`);
  if (Number((dtCount as any).rows?.[0]?.c ?? 0) === 0) {
    await db.execute(sql`
      INSERT INTO deck_template_configs (palette, typography, format_a_desc, format_b_desc, footer_left, footer_right, system_prompt, updated_at)
      VALUES (
        '{"C_TRACKER":"535353","C_TITLE":"1A6571","C_HEADER":"1A6571","C_BORDER":"16C3CF","C_BODY":"535353","C_WHITE":"FFFFFF","C_SUBHEAD":"16C3CF","C_BGROW":"F0F9FA"}'::jsonb,
        '{"tracker":"Arial 7pt #535353 NOT bold","title":"Arial 20pt #1A6571 Bold","headers":"Arial 11pt #1A6571 Bold","bullets":"Arial 8.5pt #535353","footer":"Arial 7pt #535353","eendigo":"Arial 7pt #1A6571 (footer right)","page_num":"Arial 7pt #535353 (footer right)"}'::jsonb,
        'FORMAT A: 3-COLUMN WITH ROW BANDS (training / cert / prereq)

Blocks support: header, training[], certificate[], prereq[] (Format A)
Set USE_ROW_BANDS = true to use this format.',
        'FORMAT B: PLAIN 3-COLUMN BULLETS

Blocks support: header, bullets[] (Format B)
Set USE_ROW_BANDS = false to use this format.',
        'Notes and source',
        'Eendigo',
        'You are a senior strategy consultant (McKinsey / BCG level) preparing one executive PowerPoint slide using the Eendigo consulting template.
PptxGenJS — 16:9

HOW TO USE:
1. Fill in SLIDE_TITLE and TRACKER
2. Edit blocks[] with your headers + bullets
3. Run: node eendigo_template.js
4. Output: eendigo_slide.pptx

PALETTE (DO NOT CHANGE)
C_TRACKER = "535353"
C_TITLE = "1A6571"
C_HEADER = "1A6571"
C_BORDER = "16C3CF"
C_BODY = "535353"
C_WHITE = "FFFFFF"
C_SUBHEAD = "16C3CF"
C_BGROW = "F0F9FA"

TYPOGRAPHY (DO NOT CHANGE)
TRACKER: Arial 7pt #535353 NOT bold
Title: Arial 20pt #1A6571 Bold
Headers: Arial 11pt #1A6571 Bold
Bullets: Arial 8.5pt #535353
Footer: Arial 7pt #535353
Eendigo: Arial 7pt #1A6571 (footer right)
Page num: Arial 7pt #535353 (footer right)

SLIDE_TITLE = "Insert your insight headline here — quantified takeaway for executives"

FORMAT A: 3-COLUMN WITH ROW BANDS (training / cert / prereq)
FORMAT B: PLAIN 3-COLUMN BULLETS

Set USE_ROW_BANDS = true or false to switch formats.

Blocks support: header, training[], certificate[], prereq[] (Format A)
Or: header, bullets[] (Format B)

Optional INSIGHT_BAR for bottom callout.
Footer left: "Notes and source"
Output: eendigo_slide.pptx

Run with: node eendigo_template.js',
        ${new Date().toISOString()}
      )
    `);
  }

  // Performance issues table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS performance_issues (
      id SERIAL PRIMARY KEY,
      employee_name TEXT NOT NULL,
      date TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Fix promo_years values: DB must store years (e.g. 0.5 = 6 months).
  // If any value is < 0.1 the DB got corrupted with wrong values — reset all promo fields.
  const existingRoles = await db.select().from(roleGridEntries);
  if (existingRoles.length > 0) {
    const hasCorrupt = existingRoles.some(
      (r) => r.promo_years_fast < 0.1 || r.promo_years_normal < 0.1 || r.promo_years_slow < 0.1
    );
    if (hasCorrupt) {
      console.log("Fixing corrupted promo_years values in role grid...");
      for (const def of DEFAULT_ROLE_GRID) {
        await db.execute(sql`
          UPDATE role_grid
          SET promo_years_fast   = ${def.promo_years_fast},
              promo_years_normal = ${def.promo_years_normal},
              promo_years_slow   = ${def.promo_years_slow}
          WHERE role_code = ${def.role_code}
        `);
      }
      console.log("Promo years fixed.");
    }
  }
  if (existingRoles.length === 0) {
    console.log("Seeding role grid...");
    await db.insert(roleGridEntries).values(DEFAULT_ROLE_GRID);
    console.log(`Seeded ${DEFAULT_ROLE_GRID.length} roles`);
  }

  // Seed employees if empty
  const existingEmployees = await db.select().from(employees);
  if (existingEmployees.length === 0) {
    console.log("Seeding employees...");
    await db.insert(employees).values(SEED_EMPLOYEES);
    console.log(`Seeded ${SEED_EMPLOYEES.length} employees`);
  }

  // Fix Defne: she is A2, not S1 — correct role and salary history
  await db.execute(sql`
    UPDATE employees
    SET current_role_code = 'A2',
        last_promo_date = '2024-03-01',
        current_gross_fixed_year = 36387
    WHERE id = 'emp-defne' AND current_role_code = 'S1'
  `);
  await db.execute(sql`
    UPDATE salary_history
    SET role_code = 'A2', effective_date = '2025-09-01', note = 'Salary increase'
    WHERE employee_id = 'emp-defne' AND role_code = 'S1'
  `);

  // Ensure Defne has BA and A1 salary history entries (may be missing if DB was seeded before these were added)
  const defneBaCount = await db.execute(sql`SELECT COUNT(*) as cnt FROM salary_history WHERE employee_id = 'emp-defne' AND role_code = 'BA'`);
  if (parseInt((defneBaCount.rows[0] as any).cnt) === 0) {
    await db.execute(sql`INSERT INTO salary_history (employee_id, effective_date, role_code, gross_fixed_year, months_paid, note) VALUES
      ('emp-defne', '2023-06-08', 'BA', 15120, 12, 'Hire')`);
  }
  const defneA1Count = await db.execute(sql`SELECT COUNT(*) as cnt FROM salary_history WHERE employee_id = 'emp-defne' AND role_code = 'A1'`);
  if (parseInt((defneA1Count.rows[0] as any).cnt) === 0) {
    await db.execute(sql`INSERT INTO salary_history (employee_id, effective_date, role_code, gross_fixed_year, months_paid, note) VALUES
      ('emp-defne', '2023-10-01', 'A1', 29280, 12, 'Promotion to A1')`);
  }

  // Seed Defne salary history (idempotent — only if no entries exist for her)
  const defneHistory = await db.execute(sql`SELECT COUNT(*) as cnt FROM salary_history WHERE employee_id = 'emp-defne'`);
  const defneCount = (defneHistory.rows[0] as any).cnt;
  if (parseInt(defneCount) === 0) {
    await db.execute(sql`INSERT INTO salary_history (employee_id, effective_date, role_code, gross_fixed_year, months_paid, note) VALUES
      ('emp-defne', '2023-06-08', 'BA',  15120, 12, 'Hire'),
      ('emp-defne', '2023-10-01', 'A1',  29280, 12, 'Promotion to A1'),
      ('emp-defne', '2024-03-01', 'A2',  34307, 13, 'Promotion to A2'),
      ('emp-defne', '2025-09-01', 'A2',  36387, 13, 'Salary increase')`);
    console.log("Seeded Defne salary history");
  }

  // Seed Malika salary history (idempotent)
  const malikaHistory = await db.execute(sql`SELECT COUNT(*) as cnt FROM salary_history WHERE employee_id = 'emp-malika'`);
  const malikaCount = (malikaHistory.rows[0] as any).cnt;
  if (parseInt(malikaCount) === 0) {
    await db.execute(sql`INSERT INTO salary_history (employee_id, effective_date, role_code, gross_fixed_year, months_paid, note) VALUES
      ('emp-malika', '2024-09-01', 'BA', 26136, 12, 'Hire'),
      ('emp-malika', '2025-10-01', 'A1', 28788, 12, 'Promotion to A1')`);
    console.log("Seeded Malika salary history");
  }

  // Update DOBs for known employees (Alessandro, Gabriele, Tiani)
  await db.execute(sql`UPDATE employees SET date_of_birth = '2001-04-08' WHERE name ILIKE '%alessandro%' AND date_of_birth = '2001-01-01'`);
  await db.execute(sql`UPDATE employees SET date_of_birth = '2005-06-08' WHERE name ILIKE '%gabriele%' AND date_of_birth = '2001-01-01'`);
  await db.execute(sql`UPDATE employees SET date_of_birth = '1994-12-11' WHERE name ILIKE '%tiani%' AND date_of_birth != '1994-12-11'`);

  // Seed Alessandro onboarding ratings W1-W3
  await db.execute(sql`
    UPDATE employees
    SET onboarding_ratings = '[{"week":1,"score":91},{"week":2,"score":91},{"week":3,"score":95}]'::jsonb
    WHERE name ILIKE '%alessandro%'
      AND (onboarding_ratings IS NULL OR onboarding_ratings = '[]'::jsonb)
  `);

  // Seed Edoardo onboarding ratings W1-W8
  await db.execute(sql`
    UPDATE employees
    SET onboarding_ratings = '[{"week":1,"score":76},{"week":2,"score":91},{"week":3,"score":89},{"week":4,"score":79},{"week":5,"score":83},{"week":6,"score":89},{"week":7,"score":87},{"week":8,"score":91}]'::jsonb
    WHERE name ILIKE '%edoardo%'
      AND (onboarding_ratings IS NULL OR onboarding_ratings = '[]'::jsonb)
  `);

  // Seed settings if empty
  const existingSettings = await db.select().from(appSettings);
  if (existingSettings.length === 0) {
    console.log("Seeding settings...");
    await db.insert(appSettings).values({
      id: 1,
      net_factor: 0.75,
      meal_voucher_days_per_month: 20,
      min_promo_increase_pct: 10,
      promotion_windows: ["01-01", "05-01", "09-01"],
      window_tolerance_days: 21,
      track_fast_threshold: 8.5,
      track_slow_threshold: 7.0,
      tests: DEFAULT_TESTS,
    });
    console.log("Settings seeded");
  }
}
