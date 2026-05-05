---
name: Performance review
agent: chro_agent
trigger: Review cycle (semi-annual)
slots: [employee, role, period, achievements, growth_areas, goals_next, calibration_recommendation]
output: markdown
---

# Performance Review — {{employee}} ({{role}})

**Period:** {{period}}

## Key achievements
{{#each achievements}}
- {{achievement}}
{{/each}}

## Growth areas
{{#each growth_areas}}
- {{area}} → suggested action: {{action}}
{{/each}}

## Goals for next period
{{#each goals_next}}
- {{goal}}
{{/each}}

## Calibration recommendation
{{calibration_recommendation}}
