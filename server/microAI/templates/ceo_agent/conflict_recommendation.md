---
name: Conflict resolution recommendation
agent: ceo_agent
trigger: Cross-agent conflict detected
slots: [conflict_id, agents_involved, root_cause, okrs_affected, options, ceo_recommendation, urgency]
output: markdown
---

# Conflict #{{conflict_id}} — CEO Recommendation

**Agents involved:** {{agents_involved}}
**OKRs affected:** {{okrs_affected}}
**Urgency:** {{urgency}}

## Root cause
{{root_cause}}

## Options considered
{{#each options}}
- **Option {{letter}}:** {{description}} — Pros: {{pros}} — Cons: {{cons}}
{{/each}}

## CEO recommendation
{{ceo_recommendation}}

## Decision required from President: APPROVE / MODIFY / REJECT
