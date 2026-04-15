import React, { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Receipt, Send, Search, AlertTriangle, CheckCircle, Clock, DollarSign, RefreshCw, EyeOff, Eye, ArrowUpDown, ArrowUp, ArrowDown, X, Bell, Plus, CreditCard, Trophy, Pencil, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

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
  project_codes: string | null;
  project_names: string | null;
  project_codes_auto?: string | null;
  project_codes_manual?: string | null;
  client_default_code?: string | null;
  code_source?: "manual" | "auto" | "client_default" | "none";
  has_manual_override?: boolean;
}

interface WonProject {
  id: number;
  project_code: string;
  total_amount: number;
  currency: string;
  nb_of_invoices: number | null;
  invoicing_schedule_text: string | null;
  // These legacy fields still come back from the server but we don't render them.
  client_name?: string | null;
  client_code?: string | null;
  project_name?: string | null;
  won_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
}

interface InvoiceChange {
  id: number;
  invoice_id: number;
  invoice_number: string;
  client_name: string;
  amount: number;
  change_type: "new_invoice" | "paid" | "amount_changed" | "deleted" | "project_code_conflict";
  old_value: string | null;
  new_value: string | null;
  detected_at: string;
  approval_status: "pending" | "approved" | "rejected";
  dismissed: number;
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

// Return the invoice's most meaningful chronological date (falls back through
// sent_at → invoice created_at → due_date). Used both for display in the code
// picker and for the "nearest-code" suggestion heuristic.
function invoiceDate(inv: HarvestInvoice): string | null {
  return inv.sent_at ?? inv.created_at ?? inv.due_date ?? null;
}
function invoiceDateMs(inv: HarvestInvoice): number {
  const d = invoiceDate(inv);
  return d ? new Date(d).getTime() : 0;
}

// Given all invoices for a client, return a map: code -> { count, meanMs, firstMs, lastMs }
// Only "confirmed" codes (auto or manual, not falls-back) are used as anchors.
interface ClientCodeStats { code: string; count: number; meanMs: number; firstMs: number; lastMs: number; }
function buildClientCodeIndex(invoices: HarvestInvoice[]): Map<string, ClientCodeStats[]> {
  const byClient = new Map<string, HarvestInvoice[]>();
  for (const inv of invoices) {
    const name = inv.client?.name ?? "";
    if (!name) continue;
    const arr = byClient.get(name) ?? [];
    arr.push(inv);
    byClient.set(name, arr);
  }
  const result = new Map<string, ClientCodeStats[]>();
  for (const [client, list] of byClient) {
    const byCode = new Map<string, number[]>();  // code -> date ms list
    for (const inv of list) {
      // Prefer manual override, then auto — NOT client_default (that's a fallback, not a signal).
      const src = inv.project_codes_manual ?? inv.project_codes_auto ?? null;
      if (!src) continue;
      const dt = invoiceDateMs(inv);
      if (!dt) continue;
      for (const raw of src.split(",").map(s => s.trim()).filter(Boolean)) {
        const arr = byCode.get(raw) ?? [];
        arr.push(dt);
        byCode.set(raw, arr);
      }
    }
    const stats: ClientCodeStats[] = [];
    for (const [code, dates] of byCode) {
      dates.sort((a, b) => a - b);
      const mean = dates.reduce((s, v) => s + v, 0) / dates.length;
      stats.push({ code, count: dates.length, meanMs: mean, firstMs: dates[0], lastMs: dates[dates.length - 1] });
    }
    stats.sort((a, b) => a.code.localeCompare(b.code));
    result.set(client, stats);
  }
  return result;
}

// Derive the canonical 3-letter client prefix from the client name.
//   "KPS Capital Partners" → "KPS"
//   "FAST Logistics Group" → "FAS"
//   "Aspire Advisors AG"   → "ASP"
//   "Metra SpA"            → "MET"
// Strips accents + non-letters, uppercases, takes first 3 chars.
function clientNamePrefix(clientName: string | null | undefined): string {
  if (!clientName) return "";
  return String(clientName)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 3)
    .toUpperCase();
}

// Suggest the most likely code for an invoice. Priority order:
//   1. Existing confirmed manual/auto code (return as-is).
//   2. Closest-mean-date match among already-tagged codes for the client.
//   3. Fall back to {ClientPrefix}01 (e.g. "KPS01" for KPS Capital Partners)
//      — this covers the "brand-new client, no tagged invoices yet" case so
//      the user isn't left staring at a hardcoded "FAS01" placeholder.
//   4. Only return null if we can't even derive a client prefix.
function suggestCodeForInvoice(inv: HarvestInvoice, clientStats: ClientCodeStats[] | undefined): string | null {
  if (inv.project_codes_manual) return inv.project_codes_manual.split(",")[0].trim();
  if (inv.project_codes_auto) return inv.project_codes_auto.split(",")[0].trim();
  if (clientStats && clientStats.length > 0) {
    const dt = invoiceDateMs(inv);
    if (!dt) return clientStats[0].code;
    let best = clientStats[0];
    let bestDist = Math.abs(dt - best.meanMs);
    for (const s of clientStats.slice(1)) {
      const dist = Math.abs(dt - s.meanMs);
      if (dist < bestDist) { best = s; bestDist = dist; }
    }
    return best.code;
  }
  // No existing codes → synthesise {prefix}01 from the client name.
  const prefix = clientNamePrefix(inv.client?.name);
  if (prefix.length >= 2) return `${prefix}01`;
  return null;
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
  const [changes, setChanges] = useState<InvoiceChange[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [editingCodeFor, setEditingCodeFor] = useState<number | null>(null);
  const [editingCodeValue, setEditingCodeValue] = useState<string>("");
  const [editingApplyToClient, setEditingApplyToClient] = useState<boolean>(true);
  const [savingCodeFor, setSavingCodeFor] = useState<number | null>(null);

  // ── Won Projects (moved from Pricing → AR). Intentionally minimal: only
  // project_code, total_amount, nb_of_invoices, and the invoicing schedule
  // text the user pastes in. Everything else the legacy table requires
  // (client_name, client_code, project_name, won_date) is auto-derived on the
  // server from project_code, so the user never has to type it.
  interface WonProjectForm {
    project_code: string;
    total_amount: string; // keep as string so the input can be empty
    currency: string;
    nb_of_invoices: string;
    invoicing_schedule_text: string;
  }
  const emptyWonForm: WonProjectForm = {
    project_code: "",
    total_amount: "",
    currency: "EUR",
    nb_of_invoices: "",
    invoicing_schedule_text: "",
  };
  const [wonProjects, setWonProjects] = useState<WonProject[]>([]);
  const [wonForm, setWonForm] = useState<WonProjectForm>(emptyWonForm);
  const [editingWonId, setEditingWonId] = useState<number | null>(null);
  const [showWonForm, setShowWonForm] = useState(false);
  const [savingWon, setSavingWon] = useState(false);

  const loadWonProjects = async () => {
    try {
      const res = await fetch("/api/won-projects", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWonProjects(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.error("[Invoicing] won-projects load failed:", err);
    }
  };

  const openNewWon = () => {
    setEditingWonId(null);
    setWonForm(emptyWonForm);
    setShowWonForm(true);
  };

  const openEditWon = (w: WonProject) => {
    setEditingWonId(w.id);
    setWonForm({
      project_code: w.project_code ?? "",
      total_amount: String(w.total_amount ?? ""),
      currency: w.currency ?? "EUR",
      nb_of_invoices: w.nb_of_invoices == null ? "" : String(w.nb_of_invoices),
      invoicing_schedule_text: w.invoicing_schedule_text ?? "",
    });
    setShowWonForm(true);
  };

  const cancelWonForm = () => {
    setShowWonForm(false);
    setEditingWonId(null);
    setWonForm(emptyWonForm);
  };

  const saveWonProject = async () => {
    const code = wonForm.project_code.trim().toUpperCase();
    if (!code) {
      toast({ title: "Project code is required", variant: "destructive" });
      return;
    }
    const total = Number(wonForm.total_amount) || 0;
    const nbInv = wonForm.nb_of_invoices.trim() === "" ? null : Number(wonForm.nb_of_invoices);
    setSavingWon(true);
    try {
      const payload = {
        project_code: code,
        total_amount: total,
        currency: wonForm.currency || "EUR",
        nb_of_invoices: nbInv,
        invoicing_schedule_text: wonForm.invoicing_schedule_text.trim() || null,
      };
      const url = editingWonId ? `/api/won-projects/${editingWonId}` : "/api/won-projects";
      const method = editingWonId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = await res.json();
      setWonProjects(prev => editingWonId
        ? prev.map(w => w.id === editingWonId ? saved : w)
        : [saved, ...prev]);
      toast({ title: editingWonId ? "Won project updated" : "Won project saved" });
      cancelWonForm();
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    } finally {
      setSavingWon(false);
    }
  };

  const deleteWonProject = async (id: number) => {
    if (!window.confirm("Delete this won project?")) return;
    try {
      const res = await fetch(`/api/won-projects/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setWonProjects(prev => prev.filter(w => w.id !== id));
      toast({ title: "Deleted" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const saveProjectCodeOverride = async (invoiceId: number, value: string, applyToClient: boolean) => {
    setSavingCodeFor(invoiceId);
    try {
      const res = await fetch(`/api/harvest/invoices/${invoiceId}/project-codes`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_codes: value.trim() || null, apply_to_client: applyToClient }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // After saving, reload from server so the client-default fallback
      // populates every other blank invoice for the same client.
      setEditingCodeFor(null);
      if (applyToClient && value.trim()) {
        loadInvoices();
      } else {
        setInvoices(prev => prev.map(i => i.id === invoiceId
          ? { ...i, project_codes: value.trim() || i.project_codes_auto || null,
              project_codes_manual: value.trim() || null,
              has_manual_override: !!value.trim() }
          : i));
      }
    } catch (err: any) {
      console.error("Failed to save override:", err);
    } finally {
      setSavingCodeFor(null);
    }
  };

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

  // Load invoices from LOCAL DB (instant, no Harvest call).
  // This endpoint reads /api/harvest/invoices which is a pure SELECT from
  // the invoice_snapshots table — it does NOT contact Harvest.
  const loadInvoices = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/harvest/invoices", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInvoices(data.invoices ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadChanges = async () => {
    try {
      const res = await fetch("/api/harvest/changes", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setChanges(data.changes ?? []);
      }
    } catch { /* silent */ }
  };

  // Sync with Harvest — only when user clicks "Update from Harvest"
  const syncFromHarvest = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/harvest/sync", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.first_load) {
        toast({ title: `Initial sync: ${data.synced} invoices imported` });
      } else if (data.new_changes > 0) {
        toast({ title: `${data.new_changes} change(s) detected — review below`, variant: "destructive" });
      } else {
        toast({ title: "No changes found — everything is up to date" });
      }
      await loadInvoices();
      await loadChanges();
    } catch (err: any) {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  // Approve / reject a pending change. For project-code conflicts we force an
  // explicit confirm so the user can never lose a manual override by reflex.
  const handleChangeAction = async (changeId: number, action: "approve" | "reject") => {
    const ch = changes.find(c => c.id === changeId);
    if (ch?.change_type === "project_code_conflict" && action === "approve") {
      const ok = window.confirm(
        `Overwrite your manual project code?\n\n` +
        `Invoice #${ch.invoice_number} (${ch.client_name})\n` +
        `Your code: ${ch.old_value || "(none)"}\n` +
        `Harvest now says: ${ch.new_value || "(none)"}\n\n` +
        `Approving will REPLACE your manual code with Harvest's value.\n` +
        `Click Cancel to keep your own code.`
      );
      if (!ok) return;
    }
    setApprovingId(changeId);
    try {
      await fetch(`/api/harvest/changes/${changeId}/${action}`, { method: "POST", credentials: "include" });
      toast({ title: action === "approve" ? "Change approved" : "Change rejected" });
      await loadInvoices();
      await loadChanges();
    } catch {
      toast({ title: `Failed to ${action}`, variant: "destructive" });
    }
    setApprovingId(null);
  };

  const dismissChange = async (changeId: number) => {
    setChanges(prev => prev.filter(c => c.id !== changeId));
    await fetch(`/api/harvest/changes/${changeId}/dismiss`, { method: "POST", credentials: "include" }).catch(() => {});
  };

  // On mount: read the local DB only — NEVER auto-hit Harvest.
  // The only path that fetches from Harvest is the explicit "Update from
  // Harvest" button (syncFromHarvest), which stages changes as pending
  // notifications for the user to approve/reject.
  useEffect(() => {
    loadInvoices();
    loadChanges();
    loadWonProjects();
  }, []);

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

  // Per-client project-code statistics — recomputed whenever invoices change.
  // Used by the project-code picker dropdown to show all known codes for the
  // current client and the suggested one (nearest mean-date match).
  const clientCodeIndex = useMemo(() => buildClientCodeIndex(invoices), [invoices]);

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
              Reload
            </Button>
            <Button size="sm" onClick={syncFromHarvest} disabled={syncing}
              className="bg-primary text-primary-foreground hover:bg-primary/90">
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing..." : "Update from Harvest"}
            </Button>
          </div>
        }
      />

      {/* Pending changes requiring approval */}
      {(() => {
        const pending = changes.filter(c => c.approval_status === "pending");
        const recent = changes.filter(c => c.approval_status !== "pending" && !c.dismissed);
        const CHANGE_COLORS: Record<string, string> = {
          new_invoice: "bg-blue-50 border-blue-200 text-blue-800",
          paid: "bg-emerald-50 border-emerald-200 text-emerald-800",
          amount_changed: "bg-amber-50 border-amber-200 text-amber-800",
          deleted: "bg-red-50 border-red-200 text-red-800",
          project_code_conflict: "bg-fuchsia-50 border-fuchsia-300 text-fuchsia-900",
        };
        const CHANGE_LABELS: Record<string, string> = {
          new_invoice: "New Invoice", paid: "Marked Paid",
          amount_changed: "Amount Changed", deleted: "Deleted in Harvest",
          project_code_conflict: "Project Code Conflict",
        };
        const CHANGE_ICONS: Record<string, typeof Plus> = {
          new_invoice: Plus, paid: CreditCard, amount_changed: AlertTriangle, deleted: X,
          project_code_conflict: AlertTriangle,
        };

        return (
          <>
            {pending.length > 0 && (
              <Card className="border-amber-300 bg-amber-50/30">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Bell className="w-4 h-4 text-amber-600" />
                    <span className="text-sm font-bold uppercase tracking-wide text-amber-800">Pending Approval</span>
                    <Badge variant="destructive" className="text-[10px]">{pending.length}</Badge>
                    <span className="text-[10px] text-muted-foreground ml-auto">Click "Update from Harvest" to check for new changes</span>
                  </div>
                  <div className="space-y-2">
                    {pending.map(c => {
                      const Icon = CHANGE_ICONS[c.change_type] ?? Bell;
                      const isProcessing = approvingId === c.id;
                      const isConflict = c.change_type === "project_code_conflict";
                      return (
                        <div key={c.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${CHANGE_COLORS[c.change_type] ?? "bg-muted/30 border-border"}`}>
                          <Icon className="w-4 h-4 shrink-0" />
                          <Badge variant="outline" className="text-[9px] shrink-0">{CHANGE_LABELS[c.change_type] ?? c.change_type}</Badge>
                          <span className="text-xs font-semibold">#{c.invoice_number}</span>
                          <span className="text-xs">{c.client_name}</span>
                          {!isConflict && (
                            <span className="text-xs font-mono font-bold">{fmtCurrency(c.amount)}</span>
                          )}
                          {isConflict ? (
                            <span className="text-[11px] font-mono">
                              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300">
                                yours: {c.old_value || "(none)"}
                              </span>
                              <span className="mx-1 text-muted-foreground">vs</span>
                              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                                harvest: {c.new_value || "(none)"}
                              </span>
                            </span>
                          ) : (c.old_value && c.new_value && (
                            <span className="text-[10px] text-muted-foreground">{c.old_value} → {c.new_value}</span>
                          ))}
                          <span className="text-[9px] text-muted-foreground">{fmtDate(c.detected_at)}</span>
                          <div className="flex items-center gap-1 ml-auto shrink-0">
                            <Button size="sm" className="h-6 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white"
                              disabled={isProcessing} onClick={() => handleChangeAction(c.id, "approve")}>
                              {isProcessing ? "..." : (isConflict ? "Use Harvest" : "Approve")}
                            </Button>
                            <Button size="sm" variant="outline" className="h-6 text-[10px]"
                              disabled={isProcessing} onClick={() => handleChangeAction(c.id, "reject")}>
                              {isConflict ? "Keep mine" : "Reject"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recently processed changes (approved/rejected, last 30 days, not dismissed) */}
            {recent.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {recent.slice(0, 10).map(c => {
                  const Icon = CHANGE_ICONS[c.change_type] ?? Bell;
                  return (
                    <div key={c.id} className="flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] bg-muted/20 text-muted-foreground">
                      <Icon className="w-3 h-3" />
                      <span>#{c.invoice_number}</span>
                      <span>{c.client_name}</span>
                      <Badge variant={c.approval_status === "approved" ? "default" : "secondary"} className="text-[8px] px-1">
                        {c.approval_status}
                      </Badge>
                      <button onClick={() => dismissChange(c.id)} className="p-0.5 hover:bg-black/10 rounded" title="Dismiss">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

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
          <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Loading invoices from local database...
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
                  <TableHead className="text-xs font-semibold">Project</TableHead>
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
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
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
                      <TableCell className="text-xs font-mono font-semibold text-primary">
                        {editingCodeFor === inv.id ? (
                          (() => {
                            const clientStats = clientCodeIndex.get(inv.client?.name ?? "") ?? [];
                            const suggested = suggestCodeForInvoice(inv, clientStats);
                            const invDate = invoiceDate(inv);
                            return (
                              <div className="flex flex-col gap-1 min-w-[220px]">
                                {/* Context: invoice date — critical for picking the right sequential code */}
                                <div className="text-[9px] text-muted-foreground leading-tight">
                                  <span className="font-semibold">Invoice date:</span> {fmtDate(invDate)}
                                  {suggested && (
                                    <span className="ml-1.5 text-blue-600">
                                      · Suggested: <span className="font-mono font-bold">{suggested}</span>
                                    </span>
                                  )}
                                </div>
                                {/* Known codes as clickable chips (sorted MET01..MET04) */}
                                {clientStats.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {clientStats.map(s => {
                                      const isActive = editingCodeValue === s.code;
                                      const isSuggested = s.code === suggested;
                                      return (
                                        <button
                                          key={s.code}
                                          type="button"
                                          onClick={() => setEditingCodeValue(s.code)}
                                          className={`font-mono text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                                            isActive
                                              ? "bg-primary text-primary-foreground border-primary"
                                              : isSuggested
                                                ? "bg-blue-50 text-blue-700 border-blue-400 hover:bg-blue-100"
                                                : "bg-muted/40 text-foreground border-muted hover:bg-muted"
                                          }`}
                                          title={`${s.count} invoice${s.count > 1 ? "s" : ""} tagged · ${fmtDate(new Date(s.firstMs).toISOString())} → ${fmtDate(new Date(s.lastMs).toISOString())}`}
                                        >
                                          {s.code}
                                          <span className="ml-1 opacity-60">({s.count})</span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                                {/* Free-form input for new codes. Save falls back to the
                                    suggested code if the user leaves the input blank — so
                                    clicking Save immediately on a fresh pick "just works". */}
                                <div className="flex items-center gap-1">
                                  <Input
                                    value={editingCodeValue}
                                    onChange={e => setEditingCodeValue(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === "Enter") saveProjectCodeOverride(inv.id, (editingCodeValue.trim() || suggested || ""), editingApplyToClient);
                                      if (e.key === "Escape") setEditingCodeFor(null);
                                    }}
                                    placeholder={suggested ?? "MET01"}
                                    className="h-6 text-[11px] font-mono w-24 px-1.5"
                                    autoFocus
                                    disabled={savingCodeFor === inv.id}
                                  />
                                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
                                    onClick={() => saveProjectCodeOverride(inv.id, (editingCodeValue.trim() || suggested || ""), editingApplyToClient)}
                                    disabled={savingCodeFor === inv.id}>
                                    {savingCodeFor === inv.id ? "..." : "Save"}
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
                                    onClick={() => setEditingCodeFor(null)}>
                                    Cancel
                                  </Button>
                                </div>
                                <label className="flex items-center gap-1 text-[9px] text-muted-foreground cursor-pointer whitespace-nowrap">
                                  <input type="checkbox" checked={editingApplyToClient}
                                    onChange={e => setEditingApplyToClient(e.target.checked)}
                                    className="h-3 w-3" />
                                  Apply to all {inv.client?.name?.split(" ")[0] ?? "client"} invoices as default
                                </label>
                              </div>
                            );
                          })()
                        ) : (
                          <button
                            onClick={() => {
                              setEditingCodeFor(inv.id);
                              // Pre-populate: prefer manual > existing code > suggested code based on date.
                              const existing = inv.project_codes_manual ?? inv.project_codes ?? "";
                              if (existing) {
                                setEditingCodeValue(existing);
                              } else {
                                const clientStats = clientCodeIndex.get(inv.client?.name ?? "") ?? [];
                                const suggested = suggestCodeForInvoice(inv, clientStats);
                                setEditingCodeValue(suggested ?? "");
                              }
                              setEditingApplyToClient(false);  // default OFF — user must opt in to "apply to all"
                            }}
                            className="flex items-center gap-1 hover:bg-muted/50 rounded px-1 -mx-1 group min-h-[24px]"
                            title={
                              inv.code_source === "manual" ? "Manual override (click to edit)" :
                              inv.code_source === "client_default" ? "From client default (click to edit)" :
                              inv.code_source === "auto" ? "Auto-extracted from Harvest (click to override)" :
                              "Click to set"
                            }
                          >
                            {inv.project_codes ? inv.project_codes.split(",").map((c, i) => (
                              <Badge key={i}
                                variant={inv.code_source === "manual" ? "default" : "secondary"}
                                className={`text-[9px] mr-0.5 font-mono ${inv.code_source === "client_default" ? "border-dashed" : ""}`}>
                                {c}
                              </Badge>
                            )) : <span className="text-muted-foreground italic">—</span>}
                            {inv.code_source === "manual" && <span className="text-[8px] text-blue-600">●</span>}
                            {inv.code_source === "client_default" && <span className="text-[8px] text-amber-600">◇</span>}
                            <span className="text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100 ml-1">edit</span>
                          </button>
                        )}
                      </TableCell>
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

      {/* ── WON PROJECTS (moved from Pricing tool, Task 11) ─────────────────── */}
      {/* Minimal model: project code + total + number of invoices + free-form
          schedule text the user pastes from an email. Everything else is
          auto-derived server-side. This is the AR side of the cashflow loop. */}
      <Card className="mt-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              <h3 className="text-lg font-semibold">Won Projects</h3>
              <Badge variant="secondary" className="text-[11px]">{wonProjects.length}</Badge>
            </div>
            {!showWonForm && (
              <Button size="sm" onClick={openNewWon} data-testid="button-new-won-project">
                <Plus className="w-4 h-4 mr-1" /> Add won project
              </Button>
            )}
          </div>

          {showWonForm && (
            <div className="border border-border rounded-md p-4 mb-4 bg-muted/30">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1">
                    Project code <span className="text-destructive">*</span>
                  </label>
                  <Input
                    value={wonForm.project_code}
                    onChange={e => setWonForm(f => ({ ...f, project_code: e.target.value.toUpperCase() }))}
                    placeholder="e.g. MET04"
                    data-testid="input-won-project-code"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1">
                    Total amount
                  </label>
                  <div className="flex gap-1">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={wonForm.total_amount}
                      onChange={e => setWonForm(f => ({ ...f, total_amount: e.target.value }))}
                      placeholder="0"
                      data-testid="input-won-total"
                    />
                    <Select
                      value={wonForm.currency}
                      onValueChange={v => setWonForm(f => ({ ...f, currency: v }))}
                    >
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1">
                    Number of invoices
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={wonForm.nb_of_invoices}
                    onChange={e => setWonForm(f => ({ ...f, nb_of_invoices: e.target.value }))}
                    placeholder="e.g. 3"
                    data-testid="input-won-nb-invoices"
                  />
                </div>
              </div>
              <div className="mb-3">
                <label className="text-xs font-semibold text-muted-foreground block mb-1">
                  Invoicing schedule (paste window / notes)
                </label>
                <Textarea
                  rows={4}
                  value={wonForm.invoicing_schedule_text}
                  onChange={e => setWonForm(f => ({ ...f, invoicing_schedule_text: e.target.value }))}
                  placeholder={"e.g.\n30% on kickoff (2026-04-20)\n40% on midterm\n30% on final delivery"}
                  data-testid="textarea-won-schedule"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={cancelWonForm} disabled={savingWon}>
                  Cancel
                </Button>
                <Button size="sm" onClick={saveWonProject} disabled={savingWon} data-testid="button-save-won">
                  {savingWon ? "Saving..." : editingWonId ? "Update" : "Save"}
                </Button>
              </div>
            </div>
          )}

          {wonProjects.length === 0 && !showWonForm ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No won projects yet. Click "Add won project" to track one.
            </div>
          ) : (
            <div className="space-y-2">
              {wonProjects.map(w => {
                const totalFmt = fmtCurrency(w.total_amount, w.currency || "EUR");
                return (
                  <div
                    key={w.id}
                    className="border border-border rounded-md p-3 hover-elevate"
                    data-testid={`row-won-${w.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <Badge className="font-mono text-xs">{w.project_code || "—"}</Badge>
                          <span className="text-sm font-semibold">{totalFmt}</span>
                          <span className="text-xs text-muted-foreground">
                            {w.nb_of_invoices != null
                              ? `${w.nb_of_invoices} invoice${w.nb_of_invoices === 1 ? "" : "s"}`
                              : "— invoices"}
                          </span>
                        </div>
                        {w.invoicing_schedule_text && (
                          <pre className="mt-2 text-xs whitespace-pre-wrap font-sans text-muted-foreground bg-muted/40 rounded px-2 py-1.5">
                            {w.invoicing_schedule_text}
                          </pre>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditWon(w)}
                          data-testid={`button-edit-won-${w.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => deleteWonProject(w.id)}
                          data-testid={`button-delete-won-${w.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
