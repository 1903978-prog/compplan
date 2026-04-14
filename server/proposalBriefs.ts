import Anthropic from "@anthropic-ai/sdk";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SlideBriefField {
  key: string;
  label: string;
  value: string;
}

export interface SlideBrief {
  slide_id: string;
  title: string;
  purpose: string;
  content_structure: SlideBriefField[];
  notes: string;
}

interface BriefInput {
  company_name: string;
  website?: string | null;
  transcript?: string | null;
  notes?: string | null;
  revenue?: number | null;
  ebitda_margin?: number | null;
  scope_perimeter?: string | null;
  objective?: string | null;
  urgency?: string | null;
  project_type: string;
  selected_slides: { slide_id: string; title: string }[];
  admin_configs?: Record<string, any>;  // slide_id → SlideMethodologyConfig
}

// ── Slide-specific structures ────────────────────────────────────────────────

const SLIDE_STRUCTURES: Record<string, { purpose: string; fields: { key: string; label: string; hint: string }[] }> = {
  cover: {
    purpose: "Title slide with company name, date, and Eendigo branding",
    fields: [
      { key: "title", label: "Proposal Title", hint: "e.g. 'Commercial Excellence Transformation'" },
      { key: "subtitle", label: "Subtitle", hint: "e.g. 'Engagement Proposal for [Company]'" },
      { key: "date", label: "Date", hint: "Proposal date" },
    ],
  },
  confidentiality: {
    purpose: "Confidentiality notice and intellectual property protection statement",
    fields: [
      { key: "confidentiality_text", label: "Confidentiality Statement", hint: "Standard Eendigo confidentiality and IP protection text" },
      { key: "copyright", label: "Copyright Line", hint: "e.g. Copyright 2026 Eendigo LLC" },
    ],
  },
  agenda: {
    purpose: "Overview of what the proposal covers",
    fields: [
      { key: "items", label: "Agenda Items", hint: "Numbered list of sections in the proposal" },
    ],
  },
  why_eendigo: {
    purpose: "Credentials, case studies, and measurable results",
    fields: [
      { key: "credentials", label: "Key Credentials", hint: "3-4 proof points of Eendigo expertise" },
      { key: "case_studies", label: "Relevant Case Studies", hint: "2-3 similar engagements with outcomes" },
      { key: "impact_numbers", label: "Impact Numbers", hint: "Quantified results from past work" },
    ],
  },
  exec_philosophy: {
    purpose: "How Eendigo approaches delivery and execution",
    fields: [
      { key: "principles", label: "Core Principles", hint: "3-4 execution principles" },
      { key: "differentiation", label: "What Makes This Different", hint: "How the approach differs from traditional consulting" },
    ],
  },
  proof_method: {
    purpose: "Evidence of the methodology's effectiveness",
    fields: [
      { key: "methodology_evidence", label: "Method Evidence", hint: "Data or cases proving the methodology works" },
      { key: "outcomes", label: "Documented Outcomes", hint: "Specific results achieved" },
    ],
  },
  exec_summary: {
    purpose: "High-level overview of the engagement",
    fields: [
      { key: "context", label: "Context", hint: "Client situation in 2-3 sentences" },
      { key: "why_now", label: "Why Now", hint: "Urgency and trigger for change" },
      { key: "recommendation", label: "Recommendation", hint: "What Eendigo proposes" },
      { key: "impact", label: "Expected Impact", hint: "Quantified impact if possible" },
      { key: "priorities", label: "Top 3 Priorities", hint: "The three most critical focus areas" },
      { key: "scope", label: "Scope Summary", hint: "High-level scope statement" },
      { key: "deliverables", label: "Key Deliverables", hint: "2-4 main outputs" },
    ],
  },
  context: {
    purpose: "Client situation, market dynamics, and urgency drivers",
    fields: [
      { key: "business_model", label: "Business Model Summary", hint: "What the company does and how it makes money" },
      { key: "challenges", label: "Key Challenges", hint: "3-5 specific challenges the client faces" },
      { key: "performance_gaps", label: "Performance Gaps", hint: "Where performance falls short of potential" },
      { key: "trigger", label: "Trigger for Change", hint: "What caused the client to seek help now" },
    ],
  },
  client_context: {
    purpose: "Client situation and urgency drivers",
    fields: [
      { key: "business_model", label: "Business Model Summary", hint: "What the company does and how it makes money" },
      { key: "challenges", label: "Key Challenges", hint: "3-5 specific challenges the client faces" },
      { key: "performance_gaps", label: "Performance Gaps", hint: "Where performance falls short of potential" },
      { key: "trigger", label: "Trigger for Change", hint: "What caused the client to seek help now" },
    ],
  },
  positioning: {
    purpose: "Differentiation from typical consulting",
    fields: [
      { key: "not_this", label: '"This is NOT..."', hint: "What this engagement is not (e.g. not a strategy deck, not a benchmarking exercise)" },
      { key: "this_is", label: '"This IS..."', hint: "What this engagement actually delivers" },
      { key: "difference", label: "Key Difference", hint: "The core differentiator from competitors" },
    ],
  },
  diag_justification: {
    purpose: "Why a diagnostic phase is needed before action",
    fields: [
      { key: "why_diagnose", label: "Why Diagnose First", hint: "Why jumping to solutions would be premature" },
      { key: "what_we_assess", label: "What We Assess", hint: "Key areas of the diagnostic" },
      { key: "expected_output", label: "Diagnostic Output", hint: "What the diagnostic delivers" },
    ],
  },
  transformation: {
    purpose: "The change logic and transformation roadmap",
    fields: [
      { key: "current_state", label: "Current State", hint: "Where the organization is today" },
      { key: "target_state", label: "Target State", hint: "Where it needs to be" },
      { key: "change_logic", label: "Change Logic", hint: "The logical sequence of transformation" },
      { key: "enablers", label: "Key Enablers", hint: "What needs to be in place for success" },
    ],
  },
  methodology: {
    purpose: "Core methodology and frameworks used",
    fields: [
      { key: "approach", label: "Overall Approach", hint: "The methodology logic flow" },
      { key: "phases", label: "Key Phases", hint: "Main phases of the approach" },
      { key: "emphasis", label: "Emphasis Areas", hint: "What this methodology focuses on most" },
      { key: "modules", label: "Key Modules", hint: "The building blocks of the methodology" },
    ],
  },
  workstreams: {
    purpose: "Breakdown of work into streams or modules",
    fields: [
      { key: "modules", label: "Workstream Modules", hint: "List each workstream with 1-2 line descriptions" },
      { key: "dependencies", label: "Dependencies Between Streams", hint: "How workstreams connect" },
    ],
  },
  deep_dive: {
    purpose: "Detailed analysis of key workstream",
    fields: [
      { key: "drivers", label: "Key Drivers (8-12 max)", hint: "Observation \u2192 Root cause \u2192 Action for each" },
      { key: "observations", label: "Key Observations", hint: "What the data or interviews reveal" },
      { key: "root_causes", label: "Root Causes", hint: "Underlying reasons for the issues" },
      { key: "actions", label: "Recommended Actions", hint: "Specific actions to address each driver" },
    ],
  },
  scope_boundaries: {
    purpose: "What is included vs excluded from scope",
    fields: [
      { key: "in_scope", label: "IN Scope", hint: "What is explicitly included" },
      { key: "out_scope", label: "OUT of Scope", hint: "What is explicitly excluded" },
      { key: "assumptions", label: "Assumptions", hint: "Key assumptions about scope" },
    ],
  },
  maturity: {
    purpose: "Opportunity sizing and maturity assessment",
    fields: [
      { key: "current_maturity", label: "Current Maturity", hint: "Where the client stands on the maturity curve" },
      { key: "benchmark", label: "Benchmark / Best Practice", hint: "What best-in-class looks like" },
      { key: "gap", label: "Gap Analysis", hint: "The gap between current and target" },
      { key: "impact", label: "Size of Prize", hint: "Quantified potential impact" },
      { key: "assumptions", label: "Assumptions", hint: "Key assumptions behind the sizing" },
    ],
  },
  org_design: {
    purpose: "Organizational design analysis and recommendations",
    fields: [
      { key: "current_structure", label: "Current Structure", hint: "How the org is structured today" },
      { key: "issues", label: "Structural Issues", hint: "What isn't working" },
      { key: "proposed_changes", label: "Proposed Changes", hint: "Recommended restructuring" },
      { key: "impact", label: "Expected Impact", hint: "What the new design enables" },
    ],
  },
  sfe_lever: {
    purpose: "Sales force effectiveness and commercial levers",
    fields: [
      { key: "coverage", label: "Coverage Analysis", hint: "Territory and segment coverage" },
      { key: "activity", label: "Activity Analysis", hint: "Sales activity patterns and gaps" },
      { key: "pipeline", label: "Pipeline Health", hint: "Pipeline conversion and quality" },
      { key: "levers", label: "Key Levers", hint: "The commercial levers to activate" },
    ],
  },
  comex_map: {
    purpose: "Commercial excellence system and interconnections",
    fields: [
      { key: "system_elements", label: "System Elements", hint: "Key components of the commercial system" },
      { key: "interconnections", label: "Interconnections", hint: "How elements interact" },
      { key: "focus_areas", label: "Focus Areas", hint: "Where to intervene first" },
    ],
  },
  scope_deliverables: {
    purpose: "Summary of scope and key deliverables",
    fields: [
      { key: "scope_summary", label: "Scope Statement", hint: "Overall scope in 2-3 sentences" },
      { key: "deliverables", label: "Deliverables by Workstream", hint: "Grouped list of tangible outputs" },
    ],
  },
  sample_deliverables: {
    purpose: "Examples of deliverable formats and outputs",
    fields: [
      { key: "examples", label: "Sample Outputs", hint: "2-3 examples of what deliverables look like" },
      { key: "format", label: "Format & Quality", hint: "Expected format and level of detail" },
    ],
  },
  detailed_deliverables: {
    purpose: "Comprehensive deliverables with ownership and timing",
    fields: [
      { key: "deliverable_table", label: "Deliverables Table", hint: "Each deliverable with owner, timing, and format" },
    ],
  },
  timeline: {
    purpose: "Project timeline with milestones",
    fields: [
      { key: "phases", label: "Phases", hint: "Name and duration of each phase" },
      { key: "milestones", label: "Key Milestones", hint: "Critical checkpoints" },
      { key: "duration", label: "Total Duration", hint: "Overall project duration" },
    ],
  },
  exec_cadence: {
    purpose: "War room rhythm and execution governance",
    fields: [
      { key: "cadence", label: "Meeting Cadence", hint: "Frequency and format of war rooms" },
      { key: "kpis", label: "Tracking KPIs", hint: "Key metrics tracked in each session" },
      { key: "governance", label: "Escalation Process", hint: "How issues get escalated" },
    ],
  },
  options: {
    purpose: "2\u20133 engagement options with different scope/investment",
    fields: [
      { key: "option_1", label: "Option 1 (Essential)", hint: "Lighter scope, shorter duration" },
      { key: "option_2", label: "Option 2 (Standard)", hint: "Full scope, balanced team" },
      { key: "option_3", label: "Option 3 (Premium)", hint: "Comprehensive, maximum impact" },
      { key: "comparison_logic", label: "Comparison Logic", hint: "How the options differ and why" },
    ],
  },
  pricing: {
    purpose: "Fee structure and commercial terms",
    fields: [
      { key: "fee_structure", label: "Fee Structure", hint: "How fees are structured (fixed, weekly, etc.)" },
      { key: "total_fees", label: "Total Fees by Option", hint: "Fee for each option" },
      { key: "payment_terms", label: "Payment Terms", hint: "Payment schedule and conditions" },
    ],
  },
  governance: {
    purpose: "Steering committee, escalation, and reporting",
    fields: [
      { key: "structure", label: "Governance Structure", hint: "Steering committee, working groups" },
      { key: "reporting", label: "Reporting Cadence", hint: "Frequency and format of reports" },
      { key: "escalation", label: "Escalation Path", hint: "How issues are raised and resolved" },
    ],
  },
  team: {
    purpose: "Proposed team members and their roles",
    fields: [
      { key: "team_composition", label: "Team Composition", hint: "Roles and responsibilities" },
      { key: "effort", label: "Effort Allocation", hint: "Days per week per role" },
      { key: "rationale", label: "Team Rationale", hint: "Why this team structure" },
    ],
  },
  client_deps: {
    purpose: "What the client needs to provide for success",
    fields: [
      { key: "data", label: "Data Requirements", hint: "Data access needed" },
      { key: "people", label: "People Availability", hint: "Who needs to be available and when" },
      { key: "decisions", label: "Key Decisions Needed", hint: "Decisions the client must make" },
    ],
  },
  next_steps: {
    purpose: "Immediate actions and decision timeline",
    fields: [
      { key: "immediate_actions", label: "Immediate Actions", hint: "What happens next" },
      { key: "decision_timeline", label: "Decision Timeline", hint: "When decisions are needed" },
      { key: "kick_off", label: "Kick-off Plan", hint: "How the project starts" },
    ],
  },
  // ── New slide IDs (matching updated MASTER_SLIDES) ─────────────────────────
  value_at_stake: {
    purpose: "Quantified opportunity sizing and impact if nothing changes",
    fields: [
      { key: "current_state", label: "Current Performance", hint: "Where the client stands today (revenue, margin, etc.)" },
      { key: "gap", label: "Performance Gap", hint: "The gap between current and potential" },
      { key: "impact", label: "Value at Stake", hint: "Quantified impact of inaction (EUR M, % margin, etc.)" },
      { key: "assumptions", label: "Assumptions", hint: "Key assumptions behind the sizing" },
    ],
  },
  proposed_approach: {
    purpose: "Recommended approach, logic, and high-level workstreams",
    fields: [
      { key: "approach_logic", label: "Approach Logic", hint: "The overall logic flow of the approach" },
      { key: "phases", label: "Key Phases", hint: "Main phases with description" },
      { key: "workstreams", label: "Workstreams Overview", hint: "High-level workstream names and focus" },
      { key: "emphasis", label: "Emphasis Areas", hint: "What the approach focuses on most" },
    ],
  },
  timeline_options: {
    purpose: "Project timeline with milestones and option variants",
    fields: [
      { key: "phases", label: "Phases", hint: "Name and duration of each phase" },
      { key: "milestones", label: "Key Milestones", hint: "Critical checkpoints" },
      { key: "duration", label: "Total Duration", hint: "Overall project duration" },
      { key: "options_timeline", label: "Timeline by Option", hint: "How timeline differs per engagement option" },
    ],
  },
  governance_inputs: {
    purpose: "Steering committee, escalation, reporting, and client inputs",
    fields: [
      { key: "structure", label: "Governance Structure", hint: "Steering committee, working groups" },
      { key: "reporting", label: "Reporting Cadence", hint: "Frequency and format of reports" },
      { key: "escalation", label: "Escalation Path", hint: "How issues are raised and resolved" },
      { key: "client_inputs", label: "Client Inputs Required", hint: "Data, decisions, and access needed from client" },
    ],
  },
  impact_roi: {
    purpose: "Expected business impact, ROI projections, and value creation",
    fields: [
      { key: "expected_impact", label: "Expected Impact", hint: "Quantified business outcomes (revenue, margin, efficiency)" },
      { key: "roi_logic", label: "ROI Logic", hint: "Investment vs. return calculation" },
      { key: "value_drivers", label: "Value Drivers", hint: "Key levers driving the impact" },
      { key: "timeline_to_value", label: "Timeline to Value", hint: "When the client starts seeing results" },
    ],
  },
  commercials: {
    purpose: "Fee structure, pricing, and commercial terms",
    fields: [
      { key: "fee_structure", label: "Fee Structure", hint: "How fees are structured (fixed, weekly, etc.)" },
      { key: "total_fees", label: "Total Fees by Option", hint: "Fee for each option" },
      { key: "payment_terms", label: "Payment Terms", hint: "Payment schedule and conditions" },
    ],
  },
  annex: {
    purpose: "Supporting data, detailed tables, and appendix material",
    fields: [
      { key: "appendix_items", label: "Appendix Items", hint: "List of supporting materials to include" },
    ],
  },
  scope_activities: {
    purpose: "Detailed scope breakdown with activity descriptions",
    fields: [
      { key: "activities", label: "Key Activities", hint: "Activity list grouped by workstream or phase" },
      { key: "ownership", label: "Ownership", hint: "Who leads each activity" },
    ],
  },
  workstream_modules: {
    purpose: "Breakdown of work into streams or modules",
    fields: [
      { key: "modules", label: "Workstream Modules", hint: "List each workstream with 1-2 line descriptions" },
      { key: "dependencies", label: "Dependencies Between Streams", hint: "How workstreams connect" },
    ],
  },
  workstream_activities: {
    purpose: "Detailed activities within each workstream",
    fields: [
      { key: "workstream_details", label: "Activities by Workstream", hint: "For each workstream, list specific activities and outputs" },
    ],
  },
  deliverables_matrix: {
    purpose: "Deliverables mapped to workstreams, ownership, and timing",
    fields: [
      { key: "matrix", label: "Deliverables Matrix", hint: "Deliverable | Workstream | Owner | Timing" },
    ],
  },
  governance_steercos: {
    purpose: "Detailed steerco and weekly meeting cadence and agenda",
    fields: [
      { key: "steerco", label: "Steering Committee", hint: "Frequency, participants, agenda" },
      { key: "weekly", label: "Weekly Meetings", hint: "Working-level cadence and format" },
      { key: "agenda_template", label: "Agenda Template", hint: "Standard agenda structure" },
    ],
  },
  team_bio: {
    purpose: "Proposed team members, bios, and roles",
    fields: [
      { key: "team_composition", label: "Team Composition", hint: "Roles and responsibilities" },
      { key: "bios", label: "Team Bios", hint: "Brief bio for each team member" },
      { key: "effort", label: "Effort Allocation", hint: "Days per week per role" },
    ],
  },
  client_time: {
    purpose: "Expected time commitment from client stakeholders",
    fields: [
      { key: "stakeholder_time", label: "Stakeholder Time", hint: "Hours per week expected from key stakeholders" },
      { key: "workshops", label: "Workshop Participation", hint: "Number and duration of workshops requiring client presence" },
    ],
  },
};

// ── Methodology logic by project type ────────────────────────────────────────

const METHODOLOGY_BY_TYPE: Record<string, string> = {
  "Strategy":                    "Segmentation \u2192 Prioritization \u2192 Roadmap",
  "Design":                      "Discovery \u2192 Architecture \u2192 Validation \u2192 Blueprint",
  "SPARK (Diagnostic)":          "Diagnostic \u2192 Maturity Assessment \u2192 Roadmap",
  "War Rooms (Execution)":       "Cadence \u2192 KPIs \u2192 Governance \u2192 Execution Loops",
  "Org Transformation":          "Current State \u2192 Target Design \u2192 Transition Plan \u2192 Implementation",
  "CaPDB / Growth Engine":       "ICP \u2192 Sourcing \u2192 Prioritization \u2192 Activation",
  "SFE (Sales Force Excellence)": "Coverage \u2192 Activity \u2192 Pipeline \u2192 Conversion",
  "Coaching & PaM":              "Assessment \u2192 Program Design \u2192 Coaching Cycles \u2192 Measurement",
  "Incentives & SPM":            "Current Plan Analysis \u2192 Design \u2192 Modeling \u2192 Roll-out",
  "Pricing":                     "Price Drivers \u2192 GTN Analysis \u2192 Optimization \u2192 Governance",
};

// ── Resolve fields: admin config overrides defaults ──────────────────────────

function getFieldsForSlide(slideId: string, adminConfig?: any): { key: string; label: string; hint: string }[] {
  // If admin config has structure.sections, use those as fields
  if (adminConfig?.structure?.sections?.length > 0) {
    return adminConfig.structure.sections.map((section: string) => {
      const key = section.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      return { key, label: section, hint: section };
    });
  }
  // Fallback to hardcoded defaults
  const structure = SLIDE_STRUCTURES[slideId];
  return structure ? structure.fields : [{ key: "content", label: "Content", hint: "Content for this slide" }];
}

function getPurposeForSlide(slideId: string, adminConfig?: any): string {
  if (adminConfig?.purpose) return adminConfig.purpose;
  return SLIDE_STRUCTURES[slideId]?.purpose || "Slide content";
}

// ── Claude tool schema ───────────────────────────────────────────────────────

function buildBriefTool(selectedSlides: { slide_id: string; title: string }[], adminConfigs?: Record<string, any>) {
  const slideProperties: Record<string, any> = {};

  for (const slide of selectedSlides) {
    const adminCfg = adminConfigs?.[slide.slide_id];
    const fields = getFieldsForSlide(slide.slide_id, adminCfg);

    const fieldProperties: Record<string, any> = {};
    for (const field of fields) {
      fieldProperties[field.key] = { type: "string", description: field.hint };
    }

    slideProperties[slide.slide_id] = {
      type: "object",
      description: `Brief for "${slide.title}"`,
      properties: fieldProperties,
      required: fields.map(f => f.key),
    };
  }

  return {
    name: "submit_slide_briefs" as const,
    description: "Submit structured content briefs for each selected proposal slide",
    input_schema: {
      type: "object" as const,
      properties: slideProperties,
      required: selectedSlides.map(s => s.slide_id),
    },
  };
}

// ── Mock briefs (fallback) ───────────────────────────────────────────────────

function getMockBriefs(input: BriefInput): SlideBrief[] {
  return input.selected_slides.map(slide => {
    const adminCfg = input.admin_configs?.[slide.slide_id];
    const resolvedFields = getFieldsForSlide(slide.slide_id, adminCfg);
    const purpose = getPurposeForSlide(slide.slide_id, adminCfg);

    const fields: SlideBriefField[] = resolvedFields.map(f => ({
      key: f.key,
      label: f.label,
      value: `[AI unavailable \u2014 set ANTHROPIC_API_KEY] ${f.hint}`,
    }));

    return {
      slide_id: slide.slide_id,
      title: slide.title,
      purpose,
      content_structure: fields,
      notes: "",
    };
  });
}

// ── Main function ────────────────────────────────────────────────────────────

export async function generateSlideBriefs(input: BriefInput): Promise<SlideBrief[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY not set \u2014 returning mock briefs");
    return getMockBriefs(input);
  }

  const client = new Anthropic({ apiKey });

  // Build context
  const contextParts: string[] = [];
  contextParts.push(`Company: ${input.company_name}`);
  contextParts.push(`Project Type: ${input.project_type}`);
  if (input.website) contextParts.push(`Website: ${input.website}`);
  if (input.revenue) contextParts.push(`Revenue: EUR ${input.revenue}M`);
  if (input.ebitda_margin) contextParts.push(`EBITDA margin: ${input.ebitda_margin}%`);
  if (input.objective) contextParts.push(`Client objective: ${input.objective}`);
  if (input.scope_perimeter) contextParts.push(`Scope/perimeter: ${input.scope_perimeter}`);
  if (input.urgency) contextParts.push(`Urgency: ${input.urgency}`);
  if (input.transcript) contextParts.push(`Call transcript:\n${input.transcript}`);
  if (input.notes) contextParts.push(`Additional notes:\n${input.notes}`);

  const methodologyLogic = METHODOLOGY_BY_TYPE[input.project_type] || "Diagnostic \u2192 Design \u2192 Implementation";

  const adminConfigs = input.admin_configs || {};

  // Build enriched slide list with admin overrides
  const slideList = input.selected_slides.map((s, i) => {
    const adminCfg = adminConfigs[s.slide_id];
    const fields = getFieldsForSlide(s.slide_id, adminCfg);
    const purpose = getPurposeForSlide(s.slide_id, adminCfg);
    const fieldsDesc = fields.map(f => `  - ${f.label}: ${f.hint}`).join("\n");

    let slideBlock = `${i + 1}. ${s.title} (${s.slide_id})\n  Purpose: ${purpose}\n${fieldsDesc}`;

    // Inject admin rules if configured
    if (adminCfg?.rules) {
      slideBlock += `\n  RULES:\n${adminCfg.rules.split("\n").map((r: string) => `    ${r}`).join("\n")}`;
    }
    // Inject project-type variation
    if (adminCfg?.variations?.[input.project_type]) {
      slideBlock += `\n  PROJECT-TYPE OVERRIDE (${input.project_type}): ${adminCfg.variations[input.project_type]}`;
    }
    // Inject examples
    if (adminCfg?.examples?.length > 0) {
      slideBlock += `\n  EXAMPLES:\n${adminCfg.examples.map((ex: string) => `    - ${ex}`).join("\n")}`;
    }
    // Inject column logic
    if (adminCfg?.columns?.column_1) {
      slideBlock += `\n  COLUMN LAYOUT: ${adminCfg.columns.column_1} | ${adminCfg.columns.column_2 || ""} | ${adminCfg.columns.column_3 || ""}`;
    }

    return slideBlock;
  }).join("\n\n");

  const systemPrompt = `You are Eendigo's senior proposal strategist. You specialize in management consulting proposals for commercial excellence, pricing, SFE, org transformation, and go-to-market optimization.

Your task: Generate a structured CONTENT BRIEF for each slide in a proposal. This is NOT final text \u2014 it is structured thinking that will guide slide creation.

CRITICAL RULES:
1. No generic consulting language. Be specific to the client and project type.
2. Must reflect the project type "${input.project_type}" methodology: ${methodologyLogic}
3. Use bullet points and structured content, not paragraphs.
4. Be concrete and actionable. Every field should contain usable content.
5. For slides with RULES defined below, you MUST follow those rules exactly.
6. For slides with EXAMPLES, use them as quality benchmarks for your output.
7. For slides with COLUMN LAYOUT, structure the content to fit that column pattern.
8. All quantified claims must be grounded in the client context provided.
9. Keep each field concise (2-5 bullet points or 1-3 sentences max).

The selected slides for this proposal are:
${slideList}`;

  const tool = buildBriefTool(input.selected_slides, adminConfigs);

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: systemPrompt,
      tools: [tool],
      tool_choice: { type: "tool", name: "submit_slide_briefs" },
      messages: [{ role: "user", content: contextParts.join("\n\n") }],
    });

    const toolUse = response.content.find((block: any) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      console.error("No tool_use block in Claude response");
      return getMockBriefs(input);
    }

    const rawBriefs = toolUse.input as Record<string, Record<string, string>>;

    // Transform into SlideBrief[] using admin-resolved fields
    return input.selected_slides.map(slide => {
      const adminCfg = adminConfigs[slide.slide_id];
      const resolvedFields = getFieldsForSlide(slide.slide_id, adminCfg);
      const purpose = getPurposeForSlide(slide.slide_id, adminCfg);
      const briefData = rawBriefs[slide.slide_id] || {};

      const fields: SlideBriefField[] = resolvedFields.map(f => ({
        key: f.key,
        label: f.label,
        value: briefData[f.key] || "",
      }));

      return {
        slide_id: slide.slide_id,
        title: slide.title,
        purpose,
        content_structure: fields,
        notes: "",
      };
    });
  } catch (error) {
    console.error("Claude API error (briefs):", error);
    return getMockBriefs(input);
  }
}

// Export for route use
export { SLIDE_STRUCTURES };

// ── Per-slide defaults & generation ─────────────────────────────────────────

export function getSlideDefaults(slideId: string, adminConfig?: any): {
  visual_prompt: string;
  content_prompt: string;
  follow_up_questions: { key: string; question: string }[];
} {
  const structure = SLIDE_STRUCTURES[slideId];

  // Visual prompt from admin config or generic default
  let visualPrompt = "Standard single-column slide with header, body content, and Eendigo footer bar.";
  if (adminConfig) {
    const parts: string[] = [];
    if (adminConfig.format) parts.push(`Format: ${adminConfig.format}`);
    if (adminConfig.columns?.column_1) parts.push(`Column 1: ${adminConfig.columns.column_1}`);
    if (adminConfig.columns?.column_2) parts.push(`Column 2: ${adminConfig.columns.column_2}`);
    if (adminConfig.rules) parts.push(`Rules: ${adminConfig.rules}`);
    if (parts.length > 0) visualPrompt = parts.join("\n");
  }

  // Content prompt as a workflow of guiding questions
  let contentPrompt = "Describe the key content for this slide.";
  const followUpQuestions: { key: string; question: string }[] = [];

  if (structure) {
    const lines: string[] = [];
    lines.push(`Purpose: ${structure.purpose}`);
    lines.push("");
    lines.push("Answer the following to generate this slide's content:");
    structure.fields.forEach((f, i) => {
      lines.push(`${i + 1}. ${f.label}: ${f.hint}`);
      followUpQuestions.push({ key: f.key, question: `${f.label} — ${f.hint}` });
    });
    contentPrompt = lines.join("\n");
  }

  return { visual_prompt: visualPrompt, content_prompt: contentPrompt, follow_up_questions: followUpQuestions };
}

export async function generateSingleSlideBrief(input: {
  slide_id: string;
  slide_title: string;
  visual_prompt: string;
  content_prompt: string;
  answers: Record<string, string>;
  company_name: string;
  website?: string | null;
  transcript?: string | null;
  notes?: string | null;
  revenue?: number | null;
  ebitda_margin?: number | null;
  scope_perimeter?: string | null;
  objective?: string | null;
  urgency?: string | null;
  project_type: string;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return `[AI generation unavailable — ANTHROPIC_API_KEY not set]\n\nSlide: ${input.slide_title}\nPlease fill in the content manually based on the content prompt.`;
  }

  const client = new Anthropic({ apiKey });

  // Build context from proposal data
  const contextParts: string[] = [];
  contextParts.push(`Company: ${input.company_name}`);
  if (input.website) contextParts.push(`Website: ${input.website}`);
  if (input.project_type) contextParts.push(`Project type: ${input.project_type}`);
  if (input.revenue) contextParts.push(`Revenue: €${input.revenue}M`);
  if (input.ebitda_margin) contextParts.push(`EBITDA margin: ${input.ebitda_margin}%`);
  if (input.scope_perimeter) contextParts.push(`Scope: ${input.scope_perimeter}`);
  if (input.objective) contextParts.push(`Objective: ${input.objective}`);
  if (input.urgency) contextParts.push(`Urgency: ${input.urgency}`);
  if (input.transcript) contextParts.push(`Call transcript / notes:\n${input.transcript.substring(0, 3000)}`);
  if (input.notes) contextParts.push(`Additional notes:\n${input.notes.substring(0, 1000)}`);

  // Build the answers section
  const answerLines = Object.entries(input.answers)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const systemPrompt = `You are a senior management consultant at Eendigo, writing slide content for a client proposal.
Write concise, executive-level content suitable for a PowerPoint slide. Use bullet points where appropriate.
Be specific to the client context provided. Avoid generic filler text.
Format: Use markdown with headers (##) for sections and bullet points (-) for items.`;

  const userPrompt = `Generate content for the slide "${input.slide_title}".

PROPOSAL CONTEXT:
${contextParts.join("\n")}

VISUAL INSTRUCTIONS:
${input.visual_prompt}

CONTENT BRIEF:
${input.content_prompt}

${answerLines ? `USER ANSWERS:\n${answerLines}` : ""}

Write the slide content now. Be specific to ${input.company_name}. Keep it concise and slide-ready.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = response.content.find(b => b.type === "text");
    return textBlock?.text ?? "No content generated.";
  } catch (error: any) {
    console.error("Claude API error (single slide):", error.message);
    return `[Generation failed: ${error.message}]\n\nPlease write the content manually.`;
  }
}
