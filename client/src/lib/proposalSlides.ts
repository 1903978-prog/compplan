// ── Master Slide List ─────────────────────────────────────────────────────────

export interface SlideDefinition {
  slide_id: string;
  title: string;
  description: string;
  group: "core" | "optional";
}

export const MASTER_SLIDES: SlideDefinition[] = [
  // ── CORE PAGES (always selected by default, 16 slides) ───────────────────
  // Order matches the Proposals wizard Step 5 Deck view exactly. Updating
  // this list also drives the Slide Backgrounds admin screen (one row per
  // slide_id from here) and SlideMethodologyAdmin's left-hand nav.
  { slide_id: "cover",             title: "Cover Page",             description: "Title slide with company name, date, and Eendigo branding",                                       group: "core" },
  { slide_id: "confidentiality",   title: "Confidentiality",        description: "Confidentiality notice and intellectual property protection",                                     group: "core" },
  { slide_id: "agenda",            title: "Agenda",                 description: "Overview of what the proposal covers",                                                            group: "core" },
  { slide_id: "exec_summary",      title: "Executive Summary",      description: "High-level overview of the engagement",                                                           group: "core" },
  // Merged slide (was `context` + `value_at_stake`). The id stays `context`
  // so existing proposals' slide_selection JSONB arrays keep resolving.
  { slide_id: "context",           title: "Context & Value at stake", description: "Client situation, market dynamics, urgency drivers, and quantified opportunity if nothing changes", group: "core" },
  { slide_id: "proposed_approach", title: "Proposed Approach",      description: "Recommended approach, logic, and high-level workstreams",                                         group: "core" },
  { slide_id: "timeline_options",  title: "Timeline",               description: "Project timeline with milestones",                                                                group: "core" },
  // Promoted from optional → core. Id stays `options`; title shortened to
  // match the wizard ("Options" instead of "Options (2–3)").
  { slide_id: "options",           title: "Options",                description: "2\u20133 engagement options with different scope / investment trade-offs",                          group: "core" },
  { slide_id: "governance_inputs", title: "Governance & Inputs",    description: "Steering committee, escalation, reporting, and client inputs",                                    group: "core" },
  { slide_id: "why_eendigo",       title: "Why Eendigo",            description: "Credentials, case studies, proof of impact, and differentiators",                                 group: "core" },
  { slide_id: "commercials",       title: "Commercials",            description: "Fee structure, pricing, commercial terms, and option variants",                                   group: "core" },
  { slide_id: "impact_roi",        title: "Impact & ROI",           description: "Expected business impact, ROI projections, and value creation",                                   group: "core" },
  { slide_id: "next_steps",        title: "Next Steps",             description: "Immediate actions and decision timeline",                                                         group: "core" },
  // New core slides — wrap-up pages that sit between next_steps and annex.
  { slide_id: "last_page",         title: "Last page",              description: "Closing hand-off page before the annex",                                                          group: "core" },
  { slide_id: "final_message",     title: "Final Message",          description: "Single-line closing statement / call to action",                                                  group: "core" },
  { slide_id: "annex",             title: "Annex",                  description: "Supporting data, detailed tables, and appendix material",                                         group: "core" },

  // ── OPTIONAL PAGES (not selected by default, suggested per project type) ──
  { slide_id: "scope_activities",       title: "Scope & Activities",               description: "Detailed scope breakdown with activity descriptions",                group: "optional" },
  { slide_id: "positioning",            title: 'Positioning ("This is not X") - Scope Boundaries', description: "Differentiation from typical consulting and IN/OUT scope", group: "optional" },
  { slide_id: "diag_justification",     title: "Diagnostic Justification",         description: "Why a diagnostic phase is needed before action",                     group: "optional" },
  { slide_id: "transformation",         title: "Full Transformation Journey",      description: "End-to-end change logic and transformation roadmap",                 group: "optional" },
  { slide_id: "exec_philosophy",        title: "Execution Philosophy",             description: "How Eendigo approaches delivery and execution",                      group: "optional" },
  { slide_id: "methodology",            title: "Methodology Overview",             description: "Core methodology and frameworks used",                               group: "optional" },
  { slide_id: "workstream_modules",     title: "Workstreams / Scope Modules",      description: "Breakdown of work into streams or modules",                          group: "optional" },
  { slide_id: "workstream_activities",  title: "Workstreams / Detailed Activities", description: "Detailed activities within each workstream",                         group: "optional" },
  { slide_id: "scope_deliverables",     title: "Scope & Deliverables",             description: "Summary of scope and key deliverables",                              group: "optional" },
  { slide_id: "deliverables_matrix",    title: "Deliverables Matrix",              description: "Deliverables mapped to workstreams, ownership, and timing",          group: "optional" },
  { slide_id: "comex_map",              title: "ComEx System Map",                 description: "Commercial excellence system and interconnections",                  group: "optional" },
  { slide_id: "sample_deliverables",    title: "Sample Deliverables",              description: "Examples of deliverable formats and outputs",                        group: "optional" },
  { slide_id: "detailed_deliverables",  title: "Detailed Deliverables Table",      description: "Comprehensive deliverables with ownership and timing",               group: "optional" },
  // Kept as an optional for backwards compat with existing proposals whose
  // slide_selection JSONB still references `value_at_stake`. New proposals
  // use the merged `context` slide above and will not get this one by default.
  { slide_id: "value_at_stake",         title: "Value at Stake (legacy)",          description: "[LEGACY] Standalone value-at-stake page — merged into Context & Value at stake for new proposals", group: "optional" },
  { slide_id: "governance_steercos",    title: "Governance: Steercos & Weekly",    description: "Detailed steerco and weekly meeting cadence and agenda",             group: "optional" },
  { slide_id: "exec_cadence",           title: "Execution Cadence (War Rooms)",    description: "War room rhythm and execution governance",                           group: "optional" },
  { slide_id: "team_bio",               title: "Team Bio",                         description: "Proposed team members, bios, and roles",                             group: "optional" },
  { slide_id: "client_deps",            title: "Client Dependencies: Data",        description: "Data, systems, and access the client needs to provide",              group: "optional" },
  { slide_id: "client_time",            title: "Client Time Investment",           description: "Expected time commitment from client stakeholders",                  group: "optional" },
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

// ── Core slide IDs (always pre-selected) ─────────────────────────────────────

const CORE_SLIDE_IDS: string[] = MASTER_SLIDES
  .filter(s => s.group === "core")
  .map(s => s.slide_id);

// ── Suggested optional pages by project type ─────────────────────────────────
// These are highlighted as "SUGGESTED" but NOT ticked by default.
// User decides whether to include them.

export const SUGGESTED_OPTIONALS: Record<ProjectType, string[]> = {
  "Strategy": [
    "positioning", "options", "scope_activities", "methodology",
    "workstream_modules", "team_bio",
  ],
  "Design": [
    "positioning", "scope_activities", "workstream_modules",
    "scope_deliverables", "deliverables_matrix", "team_bio",
  ],
  "SPARK (Diagnostic)": [
    "exec_philosophy", "positioning", "diag_justification", "methodology",
    "comex_map", "detailed_deliverables", "scope_deliverables",
    "governance_steercos", "client_deps", "transformation", "team_bio",
  ],
  "War Rooms (Execution)": [
    "exec_philosophy", "positioning", "methodology",
    "workstream_modules", "comex_map", "sample_deliverables",
    "exec_cadence", "governance_steercos", "team_bio", "client_time",
  ],
  "Org Transformation": [
    "exec_philosophy", "positioning", "transformation", "methodology",
    "workstream_modules", "comex_map", "detailed_deliverables", "options",
    "governance_steercos", "client_deps", "team_bio", "client_time",
  ],
  "CaPDB / Growth Engine": [
    "exec_philosophy", "positioning", "scope_activities", "methodology",
    "workstream_modules", "sample_deliverables", "options",
    "governance_steercos", "client_deps", "team_bio",
  ],
  "SFE (Sales Force Excellence)": [
    "exec_philosophy", "positioning", "methodology",
    "workstream_modules", "comex_map", "sample_deliverables",
    "exec_cadence", "governance_steercos", "team_bio", "client_time",
  ],
  "Coaching & PaM": [
    "exec_philosophy", "positioning", "methodology",
    "sample_deliverables", "exec_cadence",
    "governance_steercos", "team_bio", "client_time",
  ],
  "Incentives & SPM": [
    "exec_philosophy", "positioning", "methodology",
    "comex_map", "sample_deliverables", "options",
    "governance_steercos", "client_deps", "team_bio",
  ],
  "Pricing": [
    "positioning", "diag_justification", "scope_activities", "methodology",
    "comex_map", "sample_deliverables", "detailed_deliverables",
    "governance_steercos", "client_deps", "team_bio",
  ],
};

// ── Slide selection entry (persisted in proposal) ────────────────────────────

export interface SlideSelectionEntry {
  slide_id: string;
  title: string;
  is_selected: boolean;
  default_selected: boolean;
  is_suggested: boolean;
  group: "core" | "optional";
  order: number;
  // Per-slide prompt editing (persisted in proposal JSONB)
  visual_prompt?: string;       // Layout/design instructions for this slide
  content_prompt?: string;      // Text generation workflow/questions
  generation_answers?: Record<string, string>;
  generated_content?: string;
  quality_score?: { clarity: number; relevance: number; visual: number; persuasion: number; total: number; tip: string } | null;
  reference_image?: string | null;
  preview_html?: string | null;    // Generated HTML preview (persisted)
}

// ── Generate default selection for a project type ────────────────────────────

export function getDefaultSlideSelection(projectType: ProjectType): SlideSelectionEntry[] {
  const coreSet = new Set(CORE_SLIDE_IDS);
  const suggestedSet = new Set(SUGGESTED_OPTIONALS[projectType] || []);

  return MASTER_SLIDES.map((slide, idx) => {
    const entry: SlideSelectionEntry = {
      slide_id: slide.slide_id,
      title: slide.title,
      is_selected: coreSet.has(slide.slide_id),
      default_selected: coreSet.has(slide.slide_id),
      is_suggested: suggestedSet.has(slide.slide_id),
      group: slide.group,
      order: idx,
    };
    // Pre-fill confidentiality slide with fixed content (always the same)
    if (slide.slide_id === "confidentiality") {
      entry.visual_prompt = `Two-column layout:
- Left side: Large title "Confidentiality" in Eendigo teal (#1A6571), vertically centered
- Right side: Body text in italic teal, separated by a vertical teal accent line
- Footer: Eendigo logo bottom-right with page number
- Clean white background, no imagery`;
      entry.content_prompt = `This slide is FIXED — do not modify the text.

Eendigo enforces rigorous confidentiality practices to ensure that all client materials, insights, and discussions remain fully protected. Protecting these assets is essential to maintaining competitive advantage.

Equally, our methodologies, analytical frameworks, and proprietary approaches represent core intellectual property developed through years of experience. We rely on our clients to safeguard this knowledge. No portion of this proposal, its analyses, or supporting materials may be shared, reproduced, or disclosed to any external party without prior written consent.

Copyright 2026© Eendigo LLC`;
    }
    // Pre-fill agenda slide with dynamic content prompt
    if (slide.slide_id === "agenda") {
      entry.visual_prompt = `Single-column layout:
- Title "Agenda" in Eendigo teal (#1A6571) at the top left
- Numbered list of agenda items, each on its own line
- Use consistent font size (14-16pt), teal color for numbers, dark text for titles
- Clean spacing between items (1.2× line height)
- Footer: Eendigo logo bottom-right with page number
- No icons, no bullets — just numbered items aligned left
- White background, professional and minimal`;
      entry.content_prompt = `DYNAMIC AGENDA — AUTO-GENERATED FROM SELECTED SLIDES

This page must list EXACTLY the slides that are currently selected in the proposal, in their exact order. It must start from the slide after "Agenda" (typically "Executive Summary") and end with the last selected slide (typically "Next Steps" or "Annex").

RULES:
1. List ONLY slides that have is_selected = true
2. Skip "Cover Page", "Confidentiality", and "Agenda" itself — they are not agenda items
3. Use the exact slide TITLE as the agenda item text (respect any renames the user made)
4. Maintain the exact ORDER defined in the slide selection (the order field)
5. Number each item sequentially starting from 1
6. If an optional slide is selected, it appears in the agenda at its position in the order
7. If a slide is deselected, it must NOT appear in the agenda
8. If a custom slide was added by the user, include it at its position

FORMAT:
1. Executive Summary
2. Context
3. Value at Stake
4. Proposed Approach
5. Timeline
6. Governance & Inputs
7. Impact & ROI
8. Why Eendigo
9. Commercials & Options
10. Next Steps
11. Annex

NOTE: The above is just an example. The actual agenda must reflect the CURRENT slide selection at the time of generation. The system should read the slides array and build the list dynamically.`;
    }
    return entry;
  });
}

// ── Slide count rules ────────────────────────────────────────────────────────

export const SLIDE_COUNT = {
  IDEAL_MIN: 14,
  IDEAL_MAX: 19,
  ACCEPTABLE_MIN: 14,
  ACCEPTABLE_MAX: 22,
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
