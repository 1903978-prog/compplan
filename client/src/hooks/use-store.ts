import { create } from "zustand";
import type { EmployeeInput, RoleGridRow, AdminSettings } from "@shared/schema";
import { DEFAULT_ROLE_GRID, DEFAULT_ADMIN_SETTINGS } from "@/lib/calculations";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";

/** Sanitize employee JSONB fields that may come as wrong types from the DB */
function sanitizeEmployee(e: any): EmployeeInput {
  return {
    ...e,
    completed_tests: Array.isArray(e.completed_tests)
      ? e.completed_tests.map((t: any) => typeof t === 'string' ? { id: t, score: null } : t)
      : [],
    monthly_ratings: Array.isArray(e.monthly_ratings) ? e.monthly_ratings : [],
    onboarding_ratings: Array.isArray(e.onboarding_ratings) ? e.onboarding_ratings : [],
    yearly_reviews: Array.isArray(e.yearly_reviews) ? e.yearly_reviews : [],
    comex_areas: e.comex_areas && typeof e.comex_areas === 'object' && !Array.isArray(e.comex_areas) ? e.comex_areas : {},
  };
}

interface AppState {
  employees: EmployeeInput[];
  roleGrid: RoleGridRow[];
  settings: AdminSettings;
  isLoaded: boolean;

  loadData: () => Promise<void>;

  addEmployee: (employee: EmployeeInput) => Promise<void>;
  updateEmployee: (id: string, employee: Partial<EmployeeInput>) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;

  updateRoleGrid: (newGrid: RoleGridRow[]) => Promise<void>;
  updateSettings: (newSettings: AdminSettings) => Promise<void>;
  resetDefaults: () => Promise<void>;
}

export const useStore = create<AppState>()((set, get) => ({
  employees: [],
  roleGrid: DEFAULT_ROLE_GRID,
  settings: DEFAULT_ADMIN_SETTINGS,
  isLoaded: false,

  loadData: async () => {
    try {
      const [empsRes, gridRes, settingsRes] = await Promise.all([
        fetch("/api/employees", { credentials: "include" }),
        fetch("/api/role-grid", { credentials: "include" }),
        fetch("/api/settings", { credentials: "include" }),
      ]);
      const [empsData, gridData, settingsData] = await Promise.all([
        empsRes.json(),
        gridRes.json(),
        settingsRes.json(),
      ]);
      set({
        employees: (empsData as any[]).map(sanitizeEmployee),
        roleGrid: gridData as RoleGridRow[],
        settings: settingsData as AdminSettings,
        isLoaded: true,
      });
    } catch (err) {
      console.error("Failed to load data:", err);
      set({ isLoaded: true });
    }
  },

  addEmployee: async (employee) => {
    const res = await apiRequest("POST", "/api/employees", employee);
    const created = sanitizeEmployee(await res.json());
    set((s) => ({ employees: [...s.employees, created] }));
  },

  updateEmployee: async (id, updates) => {
    const existing = get().employees.find((e) => e.id === id);
    if (!existing) return;
    const merged = { ...existing, ...updates };
    const res = await apiRequest("PUT", `/api/employees/${id}`, merged);
    const updated = sanitizeEmployee(await res.json());
    set((s) => ({
      employees: s.employees.map((e) => (e.id === id ? updated : e)),
    }));
  },

  deleteEmployee: async (id) => {
    await apiRequest("DELETE", `/api/employees/${id}`);
    set((s) => ({ employees: s.employees.filter((e) => e.id !== id) }));
  },

  updateRoleGrid: async (newGrid) => {
    const res = await apiRequest("PUT", "/api/role-grid", newGrid);
    const saved = await res.json() as RoleGridRow[];
    set({ roleGrid: saved });
  },

  updateSettings: async (newSettings) => {
    const res = await apiRequest("PUT", "/api/settings", newSettings);
    const saved = await res.json() as AdminSettings;
    set({ settings: saved });
  },

  resetDefaults: async () => {
    const [gridRes, settingsRes] = await Promise.all([
      apiRequest("PUT", "/api/role-grid", DEFAULT_ROLE_GRID),
      apiRequest("PUT", "/api/settings", DEFAULT_ADMIN_SETTINGS),
    ]);
    const [grid, settings] = await Promise.all([
      gridRes.json() as Promise<RoleGridRow[]>,
      settingsRes.json() as Promise<AdminSettings>,
    ]);
    set({ roleGrid: grid, settings });
  },
}));
