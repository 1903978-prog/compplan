// Templates Admin — browse, test-render, and edit every microAI template.
// Route: /agentic/templates
// API:
//   GET  /api/templates              → TemplateMeta[]
//   GET  /api/templates/:agent/:slug → { meta, raw }
//   POST /api/templates/render       → { body, missingSlots }
//   POST /api/templates/:agent/:slug → save raw edit

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText, ChevronDown, ChevronRight, Play, Edit2, Save,
  X, Search, RefreshCw, AlertCircle, CheckCircle2,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface TemplateMeta {
  name: string;
  agent: string;
  trigger: string;
  slots: string[];
  output: string;
  slug: string;
}

interface GroupedAgent {
  agent: string;
  templates: TemplateMeta[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const AGENT_LABELS: Record<string, string> = {
  ceo_agent:        "CEO",
  coo_agent:        "COO",
  cfo_agent:        "CFO",
  svp_sales:        "SVP Sales",
  cmo_agent:        "CMO",
  chro_agent:       "CHRO",
  cko_agent:        "CKO",
  delivery_officer: "Delivery",
  pricing_agent:    "Pricing",
  bd_agent:         "BD",
  proposal_agent:   "Proposals",
  ar_agent:         "AR",
  ld_manager:       "L&D",
  partnership_agent:"Partnerships",
};

function agentLabel(agent: string) {
  return AGENT_LABELS[agent] ?? agent;
}

function groupByAgent(templates: TemplateMeta[]): GroupedAgent[] {
  const map = new Map<string, TemplateMeta[]>();
  for (const t of templates) {
    if (!map.has(t.agent)) map.set(t.agent, []);
    map.get(t.agent)!.push(t);
  }
  return Array.from(map.entries()).map(([agent, tpl]) => ({ agent, templates: tpl }));
}

// ── Slot form — renders one input per slot ───────────────────────────────────

function SlotForm({
  slots,
  values,
  onChange,
}: {
  slots: string[];
  values: Record<string, string>;
  onChange: (k: string, v: string) => void;
}) {
  return (
    <div className="space-y-2">
      {slots.map(slot => (
        <div key={slot} className="flex items-start gap-2">
          <label className="w-40 shrink-0 text-[11px] font-mono text-muted-foreground pt-2 truncate" title={slot}>
            {slot}
          </label>
          <Textarea
            className="flex-1 text-[12px] min-h-[32px] max-h-40 resize-y"
            rows={1}
            placeholder={`value for {{${slot}}}`}
            value={values[slot] ?? ""}
            onChange={e => onChange(slot, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function TemplateDetail({ meta }: { meta: TemplateMeta }) {
  const [raw, setRaw]             = useState<string | null>(null);
  const [editMode, setEditMode]   = useState(false);
  const [editRaw, setEditRaw]     = useState("");
  const [slotVals, setSlotVals]   = useState<Record<string, string>>({});
  const [rendered, setRendered]   = useState<string | null>(null);
  const [missing, setMissing]     = useState<string[]>([]);
  const [loading, setLoading]     = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [renderErr, setRenderErr] = useState<string | null>(null);

  // Load raw on mount / when meta changes
  useEffect(() => {
    setRaw(null);
    setRendered(null);
    setMissing([]);
    setEditMode(false);
    setSlotVals({});
    fetch(`/api/templates/${meta.agent}/${meta.slug}`, { credentials: "include" })
      .then(r => r.json())
      .then(d => { setRaw(d.raw ?? ""); setEditRaw(d.raw ?? ""); })
      .catch(() => setRaw("(error loading template)"));
  }, [meta.agent, meta.slug]);

  const handleSlotChange = useCallback((k: string, v: string) => {
    setSlotVals(prev => ({ ...prev, [k]: v }));
  }, []);

  const handleRender = async () => {
    setLoading(true);
    setRenderErr(null);
    try {
      const res = await fetch("/api/templates/render", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: meta.agent, slug: meta.slug, slots: slotVals }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "render failed");
      setRendered(d.body);
      setMissing(d.missingSlots ?? []);
    } catch (e: unknown) {
      setRenderErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/templates/${meta.agent}/${meta.slug}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editRaw }),
      });
      if (!res.ok) throw new Error("save failed");
      setRaw(editRaw);
      setSaveStatus("ok");
      setEditMode(false);
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("err");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Meta header */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold">{meta.name}</h2>
          <Badge variant="outline" className="text-[10px]">{agentLabel(meta.agent)}</Badge>
          <Badge variant="secondary" className="text-[10px]">{meta.output}</Badge>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          <span className="font-medium">Trigger:</span> {meta.trigger}
        </p>
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium">Slug:</span>{" "}
          <code className="font-mono">{meta.agent}/{meta.slug}</code>
        </p>
      </div>

      {/* Slot form + render */}
      <Card className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Test render ({meta.slots.length} slots)
          </p>
          <Button size="sm" variant="default" onClick={handleRender} disabled={loading} className="h-7 text-[11px]">
            {loading
              ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
              : <Play className="w-3 h-3 mr-1" />}
            Render
          </Button>
        </div>
        <SlotForm slots={meta.slots} values={slotVals} onChange={handleSlotChange} />
      </Card>

      {/* Render output */}
      {renderErr && (
        <div className="flex items-start gap-2 p-3 rounded border border-destructive/40 bg-destructive/5 text-[12px] text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {renderErr}
        </div>
      )}
      {rendered !== null && (
        <Card className="p-3 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              Rendered output
            </span>
            {missing.length > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {missing.length} missing slot{missing.length > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          {missing.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Still unfilled: {missing.map(s => <code key={s} className="mx-0.5 font-mono text-[10px]">{"{{"+s+"}}"}</code>)}
            </p>
          )}
          <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/30 rounded p-2 max-h-80 overflow-y-auto leading-relaxed">
            {rendered}
          </pre>
        </Card>
      )}

      {/* Raw template editor */}
      <Card className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Raw template</p>
          <div className="flex gap-1.5">
            {editMode ? (
              <>
                <Button
                  size="sm" variant="default" className="h-7 text-[11px]"
                  onClick={handleSave}
                  disabled={saveStatus === "saving"}
                >
                  {saveStatus === "saving"
                    ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                    : <Save className="w-3 h-3 mr-1" />}
                  {saveStatus === "ok" ? "Saved!" : saveStatus === "err" ? "Error" : "Save"}
                </Button>
                <Button
                  size="sm" variant="ghost" className="h-7 text-[11px]"
                  onClick={() => { setEditMode(false); setEditRaw(raw ?? ""); }}
                >
                  <X className="w-3 h-3 mr-1" /> Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm" variant="outline" className="h-7 text-[11px]"
                onClick={() => setEditMode(true)}
              >
                <Edit2 className="w-3 h-3 mr-1" /> Edit
              </Button>
            )}
          </div>
        </div>
        {raw === null ? (
          <p className="text-[11px] text-muted-foreground">Loading…</p>
        ) : editMode ? (
          <Textarea
            className="font-mono text-[11px] min-h-[320px] resize-y"
            value={editRaw}
            onChange={e => setEditRaw(e.target.value)}
          />
        ) : (
          <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/30 rounded p-2 max-h-80 overflow-y-auto leading-relaxed">
            {raw}
          </pre>
        )}
      </Card>
    </div>
  );
}

// ── Agent group ───────────────────────────────────────────────────────────────

function AgentGroup({
  group,
  selectedSlug,
  onSelect,
  defaultOpen,
}: {
  group: GroupedAgent;
  selectedSlug: string | null;
  onSelect: (meta: TemplateMeta) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasSelected = group.templates.some(t => `${t.agent}/${t.slug}` === selectedSlug);

  // Auto-open when a child is selected
  useEffect(() => {
    if (hasSelected) setOpen(true);
  }, [hasSelected]);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left bg-muted/10"
      >
        {open
          ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
        <span className="text-[12px] font-semibold">{agentLabel(group.agent)}</span>
        <span className="text-[11px] text-muted-foreground ml-1">{group.templates.length}</span>
      </button>
      {open && (
        <div className="border-t divide-y">
          {group.templates.map(t => {
            const id = `${t.agent}/${t.slug}`;
            const active = id === selectedSlug;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(t)}
                className={`w-full flex items-start gap-2 px-4 py-2 text-left transition-colors hover:bg-muted/30 ${
                  active ? "bg-primary/5 border-l-2 border-primary" : ""
                }`}
              >
                <FileText className="w-3 h-3 shrink-0 mt-0.5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className={`text-[12px] truncate ${active ? "font-semibold text-primary" : ""}`}>
                    {t.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">{t.trigger}</p>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                  {t.slots.length} slots
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TemplatesAdmin() {
  const [templates, setTemplates]   = useState<TemplateMeta[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [selected, setSelected]     = useState<TemplateMeta | null>(null);

  useEffect(() => {
    fetch("/api/templates", { credentials: "include" })
      .then(r => r.json())
      .then(d => { setTemplates(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? templates.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.agent.toLowerCase().includes(search.toLowerCase()) ||
        t.slug.toLowerCase().includes(search.toLowerCase()) ||
        t.trigger.toLowerCase().includes(search.toLowerCase())
      )
    : templates;

  const groups = groupByAgent(filtered);
  const selectedSlug = selected ? `${selected.agent}/${selected.slug}` : null;

  return (
    <div className="container mx-auto pt-2 pb-8 px-4 md:px-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-5 h-5 text-primary shrink-0" />
        <div>
          <h1 className="text-xl font-bold tracking-tight leading-tight">Templates</h1>
          <p className="text-[12px] text-muted-foreground">
            {loading ? "Loading…" : `${templates.length} templates across ${groups.length} agents — zero LLM tokens`}
          </p>
        </div>
      </div>

      <div className="flex gap-4 items-start">
        {/* Left: template list */}
        <div className="w-72 shrink-0 space-y-2">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 h-8 text-[12px]"
              placeholder="Search templates…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {/* Stats */}
          <div className="flex gap-3 text-[11px] text-muted-foreground px-1">
            <span><span className="font-semibold text-foreground">{filtered.length}</span> templates</span>
            <span><span className="font-semibold text-foreground">{groups.length}</span> agents</span>
          </div>
          {/* Groups */}
          <div className="space-y-1.5 max-h-[calc(100vh-180px)] overflow-y-auto pr-1">
            {loading ? (
              <p className="text-[12px] text-muted-foreground px-2 py-4">Loading templates…</p>
            ) : groups.length === 0 ? (
              <p className="text-[12px] text-muted-foreground px-2 py-4">No templates match.</p>
            ) : (
              groups.map((g, i) => (
                <AgentGroup
                  key={g.agent}
                  group={g}
                  selectedSlug={selectedSlug}
                  onSelect={setSelected}
                  defaultOpen={i === 0}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: detail panel */}
        <div className="flex-1 min-w-0">
          {selected ? (
            <TemplateDetail key={`${selected.agent}/${selected.slug}`} meta={selected} />
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
              <FileText className="w-8 h-8 opacity-20" />
              <p className="text-[13px]">Select a template to preview and test-render it.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
