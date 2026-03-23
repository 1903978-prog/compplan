import { addMonths, format, parse, differenceInYears, parseISO } from "date-fns";
import type { EmployeeInput, RoleGridRow, AdminSettings, EmployeeCalculationResult } from "@shared/schema";

export const calculateEmployeeMetrics = (
  employee: EmployeeInput,
  roleGrid: RoleGridRow[],
  settings: AdminSettings
): EmployeeCalculationResult & { 
  age: number, 
  totalTenure: number, 
  hireTenure: number,
  tracks: {
    label: string,
    months: number,
    eligibilityDate: Date,
    effectiveDate: Date,
    isRecommended: boolean
  }[],
  current_min: number,
  current_max: number,
  next_min: number,
  next_max: number,
  annual_now: number,
  annual_future: number
} => {
  const currentRole = roleGrid.find((r) => r.role_code === employee.current_role_code);
  
  const today = new Date();
  const dob = parseISO(employee.date_of_birth);
  const age = differenceInYears(today, dob);
  
  const hireDate = employee.hire_date.length === 10
    ? parse(employee.hire_date, "yyyy-MM-dd", new Date())
    : parse(employee.hire_date, "yyyy-MM", new Date());
  // Use today's date for comparison
  const monthsDiff = (today.getFullYear() - hireDate.getFullYear()) * 12 + (today.getMonth() - hireDate.getMonth());
  const hireTenure = Number((monthsDiff / 12).toFixed(1));
  const totalTenure = Number((hireTenure + employee.tenure_before_years).toFixed(1));

  // Default fallback if role not found
  if (!currentRole) {
    return {
      employeeId: employee.id,
      normalized_tenure: totalTenure,
      gross_month: 0,
      net_month: 0,
      recommended_track: "No promotion",
      next_promo_date: "No promotion",
      next_role_code: null,
      target_ral_min: 0,
      target_ral_max: 0,
      future_gross_month: 0,
      increase_amount_monthly: 0,
      increase_pct: 0,
      band_status: "In band",
      policy_applied: "Role not found",
      age,
      totalTenure,
      hireTenure,
      tracks: [],
      current_min: 0,
      current_max: 0,
      next_min: 0,
      next_max: 0,
      annual_now: 0,
      annual_future: 0
    };
  }

  // 1. Calculate Gross & Net Month
  const gross_month = employee.current_gross_fixed_year / employee.months_paid;
  const net_month = (gross_month * settings.net_factor); 

  // 1b. Performance score: average of monthly ratings (last 12), fallback to manual score
  let performance_score: number | null = null;
  if (employee.monthly_ratings && employee.monthly_ratings.length > 0) {
    const sortedRatings = [...employee.monthly_ratings].sort((a, b) => b.month.localeCompare(a.month));
    const last12 = sortedRatings.slice(0, 12);
    const sum = last12.reduce((acc, curr) => acc + curr.score, 0);
    performance_score = Math.round((sum / last12.length) * 10) / 10;
  } else if (employee.performance_score != null && employee.performance_score > 0) {
    performance_score = employee.performance_score;
  }

  // 2. Determine Track based on Performance Score
  let recommended_track: "Fast" | "Normal" | "Slow" | "No promotion" = "No promotion";

  const fastThreshold = settings.track_fast_threshold ?? 8.5;
  const slowThreshold = settings.track_slow_threshold ?? 7.0;

  if (performance_score !== null && performance_score > 5) {
    if (performance_score >= fastThreshold) {
      recommended_track = "Fast";
    } else if (performance_score >= slowThreshold) {
      recommended_track = "Normal";
    } else {
      recommended_track = "Slow";
    }
  }

  // 3. Calculate All Tracks
  // Base = last promo date if set, otherwise hire date
  const baseDate = employee.last_promo_date
    ? (employee.last_promo_date.length === 10
        ? parse(employee.last_promo_date, "yyyy-MM-dd", new Date())
        : parse(employee.last_promo_date, "yyyy-MM", new Date()))
    : hireDate;

  const calculateEffectiveDate = (promoMonths: number) => {
    const eligibilityDate = addMonths(baseDate, Math.round(promoMonths * 12));
    // Effective date = 1st of the month immediately after eligibility
    const effectiveDate = new Date(eligibilityDate.getFullYear(), eligibilityDate.getMonth() + 1, 1);
    return { eligibilityDate, effectiveDate };
  };

  const tracks = [
    { label: "Fast", months: currentRole.promo_years_fast },
    { label: "Normal", months: currentRole.promo_years_normal },
    { label: "Slow", months: currentRole.promo_years_slow }
  ].map(t => {
    const { eligibilityDate, effectiveDate } = calculateEffectiveDate(t.months);
    return {
      label: t.label as "Fast" | "Normal" | "Slow",
      months: Math.round(t.months * 12),
      eligibilityDate,
      effectiveDate,
      isRecommended: recommended_track === t.label
    };
  });

  // 4. Calculate Next Promo Date for Dashboard
  let next_promo_date: string | "No promotion" = "No promotion";
  let next_role_code: string | null = currentRole.next_role_code;
  let policy_applied = "Standard calculation";

  if (!next_role_code) {
    next_promo_date = "N/A (Top role)";
  } else if (recommended_track === "No promotion") {
    next_promo_date = "No promotion";
  } else {
    const recTrack = tracks.find(t => t.isRecommended);
    if (recTrack) {
      next_promo_date = format(recTrack.effectiveDate, "MM/yy");
    }
  }

  // 5. Future Salary Calculations
  let target_ral_min = 0;
  let target_ral_max = 0;
  let future_gross_month = 0;
  let increase_amount_monthly = 0;
  let increase_pct = 0;

  const nextRole = roleGrid.find(r => r.role_code === next_role_code);

  if (nextRole && recommended_track !== "No promotion") {
    target_ral_min = nextRole.ral_min_k * 1000;
    target_ral_max = nextRole.ral_max_k * 1000;

    // Use per-employee override if set, otherwise fall back to global setting
    const effectiveIncreasePct = employee.promo_increase_override != null
      ? employee.promo_increase_override
      : settings.min_promo_increase_pct;

    const increaseMultiplier = 1 + (effectiveIncreasePct / 100);
    const increaseTarget = gross_month * increaseMultiplier;

    const bandMinMonth = nextRole.gross_fixed_min_month;
    const bandMaxMonth = nextRole.gross_fixed_max_month;

    if (increaseTarget <= bandMinMonth) {
        future_gross_month = bandMinMonth;
        policy_applied = "Raised to role minimum band";
    } else if (increaseTarget >= bandMaxMonth) {
        const fivePercentIncrease = gross_month * 1.05;
        future_gross_month = Math.max(bandMaxMonth, fivePercentIncrease);
        policy_applied = fivePercentIncrease > bandMaxMonth
          ? "Exceeded band max: applied minimum 5% promotion increase"
          : "Capped at role maximum band";
    } else {
        future_gross_month = increaseTarget;
        policy_applied = `+${effectiveIncreasePct.toFixed(1)}% promotion increase`;
    }

    increase_amount_monthly = future_gross_month - gross_month;
    increase_pct = (increase_amount_monthly / gross_month) * 100;
  }

  // 6. Band Status (compare annual gross against ral_k ranges)
  let band_status: "Under" | "In band" | "Over" = "In band";
  const annualGross = employee.current_gross_fixed_year;
  const roleGrossMin = currentRole.gross_fixed_min_month * currentRole.months_paid;
  const roleGrossMax = currentRole.gross_fixed_max_month * currentRole.months_paid;
  if (annualGross < roleGrossMin) band_status = "Under";
  else if (annualGross > roleGrossMax) band_status = "Over";

  return {
    employeeId: employee.id,
    normalized_tenure: totalTenure,
    gross_month,
    net_month,
    recommended_track,
    next_promo_date,
    next_role_code,
    target_ral_min,
    target_ral_max,
    future_gross_month,
    increase_amount_monthly,
    increase_pct,
    band_status,
    policy_applied,
    age,
    performance_score,
    totalTenure,
    hireTenure,
    tracks,
    current_min: currentRole.gross_fixed_min_month * currentRole.months_paid,
    current_max: currentRole.gross_fixed_max_month * currentRole.months_paid,
    next_min: nextRole ? nextRole.gross_fixed_min_month * nextRole.months_paid : 0,
    next_max: nextRole ? nextRole.gross_fixed_max_month * nextRole.months_paid : 0,
    annual_now: employee.current_gross_fixed_year,
    annual_future: future_gross_month * (nextRole ? nextRole.months_paid : employee.months_paid)
  };
};

export const DEFAULT_ROLE_GRID: RoleGridRow[] = [
    { role_code: "INT", role_name: "Intern",               next_role_code: "BA",  promo_years_fast: 0.25, promo_years_normal: 0.5,  promo_years_slow: 0.75, ral_min_k: 10,   ral_max_k: 12,   gross_fixed_min_month: 850,  gross_fixed_max_month: 1275, bonus_pct: 0,  meal_voucher_eur_per_day: 0, months_paid: 12 },
    { role_code: "BA",  role_name: "Business Analyst",     next_role_code: "A1",  promo_years_fast: 0.75, promo_years_normal: 1.0,  promo_years_slow: 1.5,  ral_min_k: 16.3, ral_max_k: 27.3, gross_fixed_min_month: 1600, gross_fixed_max_month: 2400, bonus_pct: 0,  meal_voucher_eur_per_day: 8, months_paid: 12 },
    { role_code: "A1",  role_name: "Associate 1",          next_role_code: "A2",  promo_years_fast: 0.5,  promo_years_normal: 0.75, promo_years_slow: 1.0,  ral_min_k: 19.7, ral_max_k: 23.5, gross_fixed_min_month: 1872, gross_fixed_max_month: 2153, bonus_pct: 10, meal_voucher_eur_per_day: 8, months_paid: 12 },
    { role_code: "A2",  role_name: "Associate 2",          next_role_code: "S1",  promo_years_fast: 0.5,  promo_years_normal: 0.75, promo_years_slow: 1.0,  ral_min_k: 24.7, ral_max_k: 30.4, gross_fixed_min_month: 2059, gross_fixed_max_month: 2368, bonus_pct: 10, meal_voucher_eur_per_day: 8, months_paid: 13 },
    { role_code: "S1",  role_name: "Senior 1",             next_role_code: "S2",  promo_years_fast: 0.5,  promo_years_normal: 0.75, promo_years_slow: 1.0,  ral_min_k: 28.4, ral_max_k: 35.1, gross_fixed_min_month: 2265, gross_fixed_max_month: 2605, bonus_pct: 15, meal_voucher_eur_per_day: 8, months_paid: 13 },
    { role_code: "S2",  role_name: "Senior 2",             next_role_code: "C1",  promo_years_fast: 0.5,  promo_years_normal: 0.75, promo_years_slow: 1.0,  ral_min_k: 31.3, ral_max_k: 39.3, gross_fixed_min_month: 2424, gross_fixed_max_month: 2787, bonus_pct: 15, meal_voucher_eur_per_day: 8, months_paid: 13 },
    { role_code: "C1",  role_name: "Consultant 1",         next_role_code: "C2",  promo_years_fast: 0.75, promo_years_normal: 1.0,  promo_years_slow: 1.5,  ral_min_k: 33.7, ral_max_k: 44.3, gross_fixed_min_month: 2545, gross_fixed_max_month: 3054, bonus_pct: 20, meal_voucher_eur_per_day: 8, months_paid: 13 },
    { role_code: "C2",  role_name: "Consultant 2",         next_role_code: "EM1", promo_years_fast: 0.75, promo_years_normal: 1.0,  promo_years_slow: 1.5,  ral_min_k: 40.4, ral_max_k: 50.8, gross_fixed_min_month: 2850, gross_fixed_max_month: 3420, bonus_pct: 20, meal_voucher_eur_per_day: 8, months_paid: 13 },
    { role_code: "EM1", role_name: "Engagement Manager 1", next_role_code: "EM2", promo_years_fast: 1.0,  promo_years_normal: 1.5,  promo_years_slow: 2.0,  ral_min_k: 50.8, ral_max_k: 62.4, gross_fixed_min_month: 3420, gross_fixed_max_month: 4104, bonus_pct: 20, meal_voucher_eur_per_day: 8, months_paid: 13 },
    { role_code: "EM2", role_name: "Engagement Manager 2", next_role_code: null,  promo_years_fast: 1.0,  promo_years_normal: 1.5,  promo_years_slow: 2.0,  ral_min_k: 62.4, ral_max_k: 81.1, gross_fixed_min_month: 4104, gross_fixed_max_month: 4925, bonus_pct: 25, meal_voucher_eur_per_day: 8, months_paid: 13 },
];

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
    net_factor: 0.75,
    meal_voucher_days_per_month: 20,
    min_promo_increase_pct: 10,
    promotion_windows: ["01-01", "05-01", "09-01"],
    window_tolerance_days: 21,
    track_fast_threshold: 8.5,
    track_slow_threshold: 7.0,
    tests: [
      { id: "1", name: "Onboarding", due_from_hire_months: 2 },
      { id: "2", name: "Project zero", due_from_hire_months: 2 },
      { id: "3", name: "Policies", due_from_hire_months: 1 },
      { id: "4", name: "Cybersecurity", due_from_hire_months: 1 },
      { id: "5", name: "White belt", due_from_hire_months: 12 },
      { id: "6", name: "Consulting foundations", due_from_hire_months: 12 },
      { id: "7", name: "Green belt", due_from_hire_months: 24 },
    ],
};
