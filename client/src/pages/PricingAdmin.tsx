import { useState, useEffect } from "react";
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
  Check,
  X,
  Edit2,
  Plus,
  Info,
  Save,
  Lock,
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

interface PricingSettings {
  roles: PricingRole[];
  regions: PricingRegion[];
  ownership_multipliers: OwnershipMultiplier[];
  revenue_band_multipliers: RevenueBandMultiplier[];
  sensitivity_multipliers: SensitivityMultiplier[];
  bracket_low_pct: number;
  bracket_high_pct: number;
  aggressive_threshold_pct: number;
  conservative_threshold_pct: number;
  min_comparables: number;
  fund_anchor_weight: number;
  win_loss_weight: number;
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
  bracket_low_pct: 10,
  bracket_high_pct: 15,
  aggressive_threshold_pct: 20,
  conservative_threshold_pct: 15,
  min_comparables: 3,
  fund_anchor_weight: 0.4,
  win_loss_weight: 0.6,
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
  onSave: () => void;
  saving: boolean;
}

function RolesTab({ roles, onChange, onSave, saving }: RolesTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState<Partial<PricingRole>>({});

  const startEdit = (role: PricingRole) => {
    setEditingId(role.id);
    setEditBuf({ role_name: role.role_name, default_daily_rate: role.default_daily_rate });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditBuf({});
    // Remove new unsaved row
    onChange(roles.filter((r) => r.id !== "__new__"));
  };

  const commitEdit = (id: string) => {
    onChange(
      roles.map((r) => {
        if (r.id !== id) return r;
        return {
          ...r,
          id: id === "__new__" ? crypto.randomUUID() : r.id,
          role_name: editBuf.role_name ?? r.role_name,
          default_daily_rate: editBuf.default_daily_rate ?? r.default_daily_rate,
        };
      })
    );
    setEditingId(null);
    setEditBuf({});
  };

  const toggleActive = (id: string) => {
    onChange(roles.map((r) => (r.id === id ? { ...r, active: !r.active } : r)));
  };

  const addRole = () => {
    const newRole: PricingRole = {
      id: "__new__",
      role_name: "",
      default_daily_rate: 1000,
      active: true,
      sort_order: roles.length + 1,
    };
    onChange([...roles, newRole]);
    setEditingId("__new__");
    setEditBuf({ role_name: "", default_daily_rate: 1000 });
  };

  const activeRoles = roles.filter((r) => r.active);
  const estimatedWeeklyCost = activeRoles.reduce(
    (sum, r) => sum + r.default_daily_rate * 5,
    0
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
            Consultant Roles
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define roles and their default daily rates (€). These are used as the base for price calculations.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Est. weekly cost (full team, 1 person each)</p>
          <p className="font-bold text-primary">
            €{estimatedWeeklyCost.toLocaleString()}
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
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-center w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role, idx) => {
              const isEditing = editingId === role.id;
              return (
                <TableRow
                  key={role.id}
                  className={!role.active ? "opacity-50" : undefined}
                >
                  <TableCell className="text-center text-xs text-muted-foreground">
                    {idx + 1}
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <Input
                        value={editBuf.role_name ?? ""}
                        onChange={(e) =>
                          setEditBuf((b) => ({ ...b, role_name: e.target.value }))
                        }
                        className="h-8 text-sm"
                        placeholder="Role name"
                        autoFocus
                      />
                    ) : (
                      <span className="font-medium text-sm">{role.role_name}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isEditing ? (
                      <Input
                        type="number"
                        value={editBuf.default_daily_rate ?? ""}
                        onChange={(e) =>
                          setEditBuf((b) => ({
                            ...b,
                            default_daily_rate: parseFloat(e.target.value) || 0,
                          }))
                        }
                        className="h-8 text-sm text-right w-32 ml-auto"
                      />
                    ) : (
                      <span className="font-mono text-sm">
                        €{role.default_daily_rate.toLocaleString()}
                      </span>
                    )}
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
                    {isEditing ? (
                      <div className="flex justify-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                          onClick={() => commitEdit(role.id)}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={cancelEdit}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => startEdit(role)}
                        disabled={editingId !== null}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={addRole}
          disabled={editingId !== null}
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add Role
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
                        className="h-8 text-sm text-center w-24 mx-auto font-mono"
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
                        className="h-8 text-sm text-center w-24 mx-auto font-mono"
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
                        className="h-8 text-sm text-center w-24 mx-auto font-mono"
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
                      className="h-8 text-sm text-center w-24 mx-auto font-mono"
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

// ─── Tabs list ────────────────────────────────────────────────────────────────

type TabId = "roles" | "regions" | "client_multipliers" | "sensitivity" | "bracket_rules";

const TABS: { id: TabId; label: string }[] = [
  { id: "roles", label: "Roles & Rates" },
  { id: "regions", label: "Regions" },
  { id: "client_multipliers", label: "Client Multipliers" },
  { id: "sensitivity", label: "Sensitivity" },
  { id: "bracket_rules", label: "Bracket & Rules" },
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
        setSettings(data);
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
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Pricing Admin"
        description="Configure pricing logic, daily rates, multipliers, and intelligence thresholds"
        actions={
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Settings className="w-4 h-4" />
            <span className="text-sm hidden sm:inline">Admin Settings</span>
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
        </CardContent>
      </Card>
    </div>
  );
}
