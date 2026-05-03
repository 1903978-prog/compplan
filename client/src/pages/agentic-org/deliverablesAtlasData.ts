// Deliverables Atlas — every deliverable across all 14 AIOS agents,
// classified by HOW it's produced. Used by the Deliverables Atlas page
// in the Atlas menu.
//
// Five production methods (per Livio's Nov-26 spec):
//   🔴 frontier      — Frontier AI (paid Anthropic tokens). Reserved for
//                      genuinely creative synthesis: CEO Brief, press
//                      releases, novel proposal sections, conflict
//                      analysis, board decks.
//   🟠 micro         — Micro-AI (free, local). Small models on the server
//                      for classification, embeddings, archetype matching,
//                      reply categorization.
//   🟢 deterministic — Pure code, SQL, or rule engines. Scoring, fee
//                      calculation, pipeline review, AR aging, dashboards.
//   🔵 template      — Fill-in-the-blanks. Emails, status reports,
//                      follow-ups, onboarding checklists, JD libraries.
//   ⚫ external      — External API only — Apollo / LinkedIn for contact
//                      discovery and movement tracking.
//
// The deliverable strings are sourced verbatim from server/agentSpecsData.ts
// so the Atlas page stays in lockstep with each agent's spec card.
// When AGENT_SPECS evolves, regenerate this file.

export type DeliverableMethod =
  | "frontier"
  | "micro"
  | "deterministic"
  | "template"
  | "external";

export interface MethodInfo {
  label: string;
  emoji: string;
  /** Tailwind colour tokens for chip backgrounds + bars. */
  bg: string;
  text: string;
  border: string;
  /** Pure dot colour (used in stats bar). */
  dot: string;
  /** One-line plain explanation for tooltips and hover cards. */
  desc: string;
}

export const METHOD_INFO: Record<DeliverableMethod, MethodInfo> = {
  frontier: {
    label: "Frontier AI",
    emoji: "🔴",
    bg: "bg-red-50 dark:bg-red-950/40",
    text: "text-red-700 dark:text-red-300",
    border: "border-red-200 dark:border-red-900",
    dot: "bg-red-500",
    desc: "Real Anthropic tokens — for genuinely creative synthesis (CEO brief, press releases, novel proposal sections, board decks).",
  },
  micro: {
    label: "Micro-AI",
    emoji: "🟠",
    bg: "bg-orange-50 dark:bg-orange-950/40",
    text: "text-orange-700 dark:text-orange-300",
    border: "border-orange-200 dark:border-orange-900",
    dot: "bg-orange-500",
    desc: "Free, local small models. Classification, embeddings, archetype matching, reply categorization.",
  },
  deterministic: {
    label: "Deterministic",
    emoji: "🟢",
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-900",
    dot: "bg-emerald-500",
    desc: "Pure code, SQL, rule engines. Scoring, fee calc, pipeline review, AR aging, dashboards.",
  },
  template: {
    label: "Template",
    emoji: "🔵",
    bg: "bg-sky-50 dark:bg-sky-950/40",
    text: "text-sky-700 dark:text-sky-300",
    border: "border-sky-200 dark:border-sky-900",
    dot: "bg-sky-500",
    desc: "Fill-in-the-blanks. Emails, status reports, follow-ups, onboarding checklists, JD libraries.",
  },
  external: {
    label: "External API",
    emoji: "⚫",
    bg: "bg-slate-100 dark:bg-slate-800/60",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-300 dark:border-slate-700",
    dot: "bg-slate-700",
    desc: "Apollo / LinkedIn / other 3rd-party APIs for contact discovery and movement tracking.",
  },
};

/** Display order of methods in the stats bar and filters. */
export const METHOD_ORDER: DeliverableMethod[] = [
  "frontier",
  "micro",
  "deterministic",
  "template",
  "external",
];

export interface DeliverableEntry {
  text: string;
  method: DeliverableMethod;
}

export interface AgentDeliverables {
  /** Display name; matches AGENT_SPECS[i].name for cross-reference. */
  agent: string;
  /** Short tag for filter chips. */
  short: string;
  items: DeliverableEntry[];
}

// ─────────────────────────────────────────────────────────────────────
// Classifications. Each agent's deliverables are listed in source order
// from agentSpecsData.ts. Method assignments follow Livio's heuristic:
//
//   • Synthesis / narrative / novel writing  → frontier
//   • Categorization / matching / extraction → micro
//   • Numeric / SQL / pipeline / AR / KPI    → deterministic
//   • Boilerplate emails / docs / checklists → template
//   • Apollo / LinkedIn movement & discovery → external
//
// When in doubt the cheaper bucket wins — only assign frontier when a
// frozen template + simple variable substitution genuinely cannot do it.
// ─────────────────────────────────────────────────────────────────────

export const ATLAS_DELIVERABLES: AgentDeliverables[] = [
  {
    agent: "CEO",
    short: "CEO",
    items: [
      { text: "Daily morning brief with top 3 decisions and traffic-light status (daily).",                        method: "frontier" },
      { text: "Weekly firm scorecard covering pipeline, utilization, cash, NPS (weekly).",                          method: "deterministic" },
      { text: "Monthly strategy update with OKR progress and 30-60-90 outlook (monthly).",                          method: "frontier" },
      { text: "Quarterly board-style narrative deck (quarterly).",                                                  method: "frontier" },
      { text: "Decisions log with full audit trail (continuous, on-demand export).",                                method: "deterministic" },
      { text: "Competitive intelligence digest on commercial excellence market (weekly).",                          method: "micro" },
      { text: "Founder-ready talking points for client and prospect calls (on-demand).",                            method: "template" },
      { text: "Strategic option papers for major bets, with quantified tradeoffs (on-demand).",                     method: "frontier" },
    ],
  },
  {
    agent: "COO",
    short: "COO",
    items: [
      { text: "Live RACI matrix with diff log (continuous, weekly snapshot).",                                       method: "deterministic" },
      { text: "Agent registry with capability cards and eval scorecards (continuous).",                              method: "deterministic" },
      { text: "Weekly operations review document (weekly).",                                                         method: "template" },
      { text: "Monthly operating health report with bottleneck analysis (monthly).",                                 method: "micro" },
      { text: "Updated playbook library with version history (on-demand, monthly review).",                          method: "template" },
      { text: "Skills factory backlog and roadmap (weekly).",                                                        method: "deterministic" },
      { text: "Incident and near-miss log with root-cause analyses (continuous).",                                   method: "micro" },
      { text: "Quarterly process audit covering all client-facing workflows (quarterly).",                           method: "frontier" },
    ],
  },
  {
    agent: "SVP Sales / BD",
    short: "SVP",
    items: [
      { text: "Weekly pipeline review (stage, weighted value, velocity).",                                           method: "deterministic" },
      { text: "Weekly outbound activity report (touches, replies, meetings booked).",                                method: "deterministic" },
      { text: "Monthly ICP refresh and account rotation.",                                                           method: "micro" },
      { text: "Monthly cohort analysis (source, vertical, deal size).",                                              method: "deterministic" },
      { text: "Quarterly win/loss synthesis.",                                                                        method: "frontier" },
      { text: "Quarterly forecast vs. actual reconciliation.",                                                       method: "deterministic" },
      { text: "On-demand discovery call briefs (24h SLA).",                                                          method: "template" },
      { text: "Proposal pipeline tracker (live).",                                                                   method: "deterministic" },
    ],
  },
  {
    agent: "CFO",
    short: "CFO",
    items: [
      { text: "Daily cash dashboard with 13-week forecast (daily).",                                                 method: "deterministic" },
      { text: "Weekly AR aging report with collections actions (weekly).",                                           method: "deterministic" },
      { text: "Weekly engagement margin tracker with red-flag list (weekly).",                                       method: "deterministic" },
      { text: "Monthly close package: P&L, BS snapshot, variance commentary (monthly).",                              method: "deterministic" },
      { text: "Monthly pricing discipline report: realization, leakage, exception log (monthly).",                    method: "deterministic" },
      { text: "Quarterly profitability deep-dive by client and service line (quarterly).",                            method: "deterministic" },
      { text: "On-demand pricing memo for every proposal above threshold.",                                          method: "template" },
      { text: "Annual budget and rolling reforecast (annual + quarterly refresh).",                                  method: "deterministic" },
    ],
  },
  {
    agent: "CHRO",
    short: "CHRO",
    items: [
      { text: "Weekly capacity & staffing dashboard (humans + agents, % utilization, bench).",                       method: "deterministic" },
      { text: "Monthly People Pulse report (eNPS, attrition risk, hiring funnel).",                                  method: "deterministic" },
      { text: "Quarterly Workforce Plan (12-month rolling, hires + agents to build).",                               method: "deterministic" },
      { text: "Agent Readiness Scorecard per agent (monthly): prompt version, eval pass rate, incidents.",            method: "deterministic" },
      { text: "Live JD/Role-Card library in the internal app.",                                                      method: "template" },
      { text: "Onboarding plan per new hire (30/60/90) and per new agent (inputs, evals, owner).",                   method: "template" },
      { text: "Annual compensation benchmarking memo for Livio.",                                                    method: "deterministic" },
      { text: "Exit-interview synthesis after each departure.",                                                      method: "frontier" },
    ],
  },
  {
    agent: "CMO",
    short: "CMO",
    items: [
      { text: "Weekly editorial calendar (Monday).",                                                                 method: "template" },
      { text: "5 LinkedIn posts/week, 1 long-form article/week (Tue+Thu cadence).",                                  method: "frontier" },
      { text: "Bi-weekly Substack issue (1,200–1,800 words).",                                                       method: "frontier" },
      { text: "Monthly thought-leadership 'anchor piece' (3,500+ words, gated).",                                    method: "frontier" },
      { text: "Monthly ABM insight pack per targeted PE fund (5–10 funds in rotation).",                             method: "micro" },
      { text: "Monthly reputation/SOV dashboard.",                                                                   method: "deterministic" },
      { text: "Quarterly content-to-pipeline attribution report.",                                                   method: "deterministic" },
      { text: "Quarterly competitive content teardown (Simon-Kucher, ZS, Bain).",                                    method: "micro" },
    ],
  },
  {
    agent: "CKO",
    short: "CKO",
    items: [
      { text: "Curated KM library with full taxonomy, refreshed continuously.",                                       method: "micro" },
      { text: "Proposal library with modular blocks and a 'best-fit' recommender.",                                  method: "micro" },
      { text: "Case-study repository (one-pagers + long-form), versioned.",                                          method: "micro" },
      { text: "Monthly Reuse & Knowledge Health Report.",                                                            method: "deterministic" },
      { text: "Quarterly IP Roadmap (what to codify next).",                                                         method: "frontier" },
      { text: "End-of-engagement debrief templates and completed debriefs.",                                         method: "template" },
      { text: "Glossary of Eendigo terms and client-sector lexicons.",                                               method: "template" },
      { text: "Annual 'State of Eendigo Knowledge' memo to Livio.",                                                  method: "frontier" },
    ],
  },
  {
    agent: "Delivery Officer",
    short: "Delivery",
    items: [
      { text: "Weekly Portfolio Health Report (Monday 8am, Livio).",                                                 method: "deterministic" },
      { text: "Per-engagement RAG dashboard (live, Notion/Airtable).",                                               method: "deterministic" },
      { text: "Bi-weekly Steerco pre-read pack per engagement.",                                                     method: "frontier" },
      { text: "Monthly NPS rollup with verbatim themes.",                                                            method: "micro" },
      { text: "Live RAID register per engagement.",                                                                  method: "deterministic" },
      { text: "Monthly margin & realization scorecard.",                                                             method: "deterministic" },
      { text: "Change-request memos (event-driven).",                                                                 method: "template" },
      { text: "Project closure pack + lessons-learned (per close).",                                                  method: "frontier" },
      { text: "Quarterly delivery-quality review for Livio.",                                                          method: "deterministic" },
      { text: "3-week rolling capacity plan.",                                                                        method: "deterministic" },
    ],
  },
  {
    agent: "Pricing Agent",
    short: "Pricing",
    items: [
      { text: "GTN waterfall model (Excel + dashboard) per client engagement.",                                       method: "deterministic" },
      { text: "Pocket-margin distribution / 'whale curve' by customer, monthly during engagement.",                   method: "deterministic" },
      { text: "Willingness-to-pay study report (van Westendorp + Gabor-Granger) per pricing project.",                method: "deterministic" },
      { text: "Conjoint / DCM analytical pack with simulator.",                                                      method: "deterministic" },
      { text: "Price-corridor and deal-scoring tool (deployed in client CRM / Excel).",                              method: "deterministic" },
      { text: "Discount & rebate policy redesign deck with EBITDA bridge.",                                          method: "frontier" },
      { text: "Tender / bid pricing memos (deal-by-deal, on demand).",                                               method: "template" },
      { text: "Win/loss pricing diagnostic (quarterly during engagement).",                                          method: "micro" },
      { text: "Pricing governance charter and exception workflow.",                                                  method: "template" },
      { text: "Client pricing playbook (versioned).",                                                                method: "template" },
    ],
  },
  {
    agent: "Proposal Agent",
    short: "Proposal",
    items: [
      { text: "Proposal v1 within 48h of scoping call (target 24h).",                                                method: "frontier" },
      { text: "Executive summary (1 page, standalone).",                                                             method: "frontier" },
      { text: "Detailed approach deck (15–25 slides, eendigo-template).",                                            method: "frontier" },
      { text: "Tailored case study appendix (3–5 studies per proposal).",                                            method: "micro" },
      { text: "Commercial annex (skeleton, Livio fills numbers).",                                                   method: "template" },
      { text: "Risk and assumptions register.",                                                                       method: "template" },
      { text: "Statement of Work (SOW) draft using standard template.",                                              method: "template" },
      { text: "Post-decision win/loss capture template populated.",                                                  method: "template" },
    ],
  },
  {
    agent: "BD Agent",
    short: "BD",
    items: [
      { text: "Daily 50–100 personalized outbound drafts (review-ready for SVP).",                                    method: "frontier" },
      { text: "Weekly account research dossiers (10–15 accounts deep-dived).",                                       method: "micro" },
      { text: "Live reply-triage queue (zero-inbox SLA: 4h).",                                                       method: "micro" },
      { text: "Pre-meeting briefs (24h ahead).",                                                                     method: "template" },
      { text: "Post-meeting CRM updates (within 1h of call).",                                                       method: "deterministic" },
      { text: "Weekly cadence performance report (open, reply, meeting rates by sequence).",                         method: "deterministic" },
      { text: "Monthly objection-library refresh.",                                                                  method: "micro" },
      { text: "Monthly persona-pain-statement library refresh.",                                                     method: "micro" },
    ],
  },
  {
    agent: "AR Agent",
    short: "AR",
    items: [
      { text: "Draft invoice queue (continuous; weekly batch on Friday).",                                            method: "template" },
      { text: "Weekly AR aging report (Monday).",                                                                    method: "deterministic" },
      { text: "13-week cash forecast (weekly).",                                                                     method: "deterministic" },
      { text: "Monthly DSO / CEI / bad-debt scorecard.",                                                             method: "deterministic" },
      { text: "Dispute log with status and root cause.",                                                             method: "deterministic" },
      { text: "Dunning queue with drafted emails awaiting approval.",                                                method: "template" },
      { text: "Cash-application reconciliation (daily, on bank-feed pull).",                                          method: "deterministic" },
      { text: "Month-end AR close pack (sub-ledger to GL tie-out).",                                                  method: "deterministic" },
      { text: "Quarterly customer credit-risk review.",                                                               method: "deterministic" },
      { text: "Annual bad-debt provision recommendation.",                                                            method: "deterministic" },
    ],
  },
  {
    agent: "Partnership Agent",
    short: "Partner",
    items: [
      { text: "Live partner map (3 tiers, 100+ entities).",                                                          method: "external" },
      { text: "Quarterly partner landscape report.",                                                                 method: "micro" },
      { text: "Monthly partner-sourced pipeline report.",                                                            method: "deterministic" },
      { text: "Per-partner enablement one-pager (refreshed annually).",                                               method: "template" },
      { text: "Co-marketing calendar (rolling 6 months).",                                                            method: "template" },
      { text: "Partner-touchpoint log (CRM-integrated).",                                                            method: "deterministic" },
      { text: "Annual top-10 partner business review.",                                                              method: "frontier" },
      { text: "PE Operating Partner movement bulletin (monthly).",                                                   method: "external" },
    ],
  },
  {
    agent: "L&D Manager",
    short: "L&D",
    items: [
      { text: "Per-role learning path with required + recommended modules.",                                          method: "template" },
      { text: "Weekly personalized learning digest per consultant.",                                                 method: "template" },
      { text: "Quarterly Skills Assessment Report (humans).",                                                        method: "deterministic" },
      { text: "Eval suite per agent, versioned and runnable on demand.",                                              method: "deterministic" },
      { text: "Prompt changelog with eval deltas per release.",                                                      method: "deterministic" },
      { text: "Monthly Agent Training Review.",                                                                       method: "deterministic" },
      { text: "Onboarding curriculum for new hires (covers craft + AI tools).",                                      method: "template" },
      { text: "Library of reference docs per agent (with metadata).",                                                method: "template" },
      { text: "Annual L&D plan and budget proposal.",                                                                 method: "frontier" },
      { text: "Post-incident training note (per significant incident).",                                              method: "template" },
    ],
  },
];

// ─ Rollups ────────────────────────────────────────────────────────────

export const ATLAS_TOTAL = ATLAS_DELIVERABLES.reduce(
  (n, a) => n + a.items.length,
  0,
);

export function countByMethod(): Record<DeliverableMethod, number> {
  const out: Record<DeliverableMethod, number> = {
    frontier: 0,
    micro: 0,
    deterministic: 0,
    template: 0,
    external: 0,
  };
  for (const a of ATLAS_DELIVERABLES) {
    for (const d of a.items) out[d.method]++;
  }
  return out;
}

export function countAgentByMethod(agent: AgentDeliverables): Record<DeliverableMethod, number> {
  const out: Record<DeliverableMethod, number> = {
    frontier: 0,
    micro: 0,
    deterministic: 0,
    template: 0,
    external: 0,
  };
  for (const d of agent.items) out[d.method]++;
  return out;
}
