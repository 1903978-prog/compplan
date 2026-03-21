export const API = {
  employees: "/api/employees",
  employee: (id: string) => `/api/employees/${id}`,
  roleGrid: "/api/role-grid",
  settings: "/api/settings",
  authCheck: "/api/auth/check",
  authLogin: "/api/auth/login",
  authLogout: "/api/auth/logout",
};
