import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, TrendingUp, TrendingDown, Minus, Clock } from "lucide-react";
import type { SalaryHistoryEntry, EmployeeInput } from "@shared/schema";
import { grossToRal } from "@/lib/calculations";
import { useToast } from "@/hooks/use-toast";

interface Props {
  employee: EmployeeInput;
  open: boolean;
  onClose: () => void;
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(d: string) {
  // d = YYYY-MM-DD
  const [y, m] = d.split("-");
  return `${MONTH_NAMES[parseInt(m) - 1]} ${y}`;
}

export function SalaryHistoryDialog({ employee, open, onClose }: Props) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<SalaryHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // New entry form state
  const [form, setForm] = useState({
    effective_date: new Date().toISOString().slice(0, 10),
    role_code: employee.current_role_code,
    gross_fixed_year: employee.current_gross_fixed_year,
    months_paid: employee.months_paid,
    bonus_pct: employee.current_bonus_pct,
    meal_voucher_daily: employee.meal_voucher_daily,
    note: "",
  });

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/salary-history/${employee.id}`, { credentials: "include" });
      const data = await res.json();
      // Sort ascending: oldest first, newest (current) at the bottom
      setEntries((data as SalaryHistoryEntry[]).sort((a, b) => a.effective_date.localeCompare(b.effective_date)));
    } catch {
      toast({ title: "Failed to load salary history", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) loadHistory();
  }, [open, employee.id]);

  const handleAdd = async () => {
    if (!form.gross_fixed_year || form.gross_fixed_year <= 0) return;
    try {
      const res = await fetch("/api/salary-history", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, employee_id: employee.id }),
      });
      if (!res.ok) throw new Error("Failed");
      await loadHistory();
      setShowForm(false);
      setForm(f => ({ ...f, note: "" }));
      toast({ title: "Salary entry added" });
    } catch {
      toast({ title: "Failed to save entry", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this entry?")) return;
    try {
      await fetch(`/api/salary-history/${id}`, { method: "DELETE", credentials: "include" });
      setEntries(e => e.filter(x => x.id !== id));
      toast({ title: "Entry deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  // For each entry, compute delta vs the entry before it (the older one)
  const getDelta = (idx: number) => {
    if (idx === 0) return null;
    const prev = entries[idx - 1];
    const delta = entries[idx].gross_fixed_year - prev.gross_fixed_year;
    const pct = (delta / prev.gross_fixed_year) * 100;
    return { delta, pct };
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-muted-foreground" />
            Salary History — {employee.name}
          </DialogTitle>
        </DialogHeader>

        {/* Current salary summary */}
        <div className="bg-muted/30 rounded-lg p-3 text-sm grid grid-cols-4 gap-3 border">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground font-bold">Current Role</div>
            <div className="font-semibold font-mono">{employee.current_role_code}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground font-bold">Yearly Gross</div>
            <div className="font-semibold">€{employee.current_gross_fixed_year.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground font-bold">Monthly Gross</div>
            <div className="font-semibold">€{Math.round(employee.current_gross_fixed_year / employee.months_paid).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground font-bold">RAL</div>
            <div className="font-semibold">€{Math.round(grossToRal(employee.current_gross_fixed_year) * 1000).toLocaleString()}</div>
          </div>
        </div>

        {/* Add entry button */}
        <div className="flex justify-end">
          <Button size="sm" variant={showForm ? "outline" : "default"} onClick={() => setShowForm(v => !v)}>
            {showForm ? "Cancel" : <><Plus className="w-4 h-4 mr-1" /> Log Salary Entry</>}
          </Button>
        </div>

        {/* Add entry form */}
        {showForm && (
          <div className="border rounded-lg p-4 bg-muted/20 space-y-4">
            <div className="text-sm font-bold text-muted-foreground uppercase tracking-wide">New Entry</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Effective Date</Label>
                <Input type="date" value={form.effective_date}
                  onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))}
                  className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Role Code</Label>
                <Input value={form.role_code}
                  onChange={e => setForm(f => ({ ...f, role_code: e.target.value }))}
                  className="h-8 text-sm font-mono" placeholder="e.g. A1" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Yearly Gross (€)</Label>
                <Input type="number" value={form.gross_fixed_year}
                  onChange={e => setForm(f => ({ ...f, gross_fixed_year: parseFloat(e.target.value) || 0 }))}
                  className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Months Paid</Label>
                <Input type="number" min="12" max="13" value={form.months_paid}
                  onChange={e => setForm(f => ({ ...f, months_paid: parseInt(e.target.value) as 12 | 13 }))}
                  className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bonus %</Label>
                <Input type="number" min="0" max="100" value={form.bonus_pct}
                  onChange={e => setForm(f => ({ ...f, bonus_pct: parseFloat(e.target.value) || 0 }))}
                  className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Meal Voucher (€/day)</Label>
                <Input type="number" min="0" step="0.5" value={form.meal_voucher_daily}
                  onChange={e => setForm(f => ({ ...f, meal_voucher_daily: parseFloat(e.target.value) || 0 }))}
                  className="h-8 text-sm" />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Note (optional)</Label>
                <Input value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                  className="h-8 text-sm" placeholder="e.g. Promotion to S1, Annual review, Added meal voucher…" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAdd}>Save Entry</Button>
            </div>
          </div>
        )}

        {/* History timeline */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm italic">
            No salary history logged yet. Click "Log Salary Entry" to start tracking.
          </div>
        ) : (
          <div className="relative space-y-0">
            {/* Vertical timeline line */}
            <div className="absolute left-[19px] top-3 bottom-3 w-0.5 bg-border z-0" />

            {entries.map((entry, idx) => {
              const isNewest = idx === entries.length - 1;
              const delta = getDelta(idx);
              const monthlyGross = entry.gross_fixed_year / (entry.months_paid ?? 12);
              const ral = grossToRal(entry.gross_fixed_year);

              return (
                <div key={entry.id} className="relative flex gap-4 pb-4 z-10">
                  {/* Timeline dot */}
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-bold z-10 bg-background ${
                    isNewest ? "border-primary text-primary" : "border-border text-muted-foreground"
                  }`}>
                    {isNewest ? "NOW" : fmtDate(entry.effective_date).slice(0, 3)}
                  </div>

                  {/* Card */}
                  <div className={`flex-1 rounded-lg border p-3 ${isNewest ? "border-primary/30 bg-primary/5" : "bg-background"}`}>
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{fmtDate(entry.effective_date)}</span>
                          {entry.role_code && (
                            <span className="bg-secondary px-2 py-0.5 rounded text-xs font-mono">{entry.role_code}</span>
                          )}
                          {isNewest && <span className="text-[10px] bg-primary text-primary-foreground px-2 py-0.5 rounded font-bold uppercase">Latest</span>}
                        </div>
                        {entry.note && (
                          <div className="text-xs text-muted-foreground italic mt-0.5">{entry.note}</div>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(entry.id!)}
                        className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Salary grid */}
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase">Yearly Gross</div>
                        <div className="font-bold text-sm">€{entry.gross_fixed_year.toLocaleString()}</div>
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
                        {entry.bonus_pct != null && (
                          <div><span className="text-[10px] text-muted-foreground uppercase">Bonus </span><span className="font-semibold">{entry.bonus_pct}%</span></div>
                        )}
                        {entry.meal_voucher_daily != null && (
                          <div><span className="text-[10px] text-muted-foreground uppercase">Voucher </span><span className="font-semibold">€{entry.meal_voucher_daily}/d</span></div>
                        )}
                      </div>
                    </div>

                    {/* Delta vs previous */}
                    {delta && (
                      <div className={`mt-2 pt-2 border-t flex items-center gap-1.5 text-xs font-semibold ${delta.delta > 0 ? "text-emerald-600" : delta.delta < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {delta.delta > 0 ? <TrendingUp className="w-3 h-3" /> : delta.delta < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                        {delta.delta > 0 ? "+" : ""}{delta.delta.toLocaleString()} €/yr
                        ({delta.delta > 0 ? "+" : ""}{delta.pct.toFixed(1)}% vs prev)
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
