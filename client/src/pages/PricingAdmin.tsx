import React, { useState, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Settings,
  X,
  Plus,
  Info,
  Save,
  Lock,
  Trash2,
  Download,
  Database,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PricingRole {
  id: string;
  role_name: string;
  default_daily_rate: number;
  active: boolean;
  sort_order: number;
}

interface PricingRegion {
  id: string;
  region_name: string;
  multiplier: number;
  is_baseline: boolean;
}

interface OwnershipMultiplier {
  value: string; // "pe" | "non_pe"
  label: string;
  multiplier: number;
  is_baseline: boolean;
}

interface RevenueBandMultiplier {
  value: string; // "below_100m" | "100m_200m" | "200m_1b" | "above_1b"
  label: string;
  multiplier: number;
  is_baseline: boolean;
}

interface SensitivityMultiplier {
  value: string; // "low" | "medium" | "high"
  label: string;
  multiplier: number;
}

interface PricingDiscount {
  id: string;
  name: string;
  default_pct: number;
  active: boolean;
}

interface StaffCostEntry {
  role_id: string;
  role_name: string;
  daily_cost: number;
}

interface RateMatrixCell {
  min_weekly: number;
  max_weekly: number;
  note: string;
  avoid: boolean;
}

interface RateMatrixRow {
  client_type: string;
  rates: Record<string, RateMatrixCell>;
}

interface FloorRule {
  min_weekly: number;
  description: string;
}

interface CompetitorTierRates {
  Italy:  { min_weekly: number; max_weekly: number };
  France: { min_weekly: number; max_weekly: number };
  UK:     { min_weekly: number; max_weekly: number };
  DACH:   { min_weekly: number; max_weekly: number };
  US:     { min_weekly: number; max_weekly: number };
}

interface CompetitorBenchmark {
  tier: string;
  label: string;
  color: string;
  rates: CompetitorTierRates;
  sources: string[];
}

interface PricingAdjustment {
  value: string;
  label: string;
  adj_pct: number;
}

interface PricingSettings {
  roles: PricingRole[];
  regions: PricingRegion[];
  ownership_multipliers: OwnershipMultiplier[];
  revenue_band_multipliers: RevenueBandMultiplier[];
  sensitivity_multipliers: SensitivityMultiplier[];
  funds: string[];
  discounts: PricingDiscount[];
  staff_costs: StaffCostEntry[];
  rate_matrix: RateMatrixRow[];
  floor_rule?: FloorRule; // deprecated — kept optional for backward compat
  bracket_low_pct: number;
  bracket_high_pct: number;
  aggressive_threshold_pct: number;
  conservative_threshold_pct: number;
  min_comparables: number;
  fund_anchor_weight: number;
  win_loss_weight: number;
  competitor_benchmarks: CompetitorBenchmark[];
  competitive_intensity_adj?: PricingAdjustment[];
  competitor_type_adj?: PricingAdjustment[];
  strategic_intent_adj?: PricingAdjustment[];
  fund_defaults?: FundDefaults[];
  sector_multipliers?: SectorMultiplier[];
  sectors?: string[];
  project_types?: string[];
}

interface SectorMultiplier {
  sector: string;
  multiplier: number;
}

interface FundDefaults {
  fund_name: string;
  relationship_type?: string | null;
  strategic_intent?: string | null;
  competitive_intensity?: string | null;
  price_sensitivity?: string | null;
}

// ─── Default / fallback data ─────────────────────────────────────────────────

const DEFAULT_SETTINGS: PricingSettings = {
  roles: [
    { id: "1", role_name: "Analyst", default_daily_rate: 800, active: true, sort_order: 1 },
    { id: "2", role_name: "Senior Analyst", default_daily_rate: 1100, active: true, sort_order: 2 },
    { id: "3", role_name: "Consultant", default_daily_rate: 1400, active: true, sort_order: 3 },
    { id: "4", role_name: "Senior Consultant", default_daily_rate: 1800, active: true, sort_order: 4 },
    { id: "5", role_name: "Manager", default_daily_rate: 2200, active: true, sort_order: 5 },
    { id: "6", role_name: "Senior Manager", default_daily_rate: 2700, active: true, sort_order: 6 },
    { id: "7", role_name: "Director", default_daily_rate: 3200, active: true, sort_order: 7 },
    { id: "8", role_name: "Partner", default_daily_rate: 4000, active: true, sort_order: 8 },
  ],
  regions: [
    { id: "it", region_name: "Italy", multiplier: 1.0, is_baseline: true },
    { id: "se", region_name: "South Europe", multiplier: 0.95, is_baseline: false },
    { id: "fr", region_name: "France", multiplier: 1.1, is_baseline: false },
    { id: "de", region_name: "Germany", multiplier: 1.15, is_baseline: false },
    { id: "uk", region_name: "UK", multiplier: 1.25, is_baseline: false },
    { id: "us", region_name: "US", multiplier: 1.4, is_baseline: false },
    { id: "as", region_name: "Asia", multiplier: 1.05, is_baseline: false },
    { id: "me", region_name: "Middle East", multiplier: 1.2, is_baseline: false },
  ],
  ownership_multipliers: [
    { value: "pe", label: "PE-owned", multiplier: 1.0, is_baseline: true },
    { value: "non_pe", label: "Non PE-owned", multiplier: 0.85, is_baseline: false },
  ],
  revenue_band_multipliers: [
    { value: "below_100m", label: "Below $100M", multiplier: 0.8, is_baseline: false },
    { value: "100m_200m", label: "$100M – $200M", multiplier: 0.9, is_baseline: false },
    { value: "200m_1b", label: "$200M – $1B", multiplier: 0.95, is_baseline: false },
    { value: "above_1b", label: "Above $1B", multiplier: 1.0, is_baseline: true },
  ],
  sensitivity_multipliers: [
    { value: "low", label: "Low", multiplier: 1.1 },
    { value: "medium", label: "Medium", multiplier: 1.0 },
    { value: "high", label: "High", multiplier: 0.9 },
  ],
  funds: ["CARLYLE", "BAIN CAP", "KPS", "ADVENT", "CVC"],
  sectors: ["Industrial / Manufacturing", "Pharma / Healthcare", "Software / SaaS", "Consumer / Retail", "Energy / Utilities", "Business Services", "PE-SWF", "Other", "Distribution"],
  project_types: ["Spark", "SFE", "Pricing", "Other Design", "War Room"],
  discounts: [
    { id: "oneoff", name: "One-off discount", default_pct: 0, active: true },
    { id: "prompt_payment", name: "Prompt payment discount", default_pct: 3, active: true },
    { id: "rebate", name: "Rebate", default_pct: 2, active: false },
  ],
  staff_costs: [
    { role_id: "partner",   role_name: "Partner",          daily_cost: 0    },
    { role_id: "manager",   role_name: "Manager",          daily_cost: 400  },
    { role_id: "associate", role_name: "Associate",        daily_cost: 283  },
    { role_id: "analyst",   role_name: "Analyst",          daily_cost: 220  },
    { role_id: "counsel",   role_name: "Counsel / Expert", daily_cost: 1500 },
  ],
  rate_matrix: [
    // ── PE clients (3 revenue bands: <€200M, €200M-€1B, >€1B) ──
    {
      client_type: "PE >€1B",
      rates: {
        Italy:  { min_weekly: 30000, max_weekly: 34000, note: "", avoid: false },
        France: { min_weekly: 32000, max_weekly: 36000, note: "", avoid: false },
        UK:     { min_weekly: 36000, max_weekly: 42000, note: "", avoid: false },
        DACH:   { min_weekly: 34000, max_weekly: 40000, note: "", avoid: false },
        US:     { min_weekly: 42000, max_weekly: 50000, note: "", avoid: false },
      },
    },
    {
      client_type: "PE €200M-€1B",
      rates: {
        Italy:  { min_weekly: 26000, max_weekly: 32000, note: "", avoid: false },
        France: { min_weekly: 28000, max_weekly: 34000, note: "", avoid: false },
        UK:     { min_weekly: 32000, max_weekly: 38000, note: "", avoid: false },
        DACH:   { min_weekly: 30000, max_weekly: 36000, note: "", avoid: false },
        US:     { min_weekly: 38000, max_weekly: 46000, note: "", avoid: false },
      },
    },
    {
      client_type: "PE <€200M",
      rates: {
        Italy:  { min_weekly: 20000, max_weekly: 26000, note: "", avoid: false },
        France: { min_weekly: 22000, max_weekly: 28000, note: "", avoid: false },
        UK:     { min_weekly: 26000, max_weekly: 32000, note: "", avoid: false },
        DACH:   { min_weekly: 24000, max_weekly: 30000, note: "", avoid: false },
        US:     { min_weekly: 31000, max_weekly: 39000, note: "", avoid: false },
      },
    },
    // ── Family / Corporate clients (3 revenue bands) ──
    {
      client_type: "Family >€200M",
      rates: {
        Italy:  { min_weekly: 18000, max_weekly: 24000, note: "", avoid: false },
        France: { min_weekly: 20000, max_weekly: 26000, note: "", avoid: false },
        UK:     { min_weekly: 22000, max_weekly: 28000, note: "", avoid: false },
        DACH:   { min_weekly: 20000, max_weekly: 26000, note: "", avoid: false },
        US:     { min_weekly: 0, max_weekly: 0, note: "", avoid: true },
      },
    },
    {
      client_type: "Family €100M-€200M",
      rates: {
        Italy:  { min_weekly: 14000, max_weekly: 20000, note: "", avoid: false },
        France: { min_weekly: 16000, max_weekly: 22000, note: "", avoid: false },
        UK:     { min_weekly: 18000, max_weekly: 24000, note: "", avoid: false },
        DACH:   { min_weekly: 16000, max_weekly: 22000, note: "", avoid: false },
        US:     { min_weekly: 0, max_weekly: 0, note: "", avoid: true },
      },
    },
    {
      client_type: "Family <€100M",
      rates: {
        Italy:  { min_weekly: 10000, max_weekly: 15000, note: "", avoid: false },
        France: { min_weekly: 12000, max_weekly: 16000, note: "", avoid: false },
        UK:     { min_weekly: 0, max_weekly: 0, note: "", avoid: true },
        DACH:   { min_weekly: 0, max_weekly: 0, note: "", avoid: true },
        US:     { min_weekly: 0, max_weekly: 0, note: "", avoid: true },
      },
    },
  ],
  bracket_low_pct: 10,
  bracket_high_pct: 15,
  aggressive_threshold_pct: 20,
  conservative_threshold_pct: 15,
  min_comparables: 3,
  fund_anchor_weight: 0.4,
  win_loss_weight: 0.6,
  competitor_benchmarks: [
    {
      tier: "tier1", label: "Tier 1 (MBB)", color: "#7c3aed",
      rates: {
        Italy:  { min_weekly: 80000,  max_weekly: 150000 },
        France: { min_weekly: 90000,  max_weekly: 165000 },
        UK:     { min_weekly: 100000, max_weekly: 185000 },
        DACH:   { min_weekly: 90000,  max_weekly: 165000 },
        US:     { min_weekly: 120000, max_weekly: 220000 },
      },
      sources: ["Source Global Research Annual Survey", "Kennedy Research Consulting Fee Study"],
    },
    {
      tier: "tier2", label: "Tier 2 (OW, SKP, Kearney)", color: "#2563eb",
      rates: {
        Italy:  { min_weekly: 40000, max_weekly: 85000  },
        France: { min_weekly: 45000, max_weekly: 95000  },
        UK:     { min_weekly: 55000, max_weekly: 115000 },
        DACH:   { min_weekly: 50000, max_weekly: 100000 },
        US:     { min_weekly: 70000, max_weekly: 140000 },
      },
      sources: ["Consultancy.eu Market Report", "ALM Intelligence Management Consulting Fee Survey"],
    },
    {
      tier: "big4", label: "Big 4", color: "#059669",
      rates: {
        Italy:  { min_weekly: 18000, max_weekly: 42000 },
        France: { min_weekly: 22000, max_weekly: 48000 },
        UK:     { min_weekly: 28000, max_weekly: 58000 },
        DACH:   { min_weekly: 24000, max_weekly: 52000 },
        US:     { min_weekly: 38000, max_weekly: 72000 },
      },
      sources: ["ProcureEx Consulting Procurement Benchmark", "Staffing Industry Analysts Fee Survey"],
    },
  ],
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function BaselineBadge() {
  return (
    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 text-xs font-medium">
      Baseline
    </Badge>
  );
}

function InfoTooltip({ content }: { content: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help inline-block ml-1" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Tab: Roles & Rates ───────────────────────────────────────────────────────

interface RolesTabProps {
  roles: PricingRole[];
  onChange: (roles: PricingRole[]) => void;
  staffCosts: StaffCostEntry[];
  onStaffCostChange: (costs: StaffCostEntry[]) => void;
  onSave: () => void;
  saving: boolean;
}

function RolesTab({ roles, onChange, staffCosts, onStaffCostChange, onSave, saving }: RolesTabProps) {

  const updateRole = (id: string, patch: Partial<PricingRole>) =>
    onChange(roles.map(r => r.id === id ? { ...r, ...patch } : r));

  const toggleActive = (id: string) =>
    onChange(roles.map(r => r.id === id ? { ...r, active: !r.active } : r));

  const addRole = () => {
    onChange([...roles, {
      id: crypto.randomUUID(),
      role_name: "",
      default_daily_rate: 1000,
      active: true,
      sort_order: roles.length + 1,
    }]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            Consultant Roles
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Edit directly — all fields are always editable. Click Save when done.
          </p>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-8 text-center">#</TableHead>
              <TableHead>Role Name</TableHead>
              <TableHead className="text-right">Daily Rate (€)</TableHead>
              <TableHead className="text-right">Internal Cost (€/day)</TableHead>
              <TableHead className="text-right">Rate / Cost ×</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-center w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role, idx) => {
              const entry = staffCosts.find(c => c.role_id === role.id);
              const cost = entry?.daily_cost ?? 0;
              const ratio = cost > 0 ? role.default_daily_rate / cost : null;
              const ratioColor = ratio === null ? "" : ratio >= 5 ? "text-emerald-600" : ratio >= 3 ? "text-amber-600" : "text-red-500";

              return (
                <TableRow key={role.id} className={!role.active ? "opacity-50" : undefined}>
                  <TableCell className="text-center text-xs text-muted-foreground">{idx + 1}</TableCell>

                  <TableCell>
                    <Input
                      value={role.role_name}
                      onChange={e => updateRole(role.id, { role_name: e.target.value })}
                      className="h-9 text-sm border-0 shadow-none focus-visible:ring-1 px-1"
                      placeholder="Role name"
                    />
                  </TableCell>

                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="50"
                      min="0"
                      value={role.default_daily_rate}
                      onChange={e => updateRole(role.id, { default_daily_rate: parseFloat(e.target.value) || 0 })}
                      className="h-9 text-sm text-right w-28 ml-auto font-mono border-0 shadow-none focus-visible:ring-1 px-1"
                    />
                  </TableCell>

                  <TableCell className="text-right">
                    <Input
                      type="number"
                      step="50"
                      min="0"
                      value={cost || ""}
                      placeholder="0"
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0;
                        if (entry) {
                          onStaffCostChange(staffCosts.map(c => c.role_id === role.id ? { ...c, daily_cost: val } : c));
                        } else {
                          onStaffCostChange([...staffCosts, { role_id: role.id, role_name: role.role_name, daily_cost: val }]);
                        }
                      }}
                      className="h-9 text-sm text-right w-28 ml-auto font-mono border-0 shadow-none focus-visible:ring-1 px-1"
                    />
                  </TableCell>

                  <TableCell className="text-right">
                    {ratio !== null
                      ? <span className={`font-bold text-sm font-mono ${ratioColor}`}>{ratio.toFixed(1)}×</span>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>

                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => toggleActive(role.id)}
                      className={`text-xs font-medium px-2 py-0.5 rounded-full border transition-colors ${
                        role.active
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                          : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                      }`}
                    >
                      {role.active ? "Active" : "Inactive"}
                    </button>
                  </TableCell>

                  <TableCell className="text-center">
                    <Button
                      size="icon" variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => { if (confirm(`Remove "${role.role_name}"?`)) onChange(roles.filter(r => r.id !== role.id)); }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" size="sm" onClick={addRole}>
          <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Role
        </Button>
        <Button onClick={onSave} disabled={saving} size="sm">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

// ─── Tab: Regions ─────────────────────────────────────────────────────────────

interface RegionsTabProps {
  regions: PricingRegion[];
  onChange: (regions: PricingRegion[]) => void;
  onSave: () => void;
  saving: boolean;
}

function RegionsTab({ regions, onChange, onSave, saving }: RegionsTabProps) {
  const updateMultiplier = (id: string, value: number) => {
    onChange(regions.map((r) => (r.id === id ? { ...r, multiplier: value } : r)));
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Regional Multipliers
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Italy is the baseline (1.0×). Other regions adjust pricing relative to Italy.
          A value of 1.30 means 30% above Italy rates.
        </p>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>Region</TableHead>
              <TableHead className="text-center">Multiplier</TableHead>
              <TableHead className="text-center">vs Italy</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {regions.map((region) => {
              const delta = ((region.multiplier - 1) * 100).toFixed(0);
              const isPositive = region.multiplier > 1;
              const isNeutral = region.multiplier === 1;

              return (
                <TableRow
                  key={region.id}
                  className={region.is_baseline ? "bg-emerald-50/50" : undefined}
                >
                  <TableCell className="font-medium text-sm">{region.region_name}</TableCell>
                  <TableCell className="text-center">
                    {region.is_baseline ? (
                      <div className="flex items-center justify-center gap-1">
                        <span className="font-mono text-sm">1.00</span>
                        <Lock className="w-3 h-3 text-muted-foreground" />
                      </div>
                    ) : (
                      <Input
                        type="number"
                        step="0.01"
                        min="0.1"
                        max="5"
                        value={region.multiplier}
                        onChange={(e) =>
                          updateMultiplier(region.id, parseFloat(e.target.value) || 1)
                        }
                        className="h-9 text-sm text-center w-24 mx-auto font-mono"
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {region.is_baseline ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={`text-xs font-medium ${
                          isNeutral
                            ? "text-muted-foreground"
                            : isPositive
                            ? "text-blue-600"
                            : "text-amber-600"
                        }`}
                      >
                        {isPositive ? "+" : ""}
                        {delta}% vs Italy
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {region.is_baseline ? (
                      <BaselineBadge />
                    ) : (
                      <span className="text-xs text-muted-foreground">{region.multiplier}×</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-700">
        <strong>Guide:</strong> 1.0× = same as Italy · 1.3× = 30% above Italy · 0.9× = 10% below Italy
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onSave} disabled={saving} size="sm">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

// ─── Tab: Client Multipliers ──────────────────────────────────────────────────

interface ClientMultipliersTabProps {
  ownershipMultipliers: OwnershipMultiplier[];
  revenueBandMultipliers: RevenueBandMultiplier[];
  onOwnershipChange: (items: OwnershipMultiplier[]) => void;
  onRevenueBandChange: (items: RevenueBandMultiplier[]) => void;
  onSave: () => void;
  saving: boolean;
}

function ClientMultipliersTab({
  ownershipMultipliers,
  revenueBandMultipliers,
  onOwnershipChange,
  onRevenueBandChange,
  onSave,
  saving,
}: ClientMultipliersTabProps) {
  const updateOwnership = (value: string, multiplier: number) => {
    onOwnershipChange(
      ownershipMultipliers.map((o) => (o.value === value ? { ...o, multiplier } : o))
    );
  };

  const updateRevenueBand = (value: string, multiplier: number) => {
    onRevenueBandChange(
      revenueBandMultipliers.map((r) => (r.value === value ? { ...r, multiplier } : r))
    );
  };

  return (
    <div className="space-y-6">
      <div className="p-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
        <strong>Reference client:</strong> PE-owned + Above $1B revenue = 1.0× (baseline). All other types apply a discount or premium relative to this combination.
      </div>

      {/* PE Ownership */}
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-sm">PE Ownership</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Adjust pricing based on whether the client is PE-backed.
          </p>
        </div>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Ownership Type</TableHead>
                <TableHead className="text-center">Multiplier</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ownershipMultipliers.map((item) => (
                <TableRow
                  key={item.value}
                  className={item.is_baseline ? "bg-emerald-50/50" : undefined}
                >
                  <TableCell className="font-medium text-sm">{item.label}</TableCell>
                  <TableCell className="text-center">
                    {item.is_baseline ? (
                      <div className="flex items-center justify-center gap-1">
                        <span className="font-mono text-sm">1.00</span>
                        <Lock className="w-3 h-3 text-muted-foreground" />
                      </div>
                    ) : (
                      <Input
                        type="number"
                        step="0.01"
                        min="0.1"
                        max="3"
                        value={item.multiplier}
                        onChange={(e) =>
                          updateOwnership(item.value, parseFloat(e.target.value) || 1)
                        }
                        className="h-9 text-sm text-center w-24 mx-auto font-mono"
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {item.is_baseline ? (
                      <BaselineBadge />
                    ) : (
                      <span className="text-xs text-muted-foreground">{item.multiplier}×</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Revenue Band */}
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-sm">Revenue Band</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Adjust pricing based on client annual revenue. Above $1B is the baseline.
          </p>
        </div>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Revenue Band</TableHead>
                <TableHead className="text-center">Multiplier</TableHead>
                <TableHead className="text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revenueBandMultipliers.map((item) => (
                <TableRow
                  key={item.value}
                  className={item.is_baseline ? "bg-emerald-50/50" : undefined}
                >
                  <TableCell className="font-medium text-sm">{item.label}</TableCell>
                  <TableCell className="text-center">
                    {item.is_baseline ? (
                      <div className="flex items-center justify-center gap-1">
                        <span className="font-mono text-sm">1.00</span>
                        <Lock className="w-3 h-3 text-muted-foreground" />
                      </div>
                    ) : (
                      <Input
                        type="number"
                        step="0.01"
                        min="0.1"
                        max="3"
                        value={item.multiplier}
                        onChange={(e) =>
                          updateRevenueBand(item.value, parseFloat(e.target.value) || 1)
                        }
                        className="h-9 text-sm text-center w-24 mx-auto font-mono"
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {item.is_baseline ? (
                      <BaselineBadge />
                    ) : (
                      <span className="text-xs text-muted-foreground">{item.multiplier}×</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onSave} disabled={saving} size="sm">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

// ─── Tab: Sensitivity ─────────────────────────────────────────────────────────

interface SensitivityTabProps {
  multipliers: SensitivityMultiplier[];
  onChange: (multipliers: SensitivityMultiplier[]) => void;
  onSave: () => void;
  saving: boolean;
}

const SENSITIVITY_DESCRIPTIONS: Record<string, string> = {
  low: "Client is price-insensitive. Premium pricing is feasible — they prioritise quality and relationships over cost.",
  medium: "Standard price sensitivity. The client compares offers but quality and fit still matter.",
  high: "Client is highly price-sensitive. Competitive pricing is essential; a 10–15% premium may lose the deal.",
};

function SensitivityTab({ multipliers, onChange, onSave, saving }: SensitivityTabProps) {
  const updateMultiplier = (value: string, multiplier: number) => {
    onChange(multipliers.map((m) => (m.value === value ? { ...m, multiplier } : m)));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            Price Sensitivity Multipliers
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Applied based on the assessed price sensitivity of the client.
            <InfoTooltip content="Price sensitivity reflects how likely a client is to select a cheaper option. Low sensitivity = clients who value expertise and relationships. High sensitivity = cost-driven procurement processes." />
          </p>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead>Sensitivity Level</TableHead>
              <TableHead className="text-center">Multiplier</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {multipliers.map((item) => {
              const isMedium = item.value === "medium";
              return (
                <TableRow
                  key={item.value}
                  className={isMedium ? "bg-emerald-50/50" : undefined}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          item.value === "low"
                            ? "bg-blue-400"
                            : item.value === "medium"
                            ? "bg-emerald-400"
                            : "bg-amber-400"
                        }`}
                      />
                      <span className="font-medium text-sm capitalize">{item.label}</span>
                      {isMedium && <BaselineBadge />}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Input
                      type="number"
                      step="0.01"
                      min="0.1"
                      max="3"
                      value={item.multiplier}
                      onChange={(e) =>
                        updateMultiplier(item.value, parseFloat(e.target.value) || 1)
                      }
                      className="h-9 text-sm text-center w-24 mx-auto font-mono"
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {SENSITIVITY_DESCRIPTIONS[item.value]}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onSave} disabled={saving} size="sm">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

// ─── Tab: Bracket & Rules ─────────────────────────────────────────────────────

interface BracketRulesTabProps {
  settings: PricingSettings;
  onChange: (patch: Partial<PricingSettings>) => void;
  onSave: () => void;
  saving: boolean;
}

function BracketRulesTab({ settings, onChange, onSave, saving }: BracketRulesTabProps) {
  return (
    <div className="space-y-6">
      {/* Bracket Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bracket Settings</CardTitle>
          <CardDescription className="text-xs">
            Define how wide the pricing bracket is around the target price. The bracket is shown to
            clients as a range (low – target – high).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-sm">
              Low bracket offset (%)
              <InfoTooltip content="The low end of the bracket = Target − X%. E.g. 10 means the low price is 10% below the target." />
            </Label>
            <div className="relative">
              <Input
                type="number"
                step="0.5"
                min="0"
                max="50"
                value={settings.bracket_low_pct}
                onChange={(e) =>
                  onChange({ bracket_low_pct: parseFloat(e.target.value) || 0 })
                }
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                %
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Low = Target − {settings.bracket_low_pct}%
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">
              High bracket offset (%)
              <InfoTooltip content="The high end of the bracket = Target + Y%. E.g. 15 means the high price is 15% above the target." />
            </Label>
            <div className="relative">
              <Input
                type="number"
                step="0.5"
                min="0"
                max="50"
                value={settings.bracket_high_pct}
                onChange={(e) =>
                  onChange({ bracket_high_pct: parseFloat(e.target.value) || 0 })
                }
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                %
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              High = Target + {settings.bracket_high_pct}%
            </p>
          </div>

          <div className="sm:col-span-2 p-3 rounded-lg bg-muted/40 border text-xs text-muted-foreground">
            <strong>Example:</strong> If target = €100k, the bracket will be shown as{" "}
            <strong>
              €{(100 * (1 - settings.bracket_low_pct / 100)).toFixed(0)}k – €100k – €
              {(100 * (1 + settings.bracket_high_pct / 100)).toFixed(0)}k
            </strong>
          </div>
        </CardContent>
      </Card>

      {/* Win/Loss Intelligence */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Win/Loss Intelligence Thresholds</CardTitle>
          <CardDescription className="text-xs">
            Configure how historical win/loss data influences pricing recommendations. These
            thresholds determine when to flag a price as aggressive or conservative.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-sm">
              Aggressive threshold (%)
              <InfoTooltip content="If the proposed price is this % above the historical average win price, it is flagged as 'aggressive'." />
            </Label>
            <div className="relative">
              <Input
                type="number"
                step="1"
                min="0"
                max="100"
                value={settings.aggressive_threshold_pct}
                onChange={(e) =>
                  onChange({ aggressive_threshold_pct: parseFloat(e.target.value) || 0 })
                }
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                %
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Flag if price is {settings.aggressive_threshold_pct}%+ above historical average
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">
              Conservative threshold (%)
              <InfoTooltip content="If the proposed price is this % below the historical average win price, it is flagged as 'conservative' (leaving money on the table)." />
            </Label>
            <div className="relative">
              <Input
                type="number"
                step="1"
                min="0"
                max="100"
                value={settings.conservative_threshold_pct}
                onChange={(e) =>
                  onChange({ conservative_threshold_pct: parseFloat(e.target.value) || 0 })
                }
                className="pr-8"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                %
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Flag if price is {settings.conservative_threshold_pct}%+ below historical average
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">
              Minimum comparables
              <InfoTooltip content="Minimum number of historical deals needed before win/loss intelligence is applied. Below this threshold, the system uses multipliers only." />
            </Label>
            <Input
              type="number"
              step="1"
              min="1"
              max="50"
              value={settings.min_comparables}
              onChange={(e) =>
                onChange({ min_comparables: parseInt(e.target.value) || 1 })
              }
            />
            <p className="text-xs text-muted-foreground">
              Need at least {settings.min_comparables} comparable deal(s)
            </p>
          </div>

          <div className="space-y-2" />

          <div className="space-y-3">
            <Label className="text-sm">
              Fund anchor weight
              <InfoTooltip content="Weight (0–1) given to the fund's historical pricing anchor when blending with win/loss data. Higher = fund anchor matters more." />
            </Label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.fund_anchor_weight}
                onChange={(e) =>
                  onChange({ fund_anchor_weight: parseFloat(e.target.value) })
                }
                className="flex-1 accent-primary"
              />
              <span className="font-mono text-sm w-10 text-right">
                {settings.fund_anchor_weight.toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              0 = ignore fund anchor · 1 = use only fund anchor
            </p>
          </div>

          <div className="space-y-3">
            <Label className="text-sm">
              Win/loss weight
              <InfoTooltip content="Weight (0–1) given to win/loss historical data when blending signals. Should sum to ~1 with fund anchor weight." />
            </Label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.win_loss_weight}
                onChange={(e) =>
                  onChange({ win_loss_weight: parseFloat(e.target.value) })
                }
                className="flex-1 accent-primary"
              />
              <span className="font-mono text-sm w-10 text-right">
                {settings.win_loss_weight.toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              0 = ignore win/loss data · 1 = rely entirely on win/loss
            </p>
          </div>

          {Math.abs(settings.fund_anchor_weight + settings.win_loss_weight - 1) > 0.01 && (
            <div className="sm:col-span-2 p-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
              Fund anchor weight + Win/loss weight ={" "}
              {(settings.fund_anchor_weight + settings.win_loss_weight).toFixed(2)} (ideally 1.00)
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end pt-2">
        <Button onClick={onSave} disabled={saving} size="sm">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

// ─── Tab: Discounts & Staff Costs ────────────────────────────────────────────

interface DiscountsAndCostsTabProps {
  settings: PricingSettings;
  onChange: (patch: Partial<PricingSettings>) => void;
  onSave: () => void;
  saving: boolean;
}

function DiscountsAndCostsTab({ settings, onChange, onSave, saving }: DiscountsAndCostsTabProps) {
  const discounts: PricingDiscount[] = settings.discounts ?? [];
  const staffCosts: StaffCostEntry[] = settings.staff_costs ?? [];
  const [newName, setNewName] = useState("");
  const [newPct, setNewPct] = useState<number>(0);

  const updateDiscount = (id: string, field: keyof PricingDiscount, value: any) => {
    onChange({ discounts: discounts.map(d => d.id === id ? { ...d, [field]: value } : d) });
  };

  const addDiscount = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const newDiscount: PricingDiscount = {
      id: crypto.randomUUID(),
      name: trimmed,
      default_pct: newPct,
      active: true,
    };
    onChange({ discounts: [...discounts, newDiscount] });
    setNewName("");
    setNewPct(0);
  };

  const removeDiscount = (id: string) => {
    onChange({ discounts: discounts.filter(d => d.id !== id) });
  };

  const updateStaffCost = (role_id: string, daily_cost: number) => {
    onChange({ staff_costs: staffCosts.map(c => c.role_id === role_id ? { ...c, daily_cost } : c) });
  };

  return (
    <div className="space-y-6">
      {/* Discounts */}
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Commercial Discounts</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define discount types and their default percentages. These appear as options when building a pricing case.
          </p>
        </div>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Discount Name</TableHead>
                <TableHead className="text-center w-36">Default %</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {discounts.map(d => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Input
                      value={d.name}
                      onChange={e => updateDiscount(d.id, "name", e.target.value)}
                      className="h-9 text-sm"
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="relative flex items-center justify-center">
                      <Input
                        type="number"
                        step="0.5"
                        min="0"
                        max="100"
                        value={d.default_pct}
                        onChange={e => updateDiscount(d.id, "default_pct", parseFloat(e.target.value) || 0)}
                        className="h-9 text-sm text-center w-24 font-mono pr-6"
                      />
                      <span className="absolute right-2 text-muted-foreground text-sm">%</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => removeDiscount(d.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex gap-2 items-center">
          <Input
            placeholder="Discount name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addDiscount()}
            className="h-9 text-sm max-w-xs"
          />
          <div className="relative flex items-center">
            <Input
              type="number"
              step="0.5"
              min="0"
              max="100"
              value={newPct}
              onChange={e => setNewPct(parseFloat(e.target.value) || 0)}
              className="h-9 text-sm text-center w-20 font-mono pr-6"
            />
            <span className="absolute right-2 text-muted-foreground text-sm">%</span>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={addDiscount} disabled={!newName.trim()}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {/* Staff costs */}
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Staff Daily Costs</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Internal cost per consultant day (€). Used to compute gross margin on each case.
            Set to 0 for partners or roles where cost is not tracked.
          </p>
        </div>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Daily Cost (€)</TableHead>
                <TableHead className="text-right text-muted-foreground text-xs">Weekly equiv. (5d)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staffCosts.map(c => (
                <TableRow key={c.role_id}>
                  <TableCell className="font-medium text-sm">{c.role_name}</TableCell>
                  <TableCell>
                    <div className="relative flex items-center justify-end">
                      <span className="absolute left-2 text-muted-foreground text-sm">€</span>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={c.daily_cost}
                        onChange={e => updateStaffCost(c.role_id, parseFloat(e.target.value) || 0)}
                        className="h-9 text-sm text-right w-28 font-mono pl-6"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm font-mono">
                    {c.daily_cost > 0 ? `€${(c.daily_cost * 5).toLocaleString("it-IT")}` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onSave} disabled={saving} size="sm">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

// ─── Tab: PE Funds ────────────────────────────────────────────────────────────

interface FundsTabProps {
  settings: PricingSettings;
  onChange: (patch: Partial<PricingSettings>) => void;
  onSave: () => void;
  saving: boolean;
}

function FundsTab({ settings, onChange, onSave, saving }: FundsTabProps) {
  const funds = settings.funds ?? [];
  const [newFund, setNewFund] = useState("");

  const addFund = () => {
    const trimmed = newFund.trim().toUpperCase();
    if (!trimmed || funds.includes(trimmed)) return;
    onChange({ funds: [...funds, trimmed] });
    setNewFund("");
  };

  const removeFund = (fund: string) => {
    onChange({ funds: funds.filter((f) => f !== fund) });
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">PE Fund Names</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Define the list of PE funds available as dropdown options when creating pricing cases.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {funds.map((fund) => (
          <div
            key={fund}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium border border-primary/20"
          >
            {fund}
            <button
              type="button"
              onClick={() => removeFund(fund)}
              className="text-primary/60 hover:text-destructive transition-colors ml-0.5"
              aria-label={`Remove ${fund}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {funds.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No funds configured.</p>
        )}
      </div>

      <div className="flex gap-2 items-center">
        <Input
          placeholder="Fund name (e.g. BLACKSTONE)"
          value={newFund}
          onChange={(e) => setNewFund(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && addFund()}
          className="h-9 text-sm uppercase max-w-xs"
        />
        <Button type="button" size="sm" variant="outline" onClick={addFund} disabled={!newFund.trim()}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add Fund
        </Button>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onSave} disabled={saving} size="sm">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

// ─── Tab: Rate Matrix ─────────────────────────────────────────────────────────

const RATE_MATRIX_REGIONS = ["Italy", "France", "UK", "DACH", "US"];

// Map matrix region labels → admin region codes for multiplier lookup
const MATRIX_REGION_TO_CODE: Record<string, string> = {
  Italy: "IT", France: "FR", UK: "UK", DACH: "DE", US: "US",
};

interface RateMatrixTabProps {
  settings: PricingSettings;
  onChange: (patch: Partial<PricingSettings>) => void;
  onSave: () => void;
  saving: boolean;
}

function RateMatrixTab({ settings, onChange, onSave, saving }: RateMatrixTabProps) {
  const regions = settings.regions ?? [];

  // Ensure all 6 default rows exist (3 PE + 3 Family). If the saved matrix
  // is missing rows (e.g. old "PE/LBO" single row), fill in from defaults.
  const REQUIRED_ROWS = [
    "PE >€1B", "PE €200M-€1B", "PE <€200M",
    "Family >€200M", "Family €100M-€200M", "Family <€100M",
  ];
  const rawMatrix: RateMatrixRow[] = settings.rate_matrix ?? [];
  const matrix: RateMatrixRow[] = REQUIRED_ROWS.map(ct => {
    const existing = rawMatrix.find(r => r.client_type === ct);
    if (existing) return existing;
    // Pull from defaults
    const def = DEFAULT_SETTINGS.rate_matrix.find(r => r.client_type === ct);
    return def ?? { client_type: ct, rates: {} };
  });
  // Also keep any custom rows the user added beyond the 6 defaults
  const extraRows = rawMatrix.filter(r => !REQUIRED_ROWS.includes(r.client_type));
  const fullMatrix = [...matrix, ...extraRows];
  // If we added missing rows, persist them
  if (fullMatrix.length !== rawMatrix.length || REQUIRED_ROWS.some(ct => !rawMatrix.find(r => r.client_type === ct))) {
    setTimeout(() => onChange({ rate_matrix: fullMatrix }), 0);
  }

  // Find the baseline region (Italy by default)
  const baselineRegion = regions.find(r => r.is_baseline) ?? regions[0];
  const baselineLabel = RATE_MATRIX_REGIONS.find(label => {
    const code = MATRIX_REGION_TO_CODE[label];
    return code && baselineRegion && baselineRegion.region_name === code;
  }) ?? "Italy";

  // Get multiplier for a matrix region label
  const getMultiplier = (matrixRegion: string): number => {
    const code = MATRIX_REGION_TO_CODE[matrixRegion];
    if (!code) return 1;
    const adminRegion = regions.find(r => r.region_name === code);
    return adminRegion?.multiplier ?? 1;
  };

  // When user edits the baseline, auto-compute all other regions
  const updateBaselineCell = (rowIdx: number, field: "min_weekly" | "max_weekly", value: number) => {
    const newMatrix = fullMatrix.map((row, i) => {
      if (i !== rowIdx) return row;
      const newRates = { ...row.rates };
      // Update baseline
      const baseCell = newRates[baselineLabel] ?? { min_weekly: 0, max_weekly: 0, note: "", avoid: false };
      newRates[baselineLabel] = { ...baseCell, [field]: value };
      // Auto-compute other regions from baseline values
      const updatedBase = newRates[baselineLabel];
      for (const region of RATE_MATRIX_REGIONS) {
        if (region === baselineLabel) continue;
        const existing = newRates[region] ?? { min_weekly: 0, max_weekly: 0, note: "", avoid: false };
        if (existing.avoid) continue; // don't touch avoided regions
        const mult = getMultiplier(region);
        newRates[region] = {
          ...existing,
          min_weekly: Math.round(updatedBase.min_weekly * mult / 500) * 500,
          max_weekly: Math.round(updatedBase.max_weekly * mult / 500) * 500,
        };
      }
      return { ...row, rates: newRates };
    });
    onChange({ rate_matrix: newMatrix });
  };

  const toggleAvoid = (rowIdx: number, region: string, avoid: boolean) => {
    const newMatrix = fullMatrix.map((row, i) => {
      if (i !== rowIdx) return row;
      const cell = row.rates[region] ?? { min_weekly: 0, max_weekly: 0, note: "", avoid: false };
      const newRates = { ...row.rates, [region]: { ...cell, avoid } };
      // If un-avoiding, auto-compute from baseline
      if (!avoid) {
        const baseCell = row.rates[baselineLabel] ?? { min_weekly: 0, max_weekly: 0, note: "", avoid: false };
        const mult = getMultiplier(region);
        newRates[region] = {
          min_weekly: Math.round(baseCell.min_weekly * mult / 500) * 500,
          max_weekly: Math.round(baseCell.max_weekly * mult / 500) * 500,
          note: "", avoid: false,
        };
      }
      return { ...row, rates: newRates };
    });
    onChange({ rate_matrix: newMatrix });
  };

  const peRows = fullMatrix.filter(r => r.client_type.startsWith("PE"));
  const familyRows = fullMatrix.filter(r => !r.client_type.startsWith("PE"));

  const fmtK = (n: number) => n >= 1000 ? `€${Math.round(n / 1000)}k` : `€${n}`;
  const fmtN = (n: number) => n.toLocaleString("it-IT");

  const renderMatrixTable = (rows: RateMatrixRow[], title: string, colorClass: string) => (
    <div className="space-y-2">
      <div className={`text-sm font-bold ${colorClass}`}>{title}</div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[#1A3A4A] text-white">
              <th rowSpan={2} className="text-left px-3 py-2 font-bold text-xs uppercase tracking-wide border-r border-white/20 min-w-[160px]">Client Type</th>
              {RATE_MATRIX_REGIONS.map(region => {
                const isBase = region === baselineLabel;
                const mult = getMultiplier(region);
                return (
                  <th key={region} colSpan={2} className="text-center px-2 py-1.5 font-bold text-xs uppercase tracking-wide border-r border-white/20 last:border-r-0">
                    {region}
                    {!isBase && <span className="ml-1 text-[9px] font-normal opacity-70">×{mult.toFixed(2)}</span>}
                    {isBase && <span className="ml-1 text-[9px] font-normal opacity-70">base</span>}
                  </th>
                );
              })}
            </tr>
            <tr className="bg-[#1A3A4A]/80 text-white/80">
              {RATE_MATRIX_REGIONS.map(region => (
                <React.Fragment key={region}>
                  <th className="text-center px-1.5 py-1 text-[10px] font-semibold border-r border-white/10 w-20">Min</th>
                  <th className="text-center px-1.5 py-1 text-[10px] font-semibold border-r border-white/20 last:border-r-0 w-20">Max</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const rowIdx = fullMatrix.indexOf(row);
              const isBase = (region: string) => region === baselineLabel;
              return (
                <tr key={row.client_type} className={ri % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                  <td className="px-3 py-2.5 font-semibold text-xs border-r border-border whitespace-nowrap">{row.client_type}</td>
                  {RATE_MATRIX_REGIONS.map(region => {
                    const cell: RateMatrixCell = row.rates[region] ?? { min_weekly: 0, max_weekly: 0, note: "", avoid: false };
                    return cell.avoid ? (
                      <td key={region} colSpan={2} className="text-center py-2 px-1 border-r border-border last:border-r-0">
                        <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100 text-[10px]">AVOID</Badge>
                        <button type="button" onClick={() => toggleAvoid(rowIdx, region, false)}
                          className="block mx-auto text-[9px] text-muted-foreground hover:text-foreground underline mt-0.5">set range</button>
                      </td>
                    ) : isBase(region) ? (
                      /* Baseline (Italy) — editable */
                      <React.Fragment key={region}>
                        <td className="py-1.5 px-1 border-r border-border/50 text-center bg-primary/5">
                          <Input type="number" step="500" min="0" value={cell.min_weekly}
                            onChange={e => updateBaselineCell(rowIdx, "min_weekly", parseInt(e.target.value) || 0)}
                            className="h-7 text-xs text-center font-mono w-full px-1 border-primary/30" />
                        </td>
                        <td className="py-1.5 px-1 border-r border-border last:border-r-0 text-center bg-primary/5">
                          <Input type="number" step="500" min="0" value={cell.max_weekly}
                            onChange={e => updateBaselineCell(rowIdx, "max_weekly", parseInt(e.target.value) || 0)}
                            className="h-7 text-xs text-center font-mono w-full px-1 border-primary/30" />
                        </td>
                      </React.Fragment>
                    ) : (
                      /* Non-baseline — auto-computed, read-only */
                      <React.Fragment key={region}>
                        <td className="py-2 px-1.5 border-r border-border/50 text-center font-mono text-xs text-muted-foreground">
                          {fmtN(cell.min_weekly)}
                        </td>
                        <td className="py-2 px-1.5 border-r border-border last:border-r-0 text-center">
                          <div className="font-mono text-xs text-muted-foreground">{fmtN(cell.max_weekly)}</div>
                          <button type="button" onClick={() => toggleAvoid(rowIdx, region, true)}
                            className="text-[8px] text-muted-foreground hover:text-red-600 underline mt-0.5">avoid</button>
                        </td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Fee Strategy Matrix</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Weekly rate reference ranges by client type and market. Split into PE and Family/Corporate matrices. Used as a sanity-check overlay on computed prices.
        </p>
      </div>

      {renderMatrixTable(peRows, "PE Fee Matrix", "text-primary")}
      {renderMatrixTable(familyRows, "Family / Corporate Fee Matrix", "text-amber-700")}

      <div className="flex justify-end pt-2">
        <Button onClick={onSave} disabled={saving} size="sm">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

// ─── Tabs list ────────────────────────────────────────────────────────────────

type TabId = "roles" | "regions" | "client_multipliers" | "sensitivity" | "bracket_rules" | "discounts_costs" | "funds" | "rate_matrix" | "market_benchmarks" | "price_adjustments" | "fund_defaults" | "sector_multipliers" | "project_types" | "sectors_list";

// ─── Tab: Market Benchmarks ───────────────────────────────────────────────────

const BENCHMARK_REGIONS = ["Italy", "France", "UK", "DACH", "US"] as const;
type BenchmarkRegion = typeof BENCHMARK_REGIONS[number];

const SOURCE_OPTIONS = [
  { label: "Source Global Research Annual Survey", url: "https://www.sourceglobalresearch.com" },
  { label: "Kennedy Research / ALM Intelligence Consulting Fee Study", url: "https://www.kennedyresearch.com" },
  { label: "Consultancy.eu European Market Report", url: "https://www.consultancy.eu" },
  { label: "ProcureEx Consulting Procurement Benchmark", url: "https://www.procureex.com" },
  { label: "Staffing Industry Analysts Fee Survey", url: "https://www2.staffingindustry.com" },
  { label: "Heidrick & Struggles Leadership Consulting Survey", url: "https://www.heidrick.com" },
];

// ─── Price Adjustments Tab ──────────────────────────────────────────────────

const DEFAULT_COMP_INTENSITY: PricingAdjustment[] = [
  { value: "sole_source", label: "Sole source",        adj_pct: 15  },
  { value: "limited",     label: "Limited competition", adj_pct: 5   },
  { value: "competitive", label: "Competitive",         adj_pct: 0   },
  { value: "crowded",     label: "Crowded market",      adj_pct: -15 },
];
const DEFAULT_COMP_TYPE: PricingAdjustment[] = [
  { value: "none",      label: "No competitor",  adj_pct: 0   },
  { value: "boutiques", label: "Boutiques",      adj_pct: -5  },
  { value: "tier2",     label: "Tier 2 firms",   adj_pct: 0   },
  { value: "mbb",       label: "MBB present",    adj_pct: 15  },
];
const DEFAULT_STRAT_INTENT: PricingAdjustment[] = [
  { value: "enter",   label: "Enter new client (beachhead)", adj_pct: -15 },
  { value: "expand",  label: "Expand relationship",          adj_pct: 0   },
  { value: "harvest", label: "Harvest (optimise margin)",    adj_pct: 15  },
];

function PriceAdjustmentsTab({ settings, onChange, onSave, saving }: {
  settings: PricingSettings;
  onChange: (patch: Partial<PricingSettings>) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const SECTIONS: {
    title: string;
    key: "competitive_intensity_adj" | "competitor_type_adj" | "strategic_intent_adj";
    defaults: PricingAdjustment[];
    description: string;
  }[] = [
    { title: "Competitive Intensity (L2)", key: "competitive_intensity_adj", defaults: DEFAULT_COMP_INTENSITY,
      description: "How crowded the market is for this deal. Applied as % adjustment to the base price." },
    { title: "Competitor Type (L2)", key: "competitor_type_adj", defaults: DEFAULT_COMP_TYPE,
      description: "Who we're competing against. E.g. MBB presence validates a premium." },
    { title: "Strategic Intent (L5)", key: "strategic_intent_adj", defaults: DEFAULT_STRAT_INTENT,
      description: "Our strategic goal for this client relationship." },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Price Adjustments</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure the % adjustments applied by the pricing engine layers. These values are used directly in the waterfall calculation.
        </p>
      </div>

      {SECTIONS.map(sec => {
        const items: PricingAdjustment[] = (settings as any)[sec.key] ?? sec.defaults;
        return (
          <div key={sec.key} className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold">{sec.title}</h4>
              <p className="text-xs text-muted-foreground">{sec.description}</p>
            </div>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b">
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground w-36">Key</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Label</th>
                    <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground w-24">Adj %</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((a, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1.5">
                        <Input value={a.value}
                          onChange={e => {
                            const updated = items.map((v, j) => j === i ? { ...v, value: e.target.value } : v);
                            onChange({ [sec.key]: updated });
                          }}
                          className="h-7 text-xs font-mono" placeholder="key" />
                      </td>
                      <td className="px-3 py-1.5">
                        <Input value={a.label}
                          onChange={e => {
                            const updated = items.map((v, j) => j === i ? { ...v, label: e.target.value } : v);
                            onChange({ [sec.key]: updated });
                          }}
                          className="h-7 text-xs" placeholder="Label" />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <Input type="number" step="1" value={a.adj_pct}
                          onChange={e => {
                            const updated = items.map((v, j) => j === i ? { ...v, adj_pct: parseFloat(e.target.value) || 0 } : v);
                            onChange({ [sec.key]: updated });
                          }}
                          className="h-7 text-xs font-mono text-center w-20 mx-auto" />
                      </td>
                      <td className="px-1 py-1.5">
                        <button onClick={() => {
                          const updated = items.filter((_, j) => j !== i);
                          onChange({ [sec.key]: updated });
                        }} className="text-muted-foreground hover:text-destructive p-1">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button size="sm" variant="outline" onClick={() => {
              onChange({ [sec.key]: [...items, { value: "", label: "", adj_pct: 0 }] });
            }}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add
            </Button>
          </div>
        );
      })}

      <div className="flex justify-end pt-2">
        <Button onClick={onSave} disabled={saving} size="sm">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

// ─── Fund Defaults Tab ──────────────────────────────────────────────────────

function FundDefaultsTab({ settings, onChange, onSave, saving }: {
  settings: PricingSettings;
  onChange: (patch: Partial<PricingSettings>) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const funds = settings.funds ?? [];
  const defaults: FundDefaults[] = (settings as any).fund_defaults ?? [];

  const update = (idx: number, field: keyof FundDefaults, value: string | null) => {
    const updated = defaults.map((d, i) => i === idx ? { ...d, [field]: value } : d);
    onChange({ fund_defaults: updated } as any);
  };

  const addRow = (fundName: string) => {
    if (defaults.some(d => d.fund_name === fundName)) return;
    onChange({ fund_defaults: [...defaults, { fund_name: fundName }] } as any);
  };

  const removeRow = (idx: number) => {
    onChange({ fund_defaults: defaults.filter((_, i) => i !== idx) } as any);
  };

  const OPT = (label: string, options: { value: string; label: string }[], current: string | null | undefined, onCh: (v: string | null) => void) => (
    <Select value={current ?? "__none__"} onValueChange={v => onCh(v === "__none__" ? null : v)}>
      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">—</SelectItem>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Fund Defaults</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          When a fund is selected in a pricing case, these fields auto-fill. Leave blank to skip.
        </p>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/30 border-b">
              <th className="text-left px-3 py-2 font-semibold w-32">Fund</th>
              <th className="text-left px-2 py-2 font-semibold">Relationship</th>
              <th className="text-left px-2 py-2 font-semibold">Strategic Intent</th>
              <th className="text-left px-2 py-2 font-semibold">Competitive Intensity</th>
              <th className="text-left px-2 py-2 font-semibold">Price Sensitivity</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {defaults.map((d, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="px-3 py-1.5 font-semibold">{d.fund_name}</td>
                <td className="px-2 py-1.5">
                  {OPT("Relationship", [
                    { value: "new", label: "First-time" },
                    { value: "repeat", label: "Repeat" },
                    { value: "strategic", label: "Strategic" },
                  ], d.relationship_type, v => update(i, "relationship_type", v))}
                </td>
                <td className="px-2 py-1.5">
                  {OPT("Intent", [
                    { value: "enter", label: "Enter" },
                    { value: "expand", label: "Expand" },
                    { value: "harvest", label: "Harvest" },
                  ], d.strategic_intent, v => update(i, "strategic_intent", v))}
                </td>
                <td className="px-2 py-1.5">
                  {OPT("Competition", [
                    { value: "sole_source", label: "Sole source" },
                    { value: "limited", label: "Limited" },
                    { value: "competitive", label: "Competitive" },
                    { value: "crowded", label: "Crowded" },
                  ], d.competitive_intensity, v => update(i, "competitive_intensity", v))}
                </td>
                <td className="px-2 py-1.5">
                  {OPT("Sensitivity", [
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                  ], d.price_sensitivity, v => update(i, "price_sensitivity", v))}
                </td>
                <td className="px-1 py-1.5">
                  <button onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive p-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add fund buttons */}
      <div className="flex flex-wrap gap-2">
        {funds.filter(f => !defaults.some(d => d.fund_name === f)).map(f => (
          <Button key={f} size="sm" variant="outline" onClick={() => addRow(f)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> {f}
          </Button>
        ))}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onSave} disabled={saving} size="sm">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

interface MarketBenchmarksTabProps {
  settings: PricingSettings;
  onChange: (patch: Partial<PricingSettings>) => void;
  onSave?: () => void;
  saving?: boolean;
}

function MarketBenchmarksTab({ settings, onChange, onSave, saving }: MarketBenchmarksTabProps) {
  const benchmarks: CompetitorBenchmark[] = settings.competitor_benchmarks ?? DEFAULT_SETTINGS.competitor_benchmarks;
  const { toast } = useToast();

  const updateRate = (tierIdx: number, region: BenchmarkRegion, field: "min_weekly" | "max_weekly", val: number) => {
    const updated = benchmarks.map((b, i) =>
      i !== tierIdx ? b : {
        ...b,
        rates: { ...b.rates, [region]: { ...b.rates[region], [field]: val } },
      }
    );
    onChange({ competitor_benchmarks: updated });
  };

  const updateLabel = (tierIdx: number, label: string) => {
    onChange({ competitor_benchmarks: benchmarks.map((b, i) => i !== tierIdx ? b : { ...b, label }) });
  };

  const updateSources = (tierIdx: number, sources: string[]) => {
    onChange({ competitor_benchmarks: benchmarks.map((b, i) => i !== tierIdx ? b : { ...b, sources }) });
  };

  const fmt = (v: number) => `€${Math.round(v / 1000)}k`;

  const TIER_COLORS: Record<string, string> = {
    tier1: "#7c3aed",
    tier2: "#2563eb",
    big4:  "#059669",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="font-bold text-sm text-amber-900 mb-1">Market Benchmark Rates</div>
        <p className="text-xs text-amber-800">
          Estimated weekly fees for an <strong>EM+2 team</strong> (1 Engagement Manager + 2 Associates) by competitor tier and region.
          These are market estimates — update with latest data from the sources below. Shown as a reference bar in every Pricing Case.
        </p>
      </div>

      {/* Rate table per tier */}
      {benchmarks.map((bench, tidx) => (
        <div key={bench.tier} className="border rounded-lg overflow-hidden">
          <div
            className="px-4 py-2.5 flex items-center gap-3"
            style={{ backgroundColor: TIER_COLORS[bench.tier] ?? "#374151" }}
          >
            <input
              value={bench.label}
              onChange={e => updateLabel(tidx, e.target.value)}
              className="flex-1 bg-transparent text-white font-bold text-sm border-0 outline-none placeholder:text-white/50"
            />
          </div>

          {/* Sources */}
          <div className="px-4 py-2 bg-muted/30 border-b flex flex-wrap gap-1 items-center">
            <span className="text-[10px] text-muted-foreground font-semibold mr-1">Sources:</span>
            {SOURCE_OPTIONS.map(src => {
              const active = bench.sources.includes(src.label);
              return (
                <button
                  key={src.label}
                  onClick={() => updateSources(tidx, active
                    ? bench.sources.filter(s => s !== src.label)
                    : [...bench.sources, src.label]
                  )}
                  className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-primary font-bold"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                  title={src.url}
                >
                  {src.label}
                </button>
              );
            })}
          </div>

          {/* Rate grid */}
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 text-muted-foreground font-semibold">Region</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-semibold">Min /week</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-semibold">Max /week</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-semibold">Range</th>
              </tr>
            </thead>
            <tbody>
              {BENCHMARK_REGIONS.map(region => {
                const cell = bench.rates[region];
                return (
                  <tr key={region} className="border-t hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-medium">{region}</td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        step={1000}
                        value={cell.min_weekly}
                        onChange={e => updateRate(tidx, region, "min_weekly", parseInt(e.target.value) || 0)}
                        className="w-24 text-right border rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        step={1000}
                        value={cell.max_weekly}
                        onChange={e => updateRate(tidx, region, "max_weekly", parseInt(e.target.value) || 0)}
                        className="w-24 text-right border rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                      {fmt(cell.min_weekly)} – {fmt(cell.max_weekly)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Visual preview bar */}
      <div className="border rounded-lg p-4 bg-background space-y-3">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-1">Preview — Italy · EM+2 /week</div>
        {(() => {
          const region: BenchmarkRegion = "Italy";
          const allMaxes = benchmarks.map(b => b.rates[region].max_weekly);
          const scaleMax = Math.max(...allMaxes) * 1.05;
          const pct = (v: number) => `${Math.min(100, (v / scaleMax) * 100).toFixed(1)}%`;
          const fmt2 = (v: number) => `€${Math.round(v / 1000)}k`;
          return benchmarks.map((bench, i) => {
            const cell = bench.rates[region];
            const mid = (cell.min_weekly + cell.max_weekly) / 2;
            const color = TIER_COLORS[bench.tier] ?? "#374151";
            return (
              <div key={i} className="space-y-0.5">
                <div className="flex justify-between text-[9px] text-muted-foreground">
                  <span>{bench.label}</span>
                  <span className="font-mono">{fmt2(cell.min_weekly)} – <span className="opacity-60">avg {fmt2(mid)}</span> – {fmt2(cell.max_weekly)}</span>
                </div>
                <div className="relative h-4 bg-muted rounded-full overflow-hidden">
                  <div
                    className="absolute top-0 bottom-0 rounded-full opacity-40"
                    style={{ left: pct(cell.min_weekly), right: `${100 - parseFloat(pct(cell.max_weekly))}%`, backgroundColor: color }}
                  />
                  <div className="absolute top-0 bottom-0 w-0.5 opacity-70"
                    style={{ left: pct(cell.min_weekly), backgroundColor: color }} />
                  <div className="absolute top-0 bottom-0 w-0.5 opacity-70"
                    style={{ left: pct(cell.max_weekly), backgroundColor: color }} />
                  <div className="absolute top-0 bottom-0 opacity-50"
                    style={{ left: pct(mid), width: "1px", backgroundColor: color }} />
                </div>
              </div>
            );
          });
        })()}
      </div>

      {/* Data sources reference */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="text-xs font-bold mb-2">Recommended Data Sources</div>
        {SOURCE_OPTIONS.map(src => (
          <div key={src.label} className="flex items-center gap-2 text-xs">
            <span className="flex-1 text-muted-foreground">{src.label}</span>
            <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline text-[10px]">
              Visit →
            </a>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saving} className="flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Benchmarks"}
        </Button>
      </div>
    </div>
  );
}

const TABS: { id: TabId; label: string }[] = [
  { id: "roles", label: "Roles & Rates" },
  { id: "regions", label: "Regions" },
  { id: "client_multipliers", label: "Client Multipliers" },
  { id: "sensitivity", label: "Sensitivity" },
  { id: "bracket_rules", label: "Bracket & Rules" },
  { id: "discounts_costs", label: "Discounts & Costs" },
  { id: "funds", label: "PE Funds" },
  { id: "rate_matrix", label: "Rate Matrix" },
  { id: "market_benchmarks", label: "Market Benchmarks" },
  { id: "price_adjustments", label: "Price Adjustments" },
  { id: "fund_defaults", label: "Fund Defaults" },
  { id: "sector_multipliers", label: "Sector Multipliers" },
  { id: "project_types", label: "Project Types" },
  { id: "sectors_list", label: "Sectors" },
];

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PricingAdmin() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>("roles");
  const [settings, setSettings] = useState<PricingSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load settings from API
  useEffect(() => {
    setLoading(true);
    fetch("/api/pricing/settings", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: PricingSettings) => {
        // Merge with defaults so any newly-added fields are always present
        setSettings({ ...DEFAULT_SETTINGS, ...data });
      })
      .catch((err) => {
        console.error("Failed to load pricing settings:", err);
        toast({
          title: "Could not load pricing settings",
          description: "Using default values. Changes will be saved to the server.",
          variant: "destructive",
        });
      })
      .finally(() => setLoading(false));
  }, []);

  // Save settings to API
  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/pricing/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Pricing settings saved successfully" });
    } catch (err) {
      console.error("Failed to save pricing settings:", err);
      toast({
        title: "Failed to save settings",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const patchSettings = (patch: Partial<PricingSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Pricing Admin"
          description="Configure pricing logic, daily rates, multipliers, and intelligence thresholds"
        />
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
          Loading pricing settings…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing Admin"
        description="Configure pricing logic, daily rates, multipliers, and intelligence thresholds"
        actions={
          <div className="flex items-center gap-2">
            <a
              href="/api/admin/download-code"
              download
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted transition-colors text-foreground"
              title="Download all source code as .tar.gz"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Code</span>
            </a>
            <a
              href="/api/admin/download-backup"
              download
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted transition-colors text-foreground"
              title="Download full data backup as .json"
            >
              <Database className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Backup</span>
            </a>
            <div className="flex items-center gap-1.5 text-muted-foreground pl-1 border-l">
              <Settings className="w-4 h-4" />
              <span className="text-sm hidden sm:inline">Admin Settings</span>
            </div>
          </div>
        }
      />

      {/* Tab bar */}
      <div className="border-b">
        <nav className="flex gap-0 overflow-x-auto" aria-label="Pricing settings tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <Card>
        <CardContent className="pt-6">
          {activeTab === "roles" && (
            <RolesTab
              roles={settings.roles}
              onChange={(roles) => patchSettings({ roles })}
              staffCosts={settings.staff_costs ?? []}
              onStaffCostChange={(staff_costs) => patchSettings({ staff_costs })}
              onSave={handleSave}
              saving={saving}
            />
          )}

          {activeTab === "regions" && (
            <RegionsTab
              regions={settings.regions}
              onChange={(regions) => patchSettings({ regions })}
              onSave={handleSave}
              saving={saving}
            />
          )}

          {activeTab === "client_multipliers" && (
            <ClientMultipliersTab
              ownershipMultipliers={settings.ownership_multipliers}
              revenueBandMultipliers={settings.revenue_band_multipliers}
              onOwnershipChange={(ownership_multipliers) =>
                patchSettings({ ownership_multipliers })
              }
              onRevenueBandChange={(revenue_band_multipliers) =>
                patchSettings({ revenue_band_multipliers })
              }
              onSave={handleSave}
              saving={saving}
            />
          )}

          {activeTab === "sensitivity" && (
            <SensitivityTab
              multipliers={settings.sensitivity_multipliers}
              onChange={(sensitivity_multipliers) =>
                patchSettings({ sensitivity_multipliers })
              }
              onSave={handleSave}
              saving={saving}
            />
          )}

          {activeTab === "bracket_rules" && (
            <BracketRulesTab
              settings={settings}
              onChange={patchSettings}
              onSave={handleSave}
              saving={saving}
            />
          )}
          {activeTab === "discounts_costs" && (
            <DiscountsAndCostsTab settings={settings} onChange={patchSettings} onSave={handleSave} saving={saving} />
          )}
          {activeTab === "funds" && (
            <FundsTab settings={settings} onChange={patchSettings} onSave={handleSave} saving={saving} />
          )}

          {activeTab === "rate_matrix" && (
            <RateMatrixTab settings={settings} onChange={patchSettings} onSave={handleSave} saving={saving} />
          )}
          {activeTab === "market_benchmarks" && (
            <MarketBenchmarksTab settings={settings} onChange={patchSettings} onSave={handleSave} saving={saving} />
          )}
          {activeTab === "price_adjustments" && (
            <PriceAdjustmentsTab settings={settings} onChange={patchSettings} onSave={handleSave} saving={saving} />
          )}
          {activeTab === "fund_defaults" && (
            <FundDefaultsTab settings={settings} onChange={patchSettings} onSave={handleSave} saving={saving} />
          )}
          {activeTab === "sector_multipliers" && (() => {
            const DEFAULT_SECTORS: SectorMultiplier[] = [
              { sector: "Industrial / Manufacturing", multiplier: 1.0 },
              { sector: "Pharma / Healthcare", multiplier: 1.1 },
              { sector: "Software / SaaS", multiplier: 1.05 },
              { sector: "Consumer / Retail", multiplier: 1.0 },
              { sector: "Energy / Utilities", multiplier: 1.0 },
              { sector: "Business Services", multiplier: 1.0 },
              { sector: "Financial Services", multiplier: 1.0 },
              { sector: "Other", multiplier: 1.0 },
            ];
            const items: SectorMultiplier[] = (settings as any).sector_multipliers ?? DEFAULT_SECTORS;
            return (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Sector Multipliers</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Applied as a pricing layer after Geography. Multiplier ×1.0 = no adjustment, ×1.1 = +10%.
                  </p>
                </div>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 border-b">
                        <th className="text-left px-3 py-2 text-xs font-semibold">Sector</th>
                        <th className="text-center px-3 py-2 text-xs font-semibold w-28">Multiplier</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((s, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-1.5">
                            <Input value={s.sector}
                              onChange={e => {
                                const updated = items.map((v, j) => j === i ? { ...v, sector: e.target.value } : v);
                                patchSettings({ sector_multipliers: updated } as any);
                              }}
                              className="h-7 text-xs" />
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <Input type="number" step="0.05" min="0.5" max="3" value={s.multiplier}
                              onChange={e => {
                                const updated = items.map((v, j) => j === i ? { ...v, multiplier: parseFloat(e.target.value) || 1 } : v);
                                patchSettings({ sector_multipliers: updated } as any);
                              }}
                              className="h-7 text-xs font-mono text-center w-20 mx-auto" />
                          </td>
                          <td className="px-1 py-1.5">
                            <button onClick={() => {
                              patchSettings({ sector_multipliers: items.filter((_, j) => j !== i) } as any);
                            }} className="text-muted-foreground hover:text-destructive p-1">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button size="sm" variant="outline" onClick={() => {
                  patchSettings({ sector_multipliers: [...items, { sector: "", multiplier: 1.0 }] } as any);
                }}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Sector
                </Button>
                <div className="flex justify-end pt-2">
                  <Button onClick={handleSave} disabled={saving} size="sm">
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                    {saving ? "Saving…" : "Save Settings"}
                  </Button>
                </div>
              </div>
            );
          })()}

          {activeTab === "project_types" && (() => {
            const DEFAULT_PT = ["Spark", "SFE", "Pricing", "Other Design", "War Room"];
            const items: string[] = settings.project_types ?? DEFAULT_PT;
            return (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Project Types</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">List of project types available in the Pricing Tool dropdown.</p>
                </div>
                <div className="space-y-2 max-w-sm">
                  {items.map((t, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <Input value={t}
                        onChange={e => {
                          const updated = items.map((v, j) => j === i ? e.target.value : v);
                          patchSettings({ project_types: updated });
                        }}
                        className="h-8 text-sm flex-1" />
                      <button
                        onClick={() => patchSettings({ project_types: items.filter((_, j) => j !== i) })}
                        className="text-muted-foreground hover:text-destructive p-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => patchSettings({ project_types: [...items, ""] })}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add type
                  </Button>
                </div>
                <Button onClick={handleSave} disabled={saving} size="sm">
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            );
          })()}

          {activeTab === "sectors_list" && (() => {
            const DEFAULT_SEC = ["Industrial / Manufacturing", "Pharma / Healthcare", "Software / SaaS", "Consumer / Retail", "Energy / Utilities", "Business Services", "PE-SWF", "Other", "Distribution"];
            const items: string[] = settings.sectors ?? DEFAULT_SEC;
            return (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Sectors</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">List of sectors available in the Pricing Tool dropdown.</p>
                </div>
                <div className="space-y-2 max-w-sm">
                  {items.map((s, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <Input value={s}
                        onChange={e => {
                          const updated = items.map((v, j) => j === i ? e.target.value : v);
                          patchSettings({ sectors: updated });
                        }}
                        className="h-8 text-sm flex-1" />
                      <button
                        onClick={() => patchSettings({ sectors: items.filter((_, j) => j !== i) })}
                        className="text-muted-foreground hover:text-destructive p-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={() => patchSettings({ sectors: [...items, ""] })}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add sector
                  </Button>
                </div>
                <Button onClick={handleSave} disabled={saving} size="sm">
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
