import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CalendarRange, Filter, Users, AlertCircle, UserPlus, X, Zap } from "lucide-react";
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

interface ExternalContact {
  id: number;
  name: string;
  email?: string | null;
  kind: string; // "freelancer" | "partner" | ...
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const MS_DAY = 86_400_000;
const MS_WK = 7 * MS_DAY;
const HORIZON_WEEKS = 24;

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

function fmtIso(d: Date): string {
  return d.toISOString().split("T")[0];
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
  const [externals, setExternals] = useState<ExternalContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWeighted, setShowWeighted] = useState(true);
  const [showPipeline, setShowPipeline] = useState(true);

  // ── FTE breakdown modal state ───────────────────────────────────────────────
  const [breakdownWeekIndex, setBreakdownWeekIndex] = useState<number | null>(null);

  // ── TBD card inline start-date editing ────────────────────────────────────
  const [editingStartDate, setEditingStartDate] = useState<number | null>(null); // proposal id

  async function saveStartDate(proposalId: number, newDate: string) {
    const proj = proposals.find(p => p.id === proposalId);
    if (!proj) return;
    try {
      const r = await fetch(`/api/pricing/proposals/${proposalId}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...proj, start_date: newDate || null }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const updated = await r.json();
      setProposals(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
    } catch (e) {
      toast({ title: "Failed to save start date", variant: "destructive" });
    } finally {
      setEditingStartDate(null);
    }
  }

  // ── Assign-to-project modal state ─────────────────────────────────────────
  // Two entry points:
  //   (A) Person-first  → click UserPlus on a row → assignFor is set, project blank
  //   (B) Project-first → click Reserve on a TBD card → assignProjectId is set, person blank
  const [assignModalOpen,  setAssignModalOpen]  = useState(false);
  const [assignFor,        setAssignFor]        = useState<string | null>(null);   // person name
  const [assignProjectId,  setAssignProjectId]  = useState<string>("");
  const [assignKind,       setAssignKind]       = useState<"manager" | "team">("team");
  const [assignRoleLabel,  setAssignRoleLabel]  = useState<string>("Associate");
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  // For TBD projects: optionally update the proposal's start_date to the
  // person's first available week so the Gantt block appears in the right place.
  const [updateStartDate,  setUpdateStartDate]  = useState(true);

  function openAssignModal(personName: string) {
    setAssignFor(personName);
    setAssignProjectId("");
    setAssignKind("team");
    setAssignRoleLabel("Associate");
    setUpdateStartDate(true);
    setAssignModalOpen(true);
  }

  function openFromProjectModal(projectId: number) {
    setAssignFor(null);
    setAssignProjectId(String(projectId));
    setAssignKind("team");
    setAssignRoleLabel("Associate");
    setUpdateStartDate(true);
    setAssignModalOpen(true);
  }

  function closeAssignModal() {
    setAssignFor(null);
    setAssignProjectId("");
    setAssignModalOpen(false);
    setAssignSubmitting(false);
  }

  const dropdownWeekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const openProjects = useMemo(() => {
    return proposals
      .filter(p => {
        if (p.outcome === "lost") return false;
        if (p.outcome === "pending") return true;
        const span = projectWeeks(p, dropdownWeekStart);
        if (span !== null) return true;
        if (p.manager_name || (p.team_members ?? []).length > 0) return true;
        return false;
      })
      .sort((a, b) => (a.project_name || "").localeCompare(b.project_name || ""));
  }, [proposals, dropdownWeekStart]);

  async function submitAssign() {
    if (!assignFor || !assignProjectId) {
      toast({ title: "Pick both a person and a project", variant: "destructive" });
      return;
    }
    const proj = proposals.find(p => String(p.id) === assignProjectId);
    if (!proj) return;
    setAssignSubmitting(true);

    const patch: Record<string, unknown> = { ...proj };
    if (assignKind === "manager") {
      patch.manager_name = assignFor;
    } else {
      const existing = Array.isArray(proj.team_members) ? proj.team_members : [];
      const already = existing.some(m => (m.name || "").trim().toLowerCase() === assignFor.trim().toLowerCase());
      patch.team_members = already
        ? existing
        : [...existing, { role: assignRoleLabel.trim() || "Team", name: assignFor }];
    }

    // For TBD/pending projects: optionally set start_date = person's first free week
    // so the Gantt block appears at the right position without manual date entry.
    if (proj.outcome === "pending" && updateStartDate) {
      const d = availabilityDates[assignFor];
      patch.start_date = d ? fmtIso(d) : fmtIso(new Date());
    }

    try {
      const r = await fetch(`/api/pricing/proposals/${proj.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const updated = await r.json();
      setProposals(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
      toast({
        title: "Reserved",
        description: `${assignFor} → ${proj.project_name}${proj.outcome === "pending" ? " (TBD)" : ""}`,
      });
      closeAssignModal();
    } catch (e) {
      toast({ title: "Failed to assign", description: (e as Error).message, variant: "destructive" });
      setAssignSubmitting(false);
    }
  }

  async function unassign(personName: string, projectId: number) {
    const proj = proposals.find(p => p.id === projectId);
    if (!proj) return;
    const lower = personName.trim().toLowerCase();
    const patch: Record<string, unknown> = { ...proj };
    if ((proj.manager_name || "").trim().toLowerCase() === lower) {
      patch.manager_name = null;
    } else {
      patch.team_members = (proj.team_members ?? []).filter(
        m => (m.name || "").trim().toLowerCase() !== lower,
      );
    }
    try {
      const r = await fetch(`/api/pricing/proposals/${proj.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const updated = await r.json();
      setProposals(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
    } catch (e) {
      toast({ title: "Failed to unassign", description: (e as Error).message, variant: "destructive" });
    }
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/pricing/proposals",  { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/employees",          { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/external-contacts",  { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ]).then(([pp, ee, ex]) => {
      setProposals(Array.isArray(pp) ? pp : []);
      setEmployees(Array.isArray(ee) ? ee : []);
      setExternals(Array.isArray(ex) ? ex : []);
      setLoading(false);
    }).catch(() => { toast({ title: "Failed to load staffing data", variant: "destructive" }); setLoading(false); });
  }, [toast]);

  const weekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const weeks = useMemo(() => {
    return Array.from({ length: HORIZON_WEEKS }, (_, i) => new Date(weekStart.getTime() + i * MS_WK));
  }, [weekStart]);

  // Interns (INT) and Back Office (BO) are not billable — exclude from Gantt.
  const NON_BILLABLE_ROLE_CODES = new Set(["ADMIN", "BACKOFFICE", "BO", "INT", "FINANCE", "OPS"]);
  const isBackOffice = (e: Employee): boolean => {
    const code = (e.current_role_code ?? "").trim().toUpperCase();
    return NON_BILLABLE_ROLE_CODES.has(code);
  };

  const people = useMemo(() => {
    // Build exclusion set first so retired names are never re-added from proposal assignments.
    const excluded = new Set<string>();
    for (const e of employees) {
      if ((e as any).status === "former" || isBackOffice(e)) {
        excluded.add(e.name.trim().toLowerCase());
      }
    }
    const out = new Map<string, { name: string; role?: string }>();
    for (const e of employees) {
      if (excluded.has(e.name.trim().toLowerCase())) continue;
      out.set(e.name.trim().toLowerCase(), { name: e.name, role: e.current_role_code ?? undefined });
    }
    for (const p of proposals) {
      const includeP = p.outcome === "won" || (showPipeline && p.outcome === "pending");
      if (!includeP) continue;
      if (p.manager_name) {
        const k = p.manager_name.trim().toLowerCase();
        if (!out.has(k) && !excluded.has(k)) out.set(k, { name: p.manager_name, role: "EM" });
      }
      for (const m of (p.team_members ?? [])) {
        if (!m.name) continue;
        const k = m.name.trim().toLowerCase();
        if (!out.has(k) && !excluded.has(k)) out.set(k, { name: m.name, role: m.role || undefined });
      }
    }
    return Array.from(out.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, proposals, showPipeline]);

  type Block = { project: string; projectId: number; client?: string | null; outcome: string; alpha: number; isManager: boolean };
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
        if (!out[k]) return;
        for (let w = span.from; w <= span.to; w++) {
          out[k][w].push({ project: p.project_name, projectId: p.id, client: p.client_name ?? null, outcome: p.outcome, alpha, isManager });
        }
      };

      if (p.manager_name) allocate(p.manager_name, true);
      for (const m of (p.team_members ?? [])) {
        if (m.name) allocate(m.name, false);
      }
    }
    return out;
  }, [people, proposals, weekStart, showPipeline, showWeighted]);

  // FTE demand per week: full count for won/ongoing projects + (count × prob)
  // for TBD pipeline. Counted from `manager_name` + `team_members`, so a TBD
  // proposal with no team yet contributes 0 (no signal of headcount needed).
  // Always weighted by win_probability for pending — independent of the
  // showWeighted/showPipeline visual toggles, since this is the demand picture.
  type BreakdownItem = { projectName: string; outcome: string; manager?: string; teamMembers: string[]; teamCount: number; probability: number; weight: number; contribution: number };
  const { ftesNeededPerWeek, breakdownPerWeek } = useMemo(() => {
    const totals = Array<number>(HORIZON_WEEKS).fill(0);
    const breakdowns = Array<BreakdownItem[]>(HORIZON_WEEKS).fill(null).map(() => []);

    for (const p of proposals) {
      if (p.outcome === "lost") continue;
      const span = projectWeeks(p, weekStart);
      if (!span) continue;

      const manager = p.manager_name && (p.manager_name ?? "").trim().length > 0 ? p.manager_name : null;
      const teamMembers = (p.team_members ?? [])
        .filter(m => (m.name ?? "").trim().length > 0)
        .map(m => m.name!);
      const teamCount = (manager ? 1 : 0) + teamMembers.length;

      if (teamCount === 0) continue;

      const isPipeline = p.outcome === "pending";
      const prob = Math.max(0, Math.min(100, Number(p.win_probability ?? 50)));
      const weight = isPipeline ? prob / 100 : 1;
      const contribution = teamCount * weight;

      const breakdownItem: BreakdownItem = {
        projectName: p.project_name,
        outcome: p.outcome,
        manager,
        teamMembers,
        teamCount,
        probability: prob,
        weight,
        contribution,
      };

      for (let w = span.from; w <= span.to; w++) {
        totals[w] += contribution;
        breakdowns[w].push(breakdownItem);
      }
    }
    return { ftesNeededPerWeek: totals, breakdownPerWeek: breakdowns };
  }, [proposals, weekStart]);

  // Availability: human-readable string + actual Date for the first free week.
  // The Date is used when reserving to a TBD project (start_date patch).
  const { availability, availabilityDates } = useMemo(() => {
    const avail: Record<string, string> = {};
    const dates: Record<string, Date | null> = {};
    for (const person of people) {
      const cells = matrix[person.name.toLowerCase()] ?? [];
      const firstFree = cells.findIndex(c => c.length === 0);
      if (cells[0]?.length === 0) {
        avail[person.name]  = "available now";
        dates[person.name]  = null; // null = today
      } else if (firstFree === -1) {
        avail[person.name]  = `>${HORIZON_WEEKS}w`;
        dates[person.name]  = null;
      } else {
        avail[person.name]  = `from ${fmtWeek(weeks[firstFree])}`;
        dates[person.name]  = weeks[firstFree];
      }
    }
    return { availability: avail, availabilityDates: dates };
  }, [matrix, people, weeks]);

  // Full person list for the modal picker: Gantt rows + all external contacts.
  // External contacts include freelancers (Wissam, Thomas, Defne, …) and partners.
  // Deduped by lower-case name so employees already in the Gantt aren't doubled.
  const allPeopleForModal = useMemo(() => {
    const seen = new Set(people.map(p => p.name.trim().toLowerCase()));
    const extras: { name: string; role?: string }[] = [];
    for (const ext of externals) {
      const key = ext.name.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        extras.push({ name: ext.name, role: ext.kind });
      }
    }
    return [...people, ...extras].sort((a, b) => a.name.localeCompare(b.name));
  }, [people, externals]);

  // TBD = pending proposals, sorted by win probability descending.
  const tbdProposals = useMemo(() =>
    proposals
      .filter(p => p.outcome === "pending")
      .sort((a, b) => (b.win_probability ?? 0) - (a.win_probability ?? 0)),
    [proposals]);

  // Derive modal context helpers
  const selectedProposal = openProjects.find(x => String(x.id) === assignProjectId) ?? null;
  const isTBD = selectedProposal?.outcome === "pending";
  const personAvailDate = (assignFor && availabilityDates[assignFor] !== undefined)
    ? availabilityDates[assignFor]
    : null;
  const proposedStartIso = personAvailDate ? fmtIso(personAvailDate) : fmtIso(new Date());

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
              {HORIZON_WEEKS}-week look-ahead. Solid = won / ongoing. Striped = TBD pipeline (weighted by win-prob). Click <span className="font-mono">+</span> to assign a person; click <span className="font-mono">Reserve</span> on a TBD card to pick a person.
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
                  : avail.startsWith(">")
                  ? "text-red-600 font-semibold"
                  : "text-amber-700";
                return (
                  <tr key={person.name} className="border-b hover:bg-muted/20">
                    <td className="p-2 font-medium truncate sticky left-0 bg-background z-10">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{person.name}</span>
                        {person.role && <Badge variant="outline" className="text-[9px] py-0 h-4 shrink-0">{person.role}</Badge>}
                        <button
                          onClick={() => openAssignModal(person.name)}
                          className="ml-auto shrink-0 p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                          title={`Assign ${person.name} to a project`}
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                        </button>
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
                              className={`group relative text-[9px] px-1 py-0.5 rounded font-mono truncate ${
                                b.outcome === "pending"
                                  ? "bg-amber-400/70 text-amber-950 ring-1 ring-amber-500"
                                  : b.isManager
                                  ? "bg-primary/80 text-primary-foreground"
                                  : "bg-emerald-500/80 text-white"
                              }`}
                              style={{ opacity: Math.max(0.25, b.alpha) }}
                            >
                              {b.project}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm(`Remove ${person.name} from ${b.project}?`)) {
                                    void unassign(person.name, b.projectId);
                                  }
                                }}
                                className="absolute -top-1 -right-1 hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white text-black shadow border border-black/10 hover:bg-red-500 hover:text-white"
                                title={`Remove ${person.name} from ${b.project}`}
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 bg-muted/40 font-semibold">
                <td className="p-2 sticky left-0 bg-muted/60 z-10 w-44">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    FTEs needed
                  </div>
                </td>
                <td
                  className="p-2 sticky left-44 bg-muted/60 z-10 w-28 text-[10px] font-normal text-muted-foreground"
                  title="Per week: FTEs on won/ongoing projects + Σ(FTEs on TBD × win-probability)"
                >
                  won + tbd × prob
                </td>
                {ftesNeededPerWeek.map((n, i) => (
                  <td
                    key={i}
                    className="border-l text-center font-mono text-[11px] p-1 min-w-16 cursor-pointer hover:bg-primary/20 transition-colors"
                    title={n > 0 ? `Click to see breakdown · ${n.toFixed(2)} FTE-equivalents needed week of ${fmtWeek(weeks[i])}` : "no demand"}
                    onClick={() => n > 0 && setBreakdownWeekIndex(i)}
                  >
                    {n > 0 ? n.toFixed(1) : "—"}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      {/* ── FTE Breakdown Modal ────────────────────────────────────────────── */}
      {breakdownWeekIndex !== null && (
        <Dialog open={breakdownWeekIndex !== null} onOpenChange={(open) => !open && setBreakdownWeekIndex(null)}>
          <DialogContent className="max-w-2xl max-h-[70vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>FTE Calculation Breakdown</DialogTitle>
              <DialogDescription>
                Week of {fmtWeek(weeks[breakdownWeekIndex])} · Total: <span className="font-mono font-bold text-foreground">{ftesNeededPerWeek[breakdownWeekIndex].toFixed(2)}</span> FTE
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {breakdownPerWeek[breakdownWeekIndex].length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No projects contributing to this week</p>
              ) : (
                breakdownPerWeek[breakdownWeekIndex].map((item, idx) => (
                  <div key={idx} className="border rounded p-3 space-y-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{item.projectName}</div>
                        <div className="text-[12px] text-muted-foreground">
                          Status: <span className={item.outcome === "won" ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"}>{item.outcome}</span>
                          {item.outcome === "pending" && ` · ${item.probability}% win probability`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-bold text-lg">{item.contribution.toFixed(2)} FTE</div>
                        <div className="text-[11px] text-muted-foreground">= {item.teamCount} × {item.weight.toFixed(2)}</div>
                      </div>
                    </div>
                    <div className="text-[12px] text-muted-foreground space-y-1">
                      {item.manager && <div>Manager: <span className="font-medium">{item.manager}</span></div>}
                      {item.teamMembers.length > 0 && (
                        <div>
                          Team ({item.teamMembers.length}): <span className="font-medium">{item.teamMembers.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              <div className="border-t pt-3 mt-4">
                <div className="flex justify-between font-semibold">
                  <span>Total FTE needed for week of {fmtWeek(weeks[breakdownWeekIndex])}</span>
                  <span className="font-mono text-lg">{ftesNeededPerWeek[breakdownWeekIndex].toFixed(2)}</span>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      <div className="mt-4 flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-primary/80" />
          Manager
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-emerald-500/80" />
          Team member
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-amber-400/70 ring-1 ring-amber-500" />
          TBD pipeline (prob-weighted)
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <AlertCircle className="w-3 h-3" />
          Click <UserPlus className="inline w-3 h-3" /> on a row or <strong>Reserve</strong> on a TBD card. Hover a block + × to unassign.
        </div>
      </div>

      {/* ── TBD Pipeline ───────────────────────────────────────────────────── */}
      {tbdProposals.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-semibold">TBD Pipeline</h2>
            <span className="text-[11px] text-muted-foreground">
              {tbdProposals.length} pending proposal{tbdProposals.length !== 1 ? "s" : ""} · click Reserve to pre-assign a person starting from their availability date
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {tbdProposals.map(p => {
              const team = [
                ...(p.manager_name ? [{ role: "Manager", name: p.manager_name }] : []),
                ...(p.team_members ?? []),
              ];
              const probColor =
                (p.win_probability ?? 0) >= 70 ? "bg-emerald-100 text-emerald-800 border-emerald-300" :
                (p.win_probability ?? 0) >= 40 ? "bg-amber-100 text-amber-800 border-amber-300" :
                "bg-red-100 text-red-800 border-red-300";
              return (
                <Card key={p.id} className="p-3 border-amber-200 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-sm truncate">{p.project_name}</div>
                      {p.client_name && <div className="text-[10px] text-muted-foreground truncate">{p.client_name}</div>}
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${probColor}`}>
                      {p.win_probability != null ? `${p.win_probability}%` : "?%"}
                    </Badge>
                  </div>

                  <div className="text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
                    {p.duration_weeks && <span>{p.duration_weeks}w</span>}
                    {editingStartDate === p.id ? (
                      <input
                        autoFocus
                        type="date"
                        defaultValue={p.start_date ?? ""}
                        className="text-[10px] border border-primary rounded px-1 py-0.5 text-foreground bg-background outline-none"
                        onBlur={e => saveStartDate(p.id, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setEditingStartDate(null);
                        }}
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:text-primary hover:underline"
                        title="Click to edit start date"
                        onClick={() => setEditingStartDate(p.id)}
                      >
                        {p.start_date ? `· starts ${p.start_date}` : <span className="italic">· no start date — click to set</span>}
                      </span>
                    )}
                  </div>

                  {/* Already-reserved team members */}
                  {team.length > 0 && (
                    <div className="text-[10px] text-muted-foreground space-y-0.5">
                      {team.map((m, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
                          <span className="font-medium truncate">{m.name}</span>
                          <span className="text-muted-foreground/60">· {m.role}</span>
                          {/* Show availability of already-assigned members */}
                          {availability[m.name] && (
                            <span className={`ml-auto shrink-0 ${
                              availability[m.name] === "available now" ? "text-emerald-600" :
                              availability[m.name].startsWith(">")     ? "text-red-500" :
                              "text-amber-600"
                            }`}>{availability[m.name]}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <Button
                    size="sm" variant="outline"
                    className="w-full h-7 text-xs border-amber-300 hover:bg-amber-50"
                    onClick={() => openFromProjectModal(p.id)}
                  >
                    <UserPlus className="w-3.5 h-3.5 mr-1" /> Reserve person →
                  </Button>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Assign / Reserve modal ─────────────────────────────────────────── */}
      <Dialog open={assignModalOpen} onOpenChange={(open) => { if (!open) closeAssignModal(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {assignFor
                ? `Assign ${assignFor} to a project`
                : selectedProposal
                ? `Reserve a person for ${selectedProposal.project_name}`
                : "Assign to project"}
            </DialogTitle>
            <DialogDescription>
              {isTBD
                ? "TBD project — reserving a person will set the project's start date to when they become available."
                : "Pick an open project (won + ongoing, or pending pipeline). The Gantt re-renders from the project's dates."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">

            {/* Person selector — shown when opened from a project card */}
            {!assignFor && (
              <div className="space-y-1">
                <Label className="text-xs">Person</Label>
                <Select
                  value={assignFor ?? ""}
                  onValueChange={v => setAssignFor(v || null)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="— pick a person —" />
                  </SelectTrigger>
                  <SelectContent>
                    {allPeopleForModal.map(p => {
                      const avail = availability[p.name];
                      return (
                        <SelectItem key={p.name} value={p.name}>
                          <span className="font-medium">{p.name}</span>
                          {p.role && <span className="text-muted-foreground ml-1 text-[10px]">{p.role}</span>}
                          {avail ? (
                            <span className={`ml-2 text-[10px] ${
                              avail === "available now" ? "text-emerald-600" :
                              avail.startsWith(">")    ? "text-red-500" :
                              "text-amber-600"
                            }`}>{avail}</span>
                          ) : (
                            <span className="ml-2 text-[10px] text-emerald-600">freelancer</span>
                          )}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Project selector — shown when opened from a person row */}
            {assignFor && (
              <div className="space-y-1">
                <Label className="text-xs">Project</Label>
                <Select value={assignProjectId} onValueChange={setAssignProjectId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="— pick a project —" />
                  </SelectTrigger>
                  <SelectContent>
                    {openProjects.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground italic">
                        No open projects. Add one under /pricing → Past Projects.
                      </div>
                    ) : openProjects.map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        <span className="font-mono font-semibold">{p.project_name}</span>
                        {p.client_name && <span className="text-muted-foreground"> · {p.client_name}</span>}
                        {p.outcome === "pending" && (
                          <span className="text-amber-600 text-[10px]"> · TBD {p.win_probability != null ? `${p.win_probability}%` : ""}</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Role on project */}
            <div className="space-y-1">
              <Label className="text-xs">Role on this project</Label>
              <Select value={assignKind} onValueChange={(v) => setAssignKind(v as "manager" | "team")}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Manager (EM) — replaces current manager</SelectItem>
                  <SelectItem value="team">Team member — added to team</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {assignKind === "team" && (
              <div className="space-y-1">
                <Label className="text-xs">Team-member role label</Label>
                <Input
                  value={assignRoleLabel}
                  onChange={(e) => setAssignRoleLabel(e.target.value)}
                  placeholder="e.g. Partner, Senior, BA"
                  className="h-9 text-sm"
                />
              </div>
            )}

            {/* TBD project info: show availability + start-date update option */}
            {isTBD && assignFor && (
              <div className="space-y-2 border rounded p-2.5 bg-amber-50/60 border-amber-200">
                <div className="text-[11px] text-amber-800">
                  <span className="font-semibold">{assignFor}</span> is{" "}
                  {personAvailDate
                    ? <>free from <span className="font-mono">{fmtWeek(personAvailDate)}</span> ({proposedStartIso})</>
                    : <span className="text-emerald-700 font-semibold">available now</span>
                  }
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-[11px] text-amber-900">
                  <input
                    type="checkbox"
                    checked={updateStartDate}
                    onChange={e => setUpdateStartDate(e.target.checked)}
                    className="rounded"
                  />
                  Set <strong>{selectedProposal?.project_name}</strong> start date → <span className="font-mono">{proposedStartIso}</span>
                </label>
              </div>
            )}

            {/* Project window summary */}
            {assignProjectId && selectedProposal && (
              <div className="text-[10px] text-muted-foreground border rounded p-2 bg-muted/30">
                {selectedProposal.outcome === "pending" ? (
                  <>TBD · {selectedProposal.duration_weeks ?? "?"}w · win prob{" "}
                  <span className="font-mono font-semibold">{selectedProposal.win_probability ?? "?"}%</span>
                  {updateStartDate && assignFor
                    ? <> · planned start <span className="font-mono">{proposedStartIso}</span></>
                    : selectedProposal.start_date
                    ? <> · current start <span className="font-mono">{selectedProposal.start_date}</span></>
                    : " · no start date yet"}
                  </>
                ) : (
                  <>Project window: <span className="font-mono">{selectedProposal.start_date || selectedProposal.proposal_date || "—"}</span> →{" "}
                  <span className="font-mono">{selectedProposal.end_date || (selectedProposal.duration_weeks ? `${selectedProposal.duration_weeks}w from start` : "—")}</span></>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeAssignModal} disabled={assignSubmitting}>Cancel</Button>
            <Button
              onClick={submitAssign}
              disabled={!assignFor || !assignProjectId || assignSubmitting}
            >
              {assignSubmitting ? "Reserving…" : isTBD ? "Reserve" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
