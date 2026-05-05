import { useState, useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/PageHeader";
import { Link } from "wouter";
import { TrendingUp, ArrowUpRight, Calculator, Info } from "lucide-react";

// ── Formula constants (mirrors pricingEngine.ts) ──────────────────────────
const OVERHEAD_PCT   = 0.15;   // 15% overhead on delivery cost
const MIN_MARGIN_PCT = 0.25;   // 25% minimum above cost+overhead

// Corridor multipliers on the floor price
const CORRIDOR = {
  floor:  1.00,  // absolute minimum — never quote below this
  low:    1.10,  // 10% above floor — tight but acceptable
  mid:    1.35,  // target comfortable margin
  high:   1.70,  // stretch — value-based ceiling
} as const;

function computeFloor(deliveryCostWeekly: number): number {
  return deliveryCostWeekly * (1 + OVERHEAD_PCT) * (1 + MIN_MARGIN_PCT);
}

const eur = (n: number): string =>
  n >= 1_000_000 ? `€${(n / 1_000_000).toFixed(2)}M` :
  n >= 1000      ? `€${Math.round(n / 1000)}k`        :
                   `€${Math.round(n)}`;

// ── Corridor bar visualizer ───────────────────────────────────────────────
function CorridorBar({
  floor, low, mid, high, recommendation,
}: {
  floor: number; low: number; mid: number; high: number; recommendation?: number;
}) {
  const max = high * 1.1;
  const pct = (v: number) => Math.min(100, Math.round((v / max) * 100));
  const recPct = recommendation ? pct(recommendation) : null;

  return (
    <div className="space-y-2">
      <div className="relative h-8 bg-muted rounded-full overflow-hidden">
        {/* Red zone: below floor */}
        <div className="absolute inset-y-0 left-0 bg-red-200" style={{ width: `${pct(floor)}%` }} />
        {/* Amber zone: floor → low */}
        <div className="absolute inset-y-0 bg-amber-200" style={{ left: `${pct(floor)}%`, width: `${pct(low) - pct(floor)}%` }} />
        {/* Green zone: low → mid */}
        <div className="absolute inset-y-0 bg-emerald-200" style={{ left: `${pct(low)}%`, width: `${pct(mid) - pct(low)}%` }} />
        {/* Blue zone: mid → high */}
        <div className="absolute inset-y-0 bg-blue-200" style={{ left: `${pct(mid)}%`, width: `${pct(high) - pct(mid)}%` }} />
        {/* Recommendation marker */}
        {recPct != null && (
          <div
            className="absolute inset-y-0 w-1 bg-primary rounded"
            style={{ left: `${recPct}%` }}
            title={`Recommendation: ${eur(recommendation!)}`}
          />
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
        <span>Floor {eur(floor)}</span>
        <span>Low {eur(low)}</span>
        <span>Mid {eur(mid)}</span>
        <span>High {eur(high)}</span>
      </div>
    </div>
  );
}

// ── Formula explainer card ────────────────────────────────────────────────
function FormulaCard() {
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Calculator className="w-5 h-5 text-primary" />
        <h3 className="font-bold text-sm">Floor & Corridor Formula</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">Floor (absolute minimum)</p>
            <code className="block bg-muted rounded px-3 py-2 text-xs font-mono">
              floor = delivery_cost × (1 + {(OVERHEAD_PCT * 100).toFixed(0)}% overhead) × (1 + {(MIN_MARGIN_PCT * 100).toFixed(0)}% min margin)
            </code>
            <p className="text-xs text-muted-foreground mt-1">
              = cost × {(1 + OVERHEAD_PCT).toFixed(2)} × {(1 + MIN_MARGIN_PCT).toFixed(2)} = cost × {((1 + OVERHEAD_PCT) * (1 + MIN_MARGIN_PCT)).toFixed(4)}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">Corridor zones</p>
            <div className="space-y-1 text-xs">
              {[
                { zone: "🔴 Below floor",   rule: "< floor",        note: "Never quote here — loss-making", color: "text-red-600" },
                { zone: "🟡 Tight",         rule: "floor → +10%",   note: "Acceptable only if strategic", color: "text-amber-600" },
                { zone: "🟢 Target",        rule: "+10% → +35%",    note: "Comfortable margin, quote here", color: "text-emerald-600" },
                { zone: "🔵 Stretch",       rule: "+35% → +70%",    note: "Value-based / benchmark anchor", color: "text-blue-600" },
              ].map(r => (
                <div key={r.zone} className="flex items-start gap-2">
                  <span className={`font-semibold shrink-0 ${r.color}`}>{r.zone}</span>
                  <span className="text-muted-foreground">({r.rule}) — {r.note}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">Overhead breakdown (15%)</p>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>• Management time not on project (~5%)</div>
              <div>• Bench + non-billable days (~4%)</div>
              <div>• Infra, tools, admin, T&E (~4%)</div>
              <div>• Buffer / risk (~2%)</div>
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wide mb-1">Min margin rationale (25%)</p>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>• Business development cost (~8%)</div>
              <div>• Partner distribution (~7%)</div>
              <div>• R&D / IP investment (~5%)</div>
              <div>• Profit floor (~5%)</div>
            </div>
          </div>

          <div className="flex items-start gap-1.5 bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-700">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>The engine computes the floor per case using actual role costs from pricing admin. Use the calculator below for quick estimates.</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Quick calculator ──────────────────────────────────────────────────────
function QuickCalculator() {
  const [deliveryCost, setDeliveryCost] = useState(15000);
  const [durationWeeks, setDurationWeeks] = useState(8);

  const floor    = computeFloor(deliveryCost);
  const low      = floor * CORRIDOR.low;
  const mid      = floor * CORRIDOR.mid;
  const high     = floor * CORRIDOR.high;
  const totalLow  = low * durationWeeks;
  const totalMid  = mid * durationWeeks;
  const totalHigh = high * durationWeeks;

  return (
    <Card className="p-5 space-y-4">
      <h3 className="font-bold text-sm flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-emerald-600" />
        Quick Corridor Calculator
      </h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Weekly delivery cost (€)</Label>
          <Input
            type="number"
            value={deliveryCost}
            onChange={e => setDeliveryCost(Math.max(0, Number(e.target.value)))}
            className="h-8 text-sm font-mono"
          />
          <p className="text-[10px] text-muted-foreground">Sum of all roles × days/wk × daily cost</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Duration (weeks)</Label>
          <Input
            type="number"
            value={durationWeeks}
            onChange={e => setDurationWeeks(Math.max(1, Number(e.target.value)))}
            className="h-8 text-sm font-mono"
          />
        </div>
      </div>

      <CorridorBar floor={floor} low={low} mid={mid} high={high} />

      <div className="grid grid-cols-4 gap-2 text-center text-xs">
        {[
          { label: "Floor /wk",  value: floor, color: "text-red-700",     bg: "bg-red-50",     border: "border-red-200" },
          { label: "Tight /wk",  value: low,   color: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200" },
          { label: "Target /wk", value: mid,   color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
          { label: "Stretch /wk",value: high,  color: "text-blue-700",    bg: "bg-blue-50",    border: "border-blue-200" },
        ].map(c => (
          <div key={c.label} className={`border rounded p-2 ${c.bg} ${c.border}`}>
            <div className={`text-base font-bold font-mono ${c.color}`}>{eur(c.value)}</div>
            <div className="text-[10px] text-muted-foreground">{c.label}</div>
          </div>
        ))}
      </div>

      {durationWeeks > 1 && (
        <div className="border-t pt-3">
          <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-2">Total engagement ({durationWeeks} weeks)</p>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            {[
              { label: "Tight total",  value: totalLow,  color: "text-amber-700" },
              { label: "Target total", value: totalMid,  color: "text-emerald-700" },
              { label: "Stretch total",value: totalHigh, color: "text-blue-700" },
            ].map(c => (
              <div key={c.label} className="border rounded p-2 bg-background">
                <div className={`text-sm font-bold font-mono ${c.color}`}>{eur(c.value)}</div>
                <div className="text-[10px] text-muted-foreground">{c.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Margin on floor: tight = {Math.round((CORRIDOR.low - 1) * 100)}%, target = {Math.round((CORRIDOR.mid - 1) * 100)}%, stretch = {Math.round((CORRIDOR.high - 1) * 100)}% above floor.
        Gross margin on cost: tight ≈ {Math.round((1 - 1/CORRIDOR.low / ((1+OVERHEAD_PCT)*(1+MIN_MARGIN_PCT))) * 100)}%, target ≈ {Math.round((1 - 1 / (CORRIDOR.mid * (1+OVERHEAD_PCT) * (1+MIN_MARGIN_PCT))) * 100)}%.
      </p>
    </Card>
  );
}

// ── Active cases table ────────────────────────────────────────────────────
function ActiveCasesTable() {
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pricing/cases", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => { setCases(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const active = useMemo(() =>
    cases.filter(c => c.status === "active" || c.status === "draft" || c.status === "pending"),
    [cases]
  );

  if (loading) return <p className="text-xs text-muted-foreground italic">Loading…</p>;
  if (active.length === 0) return <p className="text-xs text-muted-foreground italic">No active pricing cases.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-[10px] uppercase text-muted-foreground tracking-wide border-b">
          <tr>
            <th className="py-2 pr-3">Case</th>
            <th className="py-2 pr-3">Duration</th>
            <th className="py-2 pr-3 text-right">Floor /wk</th>
            <th className="py-2 pr-3 text-right">Corridor (mid) /wk</th>
            <th className="py-2 pr-3 text-right">Recommendation /wk</th>
            <th className="py-2 pr-3 text-right">Margin vs floor</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {active.map((c: any) => {
            const rec = c.recommendation;
            const floor = rec?.cost_floor_weekly ?? 0;
            const mid = floor > 0 ? floor * CORRIDOR.mid : 0;
            const recWeekly = rec?.target_weekly ?? rec?.canonical_net_weekly ?? 0;
            const marginAboveFloor = floor > 0 && recWeekly > 0
              ? Math.round(((recWeekly - floor) / floor) * 100)
              : null;
            const zone = marginAboveFloor == null ? "—"
              : marginAboveFloor < 0  ? "below floor"
              : marginAboveFloor < 10 ? "tight"
              : marginAboveFloor < 35 ? "target"
              : "stretch";
            const zoneColor = zone === "below floor" ? "text-red-700" : zone === "tight" ? "text-amber-600" : zone === "target" ? "text-emerald-600" : zone === "stretch" ? "text-blue-600" : "text-muted-foreground";

            return (
              <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="py-2 pr-3 font-medium">
                  <div>{c.project_name} — {c.client_name}</div>
                  <div className="text-[10px] text-muted-foreground">{c.region}</div>
                </td>
                <td className="py-2 pr-3 font-mono text-muted-foreground">{c.duration_weeks ?? "—"}w</td>
                <td className="py-2 pr-3 text-right font-mono text-red-700" data-privacy="blur">{floor > 0 ? eur(floor) : "—"}</td>
                <td className="py-2 pr-3 text-right font-mono text-emerald-700" data-privacy="blur">{mid > 0 ? eur(mid) : "—"}</td>
                <td className="py-2 pr-3 text-right font-mono font-semibold" data-privacy="blur">{recWeekly > 0 ? eur(recWeekly) : "—"}</td>
                <td className="py-2 pr-3 text-right">
                  {marginAboveFloor != null
                    ? <span className={`font-semibold ${zoneColor}`}>+{marginAboveFloor}% ({zone})</span>
                    : <span className="text-muted-foreground">—</span>
                  }
                </td>
                <td className="py-2">
                  <Link href="/pricing" className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                    open <ArrowUpRight className="w-3 h-3" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function PricingDirector() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing Director"
        description="Floor/corridor formula · active case analysis · pricing governance"
      />

      <FormulaCard />
      <QuickCalculator />

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm">Active Cases — Corridor Position</h3>
          <Link href="/pricing" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1">
            Pricing Tool <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        <ActiveCasesTable />
        <p className="text-[10px] text-muted-foreground">
          Floor computed per case from actual role costs × {(OVERHEAD_PCT*100).toFixed(0)}% overhead × {(MIN_MARGIN_PCT*100).toFixed(0)}% min margin.
          Recommendation from the 7-layer pricing engine. Open a case in Pricing Tool to update.
        </p>
      </Card>
    </div>
  );
}
