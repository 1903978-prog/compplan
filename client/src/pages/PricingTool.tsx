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
  type OwnershipType, type StrategicIntent, type ProcurementInvolvement, type LayerTrace,
  type CountryBenchmarkRow,
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
  aspiration_ebitda_pct?: number | null;
  company_revenue_m?: number | null;      // Company total revenue (€M)
  aspiration_ebitda_eur?: number | null;  // Incremental aspiration EBITDA (€, absolute)
  // Comprehensive analysis (v2)
  relationship_type?: string | null;      // new / repeat / strategic
  decision_maker?: string | null;         // CEO / CFO / COO / PE partner / Board
  budget_disclosed_eur?: number | null;   // client-disclosed budget ceiling (€)
  incumbent_advisor?: string | null;      // name of existing advisor if any
  geographic_scope?: string | null;       // single / multi / global
  value_driver?: string | null;           // key business lever (free text)
  differentiation?: string | null;        // why us vs competition (free text)
  risk_flags?: string[] | null;           // regulatory / timing / team / reputation
  problem_statement?: string | null;      // what the project actually solves
  expected_impact_eur?: number | null;    // expected € impact on client's P&L
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

const TEAM_PRESETS: Record<string, { label: string; config: { match: string; count: number; days: number }[] }> = {
  "1+2": {
    label: "1+2 (Partner + EM + 2 ASC)",
    config: [{ match: "Partner", count: 1, days: 1 }, { match: "Manager EXT", count: 1, days: 5 }, { match: "ASC IN", count: 2, days: 5 }],
  },
  "1+1": {
    label: "1+1 (Partner + EM + 1 ASC)",
    config: [{ match: "Partner", count: 1, days: 1 }, { match: "Manager EXT", count: 1, days: 5 }, { match: "ASC IN", count: 1, days: 5 }],
  },
  "1+2pt": {
    label: "1+2 part time (Partner + EM + 2 ASC, 3d/wk)",
    config: [{ match: "Partner", count: 1, days: 1 }, { match: "Manager EXT", count: 1, days: 3 }, { match: "ASC IN", count: 2, days: 3 }],
  },
  "1+1pt": {
    label: "1+1 part time (Partner + EM + 1 ASC, 3d/wk)",
    config: [{ match: "Partner", count: 1, days: 1 }, { match: "Manager EXT", count: 1, days: 3 }, { match: "ASC IN", count: 1, days: 3 }],
  },
  "other": { label: "Other (manual)", config: [] },
};

function buildStaffingFromPreset(preset: string, settings: PricingSettings): StaffingLine[] {
  const p = TEAM_PRESETS[preset];
  if (!p || p.config.length === 0) return [];
  const lines: StaffingLine[] = [];
  for (const cfg of p.config) {
    const role = settings.roles.find(r => r.role_name.toLowerCase().includes(cfg.match.toLowerCase()));
    if (!role) continue;
    lines.push({ role_id: role.id, role_name: role.role_name, days_per_week: cfg.days, daily_rate_used: role.default_daily_rate, count: cfg.count });
  }
  return lines;
}

function clientPrefix(name: string): string {
  return (name || "CLI").replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");
}

// ── Benchmark helpers ─────────────────────────────────────────────────────────

const REGION_TO_COUNTRY: Record<string, string[]> = {
  IT: ["Italy", "IT"],
  FR: ["France", "FR"],
  DE: ["Germany", "DACH", "DE"],
  UK: ["United Kingdom", "UK"],
  US: ["United States", "US"],
  Asia: ["Asia"],
  "Middle East": ["Middle East"],
};

function getBandForPrice(
  weeklyPrice: number,
  region: string,
  benchmarks: CountryBenchmarkRow[]
): "green" | "yellow" | "red" | null {
  const aliases = REGION_TO_COUNTRY[region] ?? [region];
  const bench = benchmarks.find(b =>
    aliases.some(a => a.toLowerCase() === b.country.toLowerCase()) &&
    (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"))
  );
  if (!bench || bench.yellow_high === 0) return null;
  if (weeklyPrice >= bench.green_low && weeklyPrice <= bench.green_high) return "green";
  if (weeklyPrice >= bench.yellow_low && weeklyPrice <= bench.yellow_high) return "yellow";
  return "red";
}

function parsePricePaste(text: string): CountryBenchmarkRow[] {
  const toNum = (s: string): number => {
    const clean = s.replace(/[€$£,\s]/g, "").toLowerCase();
    const m = clean.match(/(\d+(?:\.\d+)?)(k|m)?/);
    if (!m) return 0;
    return Math.round(parseFloat(m[1]) * (m[2] === "k" ? 1000 : m[2] === "m" ? 1_000_000 : 1));
  };
  const extractNums = (s: string): number[] =>
    [...s.matchAll(/\d+(?:[.,]\d+)?(?:\s*k|\s*m)?/gi)].map(m => toNum(m[0])).filter(n => n > 0);

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // ── Mode 1: Structured (pipe or tab separated) ─────────────────────────────
  const structured: CountryBenchmarkRow[] = [];
  for (const line of lines) {
    const sep = line.includes("|") ? "|" : line.includes("\t") ? "\t" : null;
    if (!sep) continue;
    const cells = line.split(sep).map(c => c.trim()).filter(Boolean);
    if (cells.length < 4) continue;
    const country = cells[0];
    if (!country || /^[-=]+$/.test(country) || country.toLowerCase() === "country") continue;
    const parameter = cells[1] ?? "";
    const greenStr = cells[2] ?? "";
    const yellowStr = cells[3] ?? "";
    const decisStr = cells.length > 5 ? cells[5] : (cells[4] ?? "");
    const gNums = greenStr.split(/[–\-]/).map(toNum).filter(n => n > 0);
    const green_low = gNums[0] ?? 0;
    const green_high = gNums[1] ?? green_low;
    const yHalves = yellowStr.split("/");
    const yL = (yHalves[0] ?? "").split(/[–\-]/).map(toNum).filter(n => n > 0);
    const yH = (yHalves[1] ?? "").split(/[–\-]/).map(toNum).filter(n => n > 0);
    const yellow_low = yL.length > 0 ? Math.min(...yL) : 0;
    const yellow_high = yH.length > 0 ? Math.max(...yH) : 0;
    const dM = decisStr.match(/(\d+(?:\.\d+)?)/);
    const decisiveness_pct = dM ? parseFloat(dM[1]) : 25;
    if (green_low === 0 && yellow_low === 0) continue;
    structured.push({ country, parameter, yellow_low, green_low, green_high, yellow_high, decisiveness_pct });
  }
  if (structured.length > 0) return structured;

  // ── Mode 2: Free-form country sections ─────────────────────────────────────
  // Accepts text like:
  //   Italy
  //   Weekly fee: green €28k–34k, yellow €25k–28k / €34k–38k, 25%
  //   Total project cost: strongest wins €300k–410k, mixed €150k–300k / €410k–600k, 25%
  const PARAM_MAP: [RegExp, string][] = [
    [/weekly\s*fee|fee\s*weekly|\bwkly\b/i, "Weekly fee"],
    [/total\s*(project\s*)?cost|total\s*fee|project\s*cost/i, "Total project cost"],
    [/daily\s*rate/i, "Daily rate"],
  ];
  const freeRows: CountryBenchmarkRow[] = [];
  let currentCountry = "";
  for (const line of lines) {
    // Country detector: short line, starts uppercase, no € or | symbols
    if (line.length < 40 && !line.includes("€") && !line.includes("|") && !line.includes(":")) {
      const stripped = line.replace(/[:\-\*\#]+\s*$/, "").trim();
      if (/^[A-Z]/.test(stripped) && stripped.split(/\s+/).length <= 3) {
        currentCountry = stripped;
        continue;
      }
    }
    // Also detect "Italy:" lines (country name + colon only)
    const countryColon = line.match(/^([A-Z][a-zA-Z\s]{1,20})\s*:\s*$/);
    if (countryColon) { currentCountry = countryColon[1].trim(); continue; }

    if (!currentCountry) continue;

    // Detect parameter
    let parameter = "";
    for (const [rx, label] of PARAM_MAP) {
      if (rx.test(line)) { parameter = label; break; }
    }
    if (!parameter) continue;

    // Find green band from keywords
    let green_low = 0, green_high = 0, yellow_low = 0, yellow_high = 0;
    const gMatch = line.match(/(?:green|strong(?:est)?|wins?|optimal|cluster)[^€\d]*([€\d][^\n,;|]+)/i);
    if (gMatch) {
      const gn = gMatch[1].split(/[–\-]/).map(toNum).filter(n => n > 0);
      green_low = gn[0] ?? 0; green_high = gn[1] ?? green_low;
    }
    // Yellow-low from "mixed/caution/yellow €X–Y"
    const yLMatch = line.match(/(?:yellow|mixed|caution)[^€\d]*([€\d][^\/,;|\n]+)/i);
    if (yLMatch) {
      const yn = yLMatch[1].split(/[–\-]/).map(toNum).filter(n => n > 0);
      yellow_low = Math.min(...yn);
      if (yn.length > 1 && yellow_high === 0) yellow_high = Math.max(...yn);
    }
    // Yellow-high / red threshold from "above €X" or "risk above €X"
    const yHMatch = line.match(/(?:above|high.?risk|red|danger|avoid)[^\d€]*([€\d][\d.,k]+)/i);
    if (yHMatch) yellow_high = toNum(yHMatch[1]);

    // Fallback: just use sorted nums
    if (green_low === 0) {
      const allN = extractNums(line).sort((a, b) => a - b);
      if (allN.length >= 4) [yellow_low, green_low, green_high, yellow_high] = allN;
      else if (allN.length === 3) { yellow_low = allN[0]; green_low = allN[0]; green_high = allN[1]; yellow_high = allN[2]; }
      else if (allN.length === 2) { green_low = allN[0]; green_high = allN[1]; }
    }
    if (!yellow_low) yellow_low = green_low;
    if (!yellow_high) yellow_high = green_high;

    const dM = line.match(/(\d+(?:\.\d+)?)\s*%/);
    const decisiveness_pct = dM ? parseFloat(dM[1]) : 25;

    if (green_low === 0) continue;
    freeRows.push({ country: currentCountry, parameter, yellow_low, green_low, green_high, yellow_high, decisiveness_pct });
  }
  return freeRows;
}

function emptyCase(): PricingCase {
  return {
    project_name: "", client_name: "", fund_name: "CARLYLE",
    region: "IT", pe_owned: true, revenue_band: "above_1b",
    price_sensitivity: "medium", duration_weeks: 12, notes: "", status: "draft", staffing: [],
    project_type: null, sector: null, ebitda_margin_pct: null,
    commercial_maturity: null, urgency: null, competitive_intensity: null,
    competitor_type: null, ownership_type: null, strategic_intent: null,
    procurement_involvement: null,
    target_roi: 10, max_fees_ebitda_pct: 3,
    aspiration_ebitda_pct: null,
    company_revenue_m: null, aspiration_ebitda_eur: null,
    relationship_type: null, decision_maker: null, budget_disclosed_eur: null,
    incumbent_advisor: null, geographic_scope: null, value_driver: null,
    differentiation: null, risk_flags: null, problem_statement: null,
    expected_impact_eur: null,
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
  const [teamPreset, setTeamPreset] = useState<string>("1+2");
  const [benchmarks, setBenchmarks] = useState<CountryBenchmarkRow[]>([]);
  const [benchmarksLocal, setBenchmarksLocal] = useState<CountryBenchmarkRow[]>([]);
  const [editingBenchmarks, setEditingBenchmarks] = useState(false);
  const [savingBenchmarks, setSavingBenchmarks] = useState(false);
  const [pasteInput, setPasteInput] = useState("");
  const [pasteResult, setPasteResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [excelPaste, setExcelPaste] = useState("");
  const [excelPasteResult, setExcelPasteResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [importingExcel, setImportingExcel] = useState(false);

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

  useEffect(() => {
    setBenchmarks(settings?.country_benchmarks ?? DEFAULT_PRICING_SETTINGS.country_benchmarks ?? []);
  }, [settings]);

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
    if (settings) base.staffing = buildStaffingFromPreset("1+2", settings);
    setTeamPreset("1+2");
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

  const saveBenchmarks = async (data?: CountryBenchmarkRow[]) => {
    const toSave = data ?? benchmarksLocal;
    setSavingBenchmarks(true);
    try {
      const updated = { ...(settings ?? DEFAULT_PRICING_SETTINGS), country_benchmarks: toSave };
      await fetch("/api/pricing/settings", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      setBenchmarks(toSave);
      if (data == null) setEditingBenchmarks(false);
      toast({ title: "Benchmarks saved" });
      loadAll();
    } catch {
      toast({ title: "Failed to save benchmarks", variant: "destructive" });
    } finally {
      setSavingBenchmarks(false);
    }
  };

  const handleParsePaste = () => {
    const parsed = parsePricePaste(pasteInput);
    if (parsed.length === 0) {
      setPasteResult({ ok: false, msg: "No valid rows found — use pipe format (Italy | Weekly fee | €28k-34k | ...) or free-form (country header + 'Weekly fee: green €28k-34k, yellow €25k-28k / €34k-38k')" });
      return;
    }
    const merged = [...benchmarks];
    for (const row of parsed) {
      const idx = merged.findIndex(r =>
        r.country.toLowerCase() === row.country.toLowerCase() &&
        r.parameter.toLowerCase() === row.parameter.toLowerCase()
      );
      if (idx >= 0) merged[idx] = row; else merged.push(row);
    }
    setPasteResult({ ok: true, msg: `${parsed.length} row${parsed.length > 1 ? "s" : ""} imported — saving…` });
    setPasteInput("");
    saveBenchmarks(merged).then(() => setPasteResult({ ok: true, msg: `${parsed.length} row${parsed.length > 1 ? "s" : ""} saved` }));
  };

  const updateBenchmarkLocal = (idx: number, field: keyof CountryBenchmarkRow, value: string | number) => {
    setBenchmarksLocal(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const deleteCase = async (id: number) => {
    if (!confirm("Delete this pricing case?")) return;
    await fetch(`/api/pricing/cases/${id}`, { method: "DELETE", credentials: "include" });
    loadAll();
  };

  // Parse Excel-paste (tab-separated or comma-separated rows) into PricingProposal[]
  const parseExcelPaste = (text: string): Partial<PricingProposal>[] => {
    const rows: Partial<PricingProposal>[] = [];
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return rows;

    // Detect separator (tab preferred, else comma, else pipe)
    const sep = lines[0].includes("\t") ? "\t" : lines[0].includes("|") ? "|" : ",";

    // Normalize a header row to a column-index map
    const headerCells = lines[0].split(sep).map(c => c.trim().toLowerCase());
    const hasHeader = headerCells.some(h =>
      h.includes("project") || h.includes("client") || h.includes("weekly") ||
      h.includes("outcome") || h.includes("won") || h === "yymm");
    const colIdx: Record<string, number> = {};
    if (hasHeader) {
      headerCells.forEach((h, i) => {
        if (h.includes("yymm") || h.includes("date")) colIdx.date = i;
        else if (h.includes("won") || h.includes("outcome")) colIdx.outcome = i;
        else if (h.includes("project") && h.includes("code")) colIdx.project = i;
        else if (h.includes("client")) colIdx.client = i;
        else if (h.includes("sector") || h.includes("industry")) colIdx.sector = i;
        else if (h.includes("fund") || h.includes("pe")) colIdx.fund = i;
        else if (h.includes("revenue")) colIdx.revenue = i;
        else if (h.includes("team")) colIdx.team = i;
        else if (h.includes("total") && h.includes("amount")) colIdx.total = i;
        else if (h.includes("week") && h.includes("amount")) colIdx.weekly = i;
        else if (h.includes("nb") && h.includes("week")) colIdx.weeks = i;
        else if (h === "weeks" || h === "duration") colIdx.weeks = i;
        else if (h.includes("country")) colIdx.country = i;
      });
    }

    const startIdx = hasHeader ? 1 : 0;
    const toNum = (s: string) => {
      const n = parseFloat((s || "").replace(/[€$,\s]/g, ""));
      return isNaN(n) ? 0 : n;
    };

    for (let i = startIdx; i < lines.length; i++) {
      const cells = lines[i].split(sep).map(c => c.trim());
      if (cells.length < 4) continue;

      // Without header, assume Excel column order matches the template
      const get = (key: string, fallbackIdx: number) =>
        hasHeader ? (colIdx[key] !== undefined ? cells[colIdx[key]] : "") : cells[fallbackIdx];

      const rawDate = get("date", 0);
      let proposal_date = new Date().toISOString().slice(0, 10);
      if (/^\d{4}$/.test(rawDate)) {
        proposal_date = `20${rawDate.slice(0, 2)}-${rawDate.slice(2, 4)}-15`;
      } else if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
        proposal_date = rawDate.slice(0, 10);
      }

      const outcomeRaw = (get("outcome", 1) || "").toLowerCase();
      const outcome = outcomeRaw.includes("won") ? "won" : outcomeRaw.includes("lost") ? "lost" : "pending";

      const project_name = get("project", 2);
      if (!project_name) continue;

      const client_name = get("client", 3);
      const sector = get("sector", 4);
      const fund_name = get("fund", 5);
      const revRaw = toNum(get("revenue", 6));
      const team = get("team", 7);
      const total_fee = toNum(get("total", 9));
      const weeks = toNum(get("weeks", 11));
      const weekly_price = toNum(get("weekly", 12));
      const country = get("country", 13);

      if (!weekly_price || weekly_price < 100) continue;

      // Revenue band
      let rev_meur = revRaw;
      if (rev_meur > 0 && rev_meur < 10) rev_meur *= 1000; // BEUR shorthand
      let revenue_band = "above_1b";
      if (rev_meur > 0 && rev_meur < 100) revenue_band = "below_100m";
      else if (rev_meur < 200) revenue_band = "100m_200m";
      else if (rev_meur < 1000) revenue_band = "200m_1b";

      // Region mapping
      const CMAP: Record<string, string> = {
        "italy": "IT", "usa": "US", "united states": "US", "united kingdom": "UK", "uk": "UK",
        "germany": "DE", "france": "FR", "switzerland": "DE", "austria": "DE",
        "netherlands": "DE", "the netherlands": "DE", "belgium": "FR",
        "luxembourg": "FR", "luxemburg": "FR", "czech republic": "DE",
        "uae": "Middle East", "saudi arabia": "Middle East",
        "japan": "Asia", "indonesia": "Asia", "the phillipines": "Asia", "philippines": "Asia",
      };
      const region = CMAP[country.toLowerCase()] ?? "IT";

      const pe_owned = !!(fund_name && !/n\/a|publicly|independent|sovereign/i.test(fund_name));

      rows.push({
        proposal_date, project_name, client_name, fund_name,
        region, pe_owned, revenue_band, duration_weeks: weeks || 0,
        weekly_price, total_fee: total_fee || weekly_price * (weeks || 0), outcome,
        notes: `Sector: ${sector}; Team: ${team}; Revenue: ${revRaw}; Origin: ${country}`,
      } as any);
    }
    return rows;
  };

  const handleExcelImport = async () => {
    const parsed = parseExcelPaste(excelPaste);
    if (parsed.length === 0) {
      setExcelPasteResult({ ok: false, msg: "No valid rows — tab-separated expected (copy from Excel)" });
      return;
    }
    setImportingExcel(true);
    try {
      let inserted = 0, skipped = 0;
      for (const p of parsed) {
        const existing = proposals.find(x =>
          x.project_name === p.project_name &&
          x.client_name === p.client_name
        );
        if (existing) { skipped++; continue; }
        const payload = { ...p, pe_owned: p.pe_owned ? 1 : 0 };
        const res = await fetch("/api/pricing/proposals", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) inserted++;
      }
      setExcelPasteResult({ ok: true, msg: `Imported ${inserted}, skipped ${skipped} duplicates` });
      setExcelPaste("");
      loadAll();
    } catch {
      setExcelPasteResult({ ok: false, msg: "Import failed" });
    } finally {
      setImportingExcel(false);
    }
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

  // Rate matrix min/max for current case (used by waterfall + commercial analysis)
  const { minFeeWeekly, maxFeeWeekly } = useMemo(() => {
    if (!settings) return { minFeeWeekly: 0, maxFeeWeekly: Infinity };
    const regionMap: Record<string, string> = { IT: "Italy", FR: "France", DE: "DACH", UK: "UK", US: "US" };
    const matrixRegion = regionMap[form.region] ?? "Italy";
    const clientType = form.pe_owned
      ? (form.revenue_band === "above_1b" ? "PE >€1B"
        : form.revenue_band === "200m_1b" ? "PE €200M-€1B"
        : "PE <€200M")
      : (form.revenue_band === "above_1b" || form.revenue_band === "200m_1b" ? "Family >€200M"
        : form.revenue_band === "100m_200m" ? "Family €100M-€200M"
        : "Family <€100M");
    const matrixRow = settings.rate_matrix?.find(r => r.client_type === clientType);
    const matrixCell = matrixRow?.rates?.[matrixRegion];
    return {
      minFeeWeekly: matrixCell && !matrixCell.avoid ? matrixCell.min_weekly : 0,
      maxFeeWeekly: matrixCell && !matrixCell.avoid ? matrixCell.max_weekly : Infinity,
    };
  }, [settings, form.region, form.pe_owned, form.revenue_band]);

  // NWF = target after discounts, clamped to country min/max
  const nwfRaw = recommendation ? Math.round(recommendation.target_weekly * netMultiplier) : 0;
  const nwfClamped = nwfRaw > 0
    ? Math.max(
        minFeeWeekly > 0 ? minFeeWeekly : nwfRaw,
        Math.min(maxFeeWeekly < Infinity ? maxFeeWeekly : nwfRaw, nwfRaw)
      )
    : 0;
  const tnf = nwfClamped * (form.duration_weeks || 0);

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
            <Button onClick={() => setShowHistoryForm(true)}>
              <Plus className="w-4 h-4 mr-2" /> Import Excel / Paste
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
                      <TableHead className="w-14 text-center">Band</TableHead>
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
                        <TableCell className="text-center">
                          {(() => {
                            const price = c.recommendation?.target_weekly;
                            if (!price) return <span className="text-muted-foreground text-xs">—</span>;
                            const band = getBandForPrice(price, c.region, benchmarks);
                            if (!band) return <span className="text-muted-foreground text-xs">—</span>;
                            const cfg = band === "green"
                              ? { cls: "bg-emerald-500", label: `Green band (${fmt(price)}/wk)` }
                              : band === "yellow"
                              ? { cls: "bg-amber-400", label: `Yellow band (${fmt(price)}/wk)` }
                              : { cls: "bg-red-500", label: `Red band (${fmt(price)}/wk)` };
                            return <span className={`inline-block w-3 h-3 rounded-full ${cfg.cls}`} title={cfg.label} />;
                          })()}
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
                  <CardTitle className="text-base">Import Excel / Paste Win-Loss Data</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Copy rows from Excel (select cells → Ctrl+C) and paste here. First row can be headers.
                    Expected columns: YYMM, Won/Lost, Project Code, Client Name, Sector, Fund, Revenue (MEUR),
                    Team Size, Team Size2, Total Amount, Currency, Nb of weeks, Weekly Amount, Client Country.
                  </p>
                  <Textarea
                    value={excelPaste}
                    onChange={e => { setExcelPaste(e.target.value); setExcelPasteResult(null); }}
                    placeholder={"Paste here — tab-separated rows from Excel:\n2210\tLost\tARX00\tArxada AG\tPharma / Healthcare\tBain / Cinven\t2.4\tEM+1\t1\t357143\tEUR\t12\t29761\tSwitzerland"}
                    className="text-xs font-mono resize-none"
                    rows={8}
                  />
                  <div className="flex items-center gap-3">
                    <Button onClick={handleExcelImport} disabled={!excelPaste.trim() || importingExcel} size="sm">
                      {importingExcel ? "Importing…" : "Import & Save"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setShowHistoryForm(false); setExcelPaste(""); setExcelPasteResult(null); }}>
                      Cancel
                    </Button>
                    {excelPasteResult && (
                      <span className={`text-xs font-medium ${excelPasteResult.ok ? "text-emerald-600" : "text-destructive"}`}>
                        {excelPasteResult.msg}
                      </span>
                    )}
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
                  <Button onClick={() => setShowHistoryForm(true)}><Plus className="w-4 h-4 mr-2" /> Import Excel / Paste</Button>
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

            {/* ── Country Benchmarks ──────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Country Benchmarks</CardTitle>
                  <div className="flex gap-2">
                    {editingBenchmarks ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setBenchmarksLocal(prev => [...prev, {
                          country: "", parameter: "Weekly fee",
                          yellow_low: 0, green_low: 0, green_high: 0, yellow_high: 0, decisiveness_pct: 25,
                        }])}>
                          <Plus className="w-3.5 h-3.5 mr-1" /> Add Row
                        </Button>
                        <Button size="sm" onClick={() => saveBenchmarks()} disabled={savingBenchmarks}>
                          {savingBenchmarks ? "Saving…" : "Save"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { setBenchmarksLocal([...benchmarks]); setEditingBenchmarks(false); }}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => { setBenchmarksLocal([...benchmarks]); setEditingBenchmarks(true); }}>
                        Edit manually
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">

                {/* ── Paste import — always visible ──────────────────── */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">Paste win-loss analysis text to import</p>
                  <Textarea
                    value={pasteInput}
                    onChange={e => { setPasteInput(e.target.value); setPasteResult(null); }}
                    placeholder={
                      "Pipe format:\nItaly | Weekly fee | €28k–34k | €25k–28k / €34k–38k | <€25k / >€38k | 25%\nItaly | Total project cost | €300k–410k | €150k–300k / €410k–600k | <€150k / >€600k | 25%\n\nFree-form format:\nItaly\nWeekly fee: green €28k–34k, yellow €25k–28k / €34k–38k, 25% decisiveness\nTotal project cost: strongest wins €300k–410k, mixed €150k–300k and €410k–600k, red above €600k, 25%"
                    }
                    className="text-xs font-mono resize-none"
                    rows={5}
                  />
                  <div className="flex items-center gap-3">
                    <Button size="sm" onClick={handleParsePaste} disabled={!pasteInput.trim() || savingBenchmarks}>
                      {savingBenchmarks ? "Saving…" : "Import & Save"}
                    </Button>
                    {pasteResult && (
                      <span className={`text-xs font-medium ${pasteResult.ok ? "text-emerald-600" : "text-destructive"}`}>
                        {pasteResult.msg}
                      </span>
                    )}
                  </div>
                </div>

                {/* ── Display: per-country tables ─────────────────────── */}
                {!editingBenchmarks && (
                  benchmarks.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">No benchmarks yet — paste analysis text above to import.</p>
                  ) : (
                    <div className="space-y-4">
                      {[...new Set(benchmarks.map(b => b.country))].map(country => {
                        const rows = benchmarks.filter(b => b.country === country);
                        const fB = (n: number) => n >= 1000
                          ? `€${Math.round(n / 1000)}k`
                          : `€${n}`;
                        return (
                          <div key={country}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-xs font-bold uppercase tracking-wide text-foreground">{country}</span>
                              <div className="flex-1 border-t border-border" />
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-muted/30">
                                  <TableHead className="text-xs py-1.5">Parameter</TableHead>
                                  <TableHead className="text-xs py-1.5 text-center">🟢 Green band</TableHead>
                                  <TableHead className="text-xs py-1.5 text-center">🟡 Yellow band</TableHead>
                                  <TableHead className="text-xs py-1.5 text-center">🔴 Red band</TableHead>
                                  <TableHead className="text-xs py-1.5 text-center w-28">Decisiveness</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {rows.map((row, i) => (
                                  <TableRow key={i}>
                                    <TableCell className="text-xs py-2 font-medium">{row.parameter}</TableCell>
                                    <TableCell className="text-center py-2">
                                      <span className="bg-emerald-100 text-emerald-800 text-xs font-mono px-2 py-0.5 rounded">
                                        {fB(row.green_low)}–{fB(row.green_high)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-center py-2">
                                      <span className="bg-amber-100 text-amber-800 text-xs font-mono px-2 py-0.5 rounded">
                                        {fB(row.yellow_low)}–{fB(row.green_low)} / {fB(row.green_high)}–{fB(row.yellow_high)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-center py-2">
                                      <span className="bg-red-100 text-red-800 text-xs font-mono px-2 py-0.5 rounded">
                                        &lt;{fB(row.yellow_low)} / &gt;{fB(row.yellow_high)}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-center py-2 text-xs font-semibold">{row.decisiveness_pct}%</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}

                {/* ── Manual edit table ───────────────────────────────── */}
                {editingBenchmarks && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Edit thresholds directly (in €). Red = outside yellow bounds.</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Country</TableHead>
                          <TableHead>Parameter</TableHead>
                          <TableHead className="text-center">🟡 Yel low</TableHead>
                          <TableHead className="text-center">🟢 Grn low</TableHead>
                          <TableHead className="text-center">🟢 Grn high</TableHead>
                          <TableHead className="text-center">🟡 Yel high</TableHead>
                          <TableHead className="text-center">Decis %</TableHead>
                          <TableHead className="w-8" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {benchmarksLocal.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell><Input value={row.country} onChange={e => updateBenchmarkLocal(i, "country", e.target.value)} className="h-7 text-xs w-24" /></TableCell>
                            <TableCell><Input value={row.parameter} onChange={e => updateBenchmarkLocal(i, "parameter", e.target.value)} className="h-7 text-xs w-36" /></TableCell>
                            <TableCell><Input type="number" min="0" value={row.yellow_low || ""} onChange={e => updateBenchmarkLocal(i, "yellow_low", +e.target.value || 0)} className="h-7 text-xs font-mono text-right" /></TableCell>
                            <TableCell><Input type="number" min="0" value={row.green_low || ""} onChange={e => updateBenchmarkLocal(i, "green_low", +e.target.value || 0)} className="h-7 text-xs font-mono text-right" /></TableCell>
                            <TableCell><Input type="number" min="0" value={row.green_high || ""} onChange={e => updateBenchmarkLocal(i, "green_high", +e.target.value || 0)} className="h-7 text-xs font-mono text-right" /></TableCell>
                            <TableCell><Input type="number" min="0" value={row.yellow_high || ""} onChange={e => updateBenchmarkLocal(i, "yellow_high", +e.target.value || 0)} className="h-7 text-xs font-mono text-right" /></TableCell>
                            <TableCell><Input type="number" min="0" max="100" value={row.decisiveness_pct || ""} onChange={e => updateBenchmarkLocal(i, "decisiveness_pct", +e.target.value || 0)} className="h-7 text-xs font-mono text-right" /></TableCell>
                            <TableCell>
                              <button onClick={() => setBenchmarksLocal(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive p-1">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

              </CardContent>
            </Card>

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

      <div className="grid lg:grid-cols-[1fr,700px] gap-6 items-start">
        {/* ── LEFT COLUMN ──────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* SECTION A: Project Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Project Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {/* Client name — first */}
                <div className="space-y-1">
                  <Label className="text-xs">Client Company <span className="text-destructive">*</span></Label>
                  <Input value={form.client_name}
                    onChange={e => {
                      const name = e.target.value;
                      const pfx = clientPrefix(name);
                      // Update project_name to next sequence if it follows the old prefix pattern
                      setForm(f => {
                        const oldPfx = clientPrefix(f.client_name);
                        const isOldPattern = f.project_name.startsWith(oldPfx) && /^\d{2}$/.test(f.project_name.slice(3));
                        const seq = isOldPattern ? f.project_name.slice(3) : "01";
                        return { ...f, client_name: name, project_name: `${pfx}${seq}` };
                      });
                    }}
                    placeholder="e.g. Apple" />
                </div>
                {/* Project sequence */}
                <div className="space-y-1">
                  <Label className="text-xs">Project Sequence <span className="text-destructive">*</span></Label>
                  {(() => {
                    const pfx = clientPrefix(form.client_name);
                    const seqOptions = Array.from({ length: 9 }, (_, i) => `${pfx}${String(i + 1).padStart(2, "0")}`);
                    const currentSeq = seqOptions.includes(form.project_name) ? form.project_name : seqOptions[0];
                    return (
                      <Select value={currentSeq} onValueChange={v => setForm(f => ({ ...f, project_name: v }))}>
                        <SelectTrigger className="h-9 text-sm font-mono"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {seqOptions.map(s => <SelectItem key={s} value={s} className="font-mono">{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    );
                  })()}
                </div>
                {/* PE Owner — default CARLYLE */}
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
                {/* Team Size preset */}
                <div className="space-y-1">
                  <Label className="text-xs">Team Size</Label>
                  <Select value={teamPreset} onValueChange={v => {
                    setTeamPreset(v);
                    if (v !== "other" && settings) {
                      setForm(f => ({ ...f, staffing: buildStaffingFromPreset(v, settings) }));
                    }
                  }}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(TEAM_PRESETS).map(([k, p]) => (
                        <SelectItem key={k} value={k}>{p.label}</SelectItem>
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
                    className="text-sm resize-none" rows={2} />
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
                {/* Company total revenue */}
                <div className="space-y-1">
                  <Label className="text-xs">Company Revenue (€M)</Label>
                  <Input type="number" min="0" step="10"
                    placeholder="e.g. 500"
                    value={form.company_revenue_m ?? ""}
                    onChange={e => setForm(f => ({ ...f, company_revenue_m: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
                  {form.company_revenue_m && form.ebitda_margin_pct ? (
                    <div className="text-[9px] text-muted-foreground">
                      Computed EBITDA: €{((form.company_revenue_m * form.ebitda_margin_pct / 100) * 1_000_000).toLocaleString("it-IT")}
                    </div>
                  ) : (
                    <div className="text-[9px] text-muted-foreground">EBITDA = Revenue × Margin%</div>
                  )}
                </div>
                {/* Incremental aspiration EBITDA (absolute €) */}
                <div className="space-y-1">
                  <Label className="text-xs">Incremental Aspiration EBITDA (€)</Label>
                  <Input type="number" min="0" step="100000"
                    placeholder="e.g. 5000000"
                    value={form.aspiration_ebitda_eur ?? ""}
                    onChange={e => setForm(f => ({ ...f, aspiration_ebitda_eur: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
                  <div className="text-[9px] text-muted-foreground">Absolute €, not %. Used in TNF/Aspiration ratio below.</div>
                </div>
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
              </div>

              {/* ── Comprehensive Analysis Fields ────────────────────────────── */}
              <div className="pt-3 mt-3 border-t border-dashed border-border space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Comprehensive Case Analysis</div>
                <div className="grid grid-cols-2 gap-3">
                  {/* Relationship */}
                  <div className="space-y-1">
                    <Label className="text-xs">Client Relationship</Label>
                    <Select value={form.relationship_type ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, relationship_type: v === "__none__" ? null : v }))}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not set —</SelectItem>
                        <SelectItem value="new">First-time client</SelectItem>
                        <SelectItem value="repeat">Repeat client</SelectItem>
                        <SelectItem value="strategic">Strategic account</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Decision maker */}
                  <div className="space-y-1">
                    <Label className="text-xs">Primary Decision Maker</Label>
                    <Select value={form.decision_maker ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, decision_maker: v === "__none__" ? null : v }))}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not set —</SelectItem>
                        <SelectItem value="ceo">CEO</SelectItem>
                        <SelectItem value="cfo">CFO</SelectItem>
                        <SelectItem value="coo">COO</SelectItem>
                        <SelectItem value="pe_partner">PE Partner / Investor</SelectItem>
                        <SelectItem value="board">Board</SelectItem>
                        <SelectItem value="procurement">Procurement</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Geographic scope */}
                  <div className="space-y-1">
                    <Label className="text-xs">Geographic Scope</Label>
                    <Select value={form.geographic_scope ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, geographic_scope: v === "__none__" ? null : v }))}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not set —</SelectItem>
                        <SelectItem value="single">Single country</SelectItem>
                        <SelectItem value="multi">Multi-country (2-5)</SelectItem>
                        <SelectItem value="global">Global (6+ countries)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Budget disclosed */}
                  <div className="space-y-1">
                    <Label className="text-xs">Budget Disclosed (€, if any)</Label>
                    <Input type="number" min="0" step="10000"
                      placeholder="e.g. 400000"
                      value={form.budget_disclosed_eur ?? ""}
                      onChange={e => setForm(f => ({ ...f, budget_disclosed_eur: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
                  </div>
                  {/* Incumbent advisor */}
                  <div className="space-y-1">
                    <Label className="text-xs">Incumbent Advisor (if any)</Label>
                    <Input placeholder="e.g. McKinsey, internal team, none"
                      value={form.incumbent_advisor ?? ""}
                      onChange={e => setForm(f => ({ ...f, incumbent_advisor: e.target.value || null }))} />
                  </div>
                  {/* Expected impact */}
                  <div className="space-y-1">
                    <Label className="text-xs">Expected Client Impact (€)</Label>
                    <Input type="number" min="0" step="100000"
                      placeholder="e.g. 15000000"
                      value={form.expected_impact_eur ?? ""}
                      onChange={e => setForm(f => ({ ...f, expected_impact_eur: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
                    {form.expected_impact_eur && recommendation?.target_total ? (
                      <div className="text-[9px] text-muted-foreground">
                        Fees/Impact: {((recommendation.target_total / form.expected_impact_eur) * 100).toFixed(1)}%
                      </div>
                    ) : (
                      <div className="text-[9px] text-muted-foreground">€ P&amp;L impact target — drives value-based pricing</div>
                    )}
                  </div>
                </div>
                {/* Problem statement */}
                <div className="space-y-1">
                  <Label className="text-xs">Problem Statement / Scope</Label>
                  <Textarea value={form.problem_statement ?? ""}
                    onChange={e => setForm(f => ({ ...f, problem_statement: e.target.value || null }))}
                    placeholder="What business problem are we solving? E.g. 'Post-merger procurement consolidation across 3 BU targeting €8M savings in 6 months'"
                    className="text-sm resize-none" rows={2} />
                </div>
                {/* Value driver */}
                <div className="space-y-1">
                  <Label className="text-xs">Key Value Driver</Label>
                  <Input placeholder="The one business lever this work moves — e.g. 'EBITDA +3pp via cost takeout'"
                    value={form.value_driver ?? ""}
                    onChange={e => setForm(f => ({ ...f, value_driver: e.target.value || null }))} />
                </div>
                {/* Differentiation */}
                <div className="space-y-1">
                  <Label className="text-xs">Why Us vs Competition</Label>
                  <Textarea value={form.differentiation ?? ""}
                    onChange={e => setForm(f => ({ ...f, differentiation: e.target.value || null }))}
                    placeholder="Our unique edge on this case — e.g. 'Prior work with this PE, sector IP, speed to impact'"
                    className="text-sm resize-none" rows={2} />
                </div>
                {/* Risk flags */}
                <div className="space-y-1">
                  <Label className="text-xs">Risk Flags</Label>
                  <div className="flex flex-wrap gap-2">
                    {["regulatory", "timing", "team availability", "reputation", "payment risk", "scope creep"].map(flag => {
                      const active = (form.risk_flags ?? []).includes(flag);
                      return (
                        <button key={flag} type="button"
                          onClick={() => {
                            const curr = form.risk_flags ?? [];
                            const next = active ? curr.filter(f => f !== flag) : [...curr, flag];
                            setForm(f => ({ ...f, risk_flags: next.length > 0 ? next : null }));
                          }}
                          className={`text-[10px] px-2 py-1 rounded border capitalize transition-colors ${
                            active
                              ? "bg-amber-100 border-amber-400 text-amber-800"
                              : "bg-background border-border text-muted-foreground hover:bg-muted"
                          }`}>
                          {flag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SECTION B: Pricing Waterfall Chart */}
          {recommendation && (() => {
            const trace = recommendation.layer_trace;
            const base = baseWeeklyDisplay;
            const final = recommendation.target_weekly;

            // Map trace entries by normalized label (strip parenthetical suffixes like "(IT)")
            const traceByKey: Record<string, LayerTrace> = {};
            for (const lt of trace) {
              const key = lt.label.replace(/\s*\(.*?\)\s*$/, "").trim();
              traceByKey[key] = lt;
            }

            // Canonical layer sequence — always shown, even if 0% impact
            const CANONICAL = [
              "Geography",
              "Market Context",
              "Client Profile",
              "Cost Floor Applied",
              "Fund History",
              "Win/Loss Comparables",
              "Strategic Intent",
            ];

            // Build delta bars from canonical list, using trace values when present
            const bars: { label: string; start: number; end: number; note: string; deltaPct: number }[] = [];
            let prev = base;
            for (const key of CANONICAL) {
              const lt = traceByKey[key];
              if (lt) {
                bars.push({ label: key, start: prev, end: lt.value, note: lt.note, deltaPct: lt.delta_pct });
                prev = lt.value;
              } else {
                bars.push({ label: key, start: prev, end: prev, note: "No impact", deltaPct: 0 });
              }
            }

            // Single NWP bar after target (net after discounts + clamp)
            const extraBars: { label: string; start: number; end: number; color?: string; deltaPct: number }[] = [];
            const showNWFBar = totalDiscountPct > 0 || Math.abs(nwfClamped - final) > 50;
            if (showNWFBar) {
              const deltaPct = final > 0 ? ((nwfClamped - final) / final) * 100 : 0;
              extraBars.push({ label: "NWP", start: final, end: nwfClamped, color: "#059669", deltaPct });
            }
            const nwfFinal = nwfClamped > 0 ? nwfClamped : final;

            const totalBarCount = 1 + bars.length + 1 + extraBars.length + (showNWFBar ? 1 : 0);
            const allVals = [base, final, ...bars.flatMap(b => [b.start, b.end]),
              ...extraBars.flatMap(b => [b.start, b.end]), nwfFinal];
            const minV = Math.min(...allVals) * 0.92;
            const maxV = Math.max(...allVals) * 1.08;
            const range = maxV - minV || 1;

            const W = 640; const H = 180;
            const barW = Math.max(22, Math.floor((W - 60) / (totalBarCount + 1) - 4));
            const gap = Math.max(3, Math.floor((W - 60 - totalBarCount * barW) / totalBarCount));
            const xOf = (i: number) => 30 + i * (barW + gap);
            const yOf = (v: number) => H - 32 - ((v - minV) / range) * (H - 56);
            const hOf = (v1: number, v2: number) => Math.abs(yOf(v1) - yOf(v2));

            // Short labels to fit narrow bars
            const SHORT: Record<string, string> = {
              "Geography": "Geo",
              "Market Context": "Market",
              "Client Profile": "Client",
              "Cost Floor Applied": "Floor",
              "Fund History": "Fund Hist",
              "Win/Loss Comparables": "W/L Comp",
              "Strategic Intent": "Intent",
            };

            return (
              <div className="border rounded-lg p-4 bg-muted/10 space-y-2">
                <div className="text-xs font-bold uppercase text-muted-foreground tracking-wide">Pricing Waterfall</div>
                <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
                  {/* Base bar */}
                  {(() => {
                    const x = xOf(0); const y = yOf(base); const h = hOf(minV, base);
                    return <>
                      <rect x={x} y={y} width={barW} height={h} fill="#1A6571" rx="2" />
                      <text x={x + barW/2} y={y - 3} textAnchor="middle" fontSize="7" fill="#1A6571" fontWeight="bold">{fmt(base)}</text>
                      <text x={x + barW/2} y={H - 8} textAnchor="middle" fontSize="6.5" fill="#64748b">Staffing</text>
                    </>;
                  })()}
                  {/* Layer delta bars */}
                  {bars.map((b, i) => {
                    const x = xOf(i + 1);
                    const isZero = Math.abs(b.end - b.start) < 1;
                    const up = b.end >= b.start;
                    const color = isZero ? "#cbd5e1" : (up ? "#16C3CF" : "#ef4444");
                    const y = up ? yOf(b.end) : yOf(b.start);
                    const h = Math.max(2, hOf(b.start, b.end));
                    const deltaEur = b.end - b.start;
                    const sign = deltaEur >= 0 ? "+" : "";
                    const textY = up ? y - 9 : y + h + 8;
                    return (
                      <g key={i}>
                        <line x1={xOf(i) + barW} y1={yOf(b.start)} x2={x} y2={yOf(b.start)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                        <rect x={x} y={y} width={barW} height={h} fill={color} rx="2" opacity={isZero ? 0.45 : 0.85} />
                        <text x={x + barW/2} y={textY} textAnchor="middle" fontSize="7" fill={isZero ? "#94a3b8" : color} fontWeight="bold">
                          {isZero ? "—" : `${sign}${fmt(deltaEur)}`}
                        </text>
                        <text x={x + barW/2} y={textY + 6} textAnchor="middle" fontSize="5.5" fill="#94a3b8">
                          {isZero ? "0%" : `${sign}${b.deltaPct.toFixed(0)}%`}
                        </text>
                        <text x={x + barW/2} y={H - 8} textAnchor="middle" fontSize="6" fill="#64748b">{SHORT[b.label] ?? b.label}</text>
                      </g>
                    );
                  })}
                  {/* Target bar */}
                  {(() => {
                    const bi = bars.length + 1;
                    const x = xOf(bi); const y = yOf(final); const h = hOf(minV, final);
                    const prevEnd = bars[bars.length - 1]?.end ?? base;
                    return <>
                      <line x1={xOf(bi - 1) + barW} y1={yOf(prevEnd)} x2={x} y2={yOf(final)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                      <rect x={x} y={y} width={barW} height={h} fill="#1A6571" rx="2" />
                      <text x={x + barW/2} y={y - 3} textAnchor="middle" fontSize="7" fill="#1A6571" fontWeight="bold">{fmt(final)}</text>
                      <text x={x + barW/2} y={H - 8} textAnchor="middle" fontSize="6.5" fill="#64748b">{showNWFBar ? "Target" : "NWF"}</text>
                    </>;
                  })()}
                  {/* Discount / clamp bars */}
                  {extraBars.map((b, i) => {
                    const bi = bars.length + 2 + i;
                    const x = xOf(bi);
                    const up = b.end >= b.start;
                    const color = b.color ?? (up ? "#16C3CF" : "#ef4444");
                    const y = up ? yOf(b.end) : yOf(b.start);
                    const h = Math.max(2, hOf(b.start, b.end));
                    const deltaEur = b.end - b.start;
                    const sign = deltaEur >= 0 ? "+" : "";
                    const textY = up ? y - 9 : y + h + 8;
                    return (
                      <g key={i}>
                        <line x1={xOf(bi - 1) + barW} y1={yOf(b.start)} x2={x} y2={yOf(b.start)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                        <rect x={x} y={y} width={barW} height={h} fill={color} rx="2" opacity="0.85" />
                        <text x={x + barW/2} y={textY} textAnchor="middle" fontSize="7" fill={color} fontWeight="bold">
                          {sign}{fmt(deltaEur)}
                        </text>
                        <text x={x + barW/2} y={textY + 6} textAnchor="middle" fontSize="5.5" fill="#94a3b8">
                          {sign}{b.deltaPct.toFixed(0)}%
                        </text>
                        <text x={x + barW/2} y={H - 8} textAnchor="middle" fontSize="6" fill="#64748b">{b.label}</text>
                      </g>
                    );
                  })}
                  {/* NWF final bar (only when extra steps exist) */}
                  {showNWFBar && (() => {
                    const bi = bars.length + 2 + extraBars.length;
                    const x = xOf(bi); const y = yOf(nwfFinal); const h = hOf(minV, nwfFinal);
                    const prevEnd = extraBars[extraBars.length - 1]?.end ?? final;
                    return <>
                      <line x1={xOf(bi - 1) + barW} y1={yOf(prevEnd)} x2={x} y2={yOf(nwfFinal)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                      <rect x={x} y={y} width={barW} height={h} fill="#059669" rx="2" />
                      <text x={x + barW/2} y={y - 3} textAnchor="middle" fontSize="7" fill="#059669" fontWeight="bold">{fmt(nwfFinal)}</text>
                      <text x={x + barW/2} y={H - 8} textAnchor="middle" fontSize="6.5" fill="#64748b">NWF</text>
                    </>;
                  })()}
                  {/* Baseline */}
                  <line x1="25" y1={H - 22} x2={W - 5} y2={H - 22} stroke="#e2e8f0" strokeWidth="0.5" />
                </svg>
              </div>
            );
          })()}

          {/* SECTION C: Commercial Analysis (TNF rows + probability curve) */}
          {recommendation && nwfClamped > 0 && (() => {
            const cur = getCurrencyForRegion(form.region);
            const fmtC = (n: number) => cur.symbol + Math.round(n).toLocaleString("it-IT");
            const fmtK2 = (n: number) => `${cur.symbol}${Math.round(n / 1000)}k`;

            const regionMap2: Record<string, string> = { IT: "Italy", FR: "France", DE: "DACH", UK: "UK", US: "US" };
            const matrixRegion2 = regionMap2[form.region] ?? "Italy";
            const competitorBenchmarks = settings?.competitor_benchmarks ?? DEFAULT_PRICING_SETTINGS.competitor_benchmarks;

            const revenueM = form.company_revenue_m ?? 0;
            const ebitdaPct = form.ebitda_margin_pct ?? 0;
            const currentEbitda = revenueM > 0 && ebitdaPct > 0 ? revenueM * 1_000_000 * ebitdaPct / 100 : 0;
            const aspirationEur = form.aspiration_ebitda_eur ?? 0;
            const tnfEbitdaRatio = currentEbitda > 0 ? tnf / currentEbitda : null;
            const tnfAspirationRatio = aspirationEur > 0 ? tnf / aspirationEur : null;

            // Benchmark totals for this region
            const benchRows = competitorBenchmarks.map(b => {
              const minW = (b.rates as any)[matrixRegion2]?.min_weekly ?? 0;
              const maxW = (b.rates as any)[matrixRegion2]?.max_weekly ?? 0;
              const avg = ((minW + maxW) / 2) * (form.duration_weeks || 12);
              return { label: b.label, color: b.color, avg };
            }).filter(r => r.avg > 0);
            const allBenchVals = [...benchRows.map(r => r.avg), tnf];
            const benchScale = Math.max(...allBenchVals, 1) * 1.1;
            const pctBar = (v: number) => `${Math.min(100, (v / benchScale) * 100).toFixed(1)}%`;

            return (
              <div className="border rounded-lg p-4 bg-muted/10 space-y-3">
                <div className="text-xs font-bold uppercase text-muted-foreground tracking-wide">Commercial Analysis</div>
                <div className="grid grid-cols-[1fr,268px] gap-4 items-start">
                  {/* 4 rows */}
                  <div className="space-y-2">
                    {/* Row 1: TNF */}
                    <div className="flex items-center justify-between rounded bg-primary/5 border border-primary/15 px-3 py-2">
                      <span className="text-xs font-semibold text-muted-foreground">Total Net Fees (TNF)</span>
                      <span className="text-sm font-bold text-primary">
                        {fmtC(tnf)}
                        <span className="text-[10px] font-normal text-muted-foreground ml-1">({form.duration_weeks}w × {fmtC(nwfClamped)}/wk)</span>
                      </span>
                    </div>
                    {/* Row 2: Benchmark bar */}
                    <div className="rounded border px-3 py-2 space-y-1.5">
                      <div className="text-[10px] font-bold uppercase text-muted-foreground">TNF vs Market (total project, {matrixRegion2})</div>
                      {[...benchRows, { label: "Our TNF", color: "#f59e0b", avg: tnf, isOurs: true }].map((t, i) => (
                        <div key={i} className="space-y-0.5">
                          <div className="flex justify-between text-[10px] text-muted-foreground">
                            <span className={(t as any).isOurs ? "font-bold text-amber-700" : ""}>{t.label}</span>
                            <span className="font-mono">{fmtK2(t.avg)}</span>
                          </div>
                          <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: pctBar(t.avg), backgroundColor: t.color, opacity: (t as any).isOurs ? 1 : 0.55 }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Row 3: TNF/EBITDA */}
                    <div className="flex items-center justify-between rounded bg-muted/20 border px-3 py-2">
                      <span className="text-xs text-muted-foreground">TNF / Company EBITDA</span>
                      {tnfEbitdaRatio != null ? (
                        <span className="text-sm font-bold">
                          {(tnfEbitdaRatio * 100).toFixed(1)}%
                          <span className="text-[10px] font-normal text-muted-foreground ml-1">of {fmtK2(currentEbitda)}</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic">Set Revenue + EBITDA margin above</span>
                      )}
                    </div>
                    {/* Row 4: TNF/Aspiration */}
                    <div className="flex items-center justify-between rounded bg-muted/20 border px-3 py-2">
                      <span className="text-xs text-muted-foreground">TNF / Aspiration EBITDA increase</span>
                      {tnfAspirationRatio != null ? (
                        <span className="text-sm font-bold">
                          {(tnfAspirationRatio * 100).toFixed(1)}%
                          <span className="text-[10px] font-normal text-muted-foreground ml-1">of {fmtK2(aspirationEur)}</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic">Set Incremental Aspiration EBITDA above</span>
                      )}
                    </div>
                  </div>
                  {/* Band visualization (replaces Win Probability chart) */}
                  {(() => {
                    const countryAliases = REGION_TO_COUNTRY[form.region] ?? [form.region];
                    const weeklyBench = benchmarks.find(b =>
                      countryAliases.some(a => a.toLowerCase() === b.country.toLowerCase()) &&
                      (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"))
                    );
                    const totalBench = benchmarks.find(b =>
                      countryAliases.some(a => a.toLowerCase() === b.country.toLowerCase()) &&
                      (b.parameter.toLowerCase().includes("total") || b.parameter.toLowerCase().includes("cost"))
                    );

                    const BandBar = ({ bench, marker, label }: { bench: CountryBenchmarkRow | undefined; marker: number; label: string }) => {
                      if (!bench || bench.yellow_high === 0) {
                        return (
                          <div className="space-y-0.5">
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">{label}</div>
                            <div className="text-[9px] text-muted-foreground italic">No benchmark for {form.region}</div>
                          </div>
                        );
                      }
                      const rangeLow = Math.min(bench.yellow_low * 0.75, marker * 0.85);
                      const rangeHigh = Math.max(bench.yellow_high * 1.15, marker * 1.15);
                      const span = rangeHigh - rangeLow;
                      const pct = (v: number) => Math.max(0, Math.min(100, ((v - rangeLow) / span) * 100));
                      const markerPct = pct(marker);
                      const band = marker >= bench.green_low && marker <= bench.green_high
                        ? "green"
                        : marker >= bench.yellow_low && marker <= bench.yellow_high
                        ? "yellow"
                        : "red";
                      const bandLabel = band === "green" ? "In Green band" : band === "yellow" ? "In Yellow band" : "In Red band";
                      const bandColor = band === "green" ? "text-emerald-600" : band === "yellow" ? "text-amber-600" : "text-red-600";
                      return (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-bold uppercase text-muted-foreground">{label}</div>
                            <div className={`text-[10px] font-bold ${bandColor}`}>{bandLabel}</div>
                          </div>
                          <div className="relative h-6 rounded overflow-hidden border border-border">
                            {/* Red left */}
                            <div className="absolute top-0 bottom-0 bg-red-400/40" style={{ left: 0, width: `${pct(bench.yellow_low)}%` }} />
                            {/* Yellow left */}
                            <div className="absolute top-0 bottom-0 bg-amber-300/60" style={{ left: `${pct(bench.yellow_low)}%`, width: `${pct(bench.green_low) - pct(bench.yellow_low)}%` }} />
                            {/* Green middle */}
                            <div className="absolute top-0 bottom-0 bg-emerald-400/70" style={{ left: `${pct(bench.green_low)}%`, width: `${pct(bench.green_high) - pct(bench.green_low)}%` }} />
                            {/* Yellow right */}
                            <div className="absolute top-0 bottom-0 bg-amber-300/60" style={{ left: `${pct(bench.green_high)}%`, width: `${pct(bench.yellow_high) - pct(bench.green_high)}%` }} />
                            {/* Red right */}
                            <div className="absolute top-0 bottom-0 bg-red-400/40" style={{ left: `${pct(bench.yellow_high)}%`, right: 0 }} />
                            {/* Marker */}
                            <div className="absolute top-0 bottom-0 w-0.5 bg-foreground" style={{ left: `calc(${markerPct}% - 1px)` }} />
                            <div className="absolute -top-0.5 text-[9px] font-bold text-foreground whitespace-nowrap"
                                 style={{ left: `${markerPct}%`, transform: "translate(-50%, -100%)" }}>
                              ▼
                            </div>
                          </div>
                          <div className="flex justify-between text-[8px] text-muted-foreground font-mono">
                            <span>{fmtK2(rangeLow)}</span>
                            <span className="text-emerald-700">🟢 {fmtK2(bench.green_low)}–{fmtK2(bench.green_high)}</span>
                            <span>{fmtK2(rangeHigh)}</span>
                          </div>
                          <div className="text-[9px] text-center">
                            <span className="font-semibold">{fmtC(marker)}</span>
                            <span className="text-muted-foreground ml-1">({bench.decisiveness_pct}% decisiveness)</span>
                          </div>
                        </div>
                      );
                    };

                    return (
                      <div className="space-y-3">
                        <BandBar bench={weeklyBench} marker={nwfClamped} label={`Weekly fee band — ${weeklyBench?.country ?? form.region}`} />
                        <BandBar bench={totalBench} marker={tnf} label={`Total project cost band — ${totalBench?.country ?? form.region}`} />
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

          {/* SECTION B-old: Staffing moved to right column */}
          {/* Staffing Build-up — now in right column */}
          <div className="hidden">
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
          </div>{/* end hidden staffing */}

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
                : "PE <€200M")
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

        {/* ── RIGHT COLUMN: Staffing + Live Result ─────────────────────────── */}
        <div className="lg:sticky lg:top-6 space-y-4">

          {/* Staffing Build-up */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Staffing Build-up</CardTitle>
                {baseWeeklyDisplay > 0 && (
                  <span className="text-xs font-semibold text-muted-foreground">
                    Base: <span className="text-foreground">{fmt(baseWeeklyDisplay)}/wk</span>
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {settings ? (
                <div className="space-y-1">
                  <div className="grid grid-cols-[80px_1fr_1fr_60px_70px] gap-1.5 px-1 pb-1">
                    <span className="text-[9px] font-bold uppercase text-muted-foreground">Role</span>
                    <span className="text-[9px] font-bold uppercase text-muted-foreground text-center">Count</span>
                    <span className="text-[9px] font-bold uppercase text-muted-foreground text-center">d/wk</span>
                    <span className="text-[9px] font-bold uppercase text-muted-foreground text-right">Rate</span>
                    <span className="text-[9px] font-bold uppercase text-muted-foreground text-right">Weekly</span>
                  </div>
                  {STAFFING_ROLES.map(def => {
                    const adminRole = settings.roles.find(r => r.role_name.toLowerCase().includes(def.match.toLowerCase()));
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
                        setForm(f => ({ ...f, staffing: f.staffing.filter(s => s.role_id !== adminRole.id) }));
                      } else if (line) {
                        updateStaffingLine(adminRole.id, "count", newCount);
                      } else {
                        setForm(f => ({ ...f, staffing: [...f.staffing, { role_id: adminRole.id, role_name: def.label, days_per_week: def.defaultDays, daily_rate_used: rate, count: newCount }] }));
                      }
                    };
                    const setDays = (d: number) => { if (line) updateStaffingLine(adminRole.id, "days_per_week", Math.max(0.5, Math.min(5, d))); };
                    return (
                      <div key={def.label} className={`grid grid-cols-[80px_1fr_1fr_60px_70px] gap-1.5 items-center rounded px-1 py-1.5 transition-colors ${active ? "bg-primary/5 border border-primary/15" : "bg-muted/20 border border-transparent"}`}>
                        <span className={`text-xs font-semibold ${active ? "text-foreground" : "text-muted-foreground"}`}>{def.label}</span>
                        <div className="flex items-center justify-center gap-0.5">
                          <button type="button" onClick={() => setCount(count - 1)} disabled={count === 0} className="w-5 h-5 rounded border bg-background hover:bg-muted text-xs font-bold flex items-center justify-center disabled:opacity-30">−</button>
                          <span className={`w-5 text-center text-xs font-bold tabular-nums ${active ? "" : "text-muted-foreground"}`}>{count}</span>
                          <button type="button" onClick={() => setCount(count + 1)} className="w-5 h-5 rounded border bg-background hover:bg-muted text-xs font-bold flex items-center justify-center">+</button>
                        </div>
                        <div className="flex items-center justify-center gap-0.5">
                          <button type="button" onClick={() => setDays(days - 0.5)} disabled={!active || days <= 0.5} className="w-5 h-5 rounded border bg-background hover:bg-muted text-xs font-bold flex items-center justify-center disabled:opacity-30">−</button>
                          <span className={`w-7 text-center text-xs tabular-nums ${active ? "" : "text-muted-foreground/50"}`}>{active ? days : "—"}</span>
                          <button type="button" onClick={() => setDays(days + 0.5)} disabled={!active || days >= 5} className="w-5 h-5 rounded border bg-background hover:bg-muted text-xs font-bold flex items-center justify-center disabled:opacity-30">+</button>
                        </div>
                        <span className={`text-[10px] text-right tabular-nums ${active ? "text-muted-foreground" : "text-muted-foreground/40"}`}>€{rate.toLocaleString("it-IT")}/d</span>
                        <span className={`text-xs font-semibold text-right tabular-nums ${active ? "text-foreground" : "text-muted-foreground/30"}`}>{active ? fmt(weekly) : "—"}</span>
                      </div>
                    );
                  })}
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
                      <div className="flex items-center justify-between pt-2 border-t mt-1 px-1">
                        <span className="text-xs text-muted-foreground">{t.people} people · {t.days.toFixed(1)}d/wk</span>
                        <span className="font-bold text-sm">{fmt(t.weekly)}/week</span>
                      </div>
                    );
                  })()}
                </div>
              ) : <div className="text-sm text-muted-foreground">Loading roles…</div>}
            </CardContent>
          </Card>

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
                  {/* Benchmark Price */}
                  <div className="rounded-lg border-2 border-primary/40 bg-primary/5 px-4 py-3">
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-primary mb-1">Benchmark Price</div>
                        <div className="text-2xl font-bold text-primary leading-none">
                          {fmt(recommendation.target_weekly + manualDelta)}
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-0.5">/week · market-based</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] text-muted-foreground leading-tight">Base {fmt(recommendation.base_weekly)}</div>
                        <div className="text-[9px] text-muted-foreground leading-tight">→ layers applied</div>
                      </div>
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

                  {/* ── FUND WIN REFERENCE RANGES ────────────────────── */}
                  {form.fund_name?.trim() && (() => {
                    const wonSameCountry = proposals.filter(
                      p => p.fund_name?.toLowerCase().trim() === form.fund_name.toLowerCase().trim()
                        && p.region === form.region
                        && p.outcome === "won"
                        && p.weekly_price > 0
                    );
                    const wonAllCountries = proposals.filter(
                      p => p.fund_name?.toLowerCase().trim() === form.fund_name.toLowerCase().trim()
                        && p.outcome === "won"
                        && p.weekly_price > 0
                    );
                    if (wonAllCountries.length === 0) return null;
                    const minMax = (arr: typeof proposals) => ({
                      min: Math.min(...arr.map(p => p.weekly_price)),
                      max: Math.max(...arr.map(p => p.weekly_price)),
                      names: arr.map(p => p.project_name).filter(Boolean),
                    });
                    const sc = wonSameCountry.length > 0 ? minMax(wonSameCountry) : null;
                    const all = minMax(wonAllCountries);
                    return (
                      <div className="border rounded-lg overflow-hidden">
                        <div className="bg-muted/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          {form.fund_name} — Won Projects Reference
                        </div>
                        <div className="divide-y">
                          {sc && (
                            <div className="px-3 py-2">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[10px] font-semibold text-muted-foreground">Same country ({form.region})</span>
                                <span className="text-xs font-bold font-mono">
                                  {fmt(sc.min)} – {fmt(sc.max)}<span className="text-[9px] font-normal text-muted-foreground ml-1">/wk</span>
                                </span>
                              </div>
                              <div className="text-[9px] text-muted-foreground italic">{sc.names.join(" · ")}</div>
                            </div>
                          )}
                          <div className="px-3 py-2">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] font-semibold text-muted-foreground">All countries</span>
                              <span className="text-xs font-bold font-mono">
                                {fmt(all.min)} – {fmt(all.max)}<span className="text-[9px] font-normal text-muted-foreground ml-1">/wk</span>
                              </span>
                            </div>
                            <div className="text-[9px] text-muted-foreground italic">{all.names.join(" · ")}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

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
