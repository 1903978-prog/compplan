/**
 * C13 — Email Composer
 * 20 slot-based email templates for common agent communication patterns.
 * Slot syntax: {{slot_name}}
 * Replaces "draft an email" Claude calls. Falls back to Claude only if no template matches.
 * Zero LLM calls for matched templates.
 */
import { logMicroAI } from "./logger.js";

export interface EmailSlots {
  [key: string]: string | number | undefined;
}

export interface EmailOutput {
  subject: string;
  body: string;
  templateUsed?: string;
  fallbackNeeded?: boolean;
}

// ── Template registry ──────────────────────────────────────────────────────
// Each template has a subject and body with {{slot}} placeholders.
// Keyed by template_id for programmatic access.
const TEMPLATES: Record<string, { subject: string; body: string; tags: string[] }> = {

  // ── BD / Client ────────────────────────────────────────────────────────
  "bd_intro_email": {
    tags: ["bd", "prospecting", "intro"],
    subject: "Eendigo × {{company_name}} — Strategy & Execution",
    body: `Dear {{contact_name}},

I hope this message finds you well. My name is {{sender_name}} from Eendigo, a boutique strategy and execution firm working with mid-market companies across the Benelux and beyond.

We specialise in {{service_focus}} and have recently helped similar companies in {{industry}} achieve {{outcome_teaser}}.

I would love to explore whether there is a fit — would a 20-minute call next week work for you?

Best regards,
{{sender_name}}
Eendigo`,
  },

  "bd_follow_up": {
    tags: ["bd", "follow-up"],
    subject: "Re: {{original_subject}} — Quick follow-up",
    body: `Dear {{contact_name}},

I wanted to follow up on my previous message regarding {{topic}}. I understand you are busy, so I will keep this short.

We have just completed a similar engagement for a {{industry}} company and the results were {{outcome_teaser}}.

Happy to share a short case study if that would be useful. Would {{proposed_date}} work for a brief call?

Best regards,
{{sender_name}}
Eendigo`,
  },

  "bd_proposal_send": {
    tags: ["bd", "proposal"],
    subject: "{{company_name}} — Eendigo Proposal",
    body: `Dear {{contact_name}},

As discussed, please find attached our proposal for {{project_title}}.

In brief, we propose a {{duration}} engagement structured as follows:
- Phase 1: {{phase_1}}
- Phase 2: {{phase_2}}
- Phase 3: {{phase_3}}

Investment: €{{fee_mid}}/week (full range: €{{fee_min}}–€{{fee_max}}).

We are confident this approach will deliver {{expected_outcome}}. I am happy to walk you through the details at your convenience.

Best regards,
{{sender_name}}
Eendigo`,
  },

  "bd_deal_won": {
    tags: ["bd", "won"],
    subject: "Welcome aboard — {{company_name}} × Eendigo",
    body: `Dear {{contact_name}},

Excellent news — we are delighted to confirm the engagement for {{project_title}}.

Kick-off is scheduled for {{kickoff_date}}. Our project lead will be {{project_lead}} who will reach out shortly to align on logistics.

We look forward to delivering {{expected_outcome}} together.

Best regards,
{{sender_name}}
Eendigo`,
  },

  "bd_deal_lost": {
    tags: ["bd", "lost"],
    subject: "Thank you — {{company_name}} & Eendigo",
    body: `Dear {{contact_name}},

Thank you for considering Eendigo for {{project_title}}. We understand you have decided to go in a different direction at this time.

We genuinely enjoyed learning about {{company_name}} and hope there will be opportunities to collaborate in the future.

Should circumstances change, please do not hesitate to reach out.

Best regards,
{{sender_name}}
Eendigo`,
  },

  // ── Candidate / Recruiting ─────────────────────────────────────────────
  "hire_application_ack": {
    tags: ["hiring", "candidate", "ack"],
    subject: "Your application to Eendigo — {{role_title}}",
    body: `Dear {{candidate_name}},

Thank you for your application for the {{role_title}} position at Eendigo. We have received your materials and will review them carefully.

You can expect to hear from us within {{response_days}} business days regarding next steps.

Best regards,
{{sender_name}}
Eendigo People Team`,
  },

  "hire_interview_invite": {
    tags: ["hiring", "candidate", "interview"],
    subject: "Interview invitation — {{role_title}} at Eendigo",
    body: `Dear {{candidate_name}},

We were impressed by your profile and would like to invite you to an interview for the {{role_title}} role.

Proposed slot: {{interview_date}} at {{interview_time}} ({{duration}} minutes)
Format: {{interview_format}}
Interviewer(s): {{interviewers}}

Please confirm your availability by replying to this email or selecting an alternative from: {{calendar_link}}.

Best regards,
{{sender_name}}
Eendigo People Team`,
  },

  "hire_rejection": {
    tags: ["hiring", "candidate", "rejection"],
    subject: "Update on your Eendigo application — {{role_title}}",
    body: `Dear {{candidate_name}},

Thank you for taking the time to apply and interview for the {{role_title}} position at Eendigo. We appreciated getting to know you during the process.

After careful consideration, we have decided to move forward with another candidate whose profile more closely matches our current needs.

We were genuinely impressed by {{positive_note}} and encourage you to keep an eye on our future openings.

We wish you every success in your search.

Best regards,
{{sender_name}}
Eendigo People Team`,
  },

  "hire_offer": {
    tags: ["hiring", "candidate", "offer"],
    subject: "Offer of Employment — {{role_title}} at Eendigo",
    body: `Dear {{candidate_name}},

We are delighted to offer you the position of {{role_title}} at Eendigo.

Key terms:
- Start date: {{start_date}}
- Gross fixed salary: €{{gross_salary}}/year
- Bonus: {{bonus_pct}}% of gross fixed
- Meal vouchers: €{{meal_voucher}}/day

A formal employment contract will follow within {{contract_days}} business days.

Please confirm your acceptance by {{acceptance_deadline}}.

We look forward to welcoming you to the team!

Best regards,
{{sender_name}}
Eendigo People Team`,
  },

  // ── Project Delivery / Client Updates ─────────────────────────────────
  "project_kickoff_confirm": {
    tags: ["delivery", "kickoff"],
    subject: "Kick-off confirmed — {{project_title}}",
    body: `Dear {{contact_name}},

This email confirms our kick-off meeting for {{project_title}}.

Date & time: {{kickoff_date}} at {{kickoff_time}}
Location / link: {{kickoff_location}}
Attendees: {{attendees}}

Agenda:
1. Project scope & objectives
2. Workplan & milestones
3. Governance & escalation
4. Next steps

Please send over any background materials by {{materials_deadline}} so we can prepare.

Best regards,
{{sender_name}}
Eendigo`,
  },

  "project_status_update": {
    tags: ["delivery", "status"],
    subject: "{{project_title}} — Status Update (Week {{week_number}})",
    body: `Dear {{contact_name}},

Please find below a brief status update for week {{week_number}}.

**Progress this week**
{{progress_summary}}

**Planned for next week**
{{next_week_plan}}

**Risks / blockers**
{{risks}}

Overall status: {{traffic_light}} ({{traffic_light_reason}})

Let me know if you have any questions.

Best regards,
{{sender_name}}
Eendigo`,
  },

  "project_deliverable_send": {
    tags: ["delivery", "deliverable"],
    subject: "{{project_title}} — {{deliverable_name}} delivered",
    body: `Dear {{contact_name}},

Please find attached {{deliverable_name}} as agreed in our project plan.

Key highlights:
{{highlights}}

Next milestone: {{next_milestone}} by {{next_milestone_date}}.

We welcome your feedback by {{feedback_deadline}}.

Best regards,
{{sender_name}}
Eendigo`,
  },

  "project_invoice": {
    tags: ["delivery", "invoice", "finance"],
    subject: "Invoice {{invoice_number}} — {{project_title}}",
    body: `Dear {{contact_name}},

Please find attached invoice {{invoice_number}} for services rendered on {{project_title}} for the period {{billing_period}}.

Amount: €{{invoice_amount}} (excl. VAT)
Payment terms: {{payment_terms}}
Bank details: as per our standing agreement.

Please do not hesitate to contact us if you have any questions.

Best regards,
{{sender_name}}
Eendigo Finance`,
  },

  // ── Internal / AIOS ────────────────────────────────────────────────────
  "internal_approval_request": {
    tags: ["internal", "approval"],
    subject: "Approval needed: {{action_title}}",
    body: `Hi {{approver_name}},

I am requesting your approval for the following action:

**Action:** {{action_title}}
**Agent:** {{agent_name}}
**Decision level:** {{decision_level}}
**Rationale:** {{rationale}}
**Deadline:** {{deadline}}

Please approve or reject via the Approvals page in the AIOS dashboard.

Thanks,
{{sender_name}}`,
  },

  "internal_conflict_escalation": {
    tags: ["internal", "conflict"],
    subject: "Conflict escalation: {{conflict_title}}",
    body: `Hi {{recipient_name}},

A conflict has been flagged that requires your attention:

**Conflict:** {{conflict_title}}
**Agents involved:** {{agents_involved}}
**Impact:** {{impact}}
**Suggested resolution:** {{suggested_resolution}}

Please review and decide via the AIOS dashboard.

Thanks,
{{sender_name}}`,
  },

  "internal_weekly_summary": {
    tags: ["internal", "weekly"],
    subject: "AIOS Weekly Summary — Week {{week_number}}",
    body: `Hi {{recipient_name}},

Here is the weekly AIOS summary for week {{week_number}}.

**Deliverables completed:** {{deliverables_count}}
**Decisions made:** {{decisions_count}} (L3: {{l3_count}}, L2: {{l2_count}}, L1: {{l1_count}})
**Conflicts raised:** {{conflicts_count}}
**Top agent:** {{top_agent}} (score: {{top_score}})
**API tokens saved:** {{tokens_saved}} (~€{{cost_saved}} saved)

Full report available in the AIOS dashboard.

{{sender_name}}`,
  },

  // ── Vendor / Partner ───────────────────────────────────────────────────
  "vendor_intro": {
    tags: ["vendor", "intro"],
    subject: "Partnership enquiry — Eendigo × {{vendor_name}}",
    body: `Dear {{contact_name}},

My name is {{sender_name}} from Eendigo. We are a strategy and execution consultancy and are exploring potential partnerships in {{service_area}}.

We believe {{vendor_name}}'s offering in {{vendor_specialty}} could complement our work with {{target_clients}}.

Would you be open to a short introductory call to explore synergies?

Best regards,
{{sender_name}}
Eendigo`,
  },

  "vendor_po_confirm": {
    tags: ["vendor", "purchase"],
    subject: "Purchase Order {{po_number}} — {{vendor_name}}",
    body: `Dear {{contact_name}},

Please find attached Purchase Order {{po_number}} for {{service_description}}.

Amount: €{{po_amount}}
Delivery by: {{delivery_date}}
Payment terms: {{payment_terms}}

Please confirm receipt and acceptance of this PO.

Best regards,
{{sender_name}}
Eendigo`,
  },

  // ── Press / Media ──────────────────────────────────────────────────────
  "press_response": {
    tags: ["press", "media"],
    subject: "Re: {{journalist_inquiry_subject}}",
    body: `Dear {{journalist_name}},

Thank you for reaching out to Eendigo regarding {{topic}}.

{{response_statement}}

For further information, please contact {{press_contact}} at {{press_email}}.

We kindly ask that any quotes be attributed to "an Eendigo spokesperson" unless explicitly agreed otherwise.

Best regards,
{{sender_name}}
Eendigo`,
  },

  // ── Generic fallback ───────────────────────────────────────────────────
  "generic_professional": {
    tags: ["generic"],
    subject: "{{subject}}",
    body: `Dear {{recipient_name}},

{{body_paragraph_1}}

{{body_paragraph_2}}

{{closing_line}}

Best regards,
{{sender_name}}
Eendigo`,
  },
};

// ── Template resolution ────────────────────────────────────────────────────

/** Return the template registry (read-only) */
export function listTemplates(): string[] {
  return Object.keys(TEMPLATES);
}

/** Get tags for a template */
export function getTemplateTags(templateId: string): string[] {
  return TEMPLATES[templateId]?.tags ?? [];
}

/**
 * Find the best matching template for a given set of search tags.
 * Returns the template ID with the most tag overlap, or null.
 */
export function findTemplate(searchTags: string[]): string | null {
  let bestId: string | null = null;
  let bestScore = 0;
  for (const [id, tpl] of Object.entries(TEMPLATES)) {
    const overlap = tpl.tags.filter(t => searchTags.includes(t)).length;
    if (overlap > bestScore) { bestScore = overlap; bestId = id; }
  }
  return bestScore > 0 ? bestId : null;
}

/** Fill {{slot}} placeholders in a string */
function fillSlots(template: string, slots: EmailSlots): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = slots[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

/**
 * Compose an email from a named template + slot values.
 * @param templateId  Key from the template registry (or use findTemplate() first)
 * @param slots       Map of slot_name → value
 */
export async function composeEmail(templateId: string, slots: EmailSlots): Promise<EmailOutput> {
  const t0 = Date.now();
  const tpl = TEMPLATES[templateId];

  if (!tpl) {
    await logMicroAI({
      module_name: "emailComposer",
      latency_ms: Date.now() - t0,
      fallback_to_claude: true,
    });
    return {
      subject: slots["subject"] ? String(slots["subject"]) : "(no subject)",
      body: "",
      templateUsed: undefined,
      fallbackNeeded: true,
    };
  }

  const subject = fillSlots(tpl.subject, slots);
  const body    = fillSlots(tpl.body, slots);

  await logMicroAI({
    module_name: "emailComposer",
    latency_ms: Date.now() - t0,
    saved_tokens_estimate: 600,
  });

  return { subject, body, templateUsed: templateId, fallbackNeeded: false };
}
