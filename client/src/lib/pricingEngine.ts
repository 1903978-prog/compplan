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

export interface PricingSettings {
  roles: PricingRole[];
  regions: PricingRegion[];
  ownership_multipliers: OwnershipMultiplier[];
  revenue_band_multipliers: RevenueBandMultiplier[];
  sensitivity_multipliers: SensitivityMultiplier[];
  bracket_low_pct: number;
  bracket_high_pct: number;
  aggressive_threshold_pct: number;
  conservative_threshold_pct: number;
  min_comparables: number;
  fund_anchor_weight: number;
  win_loss_weight: number;
}

export interface StaffingLine {
  role_id: string;
  role_name: string;
  resource_label?: string | null;
  days_per_week: number;
  daily_rate_used: number;
  count: number;
}

export interface PricingCaseInput {
  region: string;
  pe_owned: boolean;
  revenue_band: string;
  price_sensitivity: string;
  duration_weeks: number;
  fund_name?: string | null;
  staffing: StaffingLine[];
}

export interface PricingProposal {
  id?: number;
  proposal_date: string;
  project_name: string;
  client_name?: string | null;
  fund_name?: string | null;
  region: string;
  pe_owned: boolean;
  revenue_band: string;
  price_sensitivity?: string | null;
  duration_weeks?: number | null;
  weekly_price: number;
  total_fee?: number | null;
  outcome: string;
  loss_reason?: string | null;
  notes?: string | null;
  created_at?: string;
}

export interface PricingRecommendation {
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
  posture: "Defensive" | "Balanced" | "Assertive";
  confidence: number;
  confidence_label: "Low" | "Medium" | "High";
  drivers: string[];
  warnings: string[];
  advisory: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const REVENUE_BANDS = [
  { value: "below_100m", label: "Below €100M" },
  { value: "100m_200m", label: "€100M – €200M" },
  { value: "200m_1b", label: "€200M – €1B" },
  { value: "above_1b", label: "Above €1B" },
];

export const REGIONS = [
  "Italy",
  "South Europe",
  "France",
  "Germany",
  "UK",
  "US",
  "Asia",
  "Middle East",
];

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  roles: [
    { id: "partner", role_name: "Partner", default_daily_rate: 3500, active: false, sort_order: 0 },
    { id: "manager", role_name: "Manager", default_daily_rate: 2200, active: true, sort_order: 1 },
    { id: "associate", role_name: "Associate", default_daily_rate: 1400, active: true, sort_order: 2 },
    { id: "analyst", role_name: "Analyst", default_daily_rate: 900, active: false, sort_order: 3 },
    { id: "counsel", role_name: "Counsel / Expert", default_daily_rate: 2800, active: false, sort_order: 4 },
  ],
  regions: [
    { id: "italy", region_name: "Italy", multiplier: 1.0, is_baseline: true },
    { id: "south_europe", region_name: "South Europe", multiplier: 0.95, is_baseline: false },
    { id: "france", region_name: "France", multiplier: 1.10, is_baseline: false },
    { id: "germany", region_name: "Germany", multiplier: 1.15, is_baseline: false },
    { id: "uk", region_name: "UK", multiplier: 1.25, is_baseline: false },
    { id: "us", region_name: "US", multiplier: 1.40, is_baseline: false },
    { id: "asia", region_name: "Asia", multiplier: 1.05, is_baseline: false },
    { id: "middle_east", region_name: "Middle East", multiplier: 1.20, is_baseline: false },
  ],
  ownership_multipliers: [
    { value: "pe", label: "Private Equity owned", multiplier: 1.0, is_baseline: true },
    { value: "non_pe", label: "Non PE-owned", multiplier: 0.85, is_baseline: false },
  ],
  revenue_band_multipliers: [
    { value: "below_100m", label: "Below €100M", multiplier: 0.75, is_baseline: false },
    { value: "100m_200m", label: "€100M – €200M", multiplier: 0.85, is_baseline: false },
    { value: "200m_1b", label: "€200M – €1B", multiplier: 0.92, is_baseline: false },
    { value: "above_1b", label: "Above €1B", multiplier: 1.0, is_baseline: true },
  ],
  sensitivity_multipliers: [
    { value: "low", label: "Low sensitivity", multiplier: 1.10 },
    { value: "medium", label: "Medium sensitivity", multiplier: 1.00 },
    { value: "high", label: "High sensitivity", multiplier: 0.90 },
  ],
  bracket_low_pct: 12,
  bracket_high_pct: 18,
  aggressive_threshold_pct: 20,
  conservative_threshold_pct: 15,
  min_comparables: 3,
  fund_anchor_weight: 0.30,
  win_loss_weight: 0.20,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function roundTo500(value: number): number {
  return Math.round(value / 500) * 500;
}

function formatCurrency(value: number): string {
  return "€" + value.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function calculatePricing(
  input: PricingCaseInput,
  settings: PricingSettings,
  historicalProposals: PricingProposal[]
): PricingRecommendation {
  // -------------------------------------------------------------------------
  // LAYER 1: base_weekly
  // -------------------------------------------------------------------------
  const base_weekly = input.staffing.reduce((sum, line) => {
    return sum + line.days_per_week * line.daily_rate_used * line.count;
  }, 0);

  // -------------------------------------------------------------------------
  // LAYER 2: geo
  // -------------------------------------------------------------------------
  const geoRegion = settings.regions.find(
    (r) => r.region_name.toLowerCase() === input.region.toLowerCase()
  );
  const geo_multiplier = geoRegion?.multiplier ?? 1.0;
  const geo_adjusted = base_weekly * geo_multiplier;

  // -------------------------------------------------------------------------
  // LAYER 3: ownership
  // -------------------------------------------------------------------------
  const ownershipKey = input.pe_owned ? "pe" : "non_pe";
  const ownershipEntry = settings.ownership_multipliers.find(
    (o) => o.value === ownershipKey
  );
  const ownership_multiplier = ownershipEntry?.multiplier ?? 1.0;
  const ownership_adjusted = geo_adjusted * ownership_multiplier;

  // -------------------------------------------------------------------------
  // LAYER 4: size (revenue band)
  // -------------------------------------------------------------------------
  const sizeEntry = settings.revenue_band_multipliers.find(
    (s) => s.value === input.revenue_band
  );
  const size_multiplier = sizeEntry?.multiplier ?? 1.0;
  const size_adjusted = ownership_adjusted * size_multiplier;

  // -------------------------------------------------------------------------
  // LAYER 5: price sensitivity
  // -------------------------------------------------------------------------
  const sensitivityEntry = settings.sensitivity_multipliers.find(
    (s) => s.value === input.price_sensitivity
  );
  const sensitivity_multiplier = sensitivityEntry?.multiplier ?? 1.0;
  const sensitivity_adjusted = size_adjusted * sensitivity_multiplier;

  // -------------------------------------------------------------------------
  // LAYER 6: fund history
  // -------------------------------------------------------------------------
  const inputFund = input.fund_name?.trim().toLowerCase() ?? null;

  const fundProposals = inputFund
    ? historicalProposals
        .filter(
          (p) =>
            p.fund_name &&
            p.fund_name.trim().toLowerCase() === inputFund
        )
        .sort(
          (a, b) =>
            new Date(b.proposal_date).getTime() -
            new Date(a.proposal_date).getTime()
        )
    : [];

  const fund_proposals_count = fundProposals.length;
  const fundPrices = fundProposals.map((p) => p.weekly_price);

  const fund_avg_weekly = mean(fundPrices);
  const fund_recent_weekly = mean(fundPrices.slice(0, 3));
  const fund_min_weekly = fundPrices.length > 0 ? Math.min(...fundPrices) : null;
  const fund_max_weekly = fundPrices.length > 0 ? Math.max(...fundPrices) : null;

  const fundWon = fundProposals.filter((p) => p.outcome === "won").length;
  const fundLost = fundProposals.filter((p) => p.outcome === "lost").length;
  const fund_win_rate =
    fundWon + fundLost > 0 ? fundWon / (fundWon + fundLost) : null;

  let history_anchor: number | null = null;
  if (fund_proposals_count >= 2 && fund_recent_weekly !== null && fund_avg_weekly !== null) {
    history_anchor = 0.6 * fund_recent_weekly + 0.4 * fund_avg_weekly;
  }

  const history_adjustment_pct: number | null =
    history_anchor !== null
      ? ((sensitivity_adjusted - history_anchor) / history_anchor) * 100
      : null;

  // -------------------------------------------------------------------------
  // LAYER 7: comparables
  // -------------------------------------------------------------------------
  const scoredProposals = historicalProposals.map((p) => {
    let score = 0;
    if (
      inputFund &&
      p.fund_name &&
      p.fund_name.trim().toLowerCase() === inputFund
    ) {
      score += 40;
    }
    if (p.region.toLowerCase() === input.region.toLowerCase()) {
      score += 25;
    }
    if (p.pe_owned === input.pe_owned) {
      score += 15;
    }
    if (p.revenue_band === input.revenue_band) {
      score += 20;
    }
    return { proposal: p, score };
  });

  const comparables = scoredProposals
    .filter((s) => s.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((s) => s.proposal);

  const comparable_wins = comparables.filter((p) => p.outcome === "won");
  const comparable_losses = comparables.filter((p) => p.outcome === "lost");

  const comparable_avg_win_weekly = mean(comparable_wins.map((p) => p.weekly_price));
  const comparable_avg_loss_weekly = mean(comparable_losses.map((p) => p.weekly_price));

  // -------------------------------------------------------------------------
  // FINAL TARGET CALCULATION
  // -------------------------------------------------------------------------
  let adjusted = sensitivity_adjusted;

  if (history_anchor !== null && fund_proposals_count >= 2) {
    const blend_weight = settings.fund_anchor_weight;
    adjusted = adjusted * (1 - blend_weight) + history_anchor * blend_weight;
  }

  if (
    comparable_avg_win_weekly !== null &&
    comparable_wins.length >= settings.min_comparables
  ) {
    const wl_weight = settings.win_loss_weight;
    adjusted = adjusted * (1 - wl_weight) + comparable_avg_win_weekly * wl_weight;
  }

  const target_weekly = roundTo500(adjusted);
  const low_weekly = Math.round((target_weekly * (1 - settings.bracket_low_pct / 100)) / 500) * 500;
  const high_weekly = Math.round((target_weekly * (1 + settings.bracket_high_pct / 100)) / 500) * 500;

  const low_total = low_weekly * input.duration_weeks;
  const target_total = target_weekly * input.duration_weeks;
  const high_total = high_weekly * input.duration_weeks;

  // -------------------------------------------------------------------------
  // POSTURE
  // -------------------------------------------------------------------------
  let posture: "Defensive" | "Balanced" | "Assertive";
  if (target_weekly < sensitivity_adjusted * 0.95) {
    posture = "Defensive";
  } else if (target_weekly > sensitivity_adjusted * 1.05) {
    posture = "Assertive";
  } else {
    posture = "Balanced";
  }

  // -------------------------------------------------------------------------
  // CONFIDENCE
  // -------------------------------------------------------------------------
  let confidence = 0.4;
  if (fund_proposals_count >= 3) confidence += 0.2;
  if (comparable_wins.length >= 2) confidence += 0.1;
  if (comparable_losses.length >= 2) confidence += 0.1;
  if (fund_proposals_count >= 5) confidence += 0.1;
  confidence = Math.min(confidence, 1.0);

  let confidence_label: "Low" | "Medium" | "High";
  if (confidence < 0.5) {
    confidence_label = "Low";
  } else if (confidence < 0.75) {
    confidence_label = "Medium";
  } else {
    confidence_label = "High";
  }

  // -------------------------------------------------------------------------
  // DRIVERS
  // -------------------------------------------------------------------------
  const drivers: string[] = [];

  // Staffing summary
  const staffingDesc = input.staffing
    .map((line) => {
      const label = line.resource_label || line.role_name;
      const countStr = line.count > 1 ? `${line.count}x ` : "";
      return `${countStr}${label} (${line.days_per_week}d/wk @ €${line.daily_rate_used.toLocaleString("en-US")}/day)`;
    })
    .join(", ");
  drivers.push(
    `Staffing: ${staffingDesc} → base weekly fee ${formatCurrency(base_weekly)}`
  );

  // Geo multiplier
  if (geo_multiplier !== 1.0) {
    const pct = ((geo_multiplier - 1) * 100).toFixed(0);
    const sign = geo_multiplier > 1 ? "+" : "";
    drivers.push(
      `Geography (${input.region}): ${sign}${pct}% regional adjustment (×${geo_multiplier}) → ${formatCurrency(geo_adjusted)}`
    );
  }

  // Ownership multiplier
  if (ownership_multiplier !== 1.0) {
    const pct = ((ownership_multiplier - 1) * 100).toFixed(0);
    const sign = ownership_multiplier > 1 ? "+" : "";
    const ownerLabel = input.pe_owned ? "PE-owned" : "Non PE-owned";
    drivers.push(
      `Ownership (${ownerLabel}): ${sign}${pct}% adjustment (×${ownership_multiplier}) → ${formatCurrency(ownership_adjusted)}`
    );
  }

  // Size multiplier
  if (size_multiplier !== 1.0) {
    const pct = ((size_multiplier - 1) * 100).toFixed(0);
    const sign = size_multiplier > 1 ? "+" : "";
    const bandLabel =
      REVENUE_BANDS.find((b) => b.value === input.revenue_band)?.label ??
      input.revenue_band;
    drivers.push(
      `Revenue band (${bandLabel}): ${sign}${pct}% size adjustment (×${size_multiplier}) → ${formatCurrency(size_adjusted)}`
    );
  }

  // Sensitivity multiplier
  if (sensitivity_multiplier !== 1.0) {
    const pct = ((sensitivity_multiplier - 1) * 100).toFixed(0);
    const sign = sensitivity_multiplier > 1 ? "+" : "";
    const sensLabel =
      settings.sensitivity_multipliers.find(
        (s) => s.value === input.price_sensitivity
      )?.label ?? input.price_sensitivity;
    drivers.push(
      `Price sensitivity (${sensLabel}): ${sign}${pct}% adjustment (×${sensitivity_multiplier}) → ${formatCurrency(sensitivity_adjusted)}`
    );
  }

  // Fund history
  if (fund_proposals_count > 0 && input.fund_name) {
    const winRateStr =
      fund_win_rate !== null ? ` — ${(fund_win_rate * 100).toFixed(0)}% win rate` : "";
    const anchorStr =
      history_anchor !== null
        ? ` — history anchor ${formatCurrency(Math.round(history_anchor))}`
        : "";
    drivers.push(
      `Fund history (${input.fund_name}): ${fund_proposals_count} prior proposal${fund_proposals_count !== 1 ? "s" : ""}, avg ${formatCurrency(Math.round(fund_avg_weekly ?? 0))}${winRateStr}${anchorStr}`
    );
  }

  // Comparables
  if (comparables.length > 0) {
    const winStr =
      comparable_avg_win_weekly !== null
        ? `, avg win ${formatCurrency(Math.round(comparable_avg_win_weekly))}`
        : "";
    const lossStr =
      comparable_avg_loss_weekly !== null
        ? `, avg loss ${formatCurrency(Math.round(comparable_avg_loss_weekly))}`
        : "";
    drivers.push(
      `Comparables: ${comparable_wins.length} win${comparable_wins.length !== 1 ? "s" : ""} and ${comparable_losses.length} loss${comparable_losses.length !== 1 ? "es" : ""} from ${comparables.length} similar deals${winStr}${lossStr}`
    );
  }

  // -------------------------------------------------------------------------
  // WARNINGS
  // -------------------------------------------------------------------------
  const warnings: string[] = [];

  if (
    history_adjustment_pct !== null &&
    history_adjustment_pct > settings.aggressive_threshold_pct
  ) {
    const pctStr = history_adjustment_pct.toFixed(1);
    const fundLabel = input.fund_name ?? "this fund";
    warnings.push(
      `⚠ Target is ${pctStr}% above historical average for ${fundLabel} — historically leads to losses`
    );
  }

  if (
    history_adjustment_pct !== null &&
    history_adjustment_pct < -settings.conservative_threshold_pct
  ) {
    const pctStr = Math.abs(history_adjustment_pct).toFixed(1);
    const fundLabel = input.fund_name ?? "this fund";
    warnings.push(
      `⚠ Target is ${pctStr}% below historical average for ${fundLabel} — may leave money on the table`
    );
  }

  if (fund_proposals_count === 0 && input.fund_name) {
    warnings.push(`ℹ No prior proposals found for ${input.fund_name}`);
  }

  if (comparable_wins.length < settings.min_comparables) {
    warnings.push(
      `ℹ Limited comparable wins (${comparable_wins.length}) — recommendation has lower confidence`
    );
  }

  if (
    comparable_avg_loss_weekly !== null &&
    target_weekly >= comparable_avg_loss_weekly
  ) {
    warnings.push(
      `⚠ Target (${formatCurrency(target_weekly)}) is at or above the average lost price (${formatCurrency(Math.round(comparable_avg_loss_weekly))}) for comparable deals`
    );
  }

  // -------------------------------------------------------------------------
  // ADVISORY
  // -------------------------------------------------------------------------
  const postureDesc =
    posture === "Defensive"
      ? "a conservative posture to maximise win probability"
      : posture === "Assertive"
      ? "an assertive posture reflecting strong market positioning"
      : "a balanced posture between competitiveness and value capture";

  const historyContext =
    fund_proposals_count >= 2 && history_anchor !== null
      ? ` Historical data from ${fund_proposals_count} prior ${input.fund_name ? `${input.fund_name} ` : ""}proposal${fund_proposals_count !== 1 ? "s" : ""} anchors the recommendation at ${formatCurrency(Math.round(history_anchor))}/week, blended at ${(settings.fund_anchor_weight * 100).toFixed(0)}%.`
      : fund_proposals_count > 0
      ? ` There is ${fund_proposals_count} prior proposal on record for this fund, though insufficient history for anchoring.`
      : input.fund_name
      ? ` No prior proposals were found for ${input.fund_name}, so the recommendation relies solely on rate-card adjustments and market comparables.`
      : "";

  const confidenceContext =
    confidence_label === "High"
      ? "supported by sufficient comparable data"
      : confidence_label === "Medium"
      ? "with moderate confidence given available data"
      : "with low confidence due to limited historical data";

  const advisory =
    `This ${input.duration_weeks}-week engagement is priced at ${formatCurrency(target_weekly)}/week (${formatCurrency(target_total)} total), reflecting ${postureDesc}.` +
    `${historyContext}` +
    ` The recommendation carries ${confidence_label.toLowerCase()} confidence (${(confidence * 100).toFixed(0)}%), ${confidenceContext}; the negotiation range of ${formatCurrency(low_weekly)}–${formatCurrency(high_weekly)}/week should be used to guide client conversations.`;

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------
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
  };
}
