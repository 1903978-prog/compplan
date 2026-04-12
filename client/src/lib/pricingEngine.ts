// Pure calculation engine — no React imports

export interface PricingRole {
  id: string;
  role_name: string;
  default_daily_rate: number;
  active: boolean;
  sort_order: number;
}

export interface PricingRegion {
  id: string;
  region_name: string;
  multiplier: number;
  is_baseline: boolean;
}

export interface OwnershipMultiplier {
  value: string;
  label: string;
  multiplier: number;
  is_baseline: boolean;
}

export interface RevenueBandMultiplier {
  value: string;
  label: string;
  multiplier: number;
  is_baseline: boolean;
}

export interface SensitivityMultiplier {
  value: string;
  label: string;
  multiplier: number;
}

export interface PricingDiscount {
  id: string;
  name: string;
  default_pct: number;
  active: boolean;
}

export interface StaffCostEntry {
  role_id: string;
  role_name: string;
  daily_cost: number;
}

export interface RateMatrixCell {
  min_weekly: number;
  max_weekly: number;
  note: string;
  avoid: boolean;
}

export interface RateMatrixRow {
  client_type: string;
  rates: Record<string, RateMatrixCell>;
}

export interface FloorRule {
  min_weekly: number;
  description: string;
}

export interface CompetitorTierRates {
  Italy:  { min_weekly: number; max_weekly: number };
  France: { min_weekly: number; max_weekly: number };
  UK:     { min_weekly: number; max_weekly: number };
  DACH:   { min_weekly: number; max_weekly: number };
  US:     { min_weekly: number; max_weekly: number };
}

export interface CompetitorBenchmark {
  tier: string;
  label: string;
  color: string;
  rates: CompetitorTierRates;
  sources: string[];
}

export interface CountryBenchmarkRow {
  country: string;
  parameter: string;
  yellow_low: number;      // below this = red (low side)
  green_low: number;       // green band start
  green_high: number;      // green band end
  yellow_high: number;     // above this = red (high side)
  decisiveness_pct: number; // % of deals where price was decisive
}

export interface PricingSettings {
  roles: PricingRole[];
  regions: PricingRegion[];
  ownership_multipliers: OwnershipMultiplier[];
  revenue_band_multipliers: RevenueBandMultiplier[];
  sensitivity_multipliers: SensitivityMultiplier[];
  funds: string[];
  discounts: PricingDiscount[];
  staff_costs: StaffCostEntry[];
  rate_matrix: RateMatrixRow[];
  floor_rule?: FloorRule; // deprecated — kept optional for backward compat
  country_benchmarks?: CountryBenchmarkRow[];
  bracket_low_pct: number;
  bracket_high_pct: number;
  aggressive_threshold_pct: number;
  conservative_threshold_pct: number;
  min_comparables: number;
  fund_anchor_weight: number;
  win_loss_weight: number;
  competitor_benchmarks: CompetitorBenchmark[];
  project_types?: string[];
}

export interface StaffingLine {
  role_id: string;
  role_name: string;
  resource_label?: string | null;
  days_per_week: number;
  daily_rate_used: number;
  count: number;
}

// ── New types for upgraded engine ─────────────────────────────────────────────

export type ProjectType = "spark" | "sfe" | "pricing" | "other_design" | "war_room" | "diagnostic" | "implementation" | "transformation";
export const DEFAULT_PROJECT_TYPES = ["spark", "SFE", "pricing", "other design", "war room"];
export type CompetitiveIntensity = "sole_source" | "limited" | "competitive" | "crowded";
export type CompetitorType = "none" | "boutiques" | "tier2" | "mbb";
export type OwnershipType = "pe" | "corporate" | "founder";
export type StrategicIntent = "enter" | "expand" | "harvest";
export type ProcurementInvolvement = "none" | "light" | "heavy";

export const SECTORS = [
  "Industrial / Manufacturing",
  "Pharma / Healthcare",
  "Software / SaaS",
  "Consumer / Retail",
  "Energy / Utilities",
  "Business Services",
  "Financial Services",
  "Other",
] as const;
export type Sector = typeof SECTORS[number];

export interface LayerTrace {
  layer: string;
  label: string;
  value: number;
  delta_pct: number;
  note: string;
}

export interface PricingCaseInput {
  // Existing fields
  region: string;
  pe_owned: boolean;
  revenue_band: string;
  price_sensitivity: string;
  duration_weeks: number;
  fund_name?: string | null;
  staffing: StaffingLine[];

  // New fields (optional for backward compat)
  project_type?: ProjectType | null;
  sector?: string | null;
  ebitda_margin_pct?: number | null;       // e.g. 15 for 15%
  commercial_maturity?: number | null;     // 1–5
  urgency?: number | null;                 // 1–5
  competitive_intensity?: CompetitiveIntensity | null;
  competitor_type?: CompetitorType | null;
  ownership_type?: OwnershipType | null;
  strategic_intent?: StrategicIntent | null;
  procurement_involvement?: ProcurementInvolvement | null;
}

export interface PricingProposal {
  id?: number;
  proposal_date: string;
  project_name: string;
  client_name?: string | null;
  fund_name?: string | null;
  region: string;
  country?: string | null;
  pe_owned: boolean;
  revenue_band: string;
  price_sensitivity?: string | null;
  duration_weeks?: number | null;
  weekly_price: number;
  total_fee?: number | null;
  outcome: string;
  loss_reason?: string | null;
  sector?: string | null;
  project_type?: string | null;
  currency?: string | null;
  company_revenue_m?: number | null;
  ebitda_margin_pct?: number | null;
  expected_ebitda_growth_pct?: number | null;
  team_size?: number | null;
  notes?: string | null;
  attachment_url?: string | null;
  created_at?: string;
}

export interface PricingRecommendation {
  // Existing fields (preserved for backward compat)
  base_weekly: number;
  geo_multiplier: number;
  geo_adjusted: number;
  ownership_multiplier: number;
  ownership_adjusted: number;
  size_multiplier: number;
  size_adjusted: number;
  sensitivity_multiplier: number;
  sensitivity_adjusted: number;
  fund_proposals_count: number;
  fund_avg_weekly: number | null;
  fund_recent_weekly: number | null;
  fund_min_weekly: number | null;
  fund_max_weekly: number | null;
  fund_win_rate: number | null;
  history_anchor: number | null;
  history_adjustment_pct: number | null;
  comparable_wins: PricingProposal[];
  comparable_losses: PricingProposal[];
  comparable_avg_win_weekly: number | null;
  comparable_avg_loss_weekly: number | null;
  low_weekly: number;
  target_weekly: number;
  high_weekly: number;
  low_total: number;
  target_total: number;
  high_total: number;
  // Cost-based low and market-based high
  delivery_cost_weekly: number;       // raw staff cost (before overhead/margin)
  low_50gm_weekly: number;            // price at exactly 50% GM on team+overhead costs
  high_market_weekly: number | null;  // highest won price in same region+fund/client context
  high_market_context: string | null; // description of what data was used for high end
  posture: "Defensive" | "Balanced" | "Assertive";
  confidence: number;
  confidence_label: "Low" | "Medium" | "High";
  drivers: string[];
  warnings: string[];
  advisory: string;

  // New fields from upgraded engine
  value_anchor_weekly: number | null;
  cost_floor_weekly: number;
  ebitda_uplift: number | null;
  ebitda_improvement_pct: number | null;
  win_probability: number | null;
  expected_margin_pct: number | null;
  ev_optimized_weekly: number | null;
  layer_trace: LayerTrace[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const REVENUE_BANDS = [
  { value: "below_100m", label: "Below €100M" },
  { value: "100m_200m", label: "€100M – €200M" },
  { value: "200m_1b", label: "€200M – €1B" },
  { value: "above_1b", label: "Above €1B" },
];

export const REGIONS = [
  "IT", "FR", "DE", "UK", "US", "Asia", "Middle East",
];

// Revenue midpoints for EBITDA calculation (€M)
const REVENUE_MIDPOINTS: Record<string, number> = {
  below_100m: 50,
  "100m_200m": 150,
  "200m_1b": 500,
  above_1b: 1500,
};

// Sector EBITDA improvement table: [low_maturity_mid_pct, mid_maturity_pct, high_maturity_pct]
// Values represent expected EBITDA improvement points achievable
const EBITDA_IMPROVEMENT_TABLE: Record<string, [number, number, number]> = {
  "Industrial / Manufacturing": [4.5, 3.0, 1.5],
  "Pharma / Healthcare":        [3.5, 2.0, 1.5],
  "Software / SaaS":            [7.5, 4.5, 3.0],
  "Consumer / Retail":          [6.0, 3.5, 2.0],
  "Energy / Utilities":         [4.0, 2.5, 1.5],
  "Business Services":          [7.0, 4.5, 3.0],
  "Financial Services":         [5.0, 3.0, 2.0],
  "Other":                      [4.0, 2.5, 1.5],
};

// Capture rates by project type
const CAPTURE_RATES: Record<string, number> = {
  diagnostic:      0.04,   // 3–5% → use 4%
  implementation:  0.11,   // 8–15% → use 11%
  transformation:  0.20,   // 15–25% → use 20%
};

// Overhead and minimum margin for cost floor
const OVERHEAD_PCT    = 0.15;   // 15% overhead on delivery cost
const MIN_MARGIN_PCT  = 0.25;   // 25% minimum margin above cost+overhead

// Time decay constant for fund history weighting (per month)
const DECAY_LAMBDA = 0.08;

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  roles: [
    { id: "partner",      role_name: "Partner",      default_daily_rate: 7000, active: true, sort_order: 0 },
    { id: "manager_ext",  role_name: "Manager EXT",  default_daily_rate: 2800, active: true, sort_order: 1 },
    { id: "manager_int",  role_name: "Manager INT",  default_daily_rate: 2200, active: true, sort_order: 2 },
    { id: "asc_ext",      role_name: "ASC EXT",      default_daily_rate: 1400, active: true, sort_order: 3 },
    { id: "asc_in",       role_name: "ASC IN",       default_daily_rate: 1200, active: true, sort_order: 4 },
  ],
  regions: [
    { id: "italy",        region_name: "IT",           multiplier: 1.0,  is_baseline: true  },
    { id: "france",       region_name: "FR",           multiplier: 1.10, is_baseline: false },
    { id: "germany",      region_name: "DE",           multiplier: 1.15, is_baseline: false },
    { id: "uk",           region_name: "UK",           multiplier: 1.25, is_baseline: false },
    { id: "us",           region_name: "US",           multiplier: 1.40, is_baseline: false },
    { id: "asia",         region_name: "Asia",         multiplier: 1.05, is_baseline: false },
    { id: "middle_east",  region_name: "Middle East",  multiplier: 1.20, is_baseline: false },
  ],
  ownership_multipliers: [
    { value: "pe",     label: "Private Equity owned", multiplier: 1.0,  is_baseline: true  },
    { value: "non_pe", label: "Non PE-owned",         multiplier: 0.85, is_baseline: false },
  ],
  revenue_band_multipliers: [
    { value: "below_100m", label: "Below €100M",    multiplier: 0.75, is_baseline: false },
    { value: "100m_200m",  label: "€100M – €200M",  multiplier: 0.85, is_baseline: false },
    { value: "200m_1b",    label: "€200M – €1B",    multiplier: 0.92, is_baseline: false },
    { value: "above_1b",   label: "Above €1B",       multiplier: 1.0,  is_baseline: true  },
  ],
  sensitivity_multipliers: [
    { value: "low",    label: "Low sensitivity",    multiplier: 1.10 },
    { value: "medium", label: "Medium sensitivity", multiplier: 1.00 },
    { value: "high",   label: "High sensitivity",   multiplier: 0.90 },
  ],
  funds: ["CARLYLE", "BAIN CAP", "KPS", "ADVENT", "CVC"],
  discounts: [
    { id: "oneoff",          name: "One-off discount",        default_pct: 0, active: true  },
    { id: "prompt_payment",  name: "Prompt payment discount", default_pct: 3, active: true  },
    { id: "rebate",          name: "Rebate",                  default_pct: 2, active: false },
  ],
  staff_costs: [
    { role_id: "partner",     role_name: "Partner",     daily_cost: 0    },
    { role_id: "manager_ext", role_name: "Manager EXT", daily_cost: 1500 },
    { role_id: "manager_int", role_name: "Manager INT", daily_cost: 400  },
    { role_id: "asc_ext",     role_name: "ASC EXT",     daily_cost: 1500 },
    { role_id: "asc_in",      role_name: "ASC IN",      daily_cost: 250  },
    { role_id: "ba",          role_name: "BA",           daily_cost: 150  },
  ],
  rate_matrix: [
    // ── PE clients (3 revenue bands: <€200M, €200M-€1B, >€1B) ──
    {
      client_type: "PE >€1B",
      rates: {
        Italy:  { min_weekly: 30000, max_weekly: 34000, note: "", avoid: false },
        France: { min_weekly: 32000, max_weekly: 36000, note: "", avoid: false },
        UK:     { min_weekly: 36000, max_weekly: 42000, note: "", avoid: false },
        DACH:   { min_weekly: 34000, max_weekly: 40000, note: "", avoid: false },
        US:     { min_weekly: 42000, max_weekly: 50000, note: "", avoid: false },
      },
    },
    {
      client_type: "PE €200M-€1B",
      rates: {
        Italy:  { min_weekly: 26000, max_weekly: 32000, note: "", avoid: false },
        France: { min_weekly: 28000, max_weekly: 34000, note: "", avoid: false },
        UK:     { min_weekly: 32000, max_weekly: 38000, note: "", avoid: false },
        DACH:   { min_weekly: 30000, max_weekly: 36000, note: "", avoid: false },
        US:     { min_weekly: 38000, max_weekly: 46000, note: "", avoid: false },
      },
    },
    {
      client_type: "PE <€200M",
      rates: {
        Italy:  { min_weekly: 20000, max_weekly: 26000, note: "", avoid: false },
        France: { min_weekly: 22000, max_weekly: 28000, note: "", avoid: false },
        UK:     { min_weekly: 26000, max_weekly: 32000, note: "", avoid: false },
        DACH:   { min_weekly: 24000, max_weekly: 30000, note: "", avoid: false },
        US:     { min_weekly: 31000, max_weekly: 39000, note: "", avoid: false },
      },
    },
    // ── Family / Corporate clients (3 revenue bands) ──
    {
      client_type: "Family >€200M",
      rates: {
        Italy:  { min_weekly: 18000, max_weekly: 24000, note: "", avoid: false },
        France: { min_weekly: 20000, max_weekly: 26000, note: "", avoid: false },
        UK:     { min_weekly: 22000, max_weekly: 28000, note: "", avoid: false },
        DACH:   { min_weekly: 20000, max_weekly: 26000, note: "", avoid: false },
        US:     { min_weekly: 0,     max_weekly: 0,     note: "", avoid: true  },
      },
    },
    {
      client_type: "Family €100M-€200M",
      rates: {
        Italy:  { min_weekly: 14000, max_weekly: 20000, note: "", avoid: false },
        France: { min_weekly: 16000, max_weekly: 22000, note: "", avoid: false },
        UK:     { min_weekly: 18000, max_weekly: 24000, note: "", avoid: false },
        DACH:   { min_weekly: 16000, max_weekly: 22000, note: "", avoid: false },
        US:     { min_weekly: 0,     max_weekly: 0,     note: "", avoid: true  },
      },
    },
    {
      client_type: "Family <€100M",
      rates: {
        Italy:  { min_weekly: 10000, max_weekly: 15000, note: "", avoid: false },
        France: { min_weekly: 12000, max_weekly: 16000, note: "", avoid: false },
        UK:     { min_weekly: 0,     max_weekly: 0,     note: "", avoid: true  },
        DACH:   { min_weekly: 0,     max_weekly: 0,     note: "", avoid: true  },
        US:     { min_weekly: 0,     max_weekly: 0,     note: "", avoid: true  },
      },
    },
  ],
  competitor_benchmarks: [
    {
      tier: "tier1",
      label: "Tier 1 (MBB)",
      color: "#7c3aed",
      rates: {
        Italy:  { min_weekly: 80000,  max_weekly: 150000 },
        France: { min_weekly: 90000,  max_weekly: 165000 },
        UK:     { min_weekly: 100000, max_weekly: 185000 },
        DACH:   { min_weekly: 90000,  max_weekly: 165000 },
        US:     { min_weekly: 120000, max_weekly: 220000 },
      },
      sources: ["Source Global Research Annual Survey", "Kennedy Research Consulting Fee Study"],
    },
    {
      tier: "tier2",
      label: "Tier 2 (OW, SKP, Kearney)",
      color: "#2563eb",
      rates: {
        Italy:  { min_weekly: 40000, max_weekly: 85000  },
        France: { min_weekly: 45000, max_weekly: 95000  },
        UK:     { min_weekly: 55000, max_weekly: 115000 },
        DACH:   { min_weekly: 50000, max_weekly: 100000 },
        US:     { min_weekly: 70000, max_weekly: 140000 },
      },
      sources: ["Consultancy.eu Market Report", "ALM Intelligence Management Consulting Fee Survey"],
    },
    {
      tier: "big4",
      label: "Big 4",
      color: "#059669",
      rates: {
        Italy:  { min_weekly: 18000, max_weekly: 42000 },
        France: { min_weekly: 22000, max_weekly: 48000 },
        UK:     { min_weekly: 28000, max_weekly: 58000 },
        DACH:   { min_weekly: 24000, max_weekly: 52000 },
        US:     { min_weekly: 38000, max_weekly: 72000 },
      },
      sources: ["ProcureEx Consulting Procurement Benchmark", "Staffing Industry Analysts Fee Survey"],
    },
  ],
  country_benchmarks: [
    // Italy — Reliability: High
    { country: "Italy",         parameter: "Weekly fee",         yellow_low: 15000,  green_low: 27000,  green_high: 35000,  yellow_high: 39000,  decisiveness_pct: 25 },
    { country: "Italy",         parameter: "Total project cost", yellow_low: 135000, green_low: 200000, green_high: 410000, yellow_high: 705000, decisiveness_pct: 25 },
    // USA — Reliability: Medium (no lower yellow band)
    { country: "United States", parameter: "Weekly fee",         yellow_low: 29000,  green_low: 29000,  green_high: 36000,  yellow_high: 45000,  decisiveness_pct: 45 },
    { country: "United States", parameter: "Total project cost", yellow_low: 98000,  green_low: 98000,  green_high: 145000, yellow_high: 530000, decisiveness_pct: 45 },
    // United Kingdom — Reliability: Medium (no lower yellow band)
    { country: "United Kingdom",parameter: "Weekly fee",         yellow_low: 22000,  green_low: 22000,  green_high: 39000,  yellow_high: 48000,  decisiveness_pct: 30 },
    { country: "United Kingdom",parameter: "Total project cost", yellow_low: 115000, green_low: 115000, green_high: 603000, yellow_high: 669000, decisiveness_pct: 30 },
    // Germany — Reliability: Low (lower yellow only)
    { country: "Germany",       parameter: "Weekly fee",         yellow_low: 19000,  green_low: 27000,  green_high: 35000,  yellow_high: 35000,  decisiveness_pct: 35 },
    { country: "Germany",       parameter: "Total project cost", yellow_low: 20000,  green_low: 288000, green_high: 379000, yellow_high: 379000, decisiveness_pct: 35 },
    // France — Reliability: Low
    { country: "France",        parameter: "Weekly fee",         yellow_low: 30000,  green_low: 32000,  green_high: 33000,  yellow_high: 35000,  decisiveness_pct: 60 },
    { country: "France",        parameter: "Total project cost", yellow_low: 220000, green_low: 220000, green_high: 230000, yellow_high: 260000, decisiveness_pct: 60 },
    // Netherlands — Reliability: Low (no yellow bands)
    { country: "Netherlands",   parameter: "Weekly fee",         yellow_low: 11000,  green_low: 11000,  green_high: 27000,  yellow_high: 27000,  decisiveness_pct: 30 },
    { country: "Netherlands",   parameter: "Total project cost", yellow_low: 85000,  green_low: 85000,  green_high: 538000, yellow_high: 538000, decisiveness_pct: 30 },
    // Switzerland — Reliability: Very low (fallback ±10%)
    { country: "Switzerland",   parameter: "Weekly fee",         yellow_low: 12000,  green_low: 26000,  green_high: 32000,  yellow_high: 35000,  decisiveness_pct: 60 },
    { country: "Switzerland",   parameter: "Total project cost", yellow_low: 149000, green_low: 284000, green_high: 348000, yellow_high: 357000, decisiveness_pct: 60 },
    // Philippines — Reliability: Very low (fallback ±10%, upper yellow only)
    { country: "Philippines",   parameter: "Weekly fee",         yellow_low: 28000,  green_low: 28000,  green_high: 34000,  yellow_high: 37000,  decisiveness_pct: 40 },
    { country: "Philippines",   parameter: "Total project cost", yellow_low: 77000,  green_low: 77000,  green_high: 95000,  yellow_high: 105000, decisiveness_pct: 40 },
    // Saudi Arabia — Very low, no bands (0 = no data)
    { country: "Saudi Arabia",  parameter: "Weekly fee",         yellow_low: 0, green_low: 0, green_high: 0, yellow_high: 0, decisiveness_pct: 55 },
    { country: "Saudi Arabia",  parameter: "Total project cost", yellow_low: 0, green_low: 0, green_high: 0, yellow_high: 0, decisiveness_pct: 55 },
    // Luxembourg — Very low, no won projects, no bands
    { country: "Luxembourg",    parameter: "Weekly fee",         yellow_low: 0, green_low: 0, green_high: 0, yellow_high: 0, decisiveness_pct: 75 },
    { country: "Luxembourg",    parameter: "Total project cost", yellow_low: 0, green_low: 0, green_high: 0, yellow_high: 0, decisiveness_pct: 75 },
    // UAE — Very low, no won projects, no bands
    { country: "UAE",           parameter: "Weekly fee",         yellow_low: 0, green_low: 0, green_high: 0, yellow_high: 0, decisiveness_pct: 70 },
    { country: "UAE",           parameter: "Total project cost", yellow_low: 0, green_low: 0, green_high: 0, yellow_high: 0, decisiveness_pct: 70 },
    // Czech Republic — Very low, no won projects, no bands
    { country: "Czech Republic",parameter: "Weekly fee",         yellow_low: 0, green_low: 0, green_high: 0, yellow_high: 0, decisiveness_pct: 65 },
    { country: "Czech Republic",parameter: "Total project cost", yellow_low: 0, green_low: 0, green_high: 0, yellow_high: 0, decisiveness_pct: 65 },
  ],
  bracket_low_pct: 10,
  bracket_high_pct: 15,
  aggressive_threshold_pct: 20,
  conservative_threshold_pct: 15,
  min_comparables: 3,
  fund_anchor_weight: 0.40,
  win_loss_weight: 0.60,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function roundTo500(value: number): number {
  return Math.round(value / 500) * 500;
}

function formatCurrency(value: number): string {
  return "€" + Math.round(value).toLocaleString("en-US");
}

export function getCurrencyForRegion(region: string): { symbol: string; code: string } {
  if (region === "US") return { symbol: "$", code: "USD" };
  return { symbol: "€", code: "EUR" };
}

export function formatWithCurrency(value: number, region: string): string {
  const { symbol } = getCurrencyForRegion(region);
  return symbol + Math.round(value).toLocaleString("it-IT");
}

function sigmoid(a: number, x: number): number {
  return 1 / (1 + Math.exp(a * x));
}

// ── L1: Cost Floor ────────────────────────────────────────────────────────────

function computeCostFloor(input: PricingCaseInput, settings: PricingSettings): number {
  let delivery_cost_weekly = 0;
  for (const line of input.staffing) {
    const costEntry = settings.staff_costs.find(c => c.role_id === line.role_id);
    const daily_cost = costEntry?.daily_cost ?? 0;
    delivery_cost_weekly += line.days_per_week * daily_cost * line.count;
  }
  // Apply overhead and minimum margin
  const cost_floor = delivery_cost_weekly * (1 + OVERHEAD_PCT) * (1 + MIN_MARGIN_PCT);
  return cost_floor;
}

// ── L2: Market Layer ──────────────────────────────────────────────────────────

function computeMarketAdjustments(input: PricingCaseInput): {
  geo_mult: number;
  competitive_adj: number;
  competitor_adj: number;
  interaction_adj: number;
  market_notes: string[];
} {
  const notes: string[] = [];

  // Geo: returned separately (uses settings), hardcode defaults here for layer trace
  // (actual geo_mult comes from settings in main function)
  const geo_mult = 1.0; // placeholder; overridden in main

  // Competitive intensity adjustment (additive %)
  let competitive_adj = 0;
  switch (input.competitive_intensity) {
    case "sole_source":  competitive_adj = 0.15;  notes.push("Sole source: +15% premium"); break;
    case "limited":      competitive_adj = 0.05;  notes.push("Limited competition: +5%"); break;
    case "competitive":  competitive_adj = 0.0;   break;
    case "crowded":      competitive_adj = -0.15; notes.push("Crowded market: −15%"); break;
  }

  // Competitor type adjustment
  let competitor_adj = 0;
  switch (input.competitor_type) {
    case "boutiques": competitor_adj = -0.05; notes.push("Boutique competition: −5%"); break;
    case "tier2":     competitor_adj = 0.0;   break;
    case "mbb":       competitor_adj = 0.15;  notes.push("MBB present validates premium: +15%"); break;
  }

  // Interaction effects (rule table)
  let interaction_adj = 0;
  const isUS   = input.region === "US";
  const isIT   = input.region === "IT";
  const isME   = input.region === "Middle East";
  const isPE   = input.pe_owned || input.ownership_type === "pe";
  const isBig  = input.revenue_band === "above_1b";
  const isSmall = input.revenue_band === "below_100m";

  if (isUS && isPE && isBig) {
    interaction_adj += 0.10;
    notes.push("US × PE × >€1B premium: +10%");
  }
  if (isME && isPE) {
    interaction_adj += 0.08;
    notes.push("Middle East × PE premium: +8%");
  }
  if (isIT && !isPE && isSmall) {
    interaction_adj -= 0.08;
    notes.push("IT × non-PE × small company: −8%");
  }

  return { geo_mult, competitive_adj, competitor_adj, interaction_adj, market_notes: notes };
}

// ── L3: Client Layer ──────────────────────────────────────────────────────────

function computeClientAdjustments(input: PricingCaseInput): {
  ownership_adj: number;
  maturity_urgency_adj: number;
  procurement_adj: number;
  sensitivity_adj: number;
  client_notes: string[];
} {
  const notes: string[] = [];

  // Ownership type (overrides pe_owned boolean if provided)
  let ownership_adj = 0;
  const owType = input.ownership_type ?? (input.pe_owned ? "pe" : "corporate");
  switch (owType) {
    case "pe":        ownership_adj = 0.0;   break;
    case "corporate": ownership_adj = (input.revenue_band === "above_1b") ? 0.0 : -0.10; break;
    case "founder":   ownership_adj = -0.15; notes.push("Founder-led: −15%"); break;
  }
  if (owType === "corporate" && input.revenue_band !== "above_1b") notes.push("Corporate non-enterprise: −10%");

  // Maturity × urgency interaction
  const mat = input.commercial_maturity ?? 3;
  const urg = input.urgency ?? 3;
  let maturity_urgency_adj = 0;
  if (mat <= 2 && urg >= 4) {
    maturity_urgency_adj = 0.15;
    notes.push("Low maturity + high urgency (need help urgently): +15%");
  } else if (mat <= 2 && urg <= 2) {
    maturity_urgency_adj = 0.05;
    notes.push("Low maturity + low urgency: +5%");
  } else if (mat >= 4 && urg >= 4) {
    maturity_urgency_adj = 0.05;
    notes.push("Sophisticated + urgent client: +5%");
  } else if (mat >= 4 && urg <= 2) {
    maturity_urgency_adj = -0.10;
    notes.push("Sophisticated + non-urgent (price-aware): −10%");
  }

  // Procurement
  let procurement_adj = 0;
  switch (input.procurement_involvement) {
    case "none":  procurement_adj = 0.0;   break;
    case "light": procurement_adj = -0.05; notes.push("Light procurement: −5%"); break;
    case "heavy": procurement_adj = -0.15; notes.push("Heavy procurement: −15%"); break;
  }

  // Sensitivity (asymmetric)
  let sensitivity_adj = 0;
  switch (input.price_sensitivity) {
    case "low":    sensitivity_adj = 0.15;  notes.push("Low price sensitivity: +15%"); break;
    case "medium": sensitivity_adj = 0.0;   break;
    case "high":   sensitivity_adj = -0.25; notes.push("High price sensitivity: −25%"); break;
  }

  return { ownership_adj, maturity_urgency_adj, procurement_adj, sensitivity_adj, client_notes: notes };
}

// ── L4: Historical Intelligence (time-decayed) ────────────────────────────────

function computeHistoricalAnchor(
  input: PricingCaseInput,
  historicalProposals: PricingProposal[],
  settings: PricingSettings,
): {
  fund_proposals_count: number;
  fund_avg_weekly: number | null;
  fund_recent_weekly: number | null;
  fund_min_weekly: number | null;
  fund_max_weekly: number | null;
  fund_win_rate: number | null;
  history_anchor: number | null;
  history_adjustment_pct: number | null;
  comparable_wins: PricingProposal[];
  comparable_losses: PricingProposal[];
  comparable_avg_win_weekly: number | null;
  comparable_avg_loss_weekly: number | null;
} {
  const inputFund = input.fund_name?.trim().toLowerCase() ?? null;
  const today = Date.now();

  // Fund proposals with time-decay weighting
  const fundProposals = inputFund
    ? historicalProposals
        .filter(p => p.fund_name?.trim().toLowerCase() === inputFund)
        .sort((a, b) => new Date(b.proposal_date).getTime() - new Date(a.proposal_date).getTime())
    : [];

  const fund_proposals_count = fundProposals.length;

  // Time-decayed weighted average
  let weightedSum = 0;
  let weightTotal = 0;
  for (const p of fundProposals) {
    const age_months = (today - new Date(p.proposal_date).getTime()) / (1000 * 60 * 60 * 24 * 30);
    const time_weight = Math.exp(-DECAY_LAMBDA * age_months);
    const outcome_weight = p.outcome === "won" ? 1.0 : 0.5;
    const w = time_weight * outcome_weight;
    weightedSum += p.weekly_price * w;
    weightTotal += w;
  }
  const history_anchor = weightTotal > 0 && fund_proposals_count >= 2
    ? weightedSum / weightTotal
    : null;

  const fundPrices = fundProposals.map(p => p.weekly_price);
  const fund_avg_weekly = mean(fundPrices);
  const fund_recent_weekly = mean(fundPrices.slice(0, 3));
  const fund_min_weekly = fundPrices.length > 0 ? Math.min(...fundPrices) : null;
  const fund_max_weekly = fundPrices.length > 0 ? Math.max(...fundPrices) : null;

  const fundWon  = fundProposals.filter(p => p.outcome === "won").length;
  const fundLost = fundProposals.filter(p => p.outcome === "lost").length;
  const fund_win_rate = fundWon + fundLost > 0 ? fundWon / (fundWon + fundLost) : null;

  // Comparables scoring
  const scoredProposals = historicalProposals.map(p => {
    let score = 0;
    if (inputFund && p.fund_name?.trim().toLowerCase() === inputFund) score += 40;
    if (p.region.toLowerCase() === input.region.toLowerCase()) score += 25;
    if (p.pe_owned === input.pe_owned) score += 15;
    if (p.revenue_band === input.revenue_band) score += 20;
    return { proposal: p, score };
  });

  const comparables = scoredProposals
    .filter(s => s.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(s => s.proposal);

  const comparable_wins   = comparables.filter(p => p.outcome === "won");
  const comparable_losses = comparables.filter(p => p.outcome === "lost");
  const comparable_avg_win_weekly  = mean(comparable_wins.map(p => p.weekly_price));
  const comparable_avg_loss_weekly = mean(comparable_losses.map(p => p.weekly_price));

  return {
    fund_proposals_count,
    fund_avg_weekly,
    fund_recent_weekly,
    fund_min_weekly,
    fund_max_weekly,
    fund_win_rate,
    history_anchor,
    history_adjustment_pct: null, // computed later
    comparable_wins,
    comparable_losses,
    comparable_avg_win_weekly,
    comparable_avg_loss_weekly,
  };
}

// ── L6: EV Optimization ───────────────────────────────────────────────────────

function evOptimize(
  base_price: number,
  cost_floor: number,
  reference_price: number | null,
  comparable_wins: PricingProposal[],
  comparable_losses: PricingProposal[],
): {
  ev_price: number;
  win_probability: number;
  expected_margin_pct: number;
} {
  // Reference for sigmoid center: avg win comparable, or provided reference, or base_price
  const ref = reference_price
    ?? (comparable_wins.length > 0 ? mean(comparable_wins.map(p => p.weekly_price))! : base_price);

  // Slope: steeper if we have loss data showing price sensitivity
  // If avg_loss > avg_win (common), price elasticity is clear
  const avg_win  = comparable_wins.length  > 0 ? mean(comparable_wins.map(p => p.weekly_price))!  : null;
  const avg_loss = comparable_losses.length > 0 ? mean(comparable_losses.map(p => p.weekly_price))! : null;
  let a = 0.00004; // default slope (reasonable for €20k–€100k range)
  if (avg_win && avg_loss && avg_loss > avg_win) {
    // Calibrate: P(win_at_avg_win) ≈ 0.65, P(win_at_avg_loss) ≈ 0.35
    // 0.65 = 1/(1+exp(a*(avg_win - ref))) → but we keep it simple
    a = 0.00006;
  }

  // Search grid: from cost_floor to base_price * 1.5, step 500
  const lo = Math.max(cost_floor, base_price * 0.65);
  const hi = base_price * 1.5;
  let best_ev = -Infinity;
  let best_price = base_price;

  for (let price = lo; price <= hi; price += 500) {
    const p_win = sigmoid(a, price - ref);
    const margin = price - cost_floor;
    const ev = p_win * margin;
    if (ev > best_ev) {
      best_ev = ev;
      best_price = price;
    }
  }

  const win_probability = sigmoid(a, best_price - ref);
  const expected_margin_pct = cost_floor > 0
    ? ((best_price - cost_floor) / best_price) * 100
    : 0;

  return { ev_price: roundTo500(best_price), win_probability, expected_margin_pct };
}

// ── Main export ────────────────────────────────────────────────────────────────

export function calculatePricing(
  input: PricingCaseInput,
  settings: PricingSettings,
  historicalProposals: PricingProposal[]
): PricingRecommendation {

  const layer_trace: LayerTrace[] = [];

  // ── L1: Cost Floor ────────────────────────────────────────────────────────
  const cost_floor_weekly = computeCostFloor(input, settings);

  // ── Base staffing rate ────────────────────────────────────────────────────
  const base_weekly = input.staffing.reduce((sum, line) =>
    sum + line.days_per_week * line.daily_rate_used * line.count, 0);

  layer_trace.push({
    layer: "L1",
    label: "Staffing Base",
    value: base_weekly,
    delta_pct: 0,
    note: `Rate-card build-up from ${input.staffing.length} role(s). Cost floor: ${formatCurrency(cost_floor_weekly)}/wk`,
  });

  // ── L0: Value Anchor — REMOVED ───────────────────────────────────────────
  const value_anchor_weekly = null;
  const ebitda_uplift = null;
  const ebitda_improvement_pct = null;
  let working_price = base_weekly;

  // ── Geo multiplier (from settings) ───────────────────────────────────────
  const geoRegion = settings.regions.find(r =>
    r.region_name.toLowerCase() === input.region.toLowerCase()
  );
  const geo_multiplier = geoRegion?.multiplier ?? 1.0;
  const geo_adjusted = base_weekly * geo_multiplier; // keep for backward compat

  layer_trace.push({
    layer: "L2",
    label: `Geography (${input.region})`,
    value: working_price * geo_multiplier,
    delta_pct: (geo_multiplier - 1) * 100,
    note: `Regional multiplier ×${geo_multiplier}`,
  });

  // ── L2: Market adjustments (competitive context) ──────────────────────────
  const { competitive_adj, competitor_adj, interaction_adj, market_notes } = computeMarketAdjustments(input);
  const total_market_adj = competitive_adj + competitor_adj + interaction_adj;
  const after_market = working_price * geo_multiplier * (1 + total_market_adj);

  if (Math.abs(total_market_adj) > 0.001) {
    layer_trace.push({
      layer: "L2",
      label: "Market Context",
      value: after_market,
      delta_pct: total_market_adj * 100,
      note: market_notes.join("; ") || "No market adjustment",
    });
  }

  // ── L3: Client adjustments ────────────────────────────────────────────────
  const { ownership_adj, maturity_urgency_adj, procurement_adj, sensitivity_adj, client_notes } =
    computeClientAdjustments(input);
  const total_client_adj = ownership_adj + maturity_urgency_adj + procurement_adj + sensitivity_adj;
  const after_client = after_market * (1 + total_client_adj);

  // Backward compat multipliers
  const ownershipKey = input.pe_owned ? "pe" : "non_pe";
  const ownershipEntry = settings.ownership_multipliers.find(o => o.value === ownershipKey);
  const ownership_multiplier = ownershipEntry?.multiplier ?? 1.0;
  const ownership_adjusted = geo_adjusted * ownership_multiplier;

  const sizeEntry = settings.revenue_band_multipliers.find(s => s.value === input.revenue_band);
  const size_multiplier = sizeEntry?.multiplier ?? 1.0;
  const size_adjusted = ownership_adjusted * size_multiplier;

  const sensitivityEntry = settings.sensitivity_multipliers.find(s => s.value === input.price_sensitivity);
  const sensitivity_multiplier = sensitivityEntry?.multiplier ?? 1.0;
  const sensitivity_adjusted = size_adjusted * sensitivity_multiplier;

  if (Math.abs(total_client_adj) > 0.001) {
    layer_trace.push({
      layer: "L3",
      label: "Client Profile",
      value: after_client,
      delta_pct: total_client_adj * 100,
      note: client_notes.join("; ") || "Standard client profile",
    });
  }

  // Ensure cost floor
  const after_floor = Math.max(after_client, cost_floor_weekly);
  if (after_floor > after_client) {
    layer_trace.push({
      layer: "L1",
      label: "Cost Floor Applied",
      value: after_floor,
      delta_pct: ((after_floor - after_client) / after_client) * 100,
      note: `Price raised to cost floor ${formatCurrency(cost_floor_weekly)}/wk`,
    });
  }

  // ── L4: Historical Intelligence (informational only — not blended into price) ──
  const histResult = computeHistoricalAnchor(input, historicalProposals, settings);
  const {
    fund_proposals_count, fund_avg_weekly, fund_recent_weekly,
    fund_min_weekly, fund_max_weekly, fund_win_rate,
    history_anchor, comparable_wins, comparable_losses,
    comparable_avg_win_weekly, comparable_avg_loss_weekly,
  } = histResult;

  // L4 data is computed and returned for display in Commercial Analysis,
  // but intentionally NOT applied to the working price.
  const after_history = after_floor;
  const history_adjustment_pct = history_anchor !== null
    ? ((after_floor - history_anchor) / history_anchor) * 100 : null;

  // ── L5: Strategic Intent ─────────────────────────────────────────────────
  let strategic_adj = 0;
  let intent_note = "";
  switch (input.strategic_intent) {
    case "enter":   strategic_adj = -0.15; intent_note = "Enter new client: −15% (beachhead)"; break;
    case "expand":  strategic_adj = 0.0;   intent_note = "Expand existing relationship: neutral"; break;
    case "harvest": strategic_adj = 0.15;  intent_note = "Harvest: +15% (optimise margin)"; break;
  }

  const after_intent = after_history * (1 + strategic_adj);
  if (Math.abs(strategic_adj) > 0.001) {
    layer_trace.push({
      layer: "L5",
      label: "Strategic Intent",
      value: after_intent,
      delta_pct: strategic_adj * 100,
      note: intent_note,
    });
  }

  // ── Final price (L5 result used directly — L6 EV Optimization removed) ──
  const target_weekly = roundTo500(after_intent);

  // Win probability: fraction of comparable proposals won (simple estimate)
  const all_comparables = [...comparable_wins, ...comparable_losses];
  const win_probability = all_comparables.length > 0
    ? comparable_wins.length / all_comparables.length
    : 0.5;
  const expected_margin_pct = cost_floor_weekly > 0 && target_weekly > 0
    ? ((target_weekly - cost_floor_weekly) / target_weekly) * 100
    : 0;

  // Legacy bracket fields (kept for compatibility, no longer shown in main UI)
  const low_weekly  = Math.round((target_weekly * (1 - settings.bracket_low_pct / 100)) / 500) * 500;
  const high_weekly = Math.round((target_weekly * (1 + settings.bracket_high_pct / 100)) / 500) * 500;

  const low_total    = low_weekly    * input.duration_weeks;
  const target_total = target_weekly * input.duration_weeks;
  const high_total   = high_weekly   * input.duration_weeks;

  // ── Cost-based low: 50% GM on team+overhead costs ────────────────────────
  // delivery_cost_weekly = raw staff cost; team+overhead = staff × (1+OVERHEAD_PCT)
  // 50% GM → price = team_cost_with_overhead / (1 - 0.5) = team_cost_with_overhead × 2
  const team_cost_with_overhead = delivery_cost_weekly * (1 + OVERHEAD_PCT);
  const low_50gm_weekly = delivery_cost_weekly > 0
    ? Math.round((team_cost_with_overhead / 0.5) / 500) * 500
    : 0;

  // ── Market-based high: max won price in best available context ───────────
  const inputFundL = (input.fund_name ?? "").trim().toLowerCase();
  const inputRegionL = input.region.toLowerCase();
  // Priority 1: same region + same fund
  const wonRegionFund = inputFundL
    ? historicalProposals.filter(p =>
        p.outcome === "won" &&
        p.region.toLowerCase() === inputRegionL &&
        (p.fund_name ?? "").trim().toLowerCase() === inputFundL &&
        p.weekly_price > 0
      )
    : [];
  // Priority 2: same region + same client
  const inputClientL = (input.client_name ?? "").trim().toLowerCase();
  const wonRegionClient = inputClientL
    ? historicalProposals.filter(p =>
        p.outcome === "won" &&
        p.region.toLowerCase() === inputRegionL &&
        (p.client_name ?? "").trim().toLowerCase() === inputClientL &&
        p.weekly_price > 0
      )
    : [];
  // Priority 3: same region only
  const wonRegion = historicalProposals.filter(p =>
    p.outcome === "won" &&
    p.region.toLowerCase() === inputRegionL &&
    p.weekly_price > 0
  );

  let high_market_weekly: number | null = null;
  let high_market_context: string | null = null;

  if (wonRegionFund.length > 0) {
    high_market_weekly = Math.max(...wonRegionFund.map(p => p.weekly_price));
    high_market_context = `${input.region} + ${input.fund_name} (${wonRegionFund.length} won deal${wonRegionFund.length > 1 ? "s" : ""})`;
  } else if (wonRegionClient.length > 0) {
    high_market_weekly = Math.max(...wonRegionClient.map(p => p.weekly_price));
    high_market_context = `${input.region} + ${input.client_name} (${wonRegionClient.length} won deal${wonRegionClient.length > 1 ? "s" : ""})`;
  } else if (wonRegion.length > 0) {
    high_market_weekly = Math.max(...wonRegion.map(p => p.weekly_price));
    high_market_context = `${input.region} only (${wonRegion.length} won deal${wonRegion.length > 1 ? "s" : ""})`;
  }

  layer_trace.push({
    layer: "OUT",
    label: "Final Target",
    value: target_weekly,
    delta_pct: base_weekly > 0 ? ((target_weekly - base_weekly) / base_weekly) * 100 : 0,
    note: `Range: ${formatCurrency(low_weekly)} – ${formatCurrency(high_weekly)}/wk`,
  });

  // ── Posture ──────────────────────────────────────────────────────────────
  let posture: "Defensive" | "Balanced" | "Assertive";
  if (target_weekly < sensitivity_adjusted * 0.95) {
    posture = "Defensive";
  } else if (target_weekly > sensitivity_adjusted * 1.05) {
    posture = "Assertive";
  } else {
    posture = "Balanced";
  }

  // ── Confidence ───────────────────────────────────────────────────────────
  let confidence = 0.35;
  if (fund_proposals_count >= 3)  confidence += 0.15;
  if (fund_proposals_count >= 5)  confidence += 0.10;
  if (comparable_wins.length >= 2)  confidence += 0.10;
  if (comparable_losses.length >= 2) confidence += 0.05;
  if (input.competitive_intensity && input.competitor_type) confidence += 0.05; // market context
  if (input.commercial_maturity && input.urgency) confidence += 0.05;
  confidence = Math.min(confidence, 1.0);

  let confidence_label: "Low" | "Medium" | "High";
  if (confidence < 0.5)       confidence_label = "Low";
  else if (confidence < 0.75) confidence_label = "Medium";
  else                         confidence_label = "High";

  // ── Drivers ─────────────────────────────────────────────────────────────
  const drivers: string[] = [];

  const staffingDesc = input.staffing
    .map(line => {
      const label = line.resource_label || line.role_name;
      const countStr = line.count > 1 ? `${line.count}× ` : "";
      return `${countStr}${label} (${line.days_per_week}d/wk @ €${line.daily_rate_used.toLocaleString("en-US")}/day)`;
    })
    .join(", ");
  drivers.push(`Staffing: ${staffingDesc} → base ${formatCurrency(base_weekly)}/wk`);

  if (geo_multiplier !== 1.0) {
    drivers.push(`Geography (${input.region}): ×${geo_multiplier} regional adjustment`);
  }

  if (total_market_adj !== 0) {
    drivers.push(`Market context: ${market_notes.join(", ")} (${total_market_adj > 0 ? "+" : ""}${(total_market_adj * 100).toFixed(0)}%)`);
  }

  if (total_client_adj !== 0) {
    drivers.push(`Client profile: ${client_notes.join(", ")} (${total_client_adj > 0 ? "+" : ""}${(total_client_adj * 100).toFixed(0)}%)`);
  }

  if (input.strategic_intent && Math.abs(strategic_adj) > 0) {
    drivers.push(`Strategic intent: ${intent_note}`);
  }

  if (all_comparables.length > 0) {
    drivers.push(`Comparable win rate: ${(win_probability * 100).toFixed(0)}% (${comparable_wins.length} won / ${all_comparables.length} total)`);
  }

  // ── Warnings ─────────────────────────────────────────────────────────────
  const warnings: string[] = [];

  if (history_adjustment_pct !== null && history_adjustment_pct > settings.aggressive_threshold_pct) {
    warnings.push(`⚠ Target is ${history_adjustment_pct.toFixed(1)}% above historical average for ${input.fund_name ?? "this fund"}`);
  }

  if (history_adjustment_pct !== null && history_adjustment_pct < -settings.conservative_threshold_pct) {
    warnings.push(`⚠ Target is ${Math.abs(history_adjustment_pct).toFixed(1)}% below historical average — may leave money on the table`);
  }

  if (fund_proposals_count === 0 && input.fund_name) {
    warnings.push(`ℹ No prior proposals found for ${input.fund_name}`);
  }

  if (comparable_wins.length < settings.min_comparables) {
    warnings.push(`ℹ Limited comparable wins (${comparable_wins.length}) — recommendation has lower confidence`);
  }

  if (comparable_avg_loss_weekly !== null && target_weekly >= comparable_avg_loss_weekly) {
    warnings.push(`⚠ Target (${formatCurrency(target_weekly)}) is at or above the average lost price (${formatCurrency(Math.round(comparable_avg_loss_weekly))}) for comparable deals`);
  }

  if (win_probability < 0.35) {
    warnings.push(`⚠ Low estimated win probability (${(win_probability * 100).toFixed(0)}%) — consider a more competitive price`);
  }

  // ── Advisory ─────────────────────────────────────────────────────────────
  const postureDesc = posture === "Defensive"
    ? "a conservative posture to maximise win probability"
    : posture === "Assertive"
    ? "an assertive posture reflecting strong market positioning"
    : "a balanced posture between competitiveness and value capture";

  const historyContext = fund_proposals_count >= 2 && history_anchor !== null
    ? ` Historical data from ${fund_proposals_count} prior ${input.fund_name ? `${input.fund_name} ` : ""}proposals anchors at ${formatCurrency(Math.round(history_anchor))}/wk (time-decayed, outcome-weighted).`
    : fund_proposals_count > 0
    ? ` There is ${fund_proposals_count} prior proposal on record for this fund.`
    : input.fund_name
    ? ` No prior proposals found for ${input.fund_name}.`
    : "";

  const advisory =
    `This ${input.duration_weeks}-week engagement is priced at ${formatCurrency(target_weekly)}/wk (${formatCurrency(target_total)} total), reflecting ${postureDesc}.` +
    historyContext +
    (all_comparables.length > 0 ? ` Comparable win rate: ${(win_probability * 100).toFixed(0)}%, expected margin ${expected_margin_pct.toFixed(0)}%. ` : " ") +
    `Confidence: ${confidence_label.toLowerCase()} (${(confidence * 100).toFixed(0)}%). ` +
    `Negotiation range: ${formatCurrency(low_weekly)}–${formatCurrency(high_weekly)}/wk.`;

  // ── Return ───────────────────────────────────────────────────────────────
  return {
    base_weekly,
    geo_multiplier,
    geo_adjusted,
    ownership_multiplier,
    ownership_adjusted,
    size_multiplier,
    size_adjusted,
    sensitivity_multiplier,
    sensitivity_adjusted,
    fund_proposals_count,
    fund_avg_weekly,
    fund_recent_weekly,
    fund_min_weekly,
    fund_max_weekly,
    fund_win_rate,
    history_anchor,
    history_adjustment_pct,
    comparable_wins,
    comparable_losses,
    comparable_avg_win_weekly,
    comparable_avg_loss_weekly,
    low_weekly,
    target_weekly,
    high_weekly,
    low_total,
    target_total,
    high_total,
    posture,
    confidence,
    confidence_label,
    drivers,
    warnings,
    advisory,
    // New fields
    value_anchor_weekly,
    cost_floor_weekly,
    ebitda_uplift,
    ebitda_improvement_pct,
    win_probability,
    expected_margin_pct,
    ev_optimized_weekly: null,
    layer_trace,
    delivery_cost_weekly,
    low_50gm_weekly,
    high_market_weekly,
    high_market_context,
  };
}
