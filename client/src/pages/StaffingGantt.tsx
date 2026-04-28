import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CalendarRange, Filter, Users, AlertCircle, UserPlus, X } from "lucide-react";
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

  // ── Assign-to-project modal state ──────────────────────────────────────────
  // The user can click "+ Assign" on any person row to put them on an open
  // project (won OR pending pipeline). On submit we PATCH the proposal:
  //   • role=manager         → set proposal.manager_name = personName
  //   • role=team-member     → push { role, name } into proposal.team_members
  // The Gantt re-renders from the live data after the PUT returns.
  const [assignFor, setAssignFor] = useState<string | null>(null);   // person name
  const [assignProjectId, setAssignProjectId] = useState<string>("");
  const [assignKind, setAssignKind] = useState<"manager" | "team">("team");
  const [assignRoleLabel, setAssignRoleLabel] = useState<string>("Associate");
  const [assignSubmitting, setAssignSubmitting] = useState(false);

  function openAssignModal(personName: string) {
    setAssignFor(personName);
    setAssignProjectId("");
    setAssignKind("team");
    setAssignRoleLabel("Associate");
  }
  function closeAssignModal() {
    setAssignFor(null);
    setAssignSubmitting(false);
  }

  // Open projects in the dropdown = anything that ISN'T a closed loss AND
  // either (a) has its date span overlapping the 16-week look-ahead, OR
  // (b) is still pending pipeline (no firm dates yet but actively sold).
  // The previous "won + future end_date" filter was too strict and hid
  // ongoing engagements like SAN03 that are mid-flight (start in the
  // past, end in the past or near future) from the assign dialog.
  // weekStart is computed below in render — we re-derive it here so the
  // memo doesn't depend on it.
  const dropdownWeekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const openProjects = useMemo(() => {
    return proposals
      .filter(p => {
        if (p.outcome === "lost") return false;
        if (p.outcome === "pending") return true;
        // Won (or any non-lost outcome) — show if it overlaps the horizon
        // OR has at least one assignee already (so the user can edit the
        // current allocation even if dates are stale).
        const span = projectWeeks(p, dropdownWeekStart);
        if (span !== null) return true;
        if (p.manager_name || (p.team_members ?? []).length > 0) return true;
        return false;
      })
      .sort((a, b) => (a.project_name || "").localeCompare(b.project_name || ""));
  }, [proposals, dropdownWeekStart]);

  async function submitAssign() {
    if (!assignFor || !assignProjectId) {
      toast({ title: "Pick a project", variant: "destructive" });
      return;
    }
    const proj = proposals.find(p => String(p.id) === assignProjectId);
    if (!proj) return;
    setAssignSubmitting(true);
    // Build the patch. We send the whole proposal back (the existing PUT is
    // partial-tolerant but easier to send the full row to keep validation
    // schemas happy).
    const patch: Record<string, unknown> = { ...proj };
    if (assignKind === "manager") {
      patch.manager_name = assignFor;
    } else {
      const existing = Array.isArray(proj.team_members) ? proj.team_members : [];
      // Don't double-add if already on the team for this project.
      const already = existing.some(m => (m.name || "").trim().toLowerCase() === assignFor.trim().toLowerCase());
      patch.team_members = already
        ? existing
        : [...existing, { role: assignRoleLabel.trim() || "Team", name: assignFor }];
    }
    try {
      const r = await fetch(`/api/pricing/proposals/${proj.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const updated = await r.json();
      // Splice the updated proposal back into local state
      setProposals(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
      toast({
        title: "Assigned",
        description: `${assignFor} → ${proj.project_name} (${assignKind === "manager" ? "manager" : assignRoleLabel})`,
      });
      closeAssignModal();
    } catch (e) {
      toast({ title: "Failed to assign", description: (e as Error).message, variant: "destructive" });
      setAssignSubmitting(false);
    }
  }

  // Remove a person from a specific project block (manager or team member).
  // Called from the small × that appears on each block on hover.
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
  // Back-office / non-billable role codes — these people don't get staffed
  // on engagements so they shouldn't clutter the Gantt rows. Currently:
  // ADMIN (Cosmin et al.). Extendable as new non-billable roles appear.
  const NON_BILLABLE_ROLE_CODES = new Set(["ADMIN", "BACKOFFICE", "BO", "FINANCE", "OPS"]);
  const isBackOffice = (e: Employee): boolean => {
    const code = (e.current_role_code ?? "").trim().toUpperCase();
    return NON_BILLABLE_ROLE_CODES.has(code);
  };

  const people = useMemo(() => {
    const out = new Map<string, { name: string; role?: string }>();
    for (const e of employees) {
      if (isBackOffice(e)) continue; // skip Cosmin (ADMIN) + future back-office hires
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
  // We carry projectId so the user can hover-and-remove a single allocation
  // straight from the cell (× button) without going to /pricing.
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
        if (!out[k]) return; // person not in display set
        for (let w = span.from; w <= span.to; w++) {
          out[k][w].push({
            project: p.project_name,
            projectId: p.id,
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
                        {/* Quick-assign: opens the modal pre-filled with this person */}
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
                                b.isManager
                                  ? "bg-primary/80 text-primary-foreground"
                                  : "bg-emerald-500/80 text-white"
                              } ${b.outcome === "pending" ? "ring-1 ring-amber-400" : ""}`}
                              style={{ opacity: Math.max(0.25, b.alpha) }}
                            >
                              {b.project}
                              {/* × removes this person from the project entirely (manager OR team). */}
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
          Click <UserPlus className="inline w-3 h-3" /> on a row to assign that person to a project. Hover a block + click × to unassign.
        </div>
      </div>

      {/* ── Assign-to-project modal ─────────────────────────────────────── */}
      <Dialog open={assignFor !== null} onOpenChange={(open) => { if (!open) closeAssignModal(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign {assignFor} to a project</DialogTitle>
            <DialogDescription>
              Pick an open project (won + ongoing, or pending pipeline). The Gantt re-renders from the project's start_date / end_date / duration_weeks.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Project</Label>
              <Select value={assignProjectId} onValueChange={setAssignProjectId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="— pick a project —" />
                </SelectTrigger>
                <SelectContent>
                  {openProjects.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground italic">
                      No open projects. Add one under /pricing → Past Projects (outcome = Won or TBD).
                    </div>
                  ) : openProjects.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      <span className="font-mono font-semibold">{p.project_name}</span>
                      {p.client_name && <span className="text-muted-foreground"> · {p.client_name}</span>}
                      <span className="text-[10px] text-muted-foreground"> · {p.outcome}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Role on this project</Label>
              <Select value={assignKind} onValueChange={(v) => setAssignKind(v as "manager" | "team")}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
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
                  placeholder="e.g. Partner, Senior Associate, BA"
                  className="h-9 text-sm"
                />
                <div className="text-[9px] text-muted-foreground">
                  Free text — appears next to the name on past-projects + the Gantt tooltip.
                </div>
              </div>
            )}
            {assignProjectId && (() => {
              const p = openProjects.find(x => String(x.id) === assignProjectId);
              if (!p) return null;
              const start = p.start_date || p.proposal_date || "—";
              const end = p.end_date || (p.duration_weeks ? `${p.duration_weeks}w from start` : "—");
              return (
                <div className="text-[10px] text-muted-foreground border rounded p-2 bg-muted/30">
                  Project window: <span className="font-mono">{start}</span> → <span className="font-mono">{end}</span>
                  {p.outcome === "pending" && p.win_probability != null && (
                    <> · win prob <span className="font-mono">{p.win_probability}%</span></>
                  )}
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAssignModal} disabled={assignSubmitting}>Cancel</Button>
            <Button onClick={submitAssign} disabled={!assignProjectId || assignSubmitting}>
              {assignSubmitting ? "Assigning…" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
