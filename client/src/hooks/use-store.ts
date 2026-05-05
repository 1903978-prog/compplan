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
  // Surfaced error from the last loadData() call. Components can read this
  // and render a "Failed to load — retry" hint instead of silently showing
  // empty arrays. Cleared on the next successful loadData().
  loadError: string | null;

  loadData: (opts?: { retryAttempt?: number }) => Promise<void>;

  addEmployee: (employee: EmployeeInput) => Promise<void>;
  updateEmployee: (id: string, employee: Partial<EmployeeInput>) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;
  retireEmployee: (id: string) => Promise<void>;
  unretireEmployee: (id: string) => Promise<void>;

  updateRoleGrid: (newGrid: RoleGridRow[]) => Promise<void>;
  updateSettings: (newSettings: AdminSettings) => Promise<void>;
  resetDefaults: () => Promise<void>;
}

// Helper: fetch + validate JSON shape. Returns null on any failure (status
// not ok, JSON parse error, network error). Logs the specific failure so
// the cause is visible in the browser console.
async function fetchJson<T>(url: string, expect: "array" | "object"): Promise<T | null> {
  try {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) {
      console.warn(`[store] ${url} → HTTP ${r.status}`);
      return null;
    }
    const body = await r.json();
    if (expect === "array" && !Array.isArray(body)) {
      console.warn(`[store] ${url} → expected array, got`, typeof body);
      return null;
    }
    if (expect === "object" && (body == null || typeof body !== "object")) {
      console.warn(`[store] ${url} → expected object, got`, typeof body);
      return null;
    }
    return body as T;
  } catch (e) {
    console.warn(`[store] ${url} → network/parse error:`, e);
    return null;
  }
}

export const useStore = create<AppState>()((set, get) => ({
  employees: [],
  roleGrid: DEFAULT_ROLE_GRID,
  settings: DEFAULT_ADMIN_SETTINGS,
  isLoaded: false,
  loadError: null,

  loadData: async ({ retryAttempt = 0 } = {}) => {
    // Per-fetch handling: a 401/5xx on one endpoint should NOT zero out
    // the others. We keep whatever the store already has for any field
    // whose fetch failed, and only update the ones that succeeded.
    const [emps, grid, settings] = await Promise.all([
      fetchJson<any[]>("/api/employees", "array"),
      fetchJson<RoleGridRow[]>("/api/role-grid", "array"),
      fetchJson<AdminSettings>("/api/settings", "object"),
    ]);

    const failures: string[] = [];
    if (emps     === null) failures.push("employees");
    if (grid     === null) failures.push("role-grid");
    if (settings === null) failures.push("settings");

    set((s) => ({
      employees: emps     !== null ? emps.map(sanitizeEmployee)        : s.employees,
      roleGrid:  grid     !== null ? grid                              : s.roleGrid,
      settings:  settings !== null ? settings                          : s.settings,
      isLoaded:  true,
      loadError: failures.length === 0
        ? null
        : `Failed to load: ${failures.join(", ")}`,
    }));

    // One automatic retry after 3s if anything failed, capped at 1 attempt
    // so we don't spin forever on a persistent 401. Components can also
    // call loadData() manually from a "Retry" button using loadError.
    if (failures.length > 0 && retryAttempt < 1) {
      setTimeout(() => { void get().loadData({ retryAttempt: retryAttempt + 1 }); }, 3000);
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

  retireEmployee: async (id) => {
    await apiRequest("PATCH", `/api/employees/${id}/retire`);
    const today = new Date().toISOString().slice(0, 10);
    set((s) => ({
      employees: s.employees.map((e) =>
        e.id === id ? { ...e, status: "former", retired_at: today } : e
      ),
    }));
  },

  unretireEmployee: async (id) => {
    await apiRequest("PATCH", `/api/employees/${id}/unretire`);
    set((s) => ({
      employees: s.employees.map((e) =>
        e.id === id ? { ...e, status: "active", retired_at: null } : e
      ),
    }));
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
