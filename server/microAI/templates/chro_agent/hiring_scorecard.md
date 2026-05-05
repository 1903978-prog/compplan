---
name: Hiring scorecard
agent: chro_agent
trigger: Each candidate after final-round interview
slots: [candidate, role, seniority, dimensions, overall_score, recommendation, comp_band]
output: markdown
---

# Hiring scorecard — {{candidate}} ({{role}}, {{seniority}})

## Dimensions
{{#each dimensions}}
- **{{dimension}}**: {{score}}/5 — {{evidence}}
{{/each}}

**Overall:** {{overall_score}}/5

## Recommendation
{{recommendation}}

## Comp band
{{comp_band}}
