// ── SlideBackgroundsAdmin.tsx ────────────────────────────────────────────
// Per-slide PNG background uploader.
//
// Purpose: let the user export each page of their Canva template (or any
// other template) as a PNG and upload it against the matching CompPlan
// slide_id. Once uploaded, the server /generate-page and /refine-page
// routes bake the PNG into the outer div as a CSS background-image, so
// the HTML preview — and the Playwright pixel-perfect export — inherit
// the template look while the text on top stays editable.
//
// There is ONE row per slide_id in MASTER_SLIDES. Uploading re-upserts.
// Deleting removes the override so the slide renders on a white background.
//
// No OAuth here, no Canva API calls, no auto-sync. That's Path 2 —
// this page is Path 1 ("export PNGs manually, upload them once").
//
// The list pulls metadata only (/api/slide-backgrounds GET omits file_data)
// so it stays snappy even with 33 × multi-megabyte PNGs.

import { useEffect, useState } from "react";
import { MASTER_SLIDES } from "@/lib/proposalSlides";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Upload, Trash2, Eye, Image as ImageIcon, ExternalLink } from "lucide-react";

interface BackgroundMeta {
  slide_id: string;
  file_size: number;
  source: string | null;
  source_ref: string | null;
  updated_at: string;
  has_data: boolean;
}

// Read a File object as a data URL (data:image/png;base64,...).
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatKB(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function SlideBackgroundsAdmin() {
  const { toast } = useToast();
  const [metas, setMetas] = useState<Record<string, BackgroundMeta>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const r = await fetch("/api/slide-backgrounds", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows: BackgroundMeta[] = await r.json();
      const map: Record<string, BackgroundMeta> = {};
      for (const row of rows) map[row.slide_id] = row;
      setMetas(map);
    } catch (err: any) {
      toast({ title: "Failed to load backgrounds", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  async function uploadFor(slideId: string, file: File) {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Not an image", description: "Please upload a PNG, JPG, or WEBP file.", variant: "destructive" });
      return;
    }
    setUploading(slideId);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const r = await fetch(`/api/slide-backgrounds/${slideId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_data: dataUrl,
          file_size: file.size,
          source: "upload",
          source_ref: file.name,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }));
        throw new Error(err.message);
      }
      const meta: BackgroundMeta = await r.json();
      setMetas(prev => ({ ...prev, [slideId]: meta }));
      toast({ title: `Background saved for ${slideId}` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setUploading(null);
  }

  async function deleteFor(slideId: string) {
    if (!window.confirm(`Remove the background for "${slideId}"? The slide will render on a plain white background again.`)) return;
    try {
      const r = await fetch(`/api/slide-backgrounds/${slideId}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMetas(prev => {
        const next = { ...prev };
        delete next[slideId];
        return next;
      });
      toast({ title: `Background removed for ${slideId}` });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  }

  async function openPreview(slideId: string) {
    setPreviewFor(slideId);
    setPreviewUrl(null);
    try {
      const r = await fetch(`/api/slide-backgrounds/${slideId}`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const row = await r.json();
      setPreviewUrl(row.file_data);
    } catch (err: any) {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
      setPreviewFor(null);
    }
  }

  const totalUploaded = Object.keys(metas).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Slide Backgrounds</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Upload one PNG per slide to use as the visual frame. Generated previews and the
            pixel-perfect PPTX export will render all text on top of these backgrounds,
            so the deck inherits your Canva (or any) template look while the content stays editable.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            <strong>{totalUploaded}</strong> of <strong>{MASTER_SLIDES.length}</strong> slides have a background uploaded.
          </p>
        </div>
        <a
          href="https://www.canva.com/design/DAHG6-uN2l4/xxItMYnwaY4yZlsIMc2fbg/edit"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap"
        >
          <ExternalLink className="w-3 h-3" />
          Open Canva template
        </a>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How to use</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. Open your Canva template and, for each page you want to reuse, click <em>Share → Download → PNG</em>.</p>
          <p>2. Use the full slide size (16:9 — Canva&apos;s default "Presentation" document is already correct).</p>
          <p>3. Upload each PNG against the matching Command Center slide row below. The <code>slide_id</code> on the left is how the server matches it.</p>
          <p>4. When you generate or refine a slide in Proposals, the PNG is baked into the HTML outer div as a CSS background-image. The Playwright PPTX export inherits it automatically — no extra config.</p>
          <p className="text-xs italic">Note: Claude is told <em>not</em> to repaint the background or add the &quot;eendigo&quot; footer when a background is present, so your template stays clean.</p>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading backgrounds…</div>
      ) : (
        <div className="space-y-6">
          {["core", "optional"].map(group => {
            const slides = MASTER_SLIDES.filter(s => s.group === group);
            return (
              <div key={group}>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  {group === "core" ? "Core slides" : "Optional slides"}
                </h2>
                <div className="border rounded-lg divide-y">
                  {slides.map(slide => {
                    const meta = metas[slide.slide_id];
                    const isUploading = uploading === slide.slide_id;
                    return (
                      <div key={slide.slide_id} className="flex items-center gap-4 p-3 hover:bg-accent/30 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">{slide.slide_id}</code>
                            <span className="text-sm font-medium truncate">{slide.title}</span>
                            {meta ? (
                              <span className="text-[10px] font-medium bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                                UPLOADED
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                                NO BACKGROUND
                              </span>
                            )}
                          </div>
                          {meta && (
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {formatKB(meta.file_size)}
                              {meta.source_ref ? ` · ${meta.source_ref}` : ""}
                              {" · updated "}
                              {new Date(meta.updated_at).toLocaleString()}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {meta && (
                            <Button variant="ghost" size="sm" onClick={() => openPreview(slide.slide_id)} title="Preview">
                              <Eye className="w-4 h-4" />
                            </Button>
                          )}
                          <label>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={e => {
                                const f = e.target.files?.[0];
                                e.currentTarget.value = "";
                                if (f) uploadFor(slide.slide_id, f);
                              }}
                            />
                            <Button
                              variant={meta ? "outline" : "default"}
                              size="sm"
                              asChild
                              disabled={isUploading}
                            >
                              <span className="cursor-pointer">
                                <Upload className="w-4 h-4 mr-1.5" />
                                {isUploading ? "Uploading…" : meta ? "Replace" : "Upload PNG"}
                              </span>
                            </Button>
                          </label>
                          {meta && (
                            <Button variant="ghost" size="sm" onClick={() => deleteFor(slide.slide_id)} title="Delete background">
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewFor && (
        <div
          className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-8"
          onClick={() => { setPreviewFor(null); setPreviewUrl(null); }}
        >
          <div className="bg-white rounded-lg p-4 max-w-[1000px] max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-sm">{previewFor}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setPreviewFor(null); setPreviewUrl(null); }}>Close</Button>
            </div>
            {previewUrl ? (
              <img src={previewUrl} alt={previewFor} className="max-w-full h-auto border rounded" style={{ width: 960, maxWidth: "100%" }} />
            ) : (
              <div className="text-muted-foreground text-sm p-8 text-center">Loading…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
