---
name: Discount validation
agent: pricing_agent
trigger: Discount requested
slots: [client, deal_name, list_price, proposed_price, discount_pct, justification, strategic_value, verdict, conditions]
output: markdown
---

# Discount Validation — {{deal_name}}

**Client:** {{client}}

| | Amount |
|---|---|
| List price | {{list_price}} |
| Proposed price | {{proposed_price}} |
| Discount | {{discount_pct}}% |

## Justification

{{justification}}

## Strategic value

{{strategic_value}}

## Verdict

**{{verdict}}**

## Conditions (if approved)

{{#each conditions}}
- {{condition}}
{{/each}}
