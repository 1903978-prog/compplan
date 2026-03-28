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
import { Plus, Pencil, Trash2, Search, Info, ChevronDown, ChevronRight, Upload, History, TrendingUp, CheckCircle2 } from "lucide-react";
import { SalaryHistoryDialog } from "@/components/SalaryHistoryDialog";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { employeeInputSchema, type EmployeeInput, type CompletedTest } from "@shared/schema";
import { v4 as uuidv4 } from "uuid";
import { useToast } from "@/hooks/use-toast";
import { calculateEmployeeMetrics, grossToRal } from "@/lib/calculations";
import { format, parseISO, addMonths, subMonths } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight as ChevronRightIcon } from "lucide-react";

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

export default function EmployeeList() {
  const { employees, addEmployee, updateEmployee, deleteEmployee, roleGrid, settings } = useStore();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyEmployee, setHistoryEmployee] = useState<EmployeeInput | null>(null);
  const [scheduleRaiseEmployee, setScheduleRaiseEmployee] = useState<EmployeeInput | null>(null);
  const { toast } = useToast();

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

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this employee?")) {
      await deleteEmployee(id);
      toast({ title: "Employee deleted" });
    }
  };

  const openEdit = (employee: EmployeeInput) => {
    setEditingId(employee.id);
    setIsDialogOpen(true);
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

      <Card className="border-border">
        <div className="p-4 border-b flex items-center gap-4">
             <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input 
                    placeholder="Filter by name..." 
                    className="pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
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
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEmployees.map((emp) => {
              const metrics = calculateEmployeeMetrics(emp, roleGrid, settings);
              const isExpanded = expandedId === emp.id;
              return (
                <React.Fragment key={emp.id}>
                  <TableRow 
                    key={`${emp.id}-row`}
                    className="group cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedId(isExpanded ? null : emp.id)}
                  >
                    <TableCell>
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-0.5">
                        <span>{emp.name}</span>
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
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Schedule Salary Increase" onClick={(e) => { e.stopPropagation(); setScheduleRaiseEmployee(emp); }}>
                          <TrendingUp className="w-4 h-4 text-amber-500 hover:text-amber-600" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Salary History" onClick={(e) => { e.stopPropagation(); setHistoryEmployee(emp); }}>
                          <History className="w-4 h-4 text-muted-foreground hover:text-primary" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEdit(emp); }}>
                          <Pencil className="w-4 h-4 text-muted-foreground hover:text-primary" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDelete(emp.id); }}>
                          <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={16}>
                        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
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
                            {/* EEN Tenure vs Normal/Fast TOT comparison */}
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
                                      ⚠ Below fast-track minimum ({toYears(fastTot)}) — not eligible yet
                                    </div>
                                  )}
                                  {!belowFast && (
                                    <div className={`mt-1 text-[10px] font-semibold ${isAheadNorm ? 'text-emerald-600' : 'text-amber-600'}`}>
                                      {isAheadNorm ? `▲ ${toYears(deltaNorm)} ahead of normal path` : `▼ ${toYears(Math.abs(deltaNorm))} behind normal path`}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </Card>

                          <div className="space-y-6">
                            <Card className="p-4 bg-background">
                              <h4 className="font-bold text-sm mb-4">Promotion Salary Projection</h4>
                              {metrics.performance_score === null ? (
                                <p className="text-xs text-muted-foreground italic">N/A (Enter monthly ratings to see projection)</p>
                              ) : metrics.performance_score <= 5 ? (
                                <p className="text-xs text-muted-foreground italic">N/A (No promotion recommended for rate ≤ 5)</p>
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

                                  {/* Band targets: % to reach min / mid / max of next role */}
                                  {metrics.next_min > 0 && (() => {
                                    const cur = emp.current_gross_fixed_year;
                                    const nextRole = roleGrid.find(r => r.role_code === metrics.next_role_code);
                                    const mo = nextRole?.months_paid ?? emp.months_paid;
                                    const targets = [
                                      { label: "Min",  annual: metrics.next_min },
                                      { label: "Mid",  annual: Math.round((metrics.next_min + metrics.next_max) / 2) },
                                      { label: "Max",  annual: metrics.next_max },
                                    ];
                                    return (
                                      <div className="pt-2 border-t">
                                        <div className="text-[10px] uppercase text-muted-foreground font-bold mb-1.5 tracking-wide">
                                          % increase to reach {metrics.next_role_code} band
                                        </div>
                                        <div className="space-y-1">
                                          {targets.map(t => {
                                            const pct = ((t.annual - cur) / cur) * 100;
                                            const monthly = Math.round(t.annual / mo);
                                            const color = pct <= 10 ? "text-emerald-600" : pct <= 20 ? "text-amber-600" : "text-destructive";
                                            return (
                                              <div key={t.label} className="flex items-center justify-between text-xs">
                                                <span className="text-muted-foreground w-6">{t.label}</span>
                                                <span className="font-mono text-foreground">€{t.annual.toLocaleString()}/yr</span>
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
                                      <button
                                        type="button"
                                        className="h-6 w-6 rounded border flex items-center justify-center hover:bg-muted text-muted-foreground"
                                        onClick={async () => {
                                          const cur = emp.promo_increase_override ?? settings.min_promo_increase_pct;
                                          const next = Math.round((cur - 0.5) * 10) / 10;
                                          if (next >= 0) await updateEmployee(emp.id, { ...emp, promo_increase_override: next });
                                        }}
                                      >
                                        <ChevronLeft className="h-3 w-3" />
                                      </button>
                                      <div className="text-right min-w-[60px]">
                                        <div className="font-bold text-emerald-600">+{metrics.increase_pct.toFixed(1)}%</div>
                                        <div className="text-[10px] text-muted-foreground">+€{Math.round(metrics.increase_amount_monthly).toLocaleString()}/mo</div>
                                      </div>
                                      <button
                                        type="button"
                                        className="h-6 w-6 rounded border flex items-center justify-center hover:bg-muted text-muted-foreground"
                                        onClick={async () => {
                                          const cur = emp.promo_increase_override ?? settings.min_promo_increase_pct;
                                          const next = Math.round((cur + 0.5) * 10) / 10;
                                          if (next <= 100) await updateEmployee(emp.id, { ...emp, promo_increase_override: next });
                                        }}
                                      >
                                        <ChevronRightIcon className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>
                                  {emp.promo_increase_override != null && (
                                    <div className="flex justify-end">
                                      <button
                                        type="button"
                                        className="text-[10px] text-muted-foreground hover:text-destructive underline"
                                        onClick={async () => await updateEmployee(emp.id, { ...emp, promo_increase_override: null })}
                                      >
                                        Reset to global ({settings.min_promo_increase_pct}%)
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </Card>

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
                                            <input
                                              type="number"
                                              min={0}
                                              max={100}
                                              placeholder="NA"
                                              defaultValue={score ?? ""}
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
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
            {filteredEmployees.length === 0 && (
                <TableRow>
                    <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                        No employees found.
                    </TableCell>
                </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <EmployeeDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        editingId={editingId}
      />

      {historyEmployee && (
        <SalaryHistoryDialog
          employee={historyEmployee}
          roleGrid={roleGrid}
          open={!!historyEmployee}
          onClose={() => setHistoryEmployee(null)}
        />
      )}

      {scheduleRaiseEmployee && (
        <ScheduleSalaryIncreaseDialog
          employee={scheduleRaiseEmployee}
          open={!!scheduleRaiseEmployee}
          onClose={() => setScheduleRaiseEmployee(null)}
        />
      )}
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
      form.reset({ ...base, monthly_ratings: ratings.filter(r => r.score != null) });
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

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 mt-4">
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
