import { useState, useEffect, useCallback, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Plus, Trash2, ArrowRight, ArrowLeft, Loader2, Download, Pencil, Eye,
  FileText, Upload, Check, X, Sparkles, GripVertical, ChevronUp, ChevronDown,
  RotateCcw, AlertTriangle, Info, ChevronRight, BookOpen, MessageSquare,
  Settings2, Image as ImageIcon, ClipboardPaste, Cpu, HelpCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  MASTER_SLIDES, PROJECT_TYPES, type ProjectType, type SlideSelectionEntry,
  getDefaultSlideSelection, getSlideCountStatus, SLIDE_COUNT,
} from "@/lib/proposalSlides";

// ── Types ────────────────────────────────────────────────────────────────────

interface SlideBriefField { key: string; label: string; value: string }
interface SlideBrief {
  slide_id: string;
  title: string;
  purpose: string;
  content_structure: SlideBriefField[];
  notes: string;
}

interface TeamMember { role: string; count: number; days_per_week: number }
interface PriceBreakdown { role: string; count: number; daily_rate: number; days: number; total: number }
interface ProposalOption {
  name: string;
  duration_weeks: number;
  staffing_mode: string;
  team: TeamMember[];
  scope: string[];
  deliverables: string[];
  cadence: string;
  assumptions: string[];
  price_breakdown: PriceBreakdown[];
  total_fee: number;
}

interface CallChecklistItem {
  question: string;
  checked: boolean;
}

interface Proposal {
  id?: number;
  company_name: string;
  website?: string | null;
  transcript?: string | null;
  notes?: string | null;
  revenue?: number | null;
  ebitda_margin?: number | null;
  scope_perimeter?: string | null;
  objective?: string | null;
  urgency?: string | null;
  company_summary?: string | null;
  proposal_title?: string | null;
  why_now?: string | null;
  objective_statement?: string | null;
  scope_statement?: string | null;
  recommended_team?: string | null;
  staffing_intensity?: string | null;
  project_type?: string | null;
  slide_selection: SlideSelectionEntry[];
  slide_briefs: SlideBrief[];
  options: ProposalOption[];
  call_checklist?: CallChecklistItem[];
  ai_analysis?: any;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Template {
  id: number;
  name: string;
  file_size: number;
  is_active: number;
  uploaded_at: string;
}

function formatCurrency(val: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(val);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const URGENCY_OPTIONS = ["Low", "Medium", "High", "Critical"];

const DEFAULT_CALL_QUESTIONS: string[] = [
  "What decision are you trying to make or what problem are you trying to solve now?",
  "Why does this project matter now? What are the top 3\u20135 structural challenges or performance gaps today? What is the quantified value at stake if nothing changes (revenue opportunity, margin gap, cost leakage, etc.)?",
  "What are the 2\u20133 biggest pain points or value levers you want to address?",
  "What are sources of revenue growth: new clients, cross sell or share of wallet or pricing?",
  "What outcomes would define success in 12\u201318 months?",
  "Revenues, EBITDA, sales org. size",
  "What has already been tried, and why has it not solved the issue?",
  "What measurable business outcomes and KPIs matter most? Do you have any target ranges or assumptions on value creation?",
  "What scope do you want help on: diagnostic, design, implementation, or execution support?",
  "Which business units, geographies, products, channels, or customer segments are in scope?",
  "Who are the decision makers, sponsors, and day-to-day owners on the client side?",
  "Proposed Approach \u2014 From your perspective, what is the overall logic or architecture needed to solve this? Are there any specific workstreams or value drivers you already see as critical?",
  "When is ideal start date? What timing matters \u2014 key deadlines, board dates, budget cycle, or transformation milestones?",
  "What budget range or investment logic should we design the proposal around?",
  "What is your ideal project duration and key milestones? Are you open to different scope/intensity options (light vs full, phased, etc.)?",
];

const WIZARD_STEPS = [
  { n: 1, label: "Input" },
  { n: 2, label: "Slides" },
  { n: 3, label: "Briefing" },
  { n: 4, label: "Analysis" },
  { n: 5, label: "Architecture" },
  { n: 6, label: "Generate" },
];

// ── Main Component ────────────────────────────────────────────────────────────

export default function Proposals() {
  const { toast } = useToast();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [view, setView] = useState<"list" | "wizard">("list");
  const [step, setStep] = useState(1);
  const [current, setCurrent] = useState<Proposal | null>(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Template state
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  // Form state for step 1
  const [form, setForm] = useState({
    company_name: "",
    website: "",
    transcript: "",
    notes: "",
    revenue: "",
    ebitda_margin: "",
    scope_perimeter: "",
    objective: "",
    urgency: "Medium",
  });

  // Step 2: Slide selection state
  const [projectType, setProjectType] = useState<ProjectType | "">(""  );
  const [slides, setSlides] = useState<SlideSelectionEntry[]>([]);
  const [hasManualEdits, setHasManualEdits] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [pendingProjectType, setPendingProjectType] = useState<ProjectType | null>(null);
  // Step 1: Call checklist state
  const [callChecklist, setCallChecklist] = useState<CallChecklistItem[]>(
    DEFAULT_CALL_QUESTIONS.map(q => ({ question: q, checked: false }))
  );
  const [editingQuestion, setEditingQuestion] = useState<number | null>(null);

  // Step 3: Slide briefing state
  const [briefs, setBriefs] = useState<SlideBrief[]>([]);
  const [generatingBriefs, setGeneratingBriefs] = useState(false);
  const [expandedBrief, setExpandedBrief] = useState<string | null>(null);
  const [briefProgress, setBriefProgress] = useState(0); // % of briefs reviewed
  const [briefMode, setBriefMode] = useState<"choose" | "generating" | "editing">("choose");
  const [showManualPaste, setShowManualPaste] = useState(false);
  const [manualPasteText, setManualPasteText] = useState("");
  const [parsingManual, setParsingManual] = useState(false);
  // Template popup state
  const [templatePopup, setTemplatePopup] = useState<string | null>(null); // slide_id
  const [templateData, setTemplateData] = useState<any>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  // Guidance image state
  const [guidanceImages, setGuidanceImages] = useState<Record<string, string>>({}); // slide_id → base64

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  useEffect(() => {
    loadProposals();
    loadTemplates();
  }, []);

  async function loadProposals() {
    const res = await fetch("/api/proposals", { credentials: "include" });
    if (res.ok) setProposals(await res.json());
  }

  async function loadTemplates() {
    const res = await fetch("/api/proposal-templates", { credentials: "include" });
    if (res.ok) setTemplates(await res.json());
  }

  function startNew() {
    setForm({ company_name: "", website: "", transcript: "", notes: "", revenue: "", ebitda_margin: "", scope_perimeter: "", objective: "", urgency: "Medium" });
    setCurrent(null);
    setProjectType("");
    setSlides([]);
    setBriefs([]);
    setCallChecklist(DEFAULT_CALL_QUESTIONS.map(q => ({ question: q, checked: false })));
    setEditingQuestion(null);
    setHasManualEdits(false);
    setExpandedBrief(null);
    setBriefMode("choose");
    setManualPasteText("");
    setGuidanceImages({});
    setStep(1);
    setView("wizard");
  }

  function openProposal(p: Proposal) {
    setCurrent(p);
    // Restore slide selection state
    setProjectType((p.project_type as ProjectType) || "");
    setSlides(Array.isArray(p.slide_selection) && p.slide_selection.length > 0 ? p.slide_selection : []);
    setBriefs(Array.isArray(p.slide_briefs) && p.slide_briefs.length > 0 ? p.slide_briefs : []);
    // Restore call checklist
    setCallChecklist(
      Array.isArray(p.call_checklist) && p.call_checklist.length > 0
        ? p.call_checklist
        : DEFAULT_CALL_QUESTIONS.map(q => ({ question: q, checked: false }))
    );
    setEditingQuestion(null);
    setHasManualEdits(false);
    setExpandedBrief(null);
    setBriefMode(Array.isArray(p.slide_briefs) && p.slide_briefs.length > 0 ? "editing" : "choose");

    if (p.status === "draft") {
      setForm({
        company_name: p.company_name,
        website: p.website || "",
        transcript: p.transcript || "",
        notes: p.notes || "",
        revenue: p.revenue ? String(p.revenue) : "",
        ebitda_margin: p.ebitda_margin ? String(p.ebitda_margin) : "",
        scope_perimeter: p.scope_perimeter || "",
        objective: p.objective || "",
        urgency: p.urgency || "Medium",
      });
      setStep(1);
    } else if (p.status === "briefed") {
      setStep(3);
    } else {
      setStep(5);
    }
    setView("wizard");
  }

  async function deleteProposal(id: number) {
    await fetch(`/api/proposals/${id}`, { method: "DELETE", credentials: "include" });
    setProposals(prev => prev.filter(p => p.id !== id));
    toast({ title: "Proposal deleted" });
  }

  // ── Step 1 → Step 2: Save draft ────────────────────────────────────────────

  async function handleGoToSlides() {
    if (!form.company_name.trim()) {
      toast({ title: "Company name is required", variant: "destructive" });
      return;
    }
    // If no slides initialized yet and project type selected, apply learned/hardcoded defaults
    if (slides.length === 0 && projectType) {
      await applyProjectType(projectType);
    }
    setStep(2);
  }

  // ── Step 2: Project type change handling ────────────────────────────────────

  async function applyProjectType(pt: ProjectType) {
    setProjectType(pt);
    // Try to load learned defaults for this project type
    try {
      const res = await fetch(`/api/slide-defaults/${encodeURIComponent(pt)}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const savedIds: string[] = data.slide_ids || [];
        const savedOrder: string[] = data.slide_order || [];
        if (savedIds.length > 0) {
          // We have learned defaults — use them
          const selectedSet = new Set(savedIds);
          // Build slides from saved order, adding any new master slides not yet in the order
          const orderMap = new Map(savedOrder.map((id: string, i: number) => [id, i]));
          const allSlides = MASTER_SLIDES.map((slide) => ({
            slide_id: slide.slide_id,
            title: slide.title,
            is_selected: selectedSet.has(slide.slide_id),
            default_selected: selectedSet.has(slide.slide_id),
            order: orderMap.has(slide.slide_id) ? orderMap.get(slide.slide_id)! : 999,
          }));
          allSlides.sort((a, b) => a.order - b.order);
          setSlides(allSlides.map((s, i) => ({ ...s, order: i })));
          setHasManualEdits(false);
          return;
        }
      }
    } catch { /* fall through to hardcoded defaults */ }
    setSlides(getDefaultSlideSelection(pt));
    setHasManualEdits(false);
  }

  function handleProjectTypeChange(newType: ProjectType) {
    if (!newType) return;
    if (hasManualEdits) {
      setPendingProjectType(newType);
      setShowResetConfirm(true);
    } else {
      applyProjectType(newType);
    }
  }

  function confirmProjectTypeReset() {
    if (pendingProjectType) {
      applyProjectType(pendingProjectType);
    }
    setShowResetConfirm(false);
    setPendingProjectType(null);
  }

  function cancelProjectTypeReset() {
    setShowResetConfirm(false);
    setPendingProjectType(null);
  }

  function toggleSlide(slideId: string) {
    setSlides(prev => prev.map(s => s.slide_id === slideId ? { ...s, is_selected: !s.is_selected } : s));
    setHasManualEdits(true);
  }

  function moveSlide(fromIdx: number, direction: "up" | "down") {
    const toIdx = direction === "up" ? fromIdx - 1 : fromIdx + 1;
    if (toIdx < 0 || toIdx >= slides.length) return;
    setSlides(prev => {
      const next = [...prev];
      [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
      return next.map((s, i) => ({ ...s, order: i }));
    });
    setHasManualEdits(true);
  }

  function handleDragStart(idx: number) {
    dragItem.current = idx;
  }

  function handleDragEnter(idx: number) {
    dragOverItem.current = idx;
  }

  function handleDragEnd() {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const from = dragItem.current;
    const to = dragOverItem.current;
    if (from === to) { dragItem.current = null; dragOverItem.current = null; return; }
    setSlides(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next.map((s, i) => ({ ...s, order: i }));
    });
    setHasManualEdits(true);
    dragItem.current = null;
    dragOverItem.current = null;
  }

  function resetToDefaults() {
    if (projectType) {
      // Reset to hardcoded defaults (not learned) — user can use this to "unlearn"
      setSlides(getDefaultSlideSelection(projectType));
      setHasManualEdits(false);
    }
  }

  // ── Step 2 → Step 3: Save slide selection & generate briefs ─────────────────

  async function handleSubmitSlides() {
    if (!projectType) {
      toast({ title: "Select a project type", variant: "destructive" });
      return;
    }
    const selectedCount = slides.filter(s => s.is_selected).length;
    if (selectedCount === 0) {
      toast({ title: "Select at least one slide", variant: "destructive" });
      return;
    }

    setSaving(true);

    // Save this slide selection as learned defaults for this project type
    const selectedIds = slides.filter(s => s.is_selected).map(s => s.slide_id);
    const slideOrder = slides.map(s => s.slide_id);
    fetch(`/api/slide-defaults/${encodeURIComponent(projectType)}`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slide_ids: selectedIds, slide_order: slideOrder }),
    }).catch(() => {}); // fire-and-forget — don't block the main flow

    const now = new Date().toISOString();
    const body = {
      company_name: form.company_name,
      website: form.website || null,
      transcript: form.transcript || null,
      notes: form.notes || null,
      revenue: form.revenue ? Number(form.revenue) : null,
      ebitda_margin: form.ebitda_margin ? Number(form.ebitda_margin) : null,
      scope_perimeter: form.scope_perimeter || null,
      objective: form.objective || null,
      urgency: form.urgency || null,
      project_type: projectType,
      slide_selection: slides,
      slide_briefs: briefs,
      call_checklist: callChecklist,
      status: "draft",
      options: current?.options || [],
      created_at: current?.created_at || now,
      updated_at: now,
    };

    try {
      let saved: Proposal;
      if (current?.id) {
        const res = await fetch(`/api/proposals/${current.id}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        saved = await res.json();
      } else {
        const res = await fetch("/api/proposals", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        saved = await res.json();
      }
      setCurrent(saved);
      setSaving(false);

      // If briefs already exist (re-entering step 3), go straight to editing
      if (Array.isArray(saved.slide_briefs) && saved.slide_briefs.length > 0) {
        setBriefs(saved.slide_briefs);
        setBriefMode("editing");
        if (saved.slide_briefs.length > 0) setExpandedBrief(saved.slide_briefs[0].slide_id);
      } else {
        setBriefMode("choose");
      }
      setStep(3);
      // Load guidance images for selected slides
      loadGuidanceImages();
      loadProposals();
    } catch (err: any) {
      setSaving(false);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  // Generate briefs via Claude API
  async function generateBriefsWithClaude() {
    if (!current?.id) return;
    setBriefMode("generating");
    setGeneratingBriefs(true);
    try {
      const briefRes = await fetch(`/api/proposals/${current.id}/generate-briefs`, {
        method: "POST", credentials: "include",
      });
      if (!briefRes.ok) throw new Error("Brief generation failed");
      const briefed = await briefRes.json();
      setCurrent(briefed);
      setBriefs(Array.isArray(briefed.slide_briefs) ? briefed.slide_briefs : []);
      setGeneratingBriefs(false);
      setBriefMode("editing");
      if (briefed.slide_briefs?.length > 0) setExpandedBrief(briefed.slide_briefs[0].slide_id);
      loadProposals();
    } catch (err: any) {
      setGeneratingBriefs(false);
      setBriefMode("choose");
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  // Parse pasted manual text into briefs
  async function parseManualBriefs() {
    if (!current?.id || !manualPasteText.trim()) return;
    setParsingManual(true);
    try {
      const res = await fetch(`/api/proposals/${current.id}/parse-manual-briefs`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: manualPasteText }),
      });
      if (!res.ok) throw new Error("Parse failed");
      const parsed = await res.json();
      setCurrent(parsed);
      setBriefs(Array.isArray(parsed.slide_briefs) ? parsed.slide_briefs : []);
      setParsingManual(false);
      setShowManualPaste(false);
      setBriefMode("editing");
      if (parsed.slide_briefs?.length > 0) setExpandedBrief(parsed.slide_briefs[0].slide_id);
      loadProposals();
    } catch (err: any) {
      setParsingManual(false);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  // Load guidance images for slide methodology configs
  async function loadGuidanceImages() {
    try {
      const res = await fetch("/api/slide-methodology", { credentials: "include" });
      if (!res.ok) return;
      const configs = await res.json();
      const images: Record<string, string> = {};
      for (const cfg of configs) {
        if (cfg.guidance_image) images[cfg.slide_id] = cfg.guidance_image;
      }
      setGuidanceImages(images);
    } catch {}
  }

  // Upload guidance image for a slide
  async function uploadGuidanceImage(slideId: string, file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      try {
        await fetch(`/api/slide-methodology/${encodeURIComponent(slideId)}/guidance-image`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64 }),
        });
        setGuidanceImages(prev => ({ ...prev, [slideId]: base64 }));
        toast({ title: "Guidance image saved" });
      } catch {
        toast({ title: "Upload failed", variant: "destructive" });
      }
    };
    reader.readAsDataURL(file);
  }

  // Open template popup for a slide
  async function openTemplatePopup(slideId: string) {
    setTemplatePopup(slideId);
    setTemplateLoading(true);
    try {
      const res = await fetch(`/api/slide-methodology/${encodeURIComponent(slideId)}`, { credentials: "include" });
      if (res.ok) {
        setTemplateData(await res.json());
      } else {
        setTemplateData({ slide_id: slideId, purpose: "", structure: { sections: [] }, rules: "", columns: {}, variations: {}, examples: [], format: "A", insight_bar: 0 });
      }
    } catch {
      setTemplateData(null);
    }
    setTemplateLoading(false);
  }

  // Save template data
  async function saveTemplateData() {
    if (!templateData) return;
    setTemplateSaving(true);
    try {
      await fetch(`/api/slide-methodology/${encodeURIComponent(templateData.slide_id)}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateData),
      });
      toast({ title: "Template saved" });
      setTemplatePopup(null);
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
    setTemplateSaving(false);
  }

  // ── Step 3: Save edited briefs ────────────────────────────────────────────

  function updateBriefField(slideId: string, fieldKey: string, value: string) {
    setBriefs(prev => prev.map(b =>
      b.slide_id === slideId
        ? { ...b, content_structure: b.content_structure.map(f => f.key === fieldKey ? { ...f, value } : f) }
        : b
    ));
  }

  function updateBriefNotes(slideId: string, notes: string) {
    setBriefs(prev => prev.map(b => b.slide_id === slideId ? { ...b, notes } : b));
  }

  async function saveBriefs() {
    if (!current?.id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/proposals/${current.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, slide_briefs: briefs, status: "briefed", updated_at: new Date().toISOString() }),
      });
      const updated = await res.json();
      setCurrent(updated);
      loadProposals();
      toast({ title: "Briefs saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
    setSaving(false);
  }

  // ── Step 3 → Step 4: Submit briefs & trigger AI analysis ──────────────────

  async function handleSubmitBriefs() {
    await saveBriefs();
    // Move to step 4: analyzing
    setStep(4);
    setAnalyzing(true);

    try {
      const analyzeRes = await fetch(`/api/proposals/${current!.id}/analyze`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!analyzeRes.ok) throw new Error("Analysis failed");
      const analyzed = await analyzeRes.json();
      setCurrent(analyzed);
      setAnalyzing(false);
      setStep(5);
      loadProposals();
    } catch (err: any) {
      setAnalyzing(false);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  // ── Step 5: Save edits to proposal ─────────────────────────────────────────

  async function saveEdits() {
    if (!current?.id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/proposals/${current.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, updated_at: new Date().toISOString() }),
      });
      const updated = await res.json();
      setCurrent(updated);
      loadProposals();
      toast({ title: "Proposal saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
    setSaving(false);
  }

  // ── Step 6: Generate deck ──────────────────────────────────────────────────

  async function generateDeck() {
    if (!current?.id) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/proposals/${current.id}/generate-deck`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error("Generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Eendigo_Proposal_${current.company_name.replace(/[^a-zA-Z0-9]/g, "_")}.pptx`;
      a.click();
      URL.revokeObjectURL(url);

      await fetch(`/api/proposals/${current.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, status: "finalized", updated_at: new Date().toISOString() }),
      });
      loadProposals();
      toast({ title: "Deck downloaded!" });
    } catch {
      toast({ title: "Deck generation failed", variant: "destructive" });
    }
    setGenerating(false);
  }

  // ── Template management ────────────────────────────────────────────────────

  async function handleTemplateUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const res = await fetch("/api/proposal-templates", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          file_data: base64,
          file_size: file.size,
          is_active: 0,
          uploaded_at: new Date().toISOString(),
        }),
      });
      if (res.ok) {
        loadTemplates();
        toast({ title: "Template uploaded" });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function activateTemplate(id: number) {
    await fetch(`/api/proposal-templates/${id}/activate`, { method: "POST", credentials: "include" });
    loadTemplates();
    toast({ title: "Template activated" });
  }

  async function deleteTemplate(id: number) {
    await fetch(`/api/proposal-templates/${id}`, { method: "DELETE", credentials: "include" });
    loadTemplates();
  }

  // ── Computed values ────────────────────────────────────────────────────────

  const selectedSlideCount = slides.filter(s => s.is_selected).length;
  const slideCountStatus = getSlideCountStatus(selectedSlideCount);

  // ── Render: Templates ──────────────────────────────────────────────────────

  if (showTemplates) {
    return (
      <div>
        <PageHeader
          title="Proposal Templates"
          description="Manage PowerPoint templates for deck generation"
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowTemplates(false)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <label>
                <Button asChild><span><Upload className="w-4 h-4 mr-1" /> Upload .pptx</span></Button>
                <input type="file" accept=".pptx" className="hidden" onChange={handleTemplateUpload} />
              </label>
            </div>
          }
        />
        <Card className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No templates uploaded yet</TableCell></TableRow>
              )}
              {templates.map(t => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{(t.file_size / 1024).toFixed(0)} KB</TableCell>
                  <TableCell>{formatDate(t.uploaded_at)}</TableCell>
                  <TableCell>
                    {t.is_active ? (
                      <span className="inline-flex items-center gap-1 text-green-600 font-medium"><Check className="w-4 h-4" /> Active</span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => activateTemplate(t.id)}>Set Active</Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => deleteTemplate(t.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    );
  }

  // ── Render: Wizard ─────────────────────────────────────────────────────────

  if (view === "wizard") {
    const stepDescriptions: Record<number, string> = {
      1: "Enter client information",
      2: "Select project type and proposal slides",
      3: "Review and edit slide briefs",
      4: "AI is analyzing...",
      5: "Review and edit proposal architecture",
      6: "Generate and download deck",
    };

    return (
      <div>
        <PageHeader
          title={step === 1 ? "New Proposal" : step === 2 ? "Proposal Structure" : step === 3 ? "Slide Briefing" : current?.proposal_title || `Proposal: ${current?.company_name || ""}`}
          description={stepDescriptions[step]}
          actions={
            <div className="flex items-center gap-2">
              {step > 1 && (
                <Button variant="outline" onClick={() => setStep(step - 1)}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Back to {WIZARD_STEPS.find(s => s.n === step - 1)?.label || "Previous"}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => { setView("list"); setStep(1); }}>
                Back to List
              </Button>
            </div>
          }
        />

        {/* Step indicator — click completed steps to navigate back */}
        <div className="flex items-center gap-2 mb-6">
          {WIZARD_STEPS.map(({ n, label }) => (
            <div key={n} className="flex items-center gap-2">
              <button
                onClick={() => { if (n < step) setStep(n); }}
                disabled={n >= step}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  step === n ? "bg-primary text-primary-foreground" :
                  step > n ? "bg-green-500 text-white hover:bg-green-600 cursor-pointer" :
                  "bg-muted text-muted-foreground"
                }`}
              >
                {step > n ? <Check className="w-4 h-4" /> : n}
              </button>
              <span className={`text-sm ${step === n ? "font-medium" : step > n ? "text-foreground cursor-pointer" : "text-muted-foreground"}`}
                onClick={() => { if (n < step) setStep(n); }}
              >{label}</span>
              {n < WIZARD_STEPS.length && <div className={`w-8 h-0.5 ${step > n ? "bg-green-500" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        {/* ── Step 1: Input Form ─────────────────────────────────────────── */}
        {step === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* ── Left: Input Fields ──────────────────────────────────── */}
            <Card className="lg:col-span-3 p-6">
              <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wide">Proposal Inputs</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Company Name *</label>
                  <Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Acme Corp" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Website</label>
                  <Input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Revenue (EUR M)</label>
                  <Input type="number" value={form.revenue} onChange={e => setForm(f => ({ ...f, revenue: e.target.value }))} placeholder="150" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">EBITDA Margin %</label>
                  <Input type="number" value={form.ebitda_margin} onChange={e => setForm(f => ({ ...f, ebitda_margin: e.target.value }))} placeholder="12" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Objective</label>
                  <Input value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} placeholder="Improve commercial effectiveness..." />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Urgency</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.urgency}
                    onChange={e => setForm(f => ({ ...f, urgency: e.target.value }))}
                  >
                    {URGENCY_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Scope / Perimeter</label>
                  <Textarea value={form.scope_perimeter} onChange={e => setForm(f => ({ ...f, scope_perimeter: e.target.value }))} placeholder="Which functions, geographies, products..." rows={2} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Call Transcript / Meeting Notes</label>
                  <Textarea value={form.transcript} onChange={e => setForm(f => ({ ...f, transcript: e.target.value }))} placeholder="Paste call transcript or key notes..." rows={4} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Additional Notes</label>
                  <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Anything else relevant..." rows={2} />
                </div>
              </div>
              <div className="flex justify-end mt-6">
                <Button onClick={handleGoToSlides}>
                  Choose Slides <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </Card>

            {/* ── Right: Intro Call Checklist ─────────────────────────── */}
            <Card className="lg:col-span-2 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Intro Call Questions</h3>
                <span className="text-xs text-muted-foreground">
                  {callChecklist.filter(c => c.checked).length}/{callChecklist.length} answered
                </span>
              </div>
              {/* Progress bar */}
              <div className="w-full h-1.5 bg-muted rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${callChecklist.length > 0 ? (callChecklist.filter(c => c.checked).length / callChecklist.length) * 100 : 0}%` }}
                />
              </div>
              <div className="space-y-1 max-h-[calc(100vh-300px)] overflow-y-auto">
                {callChecklist.map((item, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-2 p-2 rounded-md transition-colors ${
                      item.checked ? "bg-green-50 dark:bg-green-950/20" : "hover:bg-accent/30"
                    }`}
                  >
                    <button
                      className={`mt-0.5 w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                        item.checked
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-muted-foreground/40 hover:border-primary"
                      }`}
                      onClick={() => setCallChecklist(prev => prev.map((c, i) => i === idx ? { ...c, checked: !c.checked } : c))}
                    >
                      {item.checked && <Check className="w-3 h-3" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      {editingQuestion === idx ? (
                        <Textarea
                          value={item.question}
                          onChange={e => setCallChecklist(prev => prev.map((c, i) => i === idx ? { ...c, question: e.target.value } : c))}
                          onBlur={() => setEditingQuestion(null)}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); setEditingQuestion(null); } }}
                          autoFocus
                          rows={2}
                          className="text-xs"
                        />
                      ) : (
                        <button
                          className={`text-xs text-left w-full leading-relaxed ${
                            item.checked ? "text-muted-foreground line-through" : "text-foreground"
                          }`}
                          onClick={() => setEditingQuestion(idx)}
                          title="Click to edit question"
                        >
                          <span className="text-muted-foreground mr-1.5">{idx + 1}.</span>
                          {item.question}
                        </button>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 shrink-0 opacity-0 group-hover:opacity-100 hover:opacity-100"
                      onClick={() => setCallChecklist(prev => prev.filter((_, i) => i !== idx))}
                      title="Remove question"
                    >
                      <X className="w-3 h-3 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-full"
                onClick={() => {
                  setCallChecklist(prev => [...prev, { question: "New question...", checked: false }]);
                  setEditingQuestion(callChecklist.length);
                }}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Question
              </Button>
            </Card>
          </div>
        )}

        {/* ── Step 2: Project Type & Slide Selection ─────────────────────── */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Reset confirmation modal */}
            {showResetConfirm && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <Card className="p-6 max-w-md mx-4">
                  <div className="flex items-start gap-3 mb-4">
                    <AlertTriangle className="w-5 h-5 text-orange-500 mt-0.5 shrink-0" />
                    <div>
                      <h4 className="font-semibold">Reset slide selection?</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Changing the project type will reset the slide structure to defaults for <strong>{pendingProjectType}</strong>. Your manual edits will be lost.
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={cancelProjectTypeReset}>Cancel</Button>
                    <Button size="sm" onClick={confirmProjectTypeReset}>Reset to Defaults</Button>
                  </div>
                </Card>
              </div>
            )}

            {/* Project Type + Slide Count Header */}
            <Card className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-1 block">Project Type *</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={projectType}
                    onChange={e => handleProjectTypeChange(e.target.value as ProjectType)}
                  >
                    <option value="">Select project type...</option>
                    {PROJECT_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-4">
                  {/* Slide count indicator */}
                  {slides.length > 0 && (
                    <div className="text-sm">
                      <span className="font-medium">{selectedSlideCount}</span>
                      <span className="text-muted-foreground"> / {slides.length} slides selected</span>
                      <span className="text-xs text-muted-foreground ml-1">(target: {SLIDE_COUNT.IDEAL_MIN}–{SLIDE_COUNT.IDEAL_MAX})</span>
                    </div>
                  )}
                  <Button variant="outline" size="sm" onClick={resetToDefaults} disabled={!projectType}>
                    <RotateCcw className="w-4 h-4 mr-1" /> Reset Defaults
                  </Button>
                </div>
              </div>

              {/* Slide count warning */}
              {slides.length > 0 && (selectedSlideCount < SLIDE_COUNT.ACCEPTABLE_MIN || selectedSlideCount > SLIDE_COUNT.ACCEPTABLE_MAX) && (
                <div className={`flex items-center gap-2 mt-3 px-3 py-2 rounded-md bg-orange-50 border border-orange-200 ${slideCountStatus.color}`}>
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span className="text-sm">{slideCountStatus.message}</span>
                </div>
              )}
              {slides.length > 0 && selectedSlideCount >= SLIDE_COUNT.ACCEPTABLE_MIN && selectedSlideCount <= SLIDE_COUNT.ACCEPTABLE_MAX && (
                <div className={`flex items-center gap-2 mt-3 px-3 py-2 rounded-md bg-green-50 border border-green-200 ${slideCountStatus.color}`}>
                  <Info className="w-4 h-4 shrink-0" />
                  <span className="text-sm">{slideCountStatus.message} ({selectedSlideCount} slides)</span>
                </div>
              )}
            </Card>

            {/* Slide selection: two-panel layout */}
            {slides.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Left: Full slide list */}
                <div className="lg:col-span-2">
                  <Card className="p-0 overflow-hidden">
                    <div className="px-4 py-3 border-b bg-muted/30">
                      <h3 className="text-sm font-semibold">All Slides</h3>
                      <p className="text-xs text-muted-foreground">Click to toggle, drag or use arrows to reorder</p>
                    </div>
                    <div className="divide-y max-h-[600px] overflow-y-auto">
                      {slides.map((slide, idx) => {
                        const masterDef = MASTER_SLIDES.find(m => m.slide_id === slide.slide_id);
                        return (
                          <div
                            key={slide.slide_id}
                            draggable
                            onDragStart={() => handleDragStart(idx)}
                            onDragEnter={() => handleDragEnter(idx)}
                            onDragEnd={handleDragEnd}
                            onDragOver={e => e.preventDefault()}
                            className={`flex items-center gap-3 px-4 py-2.5 transition-colors cursor-grab active:cursor-grabbing ${
                              slide.is_selected ? "bg-primary/5" : "bg-background opacity-60"
                            }`}
                          >
                            <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />

                            {/* Order arrows */}
                            <div className="flex flex-col gap-0.5">
                              <button
                                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                                onClick={() => moveSlide(idx, "up")}
                                disabled={idx === 0}
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                                onClick={() => moveSlide(idx, "down")}
                                disabled={idx === slides.length - 1}
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Checkbox */}
                            <button
                              onClick={() => toggleSlide(slide.slide_id)}
                              className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                slide.is_selected
                                  ? "bg-primary border-primary text-primary-foreground"
                                  : "border-input hover:border-primary"
                              }`}
                            >
                              {slide.is_selected && <Check className="w-3 h-3" />}
                            </button>

                            {/* Slide info */}
                            <div className="flex-1 min-w-0" onClick={() => toggleSlide(slide.slide_id)}>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-medium ${slide.is_selected ? "" : "text-muted-foreground"}`}>
                                  {slide.title}
                                </span>
                                {slide.default_selected && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-medium">DEFAULT</span>
                                )}
                              </div>
                              {masterDef && (
                                <p className="text-xs text-muted-foreground truncate">{masterDef.description}</p>
                              )}
                            </div>

                            <span className="text-xs text-muted-foreground w-6 text-right shrink-0">{idx + 1}</span>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </div>

                {/* Right: Selected slides summary */}
                <div>
                  <Card className="p-0 overflow-hidden sticky top-20">
                    <div className="px-4 py-3 border-b bg-muted/30">
                      <h3 className="text-sm font-semibold">Selected Slides ({selectedSlideCount})</h3>
                    </div>
                    <div className="p-3 max-h-[540px] overflow-y-auto">
                      {slides.filter(s => s.is_selected).length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No slides selected</p>
                      ) : (
                        <ol className="space-y-1">
                          {slides.filter(s => s.is_selected).map((s, i) => (
                            <li key={s.slide_id} className="flex items-center gap-2 text-sm py-1">
                              <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                              <span className="truncate">{s.title}</span>
                              <button
                                onClick={() => toggleSlide(s.slide_id)}
                                className="ml-auto text-muted-foreground hover:text-destructive shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {/* No project type selected */}
            {!projectType && (
              <Card className="p-12 text-center text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p>Select a project type to see the recommended slide structure</p>
              </Card>
            )}

            {/* Action buttons */}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Inputs
              </Button>
              <Button onClick={handleSubmitSlides} disabled={saving || !projectType}>
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <BookOpen className="w-4 h-4 mr-1" />}
                Continue to Briefing
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Slide Briefing & Content Definition ────────────────── */}
        {step === 3 && (
          <div className="space-y-4">
            {/* Manual paste modal */}
            {showManualPaste && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <Card className="p-6 max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <ClipboardPaste className="w-5 h-5" /> Paste Detailed Instructions
                    </h3>
                    <Button variant="ghost" size="sm" onClick={() => setShowManualPaste(false)}><X className="w-4 h-4" /></Button>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Paste the full text from ChatGPT (or similar) with slide-by-slide content. The AI will parse it and map content to each slide.
                  </p>
                  <Textarea
                    value={manualPasteText}
                    onChange={e => setManualPasteText(e.target.value)}
                    rows={16}
                    className="flex-1 text-sm font-mono"
                    placeholder="Paste your detailed slide instructions here...

Example format:
## Executive Summary
Context: The client faces...
Recommendation: We propose...

## Deep Dive - Sales Force
Observation: Current coverage is...
Root cause: Territory allocation..."
                  />
                  <div className="flex justify-end gap-2 mt-4">
                    <Button variant="outline" onClick={() => setShowManualPaste(false)}>Cancel</Button>
                    <Button onClick={parseManualBriefs} disabled={parsingManual || !manualPasteText.trim()}>
                      {parsingManual ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                      Parse & Apply to Slides
                    </Button>
                  </div>
                </Card>
              </div>
            )}

            {/* Template popup modal */}
            {templatePopup && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <Card className="p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Settings2 className="w-5 h-5" /> Slide Template: {templatePopup}
                    </h3>
                    <Button variant="ghost" size="sm" onClick={() => setTemplatePopup(null)}><X className="w-4 h-4" /></Button>
                  </div>
                  {templateLoading ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
                  ) : templateData ? (
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Purpose</label>
                        <Textarea value={templateData.purpose || ""} onChange={e => setTemplateData((d: any) => ({ ...d, purpose: e.target.value }))} rows={2} className="text-sm" />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Structure Sections (one per line)</label>
                        <Textarea
                          value={(templateData.structure?.sections || []).join("\n")}
                          onChange={e => setTemplateData((d: any) => ({ ...d, structure: { ...d.structure, sections: e.target.value.split("\n").filter((s: string) => s.trim()) } }))}
                          rows={4} className="text-sm font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Rules</label>
                        <Textarea value={templateData.rules || ""} onChange={e => setTemplateData((d: any) => ({ ...d, rules: e.target.value }))} rows={4} className="text-sm" />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="text-sm font-medium mb-1 block">Column 1</label>
                          <Input value={templateData.columns?.column_1 || ""} onChange={e => setTemplateData((d: any) => ({ ...d, columns: { ...d.columns, column_1: e.target.value } }))} className="text-sm" />
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-1 block">Column 2</label>
                          <Input value={templateData.columns?.column_2 || ""} onChange={e => setTemplateData((d: any) => ({ ...d, columns: { ...d.columns, column_2: e.target.value } }))} className="text-sm" />
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-1 block">Column 3</label>
                          <Input value={templateData.columns?.column_3 || ""} onChange={e => setTemplateData((d: any) => ({ ...d, columns: { ...d.columns, column_3: e.target.value } }))} className="text-sm" />
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div>
                          <label className="text-sm font-medium mb-1 block">Format</label>
                          <select className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm" value={templateData.format || "A"} onChange={e => setTemplateData((d: any) => ({ ...d, format: e.target.value }))}>
                            <option value="A">Format A</option>
                            <option value="B">Format B</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-2 mt-5">
                          <input type="checkbox" checked={!!templateData.insight_bar} onChange={e => setTemplateData((d: any) => ({ ...d, insight_bar: e.target.checked ? 1 : 0 }))} />
                          <label className="text-sm">Insight bar</label>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-2 border-t">
                        <Button variant="outline" size="sm" onClick={() => setTemplatePopup(null)}>Cancel</Button>
                        <Button size="sm" onClick={saveTemplateData} disabled={templateSaving}>
                          {templateSaving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                          Save Template
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No template data available.</p>
                  )}
                </Card>
              </div>
            )}

            {/* Choice screen: Claude API vs Manual Paste */}
            {briefMode === "choose" && (
              <div className="space-y-4">
                <Card className="p-8">
                  <h3 className="text-lg font-semibold mb-2 text-center">How would you like to generate slide briefs?</h3>
                  <p className="text-sm text-muted-foreground text-center mb-8">
                    Choose between AI-powered generation or paste your own detailed instructions
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
                    {/* Option 1: Claude API */}
                    <button
                      className="flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-dashed hover:border-primary hover:bg-primary/5 transition-colors text-center"
                      onClick={generateBriefsWithClaude}
                    >
                      <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                        <Cpu className="w-7 h-7 text-primary" />
                      </div>
                      <span className="font-semibold">Generate with Claude API</span>
                      <span className="text-xs text-muted-foreground">
                        AI analyzes your inputs and auto-generates structured briefs for each slide
                      </span>
                    </button>

                    {/* Option 2: Manual Paste */}
                    <button
                      className="flex flex-col items-center gap-3 p-6 rounded-lg border-2 border-dashed hover:border-primary hover:bg-primary/5 transition-colors text-center"
                      onClick={() => setShowManualPaste(true)}
                    >
                      <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center">
                        <ClipboardPaste className="w-7 h-7 text-orange-600" />
                      </div>
                      <span className="font-semibold">Paste Manual Instructions</span>
                      <span className="text-xs text-muted-foreground">
                        Paste detailed text from ChatGPT or similar — saves API costs
                      </span>
                    </button>
                  </div>
                </Card>
                <div className="flex justify-start">
                  <Button variant="outline" onClick={() => setStep(2)}>
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back to Slides
                  </Button>
                </div>
              </div>
            )}

            {/* Generating state */}
            {briefMode === "generating" && (
              <Card className="p-12 flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-12 h-12 animate-spin text-primary" />
                <p className="text-lg font-medium">Generating slide briefs...</p>
                <p className="text-sm text-muted-foreground">Claude is structuring content for each selected slide</p>
              </Card>
            )}

            {/* Briefs loaded — editing mode */}
            {briefMode === "editing" && briefs.length > 0 && (
              <>
                {/* Progress bar */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">{briefs.length} slide briefs</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button variant="outline" size="sm" onClick={() => { setBriefMode("choose"); setBriefs([]); }}>
                        <RotateCcw className="w-3 h-3 mr-1" /> Regenerate
                      </Button>
                      <Button variant="outline" size="sm" onClick={saveBriefs} disabled={saving}>
                        {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                        Save Briefs
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setExpandedBrief(expandedBrief ? null : briefs[0]?.slide_id)}>
                        {expandedBrief ? "Collapse All" : "Expand First"}
                      </Button>
                    </div>
                  </div>
                  {/* Quick navigation */}
                  <div className="flex flex-wrap gap-1.5">
                    {briefs.map((b, idx) => (
                      <button
                        key={b.slide_id}
                        onClick={() => {
                          setExpandedBrief(b.slide_id);
                          document.getElementById(`brief-${b.slide_id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                        className={`text-xs px-2 py-1 rounded-md transition-colors ${
                          expandedBrief === b.slide_id
                            ? "bg-primary text-primary-foreground"
                            : b.content_structure.some(f => f.value.trim())
                              ? "bg-green-100 text-green-700 hover:bg-green-200"
                              : "bg-muted text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {idx + 1}. {b.title}
                      </button>
                    ))}
                  </div>
                </Card>

                {/* Brief cards */}
                {briefs.map((brief, idx) => (
                  <Card
                    key={brief.slide_id}
                    id={`brief-${brief.slide_id}`}
                    className={`overflow-hidden transition-all ${expandedBrief === brief.slide_id ? "ring-2 ring-primary/30" : ""}`}
                  >
                    {/* Header (always visible, clickable) */}
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors">
                      <button
                        className="flex-1 flex items-center gap-3 text-left min-w-0"
                        onClick={() => setExpandedBrief(expandedBrief === brief.slide_id ? null : brief.slide_id)}
                      >
                        <span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium shrink-0">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{brief.title}</div>
                          <div className="text-xs text-muted-foreground">{brief.purpose}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {brief.content_structure.every(f => f.value.trim()) && (
                            <span className="text-xs text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> Complete</span>
                          )}
                          {brief.notes && <MessageSquare className="w-3.5 h-3.5 text-blue-500" />}
                          {guidanceImages[brief.slide_id] && <ImageIcon className="w-3.5 h-3.5 text-purple-500" />}
                          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${expandedBrief === brief.slide_id ? "rotate-90" : ""}`} />
                        </div>
                      </button>
                      {/* Action buttons on header */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          className="p-1.5 rounded hover:bg-accent transition-colors"
                          title="Slide template"
                          onClick={e => { e.stopPropagation(); openTemplatePopup(brief.slide_id); }}
                        >
                          <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                        <label className="p-1.5 rounded hover:bg-accent transition-colors cursor-pointer" title="Upload guidance image">
                          <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" />
                          <input
                            type="file"
                            accept="image/*,.pptx,.ppt"
                            className="hidden"
                            onChange={e => { const f = e.target.files?.[0]; if (f) uploadGuidanceImage(brief.slide_id, f); e.target.value = ""; }}
                          />
                        </label>
                      </div>
                    </div>

                    {/* Expanded content */}
                    {expandedBrief === brief.slide_id && (
                      <div className="border-t px-4 py-4 space-y-4">
                        {/* Guidance image thumbnail */}
                        {guidanceImages[brief.slide_id] && (
                          <div className="flex items-start gap-3 p-3 bg-purple-50 dark:bg-purple-950/20 rounded-md">
                            <img
                              src={guidanceImages[brief.slide_id]}
                              alt="Guidance"
                              className="w-32 h-20 object-cover rounded border"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-purple-700 dark:text-purple-300">Guidance image attached</p>
                              <p className="text-xs text-muted-foreground mt-0.5">This image is saved as template guidance for future proposals</p>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="mt-1 h-6 text-xs text-destructive"
                                onClick={async () => {
                                  await fetch(`/api/slide-methodology/${encodeURIComponent(brief.slide_id)}/guidance-image`, {
                                    method: "PUT", credentials: "include",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ image: null }),
                                  });
                                  setGuidanceImages(prev => { const n = { ...prev }; delete n[brief.slide_id]; return n; });
                                }}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Editable fields */}
                        {brief.content_structure.map(field => (
                          <div key={field.key}>
                            <label className="text-sm font-medium mb-1 block">{field.label}</label>
                            <Textarea
                              value={field.value}
                              onChange={e => updateBriefField(brief.slide_id, field.key, e.target.value)}
                              rows={Math.max(2, Math.ceil(field.value.length / 80))}
                              className="text-sm"
                            />
                          </div>
                        ))}

                        {/* Notes */}
                        <div className="border-t pt-3">
                          <label className="text-sm font-medium mb-1 flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5" /> Notes (optional)
                          </label>
                          <Textarea
                            value={brief.notes}
                            onChange={e => updateBriefNotes(brief.slide_id, e.target.value)}
                            rows={2}
                            className="text-sm"
                            placeholder="Any special instructions or context for this slide..."
                          />
                        </div>

                        {/* Navigate to next brief */}
                        {idx < briefs.length - 1 && (
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const nextId = briefs[idx + 1].slide_id;
                                setExpandedBrief(nextId);
                                setTimeout(() => {
                                  document.getElementById(`brief-${nextId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                                }, 50);
                              }}
                            >
                              Next: {briefs[idx + 1].title} <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                ))}

                {/* Action buttons */}
                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setStep(2)}>
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back to Slides
                  </Button>
                  <Button onClick={handleSubmitBriefs} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                    Validate & Analyze with AI
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Step 4: Analyzing ─────────────────────────────────────────── */}
        {step === 4 && (
          <Card className="p-12 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-lg font-medium">Claude is analyzing your inputs...</p>
            <p className="text-sm text-muted-foreground">Building proposal architecture with 3 options, team composition, pricing...</p>
          </Card>
        )}

        {/* ── Step 5: Editable Architecture ──────────────────────────────── */}
        {step === 5 && current && (
          <div className="space-y-6">
            <Card className="p-6 space-y-4">
              <h3 className="text-lg font-semibold">Proposal Overview</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Proposal Title</label>
                  <Input value={current.proposal_title || ""} onChange={e => setCurrent(c => c ? { ...c, proposal_title: e.target.value } : c)} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Staffing Intensity</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={current.staffing_intensity || "moderate"}
                    onChange={e => setCurrent(c => c ? { ...c, staffing_intensity: e.target.value } : c)}
                  >
                    <option value="light">Light</option>
                    <option value="moderate">Moderate</option>
                    <option value="intensive">Intensive</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Company Summary</label>
                  <Textarea value={current.company_summary || ""} onChange={e => setCurrent(c => c ? { ...c, company_summary: e.target.value } : c)} rows={2} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Why Now?</label>
                  <Textarea value={current.why_now || ""} onChange={e => setCurrent(c => c ? { ...c, why_now: e.target.value } : c)} rows={2} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Objective Statement</label>
                  <Textarea value={current.objective_statement || ""} onChange={e => setCurrent(c => c ? { ...c, objective_statement: e.target.value } : c)} rows={2} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Scope Statement</label>
                  <Textarea value={current.scope_statement || ""} onChange={e => setCurrent(c => c ? { ...c, scope_statement: e.target.value } : c)} rows={2} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-medium mb-1 block">Recommended Team</label>
                  <Textarea value={current.recommended_team || ""} onChange={e => setCurrent(c => c ? { ...c, recommended_team: e.target.value } : c)} rows={2} />
                </div>
              </div>
            </Card>

            <h3 className="text-lg font-semibold">Engagement Options</h3>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {(current.options || []).map((opt, optIdx) => (
                <OptionCard
                  key={optIdx}
                  option={opt}
                  onChange={(updated) => {
                    setCurrent(c => {
                      if (!c) return c;
                      const newOpts = [...c.options];
                      newOpts[optIdx] = updated;
                      return { ...c, options: newOpts };
                    });
                  }}
                />
              ))}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(3)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Briefing
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={saveEdits} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                  Save Changes
                </Button>
                <Button onClick={async () => { await saveEdits(); setStep(6); }}>
                  Generate Deck <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 6: Generate & Download ────────────────────────────────── */}
        {step === 6 && current && (
          <Card className="p-8 flex flex-col items-center gap-6">
            <FileText className="w-16 h-16 text-primary" />
            <h3 className="text-xl font-semibold">Ready to Generate Deck</h3>
            <p className="text-muted-foreground text-center max-w-md">
              Your proposal for <strong>{current.company_name}</strong> is complete.
              Click below to generate and download the PowerPoint deck.
            </p>

            <div className="w-full max-w-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Option</TableHead>
                    <TableHead className="text-center">Weeks</TableHead>
                    <TableHead className="text-right">Total Fee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(current.options || []).map((opt, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{opt.name}</TableCell>
                      <TableCell className="text-center">{opt.duration_weeks}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(opt.total_fee)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(5)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Edit Architecture
              </Button>
              <Button size="lg" onClick={generateDeck} disabled={generating}>
                {generating ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Download className="w-5 h-5 mr-2" />}
                Download PowerPoint
              </Button>
            </div>
          </Card>
        )}
      </div>
    );
  }

  // ── Render: List View ──────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Proposals"
        description="Internal proposal operating system"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowTemplates(true)}>
              <Upload className="w-4 h-4 mr-1" /> Templates
            </Button>
            <Button onClick={startNew}>
              <Plus className="w-4 h-4 mr-1" /> New Proposal
            </Button>
          </div>
        }
      />
      <Card className="p-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Options</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposals.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No proposals yet. Click "New Proposal" to start.</TableCell></TableRow>
            )}
            {[...proposals].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(p => (
              <TableRow key={p.id} className="cursor-pointer hover:bg-accent/50" onClick={() => openProposal(p)}>
                <TableCell className="font-medium">{p.company_name}</TableCell>
                <TableCell className="text-muted-foreground">{p.proposal_title || "\u2014"}</TableCell>
                <TableCell>
                  {p.project_type ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                      {p.project_type}
                    </span>
                  ) : "\u2014"}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    p.status === "finalized" ? "bg-green-100 text-green-700" :
                    p.status === "analyzed" ? "bg-blue-100 text-blue-700" :
                    "bg-gray-100 text-gray-700"
                  }`}>
                    {p.status}
                  </span>
                </TableCell>
                <TableCell>
                  {(p.options || []).length > 0
                    ? (p.options as ProposalOption[]).map(o => formatCurrency(o.total_fee)).join(" / ")
                    : "\u2014"
                  }
                </TableCell>
                <TableCell>{formatDate(p.created_at)}</TableCell>
                <TableCell>
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" onClick={() => openProposal(p)}><Eye className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteProposal(p.id!)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ── Option Card Sub-Component ─────────────────────────────────────────────────

function OptionCard({ option, onChange }: { option: ProposalOption; onChange: (o: ProposalOption) => void }) {
  const [editingScope, setEditingScope] = useState(false);
  const [editingDeliverables, setEditingDeliverables] = useState(false);

  function updateTeamMember(idx: number, field: keyof TeamMember, val: string) {
    const team = [...option.team];
    if (field === "role") {
      team[idx] = { ...team[idx], role: val };
    } else {
      team[idx] = { ...team[idx], [field]: Number(val) || 0 };
    }
    recalcPricing({ ...option, team });
  }

  function recalcPricing(opt: ProposalOption) {
    const RATES: Record<string, number> = { Partner: 7000, EM: 2800, ASC: 1200 };
    const price_breakdown = opt.team.map(m => {
      const rate = RATES[m.role] || 1200;
      const days = m.days_per_week * opt.duration_weeks;
      return { role: m.role, count: m.count, daily_rate: rate, days, total: rate * days * m.count };
    });
    const total_fee = price_breakdown.reduce((s, b) => s + b.total, 0);
    onChange({ ...opt, price_breakdown, total_fee });
  }

  return (
    <Card className="p-4 space-y-3 border-2 hover:border-primary/30 transition-colors">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-lg">{option.name}</h4>
        <span className="text-xl font-bold text-primary">{formatCurrency(option.total_fee)}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Duration (weeks)</label>
          <Input
            type="number"
            value={option.duration_weeks}
            onChange={e => recalcPricing({ ...option, duration_weeks: Number(e.target.value) || 0 })}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Staffing Mode</label>
          <Input
            value={option.staffing_mode}
            onChange={e => onChange({ ...option, staffing_mode: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium">Team</label>
        <div className="space-y-1 mt-1">
          {option.team.map((m, i) => (
            <div key={i} className="grid grid-cols-3 gap-1">
              <Input value={m.role} onChange={e => updateTeamMember(i, "role", e.target.value)} className="h-7 text-xs" />
              <Input type="number" value={m.count} onChange={e => updateTeamMember(i, "count", e.target.value)} className="h-7 text-xs" placeholder="count" />
              <Input type="number" value={m.days_per_week} onChange={e => updateTeamMember(i, "days_per_week", e.target.value)} className="h-7 text-xs" placeholder="d/wk" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground font-medium">Scope</label>
          <Button size="sm" variant="ghost" className="h-5 px-1" onClick={() => setEditingScope(!editingScope)}>
            <Pencil className="w-3 h-3" />
          </Button>
        </div>
        {editingScope ? (
          <Textarea
            value={option.scope.join("\n")}
            onChange={e => onChange({ ...option, scope: e.target.value.split("\n").filter(Boolean) })}
            rows={3}
            className="text-xs mt-1"
            placeholder="One item per line"
          />
        ) : (
          <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
            {option.scope.map((s, i) => <li key={i}>- {s}</li>)}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground font-medium">Deliverables</label>
          <Button size="sm" variant="ghost" className="h-5 px-1" onClick={() => setEditingDeliverables(!editingDeliverables)}>
            <Pencil className="w-3 h-3" />
          </Button>
        </div>
        {editingDeliverables ? (
          <Textarea
            value={option.deliverables.join("\n")}
            onChange={e => onChange({ ...option, deliverables: e.target.value.split("\n").filter(Boolean) })}
            rows={3}
            className="text-xs mt-1"
            placeholder="One item per line"
          />
        ) : (
          <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
            {option.deliverables.map((d, i) => <li key={i}>- {d}</li>)}
          </ul>
        )}
      </div>

      <div>
        <label className="text-xs text-muted-foreground">Cadence</label>
        <Input value={option.cadence} onChange={e => onChange({ ...option, cadence: e.target.value })} className="h-7 text-xs" />
      </div>

      <div className="border-t pt-2 mt-2">
        <label className="text-xs text-muted-foreground font-medium">Price Breakdown</label>
        <div className="text-xs space-y-0.5 mt-1">
          {(option.price_breakdown || []).map((b, i) => (
            <div key={i} className="flex justify-between">
              <span>{b.role} ({b.count}x) - {b.days}d @ {formatCurrency(b.daily_rate)}</span>
              <span className="font-medium">{formatCurrency(b.total)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
