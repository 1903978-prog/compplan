---
name: Capacity plan report
agent: coo_agent
trigger: Weekly capacity check
slots: [week_of, total_capacity_days, allocated_days, utilisation_pct, by_person, overallocated, underutilised]
output: markdown
---

# Capacity report — Week of {{week_of}}

**Utilisation:** {{utilisation_pct}}% ({{allocated_days}} / {{total_capacity_days}} days)

## By person
{{#each by_person}}
- {{name}}: {{utilisation}}% ({{projects}})
{{/each}}

## Overallocated (>100%)
{{#each overallocated}}
- {{name}} ({{utilisation}}%) → recommend {{action}}
{{/each}}

## Underutilised (<60%)
{{#each underutilised}}
- {{name}} ({{utilisation}}%) → available for {{capacity_days}} more days
{{/each}}
