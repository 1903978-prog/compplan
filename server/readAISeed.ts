// ── Read.ai meeting cache ──────────────────────────────────────────────────
// Fallback payload used by the /api/read-ai/meetings endpoint when there's
// no READ_AI_TOKEN configured (which is the common case today — Read.ai's
// OAuth flow is browser-only, static tokens aren't shipped yet). The shape
// mirrors what /v1/meetings returns so the client code doesn't care where
// the data came from.
//
// Refresh procedure: when read.ai adds static API keys, wire the live call
// in server/readAI.ts and delete this file. Until then, ask Claude to
// refresh this file by pulling the latest 10 meetings via the Read.ai MCP.
// Last refreshed: 2026-04-21 (10 meetings).

export interface ReadAIParticipant {
  name: string | null;
  email: string | null;
  invited: boolean;
  attended: boolean;
}

export interface ReadAIMeeting {
  id: string;
  start_time_ms: number;
  end_time_ms: number;
  title: string;
  report_url: string;
  participants: ReadAIParticipant[];
  folders: string[];
  summary: string | null;
  transcript?: string | null;
}

export const READ_AI_SEED: ReadAIMeeting[] = [
  {
    id: "01KPTGPDH1HW9Z0Q08RW7EGP73",
    start_time_ms: 1776858904097,
    end_time_ms: 1776861934687,
    title: "Coesia ComEx 360 - weekly progress update",
    report_url: "https://app.read.ai/analytics/meetings/01KPTGPDH1HW9Z0Q08RW7EGP73",
    folders: ["Status Update"],
    participants: [
      { name: "De Simone, Luca", email: "luca.desimone@coesia.com", invited: true, attended: true },
      { name: "Defne Isler", email: "defne.isler@eendigo.com", invited: true, attended: true },
      { name: "Edoardo Tiani", email: "edoardo.tiani@eendigo.com", invited: true, attended: true },
      { name: "Livio Moretti", email: "livio.moretti@eendigo.com", invited: true, attended: true },
      { name: "Ponseggi, Laerte", email: "laerte.ponseggi@coesia.com", invited: true, attended: true },
      { name: "Renata Vancini", email: "renata.vancini@eendigo.com", invited: true, attended: true },
      { name: null, email: "guillermo.carrasco@eendigo.com", invited: true, attended: false },
      { name: null, email: "egon.vuica@coesia.com", invited: true, attended: false },
    ],
    summary: "The meeting reviewed progress across the project plan, covering outstanding items, ownership, timelines, and operational handoffs for sizing, slides, specialist setup, account planning, value selling, and central sales enablement. Modeling and segmentation work is about 60% complete; the team agreed to run a larger review with Lars and Renata. Three-days-per-week Volpack support will continue through the June wrap-up; a 60-day onboarding package is proposed to start 22 April.",
    transcript: "Luca: Good morning, everyone. Let's start with the project status. Where are we on the ComEx 360 initiative? Defne, can you run through the latest?\n\nDefne: Sure. We've made solid progress on the diagnostic phase. Modeling and segmentation are about 60% complete. We identified some gaps in the data around regional pricing, but Livio and I have a plan to fill those.\n\nLivio: Right. On the specialist setup side, we're waiting on two confirmations from the legal team. Should have those by end of week.\n\nPonseggi: And on the account planning front—we've got the framework in place. Value selling component still needs one more round of review.\n\nRenata: We should probably schedule a deeper review with Lars once the modeling piece gets closer to done. Maybe early next week?\n\nDefne: Agreed. We'll have more to show by then.\n\nLuca: Good. On the Volpack side, we'll keep the three-days-per-week support running through June. And Renata, let's move forward with the 60-day onboarding package starting April 22. That gives the team time to prepare.\n\nRenata: Perfect. I'll draft the onboarding timeline.\n\nLuca: Anything else? ... OK, let's reconvene next Friday. Good work, team.",
  },
  {
    id: "01KPTD561WMANA9ZZTZE4FMQPE",
    start_time_ms: 1776855193660,
    end_time_ms: 1776859174007,
    title: "SAN03 working session",
    report_url: "https://app.read.ai/analytics/meetings/01KPTD561WMANA9ZZTZE4FMQPE",
    folders: ["Planning Meeting"],
    participants: [
      { name: "Livio Moretti", email: "livio.moretti@eendigo.com", invited: true, attended: true },
      { name: "Malika Makhmutkhazhieva", email: "malika.makhmutkhazhieva@eendigo.com", invited: true, attended: true },
      { name: "Melissa Marten", email: "melissa.marten@eendigo.com", invited: true, attended: true },
      { name: "Thomas R. Hahn", email: "thomas.r.hahn@eendigo.com", invited: true, attended: true },
      { name: "Wissam Kahi", email: "wissam.kahi@eendigo.com", invited: true, attended: true },
    ],
    summary: "Internal working session on the SAN03 commercial incentive model — misaligned target-setting, allocation of investments across national/regional/local chains. Three-step approach agreed: reallocation, commercial terms, governance. Four deliverables identified; data gaps flagged. Financial modelling discussion covered margin analysis and a simulator for gross-to-net changes.",
  },
  {
    id: "01KPT689WYG7B1ZXRM8VQSQGJ1",
    start_time_ms: 1776847955870,
    end_time_ms: 1776848381342,
    title: "COE02 Transition",
    report_url: "https://app.read.ai/analytics/meetings/01KPT689WYG7B1ZXRM8VQSQGJ1",
    folders: [],
    participants: [
      { name: "Livio Moretti", email: "livio.moretti@eendigo.com", invited: false, attended: true },
      { name: "Renata Vancini", email: "renata.vancini@eendigo.com", invited: false, attended: true },
      { name: null, email: "defne.isler@eendigo.com", invited: false, attended: false },
      { name: null, email: "edoardo.tiani@eendigo.com", invited: false, attended: false },
    ],
    summary: null,
  },
  {
    id: "01KPQTR68T2A7GHQB2N5BPZ1CS",
    start_time_ms: 1776768784666,
    end_time_ms: 1776775049070,
    title: "Case study - Jacopo",
    report_url: "https://app.read.ai/analytics/meetings/01KPQTR68T2A7GHQB2N5BPZ1CS",
    folders: ["Educational"],
    participants: [
      { name: "Jacopo Giulio Lupo Ventura", email: "jgl.ventura@gmail.com", invited: false, attended: true },
      { name: "Livio Moretti", email: "livio.moretti@eendigo.com", invited: false, attended: true },
    ],
    summary: "Case-study interview with candidate Jacopo on a top-down market-sizing exercise for an orange business. Livio probed model transparency and structure, identified a timing error in the market-share assumption, walked through monthly seasonality and segmentation, and closed with a timed client email, slide review, brainteaser, and combinatorics check.",
  },
  {
    id: "01KPQKXP8RRKNDZTDYZ307BYGG",
    start_time_ms: 1776761624856,
    end_time_ms: 1776762093375,
    title: "COE02_ mid week touch point",
    report_url: "https://app.read.ai/analytics/meetings/01KPQKXP8RRKNDZTDYZ307BYGG",
    folders: [],
    participants: [],
    summary: null,
  },
  {
    id: "01KPNBR8CHXP6BTGP34CQBCNF6",
    start_time_ms: 1776685949329,
    end_time_ms: 1776686427634,
    title: "Eendigo Team Biweekly Meeting - Defne",
    report_url: "https://app.read.ai/analytics/meetings/01KPNBR8CHXP6BTGP34CQBCNF6",
    folders: [],
    participants: [
      { name: "Defne Isler", email: "defne.isler@eendigo.com", invited: true, attended: true },
      { name: "Leonardo Briccoli", email: "leonardo.briccoli@eendigo.com", invited: true, attended: true },
      { name: null, email: "alessandro.monti@eendigo.com", invited: true, attended: false },
      { name: null, email: "gabriele.papa@eendigo.com", invited: true, attended: false },
      { name: null, email: "malika.makhmutkhazhieva@eendigo.com", invited: true, attended: false },
      { name: null, email: "melissa.marten@eendigo.com", invited: true, attended: false },
      { name: null, email: "cosmin.bunescu@eendigo.com", invited: true, attended: false },
      { name: null, email: "edoardo.tiani@eendigo.com", invited: true, attended: false },
      { name: null, email: "livio.moretti@eendigo.com", invited: true, attended: false },
    ],
    summary: null,
  },
  {
    id: "01KPN3204H6CZ25KB4H508AGQW",
    start_time_ms: 1776676831377,
    end_time_ms: 1776678748148,
    title: "Partnership catch up",
    report_url: "https://app.read.ai/analytics/meetings/01KPN3204H6CZ25KB4H508AGQW",
    folders: ["One-on-One"],
    participants: [
      { name: "Livio Moretti", email: "livio.moretti@eendigo.com", invited: false, attended: true },
      { name: "Wissam Kahi", email: "wissam.kahi@eendigo.com", invited: false, attended: true },
    ],
    summary: "Internal partnership catch-up on operations, workload balance, AR/cash-flow pressure, proposal redesign using AI (custom proposals, revenue bridges, timelines, IP protection via links), outreach tactics (free diagnostic, PE roundtables, responsible-AI themes), and an equity/options alignment proposal.",
  },
  {
    id: "01KPB3Y4GVMH0QW7BP4SF2WJKM",
    start_time_ms: 1776342209051,
    end_time_ms: 1776346025206,
    title: "EENDIGO - AI + GD diagnostic",
    report_url: "https://app.read.ai/analytics/meetings/01KPB3Y4GVMH0QW7BP4SF2WJKM",
    folders: ["Professional Consultation"],
    participants: [
      { name: "Livio Moretti", email: "livio.moretti@eendigo.com", invited: true, attended: true },
      { name: "Ponseggi, Laerte", email: "laerte.ponseggi@coesia.com", invited: false, attended: true },
      { name: "Thomas R. Hahn", email: null, invited: false, attended: true },
      { name: "Wissam Kahi", email: "wissam.kahi@eendigo.com", invited: true, attended: true },
      { name: null, email: "alessandro.parimbelli@coesia.com", invited: false, attended: false },
    ],
    summary: "Client discussion on AI use cases + GD diagnostic for Coesia. Dual-track approach: custom AI in-house for R&D / machine-resident agents vs. off-the-shelf for CRM/purchasing/marketing. Internal examples presented (automated proposal generation, dynamic pricing, AI hiring). Staged POC → pilot/MVP → enterprise scaling agreed. Five-week diagnostic + eight-week pilot proposed, mid-June start.",
  },
  {
    id: "01KPAVAW8NN75EX8SJRC46Q8JJ",
    start_time_ms: 1776333189397,
    end_time_ms: 1776335636831,
    title: "Exploratory Discussion | Commercial Excellence Manager",
    report_url: "https://app.read.ai/analytics/meetings/01KPAVAW8NN75EX8SJRC46Q8JJ",
    folders: ["Professional Consultation"],
    participants: [
      { name: "Castellano, Ornella", email: "ornella.castellano@coesia.com", invited: false, attended: true },
      { name: "Livio Moretti", email: "livio.moretti@eendigo.com", invited: true, attended: true },
      { name: "Matteo Filippo Balduzzi", email: "matteofilippo.balduzzi@gmail.com", invited: true, attended: true },
      { name: "Ponseggi, Laerte", email: "laerte.ponseggi@coesia.com", invited: false, attended: true },
    ],
    summary: "Exploratory discussion with Coesia on Commercial Excellence Manager role and 100-day operational plan. Three intervention areas: diagnostic, organizational actions, best-practice playbook. Matteo presented BPO-nomination plan, weekly touchpoints, KPI hierarchy with dashboarding, customer segmentation (employees / revenue / margin), churn-oriented incentive schemes, Academy-based training with eight-week onboarding.",
  },
  {
    id: "01KPASK2TSA0W39M3MSPM3DQDA",
    start_time_ms: 1776331361113,
    end_time_ms: 1776331868075,
    title: "1:1 Edoardo<>Livio",
    report_url: "https://app.read.ai/analytics/meetings/01KPASK2TSA0W39M3MSPM3DQDA",
    folders: [],
    participants: [
      { name: "Edoardo Tiani", email: "edoardo.tiani@eendigo.com", invited: true, attended: true },
      { name: null, email: "livio.moretti@eendigo.com", invited: true, attended: false },
    ],
    summary: null,
  },
];
