import { addDays, addMonths, addYears, format, isAfter, isBefore, parse, setYear, isSameDay, differenceInYears, parseISO } from "date-fns";
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
  
  const hireDate = parse(employee.hire_date, "yyyy-MM", new Date());
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

  // 1b. Calculate Performance Score from Monthly Ratings if available
  let performance_score: number | null = null;
  if (employee.monthly_ratings && employee.monthly_ratings.length > 0) {
    // Sort ratings by month descending
    const sortedRatings = [...employee.monthly_ratings].sort((a, b) => b.month.localeCompare(a.month));
    // Take last 12 months
    const last12 = sortedRatings.slice(0, 12);
    const sum = last12.reduce((acc, curr) => acc + curr.score, 0);
    performance_score = sum / last12.length;
  }

  // 2. Determine Track based on Performance Score
  let recommended_track: "Fast" | "Normal" | "Slow" | "No promotion" = "No promotion";

  // Check Promotion Gates (must be PASSED)
  const isTestPassed = (name: string) => employee.completed_tests?.some(ct => {
    const test = settings.tests.find(t => t.id === ct.id);
    return test?.name.toLowerCase() === name.toLowerCase();
  });

  const canPromoteToA2 = isTestPassed("White belt");
  const canPromoteToC1 = isTestPassed("Green belt");
  const canPromoteToA1 = isTestPassed("Consulting foundations");

  const nextRoleCode = currentRole.next_role_code;
  let gatePassed = true;

  if (nextRoleCode === "A2" && !canPromoteToA2) gatePassed = false;
  if (nextRoleCode === "C1" && !canPromoteToC1) gatePassed = false;
  if (nextRoleCode === "A1" && !canPromoteToA1) gatePassed = false;

  const fastThreshold = settings.track_fast_threshold ?? 8.5;
  const slowThreshold = settings.track_slow_threshold ?? 7.0;

  if (performance_score !== null && gatePassed) {
    if (performance_score > fastThreshold) {
      recommended_track = "Fast";
    } else if (performance_score > slowThreshold) {
      recommended_track = "Normal";
    } else if (performance_score > 5.0) {
      recommended_track = "Slow";
    } else {
      recommended_track = "No promotion";
    }
  } else {
    recommended_track = "No promotion";
  }

  // 3. Calculate All Tracks
  const baseDate = employee.last_promo_date ? parseISO(employee.last_promo_date) : hireDate;
  
  const calculateEffectiveDate = (promoYears: number) => {
    const eligibilityDate = addDays(baseDate, Math.round(promoYears * 365.25));
    let validDate = eligibilityDate;
    let found = false;

    // Ordered windows for current and next year
    const years = [eligibilityDate.getFullYear(), eligibilityDate.getFullYear() + 1];
    for (const year of years) {
      for (const windowStr of settings.promotion_windows) {
        const [month, day] = windowStr.split("-").map(Number);
        const windowDate = new Date(year, month - 1, day);
        const windowPlus21 = addDays(windowDate, 21);

        // Tolerance: If eligibility is within [Window, Window + 21 days]
        if ((isSameDay(eligibilityDate, windowDate) || isAfter(eligibilityDate, windowDate)) && 
            (isBefore(eligibilityDate, windowPlus21) || isSameDay(eligibilityDate, windowPlus21))) {
          validDate = windowDate;
          found = true;
          break;
        } 
        // Otherwise, first window strictly after eligibility
        if (isAfter(windowDate, eligibilityDate)) {
          validDate = windowDate;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    return { eligibilityDate, effectiveDate: validDate };
  };

  const tracks = [
    { label: "Fast", years: currentRole.promo_years_fast },
    { label: "Normal", years: currentRole.promo_years_normal },
    { label: "Slow", years: currentRole.promo_years_slow }
  ].map(t => {
    const { eligibilityDate, effectiveDate } = calculateEffectiveDate(t.years);
    return {
      label: t.label as "Fast" | "Normal" | "Slow",
      months: Math.round(t.years * 12),
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
      let effectiveDate = recTrack.effectiveDate;
      
      // Promotion date override rule for Fast/Normal tracks
      if ((recommended_track === "Fast" || recommended_track === "Normal") && employee.last_promo_date) {
        const lastPromoDate = parseISO(employee.last_promo_date);
        const twelveMonthGate = addMonths(lastPromoDate, 12);
        
        if (isAfter(effectiveDate, twelveMonthGate)) {
          // Set to first promo window on or after twelveMonthGate
          let overrideDate = twelveMonthGate;
          let found = false;
          const years = [twelveMonthGate.getFullYear(), twelveMonthGate.getFullYear() + 1];
          
          for (const year of years) {
            for (const windowStr of settings.promotion_windows) {
              const [month, day] = windowStr.split("-").map(Number);
              const windowDate = new Date(year, month - 1, day);
              const windowPlus21 = addDays(windowDate, 21);

              if ((isSameDay(twelveMonthGate, windowDate) || isAfter(twelveMonthGate, windowDate)) && 
                  (isBefore(twelveMonthGate, windowPlus21) || isSameDay(twelveMonthGate, windowPlus21))) {
                overrideDate = windowDate;
                found = true;
                break;
              } 
              if (isAfter(windowDate, twelveMonthGate)) {
                overrideDate = windowDate;
                found = true;
                break;
              }
            }
            if (found) break;
          }
          effectiveDate = overrideDate;
          policy_applied = "12-month minimum gate applied";
        }
      }
      next_promo_date = format(effectiveDate, "MM/yy");
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
    
    const minIncreaseMultiplier = 1 + (settings.min_promo_increase_pct / 100);
    const minIncreaseTarget = gross_month * minIncreaseMultiplier;
    
    const bandMinMonth = nextRole.gross_fixed_min_month;
    const bandMaxMonth = nextRole.gross_fixed_max_month;

    if (minIncreaseTarget <= bandMinMonth) {
        future_gross_month = bandMinMonth;
        policy_applied = "Raised to role minimum band";
    } else if (minIncreaseTarget >= bandMaxMonth) {
        // New Rule: If future gross is above max, still apply at least a 5% increase
        const fivePercentIncrease = gross_month * 1.05;
        future_gross_month = Math.max(bandMaxMonth, fivePercentIncrease);
        policy_applied = fivePercentIncrease > bandMaxMonth 
          ? "Exceeded band max: applied minimum 5% promotion increase" 
          : "Capped at role maximum band";
    } else {
        future_gross_month = minIncreaseTarget;
        policy_applied = `Standard +${settings.min_promo_increase_pct}% promotion increase`;
    }
    
    increase_amount_monthly = future_gross_month - gross_month;
    increase_pct = (increase_amount_monthly / gross_month) * 100;
  }

  // 6. Band Status (compare annual gross against ral_k ranges)
  let band_status: "Under" | "In band" | "Over" = "In band";
  const annualGross = employee.current_gross_fixed_year;
  if (annualGross < currentRole.ral_min_k * 1000) band_status = "Under";
  else if (annualGross > currentRole.ral_max_k * 1000) band_status = "Over";

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
    current_min: currentRole.ral_min_k * 1000,
    current_max: currentRole.ral_max_k * 1000,
    next_min: nextRole ? nextRole.ral_min_k * 1000 : 0,
    next_max: nextRole ? nextRole.ral_max_k * 1000 : 0,
    annual_now: employee.current_gross_fixed_year,
    annual_future: future_gross_month * (nextRole ? nextRole.months_paid : employee.months_paid)
  };
};

export const DEFAULT_ROLE_GRID: RoleGridRow[] = [
    { role_code: "INT", role_name: "Intern", next_role_code: "BA", promo_years_fast: 0.25, promo_years_normal: 0.5, promo_years_slow: 0.75, ral_min_k: 12, ral_max_k: 12, gross_fixed_min_month: 1333, gross_fixed_max_month: 1867, bonus_pct: 0, meal_voucher_eur_per_day: 0, months_paid: 12 },
    { role_code: "BA", role_name: "Business Analyst", next_role_code: "A1", promo_years_fast: 0.75, promo_years_normal: 1, promo_years_slow: 1.5, ral_min_k: 22, ral_max_k: 28, gross_fixed_min_month: 2050, gross_fixed_max_month: 2460, bonus_pct: 0, meal_voucher_eur_per_day: 8, months_paid: 12 },
    { role_code: "A1", role_name: "Associate 1", next_role_code: "A2", promo_years_fast: 0.5, promo_years_normal: 0.75, promo_years_slow: 1, ral_min_k: 27, ral_max_k: 33, gross_fixed_min_month: 2399, gross_fixed_max_month: 2758, bonus_pct: 10, meal_voucher_eur_per_day: 8, months_paid: 12 },
    { role_code: "A2", role_name: "Associate 2", next_role_code: "S1", promo_years_fast: 0.5, promo_years_normal: 0.75, promo_years_slow: 1, ral_min_k: 31, ral_max_k: 38, gross_fixed_min_month: 2399, gross_fixed_max_month: 2758, bonus_pct: 10, meal_voucher_eur_per_day: 8, months_paid: 13 },
    { role_code: "S1", role_name: "Senior 1", next_role_code: "S2", promo_years_fast: 0.5, promo_years_normal: 0.75, promo_years_slow: 1, ral_min_k: 34, ral_max_k: 42, gross_fixed_min_month: 2566, gross_fixed_max_month: 2951, bonus_pct: 15, meal_voucher_eur_per_day: 8, months_paid: 13 },
    { role_code: "S2", role_name: "Senior 2", next_role_code: "C1", promo_years_fast: 0.5, promo_years_normal: 0.75, promo_years_slow: 1, ral_min_k: 37, ral_max_k: 44, gross_fixed_min_month: 2695, gross_fixed_max_month: 3099, bonus_pct: 15, meal_voucher_eur_per_day: 8, months_paid: 13 },
    { role_code: "C1", role_name: "Consultant 1", next_role_code: "C2", promo_years_fast: 0.75, promo_years_normal: 1, promo_years_slow: 1.5, ral_min_k: 40, ral_max_k: 50, gross_fixed_min_month: 2829, gross_fixed_max_month: 3395, bonus_pct: 20, meal_voucher_eur_per_day: 8, months_paid: 13 },
    { role_code: "C2", role_name: "Consultant 2", next_role_code: "EM1", promo_years_fast: 0.75, promo_years_normal: 1, promo_years_slow: 1.5, ral_min_k: 46, ral_max_k: 58, gross_fixed_min_month: 3169, gross_fixed_max_month: 3803, bonus_pct: 20, meal_voucher_eur_per_day: 8, months_paid: 13 },
    { role_code: "EM1", role_name: "Engagement Manager 1", next_role_code: "EM2", promo_years_fast: 1, promo_years_normal: 1.5, promo_years_slow: 2, ral_min_k: 56, ral_max_k: 65, gross_fixed_min_month: 3708, gross_fixed_max_month: 4264, bonus_pct: 20, meal_voucher_eur_per_day: 8, months_paid: 13 },
    { role_code: "EM2", role_name: "Engagement Manager 2", next_role_code: null, promo_years_fast: 1, promo_years_normal: 1.5, promo_years_slow: 2, ral_min_k: 60, ral_max_k: 73, gross_fixed_min_month: 3893, gross_fixed_max_month: 4477, bonus_pct: 25, meal_voucher_eur_per_day: 8, months_paid: 13 },
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
