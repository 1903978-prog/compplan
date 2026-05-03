---
name: Risk register entry
agent: delivery_officer
trigger: Risk identified
slots: [project_name, risk_title, category, probability, impact, score, mitigation, contingency, owner, review_date]
output: markdown
---

# Risk Register Entry — {{project_name}}

| Field | Value |
|---|---|
| Risk | {{risk_title}} |
| Category | {{category}} |
| Probability | {{probability}} |
| Impact | {{impact}} |
| Risk score | {{score}} |
| Owner | {{owner}} |
| Review date | {{review_date}} |

## Mitigation plan

{{mitigation}}

## Contingency plan

{{contingency}}
