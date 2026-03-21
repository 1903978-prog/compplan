import { db } from "./db";
import { roleGridEntries, appSettings } from "@shared/schema";

const DEFAULT_ROLE_GRID = [
  { role_code: "INT", role_name: "Intern", next_role_code: "BA", promo_years_fast: 0.25, promo_years_normal: 0.5, promo_years_slow: 0.75, ral_min_k: 12, ral_max_k: 12, gross_fixed_min_month: 1333, gross_fixed_max_month: 1867, bonus_pct: 0, meal_voucher_eur_per_day: 0, months_paid: 12, sort_order: 0 },
  { role_code: "BA", role_name: "Business Analyst", next_role_code: "A1", promo_years_fast: 0.75, promo_years_normal: 1, promo_years_slow: 1.5, ral_min_k: 22, ral_max_k: 28, gross_fixed_min_month: 2050, gross_fixed_max_month: 2460, bonus_pct: 0, meal_voucher_eur_per_day: 8, months_paid: 12, sort_order: 1 },
  { role_code: "A1", role_name: "Associate 1", next_role_code: "A2", promo_years_fast: 0.5, promo_years_normal: 0.75, promo_years_slow: 1, ral_min_k: 27, ral_max_k: 33, gross_fixed_min_month: 2399, gross_fixed_max_month: 2758, bonus_pct: 10, meal_voucher_eur_per_day: 8, months_paid: 12, sort_order: 2 },
  { role_code: "A2", role_name: "Associate 2", next_role_code: "S1", promo_years_fast: 0.5, promo_years_normal: 0.75, promo_years_slow: 1, ral_min_k: 31, ral_max_k: 38, gross_fixed_min_month: 2399, gross_fixed_max_month: 2758, bonus_pct: 10, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 3 },
  { role_code: "S1", role_name: "Senior 1", next_role_code: "S2", promo_years_fast: 0.5, promo_years_normal: 0.75, promo_years_slow: 1, ral_min_k: 34, ral_max_k: 42, gross_fixed_min_month: 2566, gross_fixed_max_month: 2951, bonus_pct: 15, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 4 },
  { role_code: "S2", role_name: "Senior 2", next_role_code: "C1", promo_years_fast: 0.5, promo_years_normal: 0.75, promo_years_slow: 1, ral_min_k: 37, ral_max_k: 44, gross_fixed_min_month: 2695, gross_fixed_max_month: 3099, bonus_pct: 15, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 5 },
  { role_code: "C1", role_name: "Consultant 1", next_role_code: "C2", promo_years_fast: 0.75, promo_years_normal: 1, promo_years_slow: 1.5, ral_min_k: 40, ral_max_k: 50, gross_fixed_min_month: 2829, gross_fixed_max_month: 3395, bonus_pct: 20, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 6 },
  { role_code: "C2", role_name: "Consultant 2", next_role_code: "EM1", promo_years_fast: 0.75, promo_years_normal: 1, promo_years_slow: 1.5, ral_min_k: 46, ral_max_k: 58, gross_fixed_min_month: 3169, gross_fixed_max_month: 3803, bonus_pct: 20, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 7 },
  { role_code: "EM1", role_name: "Engagement Manager 1", next_role_code: "EM2", promo_years_fast: 1, promo_years_normal: 1.5, promo_years_slow: 2, ral_min_k: 56, ral_max_k: 65, gross_fixed_min_month: 3708, gross_fixed_max_month: 4264, bonus_pct: 20, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 8 },
  { role_code: "EM2", role_name: "Engagement Manager 2", next_role_code: null, promo_years_fast: 1, promo_years_normal: 1.5, promo_years_slow: 2, ral_min_k: 60, ral_max_k: 73, gross_fixed_min_month: 3893, gross_fixed_max_month: 4477, bonus_pct: 25, meal_voucher_eur_per_day: 8, months_paid: 13, sort_order: 9 },
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
  // Seed role grid if empty
  const existingRoles = await db.select().from(roleGridEntries);
  if (existingRoles.length === 0) {
    console.log("Seeding role grid...");
    await db.insert(roleGridEntries).values(DEFAULT_ROLE_GRID);
    console.log(`Seeded ${DEFAULT_ROLE_GRID.length} roles`);
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
      tests: DEFAULT_TESTS,
    });
    console.log("Settings seeded");
  }
}
