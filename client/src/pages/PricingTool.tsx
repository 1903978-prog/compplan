import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign, Plus, ArrowLeft, Trash2, TrendingUp, TrendingDown,
  Users, AlertTriangle, Eye, History, CheckCircle, XCircle, Info,
} from "lucide-react";
import {
  calculatePricing, DEFAULT_PRICING_SETTINGS, REVENUE_BANDS, REGIONS, SECTORS,
  getCurrencyForRegion, formatWithCurrency,
  type PricingSettings, type PricingProposal, type StaffingLine, type PricingRecommendation,
  type CompetitorBenchmark, type ProjectType, type CompetitiveIntensity, type CompetitorType,
  type OwnershipType, type StrategicIntent, type ProcurementInvolvement,
} from "@/lib/pricingEngine";

interface PricingCase {
  id?: number;
  project_name: string;
  client_name: string;
  fund_name: string;
  region: string;
  pe_owned: boolean;
  revenue_band: string;
  price_sensitivity: string;
  duration_weeks: number;
  notes: string;
  status: string;
  staffing: StaffingLine[];
  recommendation?: PricingRecommendation | null;
  case_discounts?: { id: string; name: string; pct: number; enabled: boolean }[];
  created_at?: string;
  // Deal context (new — 7-layer engine)
  project_type?: ProjectType | null;
  sector?: string | null;
  ebitda_margin_pct?: number | null;
  commercial_maturity?: number | null;
  urgency?: number | null;
  competitive_intensity?: CompetitiveIntensity | null;
  competitor_type?: CompetitorType | null;
  ownership_type?: OwnershipType | null;
  strategic_intent?: StrategicIntent | null;
  procurement_involvement?: ProcurementInvolvement | null;
  // Value-based pricing fields
  target_roi?: number | null;
  max_fees_ebitda_pct?: number | null;
}

const fmt = (n: number) => "€" + Math.round(n).toLocaleString("it-IT");
const fmtK = (n: number) => Math.round(n).toLocaleString("it-IT");

function emptyProposal(): PricingProposal {
  return {
    proposal_date: new Date().toISOString().slice(0, 10),
    project_name: "",
    client_name: "",
    fund_name: "",
    region: "IT",
    pe_owned: true,
    revenue_band: "above_1b",
    price_sensitivity: "medium",
    duration_weeks: 8,
    weekly_price: 0,
    total_fee: null,
    outcome: "won",
    loss_reason: "",
    notes: "",
  };
}

// Fixed staffing roles shown in the build-up (display label → admin role_name substring match)
const STAFFING_ROLES: { label: string; match: string; defaultDays: number; defaultCount: number }[] = [
  { label: "ASC INT",  match: "ASC IN",      defaultDays: 5, defaultCount: 2 },
  { label: "ASC EXT",  match: "ASC EXT",     defaultDays: 5, defaultCount: 0 },
  { label: "EM INT",   match: "Manager INT", defaultDays: 5, defaultCount: 0 },
  { label: "EM EXT",   match: "Manager EXT", defaultDays: 5, defaultCount: 1 },
  { label: "Partner",  match: "Partner",     defaultDays: 1, defaultCount: 1 },
];

function emptyCase(): PricingCase {
  return {
    project_name: "", client_name: "", fund_name: "",
    region: "IT", pe_owned: true, revenue_band: "above_1b",
    price_sensitivity: "medium", duration_weeks: 12, notes: "", status: "draft", staffing: [],
    project_type: null, sector: null, ebitda_margin_pct: null,
    commercial_maturity: null, urgency: null, competitive_intensity: null,
    competitor_type: null, ownership_type: null, strategic_intent: null,
    procurement_involvement: null,
    target_roi: 10, max_fees_ebitda_pct: 3,
  };
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  if (outcome === "won") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Won</Badge>;
  if (outcome === "lost") return <Badge className="bg-red-100 text-red-700 border-red-200">Lost</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
}

function PostureBadge({ posture }: { posture: string }) {
  if (posture === "Assertive") return <Badge className="bg-orange-100 text-orange-700 border-orange-200">Assertive</Badge>;
  if (posture === "Defensive") return <Badge variant="secondary">Defensive</Badge>;
  return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Balanced</Badge>;
}

function ConfidenceBadge({ label }: { label: string }) {
  const cls = label === "High" ? "text-emerald-600" : label === "Medium" ? "text-amber-600" : "text-muted-foreground";
  return <span className={`text-xs font-semibold ${cls}`}>{label}</span>;
}

export default function PricingTool() {
  const { toast } = useToast();
  const [view, setView] = useState<"list" | "form">("list");
  const [cases, setCases] = useState<any[]>([]);
  const [proposals, setProposals] = useState<PricingProposal[]>([]);
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PricingCase>(emptyCase());
  const [caseDiscounts, setCaseDiscounts] = useState<{ id: string; name: string; pct: number; enabled: boolean }[]>([]);
  const [mainTab, setMainTab] = useState<"cases" | "history" | "winloss">("cases");
  const [historyForm, setHistoryForm] = useState<PricingProposal>(emptyProposal());
  const [editingProposalId, setEditingProposalId] = useState<number | null>(null);
  const [showHistoryForm, setShowHistoryForm] = useState(false);
  const [savingProposal, setSavingProposal] = useState(false);
  const [manualDelta, setManualDelta] = useState(0); // manual ±500 price adjustment

  const loadAll = async () => {
    setLoading(true);
    try {
      const [sRes, cRes, pRes] = await Promise.all([
        fetch("/api/pricing/settings", { credentials: "include" }),
        fetch("/api/pricing/cases", { credentials: "include" }),
        fetch("/api/pricing/proposals", { credentials: "include" }),
      ]);
      if (!sRes.ok || !cRes.ok || !pRes.ok) throw new Error("Failed to load pricing data");
      const sData = await sRes.json();
      const cData = await cRes.json();
      const pData = await pRes.json();

      // Merge loaded settings with defaults (defaults fill missing fields)
      const merged: PricingSettings = { ...DEFAULT_PRICING_SETTINGS, ...sData };
      if (!merged.roles?.length) merged.roles = DEFAULT_PRICING_SETTINGS.roles;
      if (!merged.regions?.length) merged.regions = DEFAULT_PRICING_SETTINGS.regions;
      if (!merged.ownership_multipliers?.length) merged.ownership_multipliers = DEFAULT_PRICING_SETTINGS.ownership_multipliers;
      if (!merged.revenue_band_multipliers?.length) merged.revenue_band_multipliers = DEFAULT_PRICING_SETTINGS.revenue_band_multipliers;
      if (!merged.sensitivity_multipliers?.length) merged.sensitivity_multipliers = DEFAULT_PRICING_SETTINGS.sensitivity_multipliers;
      setSettings(merged);
      setCases(Array.isArray(cData) ? cData : []);
      setProposals(Array.isArray(pData) ? pData.map((p: any) => ({ ...p, pe_owned: p.pe_owned === 1 || p.pe_owned === true })) : []);
    } catch {
      setSettings(DEFAULT_PRICING_SETTINGS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // Initialise staffing from settings when opening form
  const initStaffing = (s: PricingSettings): StaffingLine[] => {
    const lines: StaffingLine[] = [];
    for (const def of STAFFING_ROLES) {
      if (def.defaultCount === 0) continue; // only include active defaults
      const role = s.roles.find(r => r.role_name.toLowerCase().includes(def.match.toLowerCase()));
      if (!role) continue;
      lines.push({
        role_id: role.id,
        role_name: def.label,
        days_per_week: def.defaultDays,
        daily_rate_used: role.default_daily_rate,
        count: def.defaultCount,
      });
    }
    return lines;
  };

  const openNewForm = () => {
    const base = emptyCase();
    if (settings) base.staffing = initStaffing(settings);
    setForm(base);
    setView("form");
    setCaseDiscounts((settings?.discounts ?? []).map(d => ({ id: d.id, name: d.name, pct: d.default_pct, enabled: false })));
  };

  const openCase = (c: any) => {
    const { industry: _i, country: _c, ...rest } = c;
    setForm({
      ...rest,
      pe_owned: c.pe_owned === 1 || c.pe_owned === true,
      staffing: c.staffing ?? [],
    });
    setView("form");
    if (c.case_discounts?.length) {
      setCaseDiscounts(c.case_discounts);
    } else if (settings) {
      setCaseDiscounts(settings.discounts.map(d => ({ id: d.id, name: d.name, pct: d.default_pct, enabled: false })));
    }
  };

  const deleteCase = async (id: number) => {
    if (!confirm("Delete this pricing case?")) return;
    await fetch(`/api/pricing/cases/${id}`, { method: "DELETE", credentials: "include" });
    loadAll();
  };

  const saveProposal = async () => {
    if (!historyForm.project_name.trim()) {
      toast({ title: "Project name is required", variant: "destructive" });
      return;
    }
    if (!historyForm.weekly_price) {
      toast({ title: "Weekly price is required", variant: "destructive" });
      return;
    }
    setSavingProposal(true);
    try {
      const payload = { ...historyForm, pe_owned: historyForm.pe_owned ? 1 : 0 };
      if (editingProposalId) {
        await fetch(`/api/pricing/proposals/${editingProposalId}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast({ title: "Proposal updated" });
      } else {
        await fetch("/api/pricing/proposals", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast({ title: "Proposal saved" });
      }
      setShowHistoryForm(false);
      setEditingProposalId(null);
      setHistoryForm(emptyProposal());
      loadAll();
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSavingProposal(false);
    }
  };

  const editProposal = (p: PricingProposal) => {
    setHistoryForm({ ...p, pe_owned: p.pe_owned === (1 as any) || p.pe_owned === true });
    setEditingProposalId(p.id ?? null);
    setShowHistoryForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteProposal = async (id: number) => {
    if (!confirm("Delete this past proposal?")) return;
    await fetch(`/api/pricing/proposals/${id}`, { method: "DELETE", credentials: "include" });
    loadAll();
  };

  // Live recommendation
  const recommendation = useMemo<PricingRecommendation | null>(() => {
    if (!settings || !form.region || !form.duration_weeks) return null;
    const activeStaffing = form.staffing.filter(s => s.days_per_week > 0);
    if (!activeStaffing.length) return null;
    return calculatePricing({
      region: form.region,
      pe_owned: form.pe_owned,
      revenue_band: form.revenue_band,
      price_sensitivity: form.price_sensitivity,
      duration_weeks: form.duration_weeks,
      fund_name: form.fund_name || null,
      staffing: activeStaffing,
      project_type: form.project_type ?? null,
      sector: form.sector ?? null,
      ebitda_margin_pct: form.ebitda_margin_pct ?? null,
      commercial_maturity: form.commercial_maturity ?? null,
      urgency: form.urgency ?? null,
      competitive_intensity: form.competitive_intensity ?? null,
      competitor_type: form.competitor_type ?? null,
      ownership_type: form.ownership_type ?? null,
      strategic_intent: form.strategic_intent ?? null,
      procurement_involvement: form.procurement_involvement ?? null,
    }, settings, proposals);
  }, [form.region, form.pe_owned, form.revenue_band, form.price_sensitivity,
      form.duration_weeks, form.fund_name, form.staffing, settings, proposals,
      form.project_type, form.sector, form.ebitda_margin_pct, form.commercial_maturity,
      form.urgency, form.competitive_intensity, form.competitor_type, form.ownership_type,
      form.strategic_intent, form.procurement_involvement]);

  const handleSave = async (status: "draft" | "final") => {
    if (!form.project_name.trim()) { toast({ title: "Project name is required", variant: "destructive" }); return; }
    if (!form.region) { toast({ title: "Region is required", variant: "destructive" }); return; }
    if (!form.duration_weeks) { toast({ title: "Duration is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        pe_owned: form.pe_owned ? 1 : 0,
        status,
        recommendation: recommendation ?? null,
        case_discounts: caseDiscounts,
      };
      const method = form.id ? "PUT" : "POST";
      const url = form.id ? `/api/pricing/cases/${form.id}` : "/api/pricing/cases";
      const res = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: status === "final" ? "Case finalised" : "Saved as draft" });
      setView("list");
      loadAll();
    } catch {
      toast({ title: "Failed to save case", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const updateStaffingLine = (roleId: string, field: keyof StaffingLine, value: any) => {
    setForm(f => ({
      ...f,
      staffing: f.staffing.map(s => s.role_id === roleId ? { ...s, [field]: value } : s),
    }));
  };

  const toggleRole = (role: { id: string; role_name: string; default_daily_rate: number }) => {
    const exists = form.staffing.some(s => s.role_id === role.id);
    if (exists) {
      setForm(f => ({ ...f, staffing: f.staffing.filter(s => s.role_id !== role.id) }));
    } else {
      setForm(f => ({
        ...f,
        staffing: [...f.staffing, {
          role_id: role.id,
          role_name: role.role_name,
          days_per_week: 3,
          daily_rate_used: role.default_daily_rate,
          count: 1,
        }],
      }));
    }
  };

  // Compute weekly total only from visible STAFFING_ROLES (avoids phantom entries from old saves)
  const baseWeeklyDisplay = settings
    ? STAFFING_ROLES.reduce((acc, def) => {
        const role = settings.roles.find(r => r.role_name.toLowerCase().includes(def.match.toLowerCase()));
        if (!role) return acc;
        const line = form.staffing.find(s => s.role_id === role.id);
        const count = line?.count ?? 0;
        const days = line?.days_per_week ?? def.defaultDays;
        const rate = line?.daily_rate_used ?? role.default_daily_rate;
        return acc + count * days * rate;
      }, 0)
    : form.staffing.reduce((s, l) => s + l.days_per_week * l.daily_rate_used * l.count, 0);

  const totalWeeklyCost = useMemo(() => {
    if (!settings) return 0;
    return form.staffing.reduce((sum, line) => {
      const costEntry = (settings.staff_costs ?? []).find(c => c.role_id === line.role_id);
      return sum + line.days_per_week * (costEntry?.daily_cost ?? 0) * line.count;
    }, 0);
  }, [form.staffing, settings]);

  const totalDiscountPct = caseDiscounts.filter(d => d.enabled).reduce((s, d) => s + d.pct, 0);
  const netMultiplier = 1 - totalDiscountPct / 100;
  const netTargetWeekly = recommendation ? Math.round(recommendation.target_weekly * netMultiplier) : 0;
  const netTargetTotal = netTargetWeekly * form.duration_weeks;
  const totalProjectCost = totalWeeklyCost * form.duration_weeks;
  const netRevenue = totalDiscountPct > 0 ? netTargetTotal : (recommendation?.target_total ?? 0);
  const grossMarginEur = netRevenue - totalProjectCost;
  const grossMarginPct = netRevenue > 0 ? (grossMarginEur / netRevenue) * 100 : 0;

  // Fund history for display
  const fundProposals = useMemo(() => {
    if (!form.fund_name?.trim()) return [];
    return proposals
      .filter(p => p.fund_name?.toLowerCase().trim() === form.fund_name.toLowerCase().trim())
      .sort((a, b) => b.proposal_date.localeCompare(a.proposal_date))
      .slice(0, 5);
  }, [form.fund_name, proposals]);

  // Stats for list view
  const avgTarget = cases.length
    ? cases.filter(c => c.recommendation?.target_weekly).reduce((s, c) => s + (c.recommendation?.target_weekly ?? 0), 0)
      / cases.filter(c => c.recommendation?.target_weekly).length || 0
    : 0;

  // ── LIST VIEW ───────────────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DollarSign className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Pricing Tool</h1>
              <p className="text-sm text-muted-foreground">Commercial pricing decision support</p>
            </div>
          </div>
          {mainTab === "cases" ? (
            <Button onClick={openNewForm} disabled={loading}>
              <Plus className="w-4 h-4 mr-2" /> New Pricing Case
            </Button>
          ) : mainTab === "history" ? (
            <Button onClick={() => { setHistoryForm(emptyProposal()); setEditingProposalId(null); setShowHistoryForm(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Log Past Project
            </Button>
          ) : null}
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 border-b">
          {([
            { id: "cases" as const, label: "Pricing Cases", icon: DollarSign, count: cases.length },
            { id: "history" as const, label: "Past Projects", icon: History, count: proposals.length },
            { id: "winloss" as const, label: "Win-Loss", icon: TrendingUp, count: proposals.filter(p => p.outcome === "won" || p.outcome === "lost").length },
          ]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setMainTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                mainTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${mainTab === tab.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {mainTab === "cases" ? (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "Total Cases", value: cases.length, icon: Users },
                { label: "With Recommendations", value: cases.filter(c => c.recommendation).length, icon: TrendingUp },
                { label: "Avg Target / Week", value: avgTarget > 0 ? fmt(avgTarget) : "—", icon: DollarSign },
                { label: "Past Proposals", value: proposals.length, icon: TrendingDown },
              ].map(stat => (
                <Card key={stat.label} className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground uppercase font-bold mb-1">{stat.label}</div>
                      <div className="text-2xl font-bold">{typeof stat.value === "number" ? stat.value : stat.value}</div>
                    </div>
                    <stat.icon className="w-8 h-8 text-muted-foreground/30" />
                  </div>
                </Card>
              ))}
            </div>

            {/* Cases table */}
            {loading ? (
              <div className="text-center py-12 text-muted-foreground">Loading...</div>
            ) : cases.length === 0 ? (
              <Card className="py-16">
                <CardContent className="flex flex-col items-center gap-4">
                  <DollarSign className="w-12 h-12 text-muted-foreground/30" />
                  <div className="text-center">
                    <p className="font-semibold text-lg">No pricing cases yet</p>
                    <p className="text-sm text-muted-foreground">Create your first case to get started</p>
                  </div>
                  <Button onClick={openNewForm}><Plus className="w-4 h-4 mr-2" /> New Pricing Case</Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Fund</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Target / wk</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cases.map(c => (
                      <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openCase(c)}>
                        <TableCell className="font-semibold">{c.project_name}</TableCell>
                        <TableCell>{c.client_name || "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{c.fund_name || "—"}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{c.region}</Badge></TableCell>
                        <TableCell>{c.duration_weeks}w</TableCell>
                        <TableCell className="font-semibold text-emerald-600">
                          {c.recommendation?.target_weekly ? fmt(c.recommendation.target_weekly) : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={c.status === "final" ? "default" : "secondary"} className="text-xs capitalize">
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {c.created_at ? new Date(c.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <button onClick={() => openCase(c)} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteCase(c.id)} className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </>
        ) : (
          /* ── PAST PROJECTS TAB ─────────────────────────────────────── */
          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              {(() => {
                const won = proposals.filter(p => p.outcome === "won");
                const lost = proposals.filter(p => p.outcome === "lost");
                const avgWon = won.length ? won.reduce((s, p) => s + p.weekly_price, 0) / won.length : 0;
                const avgLost = lost.length ? lost.reduce((s, p) => s + p.weekly_price, 0) / lost.length : 0;
                return [
                  { label: "Won", value: won.length, icon: CheckCircle, cls: "text-emerald-600" },
                  { label: "Lost", value: lost.length, icon: XCircle, cls: "text-red-500" },
                  { label: "Avg Won /wk", value: avgWon > 0 ? fmt(avgWon) : "—", icon: TrendingUp, cls: "" },
                  { label: "Avg Lost /wk", value: avgLost > 0 ? fmt(avgLost) : "—", icon: TrendingDown, cls: "" },
                ].map(stat => (
                  <Card key={stat.label} className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground uppercase font-bold mb-1">{stat.label}</div>
                        <div className={`text-2xl font-bold ${stat.cls}`}>{typeof stat.value === "number" ? stat.value : stat.value}</div>
                      </div>
                      <stat.icon className={`w-8 h-8 ${stat.cls || "text-muted-foreground/30"} opacity-30`} />
                    </div>
                  </Card>
                ));
              })()}
            </div>

            {/* Add / Edit form */}
            {showHistoryForm && (
              <Card className="border-primary/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{editingProposalId ? "Edit Past Project" : "Log Past Project"}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Date</Label>
                      <Input type="date" value={historyForm.proposal_date}
                        onChange={e => setHistoryForm(f => ({ ...f, proposal_date: e.target.value }))} className="h-9 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Project Name <span className="text-destructive">*</span></Label>
                      <Input value={historyForm.project_name} placeholder="e.g. Cost reduction PMO"
                        onChange={e => setHistoryForm(f => ({ ...f, project_name: e.target.value }))} className="h-9 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Client</Label>
                      <Input value={historyForm.client_name ?? ""} placeholder="Client name"
                        onChange={e => setHistoryForm(f => ({ ...f, client_name: e.target.value }))} className="h-9 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">PE Owner</Label>
                      <Select value={historyForm.fund_name || "__none__"} onValueChange={v => {
                        const isPE = v !== "__none__";
                        setHistoryForm(f => ({ ...f, fund_name: isPE ? v : "", pe_owned: isPE }));
                      }}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select PE owner…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">-- None (Family owned) --</SelectItem>
                          {(settings?.funds ?? DEFAULT_PRICING_SETTINGS.funds).map(fund => (
                            <SelectItem key={fund} value={fund}>{fund}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Region</Label>
                      <Select value={historyForm.region} onValueChange={v => setHistoryForm(f => ({ ...f, region: v }))}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Revenue Band</Label>
                      <Select value={historyForm.revenue_band} onValueChange={v => setHistoryForm(f => ({ ...f, revenue_band: v }))}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {REVENUE_BANDS.map(rb => <SelectItem key={rb.value} value={rb.value}>{rb.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Duration (weeks)</Label>
                      <Input type="number" min="1" value={historyForm.duration_weeks ?? ""}
                        onChange={e => setHistoryForm(f => ({ ...f, duration_weeks: parseInt(e.target.value) || 0 }))} className="h-9 text-sm" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Weekly Price (€) <span className="text-destructive">*</span></Label>
                      <Input type="number" min="0" value={historyForm.weekly_price || ""}
                        onChange={e => setHistoryForm(f => ({ ...f, weekly_price: parseFloat(e.target.value) || 0 }))} className="h-9 text-sm font-mono" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Outcome</Label>
                      <div className="flex gap-2">
                        {(["won", "lost", "pending"] as const).map(v => (
                          <button key={v} type="button"
                            onClick={() => setHistoryForm(f => ({ ...f, outcome: v }))}
                            className={`flex-1 py-1.5 rounded-md text-sm font-medium border capitalize transition-colors ${
                              historyForm.outcome === v
                                ? v === "won" ? "bg-emerald-600 text-white border-emerald-600"
                                  : v === "lost" ? "bg-red-500 text-white border-red-500"
                                  : "bg-primary text-primary-foreground border-primary"
                                : "bg-background border-border text-muted-foreground hover:bg-muted"
                            }`}>
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                    {historyForm.outcome === "lost" && (
                      <div className="space-y-1">
                        <Label className="text-xs">Loss Reason</Label>
                        <Input value={historyForm.loss_reason ?? ""} placeholder="e.g. Price too high, lost to competitor"
                          onChange={e => setHistoryForm(f => ({ ...f, loss_reason: e.target.value }))} className="h-9 text-sm" />
                      </div>
                    )}
                    <div className="col-span-3 space-y-1">
                      <Label className="text-xs">Notes</Label>
                      <Textarea value={historyForm.notes ?? ""} placeholder="Any context about this deal…"
                        onChange={e => setHistoryForm(f => ({ ...f, notes: e.target.value }))}
                        className="text-sm resize-none" rows={2} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={saveProposal} disabled={savingProposal} size="sm">
                      {savingProposal ? "Saving…" : editingProposalId ? "Update" : "Save"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setShowHistoryForm(false); setEditingProposalId(null); setHistoryForm(emptyProposal()); }}>
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Proposals table */}
            {proposals.length === 0 && !showHistoryForm ? (
              <Card className="py-16">
                <CardContent className="flex flex-col items-center gap-4">
                  <History className="w-12 h-12 text-muted-foreground/30" />
                  <div className="text-center">
                    <p className="font-semibold text-lg">No past projects logged yet</p>
                    <p className="text-sm text-muted-foreground">Log won and lost deals to improve pricing recommendations</p>
                  </div>
                  <Button onClick={() => setShowHistoryForm(true)}><Plus className="w-4 h-4 mr-2" /> Log First Project</Button>
                </CardContent>
              </Card>
            ) : proposals.length > 0 && (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Fund</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead>Dur.</TableHead>
                      <TableHead>Weekly price</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {proposals.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.proposal_date ? new Date(p.proposal_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                        </TableCell>
                        <TableCell className="font-semibold text-sm">{p.project_name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.client_name || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.fund_name || "—"}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{p.region}</Badge></TableCell>
                        <TableCell className="text-sm">{p.duration_weeks ? `${p.duration_weeks}w` : "—"}</TableCell>
                        <TableCell className="font-semibold text-sm font-mono">{fmt(p.weekly_price)}</TableCell>
                        <TableCell>
                          {p.outcome === "won"
                            ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Won</Badge>
                            : p.outcome === "lost"
                            ? <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Lost</Badge>
                            : <Badge variant="secondary" className="text-xs">Pending</Badge>}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <button onClick={() => editProposal(p)} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => deleteProposal(p.id!)} className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            )}
          </div>
        )}

        {/* ── WIN-LOSS ANALYSIS TAB ──────────────────────────────── */}
        {mainTab === "winloss" && (
          <div className="space-y-6">
            {(() => {
              const wonProposals = proposals.filter(p => p.outcome === "won");
              const lostProposals = proposals.filter(p => p.outcome === "lost");

              // Group by region
              const allRegions = [...new Set(proposals.map(p => p.region))].sort();

              if (wonProposals.length === 0 && lostProposals.length === 0) {
                return (
                  <Card className="py-16">
                    <CardContent className="flex flex-col items-center gap-4">
                      <TrendingUp className="w-12 h-12 text-muted-foreground/30" />
                      <div className="text-center">
                        <p className="font-semibold text-lg">No win/loss data available</p>
                        <p className="text-sm text-muted-foreground">Log past projects with outcomes to see win-loss analysis</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              }

              return (
                <>
                  {/* Summary stats */}
                  <div className="grid grid-cols-4 gap-4">
                    {(() => {
                      const avgWon = wonProposals.length ? wonProposals.reduce((s, p) => s + p.weekly_price, 0) / wonProposals.length : 0;
                      const avgLost = lostProposals.length ? lostProposals.reduce((s, p) => s + p.weekly_price, 0) / lostProposals.length : 0;
                      const winRate = (wonProposals.length + lostProposals.length) > 0
                        ? (wonProposals.length / (wonProposals.length + lostProposals.length) * 100) : 0;
                      return [
                        { label: "Won", value: wonProposals.length, cls: "text-emerald-600" },
                        { label: "Lost", value: lostProposals.length, cls: "text-red-500" },
                        { label: "Win Rate", value: `${winRate.toFixed(0)}%`, cls: "" },
                        { label: "Avg Won vs Lost", value: avgWon > 0 && avgLost > 0 ? `${((avgLost - avgWon) / avgWon * 100).toFixed(0)}% gap` : "--", cls: "" },
                      ].map(stat => (
                        <Card key={stat.label} className="p-4">
                          <div className="text-xs text-muted-foreground uppercase font-bold mb-1">{stat.label}</div>
                          <div className={`text-2xl font-bold ${stat.cls}`}>{stat.value}</div>
                        </Card>
                      ));
                    })()}
                  </div>

                  {/* Scatter plot per region */}
                  {allRegions.map(region => {
                    const regionWon = wonProposals.filter(p => p.region === region);
                    const regionLost = lostProposals.filter(p => p.region === region);
                    if (regionWon.length === 0 && regionLost.length === 0) return null;

                    const allPrices = [...regionWon, ...regionLost].map(p => p.weekly_price);
                    const minPrice = Math.min(...allPrices);
                    const maxPrice = Math.max(...allPrices);
                    const range = maxPrice - minPrice || 1;
                    const padding = range * 0.1;
                    const scaleMin = Math.max(0, minPrice - padding);
                    const scaleMax = maxPrice + padding;
                    const scaleRange = scaleMax - scaleMin || 1;

                    const suggestedMin = regionWon.length > 0 ? Math.min(...regionWon.map(p => p.weekly_price)) : null;
                    const suggestedMax = regionWon.length > 0 ? Math.max(...regionWon.map(p => p.weekly_price)) : null;
                    const avgWon = regionWon.length > 0 ? regionWon.reduce((s, p) => s + p.weekly_price, 0) / regionWon.length : null;
                    const avgLost = regionLost.length > 0 ? regionLost.reduce((s, p) => s + p.weekly_price, 0) / regionLost.length : null;

                    const cSym = getCurrencyForRegion(region).symbol;
                    const fmtR = (n: number) => `${cSym}${Math.round(n / 1000)}k`;

                    return (
                      <Card key={region}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            {region}
                            <Badge variant="secondary" className="text-xs">{regionWon.length + regionLost.length} deals</Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {/* SVG scatter */}
                          <div className="relative">
                            <svg viewBox="0 0 600 120" className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
                              {/* Background */}
                              <rect x="40" y="10" width="540" height="80" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" rx="4" />

                              {/* Suggested range */}
                              {suggestedMin != null && suggestedMax != null && (
                                <rect
                                  x={40 + ((suggestedMin - scaleMin) / scaleRange) * 540}
                                  y="10" width={Math.max(4, ((suggestedMax - suggestedMin) / scaleRange) * 540)}
                                  height="80" fill="#dcfce7" opacity="0.6"
                                />
                              )}

                              {/* Won dots (blue) */}
                              {regionWon.map((p, i) => {
                                const x = 40 + ((p.weekly_price - scaleMin) / scaleRange) * 540;
                                const y = 30 + (i % 4) * 15;
                                return <circle key={`w${i}`} cx={x} cy={y} r="5" fill="#3b82f6" opacity="0.8">
                                  <title>Won: {fmtR(p.weekly_price)} - {p.project_name}</title>
                                </circle>;
                              })}

                              {/* Lost dots (red) */}
                              {regionLost.map((p, i) => {
                                const x = 40 + ((p.weekly_price - scaleMin) / scaleRange) * 540;
                                const y = 55 + (i % 4) * 15;
                                return <circle key={`l${i}`} cx={x} cy={y} r="5" fill="#ef4444" opacity="0.8">
                                  <title>Lost: {fmtR(p.weekly_price)} - {p.project_name}</title>
                                </circle>;
                              })}

                              {/* Avg markers */}
                              {avgWon != null && (
                                <line x1={40 + ((avgWon - scaleMin) / scaleRange) * 540} y1="10"
                                  x2={40 + ((avgWon - scaleMin) / scaleRange) * 540} y2="90"
                                  stroke="#3b82f6" strokeWidth="2" strokeDasharray="4,4" />
                              )}
                              {avgLost != null && (
                                <line x1={40 + ((avgLost - scaleMin) / scaleRange) * 540} y1="10"
                                  x2={40 + ((avgLost - scaleMin) / scaleRange) * 540} y2="90"
                                  stroke="#ef4444" strokeWidth="2" strokeDasharray="4,4" />
                              )}

                              {/* Scale labels */}
                              <text x="40" y="108" fontSize="10" fill="#94a3b8">{fmtR(scaleMin)}</text>
                              <text x="580" y="108" fontSize="10" fill="#94a3b8" textAnchor="end">{fmtR(scaleMax)}</text>
                              <text x="310" y="108" fontSize="10" fill="#94a3b8" textAnchor="middle">{fmtR((scaleMin + scaleMax) / 2)}</text>
                            </svg>
                          </div>

                          {/* Legend */}
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <div className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Won
                              {avgWon != null && <span className="font-mono text-blue-600 ml-1">(avg {fmtR(avgWon)})</span>}
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-2.5 h-2.5 rounded-full bg-red-500" /> Lost
                              {avgLost != null && <span className="font-mono text-red-600 ml-1">(avg {fmtR(avgLost)})</span>}
                            </div>
                            {suggestedMin != null && suggestedMax != null && (
                              <div className="flex items-center gap-1">
                                <div className="w-3 h-2.5 bg-emerald-200 rounded-sm" />
                                Suggested: {fmtR(suggestedMin)} - {fmtR(suggestedMax)}
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </>
              );
            })()}
          </div>
        )}
      </div>
    );
  }

  // ── FORM VIEW ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Form header */}
      <div className="flex items-center gap-3">
        <button onClick={() => setView("list")}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold">{form.id ? "Edit Pricing Case" : "New Pricing Case"}</h1>
          <p className="text-sm text-muted-foreground">Fill in the details — pricing recommendation updates live</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr,380px] gap-6 items-start">
        {/* ── LEFT COLUMN ──────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* SECTION A: Project Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Project Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Project Name <span className="text-destructive">*</span></Label>
                  <Input value={form.project_name} onChange={e => setForm(f => ({ ...f, project_name: e.target.value }))}
                    placeholder="e.g. Digital Transformation Program" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Client Company <span className="text-destructive">*</span></Label>
                  <Input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
                    placeholder="Client name" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">PE Owner</Label>
                  <Select value={form.fund_name || "__none__"} onValueChange={v => {
                    const isPE = v !== "__none__";
                    setForm(f => ({ ...f, fund_name: isPE ? v : "", pe_owned: isPE }));
                  }}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select PE owner…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">-- None (Family owned) --</SelectItem>
                      {(settings?.funds ?? DEFAULT_PRICING_SETTINGS.funds).map(fund => (
                        <SelectItem key={fund} value={fund}>{fund}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Region <span className="text-destructive">*</span></Label>
                  <Select value={form.region} onValueChange={v => setForm(f => ({ ...f, region: v }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REGIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Revenue Band</Label>
                  <Select value={form.revenue_band} onValueChange={v => setForm(f => ({ ...f, revenue_band: v }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REVENUE_BANDS.map(rb => <SelectItem key={rb.value} value={rb.value}>{rb.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Price Sensitivity</Label>
                  <Select value={form.price_sensitivity} onValueChange={v => setForm(f => ({ ...f, price_sensitivity: v }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low — client not price-sensitive</SelectItem>
                      <SelectItem value="medium">Medium — standard sensitivity</SelectItem>
                      <SelectItem value="high">High — competitive / budget pressure</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Duration (weeks) <span className="text-destructive">*</span></Label>
                  <Input type="number" min="1" step="1"
                    value={form.duration_weeks}
                    onChange={e => setForm(f => ({ ...f, duration_weeks: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">Notes / Context</Label>
                  <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Any relevant context, competitive dynamics, constraints…"
                    className="text-sm resize-none" rows={3} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SECTION A2: Deal Context */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Deal Context &amp; Value Drivers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {/* Project type */}
                <div className="space-y-1">
                  <Label className="text-xs">Project Type <span className="text-muted-foreground/50 font-normal">(L0)</span></Label>
                  <Select value={form.project_type ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, project_type: v === "__none__" ? null : v as ProjectType }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not set —</SelectItem>
                      <SelectItem value="diagnostic">Diagnostic</SelectItem>
                      <SelectItem value="implementation">Implementation</SelectItem>
                      <SelectItem value="transformation">Transformation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Sector */}
                <div className="space-y-1">
                  <Label className="text-xs">Sector <span className="text-muted-foreground/50 font-normal">(L0)</span></Label>
                  <Select value={form.sector ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, sector: v === "__none__" ? null : v }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not set —</SelectItem>
                      {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {/* EBITDA margin */}
                {(() => {
                  const SECTOR_EBITDA_DEFAULTS: Record<string, number> = {
                    "Industrial / Manufacturing": 10, "Pharma / Healthcare": 17,
                    "Software / SaaS": 22, "Consumer / Retail": 9,
                    "Energy / Utilities": 18, "Business Services": 14,
                    "Financial Services": 22, "Other": 12,
                  };
                  const suggested = form.sector ? SECTOR_EBITDA_DEFAULTS[form.sector] ?? null : null;
                  const isUsingSuggested = suggested !== null && form.ebitda_margin_pct === null;
                  return (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Client EBITDA Margin (%) <span className="text-muted-foreground/50 font-normal">(L0)</span></Label>
                        {suggested !== null && form.ebitda_margin_pct === null && (
                          <button type="button"
                            onClick={() => setForm(f => ({ ...f, ebitda_margin_pct: suggested }))}
                            className="text-[9px] text-blue-600 hover:text-blue-800 underline">
                            Use sector default ({suggested}%)
                          </button>
                        )}
                      </div>
                      <Input type="number" min="0" max="100" step="1"
                        placeholder={suggested ? `Sector default: ${suggested}%` : "e.g. 15"}
                        value={form.ebitda_margin_pct ?? ""}
                        onChange={e => setForm(f => ({ ...f, ebitda_margin_pct: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
                      {isUsingSuggested && (
                        <div className="text-[9px] text-muted-foreground italic">
                          Click "Use sector default" to activate value-based pricing
                        </div>
                      )}
                    </div>
                  );
                })()}
                {/* Strategic intent */}
                <div className="space-y-1">
                  <Label className="text-xs">Strategic Intent <span className="text-muted-foreground/50 font-normal">(L5)</span></Label>
                  <Select value={form.strategic_intent ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, strategic_intent: v === "__none__" ? null : v as StrategicIntent }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not set —</SelectItem>
                      <SelectItem value="enter">Enter — new client (beachhead −15%)</SelectItem>
                      <SelectItem value="expand">Expand — existing relationship</SelectItem>
                      <SelectItem value="harvest">Harvest — optimise margin (+15%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Competitive intensity */}
                <div className="space-y-1">
                  <Label className="text-xs">Competitive Intensity <span className="text-muted-foreground/50 font-normal">(L2)</span></Label>
                  <Select value={form.competitive_intensity ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, competitive_intensity: v === "__none__" ? null : v as CompetitiveIntensity }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not set —</SelectItem>
                      <SelectItem value="sole_source">Sole source (+15%)</SelectItem>
                      <SelectItem value="limited">Limited (+5%)</SelectItem>
                      <SelectItem value="competitive">Competitive (neutral)</SelectItem>
                      <SelectItem value="crowded">Crowded (−15%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Competitor type */}
                <div className="space-y-1">
                  <Label className="text-xs">Main Competitor <span className="text-muted-foreground/50 font-normal">(L2)</span></Label>
                  <Select value={form.competitor_type ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, competitor_type: v === "__none__" ? null : v as CompetitorType }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not set —</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="boutiques">Boutiques (−5%)</SelectItem>
                      <SelectItem value="tier2">Tier 2 (neutral)</SelectItem>
                      <SelectItem value="mbb">MBB (+15%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Procurement */}
                <div className="space-y-1">
                  <Label className="text-xs">Procurement Involvement <span className="text-muted-foreground/50 font-normal">(L3)</span></Label>
                  <Select value={form.procurement_involvement ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, procurement_involvement: v === "__none__" ? null : v as ProcurementInvolvement }))}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not set —</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="light">Light (−5%)</SelectItem>
                      <SelectItem value="heavy">Heavy (−15%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Maturity / urgency sliders */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Commercial Maturity <span className="text-muted-foreground/50 font-normal">(L3)</span></Label>
                    <span className="text-xs font-bold text-muted-foreground">{form.commercial_maturity ?? "—"}/5</span>
                  </div>
                  <input type="range" min="1" max="5" step="1"
                    value={form.commercial_maturity ?? 3}
                    onChange={e => setForm(f => ({ ...f, commercial_maturity: parseInt(e.target.value) }))}
                    className="w-full h-1.5 rounded accent-primary cursor-pointer" />
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span>Naive</span><span>Sophisticated</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Urgency <span className="text-muted-foreground/50 font-normal">(L3)</span></Label>
                    <span className="text-xs font-bold text-muted-foreground">{form.urgency ?? "—"}/5</span>
                  </div>
                  <input type="range" min="1" max="5" step="1"
                    value={form.urgency ?? 3}
                    onChange={e => setForm(f => ({ ...f, urgency: parseInt(e.target.value) }))}
                    className="w-full h-1.5 rounded accent-primary cursor-pointer" />
                  <div className="flex justify-between text-[9px] text-muted-foreground">
                    <span>Low</span><span>Critical</span>
                  </div>
                </div>
              </div>

              {/* Value anchor hint */}
              {recommendation?.value_anchor_weekly != null && (
                <div className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                  Value anchor active: {fmt(recommendation.value_anchor_weekly)}/wk — see Value-Based Pricing section below
                </div>
              )}
            </CardContent>
          </Card>

          {/* SECTION B: Staffing */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Staffing Build-up</CardTitle>
                {baseWeeklyDisplay > 0 && (
                  <span className="text-sm font-semibold text-muted-foreground">
                    Base: <span className="text-foreground">{fmt(baseWeeklyDisplay)}/wk</span>
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {settings ? (
                <div className="space-y-1">
                  {/* Header */}
                  <div className="grid grid-cols-[120px_1fr_1fr_80px_90px] gap-2 px-2 pb-1">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Role</span>
                    <span className="text-[10px] font-bold uppercase text-muted-foreground text-center">How many</span>
                    <span className="text-[10px] font-bold uppercase text-muted-foreground text-center">Days / wk</span>
                    <span className="text-[10px] font-bold uppercase text-muted-foreground text-right">Rate</span>
                    <span className="text-[10px] font-bold uppercase text-muted-foreground text-right">Weekly</span>
                  </div>

                  {STAFFING_ROLES.map(def => {
                    const adminRole = settings.roles.find(r =>
                      r.role_name.toLowerCase().includes(def.match.toLowerCase())
                    );
                    if (!adminRole) return null;

                    const line = form.staffing.find(s => s.role_id === adminRole.id);
                    const count = line?.count ?? 0;
                    const days = line?.days_per_week ?? def.defaultDays;
                    const rate = adminRole.default_daily_rate;
                    const weekly = count > 0 ? count * days * rate : 0;
                    const active = count > 0;

                    const setCount = (n: number) => {
                      const newCount = Math.max(0, Math.min(10, n));
                      if (newCount === 0) {
                        // Remove from staffing
                        setForm(f => ({ ...f, staffing: f.staffing.filter(s => s.role_id !== adminRole.id) }));
                      } else if (line) {
                        updateStaffingLine(adminRole.id, "count", newCount);
                      } else {
                        // Add to staffing
                        setForm(f => ({
                          ...f,
                          staffing: [...f.staffing, {
                            role_id: adminRole.id,
                            role_name: def.label,
                            days_per_week: def.defaultDays,
                            daily_rate_used: rate,
                            count: newCount,
                          }],
                        }));
                      }
                    };

                    const setDays = (d: number) => {
                      const newDays = Math.max(0.5, Math.min(5, d));
                      if (line) {
                        updateStaffingLine(adminRole.id, "days_per_week", newDays);
                      }
                    };

                    return (
                      <div key={def.label}
                        className={`grid grid-cols-[120px_1fr_1fr_80px_90px] gap-2 items-center rounded-lg px-2 py-2 transition-colors ${
                          active ? "bg-primary/5 border border-primary/15" : "bg-muted/20 border border-transparent"
                        }`}
                      >
                        {/* Role label */}
                        <span className={`text-sm font-semibold ${active ? "text-foreground" : "text-muted-foreground"}`}>
                          {def.label}
                        </span>

                        {/* Count */}
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" onClick={() => setCount(count - 1)}
                            className="w-6 h-6 rounded-md border bg-background hover:bg-muted text-sm font-bold leading-none flex items-center justify-center disabled:opacity-30"
                            disabled={count === 0}>−</button>
                          <span className={`w-6 text-center text-sm font-bold tabular-nums ${active ? "text-foreground" : "text-muted-foreground"}`}>
                            {count}
                          </span>
                          <button type="button" onClick={() => setCount(count + 1)}
                            className="w-6 h-6 rounded-md border bg-background hover:bg-muted text-sm font-bold leading-none flex items-center justify-center">+</button>
                        </div>

                        {/* Days / wk */}
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" onClick={() => setDays(days - 0.5)}
                            disabled={!active || days <= 0.5}
                            className="w-6 h-6 rounded-md border bg-background hover:bg-muted text-sm font-bold leading-none flex items-center justify-center disabled:opacity-30">−</button>
                          <span className={`w-8 text-center text-sm tabular-nums ${active ? "text-foreground" : "text-muted-foreground/50"}`}>
                            {active ? days : "—"}
                          </span>
                          <button type="button" onClick={() => setDays(days + 0.5)}
                            disabled={!active || days >= 5}
                            className="w-6 h-6 rounded-md border bg-background hover:bg-muted text-sm font-bold leading-none flex items-center justify-center disabled:opacity-30">+</button>
                        </div>

                        {/* Rate */}
                        <span className={`text-xs text-right tabular-nums ${active ? "text-muted-foreground" : "text-muted-foreground/40"}`}>
                          €{rate.toLocaleString("it-IT")}/d
                        </span>

                        {/* Weekly */}
                        <span className={`text-sm font-semibold text-right tabular-nums ${active ? "text-foreground" : "text-muted-foreground/30"}`}>
                          {active ? fmt(weekly) : "—"}
                        </span>
                      </div>
                    );
                  })}

                  {/* Total row — computed from visible STAFFING_ROLES to avoid phantom entries */}
                  {(() => {
                    const t = STAFFING_ROLES.reduce((acc, def) => {
                      const role = settings.roles.find(r => r.role_name.toLowerCase().includes(def.match.toLowerCase()));
                      if (!role) return acc;
                      const line = form.staffing.find(s => s.role_id === role.id);
                      const count = line?.count ?? 0;
                      const days = line?.days_per_week ?? def.defaultDays;
                      const rate = line?.daily_rate_used ?? role.default_daily_rate;
                      return { people: acc.people + count, days: acc.days + count * days, weekly: acc.weekly + count * days * rate };
                    }, { people: 0, days: 0, weekly: 0 });
                    return (
                      <div className="flex items-center justify-between pt-3 border-t mt-2 px-2">
                        <span className="text-xs text-muted-foreground">
                          {t.people} people · {t.days.toFixed(1)} days/wk
                        </span>
                        <span className="font-bold text-base">{fmt(t.weekly)}/week</span>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Loading roles…</div>
              )}
            </CardContent>
          </Card>

          {/* ── MARKET BENCHMARK CHART ────────────────────────────── */}
          {(() => {
            const benchmarks: CompetitorBenchmark[] = settings?.competitor_benchmarks ?? DEFAULT_PRICING_SETTINGS.competitor_benchmarks;
            if (!benchmarks?.length) return null;
            const regionMap: Record<string, string> = { IT: "Italy", FR: "France", DE: "DACH", UK: "UK", US: "US" };
            const matrixRegion = regionMap[form.region] ?? null;
            if (!matrixRegion) return null;
            const clientType = form.pe_owned
              ? (form.revenue_band === "above_1b" ? "PE >€1B"
                : form.revenue_band === "200m_1b" ? "PE €200M-€1B"
                : form.revenue_band === "100m_200m" ? "PE €100M-€200M"
                : "PE <€100M")
              : (form.revenue_band === "above_1b" || form.revenue_band === "200m_1b" ? "Family >€200M"
                : form.revenue_band === "100m_200m" ? "Family €100M-€200M"
                : "Family <€100M");
            const matrixRow = settings?.rate_matrix?.find(r => r.client_type === clientType);
            const ourCell = matrixRow?.rates?.[matrixRegion];
            const allMaxes = benchmarks.map(b => (b.rates as any)[matrixRegion]?.max_weekly ?? 0).filter(Boolean);
            if (ourCell && !ourCell.avoid) allMaxes.push(ourCell.max_weekly);
            const targetPrice = recommendation ? recommendation.target_weekly + manualDelta : null;
            if (targetPrice) allMaxes.push(targetPrice);
            const scaleMax = Math.max(...allMaxes, 1) * 1.08;
            const pct = (v: number) => `${Math.min(100, (v / scaleMax) * 100).toFixed(1)}%`;
            const cSym = getCurrencyForRegion(form.region).symbol;
            const fmtK = (v: number) => `${cSym}${Math.round(v / 1000)}k`;
            const tiers = [
              ...benchmarks.map(b => ({
                label: b.label, color: b.color,
                min: (b.rates as any)[matrixRegion]?.min_weekly ?? 0,
                max: (b.rates as any)[matrixRegion]?.max_weekly ?? 0,
                isOurs: false,
              })),
              ...(ourCell && !ourCell.avoid ? [{
                label: "Our Range (Rate Matrix)", color: "#f59e0b",
                min: ourCell.min_weekly, max: ourCell.max_weekly, isOurs: true,
              }] : []),
            ].filter(t => t.max > 0);
            return (
              <div className="border rounded-lg p-4 bg-muted/10 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase text-muted-foreground tracking-wide">
                    Market Benchmarks — {matrixRegion} · {clientType}
                  </span>
                  {targetPrice && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Your target: <span className="font-bold text-foreground">{fmtK(targetPrice)}</span>/wk
                    </span>
                  )}
                </div>
                {tiers.map((tier, i) => {
                  const mid = (tier.min + tier.max) / 2;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span className={tier.isOurs ? "font-bold text-amber-700" : ""}>{tier.label}</span>
                        <span className="font-mono text-[11px]">{fmtK(tier.min)} – <span className="opacity-60">avg {fmtK(mid)}</span> – {fmtK(tier.max)}</span>
                      </div>
                      <div className="relative h-5 bg-muted rounded-full overflow-hidden">
                        <div className="absolute top-0 bottom-0 rounded-full opacity-35"
                          style={{ left: pct(tier.min), right: `${100 - parseFloat(pct(tier.max))}%`, backgroundColor: tier.color }} />
                        <div className="absolute top-0 bottom-0 w-0.5 opacity-70"
                          style={{ left: pct(tier.min), backgroundColor: tier.color }} />
                        <div className="absolute top-0 bottom-0 w-0.5 opacity-70"
                          style={{ left: pct(tier.max), backgroundColor: tier.color }} />
                        <div className="absolute top-0 bottom-0 opacity-50"
                          style={{ left: pct(mid), width: "1px", backgroundColor: tier.color }} />
                      </div>
                    </div>
                  );
                })}
                {/* Target price marker */}
                {targetPrice && (
                  <div className="relative h-6 mt-1">
                    <div className="absolute inset-x-0 top-3 border-t border-dashed border-muted-foreground/25" />
                    <div className="absolute top-0 flex flex-col items-center"
                      style={{ left: pct(targetPrice), transform: "translateX(-50%)" }}>
                      <div className="w-2.5 h-2.5 rounded-full bg-foreground border-2 border-background shadow" />
                      <span className="text-[9px] font-bold text-foreground whitespace-nowrap mt-0.5">
                        Target {fmtK(targetPrice)}
                      </span>
                    </div>
                  </div>
                )}
                <div className="text-[9px] text-muted-foreground/50 italic border-t pt-1.5">
                  EM+2 weekly rates. Sources: Source Global Research, ALM Intelligence, Consultancy.eu.
                </div>
              </div>
            );
          })()}

          {/* ── VALUE-BASED PRICING SECTION ────────────────────── */}
          {(() => {
            const cur = getCurrencyForRegion(form.region);
            const fmtC = (n: number) => cur.symbol + Math.round(n).toLocaleString("it-IT");
            const ebitda_margin = form.ebitda_margin_pct ?? 0;
            const ebitda_improvement = recommendation?.ebitda_improvement_pct ?? 0;
            const REVENUE_MIDPOINTS: Record<string, number> = {
              below_100m: 50, "100m_200m": 150, "200m_1b": 500, above_1b: 1500,
            };
            const revenue_m = REVENUE_MIDPOINTS[form.revenue_band] ?? 500;
            const targetRoi = form.target_roi ?? 10;
            const maxFeesPct = form.max_fees_ebitda_pct ?? 3;

            // EBITDA generated over 3 years cumulated
            const ebitda_generated_3y = revenue_m * 1_000_000 * (ebitda_margin / 100) * (ebitda_improvement / 100) * 3;
            const professional_fees = targetRoi > 0 ? ebitda_generated_3y / targetRoi : 0;
            const fees_per_week = form.duration_weeks > 0 ? professional_fees / form.duration_weeks : 0;

            // Constraint: fees <= max_fees_ebitda_pct% of EBITDA
            const annual_ebitda = revenue_m * 1_000_000 * (ebitda_margin / 100);
            const max_fees_from_ebitda = annual_ebitda * (maxFeesPct / 100);

            // Get rate matrix min/max for constraint
            const regionMap: Record<string, string> = { IT: "Italy", FR: "France", DE: "DACH", UK: "UK", US: "US" };
            const matrixRegion = regionMap[form.region] ?? "Italy";
            const clientType = form.pe_owned
              ? (form.revenue_band === "above_1b" ? "PE >€1B"
                : form.revenue_band === "200m_1b" ? "PE €200M-€1B"
                : form.revenue_band === "100m_200m" ? "PE €100M-€200M"
                : "PE <€100M")
              : (form.revenue_band === "above_1b" || form.revenue_band === "200m_1b" ? "Family >€200M"
                : form.revenue_band === "100m_200m" ? "Family €100M-€200M"
                : "Family <€100M");
            const matrixRow = settings?.rate_matrix?.find(r => r.client_type === clientType);
            const matrixCell = matrixRow?.rates?.[matrixRegion];
            const min_fee_weekly = matrixCell && !matrixCell.avoid ? matrixCell.min_weekly : 0;
            const max_fee_weekly = matrixCell && !matrixCell.avoid ? matrixCell.max_weekly : Infinity;

            // Apply constraints
            let constrained_fees_total = Math.min(professional_fees, max_fees_from_ebitda);
            let constrained_per_week = form.duration_weeks > 0 ? constrained_fees_total / form.duration_weeks : 0;
            if (min_fee_weekly > 0) constrained_per_week = Math.max(constrained_per_week, min_fee_weekly);
            if (max_fee_weekly < Infinity) constrained_per_week = Math.min(constrained_per_week, max_fee_weekly);
            constrained_fees_total = constrained_per_week * form.duration_weeks;

            const fees_as_pct_ebitda = annual_ebitda > 0 ? (constrained_fees_total / annual_ebitda) * 100 : 0;

            const hasData = ebitda_margin > 0 && ebitda_improvement > 0 && form.duration_weeks > 0;

            return (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Value-Based Pricing (ROI Logic)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Target ROI (x)</Label>
                      <Input type="number" min="1" max="100" step="1"
                        value={form.target_roi ?? 10}
                        onChange={e => setForm(f => ({ ...f, target_roi: parseFloat(e.target.value) || 10 }))} />
                      <div className="text-[9px] text-muted-foreground">Fees = EBITDA generated / ROI target</div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Max fees as % of EBITDA</Label>
                      <Input type="number" min="0.5" max="20" step="0.5"
                        value={form.max_fees_ebitda_pct ?? 3}
                        onChange={e => setForm(f => ({ ...f, max_fees_ebitda_pct: parseFloat(e.target.value) || 3 }))} />
                      <div className="text-[9px] text-muted-foreground">Hard cap on total fees vs annual EBITDA</div>
                    </div>
                  </div>

                  {hasData ? (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-2">
                      <div className="text-[10px] font-bold uppercase text-emerald-700 tracking-wide">Value-Based Fee Calculation</div>
                      <div className="text-xs text-emerald-800 space-y-1">
                        <div>Revenue estimate: {fmtC(revenue_m * 1_000_000)} | EBITDA margin: {ebitda_margin}% | Improvement: +{ebitda_improvement.toFixed(1)} pts</div>
                        <div>EBITDA generated (3yr cumulated): <span className="font-bold">{fmtC(ebitda_generated_3y)}</span></div>
                        <div>Professional fees (EBITDA / {targetRoi}x ROI): <span className="font-bold">{fmtC(professional_fees)}</span></div>
                        <div>Fees per week (/ {form.duration_weeks}w): <span className="font-bold">{fmtC(fees_per_week)}</span></div>
                      </div>
                      <div className="border-t border-emerald-300 pt-2 space-y-1">
                        <div className="text-xs text-emerald-800">
                          Constrained fees/week: <span className="font-bold text-lg">{fmtC(constrained_per_week)}</span>
                        </div>
                        <div className="text-xs text-emerald-800">
                          Total fees: <span className="font-bold">{fmtC(constrained_fees_total)}</span> | Fees as % of EBITDA: <span className="font-bold">{fees_as_pct_ebitda.toFixed(1)}%</span>
                        </div>
                        {matrixCell && !matrixCell.avoid && (
                          <div className="text-[10px] text-emerald-700">
                            Rate matrix range ({clientType}, {matrixRegion}): {fmtC(min_fee_weekly)} - {fmtC(max_fee_weekly)}/wk
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic bg-muted/30 rounded p-2">
                      Fill in EBITDA margin, sector (for improvement estimate), and duration to see value-based pricing
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Save buttons */}
          <div className="flex gap-3 pt-2">
            <Button onClick={() => handleSave("final")} disabled={saving} className="flex-1">
              {saving ? "Saving…" : "Save & Finalise"}
            </Button>
            <Button variant="outline" onClick={() => handleSave("draft")} disabled={saving}>
              Save as Draft
            </Button>
            <Button variant="ghost" onClick={() => setView("list")} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Live Result ─────────────────────────────────────── */}
        <div className="lg:sticky lg:top-6 space-y-4">
          <Card className="overflow-hidden">
            <CardHeader className="pb-2 bg-muted/30">
              <CardTitle className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Live Pricing Result
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {!recommendation ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <DollarSign className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                  Fill in region, duration, and staffing to see the recommendation
                </div>
              ) : (
                <div className="space-y-3">

                  {/* ── DUAL PRICE DISPLAY: Benchmark vs Value-Based ────── */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Benchmark Price */}
                    <div className="rounded-lg border-2 border-primary/40 bg-primary/5 px-3 py-2.5">
                      <div className="text-[9px] font-bold uppercase tracking-wide text-primary mb-1">
                        Benchmark Price
                      </div>
                      <div className="text-xl font-bold text-primary leading-none">
                        {fmt(recommendation.target_weekly + manualDelta)}
                      </div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">/week · market-based</div>
                      <div className="text-[9px] text-muted-foreground mt-1 leading-tight">
                        Base {fmt(recommendation.base_weekly)} → layers applied
                      </div>
                    </div>
                    {/* Value-Based Price */}
                    <div className={`rounded-lg border-2 px-3 py-2.5 ${
                      recommendation.value_anchor_weekly != null
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-dashed border-muted bg-muted/10"
                    }`}>
                      <div className={`text-[9px] font-bold uppercase tracking-wide mb-1 ${
                        recommendation.value_anchor_weekly != null ? "text-emerald-700" : "text-muted-foreground"
                      }`}>
                        Value-Based Price
                      </div>
                      {recommendation.value_anchor_weekly != null ? (
                        <>
                          <div className="text-xl font-bold text-emerald-700 leading-none">
                            {fmt(recommendation.value_anchor_weekly)}
                          </div>
                          <div className="text-[9px] text-emerald-600 mt-0.5">/week · EBITDA-anchored</div>
                          <div className="text-[9px] text-emerald-600 mt-1 leading-tight">
                            {recommendation.ebitda_improvement_pct != null
                              ? `+${recommendation.ebitda_improvement_pct.toFixed(1)} EBITDA pts`
                              : "EBITDA impact"}
                            {" × "}{form.project_type ?? "capture"} rate
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-sm font-medium text-muted-foreground/60 leading-none mt-1">—</div>
                          <div className="text-[9px] text-muted-foreground mt-1 leading-tight">
                            Add sector + EBITDA margin + project type to unlock
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* ── MANUAL PRICE ADJUSTMENT SLIDER ───────────────────── */}
                  <div className="rounded-lg border px-3 py-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Manual adjustment</span>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setManualDelta(d => d - 500)}
                          className="w-6 h-6 rounded border text-sm font-bold flex items-center justify-center hover:bg-muted transition-colors">−</button>
                        <span className={`text-sm font-mono font-bold w-20 text-center ${manualDelta > 0 ? "text-emerald-600" : manualDelta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                          {manualDelta === 0 ? "±€0" : `${manualDelta > 0 ? "+" : ""}€${Math.abs(manualDelta).toLocaleString("it-IT")}`}
                        </span>
                        <button onClick={() => setManualDelta(d => d + 500)}
                          className="w-6 h-6 rounded border text-sm font-bold flex items-center justify-center hover:bg-muted transition-colors">+</button>
                        {manualDelta !== 0 && (
                          <button onClick={() => setManualDelta(0)}
                            className="text-[10px] text-muted-foreground hover:text-foreground ml-1 underline">reset</button>
                        )}
                      </div>
                    </div>
                    <input type="range" min={-20000} max={20000} step={500} value={manualDelta}
                      onChange={e => setManualDelta(Number(e.target.value))}
                      className="w-full h-1.5 rounded accent-primary cursor-pointer" />
                    <div className="flex justify-between text-[9px] text-muted-foreground">
                      <span>−€20k</span><span>0</span><span>+€20k</span>
                    </div>
                  </div>

                  {/* ── ADJUSTMENTS WATERFALL ────────────────────────────── */}
                  {(() => {
                    const steps: { label: string; reason: string; multiplier: number; result: number }[] = [];

                    if (recommendation.geo_multiplier !== 1.0) {
                      const pct = ((recommendation.geo_multiplier - 1) * 100);
                      const sign = pct > 0 ? "+" : "";
                      steps.push({
                        label: `Geography — ${form.region}`,
                        reason: `${form.region} market carries a ${sign}${pct.toFixed(0)}% regional rate adjustment`,
                        multiplier: recommendation.geo_multiplier,
                        result: recommendation.geo_adjusted,
                      });
                    }

                    if (recommendation.ownership_multiplier !== 1.0) {
                      const pct = ((recommendation.ownership_multiplier - 1) * 100);
                      const sign = pct > 0 ? "+" : "";
                      steps.push({
                        label: "Ownership — Non-PE",
                        reason: `Non-PE clients receive a ${sign}${pct.toFixed(0)}% ownership adjustment vs PE baseline`,
                        multiplier: recommendation.ownership_multiplier,
                        result: recommendation.ownership_adjusted,
                      });
                    }

                    if (recommendation.size_multiplier !== 1.0) {
                      const pct = ((recommendation.size_multiplier - 1) * 100);
                      const sign = pct > 0 ? "+" : "";
                      const bandLabel = settings?.revenue_band_multipliers.find(b => b.value === form.revenue_band)?.label ?? form.revenue_band;
                      steps.push({
                        label: `Revenue — ${bandLabel}`,
                        reason: `Revenue band below €1B target applies a ${sign}${pct.toFixed(0)}% size adjustment`,
                        multiplier: recommendation.size_multiplier,
                        result: recommendation.size_adjusted,
                      });
                    }

                    if (recommendation.sensitivity_multiplier !== 1.0) {
                      const pct = ((recommendation.sensitivity_multiplier - 1) * 100);
                      const sign = pct > 0 ? "+" : "";
                      const sensLabels: Record<string, string> = {
                        low: "Low sensitivity — client not price-conscious",
                        high: "High sensitivity — competitive / budget pressure",
                      };
                      steps.push({
                        label: `Sensitivity — ${form.price_sensitivity}`,
                        reason: sensLabels[form.price_sensitivity] ?? `Price sensitivity applies a ${sign}${pct.toFixed(0)}% adjustment`,
                        multiplier: recommendation.sensitivity_multiplier,
                        result: recommendation.sensitivity_adjusted,
                      });
                    }

                    if (steps.length === 0) return (
                      <div className="text-xs text-muted-foreground text-center py-1 italic">
                        No adjustments — case matches the baseline profile
                      </div>
                    );

                    return (
                      <div className="border rounded-lg overflow-hidden">
                        <div className="bg-muted/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          Adjustments
                        </div>
                        <div className="divide-y">
                          {steps.map((step, i) => {
                            const pct = ((step.multiplier - 1) * 100);
                            const isPositive = pct > 0;
                            return (
                              <div key={i} className="px-3 py-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-medium">{step.label}</span>
                                  <div className="flex items-center gap-2">
                                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${isPositive ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>
                                      {isPositive ? "+" : ""}{pct.toFixed(0)}%
                                    </span>
                                    <span className="text-xs font-semibold font-mono">{fmt(step.result)}</span>
                                  </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-0.5">{step.reason}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}


                  {/* ── RECOMMENDATION BRACKET ───────────────────────────── */}
                  {(() => {
                    const d = manualDelta;
                    return (
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5 px-0.5">
                          Negotiation range
                          {(recommendation.history_anchor || recommendation.comparable_wins.length > 0) && (
                            <span className="ml-1 font-normal normal-case">(blended with historical data)</span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          <div className="text-center p-2.5 bg-muted/30 rounded-lg">
                            <div className="text-[10px] text-muted-foreground uppercase font-bold">Low</div>
                            <div className="text-base font-bold text-muted-foreground">{fmt(recommendation.low_weekly + d)}</div>
                            <div className="text-[10px] text-muted-foreground">/week</div>
                          </div>
                          <div className="text-center p-2.5 bg-primary/10 rounded-lg border border-primary/20">
                            <div className="text-[10px] text-primary uppercase font-bold">Target</div>
                            <div className="text-xl font-bold text-primary">{fmt(recommendation.target_weekly + d)}</div>
                            <div className="text-[10px] text-muted-foreground">/week</div>
                          </div>
                          <div className="text-center p-2.5 bg-amber-50 rounded-lg border border-amber-100">
                            <div className="text-[10px] text-amber-700 uppercase font-bold">High</div>
                            <div className="text-base font-bold text-amber-600">{fmt(recommendation.high_weekly + d)}</div>
                            <div className="text-[10px] text-muted-foreground">/week</div>
                          </div>
                        </div>

                        {/* fund anchor note */}
                        {recommendation.history_anchor && (
                          <div className="text-[10px] text-blue-600 mt-1 px-0.5">
                            Fund anchor ({recommendation.fund_proposals_count} prior proposals): {fmt(recommendation.history_anchor)}/wk blended in
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Posture + confidence */}
                  <div className="flex items-center justify-between text-xs px-0.5">
                    <PostureBadge posture={recommendation.posture} />
                    <span className="text-muted-foreground">
                      Confidence: <ConfidenceBadge label={recommendation.confidence_label} />
                    </span>
                  </div>

                  {/* ── WIN PROBABILITY + MARGIN + COST FLOOR ────────────── */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <div className="text-center rounded-lg bg-muted/30 px-2 py-2">
                      <div className="text-[9px] uppercase font-bold text-muted-foreground">Win Prob</div>
                      <div className={`text-base font-bold mt-0.5 ${recommendation.win_probability != null && recommendation.win_probability >= 0.5 ? "text-emerald-600" : "text-amber-600"}`}>
                        {recommendation.win_probability != null ? `${Math.round(recommendation.win_probability * 100)}%` : "—"}
                      </div>
                      {recommendation.win_probability != null && (
                        <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${recommendation.win_probability >= 0.5 ? "bg-emerald-500" : "bg-amber-500"}`}
                            style={{ width: `${recommendation.win_probability * 100}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="text-center rounded-lg bg-muted/30 px-2 py-2">
                      <div className="text-[9px] uppercase font-bold text-muted-foreground">Exp. Margin</div>
                      <div className="text-base font-bold text-emerald-600 mt-0.5">
                        {recommendation.expected_margin_pct != null && recommendation.expected_margin_pct > 0
                          ? `${recommendation.expected_margin_pct.toFixed(0)}%` : "—"}
                      </div>
                    </div>
                    <div className="text-center rounded-lg bg-muted/30 px-2 py-2">
                      <div className="text-[9px] uppercase font-bold text-muted-foreground">Cost Floor</div>
                      <div className="text-xs font-bold mt-0.5 text-muted-foreground">
                        {recommendation.cost_floor_weekly > 0 ? fmt(recommendation.cost_floor_weekly) : "—"}
                      </div>
                    </div>
                  </div>

                  {/* ── LAYER TRACE ──────────────────────────────────────── */}
                  {recommendation.layer_trace.length > 0 && (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="bg-muted/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        Pricing Layers
                      </div>
                      <div className="divide-y">
                        {recommendation.layer_trace.map((lt, i) => (
                          <div key={i} className="px-3 py-1.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono">{lt.layer}</span>
                                <span className="text-xs font-medium">{lt.label}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {lt.layer !== "OUT" && lt.delta_pct !== 0 && (
                                  <span className={`text-[9px] font-mono font-bold px-1 py-0.5 rounded ${lt.delta_pct > 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                                    {lt.delta_pct > 0 ? "+" : ""}{lt.delta_pct.toFixed(0)}%
                                  </span>
                                )}
                                <span className="text-xs font-semibold font-mono">{fmt(lt.value)}</span>
                              </div>
                            </div>
                            {lt.note && <p className="text-[9px] text-muted-foreground mt-0.5 leading-relaxed">{lt.note}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Totals row */}
                  {form.duration_weeks > 0 && (
                    <div className="grid grid-cols-3 gap-1 text-[10px] text-center text-muted-foreground bg-muted/20 rounded p-2">
                      <div>Low total<br /><span className="font-semibold text-foreground text-xs">{fmt(recommendation.low_total + manualDelta * form.duration_weeks)}</span></div>
                      <div className="border-x">Target total<br /><span className="font-bold text-primary text-xs">{fmt(recommendation.target_total + manualDelta * form.duration_weeks)}</span></div>
                      <div>High total<br /><span className="font-semibold text-amber-600 text-xs">{fmt(recommendation.high_total + manualDelta * form.duration_weeks)}</span></div>
                    </div>
                  )}

                  {/* ── DISCOUNT MODULE ──────────────────────────────────── */}
                  {caseDiscounts.length > 0 && (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="bg-muted/30 px-3 py-1.5 text-[10px] font-bold uppercase text-muted-foreground tracking-wide">
                        Discounts
                      </div>
                      <div className="divide-y">
                        {caseDiscounts.map(d => (
                          <div key={d.id} className="flex items-center gap-2 px-3 py-1.5">
                            <input
                              type="checkbox"
                              checked={d.enabled}
                              onChange={e => setCaseDiscounts(prev => prev.map(x => x.id === d.id ? { ...x, enabled: e.target.checked } : x))}
                              className="h-3.5 w-3.5 rounded"
                            />
                            <span className="text-xs flex-1 text-muted-foreground">{d.name}</span>
                            <div className="relative flex items-center">
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max="100"
                                value={d.pct}
                                onChange={e => setCaseDiscounts(prev => prev.map(x => x.id === d.id ? { ...x, pct: parseFloat(e.target.value) || 0 } : x))}
                                disabled={!d.enabled}
                                className="h-6 w-14 text-xs text-center font-mono border rounded pr-4 disabled:opacity-40 bg-background"
                              />
                              <span className="absolute right-1.5 text-[10px] text-muted-foreground">%</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {totalDiscountPct > 0 && (
                        <div className="bg-muted/20 px-3 py-1.5 flex justify-between items-center border-t">
                          <span className="text-xs text-muted-foreground">Total discount</span>
                          <span className="text-xs font-semibold">{totalDiscountPct.toFixed(1)}%</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Net price */}
                  {totalDiscountPct > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-center p-2.5 bg-emerald-50 rounded-lg border border-emerald-200">
                        <div className="text-[10px] text-emerald-700 uppercase font-bold">Net / week</div>
                        <div className="text-lg font-bold text-emerald-700">{fmt(netTargetWeekly)}</div>
                      </div>
                      <div className="text-center p-2.5 bg-emerald-50 rounded-lg border border-emerald-200">
                        <div className="text-[10px] text-emerald-700 uppercase font-bold">Net total</div>
                        <div className="text-lg font-bold text-emerald-700">{fmt(netTargetTotal)}</div>
                      </div>
                    </div>
                  )}

                  {/* ── GROSS MARGIN ─────────────────────────────────────── */}
                  {totalWeeklyCost > 0 && (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="bg-muted/30 px-3 py-1.5 text-[10px] font-bold uppercase text-muted-foreground tracking-wide">
                        Gross Margin
                      </div>
                      <div className="px-3 py-2 space-y-1 text-xs">
                        <div className="flex justify-between text-muted-foreground">
                          <span>Net revenue</span>
                          <span className="font-mono">{fmt(netRevenue)}</span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Staff cost ({fmt(totalWeeklyCost)}/wk)</span>
                          <span className="font-mono text-red-600">− {fmt(totalProjectCost)}</span>
                        </div>
                        <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                          <span>Gross margin</span>
                          <span className={`font-mono ${grossMarginEur >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {fmt(grossMarginEur)} ({grossMarginPct.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── WARNINGS ─────────────────────────────────────────── */}
                  {recommendation.warnings.length > 0 && (
                    <div className="space-y-1">
                      {recommendation.warnings.map((w, i) => (
                        <div key={i} className={`flex items-start gap-1.5 text-xs rounded p-2 ${w.startsWith("⚠") ? "bg-amber-50 text-amber-800 border border-amber-200" : "bg-blue-50 text-blue-800 border border-blue-200"}`}>
                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                          {w}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Fund history mini-table */}
                  {fundProposals.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase font-bold text-muted-foreground mb-1">
                        Prior proposals for {form.fund_name}
                      </div>
                      <div className="space-y-1">
                        {fundProposals.map(p => (
                          <div key={p.id} className="flex items-center justify-between text-xs bg-muted/20 rounded px-2 py-1">
                            <span className="text-muted-foreground">{p.proposal_date?.slice(0, 7)}</span>
                            <span className="truncate max-w-[100px] mx-1 text-muted-foreground">{p.project_name}</span>
                            <span className="font-semibold">{fmt(p.weekly_price)}</span>
                            <OutcomeBadge outcome={p.outcome} />
                          </div>
                        ))}
                      </div>
                      {recommendation.fund_avg_weekly && (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          Avg: <span className="font-semibold">{fmt(recommendation.fund_avg_weekly)}</span>
                          {recommendation.fund_win_rate != null && (
                            <> • Win rate: <span className="font-semibold">{Math.round(recommendation.fund_win_rate * 100)}%</span></>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Advisory */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-blue-700 uppercase mb-1 flex items-center gap-1">
                      <Info className="w-3 h-3" /> Advisory
                    </div>
                    <p className="text-xs text-blue-800 leading-relaxed">{recommendation.advisory}</p>
                  </div>

                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
