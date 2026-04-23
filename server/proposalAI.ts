import { generateJSON, resolveActiveModel, MissingApiKeyError, ProviderError, type ProviderId } from "./aiProviders";

interface ProposalInput {
  company_name: string;
  website?: string | null;
  transcript?: string | null;
  notes?: string | null;
  revenue?: number | null;
  ebitda_margin?: number | null;
  scope_perimeter?: string | null;
  objective?: string | null;
  urgency?: string | null;
  /** Optional model override forwarded from the client. When absent, falls
   *  back to env ACTIVE_AI_PROVIDER/ACTIVE_AI_MODEL, then hardcoded Claude. */
  _aiProvider?: ProviderId | null;
  _aiModel?: string | null;
}

interface TeamMember {
  role: string;
  count: number;
  days_per_week: number;
}

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

interface ProposalAnalysis {
  company_summary: string;
  proposal_title: string;
  why_now: string;
  objective_statement: string;
  scope_statement: string;
  recommended_team: string;
  staffing_intensity: string;
  options: ProposalOption[];
}


const ANALYSIS_TOOL = {
  name: "submit_proposal_analysis" as const,
  description: "Submit the structured proposal analysis",
  input_schema: {
    type: "object" as const,
    properties: {
      company_summary: { type: "string", description: "2-3 sentence summary of the company, its market position, and key characteristics" },
      proposal_title: { type: "string", description: "Professional proposal title, e.g. 'Commercial Excellence Transformation'" },
      why_now: { type: "string", description: "2-3 sentences explaining why this engagement is timely and critical" },
      objective_statement: { type: "string", description: "Clear statement of the engagement objective" },
      scope_statement: { type: "string", description: "Description of the scope and perimeter of the engagement" },
      recommended_team: { type: "string", description: "Description of recommended team composition and rationale" },
      staffing_intensity: { type: "string", description: "One of: light, moderate, intensive" },
      options: {
        type: "array",
        description: "Exactly 3 engagement options (Essential, Standard, Premium)",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Option name: Essential, Standard, or Premium" },
            duration_weeks: { type: "number", description: "Duration in weeks" },
            staffing_mode: { type: "string", description: "e.g. '3 days/week', '4 days/week', '5 days/week'" },
            team: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  role: { type: "string", description: "One of: Partner, EM, ASC" },
                  count: { type: "number" },
                  days_per_week: { type: "number" },
                },
                required: ["role", "count", "days_per_week"],
              },
            },
            scope: { type: "array", items: { type: "string" }, description: "List of scope items included" },
            deliverables: { type: "array", items: { type: "string" }, description: "List of deliverables" },
            cadence: { type: "string", description: "Meeting/reporting cadence" },
            assumptions: { type: "array", items: { type: "string" }, description: "Key assumptions" },
          },
          required: ["name", "duration_weeks", "staffing_mode", "team", "scope", "deliverables", "cadence", "assumptions"],
        },
      },
    },
    required: ["company_summary", "proposal_title", "why_now", "objective_statement", "scope_statement", "recommended_team", "staffing_intensity", "options"],
  },
};

function getMockAnalysis(input: ProposalInput): ProposalAnalysis {
  const options: ProposalOption[] = [
    {
      name: "Essential",
      duration_weeks: 6,
      staffing_mode: "3 days/week",
      team: [
        { role: "Partner", count: 1, days_per_week: 0.5 },
        { role: "EM", count: 1, days_per_week: 3 },
        { role: "ASC", count: 1, days_per_week: 3 },
      ],
      scope: ["AI analysis unavailable - set ANTHROPIC_API_KEY"],
      deliverables: ["AI analysis unavailable - set ANTHROPIC_API_KEY"],
      cadence: "Weekly steering committee",
      assumptions: ["AI analysis unavailable - set ANTHROPIC_API_KEY"],
    },
    {
      name: "Standard",
      duration_weeks: 8,
      staffing_mode: "4 days/week",
      team: [
        { role: "Partner", count: 1, days_per_week: 1 },
        { role: "EM", count: 1, days_per_week: 4 },
        { role: "ASC", count: 2, days_per_week: 4 },
      ],
      scope: ["AI analysis unavailable - set ANTHROPIC_API_KEY"],
      deliverables: ["AI analysis unavailable - set ANTHROPIC_API_KEY"],
      cadence: "Weekly steering committee + bi-weekly board update",
      assumptions: ["AI analysis unavailable - set ANTHROPIC_API_KEY"],
    },
    {
      name: "Premium",
      duration_weeks: 12,
      staffing_mode: "5 days/week",
      team: [
        { role: "Partner", count: 1, days_per_week: 1.5 },
        { role: "EM", count: 1, days_per_week: 5 },
        { role: "ASC", count: 3, days_per_week: 5 },
      ],
      scope: ["AI analysis unavailable - set ANTHROPIC_API_KEY"],
      deliverables: ["AI analysis unavailable - set ANTHROPIC_API_KEY"],
      cadence: "Weekly steering committee + weekly board update",
      assumptions: ["AI analysis unavailable - set ANTHROPIC_API_KEY"],
    },
  ];

  return {
    company_summary: `AI analysis unavailable - set ANTHROPIC_API_KEY. Company: ${input.company_name}.`,
    proposal_title: `Engagement Proposal for ${input.company_name}`,
    why_now: "AI analysis unavailable - set ANTHROPIC_API_KEY to generate tailored analysis.",
    objective_statement: input.objective || "AI analysis unavailable - set ANTHROPIC_API_KEY.",
    scope_statement: input.scope_perimeter || "AI analysis unavailable - set ANTHROPIC_API_KEY.",
    recommended_team: "AI analysis unavailable - set ANTHROPIC_API_KEY.",
    staffing_intensity: "moderate",
    options,
  };
}

export async function analyzeProposal(input: ProposalInput): Promise<ProposalAnalysis> {
  // Resolve the provider + model the caller asked for. Order of priority:
  //   1. explicit _aiProvider / _aiModel in the input (from the HTTP body,
  //      which the client forwards from its localStorage selection)
  //   2. env ACTIVE_AI_PROVIDER / ACTIVE_AI_MODEL (stable Render default)
  //   3. hardcoded Anthropic Sonnet 4.5
  const active = resolveActiveModel({ provider: input._aiProvider, model: input._aiModel });

  const contextParts: string[] = [];
  contextParts.push(`Company: ${input.company_name}`);
  if (input.website) contextParts.push(`Website: ${input.website}`);
  if (input.revenue) contextParts.push(`Revenue: EUR ${input.revenue}M`);
  if (input.ebitda_margin) contextParts.push(`EBITDA margin: ${input.ebitda_margin}%`);
  if (input.objective) contextParts.push(`Client objective: ${input.objective}`);
  if (input.scope_perimeter) contextParts.push(`Scope/perimeter: ${input.scope_perimeter}`);
  if (input.urgency) contextParts.push(`Urgency: ${input.urgency}`);
  if (input.transcript) contextParts.push(`Call transcript:\n${input.transcript}`);
  if (input.notes) contextParts.push(`Additional notes:\n${input.notes}`);

  const systemPrompt = `You are Eendigo's proposal strategist. Eendigo is a management consulting firm specializing in commercial excellence, pricing strategy, sales force effectiveness, and go-to-market optimization for mid-market and large enterprises.

Your task is to analyze the provided client information and generate a structured consulting proposal with 3 options (Essential, Standard, Premium) of increasing scope and investment. Pricing is handled separately — do not calculate fees.

Guidelines:
- Essential: Focused diagnostic or quick-win, 4-8 weeks, lean team, 3 days/week
- Standard: Full engagement, 8-12 weeks, balanced team, 4 days/week
- Premium: Comprehensive transformation, 10-16 weeks, full team, 5 days/week
- Each option must have a realistic team with Partner (oversight), EM (lead), and ASC roles
- days_per_week for Partner should be 0.5-2 depending on option
- Scope, deliverables, and assumptions should be specific to the client's industry and situation
- The staffing_intensity should reflect the urgency and complexity`;

  const userMessage = contextParts.join("\n\n");

  try {
    const out = await generateJSON<ProposalAnalysis>({
      provider: active.provider,
      model: active.model,
      system: systemPrompt,
      prompt: userMessage,
      toolName: ANALYSIS_TOOL.name,
      toolDescription: ANALYSIS_TOOL.description,
      schema: ANALYSIS_TOOL.input_schema,
      maxTokens: 4096,
    });
    // Minimal shape validation — if the model skipped required fields,
    // fall back to mock so the caller doesn't crash on undefined.
    if (!out.data || !Array.isArray((out.data as any).options)) {
      console.error(`[proposalAI] ${active.provider} returned malformed payload, falling back to mock`);
      return getMockAnalysis(input);
    }
    return out.data;
  } catch (error) {
    if (error instanceof MissingApiKeyError) {
      console.warn(`[proposalAI] ${error.envVar} not set — returning mock proposal analysis (provider: ${active.provider})`);
      return getMockAnalysis(input);
    }
    if (error instanceof ProviderError) {
      console.error(`[proposalAI] ${active.provider} ${error.status}: ${error.message.slice(0, 300)}`);
      return getMockAnalysis(input);
    }
    console.error("[proposalAI] unexpected error:", error);
    return getMockAnalysis(input);
  }
}
