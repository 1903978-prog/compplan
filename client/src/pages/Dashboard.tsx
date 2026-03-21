import { useStore } from "@/hooks/use-store";
import { calculateEmployeeMetrics } from "@/lib/calculations";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Download, ArrowRight, Gift, TrendingUp } from "lucide-react";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { format, parseISO, addDays, isBefore, isAfter, startOfMonth, endOfMonth, addMonths, differenceInMonths } from "date-fns";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

function BandPosition({ metrics }: { metrics: any }) {
  const renderLine = (label: string, min: number, max: number, val: number, isNA: boolean, tooltip: React.ReactNode) => {
    const pos = max === min ? 50 : Math.min(Math.max(((val - min) / (max - min)) * 100, 0), 100);
    const isOutOfBand = val < min || val > max;

    return (
      <div className="space-y-0.5">
        <div className="flex justify-between text-[8px] text-muted-foreground uppercase font-bold tracking-tighter">
          <span>{label}</span>
          {isNA && <span className="text-destructive/50">N/A</span>}
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="relative h-2 w-full bg-muted rounded-full overflow-visible group cursor-help">
                {!isNA && (
                  <>
                    <div className="absolute top-0 bottom-0 left-0 right-0 flex justify-between px-0.5 pointer-events-none">
                      <span className="text-[9px] font-bold self-center">€{Math.round(min/1000)}k</span>
                      <span className="text-[9px] font-bold self-center">€{Math.round(max/1000)}k</span>
                    </div>
                    <div 
                      className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border border-background shadow-sm transition-all ${isOutOfBand ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ left: `${pos}%` }}
                    />
                    {val < min && <span className="absolute -left-1 top-1/2 -translate-y-1/2 text-[8px] font-bold text-destructive">&lt;</span>}
                    {val > max && <span className="absolute -right-1 top-1/2 -translate-y-1/2 text-[8px] font-bold text-destructive">&gt;</span>}
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

    const isNA = metrics.performance_score <= 5 || !metrics.next_role_code;
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
        isNA,
        <div className="space-y-1">
          {metrics.performance_score === null ? (
            <div className="font-bold text-destructive">N/A - No ratings entered</div>
          ) : metrics.performance_score <= 5 ? (
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

export default function Dashboard() {
  const { employees, roleGrid, settings } = useStore();

  const metrics = useMemo(() => {
    return employees.map(emp => {
      const result = calculateEmployeeMetrics(emp, roleGrid, settings);
      return { ...emp, ...result };
    }).sort((a, b) => {
      const rankA = ROLE_RANK[a.current_role_code] || 0;
      const rankB = ROLE_RANK[b.current_role_code] || 0;
      if (rankA !== rankB) return rankB - rankA;
      return a.name.localeCompare(b.name);
    });
  }, [employees, roleGrid, settings]);

  const exportCSV = () => {
    // Basic CSV export logic would go here
    alert("Export feature would generate a CSV here.");
  };

  const nextOpening = useMemo(() => {
    const months = [0, 4, 8]; // Jan, May, Sep
    const now = new Date();
    const currentMonth = now.getMonth();
    
    let targetMonth = months.find(m => m > currentMonth);
    let targetYear = now.getFullYear();
    
    if (targetMonth === undefined) {
      targetMonth = 0;
      targetYear++;
    }
    
    return {
      month: targetMonth,
      year: targetYear,
      label: format(new Date(targetYear, targetMonth, 1), "MMMM")
    };
  }, []);

  const upcomingPromotions = useMemo(() => {
    return metrics.filter(m => {
      if (m.recommended_track === "No promotion" || !m.next_role_code) return false;
      const recTrack = m.tracks.find((t: any) => t.isRecommended);
      if (!recTrack) return false;
      
      const promoDate = recTrack.effectiveDate;
      return promoDate.getMonth() === nextOpening.month && promoDate.getFullYear() === nextOpening.year;
    });
  }, [metrics, nextOpening]);

  const upcomingBirthdays = useMemo(() => {
    const now = new Date();
    const next30Days = addDays(now, 30);
    
    return employees.filter(emp => {
      const dob = parseISO(emp.date_of_birth);
      const thisYearBirthday = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
      const nextYearBirthday = new Date(now.getFullYear() + 1, dob.getMonth(), dob.getDate());
      
      return (isAfter(thisYearBirthday, now) && isBefore(thisYearBirthday, next30Days)) ||
             (isAfter(nextYearBirthday, now) && isBefore(nextYearBirthday, next30Days));
    }).sort((a, b) => {
      const dobA = parseISO(a.date_of_birth);
      const dobB = parseISO(b.date_of_birth);
      return dobA.getMonth() - dobB.getMonth() || dobA.getDate() - dobB.getDate();
    });
  }, [employees]);

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Compensation Dashboard" 
        actions={
          <Button variant="outline" onClick={exportCSV}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-4 border-l-4 border-l-primary bg-primary/5">
          <div className="flex items-center gap-3 mb-3">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h3 className="font-bold text-sm">Promotions to announce in {nextOpening.label}</h3>
          </div>
          <div className="space-y-2">
            {upcomingPromotions.length > 0 ? (
              upcomingPromotions.map(emp => (
                <div key={emp.id} className="flex justify-between items-center text-sm p-2 bg-background rounded border shadow-sm">
                  <span className="font-medium">{emp.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{emp.current_role_code}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs font-bold text-primary">{emp.next_role_code}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground italic">No promotions scheduled for {nextOpening.label}.</p>
            )}
          </div>
        </Card>

        <Card className="p-4 border-l-4 border-l-pink-500 bg-pink-500/5">
          <div className="flex items-center gap-3 mb-3">
            <Gift className="w-5 h-5 text-pink-500" />
            <h3 className="font-bold text-sm">Birthdays in the next 30 days</h3>
          </div>
          <div className="space-y-2">
            {upcomingBirthdays.length > 0 ? (
              upcomingBirthdays.map(emp => {
                const dob = parseISO(emp.date_of_birth);
                return (
                  <div key={emp.id} className="flex justify-between items-center text-sm p-2 bg-background rounded border shadow-sm">
                    <span className="font-medium">{emp.name}</span>
                    <span className="text-xs font-bold text-pink-600">{format(dob, "MMM dd")}</span>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-muted-foreground italic">No birthdays in the next 30 days.</p>
            )}
          </div>
        </Card>
      </div>

      <div className="bg-card rounded-xl border shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Employee</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead className="text-right">Tenure EEN</TableHead>
                <TableHead className="text-right">Tenure (Total)</TableHead>
                <TableHead className="text-right">Months since Promo</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Track</TableHead>
                <TableHead>Next Promo</TableHead>
                <TableHead className="text-center" colSpan={2}>Gross (€)</TableHead>
                <TableHead className="text-right">Increase</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[180px]">Band position (Now vs Next)</TableHead>
              </TableRow>
              <TableRow className="bg-muted/10 text-[10px] uppercase tracking-wider">
                <TableHead colSpan={8}></TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">Future</TableHead>
                <TableHead colSpan={3}></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metrics.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="text-center h-32 text-muted-foreground">
                    No employees found. Add some from the Employees tab.
                  </TableCell>
                </TableRow>
              ) : (
                metrics.map((emp) => (
                  <TableRow key={emp.id} className="table-row-hover">
                    <TableCell className="font-medium">
                        <div>{emp.name}</div>
                        <div className="text-[10px] text-muted-foreground">Hired: {emp.hire_date}</div>
                        {emp.last_promo_date && emp.last_promo_date !== "" && (
                          <div className="text-[10px] text-muted-foreground">
                            Last Promo: {format(parseISO(emp.last_promo_date), "MM/yy")}
                          </div>
                        )}
                    </TableCell>
                    <TableCell>
                        <span className="font-mono text-xs bg-secondary px-2 py-1 rounded">{emp.current_role_code}</span>
                    </TableCell>
                    <TableCell className="text-right text-xs">{emp.age}</TableCell>
                    <TableCell className="text-right text-xs">{emp.hireTenure.toFixed(1)}y</TableCell>
                    <TableCell className="text-right text-xs">{emp.totalTenure.toFixed(1)}y</TableCell>
                    <TableCell className="text-right text-xs">
                      {emp.last_promo_date ? (
                        <span className="font-medium text-primary">
                          {differenceInMonths(new Date(), parseISO(emp.last_promo_date))}m
                        </span>
                      ) : "-"}
                    </TableCell>
                    <TableCell>
                        <div className="flex items-center gap-2">
                            {emp.performance_score !== null ? (
                                <span className={emp.performance_score >= 8.5 ? "text-purple-600 font-bold" : ""}>
                                    {emp.performance_score.toFixed(1)}
                                </span>
                            ) : (
                                <span className="text-muted-foreground italic text-[10px]">Na</span>
                            )}
                        </div>
                    </TableCell>
                    <TableCell>
                        <StatusBadge status={emp.recommended_track} variant="track" />
                    </TableCell>
                    <TableCell className="text-sm font-semibold text-primary">
                        {emp.next_promo_date}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs whitespace-nowrap px-1">
                        €{emp.current_gross_fixed_year.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs whitespace-nowrap px-1">
                         {emp.future_gross_month > 0 ? (
                            `€${(emp.future_gross_month * emp.months_paid).toLocaleString()}`
                         ) : "-"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                        {emp.increase_pct > 0 && (
                            <div className="flex flex-col items-end">
                                <span className="text-emerald-600 font-medium">+{emp.increase_pct.toFixed(1)}%</span>
                                <span className="text-[10px] text-muted-foreground">+€{(emp.increase_amount_monthly * emp.months_paid).toLocaleString()}</span>
                            </div>
                        )}
                    </TableCell>
                    <TableCell>
                        <StatusBadge status={emp.band_status} variant="band" />
                    </TableCell>
                    <TableCell>
                        <BandPosition metrics={emp} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
