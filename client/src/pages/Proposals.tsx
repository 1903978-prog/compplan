import React, { useState, useEffect, useCallback, useRef } from "react";
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
  Settings2, Image as ImageIcon, ClipboardPaste, Cpu, HelpCircle, Save,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  MASTER_SLIDES, PROJECT_TYPES, type ProjectType, type SlideSelectionEntry,
  getDefaultSlideSelection, getSlideCountStatus, SLIDE_COUNT,
} from "@/lib/proposalSlides";
import { signalApiStart, signalApiEnd } from "@/App";

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
interface ProposalOption {
  name: string;
  duration_weeks: number;
  staffing_mode: string;
  team: TeamMember[];
  scope: string[];
  deliverables: string[];
  cadence: string;
  assumptions: string[];
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
  project_approach?: string | null;
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const URGENCY_OPTIONS = ["Low", "Medium", "High", "Critical"];

const DEFAULT_CALL_QUESTIONS: string[] = [
  "What are the three or four structural challenges / performance gaps you see today?",
  "Is the main pain point strategic clarity, or execution / follow-through?",
  "Sources of growth: new clients, cross-sell, share of wallet, or pricing \u2014 which would you rate?",
  "How many active clients do you have in this scope and FTES, offices?",
  "How concentrated is the business / where are the biggest accounts?",
  "Is part of the EBITDA improvement expected from extracting more value from existing customers / pricing / margin?",
  "Which portion of this growth should come from what we are discussing today?",
  "Can you remind us revenues and EBITDA margin of the organization today?",
  "How you define success at end of this project?",
  "Which geographies would you consider in scope? Where will you start from?",
  "Should we consider only existing clients, or also prospects?",
  "What are the five things you want to deep dive on?",
  "How big is the sales organization \u2014 how many people, teams, countries?",
  "Do you want to start with execution / action or a diagnostic?",
  "what we need to do for you to chose us and do this?",
  "Now that we discussed everything, what would you say are the top priorities?",
  "When should we start?",
];

const WIZARD_STEPS = [
  { n: 1, label: "Input" },
  { n: 2, label: "Deck" },
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
  // Slide template instructions popup (Step 2)
  const [showSlideInstructions, setShowSlideInstructions] = useState(false);
  const [slideInstructionsText, setSlideInstructionsText] = useState("");
  const [slideInstructionsParsing, setSlideInstructionsParsing] = useState(false);

  // Per-slide prompt editing (Step 2)
  const [expandedSlidePanel, setExpandedSlidePanel] = useState<{ slideId: string; panel: "visual" | "content" | "generate" } | null>(null);
  const [slideGenerating, setSlideGenerating] = useState<string | null>(null);
  const [slideFollowUpQs, setSlideFollowUpQs] = useState<Record<string, { key: string; question: string }[]>>({});
  const [slideDefaultPrompts, setSlideDefaultPrompts] = useState<Record<string, { visual: string; content: string }>>({});
  const [previewSlideId, setPreviewSlideId] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<Record<string, string>>({});
  const [generatingPage, setGeneratingPage] = useState<string | null>(null);
  const [slideChatInput, setSlideChatInput] = useState("");
  const [slideChatHistory, setSlideChatHistory] = useState<Record<string, { role: "user" | "ai"; text: string }[]>>({});
  const [slideChatLoading, setSlideChatLoading] = useState(false);
  const [updatingPrompts, setUpdatingPrompts] = useState(false);
  const [slideScores, setSlideScores] = useState<Record<string, any>>({});
  const [showFullSlideView, setShowFullSlideView] = useState(false);
  const [enableQualityScore, setEnableQualityScore] = useState(false);
  const [analyzingRef, setAnalyzingRef] = useState<string | null>(null);

  // COST GUARD: check API status and require explicit confirmation before any AI call
  async function confirmApiUsage(action: string): Promise<boolean> {
    try {
      const res = await fetch("/api/api-pause", { credentials: "include" });
      const data = await res.json();
      if (data.paused) {
        // Offer to activate the API right here
        const activate = window.confirm(
          `API is paused.\n\n"${action}" requires AI and will incur costs.\n\nClick OK to enter the password and activate the API.`
        );
        if (!activate) return false;
        const pw = window.prompt("Enter API password to activate:");
        if (!pw) return false;
        const activateRes = await fetch("/api/api-pause", {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paused: false, password: pw }),
        });
        if (!activateRes.ok) {
          const err = await activateRes.json().catch(() => ({ message: "Wrong password" }));
          toast({ title: err.message || "Wrong password", variant: "destructive" });
          return false;
        }
        toast({ title: "API activated" });
      }
    } catch { return false; }
    const ok = window.confirm(`This will use the Claude AI API and incur costs.\n\nAction: ${action}\n\nProceed?`);
    if (ok) signalApiStart();
    return ok;
  }
  // Call after every AI function completes
  function apiCallDone() {
    signalApiEnd();
    // Refresh cost display
    fetch("/api/api-cost", { credentials: "include" }).then(r => r.json()).catch(() => null);
  }

  // Knowledge Center
  const [knowledgeFiles, setKnowledgeFiles] = useState<{ id: number; category: string; filename: string; file_size: number; uploaded_at: string }[]>([]);
  const [showKnowledge, setShowKnowledge] = useState(false);
  // Project Approach
  const [projectApproach, setProjectApproach] = useState<string>("");
  const [generatingApproach, setGeneratingApproach] = useState(false);

  // Auto-save: debounced save after any modification (2 second delay)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const triggerAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      if (!form.company_name) return; // don't save empty proposals
      setAutoSaving(true);
      try { await saveProgress(); } catch { /* silent */ }
      setAutoSaving(false);
    }, 2000);
  }, [form, slides, briefs, callChecklist, projectType, projectApproach]);

  // Trigger auto-save when key data changes
  useEffect(() => {
    if (step >= 1 && form.company_name) triggerAutoSave();
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [form.company_name, form.website, form.revenue, form.ebitda_margin, form.objective, form.urgency, form.scope_perimeter, form.transcript, form.notes, slides, briefs, projectApproach, callChecklist, projectType]);

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
    const loadedSlides = Array.isArray(p.slide_selection) && p.slide_selection.length > 0 ? p.slide_selection : [];
    setSlides(loadedSlides);
    // Restore saved previews and quality scores from slide data
    const restoredPreviews: Record<string, string> = {};
    const restoredScores: Record<string, any> = {};
    for (const s of loadedSlides) {
      if (s.preview_html) restoredPreviews[s.slide_id] = s.preview_html;
      if (s.quality_score) restoredScores[s.slide_id] = s.quality_score;
    }
    if (Object.keys(restoredPreviews).length > 0) setPreviewHtml(restoredPreviews);
    if (Object.keys(restoredScores).length > 0) setSlideScores(restoredScores);
    setBriefs(Array.isArray(p.slide_briefs) && p.slide_briefs.length > 0 ? p.slide_briefs : []);
    setProjectApproach(p.project_approach ?? "");
    // Restore call checklist
    setCallChecklist(
      Array.isArray(p.call_checklist) && p.call_checklist.length > 0
        ? p.call_checklist
        : DEFAULT_CALL_QUESTIONS.map(q => ({ question: q, checked: false }))
    );
    setEditingQuestion(null);
    // Treat any loaded proposal with slides as "manually edited" so that
    // changing project type on a saved proposal prompts for confirmation
    // instead of silently wiping custom slides, renames, prompts, and content.
    setHasManualEdits(loadedSlides.length > 0);
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

  // Load learned defaults (selected slide IDs + order) for a project type.
  // Returns null if none are available, so callers can fall through to hardcoded defaults.
  async function fetchLearnedDefaults(pt: ProjectType): Promise<{ savedIds: string[]; savedOrder: string[] } | null> {
    try {
      const res = await fetch(`/api/slide-defaults/${encodeURIComponent(pt)}`, { credentials: "include" });
      if (!res.ok) return null;
      const data = await res.json();
      const savedIds: string[] = data.slide_ids || [];
      const savedOrder: string[] = data.slide_order || [];
      if (savedIds.length === 0) return null;
      return { savedIds, savedOrder };
    } catch {
      return null;
    }
  }

  // SAFE, non-destructive version. Applies a project type by merging existing
  // slides with the project's defaults, preserving:
  //   - user renames (title)
  //   - user-edited prompts (visual_prompt, content_prompt)
  //   - generated_content, preview_html, quality_score, reference_image
  //   - any custom slides the user added (slide_id starting with "custom_")
  // Only selection state and order are taken from learned defaults.
  // Called from handleGoToSlides (first navigation) and from handleProjectTypeChange
  // when the user has no manual edits yet — in both cases, no data can be lost.
  async function applyProjectType(pt: ProjectType) {
    setProjectType(pt);
    const learned = await fetchLearnedDefaults(pt);
    const defaults = getDefaultSlideSelection(pt);

    setSlides(prev => {
      const existingById = new Map(prev.map(s => [s.slide_id, s]));
      const defaultIds = new Set(defaults.map(d => d.slide_id));

      const selectedSet = learned ? new Set(learned.savedIds) : null;
      const orderMap = learned ? new Map(learned.savedOrder.map((id: string, i: number) => [id, i as number])) : null;

      // Merge defaults with existing: keep every existing field on default slides,
      // only override is_selected/default_selected/order from learned data if available.
      const mergedDefaults: SlideSelectionEntry[] = defaults.map(d => {
        const existing = existingById.get(d.slide_id);
        const base: SlideSelectionEntry = existing ?? d;
        const next: SlideSelectionEntry = { ...base };
        if (selectedSet) {
          next.is_selected = selectedSet.has(d.slide_id);
          next.default_selected = selectedSet.has(d.slide_id);
        } else if (existing) {
          // No learned defaults — keep existing selection, don't touch it
          next.is_selected = existing.is_selected;
          next.default_selected = existing.default_selected;
        }
        if (orderMap && orderMap.has(d.slide_id)) {
          next.order = orderMap.get(d.slide_id)!;
        } else if (existing && typeof existing.order === "number") {
          next.order = existing.order;
        }
        return next;
      });

      // Preserve any custom slides the user added (not in MASTER defaults)
      const customs = prev.filter(s => !defaultIds.has(s.slide_id));

      const all = [...mergedDefaults, ...customs];
      all.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      return all.map((s, i) => ({ ...s, order: i }));
    });

    // Only clear the "manual edits" flag on a truly fresh proposal.
    // If there were already slides, the user has customizations — keep the flag on
    // so future project-type changes still trigger the confirmation dialog.
    if (slides.length === 0) setHasManualEdits(false);
  }

  // DESTRUCTIVE version. Wipes the slide list and rebuilds from defaults.
  // Only called from the explicit user-confirmed "reset" path and from the
  // "Reset to defaults" button. This WILL lose user edits — by design.
  async function resetSlidesToProjectType(pt: ProjectType) {
    setProjectType(pt);
    const learned = await fetchLearnedDefaults(pt);
    if (learned) {
      const selectedSet = new Set(learned.savedIds);
      const defaults = getDefaultSlideSelection(pt);
      const orderMap = new Map(learned.savedOrder.map((id: string, i: number) => [id, i as number]));
      const allSlides = defaults.map((slide) => ({
        ...slide,
        is_selected: selectedSet.has(slide.slide_id),
        default_selected: selectedSet.has(slide.slide_id),
        order: orderMap.has(slide.slide_id) ? orderMap.get(slide.slide_id)! : 999,
      }));
      allSlides.sort((a, b) => a.order - b.order);
      setSlides(allSlides.map((s, i) => ({ ...s, order: i })));
      setHasManualEdits(false);
      return;
    }
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
      resetSlidesToProjectType(pendingProjectType);
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
      // Reset to hardcoded defaults (not learned) — user can use this to "unlearn".
      // This is a destructive, explicit user action and WILL drop customizations.
      setSlides(getDefaultSlideSelection(projectType));
      setHasManualEdits(false);
    }
  }

  // ── Per-slide prompt helpers ────────────────────────────────────────────────

  function toggleSlidePanel(slideId: string, panel: "visual" | "content" | "generate") {
    if (expandedSlidePanel?.slideId === slideId && expandedSlidePanel.panel === panel) {
      setExpandedSlidePanel(null);
    } else {
      setExpandedSlidePanel({ slideId, panel });
      // Load defaults if prompts are empty
      const slide = slides.find(s => s.slide_id === slideId);
      if (!slide?.visual_prompt || !slide?.content_prompt || !slideFollowUpQs[slideId]) {
        loadSlideDefaults(slideId);
      }
    }
  }

  async function loadSlideDefaults(slideId: string) {
    try {
      const res = await fetch(`/api/slide-defaults/${slideId}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      // Store defaults separately — do NOT write into slide state (that would light up icons)
      // Defaults are shown as placeholder text in the textareas, not as saved content
      setSlideFollowUpQs(prev => ({
        ...prev,
        [slideId]: data.follow_up_questions ?? [],
      }));
      // Store default prompts for placeholder display (keyed by slideId)
      setSlideDefaultPrompts(prev => ({
        ...prev,
        [slideId]: { visual: data.visual_prompt ?? "", content: data.content_prompt ?? "" },
      }));
    } catch { /* silent */ }
  }

  function updateSlideField(slideId: string, field: string, value: any) {
    setSlides(prev => prev.map(s => s.slide_id === slideId ? { ...s, [field]: value } : s));
    setHasManualEdits(true);
  }

  async function generateSlideContent(slideId: string) {
    if (!await confirmApiUsage("Generate slide content")) return;
    const slide = slides.find(s => s.slide_id === slideId);
    if (!slide) return;

    if (!current?.id) {
      await saveProgress();
      await new Promise(r => setTimeout(r, 500));
    }
    if (!current?.id) return;

    setSlideGenerating(slideId);
    try {
      // For agenda: inject the actual selected slide list into the content prompt
      let contentPrompt = slide.content_prompt ?? "";
      if (slideId === "agenda") {
        const SKIP_IDS = new Set(["cover", "confidentiality", "agenda"]);
        const agendaItems = slides
          .filter(s => s.is_selected && !SKIP_IDS.has(s.slide_id))
          .sort((a, b) => a.order - b.order)
          .map((s, i) => `${i + 1}. ${s.title}`)
          .join("\n");
        contentPrompt += `\n\n=== CURRENT SELECTED SLIDES (use this exact list) ===\n${agendaItems}`;
      }

      const res = await fetch(`/api/proposals/${current.id}/generate-slide`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slide_id: slideId,
          visual_prompt: slide.visual_prompt ?? "",
          content_prompt: contentPrompt,
          answers: slide.generation_answers ?? {},
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
        throw new Error(errData.message || `Server returned ${res.status}`);
      }
      const data = await res.json();
      if (!data.generated_content) {
        throw new Error("Server returned empty content");
      }
      updateSlideField(slideId, "generated_content", data.generated_content);
      toast({ title: `Content generated for "${slide.title}"` });
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    }
    setSlideGenerating(null); apiCallDone();
  }

  // Generate visual page preview (HTML)
  async function generatePage(slideId: string) {
    if (!await confirmApiUsage("Generate page preview")) return;
    const slide = slides.find(s => s.slide_id === slideId);
    if (!current?.id) {
      await saveProgress();
      // saveProgress sets current via setState — wait a tick for it to update
      await new Promise(r => setTimeout(r, 500));
    }
    if (!current?.id) return; // still no ID — silently abort

    setGeneratingPage(slideId);
    setPreviewSlideId(slideId);
    try {
      // For agenda: inject the actual selected slide list
      let pageContentPrompt = slide?.content_prompt ?? "";
      let pageGenContent = slide?.generated_content ?? "";
      if (slideId === "agenda") {
        const SKIP_IDS = new Set(["cover", "confidentiality", "agenda"]);
        const agendaItems = slides
          .filter(s => s.is_selected && !SKIP_IDS.has(s.slide_id))
          .sort((a, b) => a.order - b.order)
          .map((s, i) => `${i + 1}. ${s.title}`)
          .join("\n");
        pageContentPrompt += `\n\n=== CURRENT SELECTED SLIDES (use this exact list) ===\n${agendaItems}`;
        if (!pageGenContent) pageGenContent = agendaItems;
      }

      const res = await fetch(`/api/proposals/${current.id}/generate-page`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slide_id: slideId,
          visual_prompt: slide?.visual_prompt ?? "",
          content_prompt: pageContentPrompt,
          generated_content: pageGenContent,
          include_quality_score: enableQualityScore,
        }),
      });
      if (!res.ok) throw new Error("Page generation failed");
      const data = await res.json();
      setPreviewHtml(prev => ({ ...prev, [slideId]: data.html }));
      updateSlideField(slideId, "preview_html", data.html);
      if (data.quality_score) {
        setSlideScores(prev => ({ ...prev, [slideId]: data.quality_score }));
        updateSlideField(slideId, "quality_score", data.quality_score);
      }
      toast({ title: `Page preview ready for "${slide?.title}"` });
    } catch (err: any) {
      toast({ title: "Page generation failed", description: err.message, variant: "destructive" });
    }
    setGeneratingPage(null); apiCallDone();
  }

  // Download single slide as PPTX
  async function downloadSlidePptx(slideId: string) {
    if (!current?.id) return;
    try {
      const res = await fetch(`/api/proposals/${current.id}/download-slide`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slide_id: slideId }),
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const slide = slides.find(s => s.slide_id === slideId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slide?.title ?? slideId}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  }

  // Chat modification for slide preview
  async function sendSlideChat(slideId: string) {
    if (!slideChatInput.trim() || !current?.id) return;
    if (!await confirmApiUsage("Modify slide via chat")) return;
    const instruction = slideChatInput.trim();
    setSlideChatInput("");
    setSlideChatHistory(prev => ({
      ...prev,
      [slideId]: [...(prev[slideId] ?? []), { role: "user" as const, text: instruction }],
    }));
    setSlideChatLoading(true);
    try {
      const slide = slides.find(s => s.slide_id === slideId);
      const res = await fetch(`/api/proposals/${current.id}/generate-page`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slide_id: slideId,
          visual_prompt: slide?.visual_prompt ?? "",
          content_prompt: slide?.content_prompt ?? "",
          generated_content: slide?.generated_content ?? "",
          chat_instruction: instruction,
          current_html: previewHtml[slideId] ?? "",
        }),
      });
      if (!res.ok) throw new Error("Modification failed");
      const { html } = await res.json();
      setPreviewHtml(prev => ({ ...prev, [slideId]: html }));
      updateSlideField(slideId, "preview_html", html);
      setSlideChatHistory(prev => ({
        ...prev,
        [slideId]: [...(prev[slideId] ?? []), { role: "ai" as const, text: "Page updated." }],
      }));
    } catch (err: any) {
      setSlideChatHistory(prev => ({
        ...prev,
        [slideId]: [...(prev[slideId] ?? []), { role: "ai" as const, text: `Error: ${err.message}` }],
      }));
    }
    setSlideChatLoading(false); apiCallDone();
  }

  // Update prompts from chat corrections (learning loop)
  // Analyze uploaded reference image to improve prompts
  async function analyzeReferenceImage(slideId: string, file: File) {
    if (!await confirmApiUsage("Analyze reference image")) return;
    const slide = slides.find(s => s.slide_id === slideId);
    if (!slide) return;
    if (!current?.id) { await saveProgress(); await new Promise(r => setTimeout(r, 500)); }
    if (!current?.id) return;

    setAnalyzingRef(slideId);
    toast({ title: `Analyzing "${file.name}" for ${slide.title}...` });

    try {
      // Read file as base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // Store the reference image on the slide
      updateSlideField(slideId, "reference_image", `data:${file.type};base64,${base64}`);

      // Send to server for analysis
      const res = await fetch(`/api/proposals/${current.id}/analyze-reference`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slide_id: slideId,
          slide_title: slide.title,
          image_base64: base64,
          image_type: file.type,
          current_visual_prompt: slide.visual_prompt ?? "",
          current_content_prompt: slide.content_prompt ?? "",
        }),
      });
      if (!res.ok) throw new Error("Analysis failed");
      const data = await res.json();

      // Update prompts with analysis results
      if (data.visual_prompt_update) {
        updateSlideField(slideId, "visual_prompt",
          (slide.visual_prompt ?? "") + "\n\n--- Learned from reference image ---\n" + data.visual_prompt_update);
      }
      if (data.content_prompt_update) {
        updateSlideField(slideId, "content_prompt",
          (slide.content_prompt ?? "") + "\n\n--- Learned from reference image ---\n" + data.content_prompt_update);
      }
      await saveProgress();
      toast({ title: `Prompts updated from reference image for "${slide.title}"` });
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    }
    setAnalyzingRef(null); apiCallDone();
  }

  async function updatePromptsFromChat(slideId: string) {
    if (!await confirmApiUsage("Update prompts from feedback")) return;
    const history = slideChatHistory[slideId] ?? [];
    if (history.filter(m => m.role === "user").length === 0 || !current?.id) return;
    const slide = slides.find(s => s.slide_id === slideId);

    setUpdatingPrompts(true);
    try {
      const res = await fetch(`/api/proposals/${current.id}/update-prompts`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slide_id: slideId,
          chat_history: history,
          current_visual_prompt: slide?.visual_prompt ?? "",
          current_content_prompt: slide?.content_prompt ?? "",
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();

      // Show what will be added and apply
      let updated = false;
      if (data.visual_additions?.trim()) {
        const newVisual = (slide?.visual_prompt ?? "") + "\n\n--- Learned from feedback ---\n" + data.visual_additions;
        updateSlideField(slideId, "visual_prompt", newVisual);
        updated = true;
      }
      if (data.content_additions?.trim()) {
        const newContent = (slide?.content_prompt ?? "") + "\n\n--- Learned from feedback ---\n" + data.content_additions;
        updateSlideField(slideId, "content_prompt", newContent);
        updated = true;
      }
      if (updated) {
        await saveProgress();
        toast({ title: "Prompts updated with your feedback — future generations will incorporate these learnings" });
      } else {
        toast({ title: "No prompt changes needed from this feedback" });
      }
    } catch (err: any) {
      toast({ title: "Failed to update prompts", variant: "destructive" });
    }
    setUpdatingPrompts(false); apiCallDone();
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
      project_approach: projectApproach || null,
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
      if (!briefRes.ok) {
        const err = await briefRes.json().catch(() => ({ message: "Brief generation failed" }));
        throw new Error(err.message || "Brief generation failed");
      }
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
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Parse failed" }));
        throw new Error(err.message || "Parse failed");
      }
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

  // ── Step 2: Parse slide template instructions via bulk-parse ──────────────

  async function parseSlideInstructions() {
    if (!slideInstructionsText.trim()) return;
    setSlideInstructionsParsing(true);
    try {
      const res = await fetch("/api/slide-methodology/bulk-parse", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions: slideInstructionsText }),
      });
      if (!res.ok) throw new Error("Parse failed");
      const result = await res.json();
      toast({ title: `Updated ${result.updated_count || 0} slide templates` });
      setShowSlideInstructions(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setSlideInstructionsParsing(false);
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

  // ── Save progress at any step (without advancing) ──────────────────────────
  async function saveProgress() {
    setSaving(true);
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
      project_approach: projectApproach || null,
      slide_selection: slides,
      slide_briefs: briefs,
      call_checklist: callChecklist,
      status: current?.status || "draft",
      options: current?.options || [],
      created_at: current?.created_at || now,
      updated_at: now,
    };
    try {
      if (current?.id) {
        const res = await fetch(`/api/proposals/${current.id}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const updated = await res.json();
        setCurrent(updated);
      } else {
        const res = await fetch("/api/proposals", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const created = await res.json();
        setCurrent(created);
      }
      loadProposals();
      toast({ title: "Progress saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
    setSaving(false);
  }

  // ── Knowledge Center ──────────────────────────────────────────────────────
  async function loadKnowledge() {
    try {
      const res = await fetch("/api/knowledge", { credentials: "include" });
      if (res.ok) { const d = await res.json(); setKnowledgeFiles(d.files ?? []); }
    } catch { /* silent */ }
  }
  useEffect(() => { loadKnowledge(); }, []);

  async function uploadKnowledgeFile(file: File, category: string) {
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      try {
        await fetch("/api/knowledge", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category, filename: file.name, file_data: base64, file_size: file.size }),
        });
        toast({ title: `Uploaded: ${file.name}` });
        loadKnowledge();
      } catch { toast({ title: "Upload failed", variant: "destructive" }); }
    };
    reader.readAsDataURL(file);
  }

  async function deleteKnowledgeFile(id: number) {
    await fetch(`/api/knowledge/${id}`, { method: "DELETE", credentials: "include" }).catch(() => {});
    loadKnowledge();
  }

  // ── Project Approach ────────────────────────────────────────────────────────
  async function suggestApproach() {
    if (!await confirmApiUsage("Suggest project approach")) return;
    if (!current?.id) { await saveProgress(); await new Promise(r => setTimeout(r, 500)); }
    if (!current?.id) return;
    setGeneratingApproach(true);
    try {
      const res = await fetch(`/api/proposals/${current.id}/suggest-approach`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error("Generation failed");
      const { approach } = await res.json();
      setProjectApproach(approach);
      toast({ title: "Project approach generated" });
    } catch (err: any) {
      toast({ title: "Failed to generate approach", description: err.message, variant: "destructive" });
    }
    setGeneratingApproach(false); apiCallDone();
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
              {autoSaving && (
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" /> saving...
                </span>
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
              <span className={`text-sm ${step === n ? "font-medium cursor-pointer" : step > n ? "text-foreground cursor-pointer" : "text-muted-foreground"}`}
                onClick={() => {
                  if (n < step) setStep(n);
                  // Clicking current step resets to full view (collapse panels)
                  if (n === step) { setExpandedSlidePanel(null); setPreviewSlideId(null); }
                }}
              >{label}</span>
              {n < WIZARD_STEPS.length && <div className={`w-8 h-0.5 ${step > n ? "bg-green-500" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        {/* ── Step 1: Input Form ─────────────────────────────────────────── */}
        {step === 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            {/* ── Left: Input Fields ──────────────────────────────────── */}
            <Card className="lg:col-span-3 p-4">
              <h3 className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Proposal Inputs</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="col-span-2">
                  <label className="text-[11px] font-medium mb-0.5 block">Company Name *</label>
                  <Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Acme Corp" className="h-8 text-xs" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] font-medium mb-0.5 block">Website</label>
                  <Input value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[11px] font-medium mb-0.5 block">Revenue (EUR M)</label>
                  <Input type="number" value={form.revenue} onChange={e => setForm(f => ({ ...f, revenue: e.target.value }))} placeholder="150" className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[11px] font-medium mb-0.5 block">EBITDA Margin %</label>
                  <Input type="number" value={form.ebitda_margin} onChange={e => setForm(f => ({ ...f, ebitda_margin: e.target.value }))} placeholder="12" className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[11px] font-medium mb-0.5 block">Objective</label>
                  <Input value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} placeholder="Improve commercial..." className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[11px] font-medium mb-0.5 block">Urgency</label>
                  <select
                    className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                    value={form.urgency}
                    onChange={e => setForm(f => ({ ...f, urgency: e.target.value }))}
                  >
                    {URGENCY_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] font-medium mb-0.5 block">Scope / Perimeter</label>
                  <Textarea value={form.scope_perimeter} onChange={e => setForm(f => ({ ...f, scope_perimeter: e.target.value }))} placeholder="Functions, geographies, products..." rows={1} className="text-xs min-h-[32px]" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] font-medium mb-0.5 block">Call Transcript / Notes</label>
                  <Textarea value={form.transcript} onChange={e => setForm(f => ({ ...f, transcript: e.target.value }))} placeholder="Paste transcript or key notes..." rows={2} className="text-xs" />
                </div>
                <div className="col-span-4">
                  <label className="text-[11px] font-medium mb-0.5 block">Additional Notes</label>
                  <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Anything else relevant..." rows={1} className="text-xs min-h-[32px]" />
                </div>
              </div>
              {/* ── Project Approach ──────────────────────────────── */}
              <div className="border-t pt-3 mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Project Approach</h4>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] border-violet-300 text-violet-700 hover:bg-violet-50"
                    onClick={suggestApproach} disabled={generatingApproach || !form.company_name}>
                    {generatingApproach ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Generating...</>
                      : <><Sparkles className="w-3 h-3 mr-1" />Suggest Approach (AI)</>}
                  </Button>
                </div>
                {projectApproach ? (
                  <Textarea
                    value={(() => {
                      try { return JSON.stringify(JSON.parse(projectApproach), null, 2); } catch { return projectApproach; }
                    })()}
                    onChange={e => setProjectApproach(e.target.value)}
                    rows={8}
                    className="text-[10px] font-mono"
                  />
                ) : (
                  <p className="text-[10px] text-muted-foreground italic">
                    Click "Suggest Approach" to generate team, duration, workstreams based on your inputs and knowledge files.
                  </p>
                )}
              </div>

              <div className="flex justify-end mt-3">
                <Button size="sm" onClick={handleGoToSlides}>
                  Choose Slides <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </Card>

            {/* ── Right: Intro Call Checklist ─────────────────────────── */}
            <Card className="lg:col-span-2 p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Intro Call Questions</h3>
                <span className="text-[10px] text-muted-foreground">
                  {callChecklist.filter(c => c.checked).length}/{callChecklist.length} answered
                </span>
              </div>
              <div className="w-full h-1 bg-muted rounded-full mb-2 overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${callChecklist.length > 0 ? (callChecklist.filter(c => c.checked).length / callChecklist.length) * 100 : 0}%` }}
                />
              </div>
              <div className="space-y-0.5 max-h-[calc(100vh-280px)] overflow-y-auto">
                {callChecklist.map((item, idx) => (
                  <div
                    key={idx}
                    className={`group flex items-start gap-1.5 px-1.5 py-1 rounded transition-colors ${
                      item.checked ? "bg-green-50 dark:bg-green-950/20" : "hover:bg-accent/30"
                    }`}
                  >
                    <button
                      className={`mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                        item.checked
                          ? "bg-green-500 border-green-500 text-white"
                          : "border-muted-foreground/40 hover:border-primary"
                      }`}
                      onClick={() => setCallChecklist(prev => prev.map((c, i) => i === idx ? { ...c, checked: !c.checked } : c))}
                    >
                      {item.checked && <Check className="w-2.5 h-2.5" />}
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
                        <span
                          className={`text-[11px] text-left w-full leading-snug cursor-pointer ${
                            item.checked ? "text-muted-foreground line-through" : "text-foreground"
                          }`}
                          onClick={() => setEditingQuestion(idx)}
                          title="Click to edit question"
                        >
                          <span className="text-muted-foreground mr-1.5">{idx + 1}.</span>
                          {item.question}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="p-1 rounded hover:bg-accent"
                        onClick={() => setEditingQuestion(idx)}
                        title="Edit question"
                      >
                        <Pencil className="w-3 h-3 text-muted-foreground" />
                      </button>
                      <button
                        className="p-1 rounded hover:bg-destructive/10"
                        onClick={() => setCallChecklist(prev => prev.filter((_, i) => i !== idx))}
                        title="Delete question"
                      >
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </button>
                    </div>
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

            {/* Save + Next */}
            <div className="flex justify-between pt-1 lg:col-span-5">
              <Button variant="outline" size="sm" onClick={saveProgress} disabled={saving || !form.company_name}>
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                Save Progress
              </Button>
              <Button size="sm" onClick={() => setStep(2)} disabled={!form.company_name}>
                Select Slides
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Project Type & Slide Selection ─────────────────────── */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Slide template instructions popup */}
            {showSlideInstructions && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <Card className="p-6 max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <FileText className="w-5 h-5" /> Slide Template Instructions
                    </h3>
                    <Button variant="ghost" size="sm" onClick={() => setShowSlideInstructions(false)}><X className="w-4 h-4" /></Button>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    Paste instructions on how to populate each slide. The AI will parse them and automatically update the methodology config for each slide (purpose, structure, rules, examples).
                  </p>
                  <Textarea
                    value={slideInstructionsText}
                    onChange={e => setSlideInstructionsText(e.target.value)}
                    rows={20}
                    className="flex-1 text-sm font-mono"
                    placeholder={`Paste your slide-by-slide instructions here...

Example:
## Executive Summary
- Purpose: Enable decision-maker to understand context, recommendation and impact in one page
- Must include Top 3 priorities
- Must be quantified (revenue, margin, FTE impact)
- Format: 3-column with insight bar
- Column 1: Context / problem
- Column 2: Recommendation / approach
- Column 3: Impact / value

## Context
- Purpose: Show client situation and urgency drivers
- Include business model, key challenges, performance gaps
- Must reference specific data points from transcript...`}
                  />
                  <div className="flex justify-end gap-2 mt-4">
                    <Button variant="outline" onClick={() => setShowSlideInstructions(false)}>Cancel</Button>
                    <Button onClick={parseSlideInstructions} disabled={slideInstructionsParsing || !slideInstructionsText.trim()}>
                      {slideInstructionsParsing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                      Parse & Apply to Slides
                    </Button>
                  </div>
                </Card>
              </div>
            )}

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
                  <Button variant="outline" size="sm" onClick={() => setShowFullSlideView(true)}>
                    <Eye className="w-4 h-4 mr-1" /> Preview All Slides
                  </Button>
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
            {slides.length > 0 && (() => {
              const coreSlides = slides.filter(s => s.group === "core");
              const optionalSlides = slides.filter(s => s.group === "optional");
              const suggestedCount = optionalSlides.filter(s => s.is_suggested).length;

              function renderSlideRow(slide: SlideSelectionEntry, idx: number, globalIdx: number) {
                const masterDef = MASTER_SLIDES.find(m => m.slide_id === slide.slide_id);
                const isExpanded = expandedSlidePanel?.slideId === slide.slide_id;
                const activePanel = expandedSlidePanel?.panel;
                const isGen = slideGenerating === slide.slide_id;
                const questions = slideFollowUpQs[slide.slide_id] ?? [];

                return (
                  <React.Fragment key={slide.slide_id}>
                    <div
                      draggable
                      onDragStart={() => { setExpandedSlidePanel(null); handleDragStart(globalIdx); }}
                      onDragEnter={() => handleDragEnter(globalIdx)}
                      onDragEnd={handleDragEnd}
                      onDragOver={e => e.preventDefault()}
                      className={`flex items-center gap-3 px-4 py-2.5 transition-colors cursor-grab active:cursor-grabbing ${
                        slide.is_selected ? "bg-primary/5" :
                        slide.is_suggested && !slide.is_selected ? "bg-amber-50 dark:bg-amber-950/20" :
                        "bg-background opacity-60"
                      }`}
                    >
                      <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex flex-col gap-0.5">
                        <button className="text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => moveSlide(globalIdx, "up")} disabled={globalIdx === 0}>
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button className="text-muted-foreground hover:text-foreground disabled:opacity-30" onClick={() => moveSlide(globalIdx, "down")} disabled={globalIdx === slides.length - 1}>
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <button
                        onClick={() => toggleSlide(slide.slide_id)}
                        className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          slide.is_selected ? "bg-primary border-primary text-primary-foreground" : "border-input hover:border-primary"
                        }`}
                      >
                        {slide.is_selected && <Check className="w-3 h-3" />}
                      </button>
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
                        // ONLY show existing preview — NEVER auto-generate (costs money)
                        if (previewHtml[slide.slide_id]) { setPreviewSlideId(slide.slide_id); }
                        else { toggleSlidePanel(slide.slide_id, "generate"); }
                      }}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-medium ${slide.is_selected ? "" : "text-muted-foreground"} cursor-text`}
                            onDoubleClick={e => {
                              e.stopPropagation();
                              const newName = window.prompt("Rename slide:", slide.title);
                              if (newName?.trim() && newName.trim() !== slide.title) {
                                updateSlideField(slide.slide_id, "title", newName.trim());
                              }
                            }}
                            title="Double-click to rename"
                          >{slide.title}</span>
                          <button
                            title="Rename slide"
                            onClick={e => {
                              e.stopPropagation();
                              const newName = window.prompt("Rename slide:", slide.title);
                              if (newName?.trim() && newName.trim() !== slide.title) {
                                updateSlideField(slide.slide_id, "title", newName.trim());
                              }
                            }}
                            className="p-0.5 rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors shrink-0"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          {slide.group === "core" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-medium">CORE</span>
                          )}
                          {slide.is_suggested && !slide.is_selected && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium animate-pulse">SUGGESTED</span>
                          )}
                          {slide.generated_content && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">GENERATED</span>
                          )}
                        </div>
                        {masterDef && <p className="text-xs text-muted-foreground truncate">{masterDef.description}</p>}
                      </div>
                      {/* Per-slide prompt buttons */}
                      {slide.is_selected && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button title="Visual Instructions" onClick={e => { e.stopPropagation(); toggleSlidePanel(slide.slide_id, "visual"); }}
                            className={`p-1.5 rounded hover:bg-muted transition-colors ${
                              isExpanded && activePanel === "visual" ? "bg-primary/10 text-primary"
                              : slide.visual_prompt?.trim() ? "text-blue-600 bg-blue-50"
                              : "text-muted-foreground"
                            }`}>
                            <ImageIcon className="w-3.5 h-3.5" />
                          </button>
                          <button title="Content Prompt" onClick={e => { e.stopPropagation(); toggleSlidePanel(slide.slide_id, "content"); }}
                            className={`p-1.5 rounded hover:bg-muted transition-colors ${
                              isExpanded && activePanel === "content" ? "bg-primary/10 text-primary"
                              : slide.content_prompt?.trim() ? "text-blue-600 bg-blue-50"
                              : "text-muted-foreground"
                            }`}>
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                          <button title="Generate Content (opens panel)" onClick={e => { e.stopPropagation(); toggleSlidePanel(slide.slide_id, "generate"); }}
                            disabled={isGen}
                            className={`p-1.5 rounded hover:bg-muted transition-colors ${isExpanded && activePanel === "generate" ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}>
                            {isGen ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                          </button>
                          <button title="Generate Page Preview (uses AI — costs money)" onClick={e => { e.stopPropagation(); generatePage(slide.slide_id); }}
                            disabled={generatingPage === slide.slide_id}
                            className={`p-1.5 rounded hover:bg-violet-100 transition-colors ${
                              previewSlideId === slide.slide_id && previewHtml[slide.slide_id] ? "text-emerald-600 bg-emerald-50"
                              : generatingPage === slide.slide_id ? "text-violet-600"
                              : "text-violet-500"
                            }`}>
                            {generatingPage === slide.slide_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <label title="Upload reference image (uses AI — costs money)"
                            className={`p-1.5 rounded hover:bg-violet-100 transition-colors cursor-pointer ${
                              analyzingRef === slide.slide_id ? "text-violet-600 animate-pulse"
                              : slide.reference_image ? "text-violet-600 bg-violet-50"
                              : "text-violet-500"
                            }`}>
                            {analyzingRef === slide.slide_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            <input type="file" className="hidden" accept="image/*"
                              disabled={analyzingRef === slide.slide_id}
                              onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) analyzeReferenceImage(slide.slide_id, file);
                                e.target.value = "";
                              }} />
                          </label>
                        </div>
                      )}
                      <button title="Delete slide" onClick={e => {
                        e.stopPropagation();
                        if (window.confirm(`Remove "${slide.title}" from the list?`)) {
                          setSlides(prev => prev.filter(s => s.slide_id !== slide.slide_id).map((s, i) => ({ ...s, order: i })));
                          setHasManualEdits(true);
                          if (expandedSlidePanel?.slideId === slide.slide_id) setExpandedSlidePanel(null);
                        }
                      }}
                        className="p-1 rounded hover:bg-red-50 text-muted-foreground/30 hover:text-red-500 transition-colors shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-xs text-muted-foreground w-6 text-right shrink-0">{globalIdx + 1}</span>
                    </div>

                    {/* Inline expansion panel */}
                    {isExpanded && (
                      <div className="px-6 py-3 bg-muted/20 border-t border-dashed space-y-2">
                        {activePanel === "visual" && (
                          <>
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                <ImageIcon className="w-3 h-3" /> Visual Instructions
                              </div>
                              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={saveProgress} disabled={saving}>
                                {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                                Save
                              </Button>
                            </div>
                            <Textarea
                              value={slide.visual_prompt ?? ""}
                              onChange={e => updateSlideField(slide.slide_id, "visual_prompt", e.target.value)}
                              placeholder={slideDefaultPrompts[slide.slide_id]?.visual || "Describe how this slide should look: layout, columns, imagery, branding..."}
                              rows={12}
                              className="text-xs"
                            />
                          </>
                        )}

                        {activePanel === "content" && (
                          <>
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                <FileText className="w-3 h-3" /> Content Prompt
                              </div>
                              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={saveProgress} disabled={saving}>
                                {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                                Save
                              </Button>
                            </div>
                            <Textarea
                              value={slide.content_prompt ?? ""}
                              onChange={e => updateSlideField(slide.slide_id, "content_prompt", e.target.value)}
                              placeholder={slideDefaultPrompts[slide.slide_id]?.content || "Define the workflow/questions to guide content generation for this slide..."}
                              rows={20}
                              className="text-xs font-mono"
                            />
                          </>
                        )}

                        {activePanel === "generate" && (
                          <>
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                <Sparkles className="w-3 h-3" /> Content for "{slide.title}"
                              </div>
                              <div className="flex items-center gap-1.5">
                                {!slide.generated_content && !isGen && (
                                  <Button size="sm" variant="outline" className="h-6 text-[10px] border-violet-300 text-violet-700 hover:bg-violet-50" onClick={() => generateSlideContent(slide.slide_id)}>
                                    <Sparkles className="w-3 h-3 mr-1" /> Auto-generate (AI)
                                  </Button>
                                )}
                                {slide.generated_content && (
                                  <Button size="sm" variant="outline" className="h-6 text-[10px] border-violet-300 text-violet-700 hover:bg-violet-50" onClick={() => generateSlideContent(slide.slide_id)} disabled={isGen}>
                                    {isGen ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
                                    Regenerate (AI)
                                  </Button>
                                )}
                                <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={saveProgress} disabled={saving}>
                                  {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                                  Save
                                </Button>
                              </div>
                            </div>

                            {isGen && (
                              <div className="flex items-center gap-2 py-4 justify-center text-xs text-muted-foreground border rounded bg-violet-50">
                                <Loader2 className="w-4 h-4 animate-spin text-violet-600" /> Generating content — this may take 5-10 seconds...
                              </div>
                            )}

                            {/* Editable generated content */}
                            {slide.generated_content && !isGen && (
                              <Textarea
                                value={slide.generated_content}
                                onChange={e => updateSlideField(slide.slide_id, "generated_content", e.target.value)}
                                rows={10}
                                className="text-xs font-mono"
                                placeholder="Generated content will appear here. You can edit it before previewing."
                              />
                            )}

                            {!slide.generated_content && !isGen && (
                              <div className="text-[11px] text-muted-foreground py-2">
                                Click "Auto-generate" to create content using your visual instructions, content prompt, and proposal context.
                                Or type content directly below:
                                <Textarea
                                  value=""
                                  onChange={e => updateSlideField(slide.slide_id, "generated_content", e.target.value)}
                                  rows={6}
                                  className="text-xs font-mono mt-1"
                                  placeholder="Type or paste slide content here..."
                                />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </React.Fragment>
                );
              }

              return (
                <div className={`grid grid-cols-1 gap-4 ${previewSlideId && previewHtml[previewSlideId] ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
                  {/* Left: Grouped slide list */}
                  <div className={`space-y-4 ${previewSlideId && previewHtml[previewSlideId] ? "" : "lg:col-span-2"}`}>
                    {/* Core Pages — hidden when editing an optional slide */}
                    <Card className={`p-0 overflow-hidden ${expandedSlidePanel && optionalSlides.some(s => s.slide_id === expandedSlidePanel.slideId) ? "hidden" : ""}`}>
                      <div className="px-4 py-3 border-b bg-blue-50 dark:bg-blue-950/30">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-semibold flex items-center gap-2">
                              Core Pages
                              <span className="text-xs font-normal text-muted-foreground">({coreSlides.filter(s => s.is_selected).length}/{coreSlides.length} selected)</span>
                            </h3>
                            <p className="text-xs text-muted-foreground">Always included in every proposal</p>
                          </div>
                        </div>
                      </div>
                      <div className="divide-y">
                        {slides.map((slide, globalIdx) => {
                          if (slide.group !== "core") return null;
                          // Hide other slides when a panel is expanded (focus mode)
                          if (expandedSlidePanel && expandedSlidePanel.slideId !== slide.slide_id) return null;
                          const coreIdx = coreSlides.indexOf(slide);
                          return renderSlideRow(slide, coreIdx, globalIdx);
                        })}
                      </div>
                      <div className="px-4 py-2 border-t bg-muted/10">
                        <button
                          onClick={() => {
                            const name = window.prompt("New core slide title:");
                            if (!name?.trim()) return;
                            const id = "custom_" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
                            setSlides(prev => {
                              const lastCore = prev.filter(s => s.group === "core").length;
                              const entry: SlideSelectionEntry = {
                                slide_id: id, title: name.trim(), is_selected: true,
                                default_selected: false, is_suggested: false, group: "core", order: lastCore,
                              };
                              const next = [...prev];
                              next.splice(lastCore, 0, entry);
                              return next.map((s, i) => ({ ...s, order: i }));
                            });
                            setHasManualEdits(true);
                          }}
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add core slide
                        </button>
                      </div>
                    </Card>

                    {/* Optional Pages — hidden when editing a core slide */}
                    <Card className={`p-0 overflow-hidden ${expandedSlidePanel && coreSlides.some(s => s.slide_id === expandedSlidePanel.slideId) ? "hidden" : ""}`}>
                      <div className="px-4 py-3 border-b bg-amber-50 dark:bg-amber-950/30">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-semibold flex items-center gap-2">
                              Optional Pages
                              <span className="text-xs font-normal text-muted-foreground">({optionalSlides.filter(s => s.is_selected).length}/{optionalSlides.length} selected)</span>
                            </h3>
                            <p className="text-xs text-muted-foreground">
                              Add based on project needs
                              {suggestedCount > 0 && (
                                <span className="ml-1 text-amber-600 font-medium">
                                  — {suggestedCount} suggested for {projectType}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="divide-y max-h-[400px] overflow-y-auto">
                        {slides.map((slide, globalIdx) => {
                          if (slide.group !== "optional") return null;
                          if (expandedSlidePanel && expandedSlidePanel.slideId !== slide.slide_id) return null;
                          const optIdx = optionalSlides.indexOf(slide);
                          return renderSlideRow(slide, optIdx, globalIdx);
                        })}
                      </div>
                      <div className="px-4 py-2 border-t bg-muted/10">
                        <button
                          onClick={() => {
                            const name = window.prompt("New optional slide title:");
                            if (!name?.trim()) return;
                            const id = "custom_" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
                            setSlides(prev => {
                              const entry: SlideSelectionEntry = {
                                slide_id: id, title: name.trim(), is_selected: true,
                                default_selected: false, is_suggested: false, group: "optional", order: prev.length,
                              };
                              return [...prev, entry].map((s, i) => ({ ...s, order: i }));
                            });
                            setHasManualEdits(true);
                          }}
                          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add optional slide
                        </button>
                      </div>
                    </Card>
                  </div>

                  {/* Right: Preview panel OR slide list */}
                  <div>
                    {previewSlideId && previewHtml[previewSlideId] ? (
                      /* ── Slide Preview ─────────────────────────────── */
                      <Card className="p-0 overflow-hidden sticky top-20">
                        <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
                          <div>
                            <h3 className="text-xs font-semibold">{slides.find(s => s.slide_id === previewSlideId)?.title ?? "Preview"}</h3>
                            <p className="text-[10px] text-muted-foreground">Slide preview</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="outline" className="h-7 text-[10px]"
                              onClick={() => downloadSlidePptx(previewSlideId)}>
                              <Download className="w-3 h-3 mr-1" /> PPTX
                            </Button>
                            <button onClick={() => setPreviewSlideId(null)}
                              className="p-1 rounded hover:bg-muted text-muted-foreground">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {/* Preview with font inspector */}
                        <div className="bg-gray-100 p-2 relative group">
                          <div className="bg-white shadow-lg mx-auto" style={{ width: "100%", aspectRatio: "16/9", overflow: "hidden", position: "relative" }}>
                            <div
                              ref={el => {
                                if (!el) return;
                                // Remove ALL existing popups first
                                const clearPopups = () => document.querySelectorAll(".font-inspector-popup").forEach(p => p.remove());

                                // Single popup on hover — only 1 at a time
                                el.addEventListener("mouseover", (e: MouseEvent) => {
                                  const target = e.target as HTMLElement;
                                  if (!target || target === el) return;
                                  clearPopups();
                                  const computed = window.getComputedStyle(target);
                                  const popup = document.createElement("div");
                                  popup.className = "font-inspector-popup";
                                  popup.style.cssText = "position:fixed;z-index:9999;background:#1e293b;color:white;padding:4px 8px;border-radius:4px;font-size:10px;font-family:Arial;pointer-events:none;display:flex;align-items:center;gap:6px;box-shadow:0 2px 8px rgba(0,0,0,0.3);";
                                  popup.style.left = (e.clientX + 10) + "px";
                                  popup.style.top = (e.clientY - 30) + "px";
                                  popup.textContent = `Arial ${computed.fontSize} ${parseInt(computed.fontWeight) >= 700 ? "Bold" : ""}`;
                                  document.body.appendChild(popup);
                                });

                                // Clear popup when mouse leaves the preview entirely
                                el.addEventListener("mouseleave", clearPopups);
                              }}
                              dangerouslySetInnerHTML={{ __html: previewHtml[previewSlideId] }}
                              style={{ transform: "scale(0.7)", transformOrigin: "top left", width: "143%", height: "143%", fontFamily: "Arial, sans-serif" }}
                            />
                          </div>
                          <div className="absolute bottom-3 left-3 text-[9px] text-muted-foreground/50 bg-white/80 px-1.5 py-0.5 rounded">
                            Hover text to inspect font — use ±  to resize
                          </div>
                        </div>
                        {/* Chat for modifications */}
                        <div className="border-t p-2 space-y-2">
                          <div className="max-h-28 overflow-y-auto space-y-1">
                            {(slideChatHistory[previewSlideId] ?? []).map((msg, i) => (
                              <div key={i} className={`text-[10px] px-2 py-1 rounded ${
                                msg.role === "user" ? "bg-primary/10 text-primary ml-4" : "bg-muted text-muted-foreground mr-4"
                              }`}>{msg.text}</div>
                            ))}
                          </div>
                          <div className="flex gap-1">
                            <Input
                              value={slideChatInput}
                              onChange={e => setSlideChatInput(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendSlideChat(previewSlideId); } }}
                              placeholder="Ask to modify..."
                              className="h-7 text-xs flex-1"
                              disabled={slideChatLoading}
                            />
                            <Button size="sm" className="h-7 text-[10px] shrink-0 bg-violet-600 hover:bg-violet-700 text-white"
                              onClick={() => sendSlideChat(previewSlideId)} disabled={slideChatLoading || !slideChatInput.trim()}>
                              {slideChatLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Send (AI)"}
                            </Button>
                          </div>
                          {/* Update Prompts — learn from chat corrections */}
                          {(slideChatHistory[previewSlideId] ?? []).filter(m => m.role === "user").length > 0 && (
                            <Button size="sm" variant="outline" className="w-full h-7 text-[10px] mt-1 border-violet-300 text-violet-700 hover:bg-violet-50"
                              onClick={() => updatePromptsFromChat(previewSlideId)} disabled={updatingPrompts}>
                              {updatingPrompts ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Learning...</>
                                : <><Sparkles className="w-3 h-3 mr-1" />Update Prompts from Feedback (AI)</>}
                            </Button>
                          )}
                        </div>
                        {/* Quality Score toggle + display */}
                        <div className="border-t px-3 py-2 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input type="checkbox" checked={enableQualityScore}
                                onChange={e => setEnableQualityScore(e.target.checked)}
                                className="w-3 h-3 rounded" />
                              <span className="text-[10px] font-semibold text-muted-foreground uppercase">Quality Score</span>
                              <span className="text-[8px] text-violet-500">(AI)</span>
                            </label>
                            {slideScores[previewSlideId] && (
                              <span className={`text-sm font-bold ${
                                (slideScores[previewSlideId].total ?? 0) >= 80 ? "text-emerald-600" :
                                (slideScores[previewSlideId].total ?? 0) >= 60 ? "text-amber-600" : "text-red-500"
                              }`}>{slideScores[previewSlideId].total ?? 0}%</span>
                            )}
                          </div>
                          {slideScores[previewSlideId] && (() => {
                            const sc = slideScores[previewSlideId];
                            const barColor = (sc.total ?? 0) >= 80 ? "bg-emerald-500" : (sc.total ?? 0) >= 60 ? "bg-amber-500" : "bg-red-500";
                            return (
                              <>
                                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${sc.total}%` }} />
                                </div>
                                <div className="grid grid-cols-4 gap-1 text-[8px]">
                                  <div className="text-center"><div className="font-bold">{sc.clarity ?? 0}</div><div className="text-muted-foreground">Clarity</div></div>
                                  <div className="text-center"><div className="font-bold">{sc.relevance ?? 0}</div><div className="text-muted-foreground">Relevance</div></div>
                                  <div className="text-center"><div className="font-bold">{sc.visual ?? 0}</div><div className="text-muted-foreground">Visual</div></div>
                                  <div className="text-center"><div className="font-bold">{sc.persuasion ?? 0}</div><div className="text-muted-foreground">Persuasion</div></div>
                                </div>
                                {sc.tip && <p className="text-[9px] text-muted-foreground italic">{sc.tip}</p>}
                              </>
                            );
                          })()}
                          {!enableQualityScore && !slideScores[previewSlideId] && (
                            <p className="text-[9px] text-muted-foreground italic">Enable to score slides on clarity, relevance, visual impact, and persuasion</p>
                          )}
                        </div>
                      </Card>
                    ) : (
                      /* ── Selected Slides Summary ────────────────────── */
                      <Card className="p-0 overflow-hidden sticky top-20">
                        <div className="px-3 py-2 border-b bg-muted/30">
                          <h3 className="text-xs font-semibold">Selected Slides ({selectedSlideCount})</h3>
                          <p className="text-[10px] text-muted-foreground">
                            {coreSlides.filter(s => s.is_selected).length} core + {optionalSlides.filter(s => s.is_selected).length} optional
                          </p>
                        </div>
                        <div className="p-2 max-h-[540px] overflow-y-auto">
                          {slides.filter(s => s.is_selected).length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4">No slides selected</p>
                          ) : (
                            <ol className="space-y-0.5">
                              {slides.filter(s => s.is_selected).map((s, i) => (
                                <li key={s.slide_id} className="flex items-center gap-1.5 text-xs py-0.5">
                                  <span className="text-[10px] text-muted-foreground w-4 text-right">{i + 1}.</span>
                                  <span className="truncate">{s.title}</span>
                                  {s.group === "optional" && (
                                    <span className="text-[8px] px-1 rounded bg-amber-100 text-amber-600 shrink-0">OPT</span>
                                  )}
                                  {previewHtml[s.slide_id] && (
                                    <button onClick={() => setPreviewSlideId(s.slide_id)}
                                      className="text-emerald-600 hover:text-emerald-700 shrink-0" title="Show preview">
                                      <Eye className="w-3 h-3" />
                                    </button>
                                  )}
                                  <button onClick={() => toggleSlide(s.slide_id)}
                                    className="ml-auto text-muted-foreground hover:text-destructive shrink-0">
                                    <X className="w-3 h-3" />
                                  </button>
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      </Card>
                    )}
                  </div>
                </div>
              );
            })()}

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
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowSlideInstructions(true)}>
                  <FileText className="w-4 h-4 mr-1" /> Slide Template Instructions
                </Button>
                <Button variant="outline" onClick={saveProgress} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                  Save Progress
                </Button>
                <Button onClick={handleSubmitSlides} disabled={saving || !projectType}>
                  {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <BookOpen className="w-4 h-4 mr-1" />}
                  Continue to Briefing
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
            {/* ── Full Slide View (overlay) ─────────────────────── */}
            {showFullSlideView && (
              <div className="fixed inset-0 bg-black/60 z-50 flex flex-col">
                <div className="flex items-center justify-between px-6 py-3 bg-background border-b">
                  <h2 className="text-sm font-bold">All Slides — {slides.filter(s => s.is_selected).length} pages</h2>
                  <Button size="sm" variant="ghost" onClick={() => setShowFullSlideView(false)}>
                    <X className="w-4 h-4 mr-1" /> Close
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 bg-gray-200">
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
                    {slides.filter(s => s.is_selected).sort((a, b) => a.order - b.order).map((s, i) => (
                      <div key={s.slide_id} className="space-y-1">
                        <div className="text-[10px] text-muted-foreground font-mono">{i + 1}. {s.title}</div>
                        <div
                          className="bg-white shadow-lg rounded cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                          style={{ aspectRatio: "16/9", overflow: "hidden", position: "relative" }}
                          onClick={() => { setPreviewSlideId(s.slide_id); setShowFullSlideView(false); }}
                        >
                          {previewHtml[s.slide_id] ? (
                            <div
                              dangerouslySetInnerHTML={{ __html: previewHtml[s.slide_id] }}
                              style={{ transform: "scale(0.33)", transformOrigin: "top left", width: "303%", height: "303%", fontFamily: "Arial, sans-serif" }}
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full text-muted-foreground/30">
                              <div className="text-center">
                                <FileText className="w-8 h-8 mx-auto mb-1" />
                                <span className="text-[10px]">Not generated</span>
                              </div>
                            </div>
                          )}
                          {slideScores[s.slide_id] && (
                            <div className={`absolute bottom-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              slideScores[s.slide_id].total >= 80 ? "bg-emerald-500 text-white" :
                              slideScores[s.slide_id].total >= 60 ? "bg-amber-500 text-white" : "bg-red-500 text-white"
                            }`}>{slideScores[s.slide_id].total}%</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

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
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={saveBriefs} disabled={saving}>
                      {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                      Save Progress
                    </Button>
                    <Button onClick={handleSubmitBriefs} disabled={saving}>
                      {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                      Validate & Analyze with AI
                      <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(current.options || []).map((opt, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{opt.name}</TableCell>
                      <TableCell className="text-center">{opt.duration_weeks}</TableCell>
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
              <TableHead>Created</TableHead>
              <TableHead className="w-32"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposals.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No proposals yet. Click "New Proposal" to start.</TableCell></TableRow>
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
    onChange({ ...option, team });
  }

  return (
    <Card className="p-4 space-y-3 border-2 hover:border-primary/30 transition-colors">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-lg">{option.name}</h4>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">Duration (weeks)</label>
          <Input
            type="number"
            value={option.duration_weeks}
            onChange={e => onChange({ ...option, duration_weeks: Number(e.target.value) || 0 })}
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

    </Card>
  );
}
