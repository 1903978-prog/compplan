import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarRange, Filter, Users, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types we read from the API ──────────────────────────────────────────────
interface Proposal {
  id: number;
  project_name: string;
  client_name?: string | null;
  proposal_date: string;
  start_date?: string | null;
  end_date?: string | null;
  duration_weeks?: number | null;
  outcome: string;                                 // "pending" | "won" | "lost"
  win_probability?: number | null;                 // 0..100
  manager_name?: string | null;
  team_members?: { role: string; name: string }[] | null;
}

interface Employee {
  id: string;
  name: string;
  current_role_code?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const MS_DAY = 86_400_000;
const MS_WK = 7 * MS_DAY;
const HORIZON_WEEKS = 16;

function startOfWeekMonday(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = (out.getDay() + 6) % 7; // Mon=0..Sun=6
  out.setDate(out.getDate() - dow);
  return out;
}

function fmtWeek(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function parseISODateOrNull(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Compute project weekly span [startWeekIdx, endWeekIdx] within the horizon */
function projectWeeks(p: Proposal, weekStart: Date): { from: number; to: number } | null {
  const start = parseISODateOrNull(p.start_date) ?? parseISODateOrNull(p.proposal_date);
  if (!start) return null;
  const dur = (p.duration_weeks && p.duration_weeks > 0) ? p.duration_weeks : 8;
  const end = parseISODateOrNull(p.end_date) ?? new Date(start.getTime() + dur * MS_WK);
  // map to week indices
  const fromMs = start.getTime();
  const toMs = end.getTime();
  const horizonStart = weekStart.getTime();
  const horizonEnd = horizonStart + HORIZON_WEEKS * MS_WK;
  if (toMs < horizonStart || fromMs > horizonEnd) return null;
  const from = Math.max(0, Math.floor((fromMs - horizonStart) / MS_WK));
  const to = Math.min(HORIZON_WEEKS - 1, Math.floor((toMs - horizonStart) / MS_WK));
  return { from, to };
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function StaffingGantt() {
  const { toast } = useToast();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWeighted, setShowWeighted] = useState(true);
  const [showPipeline, setShowPipeline] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/pricing/proposals", { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/employees", { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ]).then(([pp, ee]) => {
      setProposals(Array.isArray(pp) ? pp : []);
      setEmployees(Array.isArray(ee) ? ee : []);
      setLoading(false);
    }).catch(() => { toast({ title: "Failed to load staffing data", variant: "destructive" }); setLoading(false); });
  }, [toast]);

  const weekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const weeks = useMemo(() => {
    return Array.from({ length: HORIZON_WEEKS }, (_, i) => new Date(weekStart.getTime() + i * MS_WK));
  }, [weekStart]);

  // Build the full set of people we want to display:
  //  - every Eendigo employee (always shown so we can see who has slack)
  //  - every manager_name + team_members[].name on a relevant proposal
  const people = useMemo(() => {
    const out = new Map<string, { name: string; role?: string }>();
    for (const e of employees) {
      out.set(e.name.trim().toLowerCase(), { name: e.name, role: e.current_role_code ?? undefined });
    }
    for (const p of proposals) {
      const includeP = p.outcome === "won" || (showPipeline && p.outcome === "pending");
      if (!includeP) continue;
      if (p.manager_name) {
        const k = p.manager_name.trim().toLowerCase();
        if (!out.has(k)) out.set(k, { name: p.manager_name, role: "EM" });
      }
      for (const m of (p.team_members ?? [])) {
        if (!m.name) continue;
        const k = m.name.trim().toLowerCase();
        if (!out.has(k)) out.set(k, { name: m.name, role: m.role || undefined });
      }
    }
    return Array.from(out.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, proposals, showPipeline]);

  // Per-person × week allocation matrix. Each cell = list of project blocks.
  type Block = { project: string; client?: string | null; outcome: string; alpha: number; isManager: boolean };
  const matrix = useMemo(() => {
    const out: Record<string, Block[][]> = {};
    for (const person of people) {
      out[person.name.toLowerCase()] = Array.from({ length: HORIZON_WEEKS }, () => [] as Block[]);
    }
    for (const p of proposals) {
      if (p.outcome === "lost") continue;
      if (!showPipeline && p.outcome === "pending") continue;
      const span = projectWeeks(p, weekStart);
      if (!span) continue;
      const isPipeline = p.outcome === "pending";
      const probability = isPipeline ? Math.max(0, Math.min(100, Number(p.win_probability ?? 50))) / 100 : 1;
      const alpha = isPipeline ? (showWeighted ? probability : 0.4) : 1.0;

      const allocate = (name: string, isManager: boolean) => {
        const k = name.trim().toLowerCase();
        if (!out[k]) return; // person not in display set
        for (let w = span.from; w <= span.to; w++) {
          out[k][w].push({
            project: p.project_name,
            client: p.client_name ?? null,
            outcome: p.outcome,
            alpha,
            isManager,
          });
        }
      };

      if (p.manager_name) allocate(p.manager_name, true);
      for (const m of (p.team_members ?? [])) {
        if (m.name) allocate(m.name, false);
      }
    }
    return out;
  }, [people, proposals, weekStart, showPipeline, showWeighted]);

  // For each person: when are they next free? If currently allocated, find
  // the first unallocated week.
  const availability = useMemo(() => {
    const out: Record<string, string> = {};
    for (const person of people) {
      const cells = matrix[person.name.toLowerCase()] ?? [];
      const firstFree = cells.findIndex(c => c.length === 0);
      if (cells[0]?.length === 0) {
        out[person.name] = "available now";
      } else if (firstFree === -1) {
        out[person.name] = ">16 weeks";
      } else {
        out[person.name] = `from ${fmtWeek(weeks[firstFree])}`;
      }
    }
    return out;
  }, [matrix, people, weeks]);

  if (loading) {
    return <div className="container mx-auto py-8 text-sm text-muted-foreground">Loading staffing…</div>;
  }

  return (
    <div className="container mx-auto py-6 max-w-[1400px]">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <CalendarRange className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Staffing Gantt</h1>
            <p className="text-sm text-muted-foreground">
              16-week look-ahead. Solid blocks = won + ongoing. Striped/transparent = pipeline (weighted by win-probability when toggle is on). Sales: confirm a person is free before committing a start date.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Button
            size="sm" variant={showPipeline ? "default" : "outline"} className="h-7"
            onClick={() => setShowPipeline(v => !v)}
          >
            <Filter className="w-3.5 h-3.5 mr-1" />
            {showPipeline ? "Pipeline shown" : "Pipeline hidden"}
          </Button>
          <Button
            size="sm" variant={showWeighted ? "default" : "outline"} className="h-7"
            onClick={() => setShowWeighted(v => !v)}
            disabled={!showPipeline}
          >
            {showWeighted ? "Probability-weighted" : "Flat opacity"}
          </Button>
        </div>
      </div>

      {people.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground italic">
          <Users className="w-6 h-6 mx-auto mb-2" />
          No people to display. Add employees in /employees or set manager_name / team_members on a Won project under /pricing → Past Projects.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b">
                <th className="text-left p-2 font-semibold w-44 sticky left-0 bg-card z-10">Person</th>
                <th className="text-left p-2 font-semibold w-28 sticky left-44 bg-card z-10">Available</th>
                {weeks.map((w, i) => (
                  <th key={i} className="text-center p-1 font-medium text-[10px] text-muted-foreground border-l min-w-16">
                    {fmtWeek(w)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map(person => {
                const cells = matrix[person.name.toLowerCase()] ?? [];
                const avail = availability[person.name];
                const availTone = avail === "available now"
                  ? "text-emerald-600 font-semibold"
                  : avail === ">16 weeks"
                  ? "text-red-600 font-semibold"
                  : "text-amber-700";
                return (
                  <tr key={person.name} className="border-b hover:bg-muted/20">
                    <td className="p-2 font-medium truncate sticky left-0 bg-background z-10">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{person.name}</span>
                        {person.role && <Badge variant="outline" className="text-[9px] py-0 h-4 shrink-0">{person.role}</Badge>}
                      </div>
                    </td>
                    <td className={`p-2 text-[11px] sticky left-44 bg-background z-10 ${availTone}`}>{avail}</td>
                    {cells.map((blocks, w) => (
                      <td key={w} className="border-l align-top p-0 min-w-16">
                        <div className="flex flex-col gap-0.5 p-0.5">
                          {blocks.map((b, i) => (
                            <div
                              key={i}
                              title={`${b.project}${b.client ? " · " + b.client : ""} · ${b.outcome}${b.alpha < 1 ? ` · weighted ${(b.alpha * 100).toFixed(0)}%` : ""}${b.isManager ? " · manager" : ""}`}
                              className={`text-[9px] px-1 py-0.5 rounded font-mono truncate ${
                                b.isManager
                                  ? "bg-primary/80 text-primary-foreground"
                                  : "bg-emerald-500/80 text-white"
                              } ${b.outcome === "pending" ? "ring-1 ring-amber-400" : ""}`}
                              style={{ opacity: Math.max(0.25, b.alpha) }}
                            >
                              {b.project}
                            </div>
                          ))}
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <div className="mt-4 flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-primary/80" />
          Manager assignment
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-emerald-500/80" />
          Team-member assignment
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-emerald-500/40 ring-1 ring-amber-400" />
          Pipeline (probability-weighted)
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3" />
          Set start_date / end_date / manager_name / team_members on past-projects rows in /pricing.
        </div>
      </div>
    </div>
  );
}
