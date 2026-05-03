---
name: Project status report
agent: delivery_officer
trigger: Weekly
slots: [project_name, client, week, overall_rag, schedule_rag, budget_rag, scope_rag, accomplishments, next_week, blockers, budget_used_pct]
output: markdown
---

# Project Status — {{project_name}} ({{client}})

**Week:** {{week}}

| Dimension | Status |
|---|---|
| Overall | {{overall_rag}} |
| Schedule | {{schedule_rag}} |
| Budget | {{budget_rag}} |
| Scope | {{scope_rag}} |

**Budget consumed:** {{budget_used_pct}}%

## This week

{{#each accomplishments}}
- {{item}}
{{/each}}

## Next week

{{#each next_week}}
- {{item}}
{{/each}}

## Blockers

{{#each blockers}}
- {{blocker}}
{{/each}}
