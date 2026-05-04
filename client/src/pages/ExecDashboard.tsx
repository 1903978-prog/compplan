import { useEffect, useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { Link } from "wouter";
import { useStore } from "@/hooks/use-store";
import { useToast } from "@/hooks/use-toast";
import {
  Users, UserCheck, Receipt, DollarSign, TrendingUp, TrendingDown,
  AlertCircle, CheckCircle2, Clock, Briefcase,
  ArrowUpRight, Target, Layers, ClipboardList, FlaskConical, CreditCard,
  Pencil, Save, X, Plus, Trash2, Info,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ─── Executive Dashboard ─────────────────────────────────────────────────
//
// Single-screen rollup that aggregates every core data stream the app
// already tracks, so a leader can open ONE page and see: headcount, this
// month's payroll, active hiring candidates, overdue AR, and the BD
// pipeline (pending / won / lost for the trailing window).
//
// All widgets are links back to the detail pages so the dashboard is
// purely a navigation + glance surface — no edit affordances. Data is
// fetched once on mount and cached in local state; hitting refresh in
// the browser re-runs the fetches.
// -----------------------------------------------------------------------

interface Candidate {
  id: number;
  name: string;
  stage: string | null;
  sort_order?: number;
  logic_pct?: number | null;
  verbal_pct?: number | null;
  excel_pct?: number | null;
  intro_rate_pct?: number | null;
  cs_rate_pct?: number | null;
  cs_lm?: string | null;
  scores?: Record<string, number | null> | null;
}

interface Invoice {
  id: number;
  number: string;
  client: { id: number; name: string } | null;
  amount: number;
  due_amount: number;
  due_date: string | null;
  state: string;
  currency: string;
  sent_at: string | null;
  paid_at: string | null;
}

interface PricingProposal {
  id: number;
  project_name: string | null;
  client_name: string | null;
  total_fee: number | null;
  weekly_price: number;
  duration_weeks: number | null;
  outcome: "pending" | "won" | "lost" | null;
  proposal_date: string | null;
  region: string | null;
  currency: string | null;
  end_date?: string | null;
  last_invoice_at?: string | null;
  start_date?: string | null;
  win_probability?: number | null;
  manager_name?: string | null;
  team_members?: { role: string; name: string }[] | null;
  excluded_from_analysis?: 0 | 1 | boolean | null;
}

interface WonProject {
  id: number;
  client_name: string | null;
  project_name: string | null;
  total_amount: number | null;
  won_date: string | null;
  status: string | null;
  currency: string | null;
}

// EUR conversion helpers — rough, UI-only. Real reporting uses backend.
const FX: Record<string, number> = { EUR: 1, USD: 0.93, GBP: 1.17, CHF: 1.04 };
const toEUR = (amt: number | null | undefined, ccy: string | null | undefined): number => {
  if (!amt || isNaN(Number(amt))) return 0;
  return Number(amt) * (FX[(ccy || "EUR").toUpperCase()] ?? 1);
};

const eur = (n: number) =>
  n >= 1_000_000 ? `€${(n / 1_000_000).toFixed(1)}M` :
  n >= 1000      ? `€${Math.round(n / 1000)}k` :
                   `€${Math.round(n)}`;

// ─── KPI tile ──────────────────────────────────────────────────────────
function Kpi({
  label, value, sub, icon: Icon, tone, href,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  tone: "blue" | "emerald" | "amber" | "red" | "violet" | "slate";
  href?: string;
}) {
  const toneMap: Record<string, { bg: string; ring: string; text: string; iconBg: string; iconText: string }> = {
    blue:    { bg: "bg-blue-50",    ring: "ring-blue-200",    text: "text-blue-700",    iconBg: "bg-blue-100",    iconText: "text-blue-600" },
    emerald: { bg: "bg-emerald-50", ring: "ring-emerald-200", text: "text-emerald-700", iconBg: "bg-emerald-100", iconText: "text-emerald-600" },
    amber:   { bg: "bg-amber-50",   ring: "ring-amber-200",   text: "text-amber-700",   iconBg: "bg-amber-100",   iconText: "text-amber-600" },
    red:     { bg: "bg-red-50",     ring: "ring-red-200",     text: "text-red-700",     iconBg: "bg-red-100",     iconText: "text-red-600" },
    violet:  { bg: "bg-violet-50",  ring: "ring-violet-200",  text: "text-violet-700",  iconBg: "bg-violet-100",  iconText: "text-violet-600" },
    slate:   { bg: "bg-slate-50",   ring: "ring-slate-200",   text: "text-slate-700",   iconBg: "bg-slate-100",   iconText: "text-slate-600" },
  };
  const t = toneMap[tone];
  const content = (
    <Card className={`p-4 ${t.bg} ring-1 ${t.ring} border-0 hover:shadow-md transition-shadow h-full`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className={`text-2xl font-bold mt-1 ${t.text}`} data-privacy="blur">{value}</div>
          {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
        </div>
        <div className={`w-9 h-9 rounded-lg ${t.iconBg} flex items-center justify-center shrink-0`}>
          <Icon className={`w-5 h-5 ${t.iconText}`} />
        </div>
      </div>
    </Card>
  );
  return href ? <Link href={href} className="block">{content}</Link> : content;
}

// ─── Funnel bar (one stage row) ────────────────────────────────────────
function FunnelRow({ label, count, max, tone }: {
  label: string; count: number; max: number; tone: string;
}) {
  const pct = max > 0 ? Math.max(4, (count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-28 shrink-0 text-muted-foreground truncate" title={label}>{label}</div>
      <div className="flex-1 h-5 bg-muted rounded-sm overflow-hidden relative">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
        <span className="absolute inset-0 flex items-center pl-2 text-[11px] font-semibold text-foreground" data-privacy="blur">
          {count}
        </span>
      </div>
    </div>
  );
}

// LocalStorage cache key — stores the last successful dashboard payload
// so the page renders instantly on revisit, then silently refreshes.
const DASH_CACHE_KEY = "exec_dashboard_cache";
// Cache TTL: 10 minutes. Without this, a transient API failure that wrote
// empty arrays to the cache would persist across reloads until the user
// manually cleared localStorage.
const DASH_CACHE_TTL_MS = 10 * 60 * 1000;

interface DashCache {
  employees: any[];
  candidates: Candidate[];
  invoices: Invoice[];
  proposals: PricingProposal[];
  wonProjects: WonProject[];
  ts: string;
}

function readCache(): DashCache | null {
  try {
    const raw = localStorage.getItem(DASH_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as DashCache;
    const ts = cached?.ts ? new Date(cached.ts).getTime() : 0;
    if (!ts || Date.now() - ts > DASH_CACHE_TTL_MS) {
      localStorage.removeItem(DASH_CACHE_KEY);
      return null;
    }
    return cached;
  } catch { return null; }
}

function writeCache(employees: any[], candidates: Candidate[], invoices: Invoice[], proposals: PricingProposal[], wonProjects: WonProject[]) {
  // Guard: never poison the cache with an all-empty payload. A transient
  // API failure returns [] for every array — if we cached that, the next
  // cold load would show zeroes until the 10-minute TTL expired.
  if (employees.length === 0 && candidates.length === 0 && wonProjects.length === 0) return;
  try {
    localStorage.setItem(DASH_CACHE_KEY, JSON.stringify({ employees, candidates, invoices, proposals, wonProjects, ts: new Date().toISOString() }));
  } catch { /* quota exceeded — ignore */ }
}

export default function ExecDashboard() {
  const { employees: storeEmployees } = useStore();

  // ── Instant render from localStorage cache, then refresh in background ──
  // On first mount, read the last successful payload from localStorage
  // so the page paints in <50ms instead of waiting 1-3s for 4 API calls.
  const cached = readCache();
  // Direct employees fetch — used as a fallback when the Zustand store is
  // empty (e.g. its loadData() failed at app boot due to a transient 401 /
  // 5xx). Without this the dashboard would show Headcount=0 / Payroll=€0
  // forever, since loadData() runs once and never retries.
  // Employees are now cached alongside the other dashboard data so the last
  // known headcount is available instantly even before the fetch completes.
  const [directEmployees, setDirectEmployees] = useState<typeof storeEmployees>(cached?.employees ?? []);
  const [candidates, setCandidates] = useState<Candidate[]>(cached?.candidates ?? []);
  const [invoices, setInvoices] = useState<Invoice[]>(cached?.invoices ?? []);
  const [proposals, setProposals] = useState<PricingProposal[]>(cached?.proposals ?? []);
  const [wonProjects, setWonProjects] = useState<WonProject[]>(cached?.wonProjects ?? []);
  // Active pricing cases — used by the "Commercial Options (3 timelines)"
  // card to preview each deal's Net fee across its configured timelines.
  const [pricingCases, setPricingCases] = useState<any[]>([]);
  // Admin role defaults — used as fallback rate when a staffing line has
  // daily_rate_used = 0 (legacy drift). Without this, deriveNetWeekly
  // would silently return 0 for any pre-rec-pinned case with drifted
  // staffing rates.
  const [pricingRoles, setPricingRoles] = useState<{ id: string; default_daily_rate: number }[]>([]);
  const [loading, setLoading] = useState(!cached); // skip spinner if cache is warm
  const [lastFetch, setLastFetch] = useState<Date | null>(cached?.ts ? new Date(cached.ts) : null);

  // ── Payment round detail popup ─────────────────────────────────────────
  const [roundDetailIdx, setRoundDetailIdx] = useState<number | null>(null);

  // ── Payment round manual overrides ─────────────────────────────────────
  // Keyed by ISO date (e.g. "2026-05-05"). Auto-calc applies for any date
  // with no stored override — so future cycles always start clean.
  type RoundOverrides = Record<string, { eur?: number | null; usd?: number | null }>;
  const OVERRIDES_KEY = "compplan_payment_round_overrides";
  const [paymentRoundOverrides, setPaymentRoundOverrides] = useState<RoundOverrides>(() => {
    try {
      const stored = localStorage.getItem(OVERRIDES_KEY);
      if (stored) return JSON.parse(stored) as RoundOverrides;
    } catch { /* ignore */ }
    // Seed from Payment History (May 2026 initial values).
    const seed: RoundOverrides = {
      "2026-05-05": { eur: 10200, usd: null },
      "2026-05-15": { eur: 25000, usd: 43000 },
    };
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(seed)); } catch { /* ignore */ }
    return seed;
  });
  const [overrideEdit, setOverrideEdit] = useState<{ roundIdx: number; currency: "eur" | "usd" } | null>(null);

  const saveOverride = (roundDate: Date, currency: "eur" | "usd", rawInput: string) => {
    const key = roundDate.toISOString().slice(0, 10);
    const clean = rawInput.trim().replace(/[€$\s]/g, "").replace(/\./g, "").replace(",", ".");
    const num = clean === "" ? null : Number(clean);
    const value = num === null || isNaN(num) ? null : num;
    setPaymentRoundOverrides(prev => {
      const next: RoundOverrides = { ...prev, [key]: { ...(prev[key] ?? {}), [currency]: value } };
      try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    setOverrideEdit(null);
  };

  // ── Inline editing for Ongoing Projects table ──────────────────────────
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editManager, setEditManager] = useState("");
  const [editTeam, setEditTeam] = useState<{ role: string; name: string }[]>([]);
  const { toast } = useToast();

  function startEdit(p: PricingProposal) {
    setEditingProjectId(p.id);
    setEditManager(p.manager_name ?? "");
    setEditTeam(p.team_members ? [...p.team_members.map(m => ({ ...m }))] : []);
  }

  function cancelEdit() { setEditingProjectId(null); }

  async function saveEdit(id: number) {
    try {
      const res = await fetch(`/api/pricing/proposals/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ manager_name: editManager, team_members: editTeam.filter(m => m.name.trim()) }),
      });
      if (!res.ok) throw new Error(await res.text());
      setProposals(prev => prev.map(p =>
        p.id === id ? { ...p, manager_name: editManager, team_members: editTeam.filter(m => m.name.trim()) } as any : p
      ));
      setEditingProjectId(null);
      toast({ title: "Saved", description: "Project team updated." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      // Only show spinner if there's no cached data — otherwise the page
      // already has content and we're just silently refreshing.
      if (!cached) setLoading(true);
      try {
        const [empRes, cRes, iRes, pRes, wRes, casesRes, settingsRes] = await Promise.all([
          fetch("/api/employees",          { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/hiring/candidates",  { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/harvest/invoices",   { credentials: "include" }).then(r => r.ok ? r.json().then(d => d.invoices ?? []) : []),
          fetch("/api/pricing/proposals",  { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/won-projects",       { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/pricing/cases",      { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/pricing/settings",   { credentials: "include" }).then(r => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;
        const emp = Array.isArray(empRes) ? empRes : [];
        const c = Array.isArray(cRes) ? cRes : [];
        const i = Array.isArray(iRes) ? iRes : [];
        const p = Array.isArray(pRes) ? pRes : [];
        const w = Array.isArray(wRes) ? wRes : [];
        setDirectEmployees(emp);
        setCandidates(c);
        setInvoices(i);
        setProposals(p);
        setWonProjects(w);
        setPricingCases(Array.isArray(casesRes) ? casesRes : []);
        const roles = Array.isArray(settingsRes?.roles) ? settingsRes.roles : [];
        setPricingRoles(roles.map((r: any) => ({ id: r.id, default_daily_rate: Number(r.default_daily_rate ?? 0) })));
        setLastFetch(new Date());
        writeCache(emp, c, i, p, w);
      } catch (e) {
        console.error("[ExecDashboard] fetch failed", e);
      }
      if (!cancelled) setLoading(false);
    }
    fetchAll();
    return () => { cancelled = true; };
  }, []);

  // ─── HR rollup ────────────────────────────────────────────────────────
  // Prefer the store's roster (which the app already shares across pages),
  // but fall back to the dashboard's own /api/employees fetch if the store
  // is empty — covers the case where useStore.loadData() failed at boot
  // and never retried, leaving Headcount=0 / Payroll=€0 forever.
  const employees = (storeEmployees.length > 0 ? storeEmployees : directEmployees) as typeof storeEmployees;
  const hr = useMemo(() => {
    // Exclude former employees (retired via the Retire Employee feature).
    // Former employees remain in the DB for payroll history but should not
    // count toward active headcount or monthly payroll cost.
    const active = employees.filter(e => ((e as any).status ?? "active") !== "former");
    // Consultants = billable staff only; Interns (INT) and Back Office (BO)
    // are excluded from supply headcount and the capacity gap calculator.
    const EXCLUDED_ROLES = new Set(["INT", "BO"]);
    const consultants = active.filter(e => !EXCLUDED_ROLES.has(e.current_role_code ?? ""));

    const monthlyPayroll = active.reduce((sum, e) => {
      const gross = Number(e.current_gross_fixed_year ?? 0) / 12;
      const voucher = Number(e.meal_voucher_daily ?? 0) * 22;
      return sum + gross + voucher;
    }, 0);
    const avgSalary = active.length ? active.reduce((s, e) => s + Number(e.current_gross_fixed_year ?? 0), 0) / active.length : 0;

    // Upcoming birthdays in the next 30 days.
    const today = new Date();
    const in30 = new Date(today); in30.setDate(today.getDate() + 30);
    const birthdays = active.filter(e => {
      if (!e.date_of_birth) return false;
      const [, m, d] = e.date_of_birth.split("-").map(Number);
      if (!m || !d) return false;
      const thisYear = new Date(today.getFullYear(), m - 1, d);
      if (thisYear < today) thisYear.setFullYear(today.getFullYear() + 1);
      return thisYear <= in30;
    }).length;

    return { headcount: consultants.length, monthlyPayroll, avgSalary, birthdays };
  }, [employees]);

  // ─── Hiring funnel ────────────────────────────────────────────────────
  const hiring = useMemo(() => {
    const byStage: Record<string, number> = {};
    const namesByStage: Record<string, string[]> = {};
    for (const c of candidates) {
      const s = c.stage ?? "unassigned";
      byStage[s] = (byStage[s] ?? 0) + 1;
      if (!namesByStage[s]) namesByStage[s] = [];
      namesByStage[s].push(c.name || "—");
    }
    const potential     = byStage["potential"] ?? 0;
    const after_intro   = byStage["after_intro"] ?? 0;
    const after_csi_asc = byStage["after_csi_asc"] ?? 0;
    const after_csi_lm  = byStage["after_csi_lm"] ?? 0;
    const hired         = byStage["hired"] ?? 0;
    const out           = byStage["out"] ?? 0;
    // Active = in the funnel, not yet hired or rejected. The "Active
    // candidates" KPI tile uses this — previously it counted everyone
    // including hired and out, which inflated the number.
    const active = potential + after_intro + after_csi_asc + after_csi_lm;
    return {
      total: candidates.length,
      active,
      potential, after_intro, after_csi_asc, after_csi_lm, hired, out,
      // Names of candidates past CSI ASC (for interview tracking)
      namesAfterCsi: [
        ...(namesByStage["after_csi_asc"] ?? []),
        ...(namesByStage["after_csi_lm"] ?? []),
      ],
    };
  }, [candidates]);

  // ─── AR rollup ────────────────────────────────────────────────────────
  const ar = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // Mirror Invoicing page definition: "outstanding" = open | partial | overdue.
    // Draft / approved / sent / closed are excluded — they're not yet collectible.
    const open = invoices.filter(i => {
      const s = (i.state ?? "").toLowerCase();
      if (s === "open" || s === "partial") return true;
      if (s === "paid" || s === "closed" || s === "draft") return false;
      return i.due_date ? new Date(i.due_date) < today : false;
    });
    let outstanding = 0;
    let overdue = 0;
    let overdueCount = 0;
    let overdue60 = 0;
    for (const inv of open) {
      const due = toEUR(inv.due_amount ?? inv.amount, inv.currency);
      outstanding += due;
      if (inv.due_date) {
        const d = new Date(inv.due_date);
        if (!isNaN(d.getTime()) && d < today) {
          overdue += due;
          overdueCount++;
          const days = Math.floor((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
          if (days > 60) overdue60 += due;
        }
      }
    }
    return { openCount: open.length, outstanding, overdue, overdueCount, overdue60 };
  }, [invoices]);

  // ─── Payment rounds (5th and 15th of each month) ─────────────────────
  // For each round we show EUR and USD totals from open/partial invoices
  // whose due_date falls on or before that round date.
  const paymentRounds = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // Find next 2 round dates (5th and 15th, whichever comes first)
    const candidates: Date[] = [];
    for (let offset = 0; offset < 4 && candidates.length < 4; offset++) {
      const month = today.getMonth() + offset;
      const yr = today.getFullYear() + Math.floor(month / 12);
      const mo = month % 12;
      for (const day of [5, 15]) {
        const d = new Date(yr, mo, day);
        if (d >= today && candidates.length < 4) candidates.push(d);
      }
    }
    const open = invoices.filter(i => {
      const s = (i.state ?? "").toLowerCase();
      return s === "open" || s === "partial";
    });
    return candidates.slice(0, 2).map((roundDate, idx) => {
      const prevDate = idx === 0 ? new Date(0) : candidates[idx - 1];
      // Round 0 catches all overdue + currently-due; rounds 1+ only invoices
      // whose due_date falls in the new window.
      const due = open.filter(i => {
        if (!i.due_date) return false;
        const d = new Date(i.due_date);
        return idx === 0 ? d <= roundDate : d > prevDate && d <= roundDate;
      });
      const eur_total = due
        .filter(i => (i.currency ?? "EUR").toUpperCase() === "EUR")
        .reduce((s, i) => s + Number(i.due_amount ?? i.amount ?? 0), 0);
      const usd_total = due
        .filter(i => (i.currency ?? "").toUpperCase() === "USD")
        .reduce((s, i) => s + Number(i.due_amount ?? i.amount ?? 0), 0);
      const label = `${roundDate.getDate() === 5 ? "5th" : "15th"} ${roundDate.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}`;
      return { date: roundDate, label, eur_total, usd_total, count: due.length, invoices: due };
    });
  }, [invoices]);

  // ─── NET1 lookup: case → canonical_net_weekly ────────────────────────
  // Mirrors PricingTool's logic — all monetary figures use the pricing
  // engine's NET1, not stored total_fee (which may be stale).
  const dashNet1Map = useMemo(() => {
    const m = new Map<string, number>();
    pricingCases
      .filter((c: any) => c.project_name && (c.recommendation?.canonical_net_weekly ?? c.recommendation?.target_weekly ?? 0) > 0)
      .forEach((c: any) => {
        const name = (c.project_name as string).trim().toLowerCase();
        const net1 = Math.round(c.recommendation.canonical_net_weekly ?? c.recommendation.target_weekly);
        m.set(name, net1);
        const base = name.replace(/[a-z]+$/, "");
        if (base !== name && !m.has(base)) m.set(base, net1);
      });
    return m;
  }, [pricingCases]);

  const propNet1 = (p: PricingProposal): number => {
    const key = (p.project_name ?? "").trim().toLowerCase();
    return dashNet1Map.get(key) ?? dashNet1Map.get(key.replace(/[a-z]+$/, "")) ?? p.weekly_price;
  };
  const propNet1Total = (p: PricingProposal): number => {
    const wk = propNet1(p);
    const weeks = p.duration_weeks ?? 0;
    return weeks > 0 ? Math.round(wk * weeks) : (p.total_fee ?? 0);
  };

  // ─── BD pipeline (last 12 months of pricing proposals) ───────────────
  const bd = useMemo(() => {
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 12);
    const recent = proposals.filter(p => {
      // Honor the user-set "exclude from analysis" flag — these are typos,
      // duplicates, internal demos, etc. that the user explicitly marked
      // as junk in the Pricing Tool. Without this filter, flagged rows
      // still inflate Pending/Won/Lost counts on the dashboard.
      if (p.excluded_from_analysis === 1 || p.excluded_from_analysis === true) return false;
      if (!p.proposal_date) return true;
      const d = new Date(p.proposal_date);
      return isNaN(d.getTime()) || d >= cutoff;
    });

    const pending = recent.filter(p => p.outcome === "pending" || !p.outcome);
    const won     = recent.filter(p => p.outcome === "won");
    const lost    = recent.filter(p => p.outcome === "lost");

    const sumFee = (list: PricingProposal[]) =>
      list.reduce((s, p) => s + propNet1Total(p), 0);

    const decided = won.length + lost.length;
    const winRate = decided > 0 ? Math.round((won.length / decided) * 100) : 0;

    return {
      total: recent.length,
      pendingCount: pending.length,
      pendingValue: sumFee(pending),
      // Expose the actual TBD rows so the dashboard can list them below
      // the Pending/Won/Lost summary. Sorted most-recent-first so the
      // card always shows the freshest cases awaiting a decision.
      pendingList: [...pending].sort((a, b) =>
        String(b.proposal_date ?? "").localeCompare(String(a.proposal_date ?? ""))
      ),
      wonCount: won.length,
      wonValue:  sumFee(won),
      lostCount: lost.length,
      lostValue: sumFee(lost),
      winRate,
    };
  }, [proposals, dashNet1Map]);

  // ─── 4-month capacity gap from Gantt data ────────────────────────────
  // For each of the next 4 calendar months compute: committed FTE demand
  // (won proposals active that month × team_size), pipeline demand
  // (pending × team_size × win_prob), and gap vs current headcount.
  const capacityByMonth = useMemo(() => {
    const today = new Date();
    const months: { label: string; start: Date; end: Date }[] = [];
    for (let m = 0; m < 4; m++) {
      const d = new Date(today.getFullYear(), today.getMonth() + m, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      months.push({
        label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
        start: d,
        end,
      });
    }

    const allProps: PricingProposal[] = proposals.filter(p =>
      !p.excluded_from_analysis
    );

    return months.map(({ label, start, end }) => {
      let committed = 0;
      let pipeline = 0;

      for (const p of allProps) {
        const pStart = p.start_date ? new Date(p.start_date) : (p.proposal_date ? new Date(p.proposal_date) : null);
        const pEnd = p.end_date ? new Date(p.end_date) : (pStart && p.duration_weeks ? new Date(pStart.getTime() + p.duration_weeks * 7 * 86_400_000) : null);
        if (!pStart || !pEnd) continue;
        // Active during month if they overlap
        if (pEnd < start || pStart > end) continue;

        const teamLen = Array.isArray(p.team_members) ? p.team_members.length : 0;
        const slots = Math.max(1, teamLen);

        if (p.outcome === "won") {
          committed += slots;
        } else if (p.outcome === "pending" || !p.outcome) {
          const wp = typeof p.win_probability === "number"
            ? Math.max(0, Math.min(1, p.win_probability / 100))
            : 0.5;
          pipeline += slots * wp;
        }
      }

      const supply = hr.headcount;
      const totalDemand = committed + pipeline;
      const gap = totalDemand - supply;
      const status: "ok" | "tight" | "over" =
        gap <= 0 ? "ok" : gap < 2 ? "tight" : "over";

      return { label, committed: Math.round(committed), pipeline: Math.round(pipeline * 10) / 10, gap: Math.round(gap * 10) / 10, status };
    });
  }, [proposals, hr.headcount]);

  // ─── Active projects from wonProjects ────────────────────────────────
  const active = useMemo(() => {
    // Treat null/missing status as "active" — the DB default is 'active' and
    // null should never occur, but this guards against stale pre-migration rows.
    const list = wonProjects.filter(p => {
      const s = (p.status ?? "active").toLowerCase();
      return s === "active";
    });
    const value = list.reduce((s, p) => s + toEUR(p.total_amount, p.currency), 0);
    return { count: list.length, value };
  }, [wonProjects]);

  // ─── Ongoing projects from pricing_proposals (won + end_date in future) ───
  // A proposal becomes "ongoing" once the user enters an end_date that's in
  // the future. Independent of the won_projects table — the user enters
  // end_date / manager / team directly on the past-projects row.
  const ongoing = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const list = proposals
      .filter(p => p.outcome === "won" && p.end_date && p.end_date >= todayIso)
      .sort((a, b) => String(a.end_date ?? "").localeCompare(String(b.end_date ?? "")));
    const totalValue = list.reduce((s, p) => s + propNet1Total(p), 0);
    // "Needs invoice" = no last_invoice_at OR last_invoice_at >30d ago
    const todayMs = Date.now();
    const needsInvoice = list.filter(p => {
      if (!p.last_invoice_at) return true;
      const last = new Date(p.last_invoice_at).getTime();
      if (isNaN(last)) return true;
      return (todayMs - last) > 30 * 86_400_000;
    });
    return { list, count: list.length, totalValue, needsInvoice };
  }, [proposals, dashNet1Map]);

  // ─── Capacity gap calculator ─────────────────────────────────────────
  // Supply = current headcount (all employees treated as billable consultants).
  // Committed demand = active ongoing projects (each assumed min 1 consultant;
  //   use team_members.length when populated, otherwise fall back to 1).
  // Pipeline demand = pending proposals weighted at 50% probability × 1 consultant slot.
  // Gap = (committed + weighted_pipeline) - supply
  const capacity = useMemo(() => {
    const supply = hr.headcount;

    // Committed: each ongoing project with a team list uses team.length;
    // projects with no team data default to 1 slot each.
    const committedSlots = ongoing.list.reduce((sum, p) => {
      const teamLen = Array.isArray(p.team_members) ? p.team_members.length : 0;
      return sum + Math.max(1, teamLen);
    }, 0);

    // Pipeline weighted by each proposal's actual win_probability when
    // present, falling back to 50% only when the user hasn't set one.
    // Previously every pending proposal counted at flat 50% regardless
    // of how likely the deal was.
    const pipeline = bd.pendingList;
    const pipelineWeightedSlots = pipeline.reduce((sum, p) => {
      const teamLen = Array.isArray(p.team_members) ? p.team_members.length : 0;
      const slots = Math.max(1, teamLen);
      const wpRaw = p.win_probability;
      // win_probability is stored 0–100 (percent). Coerce + clamp.
      const wp = (typeof wpRaw === "number" && isFinite(wpRaw))
        ? Math.max(0, Math.min(1, wpRaw / 100))
        : 0.5;
      return sum + slots * wp;
    }, 0);

    const totalDemand   = committedSlots + pipelineWeightedSlots;
    const gap           = totalDemand - supply;
    const utilisation   = supply > 0 ? Math.round((committedSlots / supply) * 100) : 0;
    const gapStatus: "ok" | "tight" | "over" =
      gap <= 0  ? "ok"    :
      gap < 2   ? "tight" :
                  "over";

    return { supply, committedSlots, pipelineWeightedSlots, totalDemand, gap, utilisation, gapStatus };
  }, [hr.headcount, ongoing.list, bd.pendingList]);

  // ─── Attrition / churn risk per employee (numerical formula) ─────────
  // Score 0-100. Signals and their weights:
  //   Promotion overdue >30mo   +35
  //   Promotion overdue >24mo   +25
  //   Performance <6.5          +25
  //   Performance 6.5-7.0       +10
  //   HR events (complaints)    +20 per high-severity, +10 medium, +5 low
  //   New hire <6mo             +10
  //   No rating in 90d          +10
  // Risk level:  HIGH ≥50 · MEDIUM 25-49 · LOW <25
  const churnRisk = useMemo(() => {
    const today = new Date();

    type RiskRow = {
      id: string; name: string; role: string;
      signals: string[]; score: number; level: "high" | "medium" | "low";
    };

    const activeOnly = employees.filter(e => ((e as any).status ?? "active") !== "former");

    return activeOnly.map((emp): RiskRow => {
      const signals: string[] = [];
      let score = 0;

      // 1. Months since last promotion
      const promoDate = emp.last_promo_date
        ? new Date(emp.last_promo_date)
        : emp.hire_date ? new Date(emp.hire_date + "-01") : null;
      if (promoDate && !isNaN(promoDate.getTime())) {
        const monthsSince = (today.getTime() - promoDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        if (monthsSince > 30) { score += 35; signals.push(`${Math.round(monthsSince)}mo without promotion`); }
        else if (monthsSince > 24) { score += 25; signals.push(`${Math.round(monthsSince)}mo without promotion`); }
      }

      // 2. Performance score
      const perf = emp.performance_score;
      if (typeof perf === "number") {
        if (perf < 6.5) { score += 25; signals.push(`performance ${perf.toFixed(1)}/10`); }
        else if (perf < 7.0) { score += 10; signals.push(`performance ${perf.toFixed(1)}/10 (borderline)`); }
      }

      // 3. HR events (complaints, absence concerns)
      const hrEvents = (emp as any).hr_events ?? [];
      let hrEventScore = 0;
      const hrEventSummary: string[] = [];
      for (const ev of hrEvents) {
        if (ev.type === "complaint" || ev.type === "absence_concern" || ev.type === "performance_concern") {
          const pts = ev.severity === "high" ? 20 : ev.severity === "medium" ? 10 : 5;
          hrEventScore += pts;
          hrEventSummary.push(ev.type.replace(/_/g, " "));
        }
      }
      if (hrEventScore > 0) {
        score += Math.min(hrEventScore, 40); // cap HR events contribution
        signals.push(`${hrEvents.filter((e: any) => ["complaint","absence_concern","performance_concern"].includes(e.type)).length} HR event(s): ${[...new Set(hrEventSummary)].join(", ")}`);
      }

      // 4. New-hire onboarding risk (first 6 months)
      const hireParts = emp.hire_date?.split("-").map(Number) ?? [];
      if (hireParts.length >= 2) {
        const hireDate = new Date(hireParts[0], hireParts[1] - 1, 1);
        const tenureMonths = (today.getTime() - hireDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        if (tenureMonths < 6) { score += 10; signals.push(`new hire (${Math.round(tenureMonths)}mo)`); }
      }

      // 5. No rating in last 90 days → disengagement signal
      const ratings = emp.monthly_ratings ?? [];
      const cutoff = new Date(today); cutoff.setDate(today.getDate() - 90);
      const cutoffStr = cutoff.toISOString().slice(0, 7);
      const hasRecentRating = ratings.some((r: any) => String(r.month ?? r.date ?? "").slice(0, 7) >= cutoffStr);
      if (ratings.length > 0 && !hasRecentRating) { score += 10; signals.push("no recent rating (>90d)"); }

      score = Math.min(100, score);
      const level: "high" | "medium" | "low" =
        score >= 50 ? "high" :
        score >= 25 ? "medium" :
        "low";

      return { id: emp.id, name: emp.name, role: emp.current_role_code, signals, score, level };
    }).filter(r => r.level !== "low");
  }, [employees]);

  // ─── Employee tasks ───────────────────────────────────────────────────
  const [employeeTasks, setEmployeeTasks] = useState<any[]>([]);
  const [taskLoadFailed, setTaskLoadFailed] = useState(false);
  useEffect(() => {
    fetch("/api/employee-tasks", { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setEmployeeTasks(Array.isArray(d) ? d : []); setTaskLoadFailed(false); })
      .catch(() => setTaskLoadFailed(true));
  }, []);

  const overdueTasks = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return employeeTasks
      .filter(t => t.status !== "done" && t.deadline && t.deadline < todayStr)
      .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)));
  }, [employeeTasks]);

  // ─── Candidates missing key tests ────────────────────────────────────
  // ─── Top Tier 1 candidates ───────────────────────────────────────────
  const topTier1 = useMemo(() => {
    const TIER1 = { logic: 78, verbal: 100, testgorilla: 71, intro_call: 50, case_study: 60 };
    const ACTIVE = new Set(["potential", "after_intro", "after_csi_asc", "after_csi_lm"]);
    const WEIGHTS = { logic: 15, verbal: 10, testgorilla: 15, intro_call: 10, case_study: 15 };

    return candidates
      .filter(c => ACTIVE.has(c.stage ?? "") && c.stage !== "out")
      .map(c => {
        const sc = c.scores ?? {};
        const row = {
          logic:      c.logic_pct ?? sc.hsa ?? null,
          verbal:     c.verbal_pct ?? null,
          testgorilla: sc.testgorilla ?? null,
          intro_call:  sc.intro_call ?? c.intro_rate_pct ?? null,
          case_study:  sc.case_study ?? c.cs_rate_pct ?? null,
        };
        // Tier 1: all present scores must meet thresholds (missing = optimistic pass)
        const isTier1 = (Object.keys(TIER1) as (keyof typeof TIER1)[]).every(f => {
          const v = row[f as keyof typeof row];
          return typeof v !== "number" || v >= TIER1[f];
        });
        // Composite over available scores
        let totalW = 0, weighted = 0;
        for (const [k, w] of Object.entries(WEIGHTS)) {
          const v = row[k as keyof typeof row];
          if (typeof v === "number" && !isNaN(v)) { weighted += v * w; totalW += w; }
        }
        const composite = totalW > 0 ? Math.round(weighted / totalW) : null;
        return { c, row, isTier1, composite };
      })
      .filter(x => x.isTier1)
      .sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0))
      .slice(0, 3);
  }, [candidates]);

  const needsTests = useMemo(() => {
    const ACTIVE_STAGES = new Set(["potential", "after_intro", "after_csi_asc", "after_csi_lm"]);
    return candidates
      .filter(c => ACTIVE_STAGES.has(c.stage ?? ""))
      .map(c => {
        const sc = (c as any).scores ?? {};
        const missing: string[] = [];
        // logic / verbal — expected once a candidate enters the funnel
        if ((c as any).logic_pct == null && sc.hsa == null) missing.push("Logic");
        if ((c as any).verbal_pct == null) missing.push("Verbal");
        // TestGorilla expected by after_intro stage
        if (c.stage !== "potential" && sc.testgorilla == null) missing.push("TestGorilla");
        // intro call score expected once past potential
        if (c.stage !== "potential" && sc.intro_call == null) missing.push("Intro call");
        // case study expected at CSI stages
        if ((c.stage === "after_csi_asc" || c.stage === "after_csi_lm") && sc.case_study == null) missing.push("Case study");
        return { id: c.id, name: c.name, stage: c.stage, missing };
      })
      .filter(c => c.missing.length > 0);
  }, [candidates]);

  // ─── Recent BD activity — merged proposals + cases, deduplicated ─────
  // Proposals and pricing cases represent the same business concept (a
  // commercial opportunity). We merge both, add any case that has no
  // matching proposal yet, then deduplicate by client+project keeping
  // the best outcome per project (won > lost > pending/TBD).
  const recentBD = useMemo(() => {
    const outcomeRank = (o: string | null | undefined) =>
      o === "won" ? 3 : o === "lost" ? 2 : 1;

    // Pricing cases that aren't already represented by any proposal row
    const proposalKeys = new Set(
      proposals.map(p =>
        `${(p.client_name ?? "").toLowerCase()}::${(p.project_name ?? "").toLowerCase()}`
      )
    );
    const casesOnly: PricingProposal[] = (pricingCases as any[])
      .filter(c => {
        const key = `${(c.client_name ?? "").toLowerCase()}::${(c.project_name ?? "").toLowerCase()}`;
        return c.project_name && !proposalKeys.has(key);
      })
      .map(c => ({
        id: -(c.id as number),
        project_name: c.project_name ?? null,
        client_name: c.client_name ?? null,
        total_fee: c.total_fee ?? null,
        weekly_price: 0,
        duration_weeks: c.duration_weeks ?? null,
        outcome: (c.status === "final" ? "won" : c.status === "lost" ? "lost" : "pending") as PricingProposal["outcome"],
        proposal_date: c.created_at ?? null,
        region: null,
        currency: c.currency ?? null,
      }));

    // Deduplicate: for each client+project keep the row with the best outcome
    const byKey = new Map<string, PricingProposal>();
    for (const p of [...proposals, ...casesOnly]) {
      const key = `${(p.client_name ?? "").toLowerCase()}::${(p.project_name ?? "").toLowerCase()}`;
      const existing = byKey.get(key);
      if (!existing || outcomeRank(p.outcome) > outcomeRank(existing.outcome)) {
        byKey.set(key, p);
      }
    }

    return Array.from(byKey.values())
      .sort((a, b) => String(b.proposal_date ?? "").localeCompare(String(a.proposal_date ?? "")))
      .slice(0, 8);
  }, [proposals, pricingCases]);

  const maxFunnel = Math.max(1, hiring.potential, hiring.after_intro, hiring.after_csi_asc, hiring.after_csi_lm, hiring.hired, hiring.out);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <PageHeader
        title="Executive Dashboard"
        description={
          lastFetch
            ? `Live rollup across HR, Hiring, AR and BD — refreshed ${lastFetch.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Loading live data…"
        }
      />

      {/* ── Row 1: Headline KPIs ──────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Headcount"       value={String(hr.headcount)}      sub={`${hr.birthdays} birthday${hr.birthdays === 1 ? "" : "s"} in 30d`} icon={Users}      tone="blue"    href="/" />
        <Kpi label="Monthly payroll" value={eur(hr.monthlyPayroll)}    sub={`avg ${eur(hr.avgSalary)}`}    icon={DollarSign} tone="slate"   href="/employees" />
        <Kpi label="Active candidates" value={String(hiring.active)}   sub={`${hiring.potential} new potential · ${hiring.hired} hired`} icon={UserCheck} tone="violet" href="/hiring" />
        <Kpi label="AR outstanding"  value={eur(ar.outstanding)}       sub={`${ar.openCount} open · USD→EUR at 0.93`} icon={Receipt}   tone="amber"   href="/invoicing" />
        <Kpi label="AR overdue"      value={eur(ar.overdue)}           sub={`${ar.overdueCount} invoice${ar.overdueCount === 1 ? "" : "s"} · ${eur(ar.overdue60)} > 60d · USD@0.93`} icon={AlertCircle} tone={ar.overdue > 0 ? "red" : "emerald"} href="/invoicing" />
        <Kpi label="Active projects" value={String(ongoing.count)}     sub={eur(ongoing.totalValue)}       icon={Briefcase}  tone="emerald" href="/bd" />
      </div>

      {/* ── Next Payment Rounds (5th & 15th) ─────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {paymentRounds.map((round, idx) => (
          <Card key={round.label} className="p-4 bg-blue-50 ring-1 ring-blue-200 border-0 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">
                  Payment Round {idx + 1}
                </div>
                <div className="text-xl font-bold text-blue-800">{round.label}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {round.count} invoice{round.count !== 1 ? "s" : ""} due
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setRoundDetailIdx(idx)}
                  className="w-7 h-7 rounded-full bg-blue-100 hover:bg-blue-200 flex items-center justify-center transition-colors"
                  title="Show invoice breakdown"
                >
                  <Info className="w-4 h-4 text-blue-600" />
                </button>
                <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["eur", "usd"] as const).map(ccy => {
                const dateKey = round.date.toISOString().slice(0, 10);
                const ovr = paymentRoundOverrides[dateKey];
                const autoVal = ccy === "eur" ? round.eur_total : round.usd_total;
                const overridden = ovr?.[ccy] != null;
                const displayVal = overridden ? (ovr![ccy] as number) : autoVal;
                const isEditing = overrideEdit?.roundIdx === idx && overrideEdit?.currency === ccy;
                const symbol = ccy === "eur" ? "€" : "$";
                return (
                  <div
                    key={ccy}
                    className={`rounded border p-2.5 cursor-text transition-colors ${overridden ? "bg-amber-50/80 border-amber-300 hover:bg-amber-50" : "bg-white/70 border-blue-100 hover:bg-white/90"}`}
                    onClick={() => { if (!isEditing) setOverrideEdit({ roundIdx: idx, currency: ccy }); }}
                    title="Click to override"
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide">{ccy.toUpperCase()}</div>
                      {overridden
                        ? <span className="text-[8px] text-amber-600 font-bold uppercase tracking-wide cursor-pointer hover:text-red-500" title="Clear manual override" onClick={e => { e.stopPropagation(); saveOverride(round.date, ccy, ""); }}>manual ×</span>
                        : <Pencil className="w-2.5 h-2.5 text-blue-200 group-hover:text-blue-400" />
                      }
                    </div>
                    {isEditing ? (
                      <input
                        autoFocus
                        type="text"
                        inputMode="numeric"
                        className="w-full text-xl font-bold tabular-nums text-blue-900 bg-transparent border-b border-blue-400 outline-none"
                        defaultValue={displayVal > 0 ? String(Math.round(displayVal)) : ""}
                        placeholder="0"
                        onBlur={e => saveOverride(round.date, ccy, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setOverrideEdit(null);
                        }}
                      />
                    ) : (
                      <div className="text-xl font-bold tabular-nums text-blue-900" data-privacy="blur">
                        {displayVal > 0 ? `${symbol}${Math.round(displayVal).toLocaleString("it-IT")}` : "—"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      {/* ── Payment Round detail popup ────────────────────────────────── */}
      {roundDetailIdx !== null && paymentRounds[roundDetailIdx] && (() => {
        const round = paymentRounds[roundDetailIdx];
        return (
          <Dialog open onOpenChange={() => setRoundDetailIdx(null)}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  Payment Round {roundDetailIdx + 1} — {round.label}
                </DialogTitle>
              </DialogHeader>
              <p className="text-[12px] text-muted-foreground -mt-1 mb-3">
                All open/partial invoices due on or before this payment date.
                {roundDetailIdx > 0 && " (Excludes invoices already in Round 1.)"}
              </p>
              {round.invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices due for this round.</p>
              ) : (
                <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {round.invoices.map(inv => {
                    const amt = Number(inv.due_amount ?? inv.amount ?? 0);
                    const currency = (inv.currency ?? "EUR").toUpperCase();
                    const symbol = currency === "USD" ? "$" : "€";
                    return (
                      <div key={inv.id} className="flex items-center justify-between gap-3 bg-muted/40 rounded px-3 py-2 text-sm">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium truncate block">{inv.client?.name ?? "—"}</span>
                          <span className="text-[11px] text-muted-foreground">
                            #{inv.number}
                            {inv.due_date ? ` · due ${new Date(inv.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                            {" · "}<span className="capitalize">{inv.state}</span>
                          </span>
                        </div>
                        <div className="font-semibold tabular-nums shrink-0" data-privacy="blur">
                          {symbol}{Math.round(amt).toLocaleString("it-IT")} <span className="text-[10px] font-normal text-muted-foreground">{currency}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {(() => {
                const dateKey = round.date.toISOString().slice(0, 10);
                const ovr = paymentRoundOverrides[dateKey];
                const dispEur = ovr?.eur != null ? ovr.eur : round.eur_total;
                const dispUsd = ovr?.usd != null ? ovr.usd : round.usd_total;
                const eurOverridden = ovr?.eur != null;
                const usdOverridden = ovr?.usd != null;
                return (
                  <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2 text-sm">
                    {(dispEur > 0 || eurOverridden) && (
                      <div className={`rounded p-2 text-center ${eurOverridden ? "bg-amber-50 border border-amber-200" : "bg-blue-50"}`}>
                        <div className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide">
                          EUR total{eurOverridden && " ✎"}
                        </div>
                        <div className="font-bold text-blue-900 tabular-nums" data-privacy="blur">
                          €{Math.round(dispEur).toLocaleString("it-IT")}
                        </div>
                        {eurOverridden && <div className="text-[9px] text-amber-500 mt-0.5">manual override · auto: €{Math.round(round.eur_total).toLocaleString("it-IT")}</div>}
                      </div>
                    )}
                    {(dispUsd > 0 || usdOverridden) && (
                      <div className={`rounded p-2 text-center ${usdOverridden ? "bg-amber-50 border border-amber-200" : "bg-blue-50"}`}>
                        <div className="text-[10px] text-blue-600 font-semibold uppercase tracking-wide">
                          USD total{usdOverridden && " ✎"}
                        </div>
                        <div className="font-bold text-blue-900 tabular-nums" data-privacy="blur">
                          ${Math.round(dispUsd).toLocaleString("it-IT")}
                        </div>
                        {usdOverridden && <div className="text-[9px] text-amber-500 mt-0.5">manual override · auto: ${Math.round(round.usd_total).toLocaleString("it-IT")}</div>}
                      </div>
                    )}
                  </div>
                );
              })()}
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ── Ongoing Projects (proposals with end_date in the future) ─── */}
      {ongoing.list.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                <Briefcase className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Ongoing projects</h3>
                <p className="text-[11px] text-muted-foreground">
                  Won deals with an end_date in the future. Edit end_date / manager / team on the past-projects row.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">{ongoing.count} ongoing · <span data-privacy="blur">{eur(ongoing.totalValue)}</span></span>
              {ongoing.needsInvoice.length > 0 && (
                <Badge variant="destructive" className="text-[10px]">
                  {ongoing.needsInvoice.length} need invoice
                </Badge>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase text-muted-foreground tracking-wide">
                <tr className="border-b">
                  <th className="py-2 pr-3">Project</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">End date</th>
                  <th className="py-2 pr-3 text-right">Wks left</th>
                  <th className="py-2 pr-3">Manager</th>
                  <th className="py-2 pr-3">Team</th>
                  <th className="py-2 pr-3 text-right">Total fee</th>
                  <th className="py-2 pr-3">Last invoice</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {ongoing.list.map(p => {
                  const today = new Date();
                  const end = p.end_date ? new Date(p.end_date) : null;
                  const wksLeft = end ? Math.max(0, Math.round((end.getTime() - today.getTime()) / (7 * 86_400_000))) : null;
                  const lastInv = p.last_invoice_at ? new Date(p.last_invoice_at) : null;
                  const daysSinceInv = lastInv ? Math.round((today.getTime() - lastInv.getTime()) / 86_400_000) : null;
                  const needsInvoice = !lastInv || (daysSinceInv != null && daysSinceInv > 30);
                  return (
                    <tr key={p.id} className="group border-b last:border-0 hover:bg-muted/30">
                      <td className="py-1.5 pr-3 font-mono font-semibold">
                        <a href="/pricing" className="hover:underline">{p.project_name}</a>
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{p.client_name || "—"}</td>
                      <td className="py-1.5 pr-3">{p.end_date ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums" data-privacy="blur">{wksLeft ?? "—"}</td>

                      {editingProjectId === p.id ? (
                        <>
                          <td className="py-1 pr-3">
                            <input
                              className="border rounded px-1.5 py-0.5 text-xs w-28"
                              value={editManager}
                              onChange={e => setEditManager(e.target.value)}
                              placeholder="Manager name"
                            />
                          </td>
                          <td className="py-1 pr-3">
                            <div className="flex flex-col gap-1">
                              {editTeam.map((m, i) => (
                                <div key={i} className="flex items-center gap-1">
                                  <input
                                    className="border rounded px-1 py-0.5 text-xs w-16"
                                    value={m.role}
                                    onChange={e => setEditTeam(t => t.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}
                                    placeholder="Role"
                                  />
                                  <input
                                    className="border rounded px-1 py-0.5 text-xs w-24"
                                    value={m.name}
                                    onChange={e => setEditTeam(t => t.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                                    placeholder="Name"
                                  />
                                  <button onClick={() => setEditTeam(t => t.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                              <button
                                onClick={() => setEditTeam(t => [...t, { role: "", name: "" }])}
                                className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-0.5 mt-0.5"
                              >
                                <Plus className="w-3 h-3" /> Add
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-1.5 pr-3">{p.manager_name || <span className="text-muted-foreground italic">—</span>}</td>
                          <td className="py-1.5 pr-3 max-w-xs">
                            {p.team_members && p.team_members.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {p.team_members.map((m, i) => (
                                  <Badge key={i} variant="outline" className="text-[10px] py-0 h-5">
                                    {m.role ? `${m.role}: ` : ""}{m.name || "?"}
                                  </Badge>
                                ))}
                              </div>
                            ) : <span className="text-muted-foreground italic">—</span>}
                          </td>
                        </>
                      )}
                      <td className="py-1.5 pr-3 text-right font-mono" data-privacy="blur">
                        {propNet1Total(p) > 0 ? eur(propNet1Total(p)) : "—"}
                      </td>
                      <td className="py-1.5 pr-3">
                        {lastInv ? (
                          <span className={needsInvoice ? "text-amber-600 font-semibold" : "text-muted-foreground"}>
                            {p.last_invoice_at} {needsInvoice && <span className="ml-1">⚠️ {daysSinceInv}d</span>}
                          </span>
                        ) : (
                          <Badge variant="destructive" className="text-[9px] py-0 h-4">never invoiced</Badge>
                        )}
                      </td>
                      <td className="py-1.5 pl-1">
                        {editingProjectId === p.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => saveEdit(p.id)} className="text-emerald-600 hover:text-emerald-800" title="Save">
                              <Save className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={cancelEdit} className="text-muted-foreground hover:text-foreground" title="Cancel">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => startEdit(p)} className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity" title="Edit team">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-[10px] text-muted-foreground">
            ⚠️ = last invoice &gt;30 days ago. Edit invoice date on the past-project row in /pricing.
          </div>
        </Card>
      )}

      {/* ── Capacity Gap Calculator ──────────────────────────────── */}
      <Card className={`p-4 border-2 ${
        capacity.gapStatus === "over"  ? "border-red-300 bg-red-50/30"
        : capacity.gapStatus === "tight" ? "border-amber-300 bg-amber-50/30"
        : "border-emerald-300 bg-emerald-50/30"
      }`}>
        <div className="flex items-center gap-2 mb-4">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            capacity.gapStatus === "over"  ? "bg-red-100"
            : capacity.gapStatus === "tight" ? "bg-amber-100"
            : "bg-emerald-100"
          }`}>
            <Layers className={`w-4 h-4 ${
              capacity.gapStatus === "over"  ? "text-red-600"
              : capacity.gapStatus === "tight" ? "text-amber-600"
              : "text-emerald-600"
            }`} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Capacity Gap Calculator</h3>
            <p className="text-[11px] text-muted-foreground">
              Current supply vs. committed + probability-weighted pipeline demand
            </p>
          </div>
          <Badge variant="outline" className={`ml-auto text-xs ${
            capacity.gapStatus === "over"  ? "border-red-400 text-red-700 bg-red-50"
            : capacity.gapStatus === "tight" ? "border-amber-400 text-amber-700 bg-amber-50"
            : "border-emerald-400 text-emerald-700 bg-emerald-50"
          }`}>
            {capacity.gapStatus === "over"  ? "⚠ Capacity risk"
            : capacity.gapStatus === "tight" ? "↑ Getting tight"
            : "✓ Sufficient"}
          </Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center mb-4">
          {[
            { label: "Supply (headcount)", value: capacity.supply, sub: "current consultants", tone: "blue" },
            { label: "Committed demand",   value: Math.round(capacity.committedSlots), sub: `${ongoing.count} active projects`, tone: "slate" },
            { label: "Pipeline demand (50%)", value: capacity.pipelineWeightedSlots.toFixed(1), sub: `${bd.pendingCount} pending proposals`, tone: "violet" },
            { label: "Net gap",            value: capacity.gap > 0 ? `+${capacity.gap.toFixed(1)}` : capacity.gap.toFixed(1), sub: capacity.gap > 0 ? "slots needed" : "slack available", tone: capacity.gapStatus === "over" ? "red" : capacity.gapStatus === "tight" ? "amber" : "emerald" },
          ].map(({ label, value, sub, tone }) => {
            const toneText: Record<string, string> = {
              blue: "text-blue-700", slate: "text-slate-700", violet: "text-violet-700",
              red: "text-red-700", amber: "text-amber-700", emerald: "text-emerald-700",
            };
            return (
              <div key={label} className="border rounded p-3 bg-background/80">
                <div className={`text-2xl font-bold tabular-nums ${toneText[tone] ?? ""}`} data-privacy="blur">{value}</div>
                <div className="text-[10px] font-semibold text-muted-foreground mt-0.5">{label}</div>
                <div className="text-[10px] text-muted-foreground">{sub}</div>
              </div>
            );
          })}
        </div>

        {/* Utilisation bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Current utilisation (committed only)</span>
            <span data-privacy="blur">{capacity.utilisation}%</span>
          </div>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                capacity.utilisation >= 100 ? "bg-red-500"
                : capacity.utilisation >= 80  ? "bg-amber-500"
                : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(100, capacity.utilisation)}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Each active project counts as ≥1 consultant slot. Pipeline deals use 50% probability.
            To adjust: update team lists on ongoing proposals or add probability to BD deals.
          </p>
        </div>

        {/* 4-month FTE gap table */}
        {capacityByMonth.length > 0 && (
          <div className="border-t pt-4 mt-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">FTE gap — next 4 months</p>
            <div className="grid grid-cols-4 gap-2">
              {capacityByMonth.map(m => (
                <div key={m.label} className={`rounded border p-2 text-center ${
                  m.status === "over"  ? "border-red-300 bg-red-50/40"
                  : m.status === "tight" ? "border-amber-300 bg-amber-50/40"
                  : "border-emerald-300 bg-emerald-50/40"
                }`}>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">{m.label}</div>
                  <div className={`text-lg font-bold tabular-nums ${
                    m.status === "over" ? "text-red-700" : m.status === "tight" ? "text-amber-700" : "text-emerald-700"
                  }`} data-privacy="blur">
                    {m.gap > 0 ? `+${m.gap}` : m.gap}
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    {m.committed}c + {m.pipeline}p vs {capacity.supply}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">c=committed, p=pipeline-weighted. Positive = need to hire.</p>
          </div>
        )}
      </Card>

      {/* ── Row 2: Hiring funnel + Top overdue invoices ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Hiring funnel */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                <UserCheck className="w-4 h-4 text-violet-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Hiring pipeline</h3>
                <p className="text-[11px] text-muted-foreground">Active candidates by stage</p>
              </div>
            </div>
            <Link href="/hiring" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
              open <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          {hiring.total === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-6">No active candidates.</p>
          ) : (
            <div className="space-y-1.5">
              <FunnelRow label="Potential"      count={hiring.potential}     max={maxFunnel} tone="bg-blue-400" />
              <FunnelRow label="After Intro"    count={hiring.after_intro}   max={maxFunnel} tone="bg-violet-400" />
              <FunnelRow label="After CSI ASC"  count={hiring.after_csi_asc} max={maxFunnel} tone="bg-amber-400" />
              <FunnelRow label="After CSI LM"   count={hiring.after_csi_lm}  max={maxFunnel} tone="bg-emerald-500" />
              <FunnelRow label="Hired"           count={hiring.hired}         max={maxFunnel} tone="bg-green-500" />
              <FunnelRow label="Out"             count={hiring.out}           max={maxFunnel} tone="bg-red-400" />
              {hiring.namesAfterCsi.length > 0 && (
                <div className="mt-2 pt-2 border-t border-muted/40">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">To interview (after CSI)</p>
                  <div className="flex flex-wrap gap-1">
                    {hiring.namesAfterCsi.map((name, i) => (
                      <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Top overdue invoices */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                <AlertCircle className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Top overdue invoices</h3>
                <p className="text-[11px] text-muted-foreground">Highest unpaid balances</p>
              </div>
            </div>
            <Link href="/invoicing" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
              all <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          {(() => {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const overdueList = invoices
              .filter(i => {
                if ((i.state ?? "").toLowerCase() === "paid") return false;
                if (!i.due_date) return false;
                const d = new Date(i.due_date);
                return !isNaN(d.getTime()) && d < today;
              })
              .map(i => ({ ...i, dueEur: toEUR(i.due_amount ?? i.amount, i.currency) }))
              .sort((a, b) => b.dueEur - a.dueEur)
              .slice(0, 8);

            if (overdueList.length === 0) {
              return (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" /> No overdue invoices — nice.
                </div>
              );
            }
            return (
              <div className="space-y-1.5">
                {overdueList.map(i => {
                  const days = i.due_date
                    ? Math.floor((Date.now() - new Date(i.due_date).getTime()) / (1000 * 60 * 60 * 24))
                    : 0;
                  return (
                    <div key={i.id} className="flex items-center gap-2 text-xs py-1 border-b last:border-0 border-muted/40">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-red-50 border border-red-200 text-red-700 text-[9px] font-semibold uppercase">
                        {days}d
                      </span>
                      <span className="flex-1 truncate" title={`${i.client?.name ?? ""} — ${i.number}`}>
                        <span className="font-medium">{i.client?.name ?? "—"}</span>
                        <span className="text-muted-foreground"> · {i.number}</span>
                      </span>
                      <span className="font-mono font-semibold text-red-700 shrink-0" data-privacy="blur">
                        {eur(i.dueEur)}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </Card>
      </div>

      {/* ── Row 3: Proposals (merged summary + deal list) ────────── */}
      <Card className="p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Target className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Proposals</h3>
              <p className="text-[11px] text-muted-foreground">Last 12 months · win rate {bd.winRate}%</p>
            </div>
          </div>
          <Link href="/pricing" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
            open <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Stats row: TBD / WON / LOST + total in flight */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="flex-1 min-w-[90px] text-center p-3 bg-amber-50 rounded-lg border border-amber-100">
            <Clock className="w-4 h-4 text-amber-600 mx-auto mb-1" />
            <div className="text-[10px] text-amber-700 uppercase font-semibold">TBD</div>
            <div className="text-xl font-bold text-amber-700" data-privacy="blur">{bd.pendingCount}</div>
            <div className="text-[11px] text-amber-600" data-privacy="blur">{eur(bd.pendingValue)}</div>
          </div>
          <div className="flex-1 min-w-[90px] text-center p-3 bg-emerald-50 rounded-lg border border-emerald-100">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
            <div className="text-[10px] text-emerald-700 uppercase font-semibold">Won</div>
            <div className="text-xl font-bold text-emerald-700" data-privacy="blur">{bd.wonCount}</div>
            <div className="text-[11px] text-emerald-600" data-privacy="blur">{eur(bd.wonValue)}</div>
          </div>
          <div className="flex-1 min-w-[90px] text-center p-3 bg-red-50 rounded-lg border border-red-100">
            <TrendingDown className="w-4 h-4 text-red-600 mx-auto mb-1" />
            <div className="text-[10px] text-red-700 uppercase font-semibold">Lost</div>
            <div className="text-xl font-bold text-red-700" data-privacy="blur">{bd.lostCount}</div>
            <div className="text-[11px] text-red-600" data-privacy="blur">{eur(bd.lostValue)}</div>
          </div>
          <div className="flex-1 min-w-[140px] flex flex-col justify-center px-4 border-l border-muted">
            <div className="text-[10px] text-muted-foreground uppercase font-semibold">Total value in flight</div>
            <div className="text-2xl font-bold tabular-nums" data-privacy="blur">{eur(bd.pendingValue + bd.wonValue)}</div>
          </div>
        </div>

        {/* Two-column layout: TBD proposals left, Ongoing projects right */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
          {/* Left: TBD / pending proposals */}
          <div>
            <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide mb-2 flex items-center gap-1">
              <Clock className="w-3 h-3" /> TBD · {bd.pendingList.length}
            </div>
            {bd.pendingList.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No pending proposals.</p>
            ) : (
              <div>
                {bd.pendingList.slice(0, 8).map(p => (
                  <div key={p.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-muted/40 last:border-0">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[9px] font-semibold uppercase bg-amber-50 border-amber-200 text-amber-700 shrink-0">
                      tbd
                    </span>
                    <span className="flex-1 truncate" title={`${p.client_name ?? ""} — ${p.project_name ?? ""}`}>
                      <span className="font-medium">{p.client_name ?? "—"}</span>
                      <span className="text-muted-foreground"> · {p.project_name ?? ""}</span>
                    </span>
                    <span className="font-mono font-semibold text-foreground/80 shrink-0" data-privacy="blur">
                      {eur(propNet1Total(p))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Ongoing projects (won + end_date in future) */}
          <div>
            <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wide mb-2 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Ongoing · {ongoing.list.length}
            </div>
            {ongoing.list.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No ongoing projects.</p>
            ) : (
              <div>
                {ongoing.list.slice(0, 8).map(p => {
                  const todayMs = Date.now();
                  const end = p.end_date ? new Date(p.end_date) : null;
                  const wksLeft = end ? Math.max(0, Math.round((end.getTime() - todayMs) / (7 * 86_400_000))) : null;
                  return (
                    <div key={p.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-muted/40 last:border-0">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[9px] font-semibold uppercase bg-emerald-50 border-emerald-200 text-emerald-700 shrink-0">
                        live
                      </span>
                      <span className="flex-1 truncate" title={`${p.client_name ?? ""} — ${p.project_name ?? ""}`}>
                        <span className="font-medium">{p.client_name ?? "—"}</span>
                        <span className="text-muted-foreground"> · {p.project_name ?? ""}</span>
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {wksLeft != null ? `${wksLeft}w` : p.end_date ?? "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Commercial Options — three-timeline preview per active pricing case.
          Mirrors the block rendered inside each case so leadership sees the
          current Gross/Net alternatives at a glance without opening the
          deal. Only shows cases that have case_timelines populated (i.e.
          the user actively configured the three options). */}
      {(() => {
        const activeCases = pricingCases.filter(c =>
          Array.isArray(c.case_timelines) && c.case_timelines.length > 0
          && (c.status === "active" || c.status === "draft" || c.status === "pending"),
        );
        if (activeCases.length === 0) return null;
        const eur = (n: number) => "€" + Math.round(n).toLocaleString("it-IT");
        // Compute each column's net total using the same compound discount
        // arithmetic as the Pricing Case card (gross × ∏(1 − discPct)).
        // Weekly price is read from (in priority order):
        //   1. Stored recommendation.target_weekly  (set when PricingTool
        //      saves a case, AND now pinned by the EMV01 seed)
        //   2. Staffing build-up × 2.2× markup as a last-resort estimate
        //      (calibrated so a typical EMV-shaped team lands around the
        //      €30k/wk target rather than €27k — still a heuristic, not a
        //      substitute for a stored recommendation)
        // This avoids the "€0 everywhere" failure mode when a case hasn't
        // been opened in PricingTool yet.
        const deriveNetWeekly = (c: any): number => {
          const stored = c.recommendation?.target_weekly;
          if (typeof stored === "number" && stored > 0) return stored;
          const staffing = Array.isArray(c.staffing) ? c.staffing : [];
          // Fallback rate: line.daily_rate_used if > 0, else admin role's
          // default. Mirrors effectiveLineRate / pricingEngine.rateOf so
          // legacy drift (line.daily_rate_used = 0) doesn't silently
          // collapse the cost to 0.
          const rateOf = (l: any): number => {
            const stored = Number(l.daily_rate_used ?? 0);
            if (stored > 0) return stored;
            const role = pricingRoles.find(r => r.id === l.role_id);
            return role?.default_daily_rate ?? 0;
          };
          const cost = staffing.reduce((s: number, l: any) =>
            s + (l.days_per_week || 0) * rateOf(l) * (l.count || 0), 0);
          // 2.2× markup ~ 55% gross margin baseline.
          return Math.round(cost * 2.2);
        };
        const computeCols = (c: any) => {
          const wk = deriveNetWeekly(c);
          const adminPct = 8; // match PricingTool default
          const grossWk = Math.round(wk * (1 + adminPct / 100));
          const baseDiscounts = (c.case_discounts ?? []).filter((d: any) => d.enabled && d.pct > 0 && d.id !== "commitment");
          return c.case_timelines.map((t: any) => {
            const gross = grossWk * t.weeks;
            let net = gross;
            for (const d of baseDiscounts) net *= (1 - d.pct / 100);
            if (t.commitPct > 0) net *= (1 - t.commitPct / 100);
            return { weeks: t.weeks, commitPct: t.commitPct, gross: Math.round(gross), net: Math.round(net) };
          });
        };
        return (
          <div className="mt-6">
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-primary" />
                <h3 className="font-bold text-sm">Commercial Options · Active deals (three timelines each)</h3>
                <span className="text-[10px] text-muted-foreground ml-auto">{activeCases.length} case{activeCases.length !== 1 ? "s" : ""}</span>
              </div>
              <div className="space-y-3">
                {activeCases.map(c => {
                  const cols = computeCols(c);
                  return (
                    <div key={c.id} className="border rounded-lg p-3 bg-background">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <Link to="/pricing" className="font-bold text-sm hover:text-primary transition-colors">
                            {c.project_name} — {c.client_name}
                          </Link>
                          <span className="text-[10px] text-muted-foreground ml-2">
                            {c.region} · {c.revenue_band} · {c.pe_owned ? "PE" : "Corp"}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {cols.map((col, i) => (
                          <div key={i} className="rounded border bg-muted/10 p-2 text-center">
                            <div className="text-[10px] text-muted-foreground uppercase font-semibold">
                              {col.weeks} weeks{col.commitPct > 0 ? ` · −${col.commitPct}% commit` : ""}
                            </div>
                            <div className="text-[9px] text-muted-foreground font-mono" data-privacy="blur">
                              Gross {eur(col.gross)}
                            </div>
                            <div className="text-sm font-bold text-emerald-700 font-mono" data-privacy="blur">
                              Net {eur(col.net)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        );
      })()}

      {/* ── People Risk ──────────────────────────────────────────────
          Lives at the BOTTOM of the page — it's a CHRO concern, not a
          headline KPI. Excludes retired (status='former') employees. */}
      {churnRisk.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
              <TrendingDown className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">People Risk</h3>
              <p className="text-[11px] text-muted-foreground">
                Attrition / churn signals — {churnRisk.filter(r => r.level === "high").length} high, {churnRisk.filter(r => r.level === "medium").length} medium
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            {churnRisk.sort((a, b) => b.score - a.score).map(r => (
              <div key={r.id} className={`flex items-center gap-2 flex-wrap text-xs rounded px-2 py-1.5 ${
                r.level === "high" ? "bg-red-50 border border-red-200" : "bg-amber-50 border border-amber-200"
              }`}>
                <Badge variant="outline" className={`text-[10px] shrink-0 ${
                  r.level === "high" ? "border-red-400 text-red-700 bg-red-50" : "border-amber-400 text-amber-700 bg-amber-50"
                }`}>{r.level}</Badge>
                <span className={`font-mono text-[11px] font-bold shrink-0 ${r.level === "high" ? "text-red-700" : "text-amber-700"}`}>{r.score}</span>
                <span className="font-semibold" data-privacy="blur">{r.name}</span>
                <span className="text-muted-foreground">{r.role}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{r.signals.join(" · ")}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Score 0-100. Signals: promo overdue (+25-35), performance &lt;7 (+10-25), HR events/complaints (+5-20 each), new hire (+10), no recent rating (+10). HIGH ≥50, MEDIUM ≥25. CHRO owns resolution.
          </p>
        </Card>
      )}

      {/* ── Who Needs Tests + Overdue Tasks ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Tier 1 candidates */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <UserCheck className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Top Tier 1 candidates</h3>
                <p className="text-[11px] text-muted-foreground">Highest composite — meet all Tier 1 thresholds</p>
              </div>
            </div>
            <Link href="/hr/hiring/scoreboard" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
              scoreboard <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          {topTier1.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              No Tier 1 candidates yet.
            </div>
          ) : (
            <div className="space-y-3">
              {topTier1.map(({ c, row, composite }) => (
                <div key={c.id} className="border border-emerald-100 rounded-lg p-2.5 bg-emerald-50/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm" data-privacy="blur">{c.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">{c.stage?.replace(/_/g, " ")}</span>
                      {composite != null && (
                        <span className="text-[11px] font-mono font-bold text-emerald-700 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded">
                          {composite}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-1">
                    {([
                      { key: "logic",       label: "Logic" },
                      { key: "verbal",      label: "Verbal" },
                      { key: "testgorilla", label: "TG" },
                      { key: "intro_call",  label: "Intro" },
                      { key: "case_study",  label: "Case" },
                    ] as const).map(({ key, label }) => {
                      const v = row[key];
                      const color = v == null ? "bg-muted/30 text-muted-foreground" :
                        v >= 85 ? "bg-emerald-500 text-white" :
                        v >= 70 ? "bg-emerald-200 text-emerald-900" :
                        v >= 55 ? "bg-amber-200 text-amber-900" :
                        v >= 40 ? "bg-orange-300 text-orange-950" :
                        "bg-red-300 text-red-950";
                      return (
                        <div key={key} className="text-center">
                          <div className={`rounded text-[10px] font-semibold px-1 py-0.5 ${color}`} data-privacy="blur">
                            {v != null ? v : "—"}
                          </div>
                          <div className="text-[9px] text-muted-foreground mt-0.5">{label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Overdue tasks */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                <ClipboardList className="w-4 h-4 text-orange-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Overdue tasks</h3>
                <p className="text-[11px] text-muted-foreground">Pending tasks past their deadline</p>
              </div>
            </div>
            <Link href="/employees" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
              TDL <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          {taskLoadFailed ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-amber-600">
              Could not load tasks — check connection.
            </div>
          ) : overdueTasks.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-emerald-600">
              <CheckCircle2 className="w-4 h-4" /> No overdue tasks — great.
            </div>
          ) : (
            <div className="space-y-1.5">
              {overdueTasks.slice(0, 10).map(t => {
                const daysOver = t.deadline
                  ? Math.floor((Date.now() - new Date(t.deadline).getTime()) / 86_400_000)
                  : 0;
                const isVeryLate = daysOver > 7;
                return (
                  <div key={t.id} className="flex items-center gap-2 text-xs py-1 border-b last:border-0 border-muted/40">
                    <span className={`shrink-0 px-1.5 py-0.5 rounded-sm border text-[9px] font-semibold uppercase ${isVeryLate ? "bg-red-50 border-red-200 text-red-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
                      {daysOver}d
                    </span>
                    <span className="flex-1 truncate" data-privacy="blur">{t.title}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0 font-mono">{t.delegated_to}</span>
                  </div>
                );
              })}
              {overdueTasks.length > 10 && (
                <p className="text-[10px] text-muted-foreground text-right">+{overdueTasks.length - 10} more</p>
              )}
            </div>
          )}
        </Card>
      </div>

      {loading && (
        <p className="text-[11px] text-muted-foreground italic text-center">Loading live data…</p>
      )}
    </div>
  );
}
