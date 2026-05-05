import React, { useState, useEffect, useMemo } from "react";
import { useStore } from "@/hooks/use-store";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Search, Info, Upload, History, TrendingUp, CheckCircle2, X, MessageSquare, BookOpen, Calendar, Grid3X3, ListTodo, Check, Clock, AlertTriangle, Pencil, RefreshCw, Printer, Mail, User, UserX, UserCheck, ChevronUp, ChevronDown } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { employeeInputSchema, type EmployeeInput, type CompletedTest, type EmployeeTask, type YearlyReview, type HrEvent, COMEX_AREAS } from "@shared/schema";
import { v4 as uuidv4 } from "uuid";
import { useToast } from "@/hooks/use-toast";
import { calculateEmployeeMetrics, grossToRal } from "@/lib/calculations";
import { format, parseISO } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight as ChevronRightIcon } from "lucide-react";

function SalaryChart({ employeeId, hireDate, refreshKey }: { employeeId: string; hireDate: string; refreshKey?: number }) {
  const [history, setHistory] = useState<any[]>([]);
  const [hover, setHover] = useState<{ x: number; date: string; gross: number; bonus: number; role: string; months: number } | null>(null);

  useEffect(() => {
    fetch(`/api/salary-history/${employeeId}`, { credentials: "include" })
      .then(r => r.json())
      .then((data: any[]) => {
        if (Array.isArray(data)) setHistory(data.sort((a, b) => a.effective_date.localeCompare(b.effective_date)));
      })
      .catch(() => {});
  }, [employeeId, refreshKey]);

  if (history.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/20 bg-muted/20 p-6 text-center">
        <div className="text-xs text-muted-foreground italic">No salary history yet.</div>
        <div className="text-[10px] text-muted-foreground/70 mt-1">Add a salary log below to see the chart.</div>
      </div>
    );
  }

  // Yearly gross — gross_fixed_year is already annual, but the logged
  // value may have been entered as monthly × months_paid; we trust the
  // stored gross_fixed_year as the canonical annual figure. Switching
  // from 12 to 13 monthly payments is therefore visible as a real ~8.3%
  // jump on the yearly chart (which is correct — the person's yearly
  // total income IS larger), unlike the monthly view where the per-
  // month figure barely moves.
  const today = new Date().toISOString().slice(0, 10);
  interface Pt { date: string; gross: number; bonusPct: number; roleCode: string; monthsPaid: number }
  const pts: Pt[] = history.map(h => ({
    date: h.effective_date,
    gross: Math.round(h.gross_fixed_year),
    bonusPct: h.bonus_pct ?? 0,
    roleCode: h.role_code ?? "",
    monthsPaid: h.months_paid ?? 12,
  }));
  // Extend the line to "today" so the latest period is visible.
  const extended = [...pts];
  if (pts.length > 0) extended.push({ ...pts[pts.length - 1], date: today });

  // ── Layout (responsive, larger, more readable than the v1 chart) ──
  const W = 720, H = 220, pad = { top: 28, right: 24, bottom: 36, left: 64 };
  const iW = W - pad.left - pad.right;
  const iH = H - pad.top - pad.bottom;

  const t0 = new Date(extended[0].date).getTime();
  const t1 = new Date(extended[extended.length - 1].date).getTime();
  const xOf = (d: string) => t1 === t0 ? 0 : ((new Date(d).getTime() - t0) / (t1 - t0)) * iW;
  const gVals = extended.map(p => p.gross);
  const rawMin = Math.min(...gVals), rawMax = Math.max(...gVals);
  // Pad the y-domain a little so peaks don't graze the top, and round
  // the bounds to nice 5k multiples for cleaner tick labels.
  const round5k = (v: number, dir: "up" | "down") => {
    const k = 5000;
    return dir === "up" ? Math.ceil(v / k) * k : Math.floor(v / k) * k;
  };
  const gMin = round5k(rawMin * 0.92, "down");
  const gMax = round5k(rawMax * 1.08, "up");
  const yG = (v: number) => iH - ((v - gMin) / (gMax - gMin || 1)) * iH;

  // Step path — yearly gross steps up/down at each effective_date.
  const stepPath = extended.map((p, i) => {
    const x = xOf(p.date).toFixed(1);
    const y = yG(p.gross).toFixed(1);
    return i === 0 ? `M${x},${y}` : `H${x} V${y}`;
  }).join(" ");
  // Closed area for the gradient fill underneath the line.
  const areaPath = `${stepPath} V${iH} H0 Z`;

  // Y-axis ticks — 5 nice rounded values
  const tickStep = round5k((gMax - gMin) / 4, "up");
  const yTicks: number[] = [];
  for (let v = gMin; v <= gMax + 1; v += tickStep) yTicks.push(v);

  // X-axis year ticks
  const startYr = new Date(extended[0].date).getFullYear();
  const endYr = new Date(today).getFullYear();
  const yrTicks: { x: number; label: string }[] = [];
  for (let yr = startYr; yr <= endYr + 1; yr++) {
    const d = `${yr}-01-01`;
    if (d >= extended[0].date && d <= today) yrTicks.push({ x: xOf(d), label: String(yr) });
  }

  const fmtEur = (v: number) =>
    v >= 1_000_000 ? `€${(v / 1_000_000).toFixed(1)}M` :
    v >= 1000      ? `€${Math.round(v / 1000)}k` :
                     `€${v}`;

  // Role-change markers — only render label when role_code transitions.
  const roleMarkers: { x: number; label: string; date: string }[] = [];
  let lastRole = "";
  for (const h of history) {
    if (h.role_code && h.role_code !== lastRole) {
      roleMarkers.push({ x: xOf(h.effective_date), label: h.role_code, date: h.effective_date });
      lastRole = h.role_code;
    }
  }

  // Hover handler — finds the data point closest to the mouse x, then
  // shows a vertical guide-line + tooltip card. Plays well with touch
  // since we use pointer events on the overlay rect.
  const handleHover = (e: React.PointerEvent<SVGRectElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const localX = ((e.clientX - rect.left) / rect.width) * W - pad.left;
    if (localX < 0 || localX > iW) { setHover(null); return; }
    // Pick the latest point whose x ≤ cursor x — step-function semantics.
    let chosen = pts[0];
    for (const p of pts) {
      if (xOf(p.date) <= localX) chosen = p;
      else break;
    }
    setHover({
      x: xOf(chosen.date),
      date: chosen.date,
      gross: chosen.gross,
      bonus: chosen.bonusPct,
      role: chosen.roleCode,
      months: chosen.monthsPaid,
    });
  };

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Salary history chart — yearly gross over time">
        <defs>
          <linearGradient id="salaryArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#6366f1" stopOpacity="0.32" />
            <stop offset="60%" stopColor="#6366f1" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="salaryLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"  stopColor="#4f46e5" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
        </defs>

        <g transform={`translate(${pad.left},${pad.top})`}>
          {/* Y-axis grid lines */}
          {yTicks.map((v, i) => (
            <line key={i} x1={0} y1={yG(v)} x2={iW} y2={yG(v)} stroke="hsl(var(--border))" strokeOpacity={0.5} strokeDasharray="2 4" />
          ))}

          {/* Filled area under the salary line */}
          <path d={areaPath} fill="url(#salaryArea)" />

          {/* Salary step line */}
          <path d={stepPath} fill="none" stroke="url(#salaryLine)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

          {/* Step-change dots at every effective_date */}
          {history.map((h, i) => {
            const cx = xOf(h.effective_date);
            const cy = yG(Math.round(h.gross_fixed_year));
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={5} fill="white" stroke="#4f46e5" strokeWidth={2} />
                <circle cx={cx} cy={cy} r={2} fill="#4f46e5" />
              </g>
            );
          })}

          {/* Role-change vertical markers + pill labels */}
          {roleMarkers.map((r, i) => (
            <g key={i}>
              <line
                x1={r.x} y1={-4} x2={r.x} y2={iH}
                stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" opacity={0.6}
              />
              <g transform={`translate(${r.x}, -10)`}>
                <rect x={-14} y={-9} rx={3} ry={3} width={28} height={14} fill="#1e293b" />
                <text x={0} y={1} textAnchor="middle" fontSize={9} fontWeight={700} fill="white" fontFamily="ui-sans-serif, system-ui">
                  {r.label}
                </text>
              </g>
            </g>
          ))}

          {/* Y-axis labels (yearly gross in k€) */}
          <line x1={0} y1={0} x2={0} y2={iH} stroke="hsl(var(--border))" strokeWidth={1} />
          {yTicks.map((v, i) => (
            <g key={i}>
              <line x1={-4} y1={yG(v)} x2={0} y2={yG(v)} stroke="hsl(var(--border))" strokeWidth={1} />
              <text x={-8} y={yG(v) + 4} textAnchor="end" fontSize={11} fontFamily="ui-sans-serif, system-ui" fill="hsl(var(--muted-foreground))" fontWeight={500}>
                {fmtEur(v)}
              </text>
            </g>
          ))}

          {/* X-axis */}
          <line x1={0} y1={iH} x2={iW} y2={iH} stroke="hsl(var(--border))" strokeWidth={1} />
          {yrTicks.map((t, i) => (
            <g key={i}>
              <line x1={t.x} y1={iH} x2={t.x} y2={iH + 5} stroke="hsl(var(--border))" strokeWidth={1} />
              <text x={t.x} y={iH + 18} textAnchor="middle" fontSize={11} fontFamily="ui-sans-serif, system-ui" fill="hsl(var(--muted-foreground))" fontWeight={500}>
                {t.label}
              </text>
            </g>
          ))}

          {/* Y-axis title */}
          <text x={-pad.left + 8} y={-pad.top + 14} fontSize={10} fill="hsl(var(--muted-foreground))" fontWeight={600} fontFamily="ui-sans-serif, system-ui">
            Yearly gross (€)
          </text>

          {/* Hover crosshair + tooltip */}
          {hover && (
            <g pointerEvents="none">
              <line x1={hover.x} y1={0} x2={hover.x} y2={iH} stroke="#4f46e5" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
              <circle cx={hover.x} cy={yG(hover.gross)} r={6} fill="#4f46e5" stroke="white" strokeWidth={2} />
            </g>
          )}

          {/* Invisible overlay to capture pointer events */}
          <rect
            x={0} y={0} width={iW} height={iH}
            fill="transparent"
            onPointerMove={handleHover}
            onPointerLeave={() => setHover(null)}
          />
        </g>
      </svg>

      {/* Tooltip card — sits outside the SVG so it can use full
          shadcn/Tailwind styling (shadows, rounded corners, etc.). */}
      {hover && (
        <div
          className="absolute pointer-events-none bg-popover text-popover-foreground border rounded-md shadow-lg px-3 py-2 text-xs"
          style={{
            left: `calc(${((hover.x + pad.left) / W) * 100}% + 12px)`,
            top: 8,
            minWidth: 160,
          }}
        >
          <div className="font-semibold mb-1">
            {new Date(hover.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Yearly gross</span>
            <span className="font-mono font-semibold">€{hover.gross.toLocaleString("it-IT")}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Months paid</span>
            <span className="font-mono">{hover.months}×</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Per month</span>
            <span className="font-mono text-muted-foreground">
              €{Math.round(hover.gross / hover.months).toLocaleString("it-IT")}
            </span>
          </div>
          {hover.bonus > 0 && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Bonus target</span>
              <span className="font-mono text-rose-600">{hover.bonus}%</span>
            </div>
          )}
          {hover.role && (
            <div className="flex items-center justify-between gap-3 mt-1 pt-1 border-t border-border/50">
              <span className="text-muted-foreground">Role</span>
              <span className="font-bold">{hover.role}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BandPosition({ metrics }: { metrics: any }) {
  const renderLine = (label: string, min: number, max: number, val: number, noNextRole: boolean, showMarker: boolean, tooltip: React.ReactNode) => {
    const pos = max === min ? 50 : Math.min(Math.max(((val - min) / (max - min)) * 100, 0), 100);
    const isOutOfBand = val < min || val > max;

    return (
      <div className="space-y-0.5">
        <div className="flex justify-between text-[8px] text-muted-foreground uppercase font-bold tracking-tighter">
          <span>{label}</span>
          {noNextRole && <span className="text-destructive/50">N/A</span>}
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="relative h-2 w-full bg-muted rounded-full overflow-visible group cursor-help">
                {!noNextRole && (
                  <>
                    <div className="absolute top-0 bottom-0 left-0 right-0 flex justify-between px-0.5 pointer-events-none">
                      <span className="text-[9px] font-bold self-center">€{Math.round(min/1000)}k</span>
                      <span className="text-[9px] font-bold self-center">€{Math.round(max/1000)}k</span>
                    </div>
                    {showMarker && (
                      <>
                        <div
                          className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border border-background shadow-sm transition-all ${isOutOfBand ? 'bg-destructive' : 'bg-primary'}`}
                          style={{ left: `${pos}%` }}
                        />
                        {val < min && <span className="absolute -left-1 top-1/2 -translate-y-1/2 text-[8px] font-bold text-destructive">&lt;</span>}
                        {val > max && <span className="absolute -right-1 top-1/2 -translate-y-1/2 text-[8px] font-bold text-destructive">&gt;</span>}
                      </>
                    )}
                  </>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent className="text-[10px] p-2 max-w-[200px]">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  };

  const perfScore: number | null = metrics.performance_score;
  const hasPromotion = perfScore !== null && perfScore > 5 && !!metrics.next_role_code;
  const annualNow = metrics.annual_now;
  const annualFuture = metrics.annual_future;

  if (!annualNow) {
    return <div className="text-[10px] text-muted-foreground italic">Missing salary</div>;
  }
  if (metrics.current_min === 0 && metrics.current_max === 0) {
    return <div className="text-[10px]"><span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-semibold">Admin</span></div>;
  }

  return (
    <div className="flex flex-col gap-1 py-1 w-[160px]">
      {renderLine(
        "Now",
        metrics.current_min,
        metrics.current_max,
        annualNow,
        false,
        true,
        <div className="space-y-1">
          <div className="font-bold">Current Annual Gross: €{Math.round(annualNow).toLocaleString()}</div>
          <div className="text-muted-foreground">Band: €{Math.round(metrics.current_min).toLocaleString()} – €{Math.round(metrics.current_max).toLocaleString()}</div>
          <div className={`font-bold uppercase text-[8px] ${metrics.band_status === 'In band' ? 'text-emerald-500' : 'text-destructive'}`}>Status: {metrics.band_status}</div>
        </div>
      )}
      {renderLine(
        "Next",
        metrics.next_min,
        metrics.next_max,
        annualFuture,
        !metrics.next_role_code,
        hasPromotion,
        <div className="space-y-1">
          {perfScore === null ? (
            <div className="text-muted-foreground italic">Add monthly ratings to see projection</div>
          ) : perfScore <= 5 ? (
            <div className="font-bold text-destructive">N/A - No promotion (Rate ≤ 5)</div>
          ) : !metrics.next_role_code ? (
            <div className="font-bold text-primary">N/A - Top role reached</div>
          ) : (
            <>
              <div className="font-bold text-emerald-500">Future Promotion: €{Math.round(annualFuture).toLocaleString()}</div>
              <div className="text-muted-foreground">Next Band: €{Math.round(metrics.next_min).toLocaleString()} – €{Math.round(metrics.next_max).toLocaleString()}</div>
              <div className="italic text-primary-foreground/70">{metrics.policy_applied}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const ROLE_RANK: Record<string, number> = {
  "ADMIN": 11,
  "EM2": 10,
  "EM1": 9,
  "C2": 8,
  "C1": 7,
  "S2": 6,
  "S1": 5,
  "A2": 4,
  "A1": 3,
  "BA": 2,
  "INT": 1
};


// Churn risk score (0-100) computed from employee data alone
function computeChurnScore(emp: any): { score: number; level: "high" | "medium" | "low" } {
  const today = new Date();
  let score = 0;
  const promoDate = emp.last_promo_date
    ? new Date(emp.last_promo_date)
    : emp.hire_date ? new Date(emp.hire_date + "-01") : null;
  if (promoDate && !isNaN(promoDate.getTime())) {
    const monthsSince = (today.getTime() - promoDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (monthsSince > 30) score += 35;
    else if (monthsSince > 24) score += 25;
  }
  const perf = emp.performance_score;
  if (typeof perf === "number") {
    if (perf < 6.5) score += 25;
    else if (perf < 7.0) score += 10;
  }
  const hrEvents = emp.hr_events ?? [];
  let hrPts = 0;
  for (const ev of hrEvents) {
    if (["complaint","absence_concern","performance_concern"].includes(ev.type)) {
      hrPts += ev.severity === "high" ? 20 : ev.severity === "medium" ? 10 : 5;
    }
  }
  score += Math.min(hrPts, 40);
  const hireParts = emp.hire_date?.split("-").map(Number) ?? [];
  if (hireParts.length >= 2) {
    const hireDate = new Date(hireParts[0], hireParts[1] - 1, 1);
    const tenureMonths = (today.getTime() - hireDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (tenureMonths < 6) score += 10;
  }
  const ratings = emp.monthly_ratings ?? [];
  if (ratings.length > 0) {
    const cutoff = new Date(today); cutoff.setDate(today.getDate() - 90);
    const cutoffStr = cutoff.toISOString().slice(0, 7);
    const recent = ratings.some((r: any) => String(r.month ?? r.date ?? "").slice(0, 7) >= cutoffStr);
    if (!recent) score += 10;
  }
  score = Math.min(100, score);
  return { score, level: score >= 50 ? "high" : score >= 25 ? "medium" : "low" };
}

// ── Project Allocations sub-component ─────────────────────────────────────
interface Proposal {
  id: number;
  project_name: string;
  outcome: string;
  manager_name?: string;
  team_members?: { role: string; name: string }[];
}

function ProjectAllocations({ employeeName, employeeId }: { employeeName: string; employeeId: string | null; onRefresh: () => void }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [assignKind, setAssignKind] = useState<"manager" | "team">("team");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Load open projects
    fetch("/api/pricing/proposals", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(pp => {
        if (Array.isArray(pp)) {
          const open = pp.filter((p: any) => p.outcome !== "lost");
          setProposals(open);
        }
      })
      .catch(() => {});
  }, []);

  const currentAssignments = useMemo(() => {
    if (!employeeName) return [];
    const lower = employeeName.trim().toLowerCase();
    return proposals.filter(p => {
      const isManager = p.manager_name && p.manager_name.trim().toLowerCase() === lower;
      const isTeam = (p.team_members ?? []).some(m => m.name && m.name.trim().toLowerCase() === lower);
      return isManager || isTeam;
    });
  }, [proposals, employeeName]);

  async function assignToProject() {
    if (!employeeName || !selectedProjectId) {
      toast({ title: "Select a project first", variant: "destructive" });
      return;
    }

    const projectId = Number(selectedProjectId);
    const project = proposals.find(p => p.id === projectId);
    if (!project) return;

    setSubmitting(true);
    try {
      const patch: any = {};
      if (assignKind === "manager") {
        patch.manager_name = employeeName;
      } else {
        const existing = project.team_members ?? [];
        if (!existing.some(m => m.name?.toLowerCase() === employeeName.toLowerCase())) {
          patch.team_members = [...existing, { role: "Associate", name: employeeName }];
        }
      }

      const r = await fetch(`/api/pricing/proposals/${projectId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const updated = await r.json();

      setProposals(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
      setSelectedProjectId("");
      toast({ title: `${employeeName} assigned to ${project.project_name}` });
    } catch (e) {
      toast({ title: "Failed to assign", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function unassignFromProject(projectId: number) {
    if (!employeeName) return;
    setSubmitting(true);
    try {
      const project = proposals.find(p => p.id === projectId);
      if (!project) return;

      const patch: any = {};
      const lower = employeeName.trim().toLowerCase();
      if (project.manager_name?.trim().toLowerCase() === lower) {
        patch.manager_name = null;
      } else {
        patch.team_members = (project.team_members ?? []).filter(
          m => m.name && m.name.trim().toLowerCase() !== lower
        );
      }

      const r = await fetch(`/api/pricing/proposals/${projectId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const updated = await r.json();

      setProposals(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
      toast({ title: `${employeeName} unassigned from ${project.project_name}` });
    } catch (e) {
      toast({ title: "Failed to unassign", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-4 bg-background">
      <h4 className="font-bold text-sm mb-4">Project Allocations</h4>

      {/* Current assignments */}
      {currentAssignments.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Assigned to:</p>
          {currentAssignments.map(p => {
            const isManager = p.manager_name?.trim().toLowerCase() === employeeName.trim().toLowerCase();
            return (
              <div key={p.id} className="flex items-center justify-between gap-2 text-sm bg-muted/50 p-2 rounded">
                <div>
                  <div className="font-mono text-xs font-semibold">{p.project_name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {isManager ? "Manager" : "Team member"} · {p.outcome}
                  </div>
                </div>
                <button
                  onClick={() => unassignFromProject(p.id)}
                  disabled={submitting}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1"
                  title="Unassign"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Assignment controls */}
      <div className="space-y-2">
        <Label className="text-xs">Assign to project:</Label>
        <div className="flex gap-2">
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="text-xs h-8">
              <SelectValue placeholder="Choose project..." />
            </SelectTrigger>
            <SelectContent>
              {proposals
                .filter(p => !currentAssignments.some(c => c.id === p.id))
                .map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.project_name} ({p.outcome})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Select value={assignKind} onValueChange={(v) => setAssignKind(v as "manager" | "team")}>
            <SelectTrigger className="text-xs h-8 w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="team">Team member</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!selectedProjectId || submitting}
            onClick={assignToProject}
            className="text-xs h-8"
          >
            {submitting ? "..." : "Assign"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function EmployeeList() {
  const { employees, addEmployee, updateEmployee, deleteEmployee, retireEmployee, unretireEmployee, roleGrid, settings } = useStore();
  const [search, setSearch] = useState("");
  const [mainTab, setMainTab] = useState<"employees" | "tdl" | "performance" | "external">("employees");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const [showFormer, setShowFormer] = useState(false);
  const { toast } = useToast();

  // ── TDL state ─────────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<EmployeeTask[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
  const [taskPopup, setTaskPopup] = useState<EmployeeTask | null>(null);
  const [popupTitle, setPopupTitle] = useState("");
  const [popupBody, setPopupBody] = useState("");
  const [popupAssignee, setPopupAssignee] = useState("");
  const [popupDeadline, setPopupDeadline] = useState("");

  // ── TDL focus-on-person ──────────────────────────────────────────────────
  // Lets the manager pick a single person and see only their open tasks, with
  // quick actions to (a) print/save-as-PDF via the browser's native print
  // dialog and (b) send a pre-filled email with the task list. Emails live
  // in localStorage (one-time prompt per person) because the employees table
  // doesn't have an email column — adding a migration for a client-only
  // convenience feature felt heavy.
  const EMAIL_STORAGE_KEY = "tdl_person_emails_v1";
  const [focusedPerson, setFocusedPerson] = useState<string>(""); // "" = show all
  const [personEmails, setPersonEmails] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(EMAIL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const saveEmailFor = (name: string, email: string) => {
    setPersonEmails(prev => {
      const next = { ...prev, [name]: email.trim() };
      try { localStorage.setItem(EMAIL_STORAGE_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  };

  // ── Performance Issues state ──────────────────────────────────────────────
  // ── External contacts (freelancers + partners) ─────────────────────
  // Lightweight list of people who aren't in the rich `employees` table
  // (no birthday/salary/role required) but still need to be in the
  // company-wide mailing list. CRUD via /api/external-contacts.
  type ExternalContact = {
    id: number; name: string; email: string; kind: string; created_at: string;
    daily_rate?: number | null;
    daily_rate_currency?: string | null;
    is_employee?: boolean;
    employee_id?: string;
    employee_role_code?: string;
    employee_role_name?: string;
  };
  const [externalContacts, setExternalContacts] = useState<ExternalContact[]>([]);
  const [newExtName, setNewExtName] = useState("");
  const [newExtEmail, setNewExtEmail] = useState("");
  const [newExtKind, setNewExtKind] = useState<string>("freelancer");
  const [newExtRate, setNewExtRate] = useState<string>("");
  const [newExtRateCurrency, setNewExtRateCurrency] = useState<string>("EUR");
  const [editingExtId, setEditingExtId] = useState<number | null>(null);
  const [editExtName, setEditExtName] = useState<string>("");
  const [editExtEmail, setEditExtEmail] = useState<string>("");
  const [editExtKind, setEditExtKind] = useState<string>("freelancer");
  const [editExtRate, setEditExtRate] = useState<string>("");
  const [editExtRateCurrency, setEditExtRateCurrency] = useState<string>("EUR");
  const loadExternalContacts = async () => {
    try {
      const r = await fetch("/api/external-contacts", { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        setExternalContacts(Array.isArray(data) ? data : []);
      }
    } catch { /* non-fatal */ }
  };
  useEffect(() => { loadExternalContacts(); }, []);

  const addExternalContact = async () => {
    if (!newExtName.trim() || !newExtEmail.trim()) return;
    try {
      const r = await fetch("/api/external-contacts", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newExtName.trim(), email: newExtEmail.trim(), kind: newExtKind,
          daily_rate: newExtRate ? Number(newExtRate) : null,
          daily_rate_currency: newExtRateCurrency,
        }),
      });
      if (r.ok) {
        setNewExtName(""); setNewExtEmail(""); setNewExtKind("freelancer");
        setNewExtRate(""); setNewExtRateCurrency("EUR");
        loadExternalContacts();
        toast({ title: "Contact added" });
      } else {
        toast({ title: "Failed to add contact", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to add contact", variant: "destructive" });
    }
  };

  const startEditExt = (c: ExternalContact) => {
    setEditingExtId(c.id);
    setEditExtName(c.name);
    setEditExtEmail(c.email);
    setEditExtKind(c.kind);
    setEditExtRate(c.daily_rate != null ? String(c.daily_rate) : "");
    setEditExtRateCurrency(c.daily_rate_currency ?? "EUR");
  };

  const saveEditExt = async (id: number) => {
    if (!editExtName.trim() || !editExtEmail.trim()) return;
    try {
      const r = await fetch(`/api/external-contacts/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editExtName.trim(), email: editExtEmail.trim(), kind: editExtKind,
          daily_rate: editExtRate ? Number(editExtRate) : null,
          daily_rate_currency: editExtRateCurrency,
        }),
      });
      if (r.ok) {
        setEditingExtId(null);
        loadExternalContacts();
        toast({ title: "Contact updated" });
      } else {
        toast({ title: "Failed to update", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const deleteExternalContact = async (id: number, name: string) => {
    if (!confirm(`Remove ${name}?`)) return;
    try {
      await fetch(`/api/external-contacts/${id}`, { method: "DELETE", credentials: "include" });
      loadExternalContacts();
    } catch { /* non-fatal */ }
  };

  // ── "Copy all emails" — full Eendigo mailing list ──────────────────
  // Plain emails only, sorted alphabetically by email, joined by `; `.
  // Pastes directly into Outlook / Gmail "To" field. Outlook will
  // resolve display names from its own contact book on send. Pulls:
  //   • employees.email (proper schema column, edit via Edit form)
  //   • external_contacts.email (true externals only — partners,
  //     advisors, freelancers without an employee record)
  //   • Legacy TDL localStorage emails as a final fallback.
  const copyAllEmails = async () => {
    const all = new Set<string>();
    for (const emp of employees) {
      const e = (emp as any).email;
      if (e && typeof e === "string" && e.includes("@")) {
        all.add(e.toLowerCase().trim());
      } else {
        // Fallback to TDL-stored localStorage email if employee.email
        // hasn't been entered yet.
        const stored = personEmails[emp.name];
        if (stored && stored.includes("@")) all.add(stored.toLowerCase().trim());
      }
    }
    for (const c of externalContacts) {
      if (c.email && c.email.includes("@")) all.add(c.email.toLowerCase().trim());
    }
    if (all.size === 0) {
      toast({ title: "No emails to copy", description: "Add emails to employees / freelancers / partners first." });
      return;
    }
    const text = [...all].sort().join("; ");
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: `Copied ${all.size} email${all.size === 1 ? "" : "s"}`,
        description: "Paste into Outlook / Gmail To: field.",
      });
    } catch {
      // Fallback: show in a prompt for manual copy
      window.prompt("Copy this list (Ctrl+C):", text);
    }
  };

  const [perfIssues, setPerfIssues] = useState<any[]>([]);
  const [newPerfEmployee, setNewPerfEmployee] = useState("");
  const [newPerfDate, setNewPerfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newPerfNote, setNewPerfNote] = useState("");
  const [editingPerfId, setEditingPerfId] = useState<number | null>(null);
  const [editPerfEmployee, setEditPerfEmployee] = useState("");
  const [editPerfDate, setEditPerfDate] = useState("");
  const [editPerfNote, setEditPerfNote] = useState("");

  useEffect(() => {
    fetch("/api/employee-tasks", { credentials: "include" })
      .then(r => r.json()).then(setTasks).catch(() => {});
  }, []);

  const addTask = async () => {
    if (!newTaskTitle.trim() || !newTaskAssignee) return;
    const res = await fetch("/api/employee-tasks", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTaskTitle, delegated_to: newTaskAssignee, deadline: newTaskDeadline || null, status: "pending" }),
    });
    const t = await res.json();
    setTasks(prev => [...prev, t]);
    setNewTaskTitle(""); setNewTaskAssignee(""); setNewTaskDeadline("");
  };

  const toggleTask = async (task: EmployeeTask) => {
    const next = task.status === "done" ? "pending" : "done";
    const res = await fetch(`/api/employee-tasks/${task.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const updated = await res.json();
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
  };

  const deleteTask = async (id: number) => {
    await fetch(`/api/employee-tasks/${id}`, { method: "DELETE", credentials: "include" });
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const openTaskPopup = (task: EmployeeTask) => {
    setTaskPopup(task);
    setPopupTitle(task.title);
    setPopupBody(task.body ?? "");
    setPopupAssignee(task.delegated_to);
    setPopupDeadline(task.deadline ?? "");
  };

  const saveTaskPopup = async () => {
    if (!taskPopup || !popupTitle.trim() || !popupAssignee) return;
    const res = await fetch(`/api/employee-tasks/${taskPopup.id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: popupTitle, body: popupBody || null, delegated_to: popupAssignee, deadline: popupDeadline || null }),
    });
    const updated = await res.json();
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    setTaskPopup(null);
  };

  // ── Print / Email handlers for the focused-person TDL view ───────────────

  /** Build a plain-text, bullet-list rendering of a person's open tasks.
   *  Used by both the email body and the print view — keeping the source
   *  single-pass guarantees the two deliverables stay in sync. */
  const buildTaskTextList = (person: string, taskList: EmployeeTask[]): string => {
    const lines: string[] = [];
    for (const t of taskList) {
      const dl = t.deadline ? ` (due ${format(parseISO(t.deadline), "dd/MM/yyyy")})` : "";
      lines.push(`• ${t.title}${dl}`);
      if (t.body) {
        // Indent body for readability in plain text
        for (const bl of t.body.split("\n").filter(Boolean)) {
          lines.push(`    ${bl}`);
        }
      }
    }
    return lines.length > 0 ? lines.join("\n") : "(No open tasks.)";
  };

  /** Open a small pop-up window containing a print-friendly HTML table
   *  of the focused person's open tasks and immediately trigger the native
   *  print dialog. The OS dialog includes "Save as PDF" as a destination on
   *  every platform we target (Windows, macOS, Linux), which covers the
   *  user's "make a PDF" request without adding a PDF library. */
  const printFocusedTasks = (person: string, taskList: EmployeeTask[]) => {
    const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const rows = taskList.map(t => {
      const dl = t.deadline ? format(parseISO(t.deadline), "dd/MM/yyyy") : "—";
      const overdue = t.deadline && t.deadline < new Date().toISOString().slice(0, 10);
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;width:60%;">
          <div style="font-weight:600;">${escapeHtml(t.title)}</div>
          ${t.body ? `<div style="color:#6b7280;font-size:11px;margin-top:3px;white-space:pre-wrap;">${escapeHtml(t.body)}</div>` : ""}
        </td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-family:monospace;color:${overdue ? "#dc2626" : "#111"};font-weight:${overdue ? "700" : "400"};">
          ${dl}${overdue ? " (OVERDUE)" : ""}
        </td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
<title>TDL — ${escapeHtml(person)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #6b7280; font-size: 11px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; padding: 8px; background: #f3f4f6; border-bottom: 2px solid #d1d5db; font-weight: 600; font-size: 10px; text-transform: uppercase; color: #374151; }
  @media print { body { padding: 12px; } }
</style></head><body>
  <h1>Task list — ${escapeHtml(person)}</h1>
  <div class="sub">${taskList.length} open task${taskList.length === 1 ? "" : "s"} · Generated ${today}</div>
  <table>
    <thead><tr><th>Task</th><th style="width:140px;">Deadline</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="2" style="padding:16px;text-align:center;color:#9ca3af;">No open tasks.</td></tr>`}</tbody>
  </table>
</body></html>`;

    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups for this site to print.", variant: "destructive" });
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // Give the browser a tick to render before triggering print
    w.addEventListener("load", () => { w.focus(); w.print(); });
    // Fallback if load event doesn't fire (some browsers cache an empty doc)
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 400);
  };

  /** Build and open a `mailto:` URL with a pre-filled subject and body
   *  containing the task list and the standard message the user asked for.
   *  If no email is saved for this person, prompt for one first and
   *  remember it for next time. */
  const emailFocusedTasks = (person: string, taskList: EmployeeTask[]) => {
    let to = personEmails[person] ?? "";
    if (!to) {
      const entered = window.prompt(`Email address for ${person}?`, "");
      if (!entered || !entered.trim()) return;
      to = entered.trim();
      saveEmailFor(person, to);
    }
    const subject = `Updated task list — ${person}`;
    const body =
`Hi ${person.split(" ")[0] || person},

Here is the updated task list that we have discussed. For your information.

${buildTaskTextList(person, taskList)}

Let's have a quick catch up in the next days to see where we stand and to answer questions.

Thanks,`;
    // mailto: size is limited (~2000 chars on Windows). If we overshoot,
    // truncate the task list and note it so the user can paste the rest.
    const MAILTO_CAP = 1900;
    const full = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (full.length > MAILTO_CAP) {
      toast({
        title: "Task list too long for one email",
        description: "Opening your mail client with the first batch — paste the rest from the printable view.",
      });
    }
    window.location.href = full.slice(0, MAILTO_CAP);
  };

  // Minimal HTML escaper for the print pop-up so pasted notes with < or &
  // don't break the rendered page.
  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ── Performance Issues CRUD ───────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/performance-issues", { credentials: "include" })
      .then(r => r.json()).then(setPerfIssues).catch(() => {});
  }, []);

  const addPerfIssue = async () => {
    if (!newPerfNote.trim() || !newPerfEmployee) return;
    const res = await fetch("/api/performance-issues", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_name: newPerfEmployee, date: newPerfDate, note: newPerfNote }),
    });
    const issue = await res.json();
    setPerfIssues(prev => [...prev, issue]);
    setNewPerfNote(""); setNewPerfEmployee(""); setNewPerfDate(new Date().toISOString().slice(0, 10));
  };

  const startEditPerf = (issue: any) => {
    setEditingPerfId(issue.id);
    setEditPerfEmployee(issue.employee_name);
    setEditPerfDate(issue.date);
    setEditPerfNote(issue.note);
  };

  const saveEditPerf = async () => {
    if (!editingPerfId || !editPerfNote.trim() || !editPerfEmployee) return;
    const res = await fetch(`/api/performance-issues/${editingPerfId}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_name: editPerfEmployee, date: editPerfDate, note: editPerfNote }),
    });
    const updated = await res.json();
    setPerfIssues(prev => prev.map(i => i.id === updated.id ? updated : i));
    setEditingPerfId(null);
  };

  const deletePerfIssue = async (id: number) => {
    await fetch(`/api/performance-issues/${id}`, { method: "DELETE", credentials: "include" });
    setPerfIssues(prev => prev.filter(i => i.id !== id));
  };

  const handleApplyRaise = async (emp: EmployeeInput) => {
    if (!emp.pending_salary_gross || !emp.pending_salary_date) return;
    await updateEmployee(emp.id, {
      ...emp,
      current_gross_fixed_year: emp.pending_salary_gross,
      pending_salary_gross: null,
      pending_salary_date: null,
    });
    toast({ title: `Salary updated to €${emp.pending_salary_gross.toLocaleString()} for ${emp.name}` });
  };

  const filteredEmployees = useMemo(() => {
    return employees
      .filter(e => (e as any).status !== "former")
      .filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }, [employees, search]);

  const formerEmployees = useMemo(() => {
    return employees
      .filter(e => (e as any).status === "former")
      .filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }, [employees, search]);

  const MONTHS_PAID_BY_ROLE: Record<string, number> = { INT: 12, BA: 12, A1: 12, A2: 13, S1: 13, S2: 13, C1: 13, C2: 13, EM1: 13, EM2: 13 };
  const MIN_GROSS_BY_ROLE: Record<string, number> = { INT: 16000, BA: 24600, A1: 28788, A2: 31187, S1: 33358, S2: 35035, C1: 36777, C2: 41197, EM1: 48204, EM2: 50609 };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return;
    const today = new Date();
    let imported = 0;
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      const name = cols[0]?.trim();
      const role = cols[1]?.trim();
      const age = parseInt(cols[2]) || 25;
      const hireDate = cols[3]?.trim();
      const tenureEEN = parseFloat(cols[4]) || 0;
      const tenureTotal = parseFloat(cols[5]) || tenureEEN;
      const monthsSincePromo = parseInt(cols[6]) || 0;
      const rateStr = cols[7]?.trim();
      const currentGross = parseFloat(cols[10]) || 0;
      if (!name || !role || !hireDate) continue;
      const birthYear = today.getFullYear() - age;
      const lastPromoDate = monthsSincePromo > 0
        ? new Date(today.getFullYear(), today.getMonth() - monthsSincePromo, 21).toISOString().slice(0, 10)
        : "";
      const performanceScore = rateStr && rateStr !== "Na" && rateStr !== "N/A" && rateStr !== "" ? parseFloat(rateStr) : 7;
      const monthsPaid = MONTHS_PAID_BY_ROLE[role] ?? 13;
      const grossAnnual = currentGross > 0 ? currentGross : (MIN_GROSS_BY_ROLE[role] ?? 30000);
      await addEmployee({
        id: uuidv4(),
        name,
        date_of_birth: `${birthYear}-01-01`,
        current_role_code: role,
        hire_date: hireDate,
        last_promo_date: lastPromoDate || undefined,
        tenure_before_years: Math.max(0, tenureTotal - tenureEEN),
        current_gross_fixed_year: grossAnnual,
        meal_voucher_daily: 8,
        months_paid: monthsPaid as 12 | 13,
        current_bonus_pct: 0,
        performance_score: performanceScore,
        monthly_ratings: [],
        completed_tests: [],
      });
      imported++;
    }
    toast({ title: `Imported ${imported} employee${imported !== 1 ? "s" : ""}` });
    e.target.value = "";
  };

  const openCreate = () => {
    setEditingId(null);
    setIsDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description="Manage your team members and their current compensation details."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyAllEmails}>
              <Mail className="w-4 h-4 mr-2" />
              Copy all emails
            </Button>
            <label>
              <Button variant="outline" size="sm" asChild>
                <span className="cursor-pointer">
                  <Upload className="w-4 h-4 mr-2" />
                  Import CSV
                </span>
              </Button>
              <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
            </label>
            <Button onClick={openCreate} className="shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4 mr-2" />
              Add Employee
            </Button>
          </div>
        }
      />

      {selectedEmpId && employees.find(e => e.id === selectedEmpId) ? (
        <EmployeeDetailPage
          employee={employees.find(e => e.id === selectedEmpId)!}
          onBack={() => setSelectedEmpId(null)}
        />
      ) : (
      <Card className="border-border">
        <div className="p-3 border-b flex items-center gap-4 flex-wrap">
          <div className="flex rounded-lg border overflow-hidden text-sm">
            <button
              onClick={() => setMainTab("employees")}
              className={`px-4 py-1.5 font-medium transition-colors ${mainTab === "employees" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            >
              Employees
            </button>
            <button
              onClick={() => setMainTab("tdl")}
              className={`px-4 py-1.5 font-medium transition-colors flex items-center gap-1.5 ${mainTab === "tdl" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            >
              <ListTodo className="w-3.5 h-3.5" />
              TDL
              {tasks.filter(t => t.status === "pending").length > 0 && (
                <span className={`text-[10px] rounded-full px-1.5 font-bold ${mainTab === "tdl" ? "bg-white/30 text-primary-foreground" : "bg-primary/10 text-primary"}`}>
                  {tasks.filter(t => t.status === "pending").length}
                </span>
              )}
            </button>
            <button
              onClick={() => setMainTab("performance")}
              className={`px-4 py-1.5 font-medium transition-colors flex items-center gap-1.5 ${mainTab === "performance" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Performance
              {perfIssues.length > 0 && (
                <span className={`text-[10px] rounded-full px-1.5 font-bold ${mainTab === "performance" ? "bg-white/30 text-primary-foreground" : "bg-primary/10 text-primary"}`}>
                  {perfIssues.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setMainTab("external")}
              className={`px-4 py-1.5 font-medium transition-colors flex items-center gap-1.5 ${mainTab === "external" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            >
              <User className="w-3.5 h-3.5" />
              Freelancers & Partners
              {externalContacts.length > 0 && (
                <span className={`text-[10px] rounded-full px-1.5 font-bold ${mainTab === "external" ? "bg-white/30 text-primary-foreground" : "bg-primary/10 text-primary"}`}>
                  {externalContacts.length}
                </span>
              )}
            </button>
          </div>
          {mainTab === "employees" && (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Filter by name..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
        </div>

        {mainTab === "tdl" && (
          <div>
            {/* Add task form */}
            <div className="p-4 border-b bg-muted/10">
              <div className="flex gap-3 items-end flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <Label className="text-xs mb-1 block">Task</Label>
                  <Input
                    placeholder="Describe the task..."
                    value={newTaskTitle}
                    onChange={e => setNewTaskTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") addTask(); }}
                  />
                </div>
                <div className="min-w-[160px]">
                  <Label className="text-xs mb-1 block">Delegate to</Label>
                  <Select value={newTaskAssignee} onValueChange={setNewTaskAssignee}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select person..." />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map(e => <SelectItem key={e.id} value={e.name}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[140px]">
                  <Label className="text-xs mb-1 block">Deadline</Label>
                  <Input type="date" value={newTaskDeadline} onChange={e => setNewTaskDeadline(e.target.value)} />
                </div>
                <Button onClick={addTask} disabled={!newTaskTitle.trim() || !newTaskAssignee}>
                  <Plus className="w-4 h-4 mr-2" />Add Task
                </Button>
              </div>
            </div>

            {/* Focus-on-person bar — view one person's tasks, print/email them */}
            {(() => {
              const personsWithTasks = Array.from(new Set(tasks.map(t => t.delegated_to))).sort();
              const focusedTasks = focusedPerson
                ? tasks.filter(t => t.delegated_to === focusedPerson && t.status === "pending")
                : tasks;
              return (
                <div className="p-3 border-b bg-primary/5 flex flex-wrap items-center gap-2">
                  <User className="w-4 h-4 text-primary shrink-0" />
                  <Label className="text-xs font-semibold mb-0 shrink-0">View tasks for:</Label>
                  <Select
                    value={focusedPerson || "__all__"}
                    onValueChange={v => setFocusedPerson(v === "__all__" ? "" : v)}
                  >
                    <SelectTrigger className="h-8 w-56 text-sm bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All people (default)</SelectItem>
                      {personsWithTasks.map(name => {
                        const pending = tasks.filter(t => t.delegated_to === name && t.status === "pending").length;
                        return (
                          <SelectItem key={name} value={name}>
                            {name} ({pending} open)
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>

                  {focusedPerson && (
                    <>
                      <span className="text-xs text-muted-foreground ml-1">
                        {focusedTasks.length} open task{focusedTasks.length === 1 ? "" : "s"}
                        {personEmails[focusedPerson] && (
                          <span className="ml-2 text-primary">· {personEmails[focusedPerson]}</span>
                        )}
                      </span>
                      <div className="flex gap-1.5 ml-auto">
                        <Button
                          size="sm" variant="outline" className="h-8 text-xs"
                          onClick={() => printFocusedTasks(focusedPerson, focusedTasks)}
                          disabled={focusedTasks.length === 0}
                          title="Open a printable view — use your browser's 'Save as PDF' to export"
                        >
                          <Printer className="w-3.5 h-3.5 mr-1" /> Print / PDF
                        </Button>
                        <Button
                          size="sm" className="h-8 text-xs"
                          onClick={() => emailFocusedTasks(focusedPerson, focusedTasks)}
                          disabled={focusedTasks.length === 0}
                          title="Open your mail client with a pre-filled message and the task list"
                        >
                          <Mail className="w-3.5 h-3.5 mr-1" /> Email
                        </Button>
                        {personEmails[focusedPerson] && (
                          <Button
                            size="sm" variant="ghost" className="h-8 text-xs px-2"
                            onClick={() => {
                              const entered = window.prompt(
                                `Update email for ${focusedPerson}:`,
                                personEmails[focusedPerson] ?? "",
                              );
                              if (entered != null) saveEmailFor(focusedPerson, entered);
                            }}
                            title="Change saved email address"
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* Task list — filtered to focused person if one is selected */}
            <div className="divide-y">
              {(() => {
                const visibleTasks = focusedPerson
                  ? tasks.filter(t => t.delegated_to === focusedPerson)
                  : tasks;
                if (tasks.length === 0) {
                  return <div className="p-10 text-center text-muted-foreground text-sm">No tasks yet. Add one above.</div>;
                }
                if (visibleTasks.length === 0) {
                  return <div className="p-10 text-center text-muted-foreground text-sm">No tasks for {focusedPerson}.</div>;
                }
                return visibleTasks.map(task => {
                const isOverdue = task.deadline && task.deadline < new Date().toISOString().slice(0, 10) && task.status === "pending";
                // Compact single-line row so the user can see many more
                // tasks per screen. Title gets the most space (flex-1);
                // assignee, body-preview (if any), deadline, delete-button
                // all sit on the same baseline on the right.
                return (
                  <div key={task.id} className={`flex items-center gap-3 py-1.5 px-3 group hover:bg-muted/30 transition-colors ${task.status === "done" ? "opacity-60" : ""}`}>
                    <button onClick={() => toggleTask(task)} className="shrink-0">
                      {task.status === "done"
                        ? <Check className="w-4 h-4 text-emerald-500" />
                        : <div className="w-4 h-4 rounded border-2 border-muted-foreground/40 hover:border-primary transition-colors" />
                      }
                    </button>
                    <div className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer" onClick={() => openTaskPopup(task)}>
                      <span className={`text-sm truncate ${task.status === "done" ? "line-through text-muted-foreground" : "text-foreground"}`}>
                        {task.title}
                      </span>
                      {task.body && (
                        <span className="text-[10px] text-muted-foreground truncate max-w-xs hidden md:inline">
                          — {task.body}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                      → <span className="font-medium">{task.delegated_to}</span>
                    </span>
                    {task.deadline && (
                      <span className={`text-xs flex items-center gap-1 shrink-0 whitespace-nowrap ${isOverdue ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                        <Clock className="w-3 h-3" />
                        {format(parseISO(task.deadline), "dd/MM/yy")}
                        {isOverdue && " — OVERDUE"}
                      </span>
                    )}
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                );
                });
              })()}
            </div>
          </div>
        )}

        {/* Task detail popup */}
        <Dialog open={!!taskPopup} onOpenChange={open => { if (!open) setTaskPopup(null); }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Task</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-xs mb-1 block">Title</Label>
                <Input
                  value={popupTitle}
                  onChange={e => setPopupTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !popupBody) saveTaskPopup(); }}
                  autoFocus
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Instructions <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea
                  value={popupBody}
                  onChange={e => setPopupBody(e.target.value)}
                  placeholder="Add detailed instructions or context..."
                  rows={5}
                  className="resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs mb-1 block">Delegate to</Label>
                  <Select value={popupAssignee} onValueChange={setPopupAssignee}>
                    <SelectTrigger><SelectValue placeholder="Select person..." /></SelectTrigger>
                    <SelectContent>
                      {employees.map(e => <SelectItem key={e.id} value={e.name}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Deadline</Label>
                  <Input type="date" value={popupDeadline} onChange={e => setPopupDeadline(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setTaskPopup(null)}>Cancel</Button>
                <Button onClick={saveTaskPopup} disabled={!popupTitle.trim() || !popupAssignee}>Save</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {mainTab === "performance" && (
          <div>
            {/* Add issue form */}
            <div className="p-4 border-b bg-muted/10">
              <div className="flex gap-3 items-end flex-wrap">
                <div className="min-w-[160px]">
                  <Label className="text-xs mb-1 block">Employee</Label>
                  <Select value={newPerfEmployee} onValueChange={setNewPerfEmployee}>
                    <SelectTrigger><SelectValue placeholder="Select employee..." /></SelectTrigger>
                    <SelectContent>
                      {employees.map(e => <SelectItem key={e.id} value={e.name}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[140px]">
                  <Label className="text-xs mb-1 block">Date</Label>
                  <Input type="date" value={newPerfDate} onChange={e => setNewPerfDate(e.target.value)} />
                </div>
                <div className="flex-1 min-w-[250px]">
                  <Label className="text-xs mb-1 block">Note</Label>
                  <Input
                    placeholder="Describe the issue observed..."
                    value={newPerfNote}
                    onChange={e => setNewPerfNote(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") addPerfIssue(); }}
                  />
                </div>
                <Button onClick={addPerfIssue} disabled={!newPerfNote.trim() || !newPerfEmployee}>
                  <Plus className="w-4 h-4 mr-2" />Log Issue
                </Button>
              </div>
            </div>
            {/* Issues list */}
            <div className="divide-y">
              {perfIssues.length === 0 && (
                <div className="p-10 text-center text-muted-foreground text-sm">No performance issues logged yet.</div>
              )}
              {[...perfIssues].sort((a, b) => b.date.localeCompare(a.date)).map(issue => {
                const isEditing = editingPerfId === issue.id;
                return (
                  <div key={issue.id} className="flex items-start gap-3 p-3 group hover:bg-muted/30 transition-colors">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    {isEditing ? (
                      <div className="flex-1 flex gap-2 items-center flex-wrap">
                        <Select value={editPerfEmployee} onValueChange={setEditPerfEmployee}>
                          <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {employees.map(e => <SelectItem key={e.id} value={e.name}>{e.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="date" className="h-8 w-[140px]" value={editPerfDate}
                          onChange={e => setEditPerfDate(e.target.value)} />
                        <Input className="h-8 flex-1 min-w-[200px]" value={editPerfNote}
                          onChange={e => setEditPerfNote(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") saveEditPerf(); if (e.key === "Escape") setEditingPerfId(null); }}
                          autoFocus />
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-emerald-600" onClick={saveEditPerf}>
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground" onClick={() => setEditingPerfId(null)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => startEditPerf(issue)}>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold">{issue.employee_name}</span>
                          <span className="text-xs text-muted-foreground">{format(parseISO(issue.date), "dd/MM/yy")}</span>
                        </div>
                        <div className="text-sm text-muted-foreground">{issue.note}</div>
                      </div>
                    )}
                    <button
                      onClick={() => deletePerfIssue(issue.id)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {mainTab === "external" && (
          <div>
            {/* Add form */}
            <div className="p-4 border-b bg-muted/10">
              <div className="flex gap-2 items-end flex-wrap">
                <div className="min-w-[160px] flex-1">
                  <Label className="text-xs mb-1 block">Name</Label>
                  <Input
                    placeholder="e.g. Mario Rossi"
                    value={newExtName}
                    onChange={e => setNewExtName(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="min-w-[200px] flex-1">
                  <Label className="text-xs mb-1 block">Email</Label>
                  <Input
                    type="email"
                    placeholder="mario.rossi@eendigo.com"
                    value={newExtEmail}
                    onChange={e => setNewExtEmail(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="min-w-[140px]">
                  <Label className="text-xs mb-1 block">Type</Label>
                  <Select value={newExtKind} onValueChange={v => setNewExtKind(v)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="freelancer">Freelancer</SelectItem>
                      <SelectItem value="partner">Partner</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="intern">Intern</SelectItem>
                      <SelectItem value="founder">Founder</SelectItem>
                      <SelectItem value="advisor">Advisor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-1 items-end">
                  <div className="w-[90px]">
                    <Label className="text-xs mb-1 block">Daily rate</Label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={newExtRate}
                      onChange={e => setNewExtRate(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="w-[80px]">
                    <Label className="text-xs mb-1 block">CCY</Label>
                    <Select value={newExtRateCurrency} onValueChange={v => setNewExtRateCurrency(v)}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="CHF">CHF</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={addExternalContact} disabled={!newExtName.trim() || !newExtEmail.trim()}>
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              </div>
            </div>

            {/* List */}
            {externalContacts.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground italic">
                No freelancers or partners yet. Add one above.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-[130px]">Type</TableHead>
                    <TableHead className="w-[150px]">Daily rate</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...externalContacts]
                    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
                    .map(c => {
                      const isEditing = editingExtId === c.id;
                      if (isEditing) {
                        return (
                          <TableRow key={c.id} className="bg-muted/20">
                            <TableCell>
                              <Input
                                value={editExtName}
                                onChange={e => setEditExtName(e.target.value)}
                                className="h-8 text-sm w-full"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="email"
                                value={editExtEmail}
                                onChange={e => setEditExtEmail(e.target.value)}
                                className="h-8 text-xs font-mono w-full"
                              />
                            </TableCell>
                            <TableCell>
                              <Select value={editExtKind} onValueChange={v => setEditExtKind(v)}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="freelancer">Freelancer</SelectItem>
                                  <SelectItem value="partner">Partner</SelectItem>
                                  <SelectItem value="manager">Manager</SelectItem>
                                  <SelectItem value="intern">Intern</SelectItem>
                                  <SelectItem value="founder">Founder</SelectItem>
                                  <SelectItem value="advisor">Advisor</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Input
                                  type="number"
                                  min="0"
                                  placeholder="0"
                                  value={editExtRate}
                                  onChange={e => setEditExtRate(e.target.value)}
                                  className="h-8 text-sm w-[72px]"
                                />
                                <Select value={editExtRateCurrency} onValueChange={v => setEditExtRateCurrency(v)}>
                                  <SelectTrigger className="h-8 text-xs w-[62px]"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="EUR">EUR</SelectItem>
                                    <SelectItem value="USD">USD</SelectItem>
                                    <SelectItem value="CHF">CHF</SelectItem>
                                    <SelectItem value="GBP">GBP</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  onClick={() => saveEditExt(c.id)}
                                  disabled={!editExtName.trim() || !editExtEmail.trim()}
                                  className="text-emerald-600 hover:text-emerald-700 p-1 rounded transition-colors disabled:opacity-40"
                                  title="Save"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setEditingExtId(null)}
                                  className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                                  title="Cancel"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      }
                      // ── Read-only row ──────────────────────────────
                      return (
                        <TableRow key={c.id} className="hover:bg-muted/20 group">
                          <TableCell className="font-semibold text-sm">{c.name}</TableCell>
                          <TableCell className="text-xs font-mono">
                            <a href={`mailto:${c.email}`} className="text-primary hover:underline">
                              {c.email}
                            </a>
                          </TableCell>
                          <TableCell>
                            {(() => {
                              if (c.is_employee && c.employee_role_code) {
                                const code = c.employee_role_code.toLowerCase();
                                const cls =
                                  code.startsWith("em") ? "bg-emerald-100 text-emerald-800" :
                                  code === "int"        ? "bg-amber-100 text-amber-800" :
                                  code.startsWith("a")  ? "bg-blue-100 text-blue-800" :
                                  code.startsWith("p")  ? "bg-violet-100 text-violet-800" :
                                                          "bg-slate-100 text-slate-800";
                                return (
                                  <span
                                    className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-medium ${cls}`}
                                    title={c.employee_role_name ?? c.employee_role_code}
                                  >
                                    {c.employee_role_code}
                                    <span className="ml-1 text-[8px] opacity-60">EMP</span>
                                  </span>
                                );
                              }
                              const cls =
                                c.kind === "partner"    ? "bg-violet-100 text-violet-800" :
                                c.kind === "freelancer" ? "bg-blue-100 text-blue-800" :
                                c.kind === "manager"    ? "bg-emerald-100 text-emerald-800" :
                                c.kind === "intern"     ? "bg-amber-100 text-amber-800" :
                                c.kind === "founder"    ? "bg-rose-100 text-rose-800" :
                                c.kind === "advisor"    ? "bg-cyan-100 text-cyan-800" :
                                                          "bg-muted text-muted-foreground";
                              return (
                                <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-medium uppercase ${cls}`}>
                                  {c.kind}
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-sm font-mono" data-privacy="blur">
                            {c.daily_rate != null
                              ? `${c.daily_rate_currency ?? "EUR"} ${Number(c.daily_rate).toLocaleString()}`
                              : <span className="text-muted-foreground text-xs italic">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => startEditExt(c)}
                                className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
                                title="Edit"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteExternalContact(c.id, c.name)}
                                className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
                                title="Remove"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            )}
            <div className="text-[10px] text-muted-foreground italic px-4 py-2 border-t">
              The "Copy all emails" button (top-right) gathers every name+email here, plus any employee
              email captured elsewhere, sorts alphabetically, and copies to clipboard as
              <code className="text-[10px] mx-1">Name &lt;email&gt;; …</code> ready to paste in Outlook.
            </div>
          </div>
        )}

        {mainTab === "employees" && <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Hire Date</TableHead>
              <TableHead>Last Promo</TableHead>
              <TableHead className="text-right">Age</TableHead>
              <TableHead className="text-right">Tenure EEN</TableHead>
              <TableHead className="text-right">Tenure (Total)</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Yearly Gross</TableHead>
              <TableHead className="text-right">Gross/mo</TableHead>
              <TableHead className="text-right">Net/mo</TableHead>
              <TableHead className="text-right">RAL</TableHead>
              <TableHead className="text-center">Paychecks</TableHead>
              <TableHead className="text-right">Meal Voucher</TableHead>
              <TableHead className="w-[180px]">Band Position</TableHead>
              <TableHead className="text-center">Churn Risk</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEmployees.map((emp) => {
              const metrics = calculateEmployeeMetrics(emp, roleGrid, settings);
              return (
                <React.Fragment key={emp.id}>
                  <TableRow
                    key={`${emp.id}-row`}
                    className="group cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedEmpId(emp.id)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{emp.name}</span>
                        {emp.pending_salary_date && emp.pending_salary_gross && (() => {
                          const today = new Date().toISOString().slice(0, 10);
                          const isDue = emp.pending_salary_date <= today;
                          return (
                            <div className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded w-fit ${isDue ? "bg-emerald-50 border border-emerald-300 text-emerald-700" : "bg-amber-50 border border-amber-200 text-amber-700"}`}>
                              {isDue ? <CheckCircle2 className="w-2.5 h-2.5" /> : <TrendingUp className="w-2.5 h-2.5" />}
                              €{emp.pending_salary_gross.toLocaleString()} from {format(parseISO(emp.pending_salary_date), "MM/yy")}
                              {isDue && (
                                <button
                                  className="ml-1 underline hover:no-underline text-emerald-700 font-bold"
                                  onClick={(e) => { e.stopPropagation(); handleApplyRaise(emp); }}
                                >
                                  Apply
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </TableCell>
                    <TableCell>
                        <span className="bg-secondary px-2 py-1 rounded text-xs font-mono">{emp.current_role_code}</span>
                    </TableCell>
                    <TableCell>{emp.hire_date}</TableCell>
                    <TableCell>{emp.last_promo_date ? format(parseISO(emp.last_promo_date), "MM/yy") : "-"}</TableCell>
                    <TableCell className="text-right">{metrics.age}</TableCell>
                    <TableCell className="text-right text-xs">{metrics.hireTenure.toFixed(1)}y</TableCell>
                    <TableCell className="text-right text-xs">{metrics.totalTenure.toFixed(1)}y</TableCell>
                    <TableCell className="text-right text-xs">
                        <div className="flex justify-end items-center gap-2">
                            {metrics.performance_score !== null ? (
                                <span className={metrics.performance_score >= 8.5 ? "text-purple-600 font-bold" : ""}>
                                    {metrics.performance_score.toFixed(1)}
                                </span>
                            ) : (
                                <span className="text-muted-foreground italic">Na</span>
                            )}
                        </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">€{emp.current_gross_fixed_year.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-xs">€{Math.round(metrics.gross_month).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-emerald-700">€{Math.round(metrics.net_month).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">€{Math.round(grossToRal(emp.current_gross_fixed_year) * 1000).toLocaleString()}</TableCell>
                    <TableCell className="text-center">
                      <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${emp.months_paid === 13 ? "bg-violet-100 text-violet-700" : "bg-muted text-muted-foreground"}`}>
                        {emp.months_paid}mo
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {emp.meal_voucher_daily > 0 ? (
                        <div className="flex flex-col items-end">
                          <span className="font-semibold">€{emp.meal_voucher_daily}/d</span>
                          <span className="text-muted-foreground text-[10px]">€{Math.round(emp.meal_voucher_daily * (settings.meal_voucher_days_per_month ?? 20))}/mo</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <BandPosition metrics={metrics} />
                    </TableCell>
                    <TableCell className="text-center">
                      {(() => {
                        if ((emp as any).status === "former") return <span className="text-muted-foreground text-xs">—</span>;
                        const { score, level } = computeChurnScore(emp);
                        if (level === "low") return <span className="text-[11px] text-muted-foreground font-mono">{score}</span>;
                        return (
                          <span className={`inline-flex items-center justify-center w-10 h-6 rounded text-[11px] font-bold font-mono ${
                            level === "high" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                          }`} title={level}>
                            {score}
                          </span>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}
            {filteredEmployees.length === 0 && (
                <TableRow>
                    <TableCell colSpan={16} className="text-center py-12 text-muted-foreground">
                        No employees found.
                    </TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>}
      </Card>
      )}

      {/* ── Former Employees ────────────────────────────────────────────────── */}
      {formerEmployees.length > 0 && (
        <Card className="border-slate-200">
          <button
            onClick={() => setShowFormer(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
          >
            <span className="flex items-center gap-2">
              <UserX className="w-4 h-4" />
              Former Employees ({formerEmployees.length})
            </span>
            {showFormer ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showFormer && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Hire Date</TableHead>
                  <TableHead>Retired</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formerEmployees.map(emp => (
                  <TableRow
                    key={emp.id}
                    className="hover:bg-muted/50 text-muted-foreground"
                  >
                    <TableCell className="font-medium cursor-pointer" onClick={() => setSelectedEmpId(emp.id)}>{emp.name}</TableCell>
                    <TableCell className="cursor-pointer" onClick={() => setSelectedEmpId(emp.id)}>{emp.current_role_code}</TableCell>
                    <TableCell className="cursor-pointer" onClick={() => setSelectedEmpId(emp.id)}>{emp.hire_date}</TableCell>
                    <TableCell className="cursor-pointer" onClick={() => setSelectedEmpId(emp.id)}>{(emp as any).retired_at ?? "—"}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                        onClick={async () => {
                          if (confirm(`Reinstate ${emp.name} as an active employee?`)) {
                            await unretireEmployee(emp.id);
                          }
                        }}
                      >
                        Unretire
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      <EmployeeDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        editingId={null}
      />
    </div>
  );
}

function EmployeeDetailPage({ employee, onBack }: { employee: EmployeeInput; onBack: () => void }) {
  const { updateEmployee, retireEmployee, unretireEmployee, roleGrid, settings } = useStore();
  const { toast } = useToast();
  const metrics = calculateEmployeeMetrics(employee, roleGrid, settings);

  // ── react-hook-form for editable fields ──
  const last12Months = useMemo(() => {
    const months: string[] = [];
    const d = new Date();
    for (let i = 0; i < 12; i++) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      months.push(`${y}-${m}`);
      d.setMonth(d.getMonth() - 1);
    }
    return months;
  }, []);

  const existingMap = new Map((employee.monthly_ratings || []).map(r => [r.month, r.score]));
  const initialRatings12 = last12Months.map(month => ({
    month,
    score: existingMap.has(month) ? existingMap.get(month)! : null as any,
  }));

  const form = useForm<EmployeeInput>({
    resolver: zodResolver(employeeInputSchema),
    defaultValues: {
      ...employee,
      monthly_ratings: initialRatings12.filter(r => r.score != null),
      completed_tests: (employee.completed_tests ?? []).map((t: any) => typeof t === 'string' ? { id: t, score: null } : t),
      onboarding_ratings: (employee as any).onboarding_ratings ?? [],
      yearly_reviews: (employee as any).yearly_reviews ?? [],
      comex_areas: (employee as any).comex_areas ?? {},
      promotion_discussion_notes: (employee as any).promotion_discussion_notes ?? null,
      university_grade: (employee as any).university_grade ?? null,
      university_grade_type: (employee as any).university_grade_type ?? null,
    },
  });

  const [ratings12, setRatings12] = useState<{ month: string; score: number | null }[]>(initialRatings12);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [salaryRefreshKey, setSalaryRefreshKey] = useState(0);
  // Auto-save plumbing — debounce form changes and write through after
  // a brief idle period so the user never has to remember to click
  // Save. The Save button stays as an immediate-save affordance and a
  // status indicator (Saving… / Saved).
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMountRef = React.useRef(true);

  // Reset form when employee changes
  useEffect(() => {
    const existMap = new Map((employee.monthly_ratings || []).map(r => [r.month, r.score]));
    const ratings = last12Months.map(month => ({
      month,
      score: existMap.has(month) ? existMap.get(month)! : null as any,
    }));
    form.reset({
      ...employee,
      monthly_ratings: ratings.filter(r => r.score != null),
      completed_tests: (employee.completed_tests ?? []).map((t: any) => typeof t === 'string' ? { id: t, score: null } : t),
      onboarding_ratings: (employee as any).onboarding_ratings ?? [],
      yearly_reviews: (employee as any).yearly_reviews ?? [],
      comex_areas: (employee as any).comex_areas ?? {},
      promotion_discussion_notes: (employee as any).promotion_discussion_notes ?? null,
      university_grade: (employee as any).university_grade ?? null,
      university_grade_type: (employee as any).university_grade_type ?? null,
    });
    setRatings12(ratings);
  }, [employee.id]);

  // Auto-mark Onboarding test as completed with avg of weekly ratings
  useEffect(() => {
    const onboardingTest = settings.tests?.find(t => t.name.toLowerCase() === "onboarding");
    if (!onboardingTest) return;
    const weeklyScores = ((employee as any).onboarding_ratings ?? [])
      .filter((r: any) => r.score != null).map((r: any) => r.score as number);
    if (weeklyScores.length === 0) return;
    const avg = Math.round(weeklyScores.reduce((a, b) => a + b, 0) / weeklyScores.length);
    const current: CompletedTest[] = form.getValues("completed_tests") || [];
    const idx = current.findIndex(ct => ct.id === onboardingTest.id);
    if (idx >= 0) {
      if (current[idx].score !== avg) {
        const updated = [...current];
        updated[idx] = { id: onboardingTest.id, score: avg };
        form.setValue("completed_tests", updated);
      }
    } else {
      form.setValue("completed_tests", [...current, { id: onboardingTest.id, score: avg }]);
    }
  }, [employee.id, (employee as any).onboarding_ratings]);

  const updateRating12 = (month: string, score: number | null) => {
    const updated = ratings12.map(r => r.month === month ? { ...r, score } : r);
    setRatings12(updated);
    form.setValue("monthly_ratings", updated.filter(r => r.score != null) as any);
  };

  const onSubmit = async (data: EmployeeInput) => {
    // In-flight guard — prevents the manual Save button from racing the
    // debounced auto-save. If a save is already in progress, drop this
    // call (the next form change will queue a fresh debounce).
    if (saveState === "saving") return;
    setSaveState("saving");
    try {
      const prevGross = employee.current_gross_fixed_year;
      const prevRole = employee.current_role_code;
      const grossChanged = prevGross !== data.current_gross_fixed_year;
      const roleChanged = prevRole !== data.current_role_code;
      const isAutoSave = (data as any).__autoSave === true;

      await updateEmployee(employee.id, data);

      // Only WRITE a salary_history row on EXPLICIT saves. Auto-saves
      // fire every 1.5s of typing and would otherwise pollute the chart
      // with one row per pause as the user enters a new gross figure.
      // The user clicks Save once to commit a real promotion / raise.
      if ((grossChanged || roleChanged) && !isAutoSave) {
        const note = roleChanged && grossChanged
          ? `Promotion to ${data.current_role_code}`
          : roleChanged
          ? `Role change to ${data.current_role_code}`
          : "Salary update";
        await fetch("/api/salary-history", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee_id: employee.id,
            effective_date: new Date().toISOString().slice(0, 10),
            role_code: data.current_role_code,
            gross_fixed_year: data.current_gross_fixed_year,
            months_paid: data.months_paid,
            bonus_pct: data.current_bonus_pct,
            meal_voucher_daily: data.meal_voucher_daily,
            note,
          }),
        });
      }

      if (grossChanged || roleChanged) setSalaryRefreshKey(k => k + 1);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
      // Skip the toast for auto-saves — too noisy. Only show on
      // explicit submit (the form button click goes through this same
      // path but with isAutoSave=false).
      if (!(data as any).__autoSave) {
        toast({ title: "Employee saved" });
      }
    } catch (err) {
      setSaveState("idle");
      toast({ title: "Error saving employee", description: String(err), variant: "destructive" });
    }
  };

  // ── Auto-save effect ─────────────────────────────────────────────
  // Watches every form field via react-hook-form's watch() subscription
  // and triggers `onSubmit` after 1.5s of idle time. The merged-fields
  // logic from the explicit submit handler is replicated here so inline
  // store updates (promo_increase_override, completed_tests, etc.) are
  // preserved. Validation runs through the same employeeInputSchema —
  // if it fails (mid-edit, missing required field) the save is silently
  // skipped and re-attempted on the next change.
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    const subscription = form.watch(() => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        const raw = form.getValues();
        // Merge inline-updated fields from the latest employee snapshot
        // so auto-save doesn't clobber inline edits made elsewhere.
        raw.promo_increase_override = employee.promo_increase_override;
        raw.completed_tests = employee.completed_tests;
        (raw as any).onboarding_ratings = (employee as any).onboarding_ratings;
        (raw as any).yearly_reviews = (employee as any).yearly_reviews;
        (raw as any).comex_areas = (employee as any).comex_areas;
        (raw as any).university_grade = (employee as any).university_grade;
        (raw as any).university_grade_type = (employee as any).university_grade_type;
        (raw as any).promotion_discussion_notes = (employee as any).promotion_discussion_notes;
        const result = employeeInputSchema.safeParse(raw);
        if (!result.success) {
          // Mid-edit invalid state — skip silently. The form will be
          // valid again on the next keystroke and we'll retry.
          return;
        }
        (result.data as any).__autoSave = true;
        onSubmit(result.data);
      }, 1500);
    });
    return () => {
      subscription.unsubscribe();
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
    // employee.id is the stable key for which employee we're editing;
    // form is a stable react-hook-form instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id]);

  const handleRetire = async () => {
    if (confirm(`Retire ${employee.name}? They will be moved to Former Employees. No data is deleted.`)) {
      await retireEmployee(employee.id);
      toast({ title: `${employee.name} retired`, description: "Moved to Former Employees. All data retained." });
      onBack();
    }
  };

  const handleUnretire = async () => {
    if (confirm(`Reinstate ${employee.name} as an active employee?`)) {
      await unretireEmployee(employee.id);
      toast({ title: `${employee.name} reinstated`, description: "Moved back to active employees." });
      onBack();
    }
  };

  // ── Salary history inline ──
  const [salaryHistory, setSalaryHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistoryForm, setShowHistoryForm] = useState(false);
  const today = new Date();
  const [histFormMonth, setHistFormMonth] = useState(today.getMonth() + 1);
  const [histFormYear, setHistFormYear] = useState(today.getFullYear());
  const [histFormRole, setHistFormRole] = useState(employee.current_role_code);
  const [histFormGross, setHistFormGross] = useState(employee.current_gross_fixed_year);
  const [histFormMonths, setHistFormMonths] = useState<number>(employee.months_paid);
  const [histFormBonus, setHistFormBonus] = useState<number>(employee.current_bonus_pct ?? 0);
  const [histFormVoucher, setHistFormVoucher] = useState<number>(employee.meal_voucher_daily ?? 0);
  const [histFormNote, setHistFormNote] = useState("");

  // Editing existing salary history entry
  const [editHistId, setEditHistId] = useState<number | null>(null);
  const [editHistDate, setEditHistDate] = useState("");
  const [editHistRole, setEditHistRole] = useState("");
  const [editHistGross, setEditHistGross] = useState(0);
  const [editHistMonths, setEditHistMonths] = useState(13);
  const [editHistBonus, setEditHistBonus] = useState(0);
  const [editHistVoucher, setEditHistVoucher] = useState(0);
  const [editHistNote, setEditHistNote] = useState("");

  const loadSalaryHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/salary-history/${employee.id}`, { credentials: "include" });
      const data = await res.json();
      setSalaryHistory((data as any[]).sort((a, b) => a.effective_date.localeCompare(b.effective_date)));
    } catch {
      toast({ title: "Failed to load salary history", variant: "destructive" });
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { loadSalaryHistory(); }, [employee.id, salaryRefreshKey]);

  const MONTHS_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const HIST_YEARS = Array.from({ length: new Date().getFullYear() - 2022 + 3 }, (_, i) => 2023 + i);
  const buildDate = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;
  const fmtDate = (d: string) => { const [y, m] = d.split("-"); return `${MONTHS_LABELS[parseInt(m) - 1]} ${y}`; };
  const TODAY_STR = new Date().toISOString().slice(0, 10);

  const handleAddHistoryEntry = async () => {
    if (!histFormGross || histFormGross <= 0) return;
    try {
      await fetch("/api/salary-history", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employee.id,
          effective_date: buildDate(histFormYear, histFormMonth),
          role_code: histFormRole,
          gross_fixed_year: histFormGross,
          months_paid: histFormMonths,
          bonus_pct: histFormBonus,
          meal_voucher_daily: histFormVoucher,
          note: histFormNote,
        }),
      });
      await loadSalaryHistory();
      setShowHistoryForm(false);
      setHistFormNote("");
      toast({ title: "Salary entry added" });
    } catch {
      toast({ title: "Failed to save entry", variant: "destructive" });
    }
  };

  const handleDeleteHistoryEntry = async (id: number) => {
    if (!confirm("Delete this entry?")) return;
    try {
      await fetch(`/api/salary-history/${id}`, { method: "DELETE", credentials: "include" });
      setSalaryHistory(e => e.filter(x => x.id !== id));
      toast({ title: "Entry deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const startEditHist = (entry: any) => {
    setEditHistId(entry.id);
    setEditHistDate(entry.effective_date);
    setEditHistRole(entry.role_code || "");
    setEditHistGross(entry.gross_fixed_year);
    setEditHistMonths(entry.months_paid ?? 13);
    setEditHistBonus(entry.bonus_pct ?? 0);
    setEditHistVoucher(entry.meal_voucher_daily ?? 0);
    setEditHistNote(entry.note ?? "");
  };

  const saveEditHist = async () => {
    if (!editHistId) return;
    try {
      await fetch(`/api/salary-history/${editHistId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          effective_date: editHistDate,
          role_code: editHistRole,
          gross_fixed_year: editHistGross,
          months_paid: editHistMonths,
          bonus_pct: editHistBonus,
          meal_voucher_daily: editHistVoucher,
          note: editHistNote,
        }),
      });
      await loadSalaryHistory();
      setEditHistId(null);
      toast({ title: "Entry updated" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  // ── Schedule raise inline ──
  const [raiseGross, setRaiseGross] = useState(employee.current_gross_fixed_year);
  const [raiseDate, setRaiseDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [raiseNote, setRaiseNote] = useState("");
  const [raiseSaving, setRaiseSaving] = useState(false);

  useEffect(() => {
    setRaiseGross(employee.current_gross_fixed_year);
    setRaiseNote("");
  }, [employee.id]);

  const handleScheduleRaise = async () => {
    if (!raiseGross || raiseGross <= 0 || !raiseDate) return;
    setRaiseSaving(true);
    try {
      await updateEmployee(employee.id, {
        ...employee,
        pending_salary_gross: raiseGross,
        pending_salary_date: raiseDate,
      });
      await fetch("/api/salary-history", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employee.id,
          effective_date: raiseDate,
          role_code: employee.current_role_code,
          gross_fixed_year: raiseGross,
          months_paid: employee.months_paid,
          bonus_pct: employee.current_bonus_pct,
          meal_voucher_daily: employee.meal_voucher_daily,
          note: raiseNote || "Scheduled salary increase",
        }),
      });
      toast({ title: `Salary increase scheduled from ${format(parseISO(raiseDate), "dd/MM/yyyy")}` });
      await loadSalaryHistory();
    } catch (err) {
      toast({ title: "Failed to schedule raise", description: String(err), variant: "destructive" });
    } finally {
      setRaiseSaving(false);
    }
  };

  const raiseIncrease = raiseGross - employee.current_gross_fixed_year;
  const raiseIncreasePct = employee.current_gross_fixed_year > 0
    ? ((raiseIncrease / employee.current_gross_fixed_year) * 100)
    : 0;

  const emp = employee;

  return (
    <div className="space-y-6">
      {/* Back button + header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to list
        </Button>
      </div>

      <form onSubmit={async (e) => {
        e.preventDefault();
        // Bypass zodResolver — use manual safeParse so z.preprocess always runs
        const raw = form.getValues();
        // Merge in latest inline-updated fields from employee prop (store)
        // to prevent stale form values overwriting inline changes
        raw.promo_increase_override = employee.promo_increase_override;
        raw.completed_tests = employee.completed_tests;
        raw.onboarding_ratings = (employee as any).onboarding_ratings;
        raw.yearly_reviews = (employee as any).yearly_reviews;
        raw.comex_areas = (employee as any).comex_areas;
        raw.university_grade = (employee as any).university_grade;
        raw.university_grade_type = (employee as any).university_grade_type;
        raw.promotion_discussion_notes = (employee as any).promotion_discussion_notes;
        const result = employeeInputSchema.safeParse(raw);
        if (!result.success) {
          const details = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
          console.error("Validation errors:", result.error.issues);
          toast({ title: "Cannot save — validation failed", description: details.join("; "), variant: "destructive" });
          return;
        }
        await onSubmit(result.data);
      }} className="space-y-6">

        {/* Employee header — sticky */}
        <Card className="p-4 sticky top-16 z-40 shadow-md">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold">{emp.name}</h2>
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground flex-wrap">
                <span className="bg-secondary px-2 py-0.5 rounded text-xs font-mono font-semibold">{emp.current_role_code}</span>
                {emp.date_of_birth && <span>Born {format(parseISO(emp.date_of_birth), "dd/MM/yyyy")}</span>}
                <span>Hired {emp.hire_date}</span>
                {emp.pending_salary_date && emp.pending_salary_gross && (() => {
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const isDue = emp.pending_salary_date <= todayStr;
                  return (
                    <span className={`flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${isDue ? "bg-emerald-50 border border-emerald-300 text-emerald-700" : "bg-amber-50 border border-amber-200 text-amber-700"}`}>
                      {isDue ? <CheckCircle2 className="w-2.5 h-2.5" /> : <TrendingUp className="w-2.5 h-2.5" />}
                      Pending: €{emp.pending_salary_gross.toLocaleString()} from {format(parseISO(emp.pending_salary_date), "MM/yy")}
                    </span>
                  );
                })()}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button type="button" variant="outline" size="sm" onClick={() => {
                loadSalaryHistory();
                setSalaryRefreshKey(k => k + 1);
                toast({ title: "Refreshed" });
              }}>
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button type="submit" disabled={saveState !== "idle"} size="sm"
                className={`shadow-lg ${saveState === "saved" ? "bg-emerald-600 hover:bg-emerald-600" : "shadow-primary/20"}`}>
                {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save"}
              </Button>
            </div>
          </div>
        </Card>

        {/* 2-column grid: left = editable form, right = calculated projections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* LEFT: editable form fields */}
          <div className="space-y-6">
            <Card className="p-4 space-y-4">
              <h4 className="font-bold text-sm">Basic Info</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Input {...form.register("name")} />
                  {form.formState.errors.name && <span className="text-destructive text-xs">{form.formState.errors.name.message}</span>}
                </div>
                <div className="space-y-2">
                  <Label>Date of Birth</Label>
                  <Input type="date" {...form.register("date_of_birth")} />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Controller
                    control={form.control}
                    name="current_role_code"
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                        <SelectContent>
                          {roleGrid.map(role => (
                            <SelectItem key={role.role_code} value={role.role_code}>{role.role_name} ({role.role_code})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Hire Date</Label>
                  <Input type="date" {...form.register("hire_date")} />
                </div>
                <div className="space-y-2">
                  <Label>Last Promotion Date</Label>
                  <Input type="date" {...form.register("last_promo_date")} />
                  <p className="text-[10px] text-muted-foreground italic">Leave blank if first role</p>
                </div>
                <div className="space-y-2">
                  <Label>Yearly Gross Salary</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                    <Input type="number" className="pl-7" {...form.register("current_gross_fixed_year", { valueAsNumber: true })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Months Paid</Label>
                  <Controller
                    control={form.control}
                    name="months_paid"
                    render={({ field }) => (
                      <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="12">12 Months</SelectItem>
                          <SelectItem value="13">13 Months</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Default Rate (Fallback)</Label>
                  <Input type="number" step="0.1" min="1" max="10" {...form.register("performance_score", { valueAsNumber: true })} />
                  <p className="text-xs text-muted-foreground">&gt;8.5: Fast, 7-8.5: Normal, 5-7: Slow</p>
                </div>
                <div className="space-y-2">
                  <Label>Meal Voucher (Daily €)</Label>
                  <Input type="number" step="0.5" {...form.register("meal_voucher_daily", { valueAsNumber: true })} />
                </div>
                <div className="space-y-2">
                  <Label>Years Tenure Before Eendigo</Label>
                  <Input type="number" step="0.1" {...form.register("tenure_before_years", { valueAsNumber: true })} />
                </div>
              </div>
            </Card>

            {/* Monthly Ratings */}
            <Card className="p-4 space-y-3">
              <Label className="text-sm font-bold">Monthly Ratings (last 12 months)</Label>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0">
                {ratings12.map(({ month, score }) => {
                  const [y, m] = month.split("-");
                  const label = `${m}/${y.slice(2)}`;
                  return (
                    <div key={month} className="flex items-center justify-between py-1 border-b border-muted/40 last:border-0">
                      <span className="text-sm font-mono text-muted-foreground w-14">{label}</span>
                      <div className="flex items-center gap-1">
                        <button type="button" className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"
                          onClick={() => updateRating12(month, score != null ? Math.max(1, Math.round((score - 0.5) * 10) / 10) : 7)}>
                          <ChevronLeft className="h-3 w-3" />
                        </button>
                        <input type="number" step="0.5" min="1" max="10"
                          className="h-7 w-14 text-center text-sm border rounded font-mono bg-background"
                          value={score ?? ""} placeholder="—"
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            updateRating12(month, isNaN(v) ? null : Math.min(10, Math.max(1, v)));
                          }}
                        />
                        <button type="button" className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"
                          onClick={() => updateRating12(month, score != null ? Math.min(10, Math.round((score + 0.5) * 10) / 10) : 7)}>
                          <ChevronRightIcon className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground italic">Leave a month blank to exclude it. Filled months are averaged for the Rate.</p>
            </Card>

            {/* Completed Tests */}
            <Card className="p-4 space-y-3">
              <Label className="text-sm font-bold">Completed Tests</Label>
              <div className="grid grid-cols-2 gap-3">
                {settings.tests.map(test => {
                  const completedTests: CompletedTest[] = form.watch("completed_tests") || [];
                  const entry = completedTests.find(ct => ct.id === test.id);
                  const isChecked = !!entry;
                  // Onboarding test is auto-managed from weekly ratings
                  const isOnboardingAuto = test.name.toLowerCase() === "onboarding" &&
                    ((employee as any).onboarding_ratings ?? []).filter((r: any) => r.score != null).length > 0;
                  return (
                    <div key={test.id} className={`flex items-center gap-2 p-2 rounded-lg border ${isChecked ? 'bg-primary/5 border-primary/20' : 'bg-muted/10'}`}>
                      <input type="checkbox" id={`detail-test-${test.id}`} checked={isChecked}
                        disabled={isOnboardingAuto}
                        onChange={(e) => {
                          const current: CompletedTest[] = form.getValues("completed_tests") || [];
                          if (e.target.checked) {
                            form.setValue("completed_tests", [...current, { id: test.id, score: null }]);
                          } else {
                            form.setValue("completed_tests", current.filter(ct => ct.id !== test.id));
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <Label htmlFor={`detail-test-${test.id}`} className="text-sm font-normal cursor-pointer flex-1">
                        {test.name}
                        {isOnboardingAuto && <span className="text-[9px] text-muted-foreground ml-1">(auto from W1-W8)</span>}
                      </Label>
                      {isChecked && (
                        <Input type="number" min="0" max="100" placeholder="Score" className="h-7 w-20 text-xs"
                          value={entry?.score ?? ""}
                          readOnly={isOnboardingAuto}
                          onChange={(e) => {
                            if (isOnboardingAuto) return;
                            const current: CompletedTest[] = [...(form.getValues("completed_tests") || [])];
                            const idx = current.findIndex(ct => ct.id === test.id);
                            if (idx !== -1) {
                              current[idx] = { ...current[idx], score: e.target.value === "" ? null : Number(e.target.value) };
                              form.setValue("completed_tests", current);
                            }
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* RIGHT: calculated projections */}
          <div className="space-y-6">
            {/* Project Allocations */}
            <ProjectAllocations employeeName={form.getValues("name")} employeeId={employee.id} onRefresh={() => {}} />

            {/* Promotion Tracks */}
            <Card className="p-4 bg-background">
              <h4 className="font-bold text-sm mb-4">Promotion Tracks</h4>
              <div className="space-y-3">
                {metrics.tracks.map(t => (
                  <div key={t.label} className={`p-3 rounded-lg border ${t.isRecommended ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border'}`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-bold">{t.label} Track</span>
                      {t.isRecommended && <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded font-bold uppercase">Recommended</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-y-1 text-xs text-muted-foreground">
                      <span>Promo Duration:</span> <span className="text-foreground text-right">{t.months} months</span>
                      <span>Eligibility Date:</span> <span className="text-foreground text-right">{format(t.eligibilityDate, "dd/MM/yy")}</span>
                      <span>Effective Date:</span> <span className="text-primary font-bold text-right">{format(t.effectiveDate, "MM/yy")}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* EEN Tenure vs Normal/Fast TOT */}
              {metrics.normal_tot_months > 0 && (() => {
                const eenMonths = Math.round(metrics.hireTenure * 12);
                const normTot = metrics.normal_tot_months;
                const fastTot = metrics.fast_tot_months ?? 0;
                const deltaNorm = eenMonths - normTot;
                const isAheadNorm = deltaNorm >= 0;
                const belowFast = fastTot > 0 && eenMonths < fastTot;
                const toYears = (mo: number) => (mo / 12).toFixed(1) + "y";
                const nextRoleName = roleGrid.find(r => r.role_code === metrics.next_role_code)?.role_name ?? metrics.next_role_code ?? "next role";
                return (
                  <div className={`mt-3 p-3 rounded-lg border text-xs ${isAheadNorm ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
                    <div className="font-bold text-sm mb-2">Path to {nextRoleName}</div>
                    <div className="grid grid-cols-2 gap-y-1 text-muted-foreground">
                      <span>EEN Tenure:</span>
                      <span className="text-right font-mono font-semibold text-foreground">{toYears(eenMonths)}</span>
                      <span className="text-blue-700">Normal path TOT:</span>
                      <span className="text-right font-mono font-semibold text-blue-700">{toYears(normTot)}</span>
                      {fastTot > 0 && <>
                        <span className="text-purple-700">Fast path TOT:</span>
                        <span className="text-right font-mono font-semibold text-purple-700">{toYears(fastTot)}</span>
                      </>}
                      <span>vs Normal:</span>
                      <span className={`text-right font-mono font-bold ${isAheadNorm ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {isAheadNorm ? "+" : ""}{toYears(deltaNorm)}
                      </span>
                    </div>
                    {belowFast && (
                      <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-destructive bg-destructive/10 border border-destructive/20 rounded px-2 py-1">
                        Below fast-track minimum ({toYears(fastTot)}) — not eligible yet
                      </div>
                    )}
                    {!belowFast && (
                      <div className={`mt-1 text-[10px] font-semibold ${isAheadNorm ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {isAheadNorm ? `${toYears(deltaNorm)} ahead of normal path` : `${toYears(Math.abs(deltaNorm))} behind normal path`}
                      </div>
                    )}
                  </div>
                );
              })()}
            </Card>

            {/* Promotion Salary Projection */}
            <Card className="p-4 bg-background">
              <h4 className="font-bold text-sm mb-4">Promotion Salary Projection</h4>
              {metrics.performance_score === null ? (
                <p className="text-xs text-muted-foreground italic">N/A (Enter monthly ratings to see projection)</p>
              ) : metrics.performance_score <= 5 ? (
                <p className="text-xs text-muted-foreground italic">N/A (No promotion recommended for rate &le; 5)</p>
              ) : !metrics.next_role_code ? (
                <p className="text-xs text-muted-foreground italic">N/A (Top role reached)</p>
              ) : (
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Policy:</span>
                    <span className="text-right text-xs italic">{metrics.policy_applied}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t">
                    <span className="text-muted-foreground">Future Monthly Gross:</span>
                    <span className="font-bold text-emerald-600">€{Math.round(metrics.future_gross_month).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Future Yearly Gross:</span>
                    <span className="font-bold text-emerald-600">€{Math.round(metrics.annual_future).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Future RAL:</span>
                    <span className="font-bold text-emerald-600">€{Math.round(grossToRal(metrics.annual_future) * 1000).toLocaleString()}</span>
                  </div>

                  {/* Band targets */}
                  {metrics.next_min > 0 && (() => {
                    const cur = emp.current_gross_fixed_year;
                    const nextRole = roleGrid.find(r => r.role_code === metrics.next_role_code);
                    const mo = nextRole?.months_paid ?? emp.months_paid;
                    const targets = [
                      { label: "Min", annual: metrics.next_min },
                      { label: "Mid", annual: Math.round((metrics.next_min + metrics.next_max) / 2) },
                      { label: "Max", annual: metrics.next_max },
                    ];
                    return (
                      <div className="pt-2 border-t">
                        <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1.5 tracking-wide">
                          % increase to reach {metrics.next_role_code} band
                        </div>
                        <div className="space-y-1">
                          {targets.map(tgt => {
                            const pct = ((tgt.annual - cur) / cur) * 100;
                            const monthly = Math.round(tgt.annual / mo);
                            const color = pct <= 10 ? "text-emerald-600" : pct <= 20 ? "text-amber-600" : "text-destructive";
                            return (
                              <div key={tgt.label} className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground w-6">{tgt.label}</span>
                                <span className="font-mono text-foreground">€{tgt.annual.toLocaleString()}/yr</span>
                                <span className="text-muted-foreground font-mono text-[10px]">€{monthly.toLocaleString()}/mo</span>
                                <span className={`font-bold font-mono min-w-[52px] text-right ${color}`}>
                                  {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Increase vs Today:</span>
                    <div className="flex items-center gap-2">
                      <button type="button" className="h-6 w-6 rounded border flex items-center justify-center hover:bg-muted text-muted-foreground"
                        onClick={async () => {
                          const cur = emp.promo_increase_override ?? settings.min_promo_increase_pct;
                          const next = Math.round((cur - 0.5) * 10) / 10;
                          if (next >= 0) {
                            form.setValue("promo_increase_override", next);
                            await updateEmployee(emp.id, { ...emp, promo_increase_override: next });
                          }
                        }}>
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                      <div className="text-right min-w-[60px]">
                        {/* Employees without a current salary would show
                            "+Infinity%" — render "New hire" instead. */}
                        {!emp.current_gross_fixed_year || emp.current_gross_fixed_year <= 0 ? (
                          <>
                            <div className="font-bold text-muted-foreground">—</div>
                            <div className="text-[10px] text-muted-foreground italic">New hire</div>
                          </>
                        ) : (
                          <>
                            <div className="font-bold text-emerald-600">+{metrics.increase_pct.toFixed(1)}%</div>
                            <div className="text-[10px] text-muted-foreground">+€{Math.round(metrics.increase_amount_monthly).toLocaleString()}/mo</div>
                          </>
                        )}
                      </div>
                      <button type="button" className="h-6 w-6 rounded border flex items-center justify-center hover:bg-muted text-muted-foreground"
                        onClick={async () => {
                          const cur = emp.promo_increase_override ?? settings.min_promo_increase_pct;
                          const next = Math.round((cur + 0.5) * 10) / 10;
                          if (next <= 100) {
                            form.setValue("promo_increase_override", next);
                            await updateEmployee(emp.id, { ...emp, promo_increase_override: next });
                          }
                        }}>
                        <ChevronRightIcon className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {emp.promo_increase_override != null && (
                    <div className="flex justify-end">
                      <button type="button" className="text-[10px] text-muted-foreground hover:text-destructive underline"
                        onClick={async () => {
                          form.setValue("promo_increase_override", null);
                          await updateEmployee(emp.id, { ...emp, promo_increase_override: null });
                        }}>
                        Reset to global ({settings.min_promo_increase_pct}%)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Test Scores (inline editable) */}
            <Card className="p-4 bg-background">
              {(() => {
                const tests = settings.tests ?? [];
                const scores = tests
                  .map(t => {
                    const manual = emp.completed_tests?.find(ct => ct.id === t.id)?.score;
                    if (t.name.toLowerCase() === "onboarding") {
                      const ws = ((emp as any).onboarding_ratings ?? []).filter((r: any) => r.score != null).map((r: any) => r.score);
                      if (ws.length > 0) return Math.round(ws.reduce((a: number, b: number) => a + b, 0) / ws.length);
                    }
                    return manual;
                  })
                  .filter((s): s is number => s != null && s !== undefined);
                const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
                return (
                  <>
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-bold text-sm">Test Scores</h4>
                      {avg !== null && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${avg >= 70 ? "bg-emerald-100 text-emerald-700" : avg >= 50 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"}`}>
                          Avg {avg.toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {tests.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">No tests configured in Settings.</p>
                      )}
                      {tests.map(test => {
                        const existing = emp.completed_tests?.find(ct => ct.id === test.id);
                        // For "Onboarding" test, auto-calculate from weekly ratings if available
                        let score = existing?.score ?? null;
                        if (test.name.toLowerCase() === "onboarding") {
                          const weeklyScores = ((emp as any).onboarding_ratings ?? []).filter((r: any) => r.score != null).map((r: any) => r.score);
                          if (weeklyScores.length > 0) {
                            score = Math.round(weeklyScores.reduce((a: number, b: number) => a + b, 0) / weeklyScores.length);
                          }
                        }
                        const scoreColor = score === null ? "" : score >= 70 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-500";
                        return (
                          <div key={test.id} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 text-muted-foreground truncate">{test.name}</span>
                            {test.required_for_role && (
                              <span className="text-[9px] font-mono bg-muted px-1 py-0.5 rounded text-muted-foreground">{test.required_for_role}</span>
                            )}
                            <span className={`font-bold w-10 text-right font-mono ${score === null ? "text-muted-foreground/40 italic font-normal" : scoreColor}`}>
                              {score === null ? "NA" : `${score}%`}
                            </span>
                            <input type="number" min={0} max={100} placeholder="NA" defaultValue={score ?? ""}
                              className="w-16 text-xs border rounded px-1.5 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-primary"
                              onBlur={async (e) => {
                                const raw = e.target.value.trim();
                                const val = raw === "" ? null : Math.min(100, Math.max(0, parseFloat(raw)));
                                if (isNaN(val as number) && val !== null) return;
                                const updated = (emp.completed_tests ?? []).filter(t => t.id !== test.id);
                                if (val !== null) updated.push({ id: test.id, score: val });
                                await updateEmployee(emp.id, { ...emp, completed_tests: updated });
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </Card>

            {/* Debug collapsible */}
            <Collapsible className="border rounded-lg p-3 bg-background">
              <CollapsibleTrigger className="flex items-center gap-2 w-full text-xs font-bold hover:text-primary transition-colors">
                <Info className="w-3 h-3" />
                Promotion calc debug
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3 text-[10px] space-y-2 text-muted-foreground leading-relaxed">
                <div className="grid grid-cols-[80px_1fr] gap-2">
                  <span className="font-medium text-foreground">Base Date:</span>
                  <span>{emp.last_promo_date ? `${emp.last_promo_date} (Last Promo)` : `${emp.hire_date} (Hire Date)`}</span>
                  <span className="font-medium text-foreground">Logic:</span>
                  <span>Eligibility = Last Promo Date (or Hire Date) + promo months</span>
                  <span className="font-medium text-foreground">Effective:</span>
                  <span>Next promotion window on or after Eligibility Date. If Eligibility is within 30 days after a window, that earlier window is used instead.</span>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>

        {/* ── Full-width sections below the 2-column grid ── */}

        {/* Salary History Chart */}
        <Card className="p-4 bg-background">
          <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Salary History Chart
          </h4>
          <SalaryChart employeeId={emp.id} hireDate={emp.hire_date} refreshKey={salaryRefreshKey} />
        </Card>

        {/* Salary History Table (inline) */}
        <Card className="p-4 bg-background">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold text-sm flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              Salary History Log
            </h4>
            <Button type="button" size="sm" variant={showHistoryForm ? "outline" : "default"} onClick={() => setShowHistoryForm(v => !v)}>
              {showHistoryForm ? "Cancel" : <><Plus className="w-4 h-4 mr-1" /> Log Salary Entry</>}
            </Button>
          </div>

          {showHistoryForm && (
            <div className="border rounded-lg p-4 bg-muted/20 space-y-4 mb-4">
              <div className="text-sm font-bold text-muted-foreground uppercase tracking-wide">New Entry</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Effective Date</Label>
                  <div className="flex gap-2">
                    <Select value={String(histFormMonth)} onValueChange={v => setHistFormMonth(parseInt(v))}>
                      <SelectTrigger className="h-8 w-28 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTHS_LABELS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={String(histFormYear)} onValueChange={v => setHistFormYear(parseInt(v))}>
                      <SelectTrigger className="h-8 w-24 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {HIST_YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Role</Label>
                  <Select value={histFormRole} onValueChange={v => {
                    setHistFormRole(v);
                    const rr = roleGrid.find(r => r.role_code === v);
                    if (rr) setHistFormMonths(rr.months_paid);
                    const isCurrent = v === emp.current_role_code;
                    setHistFormBonus(isCurrent ? (emp.current_bonus_pct ?? 0) : 0);
                    setHistFormVoucher(isCurrent ? (emp.meal_voucher_daily ?? 0) : 0);
                  }}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roleGrid.map(r => <SelectItem key={r.role_code} value={r.role_code}><span className="font-mono font-semibold">{r.role_code}</span> <span className="ml-2 text-muted-foreground">{r.role_name}</span></SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Yearly Gross (€)</Label>
                  <Input type="number" value={histFormGross} onChange={e => setHistFormGross(parseFloat(e.target.value) || 0)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Months Paid</Label>
                  <Select value={String(histFormMonths)} onValueChange={v => setHistFormMonths(parseInt(v))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="12">12</SelectItem>
                      <SelectItem value="13">13</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Bonus %</Label>
                  <Input type="number" min="0" max="100" value={histFormBonus} onChange={e => setHistFormBonus(parseFloat(e.target.value) || 0)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Meal Voucher (€/day)</Label>
                  <Input type="number" min="0" step="0.5" value={histFormVoucher} onChange={e => setHistFormVoucher(parseFloat(e.target.value) || 0)} className="h-8 text-sm" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Note (optional)</Label>
                  <Input value={histFormNote} onChange={e => setHistFormNote(e.target.value)} className="h-8 text-sm" placeholder="e.g. Promotion to S1, Annual review..." />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="button" size="sm" onClick={handleAddHistoryEntry}>Save Entry</Button>
              </div>
            </div>
          )}

          {historyLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
          ) : salaryHistory.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm italic">No salary history logged yet.</div>
          ) : (
            <div className="space-y-3">
              {[...salaryHistory].reverse().map((entry, displayIdx) => {
                const ascIdx = salaryHistory.length - 1 - displayIdx;
                const isScheduled = entry.effective_date > TODAY_STR;
                const isCurrent = displayIdx === 0 && !isScheduled;
                const nextEntry = salaryHistory[ascIdx + 1];
                const endDate = nextEntry ? nextEntry.effective_date : null;
                const prevEntry = salaryHistory[ascIdx - 1];
                const displayGross = isCurrent ? emp.current_gross_fixed_year : entry.gross_fixed_year;
                const displayMonthsPaid = isCurrent ? emp.months_paid : (entry.months_paid ?? 12);
                const displayBonus = isCurrent ? emp.current_bonus_pct : entry.bonus_pct;
                const displayVoucher = isCurrent ? emp.meal_voucher_daily : entry.meal_voucher_daily;
                const displayRole = isCurrent ? emp.current_role_code : entry.role_code;
                const monthlyGross = displayGross / displayMonthsPaid;
                const ral = grossToRal(displayGross);
                const prevGrossForDelta = prevEntry ? prevEntry.gross_fixed_year : null;
                const delta = prevGrossForDelta !== null
                  ? { d: displayGross - prevGrossForDelta, pct: ((displayGross - prevGrossForDelta) / prevGrossForDelta) * 100 }
                  : null;

                const isEditingThis = editHistId === entry.id;

                return (
                  <div key={entry.id} className={`rounded-lg border p-3 ${isScheduled ? "border-amber-300 bg-amber-50/50" : isCurrent ? "border-primary/40 bg-primary/5" : "bg-background"}`}>
                    {isScheduled && (
                      <div className="flex items-center gap-1 text-[10px] font-bold text-amber-600 uppercase tracking-wide mb-2">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        Scheduled — pending until effective date
                      </div>
                    )}

                    {isEditingThis ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Effective Date</Label>
                            <Input type="date" className="h-8 text-sm" value={editHistDate}
                              onChange={e => setEditHistDate(e.target.value)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Role</Label>
                            <Select value={editHistRole} onValueChange={setEditHistRole}>
                              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {roleGrid.map(r => <SelectItem key={r.role_code} value={r.role_code}><span className="font-mono font-semibold">{r.role_code}</span> <span className="ml-1 text-muted-foreground">{r.role_name}</span></SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Yearly Gross (€)</Label>
                            <Input type="number" className="h-8 text-sm" value={editHistGross}
                              onChange={e => setEditHistGross(parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Months Paid</Label>
                            <Select value={String(editHistMonths)} onValueChange={v => setEditHistMonths(parseInt(v))}>
                              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="12">12</SelectItem>
                                <SelectItem value="13">13</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Bonus %</Label>
                            <Input type="number" min="0" max="100" className="h-8 text-sm" value={editHistBonus}
                              onChange={e => setEditHistBonus(parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Meal Voucher (€/day)</Label>
                            <Input type="number" min="0" step="0.5" className="h-8 text-sm" value={editHistVoucher}
                              onChange={e => setEditHistVoucher(parseFloat(e.target.value) || 0)} />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">Note</Label>
                            <Input className="h-8 text-sm" value={editHistNote}
                              onChange={e => setEditHistNote(e.target.value)} placeholder="e.g. Promotion, Annual review..." />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button type="button" size="sm" variant="ghost" onClick={() => setEditHistId(null)}>Cancel</Button>
                          <Button type="button" size="sm" onClick={saveEditHist}>Save</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex-1 cursor-pointer" onClick={() => startEditHist(entry)}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold">
                                {fmtDate(entry.effective_date)}{" -> "}
                                {endDate
                                  ? <span className="text-muted-foreground font-normal">{fmtDate(endDate)}</span>
                                  : <span className="text-primary font-semibold">ongoing</span>}
                              </span>
                              {displayRole && <span className="bg-secondary px-2 py-0.5 rounded text-xs font-mono">{displayRole}</span>}
                            </div>
                            {entry.note && <div className="text-xs text-muted-foreground italic mt-0.5">{entry.note}</div>}
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            <button type="button" onClick={() => startEditHist(entry)}
                              className="text-muted-foreground hover:text-primary transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={() => handleDeleteHistoryEntry(entry.id!)}
                              className="text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs cursor-pointer" onClick={() => startEditHist(entry)}>
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase">Yearly Gross</div>
                            <div className="font-bold text-sm">€{displayGross.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase">Monthly</div>
                            <div className="font-semibold">€{Math.round(monthlyGross).toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase">RAL</div>
                            <div className="font-semibold">€{Math.round(ral * 1000).toLocaleString()}</div>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            {displayBonus != null && (
                              <div><span className="text-[10px] text-muted-foreground uppercase">Bonus </span><span className="font-semibold">{displayBonus}%</span></div>
                            )}
                            {displayVoucher != null && displayVoucher > 0 && (
                              <div><span className="text-[10px] text-muted-foreground uppercase">Voucher </span><span className="font-semibold">€{displayVoucher}/d</span></div>
                            )}
                          </div>
                        </div>
                        {delta && (
                          <div className={`mt-2 pt-2 border-t flex items-center gap-1.5 text-xs font-semibold ${delta.d > 0 ? "text-emerald-600" : delta.d < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            {delta.d > 0 ? <TrendingUp className="w-3 h-3" /> : delta.d < 0 ? <span className="w-3 h-3 inline-block text-center">-</span> : null}
                            {delta.d > 0 ? "+" : ""}{delta.d.toLocaleString()} €/yr vs previous
                            ({delta.d > 0 ? "+" : ""}{delta.pct.toFixed(1)}%)
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Schedule Salary Increase (inline) */}
        <Card className="p-4 bg-background">
          <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-amber-500" />
            Schedule Salary Increase
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 bg-muted/30 rounded-lg text-sm">
              <div className="text-muted-foreground text-xs uppercase font-bold mb-1">Current Salary</div>
              <div className="font-bold text-lg">€{emp.current_gross_fixed_year.toLocaleString()}/yr</div>
              <div className="text-xs text-muted-foreground">€{Math.round(emp.current_gross_fixed_year / emp.months_paid).toLocaleString()}/mo</div>
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>New Yearly Gross (€)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                  <Input type="number" className="pl-7" value={raiseGross}
                    onChange={(e) => setRaiseGross(parseFloat(e.target.value) || 0)} />
                </div>
                {raiseIncrease !== 0 && (
                  <p className={`text-xs font-semibold ${raiseIncrease > 0 ? "text-emerald-600" : "text-destructive"}`}>
                    {raiseIncrease > 0 ? "+" : ""}€{raiseIncrease.toLocaleString()} ({raiseIncreasePct >= 0 ? "+" : ""}{raiseIncreasePct.toFixed(1)}%)
                    — new monthly: €{Math.round(raiseGross / emp.months_paid).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Effective Date</Label>
                <Input type="date" value={raiseDate} onChange={(e) => setRaiseDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Note (optional)</Label>
                <Input value={raiseNote} onChange={(e) => setRaiseNote(e.target.value)} placeholder="e.g. Annual review, merit increase..." />
              </div>
              <Button type="button" onClick={handleScheduleRaise} disabled={raiseSaving || raiseGross <= 0 || !raiseDate}
                className="bg-amber-500 hover:bg-amber-600 text-white">
                {raiseSaving ? "Saving..." : "Schedule Increase"}
              </Button>
            </div>
          </div>
        </Card>

        {/* Personal Info + Onboarding */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-4 bg-background">
            <h4 className="font-bold text-sm mb-3">Personal Info</h4>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground w-24 shrink-0">Date of Birth:</span>
                <span>{emp.date_of_birth ? format(parseISO(emp.date_of_birth), "dd/MM/yyyy") : "—"}</span>
                <span className="text-muted-foreground">({metrics.age} yrs)</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground w-24 shrink-0">Uni Grade:</span>
                <select
                  value={(emp as any).university_grade_type ?? "110"}
                  onChange={async e => await updateEmployee(emp.id, { ...emp, university_grade_type: e.target.value as "110" | "GPA" } as any)}
                  className="text-xs border rounded px-1 py-0.5 bg-background"
                >
                  <option value="110">x/110</option>
                  <option value="GPA">GPA</option>
                </select>
                <input type="number"
                  step={(emp as any).university_grade_type === "GPA" ? "0.01" : "1"}
                  min={0} max={(emp as any).university_grade_type === "GPA" ? 4 : 110}
                  placeholder="—" defaultValue={(emp as any).university_grade ?? ""}
                  onBlur={async e => {
                    const v = e.target.value === "" ? null : parseFloat(e.target.value);
                    await updateEmployee(emp.id, { ...emp, university_grade: v } as any);
                  }}
                  className="w-16 text-xs border rounded px-1.5 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {(emp as any).university_grade != null && (
                  <span className="font-semibold text-foreground">
                    {(emp as any).university_grade}{(emp as any).university_grade_type === "GPA" ? " GPA" : "/110"}
                  </span>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-4 bg-background">
            <div className="flex justify-between items-center mb-3">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Onboarding Ratings (W1-W8)
              </h4>
              {(() => {
                const scores = ((emp as any).onboarding_ratings ?? []).filter((r: any) => r.score != null).map((r: any) => r.score);
                const avg = scores.length > 0 ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : null;
                return avg !== null ? (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${avg >= 80 ? "bg-emerald-100 text-emerald-700" : avg >= 60 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"}`}>
                    Avg {avg.toFixed(0)}%
                  </span>
                ) : null;
              })()}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 8 }, (_, i) => {
                const weekNum = i + 1;
                const dueDate = new Date(emp.hire_date);
                dueDate.setDate(dueDate.getDate() + weekNum * 7);
                const isPast = new Date() >= dueDate;
                const rating = ((emp as any).onboarding_ratings ?? []).find((r: any) => r.week === weekNum);
                const hasScore = rating?.score != null;
                const isLate = isPast && !hasScore;
                return (
                  <div key={weekNum} className={`p-2 rounded border text-center ${hasScore ? "border-emerald-200 bg-emerald-50" : isLate ? "border-red-200 bg-red-50" : "border-border bg-background"}`}>
                    <div className="text-[9px] font-bold uppercase text-muted-foreground">W{weekNum}</div>
                    <input type="number" min={0} max={100} placeholder="—"
                      defaultValue={rating?.score ?? ""}
                      onBlur={async e => {
                        const v = e.target.value === "" ? null : Math.min(100, Math.max(0, parseFloat(e.target.value)));
                        const updated = ((emp as any).onboarding_ratings ?? []).filter((r: any) => r.week !== weekNum);
                        if (v !== null) updated.push({ week: weekNum, score: v });
                        await updateEmployee(emp.id, { ...emp, onboarding_ratings: updated } as any);
                      }}
                      className="w-full text-xs border-0 bg-transparent text-center font-bold focus:outline-none py-0.5"
                    />
                    <div className={`text-[8px] font-bold mt-0.5 ${hasScore ? "text-emerald-600" : isLate ? "text-red-500" : "text-muted-foreground"}`}>
                      {hasScore ? `${rating!.score}% done` : isLate ? "LATE" : format(dueDate, "dd/MM")}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Promotion Discussion Notes */}
        <Card className="p-4 bg-background">
          <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            Promotion Discussion Notes
          </h4>
          <Textarea
            placeholder={"1. Long-term career intent: Where do you see yourself in 3-5 years and why?\n2. Role readiness: What projects have shown you're ready for the next level?"}
            defaultValue={(emp as any).promotion_discussion_notes ?? ""}
            onBlur={async e => {
              const v = e.target.value;
              if (v !== ((emp as any).promotion_discussion_notes ?? "")) {
                await updateEmployee(emp.id, { ...emp, promotion_discussion_notes: v } as any);
              }
            }}
            rows={4}
            className="text-xs resize-none"
          />
        </Card>

        {/* Yearly Reviews */}
        <Card className="p-4 bg-background">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold text-sm flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary" />
              Yearly Reviews
            </h4>
            <Button type="button" size="sm" variant="outline" onClick={async () => {
              const yr = new Date().getFullYear();
              const existing = (emp as any).yearly_reviews ?? [];
              if (existing.find((r: any) => r.year === yr)) return;
              await updateEmployee(emp.id, { ...emp, yearly_reviews: [...existing, { year: yr, summary: "", dev_plan: "" }] } as any);
            }}>
              <Plus className="w-3 h-3 mr-1" />Add Year
            </Button>
          </div>
          {((emp as any).yearly_reviews ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground italic">No yearly reviews yet.</p>
          )}
          <div className="space-y-4">
            {((emp as any).yearly_reviews ?? []).sort((a: any, b: any) => b.year - a.year).map((rev: any) => (
              <div key={rev.year} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold">{rev.year}</span>
                  <button type="button" onClick={async () => {
                    const updated = ((emp as any).yearly_reviews ?? []).filter((r: any) => r.year !== rev.year);
                    await updateEmployee(emp.id, { ...emp, yearly_reviews: updated } as any);
                  }} className="text-muted-foreground hover:text-destructive"><X className="w-3.5 h-3.5" /></button>
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold tracking-wide">Discussion Summary</Label>
                  <Textarea placeholder="Paste discussion summary..." defaultValue={rev.summary}
                    onBlur={async e => {
                      const updated = ((emp as any).yearly_reviews ?? []).map((r: any) => r.year === rev.year ? { ...r, summary: e.target.value } : r);
                      await updateEmployee(emp.id, { ...emp, yearly_reviews: updated } as any);
                    }}
                    rows={3} className="text-xs mt-1 resize-none"
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold tracking-wide">Development Plan</Label>
                  <Textarea placeholder="Paste development plan..." defaultValue={rev.dev_plan}
                    onBlur={async e => {
                      const updated = ((emp as any).yearly_reviews ?? []).map((r: any) => r.year === rev.year ? { ...r, dev_plan: e.target.value } : r);
                      await updateEmployee(emp.id, { ...emp, yearly_reviews: updated } as any);
                    }}
                    rows={3} className="text-xs mt-1 resize-none"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Competency Areas */}
        <Card className="p-4 bg-background">
          <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
            <Grid3X3 className="w-4 h-4 text-primary" />
            Competency Areas
          </h4>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {COMEX_AREAS.map(area => {
              const checked = ((emp as any).comex_areas as Record<string, boolean> | null)?.[area] ?? false;
              return (
                <button type="button" key={area}
                  onClick={async () => {
                    const current = ((emp as any).comex_areas as Record<string, boolean> | null) ?? {};
                    await updateEmployee(emp.id, { ...emp, comex_areas: { ...current, [area]: !checked } } as any);
                  }}
                  className={`px-2 py-1.5 rounded text-xs font-medium border transition-colors text-left ${checked ? "bg-primary/10 border-primary/50 text-primary font-bold" : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}
                >
                  {checked && "* "}{area}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Assets — laptops, software licenses, monitors, phones, …
            Lives outside the main edit form (separate API + own state) so
            adding/removing an asset doesn't dirty the employee form. */}
        <EmployeeAssetsSection employeeId={employee.id} />

        {/* HR Events — churn signals logged against this employee */}
        <HrEventsSection employee={employee} />

        {/* Save + Delete buttons */}
        <div className="flex justify-between items-center pt-4 border-t">
          {(employee as any).status === "former" ? (
            <Button type="button" variant="outline" onClick={handleUnretire}
              className="text-emerald-700 border-emerald-300 hover:border-emerald-400 hover:bg-emerald-50">
              <UserCheck className="w-4 h-4 mr-2" />
              Unretire Employee
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={handleRetire}
              className="text-slate-600 border-slate-300 hover:border-slate-400 hover:bg-slate-50">
              <UserX className="w-4 h-4 mr-2" />
              Retire Employee
            </Button>
          )}
          <Button type="submit" disabled={saveState !== "idle"}
            className={saveState === "saved" ? "bg-emerald-600 hover:bg-emerald-600" : ""}>
            {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save Employee"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── HR Events (churn signal log) ───────────────────────────────────────────
function HrEventsSection({ employee }: { employee: EmployeeInput }) {
  const { updateEmployee } = useStore();
  const { toast } = useToast();
  const events: HrEvent[] = (employee as any).hr_events ?? [];

  const [newType, setNewType] = useState<HrEvent["type"]>("complaint");
  const [newSeverity, setNewSeverity] = useState<HrEvent["severity"]>("medium");
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);

  const TYPE_LABELS: Record<HrEvent["type"], string> = {
    complaint: "Complaint",
    absence_concern: "Absence",
    performance_concern: "Performance",
    praise: "Praise",
    other: "Other",
  };
  const TYPE_COLORS: Record<HrEvent["type"], string> = {
    complaint: "bg-red-100 text-red-700 border-red-200",
    absence_concern: "bg-amber-100 text-amber-700 border-amber-200",
    performance_concern: "bg-orange-100 text-orange-700 border-orange-200",
    praise: "bg-emerald-100 text-emerald-700 border-emerald-200",
    other: "bg-slate-100 text-slate-600 border-slate-200",
  };
  const SEV_COLORS: Record<HrEvent["severity"], string> = {
    high: "bg-red-500 text-white",
    medium: "bg-amber-400 text-white",
    low: "bg-slate-300 text-slate-700",
  };

  const logEvent = async () => {
    if (!newNote.trim()) { toast({ title: "Add a note", variant: "destructive" }); return; }
    setSaving(true);
    const newEvent: HrEvent = {
      id: uuidv4(),
      date: new Date().toISOString().slice(0, 10),
      type: newType,
      severity: newSeverity,
      note: newNote.trim(),
    };
    try {
      await updateEmployee(employee.id, { ...employee, hr_events: [...events, newEvent] } as any);
      setNewNote("");
      toast({ title: "Event logged" });
    } catch {
      toast({ title: "Failed to log event", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async (id: string) => {
    await updateEmployee(employee.id, { ...employee, hr_events: events.filter(e => e.id !== id) } as any);
  };

  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Card className="p-4 space-y-3">
      <h3 className="text-sm font-bold uppercase tracking-wide flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500" />
        HR Events — Churn Signals ({events.length})
      </h3>

      {sorted.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No events logged yet.</p>
      ) : (
        <div className="space-y-1.5">
          {sorted.map(ev => (
            <div key={ev.id} className="flex items-start gap-2 rounded border p-2 bg-card text-xs">
              <span className="font-mono text-muted-foreground shrink-0 pt-0.5">{ev.date}</span>
              <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${TYPE_COLORS[ev.type]}`}>
                {TYPE_LABELS[ev.type]}
              </span>
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${SEV_COLORS[ev.severity]}`}>
                {ev.severity}
              </span>
              <span className="flex-1 text-foreground">{ev.note}</span>
              <button type="button" onClick={() => deleteEvent(ev.id)}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      <div className="border-t pt-3 space-y-2">
        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">Log New Event</p>
        <div className="flex gap-2 flex-wrap">
          <Select value={newType} onValueChange={(v) => setNewType(v as HrEvent["type"])}>
            <SelectTrigger className="h-7 text-xs w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(TYPE_LABELS) as HrEvent["type"][]).map(t => (
                <SelectItem key={t} value={t} className="text-xs">{TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={newSeverity} onValueChange={(v) => setNewSeverity(v as HrEvent["severity"])}>
            <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low" className="text-xs">Low</SelectItem>
              <SelectItem value="medium" className="text-xs">Medium</SelectItem>
              <SelectItem value="high" className="text-xs">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Brief note…"
            className="h-7 text-xs flex-1"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); logEvent(); } }}
          />
          <Button type="button" size="sm" className="h-7 text-xs px-3" disabled={saving} onClick={logEvent}>
            {saving ? "…" : "Log"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ── Per-employee assets table ──────────────────────────────────────────────
// Lists every asset assigned to this employee, with inline status toggle +
// quick-add form at the bottom. Pulls types from /api/asset-types so the
// admin-managed taxonomy is the single source of truth.
function EmployeeAssetsSection({ employeeId }: { employeeId: string }) {
  const { toast } = useToast();
  const [types, setTypes] = useState<Array<{ id: number; name: string; has_license_key: number; identifier_hint: string | null; details_hint: string | null }>>([]);
  const [items, setItems] = useState<Array<{ id: number; asset_type: string; identifier: string | null; details: string | null; status: string; license_key: string | null; notes: string | null }>>([]);
  const [loading, setLoading] = useState(true);

  // New-asset form
  const [newType, setNewType] = useState("");
  const [newId, setNewId] = useState("");
  const [newDetails, setNewDetails] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newStatus, setNewStatus] = useState<"in_use" | "out_of_use" | "spare" | "retired">("in_use");
  const [adding, setAdding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [tRes, aRes] = await Promise.all([
        fetch("/api/asset-types", { credentials: "include" }),
        fetch(`/api/assets?employee_id=${encodeURIComponent(employeeId)}`, { credentials: "include" }),
      ]);
      const t = await tRes.json();
      const a = await aRes.json();
      setTypes(Array.isArray(t) ? t : []);
      setItems(Array.isArray(a) ? a : []);
      if (Array.isArray(t) && t.length > 0 && !newType) setNewType(t[0].name);
    } catch {
      toast({ title: "Failed to load assets", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [employeeId]);

  const selectedType = types.find(t => t.name === newType);

  async function addAsset() {
    if (!newType) { toast({ title: "Pick a type", variant: "destructive" }); return; }
    setAdding(true);
    try {
      const r = await fetch("/api/assets", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_type: newType,
          identifier: newId.trim() || null,
          details: newDetails.trim() || null,
          employee_id: employeeId,
          status: newStatus,
          license_key: newKey.trim() || null,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setNewId(""); setNewDetails(""); setNewKey(""); setNewStatus("in_use");
      toast({ title: `Added ${newType}` });
      await load();
    } catch (e) {
      toast({ title: "Failed to add", description: (e as Error).message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function patchAsset(id: number, patch: Partial<{ status: string; identifier: string | null; details: string | null; license_key: string | null; employee_id: string | null; notes: string | null }>) {
    setItems(prev => prev.map(x => x.id === id ? { ...x, ...patch } as any : x));
    try {
      await fetch(`/api/assets/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
      await load();
    }
  }
  async function deleteAsset(id: number) {
    if (!confirm("Delete this asset row?")) return;
    try {
      await fetch(`/api/assets/${id}`, { method: "DELETE", credentials: "include" });
      await load();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide">Assets ({items.length})</h3>
        <a href="/admin/assets" className="text-[10px] text-primary hover:underline">Manage types ↗</a>
      </div>
      {loading ? (
        <div className="text-xs text-muted-foreground italic">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">No assets assigned yet. Add one below.</div>
      ) : (
        <div className="space-y-1.5">
          {items.map(a => (
            <div key={a.id} className="flex items-center gap-2 border rounded p-2 bg-card text-xs flex-wrap">
              <Badge variant="outline" className="font-semibold text-[10px]">{a.asset_type}</Badge>
              {a.identifier && (
                <input
                  defaultValue={a.identifier}
                  onBlur={(e) => patchAsset(a.id, { identifier: e.target.value || null })}
                  className="font-mono font-bold w-20 bg-transparent border-b border-transparent focus:border-primary outline-none"
                />
              )}
              <input
                defaultValue={a.details ?? ""}
                onBlur={(e) => patchAsset(a.id, { details: e.target.value || null })}
                placeholder="(no details)"
                className="flex-1 min-w-[120px] bg-transparent border-b border-transparent focus:border-primary outline-none"
              />
              {a.license_key !== null && (
                <input
                  defaultValue={a.license_key ?? ""}
                  onBlur={(e) => patchAsset(a.id, { license_key: e.target.value || null })}
                  placeholder="(license key)"
                  className="font-mono w-44 bg-transparent border-b border-transparent focus:border-primary outline-none"
                />
              )}
              <select
                value={a.status}
                onChange={(e) => patchAsset(a.id, { status: e.target.value })}
                className={`text-[10px] rounded px-1.5 py-0.5 border ${
                  a.status === "in_use" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : a.status === "out_of_use" ? "bg-red-50 text-red-700 border-red-200"
                  : a.status === "spare" ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-slate-50 text-slate-700 border-slate-200"
                }`}
              >
                <option value="in_use">In use</option>
                <option value="out_of_use">Out of use</option>
                <option value="spare">Spare</option>
                <option value="retired">Retired</option>
              </select>
              <button
                onClick={() => deleteAsset(a.id)}
                className="text-muted-foreground hover:text-destructive p-1"
                title="Delete asset"
              ><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Add-asset row */}
      <div className="border-t pt-3 space-y-2">
        <div className="text-[10px] font-semibold uppercase text-muted-foreground">Add asset</div>
        <div className="flex gap-2 flex-wrap items-center">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="text-xs h-8 rounded border px-2 bg-background"
          >
            {types.length === 0 && <option value="">— no types defined —</option>}
            {types.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
          <input
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder={selectedType?.identifier_hint ?? "Identifier (optional)"}
            className="text-xs h-8 rounded border px-2 bg-background w-28"
          />
          <input
            value={newDetails}
            onChange={(e) => setNewDetails(e.target.value)}
            placeholder={selectedType?.details_hint ?? "Details"}
            className="text-xs h-8 rounded border px-2 bg-background flex-1 min-w-[180px]"
          />
          {selectedType?.has_license_key === 1 && (
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="License key"
              className="text-xs h-8 rounded border px-2 bg-background font-mono w-44"
            />
          )}
          <select
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value as any)}
            className="text-xs h-8 rounded border px-2 bg-background"
          >
            <option value="in_use">In use</option>
            <option value="out_of_use">Out of use</option>
            <option value="spare">Spare</option>
            <option value="retired">Retired</option>
          </select>
          <Button size="sm" type="button" onClick={addAsset} disabled={adding || !newType}>
            {adding ? "Adding…" : "Add"}
          </Button>
        </div>
        {types.length === 0 && (
          <p className="text-[10px] text-muted-foreground italic">
            No types yet — go to <a href="/admin/assets" className="text-primary hover:underline">Admin → Asset Types</a> to add some.
          </p>
        )}
      </div>
    </Card>
  );
}

function EmployeeDialog({ open, onOpenChange, editingId }: { open: boolean, onOpenChange: (open: boolean) => void, editingId: string | null }) {
  const { employees, addEmployee, updateEmployee, roleGrid, settings } = useStore();
  const { toast } = useToast();
  
  const defaultValues: Partial<EmployeeInput> = {
    name: "",
    email: "",
    date_of_birth: "1990-01-01",
    current_role_code: roleGrid[0]?.role_code || "",
    hire_date: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
    tenure_before_years: 0,
    last_promo_date: "", // Default to empty
    current_gross_fixed_year: 30000,
    meal_voucher_daily: 8,
    months_paid: 13,
    current_bonus_pct: 0,
    performance_score: 7,
    monthly_ratings: [],
    completed_tests: [],
  };

  const editingEmployee = editingId ? employees.find(e => e.id === editingId) : null;

  const form = useForm<EmployeeInput>({
    resolver: zodResolver(employeeInputSchema),
    defaultValues: editingEmployee || { ...defaultValues, id: uuidv4() },
  });

  // Generate last 12 months as YYYY-MM strings (most recent first)
  const last12Months = useMemo(() => {
    const months: string[] = [];
    const d = new Date();
    for (let i = 0; i < 12; i++) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      months.push(`${y}-${m}`);
      d.setMonth(d.getMonth() - 1);
    }
    return months; // [this month, last month, ..., 11 months ago]
  }, []);

  // Use useEffect to reset form when dialog opens/closes or editingId changes
  useEffect(() => {
    if (open) {
      const base = editingId && editingEmployee ? editingEmployee : { ...defaultValues, id: uuidv4() };
      // Merge existing ratings with the fixed 12-month window
      const existingMap = new Map((base.monthly_ratings || []).map(r => [r.month, r.score]));
      const ratings = last12Months.map(month => ({
        month,
        score: existingMap.has(month) ? existingMap.get(month)! : null as any,
      }));
      form.reset({
        ...base,
        monthly_ratings: ratings.filter(r => r.score != null),
        completed_tests: (base.completed_tests ?? []).map((t: any) => typeof t === 'string' ? { id: t, score: null } : t),
        onboarding_ratings: (base as any).onboarding_ratings ?? [],
        yearly_reviews: (base as any).yearly_reviews ?? [],
        comex_areas: (base as any).comex_areas ?? {},
        promotion_discussion_notes: (base as any).promotion_discussion_notes ?? null,
        university_grade: (base as any).university_grade ?? null,
        university_grade_type: (base as any).university_grade_type ?? null,
      });
      setRatings12(ratings);
    }
  }, [open, editingId, editingEmployee, form]);

  // Local 12-month ratings state (null = not entered)
  const [ratings12, setRatings12] = useState<{ month: string; score: number | null }[]>([]);

  const updateRating12 = (month: string, score: number | null) => {
    const updated = ratings12.map(r => r.month === month ? { ...r, score } : r);
    setRatings12(updated);
    // Only persist months with a score into the form field
    form.setValue("monthly_ratings", updated.filter(r => r.score != null) as any);
  };

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const onSubmit = async (data: EmployeeInput) => {
    setSaveState("saving");
    try {
      const isNew = !editingId;
      const prevGross = editingEmployee?.current_gross_fixed_year ?? null;
      const grossChanged = prevGross === null || prevGross !== data.current_gross_fixed_year;

      if (editingId) {
        await updateEmployee(editingId, data);
      } else {
        await addEmployee({ ...data, id: uuidv4() });
      }

      // Auto-log salary history when gross changes or employee is new
      if (grossChanged) {
        const empId = editingId ?? (data as any).id ?? data.id;
        await fetch("/api/salary-history", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee_id: empId,
            effective_date: new Date().toISOString().slice(0, 10),
            role_code: data.current_role_code,
            gross_fixed_year: data.current_gross_fixed_year,
            months_paid: data.months_paid,
            bonus_pct: data.current_bonus_pct,
            meal_voucher_daily: data.meal_voucher_daily,
            note: isNew ? "Initial salary on hire" : "Salary update",
          }),
        });
      }

      setSaveState("saved");
      setTimeout(() => { onOpenChange(false); setSaveState("idle"); }, 1000);
    } catch (err) {
      setSaveState("idle");
      toast({ title: "Error saving employee", description: String(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingId ? "Edit Employee" : "Add New Employee"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit, (errors) => {
          const details = Object.entries(errors).map(([k, v]) => `${k}: ${(v as any)?.message || (v as any)?.type || JSON.stringify(v)}`);
          console.error("Form validation errors:", errors);
          toast({ title: "Cannot save — validation failed", description: details.join("; "), variant: "destructive" });
        })} className="space-y-6 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input {...form.register("name")} placeholder="John Doe" />
              {form.formState.errors.name && <span className="text-destructive text-xs">{form.formState.errors.name.message}</span>}
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" {...form.register("email")} placeholder="firstname.lastname@eendigo.com" />
            </div>

            <div className="space-y-2">
              <Label>Date of Birth</Label>
              <Input type="date" {...form.register("date_of_birth")} />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Controller
                control={form.control}
                name="current_role_code"
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roleGrid.map(role => (
                        <SelectItem key={role.role_code} value={role.role_code}>
                          {role.role_name} ({role.role_code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-2">
              <Label>Hire Date</Label>
              <Input type="date" {...form.register("hire_date")} />
            </div>

            <div className="space-y-2">
              <Label>Last Promotion Date</Label>
              <Input type="date" {...form.register("last_promo_date")} />
              <p className="text-[10px] text-muted-foreground italic">Leave blank if this is the employee's first role</p>
            </div>

            <div className="space-y-2">
              <Label>Yearly Gross Salary</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                <Input 
                    type="number" 
                    className="pl-7" 
                    {...form.register("current_gross_fixed_year", { valueAsNumber: true })} 
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Months Paid</Label>
              <Controller
                control={form.control}
                name="months_paid"
                render={({ field }) => (
                  <Select onValueChange={(v) => field.onChange(Number(v))} value={String(field.value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="12">12 Months</SelectItem>
                      <SelectItem value="13">13 Months</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="col-span-2 border-t pt-4 space-y-2">
              <Label className="text-base font-bold">Monthly Ratings (last 12 months)</Label>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0">
                {ratings12.map(({ month, score }) => {
                  const [y, m] = month.split("-");
                  const label = `${m}/${y.slice(2)}`;
                  return (
                    <div key={month} className="flex items-center justify-between py-1 border-b border-muted/40 last:border-0">
                      <span className="text-sm font-mono text-muted-foreground w-14">{label}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"
                          onClick={() => updateRating12(month, score != null ? Math.max(1, Math.round((score - 0.5) * 10) / 10) : 7)}
                        >
                          <ChevronLeft className="h-3 w-3" />
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          min="1"
                          max="10"
                          className="h-7 w-14 text-center text-sm border rounded font-mono bg-background"
                          value={score ?? ""}
                          placeholder="—"
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            updateRating12(month, isNaN(v) ? null : Math.min(10, Math.max(1, v)));
                          }}
                        />
                        <button
                          type="button"
                          className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"
                          onClick={() => updateRating12(month, score != null ? Math.min(10, Math.round((score + 0.5) * 10) / 10) : 7)}
                        >
                          <ChevronRightIcon className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground italic">
                Leave a month blank to exclude it. Filled months are averaged for the Rate.
              </p>
            </div>

             <div className="space-y-2">
              <Label>Default Rate (Fallback)</Label>
              <Input 
                type="number" 
                step="0.1"
                min="1" 
                max="10"
                {...form.register("performance_score", { valueAsNumber: true })} 
              />
              <p className="text-xs text-muted-foreground">
                &gt;8.5: Fast, 7-8.5: Normal, 5-7: Slow
              </p>
            </div>

             <div className="space-y-2">
              <Label>Meal Voucher (Daily €)</Label>
              <Input 
                type="number" 
                step="0.5"
                {...form.register("meal_voucher_daily", { valueAsNumber: true })} 
              />
            </div>

            <div className="space-y-2">
              <Label>Years Tenure Before Eendigo</Label>
              <Input 
                type="number" 
                step="0.1"
                {...form.register("tenure_before_years", { valueAsNumber: true })} 
              />
            </div>
          </div>

            <div className="space-y-4 col-span-2 border-t pt-4">
              <Label className="text-base font-bold">Completed Tests</Label>
              <div className="grid grid-cols-2 gap-3">
                {settings.tests.map(test => {
                  const completedTests: CompletedTest[] = form.watch("completed_tests") || [];
                  const entry = completedTests.find(ct => ct.id === test.id);
                  const isChecked = !!entry;
                  return (
                    <div key={test.id} className={`flex items-center gap-2 p-2 rounded-lg border ${isChecked ? 'bg-primary/5 border-primary/20' : 'bg-muted/10'}`}>
                      <input
                        type="checkbox"
                        id={`test-${test.id}`}
                        checked={isChecked}
                        onChange={(e) => {
                          const current: CompletedTest[] = form.getValues("completed_tests") || [];
                          if (e.target.checked) {
                            form.setValue("completed_tests", [...current, { id: test.id, score: null }]);
                          } else {
                            form.setValue("completed_tests", current.filter(ct => ct.id !== test.id));
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <Label htmlFor={`test-${test.id}`} className="text-sm font-normal cursor-pointer flex-1">
                        {test.name}
                      </Label>
                      {isChecked && (
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          placeholder="Score"
                          className="h-7 w-20 text-xs"
                          value={entry?.score ?? ""}
                          onChange={(e) => {
                            const current: CompletedTest[] = [...(form.getValues("completed_tests") || [])];
                            const idx = current.findIndex(ct => ct.id === test.id);
                            if (idx !== -1) {
                              current[idx] = { ...current[idx], score: e.target.value === "" ? null : Number(e.target.value) };
                              form.setValue("completed_tests", current);
                            }
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saveState !== "idle"}
              className={saveState === "saved" ? "bg-emerald-600 hover:bg-emerald-600" : ""}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : "Save Employee"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleSalaryIncreaseDialog({
  employee,
  open,
  onClose,
}: {
  employee: EmployeeInput;
  open: boolean;
  onClose: () => void;
}) {
  const { updateEmployee } = useStore();
  const { toast } = useToast();
  const [newGross, setNewGross] = useState(employee.current_gross_fixed_year);
  const [effectiveDate, setEffectiveDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset when employee changes
  useEffect(() => {
    setNewGross(employee.current_gross_fixed_year);
    setNote("");
  }, [employee.id]);

  const handleSave = async () => {
    if (!newGross || newGross <= 0 || !effectiveDate) return;
    setSaving(true);
    try {
      // Save pending raise on the employee record
      await updateEmployee(employee.id, {
        ...employee,
        pending_salary_gross: newGross,
        pending_salary_date: effectiveDate,
      });
      // Log to salary history so it appears in the logs
      await fetch("/api/salary-history", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employee.id,
          effective_date: effectiveDate,
          role_code: employee.current_role_code,
          gross_fixed_year: newGross,
          months_paid: employee.months_paid,
          bonus_pct: employee.current_bonus_pct,
          meal_voucher_daily: employee.meal_voucher_daily,
          note: note || "Scheduled salary increase",
        }),
      });
      toast({ title: `Salary increase of €${newGross.toLocaleString()} scheduled from ${format(parseISO(effectiveDate), "dd/MM/yyyy")}` });
      onClose();
    } catch (err) {
      toast({ title: "Failed to schedule raise", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const increase = newGross - employee.current_gross_fixed_year;
  const increasePct = employee.current_gross_fixed_year > 0
    ? ((increase / employee.current_gross_fixed_year) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-amber-500" />
            Schedule Salary Increase — {employee.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="p-3 bg-muted/30 rounded-lg text-sm">
            <div className="text-muted-foreground text-xs uppercase font-bold mb-1">Current Salary</div>
            <div className="font-bold text-lg">€{employee.current_gross_fixed_year.toLocaleString()}/yr</div>
            <div className="text-xs text-muted-foreground">€{Math.round(employee.current_gross_fixed_year / employee.months_paid).toLocaleString()}/mo</div>
          </div>

          <div className="space-y-2">
            <Label>New Yearly Gross (€)</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
              <Input
                type="number"
                className="pl-7"
                value={newGross}
                onChange={(e) => setNewGross(parseFloat(e.target.value) || 0)}
              />
            </div>
            {increase !== 0 && (
              <p className={`text-xs font-semibold ${increase > 0 ? "text-emerald-600" : "text-destructive"}`}>
                {increase > 0 ? "+" : ""}€{increase.toLocaleString()} ({increasePct >= 0 ? "+" : ""}{increasePct.toFixed(1)}%)
                — new monthly: €{Math.round(newGross / employee.months_paid).toLocaleString()}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Effective Date</Label>
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Current salary remains unchanged until this date.</p>
          </div>

          <div className="space-y-2">
            <Label>Note (optional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Annual review, merit increase…"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving || newGross <= 0 || !effectiveDate}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {saving ? "Saving…" : "Schedule Increase"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
