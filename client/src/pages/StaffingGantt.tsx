import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CalendarRange, Filter, Users, AlertCircle, UserPlus, X, Zap, Pencil, Check, Copy, RefreshCw } from "lucide-react";
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

// Pricing case — read-only here, used as the upstream source-of-truth
// for win_probability / start_date / duration_weeks. The Staffing Gantt
// links cases to proposals by project_name (case-insensitive); when a
// proposal is missing one of these three fields, we fall back to the
// case's value, and the user can also click "Copy from case" to persist
// the case values onto the proposal in one action.
interface PricingCase {
  id: number;
  project_name: string;
  client_name?: string | null;
  duration_weeks?: number | null;
  win_probability?: number | null;
  start_date?: string | null;
  outcome?: string | null;
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
  // Pricing cases — read-only source-of-truth for win_probability /
  // start_date / duration_weeks when the corresponding proposal has
  // those fields null. Keyed by lowercased project_name in caseByName.
  const [cases, setCases] = useState<PricingCase[]>([]);
  // Inline-edit state per proposal id. When non-null for an id, the
  // card shows input fields instead of the static badge.
  const [editingFields, setEditingFields] = useState<Record<number, {
    win_probability: string;
    start_date: string;
    duration_weeks: string;
  }>>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showWeighted, setShowWeighted] = useState(true);
  const [showPipeline, setShowPipeline] = useState(true);

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

  function loadGanttData() {
    setFetchError(null);
    setLoading(true);
    const safe = (url: string) =>
      fetch(url, { credentials: "include" }).then(async r => {
        if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
        const body = await r.json().catch(() => { throw new Error(`${url} → invalid JSON (server may be restarting)`); });
        return body;
      });
    Promise.all([
      safe("/api/pricing/proposals"),
      safe("/api/employees"),
      safe("/api/external-contacts"),
      safe("/api/pricing/cases"),
    ]).then(([pp, ee, ex, cs]) => {
      setProposals(Array.isArray(pp) ? pp : []);
      setEmployees(Array.isArray(ee) ? ee : []);
      setExternals(Array.isArray(ex) ? ex : []);
      setCases(Array.isArray(cs) ? cs : []);
      setLoading(false);
    }).catch((e: Error) => {
      setFetchError(e.message);
      setLoading(false);
    });
  }

  useEffect(() => { loadGanttData(); }, []);

  // Lookup map: lowercased project_name → case (most recent revision wins
  // on duplicates). Strips any trailing single uppercase revision letter
  // ("RUB07A" → "rub07") so a proposal named "RUB07" still finds case
  // revision A. Used to fill missing proposal fields with case fallbacks.
  const caseByName = useMemo(() => {
    const m = new Map<string, PricingCase>();
    for (const c of cases) {
      const raw = (c.project_name ?? "").trim().toLowerCase();
      if (!raw) continue;
      const stripped = raw.replace(/[a-z]$/, "");
      // Latest case wins (assume id ordering reflects creation order)
      const incumbent = m.get(raw);
      if (!incumbent || c.id > incumbent.id) m.set(raw, c);
      const incumbentS = m.get(stripped);
      if (!incumbentS || c.id > incumbentS.id) m.set(stripped, c);
    }
    return m;
  }, [cases]);

  // Resolve effective prob/start/duration for a proposal, falling back
  // to the linked pricing case when the proposal's column is null.
  // Returns the case-derived flag too so the UI can show "(from case)".
  const effectiveFields = (p: Proposal) => {
    const raw = (p.project_name ?? "").trim().toLowerCase();
    const c = caseByName.get(raw) ?? caseByName.get(raw.replace(/[a-z]$/, ""));
    return {
      win_probability:
        p.win_probability != null ? p.win_probability :
        c?.win_probability != null ? c.win_probability : null,
      start_date:
        p.start_date ? p.start_date :
        c?.start_date ? c.start_date : null,
      duration_weeks:
        p.duration_weeks != null ? p.duration_weeks :
        c?.duration_weeks != null ? c.duration_weeks : null,
      probFromCase:    p.win_probability == null && c?.win_probability != null,
      startFromCase:   !p.start_date && !!c?.start_date,
      durFromCase:     p.duration_weeks == null && c?.duration_weeks != null,
      hasCase:         !!c,
    };
  };

  // Begin inline edit on a proposal card — pre-fills inputs with the
  // effective values (proposal first, case fallback) so the user starts
  // from the value they're seeing.
  const startEdit = (p: Proposal) => {
    const eff = effectiveFields(p);
    setEditingFields(prev => ({
      ...prev,
      [p.id]: {
        win_probability: eff.win_probability != null ? String(eff.win_probability) : "",
        start_date:      eff.start_date ?? "",
        duration_weeks:  eff.duration_weeks != null ? String(eff.duration_weeks) : "",
      },
    }));
  };
  const cancelEdit = (id: number) => setEditingFields(prev => {
    const next = { ...prev };
    delete next[id];
    return next;
  });

  // Save inline edits — PUTs the proposal with the new values. Empty
  // strings become null. Numbers are clamped to sensible ranges.
  const saveEdit = async (p: Proposal) => {
    const drafted = editingFields[p.id];
    if (!drafted) return;
    const wp = drafted.win_probability.trim() === ""
      ? null
      : Math.max(0, Math.min(100, Number(drafted.win_probability)));
    const sd = drafted.start_date.trim() === "" ? null : drafted.start_date.trim();
    const dw = drafted.duration_weeks.trim() === ""
      ? null
      : Math.max(0, Number(drafted.duration_weeks));
    try {
      const r = await fetch(`/api/pricing/proposals/${p.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...p, win_probability: wp, start_date: sd, duration_weeks: dw }),
      });
      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        toast({ title: `Save failed (HTTP ${r.status})`, description: errBody.slice(0, 200), variant: "destructive" });
        return;
      }
      const updated = await r.json();
      setProposals(prev => prev.map(x => x.id === updated.id ? { ...x, ...updated } : x));
      cancelEdit(p.id);
      toast({ title: "Updated" });
    } catch (e: any) {
      toast({ title: "Save failed", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  // One-click "copy from pricing case" — persists prob/start/duration
  // from the linked case onto the proposal so future loads use the
  // proposal's own values instead of the dynamic fallback.
  const copyFromCase = async (p: Proposal) => {
    const eff = effectiveFields(p);
    if (!eff.hasCase) {
      toast({ title: "No matching pricing case found", variant: "destructive" });
      return;
    }
    if (!eff.probFromCase && !eff.startFromCase && !eff.durFromCase) {
      toast({ title: "Proposal already has all 3 fields — nothing to copy" });
      return;
    }
    try {
      const r = await fetch(`/api/pricing/proposals/${p.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...p,
          win_probability: eff.win_probability,
          start_date:      eff.start_date,
          duration_weeks:  eff.duration_weeks,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const updated = await r.json();
      setProposals(prev => prev.map(x => x.id === updated.id ? { ...x, ...updated } : x));
      toast({ title: "Synced from pricing case" });
    } catch (e: any) {
      toast({ title: "Copy failed", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

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
    const out = new Map<string, { name: string; role?: string }>();
    for (const e of employees) {
      if (isBackOffice(e)) continue;
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

  // ── Monthly ASC demand row ─────────────────────────────────────────────
  // For each week of the horizon: count ASC FTE demand from
  //   (a) committed (won) projects: each team-member counted as 1 ASC
  //   (b) TBD pipeline:             each team-member × win_probability/100
  // Then aggregate weeks into months and take the PEAK week within each
  // month — that's the conservative "how many ASC do we need to plan
  // for this month" number, since hiring on a peak basis is what the
  // user described in the brief.
  //
  // Manager (the EM) is NOT counted toward ASC demand — managers run
  // the project, ASCs deliver. team_members.length excludes the manager
  // (the manager lives in p.manager_name, separate field). When team
  // hasn't been filled in yet, default to 1 ASC slot as a placeholder.
  const monthlyAscDemand = useMemo(() => {
    const weeklyCommitted = new Array(HORIZON_WEEKS).fill(0);
    const weeklyTbd       = new Array(HORIZON_WEEKS).fill(0);

    for (const p of proposals) {
      const teamSize = (p.team_members ?? []).length || 1;
      const eff = effectiveFields(p);
      // projectWeeks uses raw p.start_date/duration_weeks. Patch it with
      // case fallbacks before calling so TBDs that only have those
      // fields on the linked case still appear on the demand row.
      const patched: Proposal = {
        ...p,
        start_date: p.start_date ?? eff.start_date,
        duration_weeks: p.duration_weeks ?? eff.duration_weeks,
      };
      const span = projectWeeks(patched, weekStart);
      if (!span) continue;

      if (p.outcome === "won") {
        for (let w = span.from; w <= span.to; w++) {
          weeklyCommitted[w] += teamSize;
        }
      } else if (p.outcome === "pending") {
        const wp = (eff.win_probability ?? 0) / 100;
        if (wp > 0) {
          for (let w = span.from; w <= span.to; w++) {
            weeklyTbd[w] += teamSize * wp;
          }
        }
      }
    }

    // Group weeks by year-month, take the peak week's value as the
    // monthly figure (per the user's example: a TBD that contributes 1
    // FTE in any week of June makes June's monthly demand 1).
    const months: Array<{
      label:     string;
      weekFrom:  number;
      weekTo:    number;
      committed: number;
      tbd:       number;
    }> = [];
    for (let w = 0; w < HORIZON_WEEKS; w++) {
      const d = weeks[w];
      const key = d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
      const last = months[months.length - 1];
      if (!last || last.label !== key) {
        months.push({
          label: key, weekFrom: w, weekTo: w,
          committed: weeklyCommitted[w], tbd: weeklyTbd[w],
        });
      } else {
        last.weekTo = w;
        if (weeklyCommitted[w] > last.committed) last.committed = weeklyCommitted[w];
        if (weeklyTbd[w]       > last.tbd)       last.tbd       = weeklyTbd[w];
      }
    }
    return months;
  }, [proposals, weeks, weekStart, caseByName]);

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
      {fetchError && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">Failed to load staffing data</p>
            <p className="mt-0.5 text-red-700 break-all">{fetchError}</p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0 h-7 border-red-300 text-red-700 hover:bg-red-100" onClick={loadGanttData}>
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
          </Button>
        </div>
      )}
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
            {/* ASC demand by month — peak FTE need = committed + Σ(prob × team) */}
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50 dark:bg-slate-900">
                <td className="p-2 font-semibold text-[11px] sticky left-0 bg-slate-50 dark:bg-slate-900 z-10">
                  ASC demand
                </td>
                <td className="p-2 text-[10px] text-muted-foreground sticky left-44 bg-slate-50 dark:bg-slate-900 z-10">
                  peak / month
                </td>
                {monthlyAscDemand.map((m, i) => {
                  const span = m.weekTo - m.weekFrom + 1;
                  const total = m.committed + m.tbd;
                  // Color-code by demand: green = covered range, amber = stretching,
                  // red = needs hiring. Threshold values are heuristic — tune later.
                  const tone =
                    total >= 4 ? "bg-red-100 text-red-800"     :
                    total >= 2 ? "bg-amber-100 text-amber-800" :
                    total >  0 ? "bg-emerald-50  text-emerald-800" :
                                  "text-muted-foreground";
                  return (
                    <td
                      key={i}
                      colSpan={span}
                      className={`text-center p-1.5 border-l text-[10px] font-mono tabular-nums ${tone}`}
                      title={`${m.label}: ${m.committed.toFixed(1)} committed (won) + ${m.tbd.toFixed(2)} TBD-weighted = ${total.toFixed(2)} ASC FTE peak`}
                    >
                      <div className="font-semibold text-xs leading-tight">{total.toFixed(1)}</div>
                      <div className="opacity-70 text-[9px] leading-tight">
                        {m.committed.toFixed(0)}+{m.tbd.toFixed(1)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </Card>
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
              const eff = effectiveFields(p);
              const probColor =
                (eff.win_probability ?? 0) >= 70 ? "bg-emerald-100 text-emerald-800 border-emerald-300" :
                (eff.win_probability ?? 0) >= 40 ? "bg-amber-100 text-amber-800 border-amber-300" :
                "bg-red-100 text-red-800 border-red-300";
              const isEditing = !!editingFields[p.id];
              return (
                <Card key={p.id} className="p-3 border-amber-200 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-sm truncate">{p.project_name}</div>
                      {p.client_name && <div className="text-[10px] text-muted-foreground truncate">{p.client_name}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className={`text-[10px] ${probColor}`}>
                        {eff.win_probability != null ? `${eff.win_probability}%` : "?%"}
                        {eff.probFromCase && <span className="ml-0.5 text-[8px] opacity-70">·case</span>}
                      </Badge>
                      {!isEditing && (
                        <button onClick={() => startEdit(p)} className="text-muted-foreground hover:text-foreground p-0.5" title="Edit prob / start / duration">
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="space-y-1.5 bg-amber-50/50 -mx-3 px-3 py-2 border-y border-amber-100">
                      <div className="flex items-center gap-1">
                        <Label className="text-[10px] w-14 text-muted-foreground shrink-0">Win prob</Label>
                        <Input
                          type="number" min="0" max="100"
                          value={editingFields[p.id]!.win_probability}
                          onChange={e => setEditingFields(prev => ({ ...prev, [p.id]: { ...prev[p.id]!, win_probability: e.target.value } }))}
                          className="h-6 text-xs font-mono"
                          placeholder="%"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="text-[10px] w-14 text-muted-foreground shrink-0">Start</Label>
                        <Input
                          type="date"
                          value={editingFields[p.id]!.start_date}
                          onChange={e => setEditingFields(prev => ({ ...prev, [p.id]: { ...prev[p.id]!, start_date: e.target.value } }))}
                          className="h-6 text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Label className="text-[10px] w-14 text-muted-foreground shrink-0">Duration</Label>
                        <Input
                          type="number" min="0" step="0.5"
                          value={editingFields[p.id]!.duration_weeks}
                          onChange={e => setEditingFields(prev => ({ ...prev, [p.id]: { ...prev[p.id]!, duration_weeks: e.target.value } }))}
                          className="h-6 text-xs font-mono"
                          placeholder="weeks"
                        />
                      </div>
                      <div className="flex items-center gap-1 pt-1">
                        <Button size="sm" className="h-6 text-[10px] flex-1" onClick={() => saveEdit(p)}>
                          <Check className="w-3 h-3 mr-1" /> Save
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => cancelEdit(p.id)}>Cancel</Button>
                      </div>
                      {eff.hasCase && (eff.probFromCase || eff.startFromCase || eff.durFromCase) && (
                        <button
                          onClick={() => copyFromCase(p)}
                          className="text-[10px] text-blue-600 hover:underline flex items-center gap-1"
                          title="Persist the values shown above (which fall back to the linked pricing case) onto this proposal"
                        >
                          <Copy className="w-2.5 h-2.5" /> Copy missing fields from pricing case
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
                      {eff.duration_weeks != null && (
                        <span>{eff.duration_weeks}w{eff.durFromCase && <span className="opacity-60"> ·case</span>}</span>
                      )}
                      {eff.start_date && (
                        <span>· starts {eff.start_date}{eff.startFromCase && <span className="opacity-60"> ·case</span>}</span>
                      )}
                      {!eff.start_date && <span className="italic">· no start date yet</span>}
                    </div>
                  )}

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
