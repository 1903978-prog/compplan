import React, { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Receipt, Send, Search, AlertTriangle, CheckCircle, Clock, DollarSign, RefreshCw } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface HarvestInvoice {
  id: number;
  number: string;
  client: { id: number; name: string } | null;
  amount: number;
  due_amount: number;
  due_date: string | null;
  state: string; // open, draft, paid, partial, closed
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
        method: "POST",
        credentials: "include",
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

  // Filtered invoices
  const filtered = useMemo(() => {
    let list = invoices;
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(inv =>
        (inv.client?.name ?? "").toLowerCase().includes(q) ||
        inv.number.toLowerCase().includes(q) ||
        (inv.subject ?? "").toLowerCase().includes(q)
      );
    }
    // Status filter
    if (statusFilter !== "all") {
      list = list.filter(inv => {
        if (statusFilter === "overdue") return isOverdue(inv);
        return inv.state === statusFilter;
      });
    }
    // Sort: overdue first, then open, then by due date
    return list.sort((a, b) => {
      const aOver = isOverdue(a) ? 0 : 1;
      const bOver = isOverdue(b) ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      const aDate = a.due_date ? new Date(a.due_date).getTime() : 0;
      const bDate = b.due_date ? new Date(b.due_date).getTime() : 0;
      return aDate - bDate;
    });
  }, [invoices, searchQuery, statusFilter]);

  // Summary metrics
  const metrics = useMemo(() => {
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const totalOutstanding = invoices
      .filter(i => i.state === "open" || i.state === "partial" || isOverdue(i))
      .reduce((s, i) => s + i.due_amount, 0);
    const totalOverdue = invoices
      .filter(i => isOverdue(i))
      .reduce((s, i) => s + i.due_amount, 0);
    const paidThisYear = invoices
      .filter(i => (i.state === "paid" || i.state === "closed") && i.paid_at && new Date(i.paid_at) >= yearStart)
      .reduce((s, i) => s + i.amount, 0);
    const openCount = invoices.filter(i => i.state === "open" || i.state === "partial" || isOverdue(i)).length;
    const overdueCount = invoices.filter(i => isOverdue(i)).length;
    return { totalOutstanding, totalOverdue, paidThisYear, openCount, overdueCount };
  }, [invoices]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoicing"
        description="Harvest invoice management \u2014 track payments, send reminders"
        actions={
          <Button variant="outline" size="sm" onClick={loadInvoices} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50">
                <DollarSign className="w-5 h-5 text-amber-600" />
              </div>
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
              <div className="p-2 rounded-lg bg-red-50">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
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
              <div className="p-2 rounded-lg bg-emerald-50">
                <CheckCircle className="w-5 h-5 text-emerald-500" />
              </div>
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
              <div className="p-2 rounded-lg bg-blue-50">
                <Clock className="w-5 h-5 text-blue-500" />
              </div>
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
          <Input
            placeholder="Search by client or invoice #..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-40 h-9">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
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
          {filtered.length} of {invoices.length} invoices
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
                  <TableHead className="text-xs font-semibold">Invoice #</TableHead>
                  <TableHead className="text-xs font-semibold">Client</TableHead>
                  <TableHead className="text-xs font-semibold">Subject</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Amount</TableHead>
                  <TableHead className="text-xs font-semibold text-right">Due</TableHead>
                  <TableHead className="text-xs font-semibold">Due Date</TableHead>
                  <TableHead className="text-xs font-semibold">Status</TableHead>
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
                  const canRemind = (inv.state === "open" || inv.state === "partial" || overdue) && inv.state !== "draft";
                  const isSending = sendingReminder.has(inv.id);
                  const wasSent = sentReminders.has(inv.id);

                  return (
                    <TableRow key={inv.id} className={overdue ? "bg-red-50/50" : ""}>
                      <TableCell className="font-mono text-sm font-semibold">{inv.number}</TableCell>
                      <TableCell className="text-sm">{inv.client?.name ?? "\u2014"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{inv.subject ?? "\u2014"}</TableCell>
                      <TableCell className="text-sm font-mono text-right font-semibold">{fmtCurrency(inv.amount, inv.currency)}</TableCell>
                      <TableCell className={`text-sm font-mono text-right font-bold ${overdue ? "text-red-600" : inv.due_amount > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {inv.due_amount > 0 ? fmtCurrency(inv.due_amount, inv.currency) : "\u2014"}
                      </TableCell>
                      <TableCell className={`text-xs ${overdue ? "text-red-600 font-semibold" : ""}`}>{fmtDate(inv.due_date)}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant} className="text-[10px]">{status.label}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {canRemind && (
                          wasSent ? (
                            <span className="text-[10px] text-emerald-600 font-semibold flex items-center justify-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Sent
                            </span>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-[11px]"
                              disabled={isSending}
                              onClick={() => sendReminder(inv.id)}
                            >
                              <Send className={`w-3 h-3 mr-1 ${isSending ? "animate-pulse" : ""}`} />
                              {isSending ? "Sending..." : "Remind"}
                            </Button>
                          )
                        )}
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
