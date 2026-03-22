import { useState, useEffect, useMemo } from "react";
import { useStore } from "@/hooks/use-store";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, CalendarDays, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { DaysOffEntry, EmployeeInput } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

const CURRENT_YEAR = new Date().getFullYear();

// Days accrue from the month AFTER hiring (unless hired on the 1st, in which case the hire month counts).
// Supports hire_date as YYYY-MM or YYYY-MM-DD.
function accruedDays(hireDate: string, year: number): number {
  const today = new Date();
  if (today.getFullYear() < year) return 0;

  const parts = hireDate.split("-").map(Number);
  const hy = parts[0], hm = parts[1], hd = parts[2] ?? 1;
  // First month that accrues: hire month if hired on day 1, otherwise next month
  const firstAccrualMonth = hd === 1 ? hm - 1 : hm; // 0-indexed
  const firstAccrualYear = hy + Math.floor(firstAccrualMonth / 12);
  const firstAccrualM = firstAccrualMonth % 12; // 0-indexed month in year

  let accrued = 0;
  for (let m = 0; m < 12; m++) {
    const lastDay = new Date(year, m + 1, 0);
    if (lastDay > today) break;
    // Skip months before first accrual
    if (year < firstAccrualYear) continue;
    if (year === firstAccrualYear && m < firstAccrualM) continue;
    accrued += m === 11 ? 3 : 2;
  }
  return accrued;
}

function businessDaysBetween(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  if (e < s) return 0;
  let count = 0;
  const d = new Date(s);
  while (d <= e) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

interface BalanceInfo {
  accrued: number;
  carryover: number;
  taken: number;
  remaining: number;
  willCarryOver: number;
}

function getBalance(emp: EmployeeInput, entries: DaysOffEntry[], year: number): BalanceInfo {
  const empEntries = entries.filter((e) => e.employee_id === emp.id && e.year === year);
  const taken = empEntries.filter((e) => e.type === "taken").reduce((s, e) => s + e.days, 0);
  const carryover = empEntries.filter((e) => e.type === "carryover").reduce((s, e) => s + e.days, 0);
  const accrued = accruedDays(emp.hire_date, year);
  const remaining = accrued + carryover - taken;
  const willCarryOver = Math.min(5, Math.max(0, remaining));
  return { accrued, carryover, taken, remaining, willCarryOver };
}

function BalanceBadge({ remaining }: { remaining: number }) {
  if (remaining <= 0) return <Badge variant="destructive">Out of days</Badge>;
  if (remaining < 5) return <Badge className="bg-orange-500 hover:bg-orange-600">{remaining}d left</Badge>;
  return <Badge className="bg-green-600 hover:bg-green-700">{remaining}d left</Badge>;
}

export default function DaysOff() {
  const { employees } = useStore();
  const { toast } = useToast();
  const [entries, setEntries] = useState<DaysOffEntry[]>([]);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [showDialog, setShowDialog] = useState(false);
  const [filterEmp, setFilterEmp] = useState<string>("all");

  // Form state
  const [fEmployee, setFEmployee] = useState("");
  const [fType, setFType] = useState<"taken" | "carryover">("taken");
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [fDays, setFDays] = useState<number>(0);
  const [fNote, setFNote] = useState("");

  useEffect(() => {
    fetch(`/api/days-off?year=${year}`, { credentials: "include" })
      .then((r) => r.json())
      .then(setEntries)
      .catch(() => {});
  }, [year]);

  // Auto-compute business days when dates change
  useEffect(() => {
    if (fType === "taken" && fStart && fEnd) {
      setFDays(businessDaysBetween(fStart, fEnd));
    }
  }, [fStart, fEnd, fType]);

  const openAdd = () => {
    setFEmployee(employees[0]?.id ?? "");
    setFType("taken");
    setFStart("");
    setFEnd("");
    setFDays(0);
    setFNote("");
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!fEmployee) return;
    if (fType === "taken" && (!fStart || !fEnd || fDays <= 0)) {
      toast({ title: "Please fill in dates and days", variant: "destructive" });
      return;
    }
    if (fType === "carryover" && fDays <= 0) {
      toast({ title: "Carryover days must be > 0", variant: "destructive" });
      return;
    }
    try {
      const res = await apiRequest("POST", "/api/days-off", {
        employee_id: fEmployee,
        type: fType,
        year,
        start_date: fType === "taken" ? fStart : null,
        end_date: fType === "taken" ? fEnd : null,
        days: fDays,
        note: fNote || null,
      });
      const created = await res.json() as DaysOffEntry;
      setEntries((prev) => [...prev, created]);
      setShowDialog(false);
      toast({ title: "Entry saved" });
    } catch (err) {
      toast({ title: "Error saving entry", description: String(err), variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiRequest("DELETE", `/api/days-off/${id}`);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast({ title: "Entry deleted" });
    } catch (err) {
      toast({ title: "Error deleting", description: String(err), variant: "destructive" });
    }
  };

  const filteredEntries = useMemo(() =>
    entries.filter((e) => filterEmp === "all" || e.employee_id === filterEmp)
      .sort((a, b) => (a.start_date ?? "") > (b.start_date ?? "") ? -1 : 1),
    [entries, filterEmp]
  );

  const empById = useMemo(() =>
    Object.fromEntries(employees.map((e) => [e.id, e])),
    [employees]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Days Off"
        description={`Vacation balance and bookings for ${year}`}
        actions={
          <div className="flex gap-2 items-center">
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={openAdd}>
              <Plus className="w-4 h-4 mr-2" />
              Add Entry
            </Button>
          </div>
        }
      />

      {/* Balance cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {employees.map((emp) => {
          const bal = getBalance(emp, entries, year);
          return (
            <Card key={emp.id} className={`border-l-4 ${bal.remaining <= 0 ? "border-l-red-500" : bal.remaining < 5 ? "border-l-orange-400" : "border-l-green-500"}`}>
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">{emp.name}</CardTitle>
                  <BalanceBadge remaining={bal.remaining} />
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Accrued</span><span className="font-mono font-medium text-foreground">{bal.accrued}d</span></div>
                <div className="flex justify-between"><span>Carryover</span><span className="font-mono font-medium text-foreground">{bal.carryover}d</span></div>
                <div className="flex justify-between"><span>Taken</span><span className="font-mono font-medium text-foreground">{bal.taken}d</span></div>
                <div className="flex justify-between border-t pt-1 mt-1"><span className="font-semibold text-foreground">Remaining</span><span className={`font-mono font-bold ${bal.remaining <= 0 ? "text-red-600" : bal.remaining < 5 ? "text-orange-500" : "text-green-600"}`}>{bal.remaining}d</span></div>
                <div className="flex justify-between text-muted-foreground/70"><span>Carries to {year + 1}</span><span className="font-mono">{bal.willCarryOver}d</span></div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Entries table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="w-4 h-4" />
              Entries
            </CardTitle>
            <Select value={filterEmp} onValueChange={setFilterEmp}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead>Employee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-center">Days</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No entries for {year}</TableCell>
                </TableRow>
              ) : filteredEntries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">{empById[entry.employee_id]?.name ?? entry.employee_id}</TableCell>
                  <TableCell>
                    <Badge variant={entry.type === "carryover" ? "secondary" : "outline"}>
                      {entry.type === "carryover" ? "Carryover" : "Days off"}
                    </Badge>
                  </TableCell>
                  <TableCell>{entry.start_date ? formatDate(entry.start_date) : "—"}</TableCell>
                  <TableCell>{entry.end_date ? formatDate(entry.end_date) : "—"}</TableCell>
                  <TableCell className="text-center font-mono">{entry.days}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{entry.note ?? ""}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(entry.id!)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Days Off Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Employee</Label>
              <Select value={fEmployee} onValueChange={setFEmployee}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={fType} onValueChange={(v) => setFType(v as "taken" | "carryover")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="taken">Days off taken</SelectItem>
                  <SelectItem value="carryover">Carryover from previous year</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {fType === "taken" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>From</Label>
                    <Input type="date" value={fStart} onChange={(e) => setFStart(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>To</Label>
                    <Input type="date" value={fEnd} onChange={(e) => setFEnd(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Working days</Label>
                  <Input type="number" min="0.5" step="0.5" value={fDays}
                    onChange={(e) => setFDays(parseFloat(e.target.value))} />
                  <p className="text-xs text-muted-foreground">Auto-computed from dates (excl. weekends). Adjust if needed.</p>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label>Days to carry over</Label>
                <Input type="number" min="0.5" step="0.5" max="5" value={fDays}
                  onChange={(e) => setFDays(parseFloat(e.target.value))} />
                <p className="text-xs text-muted-foreground">Max 5 days allowed</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Note (optional)</Label>
              <Textarea value={fNote} onChange={(e) => setFNote(e.target.value)} rows={2} placeholder="e.g. Summer holiday" />
            </div>

            {fEmployee && (
              <div className="p-3 bg-muted/40 rounded-md text-sm">
                {(() => {
                  const emp = employees.find((e) => e.id === fEmployee);
                  if (!emp) return null;
                  const bal = getBalance(emp, entries, year);
                  const afterTaking = fType === "taken" ? bal.remaining - fDays : bal.remaining;
                  return (
                    <div className="flex items-center gap-2">
                      {afterTaking < 0 && <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />}
                      <span>
                        <span className="font-medium">{emp.name}</span> will have{" "}
                        <span className={`font-bold ${afterTaking < 0 ? "text-red-600" : "text-green-600"}`}>
                          {fType === "taken" ? afterTaking : bal.remaining + fDays}d
                        </span>{" "}
                        remaining after this entry.
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
