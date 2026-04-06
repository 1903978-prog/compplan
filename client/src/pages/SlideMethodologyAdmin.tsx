import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/PageHeader";
import { Save, RotateCcw, Check, FileText, ChevronRight, Loader2, Trash2, Plus, Palette, Type, Sparkles, Wand2, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MASTER_SLIDES, PROJECT_TYPES } from "@/lib/proposalSlides";

// ── Deck Template Types & Defaults ──────────────────────────────────────────

interface DeckTemplateConfig {
  id?: number;
  palette: Record<string, string>;
  typography: Record<string, string>;
  format_a_desc: string;
  format_b_desc: string;
  footer_left: string;
  footer_right: string;
  system_prompt: string;
  updated_at: string;
}

const DEFAULT_PALETTE: Record<string, string> = {
  C_TRACKER: "535353", C_TITLE: "1A6571", C_HEADER: "1A6571", C_BORDER: "16C3CF",
  C_BODY: "535353", C_WHITE: "FFFFFF", C_SUBHEAD: "16C3CF", C_BGROW: "F0F9FA",
};

const PALETTE_LABELS: Record<string, string> = {
  C_TRACKER: "Tracker", C_TITLE: "Title", C_HEADER: "Header", C_BORDER: "Border",
  C_BODY: "Body", C_WHITE: "White", C_SUBHEAD: "Subhead", C_BGROW: "Row BG",
};

const DEFAULT_TYPOGRAPHY: Record<string, string> = {
  tracker: "Arial 7pt #535353 NOT bold",
  title: "Arial 20pt #1A6571 Bold",
  headers: "Arial 11pt #1A6571 Bold",
  bullets: "Arial 8.5pt #535353",
  footer: "Arial 7pt #535353",
  eendigo: "Arial 7pt #1A6571 (footer right)",
  page_num: "Arial 7pt #535353 (footer right)",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface SlideConfig {
  slide_id: string;
  purpose: string;
  structure: { sections: string[] };
  rules: string;
  columns: { column_1?: string; column_2?: string; column_3?: string };
  variations: Record<string, string>;
  examples: string[];
  format: string;
  insight_bar: number;
  updated_at: string;
}

function emptyConfig(slideId: string): SlideConfig {
  return {
    slide_id: slideId,
    purpose: "",
    structure: { sections: [] },
    rules: "",
    columns: {},
    variations: {},
    examples: [],
    format: "A",
    insight_bar: 0,
    updated_at: new Date().toISOString(),
  };
}

// ── Main Component ────────────────────────────────────────────────────────────

type AdminTab = "slides" | "template";

export default function SlideMethodologyAdmin() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<AdminTab>("slides");
  const [configs, setConfigs] = useState<Record<string, SlideConfig>>({});
  const [selectedSlide, setSelectedSlide] = useState<string>(MASTER_SLIDES[0].slide_id);
  const [editing, setEditing] = useState<SlideConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // ── Deck Template state ──────────────────────────────────────────────────
  const [deckTemplate, setDeckTemplate] = useState<DeckTemplateConfig | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<DeckTemplateConfig | null>(null);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);

  // ── Bulk Instructions state ────────────────────────────────────────────────
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  async function handleBulkParse() {
    if (!bulkText.trim()) {
      toast({ title: "Paste instructions first", variant: "destructive" });
      return;
    }
    setBulkProcessing(true);
    setBulkResult(null);
    try {
      const res = await fetch("/api/slide-methodology/bulk-parse", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: bulkText }),
      });
      if (res.ok) {
        const data = await res.json();
        // Reload all configs from DB
        await loadConfigs();
        setBulkResult(`Processed ${data.count} slide${data.count !== 1 ? "s" : ""} successfully`);
        toast({ title: `${data.count} slides configured from instructions` });
      } else {
        const err = await res.json();
        setBulkResult(`Error: ${err.message}`);
        toast({ title: "Processing failed", variant: "destructive" });
      }
    } catch {
      setBulkResult("Error: Network failure");
      toast({ title: "Processing failed", variant: "destructive" });
    }
    setBulkProcessing(false);
  }

  useEffect(() => { loadConfigs(); loadDeckTemplate(); }, []);

  useEffect(() => {
    // When selected slide changes, load its config into editing state
    const config = configs[selectedSlide] || emptyConfig(selectedSlide);
    setEditing({ ...config });
    setDirty(false);
  }, [selectedSlide, configs]);

  async function loadConfigs() {
    const res = await fetch("/api/slide-methodology", { credentials: "include" });
    if (res.ok) {
      const list: SlideConfig[] = await res.json();
      const map: Record<string, SlideConfig> = {};
      for (const c of list) map[c.slide_id] = c;
      setConfigs(map);
    }
  }

  async function loadDeckTemplate() {
    const res = await fetch("/api/deck-template", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      if (data && data.id) {
        setDeckTemplate(data);
        setEditingTemplate({ ...data });
      } else {
        // No config yet — create empty
        const empty: DeckTemplateConfig = {
          palette: DEFAULT_PALETTE,
          typography: DEFAULT_TYPOGRAPHY,
          format_a_desc: "",
          format_b_desc: "",
          footer_left: "Notes and source",
          footer_right: "Eendigo",
          system_prompt: "",
          updated_at: new Date().toISOString(),
        };
        setDeckTemplate(empty);
        setEditingTemplate({ ...empty });
      }
    }
  }

  function updateTemplate(partial: Partial<DeckTemplateConfig>) {
    setEditingTemplate(prev => prev ? { ...prev, ...partial } : prev);
    setTemplateDirty(true);
  }

  async function handleSaveTemplate() {
    if (!editingTemplate) return;
    setTemplateSaving(true);
    try {
      const res = await fetch("/api/deck-template", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingTemplate),
      });
      if (res.ok) {
        const saved = await res.json();
        setDeckTemplate(saved);
        setEditingTemplate({ ...saved });
        setTemplateDirty(false);
        toast({ title: "Template saved" });
      }
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
    setTemplateSaving(false);
  }

  function handleResetTemplate() {
    if (deckTemplate) {
      setEditingTemplate({ ...deckTemplate });
      setTemplateDirty(false);
    }
  }

  function update(partial: Partial<SlideConfig>) {
    if (!editing) return;
    setEditing(prev => prev ? { ...prev, ...partial } : prev);
    setDirty(true);
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/slide-methodology/${editing.slide_id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      if (res.ok) {
        const saved = await res.json();
        setConfigs(prev => ({ ...prev, [saved.slide_id]: saved }));
        setDirty(false);
        toast({ title: "Configuration saved" });
      }
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
    setSaving(false);
  }

  function handleReset() {
    const config = configs[selectedSlide] || emptyConfig(selectedSlide);
    setEditing({ ...config });
    setDirty(false);
  }

  async function handleDelete() {
    if (!editing) return;
    await fetch(`/api/slide-methodology/${editing.slide_id}`, {
      method: "DELETE", credentials: "include",
    });
    setConfigs(prev => {
      const next = { ...prev };
      delete next[editing.slide_id];
      return next;
    });
    setEditing(emptyConfig(editing.slide_id));
    setDirty(false);
    toast({ title: "Configuration reset to empty" });
  }

  // ── Structure sections helpers ─────────────────────────────────────────────

  function addSection() {
    if (!editing) return;
    update({ structure: { sections: [...editing.structure.sections, ""] } });
  }

  function updateSection(idx: number, val: string) {
    if (!editing) return;
    const sections = [...editing.structure.sections];
    sections[idx] = val;
    update({ structure: { sections } });
  }

  function removeSection(idx: number) {
    if (!editing) return;
    const sections = editing.structure.sections.filter((_, i) => i !== idx);
    update({ structure: { sections } });
  }

  // ── Examples helpers ───────────────────────────────────────────────────────

  function addExample() {
    if (!editing) return;
    update({ examples: [...editing.examples, ""] });
  }

  function updateExample(idx: number, val: string) {
    if (!editing) return;
    const examples = [...editing.examples];
    examples[idx] = val;
    update({ examples });
  }

  function removeExample(idx: number) {
    if (!editing) return;
    update({ examples: editing.examples.filter((_, i) => i !== idx) });
  }

  // ── Variations helpers ─────────────────────────────────────────────────────

  function updateVariation(key: string, val: string) {
    if (!editing) return;
    update({ variations: { ...editing.variations, [key]: val } });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const masterDef = MASTER_SLIDES.find(s => s.slide_id === selectedSlide);
  const hasConfig = !!configs[selectedSlide];

  return (
    <div>
      <PageHeader
        title="Slide Methodology Admin"
        description="Define structure, rules, and guidance for each proposal slide"
      />

      {/* ── Tab bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-4 border-b">
        <button
          onClick={() => activeTab === "template" && templateDirty ? (window.confirm("Unsaved template changes. Discard?") && setActiveTab("slides")) : setActiveTab("slides")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "slides" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="w-4 h-4 inline mr-1.5" />Slide Configs
        </button>
        <button
          onClick={() => activeTab === "slides" && dirty ? (window.confirm("Unsaved slide changes. Discard?") && setActiveTab("template")) : setActiveTab("template")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "template" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Palette className="w-4 h-4 inline mr-1.5" />Template Format
        </button>
      </div>

      {/* ── Template Format Tab ──────────────────────────────────────── */}
      {activeTab === "template" && editingTemplate && (
        <div className="space-y-4">
          {/* Header with save/reset */}
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Palette className="w-5 h-5 text-primary" />
                  Eendigo Deck Template
                </h3>
                <p className="text-sm text-muted-foreground">Master template format for PptxGenJS deck generation</p>
              </div>
              <div className="flex items-center gap-2">
                {templateDirty && <span className="text-xs text-orange-500 font-medium">Unsaved changes</span>}
                <Button variant="outline" size="sm" onClick={handleResetTemplate} disabled={!templateDirty}>
                  <RotateCcw className="w-4 h-4 mr-1" /> Discard
                </Button>
                <Button size="sm" onClick={handleSaveTemplate} disabled={templateSaving || !templateDirty}>
                  {templateSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                  Save
                </Button>
              </div>
            </div>
          </Card>

          {/* System Prompt */}
          <Card className="p-4">
            <h4 className="text-sm font-semibold mb-2">System Prompt</h4>
            <p className="text-xs text-muted-foreground mb-2">Full template instructions fed to Claude and deck generator</p>
            <Textarea
              value={editingTemplate.system_prompt}
              onChange={e => updateTemplate({ system_prompt: e.target.value })}
              rows={18}
              className="font-mono text-xs"
              placeholder="System prompt for deck generation..."
            />
          </Card>

          {/* Palette */}
          <Card className="p-4">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Palette className="w-4 h-4 text-primary" /> Color Palette
            </h4>
            <p className="text-xs text-muted-foreground mb-3">Hex colors used across all slides (DO NOT CHANGE unless rebranding)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.keys(DEFAULT_PALETTE).map(key => (
                <div key={key} className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded border shrink-0"
                    style={{ backgroundColor: `#${editingTemplate.palette[key] || DEFAULT_PALETTE[key]}` }}
                  />
                  <div className="flex-1 min-w-0">
                    <label className="text-xs text-muted-foreground block">{PALETTE_LABELS[key] || key}</label>
                    <Input
                      value={editingTemplate.palette[key] || ""}
                      onChange={e => updateTemplate({ palette: { ...editingTemplate.palette, [key]: e.target.value } })}
                      className="h-7 text-xs font-mono"
                      placeholder={DEFAULT_PALETTE[key]}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Typography */}
          <Card className="p-4">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Type className="w-4 h-4 text-primary" /> Typography
            </h4>
            <p className="text-xs text-muted-foreground mb-3">Font specifications for each slide element</p>
            <div className="space-y-2">
              {Object.keys(DEFAULT_TYPOGRAPHY).map(key => (
                <div key={key} className="flex items-center gap-3">
                  <label className="text-xs text-muted-foreground w-24 text-right capitalize shrink-0">{key.replace(/_/g, " ")}</label>
                  <Input
                    value={editingTemplate.typography[key] || ""}
                    onChange={e => updateTemplate({ typography: { ...editingTemplate.typography, [key]: e.target.value } })}
                    className="h-8 text-sm font-mono flex-1"
                    placeholder={DEFAULT_TYPOGRAPHY[key]}
                  />
                </div>
              ))}
            </div>
          </Card>

          {/* Format Descriptions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-4">
              <h4 className="text-sm font-semibold mb-2">Format A Description</h4>
              <p className="text-xs text-muted-foreground mb-2">3-column with row bands</p>
              <Textarea
                value={editingTemplate.format_a_desc}
                onChange={e => updateTemplate({ format_a_desc: e.target.value })}
                rows={4}
                className="text-sm"
                placeholder="Describe Format A layout..."
              />
            </Card>
            <Card className="p-4">
              <h4 className="text-sm font-semibold mb-2">Format B Description</h4>
              <p className="text-xs text-muted-foreground mb-2">Plain 3-column bullets</p>
              <Textarea
                value={editingTemplate.format_b_desc}
                onChange={e => updateTemplate({ format_b_desc: e.target.value })}
                rows={4}
                className="text-sm"
                placeholder="Describe Format B layout..."
              />
            </Card>
          </div>

          {/* Footer */}
          <Card className="p-4">
            <h4 className="text-sm font-semibold mb-2">Footer Settings</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Footer Left</label>
                <Input
                  value={editingTemplate.footer_left}
                  onChange={e => updateTemplate({ footer_left: e.target.value })}
                  className="h-8 text-sm"
                  placeholder="Notes and source"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Footer Right</label>
                <Input
                  value={editingTemplate.footer_right}
                  onChange={e => updateTemplate({ footer_right: e.target.value })}
                  className="h-8 text-sm"
                  placeholder="Eendigo"
                />
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── Slide Configs Tab ────────────────────────────────────────── */}
      {activeTab === "slides" && (
      <div className="space-y-4">
        {/* ── Bulk Instructions Panel ──────────────────────────────────── */}
        <Card className="p-0 overflow-hidden">
          <button
            onClick={() => setBulkOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold">AI Bulk Instructions</span>
              <span className="text-xs text-muted-foreground">Paste instructions and auto-populate all slides</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${bulkOpen ? "rotate-180" : ""}`} />
          </button>
          {bulkOpen && (
            <div className="px-4 pb-4 border-t">
              <p className="text-xs text-muted-foreground mt-3 mb-2">
                Paste your methodology instructions below. Claude will parse them and automatically fill the right fields
                (purpose, structure, rules, columns, examples) for each slide it recognizes.
                Reference slides by name, number, or description.
              </p>
              <Textarea
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                rows={10}
                className="font-mono text-xs mb-3"
                placeholder={`Example:\n\nPage 7 — Client Context + Why Now:\n- Purpose: Establish urgency and business context\n- Sections: Market context, Why now triggers, Competitive pressure, Executive mandate\n- Rules: Must be quantified, no generic language, max 6 bullets\n- Format: 3-column (Context | Triggers | Implications)\n\nPage 6 — Executive Summary:\n- Purpose: One-page decision enabler\n- Sections: Context, Recommendation, Impact, How\n...`}
              />
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleBulkParse}
                  disabled={bulkProcessing || !bulkText.trim()}
                  size="sm"
                >
                  {bulkProcessing ? (
                    <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Processing...</>
                  ) : (
                    <><Sparkles className="w-4 h-4 mr-1.5" /> Parse & Apply to Slides</>
                  )}
                </Button>
                {bulkText.trim() && !bulkProcessing && (
                  <Button variant="ghost" size="sm" onClick={() => { setBulkText(""); setBulkResult(null); }}>
                    Clear
                  </Button>
                )}
                {bulkResult && (
                  <span className={`text-xs font-medium ${bulkResult.startsWith("Error") ? "text-destructive" : "text-green-600"}`}>
                    {bulkResult}
                  </span>
                )}
              </div>
            </div>
          )}
        </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* ── Left panel: slide list ─────────────────────────────────────── */}
        <div className="lg:col-span-1">
          <Card className="p-0 overflow-hidden">
            <div className="px-3 py-2 border-b bg-muted/30">
              <span className="text-sm font-semibold">Slides ({MASTER_SLIDES.length})</span>
            </div>
            <div className="max-h-[calc(100vh-200px)] overflow-y-auto divide-y">
              {MASTER_SLIDES.map((slide, idx) => {
                const configured = !!configs[slide.slide_id];
                const isActive = selectedSlide === slide.slide_id;
                return (
                  <button
                    key={slide.slide_id}
                    onClick={() => {
                      if (dirty) {
                        if (!window.confirm("You have unsaved changes. Discard them?")) return;
                      }
                      setSelectedSlide(slide.slide_id);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      isActive ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent/50"
                    }`}
                  >
                    <span className="w-5 text-xs text-muted-foreground text-right shrink-0">{idx + 1}</span>
                    <span className="flex-1 truncate">{slide.title}</span>
                    {configured && <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* ── Right panel: edit config ────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">
          {/* Header with save/reset */}
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  {masterDef?.title || selectedSlide}
                </h3>
                <p className="text-sm text-muted-foreground">{masterDef?.description}</p>
                {hasConfig && (
                  <span className="text-xs text-green-600 mt-1 inline-block">Configured</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {dirty && <span className="text-xs text-orange-500 font-medium">Unsaved changes</span>}
                <Button variant="outline" size="sm" onClick={handleReset} disabled={!dirty}>
                  <RotateCcw className="w-4 h-4 mr-1" /> Discard
                </Button>
                {hasConfig && (
                  <Button variant="outline" size="sm" onClick={handleDelete}>
                    <Trash2 className="w-4 h-4 mr-1 text-destructive" /> Reset to Empty
                  </Button>
                )}
                <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
                  {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                  Save
                </Button>
              </div>
            </div>
          </Card>

          {editing && (
            <>
              {/* 1. Purpose */}
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-2">1. Slide Purpose</h4>
                <p className="text-xs text-muted-foreground mb-2">What this slide must achieve</p>
                <Textarea
                  value={editing.purpose}
                  onChange={e => update({ purpose: e.target.value })}
                  rows={2}
                  placeholder="e.g. High-level overview that enables a decision-maker to understand context, recommendation, and impact in one page."
                />
              </Card>

              {/* 2. Structure Template */}
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-2">2. Structure Template</h4>
                <p className="text-xs text-muted-foreground mb-2">Define the sections that must appear on this slide</p>
                <div className="space-y-1.5">
                  {editing.structure.sections.map((section, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-5 text-right">{idx + 1}.</span>
                      <Input
                        value={section}
                        onChange={e => updateSection(idx, e.target.value)}
                        className="h-8 text-sm flex-1"
                        placeholder="Section name"
                      />
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => removeSection(idx)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="mt-2" onClick={addSection}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Section
                </Button>
              </Card>

              {/* 3. Content Rules */}
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-2">3. Content Rules</h4>
                <p className="text-xs text-muted-foreground mb-2">Guidelines for Claude when generating content for this slide</p>
                <Textarea
                  value={editing.rules}
                  onChange={e => update({ rules: e.target.value })}
                  rows={5}
                  placeholder="- Must include top 3 priorities&#10;- Must be quantified&#10;- No generic consulting language&#10;- Each bullet must start with a verb or number"
                />
              </Card>

              {/* 4. Column Logic */}
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-2">4. Column Logic</h4>
                <p className="text-xs text-muted-foreground mb-2">How content maps into 3 columns on the slide</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Column 1</label>
                    <Input
                      value={editing.columns.column_1 || ""}
                      onChange={e => update({ columns: { ...editing.columns, column_1: e.target.value } })}
                      className="h-8 text-sm"
                      placeholder="e.g. Context / problem"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Column 2</label>
                    <Input
                      value={editing.columns.column_2 || ""}
                      onChange={e => update({ columns: { ...editing.columns, column_2: e.target.value } })}
                      className="h-8 text-sm"
                      placeholder="e.g. Recommendation / approach"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Column 3</label>
                    <Input
                      value={editing.columns.column_3 || ""}
                      onChange={e => update({ columns: { ...editing.columns, column_3: e.target.value } })}
                      className="h-8 text-sm"
                      placeholder="e.g. Impact / value"
                    />
                  </div>
                </div>
              </Card>

              {/* 5. Project Type Variations */}
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-2">5. Project Type Variations</h4>
                <p className="text-xs text-muted-foreground mb-2">Override guidance for specific project types (leave empty for default)</p>
                <div className="space-y-2">
                  {PROJECT_TYPES.map(pt => (
                    <div key={pt} className="flex items-start gap-2">
                      <label className="text-xs text-muted-foreground w-40 pt-2 shrink-0 text-right">{pt}</label>
                      <Textarea
                        value={editing.variations[pt] || ""}
                        onChange={e => updateVariation(pt, e.target.value)}
                        rows={1}
                        className="text-sm flex-1 min-h-[36px]"
                        placeholder="Override guidance for this type..."
                      />
                    </div>
                  ))}
                </div>
              </Card>

              {/* 6. Examples */}
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-2">6. Examples & Best Practices</h4>
                <p className="text-xs text-muted-foreground mb-2">Example bullets or phrasing to guide content quality</p>
                <div className="space-y-1.5">
                  {editing.examples.map((ex, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <Textarea
                        value={ex}
                        onChange={e => updateExample(idx, e.target.value)}
                        rows={1}
                        className="text-sm flex-1 min-h-[36px]"
                        placeholder="Example bullet or best practice phrasing"
                      />
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 mt-0.5" onClick={() => removeExample(idx)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="mt-2" onClick={addExample}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Example
                </Button>
              </Card>

              {/* 7. Template Settings */}
              <Card className="p-4">
                <h4 className="text-sm font-semibold mb-2">7. Template Settings</h4>
                <div className="flex items-center gap-6">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Default Format</label>
                    <select
                      className="flex h-8 w-24 rounded-md border border-input bg-background px-2 py-1 text-sm"
                      value={editing.format}
                      onChange={e => update({ format: e.target.value })}
                    >
                      <option value="A">Format A</option>
                      <option value="B">Format B</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Insight Bar</label>
                    <button
                      className={`flex items-center gap-2 h-8 px-3 rounded-md border text-sm transition-colors ${
                        editing.insight_bar ? "bg-primary text-primary-foreground border-primary" : "bg-background border-input"
                      }`}
                      onClick={() => update({ insight_bar: editing.insight_bar ? 0 : 1 })}
                    >
                      {editing.insight_bar ? <Check className="w-3.5 h-3.5" /> : null}
                      {editing.insight_bar ? "Enabled" : "Disabled"}
                    </button>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
