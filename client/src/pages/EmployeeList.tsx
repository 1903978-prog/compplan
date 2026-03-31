import React, { useState, useEffect, useMemo } from "react";
import { useStore } from "@/hooks/use-store";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Search, Info, Upload, History, TrendingUp, CheckCircle2, Sparkles, ClipboardPaste, X, MessageSquare, BookOpen, Calendar, Grid3X3, ListTodo, Check, Clock } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { employeeInputSchema, type EmployeeInput, type CompletedTest, type EmployeeTask, type YearlyReview, COMEX_AREAS } from "@shared/schema";
import { v4 as uuidv4 } from "uuid";
import { useToast } from "@/hooks/use-toast";
import { calculateEmployeeMetrics, grossToRal } from "@/lib/calculations";
import { format, parseISO } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight as ChevronRightIcon } from "lucide-react";

function SalaryChart({ employeeId, hireDate }: { employeeId: string; hireDate: string }) {
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/salary-history/${employeeId}`, { credentials: "include" })
      .then(r => r.json())
      .then((data: any[]) => {
        if (Array.isArray(data)) setHistory(data.sort((a, b) => a.effective_date.localeCompare(b.effective_date)));
      })
      .catch(() => {});
  }, [employeeId]);

  if (history.length === 0) return <div className="text-xs text-muted-foreground italic py-2">No salary history data.</div>;

  const today = new Date().toISOString().slice(0, 10);
  interface Pt { date: string; grossMonth: number; bonusPct: number; roleCode: string }
  const pts: Pt[] = history.map(h => ({
    date: h.effective_date,
    grossMonth: Math.round(h.gross_fixed_year / (h.months_paid ?? 12)),
    bonusPct: h.bonus_pct ?? 0,
    roleCode: h.role_code ?? "",
  }));
  if (pts.length > 0) pts.push({ ...pts[pts.length - 1], date: today });

  const W = 560, H = 110, pad = { top: 8, right: 16, bottom: 28, left: 52 };
  const iW = W - pad.left - pad.right, iH = H - pad.top - pad.bottom;
  const t0 = new Date(pts[0].date).getTime(), t1 = new Date(pts[pts.length - 1].date).getTime();
  const xOf = (d: string) => t1 === t0 ? 0 : ((new Date(d).getTime() - t0) / (t1 - t0)) * iW;
  const gVals = pts.map(p => p.grossMonth);
  const gMin = Math.min(...gVals) * 0.9, gMax = Math.max(...gVals) * 1.1;
  const yG = (v: number) => iH - ((v - gMin) / (gMax - gMin || 1)) * iH;
  const bMax = Math.max(...pts.map(p => p.bonusPct), 1);
  const yB = (v: number) => iH - (v / bMax) * iH;

  const mkPath = (points: Pt[], yFn: (v: number) => number, key: "grossMonth" | "bonusPct") =>
    points.map((p, i) => {
      const x = xOf(p.date).toFixed(1), y = yFn(p[key]).toFixed(1);
      return i === 0 ? `M${x},${y}` : `H${x} V${y}`;
    }).join(" ");

  const grossPath = mkPath(pts, yG, "grossMonth");
  const bonusPath = mkPath(pts, yB, "bonusPct");
  const gTicks = [gMin, (gMin + gMax) / 2, gMax];
  const startYr = new Date(pts[0].date).getFullYear(), endYr = new Date(today).getFullYear();
  const yrTicks: { x: number; label: string }[] = [];
  for (let yr = startYr; yr <= endYr + 1; yr++) {
    const d = `${yr}-01-01`;
    if (d >= pts[0].date && d <= today) yrTicks.push({ x: xOf(d), label: String(yr) });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <g transform={`translate(${pad.left},${pad.top})`}>
        {gTicks.map((v, i) => <line key={i} x1={0} y1={yG(v)} x2={iW} y2={yG(v)} stroke="#e5e7eb" strokeWidth={0.5} />)}
        <path d={grossPath} fill="none" stroke="#3b82f6" strokeWidth={2} />
        {history.map((h, i) => (
          <circle key={i} cx={xOf(h.effective_date)} cy={yG(Math.round(h.gross_fixed_year / (h.months_paid ?? 12)))} r={3} fill="#3b82f6" />
        ))}
        {bMax > 0 && <path d={bonusPath} fill="none" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2" />}
        <line x1={0} y1={0} x2={0} y2={iH} stroke="#d1d5db" strokeWidth={1} />
        {gTicks.map((v, i) => (
          <g key={i}>
            <line x1={-3} y1={yG(v)} x2={0} y2={yG(v)} stroke="#9ca3af" strokeWidth={1} />
            <text x={-6} y={yG(v) + 4} textAnchor="end" fontSize={8} fill="#6b7280">€{Math.round(v / 1000)}k</text>
          </g>
        ))}
        <line x1={0} y1={iH} x2={iW} y2={iH} stroke="#d1d5db" strokeWidth={1} />
        {yrTicks.map((t, i) => (
          <g key={i}>
            <line x1={t.x} y1={iH} x2={t.x} y2={iH + 4} stroke="#9ca3af" strokeWidth={1} />
            <text x={t.x} y={iH + 14} textAnchor="middle" fontSize={8} fill="#6b7280">{t.label}</text>
          </g>
        ))}
        {history.map((h, i) => h.role_code ? (
          <g key={i}>
            <line x1={xOf(h.effective_date)} y1={0} x2={xOf(h.effective_date)} y2={iH} stroke="#e5e7eb" strokeWidth={0.5} strokeDasharray="3 2" />
            <text x={xOf(h.effective_date) + 3} y={14} fontSize={7} fill="#9ca3af">{h.role_code}</text>
          </g>
        ) : null)}
        <g transform={`translate(${iW - 88}, 2)`}>
          <line x1={0} y1={4} x2={10} y2={4} stroke="#3b82f6" strokeWidth={2} />
          <text x={13} y={8} fontSize={7} fill="#3b82f6">Monthly Gross</text>
          <line x1={0} y1={14} x2={10} y2={14} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2" />
          <text x={13} y={18} fontSize={7} fill="#ef4444">Bonus %</text>
        </g>
      </g>
    </svg>
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

interface ParsedEmployeeData {
  employee_id: string | null;
  employee_name: string;
  tests: { id: string; name: string; score: number | null }[];
  days_off: { days: number; start_date: string | null; end_date: string | null; note: string }[];
  monthly_rating: { month: string; score: number } | null;
  unrecognized: string;
}

export default function EmployeeList() {
  const { employees, addEmployee, updateEmployee, deleteEmployee, roleGrid, settings } = useStore();
  const [search, setSearch] = useState("");
  const [mainTab, setMainTab] = useState<"employees" | "tdl">("employees");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const { toast } = useToast();

  // ── TDL state ─────────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<EmployeeTask[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");

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

  // ── Smart Paste ────────────────────────────────────────────────────────────
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<ParsedEmployeeData | null>(null);
  const [applying, setApplying] = useState(false);

  const handleParse = async () => {
    if (!pasteText.trim()) return;
    setParsing(true);
    setPreview(null);
    try {
      const res = await fetch("/api/ai/parse-employee-data", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: pasteText,
          employees: employees.map(e => ({ id: e.id, name: e.name })),
          tests: (settings.tests ?? []).map(t => ({ id: t.id, name: t.name })),
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPreview(data);
    } catch (err: any) {
      toast({ title: "Parse failed", description: err.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const handleApplyPreview = async () => {
    if (!preview) return;
    setApplying(true);
    try {
      const emp = preview.employee_id ? employees.find(e => e.id === preview.employee_id) : null;
      if (!emp) {
        toast({ title: "Employee not found", description: `Could not match "${preview.employee_name}" to any employee.`, variant: "destructive" });
        return;
      }

      let updated = { ...emp };

      // Apply test scores
      if (preview.tests.length > 0) {
        const newTests = [...(emp.completed_tests ?? [])].map((t: any) => typeof t === 'string' ? { id: t, score: null } : t);
        for (const t of preview.tests) {
          const idx = newTests.findIndex(ct => ct.id === t.id);
          if (t.score !== null) {
            if (idx >= 0) newTests[idx] = { id: t.id, score: t.score };
            else newTests.push({ id: t.id, score: t.score });
          }
        }
        updated.completed_tests = newTests;
      }

      // Apply monthly rating
      if (preview.monthly_rating) {
        const ratings = [...(emp.monthly_ratings ?? [])];
        const idx = ratings.findIndex(r => r.month === preview.monthly_rating!.month);
        if (idx >= 0) ratings[idx] = preview.monthly_rating;
        else ratings.push(preview.monthly_rating);
        updated.monthly_ratings = ratings;
      }

      await updateEmployee(emp.id, updated);

      // Apply days off entries
      for (const d of preview.days_off) {
        await fetch("/api/days-off", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee_id: emp.id,
            type: "taken",
            year: new Date().getFullYear(),
            days: d.days,
            start_date: d.start_date,
            end_date: d.end_date,
            note: d.note || "Smart paste",
          }),
        });
      }

      const parts = [];
      if (preview.tests.length) parts.push(`${preview.tests.length} test score${preview.tests.length !== 1 ? "s" : ""}`);
      if (preview.days_off.length) parts.push(`${preview.days_off.reduce((s, d) => s + d.days, 0)} day${preview.days_off.reduce((s, d) => s + d.days, 0) !== 1 ? "s" : ""} off`);
      if (preview.monthly_rating) parts.push(`rating for ${preview.monthly_rating.month}`);
      toast({ title: `Applied to ${emp.name}`, description: parts.join(", ") || "No changes detected." });
      setPasteText("");
      setPreview(null);
      setPasteOpen(false);
    } finally {
      setApplying(false);
    }
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
      .filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const rankA = ROLE_RANK[a.current_role_code] || 0;
        const rankB = ROLE_RANK[b.current_role_code] || 0;
        if (rankA !== rankB) return rankB - rankA;
        return a.name.localeCompare(b.name);
      });
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
            <Button variant="outline" size="sm" onClick={() => setPasteOpen(v => !v)}>
              <ClipboardPaste className="w-4 h-4 mr-2" />
              Smart Paste
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

      {/* Smart Paste panel */}
      {pasteOpen && (
        <Card className="border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Smart Paste</span>
              <span className="text-xs text-muted-foreground">Paste any text with employee info — test results, days off, ratings — and AI will extract & apply it.</span>
            </div>
            <button onClick={() => { setPasteOpen(false); setPreview(null); setPasteText(""); }}>
              <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
            </button>
          </div>

          <Textarea
            placeholder={`e.g. "Defne passed the Green Belt with 90%. She took 3 days off from March 10 to 12. Monthly rating: 8.5"`}
            value={pasteText}
            onChange={e => { setPasteText(e.target.value); setPreview(null); }}
            rows={3}
            className="bg-background resize-none"
          />

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleParse} disabled={parsing || !pasteText.trim()}>
              {parsing ? <><Sparkles className="w-3.5 h-3.5 mr-1.5 animate-pulse" />Parsing…</> : <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Parse</>}
            </Button>
            {preview && !parsing && (
              <Button size="sm" variant="default" onClick={handleApplyPreview} disabled={applying || !preview.employee_id}>
                {applying ? "Applying…" : "Apply"}
              </Button>
            )}
          </div>

          {/* Preview */}
          {preview && !parsing && (
            <div className="bg-background border rounded-lg p-3 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Employee:</span>
                {preview.employee_id ? (
                  <span className="font-bold text-primary">{employees.find(e => e.id === preview.employee_id)?.name ?? preview.employee_name}</span>
                ) : (
                  <span className="text-destructive font-semibold">"{preview.employee_name}" — not matched. Check spelling.</span>
                )}
              </div>

              {preview.tests.length > 0 && (
                <div>
                  <div className="text-muted-foreground font-semibold mb-1">Tests:</div>
                  {preview.tests.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 pl-2">
                      <span className="w-2 h-2 rounded-full bg-primary/40 shrink-0" />
                      <span>{t.name}</span>
                      <span className={`font-bold ml-auto ${t.score === null ? "text-muted-foreground" : t.score >= 70 ? "text-emerald-600" : t.score >= 50 ? "text-amber-600" : "text-red-500"}`}>
                        {t.score === null ? "passed" : `${t.score}%`}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {preview.days_off.length > 0 && (
                <div>
                  <div className="text-muted-foreground font-semibold mb-1">Days Off:</div>
                  {preview.days_off.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 pl-2">
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                      <span>{d.days}d {d.start_date ? `(${d.start_date}${d.end_date ? ` → ${d.end_date}` : ""})` : ""}</span>
                      {d.note && <span className="text-muted-foreground">— {d.note}</span>}
                    </div>
                  ))}
                </div>
              )}

              {preview.monthly_rating && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground font-semibold">Rating:</span>
                  <span className="font-bold text-primary">{preview.monthly_rating.score}/10</span>
                  <span className="text-muted-foreground">for {preview.monthly_rating.month}</span>
                </div>
              )}

              {!preview.tests.length && !preview.days_off.length && !preview.monthly_rating && (
                <div className="text-muted-foreground italic">Nothing recognised. Try rephrasing.</div>
              )}

              {preview.unrecognized && (
                <div className="text-muted-foreground border-t pt-2 mt-1">
                  <span className="font-semibold">Unrecognized: </span>{preview.unrecognized}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

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
            {/* Task list */}
            <div className="divide-y">
              {tasks.length === 0 && (
                <div className="p-10 text-center text-muted-foreground text-sm">No tasks yet. Add one above.</div>
              )}
              {tasks.map(task => {
                const isOverdue = task.deadline && task.deadline < new Date().toISOString().slice(0, 10) && task.status === "pending";
                return (
                  <div key={task.id} className={`flex items-center gap-3 p-3 group hover:bg-muted/30 transition-colors ${task.status === "done" ? "opacity-60" : ""}`}>
                    <button onClick={() => toggleTask(task)} className="shrink-0">
                      {task.status === "done"
                        ? <Check className="w-5 h-5 text-emerald-500" />
                        : <div className="w-5 h-5 rounded border-2 border-muted-foreground/40 hover:border-primary transition-colors" />
                      }
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${task.status === "done" ? "line-through text-muted-foreground" : "text-foreground"}`}>{task.title}</div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-muted-foreground">→ <span className="font-medium">{task.delegated_to}</span></span>
                        {task.deadline && (
                          <span className={`text-xs flex items-center gap-1 ${isOverdue ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                            <Clock className="w-3 h-3" />
                            {format(parseISO(task.deadline), "dd/MM/yy")}
                            {isOverdue && " — OVERDUE"}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteTask(task.id)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                );
              })}
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
                  </TableRow>
                </React.Fragment>
              );
            })}
            {filteredEmployees.length === 0 && (
                <TableRow>
                    <TableCell colSpan={15} className="text-center py-12 text-muted-foreground">
                        No employees found.
                    </TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>}
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
  const { updateEmployee, deleteEmployee, roleGrid, settings } = useStore();
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

  const updateRating12 = (month: string, score: number | null) => {
    const updated = ratings12.map(r => r.month === month ? { ...r, score } : r);
    setRatings12(updated);
    form.setValue("monthly_ratings", updated.filter(r => r.score != null) as any);
  };

  const onSubmit = async (data: EmployeeInput) => {
    setSaveState("saving");
    try {
      const prevGross = employee.current_gross_fixed_year;
      const grossChanged = prevGross !== data.current_gross_fixed_year;

      await updateEmployee(employee.id, data);

      if (grossChanged) {
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
            note: "Salary update",
          }),
        });
      }

      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
      toast({ title: "Employee saved" });
    } catch (err) {
      setSaveState("idle");
      toast({ title: "Error saving employee", description: String(err), variant: "destructive" });
    }
  };

  const handleDetailDelete = async () => {
    if (confirm("Are you sure you want to delete this employee?")) {
      await deleteEmployee(employee.id);
      toast({ title: "Employee deleted" });
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

  useEffect(() => { loadSalaryHistory(); }, [employee.id]);

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

      <form onSubmit={(e) => {
        // Sanitize completed_tests before zodResolver validation
        const ct = form.getValues("completed_tests");
        if (Array.isArray(ct)) {
          form.setValue("completed_tests", ct.map((t: any) => typeof t === 'string' ? { id: t, score: null } : t));
        }
        form.handleSubmit(onSubmit, (errors) => {
          const details = Object.entries(errors).map(([k, v]) => `${k}: ${(v as any)?.message || (v as any)?.type || JSON.stringify(v)}`);
          console.error("Form validation errors:", errors);
          toast({ title: "Cannot save — validation failed", description: details.join("; "), variant: "destructive" });
        })(e);
      }} className="space-y-6">

        {/* Employee header */}
        <Card className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <h2 className="text-xl font-bold">{emp.name}</h2>
              <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
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
                  return (
                    <div key={test.id} className={`flex items-center gap-2 p-2 rounded-lg border ${isChecked ? 'bg-primary/5 border-primary/20' : 'bg-muted/10'}`}>
                      <input type="checkbox" id={`detail-test-${test.id}`} checked={isChecked}
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
                      <Label htmlFor={`detail-test-${test.id}`} className="text-sm font-normal cursor-pointer flex-1">{test.name}</Label>
                      {isChecked && (
                        <Input type="number" min="0" max="100" placeholder="Score" className="h-7 w-20 text-xs"
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
            </Card>
          </div>

          {/* RIGHT: calculated projections */}
          <div className="space-y-6">
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
                          if (next >= 0) await updateEmployee(emp.id, { ...emp, promo_increase_override: next });
                        }}>
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                      <div className="text-right min-w-[60px]">
                        <div className="font-bold text-emerald-600">+{metrics.increase_pct.toFixed(1)}%</div>
                        <div className="text-[10px] text-muted-foreground">+€{Math.round(metrics.increase_amount_monthly).toLocaleString()}/mo</div>
                      </div>
                      <button type="button" className="h-6 w-6 rounded border flex items-center justify-center hover:bg-muted text-muted-foreground"
                        onClick={async () => {
                          const cur = emp.promo_increase_override ?? settings.min_promo_increase_pct;
                          const next = Math.round((cur + 0.5) * 10) / 10;
                          if (next <= 100) await updateEmployee(emp.id, { ...emp, promo_increase_override: next });
                        }}>
                        <ChevronRightIcon className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {emp.promo_increase_override != null && (
                    <div className="flex justify-end">
                      <button type="button" className="text-[10px] text-muted-foreground hover:text-destructive underline"
                        onClick={async () => await updateEmployee(emp.id, { ...emp, promo_increase_override: null })}>
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
                  .map(t => emp.completed_tests?.find(ct => ct.id === t.id)?.score)
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
                        const score = existing?.score ?? null;
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
          <SalaryChart employeeId={emp.id} hireDate={emp.hire_date} />
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

                return (
                  <div key={entry.id} className={`rounded-lg border p-3 ${isScheduled ? "border-amber-300 bg-amber-50/50" : isCurrent ? "border-primary/40 bg-primary/5" : "bg-background"}`}>
                    {isScheduled && (
                      <div className="flex items-center gap-1 text-[10px] font-bold text-amber-600 uppercase tracking-wide mb-2">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        Scheduled — pending until effective date
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1">
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
                      <button type="button" onClick={() => handleDeleteHistoryEntry(entry.id!)}
                        className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
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
            <h4 className="font-bold text-sm mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Onboarding Ratings (W1-W8)
            </h4>
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

        {/* Save + Delete buttons */}
        <div className="flex justify-between items-center pt-4 border-t">
          <Button type="button" variant="destructive" onClick={handleDetailDelete}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Employee
          </Button>
          <Button type="submit" disabled={saveState !== "idle"}
            className={saveState === "saved" ? "bg-emerald-600 hover:bg-emerald-600" : ""}>
            {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save Employee"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function EmployeeDialog({ open, onOpenChange, editingId }: { open: boolean, onOpenChange: (open: boolean) => void, editingId: string | null }) {
  const { employees, addEmployee, updateEmployee, roleGrid, settings } = useStore();
  const { toast } = useToast();
  
  const defaultValues: Partial<EmployeeInput> = {
    name: "",
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
