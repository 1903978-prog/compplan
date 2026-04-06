import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/PageHeader";
import { Save, RotateCcw, Check, FileText, ChevronRight, Loader2, Trash2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MASTER_SLIDES, PROJECT_TYPES } from "@/lib/proposalSlides";

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

export default function SlideMethodologyAdmin() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<Record<string, SlideConfig>>({});
  const [selectedSlide, setSelectedSlide] = useState<string>(MASTER_SLIDES[0].slide_id);
  const [editing, setEditing] = useState<SlideConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { loadConfigs(); }, []);

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
  );
}
