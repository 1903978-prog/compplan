---
name: CFO internal escalation
agent: ar_agent
trigger: Invoice 60+ days overdue, internal flag to CFO
slots: [client_name, invoice_number, amount, days_overdue, attempts_made, risk_assessment, recommended_action]
output: markdown
---

# AR Escalation to CFO — {{client_name}}

**Invoice:** {{invoice_number}}
**Amount:** {{amount}}
**Days overdue:** {{days_overdue}}

## Collection attempts

{{#each attempts_made}}
- {{attempt}}
{{/each}}

## Risk assessment

{{risk_assessment}}

## Recommended action

{{recommended_action}}
