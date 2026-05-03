import { useEffect, useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { Link } from "wouter";
import {
  Users, UserCheck, Receipt, DollarSign, TrendingUp, TrendingDown,
  AlertCircle, CheckCircle2, Clock, Briefcase,
  ArrowUpRight, Target, Layers,
} from "lucide-react";

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

// Minimal employee shape — only the fields used by ExecDashboard KPIs.
// Fetched directly from /api/employees so the dashboard is self-contained
// and doesn't rely on the app-level Zustand store being populated.
interface Employee {
  id: string;
  name: string;
  current_role_code: string | null;
  current_gross_fixed_year: number | null;
  meal_voucher_daily: number | null;
  date_of_birth: string | null;
  hire_date: string | null;
  last_promo_date: string | null;
  performance_score: number | null;
  monthly_ratings: { month?: string; date?: string }[];
}

interface Candidate {
  id: number;
  name: string;
  stage: string | null;
  sort_order?: number;
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
  start_date?: string | null;
  region: string | null;
  currency: string | null;
  end_date?: string | null;
  last_invoice_at?: string | null;
  manager_name?: string | null;
  team_members?: { role: string; name: string }[] | null;
  win_probability?: number | null;
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
// Bump the key any time the cache shape changes, to avoid stale data.
const DASH_CACHE_KEY = "exec_dashboard_cache_v3";

function readCache(): {
  employees: Employee[];
  candidates: Candidate[];
  invoices: Invoice[];
  proposals: PricingProposal[];
  ts: string;
} | null {
  try {
    const raw = localStorage.getItem(DASH_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeCache(
  employees: Employee[],
  candidates: Candidate[],
  invoices: Invoice[],
  proposals: PricingProposal[],
) {
  try {
    localStorage.setItem(
      DASH_CACHE_KEY,
      JSON.stringify({ employees, candidates, invoices, proposals, ts: new Date().toISOString() }),
    );
  } catch { /* quota exceeded — ignore */ }
}

export default function ExecDashboard() {
  // ── Instant render from localStorage cache, then refresh in background ──
  // ExecDashboard is FULLY SELF-CONTAINED — it fetches every data source it
  // needs directly (including /api/employees) rather than relying on the
  // app-level Zustand store. This prevents headcount/payroll showing 0 when
  // the store resets (e.g. Vite HMR) or when the dashboard is opened before
  // the store's loadData() completes.
  const cached = readCache();
  const [employees, setEmployees] = useState<Employee[]>(cached?.employees ?? []);
  const [candidates, setCandidates] = useState<Candidate[]>(cached?.candidates ?? []);
  const [invoices, setInvoices] = useState<Invoice[]>(cached?.invoices ?? []);
  const [proposals, setProposals] = useState<PricingProposal[]>(cached?.proposals ?? []);
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

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      // Only show spinner if there's no cached data — otherwise the page
      // already has content and we're just silently refreshing.
      if (!cached) setLoading(true);
      try {
        const [empRes, cRes, iRes, pRes, casesRes, settingsRes] = await Promise.all([
          fetch("/api/employees",          { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/hiring/candidates",  { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/harvest/invoices",   { credentials: "include" }).then(r => r.ok ? r.json().then(d => d.invoices ?? []) : []),
          fetch("/api/pricing/proposals",  { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/pricing/cases",      { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/pricing/settings",   { credentials: "include" }).then(r => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;
        const emp = Array.isArray(empRes) ? empRes : [];
        const c = Array.isArray(cRes) ? cRes : [];
        const i = Array.isArray(iRes) ? iRes : [];
        const p = Array.isArray(pRes) ? pRes : [];
        setEmployees(emp);
        setCandidates(c);
        setInvoices(i);
        setProposals(p);
        setPricingCases(Array.isArray(casesRes) ? casesRes : []);
        const roles = Array.isArray(settingsRes?.roles) ? settingsRes.roles : [];
        setPricingRoles(roles.map((r: any) => ({ id: r.id, default_daily_rate: Number(r.default_daily_rate ?? 0) })));
        setLastFetch(new Date());
        writeCache(emp, c, i, p);
      } catch (e) {
        console.error("[ExecDashboard] fetch failed", e);
      }
      if (!cancelled) setLoading(false);
    }
    fetchAll();
    return () => { cancelled = true; };
  }, []);

  // ─── HR rollup ────────────────────────────────────────────────────────
  // `employees` from useStore is already the active roster — the app has
  // no leave-date field, so we treat every row as active.
  const hr = useMemo(() => {
    const active = employees;
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
    return {
      total: candidates.length,
      potential:     byStage["potential"] ?? 0,
      after_intro:   byStage["after_intro"] ?? 0,
      after_csi_asc: byStage["after_csi_asc"] ?? 0,
      after_csi_lm:  byStage["after_csi_lm"] ?? 0,
      hired:         byStage["hired"] ?? 0,
      out:           byStage["out"] ?? 0,
      // Names of candidates past CSI ASC (for interview tracking)
      namesAfterCsi: [
        ...(namesByStage["after_csi_asc"] ?? []),
        ...(namesByStage["after_csi_lm"] ?? []),
      ],
    };
  }, [candidates]);

  // ─── AR rollup ────────────────────────────────────────────────────────
  const ar = useMemo(() => {
    const open = invoices.filter(i => (i.state ?? "").toLowerCase() !== "paid");
    const today = new Date(); today.setHours(0, 0, 0, 0);
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

  // NET1/wk: case lookup → total_fee/weeks → weekly_price (last resort only).
  // total_fee always stores NET1 total; weekly_price may be GROSS1 on older rows.
  const propNet1 = (p: PricingProposal): number => {
    const key = (p.project_name ?? "").trim().toLowerCase();
    const fromCase = dashNet1Map.get(key) ?? dashNet1Map.get(key.replace(/[a-z]+$/, ""));
    if (fromCase) return fromCase;
    if (p.total_fee && (p.duration_weeks ?? 0) > 0) return Math.round(p.total_fee / p.duration_weeks!);
    return p.weekly_price;
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

  // ─── Active projects from proposals (won) ────────────────────────────
  // Proposals are the single source of truth — wonProjects table is not used.
  const active = useMemo(() => {
    const list = proposals.filter(p => p.outcome === "won");
    const value = list.reduce((s, p) => s + propNet1Total(p), 0);
    return { count: list.length, value };
  }, [proposals, dashNet1Map]);

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
      const teamLen = Array.isArray((p as any).team_members) ? (p as any).team_members.length : 0;
      return sum + Math.max(1, teamLen);
    }, 0);

    // Pipeline weighted at default 50% probability (proposals don't carry probability).
    const pipeline = bd.pendingList;
    const pipelineWeightedSlots = pipeline.reduce((sum, p) => {
      const teamLen = Array.isArray((p as any).team_members) ? (p as any).team_members.length : 0;
      const slots = Math.max(1, teamLen);
      return sum + slots * 0.5; // 50% win probability
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

  // ─── Attrition / churn risk per employee ─────────────────────────────
  // Heuristics (none require external benchmarks):
  //   • months_since_promo > 24   → "Promo overdue" signal
  //   • performance_score < 6.5   → "Low performance" signal (risk: flight or PIP)
  //   • tenure_months < 6         → "Onboarding — settling" signal
  //   • no monthly_ratings entry in last 90d → "Disengaged" signal
  // Risk level:
  //   HIGH   = ≥2 signals OR promo_overdue + low_perf together
  //   MEDIUM = 1 signal
  //   LOW    = no signals
  const churnRisk = useMemo(() => {
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);

    type RiskRow = {
      id: string; name: string; role: string;
      signals: string[]; level: "high" | "medium" | "low";
    };

    return employees.map((emp): RiskRow => {
      const signals: string[] = [];

      // 1. Months since last promotion
      const promoDate = emp.last_promo_date
        ? new Date(emp.last_promo_date)
        : emp.hire_date ? new Date(emp.hire_date + "-01") : null;
      if (promoDate && !isNaN(promoDate.getTime())) {
        const monthsSince = (today.getTime() - promoDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        if (monthsSince > 24) signals.push(`${Math.round(monthsSince)}mo without promotion`);
      }

      // 2. Performance score
      const perf = emp.performance_score;
      if (typeof perf === "number" && perf < 6.5) signals.push(`performance ${perf.toFixed(1)}/10`);

      // 3. New-hire onboarding risk (first 6 months)
      const hireParts = emp.hire_date?.split("-").map(Number) ?? [];
      if (hireParts.length >= 2) {
        const hireDate = new Date(hireParts[0], hireParts[1] - 1, 1);
        const tenureMonths = (today.getTime() - hireDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        if (tenureMonths < 6) signals.push(`new hire (${Math.round(tenureMonths)}mo)`);
      }

      // 4. No rating in last 90 days → disengagement signal
      const ratings = emp.monthly_ratings ?? [];
      const cutoff = new Date(today); cutoff.setDate(today.getDate() - 90);
      const cutoffStr = cutoff.toISOString().slice(0, 7); // YYYY-MM
      const hasRecentRating = ratings.some((r: any) => String(r.month ?? r.date ?? "").slice(0, 7) >= cutoffStr);
      if (ratings.length > 0 && !hasRecentRating) signals.push("no recent rating (>90d)");

      void todayIso;
      const level: "high" | "medium" | "low" =
        signals.length >= 2 ? "high" :
        signals.length === 1 ? "medium" :
        "low";

      return { id: emp.id, name: emp.name, role: emp.current_role_code ?? "—", signals, level };
    }).filter(r => r.level !== "low");
  }, [employees]);

  // ─── All proposals sorted by date (TBD first, then most recent) ─────
  const allProposals = useMemo(() => {
    return [...proposals].sort((a, b) => {
      // TBD first, then Won, then Lost — within each group: newest first
      const order = (o: string | null | undefined) =>
        o === "pending" || !o ? 0 : o === "won" ? 1 : 2;
      const oDiff = order(a.outcome) - order(b.outcome);
      if (oDiff !== 0) return oDiff;
      return String(b.proposal_date ?? "").localeCompare(String(a.proposal_date ?? ""));
    });
  }, [proposals]);

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
        <Kpi label="Active candidates" value={String(hiring.total)}    sub={`${hiring.potential} new potential`} icon={UserCheck} tone="violet" href="/hiring" />
        <Kpi label="AR outstanding"  value={eur(ar.outstanding)}       sub={`${ar.openCount} open invoices`} icon={Receipt}   tone="amber"   href="/invoicing" />
        <Kpi label="AR overdue"      value={eur(ar.overdue)}           sub={`${ar.overdueCount} invoice${ar.overdueCount === 1 ? "" : "s"} · ${eur(ar.overdue60)} > 60d`} icon={AlertCircle} tone={ar.overdue > 0 ? "red" : "emerald"} href="/invoicing" />
        <Kpi label="Active projects" value={String(active.count)}      sub={eur(active.value)}             icon={Briefcase}  tone="emerald" href="/bd" />
      </div>

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
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-1.5 pr-3 font-mono font-semibold">
                        <a href="/pricing" className="hover:underline">{p.project_name}</a>
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{p.client_name || "—"}</td>
                      <td className="py-1.5 pr-3">{p.end_date ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums" data-privacy="blur">{wksLeft ?? "—"}</td>
                      <td className="py-1.5 pr-3">{p.manager_name || <span className="text-muted-foreground italic">—</span>}</td>
                      <td className="py-1.5 pr-3 max-w-xs">
                        {p.team_members && p.team_members.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {p.team_members.map((m, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] py-0 h-5">
                                {m.role || "?"}: {m.name || "?"}
                              </Badge>
                            ))}
                          </div>
                        ) : <span className="text-muted-foreground italic">—</span>}
                      </td>
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
      </Card>

      {/* ── People Risk ──────────────────────────────────────────── */}
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
            {churnRisk.sort((a, b) => (a.level === "high" ? 0 : 1) - (b.level === "high" ? 0 : 1)).map(r => (
              <div key={r.id} className={`flex items-center gap-2 flex-wrap text-xs rounded px-2 py-1.5 ${
                r.level === "high" ? "bg-red-50 border border-red-200" : "bg-amber-50 border border-amber-200"
              }`}>
                <Badge variant="outline" className={`text-[10px] shrink-0 ${
                  r.level === "high" ? "border-red-400 text-red-700 bg-red-50" : "border-amber-400 text-amber-700 bg-amber-50"
                }`}>{r.level}</Badge>
                <span className="font-semibold" data-privacy="blur">{r.name}</span>
                <span className="text-muted-foreground">{r.role}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{r.signals.join(" · ")}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Signals: promotion overdue (&gt;24mo), performance &lt;6.5, onboarding (&lt;6mo), no recent rating. CHRO owns resolution.
          </p>
        </Card>
      )}

      {/* ── Row 2: Hiring funnel + BD pipeline ───────────────────── */}
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

        {/* BD pipeline */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Target className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Pricing proposals</h3>
                <p className="text-[11px] text-muted-foreground">Last 12 months · win rate {bd.winRate}%</p>
              </div>
            </div>
            <Link href="/pricing" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
              open <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 bg-amber-50 rounded border border-amber-100">
              <Clock className="w-4 h-4 text-amber-600 mx-auto mb-1" />
              <div className="text-[10px] text-amber-700 uppercase font-semibold">TBD</div>
              <div className="text-lg font-bold text-amber-700" data-privacy="blur">{bd.pendingCount}</div>
              <div className="text-[10px] text-amber-600" data-privacy="blur">{eur(bd.pendingValue)}</div>
            </div>
            <div className="text-center p-2 bg-emerald-50 rounded border border-emerald-100">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
              <div className="text-[10px] text-emerald-700 uppercase font-semibold">Won</div>
              <div className="text-lg font-bold text-emerald-700" data-privacy="blur">{bd.wonCount}</div>
              <div className="text-[10px] text-emerald-600" data-privacy="blur">{eur(bd.wonValue)}</div>
            </div>
            <div className="text-center p-2 bg-red-50 rounded border border-red-100">
              <TrendingDown className="w-4 h-4 text-red-600 mx-auto mb-1" />
              <div className="text-[10px] text-red-700 uppercase font-semibold">Lost</div>
              <div className="text-lg font-bold text-red-700" data-privacy="blur">{bd.lostCount}</div>
              <div className="text-[10px] text-red-600" data-privacy="blur">{eur(bd.lostValue)}</div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Total value in flight</span>
            <span className="font-bold" data-privacy="blur">{eur(bd.pendingValue + bd.wonValue)}</span>
          </div>

          {/* TBD proposals list — every saved pricing case lands here with
              outcome="pending" until the user marks it Won/Lost. Rendered
              inside the Pricing proposals card so a leader scanning the
              dashboard sees which deals still need a decision, sorted
              most-recent first. */}
          {bd.pendingList.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 mb-2">
                TBD · awaiting decision ({bd.pendingList.length})
              </p>
              <div className="space-y-1">
                {bd.pendingList.slice(0, 6).map(p => (
                  <Link
                    key={p.id}
                    href="/pricing"
                    className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-amber-50 transition-colors"
                  >
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-amber-50 border border-amber-200 text-amber-700 text-[9px] font-semibold uppercase">
                      <Clock className="w-3 h-3" /> TBD
                    </span>
                    <span className="flex-1 truncate" title={`${p.client_name ?? ""} — ${p.project_name ?? ""}`}>
                      <span className="font-medium">{p.client_name ?? "—"}</span>
                      <span className="text-muted-foreground"> · {p.project_name ?? ""}</span>
                    </span>
                    <span className="font-mono font-semibold text-foreground/80 shrink-0" data-privacy="blur">
                      {eur(propNet1Total(p))}
                    </span>
                  </Link>
                ))}
                {bd.pendingList.length > 6 && (
                  <p className="text-[10px] text-muted-foreground italic px-2 pt-1">
                    +{bd.pendingList.length - 6} more — see Pricing
                  </p>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── All Proposals (single source of truth for projects) ──────── */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">All proposals</h3>
              <p className="text-[11px] text-muted-foreground">
                {allProposals.length} total · TBD first, then Won, then Lost
              </p>
            </div>
          </div>
          <Link href="/pricing" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
            manage <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        {allProposals.length === 0 ? (
          <p className="text-xs text-muted-foreground italic text-center py-6">No proposals yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase text-muted-foreground tracking-wide">
                <tr className="border-b">
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Project</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Start date</th>
                  <th className="py-2 pr-3">End date</th>
                  <th className="py-2 pr-3">Team booked</th>
                  <th className="py-2 text-right">NET1 total</th>
                </tr>
              </thead>
              <tbody>
                {allProposals.map(p => {
                  const isWon  = p.outcome === "won";
                  const isLost = p.outcome === "lost";
                  const isTbd  = !isWon && !isLost;
                  const rowCls = isWon ? "border-emerald-100" : isLost ? "border-red-100" : "border-amber-100";
                  const badgeCls = isWon
                    ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                    : isLost
                    ? "bg-red-50 border-red-200 text-red-700"
                    : "bg-amber-50 border-amber-200 text-amber-700";
                  const badgeIcon = isWon
                    ? <CheckCircle2 className="w-3 h-3" />
                    : isLost
                    ? <TrendingDown className="w-3 h-3" />
                    : <Clock className="w-3 h-3" />;
                  const badgeLabel = isWon ? "Won" : isLost ? "Lost" : "TBD";
                  const teamBooked = !!(p.manager_name || (p.team_members && p.team_members.length > 0));
                  const teamLabel = teamBooked
                    ? (p.manager_name ?? "") + (p.team_members && p.team_members.length > 0 ? ` +${p.team_members.length}` : "")
                    : null;
                  return (
                    <tr key={p.id} className={`border-b last:border-0 hover:bg-muted/20 ${rowCls}`}>
                      <td className="py-1.5 pr-3">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[9px] font-bold uppercase whitespace-nowrap ${badgeCls}`}>
                          {badgeIcon}{badgeLabel}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 font-mono font-semibold whitespace-nowrap">
                        <Link href="/pricing" className="hover:underline">{p.project_name ?? "—"}</Link>
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground max-w-[140px] truncate" title={p.client_name ?? ""}>
                        {p.client_name ?? "—"}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">
                        {p.start_date ?? <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">
                        {p.end_date ?? <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        {teamBooked ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold whitespace-nowrap">
                            <CheckCircle2 className="w-3 h-3" />
                            <span className="truncate max-w-[110px]" title={teamLabel ?? ""}>{teamLabel}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">not booked</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono font-semibold tabular-nums" data-privacy="blur">
                        {propNet1Total(p) > 0 ? eur(propNet1Total(p)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Top overdue invoices ─────────────────────────────────── */}
      {(() => { return (
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
      ); })()}

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

      {loading && (
        <p className="text-[11px] text-muted-foreground italic text-center">Loading live data…</p>
      )}
    </div>
  );
}
