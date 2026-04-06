// ── Master Slide List ─────────────────────────────────────────────────────────

export interface SlideDefinition {
  slide_id: string;
  title: string;
  description: string;
}

export const MASTER_SLIDES: SlideDefinition[] = [
  { slide_id: "cover",               title: "Cover Page",                       description: "Title slide with company name, date, and Eendigo branding" },
  { slide_id: "agenda",              title: "Agenda",                           description: "Overview of what the proposal covers" },
  { slide_id: "why_eendigo",         title: "Why Eendigo + Proof of Impact",    description: "Credentials, case studies, and measurable results" },
  { slide_id: "exec_philosophy",     title: "Execution Philosophy",             description: "How Eendigo approaches delivery and execution" },
  { slide_id: "proof_method",        title: "Proof of Method",                  description: "Evidence of the methodology's effectiveness" },
  { slide_id: "exec_summary",        title: "Executive Summary",                description: "High-level overview of the engagement" },
  { slide_id: "client_context",      title: "Client Context + Why Now",         description: "Client situation and urgency drivers" },
  { slide_id: "positioning",         title: 'Positioning ("This is not X")',    description: "Differentiation from typical consulting" },
  { slide_id: "diag_justification",  title: "Diagnostic Justification",         description: "Why a diagnostic phase is needed before action" },
  { slide_id: "transformation",      title: "Transformation Logic",             description: "The change logic and transformation roadmap" },
  { slide_id: "methodology",         title: "Methodology Overview",             description: "Core methodology and frameworks used" },
  { slide_id: "workstreams",         title: "Workstreams / Scope Modules",      description: "Breakdown of work into streams or modules" },
  { slide_id: "deep_dive",           title: "Deep Dive",                        description: "Detailed analysis of key workstream" },
  { slide_id: "scope_boundaries",    title: "Scope Boundaries (IN / OUT)",      description: "What is included vs excluded from scope" },
  { slide_id: "maturity",            title: "Maturity / Size of Prize",         description: "Opportunity sizing and maturity assessment" },
  { slide_id: "org_design",          title: "Org Design Deep Dive",             description: "Organizational design analysis and recommendations" },
  { slide_id: "sfe_lever",           title: "SFE / Lever Deep Dive",            description: "Sales force effectiveness and commercial levers" },
  { slide_id: "comex_map",           title: "ComEx System Map",                 description: "Commercial excellence system and interconnections" },
  { slide_id: "scope_deliverables",  title: "Scope & Deliverables",             description: "Summary of scope and key deliverables" },
  { slide_id: "sample_deliverables", title: "Sample Deliverables",              description: "Examples of deliverable formats and outputs" },
  { slide_id: "detailed_deliverables", title: "Detailed Deliverables Table",    description: "Comprehensive deliverables with ownership and timing" },
  { slide_id: "timeline",            title: "Timeline",                         description: "Project timeline with milestones" },
  { slide_id: "exec_cadence",        title: "Execution Cadence (War Rooms)",    description: "War room rhythm and execution governance" },
  { slide_id: "options",             title: "Options (2\u20133)",               description: "2\u20133 engagement options with different scope/investment" },
  { slide_id: "pricing",             title: "Pricing & Commercials",            description: "Fee structure and commercial terms" },
  { slide_id: "governance",          title: "Governance",                       description: "Steering committee, escalation, and reporting" },
  { slide_id: "team",                title: "Team",                             description: "Proposed team members and their roles" },
  { slide_id: "client_deps",         title: "Client Dependencies",              description: "What the client needs to provide for success" },
  { slide_id: "next_steps",          title: "Next Steps",                       description: "Immediate actions and decision timeline" },
];

// ── Project Types ────────────────────────────────────────────────────────────

export const PROJECT_TYPES = [
  "Strategy",
  "Design",
  "SPARK (Diagnostic)",
  "War Rooms (Execution)",
  "Org Transformation",
  "CaPDB / Growth Engine",
  "SFE (Sales Force Excellence)",
  "Coaching & PaM",
  "Incentives & SPM",
  "Pricing",
] as const;

export type ProjectType = typeof PROJECT_TYPES[number];

// ── Core slides (always pre-selected) ────────────────────────────────────────

const CORE_SLIDE_IDS: string[] = [
  "cover", "agenda", "why_eendigo", "exec_summary", "client_context",
  "methodology", "workstreams", "deep_dive", "scope_deliverables",
  "timeline", "pricing", "team",
];

// ── Conditional defaults by project type ─────────────────────────────────────

const CONDITIONAL_DEFAULTS: Record<ProjectType, string[]> = {
  "Strategy": [
    "positioning", "options", "maturity",
  ],
  "Design": [
    "scope_boundaries", "positioning",
  ],
  "SPARK (Diagnostic)": [
    "exec_philosophy", "positioning", "diag_justification", "maturity",
    "comex_map", "detailed_deliverables", "governance", "client_deps",
    "transformation",
  ],
  "War Rooms (Execution)": [
    "exec_philosophy", "positioning", "maturity", "sfe_lever",
    "comex_map", "sample_deliverables", "exec_cadence", "governance", "next_steps",
  ],
  "Org Transformation": [
    "exec_philosophy", "positioning", "transformation", "maturity",
    "org_design", "comex_map", "detailed_deliverables", "options",
    "governance", "client_deps", "next_steps",
  ],
  "CaPDB / Growth Engine": [
    "exec_philosophy", "positioning", "scope_boundaries", "maturity",
    "sample_deliverables", "options", "governance", "client_deps", "next_steps",
  ],
  "SFE (Sales Force Excellence)": [
    "exec_philosophy", "positioning", "maturity", "sfe_lever",
    "sample_deliverables", "exec_cadence", "governance", "next_steps",
  ],
  "Coaching & PaM": [
    "exec_philosophy", "positioning", "sample_deliverables",
    "exec_cadence", "governance", "next_steps",
  ],
  "Incentives & SPM": [
    "exec_philosophy", "positioning", "maturity", "comex_map",
    "sample_deliverables", "options", "governance", "client_deps", "next_steps",
  ],
  "Pricing": [
    "positioning", "diag_justification", "scope_boundaries", "maturity",
    "comex_map", "sample_deliverables", "detailed_deliverables",
    "governance", "client_deps", "next_steps",
  ],
};

// ── Slide selection entry (persisted in proposal) ────────────────────────────

export interface SlideSelectionEntry {
  slide_id: string;
  title: string;
  is_selected: boolean;
  default_selected: boolean;
  order: number;
}

// ── Generate default selection for a project type ────────────────────────────

export function getDefaultSlideSelection(projectType: ProjectType): SlideSelectionEntry[] {
  const selectedIds = new Set([...CORE_SLIDE_IDS, ...CONDITIONAL_DEFAULTS[projectType]]);

  return MASTER_SLIDES.map((slide, idx) => ({
    slide_id: slide.slide_id,
    title: slide.title,
    is_selected: selectedIds.has(slide.slide_id),
    default_selected: selectedIds.has(slide.slide_id),
    order: idx,
  }));
}

// ── Slide count rules ────────────────────────────────────────────────────────

export const SLIDE_COUNT = {
  IDEAL_MIN: 12,
  IDEAL_MAX: 13,
  ACCEPTABLE_MIN: 11,
  ACCEPTABLE_MAX: 15,
};

export function getSlideCountStatus(count: number): { color: string; message: string } {
  if (count >= SLIDE_COUNT.IDEAL_MIN && count <= SLIDE_COUNT.IDEAL_MAX) {
    return { color: "text-green-600", message: "Ideal structure" };
  }
  if (count >= SLIDE_COUNT.ACCEPTABLE_MIN && count <= SLIDE_COUNT.ACCEPTABLE_MAX) {
    return { color: "text-yellow-600", message: "Acceptable range" };
  }
  if (count < SLIDE_COUNT.ACCEPTABLE_MIN) {
    return { color: "text-orange-600", message: `Too light \u2014 consider adding ${SLIDE_COUNT.IDEAL_MIN - count} more slide${SLIDE_COUNT.IDEAL_MIN - count > 1 ? "s" : ""}` };
  }
  return { color: "text-orange-600", message: `Slightly long \u2014 consider removing ${count - SLIDE_COUNT.IDEAL_MAX} slide${count - SLIDE_COUNT.IDEAL_MAX > 1 ? "s" : ""}` };
}
