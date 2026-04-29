import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface BriefSummary {
  id: string;
  generatedAt: string;
  generatedBy: string;
  status: string;
  durationMs: number | null;
  model: string | null;
  tokenInput: number | null;
  tokenOutput: number | null;
  decisionCount: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
}

export default function CeoBriefHistory() {
  const { toast } = useToast();
  const [rows, setRows] = useState<BriefSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/ceo-brief/history?limit=50", { credentials: "include" })
      .then(r => r.json())
      .then(setRows)
      .catch((e: Error) => toast({ variant: "destructive", title: "Failed to load history", description: e.message }))
      .finally(() => setLoading(false));
  }, [toast]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">CEO Brief History</h1>
        <Link href="/ceo-brief">
          <Button variant="outline" size="sm">Back to Latest</Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">No briefs generated yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Trigger</th>
                <th className="text-center px-4 py-2 font-medium text-muted-foreground">Decisions</th>
                <th className="text-center px-4 py-2 font-medium text-muted-foreground">Approved</th>
                <th className="text-center px-4 py-2 font-medium text-muted-foreground">Pending</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Duration</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {new Date(r.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className="text-xs">
                      {r.generatedBy}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-center">{r.decisionCount}</td>
                  <td className="px-4 py-2.5 text-center">
                    {r.approvedCount > 0
                      ? <span className="text-emerald-700 font-medium">{r.approvedCount}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {r.pendingCount > 0
                      ? <span className="text-amber-700 font-medium">{r.pendingCount}</span>
                      : <span className="text-muted-foreground">0</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      variant="outline"
                      className={r.status === "success"
                        ? "border-emerald-300 text-emerald-700"
                        : "border-red-300 text-red-700"}
                    >
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/ceo-brief/${r.id}`}>
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                        <ExternalLink className="w-3 h-3" /> View
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
