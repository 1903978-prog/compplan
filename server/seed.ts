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
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL UNIQUE,
      kind         TEXT NOT NULL DEFAULT 'freelancer',
      created_at   TEXT NOT NULL
    )
  `);
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
  // Revision letter appended to project_name in the UI (A / B / C / D).
  // Lets a case track its proposal revision count without renaming.
  await db.execute(sql`ALTER TABLE pricing_cases ADD COLUMN IF NOT EXISTS revision_letter TEXT DEFAULT 'A'`);

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
        "Outstanding AR <€50k at end of every month",
        "Cash runway visible 12+ weeks at all times",
        "Monthly close packaged for CEO by working day 5",
      ],
      okrs: [
        { objective: "Tight AR", key_results: ["≤10 invoices overdue >30d", "no invoices >90d overdue", "DSO <45 days trailing 90d"] },
        { objective: "Predictable close", key_results: ["Close completed by WD-5 every month", "P&L variance commentary delivered with the close", "0 surprise reclassifications post-close"] },
      ],
      tasks_10d: [],
    },
    {
      role_key: "sales-director", role_name: "Sales Director", parent_role_key: "ceo",
      person_name: null, sort_order: 2, status: "vacant",
      goals: [
        "1+ new signed engagement per month",
        "Pipeline coverage ≥3× quarterly target",
        "Every prospect call → pricing case opened in compplan + tracked in BD pipeline",
      ],
      okrs: [
        { objective: "Steady win cadence", key_results: ["≥1 new Won/month, every month of 2026", "win-rate ≥50% trailing 10 decided deals", "no deal stalled >14d untouched"] },
        { objective: "Disciplined pipeline hygiene", key_results: ["Every BD deal has next-step + owner + due-date", "Lost-to-price <30% of total losses", "Pricing case opened within 24h of every prospect call"] },
      ],
      tasks_10d: [],
    },
    {
      role_key: "marketing-manager", role_name: "Marketing Manager", parent_role_key: "ceo",
      person_name: "Philip Kotler", sort_order: 3, status: "active",
      goals: [
        "12 published thought-leadership pieces in 2026",
        "≥2 inbound qualified leads / month from content+media",
        "1 case study published per Won engagement (within 30d of close)",
      ],
      okrs: [
        { objective: "Build the Eendigo brand voice", key_results: ["1 LinkedIn post/wk consistent for 26 wks", "1 long-form article/month", "1 podcast or media mention/quarter"] },
        { objective: "Convert content into pipeline", key_results: ["≥24 inbound leads/yr from content", "≥2 leads → won in 2026", "Newsletter list 500+ by EOY"] },
      ],
      tasks_10d: [],
    },
    {
      role_key: "pricing-director", role_name: "Pricing Director", parent_role_key: "ceo",
      person_name: null, sort_order: 4, status: "vacant",
      goals: [
        "Every pricing case has 3-timeline commercial proposal + partner-fallback option",
        "Lost-to-price <30% of total losses (tune regional bands, not global discounts)",
        "Win-rate ≥50% on quoted deals trailing 10",
      ],
      okrs: [
        { objective: "Quote discipline", key_results: ["100% of cases use 3 timelines", "100% have partner-fallback computed", "Time from case-saved → proposal-sent ≤24h"] },
        { objective: "Pattern intelligence", key_results: ["Quarterly win/loss read by region+sector+fund delivered to CEO", "Regional multipliers reviewed once/quarter", "Rate card refreshed annually"] },
      ],
      tasks_10d: [],
    },
    {
      role_key: "coo", role_name: "COO — Tech & Operations", parent_role_key: "ceo",
      person_name: null, sort_order: 5, status: "active",
      goals: [
        "Compplan app stays solid: every page loads, no 5xx, no broken flows",
        "AI agents and skills evolve continuously — propose improvements weekly",
        "All agent-requested code changes flow through Claude Code with co-CEO approval",
        "Infrastructure (Render, Neon, GitHub) remains within healthy limits",
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
        "Every ongoing project has a weekly report by EOD Monday",
        "Project health visibility: green/amber/red status across the portfolio",
        "Surface risks 4+ weeks before end_date so CEO can act",
      ],
      okrs: [
        { objective: "On-time, on-scope delivery", key_results: ["100% projects deliver by their end_date", "≥80% projects close green", "0 surprise overruns >20% of budget"] },
        { objective: "Health visibility", key_results: ["Weekly status logged for every active project", "Amber/red flagged with mitigation plan within 48h", "Quarterly review: top 3 delivery learnings published internally"] },
      ],
      tasks_10d: [],
    },
    {
      role_key: "hiring-manager", role_name: "Hiring Manager", parent_role_key: "ceo",
      person_name: "Adrian", sort_order: 6, status: "active",
      goals: [
        "Maintain ≥10 active candidates across stages at all times",
        "Top scorers (weighted ≥70) reach final-round in <14 days",
        "Bench supports 4 concurrent engagements (Senior + Associate + BA mix)",
      ],
      okrs: [
        { objective: "Steady pipeline depth", key_results: ["≥10 active candidates always", "≥3 weighted-≥80 candidates in any 30d window", "0 stage with 0 movement >14d"] },
        { objective: "Right-mix bench", key_results: ["≥2 Seniors hireable on 4-week notice", "≥3 Associates available for new project", "≥2 BAs onboarding-ready"] },
      ],
      tasks_10d: [
        { id: "hm-1", title: "Review pipeline; surface top 3 scorers to CEO", due_date: _addDays(1), status: "todo" },
        { id: "hm-2", title: "Schedule final-round for any candidate ≥75 weighted", due_date: _addDays(4), status: "todo" },
        { id: "hm-3", title: "Draft JDs for 2 Partner profiles (per CEO)", due_date: _addDays(7), status: "todo" },
      ],
    },
  ];
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
  }

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
