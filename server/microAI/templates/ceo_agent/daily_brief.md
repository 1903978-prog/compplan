---
name: Daily CEO Brief
agent: ceo_agent
trigger: End of daily Atlas cycle
slots: [date, tldr, top_decisions, autonomous_actions, open_conflicts, cash_status, pipeline_status, hiring_status, ar_status]
output: markdown
---

# Daily CEO Brief — {{date}}

## TL;DR
{{tldr}}

## Decisions awaiting the President (L3)
{{#each top_decisions}}
- **{{decision}}** — Urgency: {{urgency}}. CEO recommendation: {{recommendation}}
{{/each}}

## Autonomous actions taken in last 24h (L0)
{{#each autonomous_actions}}
- {{agent}} → {{action}} ({{impact}})
{{/each}}

## Open conflicts
{{#each open_conflicts}}
- **{{conflict}}** — CEO recommendation: {{ceo_recommendation}}
{{/each}}

## Traffic lights
- Cash: **{{cash_status.color}}** ({{cash_status.runway_months}} months runway)
- Pipeline: **{{pipeline_status.color}}** (coverage {{pipeline_status.coverage_ratio}}x)
- Hiring: **{{hiring_status.color}}** ({{hiring_status.note}})
- AR: **{{ar_status.color}}** (DSO {{ar_status.dso}} days)
