// ── SlideTemplateEditor.tsx ──────────────────────────────────────────────
// Visual drag-to-position editor for JSON slide template specs.
//
// Goal: replace the "Canva PNG + free-gen Claude HTML" approach (Path 1)
// with a deterministic renderer. The user uploads a background image,
// drags rectangles over it to mark where each piece of content goes,
// names each rectangle ("company_name", "date", etc.), and configures
// font/size/color per rectangle. The spec is saved as JSON; at render
// time, the app fills the named slots with proposal values — same output
// every time, byte-for-byte.
//
// Proof-of-concept scope: only the Cover slide (slide_id="cover"). Once
// the UX is approved, we'll generalize the route to /proposals/templates/:slideId.
//
// Canvas units: 1920×1080. Editor viewport: 960×540 (half scale). All
// mouse events convert viewport pixels → canvas units before persisting,
// so the spec is resolution-independent and the same JSON can be rendered
// at any size via the shared renderSlideFromSpec() helper.
//
// Interactions:
//   - Empty area → click+drag → creates a new region
//   - Region body → drag → moves the region
//   - Region corner handle (bottom-right) → drag → resizes
//   - Click a region → selects it (shows properties in right panel)
//   - Delete key → removes the selected region

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Upload, Save, Trash2, Plus, Eye, EyeOff } from "lucide-react";
import { MASTER_SLIDES } from "@/lib/proposalSlides";
import {
  renderSlideFromSpec,
  SLIDE_RENDER_W,
  SLIDE_RENDER_H,
} from "@shared/slideTemplateRenderer";
import type { SlideTemplateSpec, SlideTemplateRegion } from "@shared/schema";

// ── Constants ─────────────────────────────────────────────────────────────
const CANVAS_W = 1920;
const CANVAS_H = 1080;
const EDITOR_SCALE = SLIDE_RENDER_W / CANVAS_W; // 0.5
const MIN_REGION_SIZE = 20; // canvas units

// Convert a viewport pixel coordinate (relative to the editor surface)
// into canvas units (the 1920×1080 system).
function pxToCanvas(px: number): number {
  return Math.round(px / EDITOR_SCALE);
}

// Convert canvas units back into viewport pixels for rendering the
// region rectangle overlays at the correct position/size.
function canvasToPx(cu: number): number {
  return Math.round(cu * EDITOR_SCALE);
}

function makeRegionId(): string {
  return `r_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

// Default region created by a fresh drag. The user can then tweak font,
// color, etc. in the properties panel.
function defaultRegion(x: number, y: number, w: number, h: number): SlideTemplateRegion {
  return {
    id: makeRegionId(),
    key: "new_field",
    type: "text",
    x, y, w, h,
    font: "Inter",
    size: 48,
    weight: 600,
    color: "#1A6571",
    align: "left",
    valign: "middle",
    line_height: 1.2,
    letter_spacing: 0,
    italic: false,
    placeholder: "Edit me",
    default_text: "",
  };
}

// Seed spec for a brand-new Cover template — the user then uploads a
// background PNG and adjusts the default regions (or deletes them and
// draws their own).
function defaultCoverSpec(): SlideTemplateSpec {
  return {
    canvas: { width: CANVAS_W, height: CANVAS_H },
    background: null,
    regions: [
      {
        ...defaultRegion(120, 640, 1600, 120),
        key: "company_name",
        size: 72,
        weight: 700,
        color: "#1A6571",
        placeholder: "Company Name",
      },
      {
        ...defaultRegion(120, 780, 1200, 50),
        key: "proposal_title",
        size: 32,
        weight: 400,
        color: "#333333",
        placeholder: "Proposal title",
      },
      {
        ...defaultRegion(120, 860, 800, 36),
        key: "proposal_date",
        size: 22,
        weight: 400,
        color: "#666666",
        italic: true,
        placeholder: "Month Year",
      },
    ],
  };
}

// Which field of a region is being dragged via mouse.
type DragMode =
  | { kind: "none" }
  | { kind: "creating"; startX: number; startY: number; curX: number; curY: number }
  | { kind: "moving"; regionId: string; offsetX: number; offsetY: number }
  | { kind: "resizing"; regionId: string };

// Read a File as a base64 data URL (for the background uploader).
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function SlideTemplateEditor() {
  const { toast } = useToast();
  const params = useParams<{ slideId: string }>();
  const slideId = params.slideId || "cover";
  const slideMeta = MASTER_SLIDES.find(s => s.slide_id === slideId);

  const [spec, setSpec] = useState<SlideTemplateSpec>(defaultCoverSpec());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragMode>({ kind: "none" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [testValues, setTestValues] = useState<Record<string, string>>({
    company_name: "Acme Corporation",
    proposal_title: "Commercial Excellence Transformation",
    proposal_date: "April 2026",
  });

  const surfaceRef = useRef<HTMLDivElement>(null);

  // ── Load existing spec on mount ───────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/slide-templates/${slideId}`, { credentials: "include" });
        if (r.status === 404) {
          // No template yet — leave the defaultCoverSpec in place so the
          // user has something to drag around immediately.
          setLoading(false);
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const row = await r.json();
        if (row?.spec) setSpec(row.spec as SlideTemplateSpec);
      } catch (err: any) {
        toast({ title: "Failed to load template", description: err.message, variant: "destructive" });
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideId]);

  // ── Delete key removes selected region ───────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        // Don't hijack Delete while the user is typing in an input.
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        setSpec(prev => ({ ...prev, regions: prev.regions.filter(r => r.id !== selectedId) }));
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  // ── Mouse handlers on the editor surface ──────────────────────────────
  // Any mouse event on the surface measures relative to the surface's
  // bounding rect so it works regardless of page scroll or zoom.
  function surfaceRelative(e: React.MouseEvent | MouseEvent): { x: number; y: number } {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(SLIDE_RENDER_W, e.clientX - rect.left)),
      y: Math.max(0, Math.min(SLIDE_RENDER_H, e.clientY - rect.top)),
    };
  }

  function onSurfaceMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    // If the click hit a region div or a resize handle, those handlers
    // already called stopPropagation — we only get here on empty canvas.
    const { x, y } = surfaceRelative(e);
    setSelectedId(null);
    setDrag({ kind: "creating", startX: x, startY: y, curX: x, curY: y });
  }

  function onRegionMouseDown(e: React.MouseEvent, region: SlideTemplateRegion) {
    e.stopPropagation();
    if (e.button !== 0) return;
    setSelectedId(region.id);
    const { x, y } = surfaceRelative(e);
    setDrag({
      kind: "moving",
      regionId: region.id,
      offsetX: x - canvasToPx(region.x),
      offsetY: y - canvasToPx(region.y),
    });
  }

  function onHandleMouseDown(e: React.MouseEvent, region: SlideTemplateRegion) {
    e.stopPropagation();
    if (e.button !== 0) return;
    setSelectedId(region.id);
    setDrag({ kind: "resizing", regionId: region.id });
  }

  // Global mousemove / mouseup while dragging. Attaching to window means
  // the drag keeps working even if the cursor briefly leaves the surface.
  useEffect(() => {
    if (drag.kind === "none") return;

    function onMove(e: MouseEvent) {
      const { x, y } = surfaceRelative(e);
      if (drag.kind === "creating") {
        setDrag({ ...drag, curX: x, curY: y });
      } else if (drag.kind === "moving") {
        const nx = pxToCanvas(x - drag.offsetX);
        const ny = pxToCanvas(y - drag.offsetY);
        setSpec(prev => ({
          ...prev,
          regions: prev.regions.map(r =>
            r.id === drag.regionId
              ? {
                  ...r,
                  x: Math.max(0, Math.min(CANVAS_W - r.w, nx)),
                  y: Math.max(0, Math.min(CANVAS_H - r.h, ny)),
                }
              : r
          ),
        }));
      } else if (drag.kind === "resizing") {
        setSpec(prev => ({
          ...prev,
          regions: prev.regions.map(r => {
            if (r.id !== drag.regionId) return r;
            const rightCU = pxToCanvas(x);
            const bottomCU = pxToCanvas(y);
            return {
              ...r,
              w: Math.max(MIN_REGION_SIZE, Math.min(CANVAS_W - r.x, rightCU - r.x)),
              h: Math.max(MIN_REGION_SIZE, Math.min(CANVAS_H - r.y, bottomCU - r.y)),
            };
          }),
        }));
      }
    }

    function onUp() {
      if (drag.kind === "creating") {
        const x0 = Math.min(drag.startX, drag.curX);
        const y0 = Math.min(drag.startY, drag.curY);
        const w = Math.abs(drag.curX - drag.startX);
        const h = Math.abs(drag.curY - drag.startY);
        if (w > 10 && h > 10) {
          const newRegion = defaultRegion(
            pxToCanvas(x0),
            pxToCanvas(y0),
            pxToCanvas(w),
            pxToCanvas(h),
          );
          setSpec(prev => ({ ...prev, regions: [...prev.regions, newRegion] }));
          setSelectedId(newRegion.id);
        }
      }
      setDrag({ kind: "none" });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag]);

  // ── Background upload ─────────────────────────────────────────────────
  async function onBackgroundChosen(file: File) {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Not an image", description: "Upload a PNG, JPG, or WEBP.", variant: "destructive" });
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setSpec(prev => ({ ...prev, background: dataUrl }));
      toast({ title: "Background loaded (not yet saved)" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
  }

  // ── Save spec ─────────────────────────────────────────────────────────
  async function saveSpec() {
    setSaving(true);
    try {
      const r = await fetch(`/api/slide-templates/${slideId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }));
        throw new Error(err.message);
      }
      toast({ title: "Template saved" });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  }

  // ── Region mutation helpers ──────────────────────────────────────────
  function updateSelected(patch: Partial<SlideTemplateRegion>) {
    if (!selectedId) return;
    setSpec(prev => ({
      ...prev,
      regions: prev.regions.map(r => (r.id === selectedId ? { ...r, ...patch } : r)),
    }));
  }

  function deleteSelected() {
    if (!selectedId) return;
    setSpec(prev => ({ ...prev, regions: prev.regions.filter(r => r.id !== selectedId) }));
    setSelectedId(null);
  }

  const selected = spec.regions.find(r => r.id === selectedId) || null;

  // Live preview HTML — rebuilt every render via the shared deterministic
  // renderer. Uses `testValues` (editable at the bottom of the right panel)
  // so the user can see how real content flows into the template.
  const previewHtml = useMemo(() => renderSlideFromSpec(spec, testValues), [spec, testValues]);

  // Creating-drag preview rectangle
  const creatingRect = drag.kind === "creating" ? {
    left: Math.min(drag.startX, drag.curX),
    top: Math.min(drag.startY, drag.curY),
    width: Math.abs(drag.curX - drag.startX),
    height: Math.abs(drag.curY - drag.startY),
  } : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Slide Template: {slideMeta?.title || slideId}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Drag rectangles over the background to mark where text goes. Give each one
            a <code className="px-1 bg-muted rounded">key</code> (like{" "}
            <code className="px-1 bg-muted rounded">company_name</code>) and the
            renderer will fill that slot with proposal data at generation time.
            Same spec = same output every time.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => setShowPreview(p => !p)}>
            {showPreview ? <EyeOff className="w-4 h-4 mr-1.5" /> : <Eye className="w-4 h-4 mr-1.5" />}
            {showPreview ? "Hide preview" : "Show preview"}
          </Button>
          <Button onClick={saveSpec} disabled={saving}>
            <Save className="w-4 h-4 mr-1.5" />
            {saving ? "Saving…" : "Save template"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading template…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[auto_340px] gap-4">
          {/* ── Editor surface ──────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    e.currentTarget.value = "";
                    if (f) onBackgroundChosen(f);
                  }}
                />
                <Button variant="outline" size="sm" asChild>
                  <span className="cursor-pointer">
                    <Upload className="w-4 h-4 mr-1.5" />
                    {spec.background ? "Replace background" : "Upload background"}
                  </span>
                </Button>
              </label>
              {spec.background && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSpec(prev => ({ ...prev, background: null }))}
                >
                  <Trash2 className="w-4 h-4 mr-1.5 text-red-600" />
                  Clear bg
                </Button>
              )}
              <div className="ml-auto text-xs text-muted-foreground">
                {spec.regions.length} region{spec.regions.length === 1 ? "" : "s"}
              </div>
            </div>

            {/* Canvas + overlays */}
            <div
              ref={surfaceRef}
              className="relative border-2 border-dashed border-muted-foreground/30 select-none cursor-crosshair"
              style={{
                width: SLIDE_RENDER_W,
                height: SLIDE_RENDER_H,
                backgroundColor: "#fff",
                backgroundImage: spec.background ? `url(${spec.background})` : "none",
                backgroundSize: `${SLIDE_RENDER_W}px ${SLIDE_RENDER_H}px`,
                backgroundRepeat: "no-repeat",
              }}
              onMouseDown={onSurfaceMouseDown}
            >
              {spec.regions.map(r => {
                const isSelected = r.id === selectedId;
                return (
                  <div
                    key={r.id}
                    onMouseDown={e => onRegionMouseDown(e, r)}
                    className={`absolute border-2 ${isSelected ? "border-sky-500 bg-sky-500/10" : "border-sky-400/60 bg-sky-400/5 hover:bg-sky-400/10"}`}
                    style={{
                      left: canvasToPx(r.x),
                      top: canvasToPx(r.y),
                      width: canvasToPx(r.w),
                      height: canvasToPx(r.h),
                      cursor: "move",
                    }}
                  >
                    <div className="absolute top-0 left-0 bg-sky-500 text-white text-[10px] font-mono px-1 leading-tight">
                      {r.key}
                    </div>
                    {isSelected && (
                      <div
                        onMouseDown={e => onHandleMouseDown(e, r)}
                        className="absolute bottom-0 right-0 w-3 h-3 bg-sky-500 cursor-se-resize"
                      />
                    )}
                  </div>
                );
              })}
              {creatingRect && (
                <div
                  className="absolute border-2 border-dashed border-sky-500 bg-sky-500/10 pointer-events-none"
                  style={creatingRect}
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Drag on empty canvas to create a region · drag a region to move · drag its
              bottom-right corner to resize · Delete key removes the selected region
            </p>

            {/* Live deterministic preview */}
            {showPreview && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Live preview (deterministic render)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className="border"
                    style={{ width: SLIDE_RENDER_W, height: SLIDE_RENDER_H }}
                    // This is the actual shared renderer output — same HTML
                    // the server will emit for the final slide.
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Right panel: region list + properties + test values ── */}
          <div className="space-y-3">
            <Card>
              <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Regions</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Add a region at the center"
                  onClick={() => {
                    const r = defaultRegion(760, 500, 400, 80);
                    setSpec(prev => ({ ...prev, regions: [...prev.regions, r] }));
                    setSelectedId(r.id);
                  }}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </CardHeader>
              <CardContent className="space-y-1 max-h-[220px] overflow-auto">
                {spec.regions.length === 0 && (
                  <div className="text-xs text-muted-foreground">No regions yet — drag on the canvas to create one.</div>
                )}
                {spec.regions.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left px-2 py-1 rounded text-xs font-mono ${r.id === selectedId ? "bg-sky-100 text-sky-900" : "hover:bg-muted"}`}
                  >
                    {r.key}
                    <span className="text-muted-foreground ml-2">
                      {r.x},{r.y} · {r.w}×{r.h}
                    </span>
                  </button>
                ))}
              </CardContent>
            </Card>

            {selected ? (
              <Card>
                <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-sm">Properties</CardTitle>
                  <Button variant="ghost" size="sm" onClick={deleteSelected} title="Delete region">
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Key (slot name)</Label>
                    <Input
                      value={selected.key}
                      onChange={e => updateSelected({ key: e.target.value.replace(/\s+/g, "_") })}
                      className="h-8 font-mono text-xs"
                    />
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <Label className="text-xs">X</Label>
                      <Input type="number" value={selected.x}
                        onChange={e => updateSelected({ x: Number(e.target.value) || 0 })}
                        className="h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs">Y</Label>
                      <Input type="number" value={selected.y}
                        onChange={e => updateSelected({ y: Number(e.target.value) || 0 })}
                        className="h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs">W</Label>
                      <Input type="number" value={selected.w}
                        onChange={e => updateSelected({ w: Number(e.target.value) || 0 })}
                        className="h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs">H</Label>
                      <Input type="number" value={selected.h}
                        onChange={e => updateSelected({ h: Number(e.target.value) || 0 })}
                        className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Font size</Label>
                      <Input type="number" value={selected.size}
                        onChange={e => updateSelected({ size: Number(e.target.value) || 12 })}
                        className="h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs">Weight</Label>
                      <Input type="number" value={selected.weight} step={100}
                        onChange={e => updateSelected({ weight: Number(e.target.value) || 400 })}
                        className="h-8 text-xs" />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Color</Label>
                    <div className="flex gap-2">
                      <input type="color" value={selected.color}
                        onChange={e => updateSelected({ color: e.target.value })}
                        className="h-8 w-12 border rounded" />
                      <Input value={selected.color}
                        onChange={e => updateSelected({ color: e.target.value })}
                        className="h-8 text-xs font-mono" />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Font family</Label>
                    <Input value={selected.font}
                      onChange={e => updateSelected({ font: e.target.value })}
                      className="h-8 text-xs" />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Align H</Label>
                      <select
                        value={selected.align}
                        onChange={e => updateSelected({ align: e.target.value as any })}
                        className="h-8 w-full border rounded text-xs px-2"
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Align V</Label>
                      <select
                        value={selected.valign}
                        onChange={e => updateSelected({ valign: e.target.value as any })}
                        className="h-8 w-full border rounded text-xs px-2"
                      >
                        <option value="top">Top</option>
                        <option value="middle">Middle</option>
                        <option value="bottom">Bottom</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="italic"
                      checked={selected.italic}
                      onChange={e => updateSelected({ italic: e.target.checked })}
                    />
                    <Label htmlFor="italic" className="text-xs cursor-pointer">Italic</Label>
                  </div>

                  <div>
                    <Label className="text-xs">Placeholder (shown when value is empty)</Label>
                    <Input value={selected.placeholder}
                      onChange={e => updateSelected({ placeholder: e.target.value })}
                      className="h-8 text-xs" />
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-6 text-center text-xs text-muted-foreground">
                  Click a region to edit its properties
                </CardContent>
              </Card>
            )}

            {/* Test values — drive the live preview */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Test values</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  These fill the slots in the live preview only — not saved with the template.
                </p>
                {Array.from(new Set(spec.regions.map(r => r.key))).map(key => (
                  <div key={key}>
                    <Label className="text-[11px] font-mono">{key}</Label>
                    <Textarea
                      rows={1}
                      value={testValues[key] || ""}
                      onChange={e => setTestValues(prev => ({ ...prev, [key]: e.target.value }))}
                      className="text-xs min-h-[32px]"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
