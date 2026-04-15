import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Users, Search, RefreshCw, ChevronDown, ChevronRight, DollarSign, CheckCircle, AlertTriangle } from "lucide-react";

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

interface ProjectGroup {
  code: string;         // e.g. "COE02" from Harvest, or "General"
  name: string;         // Harvest project name, e.g. "Cohesia SPA - Phase 2"
  invoices: HarvestInvoice[];
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
}

interface ClientSummary {
  clientId: number;
  clientName: string;
  currency: string;
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
  invoiceCount: number;
  projects: ProjectGroup[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtCurrency(amount: number, currency: string = "EUR"): string {
  const sym = currency === "USD" ? "$" : currency === "GBP" ? "\u00A3" : currency === "CHF" ? "CHF " : "\u20AC";
  return sym + Math.round(amount).toLocaleString("it-IT");
}

function fmtDate(d: string | null): string {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Extract project codes from Harvest line_items data (stored as comma-separated string)
// Falls back to regex on subject/number if no Harvest project codes available
function extractProjectCodes(inv: HarvestInvoice): string[] {
  // Use real Harvest project codes if available
  if (inv.project_codes) {
    return inv.project_codes.split(",").map(c => c.trim()).filter(Boolean);
  }
  // Fallback: try to extract from subject/number
  const text = `${inv.subject ?? ""} ${inv.number ?? ""}`;
  const match = text.match(/\b([A-Z]{2,5})\s*[-]?\s*(0[1-9]|[1-9]\d?)\b/i);
  if (match) {
    return [`${match[1].toUpperCase()}${match[2].padStart(2, "0")}`];
  }
  return ["General"];
}

function getPaidAmount(inv: HarvestInvoice): number {
  if (inv.state === "paid" || inv.state === "closed") return inv.amount;
  // Partial: paid = total - remaining due
  if (inv.due_amount < inv.amount) return inv.amount - inv.due_amount;
  return 0;
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ClientLedger() {
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<HarvestInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedClient, setExpandedClient] = useState<number | null>(null);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [editingCodeFor, setEditingCodeFor] = useState<number | null>(null);
  const [editingCodeValue, setEditingCodeValue] = useState<string>("");
  const [editingApplyToClient, setEditingApplyToClient] = useState<boolean>(true);
  const [savingCodeFor, setSavingCodeFor] = useState<number | null>(null);

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
      setEditingCodeFor(null);
      toast({ title: "Project code saved", description: applyToClient && value.trim() ? `${value.trim()} applied to all blank invoices for this client` : (value.trim() || "(cleared)") });
      // If we set a client default, reload so the fallback fills every blank.
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
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    } finally {
      setSavingCodeFor(null);
    }
  };

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

  // Build client summaries
  const clients = useMemo(() => {
    const map = new Map<number, HarvestInvoice[]>();
    for (const inv of invoices) {
      if (!inv.client) continue;
      const cid = inv.client.id;
      if (!map.has(cid)) map.set(cid, []);
      map.get(cid)!.push(inv);
    }

    const summaries: ClientSummary[] = [];
    for (const [clientId, clientInvs] of map) {
      const clientName = clientInvs[0].client?.name ?? "Unknown";
      const currency = clientInvs[0].currency ?? "EUR";
      const totalInvoiced = clientInvs.reduce((s, i) => s + i.amount, 0);
      const totalPaid = clientInvs.reduce((s, i) => s + getPaidAmount(i), 0);
      const totalOutstanding = totalInvoiced - totalPaid;

      // Group by project code (an invoice can belong to multiple projects)
      const projectMap = new Map<string, HarvestInvoice[]>();
      for (const inv of clientInvs) {
        const codes = extractProjectCodes(inv);
        for (const code of codes) {
          if (!projectMap.has(code)) projectMap.set(code, []);
          projectMap.get(code)!.push(inv);
        }
      }

      const projects: ProjectGroup[] = [...projectMap.entries()]
        .map(([code, pinvs]) => {
          // Find the Harvest project name for this code
          let projectName = code;
          for (const inv of pinvs) {
            if (inv.project_codes && inv.project_names) {
              const codes = inv.project_codes.split(",");
              const names = inv.project_names.split(",");
              const idx = codes.indexOf(code);
              if (idx >= 0 && names[idx]) { projectName = names[idx]; break; }
            }
          }
          return {
            code,
            name: projectName,
            invoices: pinvs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
            totalInvoiced: pinvs.reduce((s, i) => s + i.amount, 0),
            totalPaid: pinvs.reduce((s, i) => s + getPaidAmount(i), 0),
            totalOutstanding: pinvs.reduce((s, i) => s + i.amount, 0) - pinvs.reduce((s, i) => s + getPaidAmount(i), 0),
          };
        })
        .sort((a, b) => a.code.localeCompare(b.code));

      summaries.push({ clientId, clientName, currency, totalInvoiced, totalPaid, totalOutstanding, invoiceCount: clientInvs.length, projects });
    }

    // Sort by total invoiced descending
    return summaries.sort((a, b) => b.totalInvoiced - a.totalInvoiced);
  }, [invoices]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return clients;
    const q = searchQuery.toLowerCase();
    return clients.filter(c =>
      c.clientName.toLowerCase().includes(q) ||
      c.projects.some(p => p.code.toLowerCase().includes(q))
    );
  }, [clients, searchQuery]);

  // Totals
  const grandInvoiced = filtered.reduce((s, c) => s + c.totalInvoiced, 0);
  const grandPaid = filtered.reduce((s, c) => s + c.totalPaid, 0);
  const grandOutstanding = grandInvoiced - grandPaid;
  const collectionRate = grandInvoiced > 0 ? Math.round((grandPaid / grandInvoiced) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Ledger"
        description="Revenue by client and project \u2014 invoiced vs. received"
        actions={
          <Button variant="outline" size="sm" onClick={loadInvoices} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50"><DollarSign className="w-5 h-5 text-blue-600" /></div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-semibold">Total Invoiced</div>
                <div className="text-lg font-bold">{fmtCurrency(grandInvoiced)}</div>
                <div className="text-[10px] text-muted-foreground">{filtered.length} clients</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50"><CheckCircle className="w-5 h-5 text-emerald-500" /></div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-semibold">Total Received</div>
                <div className="text-lg font-bold text-emerald-600">{fmtCurrency(grandPaid)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50"><AlertTriangle className="w-5 h-5 text-amber-500" /></div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-semibold">Outstanding</div>
                <div className="text-lg font-bold text-amber-600">{fmtCurrency(grandOutstanding)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Users className="w-5 h-5 text-primary" /></div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase font-semibold">Collection Rate</div>
                <div className={`text-lg font-bold ${collectionRate >= 80 ? "text-emerald-600" : collectionRate >= 50 ? "text-amber-600" : "text-red-600"}`}>{collectionRate}%</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search client or project code..." value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)} className="pl-9 h-9" />
        </div>
        <div className="text-xs text-muted-foreground">{filtered.length} clients</div>
      </div>

      {/* Error / Loading */}
      {error && !loading && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-4 text-sm text-red-700">
          <strong>Error:</strong> {error}
          <Button variant="outline" size="sm" className="ml-3" onClick={loadInvoices}>Retry</Button>
        </div>
      )}
      {loading && (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Loading from Harvest...
        </div>
      )}

      {/* Client list */}
      {!loading && !error && (
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">No clients found</div>
          ) : filtered.map(client => {
            const isExpanded = expandedClient === client.clientId;
            const paidPct = client.totalInvoiced > 0 ? Math.round((client.totalPaid / client.totalInvoiced) * 100) : 0;

            return (
              <Card key={client.clientId} className="overflow-hidden">
                {/* Client header row */}
                <button
                  onClick={() => setExpandedClient(isExpanded ? null : client.clientId)}
                  className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                >
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{client.clientName}</span>
                      <Badge variant="secondary" className="text-[9px]">{client.invoiceCount} inv</Badge>
                      {client.projects.length > 1 && (
                        <Badge variant="outline" className="text-[9px]">{client.projects.filter(p => p.code !== "General").length} projects</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-6 shrink-0 text-right">
                    <div>
                      <div className="text-[9px] text-muted-foreground uppercase">Invoiced</div>
                      <div className="text-sm font-mono font-bold">{fmtCurrency(client.totalInvoiced, client.currency)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-muted-foreground uppercase">Received</div>
                      <div className="text-sm font-mono font-bold text-emerald-600">{fmtCurrency(client.totalPaid, client.currency)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-muted-foreground uppercase">Outstanding</div>
                      <div className={`text-sm font-mono font-bold ${client.totalOutstanding > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {client.totalOutstanding > 0 ? fmtCurrency(client.totalOutstanding, client.currency) : "\u2014"}
                      </div>
                    </div>
                    <div className="w-16">
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${paidPct}%` }} />
                      </div>
                      <div className="text-[9px] text-muted-foreground text-center mt-0.5">{paidPct}%</div>
                    </div>
                  </div>
                </button>

                {/* Expanded: project breakdown */}
                {isExpanded && (
                  <div className="border-t bg-muted/10 px-4 py-3 space-y-3">
                    {client.projects.map(project => {
                      const projKey = `${client.clientId}-${project.code}`;
                      const projExpanded = expandedProject === projKey;
                      const projPaidPct = project.totalInvoiced > 0 ? Math.round((project.totalPaid / project.totalInvoiced) * 100) : 0;

                      return (
                        <div key={project.code} className="border rounded-lg bg-background overflow-hidden">
                          {/* Project header */}
                          <button
                            onClick={() => setExpandedProject(projExpanded ? null : projKey)}
                            className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
                          >
                            {projExpanded
                              ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                              : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                            }
                            <Badge variant={project.code === "General" ? "outline" : "secondary"} className="text-xs font-mono">
                              {project.code}
                            </Badge>
                            {project.name !== project.code && (
                              <span className="text-xs text-muted-foreground truncate max-w-[250px]">{project.name}</span>
                            )}
                            <span className="text-xs text-muted-foreground">{project.invoices.length} invoice{project.invoices.length !== 1 ? "s" : ""}</span>
                            <div className="flex-1" />
                            <span className="text-xs font-mono font-semibold">{fmtCurrency(project.totalInvoiced, client.currency)}</span>
                            <span className="text-xs font-mono text-emerald-600">{fmtCurrency(project.totalPaid, client.currency)}</span>
                            {project.totalOutstanding > 0 && (
                              <span className="text-xs font-mono text-amber-600">{fmtCurrency(project.totalOutstanding, client.currency)} due</span>
                            )}
                            <div className="w-12">
                              <div className="h-1 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${projPaidPct}%` }} />
                              </div>
                            </div>
                          </button>

                          {/* Project invoice detail */}
                          {projExpanded && (
                            <div className="border-t">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-muted/20">
                                    <TableHead className="text-[10px] py-1.5">Invoice #</TableHead>
                                    <TableHead className="text-[10px] py-1.5">Project Code</TableHead>
                                    <TableHead className="text-[10px] py-1.5">Subject</TableHead>
                                    <TableHead className="text-[10px] py-1.5">Date</TableHead>
                                    <TableHead className="text-[10px] py-1.5 text-right">Invoiced</TableHead>
                                    <TableHead className="text-[10px] py-1.5 text-right">Received</TableHead>
                                    <TableHead className="text-[10px] py-1.5 text-right">Due</TableHead>
                                    <TableHead className="text-[10px] py-1.5">Status</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {project.invoices.map(inv => {
                                    const paid = getPaidAmount(inv);
                                    const isOverdue = inv.state !== "paid" && inv.state !== "closed" && inv.state !== "draft"
                                      && inv.due_date && new Date(inv.due_date) < new Date();
                                    return (
                                      <TableRow key={inv.id} className={isOverdue ? "bg-red-50/50" : ""}>
                                        <TableCell className="text-xs font-mono font-semibold">{inv.number}</TableCell>
                                        <TableCell className="text-[11px]">
                                          {editingCodeFor === inv.id ? (
                                            <div className="flex flex-col gap-1">
                                              <div className="flex items-center gap-1">
                                                <Input
                                                  value={editingCodeValue}
                                                  onChange={e => setEditingCodeValue(e.target.value)}
                                                  onKeyDown={e => {
                                                    if (e.key === "Enter") saveProjectCodeOverride(inv.id, editingCodeValue, editingApplyToClient);
                                                    if (e.key === "Escape") setEditingCodeFor(null);
                                                  }}
                                                  placeholder="FAS01"
                                                  className="h-6 text-[11px] font-mono w-24 px-1.5"
                                                  autoFocus
                                                  disabled={savingCodeFor === inv.id}
                                                />
                                                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
                                                  onClick={() => saveProjectCodeOverride(inv.id, editingCodeValue, editingApplyToClient)}
                                                  disabled={savingCodeFor === inv.id}>
                                                  {savingCodeFor === inv.id ? "..." : "Save"}
                                                </Button>
                                              </div>
                                              <label className="flex items-center gap-1 text-[9px] text-muted-foreground cursor-pointer whitespace-nowrap">
                                                <input type="checkbox" checked={editingApplyToClient}
                                                  onChange={e => setEditingApplyToClient(e.target.checked)}
                                                  className="h-3 w-3" />
                                                Apply to all {client.clientName.split(" ")[0]} invoices
                                              </label>
                                            </div>
                                          ) : (
                                            <button
                                              onClick={() => {
                                                setEditingCodeFor(inv.id);
                                                setEditingCodeValue(inv.project_codes_manual ?? inv.project_codes ?? "");
                                                setEditingApplyToClient(true);
                                              }}
                                              className="flex items-center gap-1 hover:bg-muted/50 rounded px-1.5 py-0.5 -mx-1.5 group"
                                              title={
                                                inv.code_source === "manual" ? "Manual override (click to edit)" :
                                                inv.code_source === "client_default" ? "From client default (click to edit)" :
                                                inv.code_source === "auto" ? "Auto-extracted from Harvest (click to override)" :
                                                "Click to set"
                                              }
                                            >
                                              {inv.project_codes ? (
                                                <span className={`font-mono font-semibold ${
                                                  inv.code_source === "manual" ? "text-blue-600" :
                                                  inv.code_source === "client_default" ? "text-amber-600" : ""
                                                }`}>
                                                  {inv.project_codes}
                                                </span>
                                              ) : (
                                                <span className="text-muted-foreground italic">—</span>
                                              )}
                                              {inv.code_source === "manual" && <span className="text-[8px] text-blue-600">●</span>}
                                              {inv.code_source === "client_default" && <span className="text-[8px] text-amber-600">◇</span>}
                                              <span className="text-[9px] text-muted-foreground opacity-0 group-hover:opacity-100">edit</span>
                                            </button>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-[11px] text-muted-foreground max-w-[200px] truncate">{inv.subject ?? "\u2014"}</TableCell>
                                        <TableCell className="text-[11px]">{fmtDate(inv.created_at)}</TableCell>
                                        <TableCell className="text-xs font-mono text-right font-semibold">{fmtCurrency(inv.amount, inv.currency)}</TableCell>
                                        <TableCell className="text-xs font-mono text-right text-emerald-600">{paid > 0 ? fmtCurrency(paid, inv.currency) : "\u2014"}</TableCell>
                                        <TableCell className={`text-xs font-mono text-right ${isOverdue ? "text-red-600 font-bold" : inv.due_amount > 0 ? "text-amber-600" : ""}`}>
                                          {inv.due_amount > 0 ? fmtCurrency(inv.due_amount, inv.currency) : "\u2014"}
                                        </TableCell>
                                        <TableCell>
                                          <Badge variant={inv.state === "paid" ? "default" : isOverdue ? "destructive" : "secondary"} className="text-[9px]">
                                            {isOverdue ? "Overdue" : inv.state}
                                          </Badge>
                                        </TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
