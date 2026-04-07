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

interface SlideMethodologyConfig {
  slide_id: string;
  purpose?: string;
  structure?: { sections: string[] };
  rules?: string;
  columns?: { column_1?: string; column_2?: string; column_3?: string };
  format?: string;
  insight_bar?: number;
}

interface SlideBriefField {
  key: string;
  label: string;
  value: string;
}

interface SlideBrief {
  slide_id: string;
  title: string;
  purpose: string;
  content_structure: SlideBriefField[];
  notes: string;
}

interface DeckTemplateConfig {
  palette?: Record<string, string>;
  typography?: Record<string, string>;
  footer_left?: string;
  footer_right?: string;
  system_prompt?: string;
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
  slide_briefs?: SlideBrief[];
  admin_configs?: Record<string, SlideMethodologyConfig>;
  deck_template?: DeckTemplateConfig;
}

// Default Eendigo branding colors (overridden by deck template palette)
const DEFAULT_COLORS = {
  PRIMARY: "1A6571",    // C_TITLE / C_HEADER
  ACCENT: "16C3CF",     // C_BORDER / C_SUBHEAD
  DARK: "1a1a2e",
  WHITE: "FFFFFF",       // C_WHITE
  LIGHT_BG: "F0F9FA",   // C_BGROW
  LIGHT_GRAY: "e2e8f0",
  TEXT: "535353",         // C_BODY / C_TRACKER
  MUTED: "535353",       // C_TRACKER
};

function resolveColors(template?: DeckTemplateConfig) {
  const p = template?.palette || {};
  return {
    PRIMARY: p.C_TITLE || p.C_HEADER || DEFAULT_COLORS.PRIMARY,
    ACCENT: p.C_BORDER || p.C_SUBHEAD || DEFAULT_COLORS.ACCENT,
    DARK: DEFAULT_COLORS.DARK,
    WHITE: p.C_WHITE || DEFAULT_COLORS.WHITE,
    LIGHT_BG: p.C_BGROW || DEFAULT_COLORS.LIGHT_BG,
    LIGHT_GRAY: DEFAULT_COLORS.LIGHT_GRAY,
    TEXT: p.C_BODY || DEFAULT_COLORS.TEXT,
    MUTED: p.C_TRACKER || DEFAULT_COLORS.MUTED,
  };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-EU", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

// ── Brief-based slide generators ────────────────────────────────────────────

// Note: addSlideHeader, addInsightBar, and format generators are defined
// inside generateProposalDeck to access the resolved COLORS closure.

// Slides that have dedicated hardcoded generators (skip from brief-based rendering)
const HARDCODED_SLIDE_IDS = new Set([
  "cover", "pricing_overview", "pricing_detail", "next_steps", "commercials",
]);

export async function generateProposalDeck(proposal: ProposalData, _template?: any): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  const COLORS = resolveColors(proposal.deck_template);
  const footerLeft = proposal.deck_template?.footer_left || "Notes and source";
  const footerRight = proposal.deck_template?.footer_right || "Eendigo";

  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Eendigo";
  pptx.subject = proposal.proposal_title || `Proposal for ${proposal.company_name}`;

  // Helper: add footer to every content slide (Eendigo template style)
  function addFooter(slide: any, pageNum?: number) {
    slide.addShape("line", { x: 0.3, y: 7.0, w: 12.7, h: 0, line: { color: COLORS.LIGHT_GRAY, width: 0.5 } });
    slide.addText(footerLeft, { x: 0.3, y: 7.05, w: 5, h: 0.35, fontSize: 7, color: COLORS.MUTED, fontFace: "Arial" });
    slide.addText(footerRight, { x: 9.5, y: 7.05, w: 3.5, h: 0.35, fontSize: 7, color: COLORS.PRIMARY, fontFace: "Arial", align: "right" });
  }

  function addSlideHeader(slide: any, title: string) {
    // Eendigo template: thin accent border line at top, then title
    slide.addShape("rect", { x: 0, y: 0, w: "100%", h: 0.04, fill: { color: COLORS.ACCENT } });
    slide.addText(title, { x: 0.5, y: 0.25, w: 12, h: 0.7, fontSize: 20, color: COLORS.PRIMARY, fontFace: "Arial", bold: true });
  }

  function addInsightBar(slide: any, text: string) {
    slide.addShape("rect", { x: 0.3, y: 6.4, w: 12.7, h: 0.5, fill: { color: COLORS.ACCENT } });
    slide.addText(text, { x: 0.5, y: 6.42, w: 12.3, h: 0.45, fontSize: 8.5, color: COLORS.WHITE, fontFace: "Arial" });
  }

  function generateFormatA(brief: SlideBrief, config: SlideMethodologyConfig | undefined) {
    const slide = pptx.addSlide();
    addSlideHeader(slide, brief.title);

    let y = 1.2;
    const maxY = config?.insight_bar ? 6.2 : 6.8;

    for (const field of brief.content_structure) {
      if (!field.value || y > maxY) continue;
      slide.addText(field.label, { x: 0.5, y, w: 12, h: 0.3, fontSize: 11, color: COLORS.PRIMARY, fontFace: "Arial", bold: true });
      y += 0.35;
      const lines = field.value.split("\n").filter(Boolean);
      const text = lines.map((l: string) => l.startsWith("-") || l.startsWith("\u2022") ? `  \u2022  ${l.replace(/^[-\u2022]\s*/, "")}` : l).join("\n");
      const blockH = Math.min(Math.max(lines.length * 0.2, 0.4), maxY - y);
      slide.addText(text, { x: 0.5, y, w: 12, h: blockH, fontSize: 8.5, color: COLORS.TEXT, fontFace: "Arial", valign: "top", paraSpaceAfter: 3 });
      y += blockH + 0.2;
    }

    if (config?.insight_bar && brief.notes) addInsightBar(slide, brief.notes);
    addFooter(slide);
  }

  function generateFormatB(brief: SlideBrief, config: SlideMethodologyConfig | undefined) {
    const slide = pptx.addSlide();
    addSlideHeader(slide, brief.title);

    const cols = config?.columns || {};
    const colW = 3.9;
    const fields = brief.content_structure.filter((f: SlideBriefField) => f.value);
    const col1: SlideBriefField[] = [], col2: SlideBriefField[] = [], col3: SlideBriefField[] = [];
    fields.forEach((f: SlideBriefField, i: number) => { [col1, col2, col3][i % 3].push(f); });

    const maxY = config?.insight_bar ? 6.2 : 6.8;

    function renderCol(x: number, items: SlideBriefField[], label?: string) {
      let y = 1.2;
      if (label) {
        slide.addText(label, { x, y, w: colW, h: 0.25, fontSize: 8.5, color: COLORS.ACCENT, fontFace: "Arial", bold: true });
        y += 0.3;
      }
      for (const f of items) {
        if (y > maxY) break;
        slide.addText(f.label, { x, y, w: colW, h: 0.25, fontSize: 11, color: COLORS.PRIMARY, fontFace: "Arial", bold: true });
        y += 0.3;
        const lines = f.value.split("\n").filter(Boolean);
        const text = lines.map((l: string) => l.startsWith("-") || l.startsWith("\u2022") ? `\u2022 ${l.replace(/^[-\u2022]\s*/, "")}` : l).join("\n");
        const h = Math.min(Math.max(lines.length * 0.18, 0.35), maxY - y);
        slide.addText(text, { x, y, w: colW, h, fontSize: 8.5, color: COLORS.TEXT, fontFace: "Arial", valign: "top", paraSpaceAfter: 2 });
        y += h + 0.15;
      }
    }

    renderCol(0.3, col1, cols.column_1);
    renderCol(4.5, col2, cols.column_2);
    renderCol(8.7, col3, cols.column_3);

    // Vertical accent dividers
    slide.addShape("line", { x: 4.3, y: 1.2, w: 0, h: maxY - 1.2, line: { color: COLORS.ACCENT, width: 0.5 } });
    slide.addShape("line", { x: 8.5, y: 1.2, w: 0, h: maxY - 1.2, line: { color: COLORS.ACCENT, width: 0.5 } });

    if (config?.insight_bar && brief.notes) addInsightBar(slide, brief.notes);
    addFooter(slide);
  }

  function generateSlideFromBrief(brief: SlideBrief, adminConfigs: Record<string, SlideMethodologyConfig>) {
    const config = adminConfigs[brief.slide_id];
    if ((config?.format || "A") === "B") generateFormatB(brief, config);
    else generateFormatA(brief, config);
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

  // ─── Brief-based slides (when briefs exist) ─────────────────────────────────
  const briefs = proposal.slide_briefs || [];
  const adminConfigs = proposal.admin_configs || {};
  const hasBriefs = briefs.length > 0;

  if (hasBriefs) {
    // Generate slides from briefs, skipping hardcoded ones (cover already done, pricing/next_steps done later)
    for (const brief of briefs) {
      if (HARDCODED_SLIDE_IDS.has(brief.slide_id)) continue;
      if (!brief.content_structure || brief.content_structure.length === 0) continue;
      generateSlideFromBrief(brief, adminConfigs);
    }
  } else {
    // ─── Fallback: Legacy hardcoded slides when no briefs exist ──────────────

    // Slide 2: Executive Summary
    const execSlide = pptx.addSlide();
    addSlideHeader(execSlide, "Executive Summary");

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

    // Slide 3: Why Now
    if (proposal.why_now) {
      const whySlide = pptx.addSlide();
      addSlideHeader(whySlide, "Why Now?");
      whySlide.addText(proposal.why_now, { x: 0.8, y: 1.5, w: 11, h: 4.0, fontSize: 14, color: COLORS.TEXT, fontFace: "Arial", paraSpaceAfter: 8 });
      addFooter(whySlide);
    }

    // Slide 4: Scope & Objectives
    if (proposal.scope_statement) {
      const scopeSlide = pptx.addSlide();
      addSlideHeader(scopeSlide, "Scope & Objectives");
      scopeSlide.addText(proposal.scope_statement, { x: 0.8, y: 1.5, w: 11, h: 4.0, fontSize: 14, color: COLORS.TEXT, fontFace: "Arial", paraSpaceAfter: 8 });
      addFooter(scopeSlide);
    }
  }

  // ─── Option Slides (always rendered) ───────────────────────────────────────
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
