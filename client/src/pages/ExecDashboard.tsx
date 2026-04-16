import { useEffect, useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Link } from "wouter";
import { useStore } from "@/hooks/use-store";
import {
  Users, UserCheck, Receipt, DollarSign, TrendingUp, TrendingDown,
  AlertCircle, CheckCircle2, Clock, Briefcase,
  ArrowUpRight, Target,
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
  outcome: "pending" | "won" | "lost" | null;
  proposal_date: string | null;
  region: string | null;
  currency: string | null;
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

export default function ExecDashboard() {
  const { employees } = useStore();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [proposals, setProposals] = useState<PricingProposal[]>([]);
  const [wonProjects, setWonProjects] = useState<WonProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      setLoading(true);
      try {
        const [cRes, iRes, pRes, wRes] = await Promise.all([
          fetch("/api/hiring/candidates",  { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/harvest/invoices",   { credentials: "include" }).then(r => r.ok ? r.json().then(d => d.invoices ?? []) : []),
          fetch("/api/pricing/proposals",  { credentials: "include" }).then(r => r.ok ? r.json() : []),
          fetch("/api/won-projects",       { credentials: "include" }).then(r => r.ok ? r.json() : []),
        ]);
        if (cancelled) return;
        setCandidates(Array.isArray(cRes) ? cRes : []);
        setInvoices(Array.isArray(iRes) ? iRes : []);
        setProposals(Array.isArray(pRes) ? pRes : []);
        setWonProjects(Array.isArray(wRes) ? wRes : []);
        setLastFetch(new Date());
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

    return { headcount: active.length, monthlyPayroll, avgSalary, birthdays };
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
      list.reduce((s, p) => s + toEUR(p.total_fee, p.currency), 0);

    const decided = won.length + lost.length;
    const winRate = decided > 0 ? Math.round((won.length / decided) * 100) : 0;

    return {
      total: recent.length,
      pendingCount: pending.length,
      pendingValue: sumFee(pending),
      wonCount: won.length,
      wonValue:  sumFee(won),
      lostCount: lost.length,
      lostValue: sumFee(lost),
      winRate,
    };
  }, [proposals]);

  // ─── Active projects from wonProjects ────────────────────────────────
  const active = useMemo(() => {
    const list = wonProjects.filter(p => (p.status ?? "").toLowerCase() === "active");
    const value = list.reduce((s, p) => s + toEUR(p.total_amount, p.currency), 0);
    return { count: list.length, value };
  }, [wonProjects]);

  // ─── Recent BD activity — last 10 proposals ──────────────────────────
  const recentBD = useMemo(() => {
    return [...proposals]
      .sort((a, b) => String(b.proposal_date ?? "").localeCompare(String(a.proposal_date ?? "")))
      .slice(0, 8);
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
                <h3 className="text-sm font-semibold">Business development</h3>
                <p className="text-[11px] text-muted-foreground">Last 12 months · win rate {bd.winRate}%</p>
              </div>
            </div>
            <Link href="/bd" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
              open <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 bg-amber-50 rounded border border-amber-100">
              <Clock className="w-4 h-4 text-amber-600 mx-auto mb-1" />
              <div className="text-[10px] text-amber-700 uppercase font-semibold">Pending</div>
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
        </Card>
      </div>

      {/* ── Row 3: Recent BD + Top overdue invoices ───────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Recent proposals</h3>
                <p className="text-[11px] text-muted-foreground">Last 8 by date</p>
              </div>
            </div>
            <Link href="/bd" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
              all <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
          {recentBD.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-6">No proposals yet.</p>
          ) : (
            <div className="space-y-1.5">
              {recentBD.map(p => {
                const tone =
                  p.outcome === "won"  ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                  p.outcome === "lost" ? "bg-red-50 border-red-200 text-red-700" :
                                         "bg-slate-50 border-slate-200 text-slate-700";
                const icon =
                  p.outcome === "won"  ? <CheckCircle2 className="w-3 h-3" /> :
                  p.outcome === "lost" ? <TrendingDown className="w-3 h-3" /> :
                                         <Clock className="w-3 h-3" />;
                return (
                  <div key={p.id} className="flex items-center gap-2 text-xs py-1 border-b last:border-0 border-muted/40">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[9px] font-semibold uppercase ${tone}`}>
                      {icon}{p.outcome ?? "pending"}
                    </span>
                    <span className="flex-1 truncate" title={`${p.client_name ?? ""} — ${p.project_name ?? ""}`}>
                      <span className="font-medium">{p.client_name ?? "—"}</span>
                      <span className="text-muted-foreground"> · {p.project_name ?? ""}</span>
                    </span>
                    <span className="font-mono font-semibold text-foreground/80 shrink-0" data-privacy="blur">
                      {eur(toEUR(p.total_fee, p.currency))}
                    </span>
                  </div>
                );
              })}
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

      {loading && (
        <p className="text-[11px] text-muted-foreground italic text-center">Loading live data…</p>
      )}
    </div>
  );
}
