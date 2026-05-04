import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/PageHeader";
import { useToast } from "@/hooks/use-toast";
import {
  Target, Plus, Upload, Trash2, Pencil, Save, X, Loader2,
  CheckCircle2, AlertCircle, ExternalLink, Database, RefreshCw, Wifi, WifiOff,
  Users, Building2, Mail, Phone, MapPin,
} from "lucide-react";

// ─── Business Development CRM ────────────────────────────────────────────
//
// Lightweight deal pipeline. Two tabs:
//   - Pipeline: kanban view grouped by stage, inline edit + drag-less
//     stage reassignment via dropdown (keeps the code small).
//   - Import:   paste a HubSpot Deals CSV, preview it, commit.
//
// Data model in shared/schema.ts ▸ bdDeals. Import de-dupes by
// `hubspot_id`, so pasting the same file twice is safe.
// -----------------------------------------------------------------------

const STAGES = [
  { id: "lead",         label: "Lead",         header: "bg-slate-100 border-slate-300 text-slate-800",    cell: "bg-slate-50/50 border-slate-200" },
  { id: "qualified",    label: "Qualified",    header: "bg-blue-100 border-blue-300 text-blue-800",       cell: "bg-blue-50/50 border-blue-200" },
  { id: "proposal",     label: "SEND PITCH",   header: "bg-violet-100 border-violet-300 text-violet-800", cell: "bg-violet-50/50 border-violet-200" },
  { id: "negotiation",  label: "Negotiation",  header: "bg-amber-100 border-amber-300 text-amber-800",    cell: "bg-amber-50/50 border-amber-200" },
  { id: "won",          label: "Won",          header: "bg-emerald-100 border-emerald-300 text-emerald-800", cell: "bg-emerald-50/50 border-emerald-200" },
  { id: "lost",         label: "Lost",         header: "bg-red-100 border-red-300 text-red-800",          cell: "bg-red-50/50 border-red-200" },
] as const;
type StageId = typeof STAGES[number]["id"];

interface Deal {
  id: number;
  hubspot_id: string | null;
  name: string;
  client_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  stage: StageId;
  amount: number | null;
  currency: string | null;
  probability: number | null;
  close_date: string | null;
  source: string | null;
  owner: string | null;
  notes: string | null;
  industry: string | null;
  region: string | null;
  last_activity_at: string | null;
  imported_at: string | null;
  linked_proposal_id: number | null;
  created_at: string;
  updated_at: string;
  // Joined from pricing_proposals via linked_proposal_id
  proposal_project_name: string | null;
  proposal_revision_letter: string | null;
  proposal_weekly_price: number | null;
  proposal_total_fee: number | null;
  proposal_duration_weeks: number | null;
  proposal_outcome: string | null;
  proposal_sector: string | null;
}

const eur = (n: number | null | undefined) => {
  if (n == null || isNaN(Number(n))) return "—";
  const x = Number(n);
  return x >= 1_000_000 ? `€${(x / 1_000_000).toFixed(1)}M` :
         x >= 1000      ? `€${Math.round(x / 1000)}k` :
                          `€${Math.round(x)}`;
};

export default function BusinessDevelopment() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();

  // Tab: pipeline | contacts | companies | import. Driven by URL.
  const tab: "pipeline" | "contacts" | "companies" | "import" =
    location === "/bd/import"    ? "import"    :
    location === "/bd/contacts"  ? "contacts"  :
    location === "/bd/companies" ? "companies" :
    "pipeline";

  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Partial<Deal>>({});
  const [syncingProposals, setSyncingProposals] = useState(false);

  async function fetchDeals() {
    setLoading(true);
    try {
      const res = await fetch("/api/bd/deals", { credentials: "include" });
      if (!res.ok) throw new Error(`GET /api/bd/deals → ${res.status}`);
      const data = await res.json();
      setDeals(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast({ title: "Failed to load deals", description: err?.message, variant: "destructive" });
    }
    setLoading(false);
  }

  useEffect(() => { fetchDeals(); }, []);

  async function saveDraft() {
    const body = { ...draft };
    if (!body.name?.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    try {
      if (editingId === "new") {
        const res = await fetch("/api/bd/deals", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "create failed");
      } else if (typeof editingId === "number") {
        const res = await fetch(`/api/bd/deals/${editingId}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "update failed");
      }
      setEditingId(null);
      setDraft({});
      fetchDeals();
      toast({ title: "Saved" });
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message, variant: "destructive" });
    }
  }

  async function changeStage(id: number, stage: StageId) {
    try {
      const res = await fetch(`/api/bd/deals/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "stage update failed");
      fetchDeals();
    } catch (err: any) {
      toast({ title: "Stage update failed", description: err?.message, variant: "destructive" });
    }
  }

  async function deleteDeal(id: number) {
    if (!window.confirm("Delete this deal? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/bd/deals/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("delete failed");
      fetchDeals();
      toast({ title: "Deleted" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message, variant: "destructive" });
    }
  }

  async function syncProposals() {
    setSyncingProposals(true);
    try {
      const r = await fetch("/api/bd/deals/sync-proposals", { method: "POST", credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Sync failed");
      toast({ title: `Proposals synced — ${data.matched} matched, ${data.unmatched} unmatched` });
      fetchDeals();
    } catch (err: any) {
      toast({ title: "Sync failed", description: err?.message, variant: "destructive" });
    } finally {
      setSyncingProposals(false);
    }
  }

  const byStage = useMemo(() => {
    const map: Record<string, Deal[]> = {};
    for (const s of STAGES) map[s.id] = [];
    for (const d of deals) {
      (map[d.stage] ?? map.lead).push(d);
    }
    return map;
  }, [deals]);

  // ── Totals shown in the header row of each column ─────────────────────
  const stageTotals = useMemo(() => {
    const totals: Record<string, { count: number; value: number }> = {};
    for (const s of STAGES) {
      const list = byStage[s.id] ?? [];
      totals[s.id] = {
        count: list.length,
        value: list.reduce((sum, d) => sum + (d.amount ?? 0), 0),
      };
    }
    return totals;
  }, [byStage]);

  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <PageHeader
        title="Business Development"
        description="Lightweight CRM — pipeline of open deals + HubSpot import"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border p-0.5 bg-muted/30">
              <Button
                size="sm"
                variant={tab === "pipeline" ? "default" : "ghost"}
                onClick={() => setLocation("/bd")}
                className="h-7 px-3 text-xs"
              >
                <Target className="w-3.5 h-3.5 mr-1" /> Pipeline
              </Button>
              <Button
                size="sm"
                variant={tab === "contacts" ? "default" : "ghost"}
                onClick={() => setLocation("/bd/contacts")}
                className="h-7 px-3 text-xs"
              >
                <Users className="w-3.5 h-3.5 mr-1" /> Contacts
              </Button>
              <Button
                size="sm"
                variant={tab === "companies" ? "default" : "ghost"}
                onClick={() => setLocation("/bd/companies")}
                className="h-7 px-3 text-xs"
              >
                <Building2 className="w-3.5 h-3.5 mr-1" /> Companies
              </Button>
              <Button
                size="sm"
                variant={tab === "import" ? "default" : "ghost"}
                onClick={() => setLocation("/bd/import")}
                className="h-7 px-3 text-xs"
              >
                <Upload className="w-3.5 h-3.5 mr-1" /> Import
              </Button>
            </div>
            {tab === "pipeline" && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={syncProposals}
                  disabled={syncingProposals}
                  className="h-8 text-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncingProposals ? "animate-spin" : ""}`} />
                  {syncingProposals ? "Syncing…" : "Sync with Proposals"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => { setEditingId("new"); setDraft({ stage: "lead", currency: "EUR" }); }}
                  disabled={editingId !== null}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> New deal
                </Button>
              </div>
            )}
          </div>
        }
      />

      {tab === "pipeline" && (
        <>
          {/* ── Kanban columns ─────────────────────────────────────── */}
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading deals…
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {STAGES.map(stage => {
                const list = byStage[stage.id] ?? [];
                const t = stageTotals[stage.id];
                return (
                  <div key={stage.id} className={`rounded-lg border ${stage.cell} flex flex-col min-h-[300px]`}>
                    <div className={`px-3 py-2 border-b ${stage.header} rounded-t-lg`}>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wide">{stage.label}</span>
                        <span className="text-[10px] font-mono opacity-70" data-privacy="blur">{t.count}</span>
                      </div>
                      <div className="text-[10px] font-mono opacity-70 mt-0.5" data-privacy="blur">{eur(t.value)}</div>
                    </div>
                    <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                      {editingId === "new" && stage.id === (draft.stage ?? "lead") && (
                        <DealEditor
                          draft={draft}
                          onChange={setDraft}
                          onSave={saveDraft}
                          onCancel={() => { setEditingId(null); setDraft({}); }}
                        />
                      )}
                      {list.length === 0 && editingId !== "new" && (
                        <p className="text-[10px] text-muted-foreground italic text-center py-2">Empty</p>
                      )}
                      {list.map(d => editingId === d.id ? (
                        <DealEditor
                          key={d.id}
                          draft={draft}
                          onChange={setDraft}
                          onSave={saveDraft}
                          onCancel={() => { setEditingId(null); setDraft({}); }}
                        />
                      ) : (
                        <div
                          key={d.id}
                          className="rounded border border-muted/60 bg-white p-2 text-[11px] hover:shadow-sm transition-shadow group"
                        >
                          <div className="flex items-start justify-between gap-1">
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold truncate" title={d.name}>{d.name}</div>
                              {d.client_name && (
                                <div className="text-muted-foreground truncate text-[10px]" title={d.client_name}>{d.client_name}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                onClick={() => { setEditingId(d.id); setDraft(d); }}
                                className="p-0.5 hover:bg-muted rounded"
                                title="Edit"
                              >
                                <Pencil className="w-3 h-3 text-muted-foreground" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteDeal(d.id)}
                                className="p-0.5 hover:bg-red-100 rounded"
                                title="Delete"
                              >
                                <Trash2 className="w-3 h-3 text-red-500" />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-1.5">
                            <span className="font-mono font-semibold text-foreground" data-privacy="blur">{eur(d.amount)}</span>
                            {d.probability != null && (
                              <span className="text-[9px] text-muted-foreground" data-privacy="blur">{d.probability}%</span>
                            )}
                          </div>
                          {(d.contact_name || d.contact_email) && (
                            <div className="text-[9px] text-muted-foreground truncate mt-0.5" title={`${d.contact_name ?? ""} ${d.contact_email ?? ""}`}>
                              {d.contact_name ?? d.contact_email}
                            </div>
                          )}
                          {d.close_date && (
                            <div className="text-[9px] text-muted-foreground mt-0.5">close {d.close_date}</div>
                          )}
                          <select
                            value={d.stage}
                            onChange={e => changeStage(d.id, e.target.value as StageId)}
                            className="w-full mt-1.5 text-[9px] border rounded px-1 py-0.5 bg-white"
                            title="Change stage"
                          >
                            {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                          {d.proposal_project_name && (
                            <div className="mt-1.5 pt-1.5 border-t border-dashed border-muted-foreground/20 space-y-0.5">
                              <div className="flex items-center justify-between text-[9px]">
                                <span className="font-mono font-semibold text-violet-700">
                                  {d.proposal_project_name}{d.proposal_revision_letter ?? ""}
                                </span>
                                {d.proposal_outcome && (
                                  <span className={`px-1 py-0.5 rounded text-[8px] font-semibold uppercase ${
                                    d.proposal_outcome === "won"  ? "bg-emerald-100 text-emerald-700" :
                                    d.proposal_outcome === "lost" ? "bg-red-100 text-red-700" :
                                    "bg-amber-100 text-amber-700"
                                  }`}>{d.proposal_outcome}</span>
                                )}
                              </div>
                              <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                                <span data-privacy="blur">{d.proposal_weekly_price ? `${eur(d.proposal_weekly_price)}/wk` : "—"}</span>
                                <span data-privacy="blur">{d.proposal_total_fee ? eur(d.proposal_total_fee) : "—"} total</span>
                              </div>
                              {d.proposal_duration_weeks && (
                                <div className="text-[9px] text-muted-foreground">{d.proposal_duration_weeks}w project</div>
                              )}
                            </div>
                          )}
                          {d.hubspot_id && (
                            <div className="flex items-center gap-0.5 mt-1 text-[8px] text-muted-foreground">
                              <Database className="w-2.5 h-2.5" /> HubSpot {d.hubspot_id}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "contacts"  && <ContactsTab />}
      {tab === "companies" && <CompaniesTab />}
      {tab === "import" && <HubspotImport onDone={() => { setLocation("/bd"); fetchDeals(); }} />}
    </div>
  );
}

// ─── Inline editor ──────────────────────────────────────────────────────
function DealEditor({
  draft, onChange, onSave, onCancel,
}: {
  draft: Partial<Deal>;
  onChange: (d: Partial<Deal>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof Deal>(k: K, v: Deal[K] | null) => onChange({ ...draft, [k]: v });
  return (
    <div className="rounded border-2 border-violet-300 bg-white p-2 space-y-1.5 text-[10px]">
      <Input
        placeholder="Deal name *"
        value={draft.name ?? ""}
        onChange={e => set("name", e.target.value)}
        className="h-6 text-[11px] font-semibold"
      />
      <Input
        placeholder="Company"
        value={draft.client_name ?? ""}
        onChange={e => set("client_name", e.target.value || null)}
        className="h-6 text-[10px]"
      />
      <div className="grid grid-cols-2 gap-1">
        <Input
          type="number"
          placeholder="Amount"
          value={draft.amount ?? ""}
          onChange={e => set("amount", e.target.value ? Number(e.target.value) : null)}
          className="h-6 text-[10px]"
        />
        <Input
          type="number"
          placeholder="Prob %"
          value={draft.probability ?? ""}
          onChange={e => set("probability", e.target.value ? Number(e.target.value) : null)}
          className="h-6 text-[10px]"
          min={0}
          max={100}
        />
      </div>
      <Input
        placeholder="Contact name"
        value={draft.contact_name ?? ""}
        onChange={e => set("contact_name", e.target.value || null)}
        className="h-6 text-[10px]"
      />
      <Input
        placeholder="Contact email"
        value={draft.contact_email ?? ""}
        onChange={e => set("contact_email", e.target.value || null)}
        className="h-6 text-[10px]"
      />
      <Input
        type="date"
        placeholder="Close date"
        value={draft.close_date ?? ""}
        onChange={e => set("close_date", e.target.value || null)}
        className="h-6 text-[10px]"
      />
      <select
        value={draft.stage ?? "lead"}
        onChange={e => set("stage", e.target.value as StageId)}
        className="w-full border rounded px-1 h-6 text-[10px] bg-white"
      >
        {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <Textarea
        placeholder="Notes"
        value={draft.notes ?? ""}
        onChange={e => set("notes", e.target.value || null)}
        className="text-[10px] min-h-[40px]"
      />
      <div className="flex gap-1 pt-1">
        <Button size="sm" onClick={onSave} className="h-6 text-[10px] flex-1">
          <Save className="w-3 h-3 mr-1" /> Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} className="h-6 text-[10px]">
          <X className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// ─── Contacts list tab ───────────────────────────────────────────────────
function ContactsTab() {
  const { toast } = useToast();
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [lastSync, setLastSync] = useState<{ total: number; inserted: number; updated: number } | null>(null);
  const [search, setSearch]     = useState("");

  useEffect(() => {
    fetch("/api/hubspot/contacts", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(setContacts)
      .catch(() => toast({ title: "Failed to load contacts", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  async function runSync() {
    setSyncing(true);
    try {
      const r = await fetch("/api/hubspot/contacts/sync", { method: "POST", credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Sync failed");
      setLastSync(data);
      toast({ title: `Contacts synced — ${data.inserted} new, ${data.updated} updated` });
      const fresh = await fetch("/api/hubspot/contacts", { credentials: "include" });
      setContacts(await fresh.json());
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase();
    return !q || [c.first_name, c.last_name, c.email, c.company, c.job_title].some(v => v?.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={runSync} disabled={syncing} className="h-7 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync from HubSpot"}
          </Button>
          <span className="text-xs text-muted-foreground">{contacts.length} contacts</span>
          {lastSync && (
            <span className="text-[11px] text-emerald-700">
              · {lastSync.inserted} new, {lastSync.updated} updated
            </span>
          )}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search contacts…"
          className="h-7 text-xs border rounded px-2 w-48 bg-background"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…
        </div>
      ) : contacts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No contacts yet. Sync from HubSpot to pull your contact list.
          <p className="text-xs mt-1">Requires <code className="bg-muted px-1 rounded">crm.objects.contacts.read</code> scope on your Private App.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Name</th>
                <th className="text-left px-3 py-2 font-semibold">Email</th>
                <th className="text-left px-3 py-2 font-semibold">Phone</th>
                <th className="text-left px-3 py-2 font-semibold">Title</th>
                <th className="text-left px-3 py-2 font-semibold">Company</th>
                <th className="text-left px-3 py-2 font-semibold">Stage</th>
                <th className="text-left px-3 py-2 font-semibold">Country</th>
                <th className="text-left px-3 py-2 font-semibold">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.id} className={`border-t ${i % 2 === 0 ? "" : "bg-muted/20"} hover:bg-muted/30`}>
                  <td className="px-3 py-1.5 font-medium whitespace-nowrap" data-privacy="blur">
                    {[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-3 py-1.5" data-privacy="blur">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="flex items-center gap-1 text-violet-600 hover:underline">
                        <Mail className="w-3 h-3" />{c.email}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground" data-privacy="blur">
                    {c.phone ? (
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{c.job_title ?? "—"}</td>
                  <td className="px-3 py-1.5 font-medium">{c.company ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    {c.lifecycle_stage ? (
                      <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-700 border border-blue-200 uppercase font-semibold">
                        {c.lifecycle_stage}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {c.country ? (
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.city ? `${c.city}, ` : ""}{c.country}</span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground font-mono text-[10px]">{c.last_activity_at ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && search && (
            <div className="text-center py-4 text-xs text-muted-foreground">No contacts match "{search}"</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Companies list tab ──────────────────────────────────────────────────
function CompaniesTab() {
  const { toast } = useToast();
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading]    = useState(true);
  const [syncing, setSyncing]    = useState(false);
  const [lastSync, setLastSync]  = useState<{ total: number; inserted: number; updated: number } | null>(null);
  const [search, setSearch]      = useState("");

  useEffect(() => {
    fetch("/api/hubspot/companies", { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(setCompanies)
      .catch(() => toast({ title: "Failed to load companies", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  async function runSync() {
    setSyncing(true);
    try {
      const r = await fetch("/api/hubspot/companies/sync", { method: "POST", credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Sync failed");
      setLastSync(data);
      toast({ title: `Companies synced — ${data.inserted} new, ${data.updated} updated` });
      const fresh = await fetch("/api/hubspot/companies", { credentials: "include" });
      setCompanies(await fresh.json());
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  const fmt = (n: any) => {
    if (n == null || isNaN(Number(n))) return "—";
    const x = Number(n);
    return x >= 1_000_000 ? `€${(x / 1_000_000).toFixed(1)}M` : x >= 1000 ? `€${Math.round(x / 1000)}k` : `€${Math.round(x)}`;
  };

  const filtered = companies.filter(c => {
    const q = search.toLowerCase();
    return !q || [c.name, c.domain, c.industry, c.country].some(v => v?.toLowerCase().includes(q));
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={runSync} disabled={syncing} className="h-7 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync from HubSpot"}
          </Button>
          <span className="text-xs text-muted-foreground">{companies.length} companies</span>
          {lastSync && (
            <span className="text-[11px] text-emerald-700">
              · {lastSync.inserted} new, {lastSync.updated} updated
            </span>
          )}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search companies…"
          className="h-7 text-xs border rounded px-2 w-48 bg-background"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading…
        </div>
      ) : companies.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No companies yet. Sync from HubSpot to pull your company list.
          <p className="text-xs mt-1">Requires <code className="bg-muted px-1 rounded">crm.objects.companies.read</code> scope on your Private App.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Name</th>
                <th className="text-left px-3 py-2 font-semibold">Domain</th>
                <th className="text-left px-3 py-2 font-semibold">Industry</th>
                <th className="text-right px-3 py-2 font-semibold">Employees</th>
                <th className="text-right px-3 py-2 font-semibold">Revenue</th>
                <th className="text-left px-3 py-2 font-semibold">Country</th>
                <th className="text-left px-3 py-2 font-semibold">Stage</th>
                <th className="text-left px-3 py-2 font-semibold">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.id} className={`border-t ${i % 2 === 0 ? "" : "bg-muted/20"} hover:bg-muted/30`}>
                  <td className="px-3 py-1.5 font-medium">{c.name ?? "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {c.domain ? (
                      <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer"
                        className="text-violet-600 hover:underline flex items-center gap-1">
                        {c.domain} <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{c.industry ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{c.num_employees ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono" data-privacy="blur">{fmt(c.annual_revenue)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {c.country ? (
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{c.city ? `${c.city}, ` : ""}{c.country}</span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-1.5">
                    {c.lifecycle_stage ? (
                      <span className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-blue-50 text-blue-700 border border-blue-200 uppercase font-semibold">
                        {c.lifecycle_stage}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground font-mono text-[10px]">{c.last_activity_at ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && search && (
            <div className="text-center py-4 text-xs text-muted-foreground">No companies match "{search}"</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── HubSpot live API sync ───────────────────────────────────────────────
function HubspotApiSync({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<{ configured: boolean; valid?: boolean; total?: number | null; message?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<{ total: number; inserted: number; updated: number; skipped: number } | null>(null);

  useEffect(() => {
    fetch("/api/hubspot/status", { credentials: "include" })
      .then(r => r.ok ? r.json() : { configured: false })
      .then(setStatus)
      .catch(() => setStatus({ configured: false }));
  }, []);

  async function runSync() {
    setSyncing(true);
    try {
      const r = await fetch("/api/hubspot/sync", { method: "POST", credentials: "include" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Sync failed");
      setLastSync(data);
      toast({ title: `HubSpot sync complete — ${data.inserted} inserted, ${data.updated} updated` });
      onDone();
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="border rounded-lg p-4 bg-background space-y-3">
      <div className="flex items-center gap-2">
        {status?.valid
          ? <Wifi className="w-4 h-4 text-emerald-600" />
          : <WifiOff className="w-4 h-4 text-amber-500" />
        }
        <h4 className="text-sm font-semibold">HubSpot Live Sync (API)</h4>
        {status?.configured && status?.valid && (
          <span className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">Connected</span>
        )}
        {status?.configured && status?.valid === false && (
          <span className="text-[10px] bg-red-50 border border-red-200 text-red-700 px-1.5 py-0.5 rounded font-semibold">Token invalid</span>
        )}
        {status?.configured === false && (
          <span className="text-[10px] bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded font-semibold">Not configured</span>
        )}
      </div>

      {!status?.configured && (
        <div className="text-xs text-muted-foreground space-y-1">
          <p>To enable live sync, add your HubSpot Private App token as an environment variable:</p>
          <code className="block bg-muted rounded px-3 py-2 text-xs font-mono">HUBSPOT_TOKEN=pat-na1-xxxxxxxxxx</code>
          <p>Create a Private App in HubSpot: <span className="font-medium">Settings → Integrations → Private Apps</span>. Grant it <code className="bg-muted px-1 rounded">crm.objects.deals.read</code> scope.</p>
        </div>
      )}

      {status?.valid && (
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={syncing} onClick={runSync} className="h-7 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync all deals now"}
          </Button>
          {status.total != null && (
            <span className="text-[11px] text-muted-foreground">{status.total} deals in HubSpot</span>
          )}
        </div>
      )}

      {lastSync && (
        <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Last sync: {lastSync.total} deals · {lastSync.inserted} new · {lastSync.updated} updated · {lastSync.skipped} skipped
        </div>
      )}
    </div>
  );
}

// ─── HubSpot CSV import tab ─────────────────────────────────────────────
function HubspotImport({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<any[] | null>(null);
  const [total, setTotal] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ inserted: number; updated: number; skipped: number } | null>(null);

  async function runPreview() {
    if (!csvText.trim()) {
      toast({ title: "Paste a CSV first", variant: "destructive" });
      return;
    }
    setPreviewing(true);
    try {
      const res = await fetch("/api/bd/import/hubspot", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, commit: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "preview failed");
      setPreview(data.preview ?? []);
      setTotal(data.total ?? 0);
      if ((data.total ?? 0) === 0) {
        toast({ title: "No rows detected", description: "Check that the first line is a header row.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Preview failed", description: err?.message, variant: "destructive" });
    }
    setPreviewing(false);
  }

  async function runCommit() {
    setCommitting(true);
    try {
      const res = await fetch("/api/bd/import/hubspot", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, commit: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "import failed");
      setLastResult({ inserted: data.inserted ?? 0, updated: data.updated ?? 0, skipped: data.skipped ?? 0 });
      toast({
        title: "Import complete",
        description: `Inserted ${data.inserted} · Updated ${data.updated} · Skipped ${data.skipped}`,
      });
    } catch (err: any) {
      toast({ title: "Import failed", description: err?.message, variant: "destructive" });
    }
    setCommitting(false);
  }

  return (
    <Card className="p-4 space-y-4">
      {/* Live API sync — shown first; CSV import below as fallback */}
      <HubspotApiSync onDone={onDone} />

      <div className="border-t pt-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Database className="w-4 h-4 text-violet-600" /> Import HubSpot Deals CSV (fallback)
        </h3>
        <p className="text-[11px] text-muted-foreground mt-1">
          In HubSpot: <span className="font-medium">CRM → Deals → Actions → Export</span>. Choose CSV,
          download, then paste the entire file contents below. Rows are
          de-duplicated by HubSpot <code className="text-[10px] bg-muted px-1 rounded">Record ID</code>, so re-running is safe.
        </p>
        <a
          href="https://knowledge.hubspot.com/crm-general/export-records"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-violet-600 hover:underline inline-flex items-center gap-0.5 mt-1"
        >
          HubSpot export docs <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </div>

      <div className="space-y-1">
        <Label className="text-xs font-semibold">Paste CSV contents</Label>
        <Textarea
          value={csvText}
          onChange={e => { setCsvText(e.target.value); setPreview(null); setLastResult(null); }}
          placeholder={`Record ID,Deal Name,Associated Company,Deal Stage,Amount,Close Date,Deal Owner\n1234567,New retainer,Acme GmbH,Proposal,75000,2026-06-30,Alice`}
          className="font-mono text-[10px] min-h-[160px]"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={runPreview} disabled={previewing || committing || !csvText.trim()} size="sm">
          {previewing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
          Preview
        </Button>
        <Button
          onClick={runCommit}
          disabled={committing || previewing || !preview || total === 0}
          size="sm"
          className="bg-violet-600 hover:bg-violet-700 text-white"
        >
          {committing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Upload className="w-3.5 h-3.5 mr-1" />}
          Commit {total > 0 ? `(${total} rows)` : ""}
        </Button>
      </div>

      {preview && (
        <div className="border rounded bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">
              Preview — {total} row{total === 1 ? "" : "s"} detected
            </span>
            {total > 10 && <span className="text-[10px] text-muted-foreground">showing first 10</span>}
          </div>
          {preview.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-amber-700">
              <AlertCircle className="w-3.5 h-3.5" /> No rows matched. Make sure the first line is a header row.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-1">Name</th>
                    <th className="text-left p-1">Company</th>
                    <th className="text-left p-1">Stage</th>
                    <th className="text-right p-1">Amount</th>
                    <th className="text-left p-1">Close</th>
                    <th className="text-left p-1">HubSpot ID</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i} className="border-t border-muted/40">
                      <td className="p-1 font-medium">{p.name}</td>
                      <td className="p-1">{p.client_name ?? "—"}</td>
                      <td className="p-1">
                        <span className="inline-block px-1.5 py-0.5 text-[9px] rounded bg-violet-100 text-violet-700 uppercase font-semibold">
                          {p.stage}
                        </span>
                      </td>
                      <td className="p-1 text-right font-mono">{eur(p.amount)}</td>
                      <td className="p-1">{p.close_date ?? "—"}</td>
                      <td className="p-1 text-muted-foreground font-mono">{p.hubspot_id ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {lastResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-emerald-700">
            <CheckCircle2 className="w-4 h-4" /> Import complete
          </div>
          <div className="text-emerald-700 mt-1 text-[11px]">
            Inserted {lastResult.inserted} · Updated {lastResult.updated} · Skipped {lastResult.skipped}
          </div>
          <Button size="sm" variant="outline" className="mt-2 h-7 text-[11px]" onClick={onDone}>
            Back to pipeline
          </Button>
        </div>
      )}
    </Card>
  );
}
