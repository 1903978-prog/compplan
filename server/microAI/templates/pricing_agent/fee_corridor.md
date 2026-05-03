---
name: Fee corridor
agent: pricing_agent
trigger: New engagement scoping
slots: [engagement_type, client_segment, scope_summary, days_estimate, floor_rate, target_rate, ceiling_rate, rationale, risk_adjustments]
output: markdown
---

# Fee Corridor — {{engagement_type}}

**Client segment:** {{client_segment}}
**Scope:** {{scope_summary}}
**Estimated effort:** {{days_estimate}} days

## Fee range

| Level | Rate | Total |
|---|---|---|
| Floor | {{floor_rate}} | — |
| Target | {{target_rate}} | — |
| Ceiling | {{ceiling_rate}} | — |

## Rationale

{{rationale}}

## Risk adjustments

{{#each risk_adjustments}}
- {{adjustment}}
{{/each}}
