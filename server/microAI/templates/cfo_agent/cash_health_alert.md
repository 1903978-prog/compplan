---
name: Cash health alert
agent: cfo_agent
trigger: Runway < 6 months OR DSO > 60 days
slots: [trigger_reason, runway_months, dso_days, top_overdue_invoices, recommendations]
output: markdown
---

# 🚨 Cash health alert

**Trigger:** {{trigger_reason}}
**Runway:** {{runway_months}} months
**DSO:** {{dso_days}} days

## Top overdue invoices
{{#each top_overdue_invoices}}
- {{client}}: €{{amount}} ({{days_overdue}} days overdue)
{{/each}}

## Recommendations
{{#each recommendations}}
- {{recommendation}}
{{/each}}
