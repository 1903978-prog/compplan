import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Map as MapIcon, Filter, ToggleLeft, ToggleRight, Pencil, Plus, Trash2, X, Check, RefreshCw, Wand2, UserPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SectionRow {
  id: number;
  module: string;
  section: string;
  subsection: string;
  primary_agent: string;
  secondary_agents: string;
  why: string;
  frequency: string;
}

const FREQ_COLORS: Record<string, string> = {
  Daily:     "bg-emerald-100 text-emerald-800 border-emerald-300",
  Weekly:    "bg-blue-100 text-blue-800 border-blue-300",
  Monthly:   "bg-purple-100 text-purple-800 border-purple-300",
  Quarterly: "bg-amber-100 text-amber-800 border-amber-300",
  Triggered: "bg-slate-100 text-slate-700 border-slate-300",
};

const FREQUENCIES = ["Daily", "Weekly", "Monthly", "Quarterly", "Triggered"];

interface RemapSuggestion { id: number; module: string; section: string; subsection: string; current: string; suggested: string; confidence: "high" | "medium" | "low"; reason: string; approved: boolean; }
interface HireSuggestion  { domain: string; reason: string; }
type BestMatch = { agent: string; confidence: "high" | "medium" | "low"; reason: string };

export default function SectionMap() {
  const { toast } = useToast();
  const [rows, setRows] = useState<SectionRow[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterModule, setFilterModule]   = useState("all");
  const [filterAgent,  setFilterAgent]    = useState("all");
  const [filterFreq,   setFilterFreq]     = useState("all");
  const [search,       setSearch]         = useState("");
  const [byAgent,      setByAgent]        = useState(false);  // reverse view

  // Inline edit
  const [editId,   setEditId]   = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<SectionRow>>({});

  // Add-row form
  const [showAdd,   setShowAdd]   = useState(false);
  const [addDraft,  setAddDraft]  = useState<Partial<SectionRow>>({
    module: "", section: "", subsection: "", primary_agent: "",
    secondary_agents: "", why: "", frequency: "Daily",
  });

  // Remap
  const [showRemap,     setShowRemap]     = useState(false);
  const [remapApplying, setRemapApplying] = useState(false);
  const [remapSuggestions, setRemapSuggestions] = useState<RemapSuggestion[]>([]);
  const [hireSuggestions,  setHireSuggestions]  = useState<HireSuggestion[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [r, a] = await Promise.all([
        fetch("/api/agentic/section-map", { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/agentic/agents",       { credentials: "include" }).then(r => r.ok ? r.json() : []),
      ]);
      setRows(Array.isArray(r) ? r : []);
      setAgents((Array.isArray(a) ? a : []).map((ag: any) => ag.name as string).sort());
    } catch { toast({ title: "Failed to load", variant: "destructive" }); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const modules = useMemo(() => Array.from(new Set(rows.map(r => r.module))).sort(), [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (filterModule !== "all" && r.module !== filterModule) return false;
    if (filterFreq   !== "all" && r.frequency !== filterFreq) return false;
    if (filterAgent  !== "all") {
      const ag = filterAgent.toLowerCase();
      if (!r.primary_agent.toLowerCase().includes(ag) && !r.secondary_agents.toLowerCase().includes(ag)) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      if (![r.module, r.section, r.subsection, r.primary_agent, r.secondary_agents, r.why].some(v => v.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [rows, filterModule, filterFreq, filterAgent, search]);

  // By-agent grouping
  const byAgentGroups = useMemo(() => {
    const map = new Map<string, { primary: SectionRow[]; secondary: SectionRow[] }>();
    for (const r of filtered) {
      const add = (name: string, role: "primary" | "secondary") => {
        const key = name.trim();
        if (!key) return;
        if (!map.has(key)) map.set(key, { primary: [], secondary: [] });
        map.get(key)![role].push(r);
      };
      add(r.primary_agent, "primary");
      r.secondary_agents.split(",").forEach(n => add(n.trim(), "secondary"));
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  async function saveEdit(id: number) {
    try {
      const r = await fetch(`/api/agentic/section-map/${id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editDraft),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Saved" });
      setEditId(null);
      void load();
    } catch (e) { toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" }); }
  }

  async function deleteRow(id: number) {
    if (!confirm("Delete this row?")) return;
    await fetch(`/api/agentic/section-map/${id}`, { method: "DELETE", credentials: "include" });
    void load();
  }

  async function addRow() {
    try {
      const r = await fetch("/api/agentic/section-map", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addDraft),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "Row added" });
      setShowAdd(false);
      setAddDraft({ module: "", section: "", subsection: "", primary_agent: "", secondary_agents: "", why: "", frequency: "Daily" });
      void load();
    } catch (e) { toast({ title: "Add failed", description: (e as Error).message, variant: "destructive" }); }
  }

  // ── Remap: client-side ownership reallocator ─────────────────────────────
  // Rules: map keywords from module+section+subsection to the canonical agent.
  const REMAP_RULES: Array<{ keywords: string[]; agent: string; confidence: "high" | "medium" }> = [
    { keywords: ["BD", "Business Development", "Deal", "CRM", "Pipeline", "Pitch", "Lead", "Partnership", "Contact"], agent: "SVP Sales / BD", confidence: "high" },
    { keywords: ["Hiring", "Candidate", "Recruitment", "Scoreboard", "Offer", "Interview"], agent: "CHRO", confidence: "high" },
    { keywords: ["Employee", "Headcount", "Payroll", "Compensation", "Onboarding"], agent: "CHRO", confidence: "medium" },
    { keywords: ["Invoice", "AR", "Revenue", "Collection", "Overdue", "Payment", "Client Ledger"], agent: "CFO", confidence: "high" },
    { keywords: ["Pricing", "Fee", "Rate", "Benchmark"], agent: "Pricing Agent", confidence: "high" },
    { keywords: ["Proposal", "Slide", "Template", "Pitch Deck", "Methodology", "Background"], agent: "Proposal Agent", confidence: "high" },
    { keywords: ["Knowledge", "Methodology", "CKO"], agent: "CKO", confidence: "high" },
    { keywords: ["Project", "Delivery", "Staffing", "Gantt", "Capacity", "COO"], agent: "COO", confidence: "high" },
    { keywords: ["Atlas", "Brief", "Decision", "Approval", "OKR", "Objective", "Agent", "Section Map"], agent: "CEO", confidence: "medium" },
    { keywords: ["Exec", "Dashboard", "Strategy", "President", "EXCOM"], agent: "President", confidence: "medium" },
    { keywords: ["Settings", "Backup", "Asset", "Admin"], agent: "COO", confidence: "medium" },
    { keywords: ["Time", "Days Off", "Leave"], agent: "CHRO", confidence: "medium" },
  ];

  const KNOWN_DOMAINS = ["BD", "Hiring", "Finance", "Pricing", "Proposals", "Knowledge", "Delivery", "Operations", "Legal", "Marketing", "Product", "Data Science", "Partnerships"];

  function runRemap() {
    const suggestions: RemapSuggestion[] = [];
    const unmatchedDomains = new Set<string>();

    for (const row of rows) {
      const haystack = `${row.module} ${row.section} ${row.subsection}`.toLowerCase();
      // Find first rule whose keywords appear in this row's text
      const matchedRule = REMAP_RULES.find(rule =>
        rule.keywords.some(k => haystack.includes(k.toLowerCase()))
      ) ?? null;
      let bestMatch: BestMatch | null = null;
      if (matchedRule !== null) {
        const hit = matchedRule.keywords.find(k => haystack.includes(k.toLowerCase())) ?? matchedRule.keywords[0];
        const agentExists = agents.some(a =>
          a.toLowerCase().includes(matchedRule.agent.toLowerCase()) ||
          matchedRule.agent.toLowerCase().includes(a.toLowerCase().split(" ")[0])
        );
        const conf: "high" | "medium" | "low" = agentExists ? matchedRule.confidence : "low";
        bestMatch = { agent: matchedRule.agent, confidence: conf, reason: `Keyword "${hit}" → ${matchedRule.agent}` };
      }

      if (!bestMatch) {
        // No rule matched — track as unmatched domain
        unmatchedDomains.add(row.module);
        continue;
      }

      // Only suggest if it's actually different from current
      if (bestMatch.confidence !== "low" && bestMatch.agent.toLowerCase() !== row.primary_agent.toLowerCase()) {
        suggestions.push({
          id: row.id,
          module: row.module, section: row.section, subsection: row.subsection,
          current: row.primary_agent,
          suggested: bestMatch.agent,
          confidence: bestMatch.confidence,
          reason: bestMatch.reason,
          approved: bestMatch.confidence === "high", // pre-approve high confidence
        });
      }
    }

    // Hire suggestions: agent-less domains
    const hire: HireSuggestion[] = [];
    for (const domain of Array.from(unmatchedDomains)) {
      if (!agents.some(a => a.toLowerCase().includes(domain.toLowerCase()))) {
        hire.push({ domain, reason: `No agent covers "${domain}" — consider creating a dedicated agent.` });
      }
    }

    setRemapSuggestions(suggestions);
    setHireSuggestions(hire);
    setShowRemap(true);
  }

  async function applyRemap() {
    setRemapApplying(true);
    const approved = remapSuggestions.filter(s => s.approved);
    let ok = 0;
    for (const s of approved) {
      const r = await fetch(`/api/agentic/section-map/${s.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primary_agent: s.suggested }),
      });
      if (r.ok) ok++;
    }
    toast({ title: `Remap applied`, description: `${ok} of ${approved.length} sections re-assigned.` });
    setShowRemap(false);
    setRemapApplying(false);
    void load();
  }

  return (
    <div className="container mx-auto py-6 max-w-7xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <MapIcon className="w-7 h-7 text-primary" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Atlas · PHASE 3</p>
            <h1 className="text-2xl font-bold tracking-tight">Agent ↔ App-Section Map</h1>
            <p className="text-sm text-muted-foreground">{rows.length} subsections · {filtered.length} shown · {agents.length} agents</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setByAgent(v => !v)}>
            {byAgent ? <ToggleRight className="w-4 h-4 mr-1 text-primary" /> : <ToggleLeft className="w-4 h-4 mr-1" />}
            {byAgent ? "By Agent" : "All Rows"}
          </Button>
          <Button size="sm" variant="outline" onClick={runRemap} title="Auto-suggest ownership re-assignments based on section keywords">
            <Wand2 className="w-3.5 h-3.5 mr-1 text-purple-600" /> Remap
          </Button>
          <Button size="sm" onClick={() => setShowAdd(v => !v)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add row
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-3 flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <Input
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-7 text-xs w-40"
        />
        <select value={filterModule} onChange={e => setFilterModule(e.target.value)} className="h-7 text-xs rounded border px-2 bg-background">
          <option value="all">All modules</option>
          {modules.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)} className="h-7 text-xs rounded border px-2 bg-background">
          <option value="all">All agents</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filterFreq} onChange={e => setFilterFreq(e.target.value)} className="h-7 text-xs rounded border px-2 bg-background">
          <option value="all">All frequencies</option>
          {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <span className="text-[10px] text-muted-foreground ml-auto">{filtered.length} / {rows.length} rows</span>
      </Card>

      {/* Remap suggestions panel */}
      {showRemap && (
        <Card className="p-4 border-2 border-purple-300 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-purple-600" />
              Remap suggestions — {remapSuggestions.filter(s => s.approved).length} approved / {remapSuggestions.length} total
            </h2>
            <Button size="sm" variant="ghost" onClick={() => setShowRemap(false)}><X className="w-4 h-4" /></Button>
          </div>

          {remapSuggestions.length === 0 && hireSuggestions.length === 0 && (
            <p className="text-xs text-muted-foreground italic">All sections already match their expected agents — no changes needed.</p>
          )}

          {remapSuggestions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase font-bold text-muted-foreground">Ownership changes</p>
              {remapSuggestions.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 text-xs border rounded px-2 py-1.5">
                  <input type="checkbox" checked={s.approved}
                    onChange={() => setRemapSuggestions(prev => prev.map((r, j) => j === i ? { ...r, approved: !r.approved } : r))}
                  />
                  <Badge variant="outline" className={`text-[9px] shrink-0 ${s.confidence === "high" ? "border-emerald-300 text-emerald-700" : "border-amber-300 text-amber-700"}`}>{s.confidence}</Badge>
                  <span className="text-muted-foreground shrink-0">{s.module} › {s.subsection}</span>
                  <span className="font-medium text-destructive shrink-0">{s.current}</span>
                  <span className="text-muted-foreground shrink-0">→</span>
                  <span className="font-medium text-emerald-700 shrink-0">{s.suggested}</span>
                  <span className="text-muted-foreground truncate flex-1">{s.reason}</span>
                </div>
              ))}
            </div>
          )}

          {hireSuggestions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                <UserPlus className="w-3 h-3 text-blue-600" /> Consider hiring / creating new agents
              </p>
              {hireSuggestions.map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-xs border border-blue-200 rounded px-2 py-1.5 bg-blue-50/30">
                  <UserPlus className="w-3 h-3 text-blue-500 shrink-0" />
                  <span className="font-semibold text-blue-700">{h.domain}</span>
                  <span className="text-muted-foreground">{h.reason}</span>
                </div>
              ))}
            </div>
          )}

          {remapSuggestions.length > 0 && (
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => void applyRemap()} disabled={remapApplying || remapSuggestions.filter(s => s.approved).length === 0}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${remapApplying ? "animate-spin" : ""}`} />
                Apply {remapSuggestions.filter(s => s.approved).length} change{remapSuggestions.filter(s => s.approved).length !== 1 ? "s" : ""}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRemapSuggestions(s => s.map(r => ({ ...r, approved: true })))}>Select all</Button>
              <Button size="sm" variant="ghost" onClick={() => setRemapSuggestions(s => s.map(r => ({ ...r, approved: false })))}>Clear all</Button>
            </div>
          )}
        </Card>
      )}

      {/* Add-row form */}
      {showAdd && (
        <Card className="p-3 space-y-2 border-2 border-primary/30">
          <div className="text-xs font-bold text-primary mb-1">New subsection</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(["module","section","subsection","primary_agent"] as const).map(f => (
              <Input key={f} placeholder={f.replace("_"," ")} value={(addDraft as any)[f] ?? ""} onChange={e => setAddDraft(d => ({...d, [f]: e.target.value}))} className="h-7 text-xs" />
            ))}
            <Input placeholder="secondary agents (CSV)" value={addDraft.secondary_agents ?? ""} onChange={e => setAddDraft(d => ({...d, secondary_agents: e.target.value}))} className="h-7 text-xs col-span-2" />
            <Input placeholder="why" value={addDraft.why ?? ""} onChange={e => setAddDraft(d => ({...d, why: e.target.value}))} className="h-7 text-xs col-span-2" />
            <select value={addDraft.frequency ?? "Daily"} onChange={e => setAddDraft(d => ({...d, frequency: e.target.value}))} className="h-7 text-xs rounded border px-2 bg-background">
              {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={addRow} disabled={!addDraft.module || !addDraft.section || !addDraft.subsection || !addDraft.primary_agent}>
              <Plus className="w-3.5 h-3.5 mr-1" /> Add
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground italic">Loading…</Card>
      ) : byAgent ? (
        /* ── BY-AGENT reverse view ─────────────────────────────────── */
        <div className="space-y-4">
          {byAgentGroups.map(([agentName, { primary, secondary }]) => (
            <Card key={agentName} className="p-4">
              <h2 className="text-sm font-bold mb-2">{agentName}</h2>
              {primary.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-1">PRIMARY ({primary.length})</div>
                  <div className="space-y-0.5">
                    {primary.map(r => (
                      <div key={r.id} className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 text-xs py-0.5 border-b items-center">
                        <span className="text-muted-foreground">{r.module} / {r.section}</span>
                        <span className="font-medium">{r.subsection}</span>
                        <span className="text-muted-foreground truncate">{r.why}</span>
                        <Badge variant="outline" className={`text-[10px] ${FREQ_COLORS[r.frequency] ?? ""}`}>{r.frequency}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {secondary.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700 mb-1">SECONDARY ({secondary.length})</div>
                  <div className="space-y-0.5">
                    {secondary.map(r => (
                      <div key={r.id} className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 text-xs py-0.5 border-b items-center opacity-75">
                        <span className="text-muted-foreground">{r.module} / {r.section}</span>
                        <span>{r.subsection}</span>
                        <span className="text-muted-foreground truncate">primary: {r.primary_agent}</span>
                        <Badge variant="outline" className={`text-[10px] ${FREQ_COLORS[r.frequency] ?? ""}`}>{r.frequency}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        /* ── FULL TABLE view ───────────────────────────────────────── */
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr className="border-b">
                <th className="p-2 text-left font-semibold">Module</th>
                <th className="p-2 text-left font-semibold">Section</th>
                <th className="p-2 text-left font-semibold">Subsection</th>
                <th className="p-2 text-left font-semibold">Primary</th>
                <th className="p-2 text-left font-semibold">Secondary</th>
                <th className="p-2 text-left font-semibold">Why</th>
                <th className="p-2 text-left font-semibold">Freq</th>
                <th className="p-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => editId === r.id ? (
                <tr key={r.id} className="border-b bg-primary/5">
                  {(["module","section","subsection","primary_agent","secondary_agents","why"] as const).map(f => (
                    <td key={f} className="p-1">
                      <Input
                        value={(editDraft as any)[f] ?? r[f]}
                        onChange={e => setEditDraft(d => ({...d, [f]: e.target.value}))}
                        className="h-6 text-xs"
                      />
                    </td>
                  ))}
                  <td className="p-1">
                    <select
                      value={editDraft.frequency ?? r.frequency}
                      onChange={e => setEditDraft(d => ({...d, frequency: e.target.value}))}
                      className="h-6 text-xs rounded border px-1 bg-background w-full"
                    >
                      {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </td>
                  <td className="p-1">
                    <div className="flex gap-1">
                      <button onClick={() => saveEdit(r.id)} className="text-emerald-600 hover:text-emerald-800 p-0.5" title="Save"><Check className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setEditId(null)} className="text-muted-foreground hover:text-foreground p-0.5" title="Cancel"><X className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={r.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="p-2 text-muted-foreground">{r.module}</td>
                  <td className="p-2 text-muted-foreground">{r.section}</td>
                  <td className="p-2 font-medium">{r.subsection}</td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 border-emerald-300 text-emerald-800">{r.primary_agent}</Badge>
                  </td>
                  <td className="p-2 text-muted-foreground max-w-[160px] truncate" title={r.secondary_agents}>{r.secondary_agents}</td>
                  <td className="p-2 text-muted-foreground max-w-[200px] truncate" title={r.why}>{r.why}</td>
                  <td className="p-2">
                    <Badge variant="outline" className={`text-[10px] ${FREQ_COLORS[r.frequency] ?? ""}`}>{r.frequency}</Badge>
                  </td>
                  <td className="p-1">
                    <div className="flex gap-1">
                      <button onClick={() => { setEditId(r.id); setEditDraft({ module: r.module, section: r.section, subsection: r.subsection, primary_agent: r.primary_agent, secondary_agents: r.secondary_agents, why: r.why, frequency: r.frequency }); }} className="text-muted-foreground hover:text-primary p-0.5" title="Edit"><Pencil className="w-3 h-3" /></button>
                      <button onClick={() => deleteRow(r.id)} className="text-muted-foreground hover:text-destructive p-0.5" title="Delete"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="text-xs italic text-muted-foreground p-4">No rows match your filters.</p>
          )}
        </Card>
      )}
    </div>
  );
}
