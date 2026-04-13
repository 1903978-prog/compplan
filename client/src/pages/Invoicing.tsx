import React, { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Receipt, Send, Search, AlertTriangle, CheckCircle, Clock, DollarSign, RefreshCw, EyeOff, Eye, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface HarvestInvoice {
  id: number;
  number: string;
  client: { id: number; name: string } | null;
  amount: number;
  due_amount: number;
  due_date: string | null;
  state: string;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
  currency: string;
  subject: string | null;
  notes: string | null;
  period_start: string | null;
  period_end: string | null;
}

type StatusFilter = "all" | "open" | "overdue" | "paid" | "partial" | "draft";
type SortColumn = "number" | "client" | "amount" | "due_amount" | "due_date" | "status" | "created_at";
type SortDir = "asc" | "desc";

// ── Helpers ────────────────────────────────────────────────────────────────────
function isOverdue(inv: HarvestInvoice): boolean {
  if (inv.state === "paid" || inv.state === "closed" || inv.state === "draft") return false;
  if (!inv.due_date) return false;
  return new Date(inv.due_date) < new Date();
}

function getDisplayStatus(inv: HarvestInvoice): { label: string; color: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (isOverdue(inv)) return { label: "Overdue", color: "text-red-600", variant: "destructive" };
  switch (inv.state) {
    case "paid": return { label: "Paid", color: "text-emerald-600", variant: "default" };
    case "partial": return { label: "Partial", color: "text-amber-600", variant: "secondary" };
    case "draft": return { label: "Draft", color: "text-muted-foreground", variant: "outline" };
    case "open": return { label: "Open", color: "text-blue-600", variant: "secondary" };
    case "closed": return { label: "Closed", color: "text-muted-foreground", variant: "outline" };
    default: return { label: inv.state, color: "text-muted-foreground", variant: "outline" };
  }
}

function fmtCurrency(amount: number, currency: string = "EUR"): string {
  const sym = currency === "USD" ? "$" : currency === "GBP" ? "\u00A3" : currency === "CHF" ? "CHF " : "\u20AC";
  return sym + Math.round(amount).toLocaleString("it-IT");
}

function fmtDate(d: string | null): string {
  if (!d) return "\u2014";
  const date = new Date(d);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const HIDDEN_KEY = "invoicing_hidden_ids";
function loadHidden(): Set<number> {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]")); } catch { return new Set(); }
}
function saveHidden(ids: Set<number>) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...ids]));
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Invoicing() {
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<HarvestInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sendingReminder, setSendingReminder] = useState<Set<number>>(new Set());
  const [sentReminders, setSentReminders] = useState<Set<number>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(loadHidden);
  const [showHidden, setShowHidden] = useState(false);
  const [sortCol, setSortCol] = useState<SortColumn>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleHide = (id: number) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      saveHidden(next);
      return next;
    });
  };

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir(col === "amount" || col === "due_amount" || col === "created_at" || col === "due_date" ? "desc" : "asc");
    }
  };

  const SortIcon = ({ col }: { col: SortColumn }) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  // Fetch all invoices
  const loadInvoices = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/harvest/invoices", { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setInvoices(data.invoices ?? []);
    } catch (err: any) {
      setError(err.message ?? "Failed to load invoices");
      toast({ title: "Failed to load invoices", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadInvoices(); }, []);

  // Send reminder
  const sendReminder = async (invoiceId: number) => {
    setSendingReminder(prev => new Set(prev).add(invoiceId));
    try {
      const res = await fetch(`/api/harvest/invoices/${invoiceId}/reminder`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error);
      }
      setSentReminders(prev => new Set(prev).add(invoiceId));
      toast({ title: "Reminder sent" });
    } catch (err: any) {
      toast({ title: "Failed to send reminder", description: err.message, variant: "destructive" });
    } finally {
      setSendingReminder(prev => { const n = new Set(prev); n.delete(invoiceId); return n; });
    }
  };

  // Visible invoices (excluding hidden)
  const visibleInvoices = useMemo(() =>
    showHidden ? invoices : invoices.filter(i => !hiddenIds.has(i.id)),
    [invoices, hiddenIds, showHidden]
  );

  // Filtered + sorted invoices
  const filtered = useMemo(() => {
    let list = visibleInvoices;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(inv =>
        (inv.client?.name ?? "").toLowerCase().includes(q) ||
        inv.number.toLowerCase().includes(q) ||
        (inv.subject ?? "").toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") {
      list = list.filter(inv => {
        if (statusFilter === "overdue") return isOverdue(inv);
        return inv.state === statusFilter;
      });
    }
    // Sort
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortCol) {
        case "number": return dir * a.number.localeCompare(b.number, undefined, { numeric: true });
        case "client": return dir * (a.client?.name ?? "").localeCompare(b.client?.name ?? "");
        case "amount": return dir * (a.amount - b.amount);
        case "due_amount": return dir * (a.due_amount - b.due_amount);
        case "due_date": {
          const ad = a.due_date ? new Date(a.due_date).getTime() : 0;
          const bd = b.due_date ? new Date(b.due_date).getTime() : 0;
          return dir * (ad - bd);
        }
        case "status": {
          const order: Record<string, number> = { overdue: 0, open: 1, partial: 2, draft: 3, paid: 4, closed: 5 };
          const as = isOverdue(a) ? "overdue" : a.state;
          const bs = isOverdue(b) ? "overdue" : b.state;
          return dir * ((order[as] ?? 9) - (order[bs] ?? 9));
        }
        case "created_at":
        default: {
          const ac = new Date(a.created_at).getTime();
          const bc = new Date(b.created_at).getTime();
          return dir * (ac - bc);
        }
      }
    });
  }, [visibleInvoices, searchQuery, statusFilter, sortCol, sortDir]);

  // Summary metrics — computed ONLY from non-hidden invoices
  const metrics = useMemo(() => {
    const visible = invoices.filter(i => !hiddenIds.has(i.id));
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const totalOutstanding = visible
      .filter(i => i.state === "open" || i.state === "partial" || isOverdue(i))
      .reduce((s, i) => s + i.due_amount, 0);
    const totalOverdue = visible
      .filter(i => isOverdue(i))
      .reduce((s, i) => s + i.due_amount, 0);
    const paidThisYear = visible
      .filter(i => (i.state === "paid" || i.state === "closed") && i.paid_at && new Date(i.paid_at) >= yearStart)
      .reduce((s, i) => s + i.amount, 0);
    const openCount = visible.filter(i => i.state === "open" || i.state === "partial" || isOverdue(i)).length;
    const overdueCount = visible.filter(i => isOverdue(i)).length;
    return { totalOutstanding, totalOverdue, paidThisYear, openCount, overdueCount };
  }, [invoices, hiddenIds]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoicing"
        description="Harvest invoice management \u2014 track payments, send reminders"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={showHidden ? "default" : "outline"}
              size="sm"
              onClick={() => setShowHidden(v => !v)}
              title={showHidden ? "Showing all (including hidden)" : `${hiddenIds.size} hidden invoices`}
            >
              {showHidden ? <Eye className="w-3.5 h-3.5 mr-1.5" /> : <EyeOff className="w-3.5 h-3.5 mr-1.5" />}
              {showHidden ? "Showing all" : hiddenIds.size > 0 ? `${hiddenIds.size} hidden` : "None hidden"}
            </Button>
            <Button variant="outline" size="sm" onClick={loadInvoices} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50"><DollarSign className="w-5 h-5 text-amber-600" /></div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-semibold">Outstanding</div>
                <div className="text-lg font-bold text-amber-600">{fmtCurrency(metrics.totalOutstanding)}</div>
                <div className="text-[10px] text-muted-foreground">{metrics.openCount} invoices</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-50"><AlertTriangle className="w-5 h-5 text-red-500" /></div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-semibold">Overdue</div>
                <div className="text-lg font-bold text-red-600">{fmtCurrency(metrics.totalOverdue)}</div>
                <div className="text-[10px] text-muted-foreground">{metrics.overdueCount} invoices</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50"><CheckCircle className="w-5 h-5 text-emerald-500" /></div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-semibold">Paid (YTD)</div>
                <div className="text-lg font-bold text-emerald-600">{fmtCurrency(metrics.paidThisYear)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50"><Clock className="w-5 h-5 text-blue-500" /></div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-semibold">Open Invoices</div>
                <div className="text-lg font-bold">{metrics.openCount}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by client or invoice #..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)} className="pl-9 h-9" />
        </div>
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-muted-foreground">
          {filtered.length} of {visibleInvoices.length} invoices
          {hiddenIds.size > 0 && !showHidden && <span className="ml-1 text-amber-600">({hiddenIds.size} hidden)</span>}
        </div>
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-4 text-sm text-red-700">
          <strong>Error:</strong> {error}
          <Button variant="outline" size="sm" className="ml-3" onClick={loadInvoices}>Retry</Button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Loading invoices from Harvest...
        </div>
      )}

      {/* Invoice table */}
      {!loading && !error && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-semibold cursor-pointer select-none" onClick={() => handleSort("number")}>
                    <span className="flex items-center">Invoice # <SortIcon col="number" /></span>
                  </TableHead>
                  <TableHead className="text-xs font-semibold cursor-pointer select-none" onClick={() => handleSort("client")}>
                    <span className="flex items-center">Client <SortIcon col="client" /></span>
                  </TableHead>
                  <TableHead className="text-xs font-semibold">Subject</TableHead>
                  <TableHead className="text-xs font-semibold text-right cursor-pointer select-none" onClick={() => handleSort("amount")}>
                    <span className="flex items-center justify-end">Amount <SortIcon col="amount" /></span>
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-right cursor-pointer select-none" onClick={() => handleSort("due_amount")}>
                    <span className="flex items-center justify-end">Due <SortIcon col="due_amount" /></span>
                  </TableHead>
                  <TableHead className="text-xs font-semibold cursor-pointer select-none" onClick={() => handleSort("due_date")}>
                    <span className="flex items-center">Due Date <SortIcon col="due_date" /></span>
                  </TableHead>
                  <TableHead className="text-xs font-semibold cursor-pointer select-none" onClick={() => handleSort("status")}>
                    <span className="flex items-center">Status <SortIcon col="status" /></span>
                  </TableHead>
                  <TableHead className="text-xs font-semibold text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      {invoices.length === 0 ? "No invoices found in Harvest" : "No invoices match your filters"}
                    </TableCell>
                  </TableRow>
                ) : filtered.map(inv => {
                  const status = getDisplayStatus(inv);
                  const overdue = isOverdue(inv);
                  const hidden = hiddenIds.has(inv.id);
                  const canRemind = (inv.state === "open" || inv.state === "partial" || overdue) && inv.state !== "draft";
                  const isSending = sendingReminder.has(inv.id);
                  const wasSent = sentReminders.has(inv.id);

                  return (
                    <TableRow key={inv.id} className={`${overdue && !hidden ? "bg-red-50/50" : ""} ${hidden ? "opacity-40" : ""}`}>
                      <TableCell className="font-mono text-sm font-semibold">{inv.number}</TableCell>
                      <TableCell className="text-sm">{inv.client?.name ?? "\u2014"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{inv.subject ?? "\u2014"}</TableCell>
                      <TableCell className="text-sm font-mono text-right font-semibold">{fmtCurrency(inv.amount, inv.currency)}</TableCell>
                      <TableCell className={`text-sm font-mono text-right font-bold ${overdue && !hidden ? "text-red-600" : inv.due_amount > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {inv.due_amount > 0 ? fmtCurrency(inv.due_amount, inv.currency) : "\u2014"}
                      </TableCell>
                      <TableCell className={`text-xs ${overdue && !hidden ? "text-red-600 font-semibold" : ""}`}>{fmtDate(inv.due_date)}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant} className="text-[10px]">{status.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          {canRemind && !hidden && (
                            wasSent ? (
                              <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" /> Sent
                              </span>
                            ) : (
                              <Button variant="ghost" size="sm" className="h-7 text-[11px]"
                                disabled={isSending} onClick={() => sendReminder(inv.id)}>
                                <Send className={`w-3 h-3 mr-1 ${isSending ? "animate-pulse" : ""}`} />
                                {isSending ? "..." : "Remind"}
                              </Button>
                            )
                          )}
                          <button
                            onClick={() => toggleHide(inv.id)}
                            className={`p-1 rounded hover:bg-muted transition-colors ${hidden ? "text-amber-500" : "text-muted-foreground/40 hover:text-muted-foreground"}`}
                            title={hidden ? "Unhide this invoice" : "Hide from metrics"}
                          >
                            {hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
