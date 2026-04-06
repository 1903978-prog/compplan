interface TeamMember {
  role: string;
  count: number;
  days_per_week: number;
}

interface PriceBreakdown {
  role: string;
  count: number;
  daily_rate: number;
  days: number;
  total: number;
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
  price_breakdown: PriceBreakdown[];
  total_fee: number;
}

interface ProposalData {
  company_name: string;
  proposal_title?: string | null;
  company_summary?: string | null;
  why_now?: string | null;
  objective_statement?: string | null;
  scope_statement?: string | null;
  recommended_team?: string | null;
  options: ProposalOption[];
}

// Eendigo branding colors
const COLORS = {
  PRIMARY: "1e3a5f",
  ACCENT: "3b82f6",
  DARK: "1a1a2e",
  WHITE: "FFFFFF",
  LIGHT_BG: "f0f4f8",
  LIGHT_GRAY: "e2e8f0",
  TEXT: "334155",
  MUTED: "64748b",
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-EU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

export async function generateProposalDeck(proposal: ProposalData, _template?: any): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();

  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Eendigo";
  pptx.subject = proposal.proposal_title || `Proposal for ${proposal.company_name}`;

  // Helper: add footer to every content slide
  function addFooter(slide: any) {
    slide.addShape("rect", { x: 0, y: 7.0, w: "100%", h: 0.5, fill: { color: COLORS.PRIMARY } });
    slide.addText("Confidential | Eendigo", { x: 0.5, y: 7.05, w: 5, h: 0.4, fontSize: 8, color: COLORS.WHITE, fontFace: "Arial" });
  }

  // ─── Slide 1: Cover ────────────────────────────────────────────────────────
  const coverSlide = pptx.addSlide();
  coverSlide.addShape("rect", { x: 0, y: 0, w: "100%", h: "100%", fill: { color: COLORS.PRIMARY } });
  coverSlide.addShape("rect", { x: 0, y: 5.5, w: "100%", h: 2, fill: { color: COLORS.DARK } });
  coverSlide.addText("EENDIGO", { x: 0.8, y: 0.5, w: 5, h: 0.6, fontSize: 14, color: COLORS.ACCENT, fontFace: "Arial", bold: true, letterSpacing: 4 });
  coverSlide.addText(proposal.proposal_title || `Engagement Proposal`, {
    x: 0.8, y: 2.0, w: 11, h: 1.2, fontSize: 36, color: COLORS.WHITE, fontFace: "Arial", bold: true,
  });
  coverSlide.addText(proposal.company_name, {
    x: 0.8, y: 3.4, w: 11, h: 0.8, fontSize: 24, color: COLORS.ACCENT, fontFace: "Arial",
  });
  coverSlide.addText(new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" }), {
    x: 0.8, y: 5.8, w: 5, h: 0.5, fontSize: 14, color: COLORS.LIGHT_GRAY, fontFace: "Arial",
  });
  coverSlide.addText("STRICTLY CONFIDENTIAL", {
    x: 0.8, y: 6.4, w: 5, h: 0.4, fontSize: 10, color: COLORS.MUTED, fontFace: "Arial", letterSpacing: 2,
  });

  // ─── Slide 2: Executive Summary ────────────────────────────────────────────
  const execSlide = pptx.addSlide();
  execSlide.addShape("rect", { x: 0, y: 0, w: "100%", h: 1.0, fill: { color: COLORS.PRIMARY } });
  execSlide.addText("Executive Summary", { x: 0.8, y: 0.15, w: 10, h: 0.7, fontSize: 28, color: COLORS.WHITE, fontFace: "Arial", bold: true });

  if (proposal.company_summary) {
    execSlide.addText("Company Overview", { x: 0.8, y: 1.3, w: 11, h: 0.4, fontSize: 16, color: COLORS.PRIMARY, fontFace: "Arial", bold: true });
    execSlide.addText(proposal.company_summary, { x: 0.8, y: 1.8, w: 11, h: 1.0, fontSize: 12, color: COLORS.TEXT, fontFace: "Arial", paraSpaceAfter: 6 });
  }

  if (proposal.objective_statement) {
    execSlide.addText("Objective", { x: 0.8, y: 3.0, w: 11, h: 0.4, fontSize: 16, color: COLORS.PRIMARY, fontFace: "Arial", bold: true });
    execSlide.addText(proposal.objective_statement, { x: 0.8, y: 3.5, w: 11, h: 1.0, fontSize: 12, color: COLORS.TEXT, fontFace: "Arial", paraSpaceAfter: 6 });
  }

  if (proposal.recommended_team) {
    execSlide.addText("Recommended Team", { x: 0.8, y: 4.7, w: 11, h: 0.4, fontSize: 16, color: COLORS.PRIMARY, fontFace: "Arial", bold: true });
    execSlide.addText(proposal.recommended_team, { x: 0.8, y: 5.2, w: 11, h: 1.0, fontSize: 12, color: COLORS.TEXT, fontFace: "Arial", paraSpaceAfter: 6 });
  }
  addFooter(execSlide);

  // ─── Slide 3: Why Now ──────────────────────────────────────────────────────
  if (proposal.why_now) {
    const whySlide = pptx.addSlide();
    whySlide.addShape("rect", { x: 0, y: 0, w: "100%", h: 1.0, fill: { color: COLORS.PRIMARY } });
    whySlide.addText("Why Now?", { x: 0.8, y: 0.15, w: 10, h: 0.7, fontSize: 28, color: COLORS.WHITE, fontFace: "Arial", bold: true });
    whySlide.addText(proposal.why_now, { x: 0.8, y: 1.5, w: 11, h: 4.0, fontSize: 14, color: COLORS.TEXT, fontFace: "Arial", paraSpaceAfter: 8 });
    addFooter(whySlide);
  }

  // ─── Slide 4: Scope & Objectives ───────────────────────────────────────────
  if (proposal.scope_statement) {
    const scopeSlide = pptx.addSlide();
    scopeSlide.addShape("rect", { x: 0, y: 0, w: "100%", h: 1.0, fill: { color: COLORS.PRIMARY } });
    scopeSlide.addText("Scope & Objectives", { x: 0.8, y: 0.15, w: 10, h: 0.7, fontSize: 28, color: COLORS.WHITE, fontFace: "Arial", bold: true });
    scopeSlide.addText(proposal.scope_statement, { x: 0.8, y: 1.5, w: 11, h: 4.0, fontSize: 14, color: COLORS.TEXT, fontFace: "Arial", paraSpaceAfter: 8 });
    addFooter(scopeSlide);
  }

  // ─── Slides 5-7: Options ───────────────────────────────────────────────────
  for (const option of proposal.options) {
    const optSlide = pptx.addSlide();
    optSlide.addShape("rect", { x: 0, y: 0, w: "100%", h: 1.0, fill: { color: COLORS.PRIMARY } });
    optSlide.addText(`Option: ${option.name}`, { x: 0.8, y: 0.15, w: 10, h: 0.7, fontSize: 28, color: COLORS.WHITE, fontFace: "Arial", bold: true });

    // Duration and staffing mode badges
    optSlide.addShape("roundRect", { x: 0.8, y: 1.2, w: 2.5, h: 0.4, fill: { color: COLORS.ACCENT }, rectRadius: 0.1 });
    optSlide.addText(`${option.duration_weeks} weeks`, { x: 0.8, y: 1.2, w: 2.5, h: 0.4, fontSize: 11, color: COLORS.WHITE, fontFace: "Arial", align: "center", bold: true });
    optSlide.addShape("roundRect", { x: 3.5, y: 1.2, w: 2.5, h: 0.4, fill: { color: COLORS.LIGHT_BG }, rectRadius: 0.1 });
    optSlide.addText(option.staffing_mode, { x: 3.5, y: 1.2, w: 2.5, h: 0.4, fontSize: 11, color: COLORS.PRIMARY, fontFace: "Arial", align: "center" });

    // Team table
    optSlide.addText("Team", { x: 0.8, y: 1.9, w: 5, h: 0.35, fontSize: 14, color: COLORS.PRIMARY, fontFace: "Arial", bold: true });
    const teamRows: any[][] = [
      [
        { text: "Role", options: { bold: true, fontSize: 10, color: COLORS.WHITE, fill: { color: COLORS.PRIMARY } } },
        { text: "Count", options: { bold: true, fontSize: 10, color: COLORS.WHITE, fill: { color: COLORS.PRIMARY } } },
        { text: "Days/Week", options: { bold: true, fontSize: 10, color: COLORS.WHITE, fill: { color: COLORS.PRIMARY } } },
      ],
    ];
    for (const member of option.team) {
      teamRows.push([
        { text: member.role, options: { fontSize: 10, color: COLORS.TEXT } },
        { text: String(member.count), options: { fontSize: 10, color: COLORS.TEXT, align: "center" } },
        { text: String(member.days_per_week), options: { fontSize: 10, color: COLORS.TEXT, align: "center" } },
      ]);
    }
    optSlide.addTable(teamRows, { x: 0.8, y: 2.3, w: 5.0, colW: [2.0, 1.5, 1.5], border: { color: COLORS.LIGHT_GRAY, pt: 0.5 }, fontFace: "Arial" });

    // Scope & Deliverables
    const scopeY = 2.3 + (teamRows.length * 0.35) + 0.3;
    optSlide.addText("Scope", { x: 0.8, y: scopeY, w: 5, h: 0.35, fontSize: 14, color: COLORS.PRIMARY, fontFace: "Arial", bold: true });
    const scopeText = option.scope.map((s) => `  \u2022  ${s}`).join("\n");
    optSlide.addText(scopeText, { x: 0.8, y: scopeY + 0.4, w: 5, h: 1.5, fontSize: 10, color: COLORS.TEXT, fontFace: "Arial", valign: "top" });

    // Deliverables on the right
    optSlide.addText("Deliverables", { x: 6.5, y: 1.9, w: 6, h: 0.35, fontSize: 14, color: COLORS.PRIMARY, fontFace: "Arial", bold: true });
    const delText = option.deliverables.map((d) => `  \u2022  ${d}`).join("\n");
    optSlide.addText(delText, { x: 6.5, y: 2.3, w: 6, h: 2.0, fontSize: 10, color: COLORS.TEXT, fontFace: "Arial", valign: "top" });

    // Pricing box
    optSlide.addShape("roundRect", { x: 6.5, y: 5.5, w: 5.5, h: 1.2, fill: { color: COLORS.LIGHT_BG }, rectRadius: 0.1, line: { color: COLORS.ACCENT, width: 1.5 } });
    optSlide.addText("Total Investment", { x: 6.7, y: 5.55, w: 3, h: 0.4, fontSize: 12, color: COLORS.MUTED, fontFace: "Arial" });
    optSlide.addText(formatCurrency(option.total_fee), { x: 6.7, y: 5.95, w: 5, h: 0.6, fontSize: 28, color: COLORS.PRIMARY, fontFace: "Arial", bold: true });

    // Cadence
    optSlide.addText(`Cadence: ${option.cadence}`, { x: 0.8, y: 6.3, w: 5, h: 0.4, fontSize: 10, color: COLORS.MUTED, fontFace: "Arial", italic: true });

    addFooter(optSlide);
  }

  // ─── Slide 8: Pricing Summary ──────────────────────────────────────────────
  const pricingSlide = pptx.addSlide();
  pricingSlide.addShape("rect", { x: 0, y: 0, w: "100%", h: 1.0, fill: { color: COLORS.PRIMARY } });
  pricingSlide.addText("Pricing Summary", { x: 0.8, y: 0.15, w: 10, h: 0.7, fontSize: 28, color: COLORS.WHITE, fontFace: "Arial", bold: true });

  // Summary table
  const summaryRows: any[][] = [
    [
      { text: "", options: { bold: true, fontSize: 11, fill: { color: COLORS.PRIMARY }, color: COLORS.WHITE } },
      { text: "Duration", options: { bold: true, fontSize: 11, fill: { color: COLORS.PRIMARY }, color: COLORS.WHITE, align: "center" } },
      { text: "Staffing", options: { bold: true, fontSize: 11, fill: { color: COLORS.PRIMARY }, color: COLORS.WHITE, align: "center" } },
      { text: "Team Size", options: { bold: true, fontSize: 11, fill: { color: COLORS.PRIMARY }, color: COLORS.WHITE, align: "center" } },
      { text: "Total Fee", options: { bold: true, fontSize: 11, fill: { color: COLORS.PRIMARY }, color: COLORS.WHITE, align: "center" } },
    ],
  ];
  for (const opt of proposal.options) {
    const teamSize = opt.team.reduce((sum, m) => sum + m.count, 0);
    summaryRows.push([
      { text: opt.name, options: { fontSize: 11, color: COLORS.PRIMARY, bold: true } },
      { text: `${opt.duration_weeks} weeks`, options: { fontSize: 11, color: COLORS.TEXT, align: "center" } },
      { text: opt.staffing_mode, options: { fontSize: 11, color: COLORS.TEXT, align: "center" } },
      { text: String(teamSize), options: { fontSize: 11, color: COLORS.TEXT, align: "center" } },
      { text: formatCurrency(opt.total_fee), options: { fontSize: 11, color: COLORS.PRIMARY, bold: true, align: "center" } },
    ]);
  }
  pricingSlide.addTable(summaryRows, { x: 0.8, y: 1.5, w: 11.5, colW: [2.5, 2.0, 2.5, 2.0, 2.5], border: { color: COLORS.LIGHT_GRAY, pt: 0.5 }, fontFace: "Arial" });

  // Rate card
  pricingSlide.addText("Daily Rate Card", { x: 0.8, y: 4.0, w: 5, h: 0.4, fontSize: 16, color: COLORS.PRIMARY, fontFace: "Arial", bold: true });
  const rateRows: any[][] = [
    [
      { text: "Role", options: { bold: true, fontSize: 10, fill: { color: COLORS.LIGHT_BG }, color: COLORS.PRIMARY } },
      { text: "Daily Rate", options: { bold: true, fontSize: 10, fill: { color: COLORS.LIGHT_BG }, color: COLORS.PRIMARY, align: "center" } },
    ],
    [{ text: "Partner", options: { fontSize: 10, color: COLORS.TEXT } }, { text: "EUR 7,000", options: { fontSize: 10, color: COLORS.TEXT, align: "center" } }],
    [{ text: "Engagement Manager", options: { fontSize: 10, color: COLORS.TEXT } }, { text: "EUR 2,800", options: { fontSize: 10, color: COLORS.TEXT, align: "center" } }],
    [{ text: "Associate / Senior Consultant", options: { fontSize: 10, color: COLORS.TEXT } }, { text: "EUR 1,200", options: { fontSize: 10, color: COLORS.TEXT, align: "center" } }],
  ];
  pricingSlide.addTable(rateRows, { x: 0.8, y: 4.5, w: 5, colW: [3.0, 2.0], border: { color: COLORS.LIGHT_GRAY, pt: 0.5 }, fontFace: "Arial" });
  addFooter(pricingSlide);

  // ─── Slide 9: Next Steps ───────────────────────────────────────────────────
  const nextSlide = pptx.addSlide();
  nextSlide.addShape("rect", { x: 0, y: 0, w: "100%", h: 1.0, fill: { color: COLORS.PRIMARY } });
  nextSlide.addText("Next Steps", { x: 0.8, y: 0.15, w: 10, h: 0.7, fontSize: 28, color: COLORS.WHITE, fontFace: "Arial", bold: true });

  const steps = [
    { num: "1", text: "Review this proposal and select preferred option" },
    { num: "2", text: "Alignment meeting to finalize scope and team composition" },
    { num: "3", text: "Contract signing and kick-off scheduling" },
    { num: "4", text: "Project kick-off and onboarding" },
  ];

  steps.forEach((step, i) => {
    const y = 1.5 + i * 1.2;
    nextSlide.addShape("ellipse", { x: 0.8, y: y, w: 0.6, h: 0.6, fill: { color: COLORS.ACCENT } });
    nextSlide.addText(step.num, { x: 0.8, y: y, w: 0.6, h: 0.6, fontSize: 18, color: COLORS.WHITE, fontFace: "Arial", bold: true, align: "center", valign: "middle" });
    nextSlide.addText(step.text, { x: 1.7, y: y, w: 10, h: 0.6, fontSize: 16, color: COLORS.TEXT, fontFace: "Arial", valign: "middle" });
  });

  nextSlide.addText("We look forward to partnering with you.", {
    x: 0.8, y: 6.2, w: 11, h: 0.5, fontSize: 14, color: COLORS.MUTED, fontFace: "Arial", italic: true,
  });
  addFooter(nextSlide);

  // Generate buffer
  const arrayBuffer = await pptx.write({ outputType: "arraybuffer" }) as ArrayBuffer;
  return Buffer.from(arrayBuffer);
}
