import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/hooks/use-store";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BenchmarkRow } from "@shared/schema";
import { DEFAULT_BENCHMARK } from "@shared/schema";
import { RefreshCw, Check, X, TrendingUp } from "lucide-react";

type Change = { tenure_years: number; field: string; old: number; new: number };

const FIELD_LABELS: Record<string, string> = {
  gen_p10: "Gen. P10", gen_median: "Gen. Median", gen_p75: "Gen. P75",
  strat_p10: "Strat. P10", strat_median: "Strat. Median", strat_p75: "Strat. P75",
};

export function BenchmarkPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings } = useStore();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [proposed, setProposed] = useState<BenchmarkRow[] | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const current: BenchmarkRow[] = (settings as any)?.benchmark_data?.length
    ? (settings as any).benchmark_data
    : DEFAULT_BENCHMARK;

  const updatedAt = (settings as any)?.benchmark_updated_at;

  const handleRefresh = async () => {
    setLoading(true);
    setProposed(null);
    setChanges([]);
    setApproved(new Set());
    try {
      const res = await apiRequest("POST", "/api/benchmark/refresh");
      const data = await res.json();
      if (data.error) { toast({ title: "Refresh failed", description: data.error, variant: "destructive" }); return; }
      setProposed(data.proposed);
      setChanges(data.changes);
      if (data.changes.length === 0) toast({ title: "No changes found — data is up to date" });
    } catch (err) {
      toast({ title: "Refresh failed", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const changeKey = (c: Change) => `${c.tenure_years}-${c.field}`;

  const toggleApprove = (c: Change) => {
    setApproved(prev => {
      const s = new Set(prev);
      s.has(changeKey(c)) ? s.delete(changeKey(c)) : s.add(changeKey(c));
      return s;
    });
  };

  const handleApply = async () => {
    if (!proposed) return;
    setApplying(true);
    try {
      // Build final data: apply only approved changes to current
      const final: BenchmarkRow[] = current.map(row => {
        const updated = { ...row };
        for (const c of changes) {
          if (c.tenure_years === row.tenure_years && approved.has(changeKey(c))) {
            (updated as any)[c.field] = c.new;
          }
        }
        return updated;
      });
      await apiRequest("POST", "/api/benchmark/apply", { data: final });
      toast({ title: `Applied ${approved.size} change${approved.size !== 1 ? "s" : ""}` });
      setProposed(null);
      setChanges([]);
      setApproved(new Set());
      window.location.reload();
    } catch (err) {
      toast({ title: "Apply failed", description: String(err), variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const displayData = proposed ?? current;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Salary Benchmarks
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {updatedAt
                ? `Last updated: ${new Date(updatedAt).toLocaleDateString("it-IT")}`
                : "Using default benchmark data"}
            </div>
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Searching…" : "Refresh via Web Search"}
            </Button>
          </div>

          {/* Benchmark table */}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Tenure</th>
                  <th className="text-center px-2 py-2 font-medium text-blue-600">Gen. P10</th>
                  <th className="text-center px-2 py-2 font-bold text-blue-700">Gen. Median</th>
                  <th className="text-center px-2 py-2 font-medium text-blue-600">Gen. P75</th>
                  <th className="text-center px-2 py-2 font-medium text-purple-600">Strat. P10</th>
                  <th className="text-center px-2 py-2 font-bold text-purple-700">Strat. Median</th>
                  <th className="text-center px-2 py-2 font-medium text-purple-600">Strat. P75</th>
                </tr>
              </thead>
              <tbody>
                {displayData.map(row => (
                  <tr key={row.tenure_years} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{row.tenure_years} year{row.tenure_years > 1 ? "s" : ""}</td>
                    {(["gen_p10","gen_median","gen_p75","strat_p10","strat_median","strat_p75"] as const).map(f => {
                      const changed = changes.find(c => c.tenure_years === row.tenure_years && c.field === f);
                      const isApproved = changed && approved.has(changeKey(changed));
                      return (
                        <td key={f} className={`text-center px-2 py-2 font-mono ${changed ? "bg-yellow-50" : ""}`}>
                          {changed ? (
                            <span className="flex items-center justify-center gap-1">
                              <span className="line-through text-muted-foreground text-xs">{changed.old}</span>
                              <span className={`font-bold ${isApproved ? "text-emerald-600" : "text-orange-600"}`}>{changed.new}</span>
                            </span>
                          ) : row[f]}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Diff approval section */}
          {changes.length > 0 && (
            <div className="space-y-2 border rounded-lg p-3 bg-yellow-50/50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{changes.length} proposed change{changes.length !== 1 ? "s" : ""} — approve each:</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setApproved(new Set(changes.map(changeKey)))}>
                    Approve All
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setApproved(new Set())}>
                    Reject All
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {changes.map(c => {
                  const isApp = approved.has(changeKey(c));
                  return (
                    <div key={changeKey(c)}
                      className={`flex items-center justify-between px-3 py-1.5 rounded border text-sm cursor-pointer ${isApp ? "bg-emerald-50 border-emerald-300" : "bg-white border-yellow-300"}`}
                      onClick={() => toggleApprove(c)}>
                      <span className="text-muted-foreground">
                        <span className="font-medium text-foreground">{c.tenure_years}y</span> · {FIELD_LABELS[c.field]}
                      </span>
                      <span className="flex items-center gap-1 font-mono text-xs">
                        {c.old} → <span className={isApp ? "text-emerald-700 font-bold" : "text-orange-600 font-bold"}>{c.new}</span>
                        {isApp
                          ? <Check className="w-3.5 h-3.5 text-emerald-600 ml-1" />
                          : <X className="w-3.5 h-3.5 text-muted-foreground ml-1" />}
                      </span>
                    </div>
                  );
                })}
              </div>
              <Button
                className="w-full mt-2"
                disabled={approved.size === 0 || applying}
                onClick={handleApply}
              >
                Apply {approved.size} Approved Change{approved.size !== 1 ? "s" : ""}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
