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
  Wand2, TrendingUp, Maximize2, Minimize2, LayoutTemplate,
  Video, Users, Copy, RefreshCw, ExternalLink,
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

// Wizard order is: Input → Briefing → Analysis → Architecture → Deck → Generate.
// Deck used to sit at step 2 (right after Input) but it's been moved to slot 5
// so the flow becomes: enter info → write briefs → AI analyses → refine the
// architecture → lock the deck structure & preview slides → generate. Putting
// Deck last lets you finalise the slide selection AFTER you know what the AI
// actually produced, instead of guessing up front.
const WIZARD_STEPS = [
  { n: 1, label: "Input" },
  { n: 2, label: "Briefing" },
  { n: 3, label: "Analysis" },
  { n: 4, label: "Architecture" },
  { n: 5, label: "Deck" },
  { n: 6, label: "Generate" },
];

// ── Read.ai meetings card ─────────────────────────────────────────────────────
// Rendered on the Proposals list page. Fetches last 10 meetings from the
// backend proxy (which either hits Read.ai's live API via READ_AI_TOKEN
// or falls back to the seed). Green-badges conversations we think are
// client-facing — heuristic: at least one participant whose email domain
// is NOT eendigo.com and NOT a free-mail domain (gmail/hotmail/etc.).
// That's a rough but reliable signal — internal all-hands and personal
// emails won't fire; client emails from @coesia.com, @carlyle.com etc. will.

interface ReadAIParticipant { name: string | null; email: string | null; invited?: boolean; attended?: boolean }
interface ReadAIMeeting {
  id: string;
  start_time_ms: number;
  end_time_ms: number;
  title: string;
  report_url: string;
  folders: string[];
  participants: ReadAIParticipant[];
  summary: string | null;
}

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com",
  "yahoo.com", "yahoo.it", "icloud.com", "me.com", "aol.com", "proton.me",
  "protonmail.com", "pm.me", "mail.com", "gmx.com", "gmx.net",
]);

function isClientMeeting(m: ReadAIMeeting): boolean {
  const attended = m.participants.filter(p => p.attended !== false);
  for (const p of attended) {
    const email = (p.email || "").toLowerCase();
    if (!email) continue;
    const domain = email.split("@")[1] || "";
    if (!domain) continue;
    if (domain === "eendigo.com") continue;
    if (FREE_MAIL_DOMAINS.has(domain)) continue;
    // A corporate non-eendigo attendee = almost certainly a client/prospect.
    return true;
  }
  return false;
}

function ReadAIMeetingsCard() {
  const { toast } = useToast();
  const [meetings, setMeetings] = useState<ReadAIMeeting[]>([]);
  const [source, setSource] = useState<"live" | "seed" | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/read-ai/meetings", { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setMeetings(d.meetings ?? []);
        setSource(d.source ?? null);
      }
    } catch {
      // Best-effort; card just shows empty state on failure.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Copy full script to clipboard: title + metadata + summary + transcript
  // (if live source). Falls back to "just summary" when transcript isn't
  // cached — the user can still paste that into a new proposal draft.
  const copyScript = async (m: ReadAIMeeting) => {
    setCopying(m.id);
    try {
      let transcript: string | null = null;
      try {
        const r = await fetch(`/api/read-ai/meetings/${m.id}/transcript`, { credentials: "include" });
        if (r.ok) {
          const d = await r.json();
          transcript = typeof d.transcript === "string" ? d.transcript : null;
        }
      } catch { /* no-op */ }

      const attendees = m.participants
        .filter(p => p.attended !== false)
        .map(p => `${p.name ?? p.email ?? "?"}${p.email ? ` <${p.email}>` : ""}`)
        .join("\n  - ");
      const dateStr = new Date(m.start_time_ms).toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      });
      const lines = [
        `Meeting: ${m.title}`,
        `Date: ${dateStr}`,
        `Report: ${m.report_url}`,
        `Attendees:\n  - ${attendees}`,
        "",
        m.summary ? `Summary:\n${m.summary}` : "(No summary available)",
      ];
      if (transcript) {
        lines.push("", "Full transcript:", transcript);
      }
      const full = lines.join("\n");
      await navigator.clipboard.writeText(full);
      toast({ title: "Copied to clipboard", description: "Paste it into a new proposal draft." });
    } catch (e: any) {
      toast({ title: "Copy failed", description: e?.message ?? "Clipboard permission denied", variant: "destructive" });
    } finally {
      setCopying(null);
    }
  };

  if (loading && meetings.length === 0) {
    return <Card className="p-4 text-xs text-muted-foreground italic">Loading recent meetings from Read.ai…</Card>;
  }
  if (meetings.length === 0) {
    return (
      <Card className="p-4 text-xs text-muted-foreground italic">
        No recent Read.ai meetings found. Check the Read.ai connector / READ_AI_TOKEN.
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm">Recent Read.ai meetings</h3>
          <span className="text-[10px] text-muted-foreground">
            {meetings.length} meeting{meetings.length !== 1 ? "s" : ""}
            {source === "seed" && " · cached snapshot (ask Claude to refresh)"}
            {source === "live" && " · live from Read.ai"}
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={load} className="h-7 text-xs">
          <RefreshCw className="w-3 h-3 mr-1" /> Reload
        </Button>
      </div>

      <div className="divide-y">
        {meetings.map(m => {
          const isClient = isClientMeeting(m);
          const attended = m.participants.filter(p => p.attended !== false);
          const isExpanded = expandedId === m.id;
          const dateStr = new Date(m.start_time_ms).toLocaleString("en-GB", {
            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
          });
          const durationMins = Math.round((m.end_time_ms - m.start_time_ms) / 60000);
          return (
            <div
              key={m.id}
              className={`py-2.5 px-2 rounded -mx-2 transition-colors ${
                isClient ? "bg-emerald-50/60 border-l-2 border-emerald-500" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={m.report_url} target="_blank" rel="noopener noreferrer"
                      className="font-semibold text-sm hover:text-primary transition-colors inline-flex items-center gap-1">
                      {m.title}
                      <ExternalLink className="w-3 h-3 opacity-50" />
                    </a>
                    {isClient && (
                      <span className="text-[9px] font-bold uppercase bg-emerald-500 text-white px-1.5 py-0.5 rounded">
                        Client
                      </span>
                    )}
                    {m.folders.map(f => (
                      <span key={f} className="text-[9px] text-muted-foreground border rounded px-1 py-0.5">
                        {f}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                    <span>{dateStr}</span>
                    <span>·</span>
                    <span>{durationMins}m</span>
                    <span>·</span>
                    <Users className="w-3 h-3" />
                    <span>{attended.length} attendee{attended.length !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => setExpandedId(e => e === m.id ? null : m.id)}
                  >
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    Details
                  </Button>
                  <Button size="sm" variant={isClient ? "default" : "outline"} className="h-7 text-xs"
                    disabled={copying === m.id}
                    onClick={() => copyScript(m)}
                    title="Copy meeting summary + transcript (if cached) to clipboard for use in a new proposal"
                  >
                    {copying === m.id ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Copy className="w-3 h-3 mr-1" />}
                    Copy script
                  </Button>
                </div>
              </div>
              {isExpanded && (
                <div className="mt-2 pl-3 border-l-2 border-border/40 space-y-2">
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">Attendees</div>
                  <div className="flex flex-wrap gap-1">
                    {attended.map((p, i) => {
                      const domain = (p.email || "").split("@")[1] || "";
                      const external = domain && domain !== "eendigo.com" && !FREE_MAIL_DOMAINS.has(domain);
                      return (
                        <span key={i}
                          className={`text-[10px] px-1.5 py-0.5 rounded ${
                            external
                              ? "bg-emerald-100 text-emerald-800 font-medium"
                              : "bg-muted text-muted-foreground"
                          }`}
                          title={p.email ?? ""}
                        >
                          {p.name ?? p.email ?? "?"}
                        </span>
                      );
                    })}
                  </div>
                  {m.summary && (
                    <>
                      <div className="text-[10px] font-semibold uppercase text-muted-foreground pt-1">Summary</div>
                      <div className="text-[11px] whitespace-pre-wrap text-foreground/80 leading-relaxed">
                        {m.summary}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="text-[9px] text-muted-foreground italic border-t pt-2">
        Green highlight = likely client conversation (at least one non-eendigo, non-free-mail attendee). "Copy script" pulls
        summary + transcript (when cached) to your clipboard — paste into a new proposal to start the wizard with full context.
      </div>
    </Card>
  );
}

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
  const [slideInstructionsSaveState, setSlideInstructionsSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [slideInstructionsSaveError, setSlideInstructionsSaveError] = useState<string>("");

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

  // Slide template metadata — which slides have a saved template with region keys
  const [slideTemplateInfo, setSlideTemplateInfo] = useState<Record<string, { key: string; placeholder: string }[]>>({});
  const [slideScores, setSlideScores] = useState<Record<string, any>>({});
  const [showFullSlideView, setShowFullSlideView] = useState(false);
  const [enableQualityScore, setEnableQualityScore] = useState(false);
  const [analyzingRef, setAnalyzingRef] = useState<string | null>(null);

  // ── "Refine until perfect" iterative workflow ──────────────────────────
  // Mirrors how Claude builds an eendigo-template slide: draft → score →
  // critique → fix → repeat until total score hits the target or the
  // budget runs out. The server drives the whole loop so we only see one
  // HTTP call per refine; the history array is returned at the end and
  // drives the "refinement trail" strip under the preview.
  const [refiningSlide, setRefiningSlide]   = useState<string | null>(null);
  const [refineHistory, setRefineHistory]   = useState<Record<string, any[]>>({});
  const [refineTarget,  setRefineTarget]    = useState<number>(() => {
    try { return Number(localStorage.getItem("compplan.refine_target") || "85"); }
    catch { return 85; }
  });
  const [showRefineHistory, setShowRefineHistory] = useState<Record<string, boolean>>({});

  // ── Direct HTML editing of slide previews ─────────────────────────────
  // Toggle a slide's preview into contentEditable mode so the user can
  // click and edit the rendered HTML directly — no AI round-trip for
  // small typo fixes, wording tweaks, or number corrections. On blur we
  // capture the updated innerHTML, persist it via updateSlideField, and
  // the next refine/score/export run picks up the edited version.
  const [editingPreview, setEditingPreview] = useState<Record<string, boolean>>({});

  // ── Fullscreen preview overlay ────────────────────────────────────────
  // Opens the currently-previewing slide in a fullscreen modal rendered at
  // native 960×540 (the size the slide HTML was designed for), scaled by
  // a JS-computed factor so it fills ~90% of the viewport. Edit mode works
  // identically to the inline preview — same contentEditable, same save-
  // on-blur, same quality-score invalidation.
  const [fullscreenPreview, setFullscreenPreview] = useState(false);
  const [fullscreenScale, setFullscreenScale]     = useState(1);

  // Compute the scale factor whenever we enter fullscreen or the window
  // resizes. The slide HTML uses px values tuned for 960×540 so the
  // right move is a uniform CSS transform, NOT reflowing the content.
  useEffect(() => {
    if (!fullscreenPreview) return;
    const updateScale = () => {
      const horizontalPad = 80;   // side padding around the slide
      const verticalPad   = 140;  // top bar + caption
      const availW = Math.max(320, window.innerWidth  - horizontalPad);
      const availH = Math.max(200, window.innerHeight - verticalPad);
      const s = Math.min(availW / 960, availH / 540, 2.0); // cap at 2× so we don't pixelate
      setFullscreenScale(s);
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [fullscreenPreview]);

  // ESC exits fullscreen (only when not actively typing — if edit mode is
  // on we let ESC bubble so the browser can do its native thing).
  useEffect(() => {
    if (!fullscreenPreview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreenPreview(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fullscreenPreview]);

  // ── Quality-score click-through analysis ──────────────────────────────
  // Clicking the small score badge expands a panel with per-dimension
  // actionable fixes + a narrative summary. If the current score object
  // already includes `fix` (produced by refine-page or the upgraded
  // generate-page scorer), we just expand. Otherwise we call
  // /api/proposals/:id/analyze-page to fetch a fresh deep analysis.
  const [slideAnalyses, setSlideAnalyses]       = useState<Record<string, any>>({});
  const [analyzingSlide, setAnalyzingSlide]     = useState<string | null>(null);
  const [showScoreDetails, setShowScoreDetails] = useState<Record<string, boolean>>({});

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

  // ── Auto-save with dirty tracking + unload flush ────────────────────────
  //
  // Bug we are fixing: the previous version debounced saves on a 2-second
  // timer. If the user typed into a textarea (e.g. content_prompt) and
  // refreshed the tab within that window, the pending timer was cancelled
  // on unmount and the edit was silently dropped. Now:
  //
  //   1. `dirtyRef` is set on every edit and cleared only after a
  //      successful save round-trip. It's the single source of truth for
  //      "there is unsaved work".
  //   2. Debounce is shortened from 2000 ms to 800 ms — shorter window of
  //      potential loss.
  //   3. Textarea onBlur calls `flushSave()` directly (no debounce), so
  //      clicking away from a field saves instantly.
  //   4. `beforeunload` both (a) flushes via `navigator.sendBeacon()` —
  //      which is the only fetch-style API the browser reliably allows
  //      during unload — AND (b) prompts the user to confirm leaving.
  //
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSaving, setAutoSaving] = useState(false);
  // dirtyRef: synchronous truth, read by beforeunload + flushSave.
  // isDirty: same info mirrored into state so React re-renders the
  // "Unsaved changes" indicator when the state flips.
  const dirtyRef = useRef(false);
  const [isDirty, setIsDirty] = useState(false);
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setIsDirty(true);
  }, []);
  const markClean = useCallback(() => {
    dirtyRef.current = false;
    setIsDirty(false);
  }, []);

  // Refs that always point to the latest state — used by the beforeunload
  // handler so it can build a save payload without going through a stale
  // closure.
  const latestFormRef = useRef(form);
  const latestSlidesRef = useRef(slides);
  const latestBriefsRef = useRef(briefs);
  const latestChecklistRef = useRef(callChecklist);
  const latestProjectTypeRef = useRef(projectType);
  const latestProjectApproachRef = useRef(projectApproach);
  const latestCurrentRef = useRef(current);
  useEffect(() => { latestFormRef.current = form; }, [form]);
  useEffect(() => { latestSlidesRef.current = slides; }, [slides]);
  useEffect(() => { latestBriefsRef.current = briefs; }, [briefs]);
  useEffect(() => { latestChecklistRef.current = callChecklist; }, [callChecklist]);
  useEffect(() => { latestProjectTypeRef.current = projectType; }, [projectType]);
  useEffect(() => { latestProjectApproachRef.current = projectApproach; }, [projectApproach]);
  useEffect(() => { latestCurrentRef.current = current; }, [current]);

  // ── Inline "ask the user when a required field is missing" helper ──────
  //
  // Used by every action that needs a form field to proceed (save, generate,
  // export, etc.). Instead of throwing a destructive toast that forces the
  // user to navigate back to Step 1, we pop a native prompt right where they
  // are, persist the answer to form state AND the latestFormRef (so callers
  // in the same callback can read it immediately, without waiting for React
  // to commit), and return the trimmed value.
  //
  // If the user cancels or submits blank, returns null — callers should bail
  // silently. No error toast. The assumption: if the user explicitly
  // cancelled the prompt, they know they're declining the action, and
  // shouting at them is noise.
  //
  // Add new required-field checks by calling `ensureField("field_key", "Human label")`
  // at the top of the action instead of scattering toast errors.
  function ensureField(key: keyof typeof form, label: string): string | null {
    const current = (latestFormRef.current as any)[key];
    if (typeof current === "string" && current.trim()) return current.trim();
    const answer = window.prompt(`${label} is required to continue.\n\nPlease enter it:`, "");
    if (answer === null) return null; // user hit Cancel
    const trimmed = answer.trim();
    if (!trimmed) return null;
    // Persist to both React state (so inputs update) and the ref (so the
    // rest of this callback sees it without a rerender round-trip).
    setForm(prev => ({ ...prev, [key]: trimmed } as any));
    (latestFormRef.current as any) = { ...latestFormRef.current, [key]: trimmed };
    return trimmed;
  }

  // ROOT-CAUSE FIX (2026-04): the previous implementation called
  // `saveProgress()` from inside a memoized `triggerAutoSave`. Because
  // `useCallback([markClean])` returned the first-render function forever,
  // the setTimeout body referenced the FIRST-render `saveProgress`, whose
  // closure captured the INITIAL empty `form`/`slides`/`current`. Every
  // auto-save was therefore POSTing an empty proposal — so typed content
  // never persisted and stray blank rows accumulated that looked like
  // "deleted proposals reappearing". Fix: the timer no longer calls
  // `saveProgress` at all. It builds the payload from the latest refs
  // and fires the fetch directly — same data path the beacon handler
  // already uses correctly.
  //
  // `justOpenedRef` blocks the very first auto-save fire after opening a
  // proposal, so simply loading a proposal never writes back to the DB.
  const justOpenedRef = useRef(false);

  // Build a save body from the LATEST refs. Never reads closed-over state.
  const buildLatestBody = useCallback(() => {
    const f = latestFormRef.current;
    const cur = latestCurrentRef.current;
    const now = new Date().toISOString();
    return {
      company_name: f.company_name,
      website: f.website || null,
      transcript: f.transcript || null,
      notes: f.notes || null,
      revenue: f.revenue ? Number(f.revenue) : null,
      ebitda_margin: f.ebitda_margin ? Number(f.ebitda_margin) : null,
      scope_perimeter: f.scope_perimeter || null,
      objective: f.objective || null,
      urgency: f.urgency || null,
      project_type: latestProjectTypeRef.current,
      project_approach: latestProjectApproachRef.current || null,
      slide_selection: latestSlidesRef.current,
      slide_briefs: latestBriefsRef.current,
      call_checklist: latestChecklistRef.current,
      status: cur?.status || "draft",
      options: cur?.options || [],
      created_at: cur?.created_at || now,
      updated_at: now,
    };
  }, []);

  // Direct save — fetches against the latest state, no stale closures,
  // no dependency on `saveProgress`. Shared by flushSave and the timer.
  const doAutoSave = useCallback(async () => {
    const f = latestFormRef.current;
    const cur = latestCurrentRef.current;
    // HARD GUARD: never auto-save a proposal without a company name.
    // This prevents blank rows from ever being created by accident.
    if (!f.company_name || !f.company_name.trim()) return;
    const body = buildLatestBody();
    try {
      if (cur?.id) {
        const res = await fetch(`/api/proposals/${cur.id}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`PUT ${res.status}`);
        const updated = await res.json();
        setCurrent(updated);
        latestCurrentRef.current = updated;
      } else {
        const res = await fetch("/api/proposals", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`POST ${res.status}`);
        const created = await res.json();
        setCurrent(created);
        latestCurrentRef.current = created;
      }
      markClean();
    } catch (err) {
      console.error("[auto-save] failed, keeping dirty flag:", err);
      // Leave dirtyRef set so the next change or onBlur retries.
    }
  }, [buildLatestBody, markClean]);

  // Force-flush (no debounce). Called from textarea onBlur, manual actions.
  const flushSave = useCallback(async () => {
    if (!dirtyRef.current) return;
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    setAutoSaving(true);
    await doAutoSave();
    setAutoSaving(false);
  }, [doAutoSave]);

  const triggerAutoSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      setAutoSaving(true);
      await doAutoSave();
      setAutoSaving(false);
    }, 800);
  }, [doAutoSave]);

  // Trigger auto-save when key data changes. Intentionally no cleanup
  // cancellation — a dep change just reschedules via clearTimeout inside
  // triggerAutoSave. The justOpenedRef gate prevents the very first fire
  // after openProposal from overwriting the freshly-loaded data.
  useEffect(() => {
    if (step < 1 || !form.company_name) return;
    if (justOpenedRef.current) {
      // Skip this effect run — it was triggered by the openProposal state
      // cascade, not by a user edit. Clear the flag so the NEXT real change
      // auto-saves normally.
      justOpenedRef.current = false;
      return;
    }
    markDirty();
    triggerAutoSave();
  }, [form.company_name, form.website, form.revenue, form.ebitda_margin, form.objective, form.urgency, form.scope_perimeter, form.transcript, form.notes, slides, briefs, projectApproach, callChecklist, projectType, step, triggerAutoSave, markDirty]);

  // beforeunload: warn the user if there's unsaved work AND attempt to
  // flush synchronously via sendBeacon (the only network call browsers
  // honour during page unload).
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      const cur = latestCurrentRef.current;
      const f = latestFormRef.current;
      if (!f.company_name) return;
      try {
        const body = {
          company_name: f.company_name,
          website: f.website || null,
          transcript: f.transcript || null,
          notes: f.notes || null,
          revenue: f.revenue ? Number(f.revenue) : null,
          ebitda_margin: f.ebitda_margin ? Number(f.ebitda_margin) : null,
          scope_perimeter: f.scope_perimeter || null,
          objective: f.objective || null,
          urgency: f.urgency || null,
          project_type: latestProjectTypeRef.current,
          project_approach: latestProjectApproachRef.current || null,
          slide_selection: latestSlidesRef.current,
          slide_briefs: latestBriefsRef.current,
          call_checklist: latestChecklistRef.current,
          status: cur?.status || "draft",
          options: cur?.options || [],
          created_at: cur?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
        if (cur?.id) {
          // sendBeacon only does POST; server supports POST-with-id fallback
          // below. For PUT, fall through to XHR sync as a secondary attempt.
          navigator.sendBeacon(`/api/proposals/${cur.id}/beacon-save`, blob);
        } else {
          navigator.sendBeacon("/api/proposals/beacon-save", blob);
        }
      } catch { /* best-effort */ }
      // Block the unload and ask the user to confirm — this is the user's
      // safety net if the beacon fails for any reason.
      e.preventDefault();
      (e as any).returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  useEffect(() => {
    loadProposals();
    loadTemplates();
    loadSlideInstructions();
    loadSlideTemplateInfo();
  }, []);

  // Persistence for the Slide Template Instructions free-text.
  //
  // Source of truth: localStorage (key below). It's instant, survives
  // reloads, and does not depend on a DB migration having shipped to prod.
  // We *also* best-effort mirror to the server's deck_template_configs row
  // so the text follows the user across devices once that column exists,
  // but a server failure must never lose the user's text — localStorage
  // already has it.
  const SLIDE_INSTRUCTIONS_LS_KEY = "compplan:slideInstructionsText";

  function loadSlideInstructions() {
    // 1. Hydrate immediately from localStorage (synchronous, no flicker).
    try {
      const cached = localStorage.getItem(SLIDE_INSTRUCTIONS_LS_KEY);
      if (cached) setSlideInstructionsText(cached);
    } catch { /* localStorage disabled — fall through to server */ }

    // 2. Then try the server. If it has a non-empty value, prefer it
    //    (cross-device sync) and refresh the localStorage cache.
    (async () => {
      try {
        const res = await fetch("/api/deck-template", { credentials: "include" });
        if (!res.ok) return;
        const cfg = await res.json();
        const serverText: string | undefined = cfg?.slide_instructions_text;
        if (serverText && serverText.trim()) {
          setSlideInstructionsText(serverText);
          try { localStorage.setItem(SLIDE_INSTRUCTIONS_LS_KEY, serverText); } catch {}
        }
      } catch { /* silent */ }
    })();
  }

  // Keystroke handler: write to localStorage synchronously so the text is
  // never lost on reload, and mark the save state as "idle" (user must click
  // Save to commit to the server).
  const onSlideInstructionsChange = useCallback((text: string) => {
    try { localStorage.setItem(SLIDE_INSTRUCTIONS_LS_KEY, text); } catch {}
    setSlideInstructionsSaveState("idle");
    setSlideInstructionsSaveError("");
  }, []);

  // Explicit Save: PUT to /api/deck-template, then GET to verify the server
  // actually persisted the value. Surfaces errors instead of swallowing them.
  async function saveSlideInstructionsNow() {
    setSlideInstructionsSaveState("saving");
    setSlideInstructionsSaveError("");
    const textToSave = slideInstructionsText;
    try {
      // 1. Fetch existing config so the PUT body carries required fields.
      const getRes = await fetch("/api/deck-template", { credentials: "include" });
      if (!getRes.ok) throw new Error(`GET failed: ${getRes.status}`);
      const existing = await getRes.json();

      // 2. PUT with the new value merged in.
      const putRes = await fetch("/api/deck-template", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(existing || {}),
          slide_instructions_text: textToSave,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!putRes.ok) {
        const errBody = await putRes.text().catch(() => "");
        throw new Error(`PUT failed: ${putRes.status} ${errBody}`);
      }

      // 3. GET again and verify the server returned what we sent — this
      //    catches the case where the column doesn't exist and Drizzle
      //    silently drops the field.
      const verifyRes = await fetch("/api/deck-template", { credentials: "include" });
      if (!verifyRes.ok) throw new Error(`verify GET failed: ${verifyRes.status}`);
      const verifyCfg = await verifyRes.json();
      if ((verifyCfg?.slide_instructions_text ?? "") !== textToSave) {
        throw new Error(
          "Server accepted the save but did not return the new text on re-read. " +
          "The deck_template_configs.slide_instructions_text column may not exist in prod yet — " +
          "check the Render deploy status."
        );
      }

      // 4. Mirror to localStorage (survives any future server outage).
      try { localStorage.setItem(SLIDE_INSTRUCTIONS_LS_KEY, textToSave); } catch {}

      setSlideInstructionsSaveState("saved");
      setTimeout(() => {
        setSlideInstructionsSaveState(s => (s === "saved" ? "idle" : s));
      }, 2500);
    } catch (e: any) {
      console.error("[slide-instructions] save failed:", e);
      setSlideInstructionsSaveError(e?.message || "Save failed");
      setSlideInstructionsSaveState("error");
    }
  }

  async function loadProposals() {
    const res = await fetch("/api/proposals", { credentials: "include" });
    if (res.ok) setProposals(await res.json());
  }

  async function loadTemplates() {
    const res = await fetch("/api/proposal-templates", { credentials: "include" });
    if (res.ok) setTemplates(await res.json());
  }

  // Fetch slide template metadata (region keys per slide_id). Used to show
  // per-region labeled inputs instead of a single textarea when a slide
  // has a saved deterministic template from the visual editor.
  async function loadSlideTemplateInfo() {
    try {
      const res = await fetch("/api/slide-templates", { credentials: "include" });
      if (!res.ok) return;
      const rows: { slide_id: string; region_keys: { key: string; placeholder: string }[] }[] = await res.json();
      const map: Record<string, { key: string; placeholder: string }[]> = {};
      for (const r of rows) {
        if (r.region_keys?.length) map[r.slide_id] = r.region_keys;
      }
      setSlideTemplateInfo(map);
    } catch { /* non-blocking */ }
  }

  function startNew() {
    // Kill any pending auto-save for whatever was open before.
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    markClean();
    // Synchronously reset the refs that auto-save reads. Without this,
    // there's a window between setCurrent(null) and the latestCurrentRef
    // effect where a pending save could PUT the new empty form data onto
    // the PREVIOUSLY open proposal, corrupting it.
    const emptyForm = { company_name: "", website: "", transcript: "", notes: "", revenue: "", ebitda_margin: "", scope_perimeter: "", objective: "", urgency: "Medium" };
    latestCurrentRef.current = null;
    latestFormRef.current = emptyForm;
    latestSlidesRef.current = [];
    latestBriefsRef.current = [];
    latestProjectTypeRef.current = "";
    latestProjectApproachRef.current = "";
    // Also block the first auto-save fire after this state cascade.
    justOpenedRef.current = true;
    setForm(emptyForm);
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
    // Block the auto-save effect from firing a save for the state cascade
    // that setCurrent/setSlides/... is about to cause. Without this, simply
    // loading a proposal would schedule a PUT that writes the just-loaded
    // data back — safe but wasteful — and any race with a subsequent edit
    // could clobber state.
    justOpenedRef.current = true;
    markClean();
    setCurrent(p);
    latestCurrentRef.current = p;
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
      // "briefed" = briefs written, not yet analysed → land in Briefing,
      // which is now step 2 in the new flow.
      setStep(2);
    } else {
      // Anything post-analysis → land in Architecture (new step 4).
      setStep(4);
    }
    setView("wizard");
  }

  async function deleteProposal(id: number) {
    // Belt-and-braces: cancel any pending auto-save for THIS proposal
    // before we delete it, clear the dirty flag so the unload beacon
    // won't try to recreate it, then verify the server actually deleted
    // it by reloading the list from the source of truth.
    if (autoSaveTimer.current) { clearTimeout(autoSaveTimer.current); autoSaveTimer.current = null; }
    markClean();
    let ok = false;
    try {
      const res = await fetch(`/api/proposals/${id}`, { method: "DELETE", credentials: "include" });
      ok = res.ok;
    } catch (err) {
      console.error("[deleteProposal] network error:", err);
    }
    if (!ok) {
      toast({ title: "Delete failed — proposal still on server", variant: "destructive" });
      await loadProposals();
      return;
    }
    // If we're deleting the currently-open proposal, clear it so no
    // subsequent effect can write to the deleted id.
    if (latestCurrentRef.current?.id === id) {
      setCurrent(null);
      latestCurrentRef.current = null;
    }
    // Reload from server — do NOT filter locally. If the row is still
    // there the user should see it.
    await loadProposals();
    toast({ title: "Proposal deleted" });
  }

  // ── Step 1 → Step 2: Save draft ────────────────────────────────────────────

  async function handleGoToSlides() {
    // Inline prompt on missing company name — no navigate-back-to-Step-1.
    if (!ensureField("company_name", "Company name")) return;
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
        const msg: string = errData.message ?? `Server returned ${res.status}`;
        // API paused mid-flight → offer to unpause and retry
        if (res.status === 503 && /paus/i.test(msg)) {
          setSlideGenerating(null); apiCallDone();
          const retry = window.confirm(
            `AI is paused.\n\n${msg}\n\nClick OK to enter the password, activate the API, and retry generating the content.`
          );
          if (!retry) return;
          const pw = window.prompt("Enter API password to activate (try: 1):");
          if (!pw) return;
          const activateRes = await fetch("/api/api-pause", {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paused: false, password: pw }),
          });
          if (!activateRes.ok) {
            toast({ title: "Wrong password — API still paused", variant: "destructive" });
            return;
          }
          toast({ title: "API activated — retrying content generation…" });
          return generateSlideContent(slideId);
        }
        throw new Error(msg);
      }
      const data = await res.json();
      if (!data.generated_content || !data.generated_content.trim()) {
        throw new Error("Server returned empty content");
      }
      updateSlideField(slideId, "generated_content", data.generated_content);
      toast({ title: `Content generated for "${slide.title}"` });
    } catch (err: any) {
      console.error("[generateSlideContent] error for", slideId, err);
      toast({
        title: "Generation failed",
        description: err?.message || "Unknown error — check the browser console.",
        variant: "destructive",
      });
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

      // If this slide has a template, pass the per-region values
      const templateRegions = slideTemplateInfo[slideId];
      let templateValues: Record<string, string> | undefined;
      if (templateRegions?.length) {
        templateValues = {};
        const answers = slide?.generation_answers ?? {};
        for (const r of templateRegions) {
          templateValues[r.key] = (answers as any)[r.key] ?? "";
        }
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
          ...(templateValues && { template_values: templateValues }),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: `Server returned ${res.status}` }));
        const msg: string = errData.message ?? `Server returned ${res.status}`;
        // Server reports API is paused → offer to unpause and auto-retry
        if (res.status === 503 && /paus/i.test(msg)) {
          setGeneratingPage(null); apiCallDone();
          const retry = window.confirm(
            `AI is paused.\n\n${msg}\n\nClick OK to enter the password, activate the API, and retry the preview.`
          );
          if (!retry) return;
          const pw = window.prompt("Enter API password to activate (try: 1):");
          if (!pw) return;
          const activateRes = await fetch("/api/api-pause", {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paused: false, password: pw }),
          });
          if (!activateRes.ok) {
            toast({ title: "Wrong password — API still paused", variant: "destructive" });
            return;
          }
          toast({ title: "API activated — retrying preview…" });
          return generatePage(slideId);
        }
        throw new Error(msg);
      }
      const data = await res.json();
      if (!data.html) throw new Error("Server returned an empty preview");
      setPreviewHtml(prev => ({ ...prev, [slideId]: data.html }));
      updateSlideField(slideId, "preview_html", data.html);
      if (data.quality_score) {
        setSlideScores(prev => ({ ...prev, [slideId]: data.quality_score }));
        updateSlideField(slideId, "quality_score", data.quality_score);
      }
      toast({ title: `Page preview ready for "${slide?.title}"` });
    } catch (err: any) {
      toast({
        title: "Page generation failed",
        description: err?.message || "Unknown error — check the browser console.",
        variant: "destructive",
      });
      console.error("[generatePage] error for", slideId, err);
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

  // ── "Refine until perfect" — run the iterative loop ─────────────────
  // Drives /api/proposals/:id/refine-page, which internally generates,
  // scores, critiques, and re-generates the slide until the score hits
  // `refineTarget` or the round budget (4) is exhausted. All rounds run
  // server-side in a single HTTP request to keep the client simple and
  // avoid partial-state bugs on reload.
  async function refineSlide(slideId: string) {
    if (!current?.id) {
      await saveProgress();
      await new Promise(r => setTimeout(r, 500));
    }
    if (!current?.id) return;
    if (!await confirmApiUsage(`Refine slide until quality ≥ ${refineTarget}/100 (up to 4 rounds = up to 8 API calls)`)) return;

    const slide = slides.find(s => s.slide_id === slideId);

    // Persist the chosen target across reloads.
    try { localStorage.setItem("compplan.refine_target", String(refineTarget)); } catch {}

    setRefiningSlide(slideId);
    setPreviewSlideId(slideId);
    setRefineHistory(prev => ({ ...prev, [slideId]: [] }));
    try {
      // For agenda: inject the actual selected-slide list so the content
      // is grounded in the current structure, same as generatePage() does.
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

      const res = await fetch(`/api/proposals/${current.id}/refine-page`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slide_id: slideId,
          visual_prompt: slide?.visual_prompt ?? "",
          content_prompt: pageContentPrompt,
          generated_content: pageGenContent,
          target_score: refineTarget,
          max_rounds: 4,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: `Server returned ${res.status}` }));
        throw new Error(errData.message ?? `Server returned ${res.status}`);
      }
      const data = await res.json();
      if (!data.html) throw new Error("Server returned an empty slide");
      setPreviewHtml(prev => ({ ...prev, [slideId]: data.html }));
      updateSlideField(slideId, "preview_html", data.html);
      if (data.quality_score) {
        setSlideScores(prev => ({ ...prev, [slideId]: data.quality_score }));
        updateSlideField(slideId, "quality_score", data.quality_score);
      }
      if (Array.isArray(data.history)) {
        setRefineHistory(prev => ({ ...prev, [slideId]: data.history }));
        setShowRefineHistory(prev => ({ ...prev, [slideId]: true }));
      }
      const final = data.quality_score?.total ?? 0;
      const rounds = data.rounds_used ?? data.history?.length ?? 0;
      toast({
        title: `Slide refined — score ${final}/100`,
        description: `${rounds} round${rounds === 1 ? "" : "s"} · target was ${refineTarget}/100`,
      });
    } catch (err: any) {
      toast({
        title: "Refinement failed",
        description: err?.message || "Unknown error — check the browser console.",
        variant: "destructive",
      });
      console.error("[refineSlide] error for", slideId, err);
    }
    setRefiningSlide(null); apiCallDone();
  }

  // Click-through quality analysis: expand the score panel and, if we
  // don't already have per-dimension fixes, fetch a deep analysis from
  // /api/proposals/:id/analyze-page. Safe no-op if there's no slide HTML
  // to analyse yet — the button itself is disabled in that case.
  async function analyzeSlideQuality(slideId: string) {
    // Toggle off if already open
    if (showScoreDetails[slideId]) {
      setShowScoreDetails(prev => ({ ...prev, [slideId]: false }));
      return;
    }

    const existingScore = slideScores[slideId];
    const existingAnalysis = slideAnalyses[slideId];
    const hasFixes = !!(existingScore?.fix || existingAnalysis?.fix);

    // Always open the panel first — even if we need to fetch, the user
    // gets immediate feedback that something is happening.
    setShowScoreDetails(prev => ({ ...prev, [slideId]: true }));

    // If we already have per-dimension fixes, no API call needed.
    if (hasFixes) return;

    // Need to fetch. Require a rendered HTML preview to analyse.
    const slide = slides.find(s => s.slide_id === slideId);
    const html = previewHtml[slideId] ?? slide?.preview_html ?? "";
    if (!html) {
      toast({
        title: "Generate the slide first",
        description: "There's no preview to analyse yet — generate or refine the slide, then click the score.",
        variant: "destructive",
      });
      return;
    }

    if (!current?.id) {
      await saveProgress();
      await new Promise(r => setTimeout(r, 500));
    }
    if (!current?.id) return;

    if (!await confirmApiUsage("Deep quality analysis of this slide (1 API call)")) {
      setShowScoreDetails(prev => ({ ...prev, [slideId]: false }));
      return;
    }

    setAnalyzingSlide(slideId);
    try {
      const res = await fetch(`/api/proposals/${current.id}/analyze-page`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slide_id: slideId,
          current_html: html,
          visual_prompt: slide?.visual_prompt ?? "",
          content_prompt: slide?.content_prompt ?? "",
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: `Server returned ${res.status}` }));
        throw new Error(errData.message ?? `Server returned ${res.status}`);
      }
      const data = await res.json();
      if (!data.analysis) throw new Error("Server returned an empty analysis");

      // Cache the full analysis (with narrative) AND merge the fresh
      // score into slideScores so the badge reflects the new number.
      setSlideAnalyses(prev => ({ ...prev, [slideId]: data.analysis }));
      setSlideScores(prev => ({ ...prev, [slideId]: { ...(prev[slideId] ?? {}), ...data.analysis } }));
      updateSlideField(slideId, "quality_score", data.analysis);

      toast({
        title: `Analysis complete — ${data.analysis.total ?? "?"}/100`,
        description: data.analysis.top_priority_fix || data.analysis.tip || "See breakdown below the score.",
      });
    } catch (err: any) {
      toast({
        title: "Analysis failed",
        description: err?.message || "Unknown error — check the browser console.",
        variant: "destructive",
      });
      console.error("[analyzeSlideQuality] error for", slideId, err);
      setShowScoreDetails(prev => ({ ...prev, [slideId]: false }));
    }
    setAnalyzingSlide(null); apiCallDone();
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

  // ── Step 5 → Step 6: Save slide selection & proceed to generate ─────────────
  // (Used to be Step 2 → 3, but Deck has moved to slot 5 so after locking the
  // deck structure we head straight to Generate.)

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

      // Deck is now the last stop before Generate — proceed straight there.
      // (The old flow jumped to Briefing here, because Deck used to be step 2.)
      setStep(6);
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
  // NOTE: This function reads from latestXxxRef — NOT closed-over state.
  // That way it is immune to the stale-closure bug that bit auto-save, no
  // matter from what memoized callback it gets called.
  async function saveProgress() {
    setSaving(true);
    // Defensive guard: never try to save a proposal without a company name.
    // The server will 400, and scattering a toast across every step makes
    // people hunt for the missing field. Inline-prompt instead and carry on.
    const name = ensureField("company_name", "Company name");
    if (!name) {
      setSaving(false);
      return;
    }
    const cur = latestCurrentRef.current;
    const body = buildLatestBody();
    try {
      if (cur?.id) {
        const res = await fetch(`/api/proposals/${cur.id}`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`PUT ${res.status}`);
        const updated = await res.json();
        setCurrent(updated);
        latestCurrentRef.current = updated;
      } else {
        const res = await fetch("/api/proposals", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`POST ${res.status}`);
        const created = await res.json();
        setCurrent(created);
        latestCurrentRef.current = created;
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

  // ── Step 2 → Step 3 → Step 4: Submit briefs & trigger AI analysis ──────────

  async function handleSubmitBriefs() {
    await saveBriefs();
    // Move to Analysis (new step 3) — the spinner screen that waits for Claude.
    setStep(3);
    setAnalyzing(true);

    try {
      // Forward the user's active AI model selection via headers so the
      // server's analyzeProposal() can route the call to the chosen
      // provider (Claude / OpenAI / Gemini) instead of hardcoded default.
      const aiModelRaw = (() => {
        try { return JSON.parse(localStorage.getItem("app_ai_model_v1") || "{}"); }
        catch { return {}; }
      })();
      const aiModelId: string = aiModelRaw?.id ?? "";
      // Infer provider from the model-id prefix when not stored explicitly.
      const aiProvider = aiModelId.startsWith("gemini-") ? "gemini"
        : aiModelId.startsWith("gpt-") || aiModelId.startsWith("o3") ? "openai"
        : aiModelId.startsWith("claude-") ? "anthropic"
        : "";
      const aiHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (aiProvider) aiHeaders["X-AI-Provider"] = aiProvider;
      if (aiModelId) aiHeaders["X-AI-Model"] = aiModelId;
      const analyzeRes = await fetch(`/api/proposals/${current!.id}/analyze`, {
        method: "POST", credentials: "include",
        headers: aiHeaders,
      });

      if (!analyzeRes.ok) throw new Error("Analysis failed");
      const analyzed = await analyzeRes.json();
      setCurrent(analyzed);
      setAnalyzing(false);
      // Analysis done → jump to Architecture (new step 4).
      setStep(4);
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

  // Pixel-perfect export: server runs each slide's preview_html through
  // headless Chromium, screenshots at 2× retina, and builds a PPTX where
  // every slide is a full-bleed image. Looks IDENTICAL to the HTML preview
  // (no layout drift) — cost is that the slides aren't text-editable in
  // PowerPoint. Good default when you've already refined previews to 85+.
  const [generatingImages, setGeneratingImages] = useState(false);
  async function downloadDeckImages() {
    if (!current?.id) return;
    // Pre-flight: warn if there are selected slides with no preview_html,
    // so the user knows why the exported deck has fewer slides than the outline.
    const selected = slides.filter(s => s.is_selected !== false);
    const withPreview = selected.filter(s => !!previewHtml[s.slide_id] || !!(s as any).preview_html);
    if (withPreview.length === 0) {
      toast({ title: "No previews generated yet", description: "Generate or refine at least one slide preview before exporting.", variant: "destructive" });
      return;
    }
    if (withPreview.length < selected.length) {
      const missing = selected.length - withPreview.length;
      const ok = window.confirm(
        `${missing} slide${missing === 1 ? " has" : "s have"} no preview yet and will be skipped.\n\nExport the ${withPreview.length} slide${withPreview.length === 1 ? "" : "s"} that do have previews?`
      );
      if (!ok) return;
    }
    setGeneratingImages(true);
    try {
      // Make sure the server is seeing the latest edits — otherwise an
      // unsaved contentEditable tweak would ship the old HTML.
      await saveProgress();
      const res = await fetch(`/api/proposals/${current.id}/export-deck-images`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Export failed" }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Eendigo_Proposal_${current.company_name.replace(/[^a-zA-Z0-9]/g, "_")}_pixel_perfect.pptx`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Pixel-perfect deck downloaded" });
    } catch (err: any) {
      toast({ title: "Image export failed", description: err.message, variant: "destructive" });
    }
    setGeneratingImages(false);
  }

  // PDF export — same Playwright rendering as the pixel-perfect PPTX but
  // outputs a multi-page PDF. The user sees the exact same visuals as the
  // HTML preview and can QA the deck before committing to the final PPTX.
  const [generatingPdf, setGeneratingPdf] = useState(false);
  async function downloadDeckPdf() {
    if (!current?.id) return;
    const selected = slides.filter(s => s.is_selected !== false);
    const withPreview = selected.filter(s => !!previewHtml[s.slide_id] || !!(s as any).preview_html);
    if (withPreview.length === 0) {
      toast({ title: "No previews generated yet", description: "Generate at least one slide preview before exporting.", variant: "destructive" });
      return;
    }
    if (withPreview.length < selected.length) {
      const missing = selected.length - withPreview.length;
      const ok = window.confirm(
        `${missing} slide${missing === 1 ? " has" : "s have"} no preview yet and will be skipped.\n\nExport the ${withPreview.length} slide${withPreview.length === 1 ? "" : "s"} that do have previews?`
      );
      if (!ok) return;
    }
    setGeneratingPdf(true);
    try {
      await saveProgress();
      const res = await fetch(`/api/proposals/${current.id}/export-deck-pdf`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Export failed" }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Eendigo_Proposal_${current.company_name.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "PDF deck downloaded" });
    } catch (err: any) {
      toast({ title: "PDF export failed", description: err.message, variant: "destructive" });
    }
    setGeneratingPdf(false);
  }

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
      2: "Review and edit slide briefs",
      3: "AI is analyzing...",
      4: "Review and edit proposal architecture",
      5: "Select project type and proposal slides",
      6: "Generate and download deck",
    };

    // ── Live AI activity indicator ─────────────────────────────────────
    // Shows a floating badge in the top-right whenever any AI operation
    // is in flight, so the user always knows something is actually
    // happening in the background instead of wondering if the app stalled.
    const slideTitleFor = (id: string | null) =>
      (id && slides.find(s => s.slide_id === id)?.title) || id || "";
    let aiStatus: string | null = null;
    if (analyzing) aiStatus = "Analyzing proposal with Claude…";
    else if (briefMode === "generating") aiStatus = "Generating slide briefs…";
    else if (slideInstructionsParsing) aiStatus = "Parsing Slide Template Instructions…";
    else if (generatingApproach) aiStatus = "Generating project approach…";
    else if (updatingPrompts) aiStatus = "Updating slide prompts from feedback…";
    else if (analyzingRef) aiStatus = `Analyzing reference image for "${slideTitleFor(analyzingRef)}"…`;
    else if (slideGenerating) aiStatus = `Generating content for "${slideTitleFor(slideGenerating)}"…`;
    else if (generatingPage) aiStatus = `Generating page preview for "${slideTitleFor(generatingPage)}"…`;
    else if (slideChatLoading) aiStatus = "Applying chat modification to slide…";
    else if (generating) aiStatus = "Generating PPTX deck…";

    return (
      <div>
        {/* ── Fullscreen slide preview overlay ───────────────────────────
            Pops the currently-previewing slide into a fixed full-viewport
            modal rendered at native 960×540 and scaled to fit. Shares state
            with the inline preview — `editingPreview` toggles contentEditable
            in both places, and onBlur saves back to state + the DB, so
            whichever view you edit in, the other stays in sync. */}
        {fullscreenPreview && previewSlideId && previewHtml[previewSlideId] && (
          <div
            className="fixed inset-0 z-[100] bg-slate-900/95 flex flex-col"
            onClick={(e) => {
              // Click on the dark backdrop (not on the slide or the top bar)
              // closes the overlay. We detect this by checking the target is
              // the backdrop itself, not any descendant.
              if (e.target === e.currentTarget) setFullscreenPreview(false);
            }}
          >
            {/* Top bar */}
            <div
              className="flex items-center justify-between px-4 py-3 bg-slate-800/80 border-b border-slate-700 text-white"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 min-w-0">
                <h3 className="text-sm font-semibold truncate">
                  {slides.find(s => s.slide_id === previewSlideId)?.title ?? "Slide preview"}
                </h3>
                <span className="text-[10px] text-slate-400 hidden md:inline">
                  960 × 540 · scale {Math.round(fullscreenScale * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={editingPreview[previewSlideId] ? "default" : "outline"}
                  className={`h-8 text-xs ${
                    editingPreview[previewSlideId]
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                      : "bg-transparent border-slate-500 text-white hover:bg-slate-700 hover:text-white"
                  }`}
                  onClick={() => setEditingPreview(prev => ({ ...prev, [previewSlideId!]: !prev[previewSlideId!] }))}
                  title={editingPreview[previewSlideId]
                    ? "Click to finish editing"
                    : "Click to edit the slide directly — type over text, delete sections, fix numbers"}
                >
                  {editingPreview[previewSlideId]
                    ? <><Check className="w-3.5 h-3.5 mr-1" /> Done</>
                    : <><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</>}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs bg-transparent border-slate-500 text-white hover:bg-slate-700 hover:text-white"
                  onClick={() => setFullscreenPreview(false)}
                  title="Exit fullscreen (or press Esc)"
                >
                  <Minimize2 className="w-3.5 h-3.5 mr-1" /> Exit
                </Button>
              </div>
            </div>

            {/* Stage: the slide itself, rendered at native 960×540 and
                uniformly scaled via CSS transform. We wrap it in a
                fixed-size container matching the scaled footprint so the
                flexbox centering works correctly. */}
            <div
              className="flex-1 flex items-center justify-center overflow-hidden"
              onClick={(e) => {
                if (e.target === e.currentTarget) setFullscreenPreview(false);
              }}
            >
              <div
                className={`bg-white shadow-2xl ${
                  editingPreview[previewSlideId] ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-slate-900" : ""
                }`}
                style={{
                  width:  960 * fullscreenScale,
                  height: 540 * fullscreenScale,
                  position: "relative",
                  overflow: "hidden",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  // Same remount trick as the inline preview — flipping edit
                  // mode re-seeds the contentEditable DOM from state so we
                  // don't keep a stale draft.
                  key={`fs-${previewSlideId}-${editingPreview[previewSlideId] ? "edit" : "view"}`}
                  contentEditable={!!editingPreview[previewSlideId]}
                  suppressContentEditableWarning
                  spellCheck={!!editingPreview[previewSlideId]}
                  onBlur={(e) => {
                    if (!editingPreview[previewSlideId!]) return;
                    const newHtml = (e.currentTarget as HTMLElement).innerHTML;
                    if (!newHtml || newHtml === previewHtml[previewSlideId!]) return;
                    setPreviewHtml(prev => ({ ...prev, [previewSlideId!]: newHtml }));
                    updateSlideField(previewSlideId!, "preview_html", newHtml);
                    setSlideScores(prev => {
                      const n = { ...prev }; delete n[previewSlideId!]; return n;
                    });
                  }}
                  dangerouslySetInnerHTML={{ __html: previewHtml[previewSlideId] }}
                  style={{
                    width:  960,
                    height: 540,
                    transform: `scale(${fullscreenScale})`,
                    transformOrigin: "top left",
                    fontFamily: "Arial, sans-serif",
                    outline: "none",
                    cursor: editingPreview[previewSlideId] ? "text" : "default",
                  }}
                />
              </div>
            </div>

            {/* Caption */}
            <div
              className="px-4 py-2 bg-slate-800/60 border-t border-slate-700 text-[11px] text-slate-300 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              {editingPreview[previewSlideId]
                ? "Click any text to edit — changes save when you click Done, click outside the slide, or press Esc"
                : "Press Esc or click outside the slide to exit — click Edit to modify directly"}
            </div>
          </div>
        )}

        {/* Floating AI activity indicator — top-right, always visible */}
        {aiStatus && (
          <div className="fixed top-4 right-4 z-50 flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg bg-violet-600 text-white text-xs font-medium animate-in fade-in slide-in-from-top-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span className="max-w-[280px] truncate">{aiStatus}</span>
          </div>
        )}
        {/* Floating save-status indicator — tells the user if anything is
            still pending before they refresh/close the tab. */}
        {!aiStatus && (autoSaving || isDirty) && (
          <div className={`fixed top-4 right-4 z-40 flex items-center gap-2 px-3 py-1.5 rounded-lg shadow-md text-[11px] font-medium ${
            autoSaving ? "bg-amber-500 text-white" : "bg-orange-100 text-orange-800 border border-orange-300"
          }`}>
            {autoSaving ? (
              <><Loader2 className="w-3 h-3 animate-spin shrink-0" /> Saving…</>
            ) : (
              <><div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" /> Unsaved changes</>
            )}
          </div>
        )}
        <PageHeader
          title={
            step === 1 ? "New Proposal" :
            step === 2 ? "Slide Briefing" :
            step === 5 ? "Proposal Structure" :
            current?.proposal_title || `Proposal: ${current?.company_name || ""}`
          }
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
                  Continue to Briefing <ArrowRight className="w-3.5 h-3.5 ml-1" />
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
              <Button size="sm" onClick={handleGoToSlides} disabled={!form.company_name}>
                Continue to Briefing
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 5: Project Type & Slide Selection (a.k.a. Deck) ──────────
            Moved from slot 2 to slot 5 so the user locks the deck structure
            AFTER the AI has produced the architecture, not before. */}
        {step === 5 && (
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
                    onChange={e => {
                      setSlideInstructionsText(e.target.value);
                      onSlideInstructionsChange(e.target.value);
                    }}
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
                  <div className="flex items-center justify-between gap-2 mt-4">
                    <div className="text-xs min-h-[1.25rem]">
                      {slideInstructionsSaveState === "saving" && (
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                        </span>
                      )}
                      {slideInstructionsSaveState === "saved" && (
                        <span className="text-green-600">✓ Saved to server</span>
                      )}
                      {slideInstructionsSaveState === "error" && (
                        <span className="text-red-600" title={slideInstructionsSaveError}>
                          ✗ {slideInstructionsSaveError || "Save failed"}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => setShowSlideInstructions(false)}>Close</Button>
                      <Button
                        variant="secondary"
                        onClick={saveSlideInstructionsNow}
                        disabled={slideInstructionsSaveState === "saving"}
                      >
                        {slideInstructionsSaveState === "saving"
                          ? <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                          : <Save className="w-4 h-4 mr-1" />}
                        Save
                      </Button>
                      <Button onClick={parseSlideInstructions} disabled={slideInstructionsParsing || !slideInstructionsText.trim()}>
                        {slideInstructionsParsing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                        Parse & Apply to Slides
                      </Button>
                    </div>
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
                  {/* Pixel-perfect export (Playwright) — lets you ship the
                      deck from Step 2 without walking through Steps 3–6.
                      Renders every generated preview_html through headless
                      Chromium and builds a PPTX that looks identical to
                      the HTML previews. */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-violet-300 text-violet-700 hover:bg-violet-50"
                    onClick={downloadDeckImages}
                    disabled={generatingImages || generating}
                    title="Export every slide preview via headless Chromium — looks identical to the preview panel"
                  >
                    {generatingImages
                      ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Rendering…</>
                      : <><Sparkles className="w-4 h-4 mr-1" /> Export Deck (pixel-perfect)</>}
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
                        // Always reveal the right-side preview panel — either shows the
                        // existing preview or an explicit "Generate preview" placeholder.
                        // Never auto-generates (costs money).
                        setPreviewSlideId(slide.slide_id);
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
                              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={async () => { await saveProgress(); setExpandedSlidePanel(null); }} disabled={saving}>
                                {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                                Save
                              </Button>
                            </div>
                            <Textarea
                              value={slide.visual_prompt ?? ""}
                              onChange={e => updateSlideField(slide.slide_id, "visual_prompt", e.target.value)}
                              onBlur={() => { flushSave(); }}
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
                              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={async () => { await saveProgress(); setExpandedSlidePanel(null); }} disabled={saving}>
                                {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                                Save
                              </Button>
                            </div>
                            <Textarea
                              value={slide.content_prompt ?? ""}
                              onChange={e => updateSlideField(slide.slide_id, "content_prompt", e.target.value)}
                              onBlur={() => { flushSave(); }}
                              placeholder={slideDefaultPrompts[slide.slide_id]?.content || "Define the workflow/questions to guide content generation for this slide..."}
                              rows={20}
                              className="text-xs font-mono"
                            />
                          </>
                        )}

                        {activePanel === "generate" && (
                          <>
                            {/* ── Template mode: per-region labeled inputs ── */}
                            {slideTemplateInfo[slide.slide_id]?.length ? (
                              <>
                                <div className="flex items-center justify-between">
                                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                    <LayoutTemplate className="w-3 h-3" /> Content for "{slide.title}"
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium ml-1">TEMPLATE</span>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <Button size="sm" variant="default" className="h-7 text-[11px]"
                                      onClick={() => generatePage(slide.slide_id)}
                                      disabled={generatingPage === slide.slide_id}>
                                      {generatingPage === slide.slide_id
                                        ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                        : <Eye className="w-3 h-3 mr-1" />}
                                      Render preview
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={async () => { await saveProgress(); setExpandedSlidePanel(null); }} disabled={saving}>
                                      {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                                      Save
                                    </Button>
                                  </div>
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                  Each field maps to a positioned region on the template. Edit the text, then click <strong>Render preview</strong> — same layout every time.
                                </p>
                                <div className="space-y-2">
                                  {slideTemplateInfo[slide.slide_id].map(region => (
                                    <div key={region.key}>
                                      <label className="text-[11px] font-mono font-semibold text-muted-foreground">{region.key}</label>
                                      <Textarea
                                        rows={1}
                                        value={(slide.generation_answers as any)?.[region.key] ?? ""}
                                        onChange={e => {
                                          const prev = (slide.generation_answers ?? {}) as Record<string, string>;
                                          updateSlideField(slide.slide_id, "generation_answers", {
                                            ...prev,
                                            [region.key]: e.target.value,
                                          });
                                        }}
                                        onBlur={() => { flushSave(); }}
                                        placeholder={region.placeholder}
                                        className="text-xs min-h-[32px]"
                                      />
                                    </div>
                                  ))}
                                </div>
                              </>
                            ) : (
                              /* ── Free-gen mode: single textarea (no template) ── */
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
                                    onBlur={() => { flushSave(); }}
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
                                      onBlur={() => { flushSave(); }}
                                      rows={6}
                                      className="text-xs font-mono mt-1"
                                      placeholder="Type or paste slide content here..."
                                    />
                                  </div>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </React.Fragment>
                );
              }

              return (
                <div className={`grid grid-cols-1 gap-4 ${previewSlideId ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
                  {/* Left: Grouped slide list */}
                  <div className={`space-y-4 ${previewSlideId ? "" : "lg:col-span-2"}`}>
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
                    {previewSlideId && !previewHtml[previewSlideId] ? (
                      /* ── Empty preview placeholder ─────────────────── */
                      <Card className="p-0 overflow-hidden sticky top-20">
                        <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
                          <div>
                            <h3 className="text-xs font-semibold">{slides.find(s => s.slide_id === previewSlideId)?.title ?? "Preview"}</h3>
                            <p className="text-[10px] text-muted-foreground">No preview yet</p>
                          </div>
                          <button onClick={() => setPreviewSlideId(null)}
                            className="p-1 rounded hover:bg-muted text-muted-foreground">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="p-6 flex flex-col items-center justify-center gap-3 text-center bg-gray-50" style={{ minHeight: 280 }}>
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                            <Eye className="w-5 h-5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">This slide has no preview yet</p>
                            <p className="text-[11px] text-muted-foreground mt-1 max-w-[260px]">
                              Generating a preview calls Claude and costs a few cents. You'll be prompted to activate the AI if it's paused.
                            </p>
                          </div>
                          <Button
                            size="sm"
                            className="h-8 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                            disabled={generatingPage === previewSlideId}
                            onClick={() => generatePage(previewSlideId!)}
                          >
                            {generatingPage === previewSlideId ? (
                              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Generating…</>
                            ) : (
                              <><Eye className="w-3.5 h-3.5 mr-1.5" /> Generate preview</>
                            )}
                          </Button>
                          <button
                            className="text-[10px] text-muted-foreground hover:text-foreground underline"
                            onClick={() => toggleSlidePanel(previewSlideId!, "generate")}
                          >
                            Or edit the content prompt first
                          </button>
                        </div>
                      </Card>
                    ) : previewSlideId && previewHtml[previewSlideId] ? (
                      /* ── Slide Preview ─────────────────────────────── */
                      <Card className="p-0 overflow-hidden sticky top-20">
                        <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
                          <div>
                            <h3 className="text-xs font-semibold">{slides.find(s => s.slide_id === previewSlideId)?.title ?? "Preview"}</h3>
                            <p className="text-[10px] text-muted-foreground">Slide preview</p>
                          </div>
                          <div className="flex items-center gap-1">
                            {/* Edit HTML directly — toggles contentEditable on
                                the preview div. Small tweaks (typos, numbers,
                                wording) no longer need an AI round-trip. */}
                            <Button
                              size="sm"
                              variant={editingPreview[previewSlideId] ? "default" : "outline"}
                              className={`h-7 text-[10px] ${editingPreview[previewSlideId] ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
                              onClick={() => setEditingPreview(prev => ({ ...prev, [previewSlideId!]: !prev[previewSlideId!] }))}
                              title={editingPreview[previewSlideId]
                                ? "Click to finish editing"
                                : "Click to edit the slide directly — type over text, delete sections, fix numbers"}
                            >
                              {editingPreview[previewSlideId]
                                ? <><Check className="w-3 h-3 mr-1" /> Done</>
                                : <><Pencil className="w-3 h-3 mr-1" /> Edit</>}
                            </Button>
                            {/* Fullscreen — opens the slide in a much larger
                                overlay for comfortable editing at native
                                960×540 scale. */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px]"
                              onClick={() => setFullscreenPreview(true)}
                              title="Open the slide fullscreen for comfortable editing"
                            >
                              <Maximize2 className="w-3 h-3 mr-1" /> Fullscreen
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-[10px]"
                              onClick={() => downloadSlidePptx(previewSlideId)}>
                              <Download className="w-3 h-3 mr-1" /> PPTX
                            </Button>
                            {/* Whole-deck pixel-perfect exports — Playwright renders every preview_html. */}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] border-violet-300 text-violet-700 hover:bg-violet-50"
                              onClick={downloadDeckPdf}
                              disabled={generatingPdf}
                              title="Export the FULL deck as PDF — same Playwright rendering, one page per slide"
                            >
                              {generatingPdf
                                ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> PDF…</>
                                : <><FileText className="w-3 h-3 mr-1" /> PDF</>}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[10px] border-violet-300 text-violet-700 hover:bg-violet-50"
                              onClick={downloadDeckImages}
                              disabled={generatingImages}
                              title="Export the FULL deck via headless Chromium — every slide preview as a pixel-perfect PPTX"
                            >
                              {generatingImages
                                ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Rendering…</>
                                : <><Sparkles className="w-3 h-3 mr-1" /> Deck</>}
                            </Button>
                            <button onClick={() => setPreviewSlideId(null)}
                              className="p-1 rounded hover:bg-muted text-muted-foreground">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {/* Preview with font inspector (view mode) / direct HTML editor (edit mode) */}
                        <div className="bg-gray-100 p-2 relative group">
                          <div
                            className={`bg-white shadow-lg mx-auto transition-all ${
                              editingPreview[previewSlideId] ? "ring-2 ring-emerald-500 ring-offset-2" : ""
                            }`}
                            style={{ width: "100%", aspectRatio: "16/9", overflow: "hidden", position: "relative" }}
                          >
                            <div
                              // `key` forces React to remount the node when we
                              // flip edit mode, so dangerouslySetInnerHTML re-
                              // seeds from state (instead of leaving the last
                              // edit session's DOM in place).
                              key={`${previewSlideId}-${editingPreview[previewSlideId] ? "edit" : "view"}`}
                              contentEditable={!!editingPreview[previewSlideId]}
                              suppressContentEditableWarning
                              spellCheck={!!editingPreview[previewSlideId]}
                              onBlur={(e) => {
                                // Persist the edited HTML back to state + the
                                // slide record. Fires once per edit session
                                // (when the user clicks outside the slide or
                                // toggles Done).
                                if (!editingPreview[previewSlideId!]) return;
                                const newHtml = (e.currentTarget as HTMLElement).innerHTML;
                                if (!newHtml || newHtml === previewHtml[previewSlideId!]) return;
                                setPreviewHtml(prev => ({ ...prev, [previewSlideId!]: newHtml }));
                                updateSlideField(previewSlideId!, "preview_html", newHtml);
                                // Clear any stale quality score — the slide
                                // has changed, so the number no longer
                                // reflects the current content.
                                setSlideScores(prev => {
                                  const n = { ...prev }; delete n[previewSlideId!]; return n;
                                });
                              }}
                              ref={el => {
                                if (!el) return;
                                // Font-inspector hover is purely a view-mode
                                // affordance — in edit mode it would fight
                                // with text selection, so we skip it entirely.
                                if (editingPreview[previewSlideId!]) return;

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
                              style={{
                                transform: "scale(0.7)",
                                transformOrigin: "top left",
                                width: "143%",
                                height: "143%",
                                fontFamily: "Arial, sans-serif",
                                outline: "none",       // contentEditable gives an ugly default blue focus ring
                                cursor: editingPreview[previewSlideId] ? "text" : "default",
                              }}
                            />
                          </div>
                          <div className="absolute bottom-3 left-3 text-[9px] text-muted-foreground/50 bg-white/80 px-1.5 py-0.5 rounded">
                            {editingPreview[previewSlideId]
                              ? "Click any text to edit — changes save when you click Done or outside the slide"
                              : "Hover text to inspect font — click Edit to modify directly"}
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
                        {/* ── Refine Until Perfect ───────────────────────
                            Kicks off the server-side loop: generate →
                            score → critique → refine → re-score, up to 4
                            rounds or until we hit `refineTarget`. While a
                            refine is running we show the live round-by-
                            round progress strip; when it finishes the
                            strip becomes the permanent "refinement trail"
                            that you can collapse. */}
                        <div className="border-t px-3 py-2 space-y-1.5 bg-violet-50/40">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1">
                              <Wand2 className="w-3 h-3 text-violet-600" />
                              <span className="text-[10px] font-semibold text-violet-700 uppercase">Refine until perfect</span>
                              <span className="text-[8px] text-violet-500">(AI loop)</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <label className="text-[9px] text-muted-foreground">target</label>
                              <input
                                type="number"
                                min={50}
                                max={100}
                                value={refineTarget}
                                onChange={e => setRefineTarget(Math.max(50, Math.min(100, Number(e.target.value) || 85)))}
                                className="w-10 h-5 text-[10px] text-center border rounded font-mono"
                                disabled={refiningSlide === previewSlideId}
                                title="Stop refining once the total quality score reaches this number (0–100)"
                              />
                            </div>
                          </div>
                          <Button
                            size="sm"
                            className="w-full h-7 text-[10px] bg-violet-600 hover:bg-violet-700 text-white"
                            onClick={() => refineSlide(previewSlideId!)}
                            disabled={refiningSlide !== null}
                            title="Iterates up to 4 rounds: draft → self-critique → fix → re-score, until the slide hits your target quality"
                          >
                            {refiningSlide === previewSlideId
                              ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Refining (up to 4 rounds)…</>
                              : <><Wand2 className="w-3 h-3 mr-1" />Refine this slide until ≥ {refineTarget}/100</>}
                          </Button>
                          {/* Refinement trail: one row per round with the score
                              and which dimension was being fixed. Makes the
                              improvement visible so you can tell whether the
                              loop is actually helping or just spinning. */}
                          {(refineHistory[previewSlideId] ?? []).length > 0 && (
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() => setShowRefineHistory(prev => ({ ...prev, [previewSlideId]: !prev[previewSlideId] }))}
                                className="flex items-center gap-1 text-[9px] text-violet-600 hover:text-violet-800 w-full"
                              >
                                <TrendingUp className="w-3 h-3" />
                                Refinement trail ({refineHistory[previewSlideId]!.length} round{refineHistory[previewSlideId]!.length === 1 ? "" : "s"})
                                {showRefineHistory[previewSlideId]
                                  ? <ChevronUp className="w-3 h-3 ml-auto" />
                                  : <ChevronDown className="w-3 h-3 ml-auto" />}
                              </button>
                              {showRefineHistory[previewSlideId] && (
                                <div className="space-y-0.5 pl-1">
                                  {refineHistory[previewSlideId]!.map((h: any, i: number) => {
                                    const prev = i > 0 ? refineHistory[previewSlideId]![i - 1] : null;
                                    const delta = prev ? (h.total ?? 0) - (prev.total ?? 0) : 0;
                                    const totalColor =
                                      (h.total ?? 0) >= 85 ? "text-emerald-600" :
                                      (h.total ?? 0) >= 70 ? "text-amber-600" :
                                                              "text-red-500";
                                    return (
                                      <div key={i} className="flex items-center gap-1.5 text-[9px]">
                                        <span className="text-muted-foreground w-10">R{h.round}</span>
                                        <span className={`font-mono font-bold w-7 ${totalColor}`}>{h.total ?? "—"}</span>
                                        {prev && (
                                          <span className={`text-[8px] font-mono ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                                            {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "="}
                                          </span>
                                        )}
                                        <span className="text-muted-foreground truncate flex-1" title={h.tip || h.focus}>
                                          {h.error ? <span className="text-red-500">{h.error}</span>
                                            : i === 0 ? <>draft · {h.tip || "scored"}</>
                                            : <>fix {h.focus} · {h.tip || "scored"}</>}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
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
                              <button
                                type="button"
                                onClick={() => analyzeSlideQuality(previewSlideId!)}
                                disabled={analyzingSlide === previewSlideId}
                                className={`text-sm font-bold flex items-center gap-1 hover:underline focus:outline-none focus:ring-1 focus:ring-violet-500 rounded px-1 ${
                                  (slideScores[previewSlideId].total ?? 0) >= 80 ? "text-emerald-600" :
                                  (slideScores[previewSlideId].total ?? 0) >= 60 ? "text-amber-600" : "text-red-500"
                                }`}
                                title="Click to see per-dimension analysis and improvement suggestions"
                              >
                                {analyzingSlide === previewSlideId
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : showScoreDetails[previewSlideId]
                                    ? <ChevronUp className="w-3 h-3" />
                                    : <ChevronDown className="w-3 h-3" />}
                                {slideScores[previewSlideId].total ?? 0}%
                              </button>
                            )}
                          </div>
                          {slideScores[previewSlideId] && (() => {
                            const sc = slideScores[previewSlideId];
                            const an = slideAnalyses[previewSlideId];
                            // Prefer the analysis response (fresher + has narrative) but fall back to sc.
                            const fix = an?.fix ?? sc.fix ?? null;
                            const narrative = an?.narrative ?? null;
                            const topFix = an?.top_priority_fix ?? null;
                            const barColor = (sc.total ?? 0) >= 80 ? "bg-emerald-500" : (sc.total ?? 0) >= 60 ? "bg-amber-500" : "bg-red-500";
                            const dimRow = (label: string, key: "clarity" | "relevance" | "visual" | "persuasion") => {
                              const v = sc[key] ?? 0;
                              const dimColor = v >= 20 ? "text-emerald-600" : v >= 15 ? "text-amber-600" : "text-red-500";
                              return (
                                <div className="flex items-start gap-2 text-[10px] py-1 border-b last:border-0 border-muted/40">
                                  <div className="w-16 shrink-0">
                                    <div className="font-semibold text-muted-foreground uppercase text-[9px]">{label}</div>
                                    <div className={`font-mono font-bold text-xs ${dimColor}`}>{v}/25</div>
                                  </div>
                                  <div className="flex-1 text-[10px] text-foreground/80 leading-snug">
                                    {fix?.[key] || <span className="italic text-muted-foreground">click score to analyse</span>}
                                  </div>
                                </div>
                              );
                            };
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
                                {sc.tip && !showScoreDetails[previewSlideId] && (
                                  <p className="text-[9px] text-muted-foreground italic">{sc.tip}</p>
                                )}

                                {/* Expandable click-through analysis: 4 per-dimension
                                    fixes + narrative + single top-priority action. */}
                                {showScoreDetails[previewSlideId] && (
                                  <div className="mt-2 p-2 bg-violet-50 border border-violet-200 rounded space-y-2">
                                    <div className="flex items-center gap-1">
                                      <Wand2 className="w-3 h-3 text-violet-600" />
                                      <span className="text-[9px] font-semibold text-violet-700 uppercase tracking-wide">
                                        {fix ? "Slide analysis" : "Analysing…"}
                                      </span>
                                    </div>

                                    {narrative && (
                                      <p className="text-[10px] text-foreground/80 leading-snug italic">
                                        {narrative}
                                      </p>
                                    )}

                                    <div className="bg-white rounded border border-violet-100 px-1.5">
                                      {dimRow("Clarity",    "clarity")}
                                      {dimRow("Relevance",  "relevance")}
                                      {dimRow("Visual",     "visual")}
                                      {dimRow("Persuasion", "persuasion")}
                                    </div>

                                    {topFix && (
                                      <div className="flex items-start gap-1.5 text-[10px] bg-violet-100 border border-violet-300 rounded px-2 py-1.5">
                                        <TrendingUp className="w-3 h-3 text-violet-700 mt-[1px] shrink-0" />
                                        <div>
                                          <div className="font-semibold text-violet-800 uppercase text-[8px] tracking-wide">Biggest lever</div>
                                          <div className="text-foreground/90 leading-snug">{topFix}</div>
                                        </div>
                                      </div>
                                    )}

                                    {fix && !analyzingSlide && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          // Force refresh: clear cached analysis and re-run.
                                          setSlideAnalyses(prev => { const n = { ...prev }; delete n[previewSlideId!]; return n; });
                                          setShowScoreDetails(prev => ({ ...prev, [previewSlideId!]: false }));
                                          setTimeout(() => analyzeSlideQuality(previewSlideId!), 50);
                                        }}
                                        className="text-[9px] text-violet-600 hover:text-violet-800 hover:underline"
                                      >
                                        Re-analyse
                                      </button>
                                    )}
                                  </div>
                                )}
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
              <Button variant="outline" onClick={() => setStep(4)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Architecture
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
                  {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                  Continue to Generate
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

        {/* ── Step 2: Slide Briefing & Content Definition ──────────────────
            Used to be step 3 — now runs immediately after Input. */}
        {step === 2 && (
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
                  <Button variant="outline" onClick={() => setStep(1)}>
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back to Inputs
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
                  <Button variant="outline" onClick={() => setStep(1)}>
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back to Inputs
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

        {/* ── Step 3: Analyzing (Claude is running) ────────────────────── */}
        {step === 3 && (
          <Card className="p-12 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-lg font-medium">Claude is analyzing your inputs...</p>
            <p className="text-sm text-muted-foreground">Building proposal architecture with 3 options, team composition, pricing...</p>
          </Card>
        )}

        {/* ── Step 4: Editable Architecture ──────────────────────────────── */}
        {step === 4 && current && (
          <div className="space-y-6">
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Briefing
              </Button>
              <Button onClick={async () => { await saveEdits(); setStep(5); }}>
                Continue to Deck <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
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
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Briefing
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={saveEdits} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                  Save Changes
                </Button>
                <Button onClick={async () => { await saveEdits(); setStep(5); }}>
                  Continue to Deck <ArrowRight className="w-4 h-4 ml-1" />
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

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setStep(5)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Back to Deck
              </Button>
              <Button size="lg" onClick={generateDeck} disabled={generating || generatingImages}>
                {generating ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Download className="w-5 h-5 mr-2" />}
                Download PowerPoint (editable)
              </Button>
              {/* PDF export — Playwright renders each preview into a multi-page PDF.
                  Same visual fidelity as the pixel-perfect PPTX; lets you QA the
                  output before committing to the final PowerPoint. */}
              <Button
                size="lg"
                variant="outline"
                onClick={downloadDeckPdf}
                disabled={generating || generatingPdf}
                title="Export every slide preview as a multi-page PDF — same Playwright rendering, easy to QA"
              >
                {generatingPdf
                  ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Rendering PDF…</>
                  : <><FileText className="w-5 h-5 mr-2" /> Download PDF (pixel-perfect)</>}
              </Button>
              {/* Pixel-perfect PPTX export — Chromium renders each preview_html
                  and drops the screenshots into a PPTX. Looks identical to
                  the preview, but slides are raster images (not editable
                  text in PowerPoint). */}
              <Button
                size="lg"
                variant="outline"
                className="border-violet-300 text-violet-700 hover:bg-violet-50"
                onClick={downloadDeckImages}
                disabled={generating || generatingImages}
                title="Export every slide preview via headless Chromium — looks identical to the preview, but slides are raster images (not text-editable in PowerPoint)"
              >
                {generatingImages
                  ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Rendering slides…</>
                  : <><Sparkles className="w-5 h-5 mr-2" /> Export all previews (pixel-perfect)</>}
              </Button>
            </div>
          </Card>
        )}

        {/* ── Storage footer + Delete this proposal ─────────────────────
            Shows how much the current proposal weighs (mostly preview_html
            blobs) so the user can decide whether it's worth keeping.
            Delete is always one click away, always at the bottom. */}
        {current?.id && (() => {
          // Serialize the live state so the number reflects unsaved edits
          // too — otherwise it would only ever show the last-saved snapshot.
          const payload = {
            form,
            slides,
            briefs,
            callChecklist,
            projectType,
            projectApproach,
            options: current?.options ?? [],
          };
          const totalBytes = new Blob([JSON.stringify(payload)]).size;
          const previewBytes = slides.reduce(
            (sum, s) => sum + (s.preview_html ? new Blob([s.preview_html]).size : 0),
            0
          );
          const contentBytes = slides.reduce(
            (sum, s) =>
              sum +
              (s.generated_content ? new Blob([s.generated_content]).size : 0) +
              (s.content_prompt ? new Blob([s.content_prompt]).size : 0) +
              (s.visual_prompt ? new Blob([s.visual_prompt]).size : 0),
            0
          );
          const fmt = (b: number) => {
            if (b < 1024) return `${b} B`;
            if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
            return `${(b / (1024 * 1024)).toFixed(2)} MB`;
          };
          const previewsGenerated = slides.filter(s => !!s.preview_html).length;
          return (
            <Card className="p-4 mt-6 border-red-200 bg-red-50/30">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-sm flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> Proposal storage
                  </div>
                  <div className="text-muted-foreground">
                    Total size of this proposal in the database: <strong>{fmt(totalBytes)}</strong>
                    {previewsGenerated > 0 && <> — {previewsGenerated} slide preview{previewsGenerated === 1 ? "" : "s"} saved ({fmt(previewBytes)})</>}
                  </div>
                  <div className="text-muted-foreground">
                    Prompts + generated content: {fmt(contentBytes)}. Slide previews are the bulk of the size; delete the whole proposal below to reclaim space.
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-300 text-red-700 hover:bg-red-100 shrink-0"
                  onClick={async () => {
                    if (!current?.id) return;
                    const ok = window.confirm(
                      `Delete this proposal?\n\n"${current.company_name}"\n\nThis will permanently remove all slides, prompts, generated content, and ${previewsGenerated} saved preview${previewsGenerated === 1 ? "" : "s"}, freeing about ${fmt(totalBytes)}.\n\nThis cannot be undone.`
                    );
                    if (!ok) return;
                    // Clear dirty state so the unload handler doesn't try
                    // to resurrect the proposal we just deleted.
                    markClean();
                    await deleteProposal(current.id);
                    setCurrent(null);
                    setView("list");
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Delete proposal ({fmt(totalBytes)})
                </Button>
              </div>
            </Card>
          );
        })()}
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
            {proposals.some(p => !p.company_name || !p.company_name.trim()) && (
              <Button
                variant="outline"
                className="border-red-300 text-red-700 hover:bg-red-50"
                onClick={async () => {
                  const blankCount = proposals.filter(p => !p.company_name || !p.company_name.trim()).length;
                  if (!window.confirm(`Delete ${blankCount} blank draft${blankCount === 1 ? "" : "s"}?\n\nThese are leftover empty rows from an earlier bug. They have no company name and no content. This cannot be undone.`)) return;
                  try {
                    const res = await fetch("/api/proposals/cleanup-blank", { method: "POST", credentials: "include" });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const { deleted } = await res.json();
                    toast({ title: `Deleted ${deleted} blank draft${deleted === 1 ? "" : "s"}` });
                    await loadProposals();
                  } catch (err: any) {
                    toast({ title: "Cleanup failed", description: err.message, variant: "destructive" });
                  }
                }}
              >
                <Trash2 className="w-4 h-4 mr-1" /> Clean blank drafts
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowTemplates(true)}>
              <Upload className="w-4 h-4 mr-1" /> Templates
            </Button>
            <Button onClick={startNew}>
              <Plus className="w-4 h-4 mr-1" /> New Proposal
            </Button>
          </div>
        }
      />

      {/* Read.ai recent meetings — green-highlight client conversations,
          copy full script to clipboard for pasting into a new proposal. */}
      <div className="mb-4">
        <ReadAIMeetingsCard />
      </div>

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
