import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Plus, TrendingUp, TrendingDown, Minus, Clock, Pencil, Check, X } from "lucide-react";
import type { SalaryHistoryEntry, EmployeeInput, RoleGridRow } from "@shared/schema";
import { grossToRal } from "@/lib/calculations";
import { useToast } from "@/hooks/use-toast";

interface Props {
  employee: EmployeeInput;
  roleGrid: RoleGridRow[];
  open: boolean;
  onClose: () => void;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CURRENT_YEAR = new Date().getFullYear();
const TODAY = new Date().toISOString().slice(0, 10);
const YEARS = Array.from({ length: CURRENT_YEAR - 2022 + 3 }, (_, i) => 2023 + i); // 2023…current+2

function fmtDate(d: string) {
  const [y, m] = d.split("-");
  return `${MONTHS[parseInt(m) - 1]} ${y}`;
}
function parseDate(d: string) {
  const [y, m] = d.split("-");
  return { year: parseInt(y), month: parseInt(m) };
}
function buildDate(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function SalaryHistoryDialog({ employee, roleGrid, open, onClose }: Props) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<SalaryHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // New entry form state
  const today = new Date();
  const [formMonth, setFormMonth] = useState(today.getMonth() + 1);
  const [formYear, setFormYear] = useState(today.getFullYear());
  const [formRole, setFormRole] = useState(employee.current_role_code);
  const [formGross, setFormGross] = useState(employee.current_gross_fixed_year);
  const [formMonths, setFormMonths] = useState<number>(employee.months_paid);
  const [formBonus, setFormBonus] = useState<number>(employee.current_bonus_pct ?? 0);
  const [formVoucher, setFormVoucher] = useState<number>(employee.meal_voucher_daily ?? 0);
  const [formNote, setFormNote] = useState("");

  // Inline date-edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editMonth, setEditMonth] = useState(1);
  const [editYear, setEditYear] = useState(CURRENT_YEAR);

  // When role changes in form, auto-fill months_paid, bonus, and meal voucher
  const handleFormRoleChange = (roleCode: string) => {
    setFormRole(roleCode);
    const roleRow = roleGrid.find(r => r.role_code === roleCode);
    if (roleRow) {
      setFormMonths(roleRow.months_paid);
    }
    // If selecting the current role, use live employee values; otherwise default to 0
    const isCurrent = roleCode === employee.current_role_code;
    setFormBonus(isCurrent ? (employee.current_bonus_pct ?? 0) : 0);
    setFormVoucher(isCurrent ? (employee.meal_voucher_daily ?? 0) : 0);
  };

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/salary-history/${employee.id}`, { credentials: "include" });
      const data = await res.json();
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
    if (!formGross || formGross <= 0) return;
    try {
      const res = await fetch("/api/salary-history", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: employee.id,
          effective_date: buildDate(formYear, formMonth),
          role_code: formRole,
          gross_fixed_year: formGross,
          months_paid: formMonths,
          bonus_pct: formBonus,
          meal_voucher_daily: formVoucher,
          note: formNote,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      await loadHistory();
      setShowForm(false);
      setFormNote("");
      toast({ title: "Salary entry added" });
    } catch {
      toast({ title: "Failed to save entry", variant: "destructive" });
    }
  };

  const startEdit = (entry: SalaryHistoryEntry) => {
    const { year, month } = parseDate(entry.effective_date);
    setEditYear(year);
    setEditMonth(month);
    setEditingId(entry.id!);
  };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = async (id: number) => {
    try {
      const res = await fetch(`/api/salary-history/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effective_date: buildDate(editYear, editMonth) }),
      });
      if (!res.ok) throw new Error("Failed");
      await loadHistory();
      setEditingId(null);
      toast({ title: "Date updated" });
    } catch {
      toast({ title: "Failed to update date", variant: "destructive" });
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

  const displayed = [...entries].reverse();

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-muted-foreground" />
            Salary History — {employee.name}
          </DialogTitle>
        </DialogHeader>

        {/* Add entry button */}
        <div className="flex justify-end">
          <Button size="sm" variant={showForm ? "outline" : "default"} onClick={() => setShowForm(v => !v)}>
            {showForm ? "Cancel" : <><Plus className="w-4 h-4 mr-1" /> Log Salary Entry</>}
          </Button>
        </div>

        {/* New entry form */}
        {showForm && (
          <div className="border rounded-lg p-4 bg-muted/20 space-y-4">
            <div className="text-sm font-bold text-muted-foreground uppercase tracking-wide">New Entry</div>
            <div className="grid grid-cols-2 gap-3">

              {/* Effective date: month + year dropdowns */}
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Effective Date</Label>
                <div className="flex gap-2">
                  <Select value={String(formMonth)} onValueChange={v => setFormMonth(parseInt(v))}>
                    <SelectTrigger className="h-8 w-28 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => (
                        <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={String(formYear)} onValueChange={v => setFormYear(parseInt(v))}>
                    <SelectTrigger className="h-8 w-24 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {YEARS.map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Role code dropdown */}
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Role</Label>
                <Select value={formRole} onValueChange={handleFormRoleChange}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select role…" />
                  </SelectTrigger>
                  <SelectContent>
                    {roleGrid.map(r => (
                      <SelectItem key={r.role_code} value={r.role_code}>
                        <span className="font-mono font-semibold">{r.role_code}</span>
                        <span className="ml-2 text-muted-foreground">{r.role_name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Yearly Gross */}
              <div className="space-y-1">
                <Label className="text-xs">Yearly Gross (€)</Label>
                <Input type="number" value={formGross}
                  onChange={e => setFormGross(parseFloat(e.target.value) || 0)}
                  className="h-8 text-sm" />
              </div>

              {/* Months Paid — auto-filled from role */}
              <div className="space-y-1">
                <Label className="text-xs">Months Paid</Label>
                <Select value={String(formMonths)} onValueChange={v => setFormMonths(parseInt(v))}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="12">12</SelectItem>
                    <SelectItem value="13">13</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Bonus — auto-filled from employee current */}
              <div className="space-y-1">
                <Label className="text-xs">Bonus %</Label>
                <Input type="number" min="0" max="100" value={formBonus}
                  onChange={e => setFormBonus(parseFloat(e.target.value) || 0)}
                  className="h-8 text-sm" />
              </div>

              {/* Meal Voucher — auto-filled from employee current */}
              <div className="space-y-1">
                <Label className="text-xs">Meal Voucher (€/day)</Label>
                <Input type="number" min="0" step="0.5" value={formVoucher}
                  onChange={e => setFormVoucher(parseFloat(e.target.value) || 0)}
                  className="h-8 text-sm" />
              </div>

              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Note (optional)</Label>
                <Input value={formNote}
                  onChange={e => setFormNote(e.target.value)}
                  className="h-8 text-sm" placeholder="e.g. Promotion to S1, Annual review…" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={handleAdd}>Save Entry</Button>
            </div>
          </div>
        )}

        {/* History list */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading…</div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm italic">
            No salary history logged yet. Click "Log Salary Entry" to start tracking.
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map((entry, displayIdx) => {
              const ascIdx = entries.length - 1 - displayIdx;
              const isScheduled = entry.effective_date > TODAY;
              const isCurrent = displayIdx === 0 && !isScheduled;
              const nextEntry = entries[ascIdx + 1];
              const endDate = nextEntry ? nextEntry.effective_date : null;
              const prevEntry = entries[ascIdx - 1];

              // Ongoing entry always mirrors live employee record
              const displayGross = isCurrent ? employee.current_gross_fixed_year : entry.gross_fixed_year;
              const displayMonths = isCurrent ? employee.months_paid : (entry.months_paid ?? 12);
              const displayBonus = isCurrent ? employee.current_bonus_pct : entry.bonus_pct;
              const displayVoucher = isCurrent ? employee.meal_voucher_daily : entry.meal_voucher_daily;
              const displayRole = isCurrent ? employee.current_role_code : entry.role_code;
              const monthlyGross = displayGross / displayMonths;
              const ral = grossToRal(displayGross);

              const deltaGross = isCurrent ? employee.current_gross_fixed_year : entry.gross_fixed_year;
              const prevGrossForDelta = prevEntry ? prevEntry.gross_fixed_year : null;
              const delta = prevGrossForDelta !== null
                ? { d: deltaGross - prevGrossForDelta, pct: ((deltaGross - prevGrossForDelta) / prevGrossForDelta) * 100 }
                : null;

              const isEditing = editingId === entry.id;

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
                      {isEditing ? (
                        <div className="space-y-2">
                          <div className="text-[10px] uppercase text-muted-foreground font-bold">Start date</div>
                          <div className="flex items-center gap-2">
                            <Select value={String(editMonth)} onValueChange={v => setEditMonth(parseInt(v))}>
                              <SelectTrigger className="h-8 w-24 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {MONTHS.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Select value={String(editYear)} onValueChange={v => setEditYear(parseInt(v))}>
                              <SelectTrigger className="h-8 w-24 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {YEARS.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <button onClick={() => saveEdit(entry.id!)}
                              className="h-7 w-7 rounded bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={cancelEdit}
                              className="h-7 w-7 rounded border flex items-center justify-center hover:bg-muted text-muted-foreground">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            End: {endDate ? fmtDate(endDate) : <span className="text-primary font-semibold">ongoing</span>}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold">
                            {fmtDate(entry.effective_date)}{" → "}
                            {endDate
                              ? <span className="text-muted-foreground font-normal">{fmtDate(endDate)}</span>
                              : <span className="text-primary font-semibold">ongoing</span>}
                          </span>
                          {displayRole && (
                            <span className="bg-secondary px-2 py-0.5 rounded text-xs font-mono">{displayRole}</span>
                          )}
                          <button onClick={() => startEdit(entry)}
                            className="text-muted-foreground hover:text-foreground transition-colors">
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {!isEditing && entry.note && (
                        <div className="text-xs text-muted-foreground italic mt-0.5">{entry.note}</div>
                      )}
                    </div>
                    {!isEditing && (
                      <button onClick={() => handleDelete(entry.id!)}
                        className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
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
                      {delta.d > 0 ? <TrendingUp className="w-3 h-3" /> : delta.d < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                      {delta.d > 0 ? "+" : ""}{delta.d.toLocaleString()} €/yr vs previous
                      ({delta.d > 0 ? "+" : ""}{delta.pct.toFixed(1)}%)
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
