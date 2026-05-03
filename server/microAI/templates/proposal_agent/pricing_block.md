---
name: Pricing block
agent: proposal_agent
trigger: Proposal pricing section
slots: [engagement_title, pricing_model, line_items, total_investment, payment_terms, assumptions, optional_add_ons]
output: markdown
---

## Investment — {{engagement_title}}

**Pricing model:** {{pricing_model}}

### Fee breakdown

{{#each line_items}}
| {{item.description}} | {{item.fee}} |
{{/each}}

**Total investment: {{total_investment}}**

### Payment terms

{{payment_terms}}

### Assumptions

{{#each assumptions}}
- {{assumption}}
{{/each}}

### Optional add-ons

{{#each optional_add_ons}}
- {{add_on.description}}: {{add_on.fee}}
{{/each}}
