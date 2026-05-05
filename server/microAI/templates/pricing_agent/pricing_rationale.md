---
name: Pricing rationale
agent: pricing_agent
trigger: Proposal sign-off
slots: [engagement_name, client, final_price, value_delivered, comparables, pricing_model, key_assumptions, approval_required]
output: markdown
---

# Pricing Rationale — {{engagement_name}}

**Client:** {{client}}
**Final price:** {{final_price}}

## Value delivered

{{value_delivered}}

## Pricing model

{{pricing_model}}

## Market comparables

{{#each comparables}}
- {{comparable}}
{{/each}}

## Key assumptions

{{#each key_assumptions}}
- {{assumption}}
{{/each}}

## Approval required

{{approval_required}}
