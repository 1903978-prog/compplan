import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Briefcase, CheckCircle2, XCircle, Clock, Plus, Pencil, Trash2,
  TrendingUp, Languages as LanguagesIcon,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────
interface HiringOffer {
  id: number;
  candidate_name: string;
  role_offered: string;
  yearly_gross_eur: number | null;
  age: number | null;
  past_prof_tenure_years: number | null;
  test_results: Record<string, number | null>;
  languages: Array<{ lang: string; level: string }>;
  outcome: "pending" | "accepted" | "declined";
  decline_reason: string | null;
  decision_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// CEFR levels for the language picker. "native" added on top.
const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "native"];

// Common test keys — matches the headline scrape fields the hiring team
// already uses on hiring_candidates so cross-referencing later is easy.
const TEST_KEYS: Array<{ key: string; label: string }> = [
  { key: "logic_pct",     label: "Logic %" },
  { key: "verbal_pct",    label: "Verbal %" },
  { key: "excel_pct",     label: "Excel %" },
  { key: "p1_pct",        label: "P1 %" },
  { key: "p2_pct",        label: "P2 %" },
  { key: "intro_rate_pct",label: "Intro %" },
  { key: "cs_rate_pct",   label: "Case Study %" },
];

const eur = (n: number | null) =>
  n == null ? "—" :
  n >= 1_000_000 ? `€${(n / 1_000_000).toFixed(1)}M` :
  n >= 1_000     ? `€${Math.round(n / 1_000)}k` :
                   `€${Math.round(n)}`;

function emptyOffer(): Omit<HiringOffer, "id" | "created_at" | "updated_at"> {
  return {
    candidate_name: "",
    role_offered: "",
    yearly_gross_eur: null,
    age: null,
    past_prof_tenure_years: null,
    test_results: {},
    languages: [],
    outcome: "pending",
    decline_reason: null,
    decision_date: null,
    notes: null,
  };
}

// ─── Page ────────────────────────────────────────────────────────────────
export default function HiringOffers() {
  const { toast } = useToast();
  const [offers, setOffers] = useState<HiringOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<HiringOffer | null>(null);
  const [draft, setDraft] = useState(emptyOffer());
  const [showForm, setShowForm] = useState(false);
  const [filterOutcome, setFilterOutcome] = useState<"all" | "accepted" | "declined" | "pending">("all");

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/hiring/offers", { credentials: "include" });
      if (!r.ok) {
        toast({ title: `Failed to load offers (HTTP ${r.status})`, variant: "destructive" });
        setOffers([]);
        return;
      }
      const data = await r.json();
      setOffers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      toast({ title: "Failed to load offers", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    if (filterOutcome === "all") return offers;
    return offers.filter(o => o.outcome === filterOutcome);
  }, [offers, filterOutcome]);

  const stats = useMemo(() => {
    const accepted = offers.filter(o => o.outcome === "accepted");
    const declined = offers.filter(o => o.outcome === "declined");
    const pending  = offers.filter(o => o.outcome === "pending");
    const decided  = accepted.length + declined.length;
    const acceptRate = decided > 0 ? Math.round((accepted.length / decided) * 100) : null;
    const avgAcceptedComp = accepted.length > 0
      ? Math.round(accepted.reduce((s, o) => s + (o.yearly_gross_eur ?? 0), 0) / accepted.length)
      : null;
    const avgDeclinedComp = declined.length > 0
      ? Math.round(declined.reduce((s, o) => s + (o.yearly_gross_eur ?? 0), 0) / declined.length)
      : null;
    return { total: offers.length, accepted: accepted.length, declined: declined.length, pending: pending.length, acceptRate, avgAcceptedComp, avgDeclinedComp };
  }, [offers]);

  const openNew = () => { setEditing(null); setDraft(emptyOffer()); setShowForm(true); };
  const openEdit = (o: HiringOffer) => {
    setEditing(o);
    setDraft({
      candidate_name: o.candidate_name,
      role_offered: o.role_offered,
      yearly_gross_eur: o.yearly_gross_eur,
      age: o.age,
      past_prof_tenure_years: o.past_prof_tenure_years,
      test_results: o.test_results ?? {},
      languages: o.languages ?? [],
      outcome: o.outcome,
      decline_reason: o.decline_reason,
      decision_date: o.decision_date,
      notes: o.notes,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!draft.candidate_name.trim()) {
      toast({ title: "Candidate name required", variant: "destructive" });
      return;
    }
    const url = editing ? `/api/hiring/offers/${editing.id}` : "/api/hiring/offers";
    const method = editing ? "PUT" : "POST";
    try {
      const r = await fetch(url, {
        method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        toast({ title: `Save failed (HTTP ${r.status})`, description: errBody.slice(0, 200), variant: "destructive" });
        return;
      }
      toast({ title: editing ? "Offer updated" : "Offer saved" });
      setShowForm(false);
      void load();
    } catch (e: any) {
      toast({ title: "Save failed", description: String(e?.message ?? e), variant: "destructive" });
    }
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this offer? It will go to the trash bin (30-day TTL).")) return;
    const r = await fetch(`/api/hiring/offers/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) {
      toast({ title: "Offer deleted" });
      void load();
    } else {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  // ─── UI ───────────────────────────────────────────────────────────────
  return (
    <div className="container mx-auto py-6 px-6 max-w-7xl">
      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-3">
          <Briefcase className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Hiring Offers — Win/Loss</h1>
            <p className="text-sm text-muted-foreground">
              Every offer extended, with comp + profile + outcome. Trains the future offer-pricing function.
            </p>
          </div>
        </div>
        <Button onClick={openNew} size="sm">
          <Plus className="w-4 h-4 mr-1" /> New offer
        </Button>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Card className="p-3 bg-slate-50 border-0">
          <div className="text-[11px] uppercase text-muted-foreground tracking-wide">Total offers</div>
          <div className="text-2xl font-bold mt-1 text-slate-700" data-privacy="blur">{stats.total}</div>
        </Card>
        <Card className="p-3 bg-emerald-50 border-0">
          <div className="text-[11px] uppercase text-emerald-700 tracking-wide">Accepted</div>
          <div className="text-2xl font-bold mt-1 text-emerald-700" data-privacy="blur">{stats.accepted}</div>
        </Card>
        <Card className="p-3 bg-red-50 border-0">
          <div className="text-[11px] uppercase text-red-700 tracking-wide">Declined</div>
          <div className="text-2xl font-bold mt-1 text-red-700" data-privacy="blur">{stats.declined}</div>
        </Card>
        <Card className="p-3 bg-amber-50 border-0">
          <div className="text-[11px] uppercase text-amber-700 tracking-wide">Pending</div>
          <div className="text-2xl font-bold mt-1 text-amber-700" data-privacy="blur">{stats.pending}</div>
        </Card>
        <Card className="p-3 bg-violet-50 border-0">
          <div className="text-[11px] uppercase text-violet-700 tracking-wide">Accept rate</div>
          <div className="text-2xl font-bold mt-1 text-violet-700" data-privacy="blur">
            {stats.acceptRate == null ? "—" : `${stats.acceptRate}%`}
          </div>
          <div className="text-[10px] text-muted-foreground">of decided offers</div>
        </Card>
        <Card className="p-3 bg-blue-50 border-0">
          <div className="text-[11px] uppercase text-blue-700 tracking-wide">Avg comp</div>
          <div className="text-sm font-bold mt-1 text-blue-700 leading-tight" data-privacy="blur">
            <div>✓ {eur(stats.avgAcceptedComp)}</div>
            <div className="text-[11px] text-red-600 font-normal">✕ {eur(stats.avgDeclinedComp)}</div>
          </div>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 mb-3">
        {(["all", "pending", "accepted", "declined"] as const).map(o => (
          <button
            key={o}
            onClick={() => setFilterOutcome(o)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              filterOutcome === o
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {o === "all" ? "All" : o[0].toUpperCase() + o.slice(1)}
            <span className="ml-1.5 opacity-70 tabular-nums">
              {o === "all" ? offers.length :
               o === "accepted" ? stats.accepted :
               o === "declined" ? stats.declined : stats.pending}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Candidate</th>
                <th className="text-left px-3 py-2 font-medium">Role</th>
                <th className="text-right px-3 py-2 font-medium">Yearly gross</th>
                <th className="text-right px-3 py-2 font-medium">Age</th>
                <th className="text-right px-3 py-2 font-medium">Past tenure</th>
                <th className="text-left px-3 py-2 font-medium">Languages</th>
                <th className="text-left px-3 py-2 font-medium">Tests</th>
                <th className="text-left px-3 py-2 font-medium">Outcome</th>
                <th className="text-left px-3 py-2 font-medium">Decided</th>
                <th className="px-3 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading && (
                <tr><td colSpan={10} className="text-center py-10 text-muted-foreground italic">Loading…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={10} className="text-center py-10 text-muted-foreground italic">
                  {offers.length === 0 ? "No offers tracked yet — click 'New offer' to start." : "No offers match this filter."}
                </td></tr>
              )}
              {!loading && filtered.map(o => (
                <tr key={o.id} className="hover:bg-muted/20 cursor-pointer" onClick={() => openEdit(o)}>
                  <td className="px-3 py-2 font-semibold" data-privacy="blur">{o.candidate_name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{o.role_offered || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono" data-privacy="blur">{eur(o.yearly_gross_eur)}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{o.age ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {o.past_prof_tenure_years == null ? "—" : `${o.past_prof_tenure_years}y`}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    {(o.languages ?? []).length === 0 ? "—" :
                      (o.languages ?? []).map(l => `${l.lang} (${l.level})`).join(", ")}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    {(() => {
                      const entries = Object.entries(o.test_results ?? {}).filter(([, v]) => v != null);
                      if (entries.length === 0) return "—";
                      const avg = Math.round(entries.reduce((s, [, v]) => s + (v as number), 0) / entries.length);
                      return <Badge variant="outline" className="text-[10px]">avg {avg}% · {entries.length} tests</Badge>;
                    })()}
                  </td>
                  <td className="px-3 py-2">
                    {o.outcome === "accepted" && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1 inline" />Accepted</Badge>}
                    {o.outcome === "declined" && <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]"><XCircle className="w-3 h-3 mr-1 inline" />Declined</Badge>}
                    {o.outcome === "pending"  && <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]"><Clock className="w-3 h-3 mr-1 inline" />Pending</Badge>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">{o.decision_date ?? "—"}</td>
                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openEdit(o)} className="text-muted-foreground hover:text-foreground p-1" title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => remove(o.id)} className="text-muted-foreground hover:text-red-600 p-1" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[11px] text-muted-foreground mt-3 italic flex items-center gap-1">
        <TrendingUp className="w-3 h-3" />
        Future use: this dataset trains the offer-pricing function — given a role + age + past tenure + tests + languages, predict the comp that lands an acceptance.
      </p>

      {/* Add / Edit dialog */}
      <Dialog open={showForm} onOpenChange={(o) => { if (!o) setShowForm(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit offer" : "New offer"}</DialogTitle>
            <DialogDescription>
              Track an offer extended to a candidate. Required: candidate name. Outcome can be set later.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Candidate name *</Label>
              <Input value={draft.candidate_name} onChange={e => setDraft(d => ({ ...d, candidate_name: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Role offered</Label>
              <Input value={draft.role_offered} onChange={e => setDraft(d => ({ ...d, role_offered: e.target.value }))} className="h-8 text-sm" placeholder="e.g. A1 / EM1 / Partner" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Yearly gross (EUR)</Label>
              <Input type="number" min="0" value={draft.yearly_gross_eur ?? ""} onChange={e => setDraft(d => ({ ...d, yearly_gross_eur: e.target.value === "" ? null : Number(e.target.value) }))} className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Age</Label>
              <Input type="number" min="16" max="80" value={draft.age ?? ""} onChange={e => setDraft(d => ({ ...d, age: e.target.value === "" ? null : Number(e.target.value) }))} className="h-8 text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Past prof. tenure (years)</Label>
              <Input type="number" min="0" step="0.5" value={draft.past_prof_tenure_years ?? ""} onChange={e => setDraft(d => ({ ...d, past_prof_tenure_years: e.target.value === "" ? null : Number(e.target.value) }))} className="h-8 text-sm font-mono" />
            </div>

            {/* Test results */}
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Test results (0–100, blank = not tested)</Label>
              <div className="grid grid-cols-3 gap-2">
                {TEST_KEYS.map(t => (
                  <div key={t.key} className="flex items-center gap-1">
                    <Label className="text-[11px] w-20 text-muted-foreground shrink-0">{t.label}</Label>
                    <Input
                      type="number" min="0" max="100"
                      value={draft.test_results[t.key] ?? ""}
                      onChange={e => {
                        const v = e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value)));
                        setDraft(d => ({ ...d, test_results: { ...d.test_results, [t.key]: v } }));
                      }}
                      className="h-7 text-xs font-mono"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Languages */}
            <div className="col-span-2 space-y-1">
              <Label className="text-xs flex items-center gap-1"><LanguagesIcon className="w-3 h-3" /> Languages</Label>
              <div className="space-y-1">
                {(draft.languages ?? []).map((l, i) => (
                  <div key={i} className="flex gap-1 items-center">
                    <Input
                      value={l.lang}
                      onChange={e => setDraft(d => {
                        const next = [...(d.languages ?? [])];
                        next[i] = { ...next[i], lang: e.target.value };
                        return { ...d, languages: next };
                      })}
                      className="h-7 text-xs"
                      placeholder="e.g. English"
                    />
                    <Select
                      value={l.level || "B2"}
                      onValueChange={v => setDraft(d => {
                        const next = [...(d.languages ?? [])];
                        next[i] = { ...next[i], level: v };
                        return { ...d, languages: next };
                      })}
                    >
                      <SelectTrigger className="h-7 text-xs w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CEFR_LEVELS.map(lev => <SelectItem key={lev} value={lev}>{lev}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => setDraft(d => ({ ...d, languages: (d.languages ?? []).filter((_, j) => j !== i) }))}
                      className="h-7 w-7 p-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm" variant="outline"
                  onClick={() => setDraft(d => ({ ...d, languages: [...(d.languages ?? []), { lang: "", level: "B2" }] }))}
                  className="h-7 text-xs"
                >
                  <Plus className="w-3 h-3 mr-1" /> Add language
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Outcome</Label>
              <Select value={draft.outcome} onValueChange={(v: any) => setDraft(d => ({ ...d, outcome: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Decision date</Label>
              <Input type="date" value={draft.decision_date ?? ""} onChange={e => setDraft(d => ({ ...d, decision_date: e.target.value || null }))} className="h-8 text-sm" />
            </div>

            {draft.outcome === "declined" && (
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Decline reason</Label>
                <Input value={draft.decline_reason ?? ""} onChange={e => setDraft(d => ({ ...d, decline_reason: e.target.value || null }))} className="h-8 text-sm" placeholder="e.g. counter-offer, location, role mismatch" />
              </div>
            )}

            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea value={draft.notes ?? ""} onChange={e => setDraft(d => ({ ...d, notes: e.target.value || null }))} rows={3} className="text-sm" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={save}>{editing ? "Save changes" : "Create offer"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
