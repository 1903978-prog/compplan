import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Users, Search, RefreshCw, ChevronDown, ChevronRight, DollarSign, CheckCircle, AlertTriangle, EyeOff, Eye, GitMerge, X } from "lucide-react";

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
  code: string;
  name: string;
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

interface ClientMerge {
  primaryId: number;
  secondaryId: number;
  mergedName: string;
}

// ── Persistence keys ───────────────────────────────────────────────────────────
const MERGES_KEY    = "clm_merges_v1";
const HIDDEN_KEY    = "clm_hidden_v1";
const DISMISSED_KEY = "clm_dismissed_dupes_v1";

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtCurrency(amount: number, currency: string = "EUR"): string {
  const sym = currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "CHF" ? "CHF " : "€";
  return sym + Math.round(amount).toLocaleString("it-IT");
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Derive the canonical 3-letter prefix from a client name (e.g. "Garnica Plywood" → "GAR").
function clientPrefix(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 3)
    .toUpperCase();
}

// Normalise a client name for duplicate-detection comparison.
// "Garnica Plywood" and "Garnica_Plywood" both → "garnicaplywood"
function normaliseForDupe(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// Two clients are considered similar if their normalised names are identical, or
// one is a clean prefix of the other (e.g. "Garnica" vs "Garnica Plywood").
function areSimilarClients(a: string, b: string): boolean {
  const na = normaliseForDupe(a);
  const nb = normaliseForDupe(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // One is a prefix of the other and both are at least 4 chars
  if (na.length >= 4 && nb.length >= 4) {
    const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
    if (longer.startsWith(shorter)) return true;
  }
  return false;
}

// Build a stable pair key: always smallest ID first
function dupeKey(a: number, b: number): string {
  return `${Math.min(a, b)}-${Math.max(a, b)}`;
}

function extractProjectCodes(inv: HarvestInvoice): string[] {
  const prefix = clientPrefix(inv.client?.name);
  if (inv.project_codes) {
    const codes = inv.project_codes.split(",").map(c => c.trim()).filter(Boolean);
    if (prefix && inv.code_source !== "manual") {
      const filtered = codes.filter(c => c.toUpperCase().startsWith(prefix));
      if (filtered.length) return filtered;
    } else {
      return codes;
    }
  }
  return prefix ? [`${prefix}??`] : ["General"];
}

function getPaidAmount(inv: HarvestInvoice): number {
  if (inv.state === "paid" || inv.state === "closed") return inv.amount;
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

  // ── Persistent display-layer state ──────────────────────────────────────────
  const [merges, setMerges] = useState<ClientMerge[]>(() => {
    try { return JSON.parse(localStorage.getItem(MERGES_KEY) ?? "[]"); } catch { return []; }
  });
  const [hiddenIds, setHiddenIds] = useState<number[]>(() => {
    try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]"); } catch { return []; }
  });
  const [dismissedDupes, setDismissedDupes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"); } catch { return []; }
  });
  const [showHidden, setShowHidden] = useState(false);

  // ── Helpers to persist state ─────────────────────────────────────────────────
  const saveMerges = (updated: ClientMerge[]) => {
    setMerges(updated);
    try { localStorage.setItem(MERGES_KEY, JSON.stringify(updated)); } catch {}
  };
  const saveHidden = (updated: number[]) => {
    setHiddenIds(updated);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(updated)); } catch {}
  };
  const saveDismissed = (updated: string[]) => {
    setDismissedDupes(updated);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(updated)); } catch {}
  };

  // ── Load invoices ────────────────────────────────────────────────────────────
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

  useEffect(() => { loadInvoices(); }, []);

  // ── Build client summaries (with merges applied) ─────────────────────────────
  const clients = useMemo(() => {
    // Build ID remap: secondary → primary
    const idRemap = new Map<number, number>();
    const nameOverride = new Map<number, string>();
    for (const m of merges) {
      idRemap.set(m.secondaryId, m.primaryId);
      nameOverride.set(m.primaryId, m.mergedName);
    }

    const map = new Map<number, HarvestInvoice[]>();
    for (const inv of invoices) {
      if (!inv.client) continue;
      const effectiveCid = idRemap.get(inv.client.id) ?? inv.client.id;
      if (!map.has(effectiveCid)) map.set(effectiveCid, []);
      map.get(effectiveCid)!.push(inv);
    }

    const summaries: ClientSummary[] = [];
    for (const [clientId, clientInvs] of map) {
      // Canonical name: explicit override (from merge) > primary's own invoice > fallback
      const clientName = nameOverride.get(clientId)
        ?? clientInvs.find(i => i.client?.id === clientId)?.client?.name
        ?? clientInvs[0].client?.name
        ?? "Unknown";
      const currency = clientInvs[0].currency ?? "EUR";
      const totalInvoiced = clientInvs.reduce((s, i) => s + i.amount, 0);
      const totalPaid = clientInvs.reduce((s, i) => s + getPaidAmount(i), 0);
      const totalOutstanding = totalInvoiced - totalPaid;

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

    return summaries.sort((a, b) => b.totalInvoiced - a.totalInvoiced);
  }, [invoices, merges]);

  // ── Duplicate detection ──────────────────────────────────────────────────────
  const dupePairs = useMemo(() => {
    const dismissedSet = new Set(dismissedDupes);
    const pairs: { a: ClientSummary; b: ClientSummary }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < clients.length; i++) {
      for (let j = i + 1; j < clients.length; j++) {
        const a = clients[i];
        const b = clients[j];
        const key = dupeKey(a.clientId, b.clientId);
        if (seen.has(key) || dismissedSet.has(key)) continue;
        seen.add(key);
        if (areSimilarClients(a.clientName, b.clientName)) {
          pairs.push({ a, b });
        }
      }
    }
    return pairs;
  }, [clients, dismissedDupes]);

  // ── Merge & hide handlers ───────────────────────────────────────────────────
  const handleMerge = (primary: ClientSummary, secondary: ClientSummary) => {
    saveMerges([...merges, { primaryId: primary.clientId, secondaryId: secondary.clientId, mergedName: primary.clientName }]);
    toast({ title: `Merged "${secondary.clientName}" into "${primary.clientName}"` });
  };

  const handleDismissDupe = (a: ClientSummary, b: ClientSummary) => {
    saveDismissed([...dismissedDupes, dupeKey(a.clientId, b.clientId)]);
  };

  const handleHide = (clientId: number) => {
    saveHidden([...hiddenIds, clientId]);
  };

  const handleUnhide = (clientId: number) => {
    saveHidden(hiddenIds.filter(id => id !== clientId));
  };

  // ── Filter ───────────────────────────────────────────────────────────────────
  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);

  const filtered = useMemo(() => {
    const base = showHidden ? clients : clients.filter(c => !hiddenSet.has(c.clientId));
    if (!searchQuery.trim()) return base;
    const q = searchQuery.toLowerCase();
    return base.filter(c =>
      c.clientName.toLowerCase().includes(q) ||
      c.projects.some(p => p.code.toLowerCase().includes(q))
    );
  }, [clients, searchQuery, hiddenSet, showHidden]);

  const visibleHiddenClients = useMemo(() =>
    showHidden ? clients.filter(c => hiddenSet.has(c.clientId)) : [],
    [clients, hiddenSet, showHidden]
  );

  // ── Totals ───────────────────────────────────────────────────────────────────
  const visibleClients = filtered.filter(c => !hiddenSet.has(c.clientId));
  const grandInvoiced = visibleClients.reduce((s, c) => s + c.totalInvoiced, 0);
  const grandPaid = visibleClients.reduce((s, c) => s + c.totalPaid, 0);
  const grandOutstanding = grandInvoiced - grandPaid;
  const collectionRate = grandInvoiced > 0 ? Math.round((grandPaid / grandInvoiced) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Ledger"
        description="Revenue by client and project — invoiced vs. received"
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
                <div className="text-[10px] text-muted-foreground">{visibleClients.length} clients</div>
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
        <div className="text-xs text-muted-foreground">{visibleClients.length} clients</div>
      </div>

      {/* Duplicate merge suggestions */}
      {dupePairs.length > 0 && (
        <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
          <div className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Possible duplicate client{dupePairs.length > 1 ? "s" : ""} detected
          </div>
          {dupePairs.map(({ a, b }) => (
            <div key={dupeKey(a.clientId, b.clientId)} className="flex items-center gap-2 text-xs flex-wrap">
              <span className="font-semibold text-amber-900">"{a.clientName}"</span>
              <span className="text-amber-600">and</span>
              <span className="font-semibold text-amber-900">"{b.clientName}"</span>
              <span className="text-amber-700">appear to be the same client.</span>
              <div className="flex items-center gap-1 ml-auto">
                <Button size="sm" variant="outline" className="h-6 text-[10px] border-amber-300 bg-white hover:bg-amber-100 text-amber-800"
                  onClick={() => handleMerge(a, b)}>
                  <GitMerge className="w-3 h-3 mr-1" />
                  Merge into "{a.clientName}"
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px] text-amber-700 hover:text-amber-900"
                  onClick={() => handleDismissDupe(a, b)}>
                  <X className="w-3 h-3 mr-0.5" /> Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error / Loading */}
      {error && !loading && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-4 text-sm text-red-700">
          <strong>Error:</strong> {error}
          <Button variant="outline" size="sm" className="ml-3" onClick={loadInvoices}>Retry</Button>
        </div>
      )}
      {loading && (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Loading from local database...
        </div>
      )}

      {/* Client list */}
      {!loading && !error && (
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">No clients found</div>
          ) : filtered.map(client => {
            const isExpanded = expandedClient === client.clientId;
            const isHidden = hiddenSet.has(client.clientId);
            const paidPct = client.totalInvoiced > 0 ? Math.round((client.totalPaid / client.totalInvoiced) * 100) : 0;

            return (
              <Card key={client.clientId} className={`overflow-hidden transition-opacity ${isHidden ? "opacity-40" : ""}`}>
                {/* Client header row — outer div carries group for hover-reveal hide button */}
                <div className="group relative w-full flex items-center">
                  <button
                    onClick={() => setExpandedClient(isExpanded ? null : client.clientId)}
                    className="flex-1 flex items-center gap-4 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
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
                          <Badge variant="outline" className="text-[9px]">{client.projects.filter(p => p.code !== "General" && !p.code.endsWith("??")).length} projects</Badge>
                        )}
                        {isHidden && <Badge variant="outline" className="text-[9px] text-muted-foreground border-dashed">hidden</Badge>}
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
                          {client.totalOutstanding > 0 ? fmtCurrency(client.totalOutstanding, client.currency) : "—"}
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

                  {/* Hide / Unhide button — hover-reveal */}
                  <button
                    onClick={e => { e.stopPropagation(); isHidden ? handleUnhide(client.clientId) : handleHide(client.clientId); }}
                    title={isHidden ? "Unhide client" : "Hide client"}
                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mr-3 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    {isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Expanded: project breakdown */}
                {isExpanded && (
                  <div className="border-t bg-muted/10 px-4 py-3 space-y-3">
                    {client.projects.map(project => {
                      const projKey = `${client.clientId}-${project.code}`;
                      const projExpanded = expandedProject === projKey;
                      const projPaidPct = project.totalInvoiced > 0 ? Math.round((project.totalPaid / project.totalInvoiced) * 100) : 0;

                      return (
                        <div key={project.code} className="border rounded-lg bg-background overflow-hidden">
                          <button
                            onClick={() => setExpandedProject(projExpanded ? null : projKey)}
                            className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/20 transition-colors"
                          >
                            {projExpanded
                              ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                              : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                            }
                            <Badge variant={project.code === "General" || project.code.endsWith("??") ? "outline" : "secondary"} className={`text-xs font-mono ${project.code.endsWith("??") ? "border-dashed text-muted-foreground" : ""}`}>
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
                                        <TableCell className="text-[11px] text-muted-foreground max-w-[200px] truncate">{inv.subject ?? "—"}</TableCell>
                                        <TableCell className="text-[11px]">{fmtDate(inv.created_at)}</TableCell>
                                        <TableCell className="text-xs font-mono text-right font-semibold">{fmtCurrency(inv.amount, inv.currency)}</TableCell>
                                        <TableCell className="text-xs font-mono text-right text-emerald-600">{paid > 0 ? fmtCurrency(paid, inv.currency) : "—"}</TableCell>
                                        <TableCell className={`text-xs font-mono text-right ${isOverdue ? "text-red-600 font-bold" : inv.due_amount > 0 ? "text-amber-600" : ""}`}>
                                          {inv.due_amount > 0 ? fmtCurrency(inv.due_amount, inv.currency) : "—"}
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

          {/* Hidden clients toggle */}
          {hiddenIds.length > 0 && (
            <div className="flex items-center justify-center pt-2">
              <button
                onClick={() => setShowHidden(v => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showHidden
                  ? <><EyeOff className="w-3.5 h-3.5" /> Hide {hiddenIds.length} hidden client{hiddenIds.length !== 1 ? "s" : ""}</>
                  : <><Eye className="w-3.5 h-3.5" /> Show {hiddenIds.length} hidden client{hiddenIds.length !== 1 ? "s" : ""}</>
                }
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
