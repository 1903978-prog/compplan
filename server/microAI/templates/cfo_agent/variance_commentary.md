---
name: Variance commentary
agent: cfo_agent
trigger: Month-end actual vs budget
slots: [period, line_items]
output: markdown
---

# Variance Commentary — {{period}}

{{#each line_items}}
## {{line}}
- Budget: €{{budget}} | Actual: €{{actual}} | Variance: €{{variance}} ({{variance_pct}}%)
- Driver: {{driver}}
- Action: {{action}}
{{/each}}
