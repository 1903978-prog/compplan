import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BookOpen, Plus, Trash2, Pencil, Check, X, Search, Upload, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Phase 3 — Project Knowledge Base ─────────────────────────────────────────
// Structured repository of past engagements. CKO ingests projects; agents
// reference them when drafting proposals or writing case studies.

interface ProjectKnowledge {
  id: number;
  client_name: string | null;
  project_name: string;
  sector: string | null;
  service_line: string | null;
  duration_weeks: number | null;
  team_size: number | null;
  revenue_eur: number | null;
  problem_statement: string | null;
  approach: string | null;
  key_outputs: string | null;
  results_impact: string | null;
  lessons_learned: string | null;
  reuse_potential: string | null;
  tags: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const EMPTY: Omit<ProjectKnowledge, "id" | "created_at" | "updated_at"> = {
  client_name: "", project_name: "", sector: "", service_line: "",
  duration_weeks: null, team_size: null, revenue_eur: null,
  problem_statement: "", approach: "", key_outputs: "",
  results_impact: "", lessons_learned: "", reuse_potential: "", tags: "", status: "draft",
};

const BATCH_PLACEHOLDER = `project_name: Pricing Transformation — PE Portfolio
client_name: Ardian Belgium
sector: PE / Consumer Goods
service_line: Pricing Strategy
duration_weeks: 12
team_size: 3
revenue_eur: 95000
problem_statement: Portfolio company losing 4% gross margin due to undisciplined discounting across 3 sales channels.
approach: MECE revenue-tree decomposition, channel-level margin waterfall, pricing council setup, discount policy redesign.
key_outputs: New price list + discount policy deck, pricing council charter, sales training module.
results_impact: +3.8% gross margin within 90 days; discount exceptions down 60%.
lessons_learned: Pricing governance (council) is 80% of the battle; the spreadsheet model is secondary.
reuse_potential: Pricing council charter template applicable to any B2B portfolio company.
tags: pricing, PE, FMCG, margin, governance
---
project_name: Go-to-Market for SaaS Scale-Up
client_name: (confidential)
sector: SaaS / B2B
...`;

export default function KnowledgeBase() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<ProjectKnowledge[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [editId, setEditId]     = useState<number | "new" | null>(null);
  const [draft, setDraft]       = useState<typeof EMPTY>({ ...EMPTY });
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [batchInput, setBatchInput] = useState("");
  const [importing, setImporting]   = useState(false);
  const [showBatch, setShowBatch]   = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/agentic/knowledge${search ? `?q=${encodeURIComponent(search)}` : ""}`, { credentials: "include" });
      setProjects(r.ok ? await r.json() : []);
    } catch { toast({ title: "Load failed", variant: "destructive" }); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [search]);

  async function save() {
    const url  = editId === "new" ? "/api/agentic/knowledge" : `/api/agentic/knowledge/${editId}`;
    const meth = editId === "new" ? "POST" : "PUT";
    try {
      const r = await fetch(url, {
        method: meth, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!r.ok) throw new Error("save failed");
      toast({ title: editId === "new" ? "Project added" : "Project updated" });
      setEditId(null);
      void load();
    } catch { toast({ title: "Save failed", variant: "destructive" }); }
  }

  async function remove(id: number) {
    if (!confirm("Delete this project from the knowledge base?")) return;
    await fetch(`/api/agentic/knowledge/${id}`, { method: "DELETE", credentials: "include" });
    void load();
  }

  // Batch import: parse '---'-separated blocks of key: value lines
  async function importBatch() {
    if (!batchInput.trim()) return;
    setImporting(true);
    let created = 0;
    try {
      const blocks = batchInput.split(/^\s*-{3,}\s*$/m).map(b => b.trim()).filter(Boolean);
      for (const block of blocks) {
        const get = (key: string): string | null => {
          const m = block.match(new RegExp(`^${key}:\\s*(.+)$`, "im"));
          return m ? m[1].trim() : null;
        };
        const name = get("project_name");
        if (!name) continue;
        const body: Record<string, unknown> = {
          project_name:      name,
          client_name:       get("client_name"),
          sector:            get("sector"),
          service_line:      get("service_line"),
          duration_weeks:    get("duration_weeks") ? parseInt(get("duration_weeks")!) : null,
          team_size:         get("team_size")      ? parseInt(get("team_size")!)      : null,
          revenue_eur:       get("revenue_eur")    ? parseInt(get("revenue_eur")!)    : null,
          problem_statement: get("problem_statement"),
          approach:          get("approach"),
          key_outputs:       get("key_outputs"),
          results_impact:    get("results_impact"),
          lessons_learned:   get("lessons_learned"),
          reuse_potential:   get("reuse_potential"),
          tags:              get("tags"),
          status:            "published",
        };
        const r = await fetch("/api/agentic/knowledge", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (r.ok) created++;
      }
      toast({ title: `Imported ${created} project(s)` });
      setBatchInput("");
      setShowBatch(false);
      void load();
    } catch { toast({ title: "Import failed", variant: "destructive" }); }
    finally { setImporting(false); }
  }

  const published = projects.filter(p => p.status === "published").length;
  const draft_count = projects.filter(p => p.status === "draft").length;

  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <BookOpen className="w-7 h-7 text-primary" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Atlas · PHASE 3</p>
            <h1 className="text-2xl font-bold tracking-tight">Project Knowledge Base</h1>
            <p className="text-sm text-muted-foreground">
              {projects.length} projects · {published} published · {draft_count} draft
              · owned by CKO
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowBatch(b => !b)}>
            <Upload className="w-3.5 h-3.5 mr-1" /> Batch import
          </Button>
          <Button size="sm" onClick={() => { setDraft({ ...EMPTY }); setEditId("new"); }}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add project
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9 text-sm"
          placeholder="Search by project name, client, sector, tags, problem statement…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Batch import panel */}
      {showBatch && (
        <Card className="p-4 space-y-3 border-amber-300/40">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-amber-600" />
            <h2 className="text-sm font-bold">Batch import (key: value format)</h2>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Paste one or more projects separated by <code>---</code>. Each block uses <code>key: value</code> per line.
            Fields: project_name (required), client_name, sector, service_line, duration_weeks, team_size,
            revenue_eur, problem_statement, approach, key_outputs, results_impact, lessons_learned, reuse_potential, tags.
          </p>
          <Textarea
            value={batchInput}
            onChange={e => setBatchInput(e.target.value)}
            rows={16}
            placeholder={BATCH_PLACEHOLDER}
            className="font-mono text-xs"
          />
          <Button size="sm" onClick={importBatch} disabled={importing || !batchInput.trim()}>
            <Upload className="w-3.5 h-3.5 mr-1" /> {importing ? "Importing…" : "Import projects"}
          </Button>
        </Card>
      )}

      {/* Add / edit form */}
      {editId !== null && (
        <Card className="p-4 space-y-4 border-primary/30">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">{editId === "new" ? "New project" : "Edit project"}</h2>
            <button onClick={() => setEditId(null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {([
              ["project_name",  "Project name *"],
              ["client_name",   "Client"],
              ["sector",        "Sector"],
              ["service_line",  "Service line"],
              ["tags",          "Tags (comma-separated)"],
            ] as [keyof typeof EMPTY, string][]).map(([k, lbl]) => (
              <div key={k} className={k === "tags" ? "col-span-2" : ""}>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase">{lbl}</label>
                <Input
                  className="h-8 text-xs mt-0.5"
                  value={String(draft[k] ?? "")}
                  onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
                />
              </div>
            ))}
            {([
              ["duration_weeks", "Duration (weeks)"],
              ["team_size",      "Team size"],
              ["revenue_eur",    "Revenue (€)"],
            ] as [keyof typeof EMPTY, string][]).map(([k, lbl]) => (
              <div key={k}>
                <label className="text-[10px] font-semibold text-muted-foreground uppercase">{lbl}</label>
                <Input
                  type="number" className="h-8 text-xs mt-0.5"
                  value={String(draft[k] ?? "")}
                  onChange={e => setDraft(d => ({ ...d, [k]: e.target.value ? parseInt(e.target.value) : null }))}
                />
              </div>
            ))}
          </div>
          {([
            ["problem_statement", "Problem statement"],
            ["approach",          "Approach / methodology"],
            ["key_outputs",       "Key outputs (deliverables)"],
            ["results_impact",    "Results & impact"],
            ["lessons_learned",   "Lessons learned"],
            ["reuse_potential",   "Reuse potential (what can be templated?)"],
          ] as [keyof typeof EMPTY, string][]).map(([k, lbl]) => (
            <div key={k}>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">{lbl}</label>
              <Textarea
                className="text-xs mt-0.5"
                rows={3}
                value={String(draft[k] ?? "")}
                onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Status</label>
            <select
              className="h-7 text-xs rounded border px-2 bg-background"
              value={draft.status}
              onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}
            >
              <option value="draft">draft</option>
              <option value="published">published</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={!draft.project_name?.trim()}>
              <Check className="w-3.5 h-3.5 mr-1" /> Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      {/* Project list */}
      {loading ? (
        <p className="text-sm italic text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <Card className="p-6 text-center">
          <BookOpen className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground italic">
            {search ? "No projects match your search." : "No projects yet. Use batch import or add manually."}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {projects.map(p => {
            const isExpanded = expanded[p.id] ?? false;
            const tagList = p.tags?.split(",").map(t => t.trim()).filter(Boolean) ?? [];
            return (
              <Card key={p.id} className="overflow-hidden">
                <button
                  className="w-full text-left p-3 flex items-center gap-3 flex-wrap hover:bg-muted/20 transition-colors"
                  onClick={() => setExpanded(e => ({ ...e, [p.id]: !isExpanded }))}
                >
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
                  <span className="font-semibold text-sm">{p.project_name}</span>
                  {p.client_name && <span className="text-xs text-muted-foreground">{p.client_name}</span>}
                  {p.sector      && <Badge variant="outline" className="text-[10px]">{p.sector}</Badge>}
                  {p.service_line && <Badge variant="outline" className="text-[10px]">{p.service_line}</Badge>}
                  {p.duration_weeks && <span className="text-[10px] text-muted-foreground">{p.duration_weeks}w</span>}
                  {p.revenue_eur   && <span className="text-[10px] text-muted-foreground">€{Math.round(p.revenue_eur / 1000)}k</span>}
                  <Badge variant="outline" className={`text-[10px] ml-auto shrink-0 ${p.status === "published" ? "border-emerald-300 text-emerald-700" : "border-amber-300 text-amber-700"}`}>
                    {p.status}
                  </Badge>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t text-xs">
                    {tagList.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-2">
                        {tagList.map(t => (
                          <Badge key={t} variant="outline" className="text-[10px] bg-blue-50/40 border-blue-200">{t}</Badge>
                        ))}
                      </div>
                    )}
                    {([
                      ["Problem", p.problem_statement],
                      ["Approach", p.approach],
                      ["Key outputs", p.key_outputs],
                      ["Results & impact", p.results_impact],
                      ["Lessons learned", p.lessons_learned],
                      ["Reuse potential", p.reuse_potential],
                    ] as [string, string | null][]).filter(([, v]) => v).map(([label, value]) => (
                      <div key={label}>
                        <div className="text-[10px] font-bold uppercase text-muted-foreground mb-0.5">{label}</div>
                        <p className="whitespace-pre-wrap text-[11px] leading-relaxed">{value}</p>
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1 border-t">
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => { setDraft({ ...p }); setEditId(p.id); }}>
                        <Pencil className="w-3 h-3 mr-1" /> Edit
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => remove(p.id)}>
                        <Trash2 className="w-3 h-3 mr-1" /> Delete
                      </Button>
                      {p.status === "draft" && (
                        <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                          onClick={async () => {
                            await fetch(`/api/agentic/knowledge/${p.id}`, {
                              method: "PUT", credentials: "include",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: "published" }),
                            });
                            void load();
                          }}>
                          <Check className="w-3 h-3 mr-1" /> Publish
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
