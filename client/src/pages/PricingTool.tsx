import React, { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign, Plus, ArrowLeft, Trash2, TrendingUp, TrendingDown,
  Users, AlertTriangle, Eye, EyeOff, History, CheckCircle, XCircle, Info, Pencil, RefreshCw, Download, Paperclip, X, FileText, ChevronDown,
  MessageSquare, ClipboardPaste, StickyNote, Save, Printer,
} from "lucide-react";
import {
  calculatePricing, DEFAULT_PRICING_SETTINGS, REVENUE_BANDS, REGIONS, SECTORS, DEFAULT_PROJECT_TYPES,
  getCurrencyForRegion, formatWithCurrency, computeTNFBenchmark,
  type PricingSettings, type PricingProposal, type StaffingLine, type PricingRecommendation,
  type CompetitorBenchmark, type ProjectType, type CompetitiveIntensity, type CompetitorType,
  type OwnershipType, type StrategicIntent, type ProcurementInvolvement, type LayerTrace,
  type CountryBenchmarkRow, type PricingRegion, type PricingAdjustment,
} from "@/lib/pricingEngine";
import { useBenchmarkNotes, cellKey as benchCellKey, tierKey as benchTierKey } from "@/lib/benchmarkNotes";
import { computeOptionColumn, centralOptionWeekly } from "@/lib/proposalOptions";
import { BenchmarkNotesEditor } from "@/components/BenchmarkNotesEditor";

interface PricingCase {
  id?: number;
  project_name: string;
  /** A / B / C / D — appended to project_name in display. Default "A". */
  revision_letter?: string;
  client_name: string;
  fund_name: string;
  region: string;
  currency?: string;
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
  win_probability?: number | null;        // 0-100 — Livio's estimate of winning; drives 24-week HR staffing forecast
  start_date?: string | null;             // YYYY-MM-DD expected delivery start
  // outcome: 'won' | 'lost' | null. Set via "Mark as Won / Lost" inside case.
  // Cases with an outcome move to the "Won/Lost Pricings" tab.
  outcome?: string | null;
  // proposal_options_count: 1 = single-option mode (only Option 1 rendered),
  // 3 = full 3-option mode. Hidden options keep their state in case_timelines
  // so toggling back is lossless.
  proposal_options_count?: number;
}

const fmt = (n: number) => "€" + Math.round(n).toLocaleString("it-IT");
const fmtK = (n: number) => Math.round(n).toLocaleString("it-IT");

/** Display form of a case's project name — base code + revision letter.
 *  "EMV01" + "B" → "EMV01B". Defaults to "A" when the field is null or
 *  empty so legacy cases render with a suffix instead of bare code. */
export function displayProjectName(projectName: string | null | undefined, revisionLetter: string | null | undefined): string {
  const base = (projectName ?? "").trim();
  const rev = (revisionLetter ?? "").trim().toUpperCase() || "A";
  if (!base) return "";
  // If the code already ends in a letter (legacy rows), don't double-append.
  if (/[A-Z]$/.test(base)) return base;
  return base + rev;
}

// ── Case discount helpers ──────────────────────────────────────────────────
// Both handled in one place so new discount types (like the commitment
// discount P7) only need to be added to DEFAULT_PRICING_SETTINGS + these
// two helpers to flow through every code path (new case, loaded case,
// migrated legacy case).

type CaseDiscountRow = { id: string; name: string; pct: number; enabled: boolean };

/** Default-enable rule: only the "one-off" discount starts enabled, matching
 *  previous behavior. All others (prompt payment, rebate, commitment) start
 *  off and are opted in per deal. */
function buildInitialDiscounts(
  defs: { id: string; name: string; default_pct: number; active?: boolean }[],
): CaseDiscountRow[] {
  return defs.map(d => ({
    id: d.id,
    name: d.name,
    pct: d.default_pct,
    enabled: /one.?off/i.test(d.name) && d.default_pct > 0,
  }));
}

/** Migrate a loaded case that predates the commitment-discount row: append
 *  the row (disabled, 0%) so the UI surfaces it without changing the saved
 *  numbers on the deal. */
function ensureCommitmentRow(saved: CaseDiscountRow[]): CaseDiscountRow[] {
  if (saved.some(d => d.id === "commitment")) return saved;
  return [
    ...saved,
    { id: "commitment", name: "Commitment discount", pct: 0, enabled: false },
  ];
}

/** Build the three default timeline options around a base duration:
 *  short = base, medium = base+4, long = base+8, with Eendigo's standard
 *  commitment discount curve (0 / 5 / 7 %). Kept pure so it can be called
 *  from newCase, openCase, and any future "reset" button. */
function deriveTimelines(baseWeeks: number): { weeks: number; commitPct: number }[] {
  const b = Math.max(1, Math.round(baseWeeks || 12));
  return [
    { weeks: b,      commitPct: 0 },
    { weeks: b + 4,  commitPct: 5 },
    { weeks: b + 8,  commitPct: 7 },
  ];
}

/** Render the three-timeline commercial-proposal block in a standalone pop-up
 *  window and trigger the OS print dialog. The user picks "Save as PDF" as
 *  destination to export — no pdf library required. Same layout as the
 *  on-screen card so pasting the resulting PDF into a deck looks identical. */
function printThreeTimelines(
  form: { project_name?: string; client_name?: string; revision_letter?: string },
  cols: { weeks: number; commitPct: number; grossTotal: number; breakdown: { id: string; name: string; pct: number; amount: number }[]; netTotal: number; note?: string }[],
  rowDefs: { id: string; name: string; pct: number }[],
  fmtC: (n: number) => string,
  grossWk: number,
  adminFeePct: number,
): void {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const clientLabel = [form.client_name, displayProjectName(form.project_name, form.revision_letter)].filter(Boolean).join(" · ") || "Commercial proposal";
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const colHeaders = cols.map(c => `<th style="padding:10px;border-bottom:2px solid #1A6571;color:#1A6571;text-align:center;font-weight:600;font-size:12px;">${c.weeks} weeks${c.note ? `<div style="font-size:10px;font-style:italic;font-weight:400;color:#6b7280;">(${esc(c.note)})</div>` : ""}${c.commitPct > 0 ? `<div style="font-size:9px;font-weight:400;color:#6b7280;">Commitment discount ${c.commitPct}%</div>` : ""}</th>`).join("");
  const grossRow = `<tr><td style="padding:8px 10px;background:#5B7E7E;color:white;text-align:right;font-weight:600;font-size:11px;">Gross total price</td>${cols.map(c => `<td style="padding:8px 10px;text-align:center;font-family:monospace;border:1px solid #d1d5db;">${esc(fmtC(c.grossTotal))}</td>`).join("")}</tr>`;
  const discountRows = rowDefs.map((row, idx) => `<tr><td style="padding:8px 10px;background:#5B7E7E;opacity:0.85;color:white;text-align:right;font-weight:600;font-size:11px;">${esc(row.id === "commitment" ? row.name : `${row.name} (${row.pct}%)`)}</td>${cols.map(c => {
    const cell = c.breakdown[idx];
    return `<td style="padding:8px 10px;text-align:center;font-family:monospace;border:1px solid #d1d5db;">${cell.amount > 0 ? `−${esc(fmtC(cell.amount))}` : "—"}</td>`;
  }).join("")}</tr>`).join("");
  const netRow = `<tr><td style="padding:10px;background:#5B7E7E;color:white;text-align:right;font-weight:700;font-size:12px;">Net total price</td>${cols.map(c => `<td style="padding:10px;text-align:center;font-family:monospace;font-weight:700;font-size:13px;background:#d1fae5;color:#065f46;border:2px solid #10b981;">${esc(fmtC(c.netTotal))}</td>`).join("")}</tr>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
<title>Commercial proposal — ${esc(clientLabel)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; padding: 32px 40px; color: #0f172a; }
  .eyebrow { color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 2px; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #1A6571; }
  .sub { color: #6b7280; font-size: 11px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: separate; border-spacing: 4px; }
  th:first-child, td:first-child { text-align: right; }
  .footnote { margin-top: 18px; font-size: 10px; color: #94a3b8; font-style: italic; border-top: 1px solid #e5e7eb; padding-top: 10px; }
  @media print { body { padding: 16px; } }
</style></head><body>
  <div class="eyebrow">Commercials</div>
  <h1>Commercial proposal — ${esc(clientLabel)}</h1>
  <div class="sub">Project fees by option · Generated ${today}</div>
  <table>
    <thead><tr><th></th>${colHeaders}</tr></thead>
    <tbody>${grossRow}${discountRows}${netRow}</tbody>
  </table>
  <div class="footnote">Based on Gross weekly rate of ${esc(fmtC(grossWk))} (Net + ${adminFeePct}% admin). Same weekly price across all three options — commitment discount rewards longer engagements.</div>
</body></html>`;

  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
  w.addEventListener("load", () => { w.focus(); w.print(); });
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 400);
}

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
    client_feedback: null,
    end_date: null,
    manager_name: "",
    team_members: [],
    last_invoice_at: null,
    win_probability: null,
    start_date: null,
    weekly_reports: [],
  };
}

// Proposal template — MUST mirror the "Commercial Proposal — Project fees
// by option" table. The Gross already bakes in the admin fee, so we don't
// mention it as a separate line. Success fee is deliberately NOT here
// (removed per user request — table has no such row). Three timeline
// options are the headline structure, each showing the full discount
// stack so the proposal text reads 1:1 with the table.
const DEFAULT_PROPOSAL_TEMPLATE = `{{#if COMMITMENT_OPTIONS_BLOCK}}This Statement of Work covers an engagement delivered by a team of {{TEAM_SIZE}} professionals ({{TEAM_COMPOSITION}}). The professional fees depend on the timeline selected by the client. Three alternative options are proposed below, with Net Professional Fees ranging from {{OPTION_1_NET_TOTAL}} ({{OPTION_1_WEEKS}} weeks) to {{OPTION_3_NET_TOTAL}} ({{OPTION_3_WEEKS}} weeks).{{/if}}{{#if NO_COMMITMENT_BLOCK}}The standard professional fees for this Statement of Work, covering a {{ENGAGEMENT_DURATION_WEEKS}}-week engagement and a team of {{TEAM_SIZE}} professionals ({{TEAM_COMPOSITION}}), amount to {{STANDARD_PROFESSIONAL_FEES}}.{{/if}}

{{#if COMMITMENT_OPTIONS_BLOCK}}
In consideration of the parties' intention to establish a long-term partnership, Eendigo is pleased to propose three alternative timeline options for this engagement. The weekly rate and team composition remain identical across all three; the client may choose the option that best fits their objectives and speed of execution.

**Option 1 — {{OPTION_1_WEEKS}} weeks**
- Gross total price: {{OPTION_1_GROSS_TOTAL}}
{{#if OPTION_1_ONE_OFF_AMOUNT}}- One-Off discount ({{ONE_OFF_DISCOUNT_PERCENT}}%): −{{OPTION_1_ONE_OFF_AMOUNT}}
{{/if}}{{#if OPTION_1_PROMPT_AMOUNT}}- Prompt Payment discount ({{PROMPT_PAYMENT_DISCOUNT_PERCENT}}%): −{{OPTION_1_PROMPT_AMOUNT}}, applicable only if payment is received in full within the agreed payment terms
{{/if}}{{#if OPTION_1_REBATE_AMOUNT}}- Rebate ({{REBATE_PERCENT}}%): −{{OPTION_1_REBATE_AMOUNT}}, subject to the conditions set out in this Statement of Work
{{/if}}{{#if OPTION_1_COMMIT_AMOUNT}}- Additional commitment discount ({{OPTION_1_COMMIT_PCT}}%): −{{OPTION_1_COMMIT_AMOUNT}}
{{/if}}- **Net total price: {{OPTION_1_NET_TOTAL}}**

**Option 2 — {{OPTION_2_WEEKS}} weeks**
- Gross total price: {{OPTION_2_GROSS_TOTAL}}
{{#if OPTION_2_ONE_OFF_AMOUNT}}- One-Off discount ({{ONE_OFF_DISCOUNT_PERCENT}}%): −{{OPTION_2_ONE_OFF_AMOUNT}}
{{/if}}{{#if OPTION_2_PROMPT_AMOUNT}}- Prompt Payment discount ({{PROMPT_PAYMENT_DISCOUNT_PERCENT}}%): −{{OPTION_2_PROMPT_AMOUNT}}, applicable only if payment is received in full within the agreed payment terms
{{/if}}{{#if OPTION_2_REBATE_AMOUNT}}- Rebate ({{REBATE_PERCENT}}%): −{{OPTION_2_REBATE_AMOUNT}}, subject to the conditions set out in this Statement of Work
{{/if}}{{#if OPTION_2_COMMIT_AMOUNT}}- Additional commitment discount ({{OPTION_2_COMMIT_PCT}}%): −{{OPTION_2_COMMIT_AMOUNT}}, granted in recognition of the extended engagement
{{/if}}- **Net total price: {{OPTION_2_NET_TOTAL}}**

**Option 3 — {{OPTION_3_WEEKS}} weeks**
- Gross total price: {{OPTION_3_GROSS_TOTAL}}
{{#if OPTION_3_ONE_OFF_AMOUNT}}- One-Off discount ({{ONE_OFF_DISCOUNT_PERCENT}}%): −{{OPTION_3_ONE_OFF_AMOUNT}}
{{/if}}{{#if OPTION_3_PROMPT_AMOUNT}}- Prompt Payment discount ({{PROMPT_PAYMENT_DISCOUNT_PERCENT}}%): −{{OPTION_3_PROMPT_AMOUNT}}, applicable only if payment is received in full within the agreed payment terms
{{/if}}{{#if OPTION_3_REBATE_AMOUNT}}- Rebate ({{REBATE_PERCENT}}%): −{{OPTION_3_REBATE_AMOUNT}}, subject to the conditions set out in this Statement of Work
{{/if}}{{#if OPTION_3_COMMIT_AMOUNT}}- Additional commitment discount ({{OPTION_3_COMMIT_PCT}}%): −{{OPTION_3_COMMIT_AMOUNT}}, granted in recognition of the longer-term partnership
{{/if}}- **Net total price: {{OPTION_3_NET_TOTAL}}**

The additional commitment discount is contingent upon the client confirming the selected timeline at contract signing. All other commercial terms (team, methodology, governance, deliverables) remain unchanged across the three options. The fees shall be invoiced in equal instalments over the engagement, as detailed in the Statement of Work.
{{/if}}

{{#if NO_COMMITMENT_BLOCK}}
In consideration of the parties' intention to establish a long-term partnership, the following commercial incentives may apply, where applicable:

{{#if ONE_OFF_DISCOUNT_PERCENT}}- One-Off Discount: {{ONE_OFF_DISCOUNT_PERCENT}}% (equal to {{ONE_OFF_DISCOUNT_AMOUNT}}){{PE_FUND_CLAUSE}}.
{{/if}}{{#if PROMPT_PAYMENT_DISCOUNT_PERCENT}}- Prompt Payment Discount: {{PROMPT_PAYMENT_DISCOUNT_PERCENT}}% (equal to {{PROMPT_PAYMENT_DISCOUNT_AMOUNT}}), applicable only if payment is received in full within the agreed payment terms.
{{/if}}{{#if REBATE_PERCENT}}- Rebate: {{REBATE_PERCENT}}% (equal to {{REBATE_AMOUNT}}), subject to the conditions set out in this Statement of Work.
{{/if}}
Accordingly, assuming all applicable incentives are achieved, the Net Professional Fees amount to {{NET_TOTAL}}.
{{/if}}`;

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

// Project naming convention: 3 capital letters (the client prefix derived
// from clientPrefix) + 2 digits (the sequence number). The revision letter
// (A / B / C / D) lives in a separate column and is appended only at
// display time. Validates manually-typed project names so legacy 4-letter
// prefixes like "SCHA01" don't slip back in.
const PROJECT_NAME_RE = /^[A-Z]{3}\d{2}$/;
function isValidProjectName(name: string | null | undefined): boolean {
  return !!name && PROJECT_NAME_RE.test(name.trim());
}

// ── Benchmark helpers ─────────────────────────────────────────────────────────

// Maps admin region codes → country names / aliases that belong to that region.
// Country Benchmarks, Fees by Country, and Win-Loss scatter all group by region.
const REGION_TO_COUNTRY: Record<string, string[]> = {
  IT:            ["Italy", "IT"],
  FR:            ["France", "FR", "Belgium"],
  DACH:          ["Germany", "DE", "Switzerland", "CH", "Austria", "AT", "Czech Republic", "CZ", "DACH"],
  Nordics:       ["Netherlands", "NL", "The Netherlands", "Sweden", "SE", "Denmark", "DK", "Norway", "NO", "Finland", "FI"],
  UK:            ["United Kingdom", "UK"],
  US:            ["United States", "US", "USA"],
  "Middle East": ["UAE", "AE", "Saudi Arabia", "SA", "Middle East"],
  Asia:          ["Philippines", "PH", "The Philippines", "The Phillipines", "Japan", "Indonesia", "Asia"],
  "Other EU":    ["Luxembourg", "LU", "Luxemburg", "Luxembours"],
};

// Reverse lookup: country name or region code → canonical region key
function countryToRegion(value: string): string | null {
  if (!value) return null;
  const lc = value.toLowerCase().trim();
  // Direct key match first (e.g. "IT" → "IT", "DACH" → "DACH")
  if (REGION_TO_COUNTRY[value]) return value;
  // Alias match
  for (const [region, aliases] of Object.entries(REGION_TO_COUNTRY)) {
    if (region.toLowerCase() === lc) return region;
    if (aliases.some(a => a.toLowerCase() === lc)) return region;
  }
  return null;
}

// Resolve a proposal's display region.
// Tries: p.region mapped → p.country mapped → p.region raw → p.country raw
function proposalRegionKey(p: { region: string; country?: string | null }): string {
  // Try mapping p.region to a canonical key
  const fromRegion = countryToRegion(p.region);
  if (fromRegion) return fromRegion;
  // Try mapping p.country to a canonical key
  if (p.country) {
    const fromCountry = countryToRegion(p.country);
    if (fromCountry) return fromCountry;
  }
  // Fallback: raw region or country
  return p.region || p.country || "—";
}

function getBandForPrice(
  weeklyPrice: number,
  region: string,
  benchmarks: CountryBenchmarkRow[],
  country?: string | null
): "green" | "yellow" | "red" | null {
  // Task 12: merge across every country in the region (e.g. DACH = DE+AT+CH)
  // so this matches the single-source-of-truth corridor displayed in the
  // Pricing Corridors table and used by the pricing-cases clamp. `.find()`
  // was returning whichever country row happened to come first and was giving
  // different bands for the same region.
  const aliases = REGION_TO_COUNTRY[region] ?? [region];
  const aliasSet = new Set(aliases.map(a => a.toLowerCase()));
  if (country) aliasSet.add(country.toLowerCase());
  const rows = benchmarks.filter(b =>
    aliasSet.has(b.country.toLowerCase()) &&
    (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"))
  );
  const nonZero = rows.filter(r => r.yellow_high > 0);
  if (nonZero.length === 0) return null;
  const greenLow  = Math.min(...nonZero.map(r => r.green_low  || Infinity));
  const greenHigh = Math.max(...nonZero.map(r => r.green_high || 0));
  const yelLow    = Math.min(...nonZero.map(r => r.yellow_low  || Infinity));
  const yelHigh   = Math.max(...nonZero.map(r => r.yellow_high || 0));
  if (weeklyPrice >= greenLow && weeklyPrice <= greenHigh) return "green";
  if (weeklyPrice >= yelLow && weeklyPrice <= yelHigh) return "yellow";
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
    project_name: "CLI01", revision_letter: "A", client_name: "", fund_name: "CARLYLE",
    region: "IT", currency: "EUR", pe_owned: true, revenue_band: "200m_1b",
    price_sensitivity: "medium", duration_weeks: 12, notes: "", status: "draft", staffing: [],
    project_type: "sfe", sector: "Industrial / Manufacturing", ebitda_margin_pct: 20,
    commercial_maturity: null, urgency: null, competitive_intensity: "limited",
    competitor_type: "none", ownership_type: null, strategic_intent: "expand",
    procurement_involvement: null,
    target_roi: 10, max_fees_ebitda_pct: 3,
    aspiration_ebitda_pct: 10,
    company_revenue_m: 300, aspiration_ebitda_eur: null,
    relationship_type: "new", decision_maker: "ceo", budget_disclosed_eur: null,
    incumbent_advisor: null, geographic_scope: "multi", value_driver: null,
    differentiation: null, risk_flags: null, problem_statement: null,
    expected_impact_eur: null,
    win_probability: null,
    start_date: null,
    proposal_options_count: 3,
  };
}

function OutcomeBadge({ outcome, end_date }: { outcome: string; end_date?: string | null }) {
  // Display-time derivation. DB still stores 'won' / 'lost' / 'pending' —
  // this only affects the badge label so handleSave + sync-tbd logic keeps
  // working unchanged. Four states surfaced:
  //   - "Open"     → outcome=won AND end_date is in the future (project
  //                  signed and still running — must not be confused with
  //                  closed wins for revenue / win-rate stats).
  //   - "Won"      → outcome=won AND end_date in the past (or no end_date).
  //   - "Lost"     → outcome=lost.
  //   - "Open"     → outcome=pending AND end_date in the future (verbally
  //                  signed, awaiting paperwork).
  //   - "TBD"      → outcome=pending AND no end_date / past end_date.
  const today = new Date().toISOString().slice(0, 10);
  const futureEnd = !!end_date && end_date > today;
  if (outcome === "won") {
    if (futureEnd) return <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">Open</Badge>;
    return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">Won</Badge>;
  }
  if (outcome === "lost") return <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Lost</Badge>;
  if (futureEnd) return <Badge className="bg-blue-100 text-blue-700 border-blue-200">Open</Badge>;
  return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs">TBD</Badge>;
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

// ── Module-level data cache ────────────────────────────────────────────────
// Lives OUTSIDE the React component so it survives SPA navigation.
// The component unmounts/remounts every time the user changes pages — without
// this cache every visit re-runs the full 5-endpoint waterfall (4-6 seconds).
// With the cache, re-visits are instant (<20ms). Cache TTL = 5 minutes.
interface _PricingDataCache {
  settings:         any | null;
  cases:            any[];
  proposals:        any[];
  employees:        any[];
  externalContacts: any[];
  loadedAt:         number | null; // ms epoch
}
const _pricingCache: _PricingDataCache = {
  settings: null, cases: [], proposals: [], employees: [], externalContacts: [], loadedAt: null,
};
const _CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
function _isCacheFresh() {
  return _pricingCache.loadedAt !== null && (Date.now() - _pricingCache.loadedAt) < _CACHE_TTL_MS;
}
function _invalidatePricingCache() { _pricingCache.loadedAt = null; }
// ─────────────────────────────────────────────────────────────────────────────

export default function PricingTool() {
  const { toast } = useToast();
  const [view, setView] = useState<"list" | "form">("list");
  const [cases, setCases] = useState<any[]>(_pricingCache.cases);
  const [proposals, setProposals] = useState<PricingProposal[]>(_pricingCache.proposals as PricingProposal[]);

  // ── Component-wide NET1 lookup ──────────────────────────────────────────
  // Maps project_name (lower) → canonical_net_weekly from the matching case.
  // Also adds a base-code key (strips trailing letter, e.g. "coe03a"→"coe03")
  // so old proposals named "COE03" resolve against case "COE03A".
  const caseNet1Map = useMemo(() => {
    const m = new Map<string, number>();
    cases
      .filter((c: any) => c.project_name && (c.recommendation?.canonical_net_weekly ?? c.recommendation?.target_weekly ?? 0) > 0)
      .forEach((c: any) => {
        const name = (c.project_name as string).trim().toLowerCase();
        const net1 = Math.round(c.recommendation.canonical_net_weekly ?? c.recommendation.target_weekly);
        m.set(name, net1);
        const base = name.replace(/[a-z]+$/, "");
        if (base !== name && !m.has(base)) m.set(base, net1);
      });
    return m;
  }, [cases]);
  // NET1 weekly for a proposal: case lookup → stored weekly_price fallback
  const proposalNet1 = (p: PricingProposal): number => {
    const key = (p.project_name ?? "").trim().toLowerCase();
    return caseNet1Map.get(key) ?? caseNet1Map.get(key.replace(/[a-z]+$/, "")) ?? p.weekly_price;
  };
  // NET1 total for a proposal: NET1/wk × weeks → total_fee fallback
  const proposalNet1Total = (p: PricingProposal): number => {
    const wk = proposalNet1(p);
    const weeks = p.duration_weeks ?? 0;
    return weeks > 0 ? Math.round(wk * weeks) : (p.total_fee ?? 0);
  };
  const [settings, setSettings] = useState<PricingSettings | null>(
    _pricingCache.settings ? { ...DEFAULT_PRICING_SETTINGS, ..._pricingCache.settings } : null
  );
  const [loading, setLoading] = useState(!_isCacheFresh());
  // Tracks which of the three parallel loads failed (if any). Surfaced as a
  // red banner with a Retry button so the user never silently sees "0" tabs
  // when the real cause was a transient fetch failure (e.g. a Render deploy
  // window where the server briefly returned 502).
  const [loadErrors, setLoadErrors] = useState<{ settings?: string; cases?: string; proposals?: string }>({});
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<PricingCase>(emptyCase());
  // Inline prob-edit state for the Pricing Cases table
  const [editingProbId, setEditingProbId] = useState<number | null>(null);
  const [probDraft, setProbDraft]         = useState<string>("");
  const [caseDiscounts, setCaseDiscounts] = useState<{ id: string; name: string; pct: number; enabled: boolean }[]>([]);
  // Three-timeline commercial-proposal comparison (short / medium / long).
  // Default: base duration + 4w + 8w, with 0 / 5 / 7% commitment discount
  // matching Eendigo's standard pitch (longer engagement → bigger discount).
  // Each row is fully editable inline on the pricing case.
  // Timeline options for the 3-option commercial-proposal table.
  //  grossTotal   — override weekly × weeks (e.g. mid-project rate reset)
  //  commitAmount — override commitPct × gross (e.g. compound-on-post-disc)
  //  note         — small italic subtitle rendered under the option header
  //                 (e.g. "exc. US reset"). Free-text, optional.
  const [caseTimelines, setCaseTimelines] = useState<{
    weeks: number;
    commitPct: number;
    grossTotal?: number;
    commitAmount?: number;
    note?: string;
  }[]>([
    { weeks: 12, commitPct: 0 },
    { weeks: 16, commitPct: 5 },
    { weeks: 20, commitPct: 7 },
  ]);

  // Keep Option 1 (the "Base" column) locked to the case's duration and
  // 0% commitment whenever the duration changes. Options 2 and 3 stay
  // user-editable. Runs only when duration_weeks actually changes so it
  // doesn't stomp on a user's Option 2/3 edits.
  // "wonlost_cases" tab removed — won/lost projects already live in
  // the All Projects tab (renamed from "Past Projects"), so the
  // separate Won/Lost listing was redundant.
  const [mainTab, setMainTab] = useState<"cases" | "history" | "winloss">("cases");
  const [bubbleTip, setBubbleTip] = useState<{ p: PricingProposal; outcome: "won" | "lost"; x: number; y: number } | null>(null);
  // Won Projects moved to the AR / Invoicing page (Task 11) — no state here.
  const [historyForm, setHistoryForm] = useState<PricingProposal>(emptyProposal());
  const [editingProposalId, setEditingProposalId] = useState<number | null>(null);
  const [showHistoryForm, setShowHistoryForm] = useState(false);
  const [showEditProposalForm, setShowEditProposalForm] = useState(false);
  const [savingProposal, setSavingProposal] = useState(false);
  // Employees roster — loaded alongside proposals in loadAll. Drives the
  // Manager + Associate dropdowns in the team-picker dialog. Each entry:
  // { id, name, current_role_code }. Falls back to an empty list if the
  // /api/employees endpoint is unreachable (auth/503) — the team picker
  // then shows an empty dropdown with a hint to check the connection.
  const [employees, setEmployees] = useState<Array<{ id: string; name: string; current_role_code?: string }>>(_pricingCache.employees);
  // External contacts (partners / freelancers) — used by the Manager (EM)
  // and Team picker dropdowns so the user can assign people who aren't on
  // the /employees rich roster.
  const [externalContacts, setExternalContacts] = useState<Array<{ id: number; name: string; kind: string }>>(_pricingCache.externalContacts);

  // Unified people list for the Manager (EM) dropdown.
  // Tier 1 = internal EM1/EM2 employees + external partners (alphabetical)
  // Tier 2 = external freelancers (alphabetical)
  // Dedup by name — if a person appears in both employees and external_contacts
  // the employee entry wins.
  const peopleOptions = useMemo(() => {
    type Person = { name: string; kind: "employee" | "partner" | "freelancer" | "other"; sublabel?: string };
    const byName = new Map<string, Person>();
    // Only EM1/EM2 and Partner-role employees are eligible to lead a project
    for (const e of employees) {
      const code = (e.current_role_code ?? "").toUpperCase();
      const isEligible = code === "EM1" || code === "EM2" || code.includes("PARTNER");
      if (!isEligible) continue;
      byName.set(e.name, { name: e.name, kind: "employee", sublabel: e.current_role_code });
    }
    for (const c of externalContacts) {
      if (byName.has(c.name)) continue; // employee entry wins
      const k = (c.kind || "").toLowerCase();
      const kind: Person["kind"] =
        k === "partner"    ? "partner"
      : k === "freelancer" ? "freelancer"
                           : "other";
      byName.set(c.name, { name: c.name, kind, sublabel: c.kind });
    }
    const all = Array.from(byName.values());
    const tier1 = all.filter(p => p.kind === "employee" || p.kind === "partner")
      .sort((a, b) => a.name.localeCompare(b.name));
    const tier2 = all.filter(p => p.kind === "freelancer")
      .sort((a, b) => a.name.localeCompare(b.name));
    return { tier1, tier2 };
  }, [employees, externalContacts]);
  // Which proposal row is currently having its team edited (Past Projects
  // → click "Pick team" / current roster button → opens the dialog).
  // Null = dialog closed. Holds a draft so dialog edits don't mutate the
  // underlying list until Save.
  const [teamEditFor, setTeamEditFor] = useState<PricingProposal | null>(null);
  const [teamDraftManager, setTeamDraftManager] = useState<string>("");
  const [teamDraftAssociates, setTeamDraftAssociates] = useState<Array<{ role: string; name: string }>>([]);
  const [propSort, setPropSort] = useState<{ field: string; dir: "asc" | "desc" }>({ field: "proposal_date", dir: "desc" });
  const [disabledBars, setDisabledBars] = useState<Set<string>>(new Set());
  const [waterfallDuration, setWaterfallDuration] = useState<number | null>(null);
  const [variableFeePct, setVariableFeePct] = useState(0);
  const [adminFeePct, setAdminFeePct] = useState(8);
  const [markingOutcome, setMarkingOutcome] = useState(false);
  const [backfillingTbd, setBackfillingTbd] = useState(false);
  // Canonical backfill: re-saves every case so the Target/wk column on
  // the cases LIST reflects the actual NET1 figure (not the engine's
  // raw target_weekly). Migrates legacy cases to the new
  // recommendation.canonical_net_weekly + canonical_gross_weekly fields.
  const [backfillingCanonical, setBackfillingCanonical] = useState(false);
  const [importConflicts, setImportConflicts] = useState<{ incoming: PricingProposal; existing: PricingProposal }[]>([]);
  const [manualDelta, setManualDelta] = useState(0); // manual ±500 price adjustment
  // Anchor-price editor: clicking NET1/GROSS1/GROSSV opens this inline editor;
  // committing back-solves manualDelta so the chosen field reaches the typed
  // value while all discount % stay unchanged.
  const [anchorPanel, setAnchorPanel] = useState<{ field: "net1" | "gross1" | "grossv"; draft: string } | null>(null);
  const anchorCancelledRef = useRef(false);
  // Inline custom-duration editor (replaces window.prompt for "Other" in waterfall)
  const [durationPanel, setDurationPanel] = useState<string | null>(null);
  // 3-option commercial-proposal block visibility is now driven by the
  // persisted form.proposal_options_count (1 = hidden / single quote,
  // 3 = visible / three-option layout). No separate showThreeOptions
  // state — the toggle outside the panel sets count directly so the
  // proposal text generator and panel render always agree.
  const [teamPreset, setTeamPreset] = useState<string>("1+2");
  const [benchmarks, setBenchmarks] = useState<CountryBenchmarkRow[]>([]);
  const [benchmarksLocal, setBenchmarksLocal] = useState<CountryBenchmarkRow[]>([]);
  const [editingBenchmarks, setEditingBenchmarks] = useState(false);
  const [savingBenchmarks, setSavingBenchmarks] = useState(false);
  const [compIntensityLocal, setCompIntensityLocal] = useState<PricingAdjustment[]>([]);
  const [editingCompIntensity, setEditingCompIntensity] = useState(false);
  const [compTypeLocal, setCompTypeLocal] = useState<PricingAdjustment[]>([]);
  const [editingCompType, setEditingCompType] = useState(false);
  const [stratIntentLocal, setStratIntentLocal] = useState<PricingAdjustment[]>([]);
  const [editingStratIntent, setEditingStratIntent] = useState(false);
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
  const [showProposalText, setShowProposalText] = useState(false);
  const [showBenchmarks, setShowBenchmarks] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [templateLocal, setTemplateLocal] = useState("");

  // ── Market benchmark notes ──────────────────────────────────────────────
  // Shared hook — same localStorage pool as the Pricing Admin rate grid, so
  // anything written here shows up there (and vice versa, via a window event
  // bus that syncs all consumers without a reload). Notes are collapsed by
  // default: clicking the sticky-note button expands a panel with the full
  // list (multiple notes per cell supported) plus an "add new" textarea.
  const { notes: benchmarkNotes, addNote: addBenchNote, updateNote: updateBenchNote,
          deleteNote: deleteBenchNote, countFor: benchNoteCount } = useBenchmarkNotes();
  const [expandedBenchNoteKey, setExpandedBenchNoteKey] = useState<string | null>(null);

  // Proposals included in all analysis (filters out excluded_from_analysis)
  const isExcluded = (p: PricingProposal): boolean => !!(p.excluded_from_analysis);
  const analysisProposals = useMemo(() => proposals.filter(p => !isExcluded(p)), [proposals]);

  // ── Duplicate proposal detection ───────────────────────────────────────
  // Groups proposals by (client_name + project_name + rounded total fee).
  // Any group with 2+ entries is a suspected duplicate.
  const duplicateGroups = useMemo(() => {
    const feeOf = (p: PricingProposal) =>
      Math.round(p.total_fee ?? p.weekly_price * (p.duration_weeks ?? 0));
    const keyOf = (p: PricingProposal) =>
      `${(p.client_name ?? "").toLowerCase().trim()}|${(p.project_name ?? "").toLowerCase().trim()}|${feeOf(p)}`;
    const map = new Map<string, PricingProposal[]>();
    for (const p of proposals) {
      const k = keyOf(p);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return Array.from(map.values()).filter(g => g.length > 1);
  }, [proposals]);

  // Fees-by-region analysis (groups by admin region, not individual country)
  const computeFeesByCountry = (ps: PricingProposal[]): CountryFeeRow[] => {
    const relevant = ps.filter(p => p.outcome === "won" || p.outcome === "lost");
    const regions = [...new Set(relevant.map(p => proposalRegionKey(p)))].sort();
    return regions.map(country => {
      const cp = relevant.filter(p => proposalRegionKey(p) === country);
      const won = cp.filter(p => p.outcome === "won");
      const lost = cp.filter(p => p.outcome === "lost");
      const total = won.length + lost.length;
      return {
        country,
        won: won.length, lost: lost.length,
        winRate: total > 0 ? won.length / total : null,
        avgWon: won.length > 0 ? won.reduce((s, p) => s + proposalNet1Total(p), 0) / won.length : null,
        avgLost: lost.length > 0 ? lost.reduce((s, p) => s + proposalNet1Total(p), 0) / lost.length : null,
        avgWonWeekly: won.length > 0 ? won.reduce((s, p) => s + proposalNet1(p), 0) / won.length : null,
        avgLostWeekly: lost.length > 0 ? lost.reduce((s, p) => s + proposalNet1(p), 0) / lost.length : null,
      };
    });
  };
  const [feesByCountry, setFeesByCountry] = useState<CountryFeeRow[] | null>(null);
  const [pendingFeesByCountry, setPendingFeesByCountry] = useState<CountryFeeRow[] | null>(null);
  const [selectedCountryUpdates, setSelectedCountryUpdates] = useState<Set<string>>(new Set());

  // Load settings/cases/proposals in parallel BUT treat each as independent.
  // A failure in one endpoint (e.g. a transient 502 during a Render deploy)
  // must NOT zero out the other two. Previous versions of this function
  // used Promise.all + a single try/catch, which meant one failed fetch
  // would leave the user staring at "Pricing Cases (0), Past Projects (0),
  // Win-Loss (0)" even though the DB was full of rows. We now:
  //   1. Run each fetch independently with its own retry.
  //   2. Preserve previous state on failure (do NOT reset to []).
  //   3. Record which endpoint failed in loadErrors so the UI can surface
  //      a red banner with a Retry button.
  //   4. Auto-retry once on the first failure (handles Render deploy blips).
  const loadOne = async <T,>(url: string, retries = 1): Promise<T> => {
    let lastErr: any;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as T;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) {
          // Short backoff before retrying. Deploy blips usually clear in <2s.
          await new Promise(r => setTimeout(r, 800));
        }
      }
    }
    throw lastErr;
  };

  // ── loadAll: parallel fetch + module-level cache ──────────────────────────
  // opts.force = true  → skip cache, always hit the network (used after mutations)
  // opts.silent = true → don't show the loading spinner (background refresh)
  const loadAll = async (opts?: { force?: boolean; silent?: boolean }) => {
    const silent = opts?.silent === true;
    const force  = opts?.force  === true;

    // ── Cache hit: serve instantly from memory ──────────────────────────────
    if (!force && _isCacheFresh()) {
      setSettings(_pricingCache.settings ?? DEFAULT_PRICING_SETTINGS);
      setCases(_pricingCache.cases);
      setProposals(_pricingCache.proposals as PricingProposal[]);
      setEmployees(_pricingCache.employees);
      setExternalContacts(_pricingCache.externalContacts);
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    const errors: { settings?: string; cases?: string; proposals?: string } = {};

    // ── ALL four endpoints in parallel (single round-trip budget) ──────────
    const [sResult, cResult, ePairResult, pResult] = await Promise.allSettled([
      loadOne<any>("/api/pricing/settings"),
      loadOne<any[]>("/api/pricing/cases"),
      Promise.all([
        loadOne<any[]>("/api/employees"),
        loadOne<any[]>("/api/external-contacts"),
      ]),
      loadOne<any[]>("/api/pricing/proposals"),
    ]);

    // Settings — default to DEFAULT_PRICING_SETTINGS so merged is always non-null
    let merged: PricingSettings = DEFAULT_PRICING_SETTINGS;
    if (sResult.status === "fulfilled") {
      const sData = sResult.value;
      merged = { ...DEFAULT_PRICING_SETTINGS, ...sData };
      if (!merged.roles?.length)                  merged.roles                  = DEFAULT_PRICING_SETTINGS.roles;
      if (!merged.regions?.length)                merged.regions                = DEFAULT_PRICING_SETTINGS.regions;
      if (!merged.ownership_multipliers?.length)  merged.ownership_multipliers  = DEFAULT_PRICING_SETTINGS.ownership_multipliers;
      if (!merged.revenue_band_multipliers?.length) merged.revenue_band_multipliers = DEFAULT_PRICING_SETTINGS.revenue_band_multipliers;
      if (!merged.sensitivity_multipliers?.length) merged.sensitivity_multipliers = DEFAULT_PRICING_SETTINGS.sensitivity_multipliers;
      setSettings(merged);
      _pricingCache.settings = merged;
    } else {
      errors.settings = (sResult.reason as any)?.message ?? "Failed to load settings";
      console.error("[PricingTool] settings load failed:", sResult.reason);
      setSettings(prev => prev ?? DEFAULT_PRICING_SETTINGS);
    }

    // Cases
    if (cResult.status === "fulfilled") {
      const cases = Array.isArray(cResult.value) ? cResult.value : [];
      setCases(cases);
      _pricingCache.cases = cases;
    } else {
      errors.cases = (cResult.reason as any)?.message ?? "Failed to load pricing cases";
      console.error("[PricingTool] cases load failed:", cResult.reason);
      // Preserve previous state — do NOT reset to []
    }

    // Employees + external contacts (single combined fetch, no duplicate)
    if (ePairResult.status === "fulfilled") {
      const [eData, ecData] = ePairResult.value;
      const emps = Array.isArray(eData)
        ? eData
            .filter((e: any) => e.status !== "former") // retired staff not in dropdowns
            .map((e: any) => ({ id: e.id, name: e.name, current_role_code: e.current_role_code }))
        : [];
      const exts = Array.isArray(ecData)
        ? ecData.map((x: any) => ({ id: x.id, name: x.name, kind: x.kind ?? "freelancer" }))
        : [];
      setEmployees(emps);
      setExternalContacts(exts);
      _pricingCache.employees        = emps;
      _pricingCache.externalContacts = exts;
    } else {
      console.warn("[PricingTool] employees/contacts load failed (dropdowns will use cached data):", ePairResult.reason);
    }

    // Proposals
    if (pResult.status === "fulfilled") {
      const rawProposals: PricingProposal[] = Array.isArray(pResult.value)
        ? pResult.value.map((p: any) => ({ ...p, pe_owned: p.pe_owned === 1 || p.pe_owned === true }))
        : [];

      // Auto-normalize fund names against canonical list (non-fatal, fire-and-forget)
      const canonicalFunds: string[] = merged?.funds ?? DEFAULT_PRICING_SETTINGS.funds ?? [];
      for (const p of rawProposals) {
        if (!p.fund_name) continue;
        const lName = p.fund_name.toLowerCase().trim();
        if (canonicalFunds.find(c => c.toLowerCase() === lName)) continue;
        const normalized =
          canonicalFunds.find(c => { const lc = c.toLowerCase(); return lName.includes(lc) || lc.includes(lName); }) ??
          canonicalFunds.find(c => c.toLowerCase().split(/\s+/).some(t => t.length >= 3 && lName.includes(t)));
        if (normalized && p.id) {
          p.fund_name = normalized;
          fetch(`/api/pricing/proposals/${p.id}`, {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...p, fund_name: normalized, pe_owned: p.pe_owned ? 1 : 0 }),
          }).catch(() => {});
        }
      }

      setProposals(rawProposals);
      _pricingCache.proposals = rawProposals;
    } else {
      errors.proposals = (pResult.reason as any)?.message ?? "Failed to load past projects";
      console.error("[PricingTool] proposals load failed:", pResult.reason);
      // Preserve previous state — do NOT reset to []
    }

    // Update cache timestamp only when core data loaded successfully
    if (!errors.cases && !errors.proposals) {
      _pricingCache.loadedAt = Date.now();
    }

    setLoadErrors(errors);
    if (!silent) setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  // Auto-refresh on window focus: if cache has expired since the user was
  // last on this page, silently re-fetch in the background.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // Error recovery: always retry if something failed
      if (Object.keys(loadErrors).length > 0) {
        _invalidatePricingCache();
        loadAll({ force: true });
        return;
      }
      // Stale cache: silently refresh without a spinner
      if (!_isCacheFresh()) {
        loadAll({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loadErrors]);

  useEffect(() => {
    setBenchmarks(settings?.country_benchmarks ?? DEFAULT_PRICING_SETTINGS.country_benchmarks ?? []);
    setCompIntensityLocal(settings?.competitive_intensity_adj ?? DEFAULT_PRICING_SETTINGS.competitive_intensity_adj ?? []);
    setCompTypeLocal(settings?.competitor_type_adj ?? DEFAULT_PRICING_SETTINGS.competitor_type_adj ?? []);
    setStratIntentLocal(settings?.strategic_intent_adj ?? DEFAULT_PRICING_SETTINGS.strategic_intent_adj ?? []);
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
    if (settings) base.staffing = buildStaffingFromPreset("1+2", settings);
    setTeamPreset("1+2");
    setForm(base);
    setView("form");
    setCaseDiscounts(buildInitialDiscounts(settings?.discounts ?? []));
    // Re-anchor the 3-timeline comparison around the new case duration.
    setCaseTimelines(deriveTimelines(base.duration_weeks));
  };

  const openCase = (c: any) => {
    const { industry: _i, country: _c, ...rest } = c;
    setForm({
      ...rest,
      pe_owned: c.pe_owned === 1 || c.pe_owned === true,
      staffing: c.staffing ?? [],
    });
    setWaterfallDuration(null); // reset so it reads from form.duration_weeks
    // Restore the saved NET1 manual override (typed-in figure or +/-500 nudge).
    // Stored in recommendation.manual_delta at save time; defaults to 0 for
    // older cases that pre-date editable NET1.
    setManualDelta(typeof c.recommendation?.manual_delta === "number" ? c.recommendation.manual_delta : 0);
    setView("form");
    if (c.case_discounts?.length) {
      // Ensure saved cases that pre-date the commitment discount get the new
      // row injected so the UI doesn't silently drop it.
      setCaseDiscounts(ensureCommitmentRow(c.case_discounts));
    } else if (settings) {
      setCaseDiscounts(buildInitialDiscounts(settings.discounts));
    }
    setCaseTimelines(c.case_timelines?.length
      ? c.case_timelines
      : deriveTimelines(c.duration_weeks ?? 12));
  };

  const saveBenchmarks = async (data?: CountryBenchmarkRow[], opts?: { silent?: boolean }) => {
    const toSave = data ?? benchmarksLocal;
    const silent = opts?.silent === true;
    if (!silent) setSavingBenchmarks(true);
    try {
      const updated = { ...(settings ?? DEFAULT_PRICING_SETTINGS), country_benchmarks: toSave };
      await fetch("/api/pricing/settings", {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      setBenchmarks(toSave);
      // Also update settings so a subsequent re-render driven by the
      // `settings` effect (line ~620) doesn't revert to stale values.
      setSettings(prev => prev ? { ...prev, country_benchmarks: toSave } : prev);
      if (data == null) setEditingBenchmarks(false);
      if (!silent) {
        toast({ title: "Benchmarks saved" });
        _invalidatePricingCache();
        loadAll({ force: true });
      }
      // Silent path: skip toast and loadAll so rapid stepper clicks don't
      // spam the UI or race against each other with stale server reads.
    } catch {
      toast({ title: "Failed to save benchmarks", variant: "destructive" });
    } finally {
      if (!silent) setSavingBenchmarks(false);
    }
  };

  const saveAdjustments = async (
    key: "competitive_intensity_adj" | "competitor_type_adj" | "strategic_intent_adj",
    data: PricingAdjustment[],
    setEditing: (v: boolean) => void,
    label: string,
  ) => {
    const updated = { ...(settings ?? DEFAULT_PRICING_SETTINGS), [key]: data };
    await fetch("/api/pricing/settings", {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    setSettings(updated);
    setEditing(false);
    toast({ title: `${label} saved` });
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
    _invalidatePricingCache(); loadAll({ force: true });
  };

  const saveProb = async (id: number) => {
    const raw = probDraft.trim();
    const val = raw === "" ? null : Math.max(0, Math.min(100, Math.round(Number(raw))));
    // Optimistic local update so the table refreshes immediately.
    setCases(prev => prev.map(c => c.id === id ? { ...c, win_probability: val } as any : c));
    setEditingProbId(null);
    await fetch(`/api/pricing/cases/${id}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ win_probability: val }),
    });
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
      _invalidatePricingCache(); loadAll({ force: true });
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
      _invalidatePricingCache(); loadAll({ force: true });
    }
    // Either way, remove this conflict from the list
    setImportConflicts(prev => prev.filter(c => c !== conflict));
  };

  const saveProposal = async () => {
    if (!historyForm.project_name.trim()) {
      toast({ title: "Project name is required", variant: "destructive" });
      return;
    }
    if (!isValidProjectName(historyForm.project_name)) {
      toast({
        title: "Project name must be 3 letters + 2 digits",
        description: `Got "${historyForm.project_name}". Expected format: ABC01.`,
        variant: "destructive",
      });
      return;
    }
    if (!historyForm.weekly_price) {
      toast({ title: "Weekly price is required", variant: "destructive" });
      return;
    }
    setSavingProposal(true);
    try {
      const payload = { ...historyForm, pe_owned: historyForm.pe_owned ? 1 : 0 };
      let r: Response;
      if (editingProposalId) {
        r = await fetch(`/api/pricing/proposals/${editingProposalId}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        r = await fetch("/api/pricing/proposals", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      // Verify save actually succeeded — without this the toast would
      // claim success even on 401/5xx and the user would think their
      // edits (e.g. end_date) persisted when they hadn't.
      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        console.error("[PricingTool] save proposal failed:", r.status, errBody);
        toast({
          title: `Save failed (HTTP ${r.status})`,
          description: errBody.slice(0, 200) || "See console for details.",
          variant: "destructive",
        });
        return;  // keep the form open so the user can retry / copy values
      }
      // Read back the saved row so we know the server actually persisted
      // every field. Drives the "Proposal updated/saved" toast below and
      // the subsequent loadAll() refresh.
      const saved = await r.json().catch(() => null);
      if (editingProposalId) {
        const synced = await syncClientFields(historyForm);
        const droppedFields: string[] = [];
        if (historyForm.end_date && saved?.end_date !== historyForm.end_date) droppedFields.push("end_date");
        if (historyForm.start_date && saved?.start_date !== historyForm.start_date) droppedFields.push("start_date");
        if (historyForm.manager_name && saved?.manager_name !== historyForm.manager_name) droppedFields.push("manager_name");
        if (droppedFields.length > 0) {
          toast({
            title: "Saved, but some fields didn't persist",
            description: `Server dropped: ${droppedFields.join(", ")}. Check console.`,
            variant: "destructive",
          });
          console.warn("[PricingTool] fields dropped on PUT:", droppedFields, { sent: historyForm, saved });
        } else {
          toast({ title: "Proposal updated", description: synced > 0 ? `${synced} sibling project${synced > 1 ? "s" : ""} synced.` : undefined });
        }
      } else {
        toast({ title: "Proposal saved" });
      }
      setShowHistoryForm(false);
      setShowEditProposalForm(false);
      setEditingProposalId(null);
      setHistoryForm(emptyProposal());
      _invalidatePricingCache(); loadAll({ force: true });
    } catch (e: any) {
      console.error("[PricingTool] save proposal threw:", e);
      toast({ title: "Failed to save", description: String(e?.message ?? e), variant: "destructive" });
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
          <Input type="date" min="2019-01-01" max={`${new Date().getFullYear()}-12-31`} value={historyForm.proposal_date} onChange={e => setHistoryForm(f => ({ ...f, proposal_date: e.target.value }))} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Outcome</Label>
          <Select value={historyForm.outcome} onValueChange={v => setHistoryForm(f => ({ ...f, outcome: v }))}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="won">Won</SelectItem>
              <SelectItem value="lost">Lost</SelectItem>
              <SelectItem value="pending">TBD</SelectItem>
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
              : "__none__";
            return (
              <div className="space-y-1">
                <Select value={selectVal} onValueChange={v => {
                  if (v === "__none__") setHistoryForm(f => ({ ...f, fund_name: "", pe_owned: false }));
                  else if (v === "other") setHistoryForm(f => ({ ...f, fund_name: "" }));
                  else setHistoryForm(f => ({ ...f, fund_name: v, pe_owned: true }));
                }}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select fund" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No fund —</SelectItem>
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
            const currentRegion = historyForm.region || "__none__";
            const inList = regionList.some(r => r.region_name === currentRegion);
            return (
              <Select value={currentRegion} onValueChange={v => setHistoryForm(f => ({ ...f, region: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select region" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Not set —</SelectItem>
                  {!inList && currentRegion !== "__none__" && (
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
          <Select value={historyForm.sector || "__none__"} onValueChange={v => setHistoryForm(f => ({ ...f, sector: v === "__none__" ? null : v }))}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select sector" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— Not set —</SelectItem>
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
              <SelectItem value="CHF">CHF Fr.</SelectItem>
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
        {/* Start date — when delivery begins. Used by the staffing Gantt;
            falls back to proposal_date if blank. */}
        <div className="space-y-1">
          <Label className="text-xs">Start date (optional)</Label>
          <Input
            type="date"
            value={historyForm.start_date ?? ""}
            onChange={e => setHistoryForm(f => ({ ...f, start_date: e.target.value || null }))}
            className="h-8 text-sm"
          />
          <div className="text-[9px] text-muted-foreground">
            Drives the /exec/staffing Gantt. If blank, falls back to proposal date.
          </div>
        </div>
        {/* End date — when set + future + outcome=won, project shows up on
            Exec → Ongoing Projects with weeks-remaining + invoice cadence. */}
        <div className="space-y-1">
          <Label className="text-xs">End date (optional)</Label>
          <Input
            type="date"
            value={historyForm.end_date ?? ""}
            onChange={e => setHistoryForm(f => ({ ...f, end_date: e.target.value || null }))}
            className="h-8 text-sm"
          />
          <div className="text-[9px] text-muted-foreground">
            If in the future + outcome=Won → appears in Exec dashboard as "ongoing".
          </div>
        </div>
        {/* Win probability — only relevant for outcome=pending. Drives the
            probability-weighted demand on the staffing Gantt and the Hiring
            Manager's buffer-rule hire trigger. */}
        {historyForm.outcome === "pending" && (
          <div className="space-y-1">
            <Label className="text-xs">Win probability (%)</Label>
            <Input
              type="number" min="0" max="100" step="5"
              value={historyForm.win_probability ?? ""}
              onChange={e => setHistoryForm(f => ({ ...f, win_probability: e.target.value === "" ? null : Math.max(0, Math.min(100, +e.target.value)) }))}
              className="h-8 text-sm font-mono"
              placeholder="e.g. 60"
            />
            <div className="text-[9px] text-muted-foreground">
              Probability-weighted demand on /exec/staffing.
            </div>
          </div>
        )}
        {/* Manager — the EM running the engagement day-to-day.
            Shows only Engagement Managers (EM1/EM2), Partners, and
            external freelancers/partners — other employee levels are
            not eligible to lead a project. Falls back to "Other" for
            names saved before this filter was introduced. */}
        <div className="space-y-1">
          <Label className="text-xs">Manager (EM)</Label>
          {(() => {
            const allNames = new Set([
              ...peopleOptions.tier1.map(p => p.name),
              ...peopleOptions.tier2.map(p => p.name),
            ]);
            const managerInList = !!historyForm.manager_name && allNames.has(historyForm.manager_name);
            const isCustom = !!historyForm.manager_name && !managerInList;
            return (
              <div className="space-y-1">
                <Select
                  value={
                    !historyForm.manager_name ? "__none__"
                    : isCustom ? "__other__"
                    : historyForm.manager_name
                  }
                  onValueChange={(v) => {
                    if (v === "__none__") setHistoryForm(f => ({ ...f, manager_name: null }));
                    else if (v === "__other__") setHistoryForm(f => ({ ...f, manager_name: f.manager_name || "" }));
                    else setHistoryForm(f => ({ ...f, manager_name: v }));
                  }}
                >
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Pick manager…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— none —</SelectItem>
                    {peopleOptions.tier1.length === 0 && peopleOptions.tier2.length === 0 && (
                      <div className="px-2 py-2 text-[11px] text-muted-foreground italic">
                        No eligible managers — add EM/Partner employees or freelancers.
                      </div>
                    )}
                    {peopleOptions.tier1.length > 0 && (
                      <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        Managers &amp; Partners
                      </div>
                    )}
                    {peopleOptions.tier1.map(p => (
                      <SelectItem key={`t1-${p.name}`} value={p.name}>
                        {p.name}{p.sublabel ? ` · ${p.sublabel}` : ""}
                      </SelectItem>
                    ))}
                    {peopleOptions.tier2.length > 0 && (
                      <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground border-t border-slate-200 mt-1">
                        Freelancers
                      </div>
                    )}
                    {peopleOptions.tier2.map(p => (
                      <SelectItem key={`t2-${p.name}`} value={p.name}>
                        {p.name}{p.sublabel ? ` · ${p.sublabel}` : ""}
                      </SelectItem>
                    ))}
                    <SelectItem value="__other__">— Other (type a name) —</SelectItem>
                  </SelectContent>
                </Select>
                {isCustom && (
                  <Input
                    type="text"
                    value={historyForm.manager_name ?? ""}
                    onChange={e => setHistoryForm(f => ({ ...f, manager_name: e.target.value || null }))}
                    className="h-7 text-xs"
                    placeholder="Custom name"
                  />
                )}
              </div>
            );
          })()}
        </div>
        {/* Team members — dropdown of employees + free-text role label.
            Same hybrid pattern as Manager: pick from /employees OR type
            a custom name (for external partners / freelancers / one-off
            ASCs not yet in the HR roster). Role stays free-text since
            it's a project-level label (Partner / Senior ASC / BA) not
            an employee attribute. */}
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <Label className="text-xs">Team members (beyond manager)</Label>
          <div className="space-y-1">
            {(historyForm.team_members ?? []).map((m, i) => {
              const inList = !!m.name && employees.some(e => e.name === m.name);
              const isCustom = !!m.name && !inList;
              return (
                <div key={i} className="flex gap-1 items-center">
                  <Select
                    value={
                      !m.name ? "__none__"
                      : isCustom ? "__other__"
                      : m.name
                    }
                    onValueChange={(v) => setHistoryForm(f => {
                      const next = [...(f.team_members ?? [])];
                      next[i] = {
                        ...next[i],
                        name: v === "__none__" ? "" : v === "__other__" ? (next[i].name || "") : v,
                      };
                      return { ...f, team_members: next };
                    })}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1"><SelectValue placeholder="Pick employee…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— none —</SelectItem>
                      {employees.map(e => (
                        <SelectItem key={e.id} value={e.name}>
                          {e.name}{e.current_role_code ? ` · ${e.current_role_code}` : ""}
                        </SelectItem>
                      ))}
                      <SelectItem value="__other__">— Other (type a name) —</SelectItem>
                    </SelectContent>
                  </Select>
                  {isCustom && (
                    <Input
                      type="text"
                      value={m.name}
                      onChange={e => setHistoryForm(f => {
                        const next = [...(f.team_members ?? [])];
                        next[i] = { ...next[i], name: e.target.value };
                        return { ...f, team_members: next };
                      })}
                      className="h-7 text-xs flex-1"
                      placeholder="Custom name"
                    />
                  )}
                  <Button
                    type="button" size="sm" variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setHistoryForm(f => ({
                      ...f,
                      team_members: (f.team_members ?? []).filter((_, j) => j !== i),
                    }))}
                  >×</Button>
                </div>
              );
            })}
            <Button
              type="button" size="sm" variant="outline"
              className="h-7 text-xs"
              onClick={() => setHistoryForm(f => ({
                ...f,
                team_members: [...(f.team_members ?? []), { role: "", name: "" }],
              }))}
            >+ Add team member</Button>
          </div>
        </div>
        {/* Last invoice — drives the "needs invoice" flag on Exec dashboard
            for ongoing projects. >30d ago = flagged amber. */}
        <div className="space-y-1">
          <Label className="text-xs">Last invoice sent</Label>
          <Input
            type="date"
            value={historyForm.last_invoice_at ?? ""}
            onChange={e => setHistoryForm(f => ({ ...f, last_invoice_at: e.target.value || null }))}
            className="h-8 text-sm"
          />
          <div className="text-[9px] text-muted-foreground">
            If &gt;30 days ago and project is ongoing → flagged for invoicing.
          </div>
        </div>
        {/* Weekly reports — managers post here; Delivery Director reads the
            stack to compute green/amber/red health and surface risks. Only
            useful for Won + ongoing projects but always editable so the
            user can backfill historical reports if needed. */}
        <div className="space-y-1 sm:col-span-2 lg:col-span-3">
          <Label className="text-xs">Weekly reports (Delivery Director reads these)</Label>
          <div className="space-y-2">
            {(historyForm.weekly_reports ?? []).map((r, i) => (
              <div key={i} className="border rounded p-2 bg-muted/20 space-y-1">
                <div className="flex gap-2 items-center flex-wrap">
                  <Input
                    type="date"
                    value={r.week_of}
                    onChange={e => setHistoryForm(f => {
                      const next = [...(f.weekly_reports ?? [])];
                      next[i] = { ...next[i], week_of: e.target.value };
                      return { ...f, weekly_reports: next };
                    })}
                    className="h-7 text-xs w-36"
                    title="Week-of (Monday)"
                  />
                  <Select
                    value={r.status}
                    onValueChange={v => setHistoryForm(f => {
                      const next = [...(f.weekly_reports ?? [])];
                      next[i] = { ...next[i], status: v as "green" | "amber" | "red" };
                      return { ...f, weekly_reports: next };
                    })}
                  >
                    <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="green">🟢 Green</SelectItem>
                      <SelectItem value="amber">🟡 Amber</SelectItem>
                      <SelectItem value="red">🔴 Red</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number" min="0" max="100" step="5"
                    value={r.pct_complete ?? ""}
                    onChange={e => setHistoryForm(f => {
                      const next = [...(f.weekly_reports ?? [])];
                      next[i] = { ...next[i], pct_complete: e.target.value === "" ? undefined : +e.target.value };
                      return { ...f, weekly_reports: next };
                    })}
                    className="h-7 text-xs w-16 font-mono"
                    placeholder="% done"
                    title="Completion percentage"
                  />
                  <Input
                    type="text"
                    value={r.author ?? ""}
                    onChange={e => setHistoryForm(f => {
                      const next = [...(f.weekly_reports ?? [])];
                      next[i] = { ...next[i], author: e.target.value };
                      return { ...f, weekly_reports: next };
                    })}
                    className="h-7 text-xs flex-1 min-w-32"
                    placeholder="Author (manager name)"
                  />
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs"
                    onClick={() => setHistoryForm(f => ({
                      ...f,
                      weekly_reports: (f.weekly_reports ?? []).filter((_, j) => j !== i),
                    }))}
                  >×</Button>
                </div>
                <Textarea
                  value={r.body}
                  onChange={e => setHistoryForm(f => {
                    const next = [...(f.weekly_reports ?? [])];
                    next[i] = { ...next[i], body: e.target.value };
                    return { ...f, weekly_reports: next };
                  })}
                  rows={2}
                  className="text-xs"
                  placeholder="What shipped this week, what's blocked, what's next"
                />
              </div>
            ))}
            <Button
              type="button" size="sm" variant="outline"
              className="h-7 text-xs"
              onClick={() => setHistoryForm(f => ({
                ...f,
                weekly_reports: [
                  ...(f.weekly_reports ?? []),
                  { week_of: new Date().toISOString().slice(0, 10), status: "green" as const, body: "", author: "", pct_complete: undefined },
                ],
              }))}
            >+ Add weekly report</Button>
          </div>
          <div className="text-[9px] text-muted-foreground">
            Delivery Director scores green/amber/red across the portfolio every Monday + Thursday.
          </div>
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
      {historyForm.outcome === "lost" && (() => {
        // ── Loss debrief section ────────────────────────────────────────
        // Mirrors the MS Forms survey sent to clients after a lost deal.
        // Everything is optional — partial surveys (or none at all) are
        // the norm. Lives in `client_feedback` (JSONB) so we can add
        // future survey questions without a migration; each setter just
        // spreads into the current object.
        const fb = historyForm.client_feedback || {};
        const ratings = fb.ratings || {};

        // Update helper — always returns a fresh object so React sees
        // the state change, and clears the whole block to null when
        // every field is empty (keeps the DB tidy).
        const setFb = (patch: Partial<typeof fb>) => {
          setHistoryForm(f => {
            const cur = f.client_feedback || {};
            const next = { ...cur, ...patch };
            // Collapse to null only if everything is empty/null.
            const hasAnything = Object.entries(next).some(([k, v]) => {
              if (v == null || v === "") return false;
              if (k === "ratings" && typeof v === "object") {
                return Object.values(v as any).some(x => x != null && x !== "");
              }
              return true;
            });
            return { ...f, client_feedback: hasAnything ? next : null };
          });
        };

        const setRating = (key: keyof NonNullable<typeof ratings>, val: number | null) => {
          setFb({ ratings: { ...ratings, [key]: val } });
        };

        // Small reusable 1-5 stars picker. Clicking the same score
        // a second time clears it (so you can mark "not answered").
        const Stars = ({ value, onChange }: { value: number | null | undefined; onChange: (v: number | null) => void }) => (
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => onChange(value === n ? null : n)}
                className={`w-5 h-5 flex items-center justify-center rounded text-sm transition-colors ${
                  (value ?? 0) >= n
                    ? "text-amber-500 hover:text-amber-600"
                    : "text-muted-foreground/30 hover:text-muted-foreground"
                }`}
                title={`${n}/5`}
              >
                ★
              </button>
            ))}
            {value != null && (
              <span className="text-[10px] text-muted-foreground ml-1 font-mono">{value}/5</span>
            )}
          </div>
        );

        return (
          <div className="space-y-3 border-l-2 border-red-300 pl-4 mt-2 bg-red-50/30 py-3 pr-3 rounded-r">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-red-700">
                  Loss debrief
                </div>
                <div className="text-[10px] text-muted-foreground italic">
                  Client feedback captured after the loss. Leave blank if the survey wasn't returned.
                </div>
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px]">Received on</Label>
                <Input
                  type="date"
                  value={fb.received_date || ""}
                  onChange={e => setFb({ received_date: e.target.value || null })}
                  className="h-7 text-xs w-36"
                />
              </div>
            </div>

            {/* Quick quantitative block */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-0.5">
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
              <div className="space-y-0.5">
                <Label className="text-xs">Who won the deal?</Label>
                <Input
                  value={fb.winner_name || ""}
                  onChange={e => setFb({ winner_name: e.target.value || null })}
                  className="h-8 text-sm"
                  placeholder="e.g. McKinsey, BCG, internal team"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs">Would reconsider us?</Label>
                <Select
                  value={fb.would_reconsider || "__none__"}
                  onValueChange={v => setFb({ would_reconsider: v === "__none__" ? null : (v as "yes" | "no" | "maybe") })}
                >
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Not answered —</SelectItem>
                    <SelectItem value="yes">Yes — in future RFPs</SelectItem>
                    <SelectItem value="maybe">Maybe</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Rating block — 1 to 5 stars per dimension */}
            <div className="space-y-1">
              <Label className="text-xs">Client ratings (1–5)</Label>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 pl-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Overall experience</span>
                  <Stars value={ratings.overall} onChange={v => setRating("overall", v)} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Team quality</span>
                  <Stars value={ratings.team} onChange={v => setRating("team", v)} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Price fairness</span>
                  <Stars value={ratings.price_fairness} onChange={v => setRating("price_fairness", v)} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Deck / proposal quality</span>
                  <Stars value={ratings.deck_quality} onChange={v => setRating("deck_quality", v)} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Approach / methodology</span>
                  <Stars value={ratings.approach} onChange={v => setRating("approach", v)} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Relationship / responsiveness</span>
                  <Stars value={ratings.relationship} onChange={v => setRating("relationship", v)} />
                </div>
              </div>
            </div>

            {/* Free-text qualitative block */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-0.5">
                <Label className="text-xs">What we did well</Label>
                <Textarea
                  value={fb.strengths || ""}
                  onChange={e => setFb({ strengths: e.target.value || null })}
                  className="text-xs min-h-[60px]"
                  placeholder="Client's verbatim: what they liked about our pitch, team, process…"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs">What to improve</Label>
                <Textarea
                  value={fb.weaknesses || ""}
                  onChange={e => setFb({ weaknesses: e.target.value || null })}
                  className="text-xs min-h-[60px]"
                  placeholder="Gaps vs. the winner: seniority, industry refs, deck depth, speed…"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs">Reasons for choosing the winner</Label>
                <Textarea
                  value={fb.reasons_for_choosing_winner || ""}
                  onChange={e => setFb({ reasons_for_choosing_winner: e.target.value || null })}
                  className="text-xs min-h-[60px]"
                  placeholder="Price, brand, relationship, specific expertise, timeline…"
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-xs">Additional comments</Label>
                <Textarea
                  value={fb.additional_comments || ""}
                  onChange={e => setFb({ additional_comments: e.target.value || null })}
                  className="text-xs min-h-[60px]"
                  placeholder="Anything else worth capturing for next time"
                />
              </div>
            </div>

            {/* Micro-help line pointing at the MS Forms survey */}
            <div className="text-[9px] text-muted-foreground italic border-t pt-2">
              Survey source:{" "}
              <a
                href="https://forms.cloud.microsoft/pages/responsepage.aspx?id=T0Pyhh4ZtUyfZzrLjQ4J_gLUxj3bPXJKsQcgYFFWMg5UNkZSM0dXRU1SUkFUQTNPNEtESVI3U1gzMC4u&route=shorturl"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                MS Forms loss-debrief
              </a>
              {" "}· paste the client's answers into each field above.
            </div>
          </div>
        );
      })()}
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

  const downloadProposalsExcel = () => {
    // Columns in the same order as the table, plus all extra project fields
    const cols: { key: keyof PricingProposal; label: string; fmt?: "num" | "pct" | "date" }[] = [
      { key: "proposal_date",            label: "Date",                   fmt: "date" },
      { key: "project_name",             label: "Project" },
      { key: "client_name",              label: "Client" },
      { key: "fund_name",                label: "Fund" },
      { key: "region",                   label: "Region" },
      { key: "country",                  label: "Country" },
      { key: "sector",                   label: "Sector" },
      { key: "project_type",             label: "Type" },
      { key: "duration_weeks",           label: "Weeks",                  fmt: "num" },
      { key: "team_size",                label: "Team",                   fmt: "num" },
      { key: "currency",                 label: "Cur." },
      { key: "weekly_price",             label: "Weekly Price",           fmt: "num" },
      { key: "total_fee",                label: "Total Net Fees",         fmt: "num" },
      { key: "outcome",                  label: "Outcome" },
      { key: "loss_reason",              label: "Loss Reason" },
      { key: "pe_owned",                 label: "PE Owned" },
      { key: "revenue_band",             label: "Revenue Band" },
      { key: "company_revenue_m",        label: "Company Revenue (M€)",   fmt: "num" },
      { key: "ebitda_margin_pct",        label: "EBITDA Margin %",        fmt: "pct" },
      { key: "expected_ebitda_growth_pct",label: "Exp. EBITDA Growth %",  fmt: "pct" },
      { key: "notes",                    label: "Notes" },
    ];

    const esc = (v: unknown): string => {
      if (v === null || v === undefined) return "";
      if (typeof v === "boolean") return v ? "Yes" : "No";
      return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    };

    const numFmt = (v: unknown) => {
      if (v === null || v === undefined || v === "") return "";
      const n = Number(v);
      return isNaN(n) ? esc(v) : n.toLocaleString("it-IT", { maximumFractionDigits: 2 });
    };

    const cellVal = (p: PricingProposal, col: typeof cols[0]): string => {
      const raw = (p as any)[col.key];
      if (col.key === "pe_owned") return raw ? "Yes" : "No";
      if (col.fmt === "num") return numFmt(raw);
      if (col.fmt === "pct") return raw != null ? `${raw}%` : "";
      return esc(raw);
    };

    const cellAlign = (col: typeof cols[0]) =>
      col.fmt === "num" || col.fmt === "pct" ? "right" : "left";

    // Sort: same as propSort state
    const sorted = [...proposals].sort((a, b) => {
      const dir = propSort.dir === "asc" ? 1 : -1;
      const av = (a as any)[propSort.field] ?? "";
      const bv = (b as any)[propSort.field] ?? "";
      if (typeof av === "number" && typeof bv === "number") return dir * (av - bv);
      return dir * String(av).localeCompare(String(bv));
    });

    // Build HTML table
    const headerRow = cols.map(c =>
      `<th style="background:#1A3A4A;color:#fff;font-weight:bold;font-size:11px;padding:6px 10px;border:1px solid #ccc;white-space:nowrap;">${c.label}</th>`
    ).join("");

    const dataRows = sorted.map((p, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f8f9fa";
      const excluded = isExcluded(p);
      const rowStyle = excluded ? `background:${bg};color:#aaa;text-decoration:line-through;` : `background:${bg};`;
      const cells = cols.map(col => {
        const val = cellVal(p, col);
        const align = cellAlign(col);
        // Outcome color
        let color = "";
        if (col.key === "outcome") {
          if (val === "won") color = "color:#16a34a;font-weight:bold;";
          else if (val === "lost") color = "color:#dc2626;font-weight:bold;";
        }
        return `<td style="${rowStyle}${color}text-align:${align};font-size:11px;padding:4px 8px;border:1px solid #e5e7eb;white-space:nowrap;">${val}</td>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    }).join("");

    const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>table{border-collapse:collapse;font-family:Calibri,Arial,sans-serif;}td,th{mso-number-format:"\\@";}</style>
</head>
<body>
<table>
<thead><tr>${headerRow}</tr></thead>
<tbody>${dataRows}</tbody>
</table>
</body></html>`;

    const blob = new Blob(["\ufeff" + html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `past_projects_${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Excel downloaded", description: `${proposals.length} projects exported.` });
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
      const bestSector  = group.map(p => p.sector).find(v => v && v.trim());
      const bestRevenue = group.map(p => p.company_revenue_m).find(v => v != null && v > 0);
      const bestEbitda  = group.map(p => p.ebitda_margin_pct).find(v => v != null && v > 0);

      for (const p of group) {
        const patch: Partial<PricingProposal> = {};
        if (bestRegion  && !(p.region ?? "").trim())                     patch.region = bestRegion;
        if (bestFund    && !(p.fund_name ?? "").trim())                  patch.fund_name = bestFund;
        if (bestSector  && !(p.sector ?? "").trim())                     patch.sector = bestSector;
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
      const baseWeekly = nwfClamped + manualDelta;
      // weekly_price = gross+admin (variable fee is tracked separately as a success fee)
      const weeklyGrossAdmin = Math.round(baseWeekly * (1 + adminFeePct / 100));
      // Net = recommended price (what we receive)
      const netTotal = Math.round(baseWeekly * form.duration_weeks);
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

      // Stamp the case itself so it moves to the Won/Lost tab.
      if (form.id) {
        await fetch(`/api/pricing/cases/${form.id}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_name: form.project_name, outcome }),
        });
      }

      toast({
        title: `Project marked as ${outcome}`,
        description: `${displayProjectName(form.project_name, form.revision_letter)} marked ${outcome}`,
      });
      setView("list");
      // Land on the All Projects tab where the now-resolved row appears
      // alongside everything else.
      setMainTab("history");
      _invalidatePricingCache(); loadAll({ force: true });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setMarkingOutcome(false);
    }
  };

  const deleteProposal = async (id: number) => {
    if (!confirm("Delete this past proposal?")) return;
    await fetch(`/api/pricing/proposals/${id}`, { method: "DELETE", credentials: "include" });
    _invalidatePricingCache(); loadAll({ force: true });
  };

  const deleteDuplicate = async (id: number) => {
    const res = await fetch(`/api/pricing/proposals/${id}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) { alert(`Delete failed (${res.status}) — please refresh and try again.`); return; }
    setProposals(prev => prev.filter(p => p.id !== id));
    _invalidatePricingCache();
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
    // Note: sector is synced (same for all projects of a client) but project_type is NOT (can vary)
    const patch: Partial<PricingProposal> = {};
    if (source.region) patch.region = source.region;
    if (source.fund_name) patch.fund_name = source.fund_name;
    if (source.sector) patch.sector = source.sector;
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
    // Optimistic local update — use prev to avoid stale closure
    let resolvedPayload: any = null;
    setProposals(prev => {
      const updated = prev.map(p => p.id === id ? { ...p, ...patch } : p);
      const current = updated.find(p => p.id === id);
      if (current) {
        resolvedPayload = { ...current, ...patch, pe_owned: current.pe_owned ? 1 : 0 };
      }
      return updated;
    });
    // Wait one tick for setProposals to flush
    await new Promise(r => setTimeout(r, 0));
    if (!resolvedPayload) return;
    try {
      await fetch(`/api/pricing/proposals/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resolvedPayload),
      });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
      _invalidatePricingCache(); loadAll({ force: true });
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
    if (!isValidProjectName(form.project_name)) {
      toast({
        title: "Project name must be 3 letters + 2 digits",
        description: `Got "${form.project_name}". Expected format: ABC01 (revision letter is separate).`,
        variant: "destructive",
      });
      return;
    }
    if (!form.region) { toast({ title: "Region is required", variant: "destructive" }); return; }
    if (!form.duration_weeks) { toast({ title: "Duration is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        pe_owned: form.pe_owned ? 1 : 0,
        status,
        // Bake the canonical net + gross weekly into the saved
        // recommendation jsonb so downstream views (Pricing Cases LIST
        // Target/wk column, exec dashboards) display the SAME figure
        // the user sees in the waterfall NET1 bar — not the engine's
        // raw target_weekly which can differ after manual delta, band
        // clamp, and commitment discount. Also persist manual_delta so
        // the user-typed NET1 override survives reload.
        recommendation: recommendation
          ? {
              ...recommendation,
              manual_delta: manualDelta,
              canonical_net_weekly: canonicalNetWeekly,
              canonical_gross_weekly: canonicalGrossWeekly,
              admin_fee_pct: adminFeePct,
              variable_fee_pct: variableFeePct,
            }
          : null,
        case_discounts: caseDiscounts,
        case_timelines: caseTimelines,
      };
      const method = form.id ? "PUT" : "POST";
      const url = form.id ? `/api/pricing/cases/${form.id}` : "/api/pricing/cases";
      const res = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Save failed");

      // (TBD auto-create / stale-cleanup happens server-side now — see
      // ensureTbdProposalForFinalCase + removeStaleTbdForNonFinalCase in
      // server/routes.ts. Removed the client-side duplicate POST that
      // used to run alongside it and double-insert the proposal row.)

      toast({ title: status === "final" ? "Case finalised" : "Saved as draft" });
      setView("list");
      _invalidatePricingCache(); loadAll({ force: true });
    } catch {
      toast({ title: "Failed to save case", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Backfill TBD proposals from existing cases ──────────────────
  // For every pricing case that has NO matching row in pricing_proposals
  // (matched by lower-cased project_name), create a TBD proposal so it
  // appears in Past Projects + Executive Dashboard. Idempotent — re-
  // running it after the first sweep finds nothing to do. Skipped cases
  // are reported in the toast so the user can spot mismatched names.
  const backfillTbdFromCases = async () => {
    setBackfillingTbd(true);
    try {
      // Calls the server-side two-way sync. It (a) inserts a TBD row for
      // every Final case that doesn't have one and (b) removes pending
      // TBDs whose backing case is no longer Final (Draft / Active).
      // Won/Lost proposals are never touched. Removed rows go to the
      // 30-day trash bin so a mistake is one click away from recovery.
      const r = await fetch("/api/pricing/proposals/sync-tbd-with-final-cases", {
        method: "POST", credentials: "include",
      });
      if (!r.ok) {
        toast({ title: "Sync failed", variant: "destructive" });
        return;
      }
      const out = await r.json();
      const parts: string[] = [];
      if (out.inserted > 0) parts.push(`${out.inserted} added`);
      if (out.deleted > 0)  parts.push(`${out.deleted} removed`);
      if (out.deduped > 0)  parts.push(`${out.deduped} dup TBDs collapsed`);
      if (parts.length === 0) parts.push("Already in sync — no changes needed.");
      else parts.push("(restorable from /admin/trash)");
      toast({ title: "TBD sync complete", description: parts.join(" · ") });
      _invalidatePricingCache(); loadAll({ force: true });
    } finally {
      setBackfillingTbd(false);
    }
  };

  // ── Backfill canonical net/gross weekly into every case ─────────
  // For each case with a saved recommendation, replicate the live
  // canonicalNetWeekly + canonicalGrossWeekly math (without needing to
  // open the form) and PUT the augmented case back. After this runs,
  // the Pricing Cases LIST Target/wk column reads the correct NET1
  // figure from recommendation.canonical_net_weekly for every row,
  // not just cases re-saved manually after the migration.
  //
  // Math here MUST stay in sync with the canonicalNetWeekly useMemo
  // (lines ~2560 onwards). If that logic changes, mirror it here.
  const backfillCanonicalForCases = async () => {
    setBackfillingCanonical(true);
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    try {
      const CANONICAL_KEYS = ["Geography", "Sector", "Ownership", "Client Size", "Client Profile", "Strategic Intent"];
      const failures: string[] = [];
      for (const c of cases) {
        const rec = (c as any).recommendation;
        // Skip only when there is NOTHING to compute from. base_weekly is
        // enough — if layer_trace is missing or empty, deltas default to 0
        // and we still produce a sensible canonical = base + clamp + manual.
        // Previous strict check ate every legacy case that had a non-array
        // layer_trace and explained the "3 still need migration" loop.
        if (!rec || (!rec.base_weekly && !rec.target_weekly)) {
          skipped++;
          continue;
        }
        // 1. Replay layer trace to get post-engine running weekly. Fall back
        //    to target_weekly when base_weekly + layer_trace is absent — the
        //    engine's recommendation is at least a starting point.
        const traceByKey: Record<string, { value: number }> = {};
        const trace = Array.isArray(rec.layer_trace) ? rec.layer_trace : [];
        for (const lt of trace) {
          const key = (lt.label ?? "").replace(/\s*\(.*?\)\s*$/, "").trim();
          if (key) traceByKey[key] = lt;
        }
        const baseWeekly = rec.base_weekly ?? rec.target_weekly ?? 0;
        let prevOrig = baseWeekly;
        const deltas: Record<string, number> = {};
        for (const key of CANONICAL_KEYS) {
          const lt = traceByKey[key];
          if (lt) { deltas[key] = lt.value - prevOrig; prevOrig = lt.value; }
          else deltas[key] = 0;
        }
        let running = baseWeekly;
        for (const key of CANONICAL_KEYS) {
          const d = deltas[key] ?? 0;
          if (Math.abs(d) >= 1) running += d;
        }
        // 2. Band clamp using the case's region + current benchmarks
        const aliases = REGION_TO_COUNTRY[(c as any).region] ?? [(c as any).region];
        const aliasSet = new Set(aliases.map((a: string) => a.toLowerCase()));
        const weeklyRows = benchmarks.filter(b =>
          aliasSet.has(b.country.toLowerCase())
          && (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee")));
        const nonZero = weeklyRows.filter(r => r.green_low > 0 && r.green_high > 0);
        const gLow  = nonZero.length ? Math.min(...nonZero.map(r => r.green_low))  : 0;
        const gHigh = nonZero.length ? Math.max(...nonZero.map(r => r.green_high)) : 0;
        if (gLow > 0 && gHigh > 0) {
          running = Math.min(gHigh, Math.max(gLow, running));
        }
        // 3. Manual delta (preserve if already saved)
        running += (typeof rec.manual_delta === "number" ? rec.manual_delta : 0);
        // 4. Commitment discount
        const cdiscs = ((c as any).case_discounts ?? []) as Array<{ id: string; pct: number; enabled: boolean }>;
        const commit = cdiscs.find(d => d.id === "commitment");
        if (commit?.enabled && commit.pct > 0) {
          running = running * (1 - commit.pct / 100);
        }
        const canonicalNet = Math.round(running);
        // 5. Canonical gross
        const adminPct = typeof rec.admin_fee_pct === "number" ? rec.admin_fee_pct : 8;
        let g = canonicalNet * (1 + adminPct / 100);
        for (const d of cdiscs.filter(d => d.enabled && d.pct > 0 && d.id !== "commitment")) {
          g /= (1 - d.pct / 100);
        }
        const canonicalGross = Math.round(g);
        // 6. PUT a MINIMAL payload — only the field we want to update.
        //    Spreading ...c was the silent-failure cause: server-managed
        //    fields like updated_at / created_at would fail Zod validation
        //    and the entire PUT 400'd → toast just said "X failed" with no
        //    detail. PUT is partial in the schema, so {recommendation,
        //    project_name} is enough; project_name is the only required
        //    field on the schema (line 383 of schema.ts).
        const payload = {
          project_name: (c as any).project_name,
          recommendation: {
            ...rec,
            canonical_net_weekly: canonicalNet,
            canonical_gross_weekly: canonicalGross,
            admin_fee_pct: adminPct,
          },
        };
        try {
          const r = await fetch(`/api/pricing/cases/${(c as any).id}`, {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (r.ok) {
            updated++;
          } else {
            failed++;
            const errText = await r.text().catch(() => `HTTP ${r.status}`);
            failures.push(`${(c as any).project_name ?? c.id}: ${errText.slice(0, 120)}`);
          }
        } catch (e: any) {
          failed++;
          failures.push(`${(c as any).project_name ?? c.id}: ${e?.message ?? "network error"}`);
        }
      }
      const parts: string[] = [];
      if (updated > 0) parts.push(`${updated} updated`);
      if (skipped > 0) parts.push(`${skipped} skipped (no recommendation)`);
      if (failed > 0)  parts.push(`${failed} failed`);
      toast({
        title: failed > 0 ? "Canonical backfill — partial" : "Canonical backfill done",
        description: (parts.join(" · ") || "Nothing to do.") + (failures.length > 0 ? `\n${failures.join("\n")}` : ""),
        variant: failed > 0 ? "destructive" : undefined,
      });
      _invalidatePricingCache(); loadAll({ force: true });
    } finally {
      setBackfillingCanonical(false);
    }
  };

  // How many cases still need the canonical fields backfilled.
  const canonicalBackfillCount = (() => {
    return cases.filter((c: any) => {
      const r = c.recommendation;
      if (!r || !r.base_weekly) return false;
      // Already has the canonical field? Skip.
      return typeof r.canonical_net_weekly !== "number";
    }).length;
  })();

  // How many cases are missing a matching proposal — drives the button
  // label so the user knows whether clicking will do anything.
  // Sum of pending changes the sync would perform: missing Final TBDs
  // to add + stale Draft/Active TBDs to remove. Drives the button label.
  const tbdBackfillCount = (() => {
    const propNames = new Set(proposals.map(p => (p.project_name || "").trim().toLowerCase()).filter(Boolean));
    const toAdd = cases.filter((c: any) => {
      const n = (c.project_name || "").trim().toLowerCase();
      return n && c.status === "final" && !propNames.has(n);
    }).length;
    const caseByName = new Map<string, any>();
    for (const c of cases) {
      const n = (c.project_name || "").trim().toLowerCase();
      if (n) caseByName.set(n, c);
    }
    const toRemove = proposals.filter(p => {
      if (p.outcome !== "pending") return false;
      const n = (p.project_name || "").trim().toLowerCase();
      const matchingCase = caseByName.get(n);
      return matchingCase != null && matchingCase.status !== "final";
    }).length;
    return toAdd + toRemove;
  })();

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

  // Resolve the effective daily rate for a staffing line. Legacy saves
  // sometimes have line.daily_rate_used = 0 even though the role's admin
  // default is non-zero — when that happens any cost calculation that
  // multiplies by line.daily_rate_used silently collapses to 0 (the
  // "Partner reduction is 0%" symptom). All non-totalizer cost callers
  // should use this helper so a stale-zero never produces a 0 share.
  const effectiveLineRate = (l: StaffingLine): number => {
    if (l.daily_rate_used && l.daily_rate_used > 0) return l.daily_rate_used;
    const role = settings?.roles.find(r => r.id === l.role_id);
    return role?.default_daily_rate ?? 0;
  };

  // Compute weekly total only from visible STAFFING_ROLES, mirroring the
  // per-row display exactly: same count-gate, same rate source (the admin
  // role's default_daily_rate, not the line's stored daily_rate_used, which
  // can drift to 0 on legacy saves and silently zero out that row's weekly).
  const baseWeeklyDisplay = settings
    ? STAFFING_ROLES.reduce((acc, def) => {
        const role = settings.roles.find(r => r.role_name.toLowerCase().includes(def.match.toLowerCase()));
        if (!role) return acc;
        const line = form.staffing.find(s => s.role_id === role.id);
        const count = line?.count ?? 0;
        if (count <= 0) return acc;
        const days = line?.days_per_week ?? def.defaultDays;
        return acc + count * days * role.default_daily_rate;
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
  const totalProjectCost = totalWeeklyCost * form.duration_weeks;
  // Net = recommended (target_weekly), never reduced by discounts
  const netTargetWeekly = recommendation ? recommendation.target_weekly : 0;
  const netTargetTotal = netTargetWeekly * form.duration_weeks;
  const netRevenue = netTargetTotal;
  const grossMarginEur = netRevenue - totalProjectCost;
  const grossMarginPct = netRevenue > 0 ? (grossMarginEur / netRevenue) * 100 : 0;

  // Fund history for display
  // Fund proposals — ranked by highest weekly fees (most expensive first)
  const fundProposals = useMemo(() => {
    if (!form.fund_name?.trim()) return [];
    return proposals
      .filter(p => p.fund_name?.toLowerCase().trim() === form.fund_name.toLowerCase().trim() && p.weekly_price > 0)
      .sort((a, b) => b.weekly_price - a.weekly_price)
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

  // NWF = recommended net weekly fees (= target_weekly, no discounts applied)
  // Clamped to country min/max from rate matrix
  const nwfRaw = recommendation ? recommendation.target_weekly : 0;
  const nwfClamped = nwfRaw > 0
    ? Math.max(
        minFeeWeekly > 0 ? minFeeWeekly : nwfRaw,
        Math.min(maxFeeWeekly < Infinity ? maxFeeWeekly : nwfRaw, nwfRaw)
      )
    : 0;
  const tnf = nwfClamped * (form.duration_weeks || 0);

  // ── Single source of truth: canonical Net and Gross weekly ────────────
  // These MUST match the waterfall's Net and Gross bars exactly.
  // Net = waterfall adjustedFinal clamped to green band (same as recommendedNwf)
  // Gross = Net × (1+admin%) / (1-d1%) / (1-d2%) / ...
  const canonicalNetWeekly = useMemo(() => {
    if (!recommendation) return 0;
    // Reproduce waterfall EXACTLY: start from base, apply layer deltas
    // respecting disabledBars (toggle state). This ensures Net here = Net bar in waterfall.
    const trace = recommendation.layer_trace;
    const base = recommendation.base_weekly;
    const CANONICAL_KEYS = ["Geography", "Sector", "Ownership", "Client Size", "Client Profile", "Strategic Intent"];

    // First compute deltas from trace (same as waterfall traceByKey logic)
    const traceByKey: Record<string, { value: number }> = {};
    for (const lt of trace) {
      const key = lt.label.replace(/\s*\(.*?\)\s*$/, "").trim();
      traceByKey[key] = lt;
    }
    const deltas: Record<string, number> = {};
    let prevOrig = base;
    for (const key of CANONICAL_KEYS) {
      const lt = traceByKey[key];
      if (lt) {
        deltas[key] = lt.value - prevOrig;
        prevOrig = lt.value;
      } else {
        deltas[key] = 0;
      }
    }

    // Apply deltas respecting disabled bars (same as waterfall runningValue logic)
    let running = base;
    for (const key of CANONICAL_KEYS) {
      const delta = deltas[key] ?? 0;
      const isDisabled = disabledBars.has(key);
      if (!isDisabled && Math.abs(delta) >= 1) {
        running += delta;
      }
    }
    // Clamp to green band BEFORE manual adjustment
    // (manual price adj overrides the green band — user decision takes priority)
    // Merge corridors across every country in the region (e.g. DACH = DE+AT+CH)
    // so we match the widest band shown in the "Pricing Corridors by Country"
    // table. Previously this used .find() which returned only the first matching
    // country row, causing the clamp to use a narrower corridor than displayed.
    const countryAliases = REGION_TO_COUNTRY[form.region] ?? [form.region];
    const aliasSet = new Set(countryAliases.map(a => a.toLowerCase()));
    const weeklyRows = benchmarks.filter(b =>
      aliasSet.has(b.country.toLowerCase()) &&
      (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"))
    );
    const nonZero = weeklyRows.filter(r => r.green_low > 0 && r.green_high > 0);
    const gLow  = nonZero.length ? Math.min(...nonZero.map(r => r.green_low))  : 0;
    const gHigh = nonZero.length ? Math.max(...nonZero.map(r => r.green_high)) : 0;
    if (gLow > 0 && gHigh > 0) {
      running = Math.min(gHigh, Math.max(gLow, running));
    }

    // Apply manual price adjustment AFTER green band clamp
    // This intentionally overrides the band — the user has explicitly chosen this price
    running += manualDelta;

    // P7 — commitment discount. Applied LAST so the waterfall's NET1 bar
    // lines up with the post-commitment price shown in the new P7 bar.
    // The pricing engine treats commitment as a pre-NET1 reduction (it
    // brings the weekly price DOWN when the client commits to a longer
    // engagement), not as a post-NET1 gross markup like the other
    // discounts. This matches the "Additional commitment discount" line
    // in the commercial-proposal table.
    const commitmentRow = caseDiscounts.find(d => d.id === "commitment");
    if (commitmentRow?.enabled && commitmentRow.pct > 0) {
      running = running * (1 - commitmentRow.pct / 100);
    }

    return Math.round(running);
  }, [recommendation, manualDelta, form.region, benchmarks, disabledBars, caseDiscounts]);

  // Gross weekly = Net × (1+admin) / ∏(1 - NON-COMMITMENT discounts).
  // Commitment discount is INTENTIONALLY excluded here — it lives as a P7
  // reduction bar between P6 and NET1 (pre-NET1), not as a post-NET1 markup.
  // This matches the commercial-proposal table: Gross per week is the SAME
  // across all three timeline options; only the commitment % (applied on
  // top of other discounts to reach Net) differs per option.
  const canonicalGrossWeekly = useMemo(() => {
    let g = canonicalNetWeekly * (1 + adminFeePct / 100);
    for (const d of caseDiscounts.filter(d => d.enabled && d.pct > 0 && d.id !== "commitment")) {
      g /= (1 - d.pct / 100);
    }
    return Math.round(g);
  }, [canonicalNetWeekly, adminFeePct, caseDiscounts]);

  // GROSSV weekly = GROSS1 × (1 + variable%) — same formula as the waterfall's
  // GROSSV bar. Used by the anchor-panel to back-solve NET1 when user edits GROSSV.
  const canonicalGrossVWeekly = useMemo(() => {
    return variableFeePct > 0
      ? Math.round(canonicalGrossWeekly * (1 + variableFeePct / 100))
      : canonicalGrossWeekly;
  }, [canonicalGrossWeekly, variableFeePct]);

  // Active cases (no outcome yet) — distinct from resolved (won/lost)
  // ones that now appear inline in the All Projects tab.
  const activeCases = cases.filter((c: any) => !c.outcome || (c.outcome !== "won" && c.outcome !== "lost"));

  /** Strip the trailing revision letter (e.g. "RUB07A" → "RUB07"). */
  const wonDisplayName = (c: any): string => {
    const full = displayProjectName(c.project_name, c.revision_letter);
    return full.replace(/[A-Z]$/, "");
  };

  // Stats for list view
  const avgTarget = activeCases.length
    ? activeCases.filter((c: any) => c.recommendation?.target_weekly).reduce((s: number, c: any) => s + (c.recommendation?.target_weekly ?? 0), 0)
      / activeCases.filter((c: any) => c.recommendation?.target_weekly).length || 0
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
          <div className="flex gap-2 flex-wrap">
            <Button onClick={openNewForm} disabled={loading}>
              <Plus className="w-4 h-4 mr-2" /> New Pricing Case
            </Button>
          {mainTab === "history" ? (
            <>
              <Button variant="outline" onClick={runSmartPopulate} disabled={proposals.length === 0}
                title="Copy region / fund / revenue / EBITDA across all projects of the same client">
                <Users className="w-4 h-4 mr-2" /> Smart Populate
              </Button>
              <Button variant="outline" onClick={runWeeklyRecalc} disabled={proposals.length === 0}
                title="Recalculate weekly price = total fee / weeks / team size">
                <RefreshCw className="w-4 h-4 mr-2" /> Recalc Weekly
              </Button>
              <Button variant="outline" onClick={downloadProposalsExcel} disabled={proposals.length === 0}>
                <Download className="w-4 h-4 mr-2" /> Download Excel
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
            </>
          ) : null}
          </div>
        </div>

        {/* Load-failure banner — surfaces transient fetch errors instead of
            silently showing 0 rows. Previously a single failed fetch (e.g. a
            Render deploy 502 blip) would leave Cases/Proposals stuck at the
            initial [] state with no indication. */}
        {Object.keys(loadErrors).length > 0 && (
          <div className="border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800 rounded-lg p-3 flex items-center gap-3 text-sm">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <div className="flex-1 text-red-800 dark:text-red-300">
              <strong>Some pricing data failed to load:</strong>{" "}
              {Object.entries(loadErrors).map(([k, v]) => `${k} (${v})`).join(" • ")}.
              {" "}Previously loaded data is preserved. Click Retry to try again.
            </div>
            <Button size="sm" variant="outline" onClick={() => { _invalidatePricingCache(); loadAll({ force: true }); }}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
            </Button>
          </div>
        )}

        {/* Tab navigation */}
        <div className="flex gap-1 border-b">
          {([
            { id: "cases" as const,   label: "Pricing Cases", icon: DollarSign, count: activeCases.length },
            { id: "history" as const, label: "All Projects",  icon: History,    count: proposals.length },
            { id: "winloss" as const, label: "Win-Loss",      icon: TrendingUp, count: proposals.filter(p => p.outcome === "won" || p.outcome === "lost").length },
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

        {/* Refresh button — below the tab bar */}
        <div className="flex justify-end pt-1.5 pb-0.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { _invalidatePricingCache(); loadAll({ force: true }); }}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground text-xs h-7"
            title="Force-reload all data from the database"
          >
            <RefreshCw className={`w-3 h-3 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Loading…" : "Refresh"}
          </Button>
        </div>

        {mainTab === "cases" ? (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "Total Cases",           value: activeCases.length, icon: Users },
                { label: "With Recommendations",  value: activeCases.filter((c: any) => c.recommendation).length, icon: TrendingUp },
                { label: "Avg Target / Week",     value: avgTarget > 0 ? fmt(avgTarget) : "—", icon: DollarSign },
                // "Proposals" = finalized cases still TBD (Final, no won/lost outcome yet).
                { label: "Proposals (TBD)",       value: activeCases.filter((c: any) => c.status === "final").length, icon: TrendingDown },
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

            {/* Canonical-fields backfill — populates canonical_net_weekly +
                canonical_gross_weekly + admin_fee_pct on cases that pre-date
                the field (saved before commit 159a840). After running this
                the Target/wk column reads accurate figures for every row,
                not just cases re-saved manually. Idempotent — already-
                migrated cases are skipped. */}
            {canonicalBackfillCount > 0 && (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
                <div className="text-xs">
                  <span className="font-semibold text-blue-900">Backfill Target/wk</span>
                  <span className="text-blue-700 ml-2">
                    {canonicalBackfillCount} case{canonicalBackfillCount === 1 ? "" : "s"} need migration to the new canonical formula. Existing values get re-derived from the saved engine recommendation.
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={backfillCanonicalForCases}
                  disabled={backfillingCanonical}
                  variant="default"
                >
                  {backfillingCanonical ? "Backfilling…" : `Backfill ${canonicalBackfillCount}`}
                </Button>
              </div>
            )}

            {/* Cases table */}
            {loading ? (
              <div className="text-center py-12 text-muted-foreground">Loading...</div>
            ) : activeCases.length === 0 ? (
              <Card className="py-16">
                <CardContent className="flex flex-col items-center gap-4">
                  <DollarSign className="w-12 h-12 text-muted-foreground/30" />
                  <div className="text-center">
                    <p className="font-semibold text-lg">No active pricing cases</p>
                    <p className="text-sm text-muted-foreground">Create a new case, or check the Won/Lost Pricings tab for resolved deals</p>
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
                      <TableHead>Total fees</TableHead>
                      <TableHead className="w-14 text-center">Band</TableHead>
                      <TableHead className="w-16 text-center">Prob %</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeCases.map(c => {
                      // Target/wk = the option that matches THIS case's
                      // duration_weeks. The user's mental model is "what's
                      // the per-week rate I'm actually quoting on this case"
                      // — which is the option whose weeks equals the case
                      // duration. e.g. COE03A is a 5-week case with timelines
                      // [12w, 5w, 20w]; the 5w timeline is the headline.
                      // Falls back to:
                      //   - 3-option mode without a duration match: tl[1]
                      //     (Option 2, the middle commitment timeline)
                      //   - 1-option mode without a duration match: tl[0]
                      //   - no timelines: canonical_net_weekly / target_weekly
                      // Reconstruct grossWk from canonical_gross_weekly when
                      // available (post handleSave migration), else from
                      // target_weekly + saved admin / discounts (legacy).
                      const tl = ((c as any).case_timelines ?? []) as Array<{ weeks: number; commitPct?: number; grossTotal?: number; commitAmount?: number; netTotal?: number }>;
                      const useThreeOptions = ((c as any).proposal_options_count ?? 3) === 3;
                      const matchByDuration = c.duration_weeks
                        ? tl.find(t => t.weeks === c.duration_weeks)
                        : null;
                      const targetTl = matchByDuration
                        ?? (useThreeOptions ? (tl[1] ?? tl[0]) : tl[0]);
                      // ── NET1 / Target/wk derivation, audited ──────────
                      // Definition: NET1 = the per-week NET price the client
                      // sees on the matching-duration option of the proposal.
                      //
                      // Three branches, in order:
                      //
                      //   (1) User pinned an explicit Net override on the
                      //       matching timeline (case_timelines[i].netTotal):
                      //       → return netTotal / weeks. This is the contract
                      //         number, period.
                      //
                      //   (2) User pinned a Gross override (no Net override):
                      //       → run computeOptionColumn(targetTl, grossWk, …)
                      //         which applies the discount stack and commit.
                      //         grossWk doesn't matter here because grossTotal
                      //         override wins inside computeOptionColumn.
                      //
                      //   (3) No overrides → return canonical_net_weekly
                      //       (a.k.a. target_weekly = NET1 from the engine).
                      //       We do NOT roundtrip through grossWk × discounts:
                      //       that path leaves admin baked in (inflating the
                      //       result by ≈ 1+admin) because computeOptionColumn
                      //       doesn't strip admin downstream.
                      const _canonical = c.recommendation?.canonical_net_weekly;
                      // ── _fromOption (placeholder, computed AFTER _liveCanonical) ──
                      // We need the engine's canonical grossWk to detect
                      // auto-pinned grossTotal overrides (the Commercial
                      // Proposal Gross input pre-fills with the computed
                      // value; users sometimes "Save" without realising
                      // they've now pinned the override). When the saved
                      // grossTotal matches the engine's computed gross
                      // within 2%, we treat it as NO override and let
                      // _liveCanonical produce the right number.
                      let _fromOption: number | null = null;
                      let _fromOptionBranch: string = "none";
                      // Live recompute of canonical_net_weekly from saved data.
                      // Mirrors PricingTool's canonicalNetWeekly useMemo so cases
                      // saved BEFORE handleSave started persisting that field
                      // still display the correct NET1 (= what the live waterfall
                      // shows). This makes the column self-healing — the user
                      // doesn't need to click "Backfill canonical fields" or
                      // re-open every case to fix display.
                      // ── LIVE canonical recompute (definitive source) ────
                      // Mirrors the case editor's canonicalNetWeekly useMemo
                      // EXACTLY for P1-P6 + band clamp + manual_delta.
                      // Difference: NO COMMIT. The list shows the headline
                      // pre-commit NET1 (what the proposal quotes as the
                      // recommended weekly fee). Commit is a per-option
                      // adjustment that lives in the Commercial Proposal
                      // table, not in the cases-list summary.
                      //
                      // Why live FIRST (ahead of stored canonical):
                      // a stored canonical_net_weekly persisted at an old
                      // save can be stale (different benchmarks, different
                      // commit rule, old engine version). The live recompute
                      // uses CURRENT benchmarks + saved layer_trace and is
                      // therefore the trustworthy figure to display today.
                      const _liveCanonical = (() => {
                        const rec = c.recommendation;
                        if (!rec) return null;
                        const trace = Array.isArray(rec.layer_trace) ? rec.layer_trace : [];
                        const base = rec.base_weekly ?? rec.target_weekly ?? 0;
                        if (!base) return null;
                        const KEYS = ["Geography", "Sector", "Ownership", "Client Size", "Client Profile", "Strategic Intent"];
                        const traceByKey: Record<string, { value: number }> = {};
                        for (const lt of trace) {
                          const key = ((lt.label ?? "") as string).replace(/\s*\(.*?\)\s*$/, "").trim();
                          if (key) traceByKey[key] = lt;
                        }
                        const deltas: Record<string, number> = {};
                        let prevOrig = base;
                        for (const k of KEYS) {
                          const lt = traceByKey[k];
                          if (lt) { deltas[k] = lt.value - prevOrig; prevOrig = lt.value; }
                          else deltas[k] = 0;
                        }
                        let running = base;
                        for (const k of KEYS) {
                          const d = deltas[k] ?? 0;
                          if (Math.abs(d) >= 1) running += d;
                        }
                        // Clamp to green band (merge corridors across all
                        // countries in the region — same as canonicalNetWeekly).
                        const aliases = REGION_TO_COUNTRY[(c as any).region as string] ?? [(c as any).region as string];
                        const aliasSet = new Set(aliases.map(a => (a ?? "").toLowerCase()));
                        const weeklyRows = (benchmarks ?? []).filter((b: any) =>
                          aliasSet.has((b.country ?? "").toLowerCase()) &&
                          (((b.parameter ?? "").toLowerCase().includes("weekly")) ||
                           ((b.parameter ?? "").toLowerCase().includes("fee")))
                        );
                        const nz = weeklyRows.filter((r: any) => r.green_low > 0 && r.green_high > 0);
                        const gLow  = nz.length ? Math.min(...nz.map((r: any) => r.green_low))  : 0;
                        const gHigh = nz.length ? Math.max(...nz.map((r: any) => r.green_high)) : 0;
                        if (gLow > 0 && gHigh > 0) {
                          running = Math.min(gHigh, Math.max(gLow, running));
                        }
                        // Manual delta (user-typed override on NET1)
                        running += rec.manual_delta ?? 0;
                        // INTENTIONALLY NO COMMIT — see header comment.
                        const result = Math.round(running);
                        // Diagnostic: log when the live recompute disagrees
                        // with stored canonical so future "Target/wk wrong"
                        // bugs can be debugged from the browser console.
                        const stored = (rec as any).canonical_net_weekly;
                        if (typeof stored === "number" && Math.abs(stored - result) > 100) {
                          // eslint-disable-next-line no-console
                          console.debug(`[Target/wk] ${c.project_name}: live=${result} stored=${stored} target_weekly=${rec.target_weekly} base=${base} manual_delta=${rec.manual_delta ?? 0} band=[${gLow},${gHigh}]`);
                        }
                        return result > 0 ? result : null;
                      })();

                      // Now compute _fromOption with engine-baseline awareness.
                      // Net override (branch 1) ALWAYS wins. Gross override
                      // (branch 2) wins ONLY when the saved value differs
                      // from the engine's computed gross by > 2% — otherwise
                      // we treat it as auto-pinned (the gross input pre-fills
                      // with the engine value) and let _liveCanonical run.
                      if (targetTl) {
                        if (typeof targetTl.netTotal === "number" && targetTl.netTotal > 0 && targetTl.weeks > 0) {
                          _fromOption = targetTl.netTotal / targetTl.weeks;
                          _fromOptionBranch = "net-override";
                        } else if (typeof targetTl.grossTotal === "number" && targetTl.grossTotal > 0 && _liveCanonical) {
                          // Compute engine's reference gross_total for this
                          // option from _liveCanonical + admin + discounts.
                          // If saved gross is within 2% of engine reference,
                          // it's an auto-pin, not a deliberate override.
                          const adminPct = c.recommendation?.admin_fee_pct ?? settings?.admin_fee_pct ?? 0;
                          const discounts = (c.case_discounts ?? []) as Array<{ id: string; name: string; pct: number; enabled: boolean }>;
                          let engineGrossWk = _liveCanonical * (1 + adminPct / 100);
                          for (const d of discounts.filter((d: any) => d.enabled && d.id !== "commitment" && d.pct > 0)) {
                            engineGrossWk = engineGrossWk / (1 - d.pct / 100);
                          }
                          const engineGrossTotal = engineGrossWk * targetTl.weeks;
                          const drift = engineGrossTotal > 0 ? Math.abs(targetTl.grossTotal - engineGrossTotal) / engineGrossTotal : 1;
                          if (drift > 0.02) {
                            // Genuine override — different from what engine
                            // would derive. Honor it.
                            const col = computeOptionColumn(targetTl, 0, discounts);
                            if (col.weeks) {
                              _fromOption = col.netTotal / col.weeks;
                              _fromOptionBranch = `gross-override(drift=${(drift * 100).toFixed(1)}%)`;
                            }
                          } else {
                            _fromOptionBranch = `gross-auto-pinned(drift=${(drift * 100).toFixed(1)}%)`;
                          }
                        }
                      }

                      // ── SINGLE RULE: Target/wk = NET1, period. ────────
                      // Per-option Net/Gross overrides drive the Commercial
                      // Proposal table's per-option figures (Option 1/2/3
                      // net totals on the SOW), not the cases-list headline.
                      // The headline IS NET1 — the engine's recommended
                      // canonical net weekly. Mixing the two produced two
                      // different numbers for COE03 (31,103 from Option 2
                      // override vs 31,111 from NET1) which is exactly the
                      // inconsistency the user flagged.
                      //
                      // Resolution: live canonical recompute → stored
                      // canonical → engine target_weekly (last-resort).
                      // No option-level overrides considered.
                      const centralWk = _liveCanonical
                        ?? _canonical
                        ?? (c.recommendation?.target_weekly ?? 0);
                      // Per-case telemetry. Logs the displayed value + each
                      // candidate so future "wrong Target/wk" reports can be
                      // diagnosed from the browser console without DB access.
                      // eslint-disable-next-line no-console
                      console.debug(
                        `[Target/wk] ${c.project_name}: ${centralWk} (`
                        + `live=${_liveCanonical ?? "null"}, `
                        + `stored=${_canonical ?? "null"}, `
                        + `target_weekly=${c.recommendation?.target_weekly ?? "null"}, `
                        + `fromOption-IGNORED=${_fromOption ?? "null"}/${_fromOptionBranch})`,
                      );
                      return (
                      <TableRow key={c.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openCase(c)}>
                        <TableCell className="font-semibold font-mono">{displayProjectName(c.project_name, c.revision_letter)}</TableCell>
                        <TableCell>{c.client_name || "—"}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{c.fund_name || "—"}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs">{c.region}</Badge></TableCell>
                        <TableCell>{c.duration_weeks}w</TableCell>
                        <TableCell className="font-semibold text-emerald-600">
                          {centralWk > 0 ? fmt(centralWk) : "—"}
                        </TableCell>
                        <TableCell className="font-semibold text-emerald-600">
                          {centralWk > 0 && c.duration_weeks ? fmt(Math.round(centralWk * c.duration_weeks)) : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {(() => {
                            const price = centralWk;
                            if (!price) return <span className="text-muted-foreground text-xs">—</span>;
                            const band = getBandForPrice(price, c.region, benchmarks);
                            if (!band) return <span className="text-muted-foreground text-xs">—</span>;
                            const cfg = band === "green"
                              ? { cls: "bg-emerald-500", label: `Pricing corridor (${fmt(price)}/wk)` }
                              : band === "yellow"
                              ? { cls: "bg-amber-400", label: `Yellow band (${fmt(price)}/wk)` }
                              : { cls: "bg-red-500", label: `Red band (${fmt(price)}/wk)` };
                            return <span className={`inline-block w-3 h-3 rounded-full ${cfg.cls}`} title={cfg.label} />;
                          })()}
                        </TableCell>
                        {/* Inline-editable win probability */}
                        <TableCell className="text-center" onClick={e => e.stopPropagation()}>
                          {editingProbId === c.id ? (
                            <input
                              type="number" min="0" max="100" step="5"
                              autoFocus
                              className="w-14 h-6 text-xs font-mono text-center border rounded bg-background"
                              value={probDraft}
                              onChange={e => setProbDraft(e.target.value)}
                              onBlur={() => void saveProb(c.id)}
                              onKeyDown={e => {
                                if (e.key === "Enter")  { e.preventDefault(); void saveProb(c.id); }
                                if (e.key === "Escape") { e.preventDefault(); setEditingProbId(null); }
                              }}
                            />
                          ) : (
                            <button
                              className="text-xs font-mono text-center w-full hover:bg-muted rounded px-1 py-0.5"
                              title="Click to edit win probability"
                              onClick={() => {
                                setEditingProbId(c.id);
                                setProbDraft((c as any).win_probability != null ? String((c as any).win_probability) : "");
                              }}
                            >
                              {(c as any).win_probability != null
                                ? <span className="text-foreground">{(c as any).win_probability}%</span>
                                : <span className="text-muted-foreground/40">—</span>}
                            </button>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={c.status === "final" ? "default" : "secondary"} className="text-xs capitalize">
                            {c.status === "final" ? "TBD" : c.status}
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
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}
          </>
        ) : mainTab === "history" ? (
          /* ── ALL PROJECTS TAB (was "Past Projects") ─────────────────── */
          <div className="space-y-4">
            {/* Backfill TBD from cases — creates a "pending" proposal
                row for every saved pricing case that doesn't have one
                yet. Use this once after a batch import or when a save
                missed the auto-create flow. */}
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
              <div className="text-xs">
                <span className="font-semibold text-amber-900">Sync TBD with Final cases</span>
                <span className="text-amber-700 ml-2">
                  {tbdBackfillCount > 0
                    ? `${tbdBackfillCount} change${tbdBackfillCount === 1 ? "" : "s"} pending — adds TBD for missing Finals, removes TBD for non-Finals`
                    : "Past Projects matches the Final cases — nothing to sync."}
                </span>
              </div>
              <Button
                size="sm"
                onClick={backfillTbdFromCases}
                disabled={backfillingTbd || tbdBackfillCount === 0}
              >
                {backfillingTbd ? "Syncing…" : `Sync ${tbdBackfillCount || ""}`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const r = await fetch("/api/pricing/proposals/normalize-names", { method: "POST", credentials: "include" });
                    const d = await r.json();
                    toast({ title: `Names normalized`, description: d.count > 0 ? d.renamed.join(", ") : "All names already consistent." });
                    if (d.count > 0) { _invalidatePricingCache(); await loadAll({ force: true }); }
                  } catch { toast({ title: "Normalize failed", variant: "destructive" }); }
                }}
              >
                Normalize names
              </Button>
            </div>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
              {(() => {
                const won = proposals.filter(p => p.outcome === "won");
                const lost = proposals.filter(p => p.outcome === "lost");
                const avgWon = won.length ? won.reduce((s, p) => s + proposalNet1(p), 0) / won.length : 0;
                const avgLost = lost.length ? lost.reduce((s, p) => s + proposalNet1(p), 0) / lost.length : 0;
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
                        {sortHeader("total_fee", "Total fee (k€)")}
                        {sortHeader("outcome", "Outcome")}
                        {sortHeader("end_date", "End date")}
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
                              {/* Team picker — opens the dialog with manager
                                  + associates dropdowns. Visual states:
                                  - destructive (red) + AlertTriangle when
                                    proposal is "open" (pending + future
                                    end_date) AND no manager assigned.
                                    Required only for open engagements.
                                  - secondary (filled) when a manager is set
                                    — shows "<First> +N" pill.
                                  - outline ("Pick team") otherwise.
                                  team_size still drives the engine elsewhere
                                  but is now derived from the picker count
                                  on save (1 + associate count). */}
                              {(() => {
                                const today = new Date().toISOString().slice(0, 10);
                                const isOpen = p.outcome === "pending" && !!p.end_date && p.end_date > today;
                                const assoc = (p.team_members ?? []).filter(m => m.name && m.name.trim());
                                const mgr = (p.manager_name ?? "").trim();
                                const missing = isOpen && !mgr;
                                return (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant={missing ? "destructive" : (mgr ? "secondary" : "outline")}
                                    className="h-7 text-[10px] px-2 max-w-[160px] truncate"
                                    onClick={() => {
                                      setTeamEditFor(p);
                                      setTeamDraftManager(mgr);
                                      setTeamDraftAssociates(assoc.length > 0
                                        ? assoc.map(m => ({ role: m.role || "Associate", name: m.name }))
                                        : []);
                                    }}
                                    title={missing
                                      ? "Open engagement — manager assignment required. Click to pick team."
                                      : mgr
                                        ? `Manager: ${mgr}${assoc.length > 0 ? ` + ${assoc.length} associate${assoc.length === 1 ? "" : "s"}` : ""}`
                                        : "Click to pick the engagement team"}
                                  >
                                    {missing && <AlertTriangle className="w-3 h-3 mr-1 shrink-0" />}
                                    <span className="truncate">
                                      {mgr
                                        ? `${mgr.split(" ")[0]}${assoc.length > 0 ? ` +${assoc.length}` : ""}`
                                        : "Pick team"}
                                    </span>
                                  </Button>
                                );
                              })()}
                            </TableCell>
                            <TableCell className="text-xs font-semibold text-muted-foreground">{p.currency || "EUR"}</TableCell>
                            <TableCell className="font-semibold text-sm font-mono">
                              {/* Net/wk = NET1 from the linked pricing case.
                                  Falls back to weekly_price only when no
                                  matching case exists (e.g. legacy rows). */}
                              {fmt(proposalNet1(p))}
                            </TableCell>
                            <TableCell className="font-semibold text-sm font-mono text-right">
                              {proposalNet1Total(p) > 0
                                ? `${Math.round(proposalNet1Total(p) / 1000).toLocaleString("it-IT")}`
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <OutcomeBadge outcome={p.outcome} end_date={p.end_date} />
                            </TableCell>
                            {/* Inline End Date — quick edit without opening
                                the row's full form. Saved via patchProposalInline.
                                When set + future + outcome=won → row appears
                                in Exec → Ongoing Projects + drives the
                                /exec/staffing Gantt block end. */}
                            <TableCell onClick={e => e.stopPropagation()}>
                              <Input
                                type="date"
                                value={p.end_date ?? ""}
                                onChange={e => patchProposalInline(p.id!, { end_date: e.target.value || null })}
                                className="h-7 text-xs px-1 w-32"
                              />
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
                              <TableCell colSpan={14} className="p-4 border-t-2 border-primary/30">
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

          </div>
        ) : null}

        {/* ── WIN-LOSS ANALYSIS TAB ──────────────────────────────── */}
        {mainTab === "winloss" && (
          <div className="space-y-6">

            {/* ── Duplicate proposals banner ─────────────────────────────── */}
            {duplicateGroups.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 px-4 py-3 space-y-3">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm font-semibold">
                    {duplicateGroups.length} duplicate group{duplicateGroups.length > 1 ? "s" : ""} detected — same client, project code, and fee
                  </span>
                </div>
                <div className="space-y-2">
                  {duplicateGroups.map((group, gi) => {
                    // Sort ascending by id; keep[0] is the oldest — offer to delete the rest
                    const sorted = [...group].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
                    const keep = sorted[0];
                    const toDelete = sorted.slice(1);
                    return (
                      <div key={gi} className="rounded-md bg-amber-100 dark:bg-amber-900/30 px-3 py-2 text-xs space-y-1">
                        <div className="font-medium text-amber-900 dark:text-amber-300">
                          {keep.client_name || keep.project_name} · {keep.project_name} · {Math.round(keep.total_fee ?? keep.weekly_price * (keep.duration_weeks ?? 0)).toLocaleString("it-IT")} €
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          <span className="text-amber-700 dark:text-amber-400">
                            Keep #{keep.id} ({keep.proposal_date}), delete:
                          </span>
                          {toDelete.map(p => (
                            <button
                              key={p.id}
                              onClick={() => deleteDuplicate(p.id!)}
                              className="inline-flex items-center gap-1 rounded px-2 py-0.5 bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/40 dark:text-red-400 dark:hover:bg-red-900/60 font-medium transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                              #{p.id} ({p.proposal_date})
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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
                  <CardTitle className="text-sm font-semibold">Pricing Corridors by Country</CardTitle>
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
                        return wp.length > 0 ? (wp.reduce((s, p) => s + proposalNet1(p), 0) / wp.length) * 1.1 : 0;
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

                    // Italy green zone for weekly fee — used as base for market benchmark bars
                    const italyWeekly = benchmarks.find(b =>
                      b.country === "Italy" && (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"))
                    );
                    const italyGreenLow = italyWeekly?.green_low ?? 0;
                    const italyGreenHigh = italyWeekly?.green_high ?? 0;

                    // Compute market benchmark for a region: Italy green × region multiplier
                    const getMarketBenchmark = (regionKey: string): { low: number; high: number; mult: number } | null => {
                      if (!italyGreenLow || !italyGreenHigh) return null;
                      // Try direct match on admin region name, then reverse-map through REGION_TO_COUNTRY
                      let adminRegion = (settings?.regions ?? []).find(r => r.region_name === regionKey);
                      if (!adminRegion) {
                        // Map region display names to codes: "DACH" → "DE", "Nordics" → "NL", etc.
                        const codeMap: Record<string, string> = { Italy: "IT", France: "FR", DACH: "DE", Nordics: "NL", UK: "UK", US: "US", "Middle East": "Middle East", Asia: "Asia" };
                        const code = codeMap[regionKey] ?? regionKey;
                        adminRegion = (settings?.regions ?? []).find(r => r.region_name === code);
                      }
                      const mult = adminRegion?.multiplier ?? 1;
                      return {
                        low: Math.round(italyGreenLow * mult),
                        high: Math.round(italyGreenHigh * mult),
                        mult,
                      };
                    };

                    return (
                      <div className="space-y-6">
                        {/* Scale legend */}
                        <div className="flex gap-6 text-xs text-muted-foreground">
                          <span>Weekly scale: 0 – {fB(weeklyScale)}</span>
                          <span>Total scale: 0 – {fB(totalScale)}</span>
                          <span className="ml-auto flex gap-4">
                            <span><span className="inline-block w-3 h-2 bg-amber-300/70 rounded-sm mr-1" />Yellow</span>
                            <span><span className="inline-block w-3 h-2 bg-emerald-400/80 rounded-sm mr-1" />Pricing corridor</span>
                            <span><span className="inline-block w-3 h-2 bg-blue-400/60 rounded-sm mr-1" />Mkt (IT×mult)</span>
                          </span>
                        </div>
                        {countries.map(country => {
                          const rows = benchmarksByRegion(country);
                          const wonProposals = wonForCountry(country);
                          const avgWonWeekly = wonProposals.length > 0
                            ? wonProposals.reduce((s, p) => s + proposalNet1(p), 0) / wonProposals.length
                            : null;
                          const mktBench = getMarketBenchmark(country);
                          return (
                            <div key={country}>
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-sm font-bold uppercase tracking-wide">{country}</span>
                                {wonProposals.length > 0 && (
                                  <span className="text-xs text-emerald-600 font-medium">
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
                              <div className="grid grid-cols-[1fr,1fr] gap-4 items-start">
                                {/* Left: editable corridor table */}
                                {(() => {
                                  // Find the actual benchmark rows for this region so we can update them
                                  const regionCountryNames = benchmarkCountries.filter(c => countryToReg(c) === country);

                                  // Task 12: single source of truth.
                                  //
                                  // A region (e.g. DACH = DE+AT+CH) used to have one DB row per
                                  // country, each with its own corridor. The stepper applied the
                                  // delta per-row, so over time rows drifted and the merged view
                                  // (min/max) no longer matched the number the user had just dialled
                                  // in. The "Win-Loss Distribution" panel below also used `.find()`
                                  // which returned only the first country row, so DACH showed 31.5/33
                                  // there and 31/36 in this table — same region, two numbers.
                                  //
                                  // Fix: compute the current merged value (what the user actually
                                  // sees in this row), apply the delta once, then write that
                                  // identical value to every country row in the region. After any
                                  // edit the region is guaranteed to be self-consistent and every
                                  // other view — distribution panel, pricing cases clamp — reads the
                                  // same number.
                                  const updateCorridorValue = (param: string, field: "green_low" | "green_high" | "yellow_low" | "yellow_high", delta: number) => {
                                    const regionRows = benchmarks.filter(b =>
                                      regionCountryNames.includes(b.country) && b.parameter === param
                                    );
                                    // Merged current value: same rule as the Pricing Corridors
                                    // display — min for lows, max for highs. If no rows, start at 0.
                                    const isLow = field === "green_low" || field === "yellow_low";
                                    const nonZero = regionRows.filter(r => (r[field] || 0) > 0);
                                    const currentMerged = nonZero.length === 0
                                      ? 0
                                      : (isLow
                                          ? Math.min(...nonZero.map(r => r[field] || 0))
                                          : Math.max(...nonZero.map(r => r[field] || 0)));
                                    const newVal = Math.max(0, currentMerged + delta);

                                    let updated = benchmarks.map(b => {
                                      const matches = regionCountryNames.includes(b.country) && b.parameter === param;
                                      return matches ? { ...b, [field]: newVal } : b;
                                    });
                                    // If no matching row exists yet, create one for the canonical
                                    // country so the stepper has something to persist against.
                                    if (!updated.some(b => regionCountryNames.includes(b.country) && b.parameter === param)) {
                                      const cName = regionCountryNames[0] ?? country;
                                      updated = [...updated, {
                                        country: cName, parameter: param,
                                        yellow_low: 0, green_low: 0, green_high: 0, yellow_high: 0,
                                        decisiveness_pct: 25, [field]: newVal,
                                      }];
                                    }
                                    setBenchmarks(updated);
                                    setBenchmarksLocal(updated);
                                    saveBenchmarks(updated, { silent: true });
                                  };

                                  const StepperCell = ({ value, onChange, highlight }: { value: number; onChange: (delta: number) => void; highlight?: boolean }) => (
                                    <div className="flex items-center justify-center gap-0.5">
                                      <button onClick={() => onChange(-500)}
                                        className="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center hover:bg-muted border border-transparent hover:border-border">−</button>
                                      <span className={`w-14 text-center font-mono text-xs ${highlight ? "font-bold text-emerald-700" : "text-foreground"}`}>
                                        {value > 0 ? fB(value) : "—"}
                                      </span>
                                      <button onClick={() => onChange(500)}
                                        className="w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center hover:bg-muted border border-transparent hover:border-border">+</button>
                                    </div>
                                  );

                                  return (
                                    <table className="text-xs w-full border rounded overflow-hidden">
                                      <thead>
                                        <tr className="bg-muted/30 border-b">
                                          <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground">Param</th>
                                          <th className="text-center px-1 py-1.5 font-semibold text-amber-600 text-[10px]">Yellow low</th>
                                          <th className="text-center px-1 py-1.5 font-semibold text-emerald-700 text-[10px]">Corridor low</th>
                                          <th className="text-center px-1 py-1.5 font-semibold text-emerald-700 text-[10px]">Corridor high</th>
                                          <th className="text-center px-1 py-1.5 font-semibold text-amber-600 text-[10px]">Yellow high</th>
                                          <th className="text-center px-2 py-1.5 font-semibold text-muted-foreground text-[10px]">Decisive</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {rows.map((row, i) => {
                                          const isWeekly = row.parameter.toLowerCase().includes("weekly") || row.parameter.toLowerCase().includes("fee");
                                          // Find the actual raw parameter name to match against benchmarks
                                          const rawParam = benchmarks.find(b =>
                                            regionCountryNames.includes(b.country) &&
                                            (b.parameter.toLowerCase().includes("weekly") === isWeekly || b.parameter === row.parameter)
                                          )?.parameter ?? row.parameter;

                                          return (
                                            <tr key={i} className={`border-b last:border-0 ${isWeekly ? "bg-emerald-50/30" : ""}`}>
                                              <td className={`px-2 py-1 font-medium ${isWeekly ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                                                {row.parameter.replace("Total project cost", "Total").replace("Weekly fee", "Weekly")}
                                              </td>
                                              <td className="px-0 py-0.5">
                                                <StepperCell value={row.yellow_low} onChange={d => updateCorridorValue(rawParam, "yellow_low", d)} />
                                              </td>
                                              <td className="px-0 py-0.5">
                                                <StepperCell value={row.green_low} onChange={d => updateCorridorValue(rawParam, "green_low", d)} highlight={isWeekly} />
                                              </td>
                                              <td className="px-0 py-0.5">
                                                <StepperCell value={row.green_high} onChange={d => updateCorridorValue(rawParam, "green_high", d)} highlight={isWeekly} />
                                              </td>
                                              <td className="px-0 py-0.5">
                                                <StepperCell value={row.yellow_high} onChange={d => updateCorridorValue(rawParam, "yellow_high", d)} />
                                              </td>
                                              <td className="px-2 py-1 text-center font-semibold text-muted-foreground">{row.decisiveness_pct}%</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  );
                                })()}
                                {/* Right: visual band bars (shared scale) */}
                                <div className="space-y-2 pt-1">
                                  {/* Market benchmark bar (Italy green × country multiplier) — weekly only */}
                                  {mktBench && mktBench.low > 0 && (() => {
                                    const scale = weeklyScale;
                                    const pctM = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100)).toFixed(2)}%`;
                                    return (
                                      <div className="space-y-0.5">
                                        <div className="text-[10px] text-blue-600 font-semibold">
                                          Mkt benchmark (IT ×{mktBench.mult.toFixed(2)})
                                        </div>
                                        <div className="relative h-7 rounded overflow-hidden bg-blue-50 border border-blue-200/50">
                                          <div className="absolute inset-y-0 bg-blue-400/50"
                                            style={{ left: pctM(mktBench.low), width: `${Math.max(0, (mktBench.high - mktBench.low) / scale * 100).toFixed(2)}%` }} />
                                          <span className="absolute text-xs font-bold text-blue-800 leading-none px-1.5"
                                            style={{ left: `calc(${pctM(mktBench.low)} + 2px)`, top: 4 }}>
                                            {fB(mktBench.low)}–{fB(mktBench.high)}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                  {rows.map((row, i) => {
                                    const scale = getScale(row);
                                    const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100)).toFixed(2)}%`;
                                    const noData = row.yellow_high === 0;
                                    const isWeekly = row.parameter.toLowerCase().includes("weekly") || row.parameter.toLowerCase().includes("fee");
                                    const synthLow = noData && avgWonWeekly && isWeekly ? avgWonWeekly * 0.9 : null;
                                    const synthHigh = noData && avgWonWeekly && isWeekly ? avgWonWeekly * 1.1 : null;

                                    // Weekly = prominent thick bar; Total = thin line markers
                                    if (!isWeekly) {
                                      // ── TOTAL: thin line representation ──
                                      return (
                                        <div key={i} className="space-y-0.5">
                                          <div className="text-[10px] text-muted-foreground/60">{row.parameter.replace("Total project cost", "Total").replace("Weekly fee", "Weekly")}</div>
                                          {noData ? (
                                            <div className="h-3 flex items-center">
                                              <span className="text-[10px] text-muted-foreground/40 italic">No data</span>
                                            </div>
                                          ) : (
                                            <div className="relative h-3 rounded-full overflow-hidden bg-muted/20">
                                              {/* Thin colored line segments */}
                                              <div className="absolute top-1 bottom-1 bg-amber-300/50 rounded-full" style={{ left: pct(row.yellow_low), width: `${Math.max(0, (row.green_low - row.yellow_low) / scale * 100).toFixed(2)}%` }} />
                                              <div className="absolute top-0.5 bottom-0.5 bg-emerald-400/70 rounded-full" style={{ left: pct(row.green_low), width: `${Math.max(0, (row.green_high - row.green_low) / scale * 100).toFixed(2)}%` }} />
                                              <div className="absolute top-1 bottom-1 bg-amber-300/50 rounded-full" style={{ left: pct(row.green_high), width: `${Math.max(0, (row.yellow_high - row.green_high) / scale * 100).toFixed(2)}%` }} />
                                              <div className="absolute top-1 bottom-1 bg-red-300/40 rounded-full" style={{ left: pct(row.yellow_high), right: 0 }} />
                                            </div>
                                          )}
                                          {!noData && (
                                            <div className="text-[9px] text-muted-foreground/50 font-mono">{fB(row.green_low)}–{fB(row.green_high)}</div>
                                          )}
                                        </div>
                                      );
                                    }

                                    // ── WEEKLY: prominent thick bar ──
                                    return (
                                      <div key={i} className="space-y-0.5">
                                        <div className="text-xs font-semibold text-foreground">{row.parameter.replace("Total project cost", "Total").replace("Weekly fee", "Weekly")}</div>
                                        {noData && !synthLow ? (
                                          <div className="h-6 rounded bg-muted/30 flex items-center px-2">
                                            <span className="text-xs text-muted-foreground italic">No data</span>
                                          </div>
                                        ) : (
                                          <div className="relative h-12 rounded-lg overflow-hidden bg-white border border-border/50">
                                            {noData && synthLow && synthHigh ? (
                                              <>
                                                <div className="absolute inset-y-0 bg-emerald-400/70"
                                                  style={{ left: pct(synthLow), width: `${Math.max(0, (synthHigh - synthLow) / scale * 100).toFixed(2)}%` }} />
                                                <span className="absolute text-sm font-bold text-emerald-800 leading-none px-1.5"
                                                  style={{ left: pct(synthLow), top: 4 }}>
                                                  {fB(synthLow)}–{fB(synthHigh)}
                                                </span>
                                                <div className="absolute bottom-1 text-[10px] text-emerald-700 italic w-full text-center leading-none">
                                                  estimated ±10%
                                                </div>
                                              </>
                                            ) : (
                                              <>
                                                <div className="absolute inset-y-0 bg-amber-300/70" style={{ left: pct(row.yellow_low), width: `${Math.max(0, (row.green_low - row.yellow_low) / scale * 100).toFixed(2)}%` }} />
                                                <div className="absolute inset-y-0 bg-emerald-400/80" style={{ left: pct(row.green_low), width: `${Math.max(0, (row.green_high - row.green_low) / scale * 100).toFixed(2)}%` }} />
                                                <div className="absolute inset-y-0 bg-amber-300/70" style={{ left: pct(row.green_high), width: `${Math.max(0, (row.yellow_high - row.green_high) / scale * 100).toFixed(2)}%` }} />
                                                <div className="absolute inset-y-0 bg-red-400/50" style={{ left: pct(row.yellow_high), right: 0 }} />
                                                <span className="absolute text-sm font-bold text-emerald-900 leading-none pointer-events-none px-1.5"
                                                  style={{ left: `calc(${pct(row.green_low)} + 2px)`, top: 4 }}>
                                                  {fB(row.green_low)}–{fB(row.green_high)}
                                                </span>
                                              </>
                                            )}
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
                        <div className="grid grid-cols-[300px,1fr] gap-4">
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
                {editingBenchmarks && (() => {
                  // Region options for the country dropdown — use REGION_TO_COUNTRY keys
                  // plus any countries already in benchmarks that don't map to a known region
                  const regionOptions = Object.keys(REGION_TO_COUNTRY);
                  const existingCountries = [...new Set(benchmarksLocal.map(b => b.country))];
                  const allOptions = [...new Set([...regionOptions, ...existingCountries])].sort();

                  return (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Edit thresholds directly (in €). Use region names from Country Benchmarks.</p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Region</TableHead>
                          <TableHead>Parameter</TableHead>
                          <TableHead className="text-center">🟡 Yel low</TableHead>
                          <TableHead className="text-center">Corridor low</TableHead>
                          <TableHead className="text-center">Corridor high</TableHead>
                          <TableHead className="text-center">🟡 Yel high</TableHead>
                          <TableHead className="text-center">Decis %</TableHead>
                          <TableHead className="w-8" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {benchmarksLocal.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              <Select value={row.country || "__none__"} onValueChange={v => updateBenchmarkLocal(i, "country", v === "__none__" ? "" : v)}>
                                <SelectTrigger className="h-7 text-xs w-32"><SelectValue placeholder="Region" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">— Select —</SelectItem>
                                  {allOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select value={row.parameter || "__none__"} onValueChange={v => updateBenchmarkLocal(i, "parameter", v === "__none__" ? "" : v)}>
                                <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Weekly fee">Weekly fee</SelectItem>
                                  <SelectItem value="Total project cost">Total project cost</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
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
                  );
                })()}

                {/* ── Paste import — at bottom ────────────────────────── */}
                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs font-semibold text-muted-foreground">Paste win-loss analysis text to import</p>
                  <Textarea
                    value={pasteInput}
                    onChange={e => { setPasteInput(e.target.value); setPasteResult(null); }}
                    placeholder={
                      "Pipe format:\nItaly | Weekly fee | €28k–34k | €25k–28k / €34k–38k | <€25k / >€38k | 25%\n\nFree-form format:\nItaly\nWeekly fee: green €28k–34k, yellow €25k–28k / €34k–38k, 25% decisiveness"
                    }
                    className="text-xs font-mono resize-none"
                    rows={4}
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
                        const prices = cps.map(p => proposalNet1(p));
                        const minP = Math.min(...prices);
                        const maxP = Math.max(...prices);
                        const sym = getCurrencyForRegion(cps[0].region).symbol;
                        const fmtK2 = (n: number) => `${sym}${Math.round(n / 1000)}k`;
                        const fmtFull = (n: number) => `${sym}${Math.round(n).toLocaleString("it-IT")}`;

                        // Task 12: use the same merged-region band as the Pricing
                        // Corridors by Country table above, not `.find()` (which
                        // returned only the first country row and caused DACH to
                        // show 31.5/33 here while the corridor table showed 31/36).
                        const countryAliases = REGION_TO_COUNTRY[country] ?? [country];
                        const aliasSet = new Set(countryAliases.map(a => a.toLowerCase()));
                        const benchRows = benchmarks.filter(b =>
                          aliasSet.has(b.country.toLowerCase()) &&
                          (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"))
                        );
                        const benchNonZero = benchRows.filter(r => r.green_low > 0 && r.green_high > 0);
                        const benchGreenLow  = benchNonZero.length ? Math.min(...benchNonZero.map(r => r.green_low))  : 0;
                        const benchGreenHigh = benchNonZero.length ? Math.max(...benchNonZero.map(r => r.green_high)) : 0;
                        const hasBench = benchGreenLow > 0 && benchGreenHigh > 0;

                        // Extend scale to include benchmark band
                        const allVals = [...prices, ...(hasBench ? [benchGreenLow, benchGreenHigh] : [])];
                        const range = (Math.max(...allVals) - Math.min(...allVals)) || Math.max(Math.max(...allVals), 1);
                        const pad = range * 0.12;
                        const sMin = Math.max(0, Math.min(...allVals) - pad);
                        const sMax = Math.max(...allVals) + pad;
                        const sRange = sMax - sMin || 1;
                        const avgWon = won.length ? won.reduce((s, p) => s + proposalNet1(p), 0) / won.length : null;
                        const avgLost = lost.length ? lost.reduce((s, p) => s + proposalNet1(p), 0) / lost.length : null;

                        const W = 320, H = 100;
                        const padL = 6, padR = 6, padT = 18, padB = 18;
                        const plotW = W - padL - padR;
                        const xAt = (v: number) => Math.max(padL, Math.min(W - padR, padL + ((v - sMin) / sRange) * plotW));

                        // Task 12: Save this region's green band as the single
                        // source of truth. Every country row in the region gets
                        // the same [newLow, newHigh] so the merged view (used
                        // everywhere — corridor table, pricing cases clamp,
                        // this chart) is guaranteed to match what the user just
                        // typed. Yellow band is preserved (previously this handler
                        // collapsed yellow = green and destroyed the outer band).
                        const saveBenchBand = (newLow: number, newHigh: number) => {
                          let updated = benchmarks.map(b => {
                            const matches = aliasSet.has(b.country.toLowerCase()) &&
                              (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"));
                            return matches ? { ...b, green_low: newLow, green_high: newHigh } : b;
                          });
                          // If no row exists for this region yet, create one.
                          if (benchRows.length === 0) {
                            updated = [...updated, {
                              country: countryAliases[0] ?? country,
                              parameter: "Weekly fee",
                              yellow_low: newLow, green_low: newLow,
                              green_high: newHigh, yellow_high: newHigh,
                              decisiveness_pct: 25,
                            }];
                          }
                          setBenchmarks(updated);
                          setBenchmarksLocal(updated);
                          saveBenchmarks(updated);
                        };

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

                              {/* Benchmark green band */}
                              {hasBench && (
                                <>
                                  <rect
                                    x={xAt(benchGreenLow)} y={padT}
                                    width={Math.max(2, xAt(benchGreenHigh) - xAt(benchGreenLow))}
                                    height={H - padT - padB}
                                    fill="#22c55e" opacity="0.15" />
                                  <line x1={xAt(benchGreenLow)} y1={padT} x2={xAt(benchGreenLow)} y2={H - padB}
                                    stroke="#16a34a" strokeWidth="0.8" strokeDasharray="3,2" opacity="0.7" />
                                  <line x1={xAt(benchGreenHigh)} y1={padT} x2={xAt(benchGreenHigh)} y2={H - padB}
                                    stroke="#16a34a" strokeWidth="0.8" strokeDasharray="3,2" opacity="0.7" />
                                  {/* Min/max labels above green band */}
                                  <text x={xAt(benchGreenLow)} y={padT - 4} fontSize="6.5" fill="#16a34a" textAnchor="middle" fontWeight="bold">{fmtK2(benchGreenLow)}</text>
                                  <text x={xAt(benchGreenHigh)} y={padT - 4} fontSize="6.5" fill="#16a34a" textAnchor="middle" fontWeight="bold">{fmtK2(benchGreenHigh)}</text>
                                </>
                              )}

                              {/* Avg won/lost markers */}
                              {avgWon != null && (
                                <line x1={xAt(avgWon)} y1={padT} x2={xAt(avgWon)} y2={H - padB}
                                  stroke="#10b981" strokeWidth="1.2" strokeDasharray="2,2" />
                              )}
                              {avgLost != null && (
                                <line x1={xAt(avgLost)} y1={padT} x2={xAt(avgLost)} y2={H - padB}
                                  stroke="#ef4444" strokeWidth="1.2" strokeDasharray="2,2" />
                              )}
                              {/* Won dots — x position = NET1 */}
                              {won.map((p, i) => (
                                <circle key={`w${i}`} cx={xAt(proposalNet1(p))}
                                  cy={padT + 12 + (i % 3) * 10} r="3.5"
                                  fill="#10b981" opacity="0.85" stroke="#065f46" strokeWidth="0.4"
                                  style={{ cursor: "pointer" }}
                                  onMouseEnter={e => setBubbleTip({ p, outcome: "won", x: e.clientX, y: e.clientY })}
                                  onMouseMove={e => setBubbleTip(t => t ? { ...t, x: e.clientX, y: e.clientY } : t)}
                                  onMouseLeave={() => setBubbleTip(null)}
                                />
                              ))}
                              {/* Lost dots — x position = NET1 */}
                              {lost.map((p, i) => (
                                <circle key={`l${i}`} cx={xAt(proposalNet1(p))}
                                  cy={padT + 45 + (i % 3) * 10} r="3.5"
                                  fill="#ef4444" opacity="0.85" stroke="#7f1d1d" strokeWidth="0.4"
                                  style={{ cursor: "pointer" }}
                                  onMouseEnter={e => setBubbleTip({ p, outcome: "lost", x: e.clientX, y: e.clientY })}
                                  onMouseMove={e => setBubbleTip(t => t ? { ...t, x: e.clientX, y: e.clientY } : t)}
                                  onMouseLeave={() => setBubbleTip(null)}
                                />
                              ))}
                              {/* Scale labels */}
                              <text x={padL} y={H - 4} fontSize="7" fill="#94a3b8">{fmtK2(sMin)}</text>
                              <text x={W - padR} y={H - 4} fontSize="7" fill="#94a3b8" textAnchor="end">{fmtK2(sMax)}</text>
                              <text x={W / 2} y={H - 4} fontSize="7" fill="#94a3b8" textAnchor="middle">{fmtK2((sMin + sMax) / 2)}</text>
                            </svg>

                            {/* Avg won/lost row */}
                            <div className="flex items-center justify-between text-[9px] mt-0.5 mb-1.5">
                              <span className="text-emerald-700 font-mono">
                                {avgWon != null ? `avg won ${fmtK2(avgWon)}` : "—"}
                              </span>
                              <span className="text-red-600 font-mono">
                                {avgLost != null ? `avg lost ${fmtK2(avgLost)}` : "—"}
                              </span>
                            </div>

                            {/* Editable green band */}
                            <div className="flex items-center gap-1.5 border-t pt-1.5">
                              <div className="w-2 h-2 rounded-sm bg-emerald-400/60 shrink-0" />
                              <span className="text-[9px] text-muted-foreground shrink-0">Pricing corridor:</span>
                              <input
                                type="number" step="500" min="0"
                                defaultValue={benchGreenLow || ""}
                                placeholder="min"
                                key={`${country}-low-${benchGreenLow}`}
                                onBlur={e => {
                                  const newLow = parseInt(e.target.value) || 0;
                                  if (newLow !== benchGreenLow) saveBenchBand(newLow, benchGreenHigh || newLow);
                                }}
                                onKeyDown={e => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                                className="w-16 h-5 text-[9px] text-center font-mono border rounded bg-emerald-50 border-emerald-200 focus:outline-none focus:border-emerald-500"
                              />
                              <span className="text-[9px] text-muted-foreground">–</span>
                              <input
                                type="number" step="500" min="0"
                                defaultValue={benchGreenHigh || ""}
                                placeholder="max"
                                key={`${country}-high-${benchGreenHigh}`}
                                onBlur={e => {
                                  const newHigh = parseInt(e.target.value) || 0;
                                  if (newHigh !== benchGreenHigh) saveBenchBand(benchGreenLow || newHigh, newHigh);
                                }}
                                onKeyDown={e => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                                className="w-16 h-5 text-[9px] text-center font-mono border rounded bg-emerald-50 border-emerald-200 focus:outline-none focus:border-emerald-500"
                              />
                              <span className="text-[9px] text-muted-foreground italic ml-0.5">↵ to save</span>
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
                        <div className="w-3 h-2 bg-emerald-200/80 rounded-sm border border-emerald-300" /> Pricing corridor (editable)
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

            {/* ── Project Fees Bar Chart (ranked, coloured by region) ── */}
            {(() => {
              // Use every proposal with a positive total_fee, won or lost,
              // except rows explicitly excluded from analysis.
              const rows = proposals
                .filter(p => !isExcluded(p) && proposalNet1Total(p) > 0)
                .map(p => ({
                  id: p.id!,
                  name: p.project_name || p.client_name || `#${p.id}`,
                  client: p.client_name || "",
                  outcome: p.outcome,
                  region: proposalRegionKey(p),
                  country: p.country || "",
                  feeK: Math.round(proposalNet1Total(p) / 1000),
                }))
                .sort((a, b) => b.feeK - a.feeK);

              if (rows.length === 0) {
                return (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold uppercase tracking-wide">Project Fees by Region</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-muted-foreground text-center py-6">
                        No projects with a total fee recorded yet — import or add a few to see the ranking.
                      </p>
                    </CardContent>
                  </Card>
                );
              }

              // Region palette. Unknown regions fall back to slate.
              const REGION_COLOR: Record<string, string> = {
                "IT":          "#ef4444", // red
                "FR":          "#3b82f6", // blue
                "DACH":        "#f59e0b", // amber
                "Nordics":     "#06b6d4", // cyan
                "UK":          "#8b5cf6", // violet
                "US":          "#10b981", // emerald
                "Middle East": "#ec4899", // pink
                "Asia":        "#eab308", // yellow
                "Other EU":    "#14b8a6", // teal
              };
              const regionColor = (r: string) => REGION_COLOR[r] ?? "#64748b";

              const maxFee = rows[0].feeK;
              const avgFee = Math.round(rows.reduce((s, r) => s + r.feeK, 0) / rows.length);
              const medianFee = (() => {
                const sorted = [...rows].map(r => r.feeK).sort((a, b) => a - b);
                const m = Math.floor(sorted.length / 2);
                return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
              })();

              // Distinct regions present, sorted by frequency (biggest bucket first)
              const regionCounts = new Map<string, number>();
              rows.forEach(r => regionCounts.set(r.region, (regionCounts.get(r.region) ?? 0) + 1));
              const legendRegions = [...regionCounts.entries()].sort((a, b) => b[1] - a[1]);

              return (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-sm font-semibold uppercase tracking-wide">Project Fees by Region</CardTitle>
                        <p className="text-[10px] text-muted-foreground italic mt-1">
                          All past projects ranked by total fee (k€) · bar = outcome (green = won, red = lost) · dot = region · {rows.length} project{rows.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      {/* Legend */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 justify-end max-w-[55%]">
                        {legendRegions.map(([region, count]) => (
                          <div key={region} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: regionColor(region) }} />
                            <span className="font-medium">{region}</span>
                            <span className="opacity-60">({count})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {/* Bars.
                        Visual encoding (per user request):
                          · Bar color  → outcome: green (won) / red (lost)
                          · Left dot   → region color (so you can still scan
                                          by geography without losing the
                                          win/loss signal on the bar itself)
                        Projects that aren't marked won/lost yet use slate. */}
                    <div className="space-y-1 max-h-[520px] overflow-y-auto pr-2">
                      {rows.map(r => {
                        const pct = maxFee > 0 ? (r.feeK / maxFee) * 100 : 0;
                        const regColor = regionColor(r.region);
                        const outcomeColor =
                          r.outcome === "won"  ? "#10b981" : // emerald-500
                          r.outcome === "lost" ? "#ef4444" : // red-500
                                                  "#64748b"; // slate-500 (unknown)
                        return (
                          <div
                            key={r.id}
                            className="flex items-center gap-2 text-[11px] group"
                            title={`${r.name} · ${r.client} · ${r.region} · ${r.feeK.toLocaleString("it-IT")} k€ · ${r.outcome ?? "pending"}`}
                          >
                            {/* Region dot — small circle at the very left, colour = region */}
                            <div
                              className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                              style={{ backgroundColor: regColor }}
                              title={`Region: ${r.region}`}
                            />
                            {/* Name */}
                            <div className="w-36 truncate text-muted-foreground group-hover:text-foreground" title={r.name}>
                              {r.name}
                            </div>
                            {/* Bar — colour now reflects win (green) / loss (red) */}
                            <div className="flex-1 h-5 bg-muted/20 rounded-sm relative overflow-hidden">
                              <div
                                className="h-full rounded-sm transition-all"
                                style={{
                                  width: `${Math.max(pct, 0.5)}%`,
                                  backgroundColor: outcomeColor,
                                }}
                              />
                              {/* Region + outcome label on the LEFT of the bar */}
                              <div className="absolute left-0 inset-y-0 flex items-center pl-2 text-[9px] font-semibold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
                                {r.region}
                                <span className="ml-1 opacity-90">
                                  · {r.outcome === "won" ? "won" : r.outcome === "lost" ? "lost" : "pending"}
                                </span>
                              </div>
                              {/* Fee figure on the RIGHT EDGE of the filled
                                  portion of the bar. drop-shadow keeps it
                                  legible regardless of bar/background colour
                                  combination — works on green, red, slate,
                                  light, and dark themes. */}
                              <div
                                className="absolute inset-y-0 flex items-center text-[10px] font-mono font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)] tabular-nums whitespace-nowrap"
                                style={{
                                  left: `${Math.min(Math.max(pct, 6), 100) - 0.5}%`,
                                  transform: "translateX(-100%)",
                                  paddingRight: "6px",
                                }}
                              >
                                {r.feeK.toLocaleString("it-IT")} k€
                              </div>
                            </div>
                            {/* Value (kept outside the bar too, for narrow rows) */}
                            <div className="w-20 text-right font-mono font-semibold tabular-nums">
                              {r.feeK.toLocaleString("it-IT")}<span className="text-muted-foreground font-normal"> k€</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Legend: outcome colours (the dot colours are already
                        shown in the region legend in the header). */}
                    <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: "#10b981" }} /> Won
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: "#ef4444" }} /> Lost
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: "#64748b" }} /> Pending
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full border border-black/10" style={{ backgroundColor: "#64748b" }} /> Region dot
                      </div>
                    </div>

                    {/* Summary footer */}
                    <div className="mt-4 pt-3 border-t flex flex-wrap items-center gap-6 text-xs">
                      <div>
                        <span className="text-muted-foreground uppercase tracking-wide text-[10px] font-semibold">Average</span>
                        <div className="font-bold text-base font-mono">{avgFee.toLocaleString("it-IT")} <span className="text-xs text-muted-foreground font-normal">k€</span></div>
                      </div>
                      <div>
                        <span className="text-muted-foreground uppercase tracking-wide text-[10px] font-semibold">Median</span>
                        <div className="font-bold text-base font-mono">{medianFee.toLocaleString("it-IT")} <span className="text-xs text-muted-foreground font-normal">k€</span></div>
                      </div>
                      <div>
                        <span className="text-muted-foreground uppercase tracking-wide text-[10px] font-semibold">Largest</span>
                        <div className="font-bold text-base font-mono">{maxFee.toLocaleString("it-IT")} <span className="text-xs text-muted-foreground font-normal">k€</span></div>
                      </div>
                      <div>
                        <span className="text-muted-foreground uppercase tracking-wide text-[10px] font-semibold">Projects</span>
                        <div className="font-bold text-base">{rows.length}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

          </div>
        )}

      {/* Bubble tooltip — fixed to viewport, follows mouse */}
      {bubbleTip && (() => {
        const p = bubbleTip.p;
        const dateStr = p.proposal_date ?? "";
        const [yyyy, mm] = dateStr.split("-");
        const dateFmt = mm && yyyy ? `${mm}/${yyyy.slice(2)}` : dateStr;
        const sym = getCurrencyForRegion(p.region).symbol;
        const total = proposalNet1Total(p);
        const wk = proposalNet1(p);
        const weeks = p.duration_weeks ?? 0;
        return (
          <div
            style={{ position: "fixed", left: bubbleTip.x + 14, top: bubbleTip.y - 56, pointerEvents: "none", zIndex: 9999 }}
            className="bg-popover border border-border rounded-lg shadow-xl px-3 py-2 text-xs min-w-[140px]"
          >
            <div className="font-semibold text-foreground">{p.project_name}</div>
            <div className="text-muted-foreground mt-0.5">{dateFmt}</div>
            <div className="font-mono text-foreground mt-1">
              {sym}{Math.round(total).toLocaleString("it-IT")}
              {weeks > 0 && <span className="text-muted-foreground text-[10px] ml-1">({weeks}w × {sym}{Math.round(wk / 1000)}k)</span>}
            </div>
            <div className={`mt-1 text-[10px] font-medium ${bubbleTip.outcome === "won" ? "text-emerald-600" : "text-red-500"}`}>
              {bubbleTip.outcome === "won" ? "Won" : "Lost"}
            </div>
          </div>
        );
      })()}

      </div>
    );
  }

  // ── FORM VIEW ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Form header — FIXED so it never scrolls away regardless of the
          overflow-x-hidden context on <main>. Sits at top-16 (64px = nav
          height) so it appears flush below the global nav bar. A spacer
          div below reserves the same height so form content starts below. */}
      <div className="fixed top-16 inset-x-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-full mx-auto px-6 md:px-10 py-2">
        <div className="flex items-center gap-3">
          <button onClick={() => setView("list")}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">{form.id ? "Edit Pricing Case" : "New Pricing Case"}</h1>
            <p className="text-sm text-muted-foreground">Fill in the details — pricing recommendation updates live</p>
          </div>
          {/* Save buttons duplicated here so they're always reachable without scrolling */}
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => handleSave("draft")} disabled={saving}>
              Save draft
            </Button>
            <Button size="sm" onClick={() => handleSave("final")} disabled={saving}>
              {saving ? "Saving…" : "Save & Finalise"}
            </Button>
          </div>
        </div>
        </div>
      </div>
      {/* Spacer — same height as the fixed header so content starts below it */}
      <div className="h-14" />

      <div className="space-y-5">

        {/* ── ROW 1: Project Info (left) + Deal Context (right) ─────────── */}
        <div className="grid lg:grid-cols-2 gap-4 items-start">

          {/* SECTION A: Project Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Project Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {/* Client name — first */}
                <div className="space-y-0.5">
                  <Label className="text-[11px]">Client Company <span className="text-destructive">*</span></Label>
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
                {/* Project sequence + revision letter.
                    Revision letter lets the team track multiple proposal
                    iterations with the same client (EMV01A is the first
                    proposal, EMV01B the second revision, etc). Defaults
                    to A on new cases. */}
                <div className="space-y-1">
                  <Label className="text-xs">Project Sequence + Revision <span className="text-destructive">*</span></Label>
                  {(() => {
                    const pfx = clientPrefix(form.client_name);
                    const seqOptions = Array.from({ length: 9 }, (_, i) => `${pfx}${String(i + 1).padStart(2, "0")}`);
                    const currentSeq = seqOptions.includes(form.project_name) ? form.project_name : seqOptions[0];
                    const currentRev = (form.revision_letter || "A").toUpperCase();
                    return (
                      <div className="flex gap-1">
                        <Select value={currentSeq} onValueChange={v => setForm(f => ({ ...f, project_name: v }))}>
                          <SelectTrigger className="h-8 text-xs font-mono flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {seqOptions.map(s => <SelectItem key={s} value={s} className="font-mono">{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Select value={currentRev} onValueChange={v => setForm(f => ({ ...f, revision_letter: v }))}>
                          <SelectTrigger className="h-8 text-xs font-mono w-16" title="Proposal revision (A = first, B = second, etc.)"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["A", "B", "C", "D"].map(r => <SelectItem key={r} value={r} className="font-mono">{r}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })()}
                </div>
                {/* PE Owner — default CARLYLE */}
                <div className="space-y-1">
                  <Label className="text-xs">PE Owner <span className="text-primary/60 font-mono text-[9px]">P3</span></Label>
                  <Select value={form.fund_name || "__none__"} onValueChange={v => {
                    const isPE = v !== "__none__";
                    const fundDef = isPE ? (settings?.fund_defaults ?? []).find(fd => fd.fund_name === v) : null;
                    setForm(f => ({
                      ...f,
                      fund_name: isPE ? v : "",
                      pe_owned: isPE,
                      ...(fundDef?.relationship_type ? { relationship_type: fundDef.relationship_type } : {}),
                      ...(fundDef?.strategic_intent ? { strategic_intent: fundDef.strategic_intent } : {}),
                      ...(fundDef?.competitive_intensity ? { competitive_intensity: fundDef.competitive_intensity } : {}),
                      ...(fundDef?.price_sensitivity ? { price_sensitivity: fundDef.price_sensitivity } : {}),
                    }));
                  }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select PE owner…" /></SelectTrigger>
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
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(TEAM_PRESETS).map(([k, p]) => (
                        <SelectItem key={k} value={k}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Region <span className="text-primary/60 font-mono text-[9px]">P1</span> <span className="text-destructive">*</span></Label>
                  <Select value={form.region} onValueChange={v => setForm(f => ({ ...f, region: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(settings?.regions ?? DEFAULT_PRICING_SETTINGS.regions).map(r => (
                        <SelectItem key={r.region_name} value={r.region_name}>
                          {r.region_name}{!r.is_baseline ? ` (×${r.multiplier.toFixed(2)})` : " (base)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Currency</Label>
                  <Select value={form.currency ?? "EUR"} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EUR">EUR €</SelectItem>
                      <SelectItem value="USD">USD $</SelectItem>
                      <SelectItem value="GBP">GBP £</SelectItem>
                      <SelectItem value="CHF">CHF Fr.</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Company Revenue → auto-fills Revenue Band */}
                <div className="space-y-1">
                  <Label className="text-xs">Company Revenue (€M)</Label>
                  <Input type="number" min="0" step="10" placeholder="e.g. 500" className="h-8 text-xs"
                    value={form.company_revenue_m ?? ""}
                    onChange={e => {
                      const val = e.target.value === "" ? null : parseFloat(e.target.value);
                      setForm(f => {
                        const updated = { ...f, company_revenue_m: val };
                        // Auto-fill revenue band from revenue
                        if (val != null && val > 0) {
                          if (val >= 1000) updated.revenue_band = "above_1b";
                          else if (val >= 200) updated.revenue_band = "200m_1b";
                          else if (val >= 100) updated.revenue_band = "100m_200m";
                          else updated.revenue_band = "below_100m";
                        }
                        return updated;
                      });
                    }} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Revenue Band <span className="text-primary/60 font-mono text-[9px]">P4</span></Label>
                  <Select value={form.revenue_band} onValueChange={v => setForm(f => ({ ...f, revenue_band: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REVENUE_BANDS.map(rb => <SelectItem key={rb.value} value={rb.value}>{rb.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Price Sensitivity <span className="text-primary/60 font-mono text-[9px]">P5</span></Label>
                  <Select value={form.price_sensitivity} onValueChange={v => setForm(f => ({ ...f, price_sensitivity: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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
                <div className="space-y-1">
                  <Label className="text-xs">Win Probability (%)</Label>
                  <Input
                    type="number" min="0" max="100" step="5"
                    value={form.win_probability ?? ""}
                    onChange={e => setForm(f => ({ ...f, win_probability: e.target.value === "" ? null : Math.max(0, Math.min(100, +e.target.value)) }))}
                    className="font-mono"
                    placeholder="e.g. 60"
                  />
                  <div className="text-[9px] text-muted-foreground">Your estimate — drives HR 24-week staffing forecast.</div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Expected Start Date</Label>
                  <Input
                    type="date"
                    value={form.start_date ?? ""}
                    onChange={e => setForm(f => ({ ...f, start_date: e.target.value || null }))}
                  />
                  <div className="text-[9px] text-muted-foreground">When delivery begins — used for staffing forecast.</div>
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
              <CardTitle className="text-sm">Deal Context &amp; Value Drivers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {/* Project type */}
                <div className="space-y-1">
                  <Label className="text-xs">Project Type <span className="text-muted-foreground/50 font-normal">(L0)</span></Label>
                  <Select value={form.project_type ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, project_type: v === "__none__" ? null : v as ProjectType }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not set —</SelectItem>
                      {projectTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {/* Sector */}
                <div className="space-y-1">
                  <Label className="text-xs">Sector <span className="text-primary/60 font-mono text-[9px]">P2</span></Label>
                  <Select value={form.sector ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, sector: v === "__none__" ? null : v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
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
                {/* EBITDA computed display (revenue input moved to top) */}
                {form.company_revenue_m && form.ebitda_margin_pct ? (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Computed EBITDA</Label>
                    <div className="text-sm font-semibold text-emerald-700">€{(form.company_revenue_m * form.ebitda_margin_pct / 100).toFixed(1)}M</div>
                  </div>
                ) : null}
                {/* Incremental aspiration EBITDA (% increase) */}
                <div className="space-y-1">
                  <Label className="text-xs">Aspiration EBITDA increase (%)</Label>
                  <Input type="number" min="0" max="200" step="1"
                    placeholder="e.g. 10"
                    value={form.aspiration_ebitda_pct ?? ""}
                    onChange={e => setForm(f => ({ ...f, aspiration_ebitda_pct: e.target.value === "" ? null : parseFloat(e.target.value) }))} />
                  <div className="text-[9px] text-muted-foreground">% increase in EBITDA targeted by the project. Used in TNF/Aspiration ratio below.</div>
                </div>
                {/* Strategic intent — labels from settings */}
                <div className="space-y-1">
                  <Label className="text-xs">Strategic Intent <span className="text-primary/60 font-mono text-[9px]">P6</span></Label>
                  <Select value={form.strategic_intent ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, strategic_intent: v === "__none__" ? null : v as StrategicIntent }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not set —</SelectItem>
                      {(settings?.strategic_intent_adj ?? DEFAULT_PRICING_SETTINGS.strategic_intent_adj ?? []).map(a => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}{a.adj_pct !== 0 ? ` (${a.adj_pct > 0 ? "+" : ""}${a.adj_pct}%)` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Competitive intensity — labels from settings */}
                <div className="space-y-1">
                  <Label className="text-xs">Competitive Intensity</Label>
                  <Select value={form.competitive_intensity ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, competitive_intensity: v === "__none__" ? null : v as CompetitiveIntensity }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not set —</SelectItem>
                      {(settings?.competitive_intensity_adj ?? DEFAULT_PRICING_SETTINGS.competitive_intensity_adj ?? []).map(a => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}{a.adj_pct !== 0 ? ` (${a.adj_pct > 0 ? "+" : ""}${a.adj_pct}%)` : ""}
                        </SelectItem>
                      ))}
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
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not set —</SelectItem>
                        <SelectItem value="new">First-time client</SelectItem>
                        <SelectItem value="repeat">Repeat client</SelectItem>
                        <SelectItem value="strategic">Strategic account</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Geographic scope */}
                  <div className="space-y-1">
                    <Label className="text-xs">Geographic Scope</Label>
                    <Select value={form.geographic_scope ?? "__none__"} onValueChange={v => setForm(f => ({ ...f, geographic_scope: v === "__none__" ? null : v }))}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
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
                </div>
              </div>
            </CardContent>
          </Card>

        </div>{/* end row 1 grid */}

          {/* ── Staffing Build-up (full width) ─────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Staffing Build-up</CardTitle>
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
                  <div className="grid grid-cols-[110px_1fr_1fr_80px_110px] gap-2 px-2 pb-1">
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
                        className={`grid grid-cols-[110px_1fr_1fr_80px_110px] gap-2 items-center rounded-lg px-2 py-2 transition-colors ${
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
                      if (count <= 0) return acc;
                      const days = line?.days_per_week ?? def.defaultDays;
                      const weekly = count * days * role.default_daily_rate;
                      return { people: acc.people + count, days: acc.days + count * days, weekly: acc.weekly + weekly };
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

          {/* ── PROJECT SPECS (full width, single line) ────────────────────── */}
          {recommendation && (
            <div className="border rounded-lg p-3 bg-muted/10">
              <div className="flex items-center gap-4 flex-wrap">
                {/* Duration */}
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Duration</Label>
                  <Select
                    value={String(waterfallDuration ?? form.duration_weeks)}
                    onValueChange={v => {
                      if (v === "other") {
                        setDurationPanel("");
                      } else {
                        setDurationPanel(null);
                        setWaterfallDuration(Number(v));
                        setForm(f => ({ ...f, duration_weeks: Number(v) }));
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[6, 8, 12, 16, 24].map(w => <SelectItem key={w} value={String(w)}>{w} weeks</SelectItem>)}
                      <SelectItem value="other">Other…</SelectItem>
                    </SelectContent>
                  </Select>
                  {durationPanel !== null && (
                    <div className="flex items-center gap-1 mt-1">
                      <Input
                        autoFocus
                        type="number"
                        min={1}
                        placeholder="weeks"
                        value={durationPanel}
                        onChange={e => setDurationPanel(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setDurationPanel(null);
                        }}
                        onBlur={() => {
                          const w = parseInt(durationPanel, 10);
                          if (w > 0) {
                            setWaterfallDuration(w);
                            setForm(f => ({ ...f, duration_weeks: w }));
                          }
                          setDurationPanel(null);
                        }}
                        className="h-7 text-sm w-20 font-mono"
                      />
                      <span className="text-xs text-muted-foreground">wks</span>
                    </div>
                  )}
                </div>
                {/* Price adjustment ±500 */}
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Price adj. ±500</Label>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setManualDelta(d => d - 500)} className="w-7 h-7 rounded border text-sm font-bold flex items-center justify-center hover:bg-muted shrink-0">−</button>
                    <span className={`text-sm font-mono font-bold w-20 text-center shrink-0 ${manualDelta > 0 ? "text-emerald-600" : manualDelta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                      {manualDelta === 0 ? "±€0" : `${manualDelta > 0 ? "+" : ""}€${Math.abs(manualDelta).toLocaleString("it-IT")}`}
                    </span>
                    <button onClick={() => setManualDelta(d => d + 500)} className="w-7 h-7 rounded border text-sm font-bold flex items-center justify-center hover:bg-muted shrink-0">+</button>
                    {manualDelta !== 0 && <button onClick={() => setManualDelta(0)} className="text-[9px] text-muted-foreground hover:text-foreground underline ml-1 shrink-0">reset</button>}
                  </div>
                </div>
                {/* Variable fee — free input (0-100%, .1 step) so the
                    back-solve from an edited GROSSV figure can land on any
                    percent, not just the old {0,10,20,30,40,50} preset. */}
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Variable fee</Label>
                  <div className="relative">
                    <Input
                      type="number" min="0" max="100" step="0.1"
                      value={variableFeePct}
                      onChange={e => {
                        const n = parseFloat(e.target.value);
                        setVariableFeePct(Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);
                      }}
                      className="h-8 text-sm pr-6"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
                  </div>
                </div>
                {/* Admin fees */}
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Admin fees</Label>
                  <Select value={String(adminFeePct)} onValueChange={v => setAdminFeePct(Number(v))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[0, 2, 4, 6, 8].map(p => <SelectItem key={p} value={String(p)}>{p}%</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {/* Discounts inline */}
                {caseDiscounts.length > 0 && (
                  <div className="flex items-center gap-2 border-l pl-4 ml-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground shrink-0">Disc:</span>
                    {caseDiscounts.map(d => {
                      // Commitment discount (P7) uses a constrained 1-10%
                      // dropdown per spec — all other discounts keep the
                      // free-form number input they've always had.
                      const isCommitment = d.id === "commitment";
                      return (
                        <label key={d.id} className="flex items-center gap-1 text-[11px] shrink-0">
                          <input type="checkbox" checked={d.enabled}
                            onChange={e => setCaseDiscounts(prev => prev.map(x => x.id === d.id ? { ...x, enabled: e.target.checked } : x))}
                            className="h-3 w-3 rounded" />
                          <span className={d.enabled ? "text-foreground" : "text-muted-foreground"}>
                            {d.name}
                            {isCommitment && <span className="text-[9px] text-muted-foreground ml-0.5">(P7)</span>}
                          </span>
                          {isCommitment ? (
                            <Select
                              value={String(d.pct)}
                              onValueChange={v => setCaseDiscounts(prev => prev.map(x =>
                                x.id === d.id ? { ...x, pct: Number(v), enabled: Number(v) > 0 || x.enabled } : x
                              ))}
                              disabled={!d.enabled}
                            >
                              <SelectTrigger className="h-5 w-14 text-[10px] px-1.5 font-mono">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(p => (
                                  <SelectItem key={p} value={String(p)} className="text-[11px]">
                                    {p}%
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <input type="number" step="0.5" min="0" max="100" value={d.pct}
                              onChange={e => setCaseDiscounts(prev => prev.map(x => x.id === d.id ? { ...x, pct: parseFloat(e.target.value) || 0 } : x))}
                              disabled={!d.enabled}
                              className="h-5 w-10 text-[10px] text-center font-mono border rounded disabled:opacity-40 bg-background" />
                          )}
                          {!isCommitment && <span className="text-[9px] text-muted-foreground">%</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION B: Pricing Waterfall Chart */}
          {recommendation && (() => {
            const trace = recommendation.layer_trace;
            // Use the engine's own base (same source the layer deltas were
            // computed from) so the visual proportions line up: a -10%
            // layer paints as 10% of the bar to its left, not 10% of some
            // other display total. baseWeeklyDisplay can diverge because
            // it uses default_daily_rate while the engine uses
            // daily_rate_used — see PricingTool.tsx:2204 comment.
            const base = recommendation.base_weekly;

            // Map trace entries by normalized label
            const traceByKey: Record<string, LayerTrace> = {};
            for (const lt of trace) {
              const key = lt.label.replace(/\s*\(.*?\)\s*$/, "").trim();
              traceByKey[key] = lt;
            }

            const CANONICAL = [
              "Geography", "Sector", "Ownership", "Client Size",
              "Client Profile", "Strategic Intent",
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

            // P7 — Commitment discount bar. ALWAYS inserted between the
            // last P6 layer and NET1 so the waterfall visually exposes the
            // slot even when no commitment discount is active (matches the
            // P1-P6 bars which also render as zero-height placeholders when
            // their driver has no impact). Red when active, grey when 0%.
            const commitmentRow = caseDiscounts.find(d => d.id === "commitment");
            const commitmentPct = (commitmentRow?.enabled && commitmentRow.pct > 0) ? commitmentRow.pct : 0;
            const reducedValue = commitmentPct > 0
              ? Math.round(runningValue * (1 - commitmentPct / 100))
              : runningValue;
            bars.push({
              label: "Commitment",
              start: runningValue,
              end: reducedValue,
              note: commitmentPct > 0
                ? `P7 commitment discount −${commitmentPct}%`
                : "P7 — commitment discount not applied (toggle 1-10% in the Discounts row above)",
              deltaPct: -commitmentPct,
              isDisabled: commitmentPct === 0,
            });
            runningValue = reducedValue;
            const adjustedFinal = runningValue;

            // Discount/rebate/one-off bars: these ADD UP after the Rec. bar to show
            // the Gross price. Each enabled discount increases the price (so the client
            // sees a higher quote, and after applying the discount lands back at Net).
            // admin fee also adds on top.
            const markupBars: { label: string; start: number; end: number; deltaPct: number }[] = [];
            // We'll compute these after recommendedNwf is known (see below).
            const extraBars: { label: string; start: number; end: number; color?: string; deltaPct: number }[] = [];

            // Green band from country benchmarks — MERGED across every country
            // in the region (e.g. DACH = DE + AT + CH). This matches the merge
            // logic in the "Pricing Corridors by Country" table (benchmarksByRegion):
            // widest band = min of green_low, max of green_high. Previously this
            // used .find() which returned only the first matching country row,
            // causing the waterfall to show a narrower corridor than the table.
            const countryAliasesW = REGION_TO_COUNTRY[form.region] ?? [form.region];
            const aliasSetW = new Set(countryAliasesW.map(a => a.toLowerCase()));
            const weeklyRowsW = benchmarks.filter(b =>
              aliasSetW.has(b.country.toLowerCase()) &&
              (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"))
            );
            const nonZeroW = weeklyRowsW.filter(r => r.green_low > 0 && r.green_high > 0);
            const greenLow  = nonZeroW.length ? Math.min(...nonZeroW.map(r => r.green_low))  : 0;
            const greenHigh = nonZeroW.length ? Math.max(...nonZeroW.map(r => r.green_high)) : 0;
            const hasGreenBand = greenLow > 0 && greenHigh > 0;

            // Net and Gross from canonical single source of truth
            const recommendedNwf = canonicalNetWeekly;
            const grossWeeklyWaterfall = canonicalGrossWeekly;

            // Duration & fee calculation for right panel
            const effectiveDuration = waterfallDuration ?? form.duration_weeks;

            // Build markup bars: admin + each enabled NON-COMMITMENT
            // discount → Gross. Commitment is rendered as a pre-NET1 P7
            // bar (see CANONICAL loop above) and intentionally excluded
            // here so it isn't double-counted.
            let markupRunning = recommendedNwf;
            const enabledDisc = caseDiscounts.filter(d => d.enabled && d.pct > 0 && d.id !== "commitment");
            if (adminFeePct > 0) {
              const newVal = Math.round(markupRunning * (1 + adminFeePct / 100));
              markupBars.push({ label: `Admin +${adminFeePct}%`, start: markupRunning, end: newVal, deltaPct: adminFeePct });
              markupRunning = newVal;
            }
            for (const d of enabledDisc) {
              const newVal = Math.round(markupRunning / (1 - d.pct / 100));
              markupBars.push({ label: `${d.name} +${d.pct}%`, start: markupRunning, end: newVal, deltaPct: d.pct });
              markupRunning = newVal;
            }
            const hasMarkups = markupBars.length > 0;

            // Y-scale — include markup bars in range
            const grossV = variableFeePct > 0 ? Math.round(grossWeeklyWaterfall * (1 + variableFeePct / 100)) : grossWeeklyWaterfall;
            const low50gm = recommendation.low_50gm_weekly ?? 0;
            const allVals = [base, adjustedFinal, ...bars.flatMap(b => [b.start, b.end]),
              recommendedNwf, grossWeeklyWaterfall, grossV,
              ...(low50gm > 0 ? [low50gm] : []),
              ...(hasGreenBand ? [greenLow, greenHigh] : [])];
            const minV = Math.min(...allVals) * 0.92;
            const maxV = Math.max(...allVals) * 1.08;
            const range = maxV - minV || 1;

            // Layout: base + layers + NET1 + markups + (GROSS1?) + (VarFee + GROSSV if variable>0 & markups)
            // Manual price adjustment (manualDelta) is folded directly INTO NET1 and overrides the band clamp.
            // It is NOT rendered as a separate bar — it becomes the new NET1 value.
            // GROSSV bar now always renders when hasMarkups (so the figure
            // stays editable even at var fee = 0). The variable-fee delta
            // bar only renders when var fee > 0 — at 0 there's nothing to
            // show. Slot count must reflect both, otherwise GROSSV's xOf()
            // exceeds the chart width and the figure renders off-screen.
            const hasGrossV = hasMarkups;
            const hasVarFeeDelta = hasMarkups && variableFeePct > 0;
            const totalBarCount = 1 + bars.length + 1 + markupBars.length
              + (hasMarkups ? 1 : 0)        // GROSS1
              + (hasGrossV ? 1 : 0)         // GROSSV (always when hasMarkups)
              + (hasVarFeeDelta ? 1 : 0);   // Var. Fee delta bar (only when > 0)
            const W = 900; const H = 260;
            const TH = 16; // toggle row height at top
            const chartBot = H - 22; const chartTop = TH + 12;
            const chartH = chartBot - chartTop;
            const barW = Math.max(20, Math.floor((W - 60) / (totalBarCount + 1) - 4));
            const gap = Math.max(3, Math.floor((W - 60 - totalBarCount * barW) / totalBarCount));
            const xOf = (i: number) => 30 + i * (barW + gap);
            const yOf = (v: number) => chartBot - ((v - minV) / range) * chartH;
            const hOf = (v1: number, v2: number) => Math.abs(yOf(v1) - yOf(v2));

            const SHORT: Record<string, string> = {
              "Geography": "P1 Geo", "Sector": "P2 Sector", "Ownership": "P3 PE/Corp",
              "Client Size": "P4 Size", "Client Profile": "P5 Sensitivity", "Strategic Intent": "P6 Intent",
              "Commitment": "P7 Commit",
            };
            const TOOLTIP: Record<string, string> = {
              "Geography": "P1 — Geography: adjusts price based on regional market rates. IT=baseline, US=+60%, UK=+20%, DACH=+10%–20%, SEA=−10%",
              "Sector": "P2 — Sector: industry-specific multiplier. Pharma/Healthcare +10%, Software/SaaS +5%, Industrial baseline",
              "Ownership": "P3 — Ownership: PE-owned = baseline (1.0×), non-PE/family-owned = typically 0.85×",
              "Client Size": "P4 — Client Size: revenue band multiplier. >€1B = baseline, €200M–€1B = 0.95×, €100M–€200M = 0.90×, <€100M = 0.80×",
              "Client Profile": "P5 — Price Sensitivity: High = −10%, Medium = baseline, Low = +10%. Reflects client's willingness to pay",
              "Strategic Intent": "P6 — Strategic Intent: adjusts for deal type. Offensive/competitive = premium, defensive/retention = discount",
              "Commitment": "P7 — Commitment discount: reduces the weekly price when the client agrees to a longer engagement. Adjust % in the Discounts bar above",
            };

            const toggleBar = (label: string) => setDisabledBars(prev => {
              const next = new Set(prev);
              next.has(label) ? next.delete(label) : next.add(label);
              return next;
            });

            return (
              <div className="border rounded-lg p-4 bg-muted/10">
                <div className="space-y-1">
                    <div className="text-xs font-bold uppercase text-muted-foreground tracking-wide">Pricing Waterfall</div>
                    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
                      {/* Pricing corridor background */}
                      {hasGreenBand && (
                        <rect x={25} y={yOf(greenHigh)} width={W - 30} height={Math.max(1, hOf(greenLow, greenHigh))}
                          fill="#22c55e" opacity="0.08" />
                      )}
                      {hasGreenBand && <>
                        <line x1={25} x2={W - 5} y1={yOf(greenHigh)} y2={yOf(greenHigh)} stroke="#22c55e" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.55" />
                        <line x1={25} x2={W - 5} y1={yOf(greenLow)} y2={yOf(greenLow)} stroke="#22c55e" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.55" />
                        <text x={W - 6} y={yOf(greenHigh) - 2} textAnchor="end" fontSize="7" fill="#16a34a" opacity="0.8">{fmt(greenHigh)}</text>
                        <text x={W - 6} y={yOf(greenLow) + 8} textAnchor="end" fontSize="7" fill="#16a34a" opacity="0.8">{fmt(greenLow)}</text>
                      </>}

                      {/* Base bar */}
                      {(() => {
                        const x = xOf(0); const y = yOf(base); const h = hOf(minV, base);
                        return <>
                          <rect x={x} y={y} width={barW} height={h} fill="#166534" rx="2" />
                          <text x={x + barW/2} y={y - 3} textAnchor="middle" fontSize="8" fill="#166534" fontWeight="bold">{fmt(base)}</text>
                          <text x={x + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="8" fill="#64748b">Staffing</text>
                        </>;
                      })()}

                      {/* Layer delta bars with toggles */}
                      {bars.map((b, i) => {
                        const x = xOf(i + 1);
                        const isZero = Math.abs(b.end - b.start) < 1;
                        const up = b.end >= b.start;
                        // Commitment (P7) is a DEDUCTION — paint it red so
                        // it stands out from the P1-P6 driver bars, which
                        // are all rendered in Eendigo green.
                        const isCommitment = b.label === "Commitment";
                        const color = b.isDisabled ? "#94a3b8"
                          : (isZero ? "#cbd5e1"
                          : (isCommitment ? "#dc2626"
                          : "#166534"));
                        const y = up ? yOf(b.end) : yOf(b.start);
                        const h = Math.max(2, hOf(b.start, b.end));
                        const deltaEur = b.end - b.start;
                        const sign = deltaEur >= 0 ? "+" : "";
                        const textY = up ? y - 9 : y + h + 8;
                        return (
                          <g key={i}>
                            {/* Toggle switch */}
                            <g style={{ cursor: "pointer" }} onClick={() => toggleBar(b.label)}>
                              <rect x={x + barW/2 - 10} y={3} width={20} height={10} rx="5"
                                fill={b.isDisabled ? "#e2e8f0" : "#166534"} />
                              <circle cx={b.isDisabled ? x + barW/2 - 5 : x + barW/2 + 5} cy={8} r={3.5}
                                fill="white" stroke={b.isDisabled ? "#cbd5e1" : "#166534"} strokeWidth="0.5" />
                            </g>
                            <line x1={xOf(i) + barW} y1={yOf(b.start)} x2={x} y2={yOf(b.start)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                            <rect x={x} y={y} width={barW} height={h} fill={color} rx="2" opacity={b.isDisabled ? 0.3 : (isZero ? 0.45 : 0.85)} style={{ cursor: "help" }}>
                              <title>{TOOLTIP[b.label] ?? b.label}{b.note ? `\n${b.note}` : ""}{!isZero ? `\nImpact: ${sign}${fmt(deltaEur)} (${sign}${b.deltaPct.toFixed(1)}%)` : ""}</title>
                            </rect>
                            <text x={x + barW/2} y={textY} textAnchor="middle" fontSize="8" fill={b.isDisabled ? "#94a3b8" : (isZero ? "#94a3b8" : color)} fontWeight="bold">
                              {b.isDisabled ? "—" : (isZero ? "—" : `${sign}${fmt(deltaEur)}`)}
                            </text>
                            {!b.isDisabled && !isZero && (
                              <text x={x + barW/2} y={textY + 8} textAnchor="middle" fontSize="7" fill="#94a3b8">
                                {sign}{b.deltaPct.toFixed(0)}%
                              </text>
                            )}
                            <text x={x + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="7" fill={b.isDisabled ? "#cbd5e1" : "#64748b"}>{SHORT[b.label] ?? b.label}</text>
                          </g>
                        );
                      })}

                      {/* NET1 bar (light green) — THE final net price.
                          Manual price adjustment (manualDelta) is folded IN here and
                          overrides the green-band clamp — NET1 can sit above or below
                          the corridor when the user has applied a manual delta. */}
                      {(() => {
                        const bi = bars.length + 1;
                        const x = xOf(bi); const y = yOf(recommendedNwf); const h = hOf(minV, recommendedNwf);
                        const prevEnd = bars[bars.length - 1]?.end ?? base;
                        const totalNet1 = recommendedNwf * effectiveDuration;
                        const adjLabelY = y - 13;
                        return <>
                          <line x1={xOf(bi - 1) + barW} y1={yOf(prevEnd)} x2={x} y2={yOf(recommendedNwf)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                          <rect x={x} y={y} width={barW} height={h} fill="#4ade80" rx="2" />
                          {manualDelta !== 0 && (
                            <text x={x + barW/2} y={adjLabelY} textAnchor="middle" fontSize="7" fill="#0ea5e9" fontWeight="bold">
                              {manualDelta > 0 ? "+" : ""}{fmt(manualDelta)} adj
                            </text>
                          )}
                          {/* NET1 — click to open the anchor-price editor below. */}
                          <text
                            x={x + barW/2} y={y - 3} textAnchor="middle"
                            fontSize="9" fill="#166534" fontWeight="bold"
                            style={{ cursor: "pointer" }}
                            onClick={() => setAnchorPanel({ field: "net1", draft: String(recommendedNwf) })}
                          >
                            {fmt(recommendedNwf)}
                          </text>
                          <text x={x + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="8.5" fill="#166534" fontWeight="700">NET1</text>
                          <text x={x + barW/2} y={chartBot + 19} textAnchor="middle" fontSize="6.5" fill="#166534">{fmt(totalNet1)}</text>
                        </>;
                      })()}

                      {/* Markup bars: admin + discounts/rebates/one-off build UP to Gross */}
                      {markupBars.map((mb, i) => {
                        const bi = bars.length + 2 + i;
                        const x = xOf(bi);
                        const y = yOf(mb.end);
                        const h = Math.max(2, hOf(mb.start, mb.end));
                        const delta = mb.end - mb.start;
                        return (
                          <g key={`markup-${i}`}>
                            <line x1={xOf(bi - 1) + barW} y1={yOf(mb.start)} x2={x} y2={yOf(mb.start)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                            <rect x={x} y={y} width={barW} height={h} fill="#166534" rx="2" opacity="0.7" />
                            <text x={x + barW/2} y={y - 9} textAnchor="middle" fontSize="8" fill="#166534" fontWeight="bold">+{fmt(delta)}</text>
                            <text x={x + barW/2} y={y - 2} textAnchor="middle" fontSize="7" fill="#94a3b8">+{mb.deltaPct}%</text>
                            <text x={x + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="7.5" fill="#64748b">{mb.label.length > 10 ? mb.label.slice(0, 10) + "…" : mb.label}</text>
                          </g>
                        );
                      })}

                      {/* GROSS1 bar (light green, only if markups exist) */}
                      {hasMarkups && (() => {
                        const bi = bars.length + 2 + markupBars.length;
                        const x = xOf(bi);
                        const y = yOf(grossWeeklyWaterfall);
                        const h = hOf(minV, grossWeeklyWaterfall);
                        const prevEnd = markupBars[markupBars.length - 1].end;
                        const totalGross1 = grossWeeklyWaterfall * effectiveDuration;
                        return <>
                          <line x1={xOf(bi - 1) + barW} y1={yOf(prevEnd)} x2={x} y2={yOf(grossWeeklyWaterfall)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                          <rect x={x} y={y} width={barW} height={h} fill="#2dd4bf" rx="2" />
                          {/* GROSS1 — click to use as anchor price; back-solves NET1 via manualDelta */}
                          <text
                            x={x + barW/2} y={y - 3} textAnchor="middle"
                            fontSize="9" fill="#0f766e" fontWeight="bold"
                            style={{ cursor: "pointer" }}
                            onClick={() => setAnchorPanel({ field: "gross1", draft: String(grossWeeklyWaterfall) })}
                          >
                            {fmt(grossWeeklyWaterfall)}
                          </text>
                          <text x={x + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="8" fill="#0f766e" fontWeight="700">GROSS1</text>
                          <text x={x + barW/2} y={chartBot + 19} textAnchor="middle" fontSize="6.5" fill="#0f766e">{fmt(totalGross1)}</text>
                        </>;
                      })()}

                      {/* Variable fee delta bar + GROSSV total bar.
                          GROSSV bar always renders when there are markups so
                          the figure stays editable even at variableFeePct=0
                          (user can type a higher number to back-solve the var
                          fee). The Var Fee delta bar only renders when var
                          fee > 0 — at 0 there's nothing to show. */}
                      {hasMarkups && (() => {
                        const grossVVal = variableFeePct > 0
                          ? Math.round(grossWeeklyWaterfall * (1 + variableFeePct / 100))
                          : grossWeeklyWaterfall;
                        const varDelta = grossVVal - grossWeeklyWaterfall;
                        const totalGrossV = grossVVal * effectiveDuration;

                        // Slot bookkeeping: GROSS1 sits at bars.length+2+markupBars.length.
                        // When var fee > 0 we render Var-Fee delta bar at +1 then
                        // GROSSV at +2. When var fee = 0 we skip the delta bar
                        // and render GROSSV at +1.
                        const grossOneSlot = bars.length + 2 + markupBars.length;
                        const bi1 = grossOneSlot + 1;                       // Var-Fee delta slot
                        const x1 = xOf(bi1);
                        const y1 = yOf(grossWeeklyWaterfall + Math.max(0, varDelta));
                        const h1 = Math.max(2, hOf(grossWeeklyWaterfall, grossWeeklyWaterfall + Math.max(0, varDelta)));

                        // GROSSV always shown when hasMarkups; sits one slot
                        // past Var-Fee delta when present, otherwise directly
                        // after GROSS1.
                        const bi2 = variableFeePct > 0 ? bi1 + 1 : bi1;
                        const x2 = xOf(bi2);
                        const y2 = yOf(grossVVal);
                        const h2 = hOf(minV, grossVVal);

                        return <>
                          {variableFeePct > 0 && (
                            <>
                              {/* Var fee delta bar */}
                              <line x1={xOf(bi1 - 1) + barW} y1={yOf(grossWeeklyWaterfall)} x2={x1} y2={yOf(grossWeeklyWaterfall)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                              <rect x={x1} y={y1} width={barW} height={h1} fill="#0891b2" rx="2" opacity="0.7" />
                              <text x={x1 + barW/2} y={y1 - 9} textAnchor="middle" fontSize="8" fill="#0e7490" fontWeight="bold">+{fmt(varDelta)}</text>
                              <text x={x1 + barW/2} y={y1 - 2} textAnchor="middle" fontSize="7" fill="#94a3b8">+{variableFeePct}%</text>
                              <text x={x1 + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="7.5" fill="#64748b">Var. Fee</text>
                            </>
                          )}

                          {/* GROSSV total bar — click to open anchor-price editor.
                              Sets GROSSV as anchor: back-solves NET1 via manualDelta
                              keeping all discount % unchanged (variable fee included). */}
                          <line x1={(variableFeePct > 0 ? x1 + barW : xOf(bi2 - 1) + barW)} y1={yOf(grossVVal)} x2={x2} y2={yOf(grossVVal)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3,2" />
                          <rect x={x2} y={y2} width={barW} height={h2} fill="#67e8f9" rx="2" />
                          <text
                            x={x2 + barW/2} y={y2 - 3} textAnchor="middle"
                            fontSize="9" fill="#0e7490" fontWeight="bold"
                            style={{ cursor: "pointer" }}
                            onClick={() => setAnchorPanel({ field: "grossv", draft: String(grossVVal) })}
                          >
                            {fmt(grossVVal)}
                          </text>
                          <text x={x2 + barW/2} y={chartBot + 10} textAnchor="middle" fontSize="8" fill="#0e7490" fontWeight="700">GROSSV</text>
                          <text x={x2 + barW/2} y={chartBot + 19} textAnchor="middle" fontSize="6.5" fill="#0e7490">{fmt(totalGrossV)}</text>
                        </>;
                      })()}

                      {/* Low 50% GM floor reference line */}
                      {recommendation.low_50gm_weekly > 0 && recommendation.low_50gm_weekly < maxV && (() => {
                        const lowY = yOf(recommendation.low_50gm_weekly);
                        return <>
                          <line x1={25} x2={W - 5} y1={lowY} y2={lowY}
                            stroke="#94a3b8" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.6" />
                          <text x={W - 6} y={lowY + 10} textAnchor="end" fontSize="7" fill="#94a3b8" opacity="0.9">
                            Low {fmt(recommendation.low_50gm_weekly)}
                          </text>
                        </>;
                      })()}

                      {/* Baseline */}
                      <line x1="25" y1={chartBot} x2={W - 5} y2={chartBot} stroke="#e2e8f0" strokeWidth="0.5" />
                    </svg>
                </div>

                {/* ── Anchor Price Editor ──────────────────────────────────
                    Opens when user clicks NET1, GROSS1 or GROSSV in the chart.
                    Typed value becomes the anchor; manualDelta back-solves so
                    all discount percentages stay unchanged. */}
                {anchorPanel && (() => {
                  const commitAnchor = () => {
                    anchorCancelledRef.current = false;
                    const v = parseInt(anchorPanel.draft.replace(/[^\d]/g, ""), 10);
                    if (Number.isFinite(v) && v > 0) {
                      const baseNet1 = canonicalNetWeekly - manualDelta;
                      if (anchorPanel.field === "net1") {
                        setManualDelta(v - baseNet1);
                      } else if (anchorPanel.field === "gross1") {
                        const mf = canonicalNetWeekly > 0 ? canonicalGrossWeekly / canonicalNetWeekly : 1;
                        if (mf > 0) setManualDelta(Math.round(v / mf) - baseNet1);
                      } else {
                        const tf = canonicalNetWeekly > 0 ? canonicalGrossVWeekly / canonicalNetWeekly : 1;
                        if (tf > 0) setManualDelta(Math.round(v / tf) - baseNet1);
                      }
                    }
                    setAnchorPanel(null);
                  };
                  const fieldLabel = anchorPanel.field === "net1" ? "NET1" : anchorPanel.field === "gross1" ? "GROSS1" : "GROSSV";
                  const fieldColor = anchorPanel.field === "net1" ? "emerald" : anchorPanel.field === "gross1" ? "teal" : "cyan";
                  const borderCls = fieldColor === "emerald" ? "border-emerald-400 focus:ring-emerald-300" : fieldColor === "teal" ? "border-teal-400 focus:ring-teal-300" : "border-cyan-400 focus:ring-cyan-300";
                  const labelCls  = fieldColor === "emerald" ? "text-emerald-700" : fieldColor === "teal" ? "text-teal-700" : "text-cyan-700";
                  return (
                    <div className="mt-3 flex items-center gap-3 p-3 rounded-lg bg-background border shadow-sm">
                      <span className={`text-[10px] font-bold uppercase shrink-0 ${labelCls}`}>{fieldLabel} weekly →</span>
                      <Input
                        autoFocus
                        type="text"
                        inputMode="numeric"
                        value={anchorPanel.draft}
                        className={`h-8 text-sm font-mono w-32 border-2 ${borderCls}`}
                        onChange={e => setAnchorPanel(p => p ? { ...p, draft: e.target.value } : p)}
                        onBlur={() => { if (!anchorCancelledRef.current) commitAnchor(); else { anchorCancelledRef.current = false; setAnchorPanel(null); } }}
                        onKeyDown={e => {
                          if (e.key === "Enter") { (e.currentTarget as HTMLInputElement).blur(); }
                          if (e.key === "Escape") { anchorCancelledRef.current = true; (e.currentTarget as HTMLInputElement).blur(); }
                        }}
                      />
                      <span className="text-[9px] text-muted-foreground">/wk · Enter or click away to apply · Esc to cancel</span>
                      <span className="text-[9px] text-muted-foreground ml-auto">Discounts unchanged — only NET1 shifts</span>
                    </div>
                  );
                })()}

                {/* ── Price summary strip ──────────────────────────────────
                    Shows NET1 / GROSS1 / GROSSV as colored clickable cards.
                    Click any to set it as the anchor price. */}
                <div className="mt-2 flex items-stretch gap-1.5">
                  {/* NET1 */}
                  <button
                    className="flex-1 rounded-lg border-2 border-emerald-200 bg-emerald-50 px-3 py-2 text-left hover:border-emerald-400 hover:bg-emerald-100/60 transition-colors group"
                    onClick={() => setAnchorPanel({ field: "net1", draft: String(canonicalNetWeekly) })}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-wide">NET1</span>
                      <span className="text-[9px] text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5">✎</span>
                    </div>
                    <div className="text-sm font-mono font-bold text-emerald-800">{fmt(canonicalNetWeekly)}<span className="text-[9px] font-normal text-emerald-600 ml-0.5">/wk</span></div>
                    <div className="text-[9px] font-mono text-emerald-600 mt-0.5">{fmt(canonicalNetWeekly * effectiveDuration)} total</div>
                  </button>
                  {hasMarkups && <>
                    <div className="flex items-center text-muted-foreground/40 text-xs px-0.5 self-center">→</div>
                    {/* GROSS1 */}
                    <button
                      className="flex-1 rounded-lg border-2 border-teal-200 bg-teal-50 px-3 py-2 text-left hover:border-teal-400 hover:bg-teal-100/60 transition-colors group"
                      onClick={() => setAnchorPanel({ field: "gross1", draft: String(canonicalGrossWeekly) })}
                    >
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-[9px] font-bold text-teal-700 uppercase tracking-wide">GROSS1</span>
                        <span className="text-[9px] text-teal-400 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5">✎</span>
                        {adminFeePct > 0 && <span className="text-[8px] text-teal-500 ml-1">+{adminFeePct}%A</span>}
                      </div>
                      <div className="text-sm font-mono font-bold text-teal-800">{fmt(canonicalGrossWeekly)}<span className="text-[9px] font-normal text-teal-600 ml-0.5">/wk</span></div>
                      <div className="text-[9px] font-mono text-teal-600 mt-0.5">{fmt(canonicalGrossWeekly * effectiveDuration)} total</div>
                    </button>
                    <div className="flex items-center text-muted-foreground/40 text-xs px-0.5 self-center">→</div>
                    {/* GROSSV */}
                    <button
                      className="flex-1 rounded-lg border-2 border-cyan-200 bg-cyan-50 px-3 py-2 text-left hover:border-cyan-400 hover:bg-cyan-100/60 transition-colors group"
                      onClick={() => setAnchorPanel({ field: "grossv", draft: String(canonicalGrossVWeekly) })}
                    >
                      <div className="flex items-center gap-1 mb-1">
                        <span className="text-[9px] font-bold text-cyan-700 uppercase tracking-wide">GROSSV</span>
                        <span className="text-[9px] text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5">✎</span>
                        {variableFeePct > 0 && <span className="text-[8px] text-cyan-500 ml-1">+{variableFeePct}%V</span>}
                      </div>
                      <div className="text-sm font-mono font-bold text-cyan-800">{fmt(canonicalGrossVWeekly)}<span className="text-[9px] font-normal text-cyan-600 ml-0.5">/wk</span></div>
                      <div className="text-[9px] font-mono text-cyan-600 mt-0.5">{fmt(canonicalGrossVWeekly * effectiveDuration)} total</div>
                    </button>
                  </>}
                  {!hasMarkups && (
                    <div className="flex-1 flex items-center justify-center text-[9px] text-muted-foreground italic border rounded-lg">
                      Add admin fee or discount to see GROSS1 / GROSSV
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── PRICING HEALTH SCORECARD ─────────────────────────────── */}
          {recommendation && nwfClamped > 0 && (() => {
            const dur = (waterfallDuration ?? form.duration_weeks) || 0;
            const netWk = canonicalNetWeekly;
            const grossWk = canonicalGrossWeekly;
            const grossVWk = variableFeePct > 0 ? Math.round(grossWk * (1 + variableFeePct / 100)) : grossWk;
            const grossVTotal = grossVWk * dur;
            const teamCostWk = recommendation.delivery_cost_weekly ?? 0;
            const grossTotal = grossWk * dur;
            const teamCostTotal = Math.round(teamCostWk * dur);
            const gmPct = grossTotal > 0 ? ((grossTotal - teamCostTotal) / grossTotal * 100) : 0;
            const cur = getCurrencyForRegion(form.region);
            const fmtH = (n: number) => cur.symbol + Math.round(n).toLocaleString("it-IT");

            // Check 1: Gross Margin >= 55%
            const gm55 = teamCostWk > 0;
            const gm55Pass = gm55 && gmPct >= 55;

            // Check 2: Net price within green band.
            // Task 12: merged min/max across every country row in the region,
            // same logic as the Pricing Corridors table and the pricing-cases
            // clamp — so the commercial check lines up with what the user sees.
            const cAliases = REGION_TO_COUNTRY[form.region] ?? [form.region];
            const cAliasSet = new Set(cAliases.map(a => a.toLowerCase()));
            const wBenchRows = benchmarks.filter(b =>
              cAliasSet.has(b.country.toLowerCase()) &&
              (b.parameter.toLowerCase().includes("weekly") || b.parameter.toLowerCase().includes("fee"))
            );
            const wBenchNonZero = wBenchRows.filter(r => r.green_low > 0 && r.green_high > 0);
            const gLow  = wBenchNonZero.length ? Math.min(...wBenchNonZero.map(r => r.green_low))  : 0;
            const gHigh = wBenchNonZero.length ? Math.max(...wBenchNonZero.map(r => r.green_high)) : 0;
            const hasGreen = gLow > 0 && gHigh > 0;
            const greenPass = hasGreen && netWk >= gLow && netWk <= gHigh;

            // Check 3: Net price <= highest won price in that country/region
            const regionKey = countryToRegion(form.region) ?? form.region;
            const wonInRegion = analysisProposals.filter(p =>
              p.outcome === "won" && proposalNet1(p) > 0 && (countryToRegion(proposalRegionKey(p)) ?? proposalRegionKey(p)) === regionKey
            );
            const maxWonWk = wonInRegion.length > 0 ? Math.max(...wonInRegion.map(p => proposalNet1(p))) : null;
            const wonPass = maxWonWk !== null && netWk <= maxWonWk;

            // Check 4a: Total project cost / EBITDA <= 2%
            const revM = form.company_revenue_m ?? 0;
            const ebitdaPct = form.ebitda_margin_pct ?? 0;
            const companyEBITDA = revM * ebitdaPct / 100 * 1_000_000; // in €
            const hasEBITDA = companyEBITDA > 0;
            const feesOverEBITDA = hasEBITDA ? grossVTotal / companyEBITDA : null;
            const ebitdaPass = feesOverEBITDA !== null && feesOverEBITDA <= 0.02;

            // Check 4b: Total project cost / aspiration EBITDA increase <= 20%
            const aspPct = form.aspiration_ebitda_pct ?? 0;
            const aspEBITDA = hasEBITDA && aspPct > 0 ? companyEBITDA * aspPct / 100 : 0;
            const hasAsp = aspEBITDA > 0;
            const feesOverAsp = hasAsp ? grossVTotal / aspEBITDA : null;
            const aspPass = feesOverAsp !== null && feesOverAsp <= 0.20;

            // Check 5a: Blended daily rate per consultant (full team).
            // Per user spec: "take Net1 and divide by the number of people in
            // the team" — e.g. a team of 4 (1 Partner + 1 Manager + 2 Associates)
            // divides Net1 by 4 to get the average per-consultant fee, then
            // by 5 days/wk to get a daily blended rate. This is intentionally
            // simpler than the person-day-weighted blended rate — we want a
            // headline number that matches how proposals are pitched to
            // clients ("average daily rate per consultant"), not an internal
            // margin metric.
            const isPartnerRole = (s: StaffingLine) =>
              (s.role_name || "").toLowerCase().includes("partner");
            const activeStaff = form.staffing.filter(s => s.days_per_week > 0 && s.count > 0);
            const teamHeadcount = activeStaff.reduce((s, l) => s + l.count, 0);
            const hasTeam = teamHeadcount > 0 && netWk > 0;
            const blendedDaily = hasTeam ? netWk / teamHeadcount / 5 : null;
            // "Healthy" target: €1,900–€2,500 per consultant per day.
            // Above the band = too thin / overpriced; below = team too heavy vs. fees.
            const blendedHealthy = blendedDaily !== null && blendedDaily >= 1900 && blendedDaily <= 2500;
            const blendedPass = blendedHealthy;

            // Check 5b: Blended daily rate EXCLUDING the Partner.
            // Partners are typically staffed at 1 day/wk and command higher rates,
            // so excluding them shows the "delivery-team" effective daily rate —
            // the number an Associate/Manager is actually billing out at. This
            // is what matters for benchmarking vs. MBB/Big4 team rates (where
            // Partners are usually excluded from published rate cards too).
            const staffNoPartner = activeStaff.filter(s => !isPartnerRole(s));
            const teamHeadcountNoPartner = staffNoPartner.reduce((s, l) => s + l.count, 0);
            // Partner cost share (weekly) = partner days × daily rate × count.
            // Subtract from Net1 weekly to get the non-partner share of fees.
            const partnerWeeklyCost = activeStaff
              .filter(isPartnerRole)
              .reduce((s, l) => s + l.days_per_week * effectiveLineRate(l) * l.count, 0);
            // Fallback proportional split when no cost data: assume partner weight
            // = partner_days / total_team_days (person-days per week).
            const totalPersonDaysPerWk = activeStaff.reduce((s, l) => s + l.days_per_week * l.count, 0);
            const partnerPersonDaysPerWk = activeStaff
              .filter(isPartnerRole)
              .reduce((s, l) => s + l.days_per_week * l.count, 0);
            const partnerFeeShare = partnerWeeklyCost > 0
              ? Math.min(partnerWeeklyCost, netWk * 0.5) // cap at 50% of fee to avoid negatives on low-net deals
              : totalPersonDaysPerWk > 0
                ? netWk * (partnerPersonDaysPerWk / totalPersonDaysPerWk)
                : 0;
            const netWkNoPartner = netWk - partnerFeeShare;
            const hasTeamNoPartner = teamHeadcountNoPartner > 0 && netWkNoPartner > 0;
            const blendedDailyNoPartner = hasTeamNoPartner
              ? netWkNoPartner / teamHeadcountNoPartner / 5
              : null;
            const blendedHealthyNoPartner = blendedDailyNoPartner !== null
              && blendedDailyNoPartner >= 1900 && blendedDailyNoPartner <= 2500;
            const blendedPassNoPartner = blendedHealthyNoPartner;

            // Overall score
            const checks = [
              { available: gm55, pass: gm55Pass },
              { available: hasGreen, pass: greenPass },
              { available: maxWonWk !== null, pass: wonPass },
              { available: hasEBITDA, pass: ebitdaPass },
              { available: hasAsp, pass: aspPass },
              { available: hasTeam, pass: blendedPass },
              { available: hasTeamNoPartner, pass: blendedPassNoPartner },
            ];
            const availableCount = checks.filter(c => c.available).length;
            const passCount = checks.filter(c => c.available && c.pass).length;
            const allPass = availableCount > 0 && passCount === availableCount;

            type Status = "pass" | "fail" | "na";
            const Row = ({ status, label, detail }: { status: Status; label: string; detail: string }) => (
              <div className={`flex items-start gap-2.5 py-1.5 ${status === "na" ? "opacity-50" : ""}`}>
                <span className="text-base mt-0.5 shrink-0">
                  {status === "pass" ? "✅" : status === "fail" ? "❌" : "⚠️"}
                </span>
                <div className="min-w-0">
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-xs text-muted-foreground ml-2">{detail}</span>
                </div>
              </div>
            );

            return (
              <div className={`border-l-4 rounded-lg p-4 bg-background shadow-sm ${
                allPass ? "border-l-emerald-500" : "border-l-red-400"
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Pricing Health</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    allPass ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                  }`}>
                    {passCount}/{availableCount} passed
                  </span>
                </div>
                <div className="divide-y">
                  <Row
                    status={!gm55 ? "na" : gm55Pass ? "pass" : "fail"}
                    label="Gross Margin ≥ 55%"
                    detail={gm55 ? `${gmPct.toFixed(0)}% GM on ${fmtH(grossTotal)} gross` : "no cost data"}
                  />
                  <Row
                    status={!hasGreen ? "na" : greenPass ? "pass" : "fail"}
                    label="Net price in pricing corridor"
                    detail={hasGreen ? `${fmtH(netWk)}/wk vs corridor ${fmtH(gLow)}–${fmtH(gHigh)}` : "no pricing corridor for region"}
                  />
                  <Row
                    status={maxWonWk === null ? "na" : wonPass ? "pass" : "fail"}
                    label="Below highest won price"
                    detail={maxWonWk !== null ? `${fmtH(netWk)}/wk vs max won ${fmtH(maxWonWk)} (${regionKey}, ${wonInRegion.length} wins)` : "no won projects in region"}
                  />
                  <Row
                    status={!hasEBITDA ? "na" : ebitdaPass ? "pass" : "fail"}
                    label="Fees / EBITDA ≤ 2%"
                    detail={hasEBITDA ? `${(feesOverEBITDA! * 100).toFixed(1)}% of €${(companyEBITDA / 1_000_000).toFixed(1)}M EBITDA` : "enter revenue & EBITDA margin"}
                  />
                  <Row
                    status={!hasAsp ? "na" : aspPass ? "pass" : "fail"}
                    label="Fees / Aspiration EBITDA ≤ 20%"
                    detail={hasAsp ? `${(feesOverAsp! * 100).toFixed(0)}% of €${(aspEBITDA / 1_000_000).toFixed(1)}M aspiration increase` : "enter aspiration EBITDA %"}
                  />
                  <Row
                    status={!hasTeam ? "na" : blendedPass ? "pass" : "fail"}
                    label="Blended daily rate per consultant"
                    detail={hasTeam
                      ? `${fmtH(blendedDaily!)}/day · ${fmtH(netWk)}/wk ÷ ${teamHeadcount} ppl ÷ 5d (healthy ${fmtH(1900)}–${fmtH(2500)})`
                      : "add staffing to compute"}
                  />
                  <Row
                    status={!hasTeamNoPartner ? "na" : blendedPassNoPartner ? "pass" : "fail"}
                    label="Blended daily rate — excl. Partner"
                    detail={hasTeamNoPartner
                      ? `${fmtH(blendedDailyNoPartner!)}/day · ${fmtH(netWkNoPartner)}/wk ÷ ${teamHeadcountNoPartner} ppl ÷ 5d (healthy ${fmtH(1900)}–${fmtH(2500)})`
                      : "no non-partner staff"}
                  />
                </div>
              </div>
            );
          })()}

          {/* SECTION D: Fee Summary + Won/Lost + Proposal */}
          {recommendation && nwfClamped > 0 && (() => {
            const effectiveDur = (waterfallDuration ?? form.duration_weeks) || 0;
            const netWeekly = canonicalNetWeekly;
            const grossWeekly = canonicalGrossWeekly;
            const enabledDiscounts = caseDiscounts.filter(d => d.enabled && d.pct > 0);
            const totalGross = Math.round(grossWeekly * effectiveDur);
            const netFees = Math.round(netWeekly * effectiveDur);
            const grossFees = totalGross;
            // Variable fee = GROSS1 × variable% × weeks (same base as waterfall Var. Fee bar)
            const variableFeeTotal = Math.round(grossWeekly * variableFeePct / 100 * effectiveDur);
            const invoiceCount = Math.max(1, Math.floor(1 + effectiveDur / 4));
            const perInvoice = invoiceCount > 0 ? Math.round(totalGross / invoiceCount) : 0;
            const cur = getCurrencyForRegion(form.region);
            const fmtC = (n: number) => cur.symbol + Math.round(n).toLocaleString("it-IT");
            return (
              <div className="border rounded-lg p-4 bg-muted/10 space-y-4">
                <div className="text-xs font-bold uppercase text-muted-foreground tracking-wide">Fee Summary</div>

                {/* 2-column layout: Fee tables on the left (3fr), Past-Projects
                    Benchmark on the right (2fr). Restored after the Apr-13
                    "Major pricing UI overhaul" (8aac77d) wiped the original
                    Historical Intelligence card. Filter is stricter now:
                    SAME client AND SAME shareholder (fund_name) AND SAME
                    country — single combined table, with averages.
                    Note: Toggle + 3-options block live INSIDE the Fee tables
                    IIFE return, so they render in the left column when ON. */}
                <div className="grid grid-cols-1 lg:grid-cols-[3fr,2fr] gap-4 items-start">
                  {/* Fee summary tables */}
                  {(() => {
                  // Net = recommended weekly (what we communicate to client)
                  const netWk = netWeekly;
                  // Gross = Net × (1+admin%) / (1-disc%) / (1-rebate%) / (1-oneoff%)
                  // This is what we invoice
                  let grossWk = netWk * (1 + adminFeePct / 100);
                  for (const d of enabledDiscounts) grossWk = grossWk / (1 - d.pct / 100);
                  grossWk = Math.round(grossWk);
                  // Totals
                  const netTotal = netWk * effectiveDur;
                  const grossTotal = grossWk * effectiveDur;
                  const grossPerInvoice = invoiceCount > 0 ? Math.round(grossTotal / invoiceCount) : 0;
                  // Gross Margin = Gross − team costs
                  const teamCostWk = recommendation?.delivery_cost_weekly ?? 0;
                  const teamCostTotal = Math.round(teamCostWk * effectiveDur);
                  const gmTotal = grossTotal - teamCostTotal;
                  const gmPct = grossTotal > 0 ? (gmTotal / grossTotal * 100) : 0;
                  const gmColor = gmPct >= 50 ? "text-emerald-600" : gmPct >= 30 ? "text-amber-600" : "text-red-600";
                  // Formula text
                  const formulaParts: string[] = [`${fmtC(netWk)} × (1+${adminFeePct}%)`];
                  for (const d of enabledDiscounts) formulaParts.push(`÷ (1−${d.pct}%)`);

                  return (
                    <div className="space-y-3">
                      {/* Row 1: Weekly fees */}
                      <div className="rounded-lg border overflow-hidden">
                        <div className="bg-[#1A3A4A] text-white text-[10px] font-bold uppercase tracking-wide px-3 py-1.5">Weekly Fees</div>
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead className="text-[9px] py-1.5">Gross /wk<br/><span className="font-normal text-muted-foreground">we invoice this</span></TableHead>
                              <TableHead className="text-[9px] py-1.5">Net /wk<br/><span className="font-normal text-muted-foreground">= recommended</span></TableHead>
                              <TableHead className="text-[9px] py-1.5 text-center">Duration</TableHead>
                              <TableHead className="text-[9px] py-1.5 text-center">Invoices</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow>
                              <TableCell className="font-mono text-sm font-bold text-amber-600">{fmtC(grossWk)}</TableCell>
                              <TableCell className="font-mono text-sm font-bold text-emerald-600">{fmtC(netWk)}</TableCell>
                              <TableCell className="text-sm text-center font-semibold">{effectiveDur}w</TableCell>
                              <TableCell className="text-sm text-center font-semibold">{invoiceCount}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                        <div className="px-3 py-1.5 text-[9px] text-muted-foreground border-t bg-muted/10">
                          Gross = {formulaParts.join(" ")} = {fmtC(grossWk)}/wk
                        </div>
                      </div>

                      {/* Row 2: Total project fees */}
                      <div className="rounded-lg border overflow-hidden">
                        <div className="bg-[#1A3A4A] text-white text-[10px] font-bold uppercase tracking-wide px-3 py-1.5">
                          Total Project Fees ({effectiveDur} weeks)
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead className="text-[9px] py-1.5">Gross Total<br/><span className="font-normal text-muted-foreground">we invoice</span></TableHead>
                              <TableHead className="text-[9px] py-1.5">GrossV Total<br/><span className="font-normal text-muted-foreground">incl. var. fee</span></TableHead>
                              <TableHead className="text-[9px] py-1.5">Net Total<br/><span className="font-normal text-muted-foreground">we communicate</span></TableHead>
                              <TableHead className="text-[9px] py-1.5">Gross / Invoice</TableHead>
                              <TableHead className="text-[9px] py-1.5">Variable Fee</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow>
                              <TableCell className="font-mono text-sm font-bold text-amber-600">{fmtC(grossTotal)}</TableCell>
                              <TableCell className="font-mono text-sm font-bold text-amber-700">{fmtC(grossTotal + variableFeeTotal)}</TableCell>
                              <TableCell className="font-mono text-sm font-bold text-emerald-600">{fmtC(netTotal)}</TableCell>
                              <TableCell className="font-mono text-sm font-semibold">{fmtC(grossPerInvoice)}</TableCell>
                              <TableCell className="font-mono text-sm text-amber-600">{fmtC(variableFeeTotal)}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>

                      {/* Row 3: Gross Margin (directly under gross total for visual connection) */}
                      {teamCostWk > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="border rounded-lg p-2.5 bg-background text-center">
                            <div className="text-[9px] text-muted-foreground uppercase font-semibold">Gross Margin</div>
                            <div className={`text-sm font-bold ${gmColor}`}>{fmtC(gmTotal)}</div>
                            <div className="text-[9px] text-muted-foreground">Gross − costs</div>
                          </div>
                          <div className="border rounded-lg p-2.5 bg-background text-center">
                            <div className="text-[9px] text-muted-foreground uppercase font-semibold">GM %</div>
                            <div className={`text-lg font-bold ${gmColor}`}>{gmPct.toFixed(0)}%</div>
                          </div>
                          <div className="border rounded-lg p-2.5 bg-background text-center">
                            <div className="text-[9px] text-muted-foreground uppercase font-semibold">Team Cost (total)</div>
                            <div className="text-sm font-bold text-muted-foreground">{fmtC(teamCostTotal)}</div>
                            <div className="text-[9px] text-muted-foreground">{fmtC(teamCostWk)}/wk × {effectiveDur}w</div>
                          </div>
                        </div>
                      )}

                      {/* ── Option without Partner ──────────────────────
                          Fallback pricing for when the client balks at the
                          quoted fee: remove the Partner's contribution from
                          the team and quote a reduced Gross / Net. Uses a
                          proportional reduction (partner's share of team
                          cost) rather than re-running the whole pricing
                          engine — transparent, easy to explain in a pitch.
                          "You keep the same execution team; I just step
                          out of the day-to-day, so here's X% off." */}
                      {(() => {
                        const partnerLines = form.staffing.filter(
                          l => l.days_per_week > 0 && l.count > 0
                            && (l.role_name || "").toLowerCase().includes("partner"),
                        );
                        if (partnerLines.length === 0 || teamCostWk <= 0) return null;
                        const partnerWeeklyCost = partnerLines.reduce(
                          (s, l) => s + l.days_per_week * effectiveLineRate(l) * l.count, 0,
                        );
                        const partnerShare = partnerWeeklyCost / teamCostWk; // 0..1
                        // Reduce gross and net by the partner's share of total
                        // team cost. Partner is typically ~15-25% of a team
                        // cost line, so the client sees a real, credible cut.
                        const grossWkNoP = Math.round(grossWk * (1 - partnerShare));
                        const netWkNoP = Math.round(netWk * (1 - partnerShare));
                        const grossTotalNoP = grossWkNoP * effectiveDur;
                        const netTotalNoP = netWkNoP * effectiveDur;
                        return (
                          <div className="rounded-lg border-2 border-dashed border-amber-300 overflow-hidden">
                            <div className="bg-amber-50 text-amber-900 text-[10px] font-bold uppercase tracking-wide px-3 py-1.5 flex items-center justify-between">
                              <span>Option without Partner — fallback quote</span>
                              <span className="font-normal normal-case text-amber-800/80">
                                Partner cost = {(partnerShare * 100).toFixed(0)}% of team
                              </span>
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-amber-50/50">
                                  <TableHead className="text-[9px] py-1.5">Gross /wk (no partner)</TableHead>
                                  <TableHead className="text-[9px] py-1.5">Net /wk (no partner)</TableHead>
                                  <TableHead className="text-[9px] py-1.5">Gross Total</TableHead>
                                  <TableHead className="text-[9px] py-1.5">Net Total</TableHead>
                                  <TableHead className="text-[9px] py-1.5">Client saves</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                <TableRow>
                                  <TableCell className="font-mono text-sm font-bold text-amber-600">{fmtC(grossWkNoP)}</TableCell>
                                  <TableCell className="font-mono text-sm font-bold text-emerald-600">{fmtC(netWkNoP)}</TableCell>
                                  <TableCell className="font-mono text-sm font-semibold text-amber-700">{fmtC(grossTotalNoP)}</TableCell>
                                  <TableCell className="font-mono text-sm font-semibold text-emerald-700">{fmtC(netTotalNoP)}</TableCell>
                                  <TableCell className="font-mono text-sm font-bold text-red-600">
                                    −{fmtC(netTotal - netTotalNoP)}
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                            <div className="px-3 py-1.5 text-[9px] text-muted-foreground border-t bg-muted/10">
                              Use this when the client pushes back on price. Keeps the execution team intact;
                              the Partner steps out of day-to-day delivery. Reduction = Partner's {(partnerShare * 100).toFixed(0)}% share of team cost, applied proportionally to Gross & Net.
                            </div>
                          </div>
                        );
                      })()}

                      {/* Commercial-proposal MODE toggle. Drives the persisted
                          form.proposal_options_count (1 = single quote,
                          3 = three-option commitment-discount layout). This
                          is the single source of truth: it controls (a) the
                          visibility of the option-config panel below AND
                          (b) which paragraph variant the proposal text
                          generator emits (3-option block vs single-option).
                          Lives OUTSIDE the panel so it stays reachable
                          when single-option mode hides the panel. */}
                      <div className="flex items-center justify-between border rounded-lg px-3 py-1.5 bg-muted/20">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          Commercial proposal
                        </span>
                        <div className="flex items-center bg-background rounded overflow-hidden text-[10px] border">
                          <button
                            type="button"
                            onClick={() => setForm(f => ({ ...f, proposal_options_count: 1 }))}
                            className={`px-2.5 py-0.5 transition-colors ${(form.proposal_options_count ?? 3) === 1 ? "bg-[#1A6571] text-white font-bold" : "text-muted-foreground hover:bg-muted"}`}
                            title="Single-option proposal — default for most deals"
                          >Single option</button>
                          <button
                            type="button"
                            onClick={() => setForm(f => ({ ...f, proposal_options_count: 3 }))}
                            className={`px-2.5 py-0.5 transition-colors ${(form.proposal_options_count ?? 3) === 3 ? "bg-[#1A6571] text-white font-bold" : "text-muted-foreground hover:bg-muted"}`}
                            title="3 alternative timelines with commitment discounts"
                          >3 alternatives</button>
                        </div>
                      </div>

                      {/* ── Commercial Proposal — three timeline options ──
                          The "12/16/20 weeks" comparison block the client
                          sees in the proposal deck. Same weekly price, three
                          durations, each with its own commitment discount so
                          longer engagements reward the client.

                          State lives in module-scope caseTimelines — editable
                          inline. The table order matches the proposal slide:
                          Gross → each discount delta → commitment → Net.
                          Print button opens a standalone formatted page and
                          triggers the native print dialog ("Save as PDF"
                          destination for PDF output). */}
                      {(form.proposal_options_count ?? 3) === 3 && (() => {
                        const timelines = caseTimelines;
                        // Math now lives in client/src/lib/proposalOptions.ts so the
                        // Pricing Cases LIST page can compute the same Option-2
                        // weekly target without duplicating logic. See
                        // computeOptionColumn there.
                        // Honor the proposal_options_count toggle: render only the
                        // first N options. Hidden columns' state is preserved in
                        // caseTimelines so toggling back to 3 is lossless.
                        const visibleTimelines = (form.proposal_options_count ?? 3) === 1 ? timelines.slice(0, 1) : timelines;
                        const cols = visibleTimelines.map(t => computeOptionColumn(t, grossWk, caseDiscounts));
                        // Discount rows shown = union of rows across columns
                        // (same structure since all cols use same discounts).
                        const rowDefs = cols[0].breakdown;
                        return (
                          <div className="rounded-lg border-2 border-[#1A6571]/40 overflow-hidden">
                            <div className="bg-[#1A6571] text-white text-[10px] font-bold uppercase tracking-wide px-3 py-1.5 flex items-center justify-between">
                              <span>Commercial Proposal — project fees by option</span>
                              <div className="flex items-center gap-2">
                                {/* Mode toggle moved OUTSIDE this panel
                                    so it stays reachable when the panel is
                                    hidden in single-option mode. The outer
                                    "Single option / 3 alternatives" toggle
                                    now drives proposal_options_count. */}
                                <Button
                                  size="sm" variant="secondary"
                                  className="h-6 text-[10px] px-2"
                                  onClick={() => printThreeTimelines(form, cols, rowDefs, fmtC, grossWk, adminFeePct)}
                                >
                                  <Printer className="w-3 h-3 mr-1" /> Print / PDF
                                </Button>
                              </div>
                            </div>
                            <div className="p-3 space-y-3 bg-background">
                              {/* Option-configuration row. Option 1 is
                                  LOCKED to the case duration with 0%
                                  commitment (the base quote). Options 2
                                  and 3 are explicitly prompted — the user
                                  picks weeks + commit% for each to build
                                  the commercial proposal. */}
                              <div className="grid gap-2" style={{ gridTemplateColumns: `160px repeat(${cols.length}, 1fr)` }}>
                                <div className="text-[10px] font-bold uppercase text-muted-foreground self-end pb-1">Option</div>
                                {timelines.map((t, i) => {
                                  const isBase = i === 0;
                                  return (
                                    <div
                                      key={i}
                                      className={`flex flex-col gap-1 items-center rounded p-1.5 ${
                                        isBase ? "bg-muted/50 border border-dashed" : "bg-[#1A6571]/5"
                                      }`}
                                    >
                                      <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground text-center leading-tight">
                                        {isBase ? "Option 1 · Base" : `Option ${i + 1}`}
                                        {t.note && (
                                          <div className="text-[9px] font-normal italic normal-case text-muted-foreground/80 mt-0.5">
                                            ({t.note})
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <Input
                                          type="number" min="1" max="52" step="1" value={t.weeks}
                                          onChange={e => setCaseTimelines(prev => prev.map((x, j) =>
                                            j === i ? { ...x, weeks: Math.max(1, parseInt(e.target.value) || 1) } : x
                                          ))}
                                          title="Editable per option. Option 1 used to be locked to case duration; now editable so projects don't have to use 12/16/20."
                                          className="h-6 w-14 text-xs text-center font-semibold"
                                        />
                                        <span className="text-[10px] text-muted-foreground">weeks</span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <span className="text-[9px] text-muted-foreground">Commit</span>
                                        <Select
                                          value={String(t.commitPct)}
                                          onValueChange={v => setCaseTimelines(prev => prev.map((x, j) =>
                                            j === i ? { ...x, commitPct: Number(v) } : x
                                          ))}
                                          disabled={isBase}
                                        >
                                          <SelectTrigger className={`h-6 w-14 text-[10px] px-1 ${isBase ? "opacity-60" : ""}`} title={isBase ? "Base option has no commitment discount by convention" : undefined}>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(p => (
                                              <SelectItem key={p} value={String(p)} className="text-[11px]">{p}%</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      {/* Optional per-option subtitle — e.g.
                                          "exc. US reset" under the 12-week
                                          column on SCHA01. Free-text, small,
                                          italic. Shown in the print view too. */}
                                      <Input
                                        type="text"
                                        value={t.note ?? ""}
                                        onChange={e => setCaseTimelines(prev => prev.map((x, j) =>
                                          j === i ? { ...x, note: e.target.value || undefined } : x
                                        ))}
                                        placeholder="Note (optional)"
                                        title="Optional subtitle shown under the option header, e.g. 'exc. US reset'"
                                        className="h-5 text-[10px] text-center italic border-dashed mt-0.5 w-28"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="text-[10px] text-muted-foreground italic px-1">
                                Option 1 is your base quote (same as the case's duration, no commitment discount).
                                Options 2 and 3 let you offer longer timelines with a commitment discount to reward the extended engagement.
                              </div>
                              {/* Gross row — editable. Each cell accepts a
                                  manual override that replaces the derived
                                  "grossWk × weeks" value. Leave it empty
                                  to restore the derived value. Overrides
                                  persist on the case via caseTimelines. */}
                              <div className="grid gap-2 items-center" style={{ gridTemplateColumns: `160px repeat(${cols.length}, 1fr)` }}>
                                <div className="text-xs font-bold text-white bg-[#5B7E7E] rounded px-2 py-1.5 text-right">Gross total price</div>
                                {cols.map((c, i) => {
                                  const isOverride = c.hasGrossOverride;
                                  return (
                                    <div key={i} className="flex items-center gap-1">
                                      <Input
                                        type="number"
                                        min="0"
                                        step="100"
                                        value={c.grossTotal}
                                        onChange={e => {
                                          const raw = e.target.value;
                                          const n = parseFloat(raw);
                                          setCaseTimelines(prev => prev.map((x, j) =>
                                            j === i
                                              ? (raw === "" || !isFinite(n) || n <= 0
                                                  ? { ...x, grossTotal: undefined }
                                                  : { ...x, grossTotal: Math.round(n) })
                                              : x,
                                          ));
                                        }}
                                        title={isOverride
                                          ? "Manual override — click the ✕ to restore the derived value"
                                          : "Derived from weekly rate × weeks. Type a new number to override."}
                                        className={`text-sm text-center font-mono h-9 ${
                                          isOverride ? "border-amber-400 bg-amber-50 text-amber-900" : "bg-background"
                                        }`}
                                      />
                                      {isOverride && (
                                        <button
                                          type="button"
                                          onClick={() => setCaseTimelines(prev => prev.map((x, j) =>
                                            j === i ? { ...x, grossTotal: undefined } : x,
                                          ))}
                                          className="text-[10px] text-muted-foreground hover:text-destructive px-1"
                                          title="Restore derived value"
                                        >✕</button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              {/* Discount rows */}
                              {rowDefs.map((row, idx) => (
                                <div key={row.id} className="grid gap-2 items-center" style={{ gridTemplateColumns: `160px repeat(${cols.length}, 1fr)` }}>
                                  <div className="text-xs font-bold text-white bg-[#5B7E7E]/80 rounded px-2 py-1.5 text-right">
                                    {row.id === "commitment" ? row.name : `${row.name} (${row.pct}%)`}
                                  </div>
                                  {cols.map((c, i) => {
                                    const cell = c.breakdown[idx];
                                    return (
                                      <div key={i} className="text-sm text-center font-mono border rounded px-2 py-1.5 bg-background">
                                        {cell.amount > 0 ? `−${fmtC(cell.amount)}` : "—"}
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                              {/* Net total row — EDITABLE. The user can pin
                                  a negotiated round-figure (e.g. €150.000 on a
                                  €152.314 computed net) and that override is
                                  persisted to case_timelines[i].netTotal so it
                                  survives reload + flows into the proposal text.
                                  Click ✕ to restore the computed value. */}
                              <div className="grid gap-2 items-center pt-1" style={{ gridTemplateColumns: `160px repeat(${cols.length}, 1fr)` }}>
                                <div className="text-xs font-bold text-white bg-[#5B7E7E] rounded px-2 py-1.5 text-right">Net total price</div>
                                {cols.map((c, i) => {
                                  const isNetOverride = c.hasNetOverride;
                                  return (
                                    <div key={i} className="flex items-center gap-1">
                                      <Input
                                        type="number"
                                        min="0"
                                        step="100"
                                        value={c.netTotal}
                                        onChange={e => {
                                          const raw = e.target.value;
                                          const n = parseFloat(raw);
                                          setCaseTimelines(prev => prev.map((x, j) =>
                                            j === i
                                              ? (raw === "" || !isFinite(n) || n <= 0
                                                  ? { ...x, netTotal: undefined }
                                                  : { ...x, netTotal: Math.round(n) })
                                              : x,
                                          ));
                                        }}
                                        title={isNetOverride
                                          ? "Manual override — click ✕ to restore the computed Net (Gross − discounts)"
                                          : "Computed = Gross × (1−discounts). Type a new number to pin the Net total."}
                                        className={`text-sm text-center font-mono font-bold h-9 border-2 ${
                                          isNetOverride
                                            ? "border-amber-500 bg-amber-50 text-amber-900"
                                            : "border-emerald-500 bg-emerald-50 text-emerald-900"
                                        }`}
                                      />
                                      {isNetOverride && (
                                        <button
                                          type="button"
                                          onClick={() => setCaseTimelines(prev => prev.map((x, j) =>
                                            j === i ? { ...x, netTotal: undefined } : x,
                                          ))}
                                          className="text-[10px] text-muted-foreground hover:text-destructive px-1"
                                          title="Restore computed value"
                                        >✕</button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="text-[9px] text-muted-foreground italic pt-1 border-t">
                                Based on Gross weekly rate of {fmtC(grossWk)} (Net {fmtC(netWk)}/wk + {adminFeePct}% admin). Same weekly price across all three options — commitment discount rewards longer engagements.
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}

                  {/* RIGHT COLUMN: Past-Projects Benchmark.
                      THREE INDEPENDENT SECTIONS — one per dimension. Each
                      section runs its own filter and shows its own list +
                      average. A project that matches multiple dimensions
                      will appear in multiple sections — that's intentional
                      ("show all Coesia past projects AND all Italy past
                      projects"). Sections are skipped when their dimension
                      isn't set on the form OR has no matches.
                      Geo section uses country if set, falls back to region. */}
                  {(() => {
                    const norm = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase() : "");
                    const clientLc  = norm(form.client_name);
                    const fundLc    = norm(form.fund_name);
                    const countryLc = norm(form.country);
                    const regionLc  = norm(form.region);
                    const anyKeySet = !!(clientLc || fundLc || countryLc || regionLc);

                    const filterByClient = (clientLc)
                      ? analysisProposals.filter(p => p.id !== form.id
                          && norm(p.client_name) === clientLc
                          && (p.total_fee != null || p.weekly_price > 0))
                        .sort((a, b) => (b.proposal_date ?? "").localeCompare(a.proposal_date ?? ""))
                      : [];
                    const filterByFund = (fundLc)
                      ? analysisProposals.filter(p => p.id !== form.id
                          && norm(p.fund_name) === fundLc
                          && (p.total_fee != null || p.weekly_price > 0))
                        .sort((a, b) => (b.proposal_date ?? "").localeCompare(a.proposal_date ?? ""))
                      : [];
                    const filterByGeo = (countryLc || regionLc)
                      ? analysisProposals.filter(p => {
                          if (p.id === form.id) return false;
                          if (!(p.total_fee != null || p.weekly_price > 0)) return false;
                          const pCountryLc = norm(p.country);
                          const pRegionLc  = norm(p.region);
                          return (
                            (!!countryLc && pCountryLc === countryLc) ||
                            (!!regionLc  && pRegionLc  === regionLc)  ||
                            (!!countryLc && !pCountryLc && pRegionLc === countryLc) ||
                            (!!regionLc  && !pRegionLc  && pCountryLc === regionLc)
                          );
                        })
                        .sort((a, b) => (b.proposal_date ?? "").localeCompare(a.proposal_date ?? ""))
                      : [];

                    const sections: Array<{
                      key: string;
                      label: string;
                      items: PricingProposal[];
                      headerColor: string;
                      bgColor: string;
                      avgRowColor: string;
                    }> = [
                      { key: "client", label: `Same client — ${form.client_name || "—"}`,
                        items: filterByClient,
                        headerColor: "bg-blue-700",     bgColor: "bg-blue-50/30",
                        avgRowColor: "bg-blue-100/60" },
                      { key: "fund",   label: `Same shareholder — ${form.fund_name || "—"}`,
                        items: filterByFund,
                        headerColor: "bg-purple-700",   bgColor: "bg-purple-50/30",
                        avgRowColor: "bg-purple-100/60" },
                      { key: "geo",    label: `Same geo — ${form.country || form.region || "—"}`,
                        items: filterByGeo,
                        headerColor: "bg-emerald-700", bgColor: "bg-emerald-50/30",
                        avgRowColor: "bg-emerald-100/60" },
                    ].filter(s => {
                      // Only show sections whose dimension is set on the form.
                      if (s.key === "client" && !clientLc) return false;
                      if (s.key === "fund"   && !fundLc)   return false;
                      if (s.key === "geo"    && !countryLc && !regionLc) return false;
                      return true;
                    });

                    // ── NET1 lookup for benchmark rows ─────────────────
                    // For any past proposal that has a backing pricing case,
                    // use the case's canonical_net_weekly (= NET1) as the
                    // reference price instead of the stored weekly_price.
                    // weekly_price for manually-entered/won proposals is
                    // total_fee ÷ weeks — not NET1. canonical_net_weekly was
                    // explicitly computed and stored on every case save.
                    // Build NET1 lookup: index by BOTH exact case name AND base
                    // code (trailing-letter suffix stripped). Cases are named
                    // proposalNet1 / proposalNet1Total / caseNet1Map are defined
                    // at component level (above state declarations) so they are
                    // available here and in all other tabs (history, scatter, KPIs).

                    const renderSection = (s: typeof sections[number]) => {
                      const weeklyFees = s.items.map(p => proposalNet1(p));
                      const totalFees  = s.items.map(p => {
                        const wk = proposalNet1(p);
                        return Math.round(wk * (p.duration_weeks ?? 0));
                      });
                      const avgTotal  = totalFees.length  > 0 ? totalFees.reduce((a, v) => a + v, 0) / totalFees.length   : 0;
                      const avgWeekly = weeklyFees.length > 0 ? weeklyFees.reduce((a, v) => a + v, 0) / weeklyFees.length : 0;

                      return (
                        <div key={s.key} className={`rounded-lg border overflow-hidden ${s.bgColor}`}>
                          <div className={`${s.headerColor} text-white text-[10px] font-bold uppercase tracking-wide px-3 py-1.5 flex items-center justify-between`}>
                            <span className="truncate">{s.label}</span>
                            <span className="font-normal normal-case text-white/80 text-[10px] shrink-0 ml-2">
                              {s.items.length} {s.items.length === 1 ? "match" : "matches"}
                            </span>
                          </div>
                          {s.items.length === 0 ? (
                            <div className="p-2.5 text-[11px] text-muted-foreground italic">
                              No prior project on this dimension.
                            </div>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-muted/20">
                                  <TableHead className="text-[9px] py-1.5">Code</TableHead>
                                  <TableHead className="text-[9px] py-1.5 text-center">Year</TableHead>
                                  <TableHead className="text-[9px] py-1.5 text-center">Wks</TableHead>
                                  <TableHead className="text-[9px] py-1.5 text-right">Net Fees</TableHead>
                                  <TableHead className="text-[9px] py-1.5 text-right">Net /wk</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {s.items.map((p, i) => {
                                  const net1wk  = proposalNet1(p);
                                  const net1tot = Math.round(net1wk * (p.duration_weeks ?? 0));
                                  const year = (p.proposal_date ?? "").slice(0, 4) || "—";
                                  return (
                                    <TableRow key={p.id ?? i}>
                                      <TableCell className="text-[11px] font-semibold py-1">{p.project_name}</TableCell>
                                      <TableCell className="text-[11px] text-center py-1 text-muted-foreground">{year}</TableCell>
                                      <TableCell className="text-[11px] text-center py-1">{p.duration_weeks ?? "—"}</TableCell>
                                      <TableCell className="text-[11px] text-right py-1 font-mono font-semibold text-emerald-700">{fmtC(net1tot)}</TableCell>
                                      <TableCell className="text-[11px] text-right py-1 font-mono text-emerald-600">{fmtC(net1wk)}</TableCell>
                                    </TableRow>
                                  );
                                })}
                                <TableRow className={`${s.avgRowColor} border-t-2`}>
                                  <TableCell className="text-[10px] font-bold uppercase tracking-wide py-1.5" colSpan={3}>
                                    Avg ({s.items.length})
                                  </TableCell>
                                  <TableCell className="text-[11px] text-right py-1.5 font-mono font-bold">{fmtC(avgTotal)}</TableCell>
                                  <TableCell className="text-[11px] text-right py-1.5 font-mono font-bold">{fmtC(avgWeekly)}</TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          )}
                        </div>
                      );
                    };

                    if (!anyKeySet) {
                      return (
                        <div className="rounded-lg border border-blue-200 bg-blue-50/30 overflow-hidden">
                          <div className="bg-[#1A6571] text-white text-[10px] font-bold uppercase tracking-wide px-3 py-1.5">
                            Past Projects — comparable references
                          </div>
                          <div className="p-3 text-[11px] text-muted-foreground italic">
                            Set <span className="font-semibold text-foreground">client</span>,{" "}
                            <span className="font-semibold text-foreground">shareholder (fund)</span>, or{" "}
                            <span className="font-semibold text-foreground">country / region</span> on the case to see comparable past projects.
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-2">
                        {sections.map(renderSection)}
                        <div className="text-[9px] text-muted-foreground italic px-1">
                          Reference only — not blended into the recommendation. A project may appear in multiple sections.
                        </div>
                      </div>
                    );
                  })()}
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

                {/* Generate proposal text */}
                <div className="border-t pt-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowProposalText(v => !v)}>
                      <FileText className="w-3.5 h-3.5 mr-1.5" />
                      {showProposalText ? "Hide Proposal Text" : "Generate Proposal Text"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      setTemplateLocal(settings?.proposal_template ?? DEFAULT_PROPOSAL_TEMPLATE);
                      setEditingTemplate(true);
                    }}>
                      <Pencil className="w-3 h-3 mr-1" /> Edit Template
                    </Button>
                  </div>

                  {/* Template editor */}
                  {editingTemplate && (
                    <div className="space-y-2 border rounded-lg p-3 bg-muted/10">
                      <div className="text-[10px] font-bold uppercase text-muted-foreground">Edit Proposal Template</div>
                      <p className="text-[9px] text-muted-foreground leading-relaxed">
                        <span className="font-semibold">Variables:</span> {"{{ENGAGEMENT_DURATION_WEEKS}}"} {"{{TEAM_SIZE}}"} {"{{TEAM_COMPOSITION}}"} {"{{STANDARD_PROFESSIONAL_FEES}}"} {"{{NET_PROFESSIONAL_FEES_EXCL_SUCCESS_FEE}}"} {"{{NUMBER_OF_INVOICES}}"} {"{{INVOICE_AMOUNT}}"} {"{{ADMINISTRATION_FEE_PERCENT}}"} {"{{PROMPT_PAYMENT_DISCOUNT_PERCENT}}"} {"{{PROMPT_PAYMENT_DISCOUNT_AMOUNT}}"} {"{{ONE_OFF_DISCOUNT_PERCENT}}"} {"{{ONE_OFF_DISCOUNT_AMOUNT}}"} {"{{REBATE_PERCENT}}"} {"{{REBATE_AMOUNT}}"} {"{{SUCCESS_FEE_PERCENT}}"} {"{{SUCCESS_FEE_AMOUNT}}"} {"{{PE_FUND_NAME}}"} {"{{CLIENT_NAME}}"} {"{{CURRENCY}}"}
                        <br/><span className="font-semibold">Conditionals:</span> {"{{#if VAR}}"}...{"{{/if}}"} — section only appears if VAR has a value
                      </p>
                      <Textarea value={templateLocal}
                        onChange={e => setTemplateLocal(e.target.value)}
                        className="text-xs font-mono resize-none" rows={15} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={async () => {
                          const updated = { ...(settings ?? DEFAULT_PRICING_SETTINGS), proposal_template: templateLocal };
                          await fetch("/api/pricing/settings", {
                            method: "PUT", credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(updated),
                          });
                          setSettings(updated);
                          setEditingTemplate(false);
                          toast({ title: "Template saved" });
                        }}>Save Template</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingTemplate(false)}>Cancel</Button>
                        <Button size="sm" variant="ghost" onClick={async () => {
                          setTemplateLocal(DEFAULT_PROPOSAL_TEMPLATE);
                          const updated = { ...(settings ?? DEFAULT_PRICING_SETTINGS), proposal_template: DEFAULT_PROPOSAL_TEMPLATE };
                          await fetch("/api/pricing/settings", {
                            method: "PUT", credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(updated),
                          });
                          setSettings(updated);
                          toast({ title: "Template reset to default and saved" });
                        }}>Reset to Default</Button>
                      </div>
                    </div>
                  )}

                  {/* Generated text */}
                  {showProposalText && !editingTemplate && (() => {
                    const curMap: Record<string, { symbol: string; code: string }> = {
                      EUR: { symbol: "€", code: "EUR" }, USD: { symbol: "$", code: "USD" },
                      GBP: { symbol: "£", code: "GBP" }, CHF: { symbol: "CHF ", code: "CHF" },
                    };
                    const cur = curMap[form.currency ?? "EUR"] ?? curMap.EUR;
                    const fmtP = (n: number) => cur.symbol + Math.round(n).toLocaleString("it-IT");
                    // Template resolution with auto-migration from v1.
                    // v1 templates included an "A4. Success Fee" paragraph
                    // and an explicit admin-fee line — both removed in v2
                    // because the commercial-proposal table above has no
                    // such rows. Any saved template still carrying those
                    // markers is stale and is silently replaced by the v2
                    // default. The user can re-customize via Edit Template.
                    const savedTemplate = settings?.proposal_template;
                    const isStale = typeof savedTemplate === "string"
                      && /A4\. Success Fee|excluding any success fee|administration fee/i.test(savedTemplate);
                    const template = (!savedTemplate || isStale) ? DEFAULT_PROPOSAL_TEMPLATE : savedTemplate;
                    const dur = (waterfallDuration ?? form.duration_weeks) || 0;
                    // Use canonical values (= waterfall)
                    const netWk = canonicalNetWeekly;
                    const grossWk = canonicalGrossWeekly;
                    const netTotal = netWk * dur;
                    const grossTotal = grossWk * dur;
                    const teamCount = form.staffing.filter(s => s.days_per_week > 0 && s.count > 0)
                      .reduce((s, l) => s + l.count, 0);
                    const teamRoles = form.staffing.filter(s => s.days_per_week > 0 && s.count > 0)
                      .map(s => s.role_name || s.resource_label || "").join(", ");
                    const invoiceCount = Math.max(1, Math.floor(1 + dur / 4));
                    const invoiceAmount = invoiceCount > 0 ? Math.round(grossTotal / invoiceCount) : 0;
                    const enabledDisc = caseDiscounts.filter(d => d.enabled && d.pct > 0);
                    const hasDiscounts = enabledDisc.length > 0 || variableFeePct > 0;

                    // GROSSV total — use EXACT same formula as waterfall: Math.round(GROSS1 × (1+var%)) × dur
                    const grossVWeekly = variableFeePct > 0
                      ? Math.round(grossWk * (1 + variableFeePct / 100))
                      : grossWk;
                    const grossVTotal = grossVWeekly * dur;
                    const varFeeTotal = grossVTotal - grossTotal;
                    // Headline = GROSSV (the all-inclusive number we report)
                    const headlineGross = grossVTotal;

                    // Identify specific discount types by name pattern
                    const promptPayment = enabledDisc.find(d => /prompt|payment/i.test(d.name));
                    const oneOff = enabledDisc.find(d => /one.?off/i.test(d.name));
                    const rebate = enabledDisc.find(d => /rebate/i.test(d.name));

                    const promptPct = promptPayment?.pct ?? 0;
                    const oneOffPct = oneOff?.pct ?? 0;
                    const rebatePct = rebate?.pct ?? 0;
                    const promptAmt = promptPct > 0 ? Math.round(grossTotal * promptPct / 100) : 0;
                    const oneOffAmt = oneOffPct > 0 ? Math.round(grossTotal * oneOffPct / 100) : 0;
                    const rebateAmt = rebatePct > 0 ? Math.round(grossTotal * rebatePct / 100) : 0;

                    // Per-option numbers — mirror EXACTLY the three-timeline
                    // table above. Same compound arithmetic as the table:
                    // start with Gross (weekly × weeks), apply each enabled
                    // discount compound, then commitment % last. This is
                    // what populates OPTION_1/2/3_* vars in the template
                    // so the proposal text reads 1:1 with the table.
                    const baseEnabledDiscs = enabledDisc.filter(d => d.id !== "commitment");
                    // Compute one option column.
                    // Inputs: weeks + commitPct, plus OPTIONAL overrides
                    // that pin gross_total and/or commit_amount for cases
                    // that don't fit the engine's default math (e.g.
                    // SCHA01 where the 16w weekly rate differs from the
                    // 12w rate; EMV01 where commit is flat % × gross).
                    // Math:
                    //   gross = override if set, else grossWk × weeks
                    //   non-commit discounts applied COMPOUND in order
                    //   commit = override if set, else pct × gross (flat)
                    //   net = running - commit_amount
                    const computeOption = (t: { weeks: number; commitPct: number; grossTotal?: number; commitAmount?: number; netTotal?: number }) => {
                      const weeks = t.weeks;
                      const commitPct = t.commitPct;
                      const gross = typeof t.grossTotal === "number" && t.grossTotal > 0
                        ? Math.round(t.grossTotal)
                        : Math.round(grossWk * weeks);
                      let running = gross;
                      const perDisc: Record<string, number> = {};
                      for (const d of baseEnabledDiscs) {
                        const before = running;
                        running = running * (1 - d.pct / 100);
                        perDisc[d.id] = Math.round(before - running);
                      }
                      const commitAmt = typeof t.commitAmount === "number" && t.commitAmount > 0
                        ? Math.round(t.commitAmount)
                        : (commitPct > 0 ? Math.round(gross * commitPct / 100) : 0);
                      running = running - commitAmt;
                      // User-pinned Net override (typed in the Commercial
                      // Proposal block's Net total row) wins over the computed
                      // gross−discounts−commit value. The proposal text emits
                      // this override as the headline Net total price.
                      const netComputed = Math.round(running);
                      const netFinal = typeof t.netTotal === "number" && t.netTotal > 0
                        ? Math.round(t.netTotal)
                        : netComputed;
                      return {
                        weeks,
                        commitPct,
                        gross,
                        net: netFinal,
                        oneOffAmt: perDisc["oneoff"] ?? 0,
                        promptAmt: perDisc["prompt_payment"] ?? 0,
                        rebateAmt: perDisc["rebate"] ?? 0,
                        commitAmt,
                      };
                    };
                    // Pad / truncate so templates can always assume 3 cols.
                    const tl = caseTimelines && caseTimelines.length > 0
                      ? caseTimelines
                      : [{ weeks: dur, commitPct: 0 }, { weeks: dur + 4, commitPct: 5 }, { weeks: dur + 8, commitPct: 7 }];
                    const opt1 = computeOption(tl[0] ?? { weeks: dur,     commitPct: 0 });
                    const opt2 = computeOption(tl[1] ?? { weeks: dur + 4, commitPct: 5 });
                    const opt3 = computeOption(tl[2] ?? { weeks: dur + 8, commitPct: 7 });

                    // A deal gets the 3-option narrative ONLY when ALL of:
                    //   (a) proposal_options_count = 3 (the 1/3 toggle).
                    //       When the user toggled to 1, single-option text
                    //       wins no matter what's in case_timelines.
                    //   (b) caseTimelines actually has ≥2 USER-DEFINED rows
                    //       (we look at the original caseTimelines, not the
                    //       padded `tl`, so a 1-row case never gets padded
                    //       up to a 3-option contract).
                    //   (c) at least one option differs from the case duration
                    //       / has a non-zero commit — otherwise all three
                    //       "options" would read identically.
                    const userTimelinesCount = (caseTimelines ?? []).length;
                    const hasThreeOptions = (form.proposal_options_count ?? 3) === 3
                      && userTimelinesCount >= 2
                      && tl.some(t => (t.commitPct ?? 0) > 0 || t.weeks !== dur);

                    // Build variable map for all replacements
                    const vars: Record<string, string> = {
                      // Legacy compat
                      DURATION_WEEKS: String(dur), TEAM_COUNT: String(teamCount), TEAM_ROLES: teamRoles,
                      GROSS_WEEKLY: fmtP(grossWk), NET_WEEKLY: fmtP(netWk), GROSS_TOTAL: fmtP(grossTotal),
                      NET_TOTAL: fmtP(netTotal), HEADLINE_GROSS: fmtP(headlineGross),
                      CLIENT_NAME: form.client_name || "[Client]",
                      PROJECT_NAME: displayProjectName(form.project_name, form.revision_letter) || "[Project]",
                      PROJECT_CODE: form.project_name || "[Project]",
                      REVISION_LETTER: (form.revision_letter || "A").toUpperCase(),
                      FUND_NAME: form.fund_name || "", ADMIN_PCT: String(adminFeePct),
                      VARIABLE_PCT: String(variableFeePct), CURRENCY: cur.code,
                      INVOICES_COUNT: String(invoiceCount), INVOICE_AMOUNT: fmtP(invoiceAmount),
                      // New structured variables.
                      // In 1-option (NO_COMMITMENT_BLOCK) mode mirror Option 1
                      // from the Commercial Proposal table — that's the
                      // headline the client sees, contract text must match
                      // 1:1 (incl. any user-pinned net override). In 3-option
                      // mode the engine duration / gross are the right numbers.
                      ENGAGEMENT_DURATION_WEEKS: String(hasThreeOptions ? dur : opt1.weeks),
                      TEAM_SIZE: String(teamCount),
                      TEAM_COMPOSITION: teamRoles,
                      STANDARD_PROFESSIONAL_FEES: fmtP(hasThreeOptions ? headlineGross : opt1.net),
                      PROMPT_PAYMENT_DISCOUNT_PERCENT: promptPct > 0 ? String(promptPct) : "",
                      PROMPT_PAYMENT_DISCOUNT_AMOUNT: promptPct > 0 ? fmtP(promptAmt) : "",
                      ONE_OFF_DISCOUNT_PERCENT: oneOffPct > 0 ? String(oneOffPct) : "",
                      ONE_OFF_DISCOUNT_AMOUNT: oneOffPct > 0 ? fmtP(oneOffAmt) : "",
                      PE_FUND_NAME: form.fund_name || "",
                      PE_FUND_CLAUSE: form.fund_name ? `, granted in connection with ${form.fund_name}` : "",
                      REBATE_PERCENT: rebatePct > 0 ? String(rebatePct) : "",
                      REBATE_AMOUNT: rebatePct > 0 ? fmtP(rebateAmt) : "",
                      // Success fee intentionally dropped from default
                      // template — the table above has no success-fee row.
                      NET_PROFESSIONAL_FEES_EXCL_SUCCESS_FEE: fmtP(netTotal),
                      NUMBER_OF_INVOICES: String(invoiceCount),
                      ADMINISTRATION_FEE_PERCENT: String(adminFeePct),
                      // Three-option block — populated only when the user
                      // has actually set up alternative timelines.
                      COMMITMENT_OPTIONS_BLOCK: hasThreeOptions ? "yes" : "",
                      NO_COMMITMENT_BLOCK: hasThreeOptions ? "" : "yes",
                      OPTION_1_WEEKS: String(opt1.weeks),
                      OPTION_1_COMMIT_PCT: opt1.commitPct > 0 ? String(opt1.commitPct) : "",
                      OPTION_1_GROSS_TOTAL: fmtP(opt1.gross),
                      OPTION_1_NET_TOTAL: fmtP(opt1.net),
                      OPTION_1_ONE_OFF_AMOUNT: opt1.oneOffAmt > 0 ? fmtP(opt1.oneOffAmt) : "",
                      OPTION_1_PROMPT_AMOUNT: opt1.promptAmt > 0 ? fmtP(opt1.promptAmt) : "",
                      OPTION_1_REBATE_AMOUNT: opt1.rebateAmt > 0 ? fmtP(opt1.rebateAmt) : "",
                      OPTION_1_COMMIT_AMOUNT: opt1.commitAmt > 0 ? fmtP(opt1.commitAmt) : "",
                      OPTION_2_WEEKS: String(opt2.weeks),
                      OPTION_2_COMMIT_PCT: opt2.commitPct > 0 ? String(opt2.commitPct) : "",
                      OPTION_2_GROSS_TOTAL: fmtP(opt2.gross),
                      OPTION_2_NET_TOTAL: fmtP(opt2.net),
                      OPTION_2_ONE_OFF_AMOUNT: opt2.oneOffAmt > 0 ? fmtP(opt2.oneOffAmt) : "",
                      OPTION_2_PROMPT_AMOUNT: opt2.promptAmt > 0 ? fmtP(opt2.promptAmt) : "",
                      OPTION_2_REBATE_AMOUNT: opt2.rebateAmt > 0 ? fmtP(opt2.rebateAmt) : "",
                      OPTION_2_COMMIT_AMOUNT: opt2.commitAmt > 0 ? fmtP(opt2.commitAmt) : "",
                      OPTION_3_WEEKS: String(opt3.weeks),
                      OPTION_3_COMMIT_PCT: opt3.commitPct > 0 ? String(opt3.commitPct) : "",
                      OPTION_3_GROSS_TOTAL: fmtP(opt3.gross),
                      OPTION_3_NET_TOTAL: fmtP(opt3.net),
                      OPTION_3_ONE_OFF_AMOUNT: opt3.oneOffAmt > 0 ? fmtP(opt3.oneOffAmt) : "",
                      OPTION_3_PROMPT_AMOUNT: opt3.promptAmt > 0 ? fmtP(opt3.promptAmt) : "",
                      OPTION_3_REBATE_AMOUNT: opt3.rebateAmt > 0 ? fmtP(opt3.rebateAmt) : "",
                      OPTION_3_COMMIT_AMOUNT: opt3.commitAmt > 0 ? fmtP(opt3.commitAmt) : "",
                    };

                    let text = template;

                    // Process {{#if VAR}}...{{/if}} conditionals.
                    // Handles ARBITRARY NESTING by matching the INNERMOST
                    // block first (body contains no further {{#if or
                    // {{/if}}), then looping until no more matches. The
                    // previous non-greedy approach broke on nested blocks
                    // because the regex matched the first inner {{/if}}
                    // as the closing of an outer {{#if}}, leaving orphan
                    // {{/if}} literals and rendering stripped content.
                    const IF_RE = /\{\{#if (\w+)\}\}((?:(?!\{\{#if |\{\{\/if\}\})[\s\S])*?)\{\{\/if\}\}/g;
                    for (let pass = 0; pass < 6; pass++) {
                      const before = text;
                      text = text.replace(IF_RE, (_match, varName, content) => {
                        const val = vars[varName] ?? "";
                        return val ? content : "";
                      });
                      if (text === before) break; // no more matches — done
                    }
                    // Any leftover {{#if}}/{{/if}} tokens mean we hit a
                    // malformed template. Strip them rather than leaking
                    // to the clipboard.
                    text = text.replace(/\{\{#if \w+\}\}/g, "").replace(/\{\{\/if\}\}/g, "");

                    // Process {{IF_DISCOUNTS}}...{{END_IF_DISCOUNTS}} (legacy)
                    if (hasDiscounts) {
                      text = text.replace(/\{\{IF_DISCOUNTS\}\}/g, "").replace(/\{\{END_IF_DISCOUNTS\}\}/g, "");
                    } else {
                      text = text.replace(/\{\{IF_DISCOUNTS\}\}[\s\S]*?\{\{END_IF_DISCOUNTS\}\}/g, "");
                    }

                    // Replace all {{VAR}} placeholders
                    text = text.replace(/\{\{(\w+)\}\}/g, (_match, varName) => vars[varName] ?? "");

                    // Clean up double blank lines
                    text = text.replace(/\n{3,}/g, "\n\n").trim();

                    return (
                      <div className="border rounded-lg p-4 bg-white space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold uppercase text-muted-foreground">Proposal Fee Section</div>
                          <Button size="sm" variant="outline" onClick={() => {
                            navigator.clipboard.writeText(text);
                            toast({ title: "Copied to clipboard" });
                          }}>
                            Copy
                          </Button>
                        </div>
                        <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed text-foreground bg-muted/20 rounded p-3 max-h-96 overflow-y-auto">
                          {text}
                        </pre>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

          {/* ── COLLAPSIBLE: Benchmarks & Market Analysis ─────────── */}
          <div className="border rounded-lg bg-muted/10 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowBenchmarks(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/20 transition-colors"
            >
              <span className="text-xs font-bold uppercase text-muted-foreground tracking-wide">
                Benchmarks & Market Analysis
              </span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showBenchmarks ? "rotate-180" : ""}`} />
            </button>
            {showBenchmarks && (
              <div className="space-y-5 px-4 pb-4">

          {/* SECTION C: Commercial Analysis */}
          {recommendation && nwfClamped > 0 && (() => {
            const cur = getCurrencyForRegion(form.region);
            const fmtC = (n: number) => cur.symbol + Math.round(n).toLocaleString("it-IT");
            const fmtK2 = (n: number) => `${cur.symbol}${Math.round(n / 1000)}k`;

            // Map all regions to rate matrix keys — fall back to nearest benchmark region
            const regionMap2: Record<string, string> = {
              IT: "Italy", FR: "France", DE: "DACH", UK: "UK", US: "US",
              DACH: "DACH", Nordics: "DACH", "Other EU": "France", "Middle East": "UK", Asia: "US", SEA: "US",
            };
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
            const secCBaseWkly = nwfClamped + manualDelta;
            const secCFinalWkly = Math.round(secCBaseWkly * (1 + variableFeePct / 100 + adminFeePct / 100));
            const secCGross = Math.round(secCBaseWkly * secCEffDur);
            const secCNet = Math.round(secCFinalWkly * secCEffDur);
            const allBenchVals = [...benchRows.map(r => r.avg), tnf];
            const benchScale = Math.max(...allBenchVals, 1) * 1.1;
            const pctBar = (v: number) => `${Math.min(100, (v / benchScale) * 100).toFixed(1)}%`;

            // Region band bars — merge all countries in the region (same as Win-Loss tab)
            const regionKey = countryToRegion(form.region) ?? form.region;
            const regionCountries = benchmarks.map(b => b.country).filter(c => (countryToRegion(c) ?? c) === regionKey);
            const mergeRegionBench = (param: string): CountryBenchmarkRow | undefined => {
              const rows = [...new Set(regionCountries)].map(c =>
                benchmarks.find(b => b.country === c && b.parameter.toLowerCase().includes(param))
              ).filter(Boolean) as CountryBenchmarkRow[];
              const nonZero = rows.filter(r => r.yellow_high > 0);
              if (nonZero.length === 0) return rows[0]; // return first even if zero
              return {
                country: regionKey,
                parameter: nonZero[0].parameter,
                yellow_low: Math.min(...nonZero.map(r => r.yellow_low)),
                green_low: Math.min(...nonZero.map(r => r.green_low)),
                green_high: Math.max(...nonZero.map(r => r.green_high)),
                yellow_high: Math.max(...nonZero.map(r => r.yellow_high)),
                decisiveness_pct: Math.round(nonZero.reduce((s, r) => s + r.decisiveness_pct, 0) / nonZero.length),
              };
            };
            const weeklyBench = mergeRegionBench("weekly") ?? mergeRegionBench("fee");
            const totalBench = mergeRegionBench("total") ?? mergeRegionBench("cost");

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
                <div className="text-sm font-bold uppercase text-muted-foreground tracking-wide">Commercial Analysis</div>
                <div>
                  {/* Market benchmarks (combined box) */}
                  <div className="border rounded-lg p-3 bg-background space-y-3">
                    {/* NET1 weekly header */}
                    <div className="flex items-center justify-between rounded bg-emerald-50 border border-emerald-200 px-2 py-1.5">
                      <span className="text-[10px] font-semibold text-muted-foreground">Our NET1 Weekly</span>
                      <span className="text-sm font-bold text-emerald-700">
                        {fmtC(canonicalNetWeekly)}<span className="text-[9px] font-normal text-muted-foreground ml-1">/week</span>
                      </span>
                    </div>
                    {/* NET1 vs Market — weekly comparison with dots + labels under each dot */}
                    {benchRows.length > 0 && (() => {
                      // Convert competitor benchmarks to weekly (they were total = avg weekly × duration)
                      const dur = form.duration_weeks || 12;
                      const weeklyPoints = competitorBenchmarks.map(b => {
                        const minW = (b.rates as any)[matrixRegion2]?.min_weekly ?? 0;
                        const maxW = (b.rates as any)[matrixRegion2]?.max_weekly ?? 0;
                        const avgW = (minW + maxW) / 2;
                        return { label: b.label, color: "#94a3b8", avg: avgW, isOurs: false };
                      }).filter(r => r.avg > 0);
                      const allPoints = [...weeklyPoints, { label: "Our NET1", color: "#16a34a", avg: canonicalNetWeekly, isOurs: true }];
                      const maxVal = Math.max(...allPoints.map(p => p.avg)) * 1.12;
                      const pctDot = (v: number) => Math.min(95, Math.max(5, (v / maxVal) * 100));
                      return (
                        <div className="space-y-0.5">
                          <div className="text-[10px] font-bold uppercase text-muted-foreground">NET1/wk vs Market — {matrixRegion2}</div>
                          <div className="relative h-16 bg-muted/20 rounded-lg border border-border/20">
                            {/* Competitor dots (rendered first = behind) */}
                            {allPoints.filter(t => !t.isOurs).map((t, i) => (
                              <div key={`c${i}`} className="absolute bottom-2 flex flex-col items-center" style={{ left: `${pctDot(t.avg)}%`, transform: "translateX(-50%)" }}>
                                <div className="w-3 h-3 rounded-full border-2 border-white shadow-sm"
                                  style={{ backgroundColor: t.color }} />
                                <span className="text-[7px] mt-0.5 whitespace-nowrap font-semibold text-muted-foreground">
                                  {t.label.replace("Tier 1 (MBB)", "MBB").replace("Tier 2 (OW, SKP, Kearney)", "T2")}
                                </span>
                                <span className="text-[8px] font-mono font-bold text-muted-foreground">{fmtK2(t.avg)}</span>
                              </div>
                            ))}
                            {/* Our NET1 dot (rendered last = on top, label ABOVE dot) */}
                            {allPoints.filter(t => t.isOurs).map((t, i) => (
                              <div key={`o${i}`} className="absolute top-1 flex flex-col items-center z-10" style={{ left: `${pctDot(t.avg)}%`, transform: "translateX(-50%)" }}>
                                <span className="text-[8px] font-mono font-bold text-emerald-700">{fmtK2(t.avg)}</span>
                                <span className="text-[7px] whitespace-nowrap font-bold text-emerald-700">Our NET1</span>
                                <div className="w-4 h-4 rounded-full border-2 border-white shadow-md ring-2 ring-emerald-400 mt-0.5"
                                  style={{ backgroundColor: "#16a34a" }} />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {/* Band bars */}
                    <BandBar bench={weeklyBench} marker={canonicalNetWeekly} label={`Weekly — ${regionKey} · ${form.pe_owned ? "PE" : "Corp"} ${form.revenue_band === "above_1b" ? ">€1B" : form.revenue_band === "200m_1b" ? "€200M-€1B" : "<€200M"}`} />
                    <BandBar bench={totalBench} marker={canonicalNetWeekly * (form.duration_weeks || 0)} label={`Total Net Fees — ${regionKey}`} />

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
                              <span className="text-[#1A6571] font-bold">Our Net1</span>
                              <span className="font-mono">{fmtC(canonicalNetWeekly)}/wk</span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-[#1A6571]" style={{ width: pctW(canonicalNetWeekly) }} />
                            </div>
                          </div>
                          <div className="text-[9px] text-muted-foreground leading-relaxed pt-1 border-t border-border/50">
                            Comparables are scored by similarity: same fund (40 pts), same region (25 pts), same PE/non-PE ownership (15 pts), same revenue band (20 pts). Top 8 projects with score ≥25 are selected. Won and lost averages shown above.
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── MARKET BENCHMARK CHART ────────────────────────────── */}
          {(() => {
            const benchmarks: CompetitorBenchmark[] = settings?.competitor_benchmarks ?? DEFAULT_PRICING_SETTINGS.competitor_benchmarks;
            if (!benchmarks?.length) return null;
            // Map all regions to rate matrix keys — fall back to nearest benchmark region
            const regionMap: Record<string, string> = {
              IT: "Italy", FR: "France", DE: "DACH", UK: "UK", US: "US",
              DACH: "DACH", Nordics: "DACH", "Other EU": "France", "Middle East": "UK", Asia: "US", SEA: "US",
            };
            const matrixRegion = regionMap[form.region] ?? "Italy";
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
                  // Cell note (region × tier) key, matches PricingAdmin's shape
                  // so notes authored in admin show up here and vice-versa.
                  const cKey = benchCellKey(matrixRegion, tier.label);
                  // Tier-level general note — cross-country observations
                  // about this tier that aren't tied to the current region.
                  const tKey = benchTierKey(tier.label);
                  const cCount = benchNoteCount(cKey);
                  const tCount = benchNoteCount(tKey);
                  const cellExpanded = expandedBenchNoteKey === cKey;
                  const tierExpanded = expandedBenchNoteKey === tKey;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between items-center text-xs text-muted-foreground gap-2">
                        <span className={tier.isOurs ? "font-bold text-amber-700" : ""}>{tier.label}</span>
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-[11px]">{fmtK(tier.min)} – <span className="opacity-60">avg {fmtK(mid)}</span> – {fmtK(tier.max)}</span>
                          {/* Cell note (region-specific) */}
                          <button
                            type="button"
                            onClick={() => setExpandedBenchNoteKey(k => k === cKey ? null : cKey)}
                            className={`p-1 rounded transition-colors inline-flex items-center gap-0.5 ${
                              cCount > 0
                                ? "text-amber-700 hover:bg-amber-100 bg-amber-50 border border-amber-300"
                                : "text-muted-foreground/50 hover:text-foreground hover:bg-muted"
                            }`}
                            title={cCount > 0
                              ? `${cCount} note${cCount !== 1 ? "s" : ""} · ${matrixRegion} · ${tier.label}`
                              : `Add note for ${matrixRegion} · ${tier.label}`}
                          >
                            <StickyNote className="w-3 h-3" />
                            {cCount > 0 && <span className="text-[9px] font-bold">{cCount}</span>}
                          </button>
                          {/* Tier-wide general note */}
                          <button
                            type="button"
                            onClick={() => setExpandedBenchNoteKey(k => k === tKey ? null : tKey)}
                            className={`p-1 rounded transition-colors inline-flex items-center gap-0.5 text-[9px] font-semibold ${
                              tCount > 0
                                ? "text-amber-700 hover:bg-amber-100 bg-amber-50 border border-amber-300"
                                : "text-muted-foreground/50 hover:text-foreground hover:bg-muted border border-dashed border-border"
                            }`}
                            title={tCount > 0
                              ? `${tCount} general note${tCount !== 1 ? "s" : ""} for ${tier.label} (all regions)`
                              : `Add general tier-wide note for ${tier.label}`}
                          >
                            Tier
                            {tCount > 0 && <span>({tCount})</span>}
                          </button>
                        </div>
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
                      {/* Expanded editor — only the one the user clicked.
                          Saved notes are hidden beneath the count badge; the
                          panel re-opens on click. */}
                      {cellExpanded && (
                        <BenchmarkNotesEditor
                          title={`Market intel · ${matrixRegion} · ${tier.label}`}
                          placeholder={`Paste market intel for ${tier.label} in ${matrixRegion}…`}
                          notes={benchmarkNotes[cKey] ?? []}
                          onAdd={text => addBenchNote(cKey, text)}
                          onUpdate={(id, text) => updateBenchNote(cKey, id, text)}
                          onDelete={id => deleteBenchNote(cKey, id)}
                          onClose={() => setExpandedBenchNoteKey(null)}
                        />
                      )}
                      {tierExpanded && (
                        <BenchmarkNotesEditor
                          title={`General notes · ${tier.label} (all regions)`}
                          placeholder={`Cross-country observations about ${tier.label}…`}
                          notes={benchmarkNotes[tKey] ?? []}
                          onAdd={text => addBenchNote(tKey, text)}
                          onUpdate={(id, text) => updateBenchNote(tKey, id, text)}
                          onDelete={id => deleteBenchNote(tKey, id)}
                          onClose={() => setExpandedBenchNoteKey(null)}
                        />
                      )}
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

              </div>
            )}
          </div>{/* end collapsible benchmarks */}

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

      {/* ── Team picker Dialog ────────────────────────────────────────
          Triggered by clicking the Team cell on a Past Projects row.
          Manager is required when the proposal is "Open" (pending +
          future end_date); enforced via the destructive-state Save
          button. Associates are optional, free-add. Saves via
          patchProposalInline so the row updates without a full reload.
          team_size is auto-recomputed = 1 (manager) + #associates so
          the existing engine + Pricing Cases list stays consistent. */}
      <Dialog open={teamEditFor !== null} onOpenChange={(open) => { if (!open) setTeamEditFor(null); }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              Pick team — {teamEditFor?.project_name ?? ""}
              {teamEditFor && (() => {
                const today = new Date().toISOString().slice(0, 10);
                const isOpen = teamEditFor.outcome === "pending"
                  && !!teamEditFor.end_date && teamEditFor.end_date > today;
                return isOpen
                  ? <Badge className="ml-2 bg-blue-100 text-blue-700 border-blue-200 text-[10px]">Open</Badge>
                  : null;
              })()}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Open engagements need at least 1 manager. Associates are optional — add as many as you need.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Manager — required for open engagements */}
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1.5">
                Manager (EM)
                <span className="text-red-500">*</span>
              </Label>
              <Select
                value={teamDraftManager || "__none__"}
                onValueChange={(v) => setTeamDraftManager(v === "__none__" ? "" : v)}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select manager…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— none —</SelectItem>
                  {employees.length === 0 && (
                    <div className="px-2 py-3 text-[11px] text-muted-foreground italic">
                      No employees loaded. Check connection or visit /employees.
                    </div>
                  )}
                  {employees.map(e => (
                    <SelectItem key={e.id} value={e.name}>
                      {e.name}{e.current_role_code ? ` · ${e.current_role_code}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Associates — optional, multi-add */}
            <div className="space-y-1">
              <Label className="text-xs">Associates (optional)</Label>
              <div className="space-y-1.5">
                {teamDraftAssociates.length === 0 && (
                  <div className="text-[11px] text-muted-foreground italic px-1">
                    No associates yet. Click below to add.
                  </div>
                )}
                {teamDraftAssociates.map((a, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <Select
                      value={a.name || "__none__"}
                      onValueChange={(v) => setTeamDraftAssociates(prev =>
                        prev.map((x, j) => j === i
                          ? { ...x, name: v === "__none__" ? "" : v }
                          : x))}
                    >
                      <SelectTrigger className="h-8 text-sm flex-1">
                        <SelectValue placeholder="Select associate…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— none —</SelectItem>
                        {employees.map(e => (
                          <SelectItem key={e.id} value={e.name}>
                            {e.name}{e.current_role_code ? ` · ${e.current_role_code}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="text"
                      value={a.role}
                      onChange={(e) => setTeamDraftAssociates(prev =>
                        prev.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}
                      placeholder="Role"
                      className="h-8 text-sm w-24"
                    />
                    <Button
                      type="button" size="sm" variant="ghost"
                      className="h-8 px-2"
                      onClick={() => setTeamDraftAssociates(prev => prev.filter((_, j) => j !== i))}
                      title="Remove this associate"
                    ><X className="w-3.5 h-3.5" /></Button>
                  </div>
                ))}
                <Button
                  type="button" size="sm" variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setTeamDraftAssociates(prev => [...prev, { role: "ASC", name: "" }])}
                >+ Add associate</Button>
              </div>
            </div>

            {/* Hint when open + no manager */}
            {teamEditFor && (() => {
              const today = new Date().toISOString().slice(0, 10);
              const isOpen = teamEditFor.outcome === "pending"
                && !!teamEditFor.end_date && teamEditFor.end_date > today;
              if (isOpen && !teamDraftManager) {
                return (
                  <div className="flex items-start gap-2 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                    <span>This engagement is <b>Open</b> (running, end-date in future). Pick a manager before saving.</span>
                  </div>
                );
              }
              return null;
            })()}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setTeamEditFor(null)}>Cancel</Button>
            <Button
              onClick={async () => {
                if (!teamEditFor?.id) return;
                const today = new Date().toISOString().slice(0, 10);
                const isOpen = teamEditFor.outcome === "pending"
                  && !!teamEditFor.end_date && teamEditFor.end_date > today;
                if (isOpen && !teamDraftManager) {
                  toast({ title: "Manager required for Open engagements", variant: "destructive" });
                  return;
                }
                const cleanedAssociates = teamDraftAssociates.filter(a => a.name && a.name.trim());
                await patchProposalInline(teamEditFor.id, {
                  manager_name: teamDraftManager || null,
                  team_members: cleanedAssociates,
                  // Keep team_size in sync: 1 manager (if set) + N associates.
                  // If no manager, fall back to associates count or 1.
                  team_size: (teamDraftManager ? 1 : 0) + cleanedAssociates.length || 1,
                } as any);
                setTeamEditFor(null);
              }}
            >Save team</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
