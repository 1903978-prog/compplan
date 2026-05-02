import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Cpu, Zap, Database, RefreshCw, Trash2, CheckCircle,
  AlertTriangle, TrendingDown, BarChart3,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ──────────────────────────────────────────────────────────────────
interface ModuleStat {
  module_name:       string;
  id?:               string;
  displayName:       string;
  category?:         string;
  wave?:             number;
  calls:             number | string;
  total_latency_ms:  number | string | null;
  total_tokens_saved: number | string | null;
  cache_hits:        number | string | null;
  claude_fallbacks:  number | string | null;
}

interface StatsResponse {
  days:           number;
  since:          string;
  localAiFirst:   boolean;
  modules:        ModuleStat[];
  cacheEntries:   number;
  totals: {
    tokensSaved:           number;
    estimatedCostSavedUsd: number;
    totalCalls:            number;
    claudeFallbacks:       number;
  };
  registry: Array<{
    id:               string;
    name:             string;
    wave:             number;
    category:         string;
    description:      string;
    tokensPerCallSaved: number;
    file:             string;
  }>;
}

interface PricingRule {
  id:          number;
  rule_name:   string;
  geography:   string | null;
  client_size: string | null;
  complexity:  string | null;
  pe_owned:    number | null;
  fee_min:     number | null;
  fee_mid:     number | null;
  fee_max:     number | null;
  rationale:   string | null;
  is_active:   number;
  created_at:  string;
  updated_at:  string;
}

// ── Category colours ───────────────────────────────────────────────────────
const CATEGORY_COLOUR: Record<string, string> = {
  nlp:       "bg-blue-100 text-blue-800",
  reasoning: "bg-purple-100 text-purple-800",
  cache:     "bg-amber-100 text-amber-800",
  scoring:   "bg-green-100 text-green-800",
  compose:   "bg-pink-100 text-pink-800",
  extract:   "bg-orange-100 text-orange-800",
};

function num(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}

// ── Component ──────────────────────────────────────────────────────────────
export default function MicroAIAdmin() {
  const { toast } = useToast();
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [pruning, setPruning] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, rRes] = await Promise.all([
        fetch(`/api/admin/micro-ai/stats?days=${days}`, { credentials: "include" }),
        fetch("/api/admin/micro-ai/pricing-rules",      { credentials: "include" }),
      ]);
      if (sRes.ok) setStats(await sRes.json());
      if (rRes.ok) setRules(await rRes.json());
    } catch {
      toast({ title: "Error loading Micro-AI stats", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [days, toast]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const pruneCache = async () => {
    setPruning(true);
    try {
      const r = await fetch("/api/admin/micro-ai/cache/prune", {
        method: "POST", credentials: "include",
      });
      const d = await r.json();
      toast({ title: `Cache pruned — ${d.deleted} entries removed` });
      loadStats();
    } catch {
      toast({ title: "Prune failed", variant: "destructive" });
    } finally {
      setPruning(false);
    }
  };

  const toggleRule = async (rule: PricingRule) => {
    try {
      const r = await fetch(`/api/admin/micro-ai/pricing-rules/${rule.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: rule.is_active ? 0 : 1 }),
      });
      if (r.ok) {
        setRules(prev => prev.map(x => x.id === rule.id ? { ...x, is_active: rule.is_active ? 0 : 1 } : x));
      }
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const totals = stats?.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Micro-AI Control Centre"
        description="Local AI modules — token savings, cache stats, pricing rules"
      />

      {/* Top summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5" /> Tokens saved ({days}d)</span>
          <span className="text-2xl font-bold font-mono">{totals ? (totals.tokensSaved / 1000).toFixed(1) + "k" : "—"}</span>
        </Card>
        <Card className="p-4 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> Est. cost saved</span>
          <span className="text-2xl font-bold font-mono text-green-600">{totals ? "$" + totals.estimatedCostSavedUsd.toFixed(2) : "—"}</span>
        </Card>
        <Card className="p-4 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><BarChart3 className="w-3.5 h-3.5" /> Total module calls</span>
          <span className="text-2xl font-bold font-mono">{totals?.totalCalls ?? "—"}</span>
        </Card>
        <Card className="p-4 flex flex-col gap-1">
          <span className="text-xs text-muted-foreground flex items-center gap-1"><Database className="w-3.5 h-3.5" /> Cache entries</span>
          <span className="text-2xl font-bold font-mono">{stats?.cacheEntries ?? "—"}</span>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          {[7, 14, 30].map(d => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"}
              onClick={() => setDays(d)}>{d}d</Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={loadStats} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <Button size="sm" variant="outline" onClick={pruneCache} disabled={pruning}>
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          Prune cache
        </Button>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Local AI first:</span>
          {stats?.localAiFirst
            ? <Badge className="bg-green-100 text-green-800">ON</Badge>
            : <Badge className="bg-amber-100 text-amber-800">OFF</Badge>}
        </div>
      </div>

      {/* Module telemetry table */}
      <Card>
        <div className="p-4 border-b">
          <h2 className="font-semibold flex items-center gap-2"><Cpu className="w-4 h-4" /> Module Stats</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Tokens saved</TableHead>
              <TableHead className="text-right">Avg latency</TableHead>
              <TableHead className="text-right">Cache hits</TableHead>
              <TableHead className="text-right">Claude fallbacks</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Show registry entries even if no calls yet */}
            {(stats?.registry ?? []).map(reg => {
              const row = stats?.modules.find(m => m.module_name === reg.file.replace(".js", ""));
              const calls         = num(row?.calls);
              const tokensSaved   = num(row?.total_tokens_saved);
              const totalLatency  = num(row?.total_latency_ms);
              const cacheHits     = num(row?.cache_hits);
              const fallbacks     = num(row?.claude_fallbacks);
              const avgLatency    = calls > 0 ? Math.round(totalLatency / calls) : null;
              const fallbackPct   = calls > 0 ? Math.round((fallbacks / calls) * 100) : 0;

              return (
                <TableRow key={reg.id}>
                  <TableCell className="font-mono text-xs font-bold text-muted-foreground">{reg.id}</TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{reg.name}</div>
                    <div className="text-xs text-muted-foreground max-w-xs truncate">{reg.description}</div>
                  </TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLOUR[reg.category] ?? "bg-muted"}`}>
                      {reg.category}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono">{calls || "—"}</TableCell>
                  <TableCell className="text-right font-mono text-green-700">{tokensSaved ? tokensSaved.toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{avgLatency != null ? `${avgLatency}ms` : "—"}</TableCell>
                  <TableCell className="text-right font-mono">{calls ? cacheHits : "—"}</TableCell>
                  <TableCell className="text-right">
                    {calls > 0 ? (
                      <span className={fallbackPct > 20 ? "text-amber-600 font-semibold" : "text-muted-foreground"}>
                        {fallbacks} ({fallbackPct}%)
                      </span>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
            {(!stats || stats.registry.length === 0) && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  {loading ? "Loading…" : "No data yet"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pricing rules table */}
      <Card>
        <div className="p-4 border-b">
          <h2 className="font-semibold flex items-center gap-2">
            <Database className="w-4 h-4" /> Pricing Rules
            <span className="text-xs text-muted-foreground font-normal ml-1">({rules.length} rules — used by B8 Pricing Reasoner)</span>
          </h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead>Geo</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Complexity</TableHead>
              <TableHead>PE</TableHead>
              <TableHead className="text-right">Min €</TableHead>
              <TableHead className="text-right">Mid €</TableHead>
              <TableHead className="text-right">Max €</TableHead>
              <TableHead>Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map(rule => (
              <TableRow key={rule.id} className={rule.is_active ? "" : "opacity-40"}>
                <TableCell className="font-medium text-sm">{rule.rule_name}</TableCell>
                <TableCell className="font-mono text-xs">{rule.geography ?? "—"}</TableCell>
                <TableCell className="text-xs">{rule.client_size ?? "—"}</TableCell>
                <TableCell className="text-xs">{rule.complexity ?? "—"}</TableCell>
                <TableCell className="text-xs">{rule.pe_owned ? "✓" : "—"}</TableCell>
                <TableCell className="text-right font-mono text-sm">{rule.fee_min != null ? rule.fee_min.toLocaleString() : "—"}</TableCell>
                <TableCell className="text-right font-mono text-sm">{rule.fee_mid != null ? rule.fee_mid.toLocaleString() : "—"}</TableCell>
                <TableCell className="text-right font-mono text-sm">{rule.fee_max != null ? rule.fee_max.toLocaleString() : "—"}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => toggleRule(rule)}>
                    {rule.is_active
                      ? <CheckCircle className="w-4 h-4 text-green-600" />
                      : <AlertTriangle className="w-4 h-4 text-muted-foreground" />}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rules.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                  No pricing rules found. Run server seed to populate.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
