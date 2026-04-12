import React, { useState, useEffect, useMemo } from "react";
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
  Users, AlertTriangle, Eye, EyeOff, History, CheckCircle, XCircle, Info, Pencil, RefreshCw, Download, Paperclip, X,
} from "lucide-react";
import {
  calculatePricing, DEFAULT_PRICING_SETTINGS, REVENUE_BANDS, REGIONS, SECTORS, DEFAULT_PROJECT_TYPES,
  getCurrencyForRegion, formatWithCurrency, computeTNFBenchmark,
  type PricingSettings, type PricingProposal, type StaffingLine, type PricingRecommendation,
  type CompetitorBenchmark, type ProjectType, type CompetitiveIntensity, type CompetitorType,
  type OwnershipType, type StrategicIntent, type ProcurementInvolvement, type LayerTrace,
  type CountryBenchmarkRow, type PricingRegion,
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
    currency: "EUR",
    company_revenue_m: null,
    ebitda_margin_pct: null,
    expected_ebitda_growth_pct: null,
    team_size: 1,
    notes: "",
  };
}

// Fixed staffing roles shown in the build-up (display label → admin role_name substring match)
// Default full Eendigo team = 2 ASC INT + 3 EM EXT (5 people)
const STAFFING_ROLES: { label: string; match: string; defaultDays: number; defaultCount: number }[] = [
  { label: "ASC INT",  match: "ASC IN",      defaultDays: 5, defaultCount: 2 },
  { label: "ASC EXT",  match: "ASC EXT",     defaultDays: 5, defaultCount: 0 },
  { label: "EM INT",   match: "Manager INT", defaultDays: 5, defaultCount: 0 },
  { label: "EM EXT",   match: "Manager EXT", defaultDays: 5, defaultCount: 3 },
  { label: "Partner",  match: "Partner",     defaultDays: 1, defaultCount: 1 },
];

const TEAM_PRESETS: Record<string, { label: string; config: { match: string; count: number; days: number }[] }> = {
  "full": {
    label: "Full team (2 ASC INT + 3 EM EXT + Partner)",
    config: [
      { match: "Partner",     count: 1, days: 1 },
      { match: "Manager EXT", count: 3, days: 5 },
      { match: "ASC IN",      count: 2, days: 5 },
    ],
  },
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

// Maps admin region codes → country names that belong to that region.
// Country Benchmarks, Fees by Country, and Win-Loss scatter all group by region.
const REGION_TO_COUNTRY: Record<string, string[]> = {
  IT:            ["Italy", "IT"],
  FR:            ["France", "FR", "Belgium", "Luxembourg", "LU"],
  DACH:          ["Germany", "DE", "Switzerland", "CH", "Austria", "AT", "Czech Republic", "CZ", "DACH"],
  Nordics:       ["Netherlands", "NL", "Sweden", "SE", "Denmark", "DK", "Norway", "NO", "Finland", "FI"],
  UK:            ["United Kingdom", "UK"],
  US:            ["United States", "US"],
  "Middle East": ["UAE", "AE", "Saudi Arabia", "SA", "Middle East"],
  Asia:          ["Philippines", "PH", "Japan", "Indonesia", "Asia"],
};

// Reverse lookup: country name → region code
function countryToRegion(country: string): string | null {
  const lc = country.toLowerCase();
  for (const [region, aliases] of Object.entries(REGION_TO_COUNTRY)) {
    if (aliases.some(a => a.toLowerCase() === lc)) return region;
  }
  return null;
}

// Resolve a proposal's display region: use p.region if it matches an admin region,
// or map p.country → region via REGION_TO_COUNTRY.
function proposalRegionKey(p: { region: string; country?: string | null }): string {
  return p.region || (p.country ? countryToRegion(p.country) ?? p.country : "—");
}

function getBandForPrice(
  weeklyPrice: number,
  region: string,
  benchmarks: CountryBenchmarkRow[],
  country?: string | null
): "green" | "yellow" | "red" | null {
  // Try exact country name match first (for proposals that store full country name)
  let bench: CountryBenchmarkRow | undefined;
  if (country) {
    bench = benchmarks.find(b =>
      b.country.toLowerCase() === country.toLowerCase() &&
      (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"))
    );
  }
  if (!bench) {
    const aliases = REGION_TO_COUNTRY[region] ?? [region];
    bench = benchmarks.find(b =>
      aliases.some(a => a.toLowerCase() === b.country.toLowerCase()) &&
      (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"))
    );
  }
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
    project_name: "CLI01", client_name: "", fund_name: "CARLYLE",
    region: "IT", pe_owned: true, revenue_band: "above_1b",
    price_sensitivity: "medium", duration_weeks: 12, notes: "", status: "draft", staffing: [],
    project_type: "transformation", sector: "Industrial / Manufacturing", ebitda_margin_pct: 20,
    commercial_maturity: null, urgency: null, competitive_intensity: "limited",
    competitor_type: "none", ownership_type: null, strategic_intent: "enter",
    procurement_involvement: null,
    target_roi: 10, max_fees_ebitda_pct: 3,
    aspiration_ebitda_pct: 10,
    company_revenue_m: 300, aspiration_ebitda_eur: null,
    relationship_type: "new", decision_maker: "ceo", budget_disclosed_eur: null,
    incumbent_advisor: null, geographic_scope: "multi", value_driver: null,
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

// Reusable arc gauge used for TNF / EBITDA ratios in the right-column fee summary
function ArcGauge({ ratio, label, denomLabel, maxRatio = 0.2, benchmark }: {
  ratio: number | null;
  label: string;
  denomLabel: string;
  maxRatio?: number;
  benchmark?: { value: number | null; label: string };
}) {
  const CX = 70; const CY = 62; const R = 50; const SW = 11;
  const clampedP = ratio != null ? Math.min(1, Math.max(0, ratio / maxRatio)) : 0;
  const angle = Math.PI * (1 - clampedP);
  const ex = CX + R * Math.cos(angle); const ey = CY - R * Math.sin(angle);
  const largeArc = clampedP > 0.5 ? 1 : 0;
  const color = ratio == null ? "#94a3b8"
    : ratio < 0.05 ? "#16a34a"
    : ratio < 0.10 ? "#f59e0b"
    : "#ef4444";
  const bgPath = `M ${CX - R} ${CY} A ${R} ${R} 0 0 0 ${CX + R} ${CY}`;
  const valPath = clampedP > 0.001
    ? `M ${CX - R} ${CY} A ${R} ${R} 0 ${largeArc} 0 ${ex} ${ey}`
    : "";
  // Benchmark marker position (angle on arc)
  const benchP = benchmark?.value != null ? Math.min(1, Math.max(0, benchmark.value / maxRatio)) : null;
  const benchAngle = benchP != null ? Math.PI * (1 - benchP) : 0;
  const bx = CX + R * Math.cos(benchAngle);
  const by = CY - R * Math.sin(benchAngle);
  return (
    <div className="border rounded-lg p-3 bg-background flex flex-col items-center shadow-sm">
      <div className="text-[10px] font-bold uppercase text-muted-foreground tracking-wide text-center mb-1">{label}</div>
      <svg width="140" height="78" viewBox={`0 0 ${CX * 2} 78`}>
        <path d={bgPath} fill="none" stroke="#e2e8f0" strokeWidth={SW} strokeLinecap="round" />
        {valPath && <path d={valPath} fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" />}
        {benchP != null && (
          <g>
            <line x1={CX + (R - SW / 2 - 2) * Math.cos(benchAngle)} y1={CY - (R - SW / 2 - 2) * Math.sin(benchAngle)}
              x2={CX + (R + SW / 2 + 2) * Math.cos(benchAngle)} y2={CY - (R + SW / 2 + 2) * Math.sin(benchAngle)}
              stroke="#1e293b" strokeWidth="2" />
            <circle cx={bx} cy={by} r="3" fill="#1e293b" />
          </g>
        )}
        <text x={CX} y={CY - 2} textAnchor="middle" fontSize="22" fontWeight="bold" fill={color}>
          {ratio != null ? `${(ratio * 100).toFixed(1)}%` : "—"}
        </text>
        <text x={CX} y={CY + 14} textAnchor="middle" fontSize="8" fill="#94a3b8">{denomLabel}</text>
      </svg>
      <div className="flex justify-between w-full text-[9px] text-muted-foreground mt-0.5 px-2">
        <span>0%</span>
        <span className="text-amber-500">{(maxRatio * 50).toFixed(0)}%</span>
        <span className="text-red-500">{(maxRatio * 100).toFixed(0)}%+</span>
      </div>
      {benchmark && (
        <div className="mt-1.5 pt-1.5 border-t border-border w-full text-[9px] text-center">
          <span className="text-muted-foreground">Past projects avg: </span>
          {benchmark.value != null ? (
            <span className="font-bold font-mono text-slate-700">{(benchmark.value * 100).toFixed(1)}%</span>
          ) : (
            <span className="italic text-muted-foreground/70">no data yet</span>
          )}
        </div>
      )}
    </div>
  );
}

type CountryFeeRow = { country: string; won: number; lost: number; winRate: number | null; avgWon: number | null; avgLost: number | null; avgWonWeekly: number | null; avgLostWeekly: number | null; };

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
  const [showEditProposalForm, setShowEditProposalForm] = useState(false);
  const [savingProposal, setSavingProposal] = useState(false);
  const [propSort, setPropSort] = useState<{ field: string; dir: "asc" | "desc" }>({ field: "proposal_date", dir: "desc" });
  const [disabledBars, setDisabledBars] = useState<Set<string>>(new Set());
  const [waterfallDuration, setWaterfallDuration] = useState<number | null>(null);
  const [negotiationDelta, setNegotiationDelta] = useState(0);
  const [variableFeePct, setVariableFeePct] = useState(10);
  const [adminFeePct, setAdminFeePct] = useState(8);
  const [markingOutcome, setMarkingOutcome] = useState(false);
  const [importConflicts, setImportConflicts] = useState<{ incoming: PricingProposal; existing: PricingProposal }[]>([]);
  const [manualDelta, setManualDelta] = useState(0); // manual ±500 price adjustment
  const [teamPreset, setTeamPreset] = useState<string>("full");
  const [benchmarks, setBenchmarks] = useState<CountryBenchmarkRow[]>([]);
  const [benchmarksLocal, setBenchmarksLocal] = useState<CountryBenchmarkRow[]>([]);
  const [editingBenchmarks, setEditingBenchmarks] = useState(false);
  const [savingBenchmarks, setSavingBenchmarks] = useState(false);
  const [projectTypesLocal, setProjectTypesLocal] = useState<string[]>([]);
  const [editingProjectTypes, setEditingProjectTypes] = useState(false);
  const [sectorsLocal, setSectorsLocal] = useState<string[]>([]);
  const [editingSectors, setEditingSectors] = useState(false);
  const [fundsLocal, setFundsLocal] = useState<string[]>([]);
  const [editingFunds, setEditingFunds] = useState(false);
  const [regionsLocal, setRegionsLocal] = useState<PricingRegion[]>([]);
  const [editingRegions, setEditingRegions] = useState(false);
  const [pasteInput, setPasteInput] = useState("");
  const [pasteResult, setPasteResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [excelPaste, setExcelPaste] = useState("");
  const [excelPasteResult, setExcelPasteResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [importingExcel, setImportingExcel] = useState(false);

  // Weekly price recalc review dialog
  type WeeklyRecalcRow = {
    proposal: PricingProposal;
    oldWeekly: number;
    newWeekly: number;
    delta: number;
  };
  const [weeklyRecalcRows, setWeeklyRecalcRows] = useState<WeeklyRecalcRow[] | null>(null);
  const [weeklyRecalcSelected, setWeeklyRecalcSelected] = useState<Set<number>>(new Set());
  const [showTNFInfo, setShowTNFInfo] = useState(false);
  const [showL4Info, setShowL4Info] = useState(false);

  // Proposals included in all analysis (filters out excluded_from_analysis)
  const isExcluded = (p: PricingProposal): boolean => !!(p.excluded_from_analysis);
  const analysisProposals = useMemo(() => proposals.filter(p => !isExcluded(p)), [proposals]);

  // Fees-by-region analysis (groups by admin region, not individual country)
  const computeFeesByCountry = (ps: PricingProposal[]): CountryFeeRow[] => {
    const relevant = ps.filter(p => p.outcome === "won" || p.outcome === "lost");
    const regions = [...new Set(relevant.map(p => proposalRegionKey(p)))].sort();
    return regions.map(country => {
      const cp = relevant.filter(p => proposalRegionKey(p) === country);
      const won = cp.filter(p => p.outcome === "won");
      const lost = cp.filter(p => p.outcome === "lost");
      const total = won.length + lost.length;
      const totalFee = (p: PricingProposal) => p.weekly_price * (p.duration_weeks || 1);
      return {
        country,
        won: won.length, lost: lost.length,
        winRate: total > 0 ? won.length / total : null,
        avgWon: won.length > 0 ? won.reduce((s, p) => s + totalFee(p), 0) / won.length : null,
        avgLost: lost.length > 0 ? lost.reduce((s, p) => s + totalFee(p), 0) / lost.length : null,
        avgWonWeekly: won.length > 0 ? won.reduce((s, p) => s + p.weekly_price, 0) / won.length : null,
        avgLostWeekly: lost.length > 0 ? lost.reduce((s, p) => s + p.weekly_price, 0) / lost.length : null,
      };
    });
  };
  const [feesByCountry, setFeesByCountry] = useState<CountryFeeRow[] | null>(null);
  const [pendingFeesByCountry, setPendingFeesByCountry] = useState<CountryFeeRow[] | null>(null);
  const [selectedCountryUpdates, setSelectedCountryUpdates] = useState<Set<string>>(new Set());

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
      const rawProposals: PricingProposal[] = Array.isArray(pData)
        ? pData.map((p: any) => ({ ...p, pe_owned: p.pe_owned === 1 || p.pe_owned === true }))
        : [];

      // Auto-normalize fund names against canonical list
      const canonicalFunds: string[] = merged.funds ?? DEFAULT_PRICING_SETTINGS.funds ?? [];
      const toNormalize = rawProposals.filter(p => {
        if (!p.fund_name) return false;
        const lName = p.fund_name.toLowerCase().trim();
        const exact = canonicalFunds.find(c => c.toLowerCase() === lName);
        if (exact) return false; // already canonical
        const sub = canonicalFunds.find(c => {
          const lc = c.toLowerCase();
          return lName.includes(lc) || lc.includes(lName);
        });
        if (sub) return true;
        const token = canonicalFunds.find(c => {
          const tokens = c.toLowerCase().split(/\s+/);
          return tokens.some(t => t.length >= 3 && lName.includes(t));
        });
        return !!token;
      });

      // Patch non-canonical proposals silently
      for (const p of toNormalize) {
        const lName = (p.fund_name ?? "").toLowerCase().trim();
        const normalized =
          canonicalFunds.find(c => c.toLowerCase() === lName) ??
          canonicalFunds.find(c => { const lc = c.toLowerCase(); return lName.includes(lc) || lc.includes(lName); }) ??
          canonicalFunds.find(c => c.toLowerCase().split(/\s+/).some(t => t.length >= 3 && lName.includes(t)));
        if (normalized && p.id) {
          rawProposals.forEach(r => { if (r.id === p.id) r.fund_name = normalized; });
          fetch(`/api/pricing/proposals/${p.id}`, {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...p, fund_name: normalized, pe_owned: p.pe_owned ? 1 : 0 }),
          }).catch(() => {});
        }
      }

      setProposals(rawProposals);
    } catch {
      setSettings(DEFAULT_PRICING_SETTINGS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    setBenchmarks(settings?.country_benchmarks ?? DEFAULT_PRICING_SETTINGS.country_benchmarks ?? []);
    setProjectTypesLocal(settings?.project_types ?? DEFAULT_PROJECT_TYPES);
    setSectorsLocal(settings?.sectors ?? [...SECTORS]);
    setFundsLocal(settings?.funds ?? DEFAULT_PRICING_SETTINGS.funds ?? []);
    setRegionsLocal(settings?.regions ?? DEFAULT_PRICING_SETTINGS.regions);
  }, [settings]);

  // Auto-populate fees-by-country when proposals first load
  useEffect(() => {
    if (proposals.length > 0 && feesByCountry === null) {
      setFeesByCountry(computeFeesByCountry(analysisProposals));
    }
  }, [proposals]);

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
    if (settings) base.staffing = buildStaffingFromPreset("full", settings);
    setTeamPreset("full");
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

  const saveRegions = async (regions: PricingRegion[]) => {
    const updated = { ...(settings ?? DEFAULT_PRICING_SETTINGS), regions };
    await fetch("/api/pricing/settings", {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setSettings(updated);
    setEditingRegions(false);
    toast({ title: "Regions saved" });
  };

  const saveProjectTypes = async (types: string[]) => {
    const updated = { ...(settings ?? DEFAULT_PRICING_SETTINGS), project_types: types };
    await fetch("/api/pricing/settings", {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setSettings(updated);
    setEditingProjectTypes(false);
    toast({ title: "Project types saved" });
  };

  const saveFunds = async (funds: string[]) => {
    const updated = { ...(settings ?? DEFAULT_PRICING_SETTINGS), funds };
    await fetch("/api/pricing/settings", {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setSettings(updated);
    setEditingFunds(false);
    toast({ title: "Funds saved" });
  };

  const saveSectors = async (sectors: string[]) => {
    const updated = { ...(settings ?? DEFAULT_PRICING_SETTINGS), sectors };
    await fetch("/api/pricing/settings", {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setSettings(updated);
    setEditingSectors(false);
    toast({ title: "Sectors saved" });
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
    const conflicts: { incoming: PricingProposal; existing: PricingProposal }[] = [];
    try {
      let inserted = 0, skipped = 0;
      for (const p of parsed) {
        // Exact match: same project_name + client_name + outcome + price within 2%
        const exact = proposals.find(x =>
          x.project_name === p.project_name &&
          x.client_name === p.client_name &&
          x.outcome === p.outcome &&
          Math.abs((x.weekly_price - p.weekly_price) / (p.weekly_price || 1)) < 0.02
        );
        if (exact) { skipped++; continue; }

        // Conflict: same project_name (or same client + fund) but different key fields
        const conflict = proposals.find(x =>
          x.project_name === p.project_name ||
          (x.client_name && p.client_name &&
           x.client_name.toLowerCase().trim() === p.client_name.toLowerCase().trim() &&
           x.fund_name && p.fund_name &&
           x.fund_name.toLowerCase().trim() === p.fund_name.toLowerCase().trim())
        );
        if (conflict) { conflicts.push({ incoming: p, existing: conflict }); continue; }

        const payload = { ...p, pe_owned: p.pe_owned ? 1 : 0 };
        const res = await fetch("/api/pricing/proposals", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res.ok) inserted++;
      }
      setImportConflicts(conflicts);
      const conflictMsg = conflicts.length > 0 ? `, ${conflicts.length} conflict(s) need review` : "";
      setExcelPasteResult({ ok: true, msg: `Imported ${inserted}, skipped ${skipped} exact duplicates${conflictMsg}` });
      if (conflicts.length === 0) setExcelPaste("");
      loadAll();
    } catch {
      setExcelPasteResult({ ok: false, msg: "Import failed" });
    } finally {
      setImportingExcel(false);
    }
  };

  const resolveConflict = async (conflict: { incoming: PricingProposal; existing: PricingProposal }, keep: "incoming" | "existing") => {
    if (keep === "incoming") {
      // Replace existing with incoming
      const payload = { ...conflict.incoming, pe_owned: conflict.incoming.pe_owned ? 1 : 0 };
      if (conflict.existing.id) {
        await fetch(`/api/pricing/proposals/${conflict.existing.id}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetch("/api/pricing/proposals", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      loadAll();
    }
    // Either way, remove this conflict from the list
    setImportConflicts(prev => prev.filter(c => c !== conflict));
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
        // Auto-sync client fields to sibling projects
        const synced = await syncClientFields(historyForm);
        toast({ title: "Proposal updated", description: synced > 0 ? `${synced} sibling project${synced > 1 ? "s" : ""} synced.` : undefined });
      } else {
        await fetch("/api/pricing/proposals", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        toast({ title: "Proposal saved" });
      }
      setShowHistoryForm(false);
      setShowEditProposalForm(false);
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
    setShowEditProposalForm(true);
  };

  const renderProposalEditForm = () => (
    <div className="space-y-3">
      <div className="text-xs font-bold uppercase tracking-wide text-primary mb-1">
        {editingProposalId ? "Edit Past Project" : "Add Past Project"}
      </div>
      <div className="grid grid-cols-4 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Date</Label>
          <Input type="date" value={historyForm.proposal_date} onChange={e => setHistoryForm(f => ({ ...f, proposal_date: e.target.value }))} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Outcome</Label>
          <Select value={historyForm.outcome} onValueChange={v => setHistoryForm(f => ({ ...f, outcome: v }))}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="won">Won</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Project name</Label>
          <Input value={historyForm.project_name} onChange={e => setHistoryForm(f => ({ ...f, project_name: e.target.value }))} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Client name</Label>
          <Input value={historyForm.client_name || ""} onChange={e => setHistoryForm(f => ({ ...f, client_name: e.target.value }))} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Fund</Label>
          {(() => {
            const knownFunds = settings?.funds ?? DEFAULT_PRICING_SETTINGS.funds;
            const isOther = !!historyForm.fund_name && !knownFunds.includes(historyForm.fund_name);
            const selectVal = historyForm.fund_name
              ? (knownFunds.includes(historyForm.fund_name) ? historyForm.fund_name : "other")
              : "";
            return (
              <div className="space-y-1">
                <Select value={selectVal} onValueChange={v => {
                  if (v === "other") setHistoryForm(f => ({ ...f, fund_name: "" }));
                  else setHistoryForm(f => ({ ...f, fund_name: v }));
                }}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select fund" /></SelectTrigger>
                  <SelectContent>
                    {knownFunds.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    <SelectItem value="other">Other…</SelectItem>
                  </SelectContent>
                </Select>
                {(isOther || selectVal === "other") && (
                  <Input
                    value={historyForm.fund_name || ""}
                    onChange={e => setHistoryForm(f => ({ ...f, fund_name: e.target.value }))}
                    className="h-8 text-sm"
                    placeholder="Enter fund name"
                    autoFocus
                  />
                )}
              </div>
            );
          })()}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Region</Label>
          {(() => {
            const regionList = (settings?.regions ?? DEFAULT_PRICING_SETTINGS.regions).filter(r => r.region_name);
            const currentRegion = historyForm.region || "";
            const inList = regionList.some(r => r.region_name === currentRegion);
            return (
              <Select value={currentRegion} onValueChange={v => setHistoryForm(f => ({ ...f, region: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select region" /></SelectTrigger>
                <SelectContent>
                  {!inList && currentRegion && (
                    <SelectItem key={currentRegion} value={currentRegion}>{currentRegion}</SelectItem>
                  )}
                  {regionList.map(r => (
                    <SelectItem key={r.region_name} value={r.region_name}>{r.region_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })()}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Sector</Label>
          <Select value={historyForm.sector || ""} onValueChange={v => setHistoryForm(f => ({ ...f, sector: v || null }))}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select sector" /></SelectTrigger>
            <SelectContent>
              {(settings?.sectors ?? [...SECTORS]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Project type</Label>
          <Select value={historyForm.project_type || "__none__"} onValueChange={v => setHistoryForm(f => ({ ...f, project_type: v === "__none__" ? null : v }))}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Not set —</SelectItem>
              {projectTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Currency</Label>
          <Select value={historyForm.currency || "EUR"} onValueChange={v => setHistoryForm(f => ({ ...f, currency: v }))}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="EUR">EUR €</SelectItem>
              <SelectItem value="USD">USD $</SelectItem>
              <SelectItem value="GBP">GBP £</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Duration (weeks)</Label>
          <Input type="number" min="1" value={historyForm.duration_weeks ?? ""} onChange={e => setHistoryForm(f => ({ ...f, duration_weeks: +e.target.value || 0 }))} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Team size</Label>
          <Select
            value={String(historyForm.team_size ?? 1)}
            onValueChange={v => setHistoryForm(f => ({ ...f, team_size: Number(v) }))}
          >
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0.5">0.5</SelectItem>
              <SelectItem value="1">1</SelectItem>
              <SelectItem value="1.5">1.5</SelectItem>
              <SelectItem value="2">2</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Weekly price</Label>
          <div className="flex gap-1">
            <span className="flex items-center px-2 text-sm font-semibold bg-muted border rounded-l border-r-0">
              {historyForm.currency === "USD" ? "$" : historyForm.currency === "GBP" ? "£" : "€"}
            </span>
            <Input type="number" min="0" value={historyForm.weekly_price || ""} onChange={e => setHistoryForm(f => ({ ...f, weekly_price: +e.target.value || 0 }))} className="h-8 text-sm font-mono rounded-l-none" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tot. Project Net Fees</Label>
          <div className="flex gap-1">
            <span className="flex items-center px-2 text-sm font-semibold bg-muted border rounded-l border-r-0">
              {historyForm.currency === "USD" ? "$" : historyForm.currency === "GBP" ? "£" : "€"}
            </span>
            <Input type="number" min="0" value={historyForm.total_fee ?? ""}
              onChange={e => {
                const val = e.target.value === "" ? null : +e.target.value;
                setHistoryForm(f => {
                  const updated = { ...f, total_fee: val };
                  // Auto-compute weekly_price from total_fee ÷ weeks ÷ team_size
                  if (val && val > 0 && f.duration_weeks && f.duration_weeks > 0) {
                    const team = f.team_size && f.team_size > 0 ? f.team_size : 1;
                    updated.weekly_price = Math.round(val / f.duration_weeks / team);
                  }
                  return updated;
                });
              }}
              className="h-8 text-sm font-mono rounded-l-none"
              placeholder="auto-computes weekly"
            />
          </div>
          {historyForm.total_fee && historyForm.duration_weeks && historyForm.duration_weeks > 0 && (
            <div className="text-[9px] text-muted-foreground">
              {fmt(historyForm.total_fee)} ÷ {historyForm.duration_weeks}w ÷ {historyForm.team_size ?? 1} team = {fmt(Math.round(historyForm.total_fee / historyForm.duration_weeks / (historyForm.team_size || 1)))}/wk
            </div>
          )}
        </div>
        {/* New: company financials — useful for TNF/EBITDA benchmarking */}
        <div className="space-y-1">
          <Label className="text-xs">Company revenue (M€)</Label>
          <Input type="number" min="0" step="0.1" value={historyForm.company_revenue_m ?? ""}
            onChange={e => setHistoryForm(f => ({ ...f, company_revenue_m: e.target.value === "" ? null : +e.target.value }))}
            className="h-8 text-sm font-mono" placeholder="e.g. 250" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">EBITDA margin</Label>
          <Select
            value={historyForm.ebitda_margin_pct != null ? String(historyForm.ebitda_margin_pct) : "__none__"}
            onValueChange={v => setHistoryForm(f => ({ ...f, ebitda_margin_pct: v === "__none__" ? null : Number(v) }))}
          >
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select margin" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Not set —</SelectItem>
              <SelectItem value="10">10%</SelectItem>
              <SelectItem value="12.5">12.5%</SelectItem>
              <SelectItem value="15">15%</SelectItem>
              <SelectItem value="17.5">17.5%</SelectItem>
              <SelectItem value="20">20%</SelectItem>
              <SelectItem value="25">25%</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Expected EBITDA growth</Label>
          <Select
            value={historyForm.expected_ebitda_growth_pct != null ? String(historyForm.expected_ebitda_growth_pct) : "__none__"}
            onValueChange={v => setHistoryForm(f => ({ ...f, expected_ebitda_growth_pct: v === "__none__" ? null : Number(v) }))}
          >
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select growth" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">N/A</SelectItem>
              <SelectItem value="5">5%</SelectItem>
              <SelectItem value="10">10%</SelectItem>
              <SelectItem value="20">20%</SelectItem>
              <SelectItem value="30">30%</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {historyForm.outcome === "lost" && (
        <div className="space-y-1 max-w-xs">
          <Label className="text-xs">Loss reason</Label>
          <Select value={historyForm.loss_reason || "__unknown__"} onValueChange={v => setHistoryForm(f => ({ ...f, loss_reason: v === "__unknown__" ? null : v }))}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select reason" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__unknown__">— Unknown —</SelectItem>
              <SelectItem value="price">Price</SelectItem>
              <SelectItem value="brand">Brand</SelectItem>
              <SelectItem value="team">Team</SelectItem>
              <SelectItem value="quality">Quality</SelectItem>
              <SelectItem value="relationship">Relationship</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex gap-2 pt-1 flex-wrap">
        <Button size="sm" onClick={saveProposal} disabled={savingProposal}>
          {savingProposal ? "Saving…" : "Save"}
        </Button>
        {editingProposalId && (
          <Button size="sm" variant="outline" onClick={async () => {
            const siblings = proposals.filter(p =>
              p.id !== editingProposalId &&
              (p.client_name || "").trim().toLowerCase() === (historyForm.client_name || "").trim().toLowerCase()
            );
            if (!siblings.length) {
              toast({ title: "No other projects for this client" });
              return;
            }
            const count = await syncClientFields(historyForm);
            toast({ title: `Synced to ${count} sibling project${count !== 1 ? "s" : ""}`, description: "Region, fund, revenue and EBITDA % copied." });
          }} title="Copy region, fund, revenue and EBITDA % to all projects of same client">
            <Users className="w-3.5 h-3.5 mr-1.5" />
            Sync to client
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => { setShowEditProposalForm(false); setEditingProposalId(null); setHistoryForm(emptyProposal()); }}>
          Cancel
        </Button>
      </div>
    </div>
  );

  const downloadProposalsCsv = () => {
    const cols: { key: keyof PricingProposal; label: string }[] = [
      { key: "proposal_date", label: "Date" },
      { key: "project_name", label: "Project" },
      { key: "client_name", label: "Client" },
      { key: "fund_name", label: "Fund" },
      { key: "region", label: "Region" },
      { key: "country", label: "Country" },
      { key: "sector", label: "Sector" },
      { key: "project_type", label: "Type" },
      { key: "pe_owned", label: "PE owned" },
      { key: "revenue_band", label: "Revenue band" },
      { key: "duration_weeks", label: "Duration (w)" },
      { key: "team_size", label: "Team size" },
      { key: "currency", label: "Currency" },
      { key: "weekly_price", label: "Weekly price" },
      { key: "total_fee", label: "Total fee" },
      { key: "outcome", label: "Outcome" },
      { key: "loss_reason", label: "Loss reason" },
      { key: "company_revenue_m", label: "Company revenue (M€)" },
      { key: "ebitda_margin_pct", label: "EBITDA margin %" },
      { key: "expected_ebitda_growth_pct", label: "Expected EBITDA growth %" },
      { key: "notes", label: "Notes" },
    ];
    const esc = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      const s = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = cols.map(c => c.label).join(";");
    const rows = proposals.map(p => cols.map(c => esc((p as any)[c.key])).join(";"));
    const csv = "\ufeff" + [header, ...rows].join("\n"); // BOM for Excel UTF-8
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `past_projects_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "CSV downloaded", description: `${proposals.length} projects exported.` });
  };

  // Recalculate weekly_price from total_fee / duration_weeks / team_size
  // and open a review dialog showing the differences.
  const runWeeklyRecalc = () => {
    const discrepancies: WeeklyRecalcRow[] = [];
    for (const p of proposals) {
      if (!p.id || !p.total_fee || !p.duration_weeks || p.duration_weeks <= 0) continue;
      const team = p.team_size && p.team_size > 0 ? p.team_size : 1;
      const computed = Math.round(p.total_fee / p.duration_weeks / team);
      const current = Math.round(p.weekly_price || 0);
      const delta = computed - current;
      // Flag rows where the discrepancy is ≥ €100 AND ≥ 1% of the current value
      if (Math.abs(delta) >= 100 && Math.abs(delta) / Math.max(current, 1) >= 0.01) {
        discrepancies.push({ proposal: p, oldWeekly: current, newWeekly: computed, delta });
      }
    }
    if (discrepancies.length === 0) {
      toast({ title: "All weekly prices already correct", description: "No discrepancies found." });
      return;
    }
    setWeeklyRecalcRows(discrepancies);
    setWeeklyRecalcSelected(new Set(discrepancies.map(d => d.proposal.id!)));
  };

  // Smart Populate: for each client, find the most-complete proposal and copy
  // region / fund / company_revenue_m / ebitda_margin_pct to sibling proposals
  // that are missing those values.
  const runSmartPopulate = async () => {
    // Group by client (case-insensitive)
    const groups = new Map<string, PricingProposal[]>();
    for (const p of proposals) {
      const key = (p.client_name ?? "").trim().toLowerCase();
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    let totalPatches = 0;
    const patched: PricingProposal[] = [];

    for (const [, group] of groups) {
      if (group.length < 2) continue;
      // Pick the "best source" per field — first non-empty value found
      const bestRegion  = group.map(p => p.region).find(v => v && v.trim());
      const bestFund    = group.map(p => p.fund_name).find(v => v && v.trim());
      const bestRevenue = group.map(p => p.company_revenue_m).find(v => v != null && v > 0);
      const bestEbitda  = group.map(p => p.ebitda_margin_pct).find(v => v != null && v > 0);

      for (const p of group) {
        const patch: Partial<PricingProposal> = {};
        if (bestRegion  && !(p.region ?? "").trim())                     patch.region = bestRegion;
        if (bestFund    && !(p.fund_name ?? "").trim())                  patch.fund_name = bestFund;
        if (bestRevenue != null && !(p.company_revenue_m != null && p.company_revenue_m > 0)) patch.company_revenue_m = bestRevenue;
        if (bestEbitda  != null && !(p.ebitda_margin_pct != null && p.ebitda_margin_pct > 0)) patch.ebitda_margin_pct = bestEbitda;
        if (Object.keys(patch).length > 0) {
          patched.push({ ...p, ...patch });
          totalPatches += Object.keys(patch).length;
        }
      }
    }

    if (patched.length === 0) {
      toast({ title: "Nothing to populate", description: "No missing fields detected across same-client groups." });
      return;
    }

    const ok = window.confirm(
      `Smart Populate will update ${patched.length} project${patched.length > 1 ? "s" : ""} ` +
      `(${totalPatches} field${totalPatches > 1 ? "s" : ""} filled in total). Proceed?`
    );
    if (!ok) return;

    // Optimistic local update
    setProposals(prev => prev.map(p => {
      const match = patched.find(q => q.id === p.id);
      return match ? { ...p, ...match } : p;
    }));

    // Persist in parallel
    await Promise.all(patched.map(p =>
      fetch(`/api/pricing/proposals/${p.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...p, pe_owned: p.pe_owned ? 1 : 0 }),
      }).catch(() => {})
    ));

    toast({ title: "Smart Populate complete", description: `${patched.length} projects updated (${totalPatches} fields).` });
  };

  const applyWeeklyRecalc = async () => {
    if (!weeklyRecalcRows) return;
    const toApply = weeklyRecalcRows.filter(r => weeklyRecalcSelected.has(r.proposal.id!));
    if (toApply.length === 0) {
      setWeeklyRecalcRows(null);
      return;
    }
    // Optimistic local update
    setProposals(prev => prev.map(p => {
      const match = toApply.find(r => r.proposal.id === p.id);
      return match ? { ...p, weekly_price: match.newWeekly } : p;
    }));
    // Persist in parallel
    await Promise.all(toApply.map(r => {
      const payload = { ...r.proposal, weekly_price: r.newWeekly, pe_owned: r.proposal.pe_owned ? 1 : 0 };
      return fetch(`/api/pricing/proposals/${r.proposal.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }));
    toast({ title: `${toApply.length} weekly price${toApply.length > 1 ? "s" : ""} updated` });
    setWeeklyRecalcRows(null);
    setWeeklyRecalcSelected(new Set());
  };

  const markProjectOutcome = async (outcome: "won" | "lost") => {
    if (!recommendation) return;
    setMarkingOutcome(true);
    try {
      const baseWeekly = nwfClamped + manualDelta + negotiationDelta;
      // weekly_price = gross+admin (variable fee is tracked separately as a success fee)
      const weeklyGrossAdmin = Math.round(baseWeekly * (1 + adminFeePct / 100));
      const grossTotal = Math.round(baseWeekly * form.duration_weeks);
      const netTotal = Math.round(grossTotal * (1 - totalDiscountPct / 100));
      const payload = {
        proposal_date: new Date().toISOString().slice(0, 10),
        project_name: form.project_name || "CLI01",
        client_name: form.client_name || null,
        fund_name: form.fund_name || null,
        region: form.region,
        pe_owned: form.pe_owned ? 1 : 0,
        revenue_band: form.revenue_band,
        price_sensitivity: form.price_sensitivity,
        duration_weeks: form.duration_weeks,
        weekly_price: weeklyGrossAdmin,
        total_fee: netTotal,
        outcome,
        sector: form.sector || null,
        project_type: form.project_type || null,
      };
      await fetch("/api/pricing/proposals", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast({ title: `Project marked as ${outcome}`, description: `${payload.project_name} saved to win/loss history` });
      loadAll();
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setMarkingOutcome(false);
    }
  };

  const deleteProposal = async (id: number) => {
    if (!confirm("Delete this past proposal?")) return;
    await fetch(`/api/pricing/proposals/${id}`, { method: "DELETE", credentials: "include" });
    loadAll();
  };

  // Propagate region / fund / revenue / ebitda from one proposal to all same-client proposals.
  // Only overwrites fields that are non-null/non-empty in `source`.
  const syncClientFields = async (source: PricingProposal, currentProposals?: PricingProposal[]) => {
    const clientName = (source.client_name || "").trim().toLowerCase();
    if (!clientName) return 0;
    const pool = currentProposals ?? proposals;
    const siblings = pool.filter(p => p.id !== source.id && (p.client_name || "").trim().toLowerCase() === clientName);
    if (!siblings.length) return 0;

    // Build the patch (only include fields that have a value in source)
    const patch: Partial<PricingProposal> = {};
    if (source.region) patch.region = source.region;
    if (source.fund_name) patch.fund_name = source.fund_name;
    if (source.company_revenue_m != null) patch.company_revenue_m = source.company_revenue_m;
    if (source.ebitda_margin_pct != null) patch.ebitda_margin_pct = source.ebitda_margin_pct;
    if (!Object.keys(patch).length) return 0;

    // Optimistic local update
    setProposals(prev => prev.map(p =>
      siblings.some(s => s.id === p.id) ? { ...p, ...patch } : p
    ));

    // Fire PUTs in parallel (fire-and-forget, no blocking)
    await Promise.all(siblings.map(sib =>
      fetch(`/api/pricing/proposals/${sib.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sib, ...patch, pe_owned: sib.pe_owned ? 1 : 0 }),
      }).catch(() => {})
    ));

    return siblings.length;
  };

  // Inline one-field update for the past-projects table (e.g. team_size).
  // Optimistic: we patch local state immediately, then PUT the row.
  const patchProposalInline = async (id: number, patch: Partial<PricingProposal>) => {
    setProposals(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
    const current = proposals.find(p => p.id === id);
    if (!current) return;
    const payload = { ...current, ...patch, pe_owned: (current.pe_owned ? 1 : 0) };
    try {
      await fetch(`/api/pricing/proposals/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
      loadAll();
    }
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
    }, settings, analysisProposals);
  }, [form.region, form.pe_owned, form.revenue_band, form.price_sensitivity,
      form.duration_weeks, form.fund_name, form.staffing, settings, analysisProposals,
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

  // Project types list (from settings or defaults)
  const projectTypes = settings?.project_types ?? DEFAULT_PROJECT_TYPES;

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
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={runSmartPopulate} disabled={proposals.length === 0}
                title="Copy region / fund / revenue / EBITDA across all projects of the same client">
                <Users className="w-4 h-4 mr-2" /> Smart Populate
              </Button>
              <Button variant="outline" onClick={runWeeklyRecalc} disabled={proposals.length === 0}
                title="Recalculate weekly price = total fee / weeks / team size">
                <RefreshCw className="w-4 h-4 mr-2" /> Recalc Weekly
              </Button>
              <Button variant="outline" onClick={downloadProposalsCsv} disabled={proposals.length === 0}>
                <Download className="w-4 h-4 mr-2" /> Download CSV
              </Button>
              <Button variant="outline" onClick={() => {
                setHistoryForm(emptyProposal());
                setEditingProposalId(null);
                setShowEditProposalForm(true);
                setShowHistoryForm(false);
              }}>
                <Plus className="w-4 h-4 mr-2" /> Add Manually
              </Button>
              <Button onClick={() => setShowHistoryForm(true)}>
                <Plus className="w-4 h-4 mr-2" /> Import Excel / Paste
              </Button>
            </div>
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
        ) : mainTab === "history" ? (
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

            {/* Import conflict resolution */}
            {importConflicts.length > 0 && (
              <Card className="border-amber-300">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-amber-700">⚠ Conflicts detected — review before importing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {importConflicts.map((c, i) => (
                    <div key={i} className="border rounded-lg overflow-hidden">
                      <div className="grid grid-cols-2 divide-x text-xs">
                        <div className="p-3 bg-muted/20 space-y-1">
                          <div className="font-bold text-muted-foreground uppercase text-[10px] mb-1">Existing</div>
                          <div><span className="font-semibold">{c.existing.project_name}</span> · {c.existing.client_name}</div>
                          <div className="text-muted-foreground">{c.existing.fund_name} · {c.existing.region} · {c.existing.proposal_date?.slice(0,7)}</div>
                          <div>{fmt(c.existing.weekly_price)}/wk · {c.existing.duration_weeks}w · <span className={c.existing.outcome === "won" ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>{c.existing.outcome}</span></div>
                        </div>
                        <div className="p-3 bg-amber-50/50 space-y-1">
                          <div className="font-bold text-amber-700 uppercase text-[10px] mb-1">Incoming (new)</div>
                          <div><span className="font-semibold">{c.incoming.project_name}</span> · {c.incoming.client_name}</div>
                          <div className="text-muted-foreground">{c.incoming.fund_name} · {c.incoming.region} · {c.incoming.proposal_date?.slice(0,7)}</div>
                          <div>{fmt(c.incoming.weekly_price)}/wk · {c.incoming.duration_weeks}w · <span className={c.incoming.outcome === "won" ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>{c.incoming.outcome}</span></div>
                        </div>
                      </div>
                      <div className="flex gap-2 px-3 py-2 bg-muted/10 border-t">
                        <Button size="sm" variant="outline" onClick={() => resolveConflict(c, "existing")}>Keep existing</Button>
                        <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => resolveConflict(c, "incoming")}>Use new</Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Weekly price recalc review */}
            {weeklyRecalcRows && weeklyRecalcRows.length > 0 && (
              <Card className="border-blue-300 bg-blue-50/30">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-sm text-blue-800">
                        Weekly Price Recalculation — {weeklyRecalcRows.length} discrepanc{weeklyRecalcRows.length === 1 ? "y" : "ies"} found
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        Formula: <span className="font-mono bg-white px-1 rounded">weekly = total_fee ÷ weeks ÷ team_size</span>.
                        Review the proposed changes and select which rows to update.
                      </p>
                    </div>
                    <button onClick={() => setWeeklyRecalcRows(null)} className="text-muted-foreground hover:text-foreground p-1">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <button onClick={() => setWeeklyRecalcSelected(new Set(weeklyRecalcRows.map(r => r.proposal.id!)))}
                      className="text-blue-600 hover:underline">Select all</button>
                    <span className="text-muted-foreground">·</span>
                    <button onClick={() => setWeeklyRecalcSelected(new Set())}
                      className="text-blue-600 hover:underline">Clear</button>
                    <span className="text-muted-foreground ml-auto">{weeklyRecalcSelected.size} selected</span>
                  </div>
                  <div className="max-h-96 overflow-y-auto border rounded bg-white">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/50 border-b">
                        <tr>
                          <th className="p-2 text-left w-8"></th>
                          <th className="p-2 text-left">Project</th>
                          <th className="p-2 text-left">Client</th>
                          <th className="p-2 text-right">Total Fee</th>
                          <th className="p-2 text-right">Weeks</th>
                          <th className="p-2 text-right">Team</th>
                          <th className="p-2 text-right">Current</th>
                          <th className="p-2 text-right">Computed</th>
                          <th className="p-2 text-right">Δ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {weeklyRecalcRows.map(r => {
                          const selected = weeklyRecalcSelected.has(r.proposal.id!);
                          return (
                            <tr key={r.proposal.id} className={selected ? "bg-blue-50/50" : ""}>
                              <td className="p-2">
                                <input type="checkbox" checked={selected}
                                  onChange={e => setWeeklyRecalcSelected(prev => {
                                    const next = new Set(prev);
                                    e.target.checked ? next.add(r.proposal.id!) : next.delete(r.proposal.id!);
                                    return next;
                                  })}
                                />
                              </td>
                              <td className="p-2 font-semibold">{r.proposal.project_name}</td>
                              <td className="p-2 text-muted-foreground truncate max-w-[140px]">{r.proposal.client_name || "—"}</td>
                              <td className="p-2 text-right font-mono">{fmt(r.proposal.total_fee ?? 0)}</td>
                              <td className="p-2 text-right font-mono">{r.proposal.duration_weeks}</td>
                              <td className="p-2 text-right font-mono">{r.proposal.team_size ?? 1}</td>
                              <td className="p-2 text-right font-mono text-muted-foreground">{fmt(r.oldWeekly)}</td>
                              <td className="p-2 text-right font-mono font-semibold text-blue-700">{fmt(r.newWeekly)}</td>
                              <td className={`p-2 text-right font-mono font-semibold ${r.delta > 0 ? "text-emerald-600" : "text-red-600"}`}>
                                {r.delta > 0 ? "+" : ""}{fmt(r.delta)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={applyWeeklyRecalc} disabled={weeklyRecalcSelected.size === 0}>
                      Apply {weeklyRecalcSelected.size > 0 ? `(${weeklyRecalcSelected.size})` : ""} changes
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setWeeklyRecalcRows(null); setWeeklyRecalcSelected(new Set()); }}>
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Manual add form (rendered above the table when adding a new row) */}
            {showEditProposalForm && editingProposalId === null && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="pt-4">
                  {renderProposalEditForm()}
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
            ) : proposals.length > 0 && (() => {
              const sortedProposals = [...proposals].sort((a, b) => {
                const dir = propSort.dir === "asc" ? 1 : -1;
                const f = propSort.field;
                const av = (a as any)[f] ?? "";
                const bv = (b as any)[f] ?? "";
                if (typeof av === "number" && typeof bv === "number") return dir * (av - bv);
                return dir * String(av).localeCompare(String(bv));
              });
              const sortHeader = (field: string, label: string) => (
                <TableHead
                  className="cursor-pointer select-none hover:text-foreground whitespace-nowrap"
                  onClick={() => setPropSort(s => ({ field, dir: s.field === field && s.dir === "asc" ? "desc" : "asc" }))}
                >
                  {label}{propSort.field === field ? (propSort.dir === "asc" ? " ↑" : " ↓") : ""}
                </TableHead>
              );
              return (
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {sortHeader("proposal_date", "Date")}
                        {sortHeader("project_name", "Project")}
                        {sortHeader("client_name", "Client")}
                        {sortHeader("fund_name", "Fund")}
                        {sortHeader("region", "Region")}
                        {sortHeader("sector", "Sector")}
                        {sortHeader("project_type", "Type")}
                        {sortHeader("duration_weeks", "Dur.")}
                        {sortHeader("team_size", "Team")}
                        {sortHeader("currency", "Cur.")}
                        {sortHeader("weekly_price", "Weekly price")}
                        {sortHeader("outcome", "Outcome")}
                        <TableHead className="w-24">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedProposals.map(p => (
                        <React.Fragment key={p.id}>
                          <TableRow className={`cursor-pointer hover:bg-muted/30 ${isExcluded(p) ? "opacity-40 line-through" : ""}`} onClick={() => editProposal(p)}>
                            <TableCell className="text-xs text-muted-foreground">
                              {p.proposal_date ? new Date(p.proposal_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                            </TableCell>
                            <TableCell className="font-semibold text-sm">{p.project_name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{p.client_name || "—"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{p.fund_name || "—"}</TableCell>
                            <TableCell><Badge variant="secondary" className="text-xs">{p.region}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground">{p.sector || "—"}</TableCell>
                            <TableCell className="text-xs">{p.project_type ? <Badge variant="outline" className="text-xs capitalize">{p.project_type}</Badge> : "—"}</TableCell>
                            <TableCell className="text-sm">{p.duration_weeks ? `${p.duration_weeks}w` : "—"}</TableCell>
                            <TableCell onClick={e => e.stopPropagation()}>
                              <Select
                                value={String(p.team_size ?? 1)}
                                onValueChange={v => patchProposalInline(p.id!, { team_size: Number(v) })}
                              >
                                <SelectTrigger className="h-7 w-16 text-xs px-2"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0.5">0.5</SelectItem>
                                  <SelectItem value="1">1</SelectItem>
                                  <SelectItem value="1.5">1.5</SelectItem>
                                  <SelectItem value="2">2</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-xs font-semibold text-muted-foreground">{p.currency || "EUR"}</TableCell>
                            <TableCell className="font-semibold text-sm font-mono">{fmt(p.weekly_price)}</TableCell>
                            <TableCell>
                              {p.outcome === "won"
                                ? <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Won</Badge>
                                : p.outcome === "lost"
                                ? <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Lost</Badge>
                                : <Badge variant="secondary" className="text-xs">Pending</Badge>}
                            </TableCell>
                            <TableCell onClick={e => e.stopPropagation()}>
                              <div className="flex gap-1 items-center">
                                <button onClick={() => editProposal(p)} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors" title="Edit">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                {/* File attachment */}
                                {p.attachment_url ? (
                                  <>
                                    <a href={p.attachment_url} target="_blank" rel="noopener noreferrer"
                                      className="text-primary hover:text-primary/80 p-1 rounded transition-colors" title={`Open: ${p.attachment_url.split("/").pop()}`}>
                                      <Paperclip className="w-3.5 h-3.5" />
                                    </a>
                                    <button onClick={async () => {
                                      await fetch(`/api/pricing/proposals/${p.id}/attachment`, { method: "DELETE", credentials: "include" });
                                      setProposals(prev => prev.map(r => r.id === p.id ? { ...r, attachment_url: null } : r));
                                      toast({ title: "Attachment removed" });
                                    }} className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors" title="Remove attachment">
                                      <X className="w-3 h-3" />
                                    </button>
                                  </>
                                ) : (
                                  <label className="text-muted-foreground hover:text-primary p-1 rounded transition-colors cursor-pointer" title="Upload PPT/PDF">
                                    <Paperclip className="w-3.5 h-3.5" />
                                    <input type="file" className="hidden" accept=".ppt,.pptx,.pdf,.key"
                                      onChange={async e => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const res = await fetch(`/api/pricing/proposals/${p.id}/attachment`, {
                                          method: "PUT", credentials: "include",
                                          headers: { "Content-Type": "application/octet-stream", "X-Filename": file.name },
                                          body: file,
                                        });
                                        if (res.ok) {
                                          const { attachment_url } = await res.json();
                                          setProposals(prev => prev.map(r => r.id === p.id ? { ...r, attachment_url } : r));
                                          toast({ title: "File uploaded", description: file.name });
                                        } else {
                                          toast({ title: "Upload failed", variant: "destructive" });
                                        }
                                        e.target.value = "";
                                      }}
                                    />
                                  </label>
                                )}
                                {/* Exclude from analysis toggle */}
                                <button
                                  onClick={() => patchProposalInline(p.id!, {
                                    excluded_from_analysis: isExcluded(p) ? 0 : 1
                                  } as any)}
                                  className={`p-1 rounded transition-colors relative ${
                                    isExcluded(p)
                                      ? "text-amber-500 hover:text-amber-700"
                                      : "text-muted-foreground hover:text-amber-500"
                                  }`}
                                  title={isExcluded(p) ? "Excluded from analysis — click to include" : "Exclude from analysis"}
                                >
                                  {isExcluded(p) ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                                <button onClick={() => deleteProposal(p.id!)} className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors" title="Delete">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {showEditProposalForm && editingProposalId === p.id && (
                            <TableRow className="bg-primary/5 hover:bg-primary/5">
                              <TableCell colSpan={13} className="p-4 border-t-2 border-primary/30">
                                {renderProposalEditForm()}
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              );
            })()}

            {/* ── Admin: Funds ─────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Funds</CardTitle>
                  <div className="flex gap-2">
                    {editingFunds ? (
                      <>
                        <Button size="sm" onClick={() => saveFunds(fundsLocal)}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setFundsLocal(settings?.funds ?? DEFAULT_PRICING_SETTINGS.funds ?? []); setEditingFunds(false); }}>Cancel</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => { setFundsLocal([...(settings?.funds ?? DEFAULT_PRICING_SETTINGS.funds ?? [])]); setEditingFunds(true); }}>
                        Edit
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {editingFunds ? (
                  <div className="space-y-2">
                    {fundsLocal.map((f, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input value={f} onChange={e => setFundsLocal(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                          className="h-7 text-sm flex-1 font-mono uppercase" />
                        <button onClick={() => setFundsLocal(prev => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-destructive p-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setFundsLocal(prev => [...prev, ""])}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add fund
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(settings?.funds ?? DEFAULT_PRICING_SETTINGS.funds ?? []).map(f => (
                      <Badge key={f} variant="secondary" className="text-xs font-mono">{f}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Admin: Regions ───────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Regions</CardTitle>
                  <div className="flex gap-2">
                    {editingRegions ? (
                      <>
                        <Button size="sm" onClick={() => saveRegions(regionsLocal)}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setRegionsLocal(settings?.regions ?? DEFAULT_PRICING_SETTINGS.regions); setEditingRegions(false); }}>Cancel</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => { setRegionsLocal([...(settings?.regions ?? DEFAULT_PRICING_SETTINGS.regions)]); setEditingRegions(true); }}>
                        Edit
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {editingRegions ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr,80px,60px,32px] gap-2 text-[10px] font-semibold text-muted-foreground uppercase px-1">
                      <span>Region code</span><span>Multiplier</span><span>Baseline</span><span />
                    </div>
                    {regionsLocal.map((r, i) => (
                      <div key={i} className="grid grid-cols-[1fr,80px,60px,32px] gap-2 items-center">
                        <Input value={r.region_name}
                          onChange={e => setRegionsLocal(prev => prev.map((v, j) => j === i ? { ...v, region_name: e.target.value } : v))}
                          className="h-7 text-sm" placeholder="e.g. IT" />
                        <Input type="number" step="0.01" min="0.5" max="3" value={r.multiplier}
                          onChange={e => setRegionsLocal(prev => prev.map((v, j) => j === i ? { ...v, multiplier: parseFloat(e.target.value) || 1 } : v))}
                          className="h-7 text-sm font-mono" />
                        <div className="flex justify-center">
                          <input type="checkbox" checked={r.is_baseline}
                            onChange={e => setRegionsLocal(prev => prev.map((v, j) => j === i ? { ...v, is_baseline: e.target.checked } : v))}
                          />
                        </div>
                        <button onClick={() => setRegionsLocal(prev => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-destructive p-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setRegionsLocal(prev => [
                      ...prev,
                      { id: `region_${Date.now()}`, region_name: "", multiplier: 1.0, is_baseline: false }
                    ])}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add region
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(settings?.regions ?? DEFAULT_PRICING_SETTINGS.regions).map(r => (
                      <Badge key={r.id} variant={r.is_baseline ? "default" : "secondary"} className="text-xs">
                        {r.region_name}
                        {!r.is_baseline && <span className="text-muted-foreground ml-1">×{r.multiplier.toFixed(2)}</span>}
                        {r.is_baseline && <span className="ml-1 opacity-60">baseline</span>}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Admin: Project Types ─────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Project Types</CardTitle>
                  <div className="flex gap-2">
                    {editingProjectTypes ? (
                      <>
                        <Button size="sm" onClick={() => saveProjectTypes(projectTypesLocal)}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setProjectTypesLocal(projectTypes); setEditingProjectTypes(false); }}>Cancel</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => { setProjectTypesLocal([...projectTypes]); setEditingProjectTypes(true); }}>
                        Edit
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {editingProjectTypes ? (
                  <div className="space-y-2">
                    {projectTypesLocal.map((t, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input value={t} onChange={e => setProjectTypesLocal(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                          className="h-7 text-sm flex-1" />
                        <button onClick={() => setProjectTypesLocal(prev => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-destructive p-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setProjectTypesLocal(prev => [...prev, ""])}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add type
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {projectTypes.map(t => (
                      <Badge key={t} variant="secondary" className="text-xs capitalize">{t}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Admin: Sectors ───────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Sectors</CardTitle>
                  <div className="flex gap-2">
                    {editingSectors ? (
                      <>
                        <Button size="sm" onClick={() => saveSectors(sectorsLocal)}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setSectorsLocal(settings?.sectors ?? [...SECTORS]); setEditingSectors(false); }}>Cancel</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => { setSectorsLocal([...(settings?.sectors ?? [...SECTORS])]); setEditingSectors(true); }}>
                        Edit
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {editingSectors ? (
                  <div className="space-y-2">
                    {sectorsLocal.map((s, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input value={s} onChange={e => setSectorsLocal(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                          className="h-7 text-sm flex-1" />
                        <button onClick={() => setSectorsLocal(prev => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-destructive p-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => setSectorsLocal(prev => [...prev, ""])}>
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add sector
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(settings?.sectors ?? [...SECTORS]).map(s => (
                      <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        ) : null}

        {/* ── WIN-LOSS ANALYSIS TAB ──────────────────────────────── */}
        {mainTab === "winloss" && (
          <div className="space-y-6">

            {/* ── Fees by Country (live — always recomputed from current proposals) ── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold uppercase tracking-wide">Fees by Country</CardTitle>
                  <span className="text-[10px] text-muted-foreground italic">Live from past projects</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Analysis table — always computed live from current proposals */}
                {(() => {
                  const liveFees = computeFeesByCountry(analysisProposals);
                  if (liveFees.length === 0) {
                    return <p className="text-xs text-muted-foreground text-center py-4">No win/loss data yet — mark projects as Won or Lost to populate this table.</p>;
                  }
                  const fmtFee = (n: number | null) => n != null ? Math.round(n).toLocaleString("it-IT") : "—";
                  return (
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-[#1A3A4A] text-white">
                            <TableHead className="text-white text-xs font-bold py-2">Country</TableHead>
                            <TableHead className="text-white text-xs font-bold py-2 text-center">Won</TableHead>
                            <TableHead className="text-white text-xs font-bold py-2 text-center">Lost</TableHead>
                            <TableHead className="text-white text-xs font-bold py-2 text-center">Win Rate</TableHead>
                            <TableHead className="text-white text-xs font-bold py-2 text-right">Avg Won /wk</TableHead>
                            <TableHead className="text-white text-xs font-bold py-2 text-right">Avg Lost /wk</TableHead>
                            <TableHead className="text-white text-xs font-bold py-2 text-right">Avg Fee Won (€)</TableHead>
                            <TableHead className="text-white text-xs font-bold py-2 text-right">Avg Fee Lost (€)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {liveFees.map((r, i) => {
                            const hasData = r.won > 0 || r.lost > 0;
                            return (
                              <TableRow key={r.country} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                                <TableCell className="text-xs font-medium py-2">{r.country}</TableCell>
                                <TableCell className="text-xs text-center font-semibold text-emerald-600 py-2">{r.won}</TableCell>
                                <TableCell className="text-xs text-center font-semibold text-red-500 py-2">{r.lost}</TableCell>
                                <TableCell className="text-xs text-center py-2">
                                  {!hasData ? "—" : r.winRate != null ? `${Math.round(r.winRate * 100)}%` : "—"}
                                </TableCell>
                                <TableCell className="text-xs text-right font-mono font-semibold text-emerald-700 py-2">
                                  {r.avgWonWeekly != null ? fmtFee(r.avgWonWeekly) : <span className="text-muted-foreground font-normal">-</span>}
                                </TableCell>
                                <TableCell className="text-xs text-right font-mono font-semibold text-red-600 py-2">
                                  {r.avgLostWeekly != null ? fmtFee(r.avgLostWeekly) : <span className="text-muted-foreground font-normal">-</span>}
                                </TableCell>
                                <TableCell className="text-xs text-right font-mono py-2">
                                  {r.won > 0 ? fmtFee(r.avgWon) : <span className="text-muted-foreground">-</span>}
                                </TableCell>
                                <TableCell className="text-xs text-right font-mono py-2">
                                  {r.lost > 0 ? fmtFee(r.avgLost) : <span className="text-muted-foreground">-</span>}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

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
                  ) : (() => {
                    const fB = (n: number) => n >= 1000 ? `€${Math.round(n / 1000)}k` : `€${n}`;
                    // Group benchmark rows by admin region (merge countries in same region)
                    const benchmarkCountries = [...new Set(benchmarks.map(b => b.country))];
                    const countryToReg = (c: string) => countryToRegion(c) ?? c;
                    const countries = [...new Set(benchmarkCountries.map(c => countryToReg(c)))];

                    // Helper: find won proposals for a region (all countries in that region)
                    const wonForCountry = (regionKey: string) => {
                      const aliases = REGION_TO_COUNTRY[regionKey] ?? [regionKey];
                      return analysisProposals.filter(p =>
                        p.outcome === "won" && (
                          p.region === regionKey ||
                          aliases.some(a => a.toLowerCase() === (p.country ?? "").toLowerCase())
                        )
                      );
                    };

                    // Merge benchmark rows from multiple countries into one region.
                    // For the same parameter, take the union (widest band).
                    const benchmarksByRegion = (regionKey: string): CountryBenchmarkRow[] => {
                      const regionCountries = benchmarkCountries.filter(c => countryToReg(c) === regionKey);
                      const params = [...new Set(regionCountries.flatMap(c =>
                        benchmarks.filter(b => b.country === c).map(b => b.parameter)
                      ))];
                      return params.map(param => {
                        const rows = regionCountries
                          .map(c => benchmarks.find(b => b.country === c && b.parameter === param))
                          .filter(Boolean) as CountryBenchmarkRow[];
                        if (rows.length === 0) return null;
                        // Merge: widest bands = min of lows, max of highs; avg decisiveness
                        const nonZero = rows.filter(r => r.yellow_high > 0);
                        if (nonZero.length === 0) return { ...rows[0], country: regionKey };
                        return {
                          country: regionKey,
                          parameter: param,
                          yellow_low:  Math.min(...nonZero.map(r => r.yellow_low)),
                          green_low:   Math.min(...nonZero.map(r => r.green_low)),
                          green_high:  Math.max(...nonZero.map(r => r.green_high)),
                          yellow_high: Math.max(...nonZero.map(r => r.yellow_high)),
                          decisiveness_pct: Math.round(nonZero.reduce((s, r) => s + r.decisiveness_pct, 0) / nonZero.length),
                        };
                      }).filter(Boolean) as CountryBenchmarkRow[];
                    };

                    // Global shared scales per parameter type (so bars are comparable across countries)
                    // Include synthetic bands (avgWonWeekly * 1.1) for countries without benchmark data
                    const weeklyRows = benchmarks.filter(b => b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"));
                    const totalRows = benchmarks.filter(b => b.parameter.toLowerCase().includes("total") || b.parameter.toLowerCase().includes("cost"));
                    const syntheticWeeklyHighs = countries
                      .filter(c => benchmarksByRegion(c).filter(r => (r.parameter.toLowerCase().includes("weekly") || r.parameter.toLowerCase().includes("fee")) && r.yellow_high > 0).length === 0)
                      .map(c => {
                        const wp = wonForCountry(c);
                        return wp.length > 0 ? (wp.reduce((s, p) => s + p.weekly_price, 0) / wp.length) * 1.1 : 0;
                      });
                    const weeklyScale = Math.max(
                      ...weeklyRows.map(r => r.yellow_high).filter(Boolean),
                      ...syntheticWeeklyHighs,
                      1
                    );
                    const totalScale = Math.max(...totalRows.map(r => r.yellow_high).filter(Boolean), 1);
                    const getScale = (row: CountryBenchmarkRow) =>
                      (row.parameter.toLowerCase().includes("weekly") || row.parameter.toLowerCase().includes("fee"))
                        ? weeklyScale : totalScale;

                    const deleteCountry = (regionKey: string) => {
                      // Delete all benchmark rows for countries in this region
                      const regionCountryNames = benchmarkCountries.filter(c => countryToReg(c) === regionKey);
                      const updated = benchmarks.filter(b => !regionCountryNames.includes(b.country));
                      saveBenchmarks(updated);
                    };

                    return (
                      <div className="space-y-5">
                        {/* Scale legend */}
                        <div className="flex gap-6 text-[9px] text-muted-foreground">
                          <span>Weekly scale: 0 – {fB(weeklyScale)}</span>
                          <span>Total scale: 0 – {fB(totalScale)}</span>
                          <span className="ml-auto flex gap-3">
                            <span><span className="inline-block w-3 h-2 bg-amber-300/70 rounded-sm mr-1" />Yellow</span>
                            <span><span className="inline-block w-3 h-2 bg-emerald-400/80 rounded-sm mr-1" />Green</span>
                            <span><span className="inline-block w-3 h-2 bg-red-400/50 rounded-sm mr-1" />Red (high)</span>
                          </span>
                        </div>
                        {countries.map(country => {
                          const rows = benchmarksByRegion(country);
                          const wonProposals = wonForCountry(country);
                          const avgWonWeekly = wonProposals.length > 0
                            ? wonProposals.reduce((s, p) => s + p.weekly_price, 0) / wonProposals.length
                            : null;
                          return (
                            <div key={country}>
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-xs font-bold uppercase tracking-wide">{country}</span>
                                {wonProposals.length > 0 && (
                                  <span className="text-[9px] text-emerald-600 font-medium">
                                    {wonProposals.length} won · avg {fB(avgWonWeekly!)}/wk
                                  </span>
                                )}
                                <div className="flex-1 border-t border-border" />
                                <button
                                  onClick={() => deleteCountry(country)}
                                  className="text-muted-foreground hover:text-destructive p-0.5 rounded transition-colors"
                                  title={`Remove ${country}`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                              <div className="grid grid-cols-[280px,1fr] gap-3 items-start">
                                {/* Left: compact number table */}
                                <table className="text-[10px] w-full border rounded overflow-hidden">
                                  <thead>
                                    <tr className="bg-muted/30 border-b">
                                      <th className="text-left px-2 py-1 font-semibold text-muted-foreground">Parameter</th>
                                      <th className="text-center px-2 py-1 font-semibold text-emerald-700">🟢 Green</th>
                                      <th className="text-center px-2 py-1 font-semibold text-muted-foreground">Decisive</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((row, i) => (
                                      <tr key={i} className="border-b last:border-0">
                                        <td className="px-2 py-1 font-medium text-muted-foreground">{row.parameter.replace("Total project cost", "Total").replace("Weekly fee", "Weekly")}</td>
                                        <td className="px-2 py-1 text-center font-mono text-emerald-700">
                                          {row.green_high === 0
                                            ? (avgWonWeekly && row.parameter.toLowerCase().includes("weekly")
                                                ? <span className="text-emerald-600 italic">{fB(avgWonWeekly * 0.9)}–{fB(avgWonWeekly * 1.1)}</span>
                                                : <span className="text-muted-foreground italic">n/a</span>)
                                            : `${fB(row.green_low)}–${fB(row.green_high)}`}
                                        </td>
                                        <td className="px-2 py-1 text-center font-semibold">{row.decisiveness_pct}%</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {/* Right: visual band bars (shared scale) */}
                                <div className="space-y-2 pt-1">
                                  {rows.map((row, i) => {
                                    const scale = getScale(row);
                                    const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100)).toFixed(2)}%`;
                                    const noData = row.yellow_high === 0;
                                    const isWeekly = row.parameter.toLowerCase().includes("weekly") || row.parameter.toLowerCase().includes("fee");
                                    // Synthetic band from won proposals when no benchmark data
                                    const synthLow = noData && avgWonWeekly && isWeekly ? avgWonWeekly * 0.9 : null;
                                    const synthHigh = noData && avgWonWeekly && isWeekly ? avgWonWeekly * 1.1 : null;
                                    return (
                                      <div key={i} className="space-y-0.5">
                                        <div className="text-[9px] text-muted-foreground">{row.parameter.replace("Total project cost", "Total").replace("Weekly fee", "Weekly")}</div>
                                        {noData && !synthLow ? (
                                          <div className="h-5 rounded bg-muted/30 flex items-center px-2">
                                            <span className="text-[9px] text-muted-foreground italic">No data</span>
                                          </div>
                                        ) : (
                                          <div className="relative h-10 rounded overflow-hidden bg-white border border-border/50">
                                            {noData && synthLow && synthHigh ? (
                                              /* Synthetic green band from won projects ±10% */
                                              <>
                                                <div className="absolute inset-y-0 bg-emerald-400/70"
                                                  style={{ left: pct(synthLow), width: `${Math.max(0, (synthHigh - synthLow) / scale * 100).toFixed(2)}%` }} />
                                                {/* value label above green band */}
                                                <span className="absolute text-[12px] font-bold text-emerald-800 leading-none px-1"
                                                  style={{ left: pct(synthLow), top: 3 }}>
                                                  {fB(synthLow)}–{fB(synthHigh)}
                                                </span>
                                                <div className="absolute bottom-1 text-[9px] text-emerald-700 italic w-full text-center leading-none">
                                                  estimated ±10%
                                                </div>
                                              </>
                                            ) : (
                                              <>
                                                {/* left zone: 0 → yellow_low — white (no colour) */}
                                                {/* yellow left: yellow_low → green_low */}
                                                <div className="absolute inset-y-0 bg-amber-300/70" style={{ left: pct(row.yellow_low), width: `${Math.max(0, (row.green_low - row.yellow_low) / scale * 100).toFixed(2)}%` }} />
                                                {/* green: green_low → green_high */}
                                                <div className="absolute inset-y-0 bg-emerald-400/80" style={{ left: pct(row.green_low), width: `${Math.max(0, (row.green_high - row.green_low) / scale * 100).toFixed(2)}%` }} />
                                                {/* yellow right: green_high → yellow_high */}
                                                <div className="absolute inset-y-0 bg-amber-300/70" style={{ left: pct(row.green_high), width: `${Math.max(0, (row.yellow_high - row.green_high) / scale * 100).toFixed(2)}%` }} />
                                                {/* red right: yellow_high → scale */}
                                                <div className="absolute inset-y-0 bg-red-400/50" style={{ left: pct(row.yellow_high), right: 0 }} />
                                                {/* Green band value label */}
                                                <span className="absolute text-[12px] font-bold text-emerald-900 leading-none pointer-events-none px-1"
                                                  style={{ left: `calc(${pct(row.green_low)} + 2px)`, top: 3 }}>
                                                  {fB(row.green_low)}–{fB(row.green_high)}
                                                </span>
                                              </>
                                            )}
                                            {/* Scale tick marks */}
                                            {[0.25, 0.5, 0.75].map(t => (
                                              <div key={t} className="absolute inset-y-0 w-px bg-black/10" style={{ left: `${t * 100}%` }} />
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {/* Scale axis labels */}
                        <div className="grid grid-cols-[280px,1fr] gap-3">
                          <div />
                          <div className="flex justify-between text-[8px] text-muted-foreground px-0.5">
                            <span>0</span><span>25%</span><span>50%</span><span>75%</span><span>max</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()
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

            {/* ── Win-Loss Scatter by Country ──────────────────────── */}
            {(() => {
              const wl = analysisProposals.filter(p => p.outcome === "won" || p.outcome === "lost");
              if (wl.length === 0) return null;
              const byCountry = new Map<string, PricingProposal[]>();
              for (const p of wl) {
                const key = proposalRegionKey(p);
                if (!byCountry.has(key)) byCountry.set(key, []);
                byCountry.get(key)!.push(p);
              }
              const countries = [...byCountry.entries()]
                .filter(([, ps]) => ps.length > 0)
                .sort((a, b) => b[1].length - a[1].length);
              if (countries.length === 0) return null;

              return (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wide">Win-Loss Distribution by Country</CardTitle>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      X axis = weekly price (€/wk). Y axis = none (dots stacked for visibility — won on top, lost below). Recomputed from current past projects on every render.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      {countries.map(([country, cps]) => {
                        const won = cps.filter(p => p.outcome === "won");
                        const lost = cps.filter(p => p.outcome === "lost");
                        const prices = cps.map(p => p.weekly_price);
                        const minP = Math.min(...prices);
                        const maxP = Math.max(...prices);
                        const range = maxP - minP || Math.max(maxP, 1);
                        const pad = range * 0.1;
                        const sMin = Math.max(0, minP - pad);
                        const sMax = maxP + pad;
                        const sRange = sMax - sMin || 1;
                        const avgWon = won.length ? won.reduce((s, p) => s + p.weekly_price, 0) / won.length : null;
                        const avgLost = lost.length ? lost.reduce((s, p) => s + p.weekly_price, 0) / lost.length : null;
                        const sym = getCurrencyForRegion(cps[0].region).symbol;
                        const fmtK2 = (n: number) => `${sym}${Math.round(n / 1000)}k`;
                        const W = 320, H = 90;
                        const padL = 6, padR = 6, padT = 8, padB = 18;
                        const plotW = W - padL - padR;
                        const xAt = (v: number) => padL + ((v - sMin) / sRange) * plotW;

                        return (
                          <div key={country} className="border rounded-lg p-2.5 bg-background">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-bold uppercase tracking-wide">{country}</span>
                              <div className="flex items-center gap-1.5 text-[9px]">
                                <span className="text-emerald-600 font-semibold">{won.length}W</span>
                                <span className="text-muted-foreground">·</span>
                                <span className="text-red-500 font-semibold">{lost.length}L</span>
                              </div>
                            </div>
                            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
                              <rect x={padL} y={padT} width={plotW} height={H - padT - padB}
                                fill="#f8fafc" stroke="#e2e8f0" strokeWidth="0.5" rx="2" />
                              {/* won band (avg ±10%) */}
                              {avgWon != null && (
                                <rect
                                  x={xAt(avgWon * 0.9)}
                                  y={padT}
                                  width={Math.max(2, xAt(avgWon * 1.1) - xAt(avgWon * 0.9))}
                                  height={H - padT - padB}
                                  fill="#dcfce7" opacity="0.7"
                                />
                              )}
                              {/* avg markers */}
                              {avgWon != null && (
                                <line x1={xAt(avgWon)} y1={padT} x2={xAt(avgWon)} y2={H - padB}
                                  stroke="#10b981" strokeWidth="1.2" strokeDasharray="2,2" />
                              )}
                              {avgLost != null && (
                                <line x1={xAt(avgLost)} y1={padT} x2={xAt(avgLost)} y2={H - padB}
                                  stroke="#ef4444" strokeWidth="1.2" strokeDasharray="2,2" />
                              )}
                              {/* won dots */}
                              {won.map((p, i) => (
                                <circle key={`w${i}`} cx={xAt(p.weekly_price)}
                                  cy={padT + 12 + (i % 3) * 10} r="3.5"
                                  fill="#10b981" opacity="0.85" stroke="#065f46" strokeWidth="0.4">
                                  <title>{p.project_name} · Won · {fmtK2(p.weekly_price)}/wk</title>
                                </circle>
                              ))}
                              {/* lost dots */}
                              {lost.map((p, i) => (
                                <circle key={`l${i}`} cx={xAt(p.weekly_price)}
                                  cy={padT + 42 + (i % 3) * 10} r="3.5"
                                  fill="#ef4444" opacity="0.85" stroke="#7f1d1d" strokeWidth="0.4">
                                  <title>{p.project_name} · Lost · {fmtK2(p.weekly_price)}/wk</title>
                                </circle>
                              ))}
                              {/* scale labels */}
                              <text x={padL} y={H - 4} fontSize="7" fill="#94a3b8">{fmtK2(sMin)}</text>
                              <text x={W - padR} y={H - 4} fontSize="7" fill="#94a3b8" textAnchor="end">{fmtK2(sMax)}</text>
                              <text x={W / 2} y={H - 4} fontSize="7" fill="#94a3b8" textAnchor="middle">{fmtK2((sMin + sMax) / 2)}</text>
                            </svg>
                            <div className="flex items-center justify-between text-[9px] mt-0.5">
                              <span className="text-emerald-700 font-mono">
                                {avgWon != null ? `avg won ${fmtK2(avgWon)}` : "—"}
                              </span>
                              <span className="text-red-600 font-mono">
                                {avgLost != null ? `avg lost ${fmtK2(avgLost)}` : "—"}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Won
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500" /> Lost
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-2 bg-emerald-200 rounded-sm" /> Won avg ±10%
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-0.5 bg-emerald-500" /> Avg won
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-0.5 bg-red-500" /> Avg lost
                      </div>
                    </div>
                  </CardContent>
                </Card>
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
                      {projectTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
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
                      {(settings?.sectors ?? [...SECTORS]).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                {/* Incremental aspiration EBITDA (% increase) */}
                <div className="space-y-1">
                  <Label className="text-xs">Aspiration EBITDA increase (%)</Label>
                  <Input type="number" min="0" max="200" step="1"
                    placeholder="e.g. 10"
                    value={form.aspiration_ebitda_pct ?? ""}
                    onChange={e => setForm(f => ({ ...f, aspiration_ebitda_pct: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
                  <div className="text-[9px] text-muted-foreground">% increase in EBITDA targeted by the project. Used in TNF/Aspiration ratio below.</div>
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

            // Map trace entries by normalized label
            const traceByKey: Record<string, LayerTrace> = {};
            for (const lt of trace) {
              const key = lt.label.replace(/\s*\(.*?\)\s*$/, "").trim();
              traceByKey[key] = lt;
            }

            const CANONICAL = [
              "Geography", "Market Context", "Client Profile",
              "Cost Floor Applied", "Strategic Intent",
            ];

            // Compute absolute deltas from original trace
            const deltas: Record<string, number> = {};
            const origNotes: Record<string, string> = {};
            const origDeltaPct: Record<string, number> = {};
            let prevOrig = base;
            for (const key of CANONICAL) {
              const lt = traceByKey[key];
              if (lt) {
                deltas[key] = lt.value - prevOrig;
                origNotes[key] = lt.note;
                origDeltaPct[key] = lt.delta_pct;
                prevOrig = lt.value;
              } else {
                deltas[key] = 0; origNotes[key] = "No impact"; origDeltaPct[key] = 0;
              }
            }

            // Build bars respecting disabledBars state
            const bars: { label: string; start: number; end: number; note: string; deltaPct: number; isDisabled: boolean }[] = [];
            let runningValue = base;
            for (const key of CANONICAL) {
              const delta = deltas[key] ?? 0;
              const isDisabled = disabledBars.has(key);
              if (isDisabled) {
                bars.push({ label: key, start: runningValue, end: runningValue, note: "off", deltaPct: 0, isDisabled: true });
              } else if (Math.abs(delta) < 1) {
                bars.push({ label: key, start: runningValue, end: runningValue, note: origNotes[key], deltaPct: 0, isDisabled: false });
              } else {
                const newEnd = runningValue + delta;
                bars.push({ label: key, start: runningValue, end: newEnd, note: origNotes[key], deltaPct: origDeltaPct[key], isDisabled: false });
                runningValue = newEnd;
              }
            }
            const adjustedFinal = runningValue;

            // NWF = adjusted final after discounts
            const adjustedNwfRaw = Math.round(adjustedFinal * netMultiplier);
            const adjustedNwfClamped = adjustedNwfRaw > 0
              ? Math.max(minFeeWeekly > 0 ? minFeeWeekly : adjustedNwfRaw, Math.min(maxFeeWeekly < Infinity ? maxFeeWeekly : adjustedNwfRaw, adjustedNwfRaw))
              : 0;
            const showNWFBar = totalDiscountPct > 0 || Math.abs(adjustedNwfClamped - adjustedFinal) > 50;
            const extraBars: { label: string; start: number; end: number; color?: string; deltaPct: number }[] = [];
            if (showNWFBar) {
              const deltaPct = adjustedFinal > 0 ? ((adjustedNwfClamped - adjustedFinal) / adjustedFinal) * 100 : 0;
              extraBars.push({ label: "NWP", start: adjustedFinal, end: adjustedNwfClamped, color: "#059669", deltaPct });
            }
            const nwfFinal = adjustedNwfClamped > 0 ? adjustedNwfClamped : adjustedFinal;

            // Green band from country benchmarks
            const countryAliasesW = REGION_TO_COUNTRY[form.region] ?? [form.region];
            const weeklyBenchW = benchmarks.find(b =>
              countryAliasesW.some(a => a.toLowerCase() === b.country.toLowerCase()) &&
              (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"))
            );
            const greenLow = weeklyBenchW?.green_low ?? 0;
            const greenHigh = weeklyBenchW?.green_high ?? 0;
            const hasGreenBand = greenLow > 0 && greenHigh > 0;

            // Recommended NWF: clamp to green band
            const recommendedNwf = hasGreenBand
              ? Math.min(greenHigh, Math.max(greenLow, nwfFinal))
              : nwfFinal;

            // Duration & fee calculation for right panel
            const effectiveDuration = waterfallDuration ?? form.duration_weeks;
            const grossFees = Math.round(adjustedFinal * effectiveDuration);
            const netFees = Math.round(recommendedNwf * effectiveDuration);

            // Y-scale
            const allVals = [base, adjustedFinal, ...bars.flatMap(b => [b.start, b.end]),
              ...extraBars.flatMap(b => [b.start, b.end]), nwfFinal, recommendedNwf,
              ...(hasGreenBand ? [greenLow, greenHigh] : [])];
            const minV = Math.min(...allVals) * 0.92;
            const maxV = Math.max(...allVals) * 1.08;
            const range = maxV - minV || 1;

            // Layout
            const totalBarCount = 1 + bars.length + 1 + extraBars.length + (showNWFBar ? 1 : 0) + 1; // +1 rec NWF
            const W = 620; const H = 210;
            const TH = 16; // toggle row height at top
            const chartBot = H - 22; const chartTop = TH + 12;
            const chartH = chartBot - chartTop;
            const barW = Math.max(20, Math.floor((W - 60) / (totalBarCount + 1) - 4));
            const gap = Math.max(3, Math.floor((W - 60 - totalBarCount * barW) / totalBarCount));
            const xOf = (i: number) => 30 + i * (barW + gap);
            const yOf = (v: number) => chartBot - ((v - minV) / range) * chartH;
            const hOf = (v1: number, v2: number) => Math.abs(yOf(v1) - yOf(v2));

            const SHORT: Record<string, string> = {
              "Geography": "Geo", "Market Context": "Market", "Client Profile": "Client",
              "Cost Floor Applied": "Floor", "Strategic Intent": "Intent",
            };

            const toggleBar = (label: string) => setDisabledBars(prev => {
              const next = new Set(prev);
              next.has(label) ? next.delete(label) : next.add(label);
              return next;
            });

            return (
              <div className="border rounded-lg p-4 bg-muted/10">
                <div className="flex items-start gap-5">
                  {/* Left: waterfall SVG */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="text-xs font-bold uppercase text-muted-foreground tracking-wide">Pricing Waterfall</div>
                    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
                      {/* Green band background */}
                      {hasGreenBand && (
                        <rect x={25} y={yOf(greenHigh)} width={W - 30} height={Math.max(1, hOf(greenLow, greenHigh))}
                          fill="#22c55e" opacity="0.08" />
                      )}
                      {hasGreenBand && <>
                        <line x1={25} x2={W - 5} y1={yOf(greenHigh)} y2={yOf(greenHigh)} stroke="#22c55e" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.55" />
                        <line x1={25} x2={W - 5} y1={yOf(greenLow)} y2={yOf(greenLow)} stroke="#22c55e" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.55" />
                        <text x={W - 6} y={yOf(greenHigh) - 2} textAnchor="end" fontSize="5" fill="#16a34a" opacity="0.8">{fmt(greenHigh)}</text>
                        <text x={W - 6} y={yOf(greenLow) + 7} textAnchor="end" fontSize="5" fill="#16a34a" opacity="0.8">{fmt(greenLow)}</text>
                      </>}

                      {/* Base bar */}
                      {(() => {
                        const x = xOf(0); const y = yOf(base); const h = hOf(minV, base);
                        return <>
                          <rect x={x} y={y} width={barW} height={h} fill="#1A6571" rx="2" />
                          <text x={x + barW/2} y={y - 3} textAnchor="middle" fontSize="7" fill="#1A6571" fontWeight="bold">{fmt(base)}</text>
                          <text x={x + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="6.5" fill="#64748b">Staffing</text>
                        </>;
                      })()}

                      {/* Layer delta bars with toggles */}
                      {bars.map((b, i) => {
                        const x = xOf(i + 1);
                        const isZero = Math.abs(b.end - b.start) < 1;
                        const up = b.end >= b.start;
                        const color = b.isDisabled ? "#94a3b8" : (isZero ? "#cbd5e1" : (up ? "#16C3CF" : "#ef4444"));
                        const y = up ? yOf(b.end) : yOf(b.start);
                        const h = Math.max(2, hOf(b.start, b.end));
                        const deltaEur = b.end - b.start;
                        const sign = deltaEur >= 0 ? "+" : "";
                        const textY = up ? y - 9 : y + h + 8;
                        return (
                          <g key={i}>
                            {/* Toggle pill */}
                            <g style={{ cursor: "pointer" }} onClick={() => toggleBar(b.label)}>
                              <rect x={x} y={2} width={barW} height={TH - 3} rx="2"
                                fill={b.isDisabled ? "#f1f5f9" : "#e0f2fe"} stroke={b.isDisabled ? "#cbd5e1" : "#7dd3fc"} strokeWidth="0.5" />
                              <text x={x + barW/2} y={TH - 3} textAnchor="middle" fontSize="5.5"
                                fill={b.isDisabled ? "#94a3b8" : "#0369a1"} fontWeight="600">
                                {b.isDisabled ? "off" : "on"}
                              </text>
                            </g>
                            <line x1={xOf(i) + barW} y1={yOf(b.start)} x2={x} y2={yOf(b.start)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                            <rect x={x} y={y} width={barW} height={h} fill={color} rx="2" opacity={b.isDisabled ? 0.3 : (isZero ? 0.45 : 0.85)} />
                            <text x={x + barW/2} y={textY} textAnchor="middle" fontSize="7" fill={b.isDisabled ? "#94a3b8" : (isZero ? "#94a3b8" : color)} fontWeight="bold">
                              {b.isDisabled ? "—" : (isZero ? "—" : `${sign}${fmt(deltaEur)}`)}
                            </text>
                            {!b.isDisabled && !isZero && (
                              <text x={x + barW/2} y={textY + 6} textAnchor="middle" fontSize="5.5" fill="#94a3b8">
                                {sign}{b.deltaPct.toFixed(0)}%
                              </text>
                            )}
                            <text x={x + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="6" fill={b.isDisabled ? "#cbd5e1" : "#64748b"}>{SHORT[b.label] ?? b.label}</text>
                          </g>
                        );
                      })}

                      {/* Adjusted target bar */}
                      {(() => {
                        const bi = bars.length + 1;
                        const x = xOf(bi); const y = yOf(adjustedFinal); const h = hOf(minV, adjustedFinal);
                        const prevEnd = bars[bars.length - 1]?.end ?? base;
                        return <>
                          <line x1={xOf(bi - 1) + barW} y1={yOf(prevEnd)} x2={x} y2={yOf(adjustedFinal)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                          <rect x={x} y={y} width={barW} height={h} fill="#1A6571" rx="2" />
                          <text x={x + barW/2} y={y - 3} textAnchor="middle" fontSize="7" fill="#1A6571" fontWeight="bold">{fmt(adjustedFinal)}</text>
                          <text x={x + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="6.5" fill="#64748b">{showNWFBar ? "Target" : "NWF"}</text>
                        </>;
                      })()}

                      {/* Discount bars */}
                      {extraBars.map((b, i) => {
                        const bi = bars.length + 2 + i;
                        const x = xOf(bi); const up = b.end >= b.start;
                        const color = b.color ?? (up ? "#16C3CF" : "#ef4444");
                        const y = up ? yOf(b.end) : yOf(b.start);
                        const h = Math.max(2, hOf(b.start, b.end));
                        const deltaEur = b.end - b.start; const sign = deltaEur >= 0 ? "+" : "";
                        const textY = up ? y - 9 : y + h + 8;
                        return (
                          <g key={i}>
                            <line x1={xOf(bi - 1) + barW} y1={yOf(b.start)} x2={x} y2={yOf(b.start)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                            <rect x={x} y={y} width={barW} height={h} fill={color} rx="2" opacity="0.85" />
                            <text x={x + barW/2} y={textY} textAnchor="middle" fontSize="7" fill={color} fontWeight="bold">{sign}{fmt(deltaEur)}</text>
                            <text x={x + barW/2} y={textY + 6} textAnchor="middle" fontSize="5.5" fill="#94a3b8">{sign}{b.deltaPct.toFixed(0)}%</text>
                            <text x={x + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="6" fill="#64748b">{b.label}</text>
                          </g>
                        );
                      })}

                      {/* NWF bar */}
                      {showNWFBar && (() => {
                        const bi = bars.length + 2 + extraBars.length;
                        const x = xOf(bi); const y = yOf(nwfFinal); const h = hOf(minV, nwfFinal);
                        const prevEnd = extraBars[extraBars.length - 1]?.end ?? adjustedFinal;
                        return <>
                          <line x1={xOf(bi - 1) + barW} y1={yOf(prevEnd)} x2={x} y2={yOf(nwfFinal)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                          <rect x={x} y={y} width={barW} height={h} fill="#059669" rx="2" />
                          <text x={x + barW/2} y={y - 3} textAnchor="middle" fontSize="7" fill="#059669" fontWeight="bold">{fmt(nwfFinal)}</text>
                          <text x={x + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="6.5" fill="#64748b">NWF</text>
                        </>;
                      })()}

                      {/* Recommended NWF bar (clamped to green band) */}
                      {(() => {
                        const bi = bars.length + 2 + extraBars.length + (showNWFBar ? 1 : 0);
                        const prevBarEnd = showNWFBar ? nwfFinal : (extraBars[extraBars.length - 1]?.end ?? adjustedFinal);
                        const x = xOf(bi); const y = yOf(recommendedNwf); const h = hOf(minV, recommendedNwf);
                        const inGreen = hasGreenBand && recommendedNwf >= greenLow && recommendedNwf <= greenHigh;
                        const recColor = inGreen ? "#16a34a" : "#f59e0b";
                        return <>
                          <line x1={xOf(bi - 1) + barW} y1={yOf(prevBarEnd)} x2={x} y2={yOf(recommendedNwf)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                          <rect x={x} y={y} width={barW} height={h} fill={recColor} rx="2" />
                          <text x={x + barW/2} y={y - 3} textAnchor="middle" fontSize="7" fill={recColor} fontWeight="bold">{fmt(recommendedNwf)}</text>
                          <text x={x + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="6.5" fill={recColor} fontWeight="600">Rec.</text>
                        </>;
                      })()}

                      {/* Baseline */}
                      <line x1="25" y1={chartBot} x2={W - 5} y2={chartBot} stroke="#e2e8f0" strokeWidth="0.5" />
                    </svg>
                  </div>

                  {/* Right: duration only */}
                  <div className="w-36 shrink-0 flex flex-col gap-3 pt-6">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Duration</Label>
                      <Select
                        value={String(waterfallDuration ?? form.duration_weeks)}
                        onValueChange={v => setWaterfallDuration(Number(v))}
                      >
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[6, 8, 12, 16, 24].map(w => (
                            <SelectItem key={w} value={String(w)}>{w} weeks</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {hasGreenBand && (
                      <div className="text-[10px] text-emerald-600 text-center">
                        🟢 {fmt(greenLow)}–{fmt(greenHigh)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* SECTION C: Commercial Analysis */}
          {recommendation && nwfClamped > 0 && (() => {
            const cur = getCurrencyForRegion(form.region);
            const fmtC = (n: number) => cur.symbol + Math.round(n).toLocaleString("it-IT");
            const fmtK2 = (n: number) => `${cur.symbol}${Math.round(n / 1000)}k`;

            const regionMap2: Record<string, string> = { IT: "Italy", FR: "France", DE: "DACH", UK: "UK", US: "US" };
            const matrixRegion2 = regionMap2[form.region] ?? "Italy";
            const competitorBenchmarks = settings?.competitor_benchmarks ?? DEFAULT_PRICING_SETTINGS.competitor_benchmarks;

            // (TNF / EBITDA ratios were moved to the right-column fee summary next to Gross/Net Project Fees.)

            // Benchmark totals for this region
            const benchRows = competitorBenchmarks.map(b => {
              const minW = (b.rates as any)[matrixRegion2]?.min_weekly ?? 0;
              const maxW = (b.rates as any)[matrixRegion2]?.max_weekly ?? 0;
              const avg = ((minW + maxW) / 2) * (form.duration_weeks || 12);
              return { label: b.label, color: "#94a3b8", avg }; // competitor bars always grey
            }).filter(r => r.avg > 0);

            // Gross / Net fees for display in Section C
            const secCEffDur = waterfallDuration ?? form.duration_weeks ?? 0;
            const secCBaseWkly = nwfClamped + manualDelta + negotiationDelta;
            const secCFinalWkly = Math.round(secCBaseWkly * (1 + variableFeePct / 100 + adminFeePct / 100));
            const secCGross = Math.round(secCBaseWkly * secCEffDur);
            const secCNet = Math.round(secCFinalWkly * secCEffDur);
            const allBenchVals = [...benchRows.map(r => r.avg), tnf];
            const benchScale = Math.max(...allBenchVals, 1) * 1.1;
            const pctBar = (v: number) => `${Math.min(100, (v / benchScale) * 100).toFixed(1)}%`;

            // Country band bars
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
                    <div className="text-[9px] text-muted-foreground italic">No benchmark</div>
                  </div>
                );
              }
              const rangeLow = Math.min(bench.yellow_low * 0.75, marker * 0.85);
              const rangeHigh = Math.max(bench.yellow_high * 1.15, marker * 1.15);
              const span = rangeHigh - rangeLow;
              const pct = (v: number) => Math.max(0, Math.min(100, ((v - rangeLow) / span) * 100));
              const markerPct = pct(marker);
              const band = marker >= bench.green_low && marker <= bench.green_high ? "green"
                : marker >= bench.yellow_low && marker <= bench.yellow_high ? "yellow" : "red";
              const bandColor = band === "green" ? "text-emerald-600" : band === "yellow" ? "text-amber-600" : "text-red-600";
              return (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-bold uppercase text-muted-foreground">{label}</div>
                    <div className={`text-[10px] font-bold ${bandColor}`}>{band === "green" ? "🟢" : band === "yellow" ? "🟡" : "🔴"}</div>
                  </div>
                  <div className="relative h-5 rounded overflow-hidden border border-border">
                    <div className="absolute inset-y-0 bg-red-400/40" style={{ left: 0, width: `${pct(bench.yellow_low)}%` }} />
                    <div className="absolute inset-y-0 bg-amber-300/60" style={{ left: `${pct(bench.yellow_low)}%`, width: `${pct(bench.green_low) - pct(bench.yellow_low)}%` }} />
                    <div className="absolute inset-y-0 bg-emerald-400/70" style={{ left: `${pct(bench.green_low)}%`, width: `${pct(bench.green_high) - pct(bench.green_low)}%` }} />
                    <div className="absolute inset-y-0 bg-amber-300/60" style={{ left: `${pct(bench.green_high)}%`, width: `${pct(bench.yellow_high) - pct(bench.green_high)}%` }} />
                    <div className="absolute inset-y-0 bg-red-400/40" style={{ left: `${pct(bench.yellow_high)}%`, right: 0 }} />
                    <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `calc(${markerPct}% - 1px)` }} />
                  </div>
                  <div className="flex justify-between text-[8px] text-muted-foreground font-mono">
                    <span>{fmtK2(rangeLow)}</span>
                    <span className="text-emerald-700">{fmtK2(bench.green_low)}–{fmtK2(bench.green_high)}</span>
                    <span>{fmtK2(rangeHigh)}</span>
                  </div>
                  <div className="text-[9px] text-center font-semibold">{fmtC(marker)}<span className="text-muted-foreground font-normal ml-1">({bench.decisiveness_pct}% decisive)</span></div>
                </div>
              );
            };

            return (
              <div className="border rounded-lg p-5 bg-muted/10 space-y-3">
                <div className="text-xs font-bold uppercase text-muted-foreground tracking-wide">Commercial Analysis</div>
                <div>
                  {/* Market benchmarks (combined box) */}
                  <div className="border rounded-lg p-3 bg-background space-y-3">
                    {/* TNF total */}
                    <div className="flex items-center justify-between rounded bg-primary/5 border border-primary/15 px-2 py-1.5">
                      <span className="text-[10px] font-semibold text-muted-foreground">Total Net Fees (TNF)</span>
                      <span className="text-sm font-bold text-primary">
                        {fmtC(tnf)}
                        <span className="text-[9px] font-normal text-muted-foreground ml-1">{form.duration_weeks}w × {fmtC(nwfClamped)}/wk</span>
                      </span>
                    </div>
                    {/* TNF vs Market bars */}
                    {benchRows.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-bold uppercase text-muted-foreground">TNF vs Market — {matrixRegion2}</div>
                        {[...benchRows, { label: "Our TNF", color: "#1A6571", avg: tnf, isOurs: true }].map((t, i) => (
                          <div key={i} className="space-y-0.5">
                            <div className="flex justify-between text-[9px] text-muted-foreground">
                              <span className={(t as any).isOurs ? "font-bold text-[#1A6571]" : ""}>{t.label}</span>
                              <span className="font-mono">{fmtK2(t.avg)}</span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: pctBar(t.avg), backgroundColor: t.color, opacity: (t as any).isOurs ? 1 : 0.7 }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Band bars */}
                    <BandBar bench={weeklyBench} marker={nwfClamped} label={`Weekly — ${weeklyBench?.country ?? form.region} · PE >${form.revenue_band === "above_1b" ? "€1B" : "€500M"}`} />
                    <BandBar bench={totalBench} marker={tnf} label={`Total cost — ${totalBench?.country ?? form.region}`} />

                    {/* W/L Comparables */}
                    {(() => {
                      const wins = recommendation.comparable_wins ?? [];
                      const losses = recommendation.comparable_losses ?? [];
                      const avgWin = recommendation.comparable_avg_win_weekly;
                      const avgLoss = recommendation.comparable_avg_loss_weekly;
                      if (wins.length === 0 && losses.length === 0) return (
                        <div className="text-[9px] text-muted-foreground italic">No W/L comparables found</div>
                      );
                      const allAvgs = [avgWin, avgLoss, nwfClamped].filter(Boolean) as number[];
                      const compScale = Math.max(...allAvgs) * 1.2;
                      const pctW = (v: number) => `${Math.min(100, (v / compScale) * 100).toFixed(1)}%`;
                      return (
                        <div className="space-y-1.5 pt-1 border-t border-border">
                          <div className="text-[10px] font-bold uppercase text-muted-foreground">W/L Comparables ({wins.length}W / {losses.length}L)</div>
                          {avgWin != null && (
                            <div className="space-y-0.5">
                              <div className="flex justify-between text-[9px]">
                                <span className="text-emerald-700 font-semibold">Avg Won ({wins.length})</span>
                                <span className="font-mono">{fmtC(avgWin)}/wk</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-emerald-500" style={{ width: pctW(avgWin) }} />
                              </div>
                            </div>
                          )}
                          {avgLoss != null && (
                            <div className="space-y-0.5">
                              <div className="flex justify-between text-[9px]">
                                <span className="text-red-600 font-semibold">Avg Lost ({losses.length})</span>
                                <span className="font-mono">{fmtC(avgLoss)}/wk</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-red-400" style={{ width: pctW(avgLoss) }} />
                              </div>
                            </div>
                          )}
                          <div className="space-y-0.5">
                            <div className="flex justify-between text-[9px]">
                              <span className="text-[#1A6571] font-bold">Our NWF</span>
                              <span className="font-mono">{fmtC(nwfClamped)}/wk</span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-[#1A6571]" style={{ width: pctW(nwfClamped) }} />
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* SECTION D: Price Finalization */}
          {recommendation && nwfClamped > 0 && (() => {
            const baseWeekly = nwfClamped + manualDelta + negotiationDelta;
            // Weekly gross+admin: base × (1 + admin%). Variable fee is excluded — it's a separate bucket.
            const weeklyGrossAdmin = Math.round(baseWeekly * (1 + adminFeePct / 100));
            const finalWeekly = weeklyGrossAdmin; // kept name used elsewhere in this block
            const effectiveDur = (waterfallDuration ?? form.duration_weeks) || 0;
            // Gross Project Fees = recommended (base) weekly × number of weeks
            const grossFees = Math.round(baseWeekly * effectiveDur);
            // Net Project Fees = Gross × (1 − discount% − rebate% − one-off%)
            const netFees = Math.round(grossFees * (1 - totalDiscountPct / 100));
            const variableFeeTotal = Math.round(baseWeekly * variableFeePct / 100 * effectiveDur);
            const invoiceCount = Math.max(1, Math.floor(1 + effectiveDur / 4));
            const perInvoice = invoiceCount > 0 ? Math.round(netFees / invoiceCount) : 0;
            const cur = getCurrencyForRegion(form.region);
            const fmtC = (n: number) => cur.symbol + Math.round(n).toLocaleString("it-IT");
            return (
              <div className="border rounded-lg p-4 bg-muted/10 space-y-4">
                <div className="text-xs font-bold uppercase text-muted-foreground tracking-wide">Price Finalization</div>

                {/* Controls row */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Left: adjustments */}
                  <div className="space-y-3">
                    {/* Manual adjustment */}
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase">Model adjustment (±500)</div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setManualDelta(d => d - 500)} className="w-7 h-7 rounded border text-sm font-bold flex items-center justify-center hover:bg-muted">−</button>
                        <span className={`text-sm font-mono font-bold w-24 text-center ${manualDelta > 0 ? "text-emerald-600" : manualDelta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                          {manualDelta === 0 ? "±€0" : `${manualDelta > 0 ? "+" : ""}€${Math.abs(manualDelta).toLocaleString("it-IT")}`}
                        </span>
                        <button onClick={() => setManualDelta(d => d + 500)} className="w-7 h-7 rounded border text-sm font-bold flex items-center justify-center hover:bg-muted">+</button>
                        {manualDelta !== 0 && <button onClick={() => setManualDelta(0)} className="text-[10px] text-muted-foreground hover:text-foreground underline">reset</button>}
                      </div>
                    </div>
                    {/* Post-negotiation adjustment */}
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase">Post-negotiation adjustment (±500)</div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setNegotiationDelta(d => d - 500)} className="w-7 h-7 rounded border text-sm font-bold flex items-center justify-center hover:bg-muted">−</button>
                        <span className={`text-sm font-mono font-bold w-24 text-center ${negotiationDelta > 0 ? "text-emerald-600" : negotiationDelta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                          {negotiationDelta === 0 ? "±€0" : `${negotiationDelta > 0 ? "+" : ""}€${Math.abs(negotiationDelta).toLocaleString("it-IT")}`}
                        </span>
                        <button onClick={() => setNegotiationDelta(d => d + 500)} className="w-7 h-7 rounded border text-sm font-bold flex items-center justify-center hover:bg-muted">+</button>
                        {negotiationDelta !== 0 && <button onClick={() => setNegotiationDelta(0)} className="text-[10px] text-muted-foreground hover:text-foreground underline">reset</button>}
                      </div>
                    </div>
                  </div>
                  {/* Right: fee %s */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Variable fee</Label>
                      <Select value={String(variableFeePct)} onValueChange={v => setVariableFeePct(Number(v))}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[0, 10, 20, 30, 40, 50].map(p => <SelectItem key={p} value={String(p)}>{p}%</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="text-[9px] text-muted-foreground">= {fmtC(Math.round(baseWeekly * variableFeePct / 100))}/wk</div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Admin fees</Label>
                      <Select value={String(adminFeePct)} onValueChange={v => setAdminFeePct(Number(v))}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[0, 2, 4, 6, 8].map(p => <SelectItem key={p} value={String(p)}>{p}%</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="text-[9px] text-muted-foreground">= {fmtC(Math.round(baseWeekly * adminFeePct / 100))}/wk</div>
                    </div>
                  </div>
                </div>

                {/* Fee summary table */}
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-[10px] py-1.5">Weekly (base)</TableHead>
                        <TableHead className="text-[10px] py-1.5">Weekly gross+admin</TableHead>
                        <TableHead className="text-[10px] py-1.5">Duration</TableHead>
                        <TableHead className="text-[10px] py-1.5">Gross Fees</TableHead>
                        <TableHead className="text-[10px] py-1.5">Net total (after D&R)</TableHead>
                        <TableHead className="text-[10px] py-1.5 text-center">Invoices</TableHead>
                        <TableHead className="text-[10px] py-1.5 text-right">Per Invoice</TableHead>
                        <TableHead className="text-[10px] py-1.5 text-right">Variable fee</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-mono text-sm font-semibold">{fmtC(baseWeekly)}</TableCell>
                        <TableCell className="font-mono text-sm font-bold text-primary">{fmtC(finalWeekly)}</TableCell>
                        <TableCell className="text-sm">{effectiveDur}w</TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">{fmtC(grossFees)}</TableCell>
                        <TableCell className="font-mono text-sm font-bold text-emerald-600">{fmtC(netFees)}</TableCell>
                        <TableCell className="text-sm text-center font-semibold">{invoiceCount}</TableCell>
                        <TableCell className="font-mono text-sm font-semibold text-right">{fmtC(perInvoice)}</TableCell>
                        <TableCell className="font-mono text-sm text-right text-amber-600">{fmtC(variableFeeTotal)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                {/* Won / Lost buttons */}
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold">Record outcome:</span>
                  <Button size="sm" disabled={markingOutcome}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => markProjectOutcome("won")}>
                    ✓ Mark as Won
                  </Button>
                  <Button size="sm" variant="outline" disabled={markingOutcome}
                    className="border-red-300 text-red-600 hover:bg-red-50"
                    onClick={() => markProjectOutcome("lost")}>
                    ✗ Mark as Lost
                  </Button>
                  {markingOutcome && <span className="text-[10px] text-muted-foreground">Saving…</span>}
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


                  {/* ── FEE RANGE ────────────────────────────────────────── */}
                  {(() => {
                    const d = manualDelta;
                    const rec = recommendation.target_weekly + d;
                    const recGM = recommendation.cost_floor_weekly > 0
                      ? ((rec - recommendation.cost_floor_weekly) / rec * 100)
                      : null;
                    const low50 = recommendation.low_50gm_weekly > 0
                      ? recommendation.low_50gm_weekly + d
                      : null;
                    const low50GM = low50 && recommendation.delivery_cost_weekly > 0
                      ? ((low50 - recommendation.delivery_cost_weekly * (1 + 0.15)) / low50 * 100)
                      : 50;
                    const highMkt = recommendation.high_market_weekly;
                    return (
                      <div className="space-y-2">
                        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground px-0.5">
                          Fee Range
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {/* Low — 50% GM floor */}
                          <div className="text-center p-2.5 bg-muted/30 rounded-lg">
                            <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-wide">Low</div>
                            <div className="text-base font-bold text-muted-foreground mt-0.5">
                              {low50 ? fmt(low50) : "—"}
                            </div>
                            <div className="text-[9px] text-muted-foreground">/week</div>
                            <div className="text-[9px] text-emerald-600 font-semibold mt-0.5">GM {Math.round(low50GM)}%</div>
                          </div>
                          {/* Center — Recommended Fees */}
                          <div className="text-center p-2.5 bg-primary/10 rounded-lg border border-primary/20">
                            <div className="text-[9px] text-primary uppercase font-bold tracking-wide">Recommended Fees</div>
                            <div className="text-xl font-bold text-primary mt-0.5">{fmt(rec)}</div>
                            <div className="text-[9px] text-muted-foreground">/week</div>
                            {recGM != null && (
                              <div className="text-[9px] text-emerald-600 font-semibold mt-0.5">GM {recGM.toFixed(0)}%</div>
                            )}
                          </div>
                          {/* High — market ceiling */}
                          <div className="text-center p-2.5 bg-amber-50 rounded-lg border border-amber-100">
                            <div className="text-[9px] text-amber-700 uppercase font-bold tracking-wide">High</div>
                            <div className="text-base font-bold text-amber-600 mt-0.5">
                              {highMkt ? fmt(highMkt) : "—"}
                            </div>
                            <div className="text-[9px] text-muted-foreground">/week</div>
                            {highMkt && recommendation.cost_floor_weekly > 0 && (
                              <div className="text-[9px] text-emerald-600 font-semibold mt-0.5">
                                GM {((highMkt - recommendation.cost_floor_weekly) / highMkt * 100).toFixed(0)}%
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Calculation explanations */}
                        <div className="text-[9px] text-muted-foreground space-y-0.5 px-0.5 leading-relaxed">
                          <div>
                            <span className="font-semibold text-foreground/70">Low:</span>{" "}
                            {low50
                              ? `${fmt(low50)}/wk = minimum to achieve 50% GM on team costs (staff ${fmt(recommendation.delivery_cost_weekly)}/wk + 15% overhead = ${fmt(Math.round(recommendation.delivery_cost_weekly * 1.15))}/wk × 2)`
                              : "No staffing cost data — enter team build-up to compute"}
                          </div>
                          <div>
                            <span className="font-semibold text-foreground/70">Recommended:</span>{" "}
                            {fmt(rec)}/wk = last bar of waterfall (rule-based layers applied to staffing base). GM {recGM != null ? `${recGM.toFixed(0)}%` : "—"} vs cost floor {fmt(recommendation.cost_floor_weekly)}/wk.
                          </div>
                          <div>
                            <span className="font-semibold text-foreground/70">High:</span>{" "}
                            {highMkt && recommendation.high_market_context
                              ? `${fmt(highMkt)}/wk = highest won deal in ${recommendation.high_market_context}`
                              : "No comparable won deals found — increase past project data for this region"}
                          </div>
                        </div>
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

                  {/* ── Historical Intelligence (L4) — reference only ────── */}
                  {(() => {
                    const hasData = fundProposals.length > 0 || (recommendation.comparable_wins?.length ?? 0) > 0;
                    if (!hasData) return null;
                    return (
                      <div className="border border-blue-100 rounded-lg bg-blue-50/40 p-3 space-y-2">
                        {/* Header with info button */}
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] uppercase font-bold text-blue-700 tracking-wide">
                            Historical Intelligence
                          </div>
                          <div className="relative">
                            <button
                              onClick={() => setShowL4Info(v => !v)}
                              className="text-blue-400 hover:text-blue-600 transition-colors"
                              title="How is this computed?"
                            >
                              <Info className="w-3.5 h-3.5" />
                            </button>
                            {showL4Info && (
                              <div className="absolute right-0 top-5 z-50 w-72 bg-white border border-blue-200 rounded-lg shadow-xl p-3 text-[11px] text-slate-700 leading-relaxed space-y-2">
                                <div className="font-bold text-blue-700 text-xs">How Historical Intelligence works</div>
                                <p>
                                  <span className="font-semibold">Fund anchor:</span> All past proposals for the same fund are retrieved and averaged using time-decay (recent deals count more) and outcome weighting (won deals count 2× vs lost). Requires ≥2 proposals to activate.
                                </p>
                                <p>
                                  <span className="font-semibold">Comparable wins:</span> Every past project is scored for similarity — fund match (40 pts), same region (25 pts), same PE/non-PE (15 pts), same revenue band (20 pts). The top 8 scoring projects with ≥25 pts are used. Win prices are averaged.
                                </p>
                                <p>
                                  <span className="font-semibold">Why not used in the price:</span> Historical data is shown here as a reference only. It is <span className="font-semibold">not blended into the recommendation</span> because past prices reflect the context of those deals (team, scope, market moment) — using them mechanically can anchor you too low or too high. Use these numbers as a sanity check, not as a target.
                                </p>
                                <button onClick={() => setShowL4Info(false)} className="text-blue-500 underline text-[10px]">Close</button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Fund anchor summary */}
                        {recommendation.history_anchor != null && (
                          <div className="flex items-center gap-3 text-xs">
                            <div>
                              <span className="text-muted-foreground">Fund anchor</span>
                              <span className="ml-1.5 font-bold text-blue-700">{fmt(recommendation.history_anchor)}/wk</span>
                              <span className="text-muted-foreground ml-1">(time-decayed avg of {recommendation.fund_proposals_count} proposals)</span>
                            </div>
                            {recommendation.fund_win_rate != null && (
                              <span className="text-muted-foreground">Win rate: <span className="font-semibold">{Math.round(recommendation.fund_win_rate * 100)}%</span></span>
                            )}
                          </div>
                        )}

                        {/* Comparable wins anchor */}
                        {recommendation.comparable_avg_win_weekly != null && (
                          <div className="text-xs">
                            <span className="text-muted-foreground">Comparable wins avg</span>
                            <span className="ml-1.5 font-bold text-blue-700">{fmt(recommendation.comparable_avg_win_weekly)}/wk</span>
                            <span className="text-muted-foreground ml-1">({recommendation.comparable_wins.length} similar won projects)</span>
                          </div>
                        )}

                        {/* Fund proposals mini-table */}
                        {fundProposals.length > 0 && (
                          <div className="space-y-1 pt-1">
                            <div className="text-[10px] text-muted-foreground font-semibold">Prior proposals — {form.fund_name}</div>
                            {fundProposals.map(p => (
                              <div key={p.id} className="flex items-center justify-between text-xs bg-white/70 rounded px-2 py-1">
                                <span className="text-muted-foreground">{p.proposal_date?.slice(0, 7)}</span>
                                <span className="truncate max-w-[90px] mx-1 text-muted-foreground">{p.project_name}</span>
                                <span className="font-semibold">{fmt(p.weekly_price)}</span>
                                <OutcomeBadge outcome={p.outcome} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Advisory */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-blue-700 uppercase mb-1 flex items-center gap-1">
                      <Info className="w-3 h-3" /> Advisory
                    </div>
                    <p className="text-xs text-blue-800 leading-relaxed">{recommendation.advisory}</p>
                  </div>

                  {/* Gross / Net Project Fees + TNF-to-EBITDA ratios */}
                  {nwfClamped > 0 && (() => {
                    const cur = getCurrencyForRegion(form.region);
                    const fmtFee = (n: number) => cur.symbol + Math.round(n).toLocaleString("it-IT");
                    const fmtK2Local = (n: number) => n >= 1_000_000 ? `${cur.symbol}${(n / 1_000_000).toFixed(1)}M` : `${cur.symbol}${Math.round(n / 1000)}k`;
                    const effDur = (waterfallDuration ?? form.duration_weeks) || 0;
                    const baseWkly = nwfClamped + manualDelta + negotiationDelta;
                    // Gross Project Fees = recommended weekly × nb of weeks
                    const gross = Math.round(baseWkly * effDur);
                    // Net Project Fees = Gross − (discount + rebate + one-off)
                    const net = Math.round(gross * (1 - totalDiscountPct / 100));
                    // TNF / EBITDA ratios
                    const revenueMLocal = form.company_revenue_m ?? 0;
                    const ebitdaPctLocal = form.ebitda_margin_pct ?? 0;
                    const currentEbitdaLocal = revenueMLocal > 0 && ebitdaPctLocal > 0
                      ? revenueMLocal * 1_000_000 * ebitdaPctLocal / 100 : 0;
                    const aspirationIncreasePctLocal = form.aspiration_ebitda_pct ?? 0;
                    const aspirationEurLocal = currentEbitdaLocal > 0 && aspirationIncreasePctLocal > 0
                      ? currentEbitdaLocal * aspirationIncreasePctLocal / 100 : 0;
                    const tnfLocal = net; // use Net Project Fees as the "TNF" denominator for ratios (same semantics)
                    const tnfEbitdaRatioLocal = currentEbitdaLocal > 0 ? tnfLocal / currentEbitdaLocal : null;
                    const tnfAspirationRatioLocal = aspirationEurLocal > 0 ? tnfLocal / aspirationEurLocal : null;

                    // Benchmark: compute TNF/EBITDA and TNF/Aspiration ratios from past
                    // won proposals that have company_revenue_m + ebitda_margin_pct populated.
                    const pastRatios = analysisProposals
                      .filter(p => p.outcome === "won"
                        && p.company_revenue_m != null && p.company_revenue_m > 0
                        && p.ebitda_margin_pct != null && p.ebitda_margin_pct > 0
                        && p.total_fee != null && p.total_fee > 0)
                      .map(p => {
                        const ebitda = (p.company_revenue_m as number) * 1_000_000 * (p.ebitda_margin_pct as number) / 100;
                        const ratio = (p.total_fee as number) / ebitda;
                        const growth = p.expected_ebitda_growth_pct ?? 0;
                        const aspiration = ebitda * growth / 100;
                        const aspRatio = aspiration > 0 ? (p.total_fee as number) / aspiration : null;
                        return { ratio, aspRatio };
                      });
                    const avgPastEbitda = pastRatios.length > 0
                      ? pastRatios.reduce((s, r) => s + r.ratio, 0) / pastRatios.length
                      : null;
                    const asps = pastRatios.filter(r => r.aspRatio != null).map(r => r.aspRatio as number);
                    const avgPastAspir = asps.length > 0
                      ? asps.reduce((s, v) => s + v, 0) / asps.length
                      : null;

                    return (
                      <div className="space-y-3 pt-1">
                        {/* Fee boxes */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="border rounded-lg p-3 bg-background space-y-0.5">
                            <div className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Gross Project Fees</div>
                            <div className="text-[10px] text-muted-foreground">before discounts & rebates</div>
                            <div className="text-xl font-bold text-foreground">{fmtFee(gross)}</div>
                            <div className="text-[10px] text-muted-foreground">{fmtFee(baseWkly)}/wk × {effDur}w</div>
                          </div>
                          <div className="border rounded-lg p-3 bg-background space-y-0.5">
                            <div className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Net Project Fees</div>
                            <div className="text-[10px] text-muted-foreground">
                              {totalDiscountPct > 0 ? `after ${totalDiscountPct.toFixed(1)}% discount/rebate/one-off` : "no discount applied"}
                            </div>
                            <div className="text-xl font-bold text-emerald-600">{fmtFee(net)}</div>
                            <div className="text-[10px] text-muted-foreground">{fmtFee(gross)} − {totalDiscountPct.toFixed(1)}%</div>
                          </div>
                        </div>

                        {/* TNF / EBITDA ratio gauges — side by side, highlighted */}
                        <div className="border-2 border-primary/20 bg-primary/5 rounded-lg p-3 space-y-2">
                          <div className="text-[10px] font-bold uppercase text-primary tracking-wide flex items-center gap-1.5">
                            <TrendingUp className="w-3 h-3" />
                            Value Capture — Fees vs EBITDA
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <ArcGauge
                              ratio={tnfEbitdaRatioLocal}
                              label="Net Fees / Co. EBITDA"
                              denomLabel={currentEbitdaLocal > 0 ? `of ${fmtK2Local(currentEbitdaLocal)} EBITDA` : "set revenue + margin"}
                              maxRatio={0.20}
                              benchmark={{ value: avgPastEbitda, label: "Past projects avg" }}
                            />
                            <ArcGauge
                              ratio={tnfAspirationRatioLocal}
                              label="Net Fees / Aspiration"
                              denomLabel={aspirationEurLocal > 0 ? `of ${fmtK2Local(aspirationEurLocal)} (+${aspirationIncreasePctLocal}%)` : "set aspiration %"}
                              maxRatio={0.20}
                              benchmark={{ value: avgPastAspir, label: "Past projects avg" }}
                            />
                          </div>
                          <div className="text-[9px] text-muted-foreground text-center px-2 pt-0.5">
                            🟢 &lt;5% · 🟡 5–10% · 🔴 &gt;10% of base · ▌ = past-projects benchmark
                          </div>
                        </div>

                        {/* ── Industry-calibrated TNF benchmark ────────────── */}
                        {(() => {
                          const tnfBench = computeTNFBenchmark(
                            form.company_revenue_m,
                            form.ebitda_margin_pct,
                            form.sector,
                            form.project_type,
                            form.revenue_band,
                          );
                          if (!tnfBench) {
                            return (
                              <div className="border rounded-lg p-3 bg-muted/20 text-[10px] text-muted-foreground">
                                Select a sector and revenue band to see the industry TNF benchmark.
                              </div>
                            );
                          }
                          const netInBand = net >= tnfBench.tnf_low_eur && net <= tnfBench.tnf_high_eur;
                          const netBelow = net < tnfBench.tnf_low_eur;
                          // Source badge styling
                          const srcStyle = tnfBench.source === "project"
                            ? { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-300", label: "PROJECT DATA" }
                            : tnfBench.source === "mixed"
                            ? { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-300", label: "MIXED" }
                            : { bg: "bg-slate-100", text: "text-slate-600", border: "border-slate-300", label: "INDUSTRY DEFAULTS" };
                          return (
                            <div className="border-2 border-blue-200 bg-blue-50/40 rounded-lg p-3 space-y-2">
                              <div className="flex items-center justify-between flex-wrap gap-1">
                                <div className="text-[10px] font-bold uppercase text-blue-700 tracking-wide flex items-center gap-1.5">
                                  <Info className="w-3 h-3" />
                                  Industry TNF Benchmark
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border ${srcStyle.bg} ${srcStyle.text} ${srcStyle.border}`}>
                                    {srcStyle.label}
                                  </span>
                                  <button onClick={() => setShowTNFInfo(v => !v)}
                                    className="text-blue-500 hover:text-blue-700 transition-colors"
                                    title="How is this computed?">
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Source explanation */}
                              <div className="text-[10px] text-muted-foreground leading-tight">
                                {tnfBench.source_label}
                                {tnfBench.source !== "project" && (
                                  <span className="ml-1 text-blue-600 italic">
                                    — enter {tnfBench.revenue_is_imputed && tnfBench.margin_is_imputed
                                      ? "company revenue & EBITDA %"
                                      : tnfBench.revenue_is_imputed
                                      ? "company revenue"
                                      : "EBITDA margin %"} for project-specific accuracy
                                  </span>
                                )}
                              </div>

                              {/* Range */}
                              <div className="flex items-center justify-between text-xs">
                                <div>
                                  <span className="text-muted-foreground">Benchmark range:</span>
                                  <span className="ml-1.5 font-bold text-blue-700">
                                    {fmtK2Local(tnfBench.tnf_low_eur)} – {fmtK2Local(tnfBench.tnf_high_eur)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Our TNF:</span>
                                  <span className={`ml-1.5 font-bold ${netInBand ? "text-emerald-600" : netBelow ? "text-amber-600" : "text-red-600"}`}>
                                    {fmtK2Local(net)}
                                  </span>
                                </div>
                              </div>

                              {/* Visual bar */}
                              {(() => {
                                const min = Math.min(tnfBench.tnf_low_eur * 0.5, net * 0.9);
                                const max = Math.max(tnfBench.tnf_high_eur * 1.2, net * 1.1);
                                const range = max - min;
                                const lowPct = ((tnfBench.tnf_low_eur - min) / range) * 100;
                                const highPct = ((tnfBench.tnf_high_eur - min) / range) * 100;
                                const netPct = ((net - min) / range) * 100;
                                return (
                                  <div className="relative h-3 bg-muted/40 rounded overflow-hidden">
                                    <div className="absolute top-0 h-full bg-emerald-200"
                                      style={{ left: `${lowPct}%`, width: `${highPct - lowPct}%` }} />
                                    <div className="absolute top-0 h-full w-0.5 bg-blue-700"
                                      style={{ left: `${Math.max(0, Math.min(100, netPct))}%` }} />
                                  </div>
                                );
                              })()}

                              {/* Breakdown */}
                              <div className="text-[10px] text-muted-foreground space-y-0.5 leading-relaxed">
                                <div>
                                  Revenue: <span className={`font-semibold ${tnfBench.revenue_is_imputed ? "text-slate-500 italic" : "text-foreground/80"}`}>
                                    {fmtK2Local(tnfBench.revenue_m_used * 1_000_000)}
                                    {tnfBench.revenue_is_imputed && " *"}
                                  </span>
                                  {" × "}
                                  EBITDA %: <span className={`font-semibold ${tnfBench.margin_is_imputed ? "text-slate-500 italic" : "text-foreground/80"}`}>
                                    {tnfBench.ebitda_margin_used_pct}%
                                    {tnfBench.margin_is_imputed && " *"}
                                  </span>
                                  {" = "}
                                  EBITDA: <span className="font-semibold text-foreground/80">{fmtK2Local(tnfBench.ebitda_eur)}</span>
                                </div>
                                <div>
                                  {tnfBench.sector}: <span className="font-semibold text-foreground/80">{tnfBench.industry_base_low_pct}–{tnfBench.industry_base_high_pct}%</span>
                                  {" · "}
                                  Stage ({tnfBench.deal_stage_label}): <span className="font-semibold text-foreground/80">×{tnfBench.deal_stage_mult}</span>
                                  {" · "}
                                  Scope ({tnfBench.scope_label}): <span className="font-semibold text-foreground/80">×{tnfBench.scope_mult}</span>
                                </div>
                                {(tnfBench.revenue_is_imputed || tnfBench.margin_is_imputed) && (
                                  <div className="text-[9px] italic text-slate-500">* imputed from industry defaults</div>
                                )}
                              </div>

                              {/* Info popup */}
                              {showTNFInfo && (
                                <div className="mt-2 bg-white border border-blue-200 rounded-lg p-3 text-[11px] text-slate-700 leading-relaxed space-y-2 shadow-inner">
                                  <div className="font-bold text-blue-700 text-xs">TNF Benchmark Methodology</div>
                                  <p>
                                    <span className="font-semibold">Core formula:</span><br/>
                                    <span className="font-mono text-[10px]">TNF = EBITDA × Industry Base % × Deal-Stage × Scope</span>
                                  </p>
                                  <div className="bg-emerald-50 border border-emerald-200 rounded p-2">
                                    <div className="font-semibold text-emerald-800 mb-1">Priority order (which data is used)</div>
                                    <ol className="list-decimal pl-4 text-[10px] space-y-0.5 text-slate-700">
                                      <li><span className="font-semibold">PROJECT DATA</span> (preferred): actual company revenue + actual EBITDA margin from the case</li>
                                      <li><span className="font-semibold">MIXED</span>: one of the two is available, the other is imputed from sector/band norms</li>
                                      <li><span className="font-semibold">INDUSTRY DEFAULTS</span>: both imputed — sector-midpoint EBITDA margin × revenue-band midpoint</li>
                                    </ol>
                                    <div className="text-[9px] text-emerald-700 italic mt-1">
                                      The engine always tries project data first. Imputed values are shown in italic with a *.
                                    </div>
                                  </div>
                                  <p>
                                    <span className="font-semibold">Why EBITDA?</span> Ties fees directly to the operational profit being optimised. Revenue-based metrics ignore margins; pure deal-size metrics ignore profitability.
                                  </p>
                                  <div>
                                    <div className="font-semibold mb-1">Industry base % (% of EBITDA):</div>
                                    <ul className="list-disc pl-4 text-[10px] space-y-0.5 text-slate-600">
                                      <li>Software / SaaS — 1.5–3.0% (high-margin, premium)</li>
                                      <li>Pharma / Healthcare — 2.5–4.0% (regulatory complexity)</li>
                                      <li>Financial Services — 1.0–2.5% (large EBITDA base)</li>
                                      <li>Consumer / Retail — 3.0–5.0% (lower margins)</li>
                                      <li>Industrial / Manufacturing — 2.5–4.5%</li>
                                      <li>Energy / Utilities — 2.0–3.5% (capital intensive)</li>
                                    </ul>
                                  </div>
                                  <div>
                                    <div className="font-semibold mb-1">Deal-stage multiplier (from project type):</div>
                                    <ul className="list-disc pl-4 text-[10px] space-y-0.5 text-slate-600">
                                      <li>Spark / Diagnostic — ×1.0 (steady state)</li>
                                      <li>SFE / Pricing — ×1.2 (operational improvement)</li>
                                      <li>Other design — ×1.3 (strategic advisory)</li>
                                      <li>War room / 100-day — ×1.8 (value creation intensive)</li>
                                    </ul>
                                  </div>
                                  <div>
                                    <div className="font-semibold mb-1">Scope multiplier:</div>
                                    <ul className="list-disc pl-4 text-[10px] space-y-0.5 text-slate-600">
                                      <li>Strategic only — ×0.7–1.0 (low implementation risk)</li>
                                      <li>Operational improvement — ×1.0–1.4</li>
                                      <li>Transformation — ×1.2–1.8 (multi-workstream)</li>
                                      <li>Turnaround — ×1.5–2.5 (crisis premium)</li>
                                    </ul>
                                  </div>
                                  <p>
                                    <span className="font-semibold">Example:</span> €50M EBITDA Software company in 100-day plan: €50M × 2.0% × 1.5 × 1.3 = <span className="font-bold">€1.95M</span>.
                                  </p>
                                  <p className="text-slate-500 italic">
                                    Benchmarks are industry anchors — use them to stress-test proposals, not as a hard rule. Adjust ±15–25% for US vs European vs emerging markets.
                                  </p>
                                  <button onClick={() => setShowTNFInfo(false)} className="text-blue-500 underline text-[10px]">Close</button>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}

                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
