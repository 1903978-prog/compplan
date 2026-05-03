---
name: Reliability memo
agent: delivery_officer
trigger: Incident or SLA miss
slots: [project_name, client, incident_date, description, root_cause, impact_summary, corrective_actions, prevention_measures, owner]
output: markdown
---

# Reliability Memo — {{project_name}}

**Client:** {{client}}
**Date:** {{incident_date}}

## What happened

{{description}}

## Root cause

{{root_cause}}

## Impact

{{impact_summary}}

## Corrective actions

{{#each corrective_actions}}
- {{action}}
{{/each}}

## Prevention measures

{{#each prevention_measures}}
- {{measure}}
{{/each}}

**Owner:** {{owner}}
