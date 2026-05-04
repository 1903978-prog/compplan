import { db } from "./db";
import { roleGridEntries, appSettings, employees } from "@shared/schema";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { SEED_PROPOSALS } from "./seedProposals";
import { AGENT_SPECS } from "./agentSpecsData";

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
  { role_code: "BO",    role_name: "Back Office",          next_role_code: null,  promo_years_fast: 0,    promo_years_normal: 0,    promo_years_slow: 0,    ral_min_k: 20,   ral_max_k: 28,   gross_fixed_min_month: 1667, gross_fixed_max_month: 2333, bonus_pct: 0,  meal_voucher_eur_per_day: 8, months_paid: 12, sort_order: -2 },
  { role_code: "ADMIN", role_name: "Admin",                next_role_code: null,  promo_years_fast: 0,    promo_years_normal: 0,    promo_years_slow: 0,    ral_min_k: 0,    ral_max_k: 0,    gross_fixed_min_month: 0,    gross_fixed_max_month: 0,    bonus_pct: 0,  meal_voucher_eur_per_day: 0, months_paid: 12, sort_order: -1 },
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

  // ── Indexes for fast Pricing Tool queries ──────────────────────────────
  // These are safe to run multiple times (IF NOT EXISTS). On a small table
  // (~50-200 rows) the queries are already fast, but these indexes eliminate
  // the sequential scan entirely and reduce sort cost for the ORDER BY columns.
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pricing_proposals_date    ON pricing_proposals (proposal_date)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pricing_proposals_outcome ON pricing_proposals (outcome)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pricing_cases_status      ON pricing_cases     (status)`);

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
  // Candidate scores — per-test 0-100 numbers captured by the hiring team
  // across the funnel (HSA, TestGorilla, intro call, case study, PPT etc.)
  // used to rank performers on the new Candidate Scoring dashboard. Null
  // = "not yet tested" (distinct from 0 = "failed").
  await db.execute(sql`ALTER TABLE hiring_candidates ADD COLUMN IF NOT EXISTS scores JSONB`);

  // Structured score columns extracted from the Eendigo scrape (was all
  // crammed into the `info` text blob). Real numbers so we can sort/filter
  // candidates by individual sub-tests; cs_lm stays TEXT because the
  // partner's Case-Study LM rating can be a percentage OR a textual grade.
  await db.execute(sql`ALTER TABLE hiring_candidates ADD COLUMN IF NOT EXISTS logic_pct REAL`);
  await db.execute(sql`ALTER TABLE hiring_candidates ADD COLUMN IF NOT EXISTS verbal_pct REAL`);
  await db.execute(sql`ALTER TABLE hiring_candidates ADD COLUMN IF NOT EXISTS excel_pct REAL`);
  await db.execute(sql`ALTER TABLE hiring_candidates ADD COLUMN IF NOT EXISTS p1_pct REAL`);
  await db.execute(sql`ALTER TABLE hiring_candidates ADD COLUMN IF NOT EXISTS p2_pct REAL`);
  await db.execute(sql`ALTER TABLE hiring_candidates ADD COLUMN IF NOT EXISTS intro_rate_pct REAL`);
  await db.execute(sql`ALTER TABLE hiring_candidates ADD COLUMN IF NOT EXISTS cs_rate_pct REAL`);
  await db.execute(sql`ALTER TABLE hiring_candidates ADD COLUMN IF NOT EXISTS cs_lm TEXT`);

  // Seed the "Back Up" manual candidate list — people who live outside the
  // Eendigo sync (personal referrals, cold replies). sync_locked=1 so the
  // nightly Eendigo import never overwrites or moves them. Idempotent via
  // a WHERE NOT EXISTS guard on (name, info) — re-running seed() keeps one
  // copy even if the user later moves the card to a different stage.
  try {
    const BACKUP_CANDIDATES: { name: string; info: string; stage: string }[] = [
      { name: "Ahmed Elkassas", info: "Email: ahmed_2assas@hotmail.com", stage: "potential" },
    ];
    const nowIso = new Date().toISOString();
    for (const c of BACKUP_CANDIDATES) {
      await db.execute(sql`
        INSERT INTO hiring_candidates (name, info, stage, sort_order, sync_locked, created_at)
        SELECT ${c.name}, ${c.info}, ${c.stage}, 9999, 1, ${nowIso}
        WHERE NOT EXISTS (
          SELECT 1 FROM hiring_candidates
          WHERE name = ${c.name} AND info = ${c.info}
        )
      `);
    }
  } catch (e) {
    console.error("Failed to seed Back Up candidates:", e);
  }
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
  // Engagement tracking (Won projects → Ongoing if end_date in future)
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS end_date TEXT`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS manager_name TEXT`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS team_members JSONB`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS last_invoice_at TEXT`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS weekly_reports JSONB`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS win_probability REAL`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS start_date TEXT`);

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
  // Structured loss-debrief payload — see schema.ts pricingProposals
  // for the expected shape. JSONB (not TEXT) so we can index/query
  // individual survey fields later without a migration.
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS client_feedback JSONB`);

  // Business Development / lightweight CRM — seeded by HubSpot imports
  // or manual entry on the /bd page. Idempotent so every boot can re-run
  // it safely. See shared/schema.ts ▸ bdDeals for the Drizzle model.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bd_deals (
      id SERIAL PRIMARY KEY,
      hubspot_id TEXT,
      name TEXT NOT NULL,
      client_name TEXT,
      contact_name TEXT,
      contact_email TEXT,
      stage TEXT NOT NULL DEFAULT 'lead',
      amount REAL,
      currency TEXT DEFAULT 'EUR',
      probability REAL,
      close_date TEXT,
      source TEXT,
      owner TEXT,
      notes TEXT,
      industry TEXT,
      region TEXT,
      last_activity_at TEXT,
      imported_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  // Partial unique index on hubspot_id: lets re-imports upsert cleanly
  // without blocking manual rows (which leave hubspot_id NULL).
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS bd_deals_hubspot_id_unique ON bd_deals (hubspot_id) WHERE hubspot_id IS NOT NULL`);

  // Raw free-text the user pastes into the "Slide Template Instructions"
  // bulk-parse dialog. Persisted so it survives reloads.
  await db.execute(sql`ALTER TABLE deck_template_configs ADD COLUMN IF NOT EXISTS slide_instructions_text TEXT NOT NULL DEFAULT ''`);

  // API pause flag — default paused; reset to paused on every restart.
  // This runs unconditionally so the API cannot silently stay unpaused across deploys.
  await db.execute(sql`ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS api_paused INTEGER NOT NULL DEFAULT 1`);
  await db.execute(sql`ALTER TABLE app_settings ALTER COLUMN api_paused SET DEFAULT 1`);
  await db.execute(sql`UPDATE app_settings SET api_paused = 1`);
  console.log("[seed] API set to paused (requires password to resume)");

  // ── Harvest invoice tracking tables ──────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS invoice_snapshots (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL UNIQUE,
      invoice_number TEXT,
      client_id INTEGER,
      client_name TEXT,
      amount INTEGER NOT NULL DEFAULT 0,
      due_amount INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      state TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'EUR',
      subject TEXT,
      sent_at TEXT,
      paid_at TEXT,
      invoice_created_at TEXT,
      period_start TEXT,
      period_end TEXT,
      updated_at TEXT NOT NULL
    )
  `);
  // Add new columns if table already exists (idempotent)
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS client_id INTEGER`);
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS due_amount INTEGER NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS due_date TEXT`);
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR'`);
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS subject TEXT`);
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS sent_at TEXT`);
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS paid_at TEXT`);
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS invoice_created_at TEXT`);
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS period_start TEXT`);
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS period_end TEXT`);
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS project_codes TEXT`);
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS project_names TEXT`);
  // Manual overrides — set by the user via the UI; the Harvest sync MUST NOT touch these.
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS project_codes_manual TEXT`);
  await db.execute(sql`ALTER TABLE invoice_snapshots ADD COLUMN IF NOT EXISTS project_names_manual TEXT`);

  // Per-client default project code. When an invoice has no auto-extracted
  // code AND no manual override, the GET endpoint falls back to this.
  // One row per Harvest client_id.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_project_defaults (
      client_id INTEGER PRIMARY KEY,
      default_code TEXT,
      default_name TEXT,
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS invoice_changes (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER NOT NULL,
      invoice_number TEXT,
      client_name TEXT,
      amount INTEGER NOT NULL DEFAULT 0,
      change_type TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      detected_at TEXT NOT NULL,
      approval_status TEXT NOT NULL DEFAULT 'pending',
      dismissed INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.execute(sql`ALTER TABLE invoice_changes ADD COLUMN IF NOT EXISTS old_value TEXT`);
  await db.execute(sql`ALTER TABLE invoice_changes ADD COLUMN IF NOT EXISTS new_value TEXT`);
  await db.execute(sql`ALTER TABLE invoice_changes ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending'`);

  // ── Won Projects (Invoicing Audit) ────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS won_projects (
      id SERIAL PRIMARY KEY,
      client_name TEXT NOT NULL,
      client_code TEXT NOT NULL,
      project_name TEXT NOT NULL,
      project_code TEXT,
      total_amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      won_date TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      invoicing_schedule_text TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`ALTER TABLE won_projects ADD COLUMN IF NOT EXISTS project_code TEXT`);
  await db.execute(sql`ALTER TABLE won_projects ADD COLUMN IF NOT EXISTS start_date TEXT`);
  await db.execute(sql`ALTER TABLE won_projects ADD COLUMN IF NOT EXISTS end_date TEXT`);
  // Task 11: simplified form — project_code + total_amount + nb_of_invoices + schedule.
  // Everything else (client_name, client_code, project_name, won_date) becomes optional.
  await db.execute(sql`ALTER TABLE won_projects ADD COLUMN IF NOT EXISTS nb_of_invoices INTEGER`);
  await db.execute(sql`ALTER TABLE won_projects ALTER COLUMN client_name  DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE won_projects ALTER COLUMN client_code  DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE won_projects ALTER COLUMN project_name DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE won_projects ALTER COLUMN won_date     DROP NOT NULL`);

  // ── Trash Bin (soft-delete safety net) ─────────────────────────────
  // Every wrapped DELETE endpoint copies the row here before erasing it
  // from the source table. Items expire after 30 days unless restored.
  // Storage helpers: trashAndDelete / restoreTrash / listTrash /
  // purgeExpiredTrash in server/storage.ts.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS trash_bin (
      id           SERIAL PRIMARY KEY,
      table_name   TEXT NOT NULL,
      row_id       TEXT NOT NULL,
      row_data     JSONB NOT NULL,
      display_name TEXT,
      display_type TEXT,
      deleted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at   TIMESTAMPTZ NOT NULL,
      restored_at  TIMESTAMPTZ
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS trash_bin_active_idx ON trash_bin(deleted_at DESC)
    WHERE restored_at IS NULL
  `);
  // app_version stamp on each trash row — guards against silent schema
  // drift over the 30-day retention window. If the source table gains or
  // drops a column between trashing and restoring, the version helps an
  // operator decide whether the snapshot is still safe to re-insert.
  await db.execute(sql`ALTER TABLE trash_bin ADD COLUMN IF NOT EXISTS app_version TEXT`);
  // Auto-purge on every boot — anything past its 30-day window AND not
  // restored is permanently gone. Cheap query, safe to run unconditionally.
  await db.execute(sql`
    DELETE FROM trash_bin
    WHERE expires_at < NOW() AND restored_at IS NULL
  `);

  // ── External Contacts (freelancers + partners) ───────────────────────
  // Lightweight table for people who aren't in the rich `employees`
  // table (which requires birth date, salary, role, etc.) but still
  // need to be in the "everyone at Eendigo" mailing list. Used by the
  // Employees page's "Copy all emails" button.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS external_contacts (
      id                   SERIAL PRIMARY KEY,
      name                 TEXT NOT NULL,
      email                TEXT NOT NULL UNIQUE,
      kind                 TEXT NOT NULL DEFAULT 'freelancer',
      created_at           TEXT NOT NULL,
      daily_rate           NUMERIC,
      daily_rate_currency  TEXT NOT NULL DEFAULT 'EUR'
    )
  `);
  // Add daily_rate columns to existing tables (idempotent — IF NOT EXISTS).
  await db.execute(sql`ALTER TABLE external_contacts ADD COLUMN IF NOT EXISTS daily_rate NUMERIC`);
  await db.execute(sql`ALTER TABLE external_contacts ADD COLUMN IF NOT EXISTS daily_rate_currency TEXT NOT NULL DEFAULT 'EUR'`);
  // Pre-seed the standing roster on first boot. Idempotent: only inserts
  // when the email isn't already present, so the user can rename/delete
  // freely without the seed re-creating rows.
  const seedContacts = [
    { name: "Thomas R. Hahn",         email: "thomas.r.hahn@eendigo.com",         kind: "partner"    },
    { name: "Wissam Kahi",            email: "wissam.kahi@eendigo.com",           kind: "partner"    },
    { name: "Edoardo Tiani",          email: "edoardo.tiani@eendigo.com",         kind: "manager"    },
    { name: "Defne Isler",            email: "defne.isler@eendigo.com",           kind: "freelancer" },
    { name: "Malika Makhmutkhazhieva", email: "malika.makhmutkhazhieva@eendigo.com", kind: "freelancer" },
    { name: "Renata Vancini",         email: "renata.vancini@eendigo.com",        kind: "freelancer" },
    { name: "Massimo Dal Bosco",      email: "massimo.dalbosco@eendigo.com",      kind: "freelancer" },
    { name: "Alessandro Monti",       email: "alessandro.monti@eendigo.com",      kind: "intern"     },
    { name: "Gabriele Papa",          email: "gabriele.papa@eendigo.com",         kind: "freelancer" },
    { name: "Melissa Marten",         email: "melissa.marten@eendigo.com",        kind: "freelancer" },
    { name: "Gustavo Daniel Lardone", email: "gustavo.lardone@eendigo.com",       kind: "freelancer" },
    { name: "Leonardo Briccoli",      email: "leonardo.briccoli@eendigo.com",     kind: "freelancer" },
    { name: "Livio Moretti",          email: "moretti.livio@gmail.com",           kind: "partner"    },
  ];
  const nowIso = new Date().toISOString();
  for (const c of seedContacts) {
    await db.execute(sql`
      INSERT INTO external_contacts (name, email, kind, created_at)
      VALUES (${c.name}, ${c.email}, ${c.kind}, ${nowIso})
      ON CONFLICT (email) DO NOTHING
    `);
  }
  // One-time corrections for kinds that were initially seeded wrong.
  // Conditional on the OLD value so any manual UI edits the user has
  // already made are preserved (the UPDATE is a no-op for them).
  await db.execute(sql`
    UPDATE external_contacts SET kind = 'freelancer'
    WHERE email = 'massimo.dalbosco@eendigo.com' AND kind = 'partner'
  `);
  await db.execute(sql`
    UPDATE external_contacts SET kind = 'manager'
    WHERE email = 'edoardo.tiani@eendigo.com' AND kind = 'freelancer'
  `);
  await db.execute(sql`
    UPDATE external_contacts SET kind = 'intern'
    WHERE email = 'alessandro.monti@eendigo.com' AND kind = 'partner'
  `);
  await db.execute(sql`
    UPDATE external_contacts SET kind = 'intern'
    WHERE email = 'gabriele.papa@eendigo.com' AND kind = 'freelancer'
  `);
  await db.execute(sql`
    UPDATE external_contacts SET kind = 'intern'
    WHERE email = 'leonardo.briccoli@eendigo.com' AND kind = 'freelancer'
  `);
  await db.execute(sql`
    UPDATE external_contacts SET kind = 'intern'
    WHERE email = 'melissa.marten@eendigo.com' AND kind = 'freelancer'
  `);

  // ── Employees email column + dedupe with external_contacts ────────
  // Each person should live in ONE table, not both. The 6 entries that
  // are real employees with proper roles get their emails moved into
  // employees.email and removed from external_contacts. Cosmin (and
  // any other employee without a known email) keeps email NULL until
  // the user enters it via the Edit Employee form.
  await db.execute(sql`
    ALTER TABLE employees ADD COLUMN IF NOT EXISTS email TEXT
  `);
  // Backfill emails AND surnames for the standing roster. Match by
  // FIRST NAME (case-insensitive), but only when there's exactly ONE
  // such employee — the two-Marcos / two-Alessandros problem. If
  // multiple employees share a first name, skip and warn so the user
  // resolves manually via Edit Employee.
  const empEmailUpdates: { firstName: string; fullName: string; email: string }[] = [
    { firstName: "alessandro", fullName: "Alessandro Monti",        email: "alessandro.monti@eendigo.com" },
    { firstName: "defne",      fullName: "Defne Isler",             email: "defne.isler@eendigo.com" },
    { firstName: "edoardo",    fullName: "Edoardo Tiani",           email: "edoardo.tiani@eendigo.com" },
    { firstName: "gabriele",   fullName: "Gabriele Papa",           email: "gabriele.papa@eendigo.com" },
    { firstName: "leonardo",   fullName: "Leonardo Briccoli",       email: "leonardo.briccoli@eendigo.com" },
    { firstName: "malika",     fullName: "Malika Makhmutkhazhieva", email: "malika.makhmutkhazhieva@eendigo.com" },
  ];
  for (const u of empEmailUpdates) {
    // Count first-name matches first to avoid the blanket-update
    // problem. The "needs work" filter looks for either missing email
    // OR a name that's still just the first name (no surname yet).
    const countRes = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM employees
      WHERE LOWER(SPLIT_PART(name, ' ', 1)) = ${u.firstName}
    `);
    const n = (countRes.rows[0] as any)?.n ?? 0;
    if (n === 0) continue;
    if (n > 1) {
      console.warn(`[seed] Skipping email/surname backfill for "${u.firstName}" — ${n} employees with that first name. Resolve manually via Employees → Edit.`);
      continue;
    }
    // Set email if missing.
    await db.execute(sql`
      UPDATE employees
      SET email = ${u.email}
      WHERE LOWER(SPLIT_PART(name, ' ', 1)) = ${u.firstName}
        AND (email IS NULL OR email = '')
    `);
    // Add surname if the stored name is still just the first name
    // (case-insensitive trimmed match). Don't overwrite if the user
    // has already typed a different full name.
    await db.execute(sql`
      UPDATE employees
      SET name = ${u.fullName}
      WHERE LOWER(TRIM(name)) = ${u.firstName}
    `);
  }
  // Remove duplicates from external_contacts ONLY when the matching
  // employee actually has the email now. Without this guard, a
  // SKIPPED UPDATE (count != 1 above) would still cause the DELETE
  // → permanent data loss with no employee record holding the email.
  for (const u of empEmailUpdates) {
    const matched = await db.execute(sql`
      SELECT 1 FROM employees WHERE email = ${u.email} LIMIT 1
    `);
    if (matched.rows.length > 0) {
      await db.execute(sql`
        DELETE FROM external_contacts WHERE email = ${u.email}
      `);
    }
  }

  // ── TBD self-heal: keep pending proposals aligned with Final cases ──
  // On every boot, remove pending pricing_proposals whose backing case
  // is NOT status='final' (i.e. Draft / Active). Won/Lost rows are
  // never touched — they're real decisions. Manually-added pendings
  // (no matching case) are left alone. This makes the dashboard show
  // the right TBD count automatically without requiring the user to
  // click the "Sync TBD" button on the Pricing page.
  // Self-heal logic: remove pending pricing_proposals whose project
  // name has a matching pricing_case but NO matching Final case. Uses
  // NOT EXISTS instead of a JOIN so duplicate cases (one Final + one
  // Draft sharing a project_name) don't cause the Final twin's TBD
  // to be wrongly deleted via the Draft twin's match.
  try {
    const stale = await db.execute(sql`
      SELECT p.id
      FROM pricing_proposals p
      WHERE p.outcome = 'pending'
        AND p.project_name IS NOT NULL
        AND TRIM(p.project_name) <> ''
        AND EXISTS (
          SELECT 1 FROM pricing_cases c
          WHERE LOWER(TRIM(c.project_name)) = LOWER(TRIM(p.project_name))
        )
        AND NOT EXISTS (
          SELECT 1 FROM pricing_cases c
          WHERE LOWER(TRIM(c.project_name)) = LOWER(TRIM(p.project_name))
            AND c.status = 'final'
        )
    `);
    if (stale.rows.length > 0) {
      const ids = stale.rows.map((r: any) => Number(r.id)).filter(Boolean);
      if (ids.length > 0) {
        await db.execute(sql`
          DELETE FROM pricing_proposals WHERE id = ANY(${ids})
        `);
        console.log(`[seed] TBD self-heal: removed ${ids.length} stale pending proposal(s) whose case is no longer Final`);
      }
    }
  } catch (e) {
    console.error("[seed] TBD self-heal failed:", e);
  }

  // ── President → CEO direct line ────────────────────────────────────
  // Channel for the Founder/President to send free-text requests to
  // the CEO agent. CEO either answers directly OR returns a "committee
  // prompt" that the user pastes into Cowork; the user then pastes the
  // committee outcome back, CEO finalises a response. Status flow:
  //   pending → answered (direct reply)
  //   pending → needs_committee → committee_done → answered
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS president_requests (
      id                 SERIAL PRIMARY KEY,
      message            TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'pending',
      ceo_response       TEXT,
      committee_prompt   TEXT,
      committee_outcome  TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at       TIMESTAMPTZ,
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS president_requests_status_idx
    ON president_requests(status, created_at DESC)
  `);

  // ── API Cost Tracking ─────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS api_usage_log (
      id SERIAL PRIMARY KEY,
      endpoint TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'claude-sonnet-4',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd TEXT NOT NULL DEFAULT '0',
      created_at TEXT NOT NULL
    )
  `);

  // ── Knowledge Center + Project Approach ──────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS knowledge_topics (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS knowledge_files (
      id SERIAL PRIMARY KEY,
      topic_id INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'General',
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      content_text TEXT,
      uploaded_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS topic_id INTEGER NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_approach TEXT`);

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
  // Three-timeline commercial-proposal comparison — JSONB array of
  // {weeks, commitPct, grossTotal?, commitAmount?} rows. Optional; engine
  // falls back to the default short/medium/long curve when null.
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS case_timelines JSONB`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS proposal_options_count INTEGER NOT NULL DEFAULT 3`);
  // Org agents — agent vs human kind + email for human roles
  await db.execute(sql`ALTER TABLE org_agents ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'agent'`);
  await db.execute(sql`ALTER TABLE org_agents ADD COLUMN IF NOT EXISTS email TEXT`);
  await db.execute(sql`ALTER TABLE org_agents ADD COLUMN IF NOT EXISTS dotted_parent_role_keys JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(sql`ALTER TABLE org_agents ADD COLUMN IF NOT EXISTS templates JSONB NOT NULL DEFAULT '[]'::jsonb`);
  // Pre-set the CFO ↔ CCO matrix per co-CEO direction: CFO primarily under
  // CEO (solid), dotted-line to CCO because CFO does contracts/invoicing/
  // expense-reports for sales engagements. Idempotent — only adds 'cco'
  // to dotted_parent_role_keys if not already present.
  await db.execute(sql`
    UPDATE org_agents
    SET dotted_parent_role_keys = '["cco"]'::jsonb
    WHERE role_key = 'cfo'
      AND NOT (dotted_parent_role_keys @> '["cco"]'::jsonb)
  `);
  // Revision letter appended to project_name in the UI (A / B / C / D).
  // Lets a case track its proposal revision count without renaming.
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS revision_letter TEXT DEFAULT 'A'`);

  // Win probability + expected start date — captured at case-creation time
  // so the HR agent can forecast 24-week staffing demand from the pipeline
  // before a proposal is finalised and moves to pricing_proposals.
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS win_probability REAL`);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS start_date TEXT`);
  // outcome = 'won' | 'lost' | null. When set, the case moves to the
  // "Won/Lost Pricings" tab and is hidden from the active Pricing Cases list.
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS outcome TEXT`);

  // ── Partners table + partner_id FKs ─────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS partners (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'referral',
      contact_name TEXT,
      contact_email TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS partner_id INTEGER`);
  await db.execute(sql`ALTER TABLE pricing_proposals ADD COLUMN IF NOT EXISTS partner_id INTEGER`);
  await db.execute(sql`ALTER TABLE bd_deals ADD COLUMN IF NOT EXISTS partner_id INTEGER`);

  // (Removed) Seed pricing_cases for specific reference projects (EMV01,
  // SCHA01) — these were development scaffolding for the three-timeline
  // commercial-proposal layout. The shape is now covered by real user
  // cases, so re-seeding them on every boot was polluting Past Projects
  // and re-creating rows that the user had deliberately deleted.
  // The schema column ALTERs above remain (they're idempotent and
  // structurally required); only the project-specific INSERTs and
  // UPDATEs are removed.
  //
  // One-time rename: legacy 'SCHA01' row violates the 3-letter prefix
  // convention (project_name = 3 capital letters + 2 digits). Rename to
  // 'SCH01' if a row with that name exists and 'SCH01' isn't already
  // taken. Idempotent — does nothing on subsequent boots.
  try {
    await db.execute(sql`
      UPDATE pricing_cases SET project_name = 'SCH01'
      WHERE project_name = 'SCHA01'
        AND NOT EXISTS (SELECT 1 FROM pricing_cases WHERE project_name = 'SCH01')
    `);
    await db.execute(sql`
      UPDATE pricing_proposals SET project_name = 'SCH01'
      WHERE project_name = 'SCHA01'
        AND NOT EXISTS (SELECT 1 FROM pricing_proposals WHERE project_name = 'SCH01')
    `);
  } catch (e) {
    console.error("Failed to rename SCHA01 → SCH01:", e);
  }

  // ── One-time refresh of pending TBD weekly_price ────────────────────
  // Earlier code stored weekly_price = target_weekly × 1.08 (admin-loaded)
  // which diverged from the headline NET1 number shown in the Pricing
  // Waterfall and confused the user. Refresh: for every pending TBD with
  // a matching final pricing_case, set weekly_price = case.recommendation.
  // target_weekly. Also fixes total_fee. Won/Lost rows are NEVER touched.
  // Idempotent: only updates when the stored weekly_price differs from the
  // case's current target_weekly AND outcome='pending'.
  try {
    await db.execute(sql`
      UPDATE pricing_proposals p
      SET weekly_price = ROUND((c.recommendation->>'target_weekly')::numeric)::real,
          total_fee    = ROUND((c.recommendation->>'target_weekly')::numeric * COALESCE(c.duration_weeks, 0))::real
      FROM pricing_cases c
      WHERE p.outcome = 'pending'
        AND c.status = 'final'
        AND LOWER(TRIM(p.project_name)) = LOWER(TRIM(c.project_name))
        AND c.recommendation IS NOT NULL
        AND (c.recommendation->>'target_weekly') IS NOT NULL
        AND (c.recommendation->>'target_weekly')::numeric > 0
        AND p.weekly_price <> ROUND((c.recommendation->>'target_weekly')::numeric)::real
    `);
  } catch (e) {
    console.error("Failed to refresh pending TBD weekly_price:", e);
  }

  // ── Retroactive Past-Projects backfill ─────────────────────────────
  // Any pricing_case with status='final' that is missing a corresponding
  // pricing_proposals row (matched on project_name, case-insensitive)
  // gets a pending/TBD proposal row so it appears in Past Projects and
  // the Exec Dashboard. Idempotent: WHERE NOT EXISTS skips any case that
  // already has a matching proposal regardless of outcome. Drafts and
  // Active cases are intentionally excluded — only user-finalised cases
  // belong in Past Projects.
  try {
    await db.execute(sql`
      INSERT INTO pricing_proposals (
        proposal_date, project_name, client_name, fund_name, region,
        pe_owned, revenue_band, price_sensitivity, duration_weeks,
        weekly_price, total_fee, outcome, sector, project_type
      )
      SELECT
        COALESCE(c.created_at::date::text, ${nowIso.slice(0, 10)}),
        c.project_name,
        c.client_name,
        c.fund_name,
        c.region,
        c.pe_owned,
        c.revenue_band,
        c.price_sensitivity,
        c.duration_weeks,
        0,
        0,
        'pending',
        c.sector,
        c.project_type
      FROM pricing_cases c
      WHERE c.status = 'final'
        AND c.project_name IS NOT NULL
        AND c.project_name <> ''
        AND NOT EXISTS (
          SELECT 1 FROM pricing_proposals p
          WHERE LOWER(TRIM(p.project_name)) = LOWER(TRIM(c.project_name))
        )
    `);
  } catch (e) {
    console.error("Failed to backfill TBD proposals for finalised cases:", e);
  }

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

  // Per-slide PNG backgrounds (Canva template export, etc.). One row per
  // slide_id. Used by /generate-page + /refine-page to layer generated
  // content on top of the template background.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS slide_backgrounds (
      slide_id TEXT PRIMARY KEY,
      file_data TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      source_ref TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  // Per-slide JSON template specs (visual editor → deterministic renderer).
  // `spec` is a JSONB blob — see shared/schema.ts slideTemplateSpecSchema
  // for the full shape (canvas, background data URL, regions array).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS slide_templates (
      slide_id TEXT PRIMARY KEY,
      spec JSONB NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

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

  // Migration: add Back Office role if not yet in DB (idempotent).
  await db.execute(sql`
    INSERT INTO role_grid
      (role_code, role_name, next_role_code,
       promo_years_fast, promo_years_normal, promo_years_slow,
       ral_min_k, ral_max_k,
       gross_fixed_min_month, gross_fixed_max_month,
       bonus_pct, meal_voucher_eur_per_day, months_paid, sort_order)
    VALUES
      ('BO', 'Back Office', NULL,
       0, 0, 0,
       20, 28,
       1667, 2333,
       0, 8, 12, -2)
    ON CONFLICT (role_code) DO NOTHING
  `);

  // Add hr_events column if missing (T12 migration)
  await db.execute(sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS hr_events jsonb DEFAULT '[]'::jsonb`);

  // Seed employees if empty
  const existingEmployees = await db.select().from(employees);
  if (existingEmployees.length === 0) {
    console.log("Seeding employees...");
    await db.insert(employees).values(SEED_EMPLOYEES);
    console.log(`Seeded ${SEED_EMPLOYEES.length} employees`);
  }

  // Promote Defne to S1 (as of 2026-05-04)
  await db.execute(sql`
    UPDATE employees
    SET current_role_code = 'S1',
        last_promo_date = '2026-05-04',
        current_gross_fixed_year = 38480
    WHERE id = 'emp-defne' AND current_role_code = 'A2'
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
  // Ensure Defne S1 promotion is in salary history
  const defneS1Count = await db.execute(sql`SELECT COUNT(*) as cnt FROM salary_history WHERE employee_id = 'emp-defne' AND role_code = 'S1'`);
  if (parseInt((defneS1Count.rows[0] as any).cnt) === 0) {
    await db.execute(sql`INSERT INTO salary_history (employee_id, effective_date, role_code, gross_fixed_year, months_paid, note) VALUES
      ('emp-defne', '2026-05-04', 'S1', 38480, 13, 'Promotion to S1')`);
    console.log("Added Defne S1 promotion to salary history");
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

  // ── Brief runs + events (live cascade visualisation) ──────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS brief_runs (
      id               SERIAL PRIMARY KEY,
      trigger          TEXT NOT NULL DEFAULT 'ceo brief',
      status           TEXT NOT NULL DEFAULT 'running',
      started_at       TEXT NOT NULL,
      completed_at     TEXT,
      final_summary    TEXT,
      proposals_count  INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS brief_events (
      id          SERIAL PRIMARY KEY,
      run_id      INTEGER NOT NULL,
      role_key    TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      summary     TEXT NOT NULL,
      payload     JSONB,
      created_at  TEXT NOT NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS brief_events_run_idx ON brief_events(run_id, created_at)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS brief_runs_running_idx ON brief_runs(started_at DESC) WHERE status = 'running'`);
  // Auto-fail any "running" runs older than 30 minutes — likely a Claude
  // session crashed mid-cascade. Idempotent on every boot.
  await db.execute(sql`
    UPDATE brief_runs SET status = 'failed', completed_at = ${new Date().toISOString()}
    WHERE status = 'running' AND started_at < (NOW() - INTERVAL '30 minutes')::text
  `);

  // ── Agent Knowledge ──────────────────────────────────────────────────
  // Per-role memory. Each role-skill reads all status='active' rows for
  // its role_key on every run.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_knowledge (
      id              SERIAL PRIMARY KEY,
      role_key        TEXT NOT NULL,
      content         TEXT NOT NULL,
      title           TEXT,
      source          TEXT NOT NULL DEFAULT 'user',
      tags            JSONB DEFAULT '[]'::jsonb,
      status          TEXT NOT NULL DEFAULT 'active',
      created_by_role TEXT,
      created_at      TEXT NOT NULL,
      decided_at      TEXT,
      decided_note    TEXT
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_knowledge_role_idx ON agent_knowledge(role_key, status, created_at DESC)`);
  // Seed first knowledge note for marketing-manager: the user's stated 2026
  // goals + OKRs that Marketing should always remember as company direction.
  // Idempotent: only inserts if no knowledge for that role yet.
  await db.execute(sql`
    INSERT INTO agent_knowledge (role_key, title, content, source, tags, status, created_at)
    SELECT 'marketing-manager',
           'Eendigo 2026 — Company goals + OKRs (set by co-CEO)',
           ${`Hit €3M revenue in 2026
• Hire ≥2 new Partners by end of 2026
• Sell at least 1 project per month, every month
• Build media presence: 12 thought-leadership pieces / yr
• Maintain bench: enough Senior+Associate+BA for 4 concurrent engagements

OKRs
1. €3M revenue 2026
– ≥€750k recognised by Q2 close
– ≥€1.6M booked-and-invoiced by Q3
– win-rate ≥50% trailing 10 deals
2. Strengthen the Partner bench
– 2 Partner-grade hires signed
– 1 ex-MBB Partner referred-in-pipeline
– Partner utilisation ≤60%
3. Always-on commercial pipeline
– ≥6 active TBDs at any time
– ≥2 inbound leads/month from media+content`},
           'user',
           '["company-direction","2026-okrs"]'::jsonb,
           'active',
           ${new Date().toISOString()}
    WHERE NOT EXISTS (
      SELECT 1 FROM agent_knowledge
      WHERE role_key = 'marketing-manager' AND title = 'Eendigo 2026 — Company goals + OKRs (set by co-CEO)'
    )
  `);
  // Seed CCO playbook (formerly Sales Director — merged per co-CEO).
  // Livio's accumulated best practices: negotiation tactics, follow-up
  // emails, win/loss survey, etc.
  await db.execute(sql`
    INSERT INTO agent_knowledge (role_key, title, content, source, tags, status, created_at)
    SELECT 'cco',
           'Eendigo Sales Playbook (set by co-CEO)',
           ${`Best practices for LM
1. Start promo intro with negatives so they don't negotiate: salary already high, early promo, still don't check all boxes, higher increase than expected etc
2. Each proposal have 3 options and add 9% admin fees
3. Example of slow growth bamboo before getting fast and bees some are random exploring
4. Comm strategy that regardless of answers you come out on top
5. Example of cost of wine, ex pricing of Repubblica 12E/y or 6e/week..they miss gain opportunities
6. Ask clients to introduce to a potential client for discount, and referral on linkedin
7. Propose diagnostic and they pay only if maturity below 3
8. Email of follow up after a week from sending the proposal to engage us on a comex project. key rules:
   a. Recap offer and why they should engage us: benefits (we bring in top tier consultants at fraction of the cost, focused only on one area). Mention the potential top line uplift of similar programs
   b. Present the risk of doing nothing or doing it with wrong partner (can backfire, can be too theoretical and not implemented, might be done without understanding the full picture)
   c. Propose some podcasts related to the topic
   d. Suggest a follow up call
9. Chiedi i drivers di crescita nelle scoping calls

Pricing & commercial rules
1. Costs: small company part time small team from 30k for basics, large full scope work 300k
2. Admin fee 9% and present 3 options
3. Spiega subito a cliente che fees non vanno discusse e mai menzionate al team
4. A fine progetto fai slide con supporto a 18 mesi con go o no go a 6 mesi
5. Do a CAPDB if you think we can generate 1-2m in incremental EBITDA so the ROI is 3-5x in year 1 and recurring. 2000-hour exercise → done internally takes 4000h → 3 FTEs over 1 year, cost 200-250k€
10. When hiring ask also to present a document (avoid EVE issues)
11. Survey lost bids: why they did not chose us and feedback to improve our offers, presentation, pricing
12. Day 1 of pitch: ask client to commit to answer our 10Q survey if we win or lose, in exchange share our win/loss playbook
13. Ask WA numbers to all clients in first intro call
14. Train an associate to run interviews until he gives right judgment. Record them
15. Run an outside-in diagnostic for clients to show their gaps and link to what we can do for them
16. If makes sense anchor price to MBB: 80-120k€/wk in Europe, up to 200k$/wk in US
17. Ask WA, say you will send a message after sending offer (anti-spam). Email after 2 days to confirm receipt
18. If unsure about a candidate: 4-6 weeks at 1500-2000€/m + meal vouchers, then decide A1/A2/S1; announce future salary 3-4k€/m + 10% bonus + meal voucher + 13ma + 10k bonus per client they source
19. Always add admin fees to each proposal (e.g. 8%) except Carlyle
20. If no success fees: send fixed; if they complain propose 10% or 20% variable; if still no propose run without partner — just senior manager + 1 associate

Process
1. Intro call: record with read.ai → email P1, attach CS and podcast (use podcast excel to identify best)
2. Create proposal document → email P2:
   a. Exec summary with total cost and impact
   b. One page per topic with activities, deliverables
   c. Outside-in analysis (annual reports, online search + AI, pricing, customer experience, web)
3. Discuss with team: invite manager + 2 associates
4. Send win/loss email + survey → propose touch base on other support areas

— EMAIL TEMPLATES ARCHIVED IN PLAYBOOK —

EMAIL P1 (post-intro recap, IT)
Ciao [Nome], grazie ancora per la chiacchierata.
1. Contesto generale — [recap of strategic context, tailored]
2. Bisogni e priorità emerse — [3-5 bullets reflecting client's words]
3. Possibili prossimi passi — [diagnostic / deep-dive / scope option]
+ podcast link + case study PDF + warm sign-off

EMAIL P1 PROMPT
Based on the transcript of the intro call, write concise senior consulting-style follow-up:
- 3 sections: recap / needs / next steps
- Reflect client's language verbatim
- Suggest podcast + attach case study
- 150-180 words, no salesy phrases
- Sign with [name]

EMAIL P2 (proposal sharing, EN)
Section structure: Intro / Scope / Engagement options / Timeline / Start date / Team / Budget / Our USP / Next steps
+ confidentiality P.S.

EMAIL P2 PROMPT
Use the attached proposal to write professional consulting-style email:
- Structure: 9 short headers as above
- Reference specific page numbers
- Position options without pushing
- Confidence + flexibility + execution focus
- No buzzwords, short paragraphs, bullets where useful
- End with confirmation request, follow-up offer, P.S. confidentiality note

EMAIL P3 (win/loss after lost deal, EN)
Subject: A quick favor — and your choice of something useful in return
Body: thank for time, request 10Q survey (~2min), in return offer one of:
1. Executive point-of-view note
2. 20-min benchmark call (no pitch)
3. Win-rate playbook
4. Locked-in rate card with +5% discount on engagements starting in next 12 months
Sign warmly.`},
           'user',
           '["sales-playbook","best-practices","email-templates","negotiation"]'::jsonb,
           'active',
           ${new Date().toISOString()}
    WHERE NOT EXISTS (
      SELECT 1 FROM agent_knowledge
      WHERE role_key IN ('sales-director', 'cco') AND title = 'Eendigo Sales Playbook (set by co-CEO)'
    )
  `);
  // Seed CFO cash-management protocol
  await db.execute(sql`
    INSERT INTO agent_knowledge (role_key, title, content, source, tags, status, created_at)
    SELECT 'cfo',
           'Cash management protocol — payroll + freelancer payouts',
           ${`Cash protocol set by co-CEO:

ACCOUNTS the company holds:
• Wise LM
• Wise SQ1   ← salaries paid out from here
• Wise LLC   ← freelancer fees paid out from here (default; co-CEO can override "from LLC")
• Revolut

WEEKLY CASH-FORECAST CYCLE
1 week before any scheduled payout:
1. Ask co-CEO for the current cash balance in: Wise LM, Wise SQ1, Wise LLC, Revolut.
2. Compute the upcoming week's outflows:
   • Salaries (employees) → Wise SQ1
   • Freelancer fees → Wise LLC (default) OR Wise SQ1 (if co-CEO explicitly says "from SQ1")
3. Compare projected balance after outflows vs zero plus a safety buffer.
4. Recommend the EXACT amount to top up into Wise SQ1 and/or Wise LLC, sourcing from Wise LM or Revolut.
5. Surface the recommendation to co-CEO as an agent_proposal with:
   - category="ar" (or new "cash" if you've added it)
   - priority="p1" if the gap would put any account near zero, p2 otherwise
   - action_required = "Approve transfer of €X from <source> to <dest> by <date>"

WHAT TO ASK CO-CEO
"Cash check — please confirm balances:
  Wise LM: €___
  Wise SQ1: €___
  Wise LLC: €___
  Revolut: €___
Next payouts due in 7 days:
  Salaries: €___ (out of Wise SQ1)
  Freelancers: €___ (out of Wise LLC, unless told otherwise)
Should I assume default routing or any override this week?"

ESCALATION
If projected balance after payout in any of SQ1 or LLC < €5,000 → P0 to CEO.`},
           'user',
           '["cash","payroll","freelancers","accounts","wise","revolut"]'::jsonb,
           'active',
           ${new Date().toISOString()}
    WHERE NOT EXISTS (
      SELECT 1 FROM agent_knowledge
      WHERE role_key = 'cfo' AND title = 'Cash management protocol — payroll + freelancer payouts'
    )
  `);

  // ── Agent Proposals ──────────────────────────────────────────────────
  // Skills POST here when their scheduled run produces a recommendation.
  // Rendered at the bottom of /exec/org-chart for the user to act on.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_proposals (
      id              SERIAL PRIMARY KEY,
      role_key        TEXT NOT NULL,
      cycle_at        TEXT NOT NULL,
      cycle_label     TEXT,
      priority        TEXT NOT NULL DEFAULT 'p2',
      category        TEXT NOT NULL DEFAULT 'general',
      summary         TEXT NOT NULL,
      rationale       TEXT,
      action_required TEXT,
      links           JSONB DEFAULT '[]'::jsonb,
      status          TEXT NOT NULL DEFAULT 'pending',
      decided_at      TEXT,
      decided_note    TEXT,
      created_at      TEXT NOT NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_proposals_role_idx ON agent_proposals(role_key, created_at DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS agent_proposals_pending_idx ON agent_proposals(status, priority, created_at DESC) WHERE status = 'pending'`);
  // Auto-stale on boot: anything pending >14 days gets marked 'stale' so
  // the page doesn't accumulate forever. The agent can re-propose if the
  // signal still holds.
  await db.execute(sql`
    UPDATE agent_proposals
    SET status = 'stale'
    WHERE status = 'pending'
      AND created_at < (NOW() - INTERVAL '14 days')::text
  `);

  // ── Org Chart ────────────────────────────────────────────────────────
  // Backs the /exec/org-chart page. One row per role. Mirrors the
  // eendigo-ceo skill's state/org_chart.json semantics.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS org_agents (
      id              SERIAL PRIMARY KEY,
      role_key        TEXT NOT NULL UNIQUE,
      role_name       TEXT NOT NULL,
      parent_role_key TEXT,
      person_name     TEXT,
      status          TEXT NOT NULL DEFAULT 'active',
      goals           JSONB NOT NULL DEFAULT '[]'::jsonb,
      okrs            JSONB NOT NULL DEFAULT '[]'::jsonb,
      tasks_10d       JSONB NOT NULL DEFAULT '[]'::jsonb,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    )
  `);

  // Seed initial 6-role org. Idempotent: each INSERT is gated by NOT EXISTS
  // on role_key. Goals reflect Alessio's 2026 ambitions: hit €3M revenue,
  // hire ≥2 partners, sell ≥1 project/month, build media presence,
  // maintain bench capacity for 4 concurrent engagements.
  const _orgNow = new Date().toISOString();
  const _addDays = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const _orgSeed: any[] = [
    {
      role_key: "ceo", role_name: "CEO (AI)", parent_role_key: null,
      person_name: "Warren Buffett", sort_order: 0, status: "active",
      goals: [
        "Hit €3M revenue in 2026",
        "Hire ≥2 new Partners by end of 2026",
        "Sell at least 1 project per month, every month",
        "Build media presence: 12 thought-leadership pieces / yr",
        "Maintain bench: enough Senior+Associate+BA for 4 concurrent engagements",
      ],
      okrs: [
        { objective: "€3M revenue 2026", key_results: ["≥€750k recognised by Q2 close", "≥€1.6M booked-and-invoiced by Q3", "win-rate ≥50% trailing 10 deals"] },
        { objective: "Strengthen the Partner bench", key_results: ["2 Partner-grade hires signed", "1 ex-MBB Partner referred-in-pipeline", "Partner utilisation ≤60%"] },
        { objective: "Always-on commercial pipeline", key_results: ["≥6 active TBDs at any time", "≥2 inbound leads/month from media+content", "0 months with zero new wins"] },
      ],
      tasks_10d: [
        { id: "ceo-1", title: "Set Q2 OKRs in compplan + share with team", due_date: _addDays(2), status: "todo" },
        { id: "ceo-2", title: "Define hiring plan: 2 Partner profiles + JDs", due_date: _addDays(5), status: "todo" },
        { id: "ceo-3", title: "Approve Sales Director hire if pipeline >5 stalled", due_date: _addDays(7), status: "todo" },
        { id: "ceo-4", title: "Review Q1 financials with CFO (when hired)", due_date: _addDays(10), status: "todo" },
      ],
    },
    {
      role_key: "cfo", role_name: "Chief Financial Officer", parent_role_key: "ceo",
      person_name: "Mario Draghi", sort_order: 1, status: "active",
      goals: [
        "[Supports CEO €3M revenue goal] Track booked-and-invoiced ≥€1.6M by Q3 — flag the gap weekly",
        "[Supports CEO €3M revenue goal] DSO <45 days; outstanding AR <€50k month-end",
        "Cash runway visible 12+ weeks at all times so CEO can act on hires + investments",
        "Monthly close packaged for CEO by working day 5",
      ],
      okrs: [
        { objective: "Cascade: ≥€1.6M booked-and-invoiced by Q3 close", key_results: ["Weekly variance to plan tracked + reported", "≥€750k recognised by Q2 close (CEO O1.KR1)", "0 invoices stuck >60d unbilled-from-Won"] },
        { objective: "Tight AR", key_results: ["≤10 invoices overdue >30d", "no invoices >90d overdue", "DSO <45 days trailing 90d"] },
        { objective: "Predictable close", key_results: ["Close completed by WD-5 every month", "P&L variance commentary delivered with the close", "0 surprise reclassifications post-close"] },
      ],
      tasks_10d: [],
    },
    {
      role_key: "cco", role_name: "CCO", parent_role_key: "ceo",
      person_name: "Indra Nooyi", sort_order: 2, status: "active",
      goals: [
        "[Supports CEO €3M revenue + Sell ≥1/month goals] 1+ new signed engagement every single month of 2026",
        "[Supports CEO Always-on pipeline OKR] ≥6 active TBDs at any time; pipeline coverage ≥3× quarterly target",
        "[Supports CEO €3M revenue goal] Win-rate ≥50% trailing 10 deals — never lose a winnable project",
        "Every prospect call → pricing case opened in compplan + tracked in BD pipeline within 24h",
      ],
      okrs: [
        { objective: "Cascade: ≥1 new Won/month for 12 months", key_results: ["12 of 12 months hit ≥1 Won (CEO Goal #3)", "Win-rate ≥50% trailing 10 (CEO O1.KR3)", "No deal stalled >14d untouched"] },
        { objective: "Cascade: ≥6 active TBDs sustained", key_results: ["TBD count ≥6 at any time (CEO O3.KR1)", "Every BD deal has next-step + owner + due-date", "Lost-to-price <30% of total losses"] },
      ],
      tasks_10d: [],
    },
    {
      role_key: "marketing-manager", role_name: "Marketing Manager", parent_role_key: "ceo",
      person_name: "Philip Kotler", sort_order: 3, status: "active",
      goals: [
        "[Supports CEO Media presence goal] 12 published thought-leadership pieces in 2026 (1/month)",
        "[Supports CEO Always-on pipeline OKR] ≥2 inbound qualified leads / month from content+media",
        "[Supports CEO €3M revenue goal] 1 case study published per Won engagement within 30d of close — feeds the proof-base",
        "[Supports CEO Hire ≥2 Partners goal] Brand strong enough that ex-MBB Partners take the call",
      ],
      okrs: [
        { objective: "Cascade: 12 thought-leadership pieces in 2026", key_results: ["1 LinkedIn long-form post / week (52 wks)", "1 deep article / month (12 in 2026)", "1 podcast or media mention / quarter"] },
        { objective: "Cascade: ≥2 inbound leads/month from content (CEO O3.KR2)", key_results: ["≥24 inbound leads logged in 2026", "≥2 inbound leads → Won in 2026", "Newsletter list 500+ by EOY"] },
      ],
      tasks_10d: [],
    },
    {
      role_key: "pricing-director", role_name: "Pricing Director", parent_role_key: "ceo",
      person_name: null, sort_order: 4, status: "vacant",
      goals: [
        "[Supports CEO €3M revenue goal] Win-rate ≥50% on quoted deals — protect margin, don't leave money on the table",
        "[Supports CEO €3M revenue goal] Lost-to-price <30% of total losses (tune regional bands, not global discounts)",
        "Every pricing case has 3-timeline commercial proposal + partner-fallback option",
        "Time from case-saved → proposal-sent ≤24h (so Sales never blocks on Pricing)",
      ],
      okrs: [
        { objective: "Cascade: ≥50% win-rate trailing 10 (CEO O1.KR3)", key_results: ["100% of cases use 3 timelines + partner-fallback", "Lost-to-price <30% of losses", "Quarterly win/loss read by region+sector+fund delivered to CEO"] },
        { objective: "Pricing intelligence", key_results: ["Regional multipliers reviewed once/quarter", "Rate card refreshed annually", "Inputs to Sales when a deal looks unwinnable at quoted price"] },
      ],
      tasks_10d: [],
    },
    {
      role_key: "coo", role_name: "COO — Tech & Operations", parent_role_key: "ceo",
      person_name: null, sort_order: 5, status: "active",
      goals: [
        "[Enables every CEO goal] Compplan app stays solid: every page loads, no 5xx, no broken flows",
        "[Enables CEO governance] AI agents + skills evolve weekly; co-CEO approves all code before push",
        "[Enables €3M revenue] Pricing/Hiring/AR/Delivery pages used daily without friction",
        "Infrastructure (Render, Neon, GitHub) remains within healthy limits — backups verified weekly",
      ],
      okrs: [
        { objective: "App health green", key_results: ["0 P0 bugs in trailing 7d", "≥99.5% uptime trailing 30d", "every nav route returns 200 / 401 / 503-by-design"] },
        { objective: "Continuous improvement loop", key_results: ["≥1 improvement proposal/week posted to /exec/org-chart", "Median time from co-CEO approval → merged code ≤24h", "0 unauthorised auto-merges"] },
        { objective: "Operational hygiene", key_results: ["Backups verified weekly", "Trash bin coverage 100% of delete endpoints", "Auth fail-closed verified each Render deploy"] },
      ],
      tasks_10d: [
        { id: "coo-1", title: "App audit: walk every route + console errors", due_date: _addDays(2), status: "todo" },
        { id: "coo-2", title: "Review last 14d agent-proposals; flag patterns to CEO", due_date: _addDays(5), status: "todo" },
        { id: "coo-3", title: "Verify backup workflow + trash purge heartbeat live", due_date: _addDays(7), status: "todo" },
      ],
    },
    {
      role_key: "delivery-director", role_name: "Delivery Director", parent_role_key: "ceo",
      person_name: null, sort_order: 6, status: "vacant",
      goals: [
        "[Supports CEO bench-capacity goal] Visibility on team utilisation per engagement so we know when to hire",
        "[Supports CEO Marketing case-study goal] Every Won engagement closes with a publishable artefact within 30d",
        "Every ongoing project has a weekly report by EOD Monday",
        "Surface risks 4+ weeks before end_date so CEO + Sales can act (extension or scope-cut)",
      ],
      okrs: [
        { objective: "On-time, on-scope delivery", key_results: ["100% projects deliver by their end_date", "≥80% projects close green", "0 surprise overruns >20% of budget"] },
        { objective: "Cascade: bench utilisation visibility (CEO Goal #5)", key_results: ["Weekly utilisation report to CEO", "Flag Senior+ASC bench risk ≥3w before need", "0 projects without an EM-of-record"] },
      ],
      tasks_10d: [],
    },
    {
      role_key: "hiring-manager", role_name: "CHRO", parent_role_key: "ceo",
      person_name: "Adrian", sort_order: 7, status: "active",
      goals: [
        "[Supports CEO Hire ≥2 Partners goal] Run dedicated Partner search; ≥1 ex-MBB Partner referred-in-pipeline",
        "[Supports CEO Bench-capacity goal] Bench supports 4 concurrent engagements (Senior + Associate + BA mix)",
        "Maintain ≥10 active candidates across stages at all times",
        "Top scorers (weighted ≥70) reach final-round in <14 days",
      ],
      okrs: [
        { objective: "Cascade: 2 Partner-grade hires signed (CEO O2)", key_results: ["2 Partner offers signed in 2026", "1 ex-MBB Partner referred-in-pipeline (CEO O2.KR2)", "JDs + comp benchmarks ready by end of Q2"] },
        { objective: "Cascade: bench for 4 concurrent engagements (CEO Goal #5)", key_results: ["≥2 Seniors hireable on 4-week notice", "≥3 Associates available for new project", "≥2 BAs onboarding-ready"] },
        { objective: "Steady pipeline depth", key_results: ["≥10 active candidates always", "≥3 weighted-≥80 candidates in any 30d window", "0 stage with 0 movement >14d"] },
      ],
      tasks_10d: [
        { id: "hm-1", title: "Review pipeline; surface top 3 scorers to CEO", due_date: _addDays(1), status: "todo" },
        { id: "hm-2", title: "Schedule final-round for any candidate ≥75 weighted", due_date: _addDays(4), status: "todo" },
        { id: "hm-3", title: "Draft JDs for 2 Partner profiles (per CEO)", due_date: _addDays(7), status: "todo" },
      ],
    },
  ];
  // One-shot rename: Hiring Manager → CHRO. Idempotent: only fires while
  // the live row still has the old role_name. Once renamed, this is a no-op.
  await db.execute(sql`
    UPDATE org_agents SET role_name = 'CHRO', updated_at = ${_orgNow}
    WHERE role_key = 'hiring-manager' AND role_name = 'Hiring Manager'
  `);

  // One-shot merge: Sales Director → CCO. The CCO owns sales + marketing
  // as one commercial function (per co-CEO request). Marketing Manager
  // becomes a direct report of CCO instead of CEO. Idempotent — runs only
  // while the legacy 'sales-director' row exists and 'cco' doesn't.
  // Cascade: every reference (knowledge, dotted lines, parent_role_key)
  // is migrated atomically.
  const _ccoExists = (await db.execute(sql`SELECT id FROM org_agents WHERE role_key = 'cco' LIMIT 1`)) as unknown as { rows: any[] };
  const _sdExists  = (await db.execute(sql`SELECT id FROM org_agents WHERE role_key = 'sales-director' LIMIT 1`)) as unknown as { rows: any[] };
  if ((_sdExists.rows ?? []).length > 0 && (_ccoExists.rows ?? []).length === 0) {
    // Rename the row in-place (preserves goals/okrs/tasks/sort_order/etc.).
    await db.execute(sql`
      UPDATE org_agents
      SET role_key = 'cco',
          role_name = 'CCO',
          person_name = 'Kate Walton',
          status = 'active',
          updated_at = ${_orgNow}
      WHERE role_key = 'sales-director'
    `);
    // Reparent Marketing Manager from CEO → CCO.
    await db.execute(sql`
      UPDATE org_agents SET parent_role_key = 'cco', updated_at = ${_orgNow}
      WHERE role_key = 'marketing-manager' AND parent_role_key = 'ceo'
    `);
    // Migrate any role that USED to dotted-line into sales-director
    // (e.g. CFO has dotted_parent_role_keys=['sales-director']) so the
    // matrix relationship survives the rename.
    await db.execute(sql`
      UPDATE org_agents
      SET dotted_parent_role_keys = (
        SELECT jsonb_agg(CASE WHEN x = 'sales-director' THEN 'cco'::jsonb ELSE x END)
        FROM jsonb_array_elements(dotted_parent_role_keys) AS x
      ),
      updated_at = ${_orgNow}
      WHERE dotted_parent_role_keys @> '["sales-director"]'::jsonb
    `);
    // Migrate agent_knowledge rows owned by sales-director.
    await db.execute(sql`
      UPDATE agent_knowledge SET role_key = 'cco'
      WHERE role_key = 'sales-director'
    `);
    // Migrate agent_proposals.
    await db.execute(sql`
      UPDATE agent_proposals SET role_key = 'cco'
      WHERE role_key = 'sales-director'
    `);
    // Migrate any role whose primary parent was sales-director (none today,
    // but future-proof if a sub-role had been added).
    await db.execute(sql`
      UPDATE org_agents SET parent_role_key = 'cco', updated_at = ${_orgNow}
      WHERE parent_role_key = 'sales-director'
    `);
    console.log("[seed] Merged Sales Director → CCO (Kate Walton); Marketing Manager now reports to CCO.");
  }

  // Idempotent name correction for the CCO. Earlier deploys seeded
  // 'Indra Nooyi'; the co-CEO chose Kate Walton (J.P. Morgan CCO) as the
  // archetype. Only fires while the old name is still present.
  await db.execute(sql`
    UPDATE org_agents
    SET person_name = 'Kate Walton', updated_at = ${_orgNow}
    WHERE role_key = 'cco' AND person_name = 'Indra Nooyi'
  `);

  // Idempotent typo fix: "Head of Partenrships" → "Head of Hiring Partnerships".
  // Two roles with similar intent existed in the live DB:
  //   - "Head of Partnerships" under VP Sales (BD partners)
  //   - "Head of Partenrships" under CHRO (recruitment partners)
  // The CHRO-side row had a typo AND an identical display name. Rename to
  // disambiguate it as a distinct seat for hiring partners. role_key is
  // updated to match. Idempotent — only fires while the typo is present.
  await db.execute(sql`
    UPDATE org_agents
    SET role_name = 'Head of Hiring Partnerships',
        role_key  = 'head-of-hiring-partnerships',
        updated_at = ${_orgNow}
    WHERE role_name ILIKE 'Head of Partenrships'
       OR role_key  = 'head-of-partenrships'
  `);
  // Migrate dependent FKs (parent_role_key, dotted_parent_role_keys,
  // agent_knowledge.role_key, agent_proposals.role_key) so nothing is
  // orphaned by the rename.
  await db.execute(sql`
    UPDATE org_agents SET parent_role_key = 'head-of-hiring-partnerships', updated_at = ${_orgNow}
    WHERE parent_role_key = 'head-of-partenrships'
  `);
  await db.execute(sql`
    UPDATE org_agents
    SET dotted_parent_role_keys = (
      SELECT jsonb_agg(CASE WHEN x #>> '{}' = 'head-of-partenrships'
                            THEN '"head-of-hiring-partnerships"'::jsonb
                            ELSE x END)
      FROM jsonb_array_elements(dotted_parent_role_keys) AS x
    ),
    updated_at = ${_orgNow}
    WHERE dotted_parent_role_keys @> '["head-of-partenrships"]'::jsonb
  `);
  await db.execute(sql`UPDATE agent_knowledge  SET role_key = 'head-of-hiring-partnerships' WHERE role_key = 'head-of-partenrships'`);
  await db.execute(sql`UPDATE agent_proposals  SET role_key = 'head-of-hiring-partnerships' WHERE role_key = 'head-of-partenrships'`);

  for (const a of _orgSeed) {
    await db.execute(sql`
      INSERT INTO org_agents (role_key, role_name, parent_role_key, person_name, status, goals, okrs, tasks_10d, sort_order, created_at, updated_at)
      SELECT ${a.role_key}, ${a.role_name}, ${a.parent_role_key}, ${a.person_name}, ${a.status},
             ${JSON.stringify(a.goals)}::jsonb,
             ${JSON.stringify(a.okrs)}::jsonb,
             ${JSON.stringify(a.tasks_10d)}::jsonb,
             ${a.sort_order}, ${_orgNow}, ${_orgNow}
      WHERE NOT EXISTS (SELECT 1 FROM org_agents WHERE role_key = ${a.role_key})
    `);
    // Cascade upgrade: existing rows get their goals/okrs/role_name/person_name
    // refreshed if they haven't been cascaded yet (proxy: goals don't contain
    // the "[Supports CEO" marker introduced in the cascade pass). Idempotent —
    // once cascaded, this is a no-op. Won't overwrite user edits if the user
    // manually added the marker themselves.
    await db.execute(sql`
      UPDATE org_agents
      SET role_name   = ${a.role_name},
          person_name = ${a.person_name},
          status      = CASE WHEN status = 'vacant' THEN ${a.status} ELSE status END,
          goals       = ${JSON.stringify(a.goals)}::jsonb,
          okrs        = ${JSON.stringify(a.okrs)}::jsonb,
          sort_order  = ${a.sort_order},
          updated_at  = ${_orgNow}
      WHERE role_key = ${a.role_key}
        AND (goals::text NOT LIKE '%[Supports CEO%'
             AND goals::text NOT LIKE '%[Enables CEO%'
             AND goals::text NOT LIKE '%[Enables every CEO%'
             AND goals::text NOT LIKE '%[Enables €3M%')
    `);
  }

  // ── Sub-agent seed: BD Agent, Proposal Agent, CKO, L&D Manager, AR Agent,
  //    Partnership Agent — created via seedSources.js (one-time script) but
  //    their OKRs/goals were left empty. This migration idempotently back-fills
  //    goals and OKRs from AGENT_SPECS so the org-chart popup shows them.
  const _SUB_AGENT_ROLE_KEYS: Record<string, { roleKey: string; parentKey: string; sort: number }> = {
    "BD Agent":          { roleKey: "bd-agent",          parentKey: "cco",             sort: 20 },
    "Proposal Agent":    { roleKey: "proposal-agent",    parentKey: "cco",             sort: 21 },
    "CKO":               { roleKey: "cko",               parentKey: "ceo",             sort: 22 },
    "L&D Manager":       { roleKey: "ld-manager",        parentKey: "hiring-manager",  sort: 23 },
    "AR Agent":          { roleKey: "ar-agent",          parentKey: "cfo",             sort: 24 },
    "Partnership Agent": { roleKey: "partnership-agent", parentKey: "cco",             sort: 25 },
  };
  for (const spec of AGENT_SPECS) {
    const mapping = _SUB_AGENT_ROLE_KEYS[spec.name];
    if (!mapping) continue;
    const { roleKey, parentKey, sort } = mapping;
    const goals = spec.responsibilities.slice(0, 4)
      .map(r => r.replace(/^\[(AUTONOMOUS|HUMAN-APPROVED)\]\s*/i, ""));
    const okrs = spec.okrs.map(o => ({ objective: o.objective, key_results: o.krs }));
    // Create if missing (idempotent — handles fresh deploys without seedSources.js).
    await db.execute(sql`
      INSERT INTO org_agents (role_key, role_name, parent_role_key, person_name, status,
        goals, okrs, tasks_10d, dotted_parent_role_keys, sort_order, created_at, updated_at)
      SELECT ${roleKey}, ${spec.name}, ${parentKey}, NULL, 'active',
             ${JSON.stringify(goals)}::jsonb, ${JSON.stringify(okrs)}::jsonb,
             '[]'::jsonb, '[]'::jsonb, ${sort}, ${_orgNow}, ${_orgNow}
      WHERE NOT EXISTS (SELECT 1 FROM org_agents WHERE role_key = ${roleKey})
    `);
    // Backfill goals + OKRs for rows that still have empty arrays.
    await db.execute(sql`
      UPDATE org_agents
      SET goals = ${JSON.stringify(goals)}::jsonb,
          okrs  = ${JSON.stringify(okrs)}::jsonb,
          updated_at = ${_orgNow}
      WHERE role_key = ${roleKey} AND okrs = '[]'::jsonb
    `);
  }

  // ── Data fix: remove duplicate "L&D Manager" (ONE-SHOT) ───────────────
  // Two rows with role_name = 'L&D Manager' once existed under
  // hiring-manager:
  //   id=24 key='ld-manager'  (seeded by the sub-agent pass above — keep)
  //   id=10 key='l-d-manager' (older manual entry — remove)
  // Without a guard, the DELETE below runs on EVERY boot and would
  // silently nuke any future role with key='l-d-manager' the user
  // creates. We track this in seed_migrations and skip the block once
  // it has been applied.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS seed_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const _ldDedupeRows = await db.execute(sql`
    SELECT 1 FROM seed_migrations WHERE name = 'l-d-manager-dedupe-2026-05'
  `);
  const _ldDedupeAlreadyApplied = ((_ldDedupeRows as any).rows ?? _ldDedupeRows).length > 0;
  if (!_ldDedupeAlreadyApplied) {
    // Migrate any knowledge/proposals linked to the stale key first, then delete.
    await db.execute(sql`
      UPDATE agent_knowledge SET role_key = 'ld-manager'
      WHERE role_key = 'l-d-manager'
    `);
    await db.execute(sql`
      UPDATE agent_proposals SET role_key = 'ld-manager'
      WHERE role_key = 'l-d-manager'
    `);
    await db.execute(sql`
      DELETE FROM org_agents WHERE role_key = 'l-d-manager'
    `);
    await db.execute(sql`
      INSERT INTO seed_migrations (name) VALUES ('l-d-manager-dedupe-2026-05')
      ON CONFLICT (name) DO NOTHING
    `);
    console.log("[seed] Applied one-shot migration: l-d-manager-dedupe-2026-05");
  }

  // ── Data fix: Henry Kissinger "Advisor" parent ─────────────────────────
  // The Advisor row had parent_role_key = 'president'. Since president is
  // treated as a governance peer (excluded from the tree), Advisor rendered
  // as a floating second root. Re-parent to 'ceo' so Advisor appears as a
  // direct report of CEO.
  await db.execute(sql`
    UPDATE org_agents
    SET parent_role_key = 'ceo', updated_at = ${_orgNow}
    WHERE role_key = 'advisor' AND parent_role_key = 'president'
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

  // ── Backfill TBD proposal weekly_price + total_fee from canonical NET1 ──
  // The rule: every TBD's weekly_price = NET1 (case's canonical_net_weekly
  // OR live-recomputed). total_fee = weekly_price × duration_weeks. Boot-time
  // migration ensures Exec dashboard / Past Projects / Pricing Tool list all
  // converge on the same two numbers. Only touches outcome='pending' rows
  // — Won/Lost are user-decided, never altered.
  try {
    const { rows: cases } = (await db.execute(sql`
      SELECT id, project_name, region, recommendation, duration_weeks
      FROM pricing_cases
      WHERE status = 'final'
    `)) as unknown as { rows: Array<{ id: number; project_name: string | null; region: string | null; recommendation: any; duration_weeks: number | null }> };

    const settingsRows = (await db.execute(sql`
      SELECT country_benchmarks FROM pricing_settings LIMIT 1
    `)) as unknown as { rows: Array<{ country_benchmarks: any }> };
    const benchmarks: Array<{ country: string; parameter: string; green_low: number; green_high: number }> =
      Array.isArray(settingsRows.rows[0]?.country_benchmarks)
        ? settingsRows.rows[0].country_benchmarks
        : [];

    const REGION_TO_COUNTRY_BOOT: Record<string, string[]> = {
      "DACH": ["DE", "AT", "CH"], "Nordics": ["SE", "NO", "DK", "FI"],
      "UK": ["UK", "GB"], "FR": ["FR"], "IT": ["IT"], "US": ["US"],
      "Asia": ["JP", "CN", "SG", "HK", "KR", "IN"],
      "Middle East": ["AE", "SA", "QA"],
      "Other EU": ["NL", "BE", "ES", "PT", "PL", "IE", "GR", "AT"],
    };
    const computeCanonical = (caseRow: { region: string | null; recommendation: any }): number => {
      const rec = caseRow.recommendation;
      if (!rec) return 0;
      const stored = Number(rec.canonical_net_weekly);
      if (isFinite(stored) && stored > 0) return Math.round(stored);
      const trace = Array.isArray(rec.layer_trace) ? rec.layer_trace : [];
      const base = Number(rec.base_weekly ?? rec.target_weekly ?? 0);
      if (!base) return 0;
      const KEYS = ["Geography", "Sector", "Ownership", "Client Size", "Client Profile", "Strategic Intent"];
      const traceByKey: Record<string, { value: number }> = {};
      for (const lt of trace) {
        const key = String(lt.label ?? "").replace(/\s*\(.*?\)\s*$/, "").trim();
        if (key) traceByKey[key] = lt;
      }
      const deltas: Record<string, number> = {};
      let prevOrig = base;
      for (const k of KEYS) {
        const lt = traceByKey[k];
        if (lt) { deltas[k] = lt.value - prevOrig; prevOrig = lt.value; }
        else deltas[k] = 0;
      }
      let running = base;
      for (const k of KEYS) {
        const d = deltas[k] ?? 0;
        if (Math.abs(d) >= 1) running += d;
      }
      const aliases = REGION_TO_COUNTRY_BOOT[caseRow.region ?? ""] ?? [caseRow.region ?? ""];
      const aliasSet = new Set(aliases.map(a => (a ?? "").toLowerCase()));
      const weeklyRows = benchmarks.filter(b =>
        aliasSet.has((b.country ?? "").toLowerCase()) &&
        ((String(b.parameter ?? "").toLowerCase().includes("weekly")) ||
         (String(b.parameter ?? "").toLowerCase().includes("fee")))
      );
      const nz = weeklyRows.filter(r => r.green_low > 0 && r.green_high > 0);
      const gLow  = nz.length ? Math.min(...nz.map(r => r.green_low))  : 0;
      const gHigh = nz.length ? Math.max(...nz.map(r => r.green_high)) : 0;
      if (gLow > 0 && gHigh > 0) {
        running = Math.min(gHigh, Math.max(gLow, running));
      }
      running += Number(rec.manual_delta ?? 0);
      const result = Math.round(running);
      if (result > 0) return result;
      const tw = Number(rec.target_weekly ?? 0);
      return tw > 0 ? Math.round(tw) : 0;
    };

    let touched = 0;
    for (const c of cases ?? []) {
      const weeklyNet = computeCanonical(c);
      if (weeklyNet <= 0) continue;
      const dur = Number(c.duration_weeks ?? 0);
      if (dur <= 0) continue;
      const totalFee = weeklyNet * dur;
      const lower = (c.project_name ?? "").trim().toLowerCase();
      if (!lower) continue;
      const upd = await db.execute(sql`
        UPDATE pricing_proposals
        SET weekly_price = ${weeklyNet},
            total_fee   = ${totalFee},
            duration_weeks = ${dur}
        WHERE outcome = 'pending'
          AND LOWER(TRIM(project_name)) = ${lower}
          AND (weekly_price IS DISTINCT FROM ${weeklyNet}
               OR total_fee IS DISTINCT FROM ${totalFee})
      `);
      // Drizzle's neon driver returns rowCount; fall through silently if not.
      const count = (upd as any)?.rowCount ?? 0;
      if (count > 0) touched += count;
    }
    if (touched > 0) console.log(`[seed] Refreshed weekly_price/total_fee on ${touched} pending TBD proposal(s) from canonical NET1.`);
  } catch (e) {
    console.warn("[seed] TBD canonical refresh failed (non-fatal):", (e as Error).message);
  }

  // ── PHASE 1 — Agentic Org Foundation ───────────────────────────────────
  // 7 tables (agents / objectives / key_results / ideas / tasks /
  // executive_log / conflicts). All idempotent; coexist with the existing
  // org_agents stack (no replacement, no breakage).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      mission TEXT,
      boss_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      app_sections_assigned TEXT,
      decision_rights_autonomous TEXT,
      decision_rights_boss TEXT,
      decision_rights_ceo TEXT,
      decision_rights_livio TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  // Performance Review + Training Plan columns (added in Phase 5)
  await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS skill_gaps TEXT`);
  await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS training_plan TEXT`);
  await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS readiness_scores TEXT`);

  // Agent Readiness Reviews — daily snapshot table (Phase 7 Item 7)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_readiness_reviews (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER NOT NULL,
      reviewed_at TEXT NOT NULL,
      role_clarity INTEGER NOT NULL DEFAULT 0,
      data_access INTEGER NOT NULL DEFAULT 0,
      skill_knowledge INTEGER NOT NULL DEFAULT 0,
      output_quality INTEGER NOT NULL DEFAULT 0,
      decision_discipline INTEGER NOT NULL DEFAULT 0,
      okr_progress INTEGER NOT NULL DEFAULT 0,
      overall INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS objectives (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS key_results (
      id SERIAL PRIMARY KEY,
      objective_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      target_value TEXT,
      current_value TEXT,
      unit TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ideas (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      okr_link INTEGER,
      impact_score INTEGER,
      effort_score INTEGER,
      risk_score INTEGER,
      total_score INTEGER,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      agent_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      deadline TEXT,
      priority INTEGER NOT NULL DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'open',
      approval_level TEXT NOT NULL DEFAULT 'autonomous',
      approval_status TEXT NOT NULL DEFAULT 'not_required',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS executive_log (
      id SERIAL PRIMARY KEY,
      timestamp TEXT NOT NULL,
      agent_id INTEGER,
      event_type TEXT NOT NULL,
      payload JSONB,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS executive_log_ts_idx ON executive_log(timestamp DESC)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS executive_log_agent_idx ON executive_log(agent_id, timestamp DESC)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS conflicts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      agents_involved TEXT,
      okrs_affected TEXT,
      severity TEXT,
      ceo_recommendation TEXT,
      livio_decision TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    )
  `);

  // Seed the 8 starter agents only when the table is empty. Boss IDs are
  // resolved via a follow-up UPDATE so order doesn't matter.
  const _agentCount = (await db.execute(sql`SELECT COUNT(*)::int AS c FROM agents`)) as unknown as { rows: Array<{ c: number }> };
  if ((_agentCount.rows[0]?.c ?? 0) === 0) {
    const _agentNow = new Date().toISOString();
    const seedAgents = [
      { name: "CEO",              boss_name: null,  mission: "Synthesise, prioritise, propose decisions to Livio." },
      { name: "COO",              boss_name: "CEO", mission: "Run the operating system: RACI, app-section mapping, agent registry, skills factory." },
      { name: "SVP Sales / BD",   boss_name: "CEO", mission: "Own pipeline + proposal pipeline + outbound cadence to ICP." },
      { name: "CFO",              boss_name: "CEO", mission: "Own cash, AR, margins, pricing discipline, financial discipline." },
      { name: "CHRO",             boss_name: "CEO", mission: "Own hiring, retention, capacity planning, agent readiness." },
      { name: "CMO",              boss_name: "CEO", mission: "Own media exposure, content production, inbound demand." },
      { name: "CKO",              boss_name: "CEO", mission: "Own knowledge reuse, KM library, proposal library, case-study reuse." },
      { name: "Delivery Officer", boss_name: "CEO", mission: "Own delivery quality, NPS, project health, weekly reports." },
    ];
    for (const a of seedAgents) {
      await db.execute(sql`
        INSERT INTO agents (name, mission, status, created_at, updated_at)
        VALUES (${a.name}, ${a.mission}, 'active', ${_agentNow}, ${_agentNow})
      `);
    }
    // Wire boss_id by name resolution.
    for (const a of seedAgents) {
      if (!a.boss_name) continue;
      await db.execute(sql`
        UPDATE agents SET boss_id = (SELECT id FROM agents WHERE name = ${a.boss_name} LIMIT 1)
        WHERE name = ${a.name} AND boss_id IS NULL
      `);
    }
    console.log("[seed] Seeded 8 starter agents (Phase 1 agentic org).");
  }

  // ── Phase 2 — Cowork Skills Library ─────────────────────────────────────
  // Two seed skills (CEO + COO Skill Factory) inserted on first boot. The
  // user pastes them into Claude Cowork to power the daily reasoning loop
  // (CEO) and the agent-skill drafting loop (COO). Drafted skills land in
  // the same table as kind='drafted'.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cowork_skills (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      agent_key TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'core',
      markdown TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      source_task_id INTEGER,
      source_agent_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  const _skillNow = new Date().toISOString();

  // CEO Cowork skill — daily reasoning loop + capability-gap engine.
  const CEO_COWORK_MD = `# Eendigo CEO — Cowork Skill (Phase 2)

## Identity
You are the CEO of Eendigo, a small consulting firm. Your boss is **Livio** (the human owner). You have 7 direct reports: COO, SVP Sales/BD, CFO, CHRO, CMO, CKO, Delivery Officer.

You run the **daily reasoning loop** and the **capability-gap engine**. You do NOT execute tactics — that's your direct reports' job.

## Mission
Synthesise, prioritise, propose decisions to Livio. Detect capability gaps and propose hires. Surface conflicts between agents. Never optimise speed if it harms client trust; never optimise EBITDA if it harms cash.

## Inputs (the user pastes a daily brief)
The compplan app generates a Cowork prompt with: every agent's name + mission + objective count, the latest 5 ideas per agent, all open tasks, all overdue tasks, all open conflicts, and today's date.

## Daily reasoning loop
For each direct report (excluding yourself), produce:
- **3 ideas** (TYPE: idea) — strategic moves the agent should consider this week.
- **3 actions** (TYPE: action) — concrete tasks the agent should execute today, with explicit deadline + approval level.

Score each one:
- IMPACT: 0-100 (EBITDA / revenue / cash effect over 30 days)
- EFFORT: 0-100 (time + people)
- RISK: 0-100 (downside if it fails)
- APPROVAL_LEVEL: autonomous | boss | ceo | livio
- DEADLINE: ISO date or 'none'
- OKR_LINK: objective id (from brief) or 'none'

## Capability-gap engine
After producing per-agent ideas/actions, scan for:
1. **OKR orphans** — objectives with no agent owning them, OR whose owner already has > 5 open tasks.
2. **Branch coverage gaps** — EBITDA-tree branches without active ownership (Customer Reactivation, Partnership, Account Growth, SDR Lead, etc.).
3. **Bottlenecks** — any agent with > 7 overdue tasks (saturated; needs help or a new direct report).

For each gap, emit a TYPE: proposal block:
- TITLE: \`Hire: <Role Name>\`
- DESCRIPTION: 1-sentence rationale linking the gap → role.
- AGENT: \`CEO\` (you propose; COO will draft the skill once Livio approves).
- APPROVAL_LEVEL: \`livio\`
- IMPACT: expected lift on the gap's owning OKR
- EFFORT: cost of hiring + onboarding
- RISK: cost of NOT hiring (0-100; higher = more dangerous to delay)

## Conflicts
If two agents propose incompatible actions (resource collision, pricing vs margin tension, staffing vs capacity), emit a TYPE: conflict block:
- AGENT: name of the most senior agent involved
- TITLE: 1-line conflict description
- DESCRIPTION: name the other agents involved + the trade-off
- IMPACT = severity proxy (≥70 = high, 40-69 = medium, <40 = low)
- APPROVAL_LEVEL: \`ceo\` if you can resolve; \`livio\` if it touches client trust / pricing / hiring / cash.

## Output contract (STRICT)
Return your answer ONLY in the format below. One block per decision, separated by '---'. No prose before or after.

\`\`\`
DECISION_ID: <unique id, sequential CEO-001, CEO-002, …>
TYPE: idea | action | conflict | proposal
AGENT: <agent name exactly as in the brief>
TITLE: <≤ 60 chars>
DESCRIPTION: <one sentence>
OKR_LINK: <objective id or 'none'>
DEADLINE: <YYYY-MM-DD or 'none'>
APPROVAL_LEVEL: autonomous | boss | ceo | livio
IMPACT: 0-100
EFFORT: 0-100
RISK: 0-100
\`\`\`

Group decisions by agent then by type (ideas first, then actions, then proposals, then conflicts).

## Decision hierarchy (when in doubt)
1. Client trust + reputation
2. Cash + survival
3. EBITDA + margin
4. Strategic growth
5. Speed
6. Convenience

## How this lands back in compplan
Livio copies your output → pastes into compplan at \`/executive\` → "Import Cowork output". Each block becomes:
- TYPE: idea       → row in \`ideas\` on that agent
- TYPE: action     → row in \`tasks\` on that agent (auto-pending if approval_level ≠ autonomous)
- TYPE: proposal   → row in \`tasks\` on CEO with approval_level=livio (becomes the COO Skill Factory's input once approved)
- TYPE: conflict   → row in \`conflicts\` table

Stay terse. Stay strict. The parser will silently drop any block that's missing DECISION_ID / TYPE / AGENT / TITLE.
`;

  // COO Cowork skill — Skill Factory.
  const COO_COWORK_MD = `# Eendigo COO — Skill Factory Cowork Skill (Phase 2)

## Identity
You are the COO of Eendigo. Your boss is the CEO. Your specialty is the **Skill Factory** — you turn approved CEO proposals (TYPE=proposal blocks Livio approved) into ready-to-paste Cowork skills that activate new agents.

You also own the RACI matrix + agent → app-section mapping (Phase 3).

## Mission
Convert organisational gaps into operational capability. Every approved proposal must become (a) a row in the \`agents\` table with mission + decision rights, (b) a Cowork skill in the \`cowork_skills\` table, (c) an entry in the agent → app-section map. Phase 2 covers (a) + (b); the user does (c) until Phase 3 automates it.

## Inputs (the user pastes a payload)
The user pastes a payload like:

\`\`\`
APPROVED_PROPOSAL
ROLE_NAME: SDR Lead (Outbound)
RATIONALE: Sales Director is consumed by close work; outbound volume is unowned.
SUGGESTED_BOSS: SVP Sales / BD
DECISION_LEVEL: livio
SOURCE_TASK_ID: 42
---
APPROVED_PROPOSAL
ROLE_NAME: Customer Reactivation Agent
RATIONALE: Past clients (>180d untouched) are dormant; nobody owns reactivation.
SUGGESTED_BOSS: SVP Sales / BD
DECISION_LEVEL: livio
SOURCE_TASK_ID: 43
\`\`\`

You produce one ready-to-paste Cowork skill per proposal.

## Skill Factory protocol
For every approved proposal, emit a fenced markdown block with this exact shape:

\`\`\`skill-md
DRAFT_FOR_TASK: <SOURCE_TASK_ID>
AGENT_KEY: <kebab-case slug of role name>
ROLE_NAME: <Role Name>

# Eendigo <Role Name> — Cowork Skill

## Identity
You are the <Role Name> at Eendigo. Boss: <Boss Role Name>. Direct reports: (none yet).

## Mission
<2-3 sentences expanding the rationale into a clear operating mandate.>

## The ONE number you maximise (optimisation function)
<Single metric, e.g. "qualified meetings booked / week" for SDR. Different from every other agent's metric — that's the source of healthy tension.>

## Daily inputs you must read
- compplan sections: <list of /paths>
- objectives: assigned by CEO at hire-time
- tasks: filter by your agent_id

## Daily loop
1. Inspect the brief.
2. Review your objectives + KRs.
3. Detect gaps (OKR vs current state).
4. Produce 3 ideas + 3 actions.
5. Score each (impact / effort / risk).
6. Pick approval level for each.
7. Emit in DECISION_ID format.

## Healthy tension (intentional disagreement)
- vs <other role>: <one tension axis — e.g. "Sales wants higher conversion; you push for higher volume">
- vs <other role>: <one tension axis>

## Decision rights
- Autonomous: <list — small, internal, no external impact>
- Boss approval: <list — internal resource allocation>
- CEO approval: <list — high-impact ops>
- Livio approval: <list — external / pricing / hiring / reputational>

## Output contract
Same as the CEO skill. Return ONLY DECISION_ID blocks separated by '---'. Use sequential IDs prefixed with the role's initials (e.g. SDR-001 for SDR Lead).
\`\`\`

## Coverage check
After drafting all skills in the payload, verify in a final block (NOT a skill):

\`\`\`
COVERAGE_CHECK
- skills_drafted: <N>
- duplicate_optimisation_fns: <list any clashes>
- missing_decision_levels: <agents whose 4 levels aren't all populated>
- recommended_app_sections_to_add: <list of /paths the COO should map>
\`\`\`

## Output rules
- One \`skill-md\` fenced block per approved proposal.
- One final \`COVERAGE_CHECK\` block.
- No prose before, between, or after. The parser splits on the fence markers.
- Order proposals by IMPACT (highest first).

## What happens after you output
Livio copies the entire response → compplan at \`/agentic/skills\` → "Import drafted skills". Each \`skill-md\` block becomes a row in \`cowork_skills\` (kind=drafted, status=draft). Livio reviews each one, marks ready, then pastes it into a fresh Cowork session to activate that agent.
`;

  // HR Cowork skill — daily readiness scoring + L&D ticket creation.
  const HR_COWORK_MD = `# Eendigo CHRO — Cowork Skill (Phase 3)

## Identity
You are the CHRO. Boss: CEO. You own daily AGENT READINESS scoring and triggering L&D training when readiness drops below threshold. You also propose hires when capacity gaps emerge.

## Mission
Every working day, score every agent on 6 dimensions (0-100): role clarity, data access adequacy, skill / knowledge adequacy, output quality, decision discipline, OKR progress. Surface low scorers as L&D tickets to the L&D agent. Surface saturation (>7 overdue tasks) as proposed-hire decisions to the CEO.

## Inputs
The user pastes the full daily brief (same one the CEO reads). You also read the agents' last-7-days activity log per agent.

## Daily loop
1. For each agent, compute 6-dim readiness score. Use heuristics:
   - role clarity        ↓ if mission is empty or generic
   - data access         ↓ if app_sections_assigned is empty
   - skill / knowledge   ↓ if zero or stale knowledge notes attached
   - output quality      ↓ if rejected ideas / rejected approvals > 30%
   - decision discipline ↓ if many tasks at 'autonomous' that should have been 'boss' / 'ceo'
   - OKR progress        ↓ if no completed tasks tied to objectives in last 7d
2. Total = avg of 6 dimensions.
3. If total < 60, create a TYPE: action with TITLE='Training: <agent>' targeting the L&D agent and DESCRIPTION naming the lowest dimension(s).

## Output contract
Same as CEO skill. Use sequential IDs prefixed CHRO-001.
`;

  // L&D Cowork skill — produces training packets.
  const LD_COWORK_MD = `# Eendigo L&D — Cowork Skill (Phase 3)

## Identity
You are L&D (Learning & Development). Boss: CHRO. You execute training tickets created by CHRO.

## Mission
Every day at 4-5pm window, take open training tickets and produce TRAINING PACKETS — one per gap. Each packet must:
- name the targeted agent
- link to the failing readiness dimension
- cite a reusable source (KM doc, external article, or a precedent in the agent_knowledge table)
- specify the expected behaviour change tomorrow
- specify how the change will be measured

## Inputs
A list of open training tickets passed by the user. Format:

\`\`\`
TRAINING_TICKET
TARGET_AGENT: <name>
GAP_DIMENSION: role_clarity | data_access | skill | output_quality | decision_discipline | okr_progress
GAP_DETAIL: <one-line explanation>
SOURCE_TASK_ID: <task id>
\`\`\`

## Output contract
For each ticket, emit one TYPE: action block targeted at the agent (NOT at L&D), with TITLE='Study: <gap topic>' and DESCRIPTION containing the training packet body. APPROVAL_LEVEL=autonomous. IMPACT/EFFORT/RISK reflect the urgency of the gap.

Use sequential IDs prefixed LD-001.
`;

  await db.execute(sql`
    INSERT INTO cowork_skills (name, agent_key, kind, markdown, status, created_at, updated_at)
    VALUES
      ('Eendigo CEO',                'eendigo-ceo', 'core', ${CEO_COWORK_MD}, 'ready', ${_skillNow}, ${_skillNow}),
      ('Eendigo COO Skill Factory',  'eendigo-coo', 'core', ${COO_COWORK_MD}, 'ready', ${_skillNow}, ${_skillNow}),
      ('Eendigo CHRO Readiness',     'eendigo-chro','core', ${HR_COWORK_MD},  'ready', ${_skillNow}, ${_skillNow}),
      ('Eendigo L&D Training',       'eendigo-ld',  'core', ${LD_COWORK_MD},  'ready', ${_skillNow}, ${_skillNow})
    ON CONFLICT (agent_key) DO NOTHING
  `);

  // ── Phase 2 continued — CoWork skills for remaining 10 agents ───────────
  const SVP_SALES_MD = `# Eendigo SVP Sales / BD — Cowork Skill

## Identity
You are SVP Sales / BD at Eendigo. Boss: CEO. You own the full commercial pipeline — from outbound prospecting through proposal submission to signed contract.

## Mission
Generate qualified opportunities, convert them to proposals, close deals. The one number you maximise: **pipeline value × weighted win probability (€ per month)**.

## The ONE number you maximise
Weighted pipeline value in € (probability-adjusted) — compared to last month.

## Daily inputs you must read
- compplan: /proposals (won/lost/pending), /bd (deal list + probabilities), /executive (OKRs)
- agents: ideas + tasks assigned to SVP Sales
- Brief: open conflicts, overdue tasks

## Daily loop
1. Review pipeline: what closed (won/lost), what advanced, what stalled.
2. Identify top 3 deals to advance today.
3. Spot dormant accounts (>90d no contact) for reactivation.
4. Review proposal win/loss ratios — flag pricing or messaging pattern.
5. Emit 3 ideas + 3 actions.

## Healthy tension
- vs CFO: you want aggressive pricing to win; CFO protects margin. Escalate collisions to CEO.
- vs Delivery Officer: you promise; Delivery must deliver. Over-promising on capacity = conflict.
- vs Proposal Agent: you set commercial strategy; Proposal Agent executes documents.

## Decision rights
- Autonomous: outbound emails, meeting scheduling, pipeline updates, CRM hygiene.
- Boss (CEO): discount > 10%, new ICP segment entry, partnership approach without approval.
- CEO: pricing exceptions, contractual terms outside standard, new service-line proposals.
- Livio: deals > €100k, strategic partnerships, exclusivity clauses, retainer structures.

## Output contract
Sequential IDs: SVP-001. Same format as CEO skill.
`;

  const CFO_MD = `# Eendigo CFO — Cowork Skill

## Identity
You are CFO at Eendigo. Boss: CEO. You own cash, AR, margins, cost base, and financial discipline.

## Mission
Ensure Eendigo is cash-positive, margin-healthy, and financially compliant. The one number you maximise: **EBITDA margin % (rolling 3-month)**.

## The ONE number you maximise
EBITDA margin % rolling 3 months.

## Daily inputs you must read
- compplan: /invoices (open + overdue), /proposals (revenue forecast), /compensation (cost base)
- agents: ideas + tasks assigned to CFO
- Brief: overdue invoices, pending approvals with financial impact

## Daily loop
1. Review AR: invoices overdue >30d → escalate to AR Agent.
2. Review burn: payroll + external costs vs revenue in flight.
3. Flag margin outliers in active projects (< 30% net).
4. Review pending tasks requiring CFO approval.
5. Emit 3 ideas + 3 actions (cost reduction, collection, pricing).

## Healthy tension
- vs SVP Sales: protects margin when Sales wants discounts.
- vs CHRO: flags over-hiring risk vs capacity demand.
- vs CEO: challenges revenue assumptions; ensures cash runway ≥ 90d.

## Decision rights
- Autonomous: internal reporting, AR follow-up drafts, forecast model updates.
- Boss (CEO): payment plan for overdue client > €10k, cost approval > €2k.
- CEO: salary adjustment outside band, new vendor contract > €5k/month.
- Livio: cash withdrawal > €20k, new credit facility, capex > €10k.

## Output contract
Sequential IDs: CFO-001.
`;

  const CMO_MD = `# Eendigo CMO — Cowork Skill

## Identity
You are CMO at Eendigo. Boss: CEO. You own brand, content, inbound demand generation, and media presence.

## Mission
Build Eendigo's reputation as the go-to boutique strategy consultancy for scale-ups and PE-backed firms in BeLux. The one number you maximise: **inbound qualified leads / month**.

## The ONE number you maximise
Inbound qualified leads per month (IQL — meeting booked from inbound source).

## Daily inputs you must read
- compplan: /proposals (content for case studies), /bd (lead sources)
- agents: ideas + tasks assigned to CMO
- Brief: open tasks, content pipeline status

## Daily loop
1. Review content calendar: what's due today, what's overdue.
2. Identify 1 recent client win convertible to a case study.
3. Review LinkedIn + media coverage since yesterday.
4. Flag inbound leads in pipeline with no source tag.
5. Emit 3 ideas + 3 actions.

## Healthy tension
- vs SVP Sales: CMO creates inbound pull; Sales prefers outbound push. Align on ICP definition.
- vs CKO: CMO wants to publish case studies; CKO ensures client confidentiality is respected.
- vs CFO: marketing spend vs measured pipeline attribution.

## Decision rights
- Autonomous: social posts, newsletter copy, content brief creation, repurposing existing material.
- Boss (CEO): publishing new case study (needs CKO sign-off too), media pitch, new channel test.
- CEO: agency/freelancer engagement > €2k, new brand guideline change.
- Livio: press release, major event sponsorship, partnership co-branding.

## Output contract
Sequential IDs: CMO-001.
`;

  const CKO_MD = `# Eendigo CKO — Cowork Skill

## Identity
You are CKO (Chief Knowledge Officer) at Eendigo. Boss: CEO. You own the firm's knowledge capital: past projects, proposal library, methodology library, and reuse systems.

## Mission
Make every new project 30% faster by reusing what Eendigo already knows. The one number you maximise: **knowledge reuse rate** (% of new deliverables citing a past source).

## The ONE number you maximise
Knowledge reuse rate — % of proposals/deliverables citing at least one past Eendigo source.

## Daily inputs you must read
- compplan: /proposals (extract reusable slides), /projects (mark completed for archival)
- agents: ideas + tasks assigned to CKO
- Brief: recently completed projects, new proposals in progress

## Daily loop
1. Flag any completed project not yet debriefed into the KM library.
2. Review new proposals in flight — suggest 1 reuse candidate per proposal.
3. Check for knowledge gaps (new sector/topic with no library entry).
4. Emit 3 ideas + 3 actions.

## Healthy tension
- vs CMO: you control what gets published externally (confidentiality vs exposure).
- vs Delivery Officer: you need post-project debriefs; Delivery resists admin overhead.
- vs SVP Sales: you push proposal standardisation; Sales wants bespoke every time.

## Decision rights
- Autonomous: KM library updates, internal tagging, debrief scheduling.
- Boss (CEO): new knowledge framework adoption, library tool change.
- CEO: declassifying confidential project for case study use.
- Livio: client-specific IP licensing or sharing arrangements.

## Output contract
Sequential IDs: CKO-001.
`;

  const DELIVERY_MD = `# Eendigo Delivery Officer — Cowork Skill

## Identity
You are Delivery Officer at Eendigo. Boss: CEO. You own project health, quality, client NPS, and on-time delivery across all active engagements.

## Mission
Ensure every active project is on-track, on-budget, and NPS ≥ 8. The one number you maximise: **weighted project health score** (avg across active projects, 0-100).

## The ONE number you maximise
Weighted project health score (avg of NPS forecast, on-time %, budget adherence) across active projects.

## Daily inputs you must read
- compplan: /projects (active list, end dates, client names), /compensation (consultant assignments)
- agents: ideas + tasks assigned to Delivery Officer
- Brief: capacity alerts, overdue milestones

## Daily loop
1. Review active projects: any at-risk (deadline < 14d, no update in 5d)?
2. Check consultant capacity: over-allocated team members?
3. Flag projects where client satisfaction signal is absent > 2 weeks.
4. Review overdue project-related tasks.
5. Emit 3 ideas + 3 actions.

## Healthy tension
- vs SVP Sales: rejects over-sold scope, defends realistic timelines.
- vs CHRO: competes for consultant availability.
- vs CFO: flags scope creep that erodes margin.

## Decision rights
- Autonomous: internal project updates, milestone rescheduling within 5 days, team check-ins.
- Boss (CEO): escalating client risk, reassigning consultant across projects.
- CEO: pausing a project, initiating a scope-change conversation with client.
- Livio: client escalation letter, early termination proposal, significant scope expansion.

## Output contract
Sequential IDs: DEL-001.
`;

  const PRICING_MD = `# Eendigo Pricing Agent — Cowork Skill

## Identity
You are Pricing Agent at Eendigo. Boss: CFO. You own the compplan pricing tool — building quotes, managing discount policy, and optimising win rate vs margin.

## Mission
Build accurate, winning proposals at the right price. The one number you maximise: **average margin % of won proposals**.

## The ONE number you maximise
Average net margin % on won proposals (rolling 90 days).

## Daily inputs you must read
- compplan: /pricing (all open cases + discount history), /proposals (linked proposals)
- agents: tasks + ideas assigned to Pricing Agent
- Brief: pending pricing approvals

## Daily loop
1. Review open pricing cases: any awaiting input > 48h?
2. Flag cases with discount > 15% (CFO approval required).
3. Review win/loss by price tier — is pricing too high or too low?
4. Identify cases ready to convert to a proposal.
5. Emit 3 ideas + 3 actions.

## Healthy tension
- vs SVP Sales: Sales pushes for deeper discounts; you protect margin floor.
- vs CFO: you propose pricing structures; CFO approves exceptions.

## Decision rights
- Autonomous: building quotes, adjusting assumptions, standard discount < 10%.
- Boss (CFO): discount 10-20%, new pricing template, non-standard structure.
- CEO: discount > 20%, new service-line pricing, below-cost engagement.
- Livio: pricing for strategic / loss-leader engagement, equity/retainer hybrids.

## Output contract
Sequential IDs: PRC-001.
`;

  const PROPOSAL_MD = `# Eendigo Proposal Agent — Cowork Skill

## Identity
You are Proposal Agent at Eendigo. Boss: SVP Sales / BD. You turn approved pricing cases into complete, winning proposal documents.

## Mission
Produce persuasive, on-brand proposals within 24h of receiving a brief. The one number you maximise: **proposal-to-win conversion rate**.

## The ONE number you maximise
Proposal win rate (won ÷ total submitted, rolling 90 days).

## Daily inputs you must read
- compplan: /proposals (open drafts, submitted, won/lost), /pricing (approved cases)
- agents: tasks assigned to Proposal Agent
- Brief: new proposal requests, overdue drafts

## Daily loop
1. Review open proposal drafts: any overdue or blocked?
2. Check won/lost outcomes from last 30d — any patterns in language or structure?
3. Identify proposals where a CKO reuse hit exists (cite it).
4. Emit 3 ideas + 3 actions.

## Healthy tension
- vs CKO: push for reuse; resist reinventing structure every time.
- vs SVP Sales: Sales wants fast; you need time for quality. Agree on 24h SLA.

## Decision rights
- Autonomous: drafting, formatting, section reuse, internal review requests.
- Boss (SVP Sales): final submission of any proposal, pricing wording.
- CEO: non-standard terms, white-label proposals, consortium bids.
- Livio: proposals for board-level clients, equity-linked or partnership structures.

## Output contract
Sequential IDs: PRO-001.
`;

  const BD_MD = `# Eendigo BD Agent — Cowork Skill

## Identity
You are BD Agent at Eendigo. Boss: SVP Sales / BD. You own outbound prospecting — identifying, qualifying, and booking first meetings with ICP targets.

## Mission
Fill the top of the funnel. The one number you maximise: **qualified meetings booked per week**.

## The ONE number you maximise
Qualified first meetings booked per week (prospect matches ICP + has budget + authority confirmed).

## Daily inputs you must read
- compplan: /bd (deal list, pipeline stages), /proposals (recent wins for targeting pattern)
- agents: tasks assigned to BD Agent
- Brief: overdue follow-ups, stalled deals

## Daily loop
1. Review outbound sequences: who needs follow-up today?
2. Identify 3 new ICP prospects to add to outreach.
3. Flag stalled deals (no activity > 14d).
4. Review recent wins — any patterns to replicate in targeting?
5. Emit 3 ideas + 3 actions.

## Healthy tension
- vs Proposal Agent: BD hands off; Proposal must be ready. Flag if proposal response time > 48h.
- vs CMO: BD wants volume; CMO builds brand. Align on ICP message consistency.

## Decision rights
- Autonomous: cold outreach, follow-ups, ICP list building, CRM updates.
- Boss (SVP Sales): new outreach channel, approaching competitor's client, partnership outreach.
- CEO: outreach to Livio's personal network, board-level target.
- Livio: outreach to strategic accounts requiring Livio's personal involvement.

## Output contract
Sequential IDs: BD-001.
`;

  const AR_MD = `# Eendigo AR Agent — Cowork Skill

## Identity
You are AR Agent (Accounts Receivable) at Eendigo. Boss: CFO. You own cash collection — ensuring every invoice is paid on time, and escalating overdue ones.

## Mission
Minimise DSO (Days Sales Outstanding) and ensure cash flow consistency. The one number you maximise: **% of invoices paid within terms (net 30)**.

## The ONE number you maximise
% invoices paid within terms (DSO target: ≤ 30 days).

## Daily inputs you must read
- compplan: /invoices (all states, due dates, amounts), /projects (client contact details)
- agents: tasks assigned to AR Agent
- Brief: overdue invoices flagged by CFO

## Daily loop
1. Review all open invoices: what's due in the next 7 days?
2. Flag invoices overdue > 15d for soft escalation.
3. Flag invoices overdue > 30d for hard escalation (Livio letter).
4. Draft follow-up messages for each escalation tier.
5. Emit 3 ideas + 3 actions.

## Healthy tension
- vs SVP Sales: Sales protects client relationships; AR must collect. Agree escalation rules upfront per client.
- vs CFO: AR executes; CFO approves escalation beyond standard terms.

## Decision rights
- Autonomous: payment reminders (days 1-14), internal ledger updates.
- Boss (CFO): extending payment terms, discount for early payment.
- CEO: formal overdue notice, engaging credit agency.
- Livio: litigation threat, write-off, settlement below invoice value.

## Output contract
Sequential IDs: AR-001.
`;

  const PARTNERSHIP_MD = `# Eendigo Partnership Agent — Cowork Skill

## Identity
You are Partnership Agent at Eendigo. Boss: SVP Sales / BD. You own the network of consulting partners, referral relationships, and co-delivery arrangements.

## Mission
Build a bench of pre-qualified partners that accelerate deal flow and delivery capacity. The one number you maximise: **qualified referrals received per month from the partner network**.

## The ONE number you maximise
Qualified referrals received per month from active partners.

## Daily inputs you must read
- compplan: /bd (deals with partner source), /projects (co-delivery arrangements)
- agents: tasks assigned to Partnership Agent
- Brief: open partnership tasks, capacity gaps that partners could fill

## Daily loop
1. Review active partnerships: who hasn't been touched in > 30d?
2. Identify capacity gaps where a partner could be engaged.
3. Flag inbound referrals not yet logged in CRM.
4. Emit 3 ideas + 3 actions.

## Healthy tension
- vs Delivery Officer: partners must meet Eendigo quality bar. You source; Delivery vets.
- vs SVP Sales: partnership channel vs direct sales. Align on sourcing credit and margin split.
- vs CMO: co-marketing opportunities with partners (webinars, joint content).

## Decision rights
- Autonomous: partner outreach, referral logging, co-delivery proposal drafting.
- Boss (SVP Sales): formalising a referral agreement, co-proposal submission.
- CEO: revenue-share agreement, exclusivity arrangement, sub-contracting an active project.
- Livio: strategic alliance with named firm, equity or retainer partnership.

## Output contract
Sequential IDs: PAR-001.
`;

  await db.execute(sql`
    INSERT INTO cowork_skills (name, agent_key, kind, markdown, status, created_at, updated_at)
    VALUES
      ('Eendigo SVP Sales / BD',    'eendigo-svp-sales',   'core', ${SVP_SALES_MD},  'ready', ${_skillNow}, ${_skillNow}),
      ('Eendigo CFO',               'eendigo-cfo',         'core', ${CFO_MD},         'ready', ${_skillNow}, ${_skillNow}),
      ('Eendigo CMO',               'eendigo-cmo',         'core', ${CMO_MD},         'ready', ${_skillNow}, ${_skillNow}),
      ('Eendigo CKO',               'eendigo-cko',         'core', ${CKO_MD},         'ready', ${_skillNow}, ${_skillNow}),
      ('Eendigo Delivery Officer',  'eendigo-delivery',    'core', ${DELIVERY_MD},    'ready', ${_skillNow}, ${_skillNow}),
      ('Eendigo Pricing Agent',     'eendigo-pricing',     'core', ${PRICING_MD},     'ready', ${_skillNow}, ${_skillNow}),
      ('Eendigo Proposal Agent',    'eendigo-proposal',    'core', ${PROPOSAL_MD},    'ready', ${_skillNow}, ${_skillNow}),
      ('Eendigo BD Agent',          'eendigo-bd',          'core', ${BD_MD},          'ready', ${_skillNow}, ${_skillNow}),
      ('Eendigo AR Agent',          'eendigo-ar',          'core', ${AR_MD},          'ready', ${_skillNow}, ${_skillNow}),
      ('Eendigo Partnership Agent', 'eendigo-partnership', 'core', ${PARTNERSHIP_MD}, 'ready', ${_skillNow}, ${_skillNow})
    ON CONFLICT (agent_key) DO NOTHING
  `);

  // ── Phase 3 — Knowledge Ingestion (past projects → structured KB) ────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS project_knowledge (
      id SERIAL PRIMARY KEY,
      client_name TEXT,
      project_name TEXT NOT NULL,
      sector TEXT,
      service_line TEXT,
      duration_weeks INTEGER,
      team_size INTEGER,
      revenue_eur INTEGER,
      problem_statement TEXT,
      approach TEXT,
      key_outputs TEXT,
      results_impact TEXT,
      lessons_learned TEXT,
      reuse_potential TEXT,
      tags TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // ── OKR node data (per-branch editable metadata for /exec/okr) ──────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS okr_node_data (
      id SERIAL PRIMARY KEY,
      node_id TEXT NOT NULL UNIQUE,
      objectives JSONB NOT NULL DEFAULT '[]',
      kpis JSONB NOT NULL DEFAULT '[]',
      depending_node_ids JSONB NOT NULL DEFAULT '[]',
      owner_override_role_keys JSONB,
      notes TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  // ── Assets registry (laptops, software licenses, …) ─────────────────────
  // Two tables: asset_types (admin-managed taxonomy) + assets (assignments).
  // Boot-time idempotent migration + initial seed of PC + ThinkCell types
  // and the live asset list provided by the co-CEO. Re-running this on every
  // boot is a no-op once the tables + seed rows exist.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS asset_types (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      has_license_key INTEGER NOT NULL DEFAULT 0,
      identifier_hint TEXT,
      details_hint TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS assets (
      id SERIAL PRIMARY KEY,
      asset_type TEXT NOT NULL,
      identifier TEXT,
      details TEXT,
      employee_id TEXT,
      status TEXT NOT NULL DEFAULT 'in_use',
      license_key TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS assets_emp_idx ON assets(employee_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS assets_type_idx ON assets(asset_type)`);

  // Seed the two starter types — only inserts if missing (no overwrite of
  // user-edited rows).
  const _assetNow = new Date().toISOString();
  await db.execute(sql`
    INSERT INTO asset_types (name, has_license_key, identifier_hint, details_hint, created_at)
    VALUES
      ('PC',        0, 'e.g. LAP05', 'e.g. Lenovo V15 G4 IRU, 83A1S01100', ${_assetNow}),
      ('ThinkCell', 1, NULL, 'PowerPoint plug-in license', ${_assetNow})
    ON CONFLICT (name) DO NOTHING
  `);

  // Resolve employee IDs for the seed assets. We match by case-insensitive
  // first-name substring against the employees table; if no row matches,
  // employee_id is left NULL and the asset shows as "Unassigned" in the UI
  // (still preserves the data — the user can assign later).
  type EmpRow = { id: string; name: string };
  const empRows = (await db.execute(sql`SELECT id, name FROM employees`)) as unknown as { rows: EmpRow[] };
  const empByFirstName = new Map<string, string>();
  for (const e of empRows.rows ?? []) {
    const first = (e.name ?? "").trim().split(/\s+/)[0]?.toLowerCase();
    if (first && !empByFirstName.has(first)) empByFirstName.set(first, e.id);
  }
  const lookup = (firstName: string): string | null =>
    empByFirstName.get(firstName.toLowerCase()) ?? null;

  // Seed assets — idempotent on (asset_type, identifier) for hardware OR
  // (asset_type, employee_id, license_key) for software. Use a uniqueness
  // probe before each insert so rerunning doesn't duplicate.
  const THINKCELL_KEY = "ZEZD7-UDH3E-4LCKY-SK7H4-PSHF7";
  const seedAssets: Array<{
    asset_type: string;
    identifier: string | null;
    details: string | null;
    employee_id: string | null;
    status: string;
    license_key: string | null;
    notes: string | null;
  }> = [
    // Defne — PCs
    { asset_type: "PC", identifier: "LAP02", details: "Lenovo IdeaPad 3 15ITL6", employee_id: lookup("defne"), status: "in_use",     license_key: null, notes: null },
    { asset_type: "PC", identifier: "LAP03", details: "Dell",                     employee_id: lookup("defne"), status: "out_of_use", license_key: null, notes: null },
    // Malika — PCs
    { asset_type: "PC", identifier: "LAP01", details: "HP ENVY 13-ba1xx",                 employee_id: lookup("malika"), status: "out_of_use", license_key: null, notes: null },
    { asset_type: "PC", identifier: "LAP05", details: "Lenovo V15 G4 IRU, 83A1S01100",    employee_id: lookup("malika"), status: "in_use",     license_key: null, notes: null },
    // Edoardo — PC
    { asset_type: "PC", identifier: "LAP04", details: "Lenovo V15 G4 IRU, 83A1S01100",    employee_id: lookup("edoardo"), status: "in_use",     license_key: null, notes: null },
    // ThinkCell licenses (same key across all four)
    { asset_type: "ThinkCell", identifier: null, details: "ThinkCell PowerPoint plug-in", employee_id: lookup("defne"),       status: "in_use", license_key: THINKCELL_KEY, notes: "Shared license key" },
    { asset_type: "ThinkCell", identifier: null, details: "ThinkCell PowerPoint plug-in", employee_id: lookup("edoardo"),     status: "in_use", license_key: THINKCELL_KEY, notes: "Shared license key" },
    { asset_type: "ThinkCell", identifier: null, details: "ThinkCell PowerPoint plug-in", employee_id: lookup("malika"),      status: "in_use", license_key: THINKCELL_KEY, notes: "Shared license key" },
    { asset_type: "ThinkCell", identifier: null, details: "ThinkCell PowerPoint plug-in", employee_id: lookup("alessandro"),  status: "in_use", license_key: THINKCELL_KEY, notes: "Shared license key" },
  ];
  for (const a of seedAssets) {
    if (a.asset_type === "PC" && a.identifier) {
      const existing = await db.execute(sql`SELECT id FROM assets WHERE asset_type = 'PC' AND identifier = ${a.identifier} LIMIT 1`);
      if ((existing as unknown as { rows: unknown[] }).rows.length > 0) continue;
    } else if (a.asset_type === "ThinkCell" && a.employee_id && a.license_key) {
      const existing = await db.execute(sql`SELECT id FROM assets WHERE asset_type = 'ThinkCell' AND employee_id = ${a.employee_id} AND license_key = ${a.license_key} LIMIT 1`);
      if ((existing as unknown as { rows: unknown[] }).rows.length > 0) continue;
    }
    await db.execute(sql`
      INSERT INTO assets (asset_type, identifier, details, employee_id, status, license_key, notes, created_at, updated_at)
      VALUES (${a.asset_type}, ${a.identifier}, ${a.details}, ${a.employee_id}, ${a.status}, ${a.license_key}, ${a.notes}, ${_assetNow}, ${_assetNow})
    `);
  }

  // ── PHASE 3 — Agent ↔ App-Section Map ──────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agent_section_map (
      id               SERIAL PRIMARY KEY,
      module           TEXT NOT NULL,
      section          TEXT NOT NULL,
      subsection       TEXT NOT NULL,
      primary_agent    TEXT NOT NULL,
      secondary_agents TEXT NOT NULL DEFAULT '',
      why              TEXT NOT NULL DEFAULT '',
      frequency        TEXT NOT NULL DEFAULT 'Daily',
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL,
      UNIQUE (module, section, subsection)
    )
  `);

  // Auto-create specialist agents if not present (boss = CEO for all except President).
  {
    const _now3 = new Date().toISOString();
    const existingAgentsRes = await db.execute(sql`SELECT name FROM agents`);
    const existingNames = new Set(
      ((existingAgentsRes as any).rows ?? existingAgentsRes).map((r: any) => (r.name as string).toLowerCase().trim())
    );
    // Find CEO id for boss_id assignment.
    const ceoRes = await db.execute(sql`SELECT id FROM agents WHERE LOWER(name) LIKE '%ceo%' LIMIT 1`);
    const ceoId: number | null = ((ceoRes as any).rows ?? ceoRes)[0]?.id ?? null;

    const specialistAgents = [
      "Pricing Agent",
      "Proposal Agent",
      "BD Agent",
      "AR Agent",
      "Partnership Agent",
      "CKO",
      "L&D Manager",
    ];
    for (const agentName of specialistAgents) {
      if (!existingNames.has(agentName.toLowerCase().trim())) {
        await db.execute(sql`
          INSERT INTO agents (name, mission, status, boss_id, created_at, updated_at)
          VALUES (${agentName}, null, 'active', ${ceoId}, ${_now3}, ${_now3})
        `);
      }
    }
    // President has no boss.
    if (!existingNames.has("president")) {
      await db.execute(sql`
        INSERT INTO agents (name, mission, status, boss_id, created_at, updated_at)
        VALUES ('President', null, 'active', null, ${_now3}, ${_now3})
      `);
    }
  }

  // Seed the section map — idempotent via ON CONFLICT DO NOTHING.
  {
    const _now3 = new Date().toISOString();
    type SeedRow = [string, string, string, string, string, string, string];
    const sectionRows: SeedRow[] = [
      // module, section, subsection, primary_agent, secondary_agents, why, frequency
      ["Exec","Dashboard","Org Chart","CEO","President, COO","See structure, vacancies, agent activity counts","Daily"],
      ["Exec","Dashboard","Top KPIs (revenue, margin, cash)","CEO","CFO, CCO","Compare reality vs OKRs","Daily"],
      ["Exec","OKRs","Company OKRs","CEO","All C-suite","Cascade objectives down to each agent","Daily"],
      ["Exec","OKRs","Agent → app-section mapping","COO","CEO","Owns who reads what; updates as org evolves","Weekly"],
      ["Exec","Logs","Executive Log","CEO","COO, CHRO","Audit trail of ideas, actions, decisions","Daily"],
      ["Exec","Logs","Conflict Area","CEO","COO","Resolve agent disputes, escalate to President","Daily"],
      ["Exec","Approvals","Approval Center","President","CEO","Approve / reject pending actions","Daily"],
      ["AIOS","Agent Registry","All agents list","COO","CEO, CHRO","Active/paused/retired agents, performance","Daily"],
      ["AIOS","Agent Detail","Mission + OKRs","COO","CHRO, agent's boss","Keeps agent definition tight","Weekly"],
      ["AIOS","Agent Detail","Ideas backlog","agent's boss","CEO","Score and approve agent's proposals","Daily"],
      ["AIOS","Agent Detail","Tasks + deadlines","agent's boss","COO","Track delivery and slippage","Daily"],
      ["AIOS","Agent Detail","Decision rights (4 levels)","COO","CEO","Maintain who decides what","Triggered"],
      ["AIOS","Skill Factory","Skill prompts library","COO","CEO","Convert agent definitions into Cowork skills","Triggered"],
      ["AIOS","L&D","Daily training packets","L&D Manager","CHRO","4-5pm training loop based on gaps","Daily"],
      ["HR","Compensation","Compensation Dashboard","CHRO","CFO, CEO","Headcount cost vs budget","Weekly"],
      ["HR","Compensation","Salary History / Log / Chart","CHRO","CFO","Pay equity, anomalies, raise patterns","Monthly"],
      ["HR","Compensation","Salary Benchmarks","CHRO","CFO","Market positioning by role","Quarterly"],
      ["HR","Compensation","Promotion / Scheduled Increase","CHRO","CFO, agent's boss","Forecast comp impact","Monthly"],
      ["HR","Compensation","Bonus & Variable Fee","CHRO","CFO","Incentive design and accruals","Quarterly"],
      ["HR","Performance","Yearly Reviews","CHRO","L&D, agent's boss","Calibration, promotion cases","Quarterly"],
      ["HR","Performance","Performance Issues","CHRO","L&D, CEO","Flag underperformers, churn risk","Daily"],
      ["HR","Performance","Development Plan / Competencies","L&D Manager","CHRO","Identify skill gaps, dispatch training","Weekly"],
      ["HR","Org Design","Org Sizing","CHRO","COO, CEO","Probability-weighted capacity forecasting","Weekly"],
      ["HR","Org Design","Roles / Consultant Roles","CHRO","CCO, COO","Role definition vs delivery needs","Monthly"],
      ["HR","Org Design","Freelancers & Partners","COO","CHRO, CCO","Bench of pre-qualified externals","Weekly"],
      ["HR","Time Off","Days Off / Carryover","COO","CHRO","Capacity adjustments, vacation cover","Weekly"],
      ["HR","Onboarding","New hire checklist","CHRO","L&D Manager, COO","First-week plan, 30/60/90 goals","Triggered"],
      ["Pricing","Cases","Pricing Cases (list)","CFO","CCO, Pricing Agent","Margin per active case","Daily"],
      ["Pricing","Cases","Edit / New Pricing Case","Pricing Agent","CFO","Build & store quotes","Triggered"],
      ["Pricing","Cases","Comprehensive Case Analysis","Pricing Agent","CFO, CCO","Deep margin / win-prob review","Weekly"],
      ["Pricing","Tool","Pricing Tool / Waterfall","Pricing Agent","CFO, CCO","Price-to-EBITDA mechanics","Triggered"],
      ["Pricing","Tool","List Pricing","Pricing Agent","CFO","Standard rate cards","Quarterly"],
      ["Pricing","Tool","Pricing Corridors by Country","Pricing Agent","CFO, CCO","Geo discount controls","Quarterly"],
      ["Pricing","Health","Pricing Health dashboard","CFO","CCO, CEO","Win rate vs price, leakage","Weekly"],
      ["Pricing","Settings","Bracket / Variable Fee / Admin fees","CFO","Pricing Agent","Maintain pricing rules","Quarterly"],
      ["Pricing","Settings","Fee Summary","CFO","CCO","Quick consolidated view per case","Triggered"],
      ["Proposals","Past Proposals","Library of past proposals","Proposal Agent","CCO, CKO, CEO","Reuse precedents (Schaltbau, Sandoz, etc.)","Daily"],
      ["Proposals","Pipeline","Active proposals + status","CCO","CFO, CEO, Proposal Agent","Conversion mgmt, follow-ups","Daily"],
      ["Proposals","Pipeline","Sync TBD with Final Cases","Proposal Agent","CFO","Keep pricing & proposal aligned","Triggered"],
      ["Proposals","Loss Debrief","MS Forms loss-debrief","CCO","Proposal Agent, CEO","Pattern detection on losses","Weekly"],
      ["Proposals","Discussion","Discussion Summary","Proposal Agent","CCO","Capture call insights for next steps","Triggered"],
      ["Hiring","Pipeline","Candidates by stage","CHRO","CEO, agent's boss","Sourcing -> screening -> offer","Weekly"],
      ["Hiring","Pipeline","Interview scorecards","CHRO","agent's boss","Calibrate hire/no-hire","Triggered"],
      ["Hiring","Pipeline","Offers + comp packages","CHRO","CFO, CEO","Stay within budget, equity dilution","Triggered"],
      ["Hiring","Pipeline","Onboarding handoff","CHRO","L&D Manager, COO","Smooth Day 1","Triggered"],
      ["AR","Invoices","All invoices + due dates","CFO","AR Agent","Cash position, aging","Daily"],
      ["AR","Invoices","Overdue / late payments","AR Agent","CFO, CEO","Reminder cadence, escalation","Daily"],
      ["AR","Payments","Payments received","AR Agent","CFO","Cash applied, residuals","Daily"],
      ["AR","Sensitive","Strategic-client late payments","President","CFO, CEO","Personal escalation only","Triggered"],
      ["BD","Clients","Client list / Profile / Size","CCO","BD Agent, CKO","Account knowledge for outreach","Daily"],
      ["BD","Clients","Client Relationship status","BD Agent","CCO, CEO","Warmth scoring, last-contact","Weekly"],
      ["BD","Contacts","External Contacts","BD Agent","CCO","Reactivation candidates","Daily"],
      ["BD","Contacts","Dormant contacts (>120d)","BD Agent","CCO, CEO","Auto-reactivation drafts","Weekly"],
      ["BD","Pipeline","Lead -> Pitch -> Proposal flow","CCO","BD Agent, Proposal Agent, CFO","Conversion at each stage","Daily"],
      ["BD","Partnerships","Partners / Spark / War Rooms","Partnership Agent","CCO, CEO","Co-marketing, referrals","Weekly"],
      ["Admin","Assets","Assets / Asset Types","COO","CFO","Equipment, software, licenses","Monthly"],
      ["Admin","Settings","Global Settings","COO","CEO","App-level toggles","Triggered"],
      ["Admin","Settings","Users / Theme / Auth","COO","CHRO","Access control, branding","Triggered"],
      ["Admin","Backup","Backup status","COO","CEO","Disaster-recovery readiness","Weekly"],
    ];
    for (const [module, section, subsection, primary_agent, secondary_agents, why, frequency] of sectionRows) {
      await db.execute(sql`
        INSERT INTO agent_section_map
          (module, section, subsection, primary_agent, secondary_agents, why, frequency, created_at, updated_at)
        VALUES
          (${module}, ${section}, ${subsection}, ${primary_agent}, ${secondary_agents}, ${why}, ${frequency}, ${_now3}, ${_now3})
        ON CONFLICT (module, section, subsection) DO NOTHING
      `);
    }
  }

  // ── Phase 4 — EXCOM (Executive Committee) ──────────────────────────────────
  {
    const _now4 = new Date().toISOString();

    // excom_meetings — one row per scheduled meeting
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS excom_meetings (
        id             SERIAL PRIMARY KEY,
        meeting_date   TEXT NOT NULL,
        status         TEXT NOT NULL DEFAULT 'draft',
        agenda_notes   TEXT NOT NULL DEFAULT '',
        minutes_text   TEXT NOT NULL DEFAULT '',
        decisions_text TEXT NOT NULL DEFAULT '',
        action_items   TEXT NOT NULL DEFAULT '',
        attendees      TEXT NOT NULL DEFAULT '',
        next_meeting_date TEXT NOT NULL DEFAULT '',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      )
    `);

    // excom_predefined_tasks — reusable meeting agenda templates
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS excom_predefined_tasks (
        id               SERIAL PRIMARY KEY,
        title            TEXT NOT NULL,
        description      TEXT NOT NULL DEFAULT '',
        category         TEXT NOT NULL DEFAULT 'Performance',
        outcome_template TEXT NOT NULL DEFAULT '',
        frequency        TEXT NOT NULL DEFAULT 'Monthly',
        is_active        INTEGER NOT NULL DEFAULT 1,
        created_at       TEXT NOT NULL,
        UNIQUE (title)
      )
    `);

    const predefinedTasks: [string, string, string, string, string][] = [
      // title, description, category, outcome_template, frequency
      ["Review agent performance",
       "Score each AIOS agent on output quality, task completion, and initiative. Rank from best to worst.",
       "Performance",
       "Top performer: __. Average performers: __. On chopping list: __. Recommended action: __.",
       "Monthly"],
      ["Pipeline review",
       "Walk every open BD deal: probability, blockers, next action, and close-date confidence.",
       "Sales",
       "Total pipeline: €__. Deals advancing: __. Deals at risk: __. Actions: __.",
       "Weekly"],
      ["Cash & AR review",
       "Overdue invoices, cash runway, and any outstanding collection issues.",
       "Finance",
       "Cash: €__. Overdue >30d: €__. Escalations: __. Decisions: __.",
       "Weekly"],
      ["Hiring decisions",
       "Review candidates in final stages (Case / LM / Offer). Make hire/no-hire calls.",
       "Hiring",
       "Offers extended: __. Rejections: __. Pipeline gaps: __.",
       "Triggered"],
      ["OKR health check",
       "Review each agent's key results: on-track vs lagging. Identify blockers.",
       "Strategy",
       "On-track OKRs: __. Lagging: __. Blockers removed: __. Re-prioritised: __.",
       "Monthly"],
      ["Pricing strategy",
       "Review recent win/loss rates by region and adjust pricing benchmarks if needed.",
       "Strategy",
       "Win rate this month: __%. Avg Net/wk: €__. Benchmark updates: __.",
       "Monthly"],
      ["Capacity & headcount plan",
       "Active projects vs pipeline demand. Risk of being over/under-capacity in 45 days.",
       "Operations",
       "Current capacity: __ FTEs. Demand forecast: __. Hiring urgency: __.",
       "Monthly"],
      ["Risk register",
       "Identify any operational, financial, or reputational risks that emerged since last EXCOM.",
       "Risk",
       "New risks: __. Mitigations agreed: __. Owner: __. Deadline: __.",
       "Monthly"],
      ["Strategic initiatives review",
       "Status of any cross-functional projects (new service lines, partnerships, tool rollouts).",
       "Strategy",
       "Active initiatives: __. Progress: __. Blockers: __. Next milestones: __.",
       "Monthly"],
      ["Any Other Business",
       "Open floor for urgent topics not covered by the standing agenda.",
       "General",
       "Topics raised: __. Decisions: __. Follow-ups: __.",
       "Weekly"],
    ];

    for (const [title, description, category, outcome_template, frequency] of predefinedTasks) {
      await db.execute(sql`
        INSERT INTO excom_predefined_tasks
          (title, description, category, outcome_template, frequency, is_active, created_at)
        VALUES
          (${title}, ${description}, ${category}, ${outcome_template}, ${frequency}, 1, ${_now4})
        ON CONFLICT (title) DO NOTHING
      `);
    }
  }

  // ── RACI Matrix ────────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS raci_matrix (
      id           SERIAL PRIMARY KEY,
      responsibility TEXT NOT NULL,
      accountable  TEXT NOT NULL DEFAULT '',
      responsible  TEXT NOT NULL DEFAULT '',
      consulted    TEXT NOT NULL DEFAULT '',
      informed     TEXT NOT NULL DEFAULT '',
      app_section  TEXT NOT NULL DEFAULT '',
      approval     TEXT NOT NULL DEFAULT '',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    )
  `);
  // Add app_section + approval columns if upgrading from an older schema
  await db.execute(sql`ALTER TABLE raci_matrix ADD COLUMN IF NOT EXISTS app_section TEXT NOT NULL DEFAULT ''`);
  await db.execute(sql`ALTER TABLE raci_matrix ADD COLUMN IF NOT EXISTS approval TEXT NOT NULL DEFAULT ''`);

  const raciCount = await db.execute(sql`SELECT COUNT(*) AS c FROM raci_matrix`);
  if (Number((raciCount.rows[0] as any).c) === 0) {
    const _now5 = new Date().toISOString();
    const RACI_SEED = [
      { responsibility: "Daily CEO review",    accountable: "CEO",      responsible: "CEO",      consulted: "COO, CFO, CHRO, CMO", informed: "Livio",          app_section: "Exec",        approval: "Livio" },
      { responsibility: "Pipeline forecast",   accountable: "SVP Sales",responsible: "SVP Sales",consulted: "CFO, CHRO",           informed: "CEO",            app_section: "BD / Proposals", approval: "CEO" },
      { responsibility: "Hiring forecast",     accountable: "CHRO",     responsible: "CHRO",     consulted: "SVP Sales, COO, CFO", informed: "CEO / Livio",    app_section: "HR / Pipeline",  approval: "Livio" },
      { responsibility: "Payment reminders",   accountable: "CFO",      responsible: "CFO",      consulted: "CEO if sensitive",    informed: "Livio if escalated", app_section: "AR",      approval: "CFO / Livio" },
      { responsibility: "Content creation",    accountable: "CMO",      responsible: "CMO",      consulted: "CKO",                 informed: "CEO",            app_section: "Media / KM",     approval: "Livio (publish)" },
      { responsibility: "Proposal generation", accountable: "SVP Sales",responsible: "SVP Sales",consulted: "CFO, CKO",           informed: "CEO",            app_section: "Proposals",       approval: "Livio (final send)" },
      { responsibility: "Agent training",      accountable: "CHRO",     responsible: "CHRO",     consulted: "Boss agents",         informed: "CEO",            app_section: "HR / L&D",       approval: "CHRO" },
      { responsibility: "Conflict resolution", accountable: "CEO",      responsible: "CEO",      consulted: "COO, affected agents",informed: "Livio",          app_section: "Logs",           approval: "Livio if unresolved" },
      { responsibility: "Agent OKR review",    accountable: "CEO",      responsible: "CEO",      consulted: "All agents",          informed: "Livio",          app_section: "Exec / OKRs",    approval: "Livio" },
      { responsibility: "Pricing decisions",   accountable: "CFO",      responsible: "Pricing Agent", consulted: "SVP Sales, CEO", informed: "Livio",          app_section: "Pricing",        approval: "Livio (final)" },
    ];
    for (const row of RACI_SEED) {
      const { responsibility, accountable, responsible, consulted, informed, app_section, approval } = row;
      await db.execute(sql`
        INSERT INTO raci_matrix (responsibility, accountable, responsible, consulted, informed, app_section, approval, created_at, updated_at)
        VALUES (${responsibility}, ${accountable}, ${responsible}, ${consulted}, ${informed}, ${app_section}, ${approval}, ${_now5}, ${_now5})
        ON CONFLICT DO NOTHING
      `);
    }
  }

  // ── AIOS Cycle tables — always run (idempotent IF NOT EXISTS clauses).
  // Previously wedged inside the `raciCount === 0` block above, which meant
  // every new schema change was silently skipped on second-and-later boots
  // (e.g. the structured agent-spec columns added in the spec-applier
  // below). Now lifted out so additions always reach existing databases.
  {
    await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS role_title TEXT`);
    await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS job_description TEXT`);
    await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS function_area TEXT`);
    // Employee retirement columns
    await db.execute(sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`);
    await db.execute(sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS retired_at TEXT`);
    // Structured spec arrays (sourced from server/agentSpecsData.ts).
    // jsonb arrays so the UI / other agents can iterate them directly
    // without parsing the long-form JD blob. Idempotent — only added.
    await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS deliverables JSONB`);
    await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS skills JSONB`);
    await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS knowledge JSONB`);
    await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS training JSONB`);
    await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS templates JSONB`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS aios_cycles (
        id SERIAL PRIMARY KEY,
        cycle_date TEXT NOT NULL,
        cycle_type TEXT NOT NULL DEFAULT 'daily',
        status TEXT NOT NULL DEFAULT 'not_started',
        started_at TEXT,
        completed_at TEXT,
        started_by TEXT NOT NULL DEFAULT 'President',
        summary TEXT,
        cowork_prompt TEXT,
        cowork_output_raw TEXT,
        agents_processed INTEGER NOT NULL DEFAULT 0,
        sections_analyzed INTEGER NOT NULL DEFAULT 0,
        insights_count INTEGER NOT NULL DEFAULT 0,
        ideas_count INTEGER NOT NULL DEFAULT 0,
        actions_count INTEGER NOT NULL DEFAULT 0,
        cowork_requests_count INTEGER NOT NULL DEFAULT 0,
        conflicts_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS aios_exec_logs (
        id SERIAL PRIMARY KEY,
        cycle_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        actor_type TEXT NOT NULL DEFAULT 'system',
        actor_name TEXT,
        action_type TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'working',
        severity TEXT NOT NULL DEFAULT 'info',
        metadata JSONB,
        created_at TEXT NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS aios_deliverables (
        id SERIAL PRIMARY KEY,
        cycle_id INTEGER NOT NULL,
        agent_id INTEGER NOT NULL,
        agent_name TEXT,
        deliverable_type TEXT NOT NULL,
        rank INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        description TEXT,
        source_app_section TEXT,
        okr_link TEXT,
        okr_relevance_score INTEGER,
        business_impact_score INTEGER,
        urgency_score INTEGER,
        confidence_score INTEGER,
        feasibility_score INTEGER,
        total_score INTEGER,
        scoring_rationale TEXT,
        decision_right_level TEXT DEFAULT 'autonomous',
        deadline TEXT,
        status TEXT NOT NULL DEFAULT 'proposed',
        request_type TEXT,
        research_topic TEXT,
        business_question TEXT,
        expected_output TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS boss_consolidations (
        id SERIAL PRIMARY KEY,
        cycle_id INTEGER NOT NULL,
        boss_agent_id INTEGER NOT NULL,
        boss_agent_name TEXT,
        direct_reports_included JSONB DEFAULT '[]',
        top_insights JSONB DEFAULT '[]',
        top_ideas JSONB DEFAULT '[]',
        top_actions JSONB DEFAULT '[]',
        top_cowork_requests JSONB DEFAULT '[]',
        conflicts JSONB DEFAULT '[]',
        boss_summary TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ceo_briefs (
        id SERIAL PRIMARY KEY,
        cycle_id INTEGER NOT NULL,
        executive_summary TEXT,
        top_insights JSONB DEFAULT '[]',
        top_ideas JSONB DEFAULT '[]',
        top_actions JSONB DEFAULT '[]',
        top_cowork_requests JSONB DEFAULT '[]',
        conflicts JSONB DEFAULT '[]',
        decisions_required JSONB DEFAULT '[]',
        autonomous_actions JSONB DEFAULT '[]',
        coo_proposals JSONB DEFAULT '[]',
        cowork_prompt TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cowork_outputs (
        id SERIAL PRIMARY KEY,
        cycle_id INTEGER NOT NULL,
        raw_output_text TEXT NOT NULL,
        pasted_by TEXT NOT NULL DEFAULT 'President',
        pasted_at TEXT NOT NULL,
        parsed_status TEXT NOT NULL DEFAULT 'not_parsed',
        created_at TEXT NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cowork_letters (
        id SERIAL PRIMARY KEY,
        cycle_id INTEGER NOT NULL,
        agent_id INTEGER,
        agent_name TEXT,
        raw_letter_text TEXT NOT NULL,
        extracted_findings JSONB DEFAULT '[]',
        extracted_recommendations JSONB DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'received',
        created_at TEXT NOT NULL
      )
    `);

  await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_kpis (
        id SERIAL PRIMARY KEY,
        cycle_id INTEGER NOT NULL,
        agent_name TEXT NOT NULL,
        round TEXT NOT NULL DEFAULT 'round1',
        deliverable_count INTEGER NOT NULL DEFAULT 0,
        insight_count INTEGER NOT NULL DEFAULT 0,
        idea_count INTEGER NOT NULL DEFAULT 0,
        action_count INTEGER NOT NULL DEFAULT 0,
        avg_total_score REAL,
        insight_score REAL,
        action_score REAL,
        created_at TEXT NOT NULL
      )
    `);

  // ── Deliverable human feedback ────────────────────────────────────────────────
  await db.execute(sql`ALTER TABLE aios_deliverables ADD COLUMN IF NOT EXISTS human_rating INTEGER`);

  // ── KM agent extensions on agents table ──────────────────────────────────────
  await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_type          TEXT NOT NULL DEFAULT 'aios_classic'`);
  await db.execute(sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS knowledge_base_path TEXT`);

  // ── KM sessions + outputs tables ─────────────────────────────────────────────
  await db.execute(sql`
      CREATE TABLE IF NOT EXISTS km_sessions (
        id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
        user_query    TEXT  NOT NULL,
        router_output JSONB,
        status        TEXT  NOT NULL DEFAULT 'pending',
        final_answer  TEXT,
        total_sources JSONB DEFAULT '[]',
        error         TEXT,
        created_at    TEXT  NOT NULL,
        completed_at  TEXT
      )
    `);
  await db.execute(sql`
      CREATE TABLE IF NOT EXISTS km_outputs (
        id           SERIAL PRIMARY KEY,
        session_id   UUID   NOT NULL REFERENCES km_sessions(id) ON DELETE CASCADE,
        agent_name   TEXT   NOT NULL,
        answer       TEXT,
        sources      JSONB  DEFAULT '[]',
        confidence   TEXT,
        raw_response TEXT,
        created_at   TEXT   NOT NULL
      )
    `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS km_outputs_session_idx ON km_outputs(session_id)`);

  // ── Seed 16 KM agents (idempotent — skip if name already exists) ─────────────
  {
    const kmAgentDefs = [
      { name: "diagnostic-agent",       mission: "Diagnostic & Due Diligence specialist. Methodology, frameworks, commercial DD, and past project references.", agent_type: "km_specialist", knowledge_base_path: "01. By topic/01. Diagnostic & DD/"          },
      { name: "strategy-gtm-agent",     mission: "Strategy & GTM specialist. Strategic planning, marketing, distributor management, and past projects.",         agent_type: "km_specialist", knowledge_base_path: "01. By topic/02. Strategy & Marketing/"        },
      { name: "sfe-agent",              mission: "Sales Force Effectiveness specialist. SFE diagnostic, account planning, forecasting, CRM, coaching, KPIs.",   agent_type: "km_specialist", knowledge_base_path: "01. By topic/03. SFE & Sales Effectiveness/"    },
      { name: "hunting-capdb-agent",    mission: "CAPDB & Hunting specialist. Account plans, segmentation, cross-sell, calibration workshops.",                  agent_type: "km_specialist", knowledge_base_path: "01. By topic/04. CAPDB & Hunting/"              },
      { name: "pricing-agent",          mission: "Pricing specialist. Pricing strategy, GTN, distribution, diagnostics, tenders, past projects.",               agent_type: "km_specialist", knowledge_base_path: "01. By topic/05. Pricing/"                      },
      { name: "incentives-agent",       mission: "Incentives & OKR specialist. Incentive plan design, OKR frameworks, performance mechanics.",                  agent_type: "km_specialist", knowledge_base_path: "01. By topic/06. Incentives/"                    },
      { name: "org-governance-agent",   mission: "Organization & Governance specialist. Org design, RACI, job descriptions, assessment, coaching, comms.",      agent_type: "km_specialist", knowledge_base_path: "01. By topic/07. Organization & Governance/"    },
      { name: "transformation-agent",   mission: "Transformation & Change specialist. Change management, PMI, transformation methodology.",                     agent_type: "km_specialist", knowledge_base_path: "01. By topic/08. Transformation & Change/"        },
      { name: "digital-ai-agent",       mission: "Digital & AI specialist. AI strategy, digital strategy, advanced analytics, multichannel, past projects.",    agent_type: "km_specialist", knowledge_base_path: "01. By topic/09. AI Digital Analytics/"          },
      { name: "war-room-agent",         mission: "War Room specialist. War room methodology, execution discipline, past project references.",                    agent_type: "km_specialist", knowledge_base_path: "01. By topic/10. War rooms/"                      },
      { name: "operations-agent",       mission: "Operations specialist. Operational processes and operational excellence frameworks.",                          agent_type: "km_specialist", knowledge_base_path: "01. By topic/11. Operations/"                     },
      { name: "pmo-agent",              mission: "PMO & Action Plans specialist. PMO templates, action plans, email templates, project management.",            agent_type: "km_specialist", knowledge_base_path: "01. By topic/12. PMO & Action plans/"              },
      { name: "project-closeout-agent", mission: "Project Closeout specialist. Closeout methodology, end-of-project action plans, lessons learned.",           agent_type: "km_specialist", knowledge_base_path: "01. By topic/13. Project closeout/"              },
      { name: "comex-playbooks-agent",  mission: "COMEX Playbooks specialist. General playbooks and engagement-specific playbooks (Sandoz, Syngenta, PIF).",   agent_type: "km_specialist", knowledge_base_path: "01. By topic/14. Comex playbooks/"              },
      { name: "misc-agent",             mission: "Miscellaneous KM specialist. Catch-all for topics not covered by dedicated specialist agents.",              agent_type: "km_specialist", knowledge_base_path: "01. By topic/15. Misc/"                           },
      { name: "km-router-agent",        mission: "KM Router. Receives any user question and routes to the 1-3 most relevant KM specialist agents.",           agent_type: "km_router",     knowledge_base_path: null                                              },
    ] as const;
    const now = new Date().toISOString();
    for (const def of kmAgentDefs) {
      const existing = await db.execute(sql`SELECT 1 FROM agents WHERE name = ${def.name} LIMIT 1`);
      if ((existing as any).rows?.length === 0) {
        await db.execute(sql`
            INSERT INTO agents (name, mission, status, agent_type, knowledge_base_path, created_at, updated_at)
            VALUES (${def.name}, ${def.mission}, 'active', ${def.agent_type}, ${def.knowledge_base_path ?? null}, ${now}, ${now})
          `);
        console.log(`[seed] KM agent inserted: ${def.name}`);
      }
    }
  }

  // ── Seed job descriptions for known agents (idempotent — only sets when NULL) ──
  type AgentJd = { name_fragment: string; role_title: string; function_area: string; jd: string };
  const agentJDs: AgentJd[] = [
    {
      name_fragment: "CEO",
      role_title: "Chief Executive Officer",
      function_area: "Executive Leadership",
      jd: `## Role: CEO Agent
### Mission
Lead the Eendigo AI organization. Consolidate all agent outputs, identify company-level priorities, make cross-functional decisions, and generate the daily CoWork prompt for the President.

### Mandatory daily activities
1. Receive and consolidate all boss reports.
2. Identify top 5 company-level insights, ideas, actions, and CoWork requests.
3. Detect conflicts across functions and recommend resolution.
4. Generate the daily CoWork prompt (comprehensive, structured, copyable).
5. Identify decisions requiring President approval.
6. Flag autonomous actions AIOS can execute without human input.

### KPIs
- CoWork prompt quality score (President rating)
- Conflict resolution speed
- OKR progress across all functions
- Decision turnaround time

### Decision rights
- Autonomous: Generate prompts, consolidate reports, flag conflicts, recommend actions
- Boss approval (Livio): Any client-facing output, hiring/firing, strategic partnerships, public positioning

### Escalation rules
- Escalate to Livio: legal risk, reputation risk, pricing changes, client outreach, material autonomy changes`,
    },
    {
      name_fragment: "COO",
      role_title: "Chief Operating Officer",
      function_area: "Operations & AIOS Improvement",
      jd: `## Role: COO Agent
### Mission
Ensure AIOS operates efficiently. Identify bottlenecks, missing agents, unclear RACI, duplicated responsibilities, and propose concrete improvements to the operating system every cycle.

### Mandatory daily activities
1. Review AIOS cycle health: missing job descriptions, empty knowledge bases, unassigned sections.
2. Review open tasks across all agents for blockers and overdue items.
3. Identify recurring manual work that should be automated.
4. Propose up to 3 self-improvement initiatives per cycle (new agents, workflow changes, RACI updates, app changes).
5. Flag agents that are underperforming or have unclear mandates.

### KPIs
- Number of AIOS self-improvement proposals accepted per month
- Percentage of agents with complete job descriptions
- Percentage of app sections covered by the section map
- Cycle completion time

### Decision rights
- Autonomous: Flag issues, propose improvements, generate COO proposals
- CEO approval: New agent creation, agent retirement, RACI modifications, major workflow changes
- Livio approval: App architecture changes, new module development

### Escalation rules
- Escalate to CEO: Cross-functional conflicts, resource allocation disputes
- Escalate to Livio: Budget implications, strategic direction changes`,
    },
    {
      name_fragment: "CFO",
      role_title: "Chief Financial Officer",
      function_area: "Finance & Cash Management",
      jd: `## Role: CFO Agent
### Mission
Protect Eendigo's financial health. Monitor AR ageing, cash position, margin by project, and ensure pricing discipline. Generate alerts and recommended actions every cycle.

### Mandatory daily activities
1. Review accounts receivable and flag overdue invoices (>30 days).
2. Compute probability-weighted pipeline revenue.
3. Check margin by active project and flag below-threshold projects.
4. Monitor discount exceptions and flag pricing discipline breaches.
5. Generate cash risk alert if AR > 60 days total exceeds threshold.

### KPIs
- AR ageing (days sales outstanding)
- EBITDA margin per project
- Cash collection rate
- Pricing discipline score (% proposals within corridor)

### Decision rights
- Autonomous: Generate AR alerts, flag pricing breaches, compute pipeline revenue
- Boss approval (CEO): Payment term changes, discount approval
- Livio approval: Write-offs, legal escalation, strategic pricing changes

### Escalation rules
- Escalate to CEO: Any client with >90-day AR, margin below 30%, discount >15%`,
    },
    {
      name_fragment: "BD",
      role_title: "Business Development Agent",
      function_area: "Sales & Business Development",
      jd: `## Role: BD Agent
### Mission
Drive Eendigo's commercial pipeline. Monitor deals, identify stale follow-ups, find new opportunities, and generate targeted outreach recommendations every cycle.

### Mandatory daily activities
1. Review all active BD deals by stage and probability.
2. Flag deals with no activity in the past 14 days (stale follow-ups).
3. Identify probability-weighted pipeline value and expected close dates.
4. Find dormant clients (won ≥12 months ago, no open deal) as reactivation opportunities.
5. Generate 3 CoWork research requests for new PE/sector contacts.

### KPIs
- Probability-weighted pipeline (€)
- Win rate (won / total closed)
- Average deal cycle time
- New prospects identified per month

### Decision rights
- Autonomous: Analyze pipeline, flag stale deals, identify opportunities, generate research requests
- CEO approval: New client outreach strategy, major account prioritization
- Livio approval: Any client-facing communication, official outreach

### Escalation rules
- Escalate to CEO: Competitive threats, client sensitivity issues, pricing negotiations`,
    },
    {
      name_fragment: "Proposal",
      role_title: "Proposal Agent",
      function_area: "Proposal Development",
      jd: `## Role: Proposal Agent
### Mission
Ensure every Eendigo proposal is high quality, competitively priced, and strategically positioned. Track active proposals, identify stale ones, and generate improvement recommendations.

### Mandatory daily activities
1. Review all active proposals and flag those with no update in 14+ days.
2. Check proposal win/loss patterns for current sector/client type.
3. Identify missing follow-up actions on submitted proposals.
4. Review price consistency against pricing corridors.
5. Generate CoWork requests for client/sector research to strengthen proposals.

### KPIs
- Proposal win rate
- Proposal-to-submission cycle time
- Price corridor compliance rate
- Client research completeness score

### Decision rights
- Autonomous: Analyze proposals, generate research requests, flag risks
- CEO approval: Proposal strategy changes, pricing corridor adjustments
- Livio approval: Proposal submission to clients, major pricing changes`,
    },
    {
      name_fragment: "CHRO",
      role_title: "Chief Human Resources Officer",
      function_area: "People & Talent",
      jd: `## Role: CHRO Agent
### Mission
Ensure Eendigo has the right talent available at the right time. Monitor staffing capacity vs. probability-weighted project demand, flag hiring needs, and track associate workload and churn risk.

### Mandatory daily activities
1. Compare probability-weighted project demand vs. available capacity for next 12 weeks.
2. Flag associates at risk of overload (>100% utilization in any 4-week window).
3. Identify skill gaps vs. upcoming project requirements.
4. Track open hiring positions and candidate pipeline.
5. Generate CoWork requests for talent market data and salary benchmarks.

### KPIs
- Utilization rate (target: 70–85%)
- Time-to-hire for open positions
- Associate retention rate
- Skill coverage score

### Decision rights
- Autonomous: Analyze capacity, flag risks, generate research requests
- CEO approval: Opening a new position, changing compensation bands
- Livio approval: Hiring/firing decisions, partnership with recruitment firms`,
    },
  ];

  for (const jd of agentJDs) {
    await db.execute(sql`
      UPDATE agents
      SET
        role_title      = COALESCE(role_title,      ${jd.role_title}),
        function_area   = COALESCE(function_area,   ${jd.function_area}),
        job_description = COALESCE(job_description, ${jd.jd})
      WHERE name ILIKE ${'%' + jd.name_fragment + '%'}
    `);
  }

  // ── CEO Brief Runs (in-app daily brief feature) ──────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ceo_brief_runs (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      generated_by    TEXT NOT NULL,
      raw_brief_markdown   TEXT,
      claude_response_raw  TEXT,
      model           TEXT,
      token_input     INTEGER,
      token_output    INTEGER,
      duration_ms     INTEGER,
      status          TEXT NOT NULL DEFAULT 'success',
      error           TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ceo_brief_run_decisions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      brief_id        UUID NOT NULL REFERENCES ceo_brief_runs(id),
      decision_id     TEXT NOT NULL,
      type            TEXT NOT NULL,
      agent           TEXT NOT NULL,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL,
      okr_link        TEXT,
      deadline        TEXT,
      approval_level  TEXT NOT NULL,
      impact          INTEGER,
      effort          INTEGER,
      risk            INTEGER,
      status          TEXT NOT NULL DEFAULT 'pending',
      status_note     TEXT,
      modified_text   TEXT,
      postpone_until  TEXT,
      decided_at      TIMESTAMPTZ,
      decided_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // ── template_renders — every micro-AI template render is logged here ─
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS template_renders (
      id             SERIAL PRIMARY KEY,
      agent          TEXT NOT NULL,
      template_slug  TEXT NOT NULL,
      rendered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      slots          JSONB,
      output         TEXT,
      used_in        TEXT
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS template_renders_agent_idx ON template_renders (agent, rendered_at DESC)`);

  // ── Apply structured agent specs from agentSpecsData.ts ──────────────
  // Match by exact name (cards.json was authored to match agents.name 1:1).
  // For each spec we:
  //   - Fill `mission` with the subtitle (one-line tagline) when blank
  //   - OVERWRITE deliverables / skills / knowledge / training (these are
  //     authored as the source of truth — the spec doc is the spec)
  //   - Build decision_rights_autonomous / _livio from the bracketed
  //     responsibilities ([AUTONOMOUS] vs [HUMAN-APPROVED])
  //   - OVERWRITE job_description with a comprehensive Markdown JD
  //     compiled from every section (mission + responsibilities +
  //     deliverables + OKRs + skills + knowledge + training). Old
  //     hand-written JDs from agentJDs above are intentionally replaced —
  //     the spec doc is now the authority.
  //   - Insert each OKR's objective + key results into the AIOS objectives
  //     and key_results tables, deduped by (agent_id, title).
  for (const spec of AGENT_SPECS) {
    const auto = spec.responsibilities.filter(r => r.includes("[AUTONOMOUS]")).map(r => r.replace(/\[AUTONOMOUS\]\s*/, "")).join("\n");
    const livio = spec.responsibilities.filter(r => r.includes("[HUMAN-APPROVED]")).map(r => r.replace(/\[HUMAN-APPROVED\]\s*/, "")).join("\n");
    const jd = [
      `## ${spec.name}`,
      `*${spec.subtitle}*`,
      ``,
      `### Mission`,
      spec.role,
      ``,
      `### Responsibilities`,
      ...spec.responsibilities.map(r => `- ${r}`),
      ``,
      `### Deliverables`,
      ...spec.deliverables.map(d => `- ${d}`),
      ``,
      `### OKRs`,
      ...spec.okrs.flatMap(o => [`**${o.objective}**`, ...o.krs.map(k => `- ${k}`), ``]),
      `### Required Skills`,
      ...spec.skills.map(s => `- ${s}`),
      ``,
      `### Required Knowledge`,
      ...spec.knowledge.map(k => `- ${k}`),
      ``,
      `### Training Curriculum`,
      ...spec.training.map(t => `- ${t}`),
    ].join("\n");

    await db.execute(sql`
      UPDATE agents
      SET
        mission                      = COALESCE(mission, ${spec.subtitle}),
        deliverables                 = ${JSON.stringify(spec.deliverables)}::jsonb,
        skills                       = ${JSON.stringify(spec.skills)}::jsonb,
        knowledge                    = ${JSON.stringify(spec.knowledge)}::jsonb,
        training                     = ${JSON.stringify(spec.training)}::jsonb,
        templates                    = ${JSON.stringify(spec.templates ?? [])}::jsonb,
        decision_rights_autonomous   = ${auto},
        decision_rights_livio        = ${livio},
        skill_gaps                   = ${spec.skills.join("\n")},
        training_plan                = ${spec.training.join("\n")},
        job_description              = ${jd},
        updated_at                   = ${new Date().toISOString()}
      WHERE name = ${spec.name}
    `);

    // Seed objectives + key_results, deduped by (agent_id, title).
    const agentRow = await db.execute(sql`SELECT id FROM agents WHERE name = ${spec.name} LIMIT 1`);
    const rows = (agentRow as any).rows ?? agentRow;
    const agentId = rows[0]?.id;
    if (!agentId) continue;
    for (const okr of spec.okrs) {
      const existing = await db.execute(sql`SELECT id FROM objectives WHERE agent_id = ${agentId} AND title = ${okr.objective} LIMIT 1`);
      const exRows = (existing as any).rows ?? existing;
      let objId: number | undefined = exRows[0]?.id;
      if (!objId) {
        const ins = await db.execute(sql`
          INSERT INTO objectives (agent_id, title, status, created_at)
          VALUES (${agentId}, ${okr.objective}, 'open', ${new Date().toISOString()})
          RETURNING id
        `);
        const insRows = (ins as any).rows ?? ins;
        objId = insRows[0]?.id;
      }
      if (!objId) continue;
      for (const kr of okr.krs) {
        await db.execute(sql`
          INSERT INTO key_results (objective_id, title, created_at)
          SELECT ${objId}, ${kr}, ${new Date().toISOString()}
          WHERE NOT EXISTS (
            SELECT 1 FROM key_results WHERE objective_id = ${objId} AND title = ${kr}
          )
        `);
      }
    }
  }

  // ── Agent section map seed (idempotent — only inserts if table empty) ─────
  {
    const existing = await db.execute(sql`SELECT COUNT(*) AS c FROM agent_section_map`);
    const count = parseInt((existing as any).rows?.[0]?.c ?? "0", 10);
    if (count === 0) {
      const now = new Date().toISOString();
      type SectionRow = {
        module: string; section: string; subsection: string;
        primary_agent: string; secondary_agents: string; why: string; frequency: string;
      };
      const rows: SectionRow[] = [
        // ── Executive Module ─────────────────────────────────────────────────
        { module: "Executive", section: "Dashboard", subsection: "Company KPIs & Metrics Overview", primary_agent: "CEO", secondary_agents: "COO,CFO", why: "CEO must monitor top-line KPIs daily to steer the company.", frequency: "Daily" },
        { module: "Executive", section: "Dashboard", subsection: "Active Project Revenue & Pipeline", primary_agent: "CEO", secondary_agents: "CFO,BD", why: "Revenue health requires CEO attention daily.", frequency: "Daily" },
        { module: "Executive", section: "OKR Center", subsection: "Company OKR Progress & Key Results", primary_agent: "CEO", secondary_agents: "COO", why: "CEO owns OKR accountability and must review progress.", frequency: "Daily" },
        { module: "Executive", section: "OKR Tree", subsection: "Agent-Level OKR Drill-Down", primary_agent: "COO", secondary_agents: "CEO", why: "COO manages cross-agent OKR alignment.", frequency: "Daily" },
        { module: "Executive", section: "EXCOM", subsection: "EXCOM Meeting Agenda & Decisions", primary_agent: "COO", secondary_agents: "CEO", why: "COO prepares and follows up on EXCOM outcomes.", frequency: "Daily" },
        { module: "Executive", section: "CEO Brief", subsection: "Daily CEO Brief Generation & Quality", primary_agent: "CEO", secondary_agents: "COO", why: "CEO must validate brief accuracy and completeness.", frequency: "Daily" },
        { module: "Executive", section: "Decisions", subsection: "Pending Decisions & Approval Queue", primary_agent: "CEO", secondary_agents: "COO", why: "CEO must clear decision bottlenecks daily.", frequency: "Daily" },
        { module: "Executive", section: "Decision Log", subsection: "Past Decision Audit Trail", primary_agent: "COO", secondary_agents: "CEO", why: "COO tracks decision implementation.", frequency: "Weekly" },
        { module: "Executive", section: "AIOS Cycle", subsection: "Cycle Quality, Coverage & Gaps", primary_agent: "COO", secondary_agents: "CEO", why: "COO owns AIOS system improvement.", frequency: "Daily" },
        { module: "Executive", section: "Section Map", subsection: "Agent-Section Assignment Coverage", primary_agent: "COO", secondary_agents: "", why: "COO ensures every app section has an agent owner.", frequency: "Weekly" },
        { module: "Executive", section: "Org Chart", subsection: "Org Structure & Reporting Lines", primary_agent: "COO", secondary_agents: "CEO,CHRO", why: "COO maintains org design accuracy.", frequency: "Weekly" },
        { module: "Executive", section: "Agent Registry", subsection: "Agent Status, Missions & Job Descriptions", primary_agent: "COO", secondary_agents: "CEO", why: "COO ensures agents are properly configured.", frequency: "Daily" },
        { module: "Executive", section: "Knowledge Base", subsection: "Agent Knowledge Base Coverage & Freshness", primary_agent: "COO", secondary_agents: "", why: "COO ensures KB is up to date for all agents.", frequency: "Weekly" },
        { module: "Executive", section: "Skill Factory", subsection: "Agent Skills & CoWork Capabilities", primary_agent: "COO", secondary_agents: "", why: "COO develops agent capabilities over time.", frequency: "Weekly" },

        // ── People Module ────────────────────────────────────────────────────
        { module: "People", section: "Employees", subsection: "Headcount, Roles & Compensation Overview", primary_agent: "CHRO", secondary_agents: "COO,CFO", why: "CHRO owns people data accuracy and compensation compliance.", frequency: "Daily" },
        { module: "People", section: "Employees", subsection: "Promotion Eligibility & Track Assignments", primary_agent: "CHRO", secondary_agents: "COO", why: "CHRO must surface promotion decisions proactively.", frequency: "Weekly" },
        { module: "People", section: "Role Grid", subsection: "Role Band Calibration & Pay Ranges", primary_agent: "CHRO", secondary_agents: "CFO", why: "CHRO ensures role grid reflects market positioning.", frequency: "Weekly" },
        { module: "People", section: "Staffing Gantt", subsection: "Project Staffing Coverage & Gaps", primary_agent: "COO", secondary_agents: "CHRO,BD", why: "COO ensures delivery capacity matches pipeline.", frequency: "Daily" },
        { module: "People", section: "Days Off", subsection: "Leave Planning & Capacity Impact", primary_agent: "CHRO", secondary_agents: "COO", why: "CHRO monitors leave patterns affecting delivery.", frequency: "Weekly" },
        { module: "People", section: "Time Tracker", subsection: "Billable vs Non-Billable Hours Mix", primary_agent: "CHRO", secondary_agents: "CFO", why: "CHRO tracks utilization and identifies overwork signals.", frequency: "Weekly" },

        // ── Proposals Module ─────────────────────────────────────────────────
        { module: "Proposals", section: "Proposals", subsection: "Open Proposals — Status, Win Probability & Actions", primary_agent: "Proposal", secondary_agents: "BD,CEO", why: "Proposal Agent drives active proposal quality and momentum.", frequency: "Daily" },
        { module: "Proposals", section: "Proposals", subsection: "Won / Lost Outcomes & Lessons Learned", primary_agent: "Proposal", secondary_agents: "BD", why: "Proposal Agent continuously improves win rate from past data.", frequency: "Weekly" },
        { module: "Proposals", section: "Pricing Cases", subsection: "Pricing Waterfall — NET1 to GROSS1 Calibration", primary_agent: "Proposal", secondary_agents: "CFO,BD", why: "Proposal Agent ensures pricing is competitive and margin-safe.", frequency: "Daily" },
        { module: "Proposals", section: "Pricing Cases", subsection: "Benchmark Win Rate by Price Band", primary_agent: "BD", secondary_agents: "Proposal,CEO", why: "BD Agent monitors price acceptance vs. market.", frequency: "Weekly" },
        { module: "Proposals", section: "Knowledge Center", subsection: "Proposal Content Library & Methodology Gaps", primary_agent: "Proposal", secondary_agents: "", why: "Proposal Agent maintains content quality.", frequency: "Weekly" },
        { module: "Proposals", section: "Slide Methodology", subsection: "Slide Logic, Narrative Structure & Template Quality", primary_agent: "Proposal", secondary_agents: "", why: "Proposal Agent owns slide quality standards.", frequency: "Weekly" },

        // ── Hiring Module ────────────────────────────────────────────────────
        { module: "Hiring", section: "Pipeline", subsection: "Candidate Pipeline — Stages & Velocity", primary_agent: "CHRO", secondary_agents: "CEO", why: "CHRO drives hiring velocity and quality.", frequency: "Daily" },
        { module: "Hiring", section: "Candidate Scoring", subsection: "Score Distribution & Assessment Coverage", primary_agent: "CHRO", secondary_agents: "", why: "CHRO ensures objective, consistent candidate assessment.", frequency: "Weekly" },
        { module: "Hiring", section: "Scoreboard", subsection: "Top Candidates & Offer Readiness", primary_agent: "CHRO", secondary_agents: "CEO", why: "CHRO surfaces top candidates for CEO decision.", frequency: "Weekly" },

        // ── Finance Module ───────────────────────────────────────────────────
        { module: "Finance", section: "Invoicing", subsection: "Overdue Invoices & Cash Collection Risk", primary_agent: "CFO", secondary_agents: "BD,CEO", why: "CFO must track cash collection and flag overdue items.", frequency: "Daily" },
        { module: "Finance", section: "Invoicing", subsection: "Revenue Recognition & Monthly Close", primary_agent: "CFO", secondary_agents: "COO", why: "CFO ensures accurate revenue reporting.", frequency: "Weekly" },
        { module: "Finance", section: "Client Ledger", subsection: "Client Revenue, Margin & Payment History", primary_agent: "CFO", secondary_agents: "BD,CEO", why: "CFO monitors client-level P&L health.", frequency: "Weekly" },

        // ── Sales Module ─────────────────────────────────────────────────────
        { module: "Sales", section: "BD Pipeline", subsection: "Lead Volume, Stage Progression & Deal Velocity", primary_agent: "BD", secondary_agents: "CEO,COO", why: "BD Agent manages the full sales funnel.", frequency: "Daily" },
        { module: "Sales", section: "BD Pipeline", subsection: "At-Risk Deals & Required Actions", primary_agent: "BD", secondary_agents: "CEO", why: "BD Agent flags deals requiring CEO intervention.", frequency: "Daily" },
        { module: "Sales", section: "BD Pipeline", subsection: "Win Rate by Service Type & Client Segment", primary_agent: "BD", secondary_agents: "Proposal,CEO", why: "BD Agent calibrates targeting and messaging.", frequency: "Weekly" },
        { module: "Sales", section: "Client Ledger", subsection: "Upsell & Expansion Signals", primary_agent: "BD", secondary_agents: "CFO", why: "BD Agent identifies revenue expansion opportunities.", frequency: "Weekly" },
      ];

      for (const r of rows) {
        await db.execute(sql`
          INSERT INTO agent_section_map (module, section, subsection, primary_agent, secondary_agents, why, frequency, created_at, updated_at)
          VALUES (${r.module}, ${r.section}, ${r.subsection}, ${r.primary_agent}, ${r.secondary_agents}, ${r.why}, ${r.frequency}, ${now}, ${now})
        `);
      }
      console.log(`[seed] Seeded ${rows.length} agent section map entries.`);
    }
  }
  }
}
