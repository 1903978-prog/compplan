import Anthropic from "@anthropic-ai/sdk";

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
  price_breakdown: { role: string; count: number; daily_rate: number; days: number; total: number }[];
  total_fee: number;
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

const DAILY_RATES: Record<string, number> = {
  Partner: 7000,
  EM: 2800,
  ASC: 1200,
};

function calculateOptionPricing(option: ProposalOption): ProposalOption {
  const priceBreakdown = option.team.map((member) => {
    const rate = DAILY_RATES[member.role] || 1200;
    const days = member.days_per_week * option.duration_weeks;
    const total = rate * days * member.count;
    return {
      role: member.role,
      count: member.count,
      daily_rate: rate,
      days,
      total,
    };
  });
  const totalFee = priceBreakdown.reduce((sum, item) => sum + item.total, 0);
  return { ...option, price_breakdown: priceBreakdown, total_fee: totalFee };
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
      price_breakdown: [],
      total_fee: 0,
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
      price_breakdown: [],
      total_fee: 0,
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
      price_breakdown: [],
      total_fee: 0,
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
    options: options.map(calculateOptionPricing),
  };
}

export async function analyzeProposal(input: ProposalInput): Promise<ProposalAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY not set — returning mock proposal analysis");
    return getMockAnalysis(input);
  }

  const client = new Anthropic({ apiKey });

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

Your task is to analyze the provided client information and generate a structured consulting proposal with 3 options (Essential, Standard, Premium) of increasing scope and investment.

Daily rates:
- Partner: EUR 7,000/day
- EM (Engagement Manager): EUR 2,800/day
- ASC (Associate/Senior Consultant): EUR 1,200/day

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
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: "tool", name: "submit_proposal_analysis" },
      messages: [{ role: "user", content: userMessage }],
    });

    // Extract tool use result
    const toolUse = response.content.find((block: any) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      console.error("No tool_use block in Claude response");
      return getMockAnalysis(input);
    }

    const analysis = toolUse.input as ProposalAnalysis;

    // Recalculate pricing for each option
    analysis.options = analysis.options.map(calculateOptionPricing);

    return analysis;
  } catch (error) {
    console.error("Claude API error:", error);
    return getMockAnalysis(input);
  }
}
