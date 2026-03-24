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
  Users, CheckCircle, XCircle, Clock, AlertTriangle, Info, ChevronDown, ChevronUp, Eye,
} from "lucide-react";
import {
  calculatePricing, DEFAULT_PRICING_SETTINGS, REVENUE_BANDS, REGIONS,
  type PricingSettings, type PricingProposal, type StaffingLine, type PricingRecommendation,
} from "@/lib/pricingEngine";

interface PricingCase {
  id?: number;
  project_name: string;
  client_name: string;
  fund_name: string;
  industry: string;
  country: string;
  region: string;
  pe_owned: boolean;
  revenue_band: string;
  price_sensitivity: string;
  duration_weeks: number;
  notes: string;
  status: string;
  staffing: StaffingLine[];
  recommendation?: PricingRecommendation | null;
  created_at?: string;
}

const fmt = (n: number) => "€" + Math.round(n).toLocaleString("it-IT");
const fmtK = (n: number) => Math.round(n).toLocaleString("it-IT");

function emptyCase(): PricingCase {
  return {
    project_name: "", client_name: "", fund_name: "", industry: "", country: "",
    region: "Italy", pe_owned: true, revenue_band: "above_1b",
    price_sensitivity: "medium", duration_weeks: 8, notes: "", status: "draft", staffing: [],
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
  const [showCalc, setShowCalc] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [sRes, cRes, pRes] = await Promise.all([
        fetch("/api/pricing/settings", { credentials: "include" }),
        fetch("/api/pricing/cases", { credentials: "include" }),
        fetch("/api/pricing/proposals", { credentials: "include" }),
      ]);
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
    return s.roles
      .filter(r => r.active && (r.role_name === "Manager" || r.role_name === "Associate"))
      .map(r => ({
        role_id: r.id,
        role_name: r.role_name,
        days_per_week: r.role_name === "Manager" ? 5 : 4,
        daily_rate_used: r.default_daily_rate,
        count: r.role_name === "Associate" ? 2 : 1,
      }));
  };

  const openNewForm = () => {
    const base = emptyCase();
    if (settings) base.staffing = initStaffing(settings);
    setForm(base);
    setView("form");
    setShowCalc(false);
  };

  const openCase = (c: any) => {
    setForm({
      ...c,
      pe_owned: c.pe_owned === 1 || c.pe_owned === true,
      staffing: c.staffing ?? [],
    });
    setView("form");
    setShowCalc(false);
  };

  const deleteCase = async (id: number) => {
    if (!confirm("Delete this pricing case?")) return;
    await fetch(`/api/pricing/cases/${id}`, { method: "DELETE", credentials: "include" });
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
    }, settings, proposals);
  }, [form.region, form.pe_owned, form.revenue_band, form.price_sensitivity,
      form.duration_weeks, form.fund_name, form.staffing, settings, proposals]);

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

  const baseWeeklyDisplay = form.staffing.reduce((s, l) => s + l.days_per_week * l.daily_rate_used * l.count, 0);

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
          <Button onClick={openNewForm} disabled={loading}>
            <Plus className="w-4 h-4 mr-2" /> New Pricing Case
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Cases", value: cases.length, icon: Users },
            { label: "With Recommendations", value: cases.filter(c => c.recommendation).length, icon: TrendingUp },
            { label: "Avg Target / Week", value: avgTarget > 0 ? fmt(avgTarget) : "—", icon: DollarSign },
            { label: "Historical Proposals", value: proposals.length, icon: TrendingDown },
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
                        <button onClick={() => openCase(c)}
                          className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteCase(c.id)}
                          className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors">
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
                  <Label className="text-xs">Fund / Shareholder</Label>
                  <Input value={form.fund_name} onChange={e => setForm(f => ({ ...f, fund_name: e.target.value }))}
                    placeholder="e.g. Advent International" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Industry / Sector</Label>
                  <Input value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
                    placeholder="e.g. Retail, Manufacturing" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Country</Label>
                  <Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                    placeholder="e.g. Italy, Germany" />
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
                  <Label className="text-xs">PE Owned</Label>
                  <div className="flex gap-2">
                    {[true, false].map(v => (
                      <button key={String(v)}
                        onClick={() => setForm(f => ({ ...f, pe_owned: v }))}
                        className={`flex-1 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                          form.pe_owned === v ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:bg-muted"
                        }`}>
                        {v ? "Yes" : "No"}
                      </button>
                    ))}
                  </div>
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
            <CardContent className="space-y-3">
              {settings ? (
                <>
                  {settings.roles.filter(r => r.active).sort((a, b) => a.sort_order - b.sort_order).map(role => {
                    const line = form.staffing.find(s => s.role_id === role.id);
                    const enabled = !!line;
                    const weeklyRole = line ? line.days_per_week * line.daily_rate_used * line.count : 0;
                    return (
                      <div key={role.id} className={`rounded-lg border p-3 transition-colors ${enabled ? "bg-primary/5 border-primary/20" : "bg-muted/20"}`}>
                        <div className="flex items-center gap-3">
                          <input type="checkbox" checked={enabled}
                            onChange={() => toggleRole(role)}
                            className="h-4 w-4 rounded" />
                          <span className={`text-sm font-medium w-32 ${enabled ? "text-foreground" : "text-muted-foreground"}`}>
                            {role.role_name}
                          </span>
                          {enabled && line && (
                            <>
                              <div className="flex items-center gap-1">
                                <Input type="number" min="0" max="7" step="0.5"
                                  value={line.days_per_week}
                                  onChange={e => updateStaffingLine(role.id, "days_per_week", parseFloat(e.target.value) || 0)}
                                  className="h-7 w-16 text-xs text-center" />
                                <span className="text-xs text-muted-foreground">d/wk</span>
                              </div>
                              {role.role_name === "Associate" && (
                                <div className="flex items-center gap-1">
                                  <span className="text-xs text-muted-foreground">×</span>
                                  <Input type="number" min="1" max="10" step="1"
                                    value={line.count}
                                    onChange={e => updateStaffingLine(role.id, "count", parseInt(e.target.value) || 1)}
                                    className="h-7 w-14 text-xs text-center" />
                                  <span className="text-xs text-muted-foreground">staff</span>
                                </div>
                              )}
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">€</span>
                                <Input type="number" min="0" step="50"
                                  value={line.daily_rate_used}
                                  onChange={e => updateStaffingLine(role.id, "daily_rate_used", parseFloat(e.target.value) || 0)}
                                  className="h-7 w-20 text-xs text-center" />
                                <span className="text-xs text-muted-foreground">/day</span>
                              </div>
                              <span className="text-xs text-muted-foreground ml-auto">
                                = <span className="font-semibold text-foreground">{fmt(weeklyRole)}/wk</span>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {form.staffing.length > 0 && (
                    <div className="flex items-center justify-between pt-2 border-t text-sm">
                      <span className="text-muted-foreground">
                        Total staffed: {form.staffing.reduce((s, l) => s + l.days_per_week * l.count, 0).toFixed(1)} days/wk
                      </span>
                      <span className="font-bold text-base">{fmt(baseWeeklyDisplay)}/week</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-muted-foreground">Loading roles…</div>
              )}
            </CardContent>
          </Card>

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
                <div className="space-y-4">
                  {/* 3 price numbers */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center p-3 bg-muted/30 rounded-lg">
                      <div className="text-[10px] text-muted-foreground uppercase font-bold">Low</div>
                      <div className="text-lg font-bold text-muted-foreground">€{fmtK(recommendation.low_weekly)}</div>
                      <div className="text-[10px] text-muted-foreground">/week</div>
                    </div>
                    <div className="text-center p-3 bg-primary/10 rounded-lg border border-primary/20">
                      <div className="text-[10px] text-primary uppercase font-bold">Target</div>
                      <div className="text-2xl font-bold text-primary">€{fmtK(recommendation.target_weekly)}</div>
                      <div className="text-[10px] text-muted-foreground">/week</div>
                    </div>
                    <div className="text-center p-3 bg-amber-50 rounded-lg border border-amber-100">
                      <div className="text-[10px] text-amber-700 uppercase font-bold">High</div>
                      <div className="text-lg font-bold text-amber-600">€{fmtK(recommendation.high_weekly)}</div>
                      <div className="text-[10px] text-muted-foreground">/week</div>
                    </div>
                  </div>

                  {/* Posture + confidence */}
                  <div className="flex items-center justify-between text-xs">
                    <PostureBadge posture={recommendation.posture} />
                    <span className="text-muted-foreground">
                      Confidence: <ConfidenceBadge label={recommendation.confidence_label} />
                    </span>
                  </div>

                  {/* Totals */}
                  {form.duration_weeks > 0 && (
                    <div className="grid grid-cols-3 gap-1 text-[10px] text-center text-muted-foreground bg-muted/20 rounded p-2">
                      <div>Low total<br /><span className="font-semibold text-foreground text-xs">{fmt(recommendation.low_total)}</span></div>
                      <div className="border-x">Target total<br /><span className="font-bold text-primary text-xs">{fmt(recommendation.target_total)}</span></div>
                      <div>High total<br /><span className="font-semibold text-amber-600 text-xs">{fmt(recommendation.high_total)}</span></div>
                    </div>
                  )}

                  {/* Calculation breakdown (collapsible) */}
                  <div>
                    <button onClick={() => setShowCalc(v => !v)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full">
                      {showCalc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {showCalc ? "Hide" : "Show"} calculation layers
                    </button>
                    {showCalc && (
                      <div className="mt-2 space-y-1 text-xs bg-muted/20 rounded p-2 font-mono">
                        {[
                          { label: "Base staffing", val: recommendation.base_weekly },
                          { label: `× Geography (${form.region}, ×${recommendation.geo_multiplier.toFixed(2)})`, val: recommendation.geo_adjusted },
                          { label: `× Ownership (×${recommendation.ownership_multiplier.toFixed(2)})`, val: recommendation.ownership_adjusted },
                          { label: `× Revenue band (×${recommendation.size_multiplier.toFixed(2)})`, val: recommendation.size_adjusted },
                          { label: `× Sensitivity (×${recommendation.sensitivity_multiplier.toFixed(2)})`, val: recommendation.sensitivity_adjusted },
                        ].map((row, i) => (
                          <div key={i} className={`flex justify-between ${i === 4 ? "font-bold text-foreground" : "text-muted-foreground"}`}>
                            <span>{row.label}</span>
                            <span>{fmt(row.val)}</span>
                          </div>
                        ))}
                        {recommendation.history_anchor && (
                          <div className="flex justify-between text-blue-600 border-t pt-1 mt-1">
                            <span>Fund anchor</span>
                            <span>{fmt(recommendation.history_anchor)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-bold text-primary border-t pt-1 mt-1">
                          <span>→ Target</span>
                          <span>{fmt(recommendation.target_weekly)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Drivers */}
                  {recommendation.drivers.length > 0 && (
                    <div className="space-y-1">
                      {recommendation.drivers.map((d, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Info className="w-3 h-3 mt-0.5 shrink-0 text-blue-400" />
                          {d}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Warnings */}
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
