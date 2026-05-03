---
name: Deal health summary
agent: svp_sales
trigger: Per-deal weekly check
slots: [client, value, stage, probability, days_in_stage, last_touch, health_color, blockers, next_action]
output: markdown
---

# {{client}} — Deal health: {{health_color}}

| Field | Value |
|---|---|
| Value | €{{value}} |
| Stage | {{stage}} ({{days_in_stage}} days) |
| Probability | {{probability}}% |
| Last touch | {{last_touch}} |

## Blockers
{{#each blockers}}
- {{blocker}}
{{/each}}

## Next action
{{next_action}}
